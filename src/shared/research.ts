import type {
  AISettings,
  Connection,
  OutputKind,
  Project,
  ResearchOutput,
  ProjectPlanContext,
} from "./types";
import type {
  ModelRequestAudit,
  RetrievalManifest,
  QuoteAssociation,
} from "./pedigree-analysis";
import type { ChallengeTarget } from "./pedigree-analysis";
import type { DeliveryPlan } from "./pmis";
import type { BoardReference } from "./board";
import type {
  ItemInsight,
  ItemInsightTarget,
  ItemInsightReview,
  ItemInsightAcceptance,
} from "./item-insight";
import type {
  ResearchBrief,
  SourceAppraisal,
  SourceOrigin,
  FindingAssessment,
  ResearchAssumption,
  MethodWorksheet,
  ReviewIssue,
  PedigreeState,
  PedigreeEntityKind,
  PedigreeRevision,
  PedigreeSnapshot,
  ResearchGap,
  ResearchDecision,
} from "./pedigree";
export type Inclusion = "include" | "pin" | "exclude";
export type ExtractionStatus =
  | "queued"
  | "processing"
  | "ready"
  | "partial"
  | "needs-ocr"
  | "failed"
  | "cancelled";
export interface SourceRecord {
  id: string;
  projectId: string;
  cardId?: string;
  title: string;
  kind: "document" | "web" | "note" | "media";
  assetId?: string;
  url?: string;
  currentVersionId: string;
  inclusion: Inclusion;
  duplicateOf?: string;
  /** Historical text from an analytical board placement; never independent evidence. */
  derived?: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface SourceVersion {
  id: string;
  sourceId: string;
  hash: string;
  acquiredAt: string;
  title: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
  doi?: string;
  url?: string;
  status: ExtractionStatus;
  method: "native" | "ocr" | "manual" | "legacy";
  totalUnits: number;
  processedUnits: number;
  error?: string;
  assetId?: string;
  snapshot?: string;
}
export interface Passage {
  id: string;
  sourceId: string;
  versionId: string;
  text: string;
  locator: string;
  page?: number;
  paragraph?: number;
  method: "native" | "ocr" | "manual" | "legacy";
  inclusion: Inclusion;
}
export interface SourceDetail {
  source: SourceRecord;
  versions: SourceVersion[];
  passages: Passage[];
}
export interface SearchHit extends Passage {
  sourceTitle: string;
  score?: number;
}
export interface Citation {
  id: string;
  label: string;
  sourceId: string;
  versionId: string;
  passageId: string;
  sourceTitle: string;
  locator: string;
  quote: string;
  url?: string;
  acquiredAt: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
  doi?: string;
  verified: boolean;
  legacyCardId?: string;
}
export interface EvidenceLink {
  id: string;
  passageId: string;
  relation: "supports" | "contradicts" | "context";
  rationale: string;
  quote: string;
}
export interface ResearchClaim {
  id: string;
  projectId: string;
  title: string;
  question: string;
  status: "unreviewed" | "provisional" | "supported" | "disputed";
  alternatives: string;
  limitations: string;
  links: EvidenceLink[];
  cardId?: string;
  updatedAt: string;
  itemReview?: ItemInsightReview;
}
export interface ResearchTask {
  id: string;
  projectId: string;
  title: string;
  question: string;
  claimId?: string;
  assumptionId?: string;
  methodId?: string;
  status: "planned" | "doing" | "blocked" | "complete";
  dueDate?: string;
  criterion: string;
  sourceIds: string[];
  updatedAt: string;
}
export interface ResearchJob {
  id: string;
  projectId: string;
  kind:
    | "extract"
    | "ocr"
    | "capture"
    | "discovery"
    | "analysis"
    | "answer"
    | "revision"
    | "challenge"
    | "method-assistance"
    | "item-summary";
  label: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  sourceId?: string;
  itemTarget?: ItemInsightTarget;
  result?: unknown;
  createdAt: string;
  updatedAt: string;
}
export interface AnalysisRun {
  id: string;
  projectId: string;
  question: string;
  instructions: string;
  kind: string;
  createdAt: string;
  provider: string;
  model: string;
  templateVersion: string;
  citations: Citation[];
  exclusions: string[];
  sourceVersions: string[];
  response: string;
  status: "completed" | "failed" | "cancelled";
  passages?: Passage[];
  queries?: { support: string[]; counter: string[]; gaps: string[] };
  groundingWarnings?: string[];
  requests?: ModelRequestAudit[];
  retrieval?: RetrievalManifest;
  quotationAssociations?: QuoteAssociation[];
  pedigreeSnapshotId?: string;
  itemInsight?: ItemInsight;
  /** Routine UI payload only; request full historical inputs with getAnalysisRun. */
  summaryOnly?: boolean;
}
export interface PageRequest {
  offset?: number;
  limit?: number;
}
export interface ResearchPage<T> {
  items: T[];
  total: number;
  offset: number;
  limit: number;
}
/** Compact internal retrieval inventory; document bodies are loaded only for candidates. */
export type PassagePolicyEntry = Pick<
  Passage,
  "id" | "sourceId" | "versionId" | "method" | "inclusion"
> & { rowid: number; hasText: boolean };
export type DraftJSONValue =
  | null
  | string
  | number
  | boolean
  | DraftJSONValue[]
  | { [key: string]: DraftJSONValue };
export const RESEARCH_DRAFT_KINDS = [
  "brief",
  "appraisal",
  "finding",
  "assumption",
  "method",
  "gap",
  "decision",
  "claim",
  "task",
  "report",
  "delivery-plan",
  "item-review",
  "source-evidence",
  "inquiry-text",
  "origin",
  "review-issue",
] as const;
export type ResearchDraftKind = (typeof RESEARCH_DRAFT_KINDS)[number];
/** A private editing buffer. It is never evidence, a reviewed record or a release. */
export interface ResearchDraft {
  key: string;
  projectId: string;
  kind: ResearchDraftKind;
  targetId?: string;
  value: DraftJSONValue;
  revision: number;
  updatedAt: string;
}
export interface ResearchDraftInput {
  projectId: string;
  key: string;
  kind: ResearchDraftKind;
  targetId?: string;
  value: DraftJSONValue;
  /** Zero creates a draft; later writes must match the saved revision. */
  expectedRevision: number;
}
export interface ResearchAnswer {
  answer: string;
  citations: Citation[];
  runId: string;
  insufficient: boolean;
}
export interface ConnectionSuggestion {
  id: string;
  source: string;
  target: string;
  relation: Connection["relation"];
  rationale: string;
}
export interface DiscoveryPlan {
  id: string;
  projectId: string;
  question: string;
  queries: string[];
  purpose: string;
  destination: string;
  maxQueries: number;
  maxCaptures: number;
  createdAt: string;
}
export interface DiscoveryCandidate {
  id: string;
  projectId: string;
  planId: string;
  title: string;
  url: string;
  description: string;
  status: "pending" | "accepted" | "dismissed" | "failed";
  capturedAt?: string;
  error?: string;
}
export interface ResearchState {
  sources: SourceRecord[];
  versions: SourceVersion[];
  claims: ResearchClaim[];
  tasks: ResearchTask[];
  jobs: ResearchJob[];
  discoveries: DiscoveryCandidate[];
  runs: AnalysisRun[];
  runCount?: number;
  /** Minimal historical basis for accepted notes outside the paged run window. */
  itemReviewBases?: {
    runId: string;
    question: string;
    briefRevision?: number;
  }[];
}
export interface ProjectSummary {
  id: string;
  title: string;
  question: string;
  updatedAt: string;
  cardCount: number;
  sourceCount: number;
}
export interface BoardGroup {
  id: string;
  title: string;
  color: string;
  cardIds: string[];
}
export interface BoardView {
  id: string;
  title: string;
  x: number;
  y: number;
  zoom: number;
}
export interface ProjectPrivacy {
  mode: "local" | "cloud";
  provider?: AISettings["provider"];
  endpoint?: string;
  model?: string;
}
export interface ReportDocument {
  type: string;
  attrs?: Record<string, unknown>;
  text?: string;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  content?: ReportDocument[];
}
export interface ReportRevision {
  id: string;
  createdAt: string;
  document: ReportDocument;
  markdown: string;
  citations: Citation[];
  note: string;
  pedigreeSnapshotId?: string;
  review?: ReleaseReview;
  plan?: ProjectPlanContext;
  deliveryPlan?: DeliveryPlan;
}
export interface ReleaseReview {
  checkedAt: string;
  warnings: string[];
  acknowledged: boolean;
}
export interface SectionProposal {
  id: string;
  original: string;
  proposed: string;
  citations: Citation[];
  runId?: string;
}
export interface ResearchAPI {
  researchDrafts(projectId: string): Promise<ResearchDraft[]>;
  saveResearchDraft(input: ResearchDraftInput): Promise<ResearchDraft>;
  deleteResearchDraft(
    projectId: string,
    key: string,
    expectedRevision: number,
  ): Promise<void>;
  listSourcesPage(
    query?: string,
    page?: PageRequest,
  ): Promise<ResearchPage<SourceRecord>>;
  searchSourcesPage(
    query: string,
    page?: PageRequest,
  ): Promise<ResearchPage<SearchHit>>;
  getSourcePassagesPage(
    sourceId: string,
    versionId?: string,
    query?: string,
    page?: PageRequest,
  ): Promise<ResearchPage<Passage>>;
  listAnalysisRunsPage(page?: PageRequest): Promise<ResearchPage<AnalysisRun>>;
  getAnalysisRun(id: string): Promise<AnalysisRun>;
  saveGap(value: ResearchGap): Promise<ResearchGap>;
  saveDecision(value: ResearchDecision): Promise<ResearchDecision>;
  addBoardReference(
    reference: BoardReference,
  ): Promise<{ project: Project; cardId: string }>;
  acceptItemInsight(input: ItemInsightAcceptance): Promise<ResearchClaim>;
  summarizeItem(target: ItemInsightTarget): Promise<ResearchJob>;
  pedigreeState(): Promise<PedigreeState>;
  saveResearchBrief(value: ResearchBrief): Promise<ResearchBrief>;
  saveSourceAppraisal(value: SourceAppraisal): Promise<SourceAppraisal>;
  saveOriginRelationship(value: SourceOrigin): Promise<SourceOrigin>;
  saveFindingAssessment(value: FindingAssessment): Promise<FindingAssessment>;
  saveAssumption(value: ResearchAssumption): Promise<ResearchAssumption>;
  saveMethod(value: MethodWorksheet): Promise<MethodWorksheet>;
  saveReviewIssue(value: ReviewIssue): Promise<ReviewIssue>;
  pedigreeRevisions(
    kind: PedigreeEntityKind,
    id: string,
  ): Promise<PedigreeRevision[]>;
  createPedigreeSnapshot(): Promise<PedigreeSnapshot>;
  getPedigreeSnapshot(id: string): Promise<PedigreeSnapshot>;
  challengeAnalysis(target: ChallengeTarget): Promise<ResearchJob>;
  assistMethod(methodId: string): Promise<ResearchJob>;
  listProjects(): Promise<ProjectSummary[]>;
  switchProject(
    id: string,
  ): Promise<{ project: Project; settings: AISettings; projectPath?: string }>;
  researchState(): Promise<ResearchState>;
  getSource(id: string, versionId?: string): Promise<SourceDetail>;
  getPassage(id: string): Promise<Passage>;
  searchSources(query: string): Promise<SearchHit[]>;
  setSourcePolicy(id: string, inclusion: Inclusion): Promise<void>;
  setPassagePolicy(id: string, inclusion: Inclusion): Promise<void>;
  captureUrl(url: string): Promise<ResearchJob>;
  reprocessSource(id: string, ocr?: boolean): Promise<ResearchJob>;
  cancelJob(id: string): Promise<void>;
  saveClaim(claim: ResearchClaim): Promise<void>;
  deleteClaim(id: string): Promise<void>;
  saveTask(task: ResearchTask): Promise<void>;
  deleteTask(id: string): Promise<void>;
  ask(question: string): Promise<ResearchJob>;
  suggestConnections(): Promise<ResearchJob>;
  planDiscovery(question: string, queries?: string[]): Promise<DiscoveryPlan>;
  approveDiscovery(id: string): Promise<ResearchJob>;
  acceptDiscovery(id: string): Promise<ResearchJob>;
  dismissDiscovery(id: string): Promise<void>;
  saveSearchKey(key: string): Promise<void>;
  hasSearchKey(): Promise<boolean>;
  reviseSection(
    outputId: string,
    original: string,
    instructions: string,
  ): Promise<ResearchJob>;
  onResearchChanged(callback: () => void): () => void;
}
