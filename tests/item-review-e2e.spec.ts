import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { createRequire } from "node:module";
import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(process.cwd());
const executable = createRequire(join(root, "package.json"))(
  "electron",
) as string;
const originalNote =
  "FICTIONAL Cedar reduced turbidity in a laboratory pilot. Field reliability has not been measured.";
const acceptedNotes =
  "## Reviewer assessment\n\nThe fictional pilot is preliminary laboratory context [1].\n\nReviewer decision: use this to design a controlled field test; it does not establish readiness.";

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

async function modelFixture() {
  let requests = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const input = JSON.parse(
      body.messages.find((message: { role: string }) => message.role === "user")
        .content,
    );
    requests++;
    const markdown = `## Summary\n\nThe fictional laboratory pilot is preliminary [${input.source_passages[0].label}].\n\n## Use in this investigation\n\nUse it to design a field trial.\n\n## Limits / cannot conclude\n\nField reliability has not been measured.\n\n## Suggested next steps\n\nPlan a controlled field test.`;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({ message: { content: JSON.stringify({ markdown }) } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing fixture port");
  return { server, port: address.port, requests: () => requests };
}

async function seed(page: Page, port: number) {
  const result = await page.evaluate(
    async ({ port, note }) => {
      const api = window.acadia!,
        { project } = await api.newProject();
      const stamp = new Date().toISOString();
      project.title = "Fictional Reviewer Notes fixture";
      project.question = "What is needed before Cedar's field trial?";
      project.privacy = {
        mode: "local",
        provider: "ollama",
        endpoint: `http://127.0.0.1:${port}`,
        model: "reviewer-notes-fixture",
      };
      project.cards = [
        {
          id: "review-item",
          title: "Fictional Cedar pilot",
          content: note,
          kind: "note",
          x: 40,
          y: 60,
          tags: [],
          status: "unreviewed",
          createdAt: stamp,
          updatedAt: stamp,
        },
      ];
      await api.saveSettings({
        provider: "ollama",
        endpoint: `http://127.0.0.1:${port}`,
        model: "reviewer-notes-fixture",
      });
      await api.save(project);
      const source = (await api.researchState()).sources.find(
        (entry) => entry.cardId === "review-item",
      )!;
      return {
        sourceId: source.id,
        versionId: source.currentVersionId,
        projectId: project.id,
      };
    },
    { port, note: originalNote },
  );
  await page.reload();
  await expect(
    page.locator('.react-flow__node[data-id="review-item"]'),
  ).toBeVisible();
  return result;
}

async function view(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Research views" })
    .getByRole("button", { name, exact: true })
    .click();
}

const summary = (page: Page) =>
  page.getByRole("dialog", {
    name: "AI summary & research advice",
    exact: true,
  });
const notesRegion = (parent: Page | ReturnType<Page["locator"]>) =>
  parent.getByRole("region", { name: "Reviewer Notes", exact: true });

async function stop(server?: Server) {
  server?.closeAllConnections();
  await new Promise<void>((resolve) =>
    server ? server.close(() => resolve()) : resolve(),
  );
}

test("human acceptance saves edited Reviewer Notes as provisional evidence without replacing collected content", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-item-review-"));
  let app: ElectronApplication | undefined;
  let server: Server | undefined;
  try {
    const model = await modelFixture();
    server = model.server;
    let session = await launch(directory);
    app = session.app;
    let page = session.page;
    const fixture = await seed(page, model.port);
    await page.locator('.react-flow__node[data-id="review-item"] h3').click();
    await page
      .getByRole("button", {
        name: "AI summary & research advice",
        exact: true,
      })
      .click();
    await summary(page)
      .getByRole("button", { name: "Summarize & advise", exact: true })
      .click();
    await expect(
      summary(page).getByRole("region", {
        name: "Item AI summary",
        exact: true,
      }),
    ).toContainText("preliminary");
    const before = await page.evaluate(() => window.acadia!.researchState());
    expect(before.claims).toHaveLength(0);
    const insight = before.runs.find((entry) => entry.itemInsight)?.itemInsight;
    expect(insight).toBeTruthy();
    let accept = summary(page).getByRole("button", {
      name: "Accept into Reviewer Notes",
      exact: true,
    });
    await expect(accept).toBeDisabled();
    await summary(page).getByLabel("Reviewer Notes").fill(acceptedNotes);
    await expect(accept).toBeDisabled();
    await summary(page)
      .getByRole("checkbox", {
        name: "I have reviewed these notes and their source references",
        exact: true,
      })
      .check();
    await expect(accept).toBeEnabled();
    await summary(page)
      .getByRole("button", { name: /^Open reference \[1\]/ })
      .click();
    await expect(summary(page)).toHaveCount(0);
    const draftReader = page.getByRole("complementary", {
      name: "Source reader",
      exact: true,
    });
    await expect(draftReader.locator(".citation-target")).toContainText(
      originalNote,
    );
    expect(
      (await page.evaluate(() => window.acadia!.researchState())).claims,
    ).toHaveLength(0);
    await draftReader
      .getByRole("button", { name: "Close source reader", exact: true })
      .click();
    // Unaccepted notes survive a full application restart; review confirmation does not.
    await app.close();
    session = await launch(directory);
    app = session.app;
    page = session.page;
    accept = summary(page).getByRole("button", {
      name: "Accept into Reviewer Notes",
      exact: true,
    });
    await page.locator('.react-flow__node[data-id="review-item"] h3').click();
    await page
      .getByRole("button", {
        name: "AI summary & research advice",
        exact: true,
      })
      .click();
    await expect(summary(page).getByLabel("Reviewer Notes")).toHaveValue(
      acceptedNotes,
    );
    await expect(accept).toBeDisabled();
    await summary(page)
      .getByRole("checkbox", {
        name: "I have reviewed these notes and their source references",
        exact: true,
      })
      .check();
    await expect(accept).toBeEnabled();
    await accept.click();
    await expect(summary(page)).toContainText(
      "Accepted into Reviewer Notes and saved as evidence.",
    );
    await expect(accept).toHaveCount(0);
    const accepted = await page.evaluate(async () => ({
      research: await window.acadia!.researchState(),
      project: (await window.acadia!.load()).project,
    }));
    expect(accepted.research.claims).toHaveLength(1);
    const claim = accepted.research.claims[0];
    expect(claim.status).toBe("provisional");
    expect(claim.cardId).toBe("review-item");
    expect(claim.itemReview).toMatchObject({
      runId: insight!.runId,
      insightId: insight!.id,
      notes: acceptedNotes,
      sourceId: fixture.sourceId,
      versionId: fixture.versionId,
    });
    expect(claim.links).toHaveLength(1);
    expect(claim.links[0].relation).toBe("context");
    expect(claim.itemReview!.citations[0].passageId).toBe(
      claim.links[0].passageId,
    );
    expect(accepted.project.cards[0].content).toBe(originalNote);
    expect(accepted.project.cards[0].status).toBe("unreviewed");
    expect(accepted.project.connections).toHaveLength(0);
    expect(accepted.research.tasks).toHaveLength(0);
    const duplicate = await page.evaluate(
      ({ runId, notes }) => window.acadia!.acceptItemInsight({ runId, notes }),
      { runId: insight!.runId, notes: acceptedNotes },
    );
    expect(duplicate.id).toBe(claim.id);
    const editedError = await page.evaluate(
      async ({ runId, notes }) => {
        try {
          await window.acadia!.acceptItemInsight({
            runId,
            notes: `${notes}\n\nChanged later.`,
          });
          return "unexpectedly accepted";
        } catch (error) {
          return String(error);
        }
      },
      { runId: insight!.runId, notes: acceptedNotes },
    );
    expect(editedError).not.toBe("unexpectedly accepted");
    expect(
      (await page.evaluate(() => window.acadia!.researchState())).claims,
    ).toHaveLength(1);
    await summary(page)
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    const inspectorNotes = notesRegion(page.locator(".inspector"));
    await expect(inspectorNotes).toBeVisible();
    await expect(inspectorNotes.locator("details")).toHaveAttribute("open", "");
    await expect(inspectorNotes).toContainText("Reviewer decision: use this");
    await page.screenshot({
      path: testInfo.outputPath("reviewer-notes-inspector.png"),
      fullPage: true,
    });
    await inspectorNotes
      .getByRole("button", { name: /^Open reference \[1\]/ })
      .click();
    const reader = page.getByRole("complementary", {
      name: "Source reader",
      exact: true,
    });
    await expect(reader.locator(".citation-target")).toContainText(
      originalNote,
    );
    await expect(reader.getByLabel("Source version")).toHaveValue(
      fixture.versionId,
    );
    const readerNotes = notesRegion(reader);
    await expect(readerNotes).toBeVisible();
    await expect(readerNotes.locator("details")).toHaveAttribute("open", "");
    await expect(readerNotes).toContainText("Reviewer decision: use this");
    await reader
      .getByRole("button", { name: "Close source reader", exact: true })
      .click();
    await view(page, "Evidence");
    await page.getByRole("button", { name: claim.title, exact: true }).click();
    const evidence = page.getByRole("dialog", {
      name: "Examine claim",
      exact: true,
    });
    await expect(
      evidence.getByRole("combobox", { name: /^Assessment/ }),
    ).toHaveValue("provisional");
    await expect(
      evidence.getByLabel("Evidence relationship", { exact: true }),
    ).toHaveValue("context");
    await expect(notesRegion(evidence).locator("details")).toHaveAttribute(
      "open",
      "",
    );
    await expect(notesRegion(evidence)).toContainText(
      "Reviewer decision: use this",
    );
    await page.screenshot({
      path: testInfo.outputPath("accepted-reviewer-notes.png"),
      fullPage: true,
    });
    await evidence
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await view(page, "Board");
    await app.close();
    app = undefined;
    session = await launch(directory);
    app = session.app;
    page = session.page;
    await page.locator('.react-flow__node[data-id="review-item"] h3').click();
    await expect(notesRegion(page.locator(".inspector"))).toBeVisible();
    await expect(
      notesRegion(page.locator(".inspector")).locator("details"),
    ).toHaveAttribute("open", "");
    await expect(notesRegion(page.locator(".inspector"))).toContainText(
      "Reviewer decision: use this",
    );
    const restored = await page.evaluate(() => window.acadia!.researchState());
    expect(restored.claims[0].itemReview).toEqual(claim.itemReview);
    expect(model.requests()).toBe(1);
    const assessment = await page.evaluate(async () => {
      const { project } = await window.acadia!.load();
      const claim = (await window.acadia!.researchState()).claims[0];
      project.cards = [];
      await window.acadia!.save(project);
      await window.acadia!.saveClaim({ ...claim, status: "disputed" });
      return (await window.acadia!.researchState()).claims[0];
    });
    expect(assessment.status).toBe("disputed");
    expect(assessment.itemReview).toEqual(claim.itemReview);
    await page.reload();
  } finally {
    await app?.close();
    await stop(server);
    await rm(directory, { recursive: true, force: true });
  }
});

test("review acceptance IPC rejects malformed and foreign runs and is private to the Collector", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-item-review-guards-"));
  let app: ElectronApplication | undefined;
  let server: Server | undefined;
  try {
    const model = await modelFixture();
    server = model.server;
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    await seed(page, model.port);
    const job = await page.evaluate(() =>
      window.acadia!.summarizeItem({ kind: "card", id: "review-item" }),
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (id) =>
            (await window.acadia!.researchState()).jobs.find(
              (entry) => entry.id === id,
            )?.status,
          job.id,
        ),
      )
      .toBe("completed");
    const runId = await page.evaluate(
      async () =>
        (await window.acadia!.researchState()).runs.find(
          (entry) => entry.itemInsight,
        )!.id,
    );
    const rejected = await page.evaluate(
      async ({ runId, notes }) => {
        const results: string[] = [];
        for (const request of [
          null,
          { runId: "../path", notes },
          { runId, notes: "" },
          { runId, notes: "x".repeat(30_001) },
        ]) {
          try {
            await window.acadia!.acceptItemInsight(request as never);
            results.push("unexpectedly accepted");
          } catch (error) {
            results.push(String(error));
          }
        }
        await window.acadia!.newProject();
        try {
          await window.acadia!.acceptItemInsight({ runId, notes });
          results.push("unexpectedly accepted");
        } catch (error) {
          results.push(String(error));
        }
        return results;
      },
      { runId, notes: acceptedNotes },
    );
    expect(rejected).toHaveLength(5);
    expect(rejected).not.toContain("unexpectedly accepted");
    await page.reload();
    const opened = app.waitForEvent("window");
    await page.evaluate(() => window.acadia!.openReleaser());
    const audience = await opened;
    await audience.waitForLoadState("domcontentloaded");
    const denied = await audience.evaluate(
      async ({ runId, notes }) => {
        try {
          await window.acadia!.acceptItemInsight({ runId, notes });
          return "unexpectedly accepted";
        } catch (error) {
          return String(error);
        }
      },
      { runId, notes: acceptedNotes },
    );
    expect(denied).toContain("Use the Collector");
    const current = await page.evaluate(() => window.acadia!.researchState());
    expect(current.claims).toHaveLength(0);
    expect(current.jobs).toHaveLength(0);
    expect(model.requests()).toBe(1);
  } finally {
    await app?.close();
    await stop(server);
    await rm(directory, { recursive: true, force: true });
  }
});
