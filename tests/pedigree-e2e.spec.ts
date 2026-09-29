import {
  _electron as electron,
  expect,
  test,
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
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  return { app, page };
}
async function view(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Research views" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function seed(page: Page) {
  const fixture = await page.evaluate(async () => {
    const { project } = await window.acadia!.newProject();
    const timestamp = new Date().toISOString();
    project.title = "Cedar analytical pedigree fixture";
    project.question = "Should the Cedar filter advance to a field trial?";
    project.privacy = { mode: "local", provider: "offline" };
    project.cards = [
      {
        id: "study",
        kind: "note",
        title: "Cedar laboratory study",
        content:
          "Cedar reduced turbidity in a controlled laboratory test. The laboratory result does not establish field performance.",
        x: 20,
        y: 20,
        tags: [],
        status: "unreviewed",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: "reporting",
        kind: "note",
        title: "Cedar secondary reporting",
        content:
          "This account reports the same laboratory experiment. Long-term durability and field reliability remain unknown.",
        x: 440,
        y: 180,
        tags: [],
        status: "unreviewed",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    await window.acadia!.save(project);
    const research = await window.acadia!.researchState();
    const study = research.sources.find((source) => source.cardId === "study")!;
    const reporting = research.sources.find(
      (source) => source.cardId === "reporting",
    )!;
    const detail = await window.acadia!.getSource(study.id);
    await window.acadia!.saveClaim({
      id: "field-readiness",
      projectId: project.id,
      title: "Cedar is ready for field validation",
      question: project.question,
      status: "provisional",
      alternatives: "Laboratory conditions may explain the result.",
      limitations: "Field reliability remains unknown.",
      links: [
        {
          id: "lab-link",
          passageId: detail.passages[0].id,
          quote: detail.passages[0].text,
          relation: "context",
          rationale:
            "Laboratory context alone is not evidence of field readiness.",
        },
      ],
      updatedAt: timestamp,
    });
    return {
      projectId: project.id,
      sourceId: study.id,
      secondSourceId: reporting.id,
      versionId: study.currentVersionId,
      passageId: detail.passages[0].id,
    };
  });
  await page.reload();
  await expect(
    page.locator('.react-flow__node[data-id="study"]'),
  ).toBeVisible();
  return fixture;
}

test("research brief, source appraisal history and confirmed source origins remain explicit", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-pedigree-ui-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const { page } = session;
    const fixture = await seed(page);
    await view(page, "Research brief");
    const briefRevision = await page.evaluate(
      async () =>
        (await window.acadia!.pedigreeState()).briefs[0]?.revision || 0,
    );
    await page
      .getByLabel("Research question", { exact: true })
      .fill("Should the Cedar filter advance to a field trial?");
    await page
      .getByLabel("Decision to inform", { exact: true })
      .fill("Decide whether to fund a limited field trial.");
    await page
      .getByLabel("Scope and boundaries", { exact: true })
      .fill("Laboratory and field evidence; no deployment recommendation.");
    await page
      .getByLabel("Include evidence when", { exact: true })
      .fill("Methods and test environment are documented.");
    await page
      .getByRole("button", { name: "Save research brief", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.pedigreeState()).briefs[0]?.revision,
        ),
      )
      .toBe(briefRevision + 1);
    await page
      .getByLabel("Scope and boundaries", { exact: true })
      .fill("Updated scope retains contradictory observations.");
    await view(page, "Board");
    await view(page, "Research brief");
    await expect(
      page.getByLabel("Scope and boundaries", { exact: true }),
    ).toHaveValue("Updated scope retains contradictory observations.");
    await page
      .getByRole("button", { name: "Save research brief", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.pedigreeState()).briefs[0]?.revision,
        ),
      )
      .toBe(briefRevision + 2);
    expect(
      await page.evaluate(
        async () => (await window.acadia!.pedigreeState()).briefs[0]?.scope,
      ),
    ).toBe("Updated scope retains contradictory observations.");
    await page.getByText("Revision history", { exact: true }).click();
    await expect(
      page.getByText(
        "Laboratory and field evidence; no deployment recommendation.",
        { exact: true },
      ),
    ).toBeVisible();

    await view(page, "Sources");
    await expect(page.getByLabel("Evidence origin coverage")).toContainText(
      "2 unlinked sources · independence unknown",
    );
    await page
      .locator(".source-summary > button")
      .filter({ hasText: "Cedar laboratory study" })
      .click();
    const reader = page.getByRole("complementary", {
      name: "Source reader",
      exact: true,
    });
    await reader
      .locator("summary")
      .filter({ hasText: "Source appraisal" })
      .click();
    await reader
      .getByLabel("Primary or secondary evidence", { exact: true })
      .selectOption("primary");
    await reader
      .getByLabel("Methods and context", { exact: true })
      .fill("Controlled laboratory measurements; field transfer unknown.");
    await reader
      .getByLabel("Appraisal reasoning", { exact: true })
      .fill("Direct observations are relevant within the stated environment.");
    await reader.locator(".pedigree-passage-options input").first().check();
    await reader
      .getByRole("button", { name: "Save source appraisal", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.pedigreeState()).appraisals[0]?.revision,
        ),
      )
      .toBe(1);
    await reader
      .getByLabel("Limitations and unknowns", { exact: true })
      .fill("Sample size and durability are unassessed.");
    await reader
      .getByRole("button", { name: "Save source appraisal", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.pedigreeState()).appraisals[0]?.revision,
        ),
      )
      .toBe(2);
    const appraisal = await page.evaluate(
      async () => (await window.acadia!.pedigreeState()).appraisals[0],
    );
    expect(appraisal.versionId).toBe(fixture.versionId);
    expect(appraisal.passageIds).toEqual([fixture.passageId]);
    await reader
      .getByText("Evidence origins and dependencies", { exact: true })
      .click();
    await reader
      .getByLabel("Related source", { exact: true })
      .selectOption(fixture.secondSourceId);
    await reader
      .getByLabel("Shared origin relationship", { exact: true })
      .selectOption("same-study");
    await reader
      .getByLabel("Dependency reasoning", { exact: true })
      .fill("Both documents describe the same laboratory experiment.");
    await reader
      .getByRole("button", { name: "Save origin relationship", exact: true })
      .click();
    await expect(page.getByLabel("Evidence origin coverage")).toContainText(
      "1 origin relationships await review",
    );
    await expect(page.getByLabel("Evidence origin coverage")).toContainText(
      "2 unlinked sources",
    );
    await reader
      .getByRole("button", { name: "Confirm dependency", exact: true })
      .click();
    await expect(page.getByLabel("Evidence origin coverage")).toContainText(
      "1 confirmed shared-origin groups",
    );
    await expect(page.getByLabel("Evidence origin coverage")).toContainText(
      "0 unlinked sources",
    );
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("researcher finding review preserves provenance distinction and assumptions create linked validation tasks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-finding-ui-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const { page } = session;
    await seed(page);
    await view(page, "Evidence");
    await page
      .locator("summary")
      .filter({ hasText: "Assumption register" })
      .click();
    await page
      .getByLabel("Assumption statement", { exact: true })
      .fill("Laboratory behavior transfers to the field.");
    await page
      .getByLabel("Consequence if wrong", { exact: true })
      .fill("A field deployment may fail despite laboratory improvement.");
    await page
      .getByLabel("How to validate or challenge it", { exact: true })
      .fill("Compare turbidity and durability in a controlled field pilot.");
    await page
      .getByRole("button", { name: "Create validation task", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.researchState()).tasks.length,
        ),
      )
      .toBe(1);
    const linked = await page.evaluate(async () => ({
      pedigree: await window.acadia!.pedigreeState(),
      research: await window.acadia!.researchState(),
    }));
    expect(linked.research.tasks[0].assumptionId).toBe(
      linked.pedigree.assumptions[0].id,
    );
    await page
      .getByRole("button", { name: "Assess finding", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Finding assessment" });
    await dialog
      .getByLabel("Finding classification", { exact: true })
      .selectOption("inference");
    await dialog
      .getByLabel("Support review", { exact: true })
      .selectOption("partial");
    await dialog
      .getByLabel("How the evidence supports this finding", { exact: true })
      .fill(
        "The study supports testing a hypothesis, not operational deployment.",
      );
    await dialog
      .getByLabel("Researcher confidence", { exact: true })
      .selectOption("low");
    await dialog
      .getByLabel("Basis for confidence and uncertainty", { exact: true })
      .fill("One laboratory evidence origin; field outcomes are unavailable.");
    await dialog
      .getByLabel("What would change this assessment?", { exact: true })
      .fill("A field test with documented operating conditions.");
    await dialog
      .getByRole("checkbox", {
        name: "Laboratory behavior transfers to the field.",
      })
      .check();
    await dialog
      .getByRole("button", { name: "Save finding assessment", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.pedigreeState()).findings[0]?.supportReview,
        ),
      )
      .toBe("partial");
    const finding = await page.evaluate(
      async () => (await window.acadia!.pedigreeState()).findings[0],
    );
    expect(finding.assumptionIds).toEqual([linked.pedigree.assumptions[0].id]);
    expect(finding.confidence).toBe("low");
    await dialog.getByText("Challenge and review", { exact: true }).click();
    await expect(
      dialog.getByRole("button", {
        name: "Challenge analysis with AI",
        exact: true,
      }),
    ).toBeDisabled();
    await dialog
      .getByText("Add a manual review issue", { exact: true })
      .click();
    await dialog
      .getByLabel("Review issue", { exact: true })
      .fill("Field evidence is missing");
    await dialog
      .getByLabel("Issue details", { exact: true })
      .fill(
        "Do not convert the laboratory claim into a field-performance conclusion.",
      );
    await dialog
      .getByRole("button", { name: "Save review issue", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.pedigreeState()).issues.length,
        ),
      )
      .toBe(1);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("all five methods retain structured fields and exact evidence, with tasks and board links created only explicitly", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-methods-ui-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const { page } = session;
    const fixture = await seed(page);
    const entries = [
      {
        label: /^Competing hypotheses/,
        kind: "hypotheses",
        add: "Add hypothesis",
        field: "Hypothesis",
        text: "Observed improvement depends on laboratory conditions.",
        extra: "Expected observations if true",
        value: "Field performance changes with operating conditions.",
      },
      {
        label: /^SWOT/,
        kind: "swot",
        add: "Add assessment row",
        field: "SWOT observation",
        text: "Laboratory test equipment is available.",
        extra: "Implications",
        value: "A repeatable baseline can be established.",
      },
      {
        label: /^Root cause \/ Why chain/,
        kind: "root-cause",
        add: "Add assessment row",
        field: "Observation or proposed cause",
        text: "Filter fouling may reduce field performance.",
        extra: "Why this could explain its parent",
        value: "Suspended solids can change flow conditions; not yet tested.",
      },
      {
        label: /^Risk/,
        kind: "risk",
        add: "Add assessment row",
        field: "Risk event",
        text: "Unmeasured durability causes an early field failure.",
        extra: "Likelihood reasoning",
        value: "Durability data are missing, so likelihood remains unassessed.",
      },
      {
        label: /^Technology readiness/,
        kind: "trl",
        add: "Add technology element",
        field: "Technology element",
        text: "Cedar membrane assembly",
        extra: "Demonstrated capability and conditions",
        value: "Turbidity reduction shown in a laboratory only.",
      },
    ];
    for (const entry of entries) {
      await view(page, "Methods");
      await page
        .locator(".method-registry")
        .getByRole("button", { name: entry.label })
        .click();
      await page
        .getByLabel("Worksheet title", { exact: true })
        .fill(`Cedar ${entry.kind} review`);
      await page
        .getByLabel("Method objective", { exact: true })
        .fill("Evaluate what the laboratory evidence can establish.");
      await page.getByRole("button", { name: entry.add, exact: true }).click();
      const row = page.locator(".method-row[open]").last();
      await row.getByLabel(entry.field, { exact: true }).fill(entry.text);
      await row.getByLabel(entry.extra, { exact: true }).fill(entry.value);
      await row
        .getByLabel("Evidence for row 1: source", { exact: true })
        .selectOption(fixture.sourceId);
      await row.locator(".pedigree-passage-options input").first().check();
      if (entry.kind === "hypotheses") {
        await row
          .getByLabel("Evidence relationship to hypothesis", { exact: true })
          .selectOption("neutral");
        await row
          .getByLabel("Diagnostic value and reasoning", { exact: true })
          .fill(
            "The result does not yet distinguish laboratory and field explanations.",
          );
      }
      if (entry.kind === "trl") {
        await row
          .getByLabel("Researcher-assessed TRL", { exact: true })
          .selectOption("4");
        await row
          .getByLabel("Assessment environment", { exact: true })
          .fill("Controlled laboratory");
      }
      await row
        .getByLabel("Next test or evidence gap for row 1", { exact: true })
        .fill("Repeat the measurement under field conditions.");
      await page
        .getByRole("button", { name: "Save worksheet", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            async (kind) =>
              (await window.acadia!.pedigreeState()).methods.some(
                (m) => m.kind === kind && m.revision === 1,
              ),
            entry.kind,
          ),
        )
        .toBe(true);
      const saved = await page.evaluate(
        async (kind) =>
          (await window.acadia!.pedigreeState()).methods.find(
            (m) => m.kind === kind,
          )!,
        entry.kind,
      );
      expect(saved.rows[0].passageIds).toEqual([fixture.passageId]);
      expect(JSON.stringify(saved.rows[0])).toContain(entry.value);
      expect(
        (
          await page.evaluate(
            async () => (await window.acadia!.load()).project.cards,
          )
        ).some((card) => card.methodId === saved.id),
      ).toBe(false);
      await expect(
        page.getByRole("button", {
          name: "Propose worksheet improvements",
          exact: true,
        }),
      ).toBeHidden();
      if (entry.kind === "hypotheses") {
        await expect(page.locator(".method-matrix")).toContainText("neutral");
        await row
          .getByRole("button", {
            name: "Create linked research task",
            exact: true,
          })
          .click();
        await expect
          .poll(() =>
            page.evaluate(
              async (id) =>
                (await window.acadia!.researchState()).tasks.some(
                  (task) => task.methodId === id,
                ),
              saved.id,
            ),
          )
          .toBe(true);
      }
      await page
        .getByRole("button", { name: "Add to board", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(
            async (id) =>
              (await window.acadia!.load()).project.cards.some(
                (card) => card.methodId === id,
              ),
            saved.id,
          ),
        )
        .toBe(true);
    }
    await view(page, "Methods");
    await page
      .getByRole("navigation", { name: "Saved worksheets" })
      .getByRole("button", { name: /Cedar risk review/ })
      .click();
    await page.locator(".method-row summary").click();
    await expect(
      page.getByLabel("Likelihood reasoning", { exact: true }),
    ).toHaveValue(entries[3].value);
    await expect(
      page.getByLabel("Qualitative likelihood", { exact: true }),
    ).toHaveValue("unassessed");
    await page
      .getByText("AI assistance · proposed changes", { exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Propose worksheet improvements",
        exact: true,
      }),
    ).toBeDisabled();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.pedigreeState()).methods.length,
        ),
      )
      .toBe(5);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("Add item exposes all five methods and creates persistent editable worksheets linked to board cards", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-add-method-ui-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const { page } = session;
    await seed(page);
    const entries = [
      { label: "Competing hypotheses", kind: "hypotheses" },
      { label: "SWOT", kind: "swot" },
      { label: "Root cause / Why chain", kind: "root-cause" },
      { label: "Risk", kind: "risk" },
      { label: "Technology readiness", kind: "trl" },
    ];
    const openAdd = async () => {
      await page.getByRole("button", { name: "Add item", exact: true }).click();
      return page.getByRole("dialog", {
        name: "Add to the Collector",
        exact: true,
      });
    };
    const cancelled = await openAdd();
    for (const label of ["note", "question", "hypothesis", "link"])
      await expect(
        cancelled.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    for (const { label } of entries)
      await expect(
        cancelled.getByRole("button", { name: label, exact: true }),
      ).toBeVisible();
    await cancelled.getByRole("button", { name: "SWOT", exact: true }).click();
    await cancelled
      .getByLabel("Title", { exact: true })
      .fill("Cancelled draft");
    await cancelled
      .getByLabel("Worksheet objective", { exact: true })
      .fill("This must not create a saved worksheet or a card.");
    await page.keyboard.press("Escape");
    await expect(cancelled).toBeHidden();
    expect(
      await page.evaluate(async () => ({
        methods: (await window.acadia!.pedigreeState()).methods.length,
        cards: (await window.acadia!.load()).project.cards.length,
      })),
    ).toEqual({ methods: 0, cards: 2 });

    const expected: {
      methodId: string;
      cardId: string;
      title: string;
      objective: string;
    }[] = [];
    for (const [index, entry] of entries.entries()) {
      const dialog = await openAdd();
      await dialog
        .getByRole("button", { name: entry.label, exact: true })
        .click();
      const title = `Cedar ${entry.label} worksheet`;
      const objective = `Use ${entry.label} to examine the gap between laboratory and field evidence.`;
      await dialog.getByLabel("Title", { exact: true }).fill(title);
      await dialog
        .getByLabel("Worksheet objective", { exact: true })
        .fill(objective);
      await dialog
        .getByLabel("Tags", { exact: false })
        .fill("cedar, field-trial");
      await dialog
        .getByRole("button", { name: "Add worksheet to board", exact: true })
        .click();
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".inspector h2")).toHaveText(title);
      await expect
        .poll(() =>
          page.evaluate(async (kind) => {
            const method = (await window.acadia!.pedigreeState()).methods.find(
              (item) => item.kind === kind,
            );
            const cards = (await window.acadia!.load()).project.cards;
            return Boolean(
              method && cards.some((card) => card.methodId === method.id),
            );
          }, entry.kind),
        )
        .toBe(true);
      const { method, card, count } = await page.evaluate(async (kind) => {
        const methods = (await window.acadia!.pedigreeState()).methods;
        const method = methods.find((item) => item.kind === kind)!;
        const card = (await window.acadia!.load()).project.cards.find(
          (item) => item.methodId === method.id,
        )!;
        return { method, card, count: methods.length };
      }, entry.kind);
      expect(count).toBe(index + 1);
      expect(method).toMatchObject({
        title,
        objective,
        revision: 1,
        reviewStatus: "unassessed",
        rows: [],
      });
      expect(card).toMatchObject({
        title,
        content: objective,
        kind: "note",
        methodId: method.id,
      });
      expect(card.tags).toEqual(
        expect.arrayContaining(["method", entry.kind, "cedar", "field-trial"]),
      );

      await page
        .getByRole("button", { name: "Open worksheet", exact: true })
        .click();
      await expect(
        page.getByLabel("Worksheet title", { exact: true }),
      ).toHaveValue(title);
      await expect(
        page.getByLabel("Method objective", { exact: true }),
      ).toHaveValue(objective);
      const revisedObjective = `${objective} Record the decisive missing observation.`;
      await page
        .getByLabel("Method objective", { exact: true })
        .fill(revisedObjective);
      await page
        .getByRole("button", { name: "Save worksheet", exact: true })
        .click();
      await expect
        .poll(() =>
          page.evaluate(async (id) => {
            const saved = (await window.acadia!.pedigreeState()).methods.find(
              (item) => item.id === id,
            );
            return { revision: saved?.revision, objective: saved?.objective };
          }, method.id),
        )
        .toEqual({ revision: 2, objective: revisedObjective });
      expected.push({
        methodId: method.id,
        cardId: card.id,
        title,
        objective: revisedObjective,
      });
      await view(page, "Board");
    }

    await app.close();
    app = undefined;
    const reopened = await launch(directory);
    app = reopened.app;
    const persisted = await reopened.page.evaluate(async () => ({
      methods: (await window.acadia!.pedigreeState()).methods,
      cards: (await window.acadia!.load()).project.cards,
    }));
    expect(persisted.methods).toHaveLength(5);
    expect(persisted.cards).toHaveLength(7);
    for (const item of expected) {
      expect(
        persisted.methods.find((method) => method.id === item.methodId),
      ).toMatchObject({
        title: item.title,
        objective: item.objective,
        revision: 2,
        reviewStatus: "unassessed",
      });
      expect(
        persisted.cards.find((card) => card.id === item.cardId)?.methodId,
      ).toBe(item.methodId);
    }
    await view(reopened.page, "Methods");
    await reopened.page
      .getByRole("navigation", { name: "Saved worksheets" })
      .getByRole("button", { name: /Cedar SWOT worksheet/ })
      .click();
    await expect(
      reopened.page.getByLabel("Method objective", { exact: true }),
    ).toHaveValue(expected[1].objective);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
