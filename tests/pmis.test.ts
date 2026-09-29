import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import {
  offlineProjectPlan,
  snapshotPlanContext,
  projectPlanInstructions,
} from "../src/shared/project-plan";
import {
  csvCell,
  draftDeliveryPlan,
  exportPmisFiles,
  newWorkPackage,
  validateDeliveryPlan,
} from "../src/shared/pmis";
import { validateProject, createBlankProject } from "../src/shared/project";
import { snapshotRevision, releasedReport } from "../src/shared/report";
import {
  exportReportDocx,
  exportReportMarkdown,
  outputHTML,
} from "../src/main/report-export";
import { PLANNER_IMPORTER } from "../src/main/planner-importer";
import type { ProjectPlanContext, ResearchOutput } from "../src/shared/types";

const context: ProjectPlanContext = {
  analysisOutputId: "analysis-1",
  gap: "Learners cannot consistently execute the task.",
  deliverableType: "curriculum",
  deliverable: "An instructor-led performance course",
  acceptanceCriteria: "Demonstrate the target task under stated conditions.",
};
const output = (): ResearchOutput => ({
  id: "plan-report",
  title: "Curriculum delivery",
  kind: "project-plan",
  plan: context,
  sourceIds: [],
  citations: [],
  provider: "Offline",
  createdAt: "2026-09-29T12:00:00Z",
  boardUpdatedAt: "2026-09-29T12:00:00Z",
  markdown: offlineProjectPlan(context),
});

describe("deliverable plans and PMIS handoff", () => {
  it("produces task-based curriculum and software plans with explicit validation and unknown resources", () => {
    const curriculum = offlineProjectPlan(context);
    expect(curriculum).toContain("Objective-to-assessment");
    expect(curriculum).toContain("does not establish qualification authority");
    expect(curriculum).toContain(
      "Owners, effort, budget and dates are unassessed",
    );
    const software = offlineProjectPlan({
      ...context,
      deliverableType: "software",
    });
    expect(software).toContain("architecture");
    expect(software).toContain("recovery test record");
    expect(projectPlanInstructions(context, output())).toContain(
      "including further research or no build",
    );
  });
  it("snapshots the selected analysis without subsequently inheriting draft changes", () => {
    const analysis = output();
    const plan = snapshotPlanContext(context, analysis);
    analysis.markdown = "Private changes";
    expect(plan.analysisMarkdown).not.toContain("Private changes");
    expect(plan.analysisTitle).toBe("Curriculum delivery");
  });
  it("extracts only a recognized work-breakdown table, retaining explicit prerequisites as notes", () => {
    const plan = draftDeliveryPlan(output());
    expect(plan.tasks).toHaveLength(6);
    expect(plan.tasks[0].title).toContain("Confirm performance need");
    expect(plan.tasks.every((t) => t.owner === "" && t.dueDate === "")).toBe(
      true,
    );
    expect(plan.tasks[0].dependencyNotes).toBe("Selected analysis");
    expect(plan.tasks[0].dependencyIds).toEqual([]);
    expect(
      draftDeliveryPlan({
        ...output(),
        markdown:
          "| Risk | Likelihood | Impact |\n| --- | --- | --- |\n| Late delivery | High | High |",
      }).tasks,
    ).toEqual([]);
  });
  it("rejects cycles, missing dependencies and invalid dates without inventing a schedule", () => {
    const plan = draftDeliveryPlan(output());
    plan.tasks[0].dependencyIds = [plan.tasks[1].id];
    plan.tasks[1].dependencyIds = [plan.tasks[0].id];
    expect(() => validateDeliveryPlan(plan)).toThrow(/cycle/);
    plan.tasks[1].dependencyIds = ["missing"];
    expect(() => validateDeliveryPlan(plan)).toThrow(/missing/);
    plan.tasks[1].dependencyIds = [];
    plan.tasks[0].dueDate = "2026-02-30";
    expect(() => validateDeliveryPlan(plan)).toThrow(/valid/);
  });
  it("exports compatible CSVs with safe multiline quoting and preserves full dependency/provenance data", () => {
    const plan = draftDeliveryPlan(output());
    plan.tasks[0].description = 'Review "evidence", then\nvalidate';
    plan.tasks[1].dependencyIds = [plan.tasks[0].id];
    plan.tasks[0].title = '=HYPERLINK("https://example.com")';
    const files = exportPmisFiles(plan);
    expect(files["monday.csv"]).toContain('"Name","Acadia ID","Phase"');
    expect(files["jira.csv"]).toContain('"Summary","Issue Type","Description"');
    expect(files["jira.csv"]).toContain("\"'=HYPERLINK");
    expect(files["work-packages.csv"]).toContain(
      'Review ""evidence"", then\nvalidate',
    );
    const planner = JSON.parse(files["planner.json"]);
    expect(planner.tasks[1].dependencyIds).toEqual([plan.tasks[0].id]);
    expect(planner.tasks[1].description).toContain("Research gap: Learners");
    expect(planner.tasks[1].description).toContain(
      "Acadia report: plan-report",
    );
    expect(planner.tasks[0]).not.toHaveProperty("assignments");
    expect(JSON.parse(files["delivery-plan.json"]).tasks[0].title).toMatch(
      /^=/,
    );
    expect(csvCell(" \t+SUM(A1) ")).toContain("' \t+SUM");
  });
  it("preserves frozen delivery work packages through project validation and released output selection", () => {
    const report = output();
    report.deliveryPlan = draftDeliveryPlan(report);
    const revision = snapshotRevision(report);
    report.revisions = [revision];
    report.releasedRevisionId = revision.id;
    report.deliveryPlan.tasks[0].title = "Private changed plan";
    const project = createBlankProject();
    project.outputs = [report];
    project.releasedOutputId = report.id;
    const restored = validateProject(JSON.parse(JSON.stringify(project)));
    expect(restored.outputs[0].plan?.gap).toBe(context.gap);
    expect(releasedReport(restored)?.deliveryPlan?.tasks[0].title).not.toBe(
      "Private changed plan",
    );
  });
  it("exports the reviewed work package register alongside the editable narrative in all report formats", async () => {
    const report = output();
    report.deliveryPlan = draftDeliveryPlan(report);
    report.deliveryPlan.tasks[0].acceptanceCriteria =
      "Exact observable validation gate";
    expect(exportReportMarkdown(report)).toContain(
      "Exact observable validation gate",
    );
    expect(outputHTML(report)).toContain("Delivery work package register");
    const zip = new AdmZip(await exportReportDocx(report));
    const xml = zip.readAsText("word/document.xml");
    expect(xml).toContain("Exact observable validation gate");
    expect(xml).toContain("<w:tbl>");
    expect(PLANNER_IMPORTER.indexOf("if (-not $Apply)")).toBeLessThan(
      PLANNER_IMPORTER.indexOf("Connect-MgGraph"),
    );
    expect(PLANNER_IMPORTER).toContain("If-Match");
    expect(PLANNER_IMPORTER).toContain("interrupted task creation");
  });
});
