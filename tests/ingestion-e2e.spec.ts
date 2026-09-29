import {
  _electron as electron,
  test,
  expect,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { Document, Paragraph, Packer } from "docx";
import { createCanvas } from "@napi-rs/canvas";
import { createDemoProject } from "../src/shared/project";
import type { Project } from "../src/shared/types";
import type { Citation } from "../src/shared/research";

const root = resolve(process.cwd());
const executable =
  process.env.ACADIA_TEST_EXECUTABLE ||
  (createRequire(join(root, "package.json"))("electron") as string);
interface Session {
  app: ElectronApplication;
  page: Page;
  directory: string;
  close(): Promise<void>;
}
async function launch(legacy?: unknown): Promise<Session> {
  const directory = await mkdtemp(join(tmpdir(), "acadia-ingestion-native-"));
  const profile = join(directory, "profile");
  if (legacy !== undefined) {
    await mkdir(join(profile, "workspace"), { recursive: true });
    await writeFile(
      join(profile, "workspace", "workspace.json"),
      typeof legacy === "string" ? legacy : JSON.stringify(legacy),
    );
  }
  const env = Object.fromEntries(
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
    env: { ...env, ACADIA_USER_DATA: profile },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  return {
    app,
    page,
    directory,
    async close() {
      await app.close().catch(() => app.process().kill());
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function waitExtraction(page: Page, title: string, status: string) {
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(() => window.acadia!.researchState());
        const source = state.sources.find((s) => s.title === title);
        return state.versions.find((v) => v.id === source?.currentVersionId)
          ?.status;
      },
      { timeout: 45000 },
    )
    .toBe(status);
}

// These tests use the actual Electron bridge, local PDF rasterizer, and packaged OCR workers.
test("Native DOCX paragraphs and scanned PDF OCR retain exact anchors and English text", async () => {
  const session = await launch();
  const { app, page, directory } = session;
  try {
    const docx = join(directory, "Native paragraphs.docx");
    await writeFile(
      docx,
      await Packer.toBuffer(
        new Document({
          creator: "Acadia fixture author",
          title: "Native paragraph investigation",
          sections: [
            {
              children: [
                new Paragraph("Native paragraph investigation"),
                new Paragraph(
                  "Support: the fictional library survey favors later hours.",
                ),
                new Paragraph(
                  "Counterevidence: the pilot attendance remains low.",
                ),
                new Paragraph(
                  "MISSING EVIDENCE: no long-term attendance series exists.",
                ),
              ],
            },
          ],
        }),
      ),
    );
    const canvas = createCanvas(1200, 200);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 1200, 200);
    context.fillStyle = "black";
    context.font = "48px Arial";
    context.fillText("SCANNED EVIDENCE requires careful review.", 30, 115);
    const image = canvas.toBuffer("image/png").toString("base64");
    const pdf = await app.evaluate(async ({ BrowserWindow }, image) => {
      const printer = new BrowserWindow({
        show: false,
        webPreferences: { sandbox: true, javascript: false },
      });
      try {
        await printer.loadURL(
          "data:text/html;charset=utf-8," +
            encodeURIComponent(
              `<html><head><title>Scanned evidence fixture</title></head><body style="margin:0"><img style="width:100%" src="data:image/png;base64,${image}"></body></html>`,
            ),
        );
        return (await printer.webContents.printToPDF({})).toString("base64");
      } finally {
        printer.destroy();
      }
    }, image);
    const scanned = join(directory, "Scanned evidence.pdf");
    await writeFile(scanned, Buffer.from(pdf, "base64"));
    await app.evaluate(
      ({ dialog }, paths) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: paths,
        });
      },
      [docx, scanned],
    );
    await page
      .getByRole("button", { name: "Import files", exact: true })
      .click();
    await waitExtraction(page, "Native paragraphs", "ready");
    await waitExtraction(page, "Scanned evidence", "needs-ocr");
    const paragraphs = await page.evaluate(async () => {
      const state = await window.acadia!.researchState();
      return window.acadia!.getSource(
        state.sources.find((s) => s.title === "Native paragraphs")!.id,
      );
    });
    expect(paragraphs.passages.map((p) => p.locator)).toEqual([
      "Paragraph 1",
      "Paragraph 2",
      "Paragraph 3",
      "Paragraph 4",
    ]);
    expect(paragraphs.passages[2].text).toContain(
      "pilot attendance remains low",
    );
    expect(paragraphs.versions.at(-1)?.author).toBe("Acadia fixture author");
    const job = await page.evaluate(async () => {
      const state = await window.acadia!.researchState();
      return window.acadia!.reprocessSource(
        state.sources.find((s) => s.title === "Scanned evidence")!.id,
        true,
      );
    });
    await expect
      .poll(
        async () =>
          page.evaluate(
            async (id) =>
              (await window.acadia!.researchState()).jobs.find(
                (j) => j.id === id,
              )?.status,
            job.id,
          ),
        { timeout: 60000 },
      )
      .toBe("completed");
    const scan = await page.evaluate(async () => {
      const state = await window.acadia!.researchState();
      return window.acadia!.getSource(
        state.sources.find((s) => s.title === "Scanned evidence")!.id,
      );
    });
    expect(scan.passages[0].text).toMatch(
      /SCANNED EVIDENCE requires careful review/i,
    );
    expect(scan.passages[0].locator).toBe("Page 1 (OCR)");
    expect(scan.passages[0].method).toBe("ocr");
    expect(scan.versions.at(-1)?.status).toBe("ready");
  } finally {
    await session.close();
  }
});

