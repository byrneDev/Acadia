import {
  _electron as electron,
  test as base,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PDFParse } from "pdf-parse";
import type { Project } from "../src/shared/types";

const root = resolve(process.cwd());
const electronExecutable = createRequire(join(root, "package.json"))(
  "electron",
) as string;
const packagedExecutable = process.env.ACADIA_TEST_EXECUTABLE;

interface NativeSession {
  app: ElectronApplication;
  page: Page;
  directory: string;
  restart(): Promise<void>;
}

/** Every run owns a disposable profile; no test loads the user's research. */
const test = base.extend<{ native: NativeSession }>({
  native: async ({}, use, testInfo) => {
    await access(packagedExecutable || join(root, "out/main/index.js"));
    const directory = await mkdtemp(join(tmpdir(), "acadia-e2e-"));
    const rendererErrors: string[] = [];
    let application!: ElectronApplication;
    let page!: Page;
    const launch = async () => {
      const environment = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key, value]) =>
            value !== undefined &&
            !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
        ),
      ) as Record<string, string>;
      application = await electron.launch({
        executablePath: packagedExecutable || electronExecutable,
        args: packagedExecutable ? [] : [join(root, "out/main/index.js")],
        cwd: root,
        env: { ...environment, ACADIA_USER_DATA: join(directory, "profile") },
        timeout: 30_000,
      });
      page = await application.firstWindow();
      page.on("pageerror", (error) => rendererErrors.push(error.message));
      await page.setViewportSize({ width: 1600, height: 1000 });
      await expect(
        page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
      ).toBeVisible();
      await application
        .context()
        .tracing.start({ screenshots: true, snapshots: true, sources: true });
    };
    await launch();
    const session: NativeSession = {
      get app() {
        return application;
      },
      get page() {
        return page;
      },
      directory,
      async restart() {
        await application.context().tracing.stop();
        await application.close();
        await launch();
      },
    };
    try {
      await use(session);
      expect(rendererErrors, "Unhandled renderer errors").toEqual([]);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) {
        await page
          .screenshot({
            path: testInfo.outputPath("failure.png"),
            animations: "disabled",
          })
          .catch(() => undefined);
        await application
          .context()
          .tracing.stop({ path: testInfo.outputPath("trace.zip") })
          .catch(() => undefined);
      } else
        await application
          .context()
          .tracing.stop()
          .catch(() => undefined);
      await application.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  },
});

async function project(page: Page): Promise<Project> {
  return page.evaluate(async () => (await window.acadia!.load()).project);
}

async function addNote(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title", { exact: true }).fill(title);
  await dialog.getByLabel("Notes & observations").fill(content);
  await dialog.getByRole("button", { name: "Add item", exact: true }).click();
  await expect(page.locator(".inspector h2")).toHaveText(title);
  await expect
    .poll(async () =>
      (await project(page)).cards.some((card) => card.title === title),
    )
    .toBe(true);
}

async function useReleaser(page: Page) {
  await page.getByRole("tab", { name: /Releaser/ }).click();
  await expect(
    page.getByRole("region", { name: "Releaser research workspace" }),
  ).toBeVisible();
}

async function generateOutline(page: Page, type?: string) {
  await useReleaser(page);
  if (type)
    await page.locator(".release-kind").filter({ hasText: type }).click();
  await page
    .getByRole("button", { name: "Build evidence brief", exact: true })
    .click();
  await expect(page.locator(".release-document")).toBeVisible();
  await expect(page.locator(".release-document-kicker")).toContainText(
    "WORKING DRAFT",
  );
  await expect(page.locator(".release-markdown")).toContainText(
    "No AI model was called",
  );
}

async function stubOpen(app: ElectronApplication, files: string[]) {
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths });
  }, files);
}

async function stubSave(app: ElectronApplication, file: string) {
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, file);
}

async function capture(page: Page, name: string) {
  await mkdir(join(root, "test-results"), { recursive: true });
  if (await page.locator(".release-composer").count())
    await page.locator(".release-composer").evaluate((element) => {
      element.scrollTop = 0;
    });
  await page.screenshot({
    path: join(root, "test-results", name),
    animations: "disabled",
  });
}

