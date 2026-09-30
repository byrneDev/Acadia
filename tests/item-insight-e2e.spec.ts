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
  const result = await page.evaluate(async (modelPort) => {
    const api = window.acadia!;
    const { project } = await api.newProject();
    const stamp = new Date().toISOString();
    project.title = "Fictional item advice fixture";
    project.question = "Should Cedar proceed to a field trial?";
    project.privacy = {
      mode: "local",
      provider: "ollama",
      endpoint: `http://127.0.0.1:${modelPort}`,
      model: "item-advice-fixture",
    };
    project.cards = [
      {
        id: "selected-item",
        kind: "note",
        title: "Cedar pilot observation",
        content:
          "Cedar reduced turbidity in a laboratory pilot. Field reliability has not been measured.",
        x: 40,
        y: 50,
        tags: ["pilot"],
        status: "unreviewed",
        createdAt: stamp,
        updatedAt: stamp,
      },
      {
        id: "unrelated-item",
        kind: "note",
        title: "Unrelated confidential fixture",
        content: "UNRELATED_NOTE_MUST_NOT_BE_SENT_TO_ITEM_MODEL",
        x: 500,
        y: 300,
        tags: [],
        status: "disputed",
        createdAt: stamp,
        updatedAt: stamp,
      },
    ];
    await api.saveSettings({
      provider: "ollama",
      endpoint: `http://127.0.0.1:${modelPort}`,
      model: "item-advice-fixture",
    });
    await api.save(project);
    const state = await api.researchState();
    const source = state.sources.find((s) => s.cardId === "selected-item")!;
    return { sourceId: source.id, versionId: source.currentVersionId };
  }, port);
  await page.reload();
  await expect(
    page.locator('.react-flow__node[data-id="selected-item"]'),
  ).toBeVisible();
  return result;
}

const summaryDialog = (page: Page) =>
  page.getByRole("dialog", {
    name: "AI summary & research advice",
    exact: true,
  });

