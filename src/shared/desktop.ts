export type DesktopPlatform = "darwin" | "win32" | "linux";

export interface DesktopPreferences {
  theme: "system" | "light" | "dark";
  density: "comfortable" | "compact" | "touch";
}

export interface DesktopState {
  preferences: DesktopPreferences;
  appearance: {
    platform: DesktopPlatform;
    theme: "light" | "dark";
    highContrast: boolean;
    reducedMotion: boolean;
  };
}

export type DesktopCommand =
  | "new-project"
  | "open-project"
  | "project-library"
  | "export-project"
  | "import-files"
  | "new-item"
  | "search"
  | "command-palette"
  | "settings"
  | "appearance"
  | "collector"
  | "releaser"
  | "present"
  | "undo"
  | "redo"
  | "delete"
  | "help";

export interface LocalModel {
  name: string;
  size?: number;
}

export interface AIConnectionResult {
  ok: true;
  message: string;
}

export const DEFAULT_DESKTOP_PREFERENCES: DesktopPreferences = {
  theme: "system",
  density: "comfortable",
};

/** Accept only the public preference fields, including at the IPC boundary. */
export function desktopPreferencePatch(
  value: unknown,
): Partial<DesktopPreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid appearance preferences.");
  const patch = value as Record<string, unknown>;
  if (Object.keys(patch).some((key) => !["theme", "density"].includes(key)))
    throw new Error("Unknown appearance preference.");
  if (
    ("theme" in patch &&
      !["system", "light", "dark"].includes(patch.theme as string)) ||
    ("density" in patch &&
      !["comfortable", "compact", "touch"].includes(patch.density as string))
  )
    throw new Error("Choose a supported appearance preference.");
  return { ...patch } as Partial<DesktopPreferences>;
}
