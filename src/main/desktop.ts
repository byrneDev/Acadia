import { rename } from "node:fs/promises";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import {
  DEFAULT_DESKTOP_PREFERENCES,
  desktopPreferencePatch,
  type DesktopCommand,
  type DesktopPlatform,
  type DesktopPreferences,
} from "../shared/desktop";
import { atomicWrite, readJSON } from "./storage";

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface SavedWindow {
  bounds: WindowBounds;
  maximized: boolean;
}
export type WindowKind = "collector" | "releaser";
interface DesktopFile {
  version: 1;
  preferences: DesktopPreferences;
  windows: Partial<Record<WindowKind, SavedWindow>>;
}

function savedWindow(value: unknown): SavedWindow | undefined {
  if (!value || typeof value !== "object") return;
  const { bounds, maximized } = value as SavedWindow;
  if (!bounds || typeof maximized !== "boolean") return;
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite))
    return;
  if (
    Math.abs(bounds.x) > 10_000_000 ||
    Math.abs(bounds.y) > 10_000_000 ||
    bounds.width < 32 ||
    bounds.height < 32 ||
    bounds.width > 32768 ||
    bounds.height > 32768
  )
    return;
  return {
    bounds: {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.round(bounds.width),
      height: Math.round(bounds.height),
    },
    maximized,
  };
}

/** App-local UI state deliberately lives outside portable research archives. */
export class DesktopStore {
  private value: DesktopFile = {
    version: 1,
    preferences: { ...DEFAULT_DESKTOP_PREFERENCES },
    windows: {},
  };
  private pending: Promise<unknown> = Promise.resolve();
  readonly path: string;
  constructor(directory: string) {
    this.path = join(directory, "desktop.json");
  }
  async load(): Promise<void> {
    try {
      const raw = await readJSON(this.path);
      if (raw === undefined) return;
      const data = raw as DesktopFile;
      if (!data || data.version !== 1)
        throw new Error("Invalid desktop state.");
      const preferences = {
        ...DEFAULT_DESKTOP_PREFERENCES,
        ...desktopPreferencePatch(data.preferences),
      };
      const windows: DesktopFile["windows"] = {};
      for (const kind of ["collector", "releaser"] as const) {
        const item = savedWindow(data.windows?.[kind]);
        if (item) windows[kind] = item;
      }
      this.value = { version: 1, preferences, windows };
    } catch (error) {
      // Preserve malformed preferences before a future successful write replaces them.
      await rename(this.path, `${this.path}.recovery-${Date.now()}`);
    }
  }
  get preferences(): DesktopPreferences {
    return { ...this.value.preferences };
  }
  window(kind: WindowKind): SavedWindow | undefined {
    const item = this.value.windows[kind];
    return item && { bounds: { ...item.bounds }, maximized: item.maximized };
  }
  private commit(update: (current: DesktopFile) => DesktopFile): Promise<void> {
    const operation = this.pending.then(async () => {
      const next = update(this.value);
      await atomicWrite(this.path, JSON.stringify(next, null, 2));
      this.value = next;
    });
    this.pending = operation.catch(() => undefined);
    return operation;
  }
  savePreferences(value: unknown): Promise<void> {
    const patch = desktopPreferencePatch(value);
    return this.commit((current) => ({
      ...current,
      preferences: { ...current.preferences, ...patch },
    }));
  }
  saveWindow(kind: WindowKind, value: SavedWindow): Promise<void> {
    const next = savedWindow(value);
    if (!next) return Promise.reject(new Error("Invalid window position."));
    return this.commit((current) => ({
      ...current,
      windows: { ...current.windows, [kind]: next },
    }));
  }
  flush(): Promise<unknown> {
    return this.pending;
  }
}

function overlap(a: WindowBounds, b: WindowBounds): number {
  return (
    Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  );
}

