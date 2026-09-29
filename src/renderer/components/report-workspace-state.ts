import type { OutputKind, ProjectPlanContext } from "../../shared/types";

export interface ReportWorkspaceState {
  kind: OutputKind;
  instructions: string;
  plan?: ProjectPlanContext;
  selectedId: string | null;
  revisionId: string;
  revisionNote: string;
  composerOpen: boolean;
  inspectorOpen: boolean;
  scrollPositions: Record<string, number>;
}

const outputKinds: OutputKind[] = [
  "project-plan",
  "decision-brief",
  "hypothesis",
  "research-plan",
  "whitepaper",
  "gap-analysis",
  "needs-analysis",
];
const key = (projectId: string) => `acadia:report-workspace:v1:${projectId}`;
export function defaultReportWorkspace(empty: boolean): ReportWorkspaceState {
  return {
    kind: "decision-brief",
    instructions: "",
    selectedId: null,
    revisionId: "",
    revisionNote: "",
    composerOpen: empty,
    inspectorOpen: false,
    scrollPositions: {},
  };
}
/** UI preferences only: never provider configuration, keys, or report content. */
export function readReportWorkspace(
  projectId: string,
  empty: boolean,
  storage?: Pick<Storage, "getItem">,
): ReportWorkspaceState {
  const fallback = defaultReportWorkspace(empty);
  try {
    const value = JSON.parse(
      (storage ?? window.localStorage).getItem(key(projectId)) || "null",
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fallback;
    const text = (field: string, max: number) =>
      typeof value[field] === "string" ? value[field].slice(0, max) : "";
    const positions: Record<string, number> = {};
    if (value.scrollPositions && typeof value.scrollPositions === "object") {
      for (const [id, offset] of Object.entries(value.scrollPositions).slice(
        -100,
      ))
        if (
          typeof offset === "number" &&
          Number.isFinite(offset) &&
          offset >= 0
        )
          positions[id] = offset;
    }
    return {
      kind: outputKinds.includes(value.kind) ? value.kind : fallback.kind,
      instructions: text("instructions", 8000),
      ...(value.plan &&
      typeof value.plan === "object" &&
      typeof value.plan.analysisOutputId === "string" &&
      ["software", "curriculum", "other"].includes(value.plan.deliverableType)
        ? {
            plan: {
              analysisOutputId: value.plan.analysisOutputId.slice(0, 128),
              ...(typeof value.plan.analysisRevisionId === "string"
                ? {
                    analysisRevisionId: value.plan.analysisRevisionId.slice(
                      0,
                      128,
                    ),
                  }
                : {}),
              ...(typeof value.plan.gapClaimId === "string"
                ? { gapClaimId: value.plan.gapClaimId.slice(0, 128) }
                : {}),
              deliverableType: value.plan.deliverableType,
              gap:
                typeof value.plan.gap === "string"
                  ? value.plan.gap.slice(0, 8000)
                  : "",
              deliverable:
                typeof value.plan.deliverable === "string"
                  ? value.plan.deliverable.slice(0, 8000)
                  : "",
              acceptanceCriteria:
                typeof value.plan.acceptanceCriteria === "string"
                  ? value.plan.acceptanceCriteria.slice(0, 8000)
                  : "",
            },
          }
        : {}),
      selectedId: text("selectedId", 200) || null,
      revisionId: text("revisionId", 200),
      revisionNote: text("revisionNote", 160),
      composerOpen: empty || value.composerOpen === true,
      inspectorOpen: value.inspectorOpen === true,
      scrollPositions: positions,
    };
  } catch {
    return fallback;
  }
}
export function writeReportWorkspace(
  projectId: string,
  state: ReportWorkspaceState,
  storage?: Pick<Storage, "setItem">,
): void {
  try {
    (storage ?? window.localStorage).setItem(
      key(projectId),
      JSON.stringify(state),
    );
  } catch {
    /* Storage can be full or disabled; research remains in project storage. */
  }
}
