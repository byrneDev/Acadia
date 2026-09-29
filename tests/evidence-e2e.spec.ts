import {
  _electron as electron,
  test as base,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { createBlankProject } from "../src/shared/project";
import type {
  Citation,
  Passage,
  SourceRecord,
  SourceVersion,
} from "../src/shared/research";
import type { Project } from "../src/shared/types";

const root = resolve(process.cwd());
const executable = createRequire(join(root, "package.json"))(
  "electron",
) as string;
const test = base.extend<{
  research: { app: ElectronApplication; page: Page; directory: string };
}>({
  research: async ({}, use, testInfo) => {
    const directory = await mkdtemp(join(tmpdir(), "acadia-evidence-native-"));
    const environment = Object.fromEntries(
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
      env: { ...environment, ACADIA_USER_DATA: join(directory, "profile") },
    });
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1600, height: 1000 });
    await expect(
      page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
    ).toBeVisible();
    try {
      await use({ app, page, directory });
      expect(errors).toEqual([]);
    } finally {
      if (testInfo.status !== testInfo.expectedStatus)
        await page
          .screenshot({ path: testInfo.outputPath("evidence-failure.png") })
          .catch(() => undefined);
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});
async function project(page: Page): Promise<Project> {
  return page.evaluate(async () => (await window.acadia!.load()).project);
}
async function seed(page: Page, count = 85) {
  await page.evaluate(async (n) => {
    const { project } = await window.acadia!.newProject();
    project.title = "Cedar investigation";
    project.question =
      "Does the Cedar filter reduce turbidity in field deployment?";
    const stamp = new Date().toISOString();
    project.cards = Array.from({ length: n }, (_, i) => ({
      id: crypto.randomUUID(),
      kind: "note",
      title: `Orchard record ${i + 1}`,
      content: `Tractor and orchard logistics record ${i + 1}.`,
      x: (i % 10) * 300,
      y: Math.floor(i / 10) * 230,
      tags: [],
      status: "unreviewed",
      createdAt: stamp,
      updatedAt: stamp,
    }));
    await window.acadia!.save(project);
  }, count);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
}
async function importFiles(
  app: ElectronApplication,
  page: Page,
  paths: string[],
) {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, paths);
  await page.getByRole("button", { name: "Import files", exact: true }).click();
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const s = await window.acadia!.researchState();
        return s.jobs.filter(
          (j) => j.kind === "extract" && j.status === "completed",
        ).length;
      }),
    )
    .toBe(paths.length);
}
async function view(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Research views" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function closeReader(page: Page) {
  await page.getByRole("button", { name: "Close source reader" }).click();
}

