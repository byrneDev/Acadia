import type { Passage, ReportDocument } from "./research";
import type { ProjectPlanContext, ResearchOutput } from "./types";
import type { PedigreeRevision, PedigreeState } from "./pedigree";
import { reportDocument } from "./report";

export interface DeliveryRecordRef {
  id: string;
  revision: number;
}
export interface VerificationEvidenceRef {
  passageId: string;
  sourceId: string;
  versionId: string;
}
export interface WorkPackage {
  id: string;
  title: string;
  phase: string;
  description: string;
  acceptanceCriteria: string;
  dependencyIds: string[];
  dependencyNotes: string;
  status: "planned" | "doing" | "blocked" | "complete";
  owner: string;
  dueDate: string;
  gapRefs?: DeliveryRecordRef[];
  findingRefs?: DeliveryRecordRef[];
  requirement?: string;
  learningObjective?: string;
  acceptanceTest?: string;
  verificationEvidence?: VerificationEvidenceRef[];
}
export interface DeliveryPlan {
  schemaVersion: 1;
  id: string;
  title: string;
  sourceOutputId: string;
  sourceRevisionId?: string;
  gap: string;
  gapRefs?: DeliveryRecordRef[];
  findingRefs?: DeliveryRecordRef[];
  deliverableType: ProjectPlanContext["deliverableType"];
  updatedAt: string;
  reviewStatus: "draft" | "reviewed";
  tasks: WorkPackage[];
}
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid delivery plan.");
  return v as Record<string, unknown>;
};
const text = (v: unknown, max = 30_000) => {
  if (typeof v !== "string" || v.length > max)
    throw new Error("Invalid delivery plan text.");
  return v;
};
const id = (v: unknown) => {
  const value = text(v, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(value))
    throw new Error("Invalid work package identifier.");
  return value;
};
export function validateDeliveryRecordRefs(
  input: unknown,
): DeliveryRecordRef[] {
  if (!Array.isArray(input) || input.length > 1000)
    throw new Error("Invalid delivery research references.");
  const seen = new Set<string>();
  return input.map((entry) => {
    const value = object(entry),
      identifier = id(value.id);
    if (
      !Number.isSafeInteger(value.revision) ||
      Number(value.revision) < 1 ||
      seen.has(identifier)
    )
      throw new Error(
        "Each delivery reference needs a unique record and a saved revision.",
      );
    seen.add(identifier);
    return { id: identifier, revision: Number(value.revision) };
  });
}
export function validateVerificationEvidenceRefs(
  input: unknown,
): VerificationEvidenceRef[] {
  if (!Array.isArray(input) || input.length > 1000)
    throw new Error("Invalid verification evidence references.");
  const seen = new Set<string>();
  return input.map((entry) => {
    const value = object(entry),
      passageId = id(value.passageId);
    if (seen.has(passageId)) throw new Error("Duplicate verification passage.");
    seen.add(passageId);
    return {
      passageId,
      sourceId: id(value.sourceId),
      versionId: id(value.versionId),
    };
  });
}
const recordFields = (value: Record<string, unknown>) => ({
  ...(value.gapRefs === undefined
    ? {}
    : { gapRefs: validateDeliveryRecordRefs(value.gapRefs) }),
  ...(value.findingRefs === undefined
    ? {}
    : { findingRefs: validateDeliveryRecordRefs(value.findingRefs) }),
});
/** Run against authoritative project-scoped records; never infer a gap resolution from task status. */
export function validateDeliveryPlanReferences(
  plan: Pick<DeliveryPlan, "gapRefs" | "findingRefs" | "tasks">,
  context: {
    projectId: string;
    pedigree: PedigreeState;
    revisions: PedigreeRevision[];
    passages: Passage[];
  },
): void {
  const records = [plan, ...plan.tasks];
  for (const entry of records)
    for (const [field, kind, collection] of [
      ["gapRefs", "gap", context.pedigree.gaps],
      ["findingRefs", "finding", context.pedigree.findings],
    ] as const)
      for (const ref of entry[field] || []) {
        const exists =
          collection.some(
            (record) =>
              record.projectId === context.projectId &&
              record.id === ref.id &&
              record.revision === ref.revision,
          ) ||
          context.revisions.some(
            (revision) =>
              revision.projectId === context.projectId &&
              revision.entityId === ref.id &&
              revision.kind === kind &&
              revision.revision === ref.revision,
          );
        if (!exists)
          throw new Error(
            "Delivery reference does not identify a saved research revision in this investigation.",
          );
      }
  for (const task of plan.tasks)
    for (const ref of task.verificationEvidence || []) {
      if (
        !context.passages.some(
          (passage) =>
            passage.id === ref.passageId &&
            passage.sourceId === ref.sourceId &&
            passage.versionId === ref.versionId,
        )
      )
        throw new Error(
          "Verification evidence does not identify an exact saved passage in this investigation.",
        );
    }
}
export function validateDeliveryPlan(input: unknown): DeliveryPlan {
  const v = object(input);
  if (v.schemaVersion !== 1 || !Array.isArray(v.tasks) || v.tasks.length > 1000)
    throw new Error(
      "Unsupported delivery plan or more than 1,000 work packages.",
    );
  if (
    !["software", "curriculum", "other"].includes(String(v.deliverableType)) ||
    !["draft", "reviewed"].includes(String(v.reviewStatus))
  )
    throw new Error("Invalid delivery plan type or review state.");
  const tasks = v.tasks.map((value): WorkPackage => {
    const t = object(value),
      dueDate = text(t.dueDate, 10);
    if (
      dueDate &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) ||
        !Number.isFinite(Date.parse(dueDate)) ||
        new Date(dueDate).toISOString().slice(0, 10) !== dueDate)
    )
      throw new Error("Use a valid YYYY-MM-DD due date.");
    if (
      !Array.isArray(t.dependencyIds) ||
      t.dependencyIds.length > 1000 ||
      !["planned", "doing", "blocked", "complete"].includes(String(t.status))
    )
      throw new Error("Invalid work package dependencies or status.");
    return {
      id: id(t.id),
      title: text(t.title, 255),
      phase: text(t.phase, 255),
      description: text(t.description),
      acceptanceCriteria: text(t.acceptanceCriteria),
      dependencyIds: [...new Set(t.dependencyIds.map(id))],
      dependencyNotes: text(t.dependencyNotes),
      status: t.status as WorkPackage["status"],
      owner: text(t.owner, 255),
      dueDate,
      ...recordFields(t),
      ...(t.requirement === undefined
        ? {}
        : { requirement: text(t.requirement) }),
      ...(t.learningObjective === undefined
        ? {}
        : { learningObjective: text(t.learningObjective) }),
      ...(t.acceptanceTest === undefined
        ? {}
        : { acceptanceTest: text(t.acceptanceTest) }),
      ...(t.verificationEvidence === undefined
        ? {}
        : {
            verificationEvidence: validateVerificationEvidenceRefs(
              t.verificationEvidence,
            ),
          }),
    };
  });
  const map = new Map(tasks.map((t) => [t.id, t]));
  if (map.size !== tasks.length)
    throw new Error("Duplicate work package identifiers.");
  const done = new Set<string>(),
    visiting = new Set<string>();
  const visit = (task: WorkPackage) => {
    if (visiting.has(task.id))
      throw new Error("Work package dependencies contain a cycle.");
    if (done.has(task.id)) return;
    visiting.add(task.id);
    for (const dependency of task.dependencyIds) {
      const parent = map.get(dependency);
      if (!parent) throw new Error("A work package dependency is missing.");
      visit(parent);
    }
    visiting.delete(task.id);
    done.add(task.id);
  };
  tasks.forEach(visit);
  const updatedAt = text(v.updatedAt, 40);
  if (!Number.isFinite(Date.parse(updatedAt)))
    throw new Error("Invalid delivery plan date.");
  return {
    schemaVersion: 1,
    id: id(v.id),
    title: text(v.title, 1000),
    sourceOutputId: id(v.sourceOutputId),
    ...(v.sourceRevisionId === undefined
      ? {}
      : { sourceRevisionId: id(v.sourceRevisionId) }),
    gap: text(v.gap),
    ...recordFields(v),
    deliverableType: v.deliverableType as DeliveryPlan["deliverableType"],
    updatedAt,
    reviewStatus: v.reviewStatus as DeliveryPlan["reviewStatus"],
    tasks,
  };
}
export function newWorkPackage(): WorkPackage {
  return {
    id: crypto.randomUUID(),
    title: "",
    phase: "",
    description: "",
    acceptanceCriteria: "",
    dependencyIds: [],
    dependencyNotes: "",
    status: "planned",
    owner: "",
    dueDate: "",
    gapRefs: [],
    findingRefs: [],
    requirement: "",
    learningObjective: "",
    acceptanceTest: "",
    verificationEvidence: [],
  };
}
const nodeText = (node: ReportDocument): string =>
  node.text ||
  (node.content || []).map(nodeText).join(node.type === "paragraph" ? " " : "");
