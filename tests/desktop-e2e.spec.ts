import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const executable =
  process.env.ACADIA_TEST_EXECUTABLE ||
  (createRequire(join(root, "package.json"))("electron") as string);

async function launch(
  profile: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    executablePath: executable,
    args: process.env.ACADIA_TEST_EXECUTABLE
      ? []
      : [join(root, "out/main/index.js")],
    cwd: root,
    env: { ...environment, ACADIA_USER_DATA: profile },
  });
  const page = await app.firstWindow();
  await expect(page.locator(".app")).toBeVisible();
  return { app, page };
}

async function capture(page: Page, name: string) {
  const directory = join(root, "tmp", "gui-review");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: join(directory, `${name}.png`),
    animations: "disabled",
  });
}

test("appearance controls and command palette provide keyboard-accessible research navigation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-gui-controls-"));
  const profile = join(directory, "profile");
  let session: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    session = await launch(profile);
    const page = session.page;
    await page.setViewportSize({ width: 1600, height: 1000 });
    const cardsBefore = (await page.evaluate(() => window.acadia!.load()))
      .project.cards;
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    const itemDialog = page.getByRole("dialog", {
      name: "Add to the Collector",
      exact: true,
    });
    const title = itemDialog.getByLabel("Title", { exact: true });
    await title.fill("A new research item");
    await title.press("ArrowRight");
    await title.pressSequentially(" with a detail");
    const editedTitle = await title.inputValue();
    const nativeEdit = (id: "undo" | "redo") =>
      session!.app.evaluate(({ Menu, BrowserWindow }, id) => {
        const item = Menu.getApplicationMenu()!.getMenuItemById(
          `acadia-${id}`,
        )!;
        if (!item.enabled)
          throw new Error("Native edit menu is disabled in the Collector.");
        item.click(
          item,
          BrowserWindow.getFocusedWindow() || undefined,
          {} as never,
        );
      }, id);
    await nativeEdit("undo");
    await expect(title).not.toHaveValue(editedTitle);
    await expect(itemDialog).toBeVisible();
    await nativeEdit("redo");
    await expect(title).toHaveValue(editedTitle);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(title).not.toHaveValue(editedTitle);
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+y",
    );
    await expect(title).toHaveValue(editedTitle);
    expect(
      (await page.evaluate(() => window.acadia!.load())).project.cards,
    ).toEqual(cardsBefore);
    await itemDialog
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    const appearance = page.getByRole("dialog", {
      name: "Appearance",
      exact: true,
    });
    await expect(appearance).toBeVisible();
    await appearance
      .getByRole("button", { name: "Light", exact: true })
      .click();
    await expect(
      appearance.getByRole("button", { name: "Light", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await appearance.getByLabel("Control size").selectOption("comfortable");
    await appearance.getByRole("button", { name: "Done", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Appearance", exact: true }),
    ).toBeFocused();
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    await capture(page, "collector-light-1600");

    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await appearance.getByRole("button", { name: "Dark", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await appearance.getByRole("button", { name: "Done", exact: true }).click();
    await capture(page, "collector-dark-1600");

    await page.keyboard.press("ControlOrMeta+k");
    const commands = page.getByRole("dialog", {
      name: "Commands",
      exact: true,
    });
    const commandInput = commands.getByRole("combobox", {
      name: "Find a command",
    });
    await expect(commandInput).toBeFocused();
    await expect(commandInput).toHaveAttribute("aria-expanded", "true");
    const options = commands.getByRole("option");
    await commandInput.press("ArrowDown");
    await expect(options.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(commandInput).toHaveAttribute(
      "aria-activedescendant",
      (await options.nth(1).getAttribute("id"))!,
    );
    for (let index = 2; index < (await options.count()); index++)
      await commandInput.press("ArrowDown");
    const activeOption = commands.getByRole("option", { selected: true });
    await expect(activeOption).toHaveText("Workspace guide");
    await expect(activeOption).toBeInViewport({ ratio: 1 });
    await expect(commandInput).toHaveAttribute(
      "aria-activedescendant",
      (await activeOption.getAttribute("id"))!,
    );
    await commandInput.fill("Search investigation");
    await expect(
      commands.getByRole("option", { selected: true }),
    ).toContainText("Search investigation");
    await page.keyboard.press("Enter");
    const search = page.getByRole("dialog", {
      name: "Search investigation",
      exact: true,
    });
    await expect(search.getByLabel("Search all research")).toBeFocused();
    await search.getByLabel("Search all research").fill("Collector");
    await expect(
      search.locator(".search-results button").first(),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).not.toBeVisible();
    await page.getByRole("button", { name: "Sources", exact: true }).click();
    await expect(page.locator(".research-workspace")).toBeVisible();
    await capture(page, "sources-dark-1600");
    await session.app.close();
    session = await launch(profile);
    await expect(session.page.locator("html")).toHaveAttribute(
      "data-theme",
      "dark",
    );
    await session.page
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await expect(
      session.page
        .getByRole("dialog", { name: "Appearance", exact: true })
        .getByRole("button", { name: "Dark", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
  } finally {
    await session?.app.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});

test("model discovery and connection buttons send only deliberate read-only inventory requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-model-ui-"));
  const requests: {
    method: string | undefined;
    url: string | undefined;
    authorization: string | undefined;
    body: string;
  }[] = [];
  let session: Awaited<ReturnType<typeof launch>> | undefined;
  let server: Server | undefined;
  try {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({ models: [{ name: "acadia-test:local", size: 1000 }] }),
      );
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    session = await launch(join(directory, "profile"));
    const page = session.page;
    await page
      .getByRole("button", { name: "Research engine settings", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Research engine",
      exact: true,
    });
    await dialog.getByLabel("Engine").selectOption("ollama");
    await dialog.getByLabel("Ollama server", { exact: true }).fill(endpoint);
    expect(requests).toEqual([]);
    await dialog
      .getByRole("button", { name: "Find installed models", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toHaveText(
      "Installed models found. Choose one below.",
    );
    await dialog
      .getByLabel("Installed models", { exact: true })
      .selectOption("acadia-test:local");
    await expect(dialog.getByLabel("Model name", { exact: true })).toHaveValue(
      "acadia-test:local",
    );
    expect(requests).toHaveLength(1);
    await dialog
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "Service reachable and selected model listed",
    );
    await expect(dialog.getByRole("status")).toContainText(
      "generation and billing availability have not been tested",
    );
    expect(requests).toEqual([
      { method: "GET", url: "/api/tags", authorization: undefined, body: "" },
      { method: "GET", url: "/api/tags", authorization: undefined, body: "" },
    ]);
    await dialog
      .getByRole("button", { name: "Save engine", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    expect((await page.evaluate(() => window.acadia!.load())).settings).toEqual(
      { provider: "ollama", endpoint, model: "acadia-test:local" },
    );
    expect(requests).toHaveLength(2);
  } finally {
    await session?.app.close().catch(() => undefined);
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("native appearance and window geometry survive restart while audience mutation stays blocked", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-native-ui-"));
  const profile = join(directory, "profile");
  let session: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    session = await launch(profile);
    const state = await session.page.evaluate(async () =>
      window.acadia!.saveDesktopPreferences!({
        theme: "light",
        density: "compact",
      }),
    );
    expect(state.preferences).toEqual({ theme: "light", density: "compact" });
    expect(state.appearance.theme).toBe("light");
    const bounds = await session.app.evaluate(({ BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows().find(
        (entry) => !entry.webContents.getURL().endsWith("#releaser"),
      )!;
      const area = screen.getPrimaryDisplay().workArea;
      window.unmaximize();
      window.setBounds({
        x: area.x,
        y: area.y,
        width: Math.min(area.width, 1100),
        height: Math.min(area.height, 740),
      });
      return window.getNormalBounds();
    });
    await expect
      .poll(
        async () =>
          JSON.parse(await readFile(join(profile, "desktop.json"), "utf8"))
            .windows?.collector?.bounds,
      )
      .toEqual(bounds);
    const menu = await session.app.evaluate(({ Menu }) => {
      const items = Menu.getApplicationMenu()!;
      return [
        "new-project",
        "project-library",
        "import-files",
        "appearance",
        "command-palette",
        "undo",
        "redo",
        "present",
      ].map((id) => ({
        id,
        found: Boolean(items.getMenuItemById(`acadia-${id}`)),
      }));
    });
    expect(menu.every((item) => item.found)).toBe(true);
    const opened = session.app.waitForEvent("window");
    await session.page.evaluate(() => window.acadia!.openReleaser());
    const audience = await opened;
    await expect(audience.locator(".app")).toBeVisible();
    expect(
      await audience.evaluate(
        async () => (await window.acadia!.getDesktopState!()).preferences,
      ),
    ).toEqual(state.preferences);
    for (const operation of [
      "preferences",
      "inventory",
      "connection",
    ] as const) {
      const error = await audience.evaluate(async (operation) => {
        try {
          if (operation === "preferences")
            await window.acadia!.saveDesktopPreferences!({ theme: "dark" });
          else if (operation === "inventory")
            await window.acadia!.listLocalModels!("http://localhost:11434");
          else
            await window.acadia!.testAIConnection!({
              provider: "offline",
              endpoint: "",
              model: "",
            });
          return "unexpected success";
        } catch (error) {
          return String(error);
        }
      }, operation);
      expect(error).toContain("Use the Collector");
    }
    await session.app.close();
    session = await launch(profile);
    expect(
      (await session.page.evaluate(() => window.acadia!.getDesktopState!()))
        .preferences,
    ).toEqual(state.preferences);
    expect(
      await session.app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].getNormalBounds(),
      ),
    ).toEqual(bounds);
    // A live system-theme update reaches both native state and the renderer event stream.
    await session.page.evaluate(() => {
      (window as Window & { desktopEvent?: unknown }).desktopEvent = undefined;
      window.acadia!.onDesktopChanged!((value) => {
        (window as Window & { desktopEvent?: unknown }).desktopEvent = value;
      });
    });
    await session.page.evaluate(() =>
      window.acadia!.saveDesktopPreferences!({ theme: "dark" }),
    );
    await expect
      .poll(() =>
        session!.page.evaluate(
          () =>
            (
              window as Window & {
                desktopEvent?: { appearance: { theme: string } };
              }
            ).desktopEvent?.appearance.theme,
        ),
      )
      .toBe("dark");
    await expect(
      session.page.evaluate(() =>
        window.acadia!.saveDesktopPreferences!({ theme: "invalid" as never }),
      ),
    ).rejects.toThrow(/supported appearance preference/);
    expect(
      (await session.page.evaluate(() => window.acadia!.getDesktopState!()))
        .preferences.theme,
    ).toBe("dark");
  } finally {
    await session?.app.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true });
  }
});
