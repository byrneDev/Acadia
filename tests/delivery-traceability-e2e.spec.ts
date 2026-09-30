import { _electron as electron, expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createGap, createFinding } from "../src/shared/pedigree";
import { draftDeliveryPlan, newWorkPackage } from "../src/shared/pmis";
import { longReportFixture } from "./fixtures/long-report";
import {
  exportReportDocx,
  exportReportMarkdown,
  outputHTML,
} from "../src/main/report-export";
import { PDFParse } from "pdf-parse";
import AdmZip from "adm-zip";
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
  await expect(
    page.getByRole("tab", { name: "Collector", exact: true }),
  ).toBeVisible();
  return { app, page };
}
test("delivery drafts survive restart, retain historical verification through archive, and never resolve gaps automatically", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-delivery-trace-"));
  let { app, page } = await launch(directory);
  try {
    const projectId = await page.evaluate(async () => {
      const api = window.acadia!,
        { project } = await api.newProject(),
        at = new Date().toISOString();
      project.title = "Fictional verification delivery";
      project.cards = [
        {
          id: "observation",
          kind: "note",
          title: "Fictional verification",
          content:
            "Observed verificationmarker at the end of the fictional assessment. No external evidence was collected.",
          x: 0,
          y: 0,
          tags: [],
          status: "unreviewed",
          createdAt: at,
          updatedAt: at,
        },
      ];
      await api.save(project);
      return project.id;
    });
    await expect
      .poll(() =>
        page.evaluate(async () =>
          (await window.acadia!.researchState()).versions.some(
            (v) => v.status === "ready",
          ),
        ),
      )
      .toBe(true);
    const gap = {
      ...createGap(projectId),
      id: "delivery-gap",
      title: "Verification performance",
      resolutionCriteria: "Independent observation confirms performance",
    };
    const finding = {
      ...createFinding(projectId, "delivery-claim"),
      id: "delivery-finding",
    };
    const report = {
      ...longReportFixture(),
      id: "delivery-report",
      kind: "project-plan" as const,
      title: "Verification delivery",
      markdown:
        "# Verification delivery\n\nManual work packages; field evaluation remains incomplete.",
      document: undefined,
      citations: [],
      sourceIds: [],
    };
    const plan = draftDeliveryPlan(report);
    plan.tasks = [
      {
        ...newWorkPackage(),
        id: "verification-work",
        title: "Verify performance",
      },
    ];
    const evidence = await page.evaluate(
      async ({ gap, finding, report, plan }) => {
        const api = window.acadia!,
          { project } = await api.load();
        await api.saveClaim({
          id: "delivery-claim",
          projectId: project.id,
          title: "Verification requires observation",
          question: project.question,
          status: "provisional",
          alternatives: "Equipment may be limiting",
          limitations: "No field evidence yet",
          links: [],
          updatedAt: new Date().toISOString(),
        });
        await api.saveFindingAssessment(finding);
        await api.saveGap(gap);
        const state = await api.researchState(),
          source = state.sources.find((s) => s.cardId === "observation")!;
        const detail = await api.getSource(source.id),
          passage = detail.passages[0];
        project.outputs = [{ ...report, deliveryPlan: plan }];
        await api.save(project);
        return {
          sourceId: source.id,
          versionId: passage.versionId,
          passageId: passage.id,
        };
      },
      { gap, finding, report, plan },
    );
    await page.reload();
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page
      .getByRole("button", { name: "Edit work packages", exact: true })
      .click();
    const modal = page.getByRole("dialog", { name: "Delivery work packages" });
    await modal
      .getByLabel("Task title", { exact: true })
      .fill("Private draft retained across restart");
    await modal
      .getByLabel("Plan gap references", { exact: true })
      .selectOption("delivery-gap@1");
    await modal
      .getByLabel("Work package 1 finding references", { exact: true })
      .selectOption("delivery-finding@1");
    await modal
      .getByLabel("Requirement for work package 1", { exact: true })
      .fill("Capture verification observations");
    await modal
      .getByLabel("Acceptance test for work package 1", { exact: true })
      .fill("A second researcher verifies the observed sequence");
    await modal
      .getByLabel("Work package 1 verification search", { exact: true })
      .fill("verificationmarker");
    await modal
      .getByRole("button", { name: "Find verification passages", exact: true })
      .click();
    await modal
      .getByRole("button", {
        name: "Link passage as verification",
        exact: true,
      })
      .first()
      .click();
    await modal
      .getByRole("button", { name: "Close — keep draft", exact: true })
      .click();
    expect(
      await page.evaluate(
        async () =>
          (await window.acadia!.load()).project.outputs[0].deliveryPlan
            ?.tasks[0].title,
      ),
    ).toBe("Verify performance");
    await app.close();
    ({ app, page } = await launch(directory));
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page
      .getByRole("button", { name: "Edit work packages", exact: true })
      .click();
    await expect(page.getByLabel("Task title", { exact: true })).toHaveValue(
      "Private draft retained across restart",
    );
    await expect(
      page.getByRole("dialog", { name: "Delivery work packages" }),
    ).toContainText("Recovered your private work-package draft");
    await page
      .getByLabel("Status for work package 1", { exact: true })
      .selectOption("complete");
    await page
      .getByRole("button", { name: "Save work packages", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Delivery work packages" }),
    ).not.toBeVisible();
    const snapshot = await page.evaluate(async () => ({
      project: (await window.acadia!.load()).project,
      pedigree: await window.acadia!.pedigreeState(),
    }));
    expect(snapshot.project.outputs[0].deliveryPlan?.tasks[0]).toMatchObject({
      status: "complete",
      requirement: "Capture verification observations",
      verificationEvidence: [evidence],
    });
    expect(snapshot.pedigree.gaps[0].status).toBe("open");
    await page.evaluate(async () => {
      const api = window.acadia!,
        state = await api.pedigreeState();
      await api.saveGap({ ...state.gaps[0], title: "Changed live gap title" });
    });
    const archive = join(directory, "trace.acadia");
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, archive);
    await page.evaluate(async () => {
      const api = window.acadia!;
      await api.exportProject((await api.load()).project);
    });
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    }, archive);
    await page.evaluate(async () => {
      const api = window.acadia!;
      await api.newProject();
      await api.openProject();
    });
    await page.reload();
    const restored = await page.evaluate(
      async () =>
        (await window.acadia!.load()).project.outputs[0].deliveryPlan!,
    );
    expect(restored.gapRefs).toEqual([{ id: "delivery-gap", revision: 1 }]);
    expect(restored.tasks[0].verificationEvidence).toEqual([evidence]);
    await page.getByRole("tab", { name: /Releaser/ }).click();
    await page
      .getByRole("button", { name: "Edit work packages", exact: true })
      .click();
    await expect(
      page.getByLabel("Plan gap references", { exact: true }),
    ).toHaveValues(["delivery-gap@1"]);
    await page.screenshot({
      path: testInfo.outputPath("delivery-traceability.png"),
      fullPage: true,
    });
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("long reports preserve final table rows, bibliography metadata and limitations in DOCX, Markdown and native PDF", async ({}, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "acadia-long-report-")),
    { app } = await launch(directory);
  try {
    const report = longReportFixture(),
      docx = await exportReportDocx(report),
      xml = new AdmZip(docx).readAsText("word/document.xml"),
      markdown = exportReportMarkdown(report);
    for (const text of [
      "ENDROW90",
      "FINAL-LIMITATION",
      "A. Researcher",
      "2024-06",
      "10.0000/fictional.acadia.validation",
      "Page 302, paragraph 8",
    ]) {
      expect(xml).toContain(text);
      expect(markdown).toContain(text);
    }
    expect(xml).toContain("w:tblHeader");
    const htmlPath = join(directory, "long-report.html");
    await writeFile(htmlPath, outputHTML(report));
    const pdf = await app.evaluate(async ({ BrowserWindow }, path) => {
      const win = new BrowserWindow({
        show: false,
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
        },
      });
      try {
        await win.loadFile(path);
        return Array.from(
          await win.webContents.printToPDF({
            printBackground: true,
            pageSize: "A4",
            preferCSSPageSize: true,
          }),
        );
      } finally {
        win.destroy();
      }
    }, htmlPath);
    const pdfPath = testInfo.outputPath("long-report.pdf");
    await writeFile(pdfPath, Buffer.from(pdf));
    await writeFile(testInfo.outputPath("long-report.docx"), docx);
    const parser = new PDFParse({ data: Buffer.from(pdf) });
    try {
      const text = await parser.getText();
      expect(text.total).toBeGreaterThan(4);
      for (const value of [
        "ENDROW90",
        "FINAL-LIMITATION",
        "A. Researcher",
        "2024-06",
        "10.0000/fictional.acadia.validation",
        "Page 302, paragraph 8",
      ])
        expect(text.text.replace(/\s+/g, " ")).toContain(value);
      const images = await parser.getScreenshot({
        partial: [1, Math.ceil(text.total / 2), text.total],
        scale: 1.2,
      });
      for (const image of images.pages)
        await writeFile(
          testInfo.outputPath(`long-report-page-${image.pageNumber}.png`),
          image.data,
        );
    } finally {
      await parser.destroy();
    }
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