/** Extract only the explicit work-breakdown table; do not reinterpret risks as assigned tasks. */
export function draftDeliveryPlan(output: ResearchOutput): DeliveryPlan {
  const tasks: WorkPackage[] = [];
  const visit = (node: ReportDocument) => {
    if (node.type === "table") {
      const rows = node.content || [];
      const headings =
        rows[0]?.content?.map((cell) => nodeText(cell).trim().toLowerCase()) ||
        [];
      const phase = headings.findIndex(
        (h) => h === "phase" || h === "work package",
      );
      const deliverable = headings.findIndex(
        (h) => h === "deliverable" || h === "output",
      );
      const criteria = headings.findIndex(
        (h) => h === "completion criteria" || h === "acceptance criteria",
      );
      const dependencies = headings.findIndex(
        (h) => h === "depends on" || h === "dependencies",
      );
      if (phase >= 0 && deliverable >= 0 && criteria >= 0)
        for (const row of rows.slice(1)) {
          const cells = row.content?.map(nodeText) || [];
          if (!cells[phase]?.trim()) continue;
          tasks.push({
            ...newWorkPackage(),
            title: cells[phase].trim().slice(0, 255),
            phase: cells[phase].trim().slice(0, 255),
            description: cells[deliverable] || "",
            acceptanceCriteria: cells[criteria] || "",
            dependencyNotes: cells[dependencies] || "",
          });
        }
    } else node.content?.forEach(visit);
  };
  visit(reportDocument(output));
  for (const task of tasks) {
    const matching = tasks.filter(
      (other) =>
        other.id !== task.id && other.title === task.dependencyNotes.trim(),
    );
    if (matching.length === 1) task.dependencyIds = [matching[0].id];
  }
  return validateDeliveryPlan({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    title: output.title,
    sourceOutputId: output.id,
    gap: output.plan?.gap || "",
    gapRefs: output.plan?.gapRefs || [],
    findingRefs: output.plan?.findingRefs || [],
    deliverableType: output.plan?.deliverableType || "other",
    updatedAt: new Date().toISOString(),
    reviewStatus: "draft",
    tasks,
  });
}