test("item advice uses only the chosen item, opens exact evidence and survives restart without changing research", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-item-advice-"));
  let app: ElectronApplication | undefined;
  let server: Server | undefined;
  const requests: Record<string, unknown>[] = [];
  try {
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const input = JSON.parse(
        body.messages.find((m: { role: string }) => m.role === "user").content,
      );
      requests.push(input);
      const passage = input.source_passages[0];
      const markdown = [
        "## Summary",
        `The laboratory pilot records a turbidity improvement [${passage.label}].`,
        "## Use in this investigation",
        "Use the pilot as background for a field-trial hypothesis; it does not establish field readiness.",
        "## Limits / cannot conclude",
        "Field reliability has not been measured.",
        "## Suggested next steps",
        "Define field conditions and measure reliability before making a deployment decision.",
      ].join("\n\n");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({ message: { content: JSON.stringify({ markdown }) } }),
      );
    });
    await new Promise<void>((resolve) =>
      server!.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Missing fixture port");
    let session = await launch(directory);
    app = session.app;
    let page = session.page;
    const initial = await seed(page, address.port);
    await page.locator('.react-flow__node[data-id="selected-item"] h3').click();
    await page.getByRole("button", { name: "Edit item", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Edit research item", exact: true })
      .getByLabel("Notes & observations")
      .fill(
        "Cedar reduced turbidity in a laboratory pilot. Field reliability has not been measured. LATEST_SAVED_NOTE: test at low flow.",
      );
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "AI summary & research advice",
        exact: true,
      })
      .click();
    await expect(summaryDialog(page)).toBeVisible();
    expect(requests).toHaveLength(0);
    await page
      .getByRole("button", { name: "Summarize & advise", exact: true })
      .click();
    const result = page.getByRole("region", {
      name: "Item AI summary",
      exact: true,
    });
    await expect(result).toContainText("field-trial hypothesis");
    expect(requests).toHaveLength(1);
    const sent = JSON.stringify(requests[0]);
    expect(sent).toContain("Should Cedar proceed to a field trial?");
    expect(sent).toContain("LATEST_SAVED_NOTE");
    expect(sent).not.toContain("UNRELATED_NOTE_MUST_NOT_BE_SENT");
    const after = await page.evaluate(async () => {
      const workspace = await window.acadia!.load();
      const research = await window.acadia!.researchState();
      return { project: workspace.project, research };
    });
    expect(after.project.cards).toHaveLength(2);
    expect(after.project.cards[0].content).toContain("LATEST_SAVED_NOTE");
    expect(after.project.cards.map((card) => card.status)).toEqual([
      "unreviewed",
      "disputed",
    ]);
    expect(after.project.connections).toHaveLength(0);
    expect(after.project.outputs).toHaveLength(0);
    expect(after.research.claims).toHaveLength(0);
    expect(after.research.tasks).toHaveLength(0);
    const saved = after.research.runs.find(
      (run) => run.itemInsight,
    )?.itemInsight;
    expect(saved?.citations).toHaveLength(1);
    await page.screenshot({
      path: testInfo.outputPath("item-summary.png"),
      fullPage: true,
    });
    await summaryDialog(page)
      .getByRole("button", { name: /^Open reference \[1\]/ })
      .click();
    await expect(summaryDialog(page)).toHaveCount(0);
    const reader = page.getByRole("complementary", {
      name: "Source reader",
      exact: true,
    });
    await expect(reader.locator(".citation-target")).toContainText(
      "LATEST_SAVED_NOTE",
    );
    await expect(reader.getByLabel("Source version")).toHaveValue(
      saved!.versionId!,
    );
    await expect(
      reader.getByRole("button", {
        name: "AI summary & research advice",
        exact: true,
      }),
    ).toBeVisible();
    await reader.getByLabel("Source version").selectOption(initial.versionId);
    await expect(reader.locator(".source-passage").first()).not.toContainText(
      "LATEST_SAVED_NOTE",
    );
    await reader
      .getByRole("button", {
        name: "AI summary & research advice",
        exact: true,
      })
      .click();
    await expect(summaryDialog(page)).toBeVisible();
    expect(requests).toHaveLength(1);
    await summaryDialog(page)
      .getByRole("button", { name: "Summarize & advise", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Item AI summary", exact: true }),
    ).toContainText("field-trial hypothesis");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1])).toContain(initial.versionId);
    expect(JSON.stringify(requests[1])).not.toContain("LATEST_SAVED_NOTE");
    const historical = await page.evaluate(
      async () =>
        (await window.acadia!.researchState()).runs.find(
          (run) => run.itemInsight?.target.kind === "source",
        )?.itemInsight,
    );
    expect(historical?.versionId).toBe(initial.versionId);
    expect(historical?.citations[0].versionId).toBe(initial.versionId);
    await app.close();
    app = undefined;
    session = await launch(directory);
    app = session.app;
    page = session.page;
    await page
      .getByRole("button", {
        name: "AI summary for Cedar pilot observation",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("region", { name: "Item AI summary", exact: true }),
    ).toContainText("field-trial hypothesis");
    await expect(
      summaryDialog(page).getByRole("button", {
        name: "Regenerate summary",
        exact: true,
      }),
    ).toBeVisible();
    expect(requests).toHaveLength(2);
  } finally {
    await app?.close();
    server?.closeAllConnections();
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
    await rm(directory, { recursive: true, force: true });
  }
});

test("item summary IPC rejects invalid and other-project targets and the audience display", async () => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-item-advice-guards-"));
  let app: ElectronApplication | undefined;
  try {
    const session = await launch(directory);
    app = session.app;
    const page = session.page;
    const original = await seed(page, 1);
    const denied = await page.evaluate(async (previous) => {
      await window.acadia!.newProject();
      const results: string[] = [];
      for (const target of [
        { kind: "source", id: previous.sourceId },
        { kind: "card", id: "selected-item" },
        { kind: "other", id: "invalid" },
        { kind: "source", id: "../path" },
        { kind: "source", id: previous.sourceId, versionId: 12 },
      ]) {
        try {
          await window.acadia!.summarizeItem(target as never);
          results.push("unexpectedly accepted");
        } catch (error) {
          results.push(String(error));
        }
      }
      return results;
    }, original);
    expect(denied).toHaveLength(5);
    expect(denied).not.toContain("unexpectedly accepted");
    await page.reload();
    const opened = app.waitForEvent("window");
    await page.evaluate(() => window.acadia!.openReleaser());
    const audience = await opened;
    await audience.waitForLoadState("domcontentloaded");
    const audienceError = await audience.evaluate(async () => {
      try {
        await window.acadia!.summarizeItem({
          kind: "card",
          id: "selected-item",
        });
        return "unexpectedly accepted";
      } catch (error) {
        return String(error);
      }
    });
    expect(audienceError).toContain("Use the Collector");
    const research = await page.evaluate(() => window.acadia!.researchState());
    expect(research.jobs).toHaveLength(0);
  } finally {
    await app?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
