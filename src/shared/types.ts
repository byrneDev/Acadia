import type {
  ResearchAPI,
  BoardGroup,
  BoardView,
  ProjectPrivacy,
  Citation,
  ReportDocument,
  ReportRevision,
} from "./research";
import type {
  AIConnectionResult,
  DesktopCommand,
  DesktopPreferences,
  DesktopState,
  LocalModel,
} from "./desktop";
import type { DeliveryPlan } from "./pmis";
import type { BoardReference } from "./board";
export type CardKind =
  | "note"
  | "question"
  | "hypothesis"
  | "link"
  | "document"
  | "image"
  | "audio"
  | "video";
export type EvidenceStatus = "unreviewed" | "supported" | "disputed";
export type Relation =
  | "relates to"
  | "supports"
  | "contradicts"
  | "derived from"
  | "investigate"
  | "informs"
  | "identifies gap"
  | "addresses"
  | "depends on"
  | "produces";
export type OutputKind =
  | "hypothesis"
  | "research-plan"
  | "whitepaper"
  | "gap-analysis"
  | "needs-analysis"
  | "decision-brief"
  | "project-plan";
export interface ProjectPlanContext {
  analysisOutputId: string;
  analysisRevisionId?: string;
  gapClaimId?: string;
  gap: string;
  deliverableType: "software" | "curriculum" | "other";
  deliverable: string;
  acceptanceCriteria: string;
  analysisTitle?: string;
  analysisMarkdown?: string;
  analysisCitations?: Citation[];
}
export interface ResearchCard {
  id: string;
  kind: CardKind;
  title: string;
  content: string;
  x: number;
  y: number;
  tags: string[];
  status: EvidenceStatus;
  url?: string;
  assetId?: string;
  fileName?: string;
  mimeType?: string;
  extraction?: string;
  sourceId?: string;
  methodId?: string;
  boardReference?: BoardReference;
  createdAt: string;
  updatedAt: string;
}
export interface Connection {
  id: string;
  source: string;
  target: string;
  relation: Relation;
}
export interface ResearchOutput {
  id: string;
  kind: OutputKind;
  title: string;
  markdown: string;
  createdAt: string;
  provider: string;
  sourceIds: string[];
  boardUpdatedAt: string;
  citations?: Citation[];
  runId?: string;
  document?: ReportDocument;
  revisions?: ReportRevision[];
  releasedRevisionId?: string;
  pedigreeSnapshotId?: string;
  plan?: ProjectPlanContext;
  deliveryPlan?: DeliveryPlan;
}
export interface Project {
  schemaVersion: 1 | 2 | 3 | 4;
  id: string;
  title: string;
  question: string;
  privacy?: ProjectPrivacy;
  groups?: BoardGroup[];
  views?: BoardView[];
  releasedOutputId?: string;
  cards: ResearchCard[];
  connections: Connection[];
  outputs: ResearchOutput[];
  createdAt: string;
  updatedAt: string;
}
export interface AISettings {
  provider: "offline" | "ollama" | "compatible";
  endpoint: string;
  model: string;
  apiKey?: string;
}
export interface DisplayInfo {
  id: number;
  label: string;
  primary: boolean;
}
export interface ImportedAsset {
  assetId: string;
  fileName: string;
  mimeType: string;
  kind: CardKind;
  content: string;
  extraction: string;
}
export interface WorkspaceState {
  project: Project;
  settings: AISettings;
  projectPath?: string;
}
export interface AcadiaAPI extends ResearchAPI {
  getDesktopState?(): Promise<DesktopState>;
  saveDesktopPreferences?(
    patch: Partial<DesktopPreferences>,
  ): Promise<DesktopState>;
  onDesktopChanged?(callback: (state: DesktopState) => void): () => void;
  onCommand?(callback: (command: DesktopCommand) => void): () => void;
  listLocalModels?(endpoint: string): Promise<LocalModel[]>;
  testAIConnection?(settings: AISettings): Promise<AIConnectionResult>;
  load(): Promise<WorkspaceState>;
  save(project: Project): Promise<{ savedAt: string }>;
  newProject(): Promise<WorkspaceState>;
  openProject(): Promise<WorkspaceState | null>;
  exportProject(project: Project): Promise<string | null>;
  importFiles(): Promise<ImportedAsset[]>;
  importDropped(paths: string[]): Promise<ImportedAsset[]>;
  filePath(file: File): string;
  assetURL(assetId: string): string;
  openExternal(url: string): Promise<void>;
  openAsset(assetId: string): Promise<void>;
  getDisplays(): Promise<DisplayInfo[]>;
  openReleaser(displayId?: number): Promise<void>;
  fullscreen(): Promise<void>;
  saveSettings(settings: AISettings): Promise<AISettings>;
  generate(
    project: Project,
    kind: OutputKind,
    instructions: string,
    plan?: ProjectPlanContext,
  ): Promise<ResearchOutput>;
  exportOutput(
    output: ResearchOutput,
    format: "md" | "pdf" | "docx",
  ): Promise<string | null>;
  exportProjectPlan(output: ResearchOutput): Promise<string | null>;
  exportPowerBI(): Promise<string | null>;
  onProjectChanged(callback: (project: Project) => void): () => void;
  onBeforeClose(callback: () => Promise<void>): () => void;
}
declare global {
  interface Window {
    acadia?: AcadiaAPI;
  }
}
