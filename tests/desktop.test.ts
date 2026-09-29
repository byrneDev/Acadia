import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampWindowBounds,
  DesktopStore,
  desktopMenuTemplate,
  setDesktopMenuEnabled,
} from "../src/main/desktop";
import { desktopPreferencePatch } from "../src/shared/desktop";
import {
  listLocalModels,
  testAIConnection,
} from "../src/main/model-connection";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function store() {
  const directory = await mkdtemp(join(tmpdir(), "acadia-desktop-"));
  directories.push(directory);
  const desktop = new DesktopStore(directory);
  await desktop.load();
  return { directory, desktop };
}

describe("app-local desktop preferences", () => {
  it("serializes simultaneous preference and geometry saves without losing either", async () => {
    const { desktop, directory } = await store();
    await Promise.all([
      desktop.savePreferences({ theme: "dark" }),
      desktop.saveWindow("releaser", {
        bounds: { x: -1300, y: 50, width: 1200, height: 800 },
        maximized: false,
      }),
      desktop.savePreferences({ density: "touch" }),
    ]);
    const reopened = new DesktopStore(directory);
    await reopened.load();
    expect(reopened.preferences).toEqual({ theme: "dark", density: "touch" });
    expect(reopened.window("releaser")).toEqual({
      bounds: { x: -1300, y: 50, width: 1200, height: 800 },
      maximized: false,
    });
    expect(await readdir(directory)).toEqual(["desktop.json"]);
    expect(JSON.parse(await readFile(desktop.path, "utf8"))).not.toHaveProperty(
      "project",
    );
  });
  it.each([
    null,
    [],
    { theme: "neon" },
    { density: "huge" },
    { theme: undefined },
    { apiKey: "secret" },
    { windows: {} },
  ])(
    "rejects unsupported IPC preference values before writing: %j",
    async (value) => {
      const { desktop } = await store();
      expect(() => desktop.savePreferences(value)).toThrow();
      expect(desktop.preferences).toEqual({
        theme: "system",
        density: "comfortable",
      });
    },
  );
  it("keeps the last committed preferences after a failed atomic write and allows retry", async () => {
    const { desktop } = await store();
    await desktop.savePreferences({ theme: "dark" });
    await rename(desktop.path, `${desktop.path}.before-failure`);
    await mkdir(desktop.path);
    await expect(
      desktop.savePreferences({ density: "compact" }),
    ).rejects.toThrow();
    expect(desktop.preferences).toEqual({
      theme: "dark",
      density: "comfortable",
    });
    await rm(desktop.path, { recursive: true });
    await rename(`${desktop.path}.before-failure`, desktop.path);
    await desktop.savePreferences({ density: "touch" });
    expect(
      JSON.parse(await readFile(desktop.path, "utf8")).preferences,
    ).toEqual({ theme: "dark", density: "touch" });
  });
  it("preserves corrupt configuration byte-for-byte and starts with recoverable defaults", async () => {
    const { desktop, directory } = await store();
    await writeFile(desktop.path, "{ interrupted desktop write");
    await desktop.load();
    const recovered = (await readdir(directory)).find((name) =>
      name.startsWith("desktop.json.recovery-"),
    )!;
    expect(await readFile(join(directory, recovered), "utf8")).toBe(
      "{ interrupted desktop write",
    );
    expect(desktop.preferences).toEqual({
      theme: "system",
      density: "comfortable",
    });
    await desktop.savePreferences({ theme: "light" });
    expect(await readFile(join(directory, recovered), "utf8")).toBe(
      "{ interrupted desktop write",
    );
  });
  it("drops invalid saved geometry without discarding valid appearance", async () => {
    const { desktop } = await store();
    await writeFile(
      desktop.path,
      JSON.stringify({
        version: 1,
        preferences: { theme: "light" },
        windows: {
          collector: {
            bounds: { x: 1, y: 1, width: -20, height: 10 },
            maximized: false,
          },
        },
      }),
    );
    await desktop.load();
    expect(desktop.preferences.theme).toBe("light");
    expect(desktop.window("collector")).toBeUndefined();
    const snapshot = desktop.preferences;
    snapshot.theme = "dark";
    expect(desktop.preferences.theme).toBe("light");
    expect(desktopPreferencePatch({ density: "compact" })).toEqual({
      density: "compact",
    });
  });
});

