import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import AdmZip from "adm-zip";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
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
    page.getByRole("tab", { name: "Collector", exact: true }),
  ).toBeVisible();
  return { app, page };
}
async function view(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Research views" })
    .getByRole("button", { name, exact: true })
    .click();
}
async function seed(page: Page, count = 2) {
  const result = await page.evaluate(async (count) => {
    const { project } = await window.acadia!.newProject(),
      stamp = new Date().toISOString();
    project.title = "Fictional v1 workflow fixture";
    project.question = "Which observation justifies the next research step?";
    project.cards = Array.from({ length: count }, (_, i) => ({
      id: `item-${i}`,
      kind: "note" as const,
      title: `Atlas item ${String(i + 1).padStart(3, "0")}`,
      content:
        i === 0
          ? Array.from(
              { length: 43 },
              (_, p) =>
                `Zephyr observation ${p + 1}: a fictional control condition is still required.`,
            ).join("\n\n")
          : `Atlas synthetic observation ${i + 1}`,
      x: (i % 10) * 330,
      y: Math.floor(i / 10) * 250,
      tags: [],
      status: "unreviewed" as const,
      createdAt: stamp,
      updatedAt: stamp,
    }));
    project.outputs = [
      {
        id: "manual-report",
        kind: "decision-brief",
        title: "Manual research report",
        markdown: "# Manual research report\n\nA finding requiring a source.",
        createdAt: stamp,
        provider: "manual",
        sourceIds: [],
        boardUpdatedAt: stamp,
        citations: [],
        revisions: [],
      },
    ];
    await window.acadia!.save(project);
    const state = await window.acadia!.researchState();
    return {
      projectId: project.id,
      source: state.sources.find((s) => s.cardId === "item-0")!,
    };
  }, count);
  await page.reload();
  await expect(
    page.locator('.react-flow__node[data-id="item-0"]'),
  ).toBeVisible();
  return result;
}

