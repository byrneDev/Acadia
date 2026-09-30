import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { BoardReference } from "../src/shared/board";

const root = resolve(process.cwd()),
  executable = createRequire(join(root, "package.json"))("electron") as string;
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
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  return { app, page };
}
async function seed(page: Page, port: number) {
  return page.evaluate(async (port) => {
    const api = window.acadia!,
      { project } = await api.newProject(),
      stamp = new Date().toISOString();
    const meta = (id: string) => ({
      id,
      projectId: project.id,
      revision: 0,
      createdAt: stamp,
      updatedAt: stamp,
    });
    project.title = "Fictional Cedar evidence to delivery";
    project.question = "Should Cedar proceed beyond its laboratory trial?";
    project.privacy = {
      mode: "local",
      provider: "ollama",
      endpoint: `http://127.0.0.1:${port}`,
      model: "board-fixture",
    };
    project.cards = [
      {
        id: "lab",
        kind: "note",
        title: "Fictional laboratory source",
        content:
          "The fictional Cedar filter improved laboratory clarity. This does not establish field reliability.",
        x: 80,
        y: 80,
        tags: [],
        status: "unreviewed",
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: "field",
        kind: "note",
        title: "Fictional field counterevidence",
        content: Array.from({ length: 126 }, (_, i) =>
          i === 124
            ? "OLD LATE PASSAGE: high-load field conditions showed no Cedar improvement; a matched trial is missing."
            : `Fictional field observation ${i + 1}: calibration checks only.`,
        ).join("\n\n"),
        x: 380,
        y: 80,
        tags: [],
        status: "unreviewed",
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    await api.saveSettings({
      provider: "ollama",
      endpoint: `http://127.0.0.1:${port}`,
      model: "board-fixture",
    });
    await api.save(project);
    let research = await api.researchState();
    const lab = research.sources.find((source) => source.cardId === "lab")!,
      field = research.sources.find((source) => source.cardId === "field")!;
    const labPassage = (await api.getSource(lab.id)).passages[0],
      fieldDetail = await api.getSource(field.id),
      counter = fieldDetail.passages[124];
    await api.saveClaim({
      id: "cedar-claim",
      projectId: project.id,
      title: "Field readiness remains uncertain",
      question: project.question,
      status: "provisional",
      alternatives: "Operating conditions may explain the result.",
      limitations: "A controlled comparison is missing.",
      links: [
        {
          id: "support",
          passageId: labPassage.id,
          quote: labPassage.text,
          relation: "supports",
          rationale: "Lab result only.",
        },
        {
          id: "conflict",
          passageId: counter.id,
          quote: counter.text,
          relation: "contradicts",
          rationale: "Field conditions challenge generalization.",
        },
      ],
      updatedAt: stamp,
    });
    await api.saveAssumption({
      ...meta("cedar-assumption"),
      statement: "Field instruments are comparable",
      basis: "Not yet calibrated together.",
      consequence: "Apparent differences could reflect measurement.",
      validation: "Cross-calibrate instruments.",
      passageIds: [],
      claimIds: ["cedar-claim"],
      status: "unassessed",
    });
    await api.saveTask({
      id: "cedar-task",
      projectId: project.id,
      title: "Run the matched-load field trial",
      question: project.question,
      claimId: "cedar-claim",
      status: "planned",
      criterion: "Comparable loads and calibrated instruments.",
      sourceIds: [],
      updatedAt: stamp,
    });
    await api.saveGap({
      ...meta("cedar-gap"),
      title: "Missing matched comparison",
      missingInformation: "Performance under equal field conditions.",
      importance: "Needed before rollout.",
      resolutionCriteria: "A controlled trial at comparable loads.",
      claimIds: ["cedar-claim"],
      taskIds: ["cedar-task"],
      passageIds: [counter.id],
      status: "open",
    });
    await api.saveMethod({
      ...meta("cedar-method"),
      kind: "swot",
      title: "Cedar SWOT worksheet",
      objective: "Compare the field-trial options.",
      limitations: "Unreviewed worksheet.",
      nextSteps: "Link observations.",
      reviewStatus: "unassessed",
      rows: [],
    });
    const current = (await api.load()).project;
    current.outputs = [
      {
        id: "cedar-report",
        kind: "decision-brief",
        title: "Cedar evidence brief",
        markdown:
          "# Fictional decision brief\n\nA controlled field trial is needed before rollout.",
        sourceIds: [lab.id, field.id],
        provider: "Offline",
        createdAt: stamp,
        boardUpdatedAt: stamp,
      },
      {
        id: "cedar-plan",
        kind: "project-plan",
        title: "Cedar validation deliverable plan",
        markdown:
          "# Fictional deliverable project plan\n\nPrepare the trial protocol and acceptance criteria.",
        sourceIds: [lab.id, field.id],
        provider: "Offline",
        createdAt: stamp,
        boardUpdatedAt: stamp,
      },
    ];
    await api.save(current);
    await api.saveDecision({
      ...meta("cedar-decision"),
      title: "Fund a limited validation trial",
      action: "Prepare a trial protocol before deployment.",
      rationale:
        "Contradictory field evidence limits the laboratory inference.",
      alternatives: "Defer deployment.",
      claimIds: ["cedar-claim"],
      assumptionIds: ["cedar-assumption"],
      outputIds: ["cedar-plan"],
      status: "proposed",
    });
    const summary = await api.summarizeItem({ kind: "card", id: "lab" });
    for (let i = 0; i < 250; i++) {
      research = await api.researchState();
      const job = research.jobs.find((job) => job.id === summary.id);
      if (job?.status === "completed") break;
      if (job?.status === "failed") throw new Error(job.message);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const insight = research.runs.find((run) => run.itemInsight)!.itemInsight!;
    const review = await api.acceptItemInsight({
      runId: insight.runId,
      notes:
        "Use the laboratory observation as preliminary context [1]. Field validation remains necessary.",
    });
    const brief = (await api.pedigreeState()).briefs[0];
    const refs: BoardReference[] = [
      { kind: "brief", id: brief.id },
      { kind: "source", id: lab.id },
      { kind: "passage", id: counter.id, versionId: counter.versionId },
      { kind: "claim", id: "cedar-claim" },
      { kind: "review", id: review.id },
      { kind: "assumption", id: "cedar-assumption" },
      { kind: "method", id: "cedar-method" },
      { kind: "gap", id: "cedar-gap" },
      { kind: "task", id: "cedar-task" },
      { kind: "decision", id: "cedar-decision" },
      { kind: "report", id: "cedar-report" },
      { kind: "delivery-plan", id: "cedar-plan" },
    ];
    return {
      refs,
      fieldSourceId: field.id,
      oldVersionId: counter.versionId,
      oldPassageId: counter.id,
      sourceCount: research.sources.filter((source) => !source.derived).length,
    };
  }, port);
}
async function view(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Research views" })
    .getByRole("button", { name, exact: true })
    .click();
}
const picker = (page: Page) =>
  page.getByRole("dialog", { name: "Add to the Collector", exact: true });
async function openPicker(page: Page) {
  await view(page, "Board");
  await page.getByRole("button", { name: "Add item", exact: true }).click();
  return picker(page);
}
async function model() {
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(
      JSON.parse(Buffer.concat(chunks).toString()).messages[1].content,
    );
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        message: {
          content: JSON.stringify({
            markdown: `## Summary\n\nThe fictional laboratory observation is preliminary [${input.source_passages[0].label}].\n\n## Use in this investigation\n\nPlan field validation.\n\n## Limits / cannot conclude\n\nNo field reliability conclusion follows.\n\n## Suggested next steps\n\nCompare matched loads.`,
          }),
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No fixture port");
  return { server, port: address.port };
}

test("the grouped picker maps existing research without creating independent sources and routes each linked type", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-board-mapping-"));
  let app: ElectronApplication | undefined, server: Server | undefined;
  try {
    const engine = await model();
    server = engine.server;
    let session = await launch(directory);
    app = session.app;
    let page = session.page;
    const fixture = await seed(page, engine.port);
    await page.reload();
    const dialog = await openPicker(page);
    await page.screenshot({
      path: join(root, "test-results/board-item-picker.png"),
      fullPage: true,
    });
    for (const label of [
      "Research brief / question",
      "note",
      "question",
      "hypothesis",
      "Existing source",
      "link",
      "Document",
      "Image",
      "Audio",
      "Video",
      "Exact source passage",
      "Finding / claim",
      "Accepted Reviewer Notes",
      "Assumption",
      "Competing hypotheses",
      "SWOT",
      "Root cause / Why chain",
      "Risk",
      "Technology readiness",
      "Research gap",
      "Research task",
      "Decision",
      "Deliverable project plan",
      "Report",
    ])
      await expect(
        dialog.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    await dialog.getByLabel("Search item types").fill("readiness");
    await expect(
      dialog.getByRole("button", { name: "Technology readiness", exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "note", exact: true }),
    ).toHaveCount(0);
    await dialog.getByLabel("Search item types").fill("");
    await dialog
      .getByRole("button", { name: "Research gap", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Use existing", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: /Missing matched comparison/ })
      .click();
    await expect(dialog).toBeHidden();
    const initialGapCard = await page.evaluate(async () =>
      (await window.acadia!.load()).project.cards.find(
        (card) => card.boardReference?.kind === "gap",
      )!,
    );
    const again = await openPicker(page);
    await again
      .getByRole("button", { name: "Research gap", exact: true })
      .click();
    await again
      .getByRole("button", { name: "Use existing", exact: true })
      .click();
    await again
      .getByRole("button", { name: /Missing matched comparison/ })
      .click();
    expect(
      await page.evaluate(
        async () =>
          (await window.acadia!.load()).project.cards.filter(
            (card) => card.boardReference?.kind === "gap",
          ).length,
      ),
    ).toBe(1);
    await expect(page.locator(".inspector h2")).toHaveText(
      "Missing matched comparison",
    );
    await page.evaluate(async () => {
      const gap = (await window.acadia!.pedigreeState()).gaps[0];
      await window.acadia!.saveGap({
        ...gap,
        title: "Revised matched-comparison gap",
      });
    });
    await expect(page.locator(".inspector h2")).toHaveText(
      "Revised matched-comparison gap",
    );
    await page
      .getByRole("button", { name: "Remove from board", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Remove this research item?" })
      .getByRole("button", { name: "Remove item", exact: true })
      .click();
    expect(
      (await page.evaluate(() => window.acadia!.pedigreeState())).gaps[0].id,
    ).toBe("cedar-gap");
    await expect
      .poll(async () =>
        (await page.evaluate(() => window.acadia!.load())).project.cards.some(
          (card) => card.id === initialGapCard.id,
        ),
      )
      .toBe(false);
    const placements = await page.evaluate(async (refs) => {
      const result: Record<string, string> = {};
      for (const reference of refs)
        result[reference.kind] = (
          await window.acadia!.addBoardReference(reference)
        ).cardId;
      return result;
    }, fixture.refs);
    expect(placements.gap).not.toBe(initialGapCard.id);
    const mapping = await page.evaluate(async (placements) => {
      const api = window.acadia!;
      const recordState = async () => {
        const research = await api.researchState(),
          pedigree = await api.pedigreeState();
        return {
          claim: research.claims.find((entry) => entry.id === "cedar-claim"),
          task: research.tasks.find((entry) => entry.id === "cedar-task"),
          gap: pedigree.gaps.find((entry) => entry.id === "cedar-gap"),
          decision: pedigree.decisions.find(
            (entry) => entry.id === "cedar-decision",
          ),
        };
      };
      const before = await recordState(),
        { project } = await api.load();
      project.connections = [
        {
          id: "lab-support",
          source: placements.source,
          target: placements.claim,
          relation: "supports",
        },
        {
          id: "field-conflict",
          source: placements.passage,
          target: placements.claim,
          relation: "contradicts",
        },
        {
          id: "review-informs",
          source: placements.review,
          target: placements.claim,
          relation: "informs",
        },
        {
          id: "finding-identifies-gap",
          source: placements.claim,
          target: placements.gap,
          relation: "identifies gap",
        },
        {
          id: "task-addresses-gap",
          source: placements.task,
          target: placements.gap,
          relation: "addresses",
        },
        {
          id: "decision-depends-on-assumption",
          source: placements.decision,
          target: placements.assumption,
          relation: "depends on",
        },
        {
          id: "decision-produces-plan",
          source: placements.decision,
          target: placements["delivery-plan"],
          relation: "produces",
        },
      ];
      await api.save(project);
      return {
        before,
        after: await recordState(),
        connections: project.connections,
      };
    }, placements);
    expect(mapping.after).toEqual(mapping.before);
    await page.reload();
    expect(
      (
        await page.evaluate(() => window.acadia!.researchState())
      ).sources.filter((source) => !source.derived),
    ).toHaveLength(fixture.sourceCount);
    const expected: Record<string, () => Promise<void>> = {
      brief: () =>
        expect(
          page.getByLabel("Decision to inform", { exact: true }),
        ).toBeVisible(),
      source: () =>
        expect(
          page.getByRole("complementary", {
            name: "Source reader",
            exact: true,
          }),
        ).toBeVisible(),
      passage: () =>
        expect(page.locator(".citation-target")).toContainText(
          "OLD LATE PASSAGE",
        ),
      claim: () =>
        expect(
          page.getByRole("dialog", { name: "Examine claim", exact: true }),
        ).toBeVisible(),
      review: () =>
        expect(
          page
            .getByRole("dialog", { name: "Examine claim", exact: true })
            .getByRole("region", { name: "Reviewer Notes", exact: true }),
        ).toBeVisible(),
      assumption: () =>
        expect(
          page.getByLabel("Assumption statement", { exact: true }),
        ).toHaveValue("Field instruments are comparable"),
      method: () =>
        expect(page.getByLabel("Worksheet title", { exact: true })).toHaveValue(
          "Cedar SWOT worksheet",
        ),
      gap: () =>
        expect(page.getByLabel("Gap title", { exact: true })).toHaveValue(
          "Revised matched-comparison gap",
        ),
      task: () =>
        expect(
          page.getByRole("dialog").getByLabel("Task", { exact: true }),
        ).toHaveValue("Run the matched-load field trial"),
      decision: () =>
        expect(page.getByLabel("Decision title", { exact: true })).toHaveValue(
          "Fund a limited validation trial",
        ),
      report: () =>
        expect(page.locator(".report-tiptap")).toContainText(
          "controlled field trial",
        ),
      "delivery-plan": () =>
        expect(page.locator(".report-tiptap")).toContainText("trial protocol"),
    };
    for (const [kind, id] of Object.entries(placements)) {
      await page.getByRole("tab", { name: /Collector/ }).click();
      await view(page, "Board");
      if (
        await page
          .getByRole("button", { name: "Close source reader", exact: true })
          .count()
      )
        await page
          .getByRole("button", { name: "Close source reader", exact: true })
          .click();
      await page
        .getByRole("button", { name: "Fit research board", exact: true })
        .click();
      await page.locator(`.react-flow__node[data-id="${id}"] h3`).click();
      if (kind === "source")
        await page
          .getByRole("button", { name: "Open source", exact: true })
          .click();
      else
        await page
          .locator(".inspector")
          .getByRole("button", { name: /^Open / })
          .first()
          .click();
      await expected[kind]();
      if (await page.getByRole("dialog").count())
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Close dialog", exact: true })
          .click();
    }
    await page.getByRole("tab", { name: /Collector/ }).click();
    await view(page, "Board");
    await page
      .getByRole("button", { name: "Fit research board", exact: true })
      .click();
    await page.screenshot({
      path: testInfo.outputPath("linked-research-board.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: join(root, "test-results/board-mapping.png"),
      fullPage: true,
    });
    await app.close();
    app = undefined;
    session = await launch(directory);
    app = session.app;
    page = session.page;
    const restored = (await page.evaluate(() => window.acadia!.load())).project;
    expect(restored.connections).toEqual(mapping.connections);
    const restoredRecords = await page.evaluate(async () => {
      const research = await window.acadia!.researchState(),
        pedigree = await window.acadia!.pedigreeState();
      return {
        claim: research.claims.find((entry) => entry.id === "cedar-claim"),
        task: research.tasks.find((entry) => entry.id === "cedar-task"),
        gap: pedigree.gaps.find((entry) => entry.id === "cedar-gap"),
        decision: pedigree.decisions.find(
          (entry) => entry.id === "cedar-decision",
        ),
      };
    });
    expect(restoredRecords).toEqual(mapping.before);
    expect(
      restored.cards.find((card) => card.id === placements.passage)
        ?.boardReference,
    ).toMatchObject({
      kind: "passage",
      id: fixture.oldPassageId,
      versionId: fixture.oldVersionId,
    });
  } finally {
    await app?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("exact passage picker reaches historical late paragraphs and document choice opens the import route", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-board-passages-"));
  let app: ElectronApplication | undefined, server: Server | undefined;
  try {
    const engine = await model();
    server = engine.server;
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    const fixture = await seed(page, engine.port);
    await page.evaluate(async () => {
      const { project } = await window.acadia!.load();
      project.cards.find((card) => card.id === "field")!.content =
        "NEW VERSION: follow-up field analysis pending.";
      await window.acadia!.save(project);
    });
    await page.reload();
    const dialog = await openPicker(page);
    await dialog
      .getByRole("button", { name: "Exact source passage", exact: true })
      .click();
    await dialog
      .getByLabel("Source", { exact: true })
      .selectOption(fixture.fieldSourceId);
    await dialog
      .getByLabel("Source version")
      .selectOption(fixture.oldVersionId);
    await dialog.getByLabel("Find an exact passage").fill("OLD LATE PASSAGE");
    await dialog
      .getByRole("button", { name: "Search passages", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: /OLD LATE PASSAGE/ }),
    ).toBeVisible();
    await dialog.getByLabel("Find an exact passage").fill("");
    await dialog
      .getByRole("button", { name: "Next passages", exact: true })
      .click();
    await dialog
      .getByRole("button", { name: "Next passages", exact: true })
      .click();
    await dialog.getByRole("button", { name: /OLD LATE PASSAGE/ }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(".inspector")).toContainText("OLD LATE PASSAGE");
    const linked = (
      await page.evaluate(() => window.acadia!.load())
    ).project.cards.find((card) => card.boardReference?.kind === "passage")!;
    expect(linked.boardReference?.versionId).toBe(fixture.oldVersionId);
    const file = join(directory, "fictional-import.txt");
    await writeFile(
      file,
      "FICTIONAL imported protocol. Compare matched loads.",
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, file);
    const imports = await openPicker(page);
    await imports
      .getByRole("button", { name: "Document", exact: true })
      .click();
    await imports
      .getByRole("button", { name: "Import document", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() => window.acadia!.researchState())
          ).sources.filter((source) => !source.derived).length,
      )
      .toBe(fixture.sourceCount + 1);
  } finally {
    await app?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
    await rm(directory, { recursive: true, force: true });
  }
});