/** Keep the entire restored window reachable, including when its old display is gone. */
export function clampWindowBounds(
  bounds: WindowBounds | undefined,
  workAreas: WindowBounds[],
  minimum = { width: 960, height: 700 },
): WindowBounds {
  const fallback = workAreas[0] || { x: 0, y: 0, width: 1600, height: 1000 };
  const area = bounds
    ? workAreas.reduce(
        (best, current) =>
          overlap(bounds, current) > overlap(bounds, best) ? current : best,
        fallback,
      )
    : fallback;
  const width = Math.min(
    Math.max(bounds?.width || 1600, Math.min(minimum.width, area.width)),
    area.width,
  );
  const height = Math.min(
    Math.max(bounds?.height || 1000, Math.min(minimum.height, area.height)),
    area.height,
  );
  return {
    x: Math.round(
      Math.max(
        area.x,
        Math.min(
          bounds?.x ?? area.x + (area.width - width) / 2,
          area.x + area.width - width,
        ),
      ),
    ),
    y: Math.round(
      Math.max(
        area.y,
        Math.min(
          bounds?.y ?? area.y + (area.height - height) / 2,
          area.y + area.height - height,
        ),
      ),
    ),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function desktopMenuTemplate(
  platform: DesktopPlatform,
  send: (command: DesktopCommand) => void,
): MenuItemConstructorOptions[] {
  const mac = platform === "darwin";
  const command = (
    label: string,
    id: DesktopCommand,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({
    id: `acadia-${id}`,
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => send(id),
  });
  const separator: MenuItemConstructorOptions = { type: "separator" };
  return [
    ...(mac
      ? [
          {
            label: "Acadia",
            submenu: [
              { role: "about" },
              separator,
              command("Settings…", "settings", "CmdOrCtrl+,"),
              command("Appearance…", "appearance"),
              separator,
              { role: "services" },
              separator,
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              separator,
              { role: "quit" },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: "File",
      submenu: [
        command("New Investigation", "new-project", "CmdOrCtrl+N"),
        command("Open Project Archive…", "open-project", "CmdOrCtrl+O"),
        command("Project Library…", "project-library", "CmdOrCtrl+Shift+O"),
        separator,
        command("Import Sources…", "import-files", "CmdOrCtrl+Shift+I"),
        command("New Research Item…", "new-item", "CmdOrCtrl+Shift+N"),
        command(
          "Export Project Archive…",
          "export-project",
          "CmdOrCtrl+Shift+E",
        ),
        separator,
        ...(mac
          ? [{ role: "close" } as MenuItemConstructorOptions]
          : [
              command("Settings…", "settings", "CmdOrCtrl+,"),
              separator,
              { role: "quit" } as MenuItemConstructorOptions,
            ]),
      ],
    },
    {
      label: "Edit",
      submenu: [
        // Windows/Linux leave keyboard history to the focused editor. macOS menu
        // accelerators and menu clicks route through the same focus-aware command.
        {
          ...command("Undo", "undo", "CmdOrCtrl+Z"),
          registerAccelerator: false,
        },
        {
          ...command("Redo", "redo", mac ? "CmdOrCtrl+Shift+Z" : "Ctrl+Y"),
          registerAccelerator: false,
        },
        separator,
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
        separator,
        command("Find in Investigation", "search", "CmdOrCtrl+F"),
      ],
    },
    {
      label: "View",
      submenu: [
        command("Collector", "collector", "CmdOrCtrl+1"),
        command("Releaser", "releaser", "CmdOrCtrl+2"),
        command("Present Released Report…", "present", "CmdOrCtrl+Shift+P"),
        separator,
        command("Command Palette…", "command-palette", "CmdOrCtrl+K"),
        command("Appearance…", "appearance"),
        separator,
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        separator,
        { role: "togglefullscreen" },
      ],
    },
    {
      role: "windowMenu",
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(mac
          ? [separator, { role: "front" } as MenuItemConstructorOptions]
          : []),
      ],
    },
    {
      role: "help",
      label: "Help",
      submenu: [
        command("Acadia Guide", "help", "F1"),
        ...(!mac
          ? [separator, { role: "about" } as MenuItemConstructorOptions]
          : []),
      ],
    },
  ];
}

interface CommandMenu {
  items: { id?: unknown; enabled: boolean; submenu?: CommandMenu }[];
}

/** Native role/separator items can omit id at runtime despite Electron's typings. */
export function setDesktopMenuEnabled(
  menu: CommandMenu,
  enabled: boolean,
): void {
  for (const item of menu.items) {
    if (typeof item.id === "string" && item.id.startsWith("acadia-"))
      item.enabled = enabled;
    if (item.submenu) setDesktopMenuEnabled(item.submenu, enabled);
  }
}
