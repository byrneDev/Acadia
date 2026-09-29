import { _electron as electron, expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import AdmZip from "adm-zip";
const root = resolve(process.cwd()),
  executable = createRequire(join(root, "package.json"))("electron") as string;
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "acadia-delivery-native-"));
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
  await expect(
    page.getByRole("heading", { name: "THE COLLECTOR", exact: true }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const api = window.acadia!,
      { project } = await api.newProject(),
      timestamp = new Date().toISOString();
    project.title = "Fictional curriculum delivery";
    project.question = "What would address the observed performance gap?";
    project.cards = [
      {
        id: "gap-observation",
        kind: "note",
        title: "Performance observation",
        content:
          "During a fictional practice exercise, six of ten learners omitted the verification step. Equipment availability was not measured; instruction may not be the only explanation.",
        x: 80,
        y: 80,
        tags: [],
        status: "unreviewed",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    await api.save(project);
    const report = await api.generate(project, "gap-analysis", "");
    project.outputs = [report];
    await api.save(project);
  });
  await page.reload();
  return { app, page, directory };
}

test("an analysis becomes an editable curriculum delivery plan and a local PMIS/Power BI handoff", async ({}, testInfo) => {
  const { app, page, directory } = await fixture();
  try {
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page
      .getByRole("button", { name: "Plan a deliverable", exact: true })
      .click();
    await page
      .getByLabel("Deliverable type", { exact: true })
      .selectOption("curriculum");
    await page
      .getByLabel("Gap to bridge", { exact: true })
      .fill("Learners omit the verification step under practice conditions.");
    await page
      .getByLabel("Proposed deliverable", { exact: true })
      .fill("A task-based instructor-led course with guided practice.");
    await page
      .getByLabel("Acceptance criteria", { exact: true })
      .fill(
        "Demonstrate the verification step using the observed performance criteria.",
      );
    await page
      .getByRole("button", { name: "Build evidence brief", exact: true })
      .click();
    await expect(page.locator(".report-tiptap")).toContainText(
      "Objective-to-assessment",
    );
    await page
      .getByRole("button", { name: "Prepare work packages", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Delivery work packages" }),
    ).toBeVisible();
    await expect(page.locator(".delivery-work-package")).toHaveCount(6);
    await page
      .getByLabel("Task title", { exact: true })
      .first()
      .fill("Validate the training need");
    await page
      .getByLabel("Plan review", { exact: true })
      .selectOption("reviewed");
    await page
      .getByRole("button", { name: "Save work packages", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Deliverable work packages" }),
    ).toContainText("6 work packages · reviewed");
    const path = join(directory, "pmis.zip");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, path);
    await page
      .getByRole("button", { name: "Export to PMIS", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Export PMIS package", exact: true })
      .click();
    await expect
      .poll(() =>
        readFile(path)
          .then((b) => b.length)
          .catch(() => 0),
      )
      .toBeGreaterThan(100);
    const zip = new AdmZip(await readFile(path));
    expect(zip.readAsText("monday.csv")).toContain(
      "Validate the training need",
    );
    expect(zip.readAsText("jira.csv")).toContain("Research gap:");
    expect(JSON.parse(zip.readAsText("planner.json")).tasks).toHaveLength(6);
    expect(zip.readAsText("research-report.md")).toContain(
      "Delivery work package register",
    );
    expect(zip.readAsText("Import-Planner.ps1")).toContain("Preview only");
    const dataPath = join(directory, "powerbi.zip");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, dataPath);
    await page
      .getByRole("button", { name: "Project menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Export data for Power BI", exact: true })
      .click();
    await expect
      .poll(() =>
        readFile(dataPath)
          .then((b) => b.length)
          .catch(() => 0),
      )
      .toBeGreaterThan(100);
    const data = new AdmZip(await readFile(dataPath));
    expect(
      data.getEntries().filter((e) => e.entryName.endsWith(".csv")).length,
    ).toBeGreaterThan(10);
    expect(data.getEntries().some((e) => e.entryName.endsWith(".m"))).toBe(
      true,
    );
    expect(
      data
        .getEntries()
        .some((e) =>
          e.getData().toString().includes("Validate the training need"),
        ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath("delivery-plan.png"),
      fullPage: true,
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("report release records limitations and pedigree while invalid references remain blocked", async () => {
  const { app, page, directory } = await fixture();
  try {
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page
      .getByRole("button", {
        name: "Preview analytical pedigree appendix",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Analytical pedigree appendix" }),
    ).toContainText("unassessed independence");
    await page
      .getByRole("button", { name: "Append to working draft", exact: true })
      .click();
    await expect(page.locator(".report-tiptap").first()).toContainText(
      "Research approach and analytical pedigree",
    );
    await page
      .getByRole("button", { name: "Save & release", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Review before release" }),
    ).toContainText("unassessed independence");
    await page
      .getByRole("button", { name: "Release with limitations", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(
          async () => (await window.acadia!.load()).project.releasedOutputId,
        ),
      )
      .toBeTruthy();
    const frozen = await page.evaluate(async () => {
      const { project } = await window.acadia!.load();
      const output = project.outputs[0];
      return output.revisions!.find((r) => r.id === output.releasedRevisionId)!;
    });
    expect(frozen.pedigreeSnapshotId).toBeTruthy();
    expect(frozen.review?.acknowledged).toBe(true);
    expect(frozen.review?.warnings.length).toBeGreaterThan(0);
    await page.evaluate(async () => {
      const api = window.acadia!,
        { project } = await api.load();
      project.outputs[0].document = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Untraceable finding [999]." }],
          },
        ],
      };
      project.outputs[0].markdown = "Untraceable finding [999].";
      await api.save(project);
    });
    await page.reload();
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page
      .getByRole("button", { name: "Save & release", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Review before release" }),
    ).toContainText("Reference [999]");
    await expect(
      page.getByRole("button", {
        name: "Release with limitations",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      await page.evaluate(async () => {
        const { project } = await window.acadia!.load();
        return project.outputs[0].revisions!.find(
          (r) => r.id === project.outputs[0].releasedRevisionId,
        );
      }),
    ).toEqual(frozen);
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
