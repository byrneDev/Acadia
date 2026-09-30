import { _electron as electron, expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
const root = resolve(process.cwd()),
  executable = createRequire(join(root, "package.json"))("electron") as string;
test("same-ID import preserves an empty board's newer private research draft in a recovery archive", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "acadia-empty-board-recovery-"),
  );
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
  try {
    const page = await app.firstWindow();
    await expect(
      page.getByRole("tab", { name: "Collector", exact: true }),
    ).toBeVisible();
    const id = await page.evaluate(async () => {
      const { project } = await window.acadia!.newProject();
      project.title = "Fictional empty-board research";
      project.question = "";
      project.cards = [];
      project.outputs = [];
      await window.acadia!.save(project);
      await window.acadia!.saveResearchDraft({
        projectId: project.id,
        key: "brief-private",
        kind: "brief",
        value: { text: "Earlier unaccepted research" },
        expectedRevision: 0,
      });
      return project.id;
    });
    const archive = join(directory, "earlier.acadia");
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, archive);
    await page.evaluate(async () =>
      window.acadia!.exportProject((await window.acadia!.load()).project),
    );
    await page.evaluate(
      async (projectId) =>
        window.acadia!.saveResearchDraft({
          projectId,
          key: "brief-private",
          kind: "brief",
          value: {
            text: "Newer private research that must remain recoverable",
          },
          expectedRevision: 1,
        }),
      id,
    );
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path],
      });
    }, archive);
    const imported = await page.evaluate(async () => {
      const workspace = await window.acadia!.openProject();
      return {
        project: workspace!.project,
        drafts: await window.acadia!.researchDrafts(workspace!.project.id),
      };
    });
    expect(imported.project.id).toBe(id);
    expect(imported.project.cards).toHaveLength(0);
    expect(imported.project.outputs).toHaveLength(0);
    expect(imported.project.question).toBe("");
    expect(
      imported.drafts.find((d) => d.key === "brief-private")?.value,
    ).toEqual({ text: "Earlier unaccepted research" });
    const recovery = join(directory, "profile", "workspace", "recovery"),
      names = await readdir(recovery);
    const saved = names
      .filter((name) => name.endsWith(".acadia"))
      .map((name) => new AdmZip(join(recovery, name)))
      .find(
        (zip) =>
          JSON.parse(zip.readAsText("project.json")).id === id &&
          zip
            .readAsText("research.json")
            .includes("Newer private research that must remain recoverable"),
      );
    expect(
      saved,
      "same-ID import must preserve SQLite-only work even with an empty canvas",
    ).toBeTruthy();
    await page.reload();
    await expect(
      page.getByRole("tab", { name: "Collector", exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