// This fixture has a known positive lab result, a contradictory field observation,
// and an unresolved durability gap. It checks useful research outcomes end to end.
test("Cedar investigation retrieves late evidence, links counterevidence, and turns its gap into follow-up research", async ({
  research,
}) => {
  const { app, page, directory } = research;
  await seed(page);
  const support =
    "Cedar filter reduced turbidity by 40 percent in controlled laboratory measurements.";
  const contrary =
    "Cedar filter showed no improvement in turbidity during field deployment.";
  const gap =
    "Cedar long-term membrane durability is unknown and has not been tested.";
  const paths = [
    "Lab study.txt",
    "Lab duplicate.txt",
    "Field study.txt",
    "Durability gap.txt",
  ].map((name) => join(directory, name));
  await Promise.all([
    writeFile(paths[0], support),
    writeFile(paths[1], support),
    writeFile(
      paths[2],
      [
        ...Array.from(
          { length: 316 },
          (_, i) =>
            `Log entry ${i + 1}: equipment inventoried at the observation station.`,
        ),
        contrary,
      ].join("\n\n"),
    ),
    writeFile(paths[3], gap),
  ]);
  await importFiles(app, page, paths);
  expect((await project(page)).cards).toHaveLength(89);
  await view(page, "Sources");
  await page.getByLabel("Search full documents").fill("turbidity");
  await page
    .getByRole("button", { name: "Search collection", exact: true })
    .click();
  const late = page
    .locator(".research-list > button")
    .filter({ hasText: "Paragraph 317" });
  await expect(late).toContainText(contrary);
  await late.click();
  await expect(page.locator(".source-passage.citation-target")).toContainText(
    "Paragraph 317",
  );
  await expect(page.locator(".coverage")).toContainText("317/317");
  await page
    .locator(".source-passage.citation-target")
    .getByRole("button", { name: "Use selection as evidence" })
    .click();
  await page
    .getByLabel("Claim to examine")
    .fill("Cedar improves field turbidity");
  await page
    .getByRole("combobox", { name: "Relationship", exact: true })
    .selectOption("contradicts");
  await page
    .getByLabel("Researcher assessment")
    .fill(
      "The field observation conflicts with the controlled laboratory result.",
    );
  await page
    .getByRole("button", { name: "Save evidence link", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Passage linked to evidence." }),
  ).toBeVisible();
  await closeReader(page);
  await view(page, "Evidence");
  await expect(page.locator(".evidence-quote.contradicts")).toContainText(
    contrary,
  );
  await page
    .getByRole("button", {
      name: "Cedar improves field turbidity",
      exact: true,
    })
    .click();
  await page
    .getByLabel("Alternative explanations")
    .fill("Laboratory conditions may differ from field conditions.");
  await page
    .getByLabel("Limitations and unresolved questions")
    .fill("Measure membrane durability under field conditions.");
  await page.getByRole("button", { name: "Save assessment" }).click();
  await page
    .getByRole("button", { name: "Investigate gap", exact: true })
    .click();
  await page
    .getByLabel("Task", { exact: true })
    .fill("Test long-term Cedar membrane durability");
  await page
    .getByLabel("Completion criteria")
    .fill(
      "Obtain a dated field durability measurement and link its original evidence.",
    );
  await page.getByRole("button", { name: "Save task", exact: true }).click();
  await view(page, "Tasks");
  await expect(page.locator(".task-columns")).toContainText(
    "Test long-term Cedar membrane durability",
  );
  await expect(page.locator(".task-columns")).toContainText(
    "Obtain a dated field durability measurement",
  );
  await view(page, "Ask & analyze");
  await page
    .getByRole("textbox", { name: "Research question", exact: true })
    .fill("Does the Cedar filter reduce turbidity in field deployment?");
  await page
    .getByRole("button", { name: "Ask with passage citations" })
    .click();
  await expect(page.locator(".answer-text")).toContainText(contrary);
  await expect(page.locator(".answer-text")).toContainText(gap);
  await expect(page.locator(".answer-text")).toContainText(
    "duplicate-file matches excluded",
  );
  await page
    .locator(".citation-buttons button")
    .filter({ hasText: "Field study" })
    .click();
  await expect(page.locator(".source-passage.citation-target")).toContainText(
    contrary,
  );
  await closeReader(page);
  const state = await page.evaluate(() => window.acadia!.researchState());
  const run = state.runs.find((r) => r.kind === "answer")!;
  expect(
    run.citations.filter(
      (c) => c.sourceTitle === "Lab study" || c.sourceTitle === "Lab duplicate",
    ),
  ).toHaveLength(1);
  expect(
    run.passages?.some((p) => p.paragraph === 317 && p.text === contrary),
  ).toBe(true);
  expect(state.claims[0].links[0].relation).toBe("contradicts");
  expect(state.tasks[0].claimId).toBe(state.claims[0].id);
  await view(page, "Discover");
  await page.getByRole("button", { name: "Prepare search plan" }).click();
  await expect(page.locator(".discovery-plan")).toContainText(
    "Brave Search API",
  );
  await expect(page.locator(".discovery-plan")).toContainText("5 queries");
  await expect(
    page.getByRole("button", { name: "Approve this search run" }),
  ).toBeDisabled();
});

test("editing a report keeps the selected released version private and citations anchored to historical source text", async ({
  research,
}) => {
  const { app, page, directory } = research;
  await seed(page, 1);
  const path = join(directory, "Cedar field evidence.txt");
  await writeFile(
    path,
    "Cedar field deployment showed no improvement in turbidity. Durability remains unknown.",
  );
  await importFiles(app, page, [path]);
  await page.getByRole("tab", { name: /Releaser/ }).click();
  await page
    .locator(".release-kind")
    .filter({ hasText: "Decision brief" })
    .click();
  await page
    .getByRole("button", { name: "Build evidence brief", exact: true })
    .click();
  const editor = page.getByLabel("Editable research report");
  await expect(editor).toContainText("no improvement");
  await page
    .getByRole("button", { name: "Save & release", exact: true })
    .click();
  await page.getByRole("button", { name: /Release with limitations|Release reviewed revision/, exact: true }).click();
  await expect
    .poll(async () => (await project(page)).outputs[0].releasedRevisionId)
    .toBeTruthy();
  const released = (await project(page)).outputs[0];
  const releasedId = released.releasedRevisionId;
  await page.getByRole("button", { name: /Open display/ }).click();
  const opened = app.waitForEvent("window");
  await page
    .getByRole("dialog")
    .locator(".display-list button")
    .first()
    .click();
  const audience = await opened;
  await audience.waitForLoadState("domcontentloaded");
  await expect(audience.getByLabel("Released report")).toContainText(
    "no improvement",
  );
  await editor.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+End" : "Control+End",
  );
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText(
    "PRIVATE FOLLOW-UP: await the durability trial.",
  );
  await expect(editor).toContainText("PRIVATE FOLLOW-UP");
  await expect
    .poll(async () => (await project(page)).outputs[0].markdown)
    .toContain("PRIVATE FOLLOW-UP");
  await expect(audience.getByLabel("Released report")).not.toContainText(
    "PRIVATE FOLLOW-UP",
  );
  expect((await project(page)).outputs[0].releasedRevisionId).toBe(releasedId);
  await page.getByLabel("Revision note").fill("Private follow-up draft");
  await page
    .getByRole("button", { name: "Save revision", exact: true })
    .click();
  await expect
    .poll(async () => (await project(page)).outputs[0].revisions?.length)
    .toBe(2);
  await expect(audience.getByLabel("Released report")).not.toContainText(
    "PRIVATE FOLLOW-UP",
  );
  const oldCitation = released.citations!.find(
    (c) => c.sourceTitle === "Cedar field evidence",
  )!;
  // Reprocessing creates another version without altering the report's original passage.
  await page.evaluate(async (id) => {
    await window.acadia!.reprocessSource(id);
  }, oldCitation.sourceId);
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const s = await window.acadia!.researchState();
        return s.jobs.filter(
          (j) => j.kind === "extract" && j.status === "completed",
        ).length;
      }),
    )
    .toBe(2);
  await expect(
    page
      .locator(".release-message.is-stale")
      .filter({ hasText: "cited source version" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reports and evidence", exact: true })
    .click();
  await page
    .locator(".release-source-item")
    .filter({ hasText: "Cedar field evidence" })
    .click();
  await expect(page.locator(".source-passage.citation-target")).toContainText(
    oldCitation.quote,
  );
  expect(await page.getByLabel("Source version").inputValue()).toBe(
    oldCitation.versionId,
  );
  await closeReader(page);
  await page
    .getByRole("button", { name: "Save & release", exact: true })
    .click();
  await page.getByRole("button", { name: /Release with limitations|Release reviewed revision/, exact: true }).click();
  await expect(audience.getByLabel("Released report")).toContainText(
    "PRIVATE FOLLOW-UP",
  );
});

test("Releaser read APIs expose only released historical passages and cannot read private originals or metadata", async ({
  research,
}) => {
  const { app, page, directory } = research;
  const stamp = new Date().toISOString();
  const draft = createBlankProject();
  // This fixture deliberately exercises a released v2 archive without pedigree records.
  draft.schemaVersion = 2;
  draft.title = "PRIVATE PROJECT TITLE";
  draft.question = "PRIVATE RESEARCH QUESTION";
  draft.privacy = {
    mode: "local",
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "PRIVATE MODEL",
  };
  draft.groups = [
    {
      id: "private-group",
      title: "PRIVATE BOARD GROUP",
      color: "#123456",
      cardIds: [],
    },
  ];
  draft.views = [
    { id: "private-view", title: "PRIVATE SAVED VIEW", x: 0, y: 0, zoom: 1 },
  ];
  const sourceId = randomUUID(),
    oldVersionId = randomUUID(),
    newVersionId = randomUUID();
  const privateSourceId = randomUUID(),
    privateVersionId = randomUUID(),
    assetId = randomUUID();
  const publishedText =
    "Published evidence: the Cedar pilot measured unchanged field turbidity.";
  const hiddenText =
    "PRIVATE UNCITED PASSAGE: the next experiment has an undisclosed budget.";
  const newText =
    "PRIVATE NEW VERSION: findings under review have not been released.";
  const oldSnapshot = `<article><p>${publishedText}</p><p>${hiddenText}</p></article>`;
  const newSnapshot = `<article><p>${newText}</p></article>`;
  const original = Buffer.from(
    "PRIVATE ORIGINAL ATTACHMENT: internal research instructions.",
  );
  const hash = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const sources: SourceRecord[] = [
    {
      id: sourceId,
      projectId: draft.id,
      title: "PRIVATE CURRENT SOURCE TITLE",
      kind: "web",
      url: "https://example.com/private-current-url",
      currentVersionId: newVersionId,
      inclusion: "exclude",
      duplicateOf: privateSourceId,
      createdAt: stamp,
      updatedAt: stamp,
    },
    {
      id: privateSourceId,
      projectId: draft.id,
      title: "PRIVATE UNRELEASED SOURCE",
      kind: "document",
      assetId,
      currentVersionId: privateVersionId,
      inclusion: "include",
      createdAt: stamp,
      updatedAt: stamp,
    },
  ];
  const versions: SourceVersion[] = [
    {
      id: oldVersionId,
      sourceId,
      hash: hash(oldSnapshot),
      acquiredAt: stamp,
      title: "Published source",
      url: "https://example.com/published",
      status: "ready",
      method: "native",
      totalUnits: 2,
      processedUnits: 2,
      snapshot: oldSnapshot,
      error: "PRIVATE EXTRACTION DIAGNOSTIC",
    },
    {
      id: newVersionId,
      sourceId,
      hash: hash(newSnapshot),
      acquiredAt: stamp,
      title: "PRIVATE NEW VERSION TITLE",
      status: "ready",
      method: "native",
      totalUnits: 1,
      processedUnits: 1,
      snapshot: newSnapshot,
    },
    {
      id: privateVersionId,
      sourceId: privateSourceId,
      hash: hash(original),
      acquiredAt: stamp,
      title: "PRIVATE DOCUMENT TITLE",
      status: "ready",
      method: "native",
      totalUnits: 1,
      processedUnits: 1,
      assetId,
    },
  ];
  const passages: Passage[] = [
    {
      id: randomUUID(),
      sourceId,
      versionId: oldVersionId,
      text: publishedText,
      locator: "Paragraph 1",
      paragraph: 1,
      method: "native",
      inclusion: "exclude",
    },
    {
      id: randomUUID(),
      sourceId,
      versionId: oldVersionId,
      text: hiddenText,
      locator: "Paragraph 2",
      paragraph: 2,
      method: "native",
      inclusion: "include",
    },
    {
      id: randomUUID(),
      sourceId,
      versionId: newVersionId,
      text: newText,
      locator: "Paragraph 1",
      paragraph: 1,
      method: "native",
      inclusion: "include",
    },
    {
      id: randomUUID(),
      sourceId: privateSourceId,
      versionId: privateVersionId,
      text: original.toString("utf8"),
      locator: "Paragraph 1",
      paragraph: 1,
      method: "native",
      inclusion: "include",
    },
  ];
  const citation: Citation = {
    id: randomUUID(),
    label: "1",
    sourceId,
    versionId: oldVersionId,
    passageId: passages[0].id,
    sourceTitle: "Published source",
    locator: "Paragraph 1",
    quote: publishedText,
    url: "https://example.com/published",
    acquiredAt: stamp,
    verified: true,
  };
  const document = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Published findings" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: publishedText + " " },
          { type: "citation", attrs: { citationId: citation.id, label: "1" } },
        ],
      },
    ],
  };
  const revision = {
    id: randomUUID(),
    createdAt: stamp,
    document,
    markdown: "# Published findings\n\n" + publishedText + " [1]",
    citations: [citation],
    note: "PRIVATE REVISION NOTE",
  };
  const outputId = randomUUID();
  draft.outputs = [
    {
      id: outputId,
      kind: "decision-brief",
      title: "PRIVATE DRAFT TITLE",
      markdown: "PRIVATE DRAFT BODY",
      document: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "PRIVATE DRAFT BODY" }],
          },
        ],
      },
      createdAt: stamp,
      provider: "PRIVATE PROVIDER MODEL",
      sourceIds: [sourceId, privateSourceId],
      boardUpdatedAt: stamp,
      citations: [citation],
      runId: "private-analysis-run",
      revisions: [revision],
      releasedRevisionId: revision.id,
    },
  ];
  draft.releasedOutputId = outputId;
  const zip = new AdmZip();
  zip.addFile("project.json", Buffer.from(JSON.stringify(draft)));
  zip.addFile(
    "research.json",
    Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        sources,
        versions,
        passages,
        claims: [],
        tasks: [],
        jobs: [],
        discoveries: [],
        runs: [],
      }),
    ),
  );
  zip.addFile(
    "assets.json",
    Buffer.from(
      JSON.stringify([
        {
          id: assetId,
          fileName: "private-original.txt",
          size: original.length,
        },
      ]),
    ),
  );
  zip.addFile(`assets/${assetId}`, original);
  const archive = join(directory, "Private source boundaries.acadia");
  await writeFile(archive, zip.toBuffer());
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, archive);
  await page.evaluate(async () => {
    await window.acadia!.openProject();
    await window.acadia!.saveSettings({
      provider: "compatible",
      endpoint: "https://private-model.example.invalid/v1",
      model: "PRIVATE SETTINGS MODEL",
    });
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  const opened = app.waitForEvent("window");
  await page.evaluate(() => window.acadia!.openReleaser());
  const audience = await opened;
  await audience.waitForLoadState("domcontentloaded");
  await expect(audience.getByLabel("Released report")).toContainText(
    publishedText,
  );
  const allowed = await audience.evaluate(
    async (id) => ({
      workspace: await window.acadia!.load(),
      research: await window.acadia!.researchState(),
      source: await window.acadia!.getSource(id),
    }),
    sourceId,
  );
  expect(JSON.stringify(allowed)).not.toContain("PRIVATE");
  expect(JSON.stringify(allowed)).not.toContain("private-");
  expect(allowed.workspace).not.toHaveProperty("projectPath");
  expect(allowed.workspace.project).not.toHaveProperty("privacy");
  expect(allowed.workspace.project).not.toHaveProperty("groups");
  expect(allowed.workspace.project).not.toHaveProperty("views");
  expect(allowed.workspace.project.question).toBe("");
  expect(allowed.workspace.project.outputs[0]).not.toHaveProperty("runId");
  expect(allowed.workspace.project.outputs[0].revisions?.[0].note).toBe("");
  expect(allowed.workspace.settings).toEqual({
    provider: "offline",
    endpoint: "",
    model: "",
  });
  expect(allowed.research.sources.map((source) => source.id)).toEqual([
    sourceId,
  ]);
  expect(allowed.research.versions.map((version) => version.id)).toEqual([
    oldVersionId,
  ]);
  expect(allowed.research.versions[0]).not.toHaveProperty("snapshot");
  expect(allowed.research.versions[0]).not.toHaveProperty("error");
  expect(allowed.source.source.currentVersionId).toBe(oldVersionId);
  expect(allowed.source.source.inclusion).toBe("include");
  expect(allowed.source.source.title).toBe("Published source");
  expect(allowed.source.source.url).toBe(citation.url);
  expect(allowed.source.source).not.toHaveProperty("duplicateOf");
  expect(allowed.source.passages.map((passage) => passage.id)).toEqual([
    passages[0].id,
  ]);
  const denied = await audience.evaluate(
    async ({
      sourceId,
      newVersionId,
      privateSourceId,
      hiddenPassageId,
      newPassageId,
    }) => {
      const result: string[] = [];
      for (const action of [
        () => window.acadia!.getSource(privateSourceId),
        () => window.acadia!.getSource(sourceId, newVersionId),
        () => window.acadia!.getPassage(hiddenPassageId),
        () => window.acadia!.getPassage(newPassageId),
      ]) {
        try {
          await action();
          result.push("allowed");
        } catch (error) {
          result.push(String(error));
        }
      }
      return result;
    },
    {
      sourceId,
      newVersionId,
      privateSourceId,
      hiddenPassageId: passages[1].id,
      newPassageId: passages[2].id,
    },
  );
  expect(denied).toHaveLength(4);
  for (const failure of denied)
    expect(failure).toContain("not included in the selected released revision");
  const anchored = await audience.evaluate(
    async (id) => window.acadia!.getPassage(id),
    passages[0].id,
  );
  expect(anchored.text).toBe(publishedText);
  await audience
    .getByRole("button", { name: /Published source.*Paragraph 1/ })
    .first()
    .click();
  await expect(
    audience.locator(".source-passage.citation-target"),
  ).toContainText(publishedText);
  await expect(audience.locator(".source-passage")).toHaveCount(1);
  await expect(
    audience.getByLabel("Source version").locator("option"),
  ).toHaveCount(1);
  await expect(
    audience.getByRole("button", { name: "Open original", exact: true }),
  ).toHaveCount(0);
  await closeReader(audience);
  const actualAssetId = await page.evaluate(
    async (id) => (await window.acadia!.getSource(id)).source.assetId!,
    privateSourceId,
  );
  // Session fetch bypasses renderer CSP so this verifies the protocol boundary itself.
  const assetSessions = await app.evaluate(
    async ({ BrowserWindow, session }, id) => {
      const url = `acadia-asset://asset/${id}`;
      const collectorResponse = await session.defaultSession.fetch(url);
      const audienceWindow = BrowserWindow.getAllWindows().find((window) =>
        window.webContents.getURL().endsWith("#releaser"),
      )!;
      const audienceResponse =
        await audienceWindow.webContents.session.fetch(url);
      return {
        collectorText: await collectorResponse.text(),
        audienceStatus: audienceResponse.status,
        audienceText: await audienceResponse.text(),
      };
    },
    actualAssetId,
  );
  expect(assetSessions.collectorText).toContain("PRIVATE ORIGINAL ATTACHMENT");
  expect(assetSessions.audienceStatus).toBe(403);
  expect(assetSessions.audienceText).not.toContain(
    "PRIVATE ORIGINAL ATTACHMENT",
  );
  const attachment = await audience.evaluate(async (id) => {
    let openError = "";
    try {
      await window.acadia!.openAsset(id);
    } catch (error) {
      openError = String(error);
    }
    try {
      const response = await fetch(window.acadia!.assetURL(id));
      return {
        openError,
        status: response.status,
        body: await response.text(),
      };
    } catch {
      return { openError, status: 0, body: "" };
    }
  }, actualAssetId);
  expect(attachment.openError).toContain("Use the Collector");
  expect([0, 403]).toContain(attachment.status);
  expect(attachment.body).not.toContain("PRIVATE ORIGINAL ATTACHMENT");
  await audience
    .getByRole("button", { name: /Published source.*Paragraph 1/ })
    .first()
    .click();
  await expect(
    audience.locator(".source-passage.citation-target"),
  ).toContainText(publishedText);
  // Revoking the release closes the read boundary immediately, even with known IDs.
  await page.evaluate(async () => {
    const project = (await window.acadia!.load()).project;
    delete project.releasedOutputId;
    await window.acadia!.save(project);
  });
  await expect(
    audience.getByRole("complementary", { name: "Source reader", exact: true }),
  ).toHaveCount(0);
  await expect(audience.locator(".source-passage")).toHaveCount(0);
  const cleared = await audience.evaluate(async (id) => {
    let error = "";
    try {
      await window.acadia!.getPassage(id);
    } catch (failure) {
      error = String(failure);
    }
    return {
      workspace: await window.acadia!.load(),
      state: await window.acadia!.researchState(),
      error,
    };
  }, passages[0].id);
  expect(cleared.workspace.project.outputs).toEqual([]);
  expect(cleared.state.sources).toEqual([]);
  expect(cleared.state.versions).toEqual([]);
  expect(cleared.error).toContain(
    "not included in the selected released revision",
  );
  // The fixture changed storage directly through IPC. Reload the Collector so its
  // close-time save does not try to resubmit the now-revoked legacy release.
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
});
