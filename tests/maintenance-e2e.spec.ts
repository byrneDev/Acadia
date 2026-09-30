import { _electron as electron, test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import AdmZip from "adm-zip";
import { createServer } from "node:http";
const root = resolve(process.cwd());
const executable = createRequire(join(root, "package.json"))(
  "electron",
) as string;
async function launch(existingDirectory?: string) {
  const directory =
    existingDirectory ??
    (await mkdtemp(join(tmpdir(), "acadia-maintenance-native-")));
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
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  return { app, page, directory };
}
test("forced process termination preserves committed work and private drafts without resuming model requests", async () => {
  let requests = 0;
  const server = createServer(async (request) => {
    for await (const _ of request) {
    }
    requests++;
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Fixture server missing");
  const first = await launch();
  let restarted: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const projectId = await first.page.evaluate(async (port) => {
      const { project } = await window.acadia!.newProject();
      const stamp = new Date().toISOString();
      project.title = "Committed crash fixture";
      project.question = "What remains unknown?";
      project.cards = [
        {
          id: crypto.randomUUID(),
          kind: "note",
          title: "Fictional observation",
          content:
            "The fictional pilot has no comparison group. Long-term outcomes are unknown.",
          x: 0,
          y: 0,
          tags: [],
          status: "unreviewed",
          createdAt: stamp,
          updatedAt: stamp,
        },
      ];
      project.privacy = {
        mode: "local",
        provider: "ollama",
        endpoint: `http://127.0.0.1:${port}`,
        model: "fixture",
      };
      await window.acadia!.save(project);
      await window.acadia!.saveResearchDraft({
        projectId: project.id,
        key: "recovery-fixture",
        kind: "report",
        value: { text: "Private unsaved interpretation" },
        expectedRevision: 0,
      });
      await window.acadia!.ask("What remains unknown?");
      return project.id;
    }, address.port);
    await expect.poll(() => requests).toBe(1);
    const closed = first.app.waitForEvent("close");
    first.app.process().kill("SIGKILL");
    await closed;
    restarted = await launch(first.directory);
    const restored = await restarted.page.evaluate(
      async (id) => ({
        workspace: await window.acadia!.load(),
        drafts: await window.acadia!.researchDrafts(id),
        research: await window.acadia!.researchState(),
      }),
      projectId,
    );
    expect(restored.workspace.project.title).toBe("Committed crash fixture");
    expect(
      restored.drafts.find((d) => d.key === "recovery-fixture")?.value,
    ).toEqual({ text: "Private unsaved interpretation" });
    expect(
      restored.research.jobs.every(
        (j) => !["running", "queued"].includes(j.status),
      ),
    ).toBe(true);
    expect(restored.research.jobs.some((j) => j.status === "failed")).toBe(
      true,
    );
    expect(requests).toBe(1);
  } finally {
    if (restarted) await restarted.app.close();
    else await first.app.close().catch(() => undefined);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(first.directory, { recursive: true, force: true });
  }
});
test("maintenance backs up acknowledged edits and excludes credentials from diagnostics and portable archives", async () => {
  const { app, page, directory } = await launch();
  try {
    await page.evaluate(async () => {
      const { project } = await window.acadia!.load();
      project.title = "Private research title";
      await window.acadia!.save(project);
      await window.acadia!.saveSettings({
        provider: "compatible",
        endpoint: "https://example.invalid/v1",
        model: "synthetic",
        apiKey: "synthetic-private-key",
      });
    });
    await app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory],
      });
    }, directory);
    const backup = await page.evaluate(() => window.acadia!.createBackup());
    expect(backup?.files).toBeGreaterThanOrEqual(2);
    const manifest = await readFile(join(backup!.path, "backup.json"), "utf8");
    expect(manifest).not.toMatch(/settings\.json|synthetic-private-key/);
    const report = await page.evaluate(() => window.acadia!.diagnosticReport());
    expect(JSON.stringify(report)).not.toMatch(
      /Private research title|synthetic-private-key|example.invalid/,
    );
    expect(
      (await page.evaluate(() => window.acadia!.removeCredential("analysis")))
        .analysis,
    ).toBe("absent");
    const archive = join(directory, "v1-project.acadia");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, archive);
    await page.evaluate(async () =>
      window.acadia!.exportProject((await window.acadia!.load()).project),
    );
    const zip = new AdmZip(archive);
    expect(JSON.parse(zip.readAsText("project.json")).schemaVersion).toBe(5);
    expect(zip.getEntries().map((e) => e.entryName)).not.toContain(
      "settings.json",
    );
    expect(zip.readAsText("research.json")).not.toContain(
      "synthetic-private-key",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("audience windows cannot use new private maintenance or draft APIs", async () => {
  const { app, page, directory } = await launch();
  try {
    const audienceReady = app.waitForEvent("window");
    await page.evaluate(() => window.acadia!.openReleaser());
    const audience = await audienceReady;
    await audience.waitForLoadState("domcontentloaded");
    const results = await audience.evaluate(async () => {
      const denied: Record<string, boolean> = {};
      for (const [key, fn] of Object.entries({
        diagnostic: () => window.acadia!.diagnosticReport(),
        backups: () => window.acadia!.listBackups(),
        credentials: () => window.acadia!.credentialStatus(),
        updates: () => window.acadia!.checkForUpdates(),
        drafts: () => window.acadia!.researchDrafts("other"),
      })) {
        try {
          await fn();
          denied[key] = false;
        } catch {
          denied[key] = true;
        }
      }
      return denied;
    });
    expect(Object.values(results)).toEqual([true, true, true, true, true]);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("manual citations retain legacy card-level provenance until original reprocessing", async () => {
  const { app, page, directory } = await launch();
  try {
    const citation = await page.evaluate(async () => {
      const { project } = await window.acadia!.newProject(),
        stamp = new Date().toISOString();
      project.cards = [
        {
          id: "legacy-card",
          kind: "document",
          title: "Legacy document excerpt",
          content: "Researcher annotation",
          extraction: "A migrated excerpt with unknown original coverage.",
          x: 0,
          y: 0,
          tags: [],
          status: "unreviewed",
          createdAt: stamp,
          updatedAt: stamp,
        },
      ];
      await window.acadia!.save(project);
      const research = await window.acadia!.researchState();
      const source = research.sources.find(
        (source) => source.cardId === "legacy-card",
      )!;
      const passages = await window.acadia!.getSourcePassagesPage(
        source.id,
        source.currentVersionId,
      );
      return window.acadia!.createPassageCitation(passages.items[0].id);
    });
    // The test changes project through the bridge; adopt it in the renderer
    // before its normal close-time save acknowledgement runs.
    await page.reload();
    expect(citation.verified).toBe(false);
    expect(citation.legacyCardId).toBe("legacy-card");
    expect(citation.locator).toContain("coverage unverified");
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed restoration fences writes, exits the stopped editor, and preserves the previous library", async () => {
  const first = await launch();
  let restarted: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    const projectId = await first.page.evaluate(async () => {
      const { project } = await window.acadia!.load();
      project.title = "Committed before restore failure";
      await window.acadia!.save(project);
      return project.id;
    });
    await first.page.reload();
    await first.app.evaluate(({ dialog }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory],
      });
    }, first.directory);
    const backup = await first.page.evaluate(() =>
      window.acadia!.createBackup(),
    );
    await first.app.evaluate(async ({ dialog }, backup) => {
      const mutable = process.getBuiltinModule(
        "node:fs/promises",
      ) as typeof import("node:fs/promises");
      const original = mutable.copyFile;
      const state = globalThis as unknown as {
        failStaging?: () => void;
        recoveryStopped?: boolean;
      };
      mutable.copyFile = (async (...args: Parameters<typeof original>) => {
        if (String(args[1]).includes("-restore-")) {
          await new Promise<void>((_resolve, reject) => {
            state.failStaging = () =>
              reject(
                Object.assign(new Error("Fixture disk full during copy"), {
                  code: "ENOSPC",
                }),
              );
          });
        }
        return original(...args);
      }) as typeof original;
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [backup],
      });
      dialog.showMessageBox = async (_options) => {
        if (
          (_options as { title?: string }).title ===
          "Restoration stopped safely"
        )
          state.recoveryStopped = true;
        return {
          response:
            (_options as { title?: string }).title ===
            "Restore research library"
              ? 1
              : 0,
          checkboxChecked: false,
        };
      };
    }, backup!.path);
    await first.page.evaluate(() => {
      void window.acadia!.restoreBackup().catch(() => undefined);
    });
    await expect
      .poll(() =>
        first.app.evaluate(() =>
          Boolean(
            (globalThis as unknown as { failStaging?: unknown }).failStaging,
          ),
        ),
      )
      .toBe(true);
    const failures = await first.page.evaluate(async (projectId) => {
      const errors: string[] = [];
      for (const action of [
        () =>
          window.acadia!.saveResearchDraft({
            projectId,
            key: "during-restore",
            kind: "report",
            value: { text: "Must not write" },
            expectedRevision: 0,
          }),
        () => window.acadia!.newProject(),
      ]) {
        try {
          await action();
          errors.push("not rejected");
        } catch (error) {
          errors.push(String(error));
        }
      }
      return errors;
    }, projectId);
    expect(
      failures.every((error) => error.includes("recovery is in progress")),
    ).toBe(true);
    const closed = first.app.waitForEvent("close");
    await first.app.evaluate(() =>
      (globalThis as unknown as { failStaging: () => void }).failStaging(),
    );
    await closed;
    restarted = await launch(first.directory);
    const restored = await restarted.page.evaluate(
      async (id) => ({
        workspace: await window.acadia!.load(),
        drafts: await window.acadia!.researchDrafts(id),
      }),
      projectId,
    );
    expect(restored.workspace.project.title).toBe(
      "Committed before restore failure",
    );
    expect(
      restored.drafts.some((draft) => draft.key === "during-restore"),
    ).toBe(false);
  } finally {
    if (restarted) await restarted.app.close();
    else first.app.process().kill();
    await rm(first.directory, { recursive: true, force: true });
  }
});
