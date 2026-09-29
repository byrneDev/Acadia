import type {
  AISettings,
  Connection,
  OutputKind,
  Project,
  ResearchOutput,
  ProjectPlanContext,
} from "./types";
import type { ModelRequestAudit, RetrievalManifest, QuoteAssociation } from "./pedigree-analysis";
import type { ChallengeTarget } from "./pedigree-analysis";
import type { DeliveryPlan } from "./pmis";
import type { ResearchBrief, SourceAppraisal, SourceOrigin, FindingAssessment, ResearchAssumption, MethodWorksheet, ReviewIssue, PedigreeState, PedigreeEntityKind, PedigreeRevision, PedigreeSnapshot } from "./pedigree";
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
    | "method-assistance";
  label: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  message: string;
  sourceId?: string;
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
  pedigreeState(): Promise<PedigreeState>;
  saveResearchBrief(value: ResearchBrief): Promise<ResearchBrief>;
  saveSourceAppraisal(value: SourceAppraisal): Promise<SourceAppraisal>;
  saveOriginRelationship(value: SourceOrigin): Promise<SourceOrigin>;
  saveFindingAssessment(value: FindingAssessment): Promise<FindingAssessment>;
  saveAssumption(value: ResearchAssumption): Promise<ResearchAssumption>;
  saveMethod(value: MethodWorksheet): Promise<MethodWorksheet>;
  saveReviewIssue(value: ReviewIssue): Promise<ReviewIssue>;
  pedigreeRevisions(kind: PedigreeEntityKind, id: string): Promise<PedigreeRevision[]>;
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