test("keyboard card movement is durable, undoable, and survives reload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-keyboard-v1-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    await seed(page);
    const node = page.locator('.react-flow__node[data-id="item-0"]');
    await node.locator("h3").click();
    await node.focus();
    await node.press("ArrowRight");
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.load()).project.cards.find(
              (c) => c.id === "item-0",
            )!.x,
        ),
      )
      .toBe(10);
    await node.press("ControlOrMeta+z");
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.load()).project.cards.find(
              (c) => c.id === "item-0",
            )!.x,
        ),
      )
      .toBe(0);
    await page.locator(".board").focus();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Shift+z" : "Control+y",
    );
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.load()).project.cards.find(
              (c) => c.id === "item-0",
            )!.x,
        ),
      )
      .toBe(10);
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.load()).project.cards.find(
              (c) => c.id === "item-0",
            )!.x,
        ),
      )
      .toBe(10);
    expect(await node.getAttribute("style")).toContain("translate(10px");
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("search pages and manual citation insertion reach late historical passages without AI", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-citations-v1-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    const { source } = await seed(page, 43);
    await page.keyboard.press("ControlOrMeta+f");
    const search = page.getByRole("dialog", {
      name: "Search investigation",
      exact: true,
    });
    await search.getByLabel("Search all research").fill("Atlas");
    const board = search.getByRole("region", {
      name: "Board items search results",
    });
    await board.getByRole("button", { name: "Next", exact: true }).click();
    await expect(
      board.getByRole("button").filter({ hasText: "Atlas item 021" }),
    ).toBeVisible();
    await search
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await page.evaluate(async () => {
      const { project } = await window.acadia!.load();
      project.cards[0].content =
        "The current source now contains a different observation.";
      await window.acadia!.save(project);
    });
    await page.reload();
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page.locator(".report-tiptap").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page
      .getByRole("button", { name: "Cite source passage", exact: true })
      .click();
    const picker = page.getByRole("dialog", {
      name: "Cite a source passage",
      exact: true,
    });
    await picker.getByLabel("Source", { exact: true }).selectOption(source.id);
    await picker
      .getByLabel("Saved version", { exact: true })
      .selectOption(source.currentVersionId);
    await picker
      .getByLabel("Search passage text", { exact: true })
      .fill("Zephyr");
    await expect(
      picker.getByText("43 matching passages", { exact: true }),
    ).toBeVisible();
    await picker
      .getByRole("navigation", { name: "Citation passages pages" })
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await picker
      .getByRole("navigation", { name: "Citation passages pages" })
      .getByRole("button", { name: "Next", exact: true })
      .click();
    await picker
      .locator(".citation-passage-results button")
      .filter({ hasText: "Zephyr observation 43:" })
      .click();
    await picker
      .getByRole("button", {
        name: "Insert selected passage citation",
        exact: true,
      })
      .click();
    await expect(picker).not.toBeVisible();
    await expect(page.locator(".report-tiptap .report-citation")).toHaveText(
      "[1]",
    );
    await page.locator(".report-tiptap .report-citation").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".source-reader .citation-target")).toContainText(
      "Zephyr observation 43:",
    );
    const citation = await page.evaluate(
      async () =>
        (await window.acadia!.load()).project.outputs.find(
          (o) => o.id === "manual-report",
        )!.citations![0],
    );
    expect(citation.versionId).toBe(source.currentVersionId);
    expect(citation.quote).toContain("observation 43");
    await page.reload();
    await expect(page.locator(".report-tiptap .report-citation")).toHaveText(
      "[1]",
    );
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("private brief and task drafts survive restart and remain unapplied until saved", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-drafts-v1-"));
  let app: ElectronApplication | undefined;
  try {
    let session = await launch(directory);
    app = session.app;
    let page = session.page;
    await seed(page);
    await view(page, "Research brief");
    await page
      .getByLabel("Scope and boundaries", { exact: true })
      .fill("Private scope requiring review");
    await view(page, "Tasks");
    await page
      .getByRole("button", { name: "New research task", exact: true })
      .click();
    let dialog = page.getByRole("dialog", {
      name: "Research task",
      exact: true,
    });
    await dialog
      .getByLabel("Task", { exact: true })
      .fill("Recover this unfinished task");
    await dialog
      .getByLabel("Completion criteria", { exact: true })
      .fill("Record the matched observation.");
    await page.keyboard.press("Escape");
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { project } = await window.acadia!.load();
          return (await window.acadia!.researchDrafts(project.id)).length;
        }),
      )
      .toBeGreaterThanOrEqual(2);
    expect(
      (await page.evaluate(() => window.acadia!.researchState())).tasks,
    ).toHaveLength(0);
    await app.close();
    session = await launch(directory);
    app = session.app;
    page = session.page;
    await view(page, "Research brief");
    await expect(
      page.getByLabel("Scope and boundaries", { exact: true }),
    ).toHaveValue("Private scope requiring review");
    await view(page, "Tasks");
    await page
      .getByRole("button", { name: "New research task", exact: true })
      .click();
    dialog = page.getByRole("dialog", { name: "Research task", exact: true });
    await expect(dialog.getByLabel("Task", { exact: true })).toHaveValue(
      "Recover this unfinished task",
    );
    await dialog
      .getByRole("button", { name: "Save task", exact: true })
      .click();
    await expect(dialog).not.toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.researchState()).tasks.length,
        ),
      )
      .toBe(1);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("optional software and curriculum practice investigations preserve the previous project and require human review", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-practice-v1-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    const first = (await page.evaluate(() => window.acadia!.load())).project.id;
    for (const kind of ["software", "curriculum"] as const) {
      await page
        .getByRole("button", { name: "Workspace guide", exact: true })
        .click();
      const guide = page.getByRole("dialog", {
        name: "From fragments to understanding",
        exact: true,
      });
      await guide
        .getByRole("button", {
          name: `Create ${kind} practice investigation`,
          exact: true,
        })
        .click();
      await expect(guide).not.toBeVisible();
      const result = await page.evaluate(async () => ({
        workspace: await window.acadia!.load(),
        research: await window.acadia!.researchState(),
        pedigree: await window.acadia!.pedigreeState(),
      }));
      expect(result.workspace.project.id).not.toBe(first);
      expect(result.research.claims[0].status).toBe("unreviewed");
      expect(result.research.claims.every((claim) => !claim.itemReview)).toBe(
        true,
      );
      expect(result.pedigree.gaps[0].status).toBe("open");
      expect(result.pedigree.decisions[0].status).toBe("proposed");
      expect(
        result.workspace.project.outputs.some(
          (output) => output.deliveryPlan?.deliverableType === kind,
        ),
      ).toBe(true);
    }
    expect(
      (await page.evaluate(() => window.acadia!.listProjects())).some(
        (project) => project.id === first,
      ),
    ).toBe(true);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("source reader compares extracted text with the exact saved PDF page", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-pdf-comparison-v1-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    await app.evaluate(
      ({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      },
      join(root, "tests/fixtures/chromium-text.pdf"),
    );
    await page.evaluate(async () => {
      const { project } = await window.acadia!.newProject(),
        assets = await window.acadia!.importFiles(),
        stamp = new Date().toISOString();
      project.cards = [
        {
          ...assets[0],
          id: "pdf-item",
          title: "PDF verification fixture",
          x: 0,
          y: 0,
          tags: [],
          status: "unreviewed",
          createdAt: stamp,
          updatedAt: stamp,
        },
      ];
      await window.acadia!.save(project);
    });
    await page.reload();
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await window.acadia!.researchState()).versions.filter(
              (v) => v.status === "ready",
            ).length,
        ),
      )
      .toBeGreaterThan(0);
    await view(page, "Sources");
    await page
      .locator(".source-summary > button")
      .filter({ hasText: "PDF verification fixture" })
      .click();
    await page
      .getByRole("button", { name: "Compare original page 1", exact: true })
      .first()
      .click();
    const comparison = page.getByRole("dialog", {
      name: "Compare with original page",
      exact: true,
    });
    await expect(comparison.getByRole("img")).toBeVisible();
    await expect(comparison.getByRole("img")).toHaveAttribute(
      "src",
      /^data:image\/png;base64,/,
    );
    await expect(
      comparison.getByRole("region", {
        name: "Extracted passage for comparison",
      }),
    ).not.toBeEmpty();
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("immediate archive export includes private edits and same-ID import replaces the draft cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-draft-archive-v1-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    const { projectId } = await seed(page);
    const archive = join(directory, "private-draft.acadia");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, archive);
    await view(page, "Research brief");
    const scope = page.getByLabel("Scope and boundaries", { exact: true });
    await scope.fill("Draft retained in portable archive");
    await page
      .getByRole("button", { name: "Project menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Export portable project", exact: true })
      .click();
    await expect(
      page.getByText("Portable project exported with its attachments", {
        exact: true,
      }),
    ).toBeVisible();
    const content = JSON.parse(new AdmZip(archive).readAsText("research.json"));
    expect(
      content.drafts.find((d: { kind: string }) => d.kind === "brief").value
        .buffer.scope,
    ).toBe("Draft retained in portable archive");
    await scope.fill("Local wording after export");
    await expect
      .poll(() =>
        page.evaluate(
          async (projectId) =>
            (await window.acadia!.researchDrafts(projectId)).find(
              (d) => d.kind === "brief",
            )?.value,
          projectId,
        ),
      )
      .toMatchObject({ buffer: { scope: "Local wording after export" } });
    await page
      .getByRole("button", { name: "Project menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Import portable project", exact: true })
      .click();
    await expect(
      page.getByText("Project opened", { exact: true }),
    ).toBeVisible();
    await expect(scope).toHaveValue("Draft retained in portable archive");
    await scope.fill("Editing the restored draft");
    await expect
      .poll(() =>
        page.evaluate(
          async (projectId) =>
            (await window.acadia!.researchDrafts(projectId)).find(
              (d) => d.kind === "brief",
            )?.value,
          projectId,
        ),
      )
      .toMatchObject({ buffer: { scope: "Editing the restored draft" } });
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