test("Legacy migration backs up exact input and preserves positions and incomplete extraction warnings", async () => {
  const legacy = createDemoProject();
  legacy.schemaVersion = 1;
  legacy.cards[0].x = 731;
  legacy.cards[0].extraction =
    "[Text could not be extracted. Open the original document.]";
  const original = { project: legacy };
  const session = await launch(original);
  try {
    const loaded = await session.page.evaluate(() => window.acadia!.load());
    expect(loaded.project.schemaVersion).toBe(3);
    expect(loaded.project.cards[0].x).toBe(731);
    expect(loaded.project.connections).toEqual(legacy.connections);
    const source = await session.page.evaluate(async () => {
      const state = await window.acadia!.researchState();
      return window.acadia!.getSource(
        state.sources.find((s) => s.cardId === "demo-question")!.id,
      );
    });
    const failed = source.versions.find(
      (version) => version.method === "legacy" && version.status === "failed",
    );
    expect(failed).toBeTruthy();
    const failedDetails = await session.page.evaluate(
      async ({ sourceId, versionId }) =>
        window.acadia!.getSource(sourceId, versionId),
      { sourceId: source.source.id, versionId: failed!.id },
    );
    expect(failedDetails.passages).toHaveLength(0);
    expect(
      source.passages.every(
        (passage) => !passage.text.includes("Text could not be extracted"),
      ),
    ).toBe(true);
    const recovery = join(
      session.directory,
      "profile",
      "workspace",
      "recovery",
    );
    const backups = (await readdir(recovery)).filter((n) =>
      n.startsWith("migration-v1-"),
    );
    expect(backups).toHaveLength(1);
    expect(
      JSON.parse(
        await readFile(join(recovery, backups[0], "workspace.json"), "utf8"),
      ),
    ).toEqual(original);
  } finally {
    await session.close();
  }
});

test("An unreadable legacy workspace is preserved byte-for-byte before a replacement workspace opens", async () => {
  const corrupt = '{"project":{"schemaVersion":1,"cards":[BROKEN_JSON';
  const session = await launch(corrupt);
  try {
    const workspace = join(session.directory, "profile", "workspace");
    const recovery = (await readdir(workspace)).find((name) =>
      name.startsWith("workspace-recovery-"),
    );
    expect(recovery).toBeTruthy();
    expect(await readFile(join(workspace, recovery!), "utf8")).toBe(corrupt);
    const loaded = await session.page.evaluate(() => window.acadia!.load());
    expect(loaded.project.schemaVersion).toBe(3);
    expect(loaded.project.cards.length).toBeGreaterThan(0);
  } finally {
    await session.app.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
    await session.close();
  }
});

test("Portable v2 reports retain historical citation passages after source edits and reimport", async () => {
  const session = await launch();
  const { app, page, directory } = session;
  try {
    const snapshot = await page.evaluate(async () => {
      const api = window.acadia!;
      const project = (await api.load()).project;
      project.question = "What evidence supports source traceability?";
      const output = await api.generate(
        project,
        "decision-brief",
        "Examine the documented evidence and gaps.",
      );
      project.outputs = [output];
      await api.save(project);
      const cited = output.citations!.find((c) => !c.legacyCardId)!;
      const before = await api.getPassage(cited.passageId);
      const state = await api.researchState();
      const source = state.sources.find((s) => s.id === cited.sourceId)!;
      const loaded = (await api.load()).project;
      const card = loaded.cards.find((c) => c.id === source.cardId)!;
      card.content =
        "Changed note: the original evidence remains in its prior immutable version.";
      card.updatedAt = new Date().toISOString();
      loaded.updatedAt = card.updatedAt;
      await api.save(loaded);
      return { citation: cited, before, project: (await api.load()).project };
    });
    const archive = join(directory, "Historical citation.acadia");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, archive);
    await page.evaluate(
      async (project) => window.acadia!.exportProject(project as Project),
      snapshot.project,
    );
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, archive);
    const imported = await page.evaluate(() => window.acadia!.openProject());
    expect(imported!.project.outputs[0].citations).toContainEqual(
      snapshot.citation,
    );
    const passage = await page.evaluate(
      async (citation) =>
        window.acadia!.getPassage((citation as Citation).passageId),
      snapshot.citation,
    );
    expect(passage).toEqual(snapshot.before);
    const detail = await page.evaluate(
      async (citation) =>
        window.acadia!.getSource(
          (citation as Citation).sourceId,
          (citation as Citation).versionId,
        ),
      snapshot.citation,
    );
    expect(detail.passages.some((p) => p.id === snapshot.before.id)).toBe(true);
    expect(detail.source.currentVersionId).not.toBe(
      snapshot.citation.versionId,
    );
    expect((await readFile(archive)).length).toBeGreaterThan(1000);
  } finally {
    await session.close();
  }
});