describe("window recovery", () => {
  const primary = { x: 0, y: 24, width: 1440, height: 876 };
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  it("restores a valid negative-coordinate secondary-display window", () => {
    const saved = { x: -1500, y: 100, width: 1100, height: 800 };
    expect(clampWindowBounds(saved, [primary, left])).toEqual(saved);
  });
  it("recovers a removed monitor's window completely into the primary work area", () => {
    expect(
      clampWindowBounds({ x: -1800, y: -200, width: 1600, height: 1100 }, [
        primary,
      ]),
    ).toEqual(primary);
  });
  it("clamps windows after a work-area or scale change without hiding the titlebar", () => {
    expect(
      clampWindowBounds({ x: 700, y: 400, width: 1200, height: 800 }, [
        primary,
      ]),
    ).toEqual({ x: 240, y: 100, width: 1200, height: 800 });
    expect(
      clampWindowBounds(undefined, [{ x: 0, y: 0, width: 800, height: 600 }]),
    ).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
  it("preserves the Releaser's supported narrower width", () => {
    const saved = { x: 20, y: 30, width: 800, height: 700 };
    expect(
      clampWindowBounds(saved, [primary], { width: 800, height: 700 }),
    ).toEqual(saved);
  });
});

describe("native menus", () => {
  it("handles native role items without IDs and disables only workspace commands for the audience", () => {
    const command = { id: "acadia-settings", enabled: true };
    const copy = { enabled: true };
    const menu = {
      items: [
        { enabled: true },
        { enabled: true, submenu: { items: [command, copy] } },
      ],
    };
    expect(() => setDesktopMenuEnabled(menu, false)).not.toThrow();
    expect(command.enabled).toBe(false);
    expect(copy.enabled).toBe(true);
    setDesktopMenuEnabled(menu, true);
    expect(command.enabled).toBe(true);
  });
  function flatten(
    items: MenuItemConstructorOptions[],
  ): MenuItemConstructorOptions[] {
    return items.flatMap((item) => [
      item,
      ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
    ]);
  }
  it.each(["darwin", "win32", "linux"] as const)(
    "exposes project/navigation commands on %s without swallowing editor history",
    (platform) => {
      const send = vi.fn();
      const menu = desktopMenuTemplate(platform, send);
      const items = flatten(menu);
      for (const label of ["File", "Edit", "View", "Window", "Help"])
        expect(menu.some((item) => item.label === label)).toBe(true);
      const undo = items.find((item) => item.id === "acadia-undo")!;
      expect(undo.registerAccelerator).toBe(false);
      expect(
        items.find((item) => item.id === "acadia-redo")!.registerAccelerator,
      ).toBe(false);
      expect(items.some((item) => item.role === "cut")).toBe(true);
      expect(items.some((item) => item.role === "paste")).toBe(true);
      const open = items.find((item) => item.id === "acadia-open-project")!;
      expect(open.accelerator).toBe("CmdOrCtrl+O");
      open.click!({} as never, undefined, {} as never);
      expect(send).toHaveBeenCalledWith("open-project");
      expect(items.some((item) => item.role === "reload")).toBe(false);
    },
  );
});

describe("deliberate model inventory checks", () => {
  it("discovers loopback Ollama models with only a credential-free GET", async () => {
    const request = vi.fn(async () =>
      Response.json({
        models: [
          { name: "qwen3.5:9b", size: 6594474711 },
          { name: "qwen3.5:9b" },
          { name: "llama3:latest" },
          { name: "bad\nname" },
        ],
      }),
    );
    vi.stubGlobal("fetch", request);
    expect(await listLocalModels("http://127.0.0.1:11434/api/chat")).toEqual([
      { name: "llama3:latest" },
      { name: "qwen3.5:9b" },
    ]);
    const [url, init] = request.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("http://127.0.0.1:11434/api/tags");
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: {},
    });
    expect(init).not.toHaveProperty("body");
  });
  it.each([
    "https://example.com",
    "http://192.168.1.1:11434",
    "http://localhost.attacker.test",
    "http://user:password@127.0.0.1",
    "http://127.0.0.1?key=secret",
  ])(
    "rejects non-local or credential-bearing discovery addresses: %s",
    async (endpoint) => {
      const request = vi.fn();
      vi.stubGlobal("fetch", request);
      await expect(
        Promise.resolve().then(() => listLocalModels(endpoint)),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
  it("checks a compatible model without a prompt, generation claim, or credentials in the result", async () => {
    const request = vi.fn(async () =>
      Response.json({ data: [{ id: "test-model" }] }),
    );
    vi.stubGlobal("fetch", request);
    const result = await testAIConnection({
      provider: "compatible",
      endpoint: "https://example.com/v1",
      model: "test-model",
      apiKey: "private-key",
    });
    expect(result.message).toMatch(
      /generation and billing availability have not been tested/,
    );
    expect(result.message).not.toContain("private-key");
    const [url, init] = request.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.href).toBe("https://example.com/v1/models");
    expect(init.headers).toEqual({ Authorization: "Bearer private-key" });
    expect(init).not.toHaveProperty("body");
  });
  it.each([401, 403, 404, 429, 500])(
    "uses bounded fixed messages for HTTP %i without provider text or retry",
    async (status) => {
      const request = vi.fn(
        async () => new Response("echoed-private-key", { status }),
      );
      vi.stubGlobal("fetch", request);
      const result = await testAIConnection({
        provider: "compatible",
        endpoint: "https://example.com/v1",
        model: "test-model",
      }).catch((error: Error) => error.message);
      expect(result).toContain(`HTTP ${status}`);
      expect(result).not.toContain("echoed-private-key");
      expect(request).toHaveBeenCalledTimes(1);
    },
  );
  it("reports reachable service with missing model separately from a working generation", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ models: [{ name: "other-model" }] })),
    );
    await expect(
      testAIConnection({
        provider: "ollama",
        endpoint: "http://localhost:11434",
        model: "qwen3.5:9b",
      }),
    ).rejects.toThrow(
      /selected model was not listed.*Generation has not been tested/,
    );
  });
  it("does not leak network errors or accept malformed/oversized model responses", async () => {
    const settings = {
      provider: "ollama" as const,
      endpoint: "http://localhost:11434",
      model: "test",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("private-key");
      }),
    );
    await expect(testAIConnection(settings)).rejects.toThrow(
      /^Could not reach the model service/,
    );
    for (const response of [
      new Response("broken"),
      new Response("{}", { headers: { "content-length": "1000001" } }),
      Response.json({ models: null }),
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response),
      );
      await expect(testAIConnection(settings)).rejects.toThrow(
        /model (list|service)/,
      );
    }
  });
});
