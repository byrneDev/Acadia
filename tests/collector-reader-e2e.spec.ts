import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const executable = createRequire(join(root, "package.json"))(
  "electron",
) as string;
async function launch(directory: string) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) =>
        value !== undefined &&
        !["ELECTRON_RUN_AS_NODE", "ELECTRON_RENDERER_URL"].includes(key),
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    executablePath: process.env.ACADIA_TEST_EXECUTABLE || executable,
    args: process.env.ACADIA_TEST_EXECUTABLE
      ? []
      : [join(root, "out/main/index.js")],
    cwd: root,
    env: { ...env, ACADIA_USER_DATA: join(directory, "profile") },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  return { app, page };
}
async function seed(page: Page, longSource = false) {
  await page.evaluate(async (long) => {
    const { project } = await window.acadia!.newProject();
    const stamp = new Date().toISOString();
    project.title = "Desktop research fixture";
    project.question = "Which observations need follow-up?";
    project.cards = [
      {
        id: "first",
        kind: "note",
        title: "Observation log",
        content: long
          ? Array.from({ length: 137 }, (_, i) =>
              i === 126
                ? "Zephyr counterevidence: the late field observation contradicts the laboratory result."
                : `Observation ${i + 1}: instrument inventory recorded and checked.`,
            ).join("\n\n")
          : "First observation",
        x: 20,
        y: 30,
        tags: [],
        status: "unreviewed",
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: "second",
        kind: "question",
        title: "Follow-up question",
        content: "Which finding can be reproduced?",
        x: 450,
        y: 280,
        tags: [],
        status: "unreviewed",
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    await window.acadia!.save(project);
  }, longSource);
  await page.reload();
  await expect(
    page.locator('.react-flow__node[data-id="first"]'),
  ).toBeVisible();
}
async function view(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Research views" })
    .getByRole("button", { name, exact: true })
    .click();
}

test("board context survives navigation and restart, and keyboard connects selected items", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-board-ui-"));
  let app: ElectronApplication | undefined;
  try {
    let session = await launch(directory);
    app = session.app;
    let page = session.page;
    await seed(page);
    const original = await page
      .locator(".react-flow__viewport")
      .getAttribute("style");
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    await expect
      .poll(() => page.locator(".react-flow__viewport").getAttribute("style"))
      .not.toBe(original);
    const viewport = await page
      .locator(".react-flow__viewport")
      .getAttribute("style");
    await view(page, "Sources");
    await view(page, "Board");
    await expect(page.locator(".react-flow__viewport")).toHaveAttribute(
      "style",
      viewport!,
    );
    await app.close();
    app = undefined;
    session = await launch(directory);
    app = session.app;
    page = session.page;
    await expect(page.locator(".react-flow__viewport")).toHaveAttribute(
      "style",
      viewport!,
    );
    await page.locator('.react-flow__node[data-id="first"] h3').click();
    await page.locator(".board").focus();
    await page.keyboard.press("c");
    await expect(
      page.getByRole("form", { name: "Connect board items" }),
    ).toBeVisible();
    await page.getByLabel("Connect to", { exact: true }).selectOption("second");
    await page
      .getByRole("button", { name: "Connect items", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("Relationship");
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.load()).project.connections.length,
        ),
      )
      .toBe(1);
    await view(page, "Sources");
    await page
      .locator(".source-summary > button")
      .filter({ hasText: "Observation log" })
      .click();
    await view(page, "Board");
    await page.locator('.react-flow__node[data-id="first"] h3').click();
    await page.getByRole("button", { name: "Close source reader" }).focus();
    await page.keyboard.press("Delete");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.load()).project.connections.length,
        ),
      )
      .toBe(1);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("docked reader jumps to late evidence with bounded passages and restores an unfinished evidence form", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-reader-ui-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    await seed(page, true);
    await view(page, "Sources");
    await page.getByLabel("Search full documents").fill("Zephyr");
    await page
      .getByRole("button", { name: "Search collection", exact: true })
      .click();
    const result = page
      .locator(".research-list > button")
      .filter({ hasText: "Zephyr counterevidence" });
    await result.focus();
    await page.keyboard.press("Enter");
    const reader = page.getByRole("complementary", {
      name: "Source reader",
      exact: true,
    });
    await expect(reader).toBeVisible();
    await expect(reader.locator(".citation-target")).toContainText(
      "Zephyr counterevidence",
    );
    await expect(reader.locator(".citation-target")).toBeFocused();
    await expect
      .poll(() => reader.locator(".source-passage").count())
      .toBeLessThanOrEqual(40);
    const previous = reader.getByRole("button", {
      name: "Previous passages",
      exact: true,
    });
    await previous.focus();
    await page.keyboard.press("Enter");
    await expect(previous).toBeFocused();
    const passageNumber = reader.getByLabel("Passage number");
    await passageNumber.fill("127");
    await page.keyboard.press("Enter");
    await expect(reader.locator(".citation-target")).toBeVisible();
    await expect(passageNumber).toBeFocused();
    const version = await reader.getByLabel("Source version").inputValue();
    await reader
      .locator(".citation-target")
      .getByRole("button", { name: "Use selection as evidence" })
      .click();
    await reader
      .getByLabel("Claim to examine")
      .fill("An unfinished counterclaim");
    await reader
      .getByLabel("Relationship", { exact: true })
      .selectOption("contradicts");
    await reader
      .getByLabel("Researcher assessment")
      .fill("The field test challenges the earlier laboratory result.");
    await reader.getByRole("button", { name: "Close source reader" }).focus();
    await page.keyboard.press("Enter");
    await expect(result).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(reader.getByLabel("Claim to examine")).toHaveValue(
      "An unfinished counterclaim",
    );
    await expect(reader.getByLabel("Source version")).toHaveValue(version);
    await reader
      .getByRole("button", { name: "Save evidence link", exact: true })
      .click();
    await expect(reader.getByRole("status")).toContainText(
      "Passage linked to evidence",
    );
    const saved = await page.evaluate(
      async () => (await window.acadia!.researchState()).claims[0],
    );
    expect(saved.links[0].relation).toBe("contradicts");
    const passage = await page.evaluate(
      (id) => window.acadia!.getPassage(id),
      saved.links[0].passageId,
    );
    expect(passage.versionId).toBe(version);
    expect(passage.text).toContain("Zephyr counterevidence");
    await reader.locator(".citation-target").focus();
    await page.keyboard.press("Escape");
    await expect(result).toBeFocused();
    await page
      .getByRole("button", { name: "All sources", exact: true })
      .click();
    const source = page
      .locator(".source-summary > button")
      .filter({ hasText: "Observation log" });
    await source.focus();
    await page.keyboard.press("Enter");
    await expect(
      reader.getByRole("heading", { name: "Observation log", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(source).toBeFocused();
    await page.getByLabel("Search full documents").fill("instrument inventory");
    await page
      .getByRole("button", { name: "Search collection", exact: true })
      .click();
    const passages = page.locator(".research-list > button");
    const firstCitation = passages.nth(0);
    const secondCitation = passages.nth(1);
    const secondPassage = await secondCitation.locator("p").innerText();
    await firstCitation.focus();
    await page.keyboard.press("Enter");
    await expect(reader.locator(".citation-target")).toBeFocused();
    await secondCitation.focus();
    await page.keyboard.press("Enter");
    await expect(reader.locator(".citation-target")).toContainText(
      secondPassage,
    );
    await expect(reader.locator(".citation-target")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(secondCitation).toBeFocused();
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("research question and source search drafts survive navigation without retaining search approval", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-research-drafts-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    await seed(page);
    await view(page, "Ask & analyze");
    await page
      .getByLabel("Research question", { exact: true })
      .fill("Unsent question about the field trial");
    await view(page, "Board");
    await view(page, "Ask & analyze");
    await expect(
      page.getByLabel("Research question", { exact: true }),
    ).toHaveValue("Unsent question about the field trial");
    await view(page, "Sources");
    await page
      .getByLabel("Search full documents")
      .fill("Pending evidence search");
    await page
      .getByLabel("Website URL")
      .fill("https://example.invalid/not-yet-captured");
    await view(page, "Board");
    await view(page, "Sources");
    await expect(page.getByLabel("Search full documents")).toHaveValue(
      "Pending evidence search",
    );
    await expect(page.getByLabel("Website URL")).toHaveValue(
      "https://example.invalid/not-yet-captured",
    );
    await view(page, "Discover");
    await page
      .getByRole("button", { name: "Prepare search plan", exact: true })
      .click();
    await page
      .getByLabel("Proposed queries (one per line)")
      .fill("Edited but unapproved query");
    await view(page, "Board");
    await view(page, "Discover");
    await expect(
      page.getByLabel("Saved query draft (one per line)"),
    ).toHaveValue("Edited but unapproved query");
    await expect(
      page.getByRole("button", {
        name: "Approve this search run",
        exact: true,
      }),
    ).toHaveCount(0);
    const jobs = await page.evaluate(
      async () => (await window.acadia!.researchState()).jobs,
    );
    expect(jobs.some((job) => job.kind === "discovery")).toBe(false);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