/** RFC 4180 quoting plus spreadsheet formula neutralization for user/model text. */
export function csvCell(input: string): string {
  const value =
    /^[\s\u0000-\u001f]*[=+@-]/.test(input) || /^[\t\r\n]/.test(input)
      ? `'${input}`
      : input;
  return `"${value.replace(/"/g, '""')}"`;
}
const csv = (rows: string[][]) =>
  "\uFEFF" +
  rows.map((row) => row.map(csvCell).join(",")).join("\r\n") +
  "\r\n";
export const taskDescription = (plan: DeliveryPlan, task: WorkPackage) =>
  [
    task.description,
    `Acceptance criteria: ${task.acceptanceCriteria || "Unassessed"}`,
    `Software requirement: ${task.requirement || "Unassessed"}`,
    `Learning objective: ${task.learningObjective || "Unassessed"}`,
    `Acceptance test / assessment: ${task.acceptanceTest || "Unassessed"}`,
    `Linked gap revisions: ${formatDeliveryRefs([...(plan.gapRefs || []), ...(task.gapRefs || [])])}`,
    `Linked finding revisions: ${formatDeliveryRefs([...(plan.findingRefs || []), ...(task.findingRefs || [])])}`,
    `Verification evidence: ${formatVerificationRefs(task.verificationEvidence || [])}`,
    `Dependencies: ${task.dependencyIds.join(", ") || "None linked"}${task.dependencyNotes ? `; ${task.dependencyNotes}` : ""}`,
    `Owner (not assigned): ${task.owner || "Unassigned"}`,
    `Research gap: ${plan.gap || "Not specified"}`,
    `Acadia report: ${plan.sourceOutputId}${plan.sourceRevisionId ? `; revision ${plan.sourceRevisionId}` : "; editable draft"}`,
    `Acadia plan: ${plan.id}; work package: ${task.id}; review: ${plan.reviewStatus}`,
  ]
    .filter(Boolean)
    .join("\n\n");
