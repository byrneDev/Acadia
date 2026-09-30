import type {
  Passage,
  ResearchClaim,
  ResearchTask,
  SourceRecord,
  SourceVersion,
} from "./research";

export type ReviewStatus = "unassessed" | "draft" | "reviewed";
export interface PedigreeEntityBase {
  id: string;
  projectId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface ResearchBrief extends PedigreeEntityBase {
  question: string;
  decision: string;
  scope: string;
  dateFrom: string;
  dateTo: string;
  inclusionCriteria: string;
  exclusionCriteria: string;
  successCriteria: string;
  reviewStatus: ReviewStatus;
}
export interface SourceAppraisal extends PedigreeEntityBase {
  sourceId: string;
  versionId: string;
  evidenceType: string;
  origin: "primary" | "secondary" | "unknown";
  methods: string;
  applicability: string;
  currency: string;
  limitations: string;
  bias: string;
  rationale: string;
  passageIds: string[];
  reviewStatus: ReviewStatus;
}
export interface SourceOrigin extends PedigreeEntityBase {
  sourceId: string;
  relatedSourceId: string;
  kind: "same-study" | "same-dataset" | "derived-from" | "same-reporting";
  status: "proposed" | "confirmed" | "rejected";
  rationale: string;
}
export interface FindingAssessment extends PedigreeEntityBase {
  claimId: string;
  classification:
    "unassessed" | "source-assertion" | "inference" | "hypothesis";
  reasoning: string;
  assumptionIds: string[];
  confidence: "unassessed" | "low" | "moderate" | "high";
  confidenceBasis: string;
  wouldChange: string;
  supportReview:
    "unassessed" | "supported" | "partial" | "unsupported" | "contradicted";
  reviewStatus: ReviewStatus;
}
export interface ResearchAssumption extends PedigreeEntityBase {
  statement: string;
  basis: string;
  consequence: string;
  validation: string;
  passageIds: string[];
  claimIds: string[];
  status: "unassessed" | "proposed" | "supported" | "challenged";
}
export interface ResearchGap extends PedigreeEntityBase {
  title: string;
  missingInformation: string;
  importance: string;
  resolutionCriteria: string;
  claimIds: string[];
  taskIds: string[];
  passageIds: string[];
  status: "open" | "investigating" | "resolved";
}
export interface ResearchDecision extends PedigreeEntityBase {
  title: string;
  action: string;
  rationale: string;
  alternatives: string;
  claimIds: string[];
  assumptionIds: string[];
  outputIds: string[];
  status: "proposed" | "made" | "reconsider";
}
export type MethodKind = "hypotheses" | "swot" | "root-cause" | "risk" | "trl";
export interface MethodRowBase {
  id: string;
  text: string;
  passageIds: string[];
  claimIds: string[];
  assumptionIds: string[];
  taskIds: string[];
  nextTest: string;
}
export interface HypothesisRow extends MethodRowBase {
  predictions: string;
  discriminatingTest: string;
  evaluations: {
    passageId: string;
    assessment: "supports" | "contradicts" | "neutral" | "unassessed";
    rationale: string;
  }[];
}
export interface SwotRow extends MethodRowBase {
  observationKind: "observation" | "assumption";
  implications: string;
  actions: string;
  category: "strength" | "weakness" | "opportunity" | "threat";
}
export interface RootCauseRow extends MethodRowBase {
  testEvidence: string;
  parentId?: string;
  causalStatus: "unassessed" | "possible" | "supported" | "rejected" | "tested";
  rationale: string;
}
export interface RiskRow extends MethodRowBase {
  causes: string;
  consequences: string;
  controls: string;
  likelihoodBasis: string;
  impactBasis: string;
  likelihood: "unassessed" | "low" | "moderate" | "high";
  impact: "unassessed" | "low" | "moderate" | "high";
  mitigation: string;
  owner: string;
  residualRisk: string;
}
export interface TrlRow extends MethodRowBase {
  element: string;
  environment: string;
  assessedLevel: number | null;
  criteria: string;
  demonstrated: string;
  requiredEvidence: string;
}
interface WorksheetBase extends PedigreeEntityBase {
  title: string;
  objective: string;
  limitations: string;
  nextSteps: string;
  reviewStatus: ReviewStatus;
}
export type MethodWorksheet = WorksheetBase &
  (
    | { kind: "hypotheses"; rows: HypothesisRow[] }
    | { kind: "swot"; rows: SwotRow[] }
    | { kind: "root-cause"; rows: RootCauseRow[] }
    | { kind: "risk"; rows: RiskRow[] }
    | { kind: "trl"; rows: TrlRow[] }
  );
export type MethodRow =
  HypothesisRow | SwotRow | RootCauseRow | RiskRow | TrlRow;
export const METHOD_REGISTRY: readonly {
  kind: MethodKind;
  label: string;
  description: string;
}[] = [
  {
    kind: "hypotheses",
    label: "Competing hypotheses",
    description:
      "Compare supporting, conflicting, and missing evidence for alternative explanations.",
  },
  {
    kind: "swot",
    label: "SWOT",
    description:
      "Record evidence for strengths, weaknesses, opportunities, and threats.",
  },
  {
    kind: "root-cause",
    label: "Root cause / Why chain",
    description:
      "Examine causal explanations and the tests that could distinguish them.",
  },
  {
    kind: "risk",
    label: "Risk",
    description:
      "Assess likelihood, impact, mitigation, and residual uncertainty.",
  },
  {
    kind: "trl",
    label: "Technology readiness",
    description:
      "Record researcher-assessed readiness, environment, criteria, and required evidence. This is not certification.",
  },
] as const;

export type ReviewTargetKind =
  | "brief"
  | "appraisal"
  | "origin"
  | "finding"
  | "assumption"
  | "method"
  | "source"
  | "claim"
  | "report";
export interface ReviewTarget {
  kind: ReviewTargetKind;
  id: string;
}
export interface ReviewIssue extends PedigreeEntityBase {
  target: ReviewTarget;
  category: string;
  summary: string;
  detail: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed";
  rationale: string;
  passageIds: string[];
  claimIds: string[];
  assumptionIds: string[];
  taskIds: string[];
  origin: "researcher" | "ai";
  runId?: string;
  reportId?: string;
  claimId?: string;
  methodId?: string;
}
export interface PedigreeState {
  briefs: ResearchBrief[];
  appraisals: SourceAppraisal[];
  origins: SourceOrigin[];
  findings: FindingAssessment[];
  assumptions: ResearchAssumption[];
  methods: MethodWorksheet[];
  issues: ReviewIssue[];
  gaps: ResearchGap[];
  decisions: ResearchDecision[];
}
export type PedigreeEntityKind =
  | "brief"
  | "appraisal"
  | "origin"
  | "finding"
  | "assumption"
  | "method"
  | "issue"
  | "gap"
  | "decision";
export type PedigreeEntity =
  | ResearchBrief
  | SourceAppraisal
  | SourceOrigin
  | FindingAssessment
  | ResearchAssumption
  | MethodWorksheet
  | ReviewIssue
  | ResearchGap
  | ResearchDecision;
export interface PedigreeRevision {
  id: string;
  projectId: string;
  entityId: string;
  kind: PedigreeEntityKind;
  revision: number;
  createdAt: string;
  data: PedigreeEntity;
}
export interface PedigreeSnapshot {
  schemaVersion: 1;
  id: string;
  projectId: string;
  createdAt: string;
  hash: string;
  state: PedigreeState;
  claims: ResearchClaim[];
  tasks: ResearchTask[];
  passages: Passage[];
  sources: SourceRecord[];
  sourceVersions: SourceVersion[];
  sourceIds: string[];
}
export const emptyPedigreeState = (): PedigreeState => ({
  briefs: [],
  appraisals: [],
  origins: [],
  findings: [],
  assumptions: [],
  methods: [],
  issues: [],
  gaps: [],
  decisions: [],
});
const base = (projectId: string): PedigreeEntityBase => {
  const timestamp = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    projectId,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};
export const createBrief = (
  projectId: string,
  question = "",
): ResearchBrief => ({
  ...base(projectId),
  question,
  decision: "",
  scope: "",
  dateFrom: "",
  dateTo: "",
  inclusionCriteria: "",
  exclusionCriteria: "",
  successCriteria: "",
  reviewStatus: "unassessed",
});
export const createAppraisal = (
  projectId: string,
  sourceId: string,
  versionId: string,
): SourceAppraisal => ({
  ...base(projectId),
  sourceId,
  versionId,
  evidenceType: "unknown",
  origin: "unknown",
  methods: "",
  applicability: "",
  currency: "",
  limitations: "",
  bias: "",
  rationale: "",
  passageIds: [],
  reviewStatus: "unassessed",
});
export const createOrigin = (
  projectId: string,
  sourceId: string,
  relatedSourceId: string,
): SourceOrigin => ({
  ...base(projectId),
  sourceId,
  relatedSourceId,
  kind: "derived-from",
  status: "proposed",
  rationale: "",
});
export const createFinding = (
  projectId: string,
  claimId: string,
): FindingAssessment => ({
  ...base(projectId),
  claimId,
  classification: "unassessed",
  reasoning: "",
  assumptionIds: [],
  confidence: "unassessed",
  confidenceBasis: "",
  wouldChange: "",
  supportReview: "unassessed",
  reviewStatus: "unassessed",
});
export const createAssumption = (projectId: string): ResearchAssumption => ({
  ...base(projectId),
  statement: "",
  basis: "",
  consequence: "",
  validation: "",
  passageIds: [],
  claimIds: [],
  status: "unassessed",
});
export const createGap = (projectId: string): ResearchGap => ({
  ...base(projectId),
  title: "",
  missingInformation: "",
  importance: "",
  resolutionCriteria: "",
  claimIds: [],
  taskIds: [],
  passageIds: [],
  status: "open",
});
export const createDecision = (projectId: string): ResearchDecision => ({
  ...base(projectId),
  title: "",
  action: "",
  rationale: "",
  alternatives: "",
  claimIds: [],
  assumptionIds: [],
  outputIds: [],
  status: "proposed",
});
export const createReviewIssue = (
  projectId: string,
  target: ReviewTarget,
): ReviewIssue => ({
  ...base(projectId),
  target,
  category: "review",
  summary: "",
  detail: "",
  status: "open",
  rationale: "",
  passageIds: [],
  claimIds: [],
  assumptionIds: [],
  taskIds: [],
  origin: "researcher",
});
export function createMethodRow(kind: MethodKind): MethodRow {
  const row: MethodRowBase = {
    id: crypto.randomUUID(),
    text: "",
    passageIds: [],
    claimIds: [],
    assumptionIds: [],
    taskIds: [],
    nextTest: "",
  };
  switch (kind) {
    case "hypotheses":
      return {
        ...row,
        predictions: "",
        discriminatingTest: "",
        evaluations: [],
      };
    case "swot":
      return {
        ...row,
        observationKind: "observation",
        category: "strength",
        implications: "",
        actions: "",
      };
    case "root-cause":
      return {
        ...row,
        testEvidence: "",
        causalStatus: "unassessed",
        rationale: "",
      };
    case "risk":
      return {
        ...row,
        causes: "",
        consequences: "",
        controls: "",
        likelihoodBasis: "",
        impactBasis: "",
        likelihood: "unassessed",
        impact: "unassessed",
        mitigation: "",
        owner: "",
        residualRisk: "",
      };
    case "trl":
      return {
        ...row,
        element: "",
        environment: "",
        assessedLevel: null,
        criteria: "",
        demonstrated: "",
        requiredEvidence: "",
      };
  }
}
export function createMethodWorksheet(
  projectId: string,
  kind: MethodKind,
): MethodWorksheet {
  return {
    ...base(projectId),
    kind,
    title: METHOD_REGISTRY.find((m) => m.kind === kind)!.label,
    objective: "",
    limitations: "",
    nextSteps: "",
    reviewStatus: "unassessed",
    rows: [],
  } as MethodWorksheet;
}

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid pedigree record.");
  return v as Record<string, unknown>;
};
const text = (v: unknown, max = 100_000): string => {
  if (typeof v !== "string" || v.length > max)
    throw new Error("Invalid pedigree text.");
  return v;
};
const ident = (v: unknown): string => {
  const s = text(v, 128);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(s))
    throw new Error("Invalid pedigree identifier.");
  return s;
};
const choice = <T extends string>(v: unknown, values: readonly T[]): T => {
  if (!values.includes(v as T)) throw new Error("Invalid pedigree choice.");
  return v as T;
};
const array = (v: unknown, max = 10_000): unknown[] => {
  if (!Array.isArray(v) || v.length > max)
    throw new Error("Invalid pedigree collection.");
  return v;
};
const ids = (v: unknown): string[] => {
  const result = array(v).map(ident);
  if (new Set(result).size !== result.length)
    throw new Error("Duplicate pedigree references.");
  return result;
};
const date = (v: unknown): string => {
  const s = text(v, 40);
  if (!Number.isFinite(Date.parse(s)))
    throw new Error("Invalid pedigree date.");
  return s;
};
const optionalDate = (v: unknown): string => {
  const s = text(v, 40);
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s))
    throw new Error("Use an ISO calendar date.");
  if (
    s &&
    (!Number.isFinite(Date.parse(s)) ||
      new Date(s).toISOString().slice(0, 10) !== s)
  )
    throw new Error("Invalid calendar date.");
  return s;
};
const review = (v: unknown) =>
  choice(v, ["unassessed", "draft", "reviewed"] as const);