test("Collector adds, edits, connects and moves evidence, then restores it after restart", async ({
  native,
}) => {
  let page = native.page;
  await expect(page.locator(".library-item")).toHaveCount(7);
  await expect(page.locator(".react-flow__node")).toHaveCount(7);
  await expect(page.locator(".react-flow__edge")).toHaveCount(7);
  await capture(page, "collector.png");

  await addNote(
    page,
    "Interview evidence",
    "Three reviewers found the source trail useful.",
  );
  await page.getByRole("button", { name: "Edit item", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Title", { exact: true })
    .fill("Reviewed interview evidence");
  await page
    .getByRole("dialog")
    .getByLabel("Notes & observations")
    .fill(
      "Three reviewers found the source trail useful. Sample size remains a limitation.",
    );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.locator(".inspector h2")).toHaveText(
    "Reviewed interview evidence",
  );
  await page
    .getByRole("combobox", { name: "Evidence review" })
    .selectOption("supported");
  await page
    .getByRole("button", { name: "Close details", exact: true })
    .click();
  const boardNodes = page.locator(".react-flow__node");
  await expect(boardNodes).toHaveCount(8);
  for (const node of await boardNodes.all()) await expect(node).toBeVisible();
  await page
    .getByRole("button", { name: "Fit research board", exact: true })
    .click();

  const source = page.getByLabel(
    "Connect from Collect without losing context",
    { exact: true },
  );
  const target = page.getByLabel("Connect to Design the next investigation", {
    exact: true,
  });
  await source.dragTo(target);
  await expect(
    page
      .getByRole("dialog")
      .getByRole("heading", { name: "A meaningful connection" }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("combobox").selectOption("supports");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save connection", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await project(page)).connections.some(
        (connection) =>
          connection.source === "demo-collector" &&
          connection.target === "demo-research" &&
          connection.relation === "supports",
      ),
    )
    .toBe(true);

  const before = (await project(page)).cards.find(
    (card) => card.title === "Reviewed interview evidence",
  )!;
  const nodeHeading = page.locator(
    `.react-flow__node[data-id="${before.id}"] h3`,
  );
  await nodeHeading.hover();
  const box = await nodeHeading.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 70,
    box!.y + box!.height / 2 + 50,
    { steps: 12 },
  );
  await page.mouse.up();
  await expect
    .poll(async () => {
      const card = (await project(page)).cards.find(
        (card) => card.id === before.id,
      )!;
      return card.x !== before.x || card.y !== before.y;
    })
    .toBe(true);
  const saved = await project(page);
  const savedCard = saved.cards.find((card) => card.id === before.id)!;
  expect(savedCard.status).toBe("supported");
  expect(savedCard.content).toContain("Sample size remains a limitation.");

  await native.restart();
  page = native.page;
  await expect(page.locator(".library-item")).toHaveCount(8);
  const reopened = await project(page);
  expect(reopened.cards.find((card) => card.id === before.id)).toEqual(
    savedCard,
  );
  expect(reopened.connections).toEqual(saved.connections);
});