export const formatDeliveryRefs = (refs: DeliveryRecordRef[]) =>
  [...new Set(refs.map((ref) => `${ref.id} (revision ${ref.revision})`))].join(
    "; ",
  ) || "None linked";
export const formatVerificationRefs = (refs: VerificationEvidenceRef[]) =>
  refs
    .map(
      (ref) =>
        `Passage ${ref.passageId}; source ${ref.sourceId}; version ${ref.versionId}`,
    )
    .join(" | ") || "None linked";
export function pmisMappingPreview(plan: DeliveryPlan) {
  return {
    format: "acadia-pmis-mapping-v1",
    planId: plan.id,
    workPackageCount: plan.tasks.length,
    unassignedOwners: plan.tasks.filter((task) => !task.owner.trim()).length,
    unscheduledTasks: plan.tasks.filter((task) => !task.dueDate).length,
    dependencies: plan.tasks.reduce(
      (count, task) => count + task.dependencyIds.length,
      0,
    ),
    withoutVerificationEvidence: plan.tasks.filter(
      (task) => !task.verificationEvidence?.length,
    ).length,
    destinations: [
      {
        name: "Monday",
        identity:
          "Map Acadia ID to a stable text column; use matching when supported.",
        assignments: "Owner is text until mapped to a member.",
        dependencies:
          "Dependency IDs are text; configure native dependency columns.",
        repeatImport:
          "Inspect existing items and mapping before repeating; automatic upsert is not provided.",
      },
      {
        name: "Jira",
        identity:
          "Acadia Work Package ID is a mapping field; retain created issue keys in an import receipt.",
        assignments:
          "Owner is retained in Description; map to an allowed account separately.",
        dependencies:
          "Dependencies and acceptance criteria are in Description; native links need mapping.",
        repeatImport:
          "A repeated create import may duplicate issues. Use the receipt to reconcile before repeating.",
      },
      {
        name: "Planner",
        identity:
          "The explicit PowerShell importer uses stable external IDs and a local receipt for one account/plan.",
        assignments:
          "Owners remain text; assign members in the target basic plan.",
        dependencies:
          "Dependencies are descriptive, not scheduling constraints.",
        repeatImport:
          "Resume with the same receipt after inspecting interrupted creates. Changed existing tasks are not synchronized.",
      },
    ],
    limitations: [
      "Exports do not contact a PMIS or resolve research gaps.",
      "Local format tests do not establish a successful live tenant import.",
      "Only entered dates and owners are exported; no schedule or identity is inferred.",
    ],
  };
}
export function deliveryPlanMarkdown(plan: DeliveryPlan): string {
  const cell = (text: string) =>
    text.replace(/[\\|`*_[\]<>]/g, (c) => `\\${c}`).replace(/\n/g, " ");
  return `## Delivery work package register\n\nReview: ${plan.reviewStatus}. Source report: ${plan.sourceOutputId}. Research gap: ${cell(plan.gap || "Unassessed")}.\n\nGap revisions: ${cell(formatDeliveryRefs(plan.gapRefs || []))}. Finding revisions: ${cell(formatDeliveryRefs(plan.findingRefs || []))}.\n\n| Work package | Deliverable and acceptance | Dependencies | Status / owner / due |\n| --- | --- | --- | --- |\n${plan.tasks.map((t) => `| ${cell(t.title)} (${t.id}) | ${cell(t.description)}. Acceptance: ${cell(t.acceptanceCriteria || "Unassessed")} | ${cell(t.dependencyIds.map((id) => plan.tasks.find((p) => p.id === id)?.title || id).join("; "))}${t.dependencyNotes ? `; ${cell(t.dependencyNotes)}` : ""} | ${t.status}; ${cell(t.owner || "Unassigned")}; ${t.dueDate || "Unscheduled"} |`).join("\n")}\n\n### Requirements and verification\n\n| Work package | Requirement / learning objective | Test / assessment | Historical basis and evidence |\n| --- | --- | --- | --- |\n${plan.tasks.map((t) => `| ${cell(t.title)} | ${cell([t.requirement && `Requirement: ${t.requirement}`, t.learningObjective && `Learning objective: ${t.learningObjective}`].filter(Boolean).join("; ") || "Unassessed")} | ${cell(t.acceptanceTest || "Unassessed")} | Gaps: ${cell(formatDeliveryRefs(t.gapRefs || []))}. Findings: ${cell(formatDeliveryRefs(t.findingRefs || []))}. Evidence: ${cell(formatVerificationRefs(t.verificationEvidence || []))} |`).join("\n")}\n\nNative account assignments and scheduling constraints must be configured in the destination PMIS. Completing a work package does not resolve a research gap; review its verification evidence and update the gap deliberately. Proposed work is not evidence that the deliverable will close the research gap.\n`;
}
export function exportPmisFiles(input: DeliveryPlan): Record<string, string> {
  const plan = validateDeliveryPlan(input);
  if (!plan.tasks.length || plan.tasks.some((t) => !t.title.trim()))
    throw new Error("Add a title to every work package before exporting.");
  const generic = [
    [
      "Work Package ID",
      "Title",
      "Phase",
      "Description",
      "Acceptance Criteria",
      "Dependencies",
      "Dependency Notes",
      "Status",
      "Owner",
      "Due Date",
      "Research Gap",
      "Source Report",
      "Plan Review",
      "Requirement",
      "Learning Objective",
      "Acceptance Test",
      "Gap Revisions",
      "Finding Revisions",
      "Verification Evidence",
    ],
    ...plan.tasks.map((t) => [
      t.id,
      t.title,
      t.phase,
      t.description,
      t.acceptanceCriteria,
      t.dependencyIds.join("; "),
      t.dependencyNotes,
      t.status,
      t.owner,
      t.dueDate,
      plan.gap,
      plan.sourceOutputId,
      plan.reviewStatus,
      t.requirement || "",
      t.learningObjective || "",
      t.acceptanceTest || "",
      formatDeliveryRefs([...(plan.gapRefs || []), ...(t.gapRefs || [])]),
      formatDeliveryRefs([
        ...(plan.findingRefs || []),
        ...(t.findingRefs || []),
      ]),
      formatVerificationRefs(t.verificationEvidence || []),
    ]),
  ];
  const monday = [
    [
      "Name",
      "Acadia ID",
      "Phase",
      "Description",
      "Acceptance Criteria",
      "Dependencies",
      "Status",
      "Owner",
      "Due Date",
    ],
    ...plan.tasks.map((t) => [
      t.title,
      t.id,
      t.phase,
      taskDescription(plan, t),
      t.acceptanceCriteria,
      t.dependencyIds.join("; "),
      t.status,
      t.owner,
      t.dueDate,
    ]),
  ];
  // Portable baseline importer fields. Relations/owners are retained in description;
  // do not manufacture Jira issue keys, account IDs or custom-field mappings.
  const jira = [
    [
      "Summary",
      "Issue Type",
      "Description",
      "Labels",
      "Due Date",
      "Acadia Work Package ID",
    ],
    ...plan.tasks.map((t) => [
      t.title,
      "Task",
      taskDescription(plan, t),
      "acadia",
      t.dueDate,
      t.id,
    ]),
  ];
  const planner = {
    format: "acadia-planner-v1",
    plan,
    tasks: plan.tasks.map((t) => ({
      externalId: t.id,
      title: t.title,
      bucket: t.phase || "Acadia work packages",
      description: taskDescription(plan, t),
      percentComplete:
        t.status === "complete" ? 100 : t.status === "doing" ? 50 : 0,
      ...(t.dueDate ? { dueDateTime: `${t.dueDate}T17:00:00Z` } : {}),
      dependencyIds: t.dependencyIds,
      status: t.status,
    })),
  };
  return {
    "work-packages.csv": csv(generic),
    "monday.csv": csv(monday),
    "jira.csv": csv(jira),
    "delivery-plan.json": JSON.stringify(plan, null, 2),
    "planner.json": JSON.stringify(planner, null, 2),
    "import-mapping.json": JSON.stringify(pmisMappingPreview(plan), null, 2),
    "IMPORT-RECEIPT-TEMPLATE.csv": csv([
      [
        "Acadia Work Package ID",
        "Destination",
        "Target Project or Plan",
        "External Item ID",
        "External URL",
      ],
      ...plan.tasks.map((task) => [task.id, "", "", "", ""]),
    ]),
    "IMPORT-README.md": PMIS_GUIDE,
  };
}
export const PMIS_GUIDE = `# Acadia PMIS handoff

Review work packages before import. Export creates local files only; it does not contact any PMIS. Dates and owners remain unassigned unless you entered them. Retain delivery-plan.json and the report for traceability. Credentials are not part of this bundle.

## Mapping preview and repeated imports
Read import-mapping.json before import: it lists identity mapping, assignments, dependencies, unassigned fields, and repeat-import limitations for each destination. Populate IMPORT-RECEIPT-TEMPLATE.csv with the external item IDs and destination project/plan after import. Stable Acadia IDs are data, not an automatic upsert guarantee. A repeated import can create duplicates; these exports do not synchronize subsequent edits or reconcile deleted tasks.

Gap and finding references retain their saved revision numbers. Requirements, learning objectives, acceptance tests, and exact verification passage/source/version IDs survive CSV descriptions and JSON exports. A completed task or a linked passage does not resolve its research gap automatically; review the observation and update the gap manually in Acadia. Live Monday, Jira, and Planner tenant imports have not been validated by Acadia's local export tests.

## Monday
Import monday.csv into a board using Import items. Map Name to the item name, Due Date to Date (YYYY-MM-DD), and the remaining fields to Text/Long Text or Status. Use Acadia ID as a matching key when offered to avoid duplicates. Dependencies and phase are preserved as text; configure native dependency columns and groups after import. Owner is text until mapped to a valid member. Do not assume native links or assignments were created.
https://support.monday.com/hc/en-us/articles/360000219209-Import-files-from-Excel

## Jira
Import jira.csv with your Jira CSV importer. Map Summary, Description, Issue Type and Labels; use yyyy-MM-dd for Due Date. Map Task to an available issue type in your project; administrator import capabilities vary. Research provenance, dependency IDs, owner and acceptance criteria are in Description. Native issue links, assignees, hierarchy and custom fields require mapping/configuration in Jira after import. A repeated CSV import may create duplicates; retain imported issue keys before repeating.
https://support.atlassian.com/jira-software-cloud/docs/create-issues-using-the-csv-importer/

## Microsoft Planner
planner.json is an integration payload, not a file to upload directly into Planner. Use the included Import-Planner.ps1 with PowerShell 7 and Microsoft.Graph.Authentication installed. It uses interactive Microsoft sign-in and Tasks.ReadWrite permission against an existing basic plan you can edit. Premium plans are outside this Graph adapter. Run first without -Apply to preview; no network calls occur in preview mode.

    ./Import-Planner.ps1 -Path ./planner.json -PlanId YOUR_EXISTING_PLAN_ID
    ./Import-Planner.ps1 -Path ./planner.json -PlanId YOUR_EXISTING_PLAN_ID -Apply

The importer creates phase buckets and tasks, then writes descriptions containing acceptance criteria, dependencies and provenance. Dependencies are descriptive, not scheduling constraints. Owners are retained as text and must be assigned in Planner. Due dates use 17:00 UTC on the supplied date. A local receipt supports resuming a partial import; keep it and inspect the target plan after any interrupted create request before retrying. Do not reuse a receipt for a different account or plan. The importer never installs modules or provisions a plan automatically.
https://learn.microsoft.com/en-us/graph/planner-concept-overview
https://learn.microsoft.com/en-us/graph/api/planner-post-tasks?view=graph-rest-1.0

## Other PMIS
Map work-packages.csv or delivery-plan.json to your system. Stable work package IDs and dependency IDs retain relationships. CSV cells that could be spreadsheet formulas are prefixed with an apostrophe; JSON retains the original text. These adapters are format-tested locally; live tenant import depends on your permissions, plan type and field configuration.
`;