function validatedBase(
  value: Record<string, unknown>,
  projectId?: string,
): PedigreeEntityBase {
  const owner = ident(value.projectId);
  if (projectId !== undefined && owner !== projectId)
    throw new Error("Pedigree record belongs to another project.");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0)
    throw new Error("Invalid pedigree revision.");
  return {
    id: ident(value.id),
    projectId: owner,
    revision: value.revision as number,
    createdAt: date(value.createdAt),
    updatedAt: date(value.updatedAt),
  };
}
function rowBase(v: Record<string, unknown>): MethodRowBase {
  return {
    id: ident(v.id),
    text: text(v.text),
    passageIds: ids(v.passageIds),
    claimIds: ids(v.claimIds),
    assumptionIds: ids(v.assumptionIds),
    taskIds: ids(v.taskIds),
    nextTest: text(v.nextTest),
  };
}
export function validatePedigreeEntity(
  kind: PedigreeEntityKind,
  input: unknown,
  projectId?: string,
): PedigreeEntity {
  const v = object(input),
    b = validatedBase(v, projectId);
  switch (kind) {
    case "brief": {
      const dateFrom = optionalDate(v.dateFrom),
        dateTo = optionalDate(v.dateTo);
      if (dateFrom && dateTo && dateFrom > dateTo)
        throw new Error("Research date range is reversed.");
      return {
        ...b,
        question: text(v.question),
        decision: text(v.decision),
        scope: text(v.scope),
        dateFrom,
        dateTo,
        inclusionCriteria: text(v.inclusionCriteria),
        exclusionCriteria: text(v.exclusionCriteria),
        successCriteria: text(v.successCriteria),
        reviewStatus: review(v.reviewStatus),
      };
    }
    case "appraisal":
      return {
        ...b,
        sourceId: ident(v.sourceId),
        versionId: ident(v.versionId),
        evidenceType: text(v.evidenceType, 1000),
        origin: choice(v.origin, ["primary", "secondary", "unknown"]),
        methods: text(v.methods),
        applicability: text(v.applicability),
        currency: text(v.currency),
        limitations: text(v.limitations),
        bias: text(v.bias),
        rationale: text(v.rationale),
        passageIds: ids(v.passageIds),
        reviewStatus: review(v.reviewStatus),
      };
    case "origin": {
      const sourceId = ident(v.sourceId),
        relatedSourceId = ident(v.relatedSourceId);
      if (sourceId === relatedSourceId)
        throw new Error("A source cannot be its own origin relationship.");
      return {
        ...b,
        sourceId,
        relatedSourceId,
        kind: choice(v.kind, [
          "same-study",
          "same-dataset",
          "derived-from",
          "same-reporting",
        ]),
        status: choice(v.status, ["proposed", "confirmed", "rejected"]),
        rationale: text(v.rationale),
      };
    }
    case "finding":
      return {
        ...b,
        claimId: ident(v.claimId),
        classification: choice(v.classification, [
          "unassessed",
          "source-assertion",
          "inference",
          "hypothesis",
        ]),
        reasoning: text(v.reasoning),
        assumptionIds: ids(v.assumptionIds),
        confidence: choice(v.confidence, [
          "unassessed",
          "low",
          "moderate",
          "high",
        ]),
        confidenceBasis: text(v.confidenceBasis),
        wouldChange: text(v.wouldChange),
        supportReview: choice(v.supportReview, [
          "unassessed",
          "supported",
          "partial",
          "unsupported",
          "contradicted",
        ]),
        reviewStatus: review(v.reviewStatus),
      };
    case "assumption":
      return {
        ...b,
        statement: text(v.statement),
        basis: text(v.basis),
        consequence: text(v.consequence),
        validation: text(v.validation),
        passageIds: ids(v.passageIds),
        claimIds: ids(v.claimIds),
        status: choice(v.status, [
          "unassessed",
          "proposed",
          "supported",
          "challenged",
        ]),
      };
    case "issue": {
      const target = object(v.target);
      return {
        ...b,
        target: {
          kind: choice(target.kind, [
            "brief",
            "appraisal",
            "origin",
            "finding",
            "assumption",
            "method",
            "source",
            "claim",
            "report",
          ]),
          id: ident(target.id),
        },
        category: text(v.category, 1000),
        summary: text(v.summary, 10000),
        detail: text(v.detail),
        status: choice(v.status, [
          "open",
          "acknowledged",
          "resolved",
          "dismissed",
        ]),
        rationale: text(v.rationale),
        passageIds: ids(v.passageIds),
        claimIds: ids(v.claimIds),
        assumptionIds: ids(v.assumptionIds),
        taskIds: ids(v.taskIds),
        origin: choice(v.origin, ["researcher", "ai"]),
        ...(v.runId !== undefined ? { runId: ident(v.runId) } : {}),
        ...(v.reportId !== undefined ? { reportId: ident(v.reportId) } : {}),
        ...(v.claimId !== undefined ? { claimId: ident(v.claimId) } : {}),
        ...(v.methodId !== undefined ? { methodId: ident(v.methodId) } : {}),
      };
    }
    case "gap":
      return {
        ...b,
        title: text(v.title, 1000),
        missingInformation: text(v.missingInformation),
        importance: text(v.importance),
        resolutionCriteria: text(v.resolutionCriteria),
        claimIds: ids(v.claimIds),
        taskIds: ids(v.taskIds),
        passageIds: ids(v.passageIds),
        status: choice(v.status, ["open", "investigating", "resolved"]),
      };
    case "decision":
      return {
        ...b,
        title: text(v.title, 1000),
        action: text(v.action),
        rationale: text(v.rationale),
        alternatives: text(v.alternatives),
        claimIds: ids(v.claimIds),
        assumptionIds: ids(v.assumptionIds),
        outputIds: ids(v.outputIds),
        status: choice(v.status, ["proposed", "made", "reconsider"]),
      };
    case "method": {
      const methodKind = choice(v.kind, [
        "hypotheses",
        "swot",
        "root-cause",
        "risk",
        "trl",
      ] as const);
      const rows = array(v.rows, 2000).map((input): MethodRow => {
        const r = object(input),
          common = rowBase(r);
        switch (methodKind) {
          case "hypotheses":
            return {
              ...common,
              predictions: text(r.predictions),
              discriminatingTest: text(r.discriminatingTest),
              evaluations: array(r.evaluations).map((input) => {
                const e = object(input);
                return {
                  passageId: ident(e.passageId),
                  assessment: choice(e.assessment, [
                    "supports",
                    "contradicts",
                    "neutral",
                    "unassessed",
                  ]),
                  rationale: text(e.rationale),
                };
              }),
            };
          case "swot":
            return {
              ...common,
              observationKind: choice(r.observationKind, [
                "observation",
                "assumption",
              ]),
              implications: text(r.implications),
              actions: text(r.actions),
              category: choice(r.category, [
                "strength",
                "weakness",
                "opportunity",
                "threat",
              ]),
            };
          case "root-cause":
            return {
              ...common,
              testEvidence: text(r.testEvidence),
              ...(r.parentId !== undefined
                ? { parentId: ident(r.parentId) }
                : {}),
              causalStatus: choice(r.causalStatus, [
                "unassessed",
                "possible",
                "supported",
                "rejected",
                "tested",
              ]),
              rationale: text(r.rationale),
            };
          case "risk":
            return {
              ...common,
              causes: text(r.causes),
              consequences: text(r.consequences),
              controls: text(r.controls),
              likelihoodBasis: text(r.likelihoodBasis),
              impactBasis: text(r.impactBasis),
              likelihood: choice(r.likelihood, [
                "unassessed",
                "low",
                "moderate",
                "high",
              ]),
              impact: choice(r.impact, [
                "unassessed",
                "low",
                "moderate",
                "high",
              ]),
              mitigation: text(r.mitigation),
              owner: text(r.owner),
              residualRisk: text(r.residualRisk),
            };
          case "trl": {
            if (
              r.assessedLevel !== null &&
              (!Number.isSafeInteger(r.assessedLevel) ||
                (r.assessedLevel as number) < 1 ||
                (r.assessedLevel as number) > 9)
            )
              throw new Error(
                "Readiness level must be unassessed or an integer from 1 to 9.",
              );
            return {
              ...common,
              element: text(r.element),
              environment: text(r.environment),
              assessedLevel: r.assessedLevel as number | null,
              criteria: text(r.criteria),
              demonstrated: text(r.demonstrated),
              requiredEvidence: text(r.requiredEvidence),
            };
          }
        }
      });
      if (new Set(rows.map((r) => r.id)).size !== rows.length)
        throw new Error("Duplicate worksheet row identifiers.");
      if (methodKind === "root-cause") {
        const map = new Map((rows as RootCauseRow[]).map((r) => [r.id, r]));
        for (const row of map.values()) {
          const visited = new Set<string>([row.id]);
          let parent = row.parentId;
          while (parent) {
            if (visited.has(parent))
              throw new Error("Root-cause chain contains a cycle.");
            visited.add(parent);
            const found = map.get(parent);
            if (!found) throw new Error("Root-cause parent row is missing.");
            parent = found.parentId;
          }
        }
      }
      return {
        ...b,
        kind: methodKind,
        title: text(v.title, 1000),
        objective: text(v.objective),
        limitations: text(v.limitations),
        nextSteps: text(v.nextSteps),
        reviewStatus: review(v.reviewStatus),
        rows,
      } as MethodWorksheet;
    }
  }
}
export const PEDIGREE_COLLECTIONS = {
  brief: "briefs",
  appraisal: "appraisals",
  origin: "origins",
  finding: "findings",
  assumption: "assumptions",
  method: "methods",
  issue: "issues",
  gap: "gaps",
  decision: "decisions",
} as const;
export function validatePedigreeState(
  input: unknown,
  projectId: string,
): PedigreeState {
  const value = object(input),
    result = emptyPedigreeState();
  for (const [kind, key] of Object.entries(PEDIGREE_COLLECTIONS) as [
    PedigreeEntityKind,
    keyof PedigreeState,
  ][]) {
    const collection =
      value[key] === undefined && (key === "gaps" || key === "decisions")
        ? []
        : value[key];
    const rows = array(collection).map((row) =>
      validatePedigreeEntity(kind, row, projectId),
    );
    if (new Set(rows.map((row) => row.id)).size !== rows.length)
      throw new Error("Duplicate pedigree identifiers.");
    (result[key] as PedigreeEntity[]) = rows;
  }
  if (result.briefs.length > 1)
    throw new Error("An investigation has one current research brief.");
  const allIds = Object.values(result).flatMap((rows) =>
    rows.map((row: PedigreeEntity) => row.id),
  );
  if (new Set(allIds).size !== allIds.length)
    throw new Error("Pedigree identifiers must be unique across record kinds.");
  if (
    new Set(result.appraisals.map((a) => `${a.sourceId}:${a.versionId}`))
      .size !== result.appraisals.length
  )
    throw new Error("Duplicate appraisal for a source version.");
  if (
    new Set(result.findings.map((f) => f.claimId)).size !==
    result.findings.length
  )
    throw new Error("Duplicate finding assessment.");
  return result;
}