test("Releaser creates traceable outputs and presents only explicitly released revisions", async ({
  native,
}) => {
  const page = native.page;
  await generateOutline(page, "Hypothesis");
  await expect(page.locator(".release-markdown h1")).toHaveText("Hypothesis");
  await expect.poll(async () => (await project(page)).outputs.length).toBe(1);
  await capture(page, "releaser.png");
  await page.getByRole("button", { name: /Open display/ }).click();
  const opened = native.app.waitForEvent("window");
  await page
    .getByRole("dialog")
    .locator(".display-list button")
    .first()
    .click();
  const second = await opened;
  await expect(
    second.getByText("No report has been released.", { exact: false }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save & release", exact: true })
    .click();
  await expect(second.locator(".release-markdown h1")).toHaveText("Hypothesis");
  const writeDenied = await second.evaluate(async () => {
    try {
      await window.acadia!.save((await window.acadia!.load()).project);
      return "";
    } catch (e) {
      return String(e);
    }
  });
  expect(writeDenied).toContain("Use the Collector");
  await generateOutline(page, "Research plan");
  await expect(page.locator(".release-markdown h1")).toHaveText(
    "Research plan",
  );
  await expect(second.locator(".release-markdown h1")).toHaveText("Hypothesis");
  await page
    .getByRole("button", { name: "Save & release", exact: true })
    .click();
  await expect(second.locator(".release-markdown h1")).toHaveText(
    "Research plan",
  );
  await expect(second.locator(".release-output-item")).toHaveCount(1);
  await page.locator(".report-citation").first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "Immutable source version",
  );
  await expect(page.locator(".citation-target")).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("tab", { name: /Collector/ }).click();
  await page
    .locator(".library-item")
    .filter({ hasText: "Start with a question" })
    .click();
  await page.getByRole("button", { name: "Edit item", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Notes & observations")
    .fill("A new counterexample needs investigation.");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await useReleaser(page);
  await expect(page.locator(".release-message.is-stale")).toBeVisible();
  await expect(second.locator(".release-markdown")).not.toContainText(
    "A new counterexample needs investigation.",
  );
});

test("Native imports retain text and originals; exports and project recovery round-trip them", async ({
  native,
}) => {
  const page = native.page;
  const textPath = join(native.directory, "Field observations.txt");
  const pdfPath = join(native.directory, "Experiment brief.pdf");
  await writeFile(
    textPath,
    "FIELD OBSERVATIONS\nThree independent reviewers completed the pilot.\nA repeat study should test the counterexample.",
  );
  const fixturePDF = await native.app.evaluate(async ({ BrowserWindow }) => {
    const printer = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, javascript: false },
    });
    try {
      await printer.loadURL(
        "data:text/html;charset=utf-8," +
          encodeURIComponent(
            "<!doctype html><h1>Experiment brief</h1><p>A comparison group is required before attributing the improvement to the research board.</p>",
          ),
      );
      return (await printer.webContents.printToPDF({})).toString("base64");
    } finally {
      printer.destroy();
    }
  });
  await writeFile(pdfPath, Buffer.from(fixturePDF, "base64"));
  await test.info().attach("PDF import fixture", {
    body: Buffer.from(fixturePDF, "base64"),
    contentType: "application/pdf",
  });
  await stubOpen(native.app, [textPath, pdfPath]);
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  await expect(page.locator(".library-item")).toHaveCount(9);
  await expect
    .poll(
      async () =>
        (await project(page)).cards.filter((card) => card.assetId).length,
    )
    .toBe(2);
  const imported = await project(page);
  const textCard = imported.cards.find(
    (card) => card.fileName === "Field observations.txt",
  )!;
  const pdfCard = imported.cards.find(
    (card) => card.fileName === "Experiment brief.pdf",
  )!;
  for (const card of [textCard, pdfCard])
    await expect
      .poll(async () =>
        page.evaluate(async (id) => {
          const d = await window.acadia!.getSource(id);
          return d.versions.find((v) => v.id === d.source.currentVersionId)
            ?.status;
        }, card.sourceId!),
      )
      .toBe("ready");
  const sourceText = async (id: string) =>
    page.evaluate(
      async (id) =>
        (await window.acadia!.getSource(id)).passages
          .map((p) => p.text)
          .join("\n"),
      id,
    );
  expect(await sourceText(textCard.sourceId!)).toContain(
    "Three independent reviewers",
  );
  expect(await sourceText(pdfCard.sourceId!)).toContain(
    "comparison group is required",
  );
  expect(textCard.extraction || "").toBe("");
  await page.evaluate(
    async (ids) => {
      for (const id of ids) await window.acadia!.setSourcePolicy(id, "pin");
    },
    [textCard.sourceId!, pdfCard.sourceId!],
  );

  await generateOutline(page, "Gap analysis");
  const markdownPath = join(native.directory, "research-output.md");
  await stubSave(native.app, markdownPath);
  await page.getByRole("button", { name: "Markdown", exact: true }).click();
  await expect
    .poll(async () => readFile(markdownPath, "utf8").catch(() => ""))
    .toContain("# Gap analysis");
  const markdown = await readFile(markdownPath, "utf8");
  expect(markdown).toContain("Three independent reviewers");
  expect(markdown).toContain("comparison group is required");

  const exportedPDF = join(native.directory, "research-output.pdf");
  await stubSave(native.app, exportedPDF);
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect
    .poll(async () =>
      (await readFile(exportedPDF).catch(() => Buffer.alloc(0)))
        .subarray(0, 5)
        .toString(),
    )
    .toBe("%PDF-");
  const parser = new PDFParse({ data: await readFile(exportedPDF) });
  try {
    const parsedPDF = await parser.getText();
    expect(parsedPDF.total).toBeGreaterThan(0);
    expect(parsedPDF.text).toContain("Gap analysis");
    expect(parsedPDF.text).toContain("Three independent reviewers");
  } finally {
    await parser.destroy();
  }

  const archive = join(native.directory, "portable-research.acadia");
  await stubSave(native.app, archive);
  await page.getByRole("button", { name: "Project menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Export portable project", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await readFile(archive).catch(() => Buffer.alloc(0)))
        .subarray(0, 2)
        .toString(),
    )
    .toBe("PK");
  await page.getByRole("button", { name: "Project menu", exact: true }).click();
  await page
    .getByRole("button", { name: "New research board", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create new board", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  await expect.poll(async () => (await project(page)).id).not.toBe(imported.id);
  await expect(page.locator(".library-item")).toHaveCount(0);
  const recoveries = await readdir(
    join(native.directory, "profile/workspace/recovery"),
  );
  expect(recoveries.some((file) => file.endsWith(".acadia"))).toBe(true);

  await stubOpen(native.app, [archive]);
  await page.getByRole("button", { name: "Project menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Import portable project", exact: true })
    .click();
  await expect(page.locator(".library-item")).toHaveCount(9);
  const restored = await project(page);
  expect(restored.outputs).toHaveLength(1);
  const restoredText = restored.cards.find(
    (card) => card.fileName === "Field observations.txt",
  )!;
  expect(restoredText.content).toBe(textCard.content);
  expect(restoredText.extraction).toBe(textCard.extraction);
  expect(await sourceText(restoredText.sourceId!)).toContain(
    "Three independent reviewers",
  );
  await native.app.evaluate(({ shell }) => {
    shell.openPath = async (path) => {
      (
        globalThis as unknown as { acadiaTestOpenedPath: string }
      ).acadiaTestOpenedPath = path;
      return "";
    };
  });
  await page
    .locator(".library-item")
    .filter({ hasText: "Field observations" })
    .click();
  await page
    .getByRole("button", { name: "Open original file", exact: true })
    .click();
  const openedPath = () =>
    native.app.evaluate(
      () =>
        (globalThis as unknown as { acadiaTestOpenedPath?: string })
          .acadiaTestOpenedPath ?? "",
    );
  await expect.poll(openedPath).not.toBe("");
  const original = await readFile(await openedPath(), "utf8");
  expect(original).toContain(
    "Three independent reviewers completed the pilot.",
  );
});

test("Simulated touch moves a card, pans and pinches the board; compact windows keep controls reachable", async ({
  native,
}) => {
  const page = native.page;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  // Touch support must be present when React Flow installs its D3 listeners.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  const touch = async (
    type: "touchStart" | "touchMove" | "touchEnd",
    points: { x: number; y: number; id: number }[],
  ) => {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((point) => ({
        ...point,
        radiusX: 2,
        radiusY: 2,
        force: 1,
      })),
    });
  };
  try {
    const card = (await project(page)).cards.find(
      (card) => card.id === "demo-collector",
    )!;
    const heading = page.locator(
      '.react-flow__node[data-id="demo-collector"] h3',
    );
    await heading.hover();
    const box = (await heading.boundingBox())!;
    const origin = {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      id: 0,
    };
    await touch("touchStart", [origin]);
    for (let step = 1; step <= 10; step++)
      await touch("touchMove", [
        { ...origin, x: origin.x + step * 6, y: origin.y + step * 4 },
      ]);
    await touch("touchEnd", []);
    await expect
      .poll(async () => {
        const moved = (await project(page)).cards.find(
          (item) => item.id === card.id,
        )!;
        return moved.x !== card.x || moved.y !== card.y;
      })
      .toBe(true);

    await page
      .getByRole("button", { name: "Toggle pan mode", exact: true })
      .click();
    const pane = (await page.locator(".react-flow__pane").boundingBox())!;
    const anchor = { x: pane.x + 120, y: pane.y + 100, id: 0 };
    const viewport = page.locator(".react-flow__viewport");
    const beforePan = await viewport.getAttribute("style");
    await touch("touchStart", [anchor]);
    for (let step = 1; step <= 8; step++)
      await touch("touchMove", [
        { ...anchor, x: anchor.x + step * 9, y: anchor.y + step * 5 },
      ]);
    await touch("touchEnd", []);
    await expect.poll(() => viewport.getAttribute("style")).not.toBe(beforePan);

    const beforePinch = await page.locator(".zoom-label").innerText();
    const center = { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2 };
    await touch("touchStart", [
      { x: center.x - 55, y: center.y, id: 0 },
      { x: center.x + 55, y: center.y, id: 1 },
    ]);
    for (let step = 1; step <= 10; step++)
      await touch("touchMove", [
        { x: center.x - 55 - step * 7, y: center.y, id: 0 },
        { x: center.x + 55 + step * 7, y: center.y, id: 1 },
      ]);
    await touch("touchEnd", []);
    await expect(page.locator(".zoom-label")).not.toHaveText(beforePinch);
  } finally {
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await cdp.detach();
  }

  await page.setViewportSize({ width: 960, height: 700 });
  await expect(
    page.getByRole("button", { name: "Add item", exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "Toggle pan mode", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await useReleaser(page);
  const generate = page.getByRole("button", {
    name: "Build evidence brief",
    exact: true,
  });
  await generate.scrollIntoViewIfNeeded();
  await expect(generate).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
