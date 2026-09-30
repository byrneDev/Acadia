import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../shared/types";
import { validateProject, validateCitation } from "../shared/project";
import { reportDocument, reportToMarkdown } from "../shared/report";
import { validateDeliveryPlanReferences } from "../shared/pmis";
import { RESEARCH_DRAFT_KINDS } from "../shared/research";
import {
  validateBoardReference,
  boardReferenceKey,
  boardRecordSignature,
  isLinkedBoardCard,
  type BoardReference,
} from "../shared/board";
import {
  validateItemInsightTarget,
  type ItemInsight,
  type ItemInsightReview,
} from "../shared/item-insight";
import {
  associateQuotedText,
  type SnapshotAnalysisContext,
} from "../shared/pedigree-analysis";
import type {
  AnalysisRun,
  DiscoveryCandidate,
  DiscoveryPlan,
  Inclusion,
  Passage,
  ProjectSummary,
  ResearchClaim,
  ResearchJob,
  ResearchState,
  ResearchTask,
  SearchHit,
  SourceDetail,
  SourceRecord,
  SourceVersion,
  ResearchDraft,
  ResearchDraftInput,
  DraftJSONValue,
  PageRequest,
  ResearchPage,
  PassagePolicyEntry,
} from "../shared/research";
import {
  createBrief,
  emptyPedigreeState,
  PEDIGREE_COLLECTIONS,
  validatePedigreeEntity,
  validatePedigreeState,
  type ResearchBrief,
  type SourceAppraisal,
  type SourceOrigin,
  type FindingAssessment,
  type ResearchAssumption,
  type MethodWorksheet,
  type ReviewIssue,
  type PedigreeEntity,
  type PedigreeEntityKind,
  type PedigreeRevision,
  type PedigreeSnapshot,
  type PedigreeState,
  type ResearchGap,
  type ResearchDecision,
} from "../shared/pedigree";

const now = () => new Date().toISOString();
export const contentHash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const parse = <T>(row: unknown): T | undefined =>
  row ? (JSON.parse((row as { data: string }).data) as T) : undefined;
const VALID_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
function checkId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !VALID_ID.test(id))
    throw new Error("Invalid research identifier.");
}
function pageBounds(page: PageRequest = {}) {
  const { offset = 0, limit = 50 } = page;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 200
  )
    throw new Error(
      "Page offset must be non-negative and page size between 1 and 200.",
    );
  return { offset, limit };
}
function draftKey(key: unknown): asserts key is string {
  if (
    typeof key !== "string" ||
    !key.trim() ||
    key.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(key)
  )
    throw new Error("Invalid private draft key.");
}
function draftValue(value: unknown): DraftJSONValue {
  let nodes = 0;
  const visit = (v: unknown, depth: number): DraftJSONValue => {
    if (++nodes > 100_000 || depth > 32)
      throw new Error("Private draft is too complex.");
    if (v === null || typeof v === "boolean" || typeof v === "string") return v;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (Array.isArray(v)) return v.map((entry) => visit(entry, depth + 1));
    if (
      !v ||
      typeof v !== "object" ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(v))
    )
      throw new Error("Private draft must contain ordinary JSON data.");
    const next: Record<string, DraftJSONValue> = {};
    for (const [key, entry] of Object.entries(v)) {
      if (
        ["__proto__", "prototype", "constructor"].includes(key) ||
        /^(?:apikey|searchkey|accesstoken|refreshtoken|password|authorization|credential|credentials|secret|clientsecret)$/i.test(
          key.replace(/[_-]/g, ""),
        )
      )
        throw new Error(
          "Private drafts cannot contain credentials or unsafe object keys.",
        );
      next[key] = visit(entry, depth + 1);
    }
    return next;
  };
  const result = visit(value, 0);
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > 2 * 1024 * 1024)
    throw new Error("Private draft exceeds the 2 MB editing-buffer limit.");
  return result;
}
function validateDraft(value: unknown, projectId: string): ResearchDraft {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid private draft.");
  const d = value as ResearchDraft;
  draftKey(d.key);
  if (
    d.projectId !== projectId ||
    !RESEARCH_DRAFT_KINDS.includes(d.kind) ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 1 ||
    typeof d.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(d.updatedAt))
  )
    throw new Error("Invalid private draft owner, type or revision.");
  if (d.targetId !== undefined) checkId(d.targetId);
  return {
    key: d.key,
    projectId,
    kind: d.kind,
    ...(d.targetId ? { targetId: d.targetId } : {}),
    value: draftValue(d.value),
    revision: d.revision,
    updatedAt: d.updatedAt,
  };
}
function cleanData<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, val) =>
      /^(?:apikey|searchkey|token|accesstoken|refreshtoken|bearertoken|password|authorization|credential|credentials|secret|clientsecret|secretaccesskey)$/i.test(
        key.replace(/[_-]/g, ""),
      )
        ? undefined
        : val,
    ),
  ) as T;
}
function validatedItemReview(
  value: unknown,
  projectId: string,
  sources: Map<string, SourceRecord>,
  versions: Map<string, SourceVersion>,
  passages: Map<string, Passage>,
  run?: AnalysisRun,
  snapshot = false,
): ItemInsightReview {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid accepted reviewer notes.");
  const raw = value as Record<string, unknown>;
  checkId(raw.runId);
  checkId(raw.insightId);
  const target = validateItemInsightTarget(raw.target);
  const acceptedAt = raw.acceptedAt;
  if (
    typeof acceptedAt !== "string" ||
    !Number.isFinite(Date.parse(acceptedAt)) ||
    typeof raw.notes !== "string" ||
    !raw.notes.trim() ||
    raw.notes.length > 30_000 ||
    !Array.isArray(raw.citations) ||
    raw.citations.length > 1000
  )
    throw new Error("Invalid accepted reviewer notes or date.");
  const notes = raw.notes.trim();
  const sourceId =
      raw.sourceId === undefined ? undefined : String(raw.sourceId),
    versionId = raw.versionId === undefined ? undefined : String(raw.versionId);
  if (sourceId) checkId(sourceId);
  if (versionId) checkId(versionId);
  if (
    Boolean(sourceId) !== Boolean(versionId) ||
    (sourceId &&
      (!sources.has(sourceId) ||
        versions.get(versionId!)?.sourceId !== sourceId)) ||
    (target.kind === "source" && sourceId !== target.id) ||
    (target.versionId && versionId !== target.versionId)
  )
    throw new Error("Reviewed notes refer to an unavailable source version.");
  const insight = run?.itemInsight;
  if (
    !snapshot &&
    (!run ||
      run.projectId !== projectId ||
      run.status !== "completed" ||
      run.kind !== "item-summary" ||
      !insight ||
      raw.runId !== run.id ||
      raw.insightId !== insight.id ||
      stableJSON(target) !== stableJSON(insight.target) ||
      sourceId !== insight.sourceId ||
      versionId !== insight.versionId)
  )
    throw new Error(
      "Reviewed notes do not match their completed item summary.",
    );
  const citations = raw.citations.map((entry) => validateCitation(entry));
  const labels = new Set(citations.map((citation) => citation.label));
  if (
    labels.size !== citations.length ||
    new Set(citations.map((citation) => citation.id)).size !== citations.length
  )
    throw new Error("Reviewed notes contain duplicate citations.");
  for (const citation of citations) {
    const passage = passages.get(citation.passageId),
      version = versions.get(citation.versionId);
    const original = insight?.citations.find(
      (entry) => entry.id === citation.id,
    );
    if (
      !passage ||
      !version ||
      citation.sourceId !== sourceId ||
      citation.versionId !== versionId ||
      passage.sourceId !== citation.sourceId ||
      passage.versionId !== citation.versionId ||
      citation.locator !== passage.locator ||
      citation.sourceTitle !== version.title ||
      citation.acquiredAt !== version.acquiredAt ||
      !citation.quote.trim() ||
      !passage.text.includes(citation.quote) ||
      !/^[1-9]\d*$/.test(citation.label) ||
      (!snapshot &&
        (!original || stableJSON(original) !== stableJSON(citation)))
    )
      throw new Error("Reviewed notes contain an invalid historical citation.");
  }
  const usedLabels = new Set(
    [...notes.matchAll(/\[(?:S)?(\d+)\]/g)].map((match) => match[1]),
  );
  if (
    [...usedLabels].some((label) => !labels.has(label)) ||
    [...labels].some((label) => !usedLabels.has(label))
  )
    throw new Error("Reviewed notes and their cited passages do not match.");
  if (
    !snapshot &&
    insight!.citations.length &&
    !citations.length &&
    !/insufficient evidence/i.test(notes)
  )
    throw new Error("Retain a verified reference in the reviewed notes.");
  if (associateQuotedText(notes, citations).warnings.length)
    throw new Error("Reviewed quotation attribution is ambiguous.");
  return {
    runId: raw.runId,
    insightId: raw.insightId,
    target,
    acceptedAt,
    notes,
    citations,
    sourceId,
    versionId,
  };
}
function policy(value: unknown): asserts value is Inclusion {
  if (!["include", "pin", "exclude"].includes(value as string))
    throw new Error("Invalid inclusion policy.");
}
export interface ResearchArchive extends ResearchState {
  schemaVersion: 2 | 3 | 4 | 5;
  passages: Passage[];
  pedigree?: PedigreeState;
  pedigreeRevisions?: PedigreeRevision[];
  pedigreeSnapshots?: PedigreeSnapshot[];
  drafts?: ResearchDraft[];
}

type PedigreeEvidence = Pick<
  ResearchArchive,
  "sources" | "versions" | "passages" | "claims" | "tasks"
> & { reportIds?: string[] };
export function validatePedigreeReferences(
  state: PedigreeState,
  evidence: PedigreeEvidence,
): void {
  const sources = new Map(
    evidence.sources.map((source) => [source.id, source]),
  );
  const versions = new Map(
    evidence.versions.map((version) => [version.id, version]),
  );
  const passages = new Map(
    evidence.passages.map((passage) => [passage.id, passage]),
  );
  const claims = new Set(evidence.claims.map((claim) => claim.id));
  const assumptions = new Set(state.assumptions.map((item) => item.id));
  const tasks = new Set(evidence.tasks.map((task) => task.id));
  const methods = new Set(state.methods.map((method) => method.id));
  const references = (
    ids: string[],
    has: (id: string) => boolean,
    label: string,
  ) => {
    if (ids.some((id) => !has(id)))
      throw new Error(
        `Pedigree ${label} reference is missing or belongs to another investigation.`,
      );
  };
  const rowReferences = (row: {
    passageIds?: string[];
    claimIds?: string[];
    assumptionIds?: string[];
    taskIds?: string[];
  }) => {
    references(row.passageIds || [], (id) => passages.has(id), "passage");
    references(row.claimIds || [], (id) => claims.has(id), "claim");
    references(
      row.assumptionIds || [],
      (id) => assumptions.has(id),
      "assumption",
    );
    references(row.taskIds || [], (id) => tasks.has(id), "task");
  };
  for (const task of evidence.tasks) {
    if (task.assumptionId)
      references(
        [task.assumptionId],
        (id) => assumptions.has(id),
        "task assumption",
      );
    if (task.methodId)
      references([task.methodId], (id) => methods.has(id), "task method");
  }
  for (const appraisal of state.appraisals) {
    if (
      !sources.has(appraisal.sourceId) ||
      versions.get(appraisal.versionId)?.sourceId !== appraisal.sourceId
    )
      throw new Error(
        "Appraisal source version is missing or belongs to another investigation.",
      );
    if (
      appraisal.passageIds.some(
        (id) => passages.get(id)?.versionId !== appraisal.versionId,
      )
    )
      throw new Error(
        "Appraisal passage must belong to the assessed source version.",
      );
  }
  for (const origin of state.origins)
    references(
      [origin.sourceId, origin.relatedSourceId],
      (id) => sources.has(id),
      "origin source",
    );
  for (const finding of state.findings) {
    references([finding.claimId], (id) => claims.has(id), "finding claim");
    rowReferences(finding);
  }
  for (const assumption of state.assumptions) rowReferences(assumption);
  for (const gap of state.gaps ?? []) rowReferences(gap);
  for (const decision of state.decisions ?? []) {
    rowReferences(decision);
    if (evidence.reportIds)
      references(
        decision.outputIds,
        (id) => evidence.reportIds!.includes(id),
        "decision report",
      );
  }
  for (const method of state.methods)
    for (const row of method.rows) {
      rowReferences(row);
      if ("evaluations" in row)
        references(
          row.evaluations.map((evaluation) => evaluation.passageId),
          (id) => passages.has(id),
          "hypothesis evidence",
        );
    }
  for (const issue of state.issues) {
    rowReferences(issue);
    if (issue.claimId)
      references([issue.claimId], (id) => claims.has(id), "review claim");
    if (issue.methodId)
      references(
        [issue.methodId],
        (id) => state.methods.some((method) => method.id === id),
        "review method",
      );
    if (issue.reportId && evidence.reportIds)
      references(
        [issue.reportId],
        (id) => evidence.reportIds!.includes(id),
        "review report",
      );
    const target = issue.target;
    const exists =
      target.kind === "source"
        ? sources.has(target.id)
        : target.kind === "claim" || target.kind === "finding"
          ? claims.has(target.id)
          : target.kind === "report"
            ? !evidence.reportIds || evidence.reportIds.includes(target.id)
            : state[PEDIGREE_COLLECTIONS[target.kind]].some(
                (item) => item.id === target.id,
              );
    if (!exists)
      throw new Error(
        "Review target is missing or belongs to another investigation.",
      );
  }
}

function stableJSON(value: unknown): string {
  const sort = (item: unknown): unknown =>
    Array.isArray(item)
      ? item.map(sort)
      : item && typeof item === "object"
        ? Object.fromEntries(
            Object.entries(item)
              .filter(([, val]) => val !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, val]) => [key, sort(val)]),
          )
        : item;
  return JSON.stringify(sort(value));
}
export function snapshotHash(
  value: Omit<PedigreeSnapshot, "hash"> | PedigreeSnapshot,
): string {
  const { hash: _hash, ...data } = value as PedigreeSnapshot;
  return contentHash(stableJSON(data));
}

export function validatePedigreeSnapshot(
  input: unknown,
  projectId?: string,
): PedigreeSnapshot {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid pedigree snapshot.");
  const value = input as PedigreeSnapshot;
  checkId(value.id);
  checkId(value.projectId);
  if (
    value.schemaVersion !== 1 ||
    typeof value.createdAt !== "string" ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    value.hash !== snapshotHash(value)
  )
    throw new Error("Pedigree snapshot hash or version is invalid.");
  const state = validatePedigreeState(value.state, value.projectId);
  const evidence = validateResearchArchive(
    {
      schemaVersion: 2,
      sources: value.sources,
      versions: value.sourceVersions,
      passages: value.passages,
      claims: value.claims,
      tasks: value.tasks,
      jobs: [],
      runs: [],
      discoveries: [],
    },
    value.projectId,
    state,
  );
  validatePedigreeReferences(state, evidence);
  if (
    !Array.isArray(value.sourceIds) ||
    value.sourceIds.length !== evidence.sources.length ||
    new Set(value.sourceIds).size !== value.sourceIds.length ||
    value.sourceIds.some(
      (id) => !evidence.sources.some((source) => source.id === id),
    )
  )
    throw new Error("Snapshot source references are incomplete.");
  const owner = projectId ?? value.projectId;
  const mappedState = emptyPedigreeState();
  for (const key of Object.values(PEDIGREE_COLLECTIONS))
    (mappedState[key] as PedigreeEntity[]) = state[key].map((entity) => ({
      ...entity,
      projectId: owner,
    }));
  // Empty new collections are a runtime default, not a historical revision.
  for (const key of ["gaps", "decisions"] as const)
    if (!Object.hasOwn(value.state, key))
      delete (mappedState as Partial<PedigreeState>)[key];
  const normalized = {
    schemaVersion: 1 as const,
    id: value.id,
    projectId: owner,
    createdAt: value.createdAt,
    state: mappedState,
    claims: evidence.claims.map((claim) => ({ ...claim, projectId: owner })),
    tasks: evidence.tasks.map((task) => ({ ...task, projectId: owner })),
    passages: evidence.passages,
    sources: evidence.sources.map(({ assetId: _asset, ...source }) => ({
      ...source,
      projectId: owner,
    })),
    sourceVersions: evidence.versions.map(
      ({ assetId: _asset, snapshot: _snapshot, ...version }) => version,
    ),
    sourceIds: value.sourceIds,
  };
  // Ownership can be rebased for an explicit archive import; evidence and revision IDs remain exact.
  return { ...normalized, hash: snapshotHash(normalized) };
}

function validatedRunAudit(
  record: Record<string, unknown>,
  passages: Map<string, Passage>,
  sources: Map<string, SourceRecord>,
): Pick<AnalysisRun, "requests" | "retrieval" | "quotationAssociations"> {
  const obj = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid analysis audit record.");
    return value as Record<string, unknown>;
  };
  const list = (value: unknown, max = 100_000): unknown[] => {
    if (!Array.isArray(value) || value.length > max)
      throw new Error("Invalid analysis audit collection.");
    return value;
  };
  const str = (value: unknown, max = 4_000_000): string => {
    if (typeof value !== "string" || value.length > max)
      throw new Error("Invalid analysis audit text.");
    return value;
  };
  const number = (value: unknown): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 0)
      throw new Error("Invalid analysis audit count.");
    return value as number;
  };
  const ident = (value: unknown): string => {
    checkId(value);
    return value;
  };
  const choice = <T extends string>(
    value: unknown,
    choices: readonly T[],
  ): T => {
    if (!choices.includes(value as T))
      throw new Error("Invalid analysis audit value.");
    return value as T;
  };
  const result: Pick<
    AnalysisRun,
    "requests" | "retrieval" | "quotationAssociations"
  > = {};
  if (record.requests !== undefined)
    result.requests = list(record.requests, 1000).map((entry) => {
      const request = obj(entry),
        endpoint = str(request.endpoint, 2048),
        url = new URL(endpoint);
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error("Audit endpoint must not contain credentials.");
      const parameters = cleanData(obj(request.parameters));
      if (JSON.stringify(parameters).length > 1_000_000)
        throw new Error("Analysis request parameters are too large.");
      return {
        provider: str(request.provider, 200),
        endpoint,
        model: str(request.model, 1000),
        parameters,
        messages: list(request.messages, 1000).map((entry) => {
          const message = obj(entry);
          return {
            role: str(message.role, 100),
            content: str(message.content),
          };
        }),
      };
    });
  if (record.retrieval !== undefined) {
    const manifest = obj(record.retrieval),
      limits = obj(manifest.limits),
      perPool = obj(manifest.perPool);
    const pools = ["pins", "support", "counter", "gaps"] as const;
    result.retrieval = {
      policy: choice(manifest.policy, ["balanced-four-pools-v1"]),
      ...(manifest.candidatePolicy === undefined
        ? {}
        : {
            candidatePolicy: choice(manifest.candidatePolicy, [
              "pin-independent-v1",
            ] as const),
          }),
      limits: {
        characters: number(limits.characters),
        passages: number(limits.passages),
      },
      perPool: {
        characters: number(perPool.characters),
        passages: number(perPool.passages),
      },
      usedCharacters: number(manifest.usedCharacters),
      selections: list(manifest.selections).map((entry) => {
        const row = obj(entry),
          passageId = ident(row.passageId);
        if (!passages.has(passageId) || typeof row.redistributed !== "boolean")
          throw new Error("Invalid selected evidence reference.");
        return {
          passageId,
          pool: choice(row.pool, pools),
          matchedPools: list(row.matchedPools, 4).map((pool) =>
            choice(pool, pools),
          ),
          reason: str(row.reason, 10000),
          characters: number(row.characters),
          redistributed: row.redistributed,
        };
      }),
      omissions: list(manifest.omissions).map((entry) => {
        const row = obj(entry),
          passageId = ident(row.passageId);
        if (!passages.has(passageId))
          throw new Error("Invalid omitted evidence reference.");
        return {
          passageId,
          reason: choice(row.reason, [
            "duplicate-file",
            "context-budget",
            "not-retrieved",
            "source-excluded",
            "passage-excluded",
            "incomplete-extraction",
            "superseded-version",
          ]),
          detail: str(row.detail, 10000),
        };
      }),
      ...(manifest.independentSourceGroups !== undefined
        ? {
            independentSourceGroups: list(manifest.independentSourceGroups).map(
              (group) =>
                list(group).map((value) => {
                  const id = ident(value);
                  if (!sources.has(id))
                    throw new Error("Invalid source independence group.");
                  return id;
                }),
            ),
          }
        : {}),
    };
  }
  if (record.quotationAssociations !== undefined)
    result.quotationAssociations = list(record.quotationAssociations).map(
      (entry) => {
        const row = obj(entry),
          start = number(row.start),
          end = number(row.end);
        if (end < start) throw new Error("Invalid quotation location.");
        return {
          quote: str(row.quote),
          start,
          end,
          labels: list(row.labels, 10000).map((label) => str(label, 100)),
          matchingLabels: list(row.matchingLabels, 10000).map((label) =>
            str(label, 100),
          ),
          status: choice(row.status, ["verified", "ambiguous"]),
        };
      },
    );
  return result;
}

/** Entity rows and FTS are separate from the lightweight board project. Original assets live on disk. */
export class ResearchStore {
  private db: DatabaseSync;
  private databasePath: string;
  private depth = 0;
  readonly migrationBackupPath?: string;
  constructor(storageRoot: string) {
    mkdirSync(storageRoot, { recursive: true });
    const databasePath = join(storageRoot, "research.sqlite");
    this.databasePath = databasePath;
    const existed = existsSync(databasePath);
    this.db = new DatabaseSync(databasePath);
    const version = Number(
      (this.db.prepare("PRAGMA user_version").get() as { user_version: number })
        .user_version,
    );
    if (version > 5) {
      this.db.close();
      throw new Error(
        "This research database was created by a newer Acadia version. Open it with that version; no data was changed.",
      );
    }
    try {
      if (existed && version < 5) {
        const recovery = join(storageRoot, "recovery");
        mkdirSync(recovery, { recursive: true });
        this.migrationBackupPath = join(
          recovery,
          `schema-v${version || 2}-to-v5-${Date.now()}-${randomUUID()}.sqlite`,
        );
        // VACUUM INTO takes a consistent SQLite snapshot, including committed WAL content.
        this.db.prepare("VACUUM INTO ?").run(this.migrationBackupPath);
        const backup = new DatabaseSync(this.migrationBackupPath, {
          readOnly: true,
        });
        try {
          const check = backup.prepare("PRAGMA integrity_check").get() as {
            integrity_check: string;
          };
          if (check.integrity_check !== "ok")
            throw new Error(
              "SQLite migration backup did not pass its integrity check.",
            );
        } finally {
          backup.close();
        }
      }
      this.db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
      );
      this.transaction(() => {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,card_id TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS source_project ON sources(project_id);
      CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,hash TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS version_source ON versions(source_id);
      CREATE TABLE IF NOT EXISTS passages(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,version_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS passage_version ON passages(version_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts USING fts5(id UNINDEXED,text,tokenize='unicode61');
      CREATE TABLE IF NOT EXISTS claims(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS discoveries(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS discovery_plans(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS pedigree_entities(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS pedigree_project ON pedigree_entities(project_id,kind);
      CREATE TABLE IF NOT EXISTS pedigree_revisions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,entity_id TEXT NOT NULL,kind TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(entity_id,revision));
      CREATE INDEX IF NOT EXISTS pedigree_revision_project ON pedigree_revisions(project_id);
      CREATE TABLE IF NOT EXISTS pedigree_snapshots(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS private_drafts(project_id TEXT NOT NULL, draft_key TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id,draft_key));
      CREATE INDEX IF NOT EXISTS runs_project ON runs(project_id);
      CREATE INDEX IF NOT EXISTS jobs_project ON jobs(project_id);
      PRAGMA user_version=5;`);
        // Seed scope only from the recorded question; never infer that the researcher reviewed it.
        for (const row of this.db.prepare("SELECT data FROM projects").all()) {
          const project = parse<Project>(row)!;
          this.markDerivedCardSources(project);
          if (project.schemaVersion !== 5) {
            project.schemaVersion = 5;
            this.db
              .prepare("UPDATE projects SET data=? WHERE id=?")
              .run(JSON.stringify(project), project.id);
          }
          if (!this.listPedigree<ResearchBrief>(project.id, "brief").length)
            this.saveBrief(createBrief(project.id, project.question));
        }
      });
    } catch (error) {
      this.db.close();
      throw new Error(
        `Acadia could not migrate the research database. The previous database was preserved.${this.migrationBackupPath ? ` Recovery backup: ${this.migrationBackupPath}.` : ""} ${error instanceof Error ? error.message : "Migration failed."}`,
      );
    }
    // Jobs cannot silently resume network or model work after a crash.
    for (const row of this.db.prepare("SELECT data FROM jobs").all()) {
      const job = parse<ResearchJob>(row)!;
      if (job.status === "running" || job.status === "queued")
        this.saveJob({
          ...job,
          status: "failed",
          message:
            "Interrupted when Acadia closed. Retry explicitly to continue.",
          updatedAt: now(),
        });
    }
    for (const row of this.db.prepare("SELECT data FROM versions").all()) {
      const version = parse<SourceVersion>(row)!;
      if (version.status === "processing" || version.status === "queued")
        this.updateVersionStatus(version.id, {
          status: "failed",
          error: "Extraction interrupted. Reprocess the source to retry.",
        });
    }
  }
  close() {
    this.db.close();
  }
  transaction<T>(action: () => T): T {
    const outer = this.depth === 0;
    if (outer) this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const result = action();
      if (outer) this.db.exec("COMMIT");
      return result;
    } catch (error) {
      if (outer) {
        // A failed COMMIT may leave the transaction active. Preserve the
        // original error even if SQLite has already rolled it back itself.
        try {
          this.db.exec("ROLLBACK");
        } catch {}
      }
      throw error;
    } finally {
      this.depth--;
    }
  }
  get activeProjectId(): string | undefined {
    return (
      this.db
        .prepare("SELECT value FROM meta WHERE key='activeProjectId'")
        .get() as { value: string } | undefined
    )?.value;
  }
  set activeProjectId(value: string | undefined) {
    if (value) {
      checkId(value);
      this.db
        .prepare("INSERT OR REPLACE INTO meta VALUES('activeProjectId',?)")
        .run(value);
    } else
      this.db.prepare("DELETE FROM meta WHERE key='activeProjectId'").run();
  }
  saveProject(project: Project): void {
    const clean = validateProject(project);
    clean.schemaVersion = 5;
    this.transaction(() => {
      this.syncCards(clean);
      for (const card of clean.cards) {
        if (card.boardReference)
          this.resolveBoardReference(clean, card.boardReference, false);
        if (card.methodId) {
          const method = this.db
            .prepare("SELECT project_id,kind FROM pedigree_entities WHERE id=?")
            .get(card.methodId) as
            { project_id: string; kind: string } | undefined;
          if (
            method &&
            (method.project_id !== clean.id || method.kind !== "method")
          )
            throw new Error(
              "Board method reference is outside this investigation.",
            );
        }
      }
      const research = this.state(clean.id);
      const pedigree = this.pedigreeState(clean.id),
        passages = this.allPassages(clean.id);
      validatePedigreeReferences(pedigree, {
        ...research,
        passages,
        reportIds: clean.outputs.map((output) => output.id),
      });
      const deliveryContext = {
        projectId: clean.id,
        pedigree,
        passages,
        revisions: this.db
          .prepare("SELECT data FROM pedigree_revisions WHERE project_id=?")
          .all(clean.id)
          .map((row) => parse<PedigreeRevision>(row)!),
      };
      for (const output of clean.outputs)
        for (const record of [output, ...(output.revisions ?? [])]) {
          if (record.deliveryPlan)
            validateDeliveryPlanReferences(
              record.deliveryPlan,
              deliveryContext,
            );
          if (record.plan?.gapRefs?.length || record.plan?.findingRefs?.length)
            validateDeliveryPlanReferences(
              { ...record.plan, tasks: [] },
              deliveryContext,
            );
        }
      for (const output of clean.outputs)
        for (const snapshotId of [
          output.pedigreeSnapshotId,
          ...(output.revisions || []).map(
            (revision) => revision.pedigreeSnapshotId,
          ),
        ])
          if (
            snapshotId &&
            this.getPedigreeSnapshot(snapshotId).projectId !== clean.id
          )
            throw new Error(
              "Report pedigree snapshot is outside this investigation.",
            );
      for (const output of clean.outputs)
        for (const citation of [
          ...(output.citations ?? []),
          ...(output.revisions ?? []).flatMap((r) => r.citations),
        ]) {
          if (citation.legacyCardId) continue;
          const passage = this.getPassage(citation.passageId);
          const source = this.getSourceRecord(passage.sourceId);
          if (
            source.projectId !== clean.id ||
            passage.versionId !== citation.versionId ||
            passage.sourceId !== citation.sourceId ||
            !passage.text.includes(citation.quote)
          )
            throw new Error(
              "Report citation does not match its saved source passage.",
            );
        }
      this.db
        .prepare("INSERT OR REPLACE INTO projects VALUES(?,?)")
        .run(clean.id, JSON.stringify(cleanData(clean)));
      if (!this.listPedigree<ResearchBrief>(clean.id, "brief").length)
        this.saveBrief(createBrief(clean.id, clean.question));
    });
    // Assign generated references back to the caller, without changing annotations.
    project.schemaVersion = 5;
    project.cards = clean.cards;
  }
  getProject(id: string): Project | undefined {
    checkId(id);
    return parse<Project>(
      this.db.prepare("SELECT data FROM projects WHERE id=?").get(id),
    );
  }
  resolveBoardReference(
    project: Project,
    input: BoardReference,
    requireAvailable = true,
  ): {
    title: string;
    content: string;
    sourceId?: string;
    versionId?: string;
    passageId?: string;
    methodId?: string;
    recordSignature?: string;
    available: boolean;
  } {
    const reference = validateBoardReference(input);
    const missing = () => {
      if (requireAvailable)
        throw new Error(
          "This research record is unavailable. Its board placement can be retained for context.",
        );
      return {
        title: "Unavailable research record",
        content: "",
        available: false,
      };
    };
    const owner = (projectId: string) => {
      if (projectId !== project.id)
        throw new Error("Board reference belongs to another investigation.");
    };
    if (reference.kind === "source" || reference.kind === "passage") {
      const passage =
        reference.kind === "passage"
          ? parse<Passage>(
              this.db
                .prepare("SELECT data FROM passages WHERE id=?")
                .get(reference.id),
            )
          : undefined;
      const sourceId =
        reference.kind === "source" ? reference.id : passage?.sourceId;
      const source = sourceId
        ? parse<SourceRecord>(
            this.db
              .prepare("SELECT data FROM sources WHERE id=?")
              .get(sourceId),
          )
        : undefined;
      const versionId = reference.versionId ?? source?.currentVersionId;
      const version = versionId
        ? parse<SourceVersion>(
            this.db
              .prepare("SELECT data FROM versions WHERE id=?")
              .get(versionId),
          )
        : undefined;
      if (source) owner(source.projectId);
      if (version) {
        const versionSource = parse<SourceRecord>(
          this.db
            .prepare("SELECT data FROM sources WHERE id=?")
            .get(version.sourceId),
        );
        if (versionSource) owner(versionSource.projectId);
        if (source && version.sourceId !== source.id)
          throw new Error(
            "Board reference points to a different source version.",
          );
      }
      if (passage && passage.versionId !== reference.versionId)
        throw new Error(
          "A passage placement must retain its exact historical version.",
        );
      if (!source || !version || (reference.kind === "passage" && !passage))
        return missing();
      return {
        title:
          reference.kind === "passage"
            ? `${version.title} — ${passage!.locator}`
            : source.title,
        content: passage?.text ?? "",
        sourceId: source.id,
        versionId: version.id,
        passageId: passage?.id,
        recordSignature: boardRecordSignature(
          reference.kind === "passage" ? passage : source,
        ),
        available: true,
      };
    }
    if (
      reference.kind === "claim" ||
      reference.kind === "review" ||
      reference.kind === "task"
    ) {
      const table = reference.kind === "task" ? "tasks" : "claims";
      const record = parse<ResearchClaim | ResearchTask>(
        this.db
          .prepare(`SELECT data FROM ${table} WHERE id=?`)
          .get(reference.id),
      );
      if (!record) return missing();
      owner(record.projectId);
      if (reference.kind === "review" && !(record as ResearchClaim).itemReview)
        throw new Error("This evidence record has no accepted reviewer notes.");
      const claim = record as ResearchClaim;
      return {
        title: record.title,
        content:
          reference.kind === "task"
            ? [
                record.title,
                record.question,
                (record as ResearchTask).criterion,
                `Status: ${record.status}`,
              ].join("\n\n")
            : [
                record.title,
                claim.itemReview?.notes,
                record.question,
                claim.alternatives,
                claim.limitations,
              ]
                .filter(Boolean)
                .join("\n\n"),
        available: true,
        recordSignature: boardRecordSignature(record),
      };
    }
    if (reference.kind === "report" || reference.kind === "delivery-plan") {
      let output = project.outputs.find((entry) => entry.id === reference.id);
      if (!output) {
        for (const row of this.db
          .prepare("SELECT data FROM projects WHERE id<>?")
          .all(project.id)) {
          if (
            parse<Project>(row)?.outputs.some(
              (entry) => entry.id === reference.id,
            )
          )
            throw new Error(
              "Board reference belongs to another investigation.",
            );
        }
        return missing();
      }
      if (
        reference.kind === "delivery-plan" &&
        output.kind !== "project-plan" &&
        !output.deliveryPlan
      )
        throw new Error(
          "Choose a deliverable project plan to place on the board.",
        );
      return {
        title: output.title,
        content: [
          reportToMarkdown(reportDocument(output)),
          ...(reference.kind === "delivery-plan" && output.deliveryPlan
            ? ["Saved work packages:", JSON.stringify(output.deliveryPlan)]
            : []),
        ].join("\n\n"),
        available: true,
        recordSignature: boardRecordSignature(output),
      };
    }
    const row = this.db
      .prepare("SELECT project_id,kind,data FROM pedigree_entities WHERE id=?")
      .get(reference.id) as
      { project_id: string; kind: string; data: string } | undefined;
    if (!row) return missing();
    owner(row.project_id);
    if (row.kind !== reference.kind)
      throw new Error(
        "Board reference does not match the research record type.",
      );
    const record = JSON.parse(row.data) as Record<string, unknown>;
    return {
      title: String(
        record.title ?? record.statement ?? record.question ?? reference.kind,
      ),
      content:
        reference.kind === "method"
          ? String(record.objective ?? "")
          : Object.entries(record)
              .filter(
                ([key, value]) =>
                  typeof value === "string" &&
                  !["id", "projectId", "createdAt", "updatedAt"].includes(key),
              )
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n\n"),
      methodId: reference.kind === "method" ? reference.id : undefined,
      recordSignature: boardRecordSignature(record),
      available: true,
    };
  }
  addBoardReference(
    project: Project,
    input: BoardReference,
  ): { project: Project; cardId: string } {
    const reference = validateBoardReference(input),
      resolved = this.resolveBoardReference(project, reference);
    const existing = project.cards.find(
      (card) =>
        (card.boardReference &&
          boardReferenceKey(card.boardReference) ===
            boardReferenceKey(reference)) ||
        (reference.kind === "method" && card.methodId === reference.id) ||
        (reference.kind === "source" &&
          !card.boardReference &&
          !card.methodId &&
          card.sourceId === reference.id &&
          !reference.versionId),
    );
    if (existing) return { project, cardId: existing.id };
    const timestamp = now(),
      cardId = randomUUID();
    const next = structuredClone(project);
    const method =
      reference.kind === "method"
        ? this.pedigreeState(project.id).methods.find(
            (entry) => entry.id === reference.id,
          )
        : undefined;
    const position = project.cards.length;
    next.schemaVersion = 5;
    next.cards.push({
      id: cardId,
      kind: "note",
      title: resolved.title.slice(0, 1000),
      content: (method?.objective ?? resolved.content).slice(0, 6000),
      x: 80 + (position % 4) * 300,
      y: 80 + Math.floor(position / 4) * 240,
      tags: method ? ["method", method.kind] : [],
      status: "unreviewed",
      methodId: method?.id,
      boardReference: reference,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    next.updatedAt = timestamp;
    this.saveProject(next);
    return { project: next, cardId };
  }
  private markDerivedCardSources(project: Project): void {
    const analytical = new Set(
      project.cards
        .filter(
          (card) =>
            isLinkedBoardCard(card) &&
            !["source", "passage"].includes(card.boardReference?.kind ?? ""),
        )
        .map((card) => card.id),
    );
    for (const source of this.list<SourceRecord>("sources", project.id))
      if (
        source.cardId &&
        analytical.has(source.cardId) &&
        source.kind === "note" &&
        !source.assetId
      )
        this.saveSource({ ...source, derived: true, inclusion: "exclude" });
  }
  listProjects(): ProjectSummary[] {
    return this.db
      .prepare("SELECT data FROM projects")
      .all()
      .map((row) => parse<Project>(row)!)
      .map((p) => ({
        id: p.id,
        title: p.title,
        question: p.question,
        updatedAt: p.updatedAt,
        cardCount: p.cards.length,
        sourceCount: Number(
          (
            this.db
              .prepare(
                "SELECT count(*) AS n FROM sources WHERE project_id=? AND COALESCE(json_extract(data,'$.derived'),0)=0",
              )
              .get(p.id) as { n: number }
          ).n,
        ),
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  private list<T>(table: string, projectId: string): T[] {
    checkId(projectId);
    return this.db
      .prepare(`SELECT data FROM ${table} WHERE project_id=?`)
      .all(projectId)
      .map((row) => parse<T>(row)!);
  }
  private write(table: string, value: { id: string; projectId: string }) {
    checkId(value.id);
    checkId(value.projectId);
    const owner = this.db
      .prepare(`SELECT project_id FROM ${table} WHERE id=?`)
      .get(value.id) as { project_id: string } | undefined;
    if (owner && owner.project_id !== value.projectId)
      throw new Error("Research identifier belongs to another project.");
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${table}(id,project_id,data) VALUES(?,?,?)`,
      )
      .run(value.id, value.projectId, JSON.stringify(cleanData(value)));
  }
  private listPedigree<T extends PedigreeEntity>(
    projectId: string,
    kind: PedigreeEntityKind,
  ): T[] {
    checkId(projectId);
    return this.db
      .prepare(
        "SELECT data FROM pedigree_entities WHERE project_id=? AND kind=? ORDER BY rowid",
      )
      .all(projectId, kind)
      .map((row) => parse<T>(row)!);
  }
  pedigreeState(projectId: string): PedigreeState {
    return {
      briefs: this.listPedigree(projectId, "brief"),
      appraisals: this.listPedigree(projectId, "appraisal"),
      origins: this.listPedigree(projectId, "origin"),
      findings: this.listPedigree(projectId, "finding"),
      assumptions: this.listPedigree(projectId, "assumption"),
      methods: this.listPedigree(projectId, "method"),
      issues: this.listPedigree(projectId, "issue"),
      gaps: this.listPedigree(projectId, "gap"),
      decisions: this.listPedigree(projectId, "decision"),
    };
  }
  private allPassages(projectId: string): Passage[] {
    return this.db
      .prepare(
        "SELECT p.data FROM passages p JOIN sources s ON s.id=p.source_id WHERE s.project_id=? ORDER BY p.rowid",
      )
      .all(projectId)
      .map((row) => parse<Passage>(row)!);
  }
  private savePedigree<T extends PedigreeEntity>(
    kind: PedigreeEntityKind,
    input: T,
  ): T {
    const value = validatePedigreeEntity(kind, input, input.projectId) as T;
    return this.transaction(() => {
      const project = this.getProject(value.projectId);
      if (!project) throw new Error("Investigation not found.");
      const old = this.db
        .prepare(
          "SELECT project_id,kind,data FROM pedigree_entities WHERE id=?",
        )
        .get(value.id) as
        { project_id: string; kind: string; data: string } | undefined;
      if (old && (old.project_id !== value.projectId || old.kind !== kind))
        throw new Error(
          "Pedigree identifier belongs to another record or investigation.",
        );
      const previous = old
        ? (JSON.parse(old.data) as PedigreeEntity)
        : undefined;
      if ((previous?.revision ?? 0) !== value.revision)
        throw new Error(
          "This assessment changed since it was opened. Reload the latest revision before saving.",
        );
      const timestamp = now();
      const saved = {
        ...value,
        revision: (previous?.revision ?? 0) + 1,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      } as T;
      const state = this.pedigreeState(value.projectId),
        key = PEDIGREE_COLLECTIONS[kind];
      (state[key] as PedigreeEntity[]) = [
        ...state[key].filter((entry) => entry.id !== saved.id),
        saved,
      ];
      validatePedigreeState(state, value.projectId);
      const research = this.state(value.projectId);
      validatePedigreeReferences(state, {
        ...research,
        passages: this.allPassages(value.projectId),
        reportIds: project.outputs.map((output) => output.id),
      });
      this.db
        .prepare(
          "INSERT INTO pedigree_entities(id,project_id,kind,data) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(saved.id, saved.projectId, kind, JSON.stringify(cleanData(saved)));
      const revision: PedigreeRevision = {
        id: randomUUID(),
        projectId: saved.projectId,
        entityId: saved.id,
        kind,
        revision: saved.revision,
        createdAt: timestamp,
        data: saved,
      };
      this.db
        .prepare("INSERT INTO pedigree_revisions VALUES(?,?,?,?,?,?)")
        .run(
          revision.id,
          revision.projectId,
          saved.id,
          kind,
          saved.revision,
          JSON.stringify(cleanData(revision)),
        );
      return saved;
    });
  }
  saveBrief(value: ResearchBrief) {
    return this.savePedigree("brief", value);
  }
  saveAppraisal(value: SourceAppraisal) {
    return this.savePedigree("appraisal", value);
  }
  saveOrigin(value: SourceOrigin) {
    return this.savePedigree("origin", value);
  }
  saveFinding(value: FindingAssessment) {
    return this.savePedigree("finding", value);
  }
  saveAssumption(value: ResearchAssumption) {
    return this.savePedigree("assumption", value);
  }
  saveMethod(value: MethodWorksheet) {
    return this.savePedigree("method", value);
  }
  saveGap(value: ResearchGap) {
    return this.savePedigree("gap", value);
  }
  saveDecision(value: ResearchDecision) {
    return this.savePedigree("decision", value);
  }
  saveReviewIssue(value: ReviewIssue) {
    return this.savePedigree("issue", value);
  }
  getPedigreeRevisions(
    kind: PedigreeEntityKind,
    entityId: string,
  ): PedigreeRevision[] {
    checkId(entityId);
    if (!(kind in PEDIGREE_COLLECTIONS))
      throw new Error("Unknown pedigree record kind.");
    return this.db
      .prepare(
        "SELECT data FROM pedigree_revisions WHERE entity_id=? AND kind=? ORDER BY revision",
      )
      .all(entityId, kind)
      .map((row) => parse<PedigreeRevision>(row)!);
  }
  createPedigreeSnapshot(
    projectId: string,
    options: { claimIds?: string[]; passageIds?: string[] } = {},
  ): PedigreeSnapshot {
    const project = this.getProject(projectId);
    if (!project) throw new Error("Investigation not found.");
    const research = this.state(projectId),
      state = this.pedigreeState(projectId),
      allPassages = this.allPassages(projectId);
    for (const id of options.claimIds || [])
      if (!research.claims.some((claim) => claim.id === id))
        throw new Error("Snapshot claim is outside this investigation.");
    for (const id of options.passageIds || [])
      if (!allPassages.some((passage) => passage.id === id))
        throw new Error("Snapshot passage is outside this investigation.");
    // Keep the full saved evidentiary context; optional IDs validate the analysis's selection.
    // This local snapshot is never implicitly sent to a provider.
    const data: Omit<PedigreeSnapshot, "hash"> = {
      schemaVersion: 1,
      id: randomUUID(),
      projectId,
      createdAt: now(),
      state,
      claims: research.claims,
      tasks: research.tasks,
      passages: allPassages,
      sources: research.sources.map(({ assetId: _asset, ...source }) => source),
      sourceVersions: research.versions.map(
        ({ assetId: _asset, snapshot: _snapshot, ...version }) => version,
      ),
      sourceIds: research.sources.map((source) => source.id),
    };
    // Hash the persisted representation after credential scrubbing, so a
    // sanitized snapshot cannot have a hash for a different unsanitized value.
    const persisted = cleanData(data);
    const snapshot = { ...persisted, hash: snapshotHash(persisted) };
    this.db
      .prepare("INSERT INTO pedigree_snapshots VALUES(?,?,?)")
      .run(snapshot.id, projectId, JSON.stringify(snapshot));
    return snapshot;
  }
  getPedigreeSnapshot(id: string): PedigreeSnapshot {
    checkId(id);
    const snapshot = parse<PedigreeSnapshot>(
      this.db.prepare("SELECT data FROM pedigree_snapshots WHERE id=?").get(id),
    );
    if (!snapshot) throw new Error("Pedigree snapshot not found.");
    return snapshot;
  }
  /** Build the same complete immutable snapshot off the Electron event loop.
   * A short SQLite read transaction freezes all rows together. Serialization and
   * hashing then run in the worker; only the small proposal-validation context
   * returns to the caller. Cancellation waits for worker termination before the
   * service may close or restore the database. */
  createPedigreeSnapshotAsync(
    projectId: string,
    options: { claimIds?: string[]; passageIds?: string[] } = {},
    signal?: AbortSignal,
  ): Promise<SnapshotAnalysisContext> {
    checkId(projectId);
    if (signal?.aborted)
      return Promise.reject(new Error("Research job cancelled."));
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        `
        const {parentPort,workerData}=require('node:worker_threads');
        const {DatabaseSync}=require('node:sqlite');
        const {createHash,randomUUID}=require('node:crypto');
        const cleanData=${cleanData.toString()};
        const stableJSON=${stableJSON.toString()};
        let db;
        try {
          db=new DatabaseSync(workerData.path);
          db.exec('PRAGMA busy_timeout=5000; BEGIN');
          const projectId=workerData.projectId;
          if(!db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))throw new Error('Investigation not found.');
          const list=table=>db.prepare('SELECT data FROM '+table+' WHERE project_id=? ORDER BY rowid').all(projectId).map(row=>JSON.parse(row.data));
          const sources=list('sources'),claims=list('claims'),tasks=list('tasks');
          const state=Object.fromEntries(Object.entries(workerData.collections).map(([kind,key])=>[key,db.prepare('SELECT data FROM pedigree_entities WHERE project_id=? AND kind=? ORDER BY rowid').all(projectId,kind).map(row=>JSON.parse(row.data))]));
          const passages=db.prepare('SELECT p.data FROM passages p JOIN sources s ON s.id=p.source_id WHERE s.project_id=? ORDER BY p.rowid').all(projectId).map(row=>JSON.parse(row.data));
          const versions=db.prepare('SELECT v.data FROM versions v JOIN sources s ON s.id=v.source_id WHERE s.project_id=? ORDER BY s.rowid,v.rowid').all(projectId).map(row=>JSON.parse(row.data));
          db.exec('COMMIT');
          const claimIds=new Set(claims.map(c=>c.id)),passageIds=new Set(passages.map(p=>p.id));
          for(const id of workerData.options.claimIds||[])if(!claimIds.has(id))throw new Error('Snapshot claim is outside this investigation.');
          for(const id of workerData.options.passageIds||[])if(!passageIds.has(id))throw new Error('Snapshot passage is outside this investigation.');
          const data=cleanData({schemaVersion:1,id:randomUUID(),projectId,createdAt:new Date().toISOString(),state,claims,tasks,passages,sources:sources.map(({assetId,...s})=>s),sourceVersions:versions.map(({assetId,snapshot,...v})=>v),sourceIds:sources.map(s=>s.id)});
          const snapshot={...data,hash:createHash('sha256').update(stableJSON(data)).digest('hex')};
          db.prepare('INSERT INTO pedigree_snapshots VALUES(?,?,?)').run(data.id,projectId,JSON.stringify(snapshot));
          parentPort.postMessage({context:{id:data.id,state:data.state,claims:data.claims,tasks:data.tasks}});
        } catch(error) { parentPort.postMessage({error:error.message}); }
        finally {if(db)db.close();}
      `,
        {
          eval: true,
          workerData: {
            path: this.databasePath,
            projectId,
            options,
            collections: PEDIGREE_COLLECTIONS,
          },
        },
      );
      let result: SnapshotAnalysisContext | undefined,
        failure: Error | undefined;
      const abort = () => {
        failure = new Error("Research job cancelled.");
        void worker.terminate();
      };
      signal?.addEventListener("abort", abort, { once: true });
      worker.on(
        "message",
        (message: { context?: SnapshotAnalysisContext; error?: string }) => {
          if (message.error) failure = new Error(message.error);
          else result = message.context;
        },
      );
      worker.once("error", (error) => {
        failure = error instanceof Error ? error : new Error(String(error));
      });
      worker.once("exit", (code) => {
        signal?.removeEventListener("abort", abort);
        if (failure) reject(failure);
        else if (code !== 0 || !result)
          reject(
            new Error(
              "The snapshot worker stopped before saving its complete result.",
            ),
          );
        else resolve(result);
      });
      if (signal?.aborted) abort();
    });
  }
  state(
    projectId: string,
    options: { lightweight?: boolean } = {},
  ): ResearchState {
    const sources = this.list<SourceRecord>("sources", projectId);
    const runPage = options.lightweight
      ? this.listAnalysisRunsPage(projectId, { limit: 100 })
      : undefined;
    return {
      sources,
      versions: sources
        .flatMap((s) => this.versions(s.id))
        .map((version) =>
          options.lightweight
            ? (({ snapshot: _snapshot, ...rest }) => rest)(version)
            : version,
        ),
      claims: this.list("claims", projectId),
      tasks: this.list("tasks", projectId),
      jobs: this.list("jobs", projectId),
      discoveries: this.list("discoveries", projectId),
      runs: runPage
        ? runPage.items.slice().reverse()
        : this.list("runs", projectId),
      ...(runPage
        ? {
            runCount: runPage.total,
            itemReviewBases: this.db
              .prepare(
                "SELECT DISTINCT r.id AS runId,json_extract(r.data,'$.itemInsight.question') AS question,json_extract(r.data,'$.itemInsight.briefRevision') AS briefRevision FROM claims c JOIN runs r ON r.id=json_extract(c.data,'$.itemReview.runId') WHERE c.project_id=? AND r.project_id=c.project_id AND json_type(r.data,'$.itemInsight')='object'",
              )
              .all(projectId)
              .map((row) => ({
                runId: String(row.runId),
                question: String(row.question),
                ...(row.briefRevision === null
                  ? {}
                  : { briefRevision: Number(row.briefRevision) }),
              })),
          }
        : {}),
    };
  }
  researchDrafts(projectId: string): ResearchDraft[] {
    checkId(projectId);
    return this.db
      .prepare(
        "SELECT data FROM private_drafts WHERE project_id=? ORDER BY draft_key",
      )
      .all(projectId)
      .map((row) => parse<ResearchDraft>(row)!);
  }
  saveResearchDraft(input: ResearchDraftInput): ResearchDraft {
    checkId(input.projectId);
    if (!this.getProject(input.projectId))
      throw new Error("Draft investigation is unavailable.");
    draftKey(input.key);
    if (
      !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 0
    )
      throw new Error("Invalid expected draft revision.");
    return this.transaction(() => {
      const old = parse<ResearchDraft>(
        this.db
          .prepare(
            "SELECT data FROM private_drafts WHERE project_id=? AND draft_key=?",
          )
          .get(input.projectId, input.key),
      );
      if ((old?.revision ?? 0) !== input.expectedRevision)
        throw new Error(
          "Private draft changed in another editor. Keep your writing and reload its saved revision before retrying.",
        );
      if (old && (old.kind !== input.kind || old.targetId !== input.targetId))
        throw new Error("Private draft identity cannot be reassigned.");
      const next = validateDraft(
        { ...input, revision: input.expectedRevision + 1, updatedAt: now() },
        input.projectId,
      );
      this.assertDraftTarget(next);
      this.db
        .prepare("INSERT OR REPLACE INTO private_drafts VALUES(?,?,?)")
        .run(next.projectId, next.key, JSON.stringify(next));
      return next;
    });
  }
  deleteResearchDraft(
    projectId: string,
    key: string,
    expectedRevision: number,
  ): void {
    checkId(projectId);
    draftKey(key);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new Error("Invalid expected draft revision.");
    const old = parse<ResearchDraft>(
      this.db
        .prepare(
          "SELECT data FROM private_drafts WHERE project_id=? AND draft_key=?",
        )
        .get(projectId, key),
    );
    if (!old) return;
    if (old.revision !== expectedRevision)
      throw new Error(
        "Private draft changed in another editor; its newer writing was preserved.",
      );
    this.db
      .prepare("DELETE FROM private_drafts WHERE project_id=? AND draft_key=?")
      .run(projectId, key);
  }
  private assertDraftTarget(draft: ResearchDraft): void {
    if (!draft.targetId) return;
    // Missing targets remain editable recovery buffers. Known foreign records
    // cannot be used to attach a draft to another investigation.
    for (const table of [
      "sources",
      "claims",
      "tasks",
      "runs",
      "pedigree_entities",
    ]) {
      const owner = this.db
        .prepare(`SELECT project_id FROM ${table} WHERE id=?`)
        .get(draft.targetId) as { project_id: string } | undefined;
      if (owner && owner.project_id !== draft.projectId)
        throw new Error(
          "Private draft target belongs to another investigation.",
        );
    }
    const passage = this.db
      .prepare(
        "SELECT s.project_id FROM passages p JOIN sources s ON s.id=p.source_id WHERE p.id=?",
      )
      .get(draft.targetId) as { project_id: string } | undefined;
    if (passage && passage.project_id !== draft.projectId)
      throw new Error(
        "Private draft passage belongs to another investigation.",
      );
    for (const row of this.db
      .prepare("SELECT id,data FROM projects WHERE id<>?")
      .all(draft.projectId))
      if (
        parse<Project>(row)!.outputs.some(
          (output) => output.id === draft.targetId,
        )
      )
        throw new Error(
          "Private draft report belongs to another investigation.",
        );
  }
  listSourcesPage(
    projectId: string,
    query = "",
    page: PageRequest = {},
  ): ResearchPage<SourceRecord> {
    checkId(projectId);
    if (typeof query !== "string" || query.length > 10000)
      throw new Error("Invalid source query.");
    const { offset, limit } = pageBounds(page),
      args = [projectId, `%${query.replace(/[\\%_]/g, "\\$&")}%`];
    const where =
      "project_id=? AND COALESCE(json_extract(data,'$.derived'),0)=0 AND json_extract(data,'$.title') LIKE ? ESCAPE '\\'";
    const total = Number(
      (
        this.db
          .prepare(`SELECT count(*) AS n FROM sources WHERE ${where}`)
          .get(...args) as { n: number }
      ).n,
    );
    return {
      items: this.db
        .prepare(
          `SELECT data FROM sources WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset)
        .map((row) => parse<SourceRecord>(row)!),
      total,
      offset,
      limit,
    };
  }
  getSourcePassagesPage(
    projectId: string,
    sourceId: string,
    versionId?: string,
    query = "",
    page: PageRequest = {},
  ): ResearchPage<Passage> {
    const source = this.getSourceRecord(sourceId);
    if (source.projectId !== projectId)
      throw new Error("Source belongs to another investigation.");
    const version = this.getVersion(versionId ?? source.currentVersionId);
    if (version.sourceId !== sourceId)
      throw new Error("Source version belongs to another source.");
    if (typeof query !== "string" || query.length > 10000)
      throw new Error("Invalid passage query.");
    const { offset, limit } = pageBounds(page),
      args = [version.id, `%${query.replace(/[\\%_]/g, "\\$&")}%`];
    const where =
      "version_id=? AND json_extract(data,'$.text') LIKE ? ESCAPE '\\'";
    const total = Number(
      (
        this.db
          .prepare(`SELECT count(*) AS n FROM passages WHERE ${where}`)
          .get(...args) as { n: number }
      ).n,
    );
    return {
      items: this.db
        .prepare(
          `SELECT data FROM passages WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`,
        )
        .all(...args, limit, offset)
        .map((row) => parse<Passage>(row)!),
      total,
      offset,
      limit,
    };
  }
  listAnalysisRunsPage(
    projectId: string,
    page: PageRequest = {},
  ): ResearchPage<AnalysisRun> {
    checkId(projectId);
    const { offset, limit } = pageBounds(page);
    const total = Number(
      (
        this.db
          .prepare("SELECT count(*) AS n FROM runs WHERE project_id=?")
          .get(projectId) as { n: number }
      ).n,
    );
    const items = this.db
      .prepare(
        "SELECT json_remove(data,'$.requests','$.passages','$.retrieval','$.response','$.instructions','$.queries','$.quotationAssociations') AS data FROM runs WHERE project_id=? ORDER BY rowid DESC LIMIT ? OFFSET ?",
      )
      .all(projectId, limit, offset)
      .map((row) => ({
        ...parse<AnalysisRun>(row)!,
        response: "",
        instructions: "",
        summaryOnly: true,
      }));
    return { items, total, offset, limit };
  }
  getAnalysisRun(projectId: string, id: string): AnalysisRun {
    checkId(projectId);
    checkId(id);
    const run = parse<AnalysisRun>(
      this.db
        .prepare("SELECT data FROM runs WHERE id=? AND project_id=?")
        .get(id, projectId),
    );
    if (!run)
      throw new Error("Analysis run is unavailable in this investigation.");
    return run;
  }
  saveSource(source: SourceRecord) {
    checkId(source.id);
    checkId(source.projectId);
    policy(source.inclusion);
    if (!["document", "web", "note", "media"].includes(source.kind))
      throw new Error("Invalid source kind.");
    const old = parse<SourceRecord>(
      this.db.prepare("SELECT data FROM sources WHERE id=?").get(source.id),
    );
    if (old && old.projectId !== source.projectId)
      throw new Error("Source belongs to another project.");
    if (old?.derived && (!source.derived || source.inclusion !== "exclude"))
      throw new Error(
        "Analytical board text is retained for history and cannot become an independent source.",
      );
    if (source.derived) source = { ...source, inclusion: "exclude" };
    this.db
      .prepare(
        "INSERT INTO sources VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,card_id=excluded.card_id,data=excluded.data",
      )
      .run(
        source.id,
        source.projectId,
        source.cardId ?? null,
        JSON.stringify(cleanData(source)),
      );
  }
  versions(sourceId: string): SourceVersion[] {
    return this.db
      .prepare("SELECT data FROM versions WHERE source_id=? ORDER BY rowid")
      .all(sourceId)
      .map((row) => parse<SourceVersion>(row)!);
  }
  getSourceRecord(id: string): SourceRecord {
    checkId(id);
    const source = parse<SourceRecord>(
      this.db.prepare("SELECT data FROM sources WHERE id=?").get(id),
    );
    if (!source) throw new Error("Source not found.");
    return source;
  }
  getSource(id: string, versionId?: string): SourceDetail {
    const source = this.getSourceRecord(id);
    const versions = this.versions(id);
    const requested = versionId ?? source.currentVersionId;
    if (!versions.some((v) => v.id === requested))
      throw new Error("Source version not found.");
    return {
      source,
      versions,
      passages: this.db
        .prepare("SELECT data FROM passages WHERE version_id=? ORDER BY rowid")
        .all(requested)
        .map((row) => parse<Passage>(row)!),
    };
  }
  getPassage(id: string): Passage {
    checkId(id);
    const passage = parse<Passage>(
      this.db.prepare("SELECT data FROM passages WHERE id=?").get(id),
    );
    if (!passage) throw new Error("Passage not found.");
    return passage;
  }
  getVersion(id: string): SourceVersion {
    const version = parse<SourceVersion>(
      this.db.prepare("SELECT data FROM versions WHERE id=?").get(id),
    );
    if (!version) throw new Error("Source version not found.");
    return version;
  }
  addVersion(version: SourceVersion, passages: Passage[] = []) {
    checkId(version.id);
    checkId(version.sourceId);
    this.transaction(() => {
      if (this.db.prepare("SELECT id FROM versions WHERE id=?").get(version.id))
        throw new Error("Source versions are immutable.");
      const source = parse<SourceRecord>(
        this.db
          .prepare("SELECT data FROM sources WHERE id=?")
          .get(version.sourceId),
      );
      if (!source) throw new Error("Source not found.");
      this.db
        .prepare("INSERT INTO versions VALUES(?,?,?,?)")
        .run(
          version.id,
          version.sourceId,
          version.hash,
          JSON.stringify(cleanData(version)),
        );
      for (const passage of passages) this.insertPassage(passage);
      const duplicate = this.db
        .prepare(
          `SELECT s.id FROM sources s JOIN versions v ON v.source_id=s.id AND v.id=json_extract(s.data,'$.currentVersionId') WHERE s.project_id=? AND s.id<>? AND v.hash=? AND s.rowid<(SELECT rowid FROM sources WHERE id=?) ORDER BY s.rowid LIMIT 1`,
        )
        .get(source.projectId, source.id, version.hash, source.id) as
        { id: string } | undefined;
      this.saveSource({
        ...source,
        currentVersionId: version.id,
        updatedAt: now(),
        duplicateOf: duplicate?.id,
      });
    });
  }
  addPassage(passage: Passage) {
    this.transaction(() => {
      if (this.getVersion(passage.versionId).status !== "processing")
        throw new Error("Completed source passages are immutable.");
      this.insertPassage(passage);
    });
  }
  private insertPassage(passage: Passage) {
    checkId(passage.id);
    policy(passage.inclusion);
    const version = this.getVersion(passage.versionId);
    if (version.sourceId !== passage.sourceId)
      throw new Error("Passage does not belong to its source version.");
    if (
      typeof passage.text !== "string" ||
      !passage.text.trim() ||
      passage.text.length > 4_000_000
    )
      throw new Error("Invalid passage text.");
    this.db
      .prepare("INSERT INTO passages VALUES(?,?,?,?)")
      .run(
        passage.id,
        passage.sourceId,
        passage.versionId,
        JSON.stringify(cleanData(passage)),
      );
    this.db
      .prepare("INSERT INTO passage_fts(id,text) VALUES(?,?)")
      .run(passage.id, passage.text);
  }
  updateVersionStatus(
    id: string,
    patch: Partial<
      Pick<SourceVersion, "status" | "processedUnits" | "totalUnits" | "error">
    >,
  ) {
    const version = this.getVersion(id);
    const updated = { ...version, ...patch };
    this.db
      .prepare("UPDATE versions SET data=? WHERE id=?")
      .run(JSON.stringify(updated), id);
  }
  updateVersionMetadata(
    id: string,
    patch: Partial<
      Pick<
        SourceVersion,
        "title" | "author" | "publisher" | "publishedAt" | "doi"
      >
    >,
  ) {
    const version = this.getVersion(id);
    if (version.status !== "processing")
      throw new Error("Completed source metadata is immutable.");
    const allowed = {
      title: patch.title ?? version.title,
      author: patch.author ?? version.author,
      publisher: patch.publisher ?? version.publisher,
      publishedAt: patch.publishedAt ?? version.publishedAt,
      doi: patch.doi ?? version.doi,
    };
    this.db
      .prepare("UPDATE versions SET data=? WHERE id=?")
      .run(JSON.stringify({ ...version, ...allowed }), id);
  }
  setSourcePolicy(id: string, inclusion: Inclusion) {
    policy(inclusion);
    this.saveSource({
      ...this.getSource(id).source,
      inclusion,
      updatedAt: now(),
    });
  }
  setPassagePolicy(id: string, inclusion: Inclusion) {
    policy(inclusion);
    const passage = this.getPassage(id);
    this.transaction(() => {
      this.db
        .prepare("UPDATE passages SET data=? WHERE id=?")
        .run(JSON.stringify({ ...passage, inclusion }), id);
      const source = this.getSource(passage.sourceId).source;
      // A policy change changes the usable evidence base even when document bytes
      // stay unchanged. Keep the report's frozen source timestamp for comparison.
      const updatedAt = new Date(
        Math.max(Date.now(), Date.parse(source.updatedAt) + 1),
      ).toISOString();
      this.saveSource({ ...source, updatedAt });
    });
  }
  listPassages(
    projectId: string,
    options: { includeExcluded?: boolean; versionId?: string } = {},
  ): Passage[] {
    const filters = [
      "s.project_id=?",
      "COALESCE(json_extract(s.data,'$.derived'),0)=0",
      options.versionId
        ? "p.version_id=?"
        : "p.version_id=json_extract(s.data,'$.currentVersionId')",
    ];
    if (!options.includeExcluded)
      filters.push(
        "json_extract(s.data,'$.inclusion')<>'exclude'",
        "json_extract(p.data,'$.inclusion')<>'exclude'",
      );
    return this.db
      .prepare(
        `SELECT p.data FROM passages p JOIN sources s ON s.id=p.source_id WHERE ${filters.join(" AND ")} ORDER BY p.rowid`,
      )
      .all(
        ...(options.versionId ? [projectId, options.versionId] : [projectId]),
      )
      .map((row) => parse<Passage>(row)!);
  }
  retrievalPassagePage(
    projectId: string,
    afterRowid = 0,
  ): PassagePolicyEntry[] {
    checkId(projectId);
    return this.db
      .prepare(
        "SELECT p.rowid,p.id,p.source_id AS sourceId,p.version_id AS versionId,json_extract(p.data,'$.method') AS method,json_extract(p.data,'$.inclusion') AS inclusion,length(trim(json_extract(p.data,'$.text'))) > 0 AS hasText FROM passages p JOIN sources s ON s.id=p.source_id WHERE s.project_id=? AND p.rowid>? AND COALESCE(json_extract(s.data,'$.derived'),0)=0 AND p.version_id=json_extract(s.data,'$.currentVersionId') ORDER BY p.rowid LIMIT 2000",
      )
      .all(projectId, afterRowid)
      .map(
        (row) =>
          ({ ...row, hasText: Boolean(row.hasText) }) as PassagePolicyEntry,
      );
  }
  pinnedPassages(projectId: string): Passage[] {
    checkId(projectId);
    return this.db
      .prepare(
        "SELECT p.data FROM passages p JOIN sources s ON s.id=p.source_id WHERE s.project_id=? AND COALESCE(json_extract(s.data,'$.derived'),0)=0 AND p.version_id=json_extract(s.data,'$.currentVersionId') AND (json_extract(s.data,'$.inclusion')='pin' OR json_extract(p.data,'$.inclusion')='pin') ORDER BY p.rowid",
      )
      .all(projectId)
      .map((row) => parse<Passage>(row)!);
  }
  search(projectId: string, query: string, limit = 50): SearchHit[] {
    const terms = [...new Set(query.match(/[\p{L}\p{N}_-]+/gu) ?? [])]
      .slice(0, 50)
      .filter((s) => s.length > 1);
    if (!terms.length)
      return this.listPassages(projectId)
        .slice(0, Math.min(500, limit))
        .map((p) => ({
          ...p,
          sourceTitle: this.getSourceRecord(p.sourceId).title,
          score: 0,
        }));
    const expression = terms
      .map((term) => '"' + term.replace(/"/g, '""') + '"')
      .join(" OR ");
    const rows = this.db
      .prepare(
        `SELECT p.data,s.data AS source,bm25(passage_fts) AS score FROM passage_fts JOIN passages p ON p.id=passage_fts.id JOIN sources s ON s.id=p.source_id WHERE passage_fts MATCH ? AND s.project_id=? AND COALESCE(json_extract(s.data,'$.derived'),0)=0 AND json_extract(s.data,'$.inclusion')<>'exclude' AND json_extract(p.data,'$.inclusion')<>'exclude' AND p.version_id=json_extract(s.data,'$.currentVersionId') ORDER BY CASE WHEN json_extract(s.data,'$.inclusion')='pin' OR json_extract(p.data,'$.inclusion')='pin' THEN 0 ELSE 1 END,score LIMIT ?`,
      )
      .all(expression, projectId, Math.max(1, Math.min(500, limit))) as {
      data: string;
      source: string;
      score: number;
    }[];
    return rows.map((row) => ({
      ...JSON.parse(row.data),
      sourceTitle: (JSON.parse(row.source) as SourceRecord).title,
      score: row.score,
    }));
  }
  /** Candidate lanes are independent of pins; pinned material has its own pool. */
  searchCandidatesBatchAsync(
    projectId: string,
    queries: string[],
    signal?: AbortSignal,
    includePinned = true,
  ): Promise<Passage[][]> {
    checkId(projectId);
    if (
      queries.length > 30 ||
      queries.some((q) => typeof q !== "string" || q.length > 10000)
    )
      throw new Error("Invalid retrieval queries.");
    if (signal?.aborted)
      return Promise.reject(new Error("Research job cancelled."));
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        `
        const {parentPort,workerData}=require('node:worker_threads');
        const {DatabaseSync}=require('node:sqlite');
        let db;
        try {
          db=new DatabaseSync(workerData.path,{readOnly:true});db.exec('PRAGMA busy_timeout=5000; BEGIN');
          const results=workerData.queries.map(query=>{
            const terms=[...new Set(query.match(/[\\p{L}\\p{N}_-]+/gu)||[])].slice(0,50).filter(term=>term.length>1);
            const expression=terms.map(term=>'"'+term.replace(/"/g,'""')+'"').join(' OR ');
            const from=expression?'passage_fts JOIN passages p ON p.id=passage_fts.id JOIN sources s ON s.id=p.source_id':'passages p JOIN sources s ON s.id=p.source_id';
            const where=(expression?'passage_fts MATCH ? AND ':'')+"s.project_id=? AND COALESCE(json_extract(s.data,'$.derived'),0)=0 AND json_extract(s.data,'$.inclusion')<>'exclude' AND json_extract(p.data,'$.inclusion')<>'exclude' AND p.version_id=json_extract(s.data,'$.currentVersionId')";
            const args=expression?[expression,workerData.projectId]:[workerData.projectId];
            const ranked=pin=>db.prepare('SELECT p.data FROM '+from+' WHERE '+where+' AND '+(pin?"(json_extract(s.data,'$.inclusion')='pin' OR json_extract(p.data,'$.inclusion')='pin')":"json_extract(s.data,'$.inclusion')<>'pin' AND json_extract(p.data,'$.inclusion')<>'pin'")+' ORDER BY '+(expression?'bm25(passage_fts),':'')+'p.rowid LIMIT 40').all(...args).map(row=>JSON.parse(row.data));
            const unpinned=ranked(false),pinned=workerData.includePinned?ranked(true):[];
            return Array.from({length:Math.max(unpinned.length,pinned.length)},(_,i)=>[unpinned[i],pinned[i]].filter(Boolean)).flat();
          });
          db.exec('COMMIT');parentPort.postMessage({results});
        }catch(error){parentPort.postMessage({error:error.message});}finally{if(db)db.close();}
      `,
        {
          eval: true,
          workerData: {
            path: this.databasePath,
            projectId,
            queries,
            includePinned,
          },
        },
      );
      let result: Passage[][] | undefined, failure: Error | undefined;
      const abort = () => {
        failure = new Error("Research job cancelled.");
        void worker.terminate();
      };
      signal?.addEventListener("abort", abort, { once: true });
      worker.on(
        "message",
        (value: { results?: Passage[][]; error?: string }) => {
          if (value.error) failure = new Error(value.error);
          else result = value.results;
        },
      );
      worker.once("error", (error) => {
        failure = error instanceof Error ? error : new Error(String(error));
      });
      worker.once("exit", (code) => {
        signal?.removeEventListener("abort", abort);
        if (failure) reject(failure);
        else if (code !== 0 || !result)
          reject(
            new Error("Evidence search worker stopped before completion."),
          );
        else resolve(result);
      });
      if (signal?.aborted) abort();
    });
  }
  searchCandidates(projectId: string, query: string, limit = 40): SearchHit[] {
    const unpinned = this.searchSourcesPage(
      projectId,
      query,
      { limit },
      true,
      false,
    ).items;
    const pinned = this.searchSourcesPage(
      projectId,
      query,
      { limit },
      "only",
      false,
    ).items;
    return Array.from(
      { length: Math.max(unpinned.length, pinned.length) },
      (_, index) =>
        [unpinned[index], pinned[index]].filter((entry): entry is SearchHit =>
          Boolean(entry),
        ),
    ).flat();
  }
  searchSourcesPage(
    projectId: string,
    query: string,
    page: PageRequest = {},
    excludePins: boolean | "only" = false,
    countResults = true,
  ): ResearchPage<SearchHit> {
    checkId(projectId);
    if (typeof query !== "string" || query.length > 10000)
      throw new Error("Invalid research query.");
    const { offset, limit } = pageBounds(page);
    const terms = [...new Set(query.match(/[\p{L}\p{N}_-]+/gu) ?? [])]
      .slice(0, 50)
      .filter((term) => term.length > 1);
    const expression = terms
      .map((term) => '"' + term.replace(/"/g, '""') + '"')
      .join(" OR ");
    const from = expression
      ? "passage_fts JOIN passages p ON p.id=passage_fts.id JOIN sources s ON s.id=p.source_id"
      : "passages p JOIN sources s ON s.id=p.source_id";
    const where = `${expression ? "passage_fts MATCH ? AND " : ""}s.project_id=? AND COALESCE(json_extract(s.data,'$.derived'),0)=0 AND json_extract(s.data,'$.inclusion')<>'exclude' AND json_extract(p.data,'$.inclusion')<>'exclude' AND p.version_id=json_extract(s.data,'$.currentVersionId')${excludePins === "only" ? " AND (json_extract(s.data,'$.inclusion')='pin' OR json_extract(p.data,'$.inclusion')='pin')" : excludePins ? " AND json_extract(s.data,'$.inclusion')<>'pin' AND json_extract(p.data,'$.inclusion')<>'pin'" : ""}`;
    const args = expression ? [expression, projectId] : [projectId];
    const total = countResults
      ? Number(
          (
            this.db
              .prepare(`SELECT count(*) AS n FROM ${from} WHERE ${where}`)
              .get(...args) as { n: number }
          ).n,
        )
      : 0;
    const rows = this.db
      .prepare(
        `SELECT p.data,s.data AS source,${expression ? "bm25(passage_fts)" : "0"} AS score FROM ${from} WHERE ${where} ORDER BY score,p.rowid LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset) as {
      data: string;
      source: string;
      score: number;
    }[];
    return {
      items: rows.map((row) => ({
        ...JSON.parse(row.data),
        sourceTitle: (JSON.parse(row.source) as SourceRecord).title,
        score: row.score,
      })),
      total,
      offset,
      limit,
    };
  }
  syncCards(project: Project) {
    this.markDerivedCardSources(project);
    for (const card of project.cards) {
      if (isLinkedBoardCard(card)) continue;
      let source = card.sourceId
        ? parse<SourceRecord>(
            this.db
              .prepare("SELECT data FROM sources WHERE id=?")
              .get(card.sourceId),
          )
        : undefined;
      if (card.sourceId && !source)
        throw new Error(
          "Card refers to a missing source. Reopen the complete portable project.",
        );
      if (source && source.projectId !== project.id)
        throw new Error("Card source belongs to another project.");
      if (!source)
        source = parse<SourceRecord>(
          this.db
            .prepare(
              "SELECT data FROM sources WHERE project_id=? AND card_id=?",
            )
            .get(project.id, card.id),
        );
      const isNew = !source;
      const linkedExisting = Boolean(
        source && card.sourceId && source.cardId !== card.id,
      );
      const changedAsset = Boolean(source && card.assetId !== source.assetId);
      source ??= {
        id: randomUUID(),
        projectId: project.id,
        cardId: card.id,
        title: card.title,
        kind: card.assetId
          ? card.kind === "document"
            ? "document"
            : "media"
          : card.kind === "link"
            ? "web"
            : "note",
        assetId: card.assetId,
        url: card.url,
        currentVersionId: "",
        inclusion: "include",
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      };
      this.saveSource({
        ...source,
        title: card.title,
        url: card.url,
        cardId: card.id,
        assetId: card.assetId ?? source.assetId,
      });
      card.sourceId = source.id;
      // Imported text used to be copied into cards. Keep only the annotation after migration.
      const isLegacy = Boolean(card.extraction);
      const text = isLegacy
        ? card.extraction!
        : !card.assetId
          ? card.content
          : "";
      const bad =
        /\[(?:This PDF has no extractable text|Text (?:could not be extracted|extraction (?:failed|skipped|unavailable))|No text|Only the first|[^\]]*OCR is not included)/i.test(
          text,
        ) ||
        /^\[(?:[^\]]*(?:failed|unavailable|not supported|no extractable|could not be extracted|extraction skipped)[^\]]*)\]$/i.test(
          text,
        );
      const hash = contentHash(
        text || `asset:${card.assetId ?? card.url ?? card.id}`,
      );
      const current = source.currentVersionId
        ? this.getVersion(source.currentVersionId)
        : undefined;
      // Annotation changes never replace a file or captured-web source version.
      if (
        isNew ||
        changedAsset ||
        (source.kind === "note" &&
          !linkedExisting &&
          ["note", "question", "hypothesis"].includes(card.kind) &&
          current?.hash !== hash)
      ) {
        const version: SourceVersion = {
          id: randomUUID(),
          sourceId: source.id,
          hash,
          acquiredAt: now(),
          title: card.title,
          url: card.url,
          assetId: card.assetId,
          status: bad
            ? "failed"
            : text.trim()
              ? isLegacy
                ? "partial"
                : "ready"
              : card.assetId
                ? "queued"
                : "ready",
          method: isLegacy ? "legacy" : "manual",
          totalUnits: text.trim() ? 1 : 0,
          processedUnits: bad ? 0 : text.trim() ? 1 : 0,
          error: bad
            ? "Legacy extraction is incomplete or unavailable. Reprocess the original source."
            : isLegacy
              ? "Legacy text has unverified coverage and card-level locations. Reprocess original for exact citations."
              : undefined,
        };
        const passages: Passage[] = [];
        if (!bad && text.trim())
          for (const [index, paragraph] of text
            .split(/\r?\n\s*\r?\n/)
            .entries())
            for (let offset = 0; offset < paragraph.length; offset += 4000) {
              const part = paragraph.slice(offset, offset + 4000).trim();
              if (part)
                passages.push({
                  id: randomUUID(),
                  sourceId: source.id,
                  versionId: version.id,
                  text: part,
                  locator:
                    (isLegacy
                      ? "Legacy card reference (coverage unverified)"
                      : `Note, paragraph ${index + 1}`) +
                    (paragraph.length > 4000
                      ? `, segment ${Math.floor(offset / 4000) + 1}`
                      : ""),
                  paragraph: index + 1,
                  method: version.method,
                  inclusion: "include",
                });
            }
        version.totalUnits = version.processedUnits = bad
          ? 0
          : Math.max(0, ...passages.map((p) => p.paragraph ?? 0));
        this.addVersion(version, passages);
      }
      if (card.extraction) {
        if (card.content === card.extraction) card.content = "";
        delete card.extraction;
      }
    }
  }
  saveClaim(value: ResearchClaim) {
    const existing = parse<ResearchClaim>(
      this.db.prepare("SELECT data FROM claims WHERE id=?").get(value.id),
    );
    if (value.itemReview || existing?.itemReview) {
      if (
        !existing?.itemReview ||
        !value.itemReview ||
        stableJSON(value.itemReview) !== stableJSON(existing.itemReview)
      )
        throw new Error(
          "Accepted reviewer notes are immutable. Use the explicit review and acceptance action for a new summary.",
        );
      if (value.cardId !== existing.cardId)
        throw new Error(
          "Accepted reviewer notes retain their original item association.",
        );
    }
    this.writeClaim(value);
  }
  private writeClaim(value: ResearchClaim) {
    if (
      value.itemReview &&
      this.db
        .prepare(
          "SELECT id FROM claims WHERE project_id=? AND id<>? AND json_extract(data,'$.itemReview.runId')=?",
        )
        .get(value.projectId, value.id, value.itemReview.runId)
    )
      throw new Error(
        "This item summary already has an accepted reviewer-note record.",
      );
    if (
      !["unreviewed", "provisional", "supported", "disputed"].includes(
        value.status,
      )
    )
      throw new Error("Invalid claim status.");
    if (!Array.isArray(value.links) || value.links.length > 10000)
      throw new Error("Invalid evidence links.");
    for (const link of value.links) {
      checkId(link.id);
      if (
        typeof link.quote !== "string" ||
        !link.quote.trim() ||
        typeof link.rationale !== "string" ||
        link.rationale.length > 20000
      )
        throw new Error("Invalid evidence quotation or rationale.");
      const passage = this.getPassage(link.passageId);
      if (this.getSourceRecord(passage.sourceId).projectId !== value.projectId)
        throw new Error("Claim evidence belongs to another project.");
      if (!passage.text.includes(link.quote))
        throw new Error("Evidence quotation is absent from its passage.");
      if (!["supports", "contradicts", "context"].includes(link.relation))
        throw new Error("Invalid evidence relation.");
    }
    this.write("claims", value);
  }
  saveItemReviewClaim(value: ResearchClaim): ResearchClaim {
    return this.transaction(() => {
      if (!value.itemReview)
        throw new Error("No reviewed item summary was supplied.");
      const research = this.exportResearch(value.projectId);
      const review = validatedItemReview(
        value.itemReview,
        value.projectId,
        new Map(research.sources.map((entry) => [entry.id, entry])),
        new Map(research.versions.map((entry) => [entry.id, entry])),
        new Map(research.passages.map((entry) => [entry.id, entry])),
        research.runs.find((entry) => entry.id === value.itemReview!.runId),
      );
      const existing = research.claims.find(
        (claim) => claim.itemReview?.runId === review.runId,
      );
      if (existing) {
        if (existing.itemReview!.notes !== review.notes)
          throw new Error("This summary already has accepted reviewer notes.");
        return existing;
      }
      if (
        value.status !== "provisional" ||
        value.links.length !== review.citations.length ||
        value.links.some(
          (link) =>
            link.relation !== "context" ||
            !review.citations.some(
              (citation) =>
                citation.passageId === link.passageId &&
                citation.quote === link.quote,
            ),
        )
      )
        throw new Error(
          "Acceptance records interpretation as provisional context, not verified support.",
        );
      const saved = { ...value, itemReview: review };
      this.writeClaim(saved);
      return saved;
    });
  }
  deleteClaim(id: string) {
    checkId(id);
    const claim = parse<ResearchClaim>(
      this.db.prepare("SELECT data FROM claims WHERE id=?").get(id),
    );
    if (!claim) return;
    if (claim.itemReview)
      throw new Error(
        "Accepted reviewer notes preserve the review history. Update the evidence assessment or record a new review instead of deleting this record.",
      );
    const state = this.pedigreeState(claim.projectId);
    if (
      state.findings.some((finding) => finding.claimId === id) ||
      state.gaps.some((gap) => gap.claimIds.includes(id)) ||
      state.decisions.some((decision) => decision.claimIds.includes(id)) ||
      state.assumptions.some((assumption) =>
        assumption.claimIds.includes(id),
      ) ||
      state.methods.some((method) =>
        method.rows.some((row) => row.claimIds.includes(id)),
      ) ||
      state.issues.some(
        (issue) =>
          issue.claimId === id ||
          issue.claimIds.includes(id) ||
          (["claim", "finding"].includes(issue.target.kind) &&
            issue.target.id === id),
      )
    )
      throw new Error(
        "This finding is referenced by an assessment or method. Keep its research history and revise the assessment instead of deleting it.",
      );
    if (
      this.list<ResearchTask>("tasks", claim.projectId).some(
        (task) => task.claimId === id,
      )
    )
      throw new Error(
        "This finding is linked to a research task. Reassign or remove that task's finding link before deleting the finding.",
      );
    this.db.prepare("DELETE FROM claims WHERE id=?").run(id);
  }
  saveTask(value: ResearchTask) {
    if (!["planned", "doing", "blocked", "complete"].includes(value.status))
      throw new Error("Invalid task status.");
    if (value.assumptionId !== undefined) checkId(value.assumptionId);
    if (value.methodId !== undefined) checkId(value.methodId);
    if (value.assumptionId || value.methodId) {
      const state = this.pedigreeState(value.projectId);
      if (
        value.assumptionId &&
        !state.assumptions.some((item) => item.id === value.assumptionId)
      )
        throw new Error(
          "Task assumption is missing or belongs to another investigation.",
        );
      if (
        value.methodId &&
        !state.methods.some((item) => item.id === value.methodId)
      )
        throw new Error(
          "Task method is missing or belongs to another investigation.",
        );
    }
    this.write("tasks", value);
  }
  deleteTask(id: string) {
    checkId(id);
    const task = parse<ResearchTask>(
      this.db.prepare("SELECT data FROM tasks WHERE id=?").get(id),
    );
    if (!task) return;
    const state = this.pedigreeState(task.projectId);
    if (
      state.methods.some((method) =>
        method.rows.some((row) => row.taskIds.includes(id)),
      ) ||
      state.gaps.some((gap) => gap.taskIds.includes(id)) ||
      state.issues.some((issue) => issue.taskIds.includes(id))
    )
      throw new Error(
        "This research task is referenced by a method or review issue. Keep its history and update its status instead of deleting it, or unlink it from the worksheet first.",
      );
    this.db.prepare("DELETE FROM tasks WHERE id=?").run(id);
  }
  saveJob(value: ResearchJob) {
    this.write("jobs", value);
  }
  getJob(id: string) {
    return parse<ResearchJob>(
      this.db.prepare("SELECT data FROM jobs WHERE id=?").get(id),
    );
  }
  saveRun(value: AnalysisRun) {
    this.write("runs", value);
  }
  saveDiscovery(value: DiscoveryCandidate) {
    this.write("discoveries", value);
  }
  getDiscovery(id: string) {
    return parse<DiscoveryCandidate>(
      this.db.prepare("SELECT data FROM discoveries WHERE id=?").get(id),
    );
  }
  saveDiscoveryPlan(value: DiscoveryPlan) {
    checkId(value.id);
    checkId(value.projectId);
    this.db
      .prepare("INSERT INTO discovery_plans(id,project_id,data) VALUES(?,?,?)")
      .run(value.id, value.projectId, JSON.stringify(cleanData(value)));
  }
  getDiscoveryPlan(id: string) {
    return parse<DiscoveryPlan>(
      this.db.prepare("SELECT data FROM discovery_plans WHERE id=?").get(id),
    );
  }
  claimDiscoveryPlan(projectId: string, id: string): boolean {
    return (
      Number(
        this.db
          .prepare(
            "UPDATE discovery_plans SET claimed=1 WHERE id=? AND project_id=? AND claimed=0",
          )
          .run(id, projectId).changes,
      ) === 1
    );
  }
  exportResearch(projectId: string): ResearchArchive {
    const state = this.state(projectId);
    const passages = this.db
      .prepare(
        "SELECT p.data FROM passages p JOIN sources s ON s.id=p.source_id WHERE s.project_id=?",
      )
      .all(projectId)
      .map((row) => parse<Passage>(row)!);
    return cleanData({
      ...state,
      schemaVersion: 5,
      drafts: this.researchDrafts(projectId),
      pedigree: this.pedigreeState(projectId),
      pedigreeRevisions: this.db
        .prepare(
          "SELECT data FROM pedigree_revisions WHERE project_id=? ORDER BY rowid",
        )
        .all(projectId)
        .map((row) => parse<PedigreeRevision>(row)!),
      pedigreeSnapshots: this.db
        .prepare(
          "SELECT data FROM pedigree_snapshots WHERE project_id=? ORDER BY rowid",
        )
        .all(projectId)
        .map((row) => parse<PedigreeSnapshot>(row)!),
      passages,
      jobs: [],
      // Portable snapshots cannot carry a live worker. Preserve completed text
      // while making the remaining coverage and explicit retry visible.
      versions: state.versions.map((version) =>
        ["queued", "processing"].includes(version.status)
          ? {
              ...version,
              status:
                version.processedUnits > 0
                  ? ("partial" as const)
                  : ("failed" as const),
              error:
                "Exported before extraction finished. Reprocess this source to complete coverage.",
            }
          : version,
      ),
      discoveries: state.discoveries,
    });
  }
  importResearch(
    projectId: string,
    value: unknown,
    options: { replace?: boolean; projectCards?: Project["cards"] } = {},
  ) {
    checkId(projectId);
    const data = validateResearchArchive(
      value,
      projectId,
      undefined,
      options.projectCards ??
        (options.replace ? undefined : this.getProject(projectId)?.cards),
    );
    this.transaction(() => {
      if (options.replace) {
        this.db
          .prepare(
            "DELETE FROM passage_fts WHERE id IN (SELECT p.id FROM passages p JOIN sources s ON s.id=p.source_id WHERE s.project_id=?)",
          )
          .run(projectId);
        this.db
          .prepare(
            "DELETE FROM passages WHERE source_id IN (SELECT id FROM sources WHERE project_id=?)",
          )
          .run(projectId);
        this.db
          .prepare(
            "DELETE FROM versions WHERE source_id IN (SELECT id FROM sources WHERE project_id=?)",
          )
          .run(projectId);
        for (const table of [
          "sources",
          "claims",
          "tasks",
          "jobs",
          "runs",
          "discoveries",
          "discovery_plans",
          "pedigree_entities",
          "pedigree_revisions",
          "pedigree_snapshots",
          "private_drafts",
        ])
          this.db
            .prepare(`DELETE FROM ${table} WHERE project_id=?`)
            .run(projectId);
      }
      // Import rejects identifier collisions rather than modifying another investigation.
      for (const source of data.sources) this.saveSource(source);
      for (const version of data.versions) {
        const existing = this.db
          .prepare("SELECT data FROM versions WHERE id=?")
          .get(version.id);
        if (existing) {
          if (JSON.stringify(parse(existing)) !== JSON.stringify(version))
            throw new Error("Conflicting immutable source version.");
        } else
          this.addVersion(
            version,
            data.passages.filter((p) => p.versionId === version.id),
          );
      }
      // Restore exported current pointers (historical versions are not necessarily ordered).
      for (const source of data.sources) this.saveSource(source);
      for (const run of data.runs) this.saveRun(run);
      // The archive validator has checked accepted-note provenance and uniqueness.
      for (const claim of data.claims) this.writeClaim(claim);
      for (const item of data.discoveries) this.saveDiscovery(item);
      if (data.pedigree) {
        for (const [kind, key] of Object.entries(PEDIGREE_COLLECTIONS) as [
          PedigreeEntityKind,
          keyof PedigreeState,
        ][]) {
          for (const entity of data.pedigree[key]) {
            const existing = this.db
              .prepare(
                "SELECT project_id,kind FROM pedigree_entities WHERE id=?",
              )
              .get(entity.id) as
              { project_id: string; kind: string } | undefined;
            if (
              existing &&
              (existing.project_id !== projectId || existing.kind !== kind)
            )
              throw new Error(
                "Imported pedigree identifier collides with another investigation.",
              );
            // A newly created destination's unassessed seed brief is superseded by the imported brief.
            if (kind === "brief")
              this.db
                .prepare(
                  "DELETE FROM pedigree_entities WHERE project_id=? AND kind='brief'",
                )
                .run(projectId);
            this.db
              .prepare(
                "INSERT OR REPLACE INTO pedigree_entities VALUES(?,?,?,?)",
              )
              .run(entity.id, projectId, kind, JSON.stringify(entity));
          }
        }
      }
      for (const revision of data.pedigreeRevisions || []) {
        const existing = parse<PedigreeRevision>(
          this.db
            .prepare(
              "SELECT data FROM pedigree_revisions WHERE id=? OR (entity_id=? AND revision=?)",
            )
            .get(revision.id, revision.entityId, revision.revision),
        );
        if (existing && stableJSON(existing) !== stableJSON(revision))
          throw new Error("Conflicting immutable pedigree revision.");
        if (!existing)
          this.db
            .prepare("INSERT INTO pedigree_revisions VALUES(?,?,?,?,?,?)")
            .run(
              revision.id,
              projectId,
              revision.entityId,
              revision.kind,
              revision.revision,
              JSON.stringify(revision),
            );
      }
      for (const snapshot of data.pedigreeSnapshots || []) {
        const existing = parse<PedigreeSnapshot>(
          this.db
            .prepare("SELECT data FROM pedigree_snapshots WHERE id=?")
            .get(snapshot.id),
        );
        if (existing && stableJSON(existing) !== stableJSON(snapshot))
          throw new Error("Conflicting immutable pedigree snapshot.");
        if (!existing)
          this.db
            .prepare("INSERT INTO pedigree_snapshots VALUES(?,?,?)")
            .run(snapshot.id, projectId, JSON.stringify(snapshot));
      }
      // The archive was validated as a whole before writing. Gap references can
      // now resolve against the imported assumptions and methods in this transaction.
      for (const task of data.tasks) this.saveTask(task);
      for (const draft of data.drafts ?? []) {
        this.assertDraftTarget(draft);
        const existing = parse<ResearchDraft>(
          this.db
            .prepare(
              "SELECT data FROM private_drafts WHERE project_id=? AND draft_key=?",
            )
            .get(projectId, draft.key),
        );
        if (existing && stableJSON(existing) !== stableJSON(draft))
          throw new Error(
            "Conflicting private draft; existing writing was preserved.",
          );
        this.db
          .prepare("INSERT OR REPLACE INTO private_drafts VALUES(?,?,?)")
          .run(projectId, draft.key, JSON.stringify(draft));
      }
      validatePedigreeState(this.pedigreeState(projectId), projectId);
    });
  }
}

/** Reject malformed archives before beginning any write. Unknown fields and secrets are discarded. */
export function validateResearchArchive(
  value: unknown,
  projectId: string,
  snapshotState?: PedigreeState,
  projectCards?: Project["cards"],
): ResearchArchive {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid research archive.");
  const raw = value as Record<string, unknown>;
  if (
    raw.schemaVersion !== 2 &&
    raw.schemaVersion !== 3 &&
    raw.schemaVersion !== 4 &&
    raw.schemaVersion !== 5
  )
    throw new Error("Unsupported research archive version.");
  const arr = (key: string, max = 100_000): Record<string, unknown>[] => {
    const v = raw[key];
    if (
      !Array.isArray(v) ||
      v.length > max ||
      v.some((x) => !x || typeof x !== "object" || Array.isArray(x))
    )
      throw new Error(`Invalid research archive ${key}.`);
    return v;
  };
  const text = (v: unknown, max = 4_000_000) => {
    if (typeof v !== "string" || v.length > max)
      throw new Error("Invalid research text.");
    return v;
  };
  const optional = (v: unknown) => (v === undefined ? undefined : text(v));
  const ident = (v: unknown) => {
    checkId(v);
    return v;
  };
  const choice = <T extends string>(v: unknown, values: T[]): T => {
    if (!values.includes(v as T)) throw new Error("Invalid research value.");
    return v as T;
  };
  const n = (v: unknown) => {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)
      throw new Error("Invalid extraction coverage.");
    return v;
  };
  const timestamp = (v: unknown) => {
    const s = text(v, 40);
    if (!Number.isFinite(Date.parse(s)))
      throw new Error("Invalid research timestamp.");
    return s;
  };
  const url = (v: unknown) => {
    const s = optional(v);
    if (s) {
      const u = new URL(s);
      if (!["https:", "http:"].includes(u.protocol) || u.username || u.password)
        throw new Error("Invalid source URL.");
    }
    return s;
  };
  const sources: SourceRecord[] = arr("sources").map((s) => ({
    id: ident(s.id),
    projectId,
    cardId: s.cardId === undefined ? undefined : ident(s.cardId),
    title: text(s.title),
    kind: choice(s.kind, ["document", "web", "note", "media"]),
    assetId: s.assetId === undefined ? undefined : ident(s.assetId),
    url: url(s.url),
    currentVersionId: ident(s.currentVersionId),
    inclusion: choice(s.inclusion, ["include", "pin", "exclude"]),
    duplicateOf: s.duplicateOf === undefined ? undefined : ident(s.duplicateOf),
    derived:
      s.derived === undefined
        ? undefined
        : (() => {
            if (typeof s.derived !== "boolean")
              throw new Error("Invalid derived source marker.");
            return s.derived;
          })(),
    createdAt: timestamp(s.createdAt),
    updatedAt: timestamp(s.updatedAt),
  }));
  const versions: SourceVersion[] = arr("versions").map((v) => ({
    id: ident(v.id),
    sourceId: ident(v.sourceId),
    hash: (() => {
      const hash = text(v.hash, 64);
      if (!/^[a-f0-9]{64}$/.test(hash))
        throw new Error("Invalid source content hash.");
      return hash;
    })(),
    acquiredAt: timestamp(v.acquiredAt),
    title: text(v.title),
    author: optional(v.author),
    publisher: optional(v.publisher),
    publishedAt: optional(v.publishedAt),
    doi: optional(v.doi),
    url: url(v.url),
    status: choice(v.status, [
      "queued",
      "processing",
      "ready",
      "partial",
      "needs-ocr",
      "failed",
      "cancelled",
    ]),
    method: choice(v.method, ["native", "ocr", "manual", "legacy"]),
    totalUnits: n(v.totalUnits),
    processedUnits: n(v.processedUnits),
    error: optional(v.error),
    assetId: v.assetId === undefined ? undefined : ident(v.assetId),
    snapshot: optional(v.snapshot),
  }));
  const passages: Passage[] = arr("passages", 1_000_000).map((p) => ({
    id: ident(p.id),
    sourceId: ident(p.sourceId),
    versionId: ident(p.versionId),
    text: text(p.text),
    locator: text(p.locator, 1000),
    page: p.page === undefined ? undefined : n(p.page),
    paragraph: p.paragraph === undefined ? undefined : n(p.paragraph),
    method: choice(p.method, ["native", "ocr", "manual", "legacy"]),
    inclusion: choice(p.inclusion, ["include", "pin", "exclude"]),
  }));
  for (const collection of [sources, versions, passages])
    if (new Set(collection.map((x) => x.id)).size !== collection.length)
      throw new Error("Duplicate research identifiers.");
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const versionMap = new Map(versions.map((v) => [v.id, v]));
  const passageMap = new Map(passages.map((p) => [p.id, p]));
  for (const s of sources)
    if (
      versionMap.get(s.currentVersionId)?.sourceId !== s.id ||
      (s.duplicateOf && !sourceMap.has(s.duplicateOf)) ||
      (s.derived && s.inclusion !== "exclude")
    )
      throw new Error("Broken source version reference.");
  for (const v of versions) {
    if (!sourceMap.has(v.sourceId) || v.processedUnits > v.totalUnits)
      throw new Error("Broken source version or coverage.");
    if (v.snapshot !== undefined && contentHash(v.snapshot) !== v.hash)
      throw new Error("Web snapshot content hash does not match.");
  }
  for (const p of passages)
    if (versionMap.get(p.versionId)?.sourceId !== p.sourceId)
      throw new Error("Broken passage reference.");
  const claimRecords = arr("claims");
  const claims: ResearchClaim[] = claimRecords.map((c) => ({
    id: ident(c.id),
    projectId,
    title: text(c.title),
    question: text(c.question),
    status: choice(c.status, [
      "unreviewed",
      "provisional",
      "supported",
      "disputed",
    ]),
    alternatives: text(c.alternatives),
    limitations: text(c.limitations),
    cardId: c.cardId === undefined ? undefined : ident(c.cardId),
    updatedAt: timestamp(c.updatedAt),
    links: (() => {
      if (!Array.isArray(c.links)) throw new Error("Invalid evidence links.");
      return c.links.map((l) => {
        const link = l as Record<string, unknown>;
        const passageId = ident(link.passageId),
          quote = text(link.quote);
        if (!quote.trim() || !passageMap.get(passageId)?.text.includes(quote))
          throw new Error("Invalid evidence quotation.");
        return {
          id: ident(link.id),
          passageId,
          quote,
          rationale: text(link.rationale),
          relation: choice(link.relation, [
            "supports",
            "contradicts",
            "context",
          ]),
        };
      });
    })(),
  }));
  const tasks: ResearchTask[] = arr("tasks").map((t) => ({
    id: ident(t.id),
    projectId,
    title: text(t.title),
    question: text(t.question),
    claimId: t.claimId === undefined ? undefined : ident(t.claimId),
    assumptionId:
      t.assumptionId === undefined ? undefined : ident(t.assumptionId),
    methodId: t.methodId === undefined ? undefined : ident(t.methodId),
    status: choice(t.status, ["planned", "doing", "blocked", "complete"]),
    dueDate: optional(t.dueDate),
    criterion: text(t.criterion),
    sourceIds: (() => {
      if (!Array.isArray(t.sourceIds)) throw new Error("Invalid task sources.");
      return t.sourceIds.map(ident);
    })(),
    updatedAt: timestamp(t.updatedAt),
  }));
  // Run provenance is data only; credentials are never admitted, including nested responses.
  const runs: AnalysisRun[] = arr("runs").map((r) => {
    if (
      !Array.isArray(r.citations) ||
      !Array.isArray(r.sourceVersions) ||
      !Array.isArray(r.exclusions)
    )
      throw new Error("Invalid analysis run.");
    const citations = r.citations.map((v) => validateCitation(v));
    for (const citation of citations)
      if (!citation.legacyCardId) {
        const passage = passageMap.get(citation.passageId);
        if (
          !passage ||
          passage.versionId !== citation.versionId ||
          passage.sourceId !== citation.sourceId ||
          !passage.text.includes(citation.quote)
        )
          throw new Error("Invalid archived citation anchor.");
      }
    let itemInsight: ItemInsight | undefined;
    if (r.itemInsight !== undefined) {
      if (
        !r.itemInsight ||
        typeof r.itemInsight !== "object" ||
        Array.isArray(r.itemInsight)
      )
        throw new Error("Invalid archived item summary.");
      const value = r.itemInsight as Record<string, unknown>,
        target = validateItemInsightTarget(value.target);
      const card =
        target.kind === "card"
          ? projectCards?.find((entry) => entry.id === target.id)
          : undefined;
      const sourceId =
        value.sourceId === undefined ? undefined : ident(value.sourceId);
      const versionId =
        value.versionId === undefined ? undefined : ident(value.versionId);
      if (
        r.kind !== "item-summary" ||
        r.status !== "completed" ||
        value.runId !== r.id ||
        value.provider !== r.provider ||
        value.model !== r.model ||
        value.question !== r.question ||
        (target.kind === "source" && sourceId !== target.id) ||
        (sourceId && !sourceMap.has(sourceId)) ||
        (versionId && versionMap.get(versionId)?.sourceId !== sourceId) ||
        (sourceId && !versionId) ||
        (versionId && !sourceId) ||
        (target.versionId !== undefined && target.versionId !== versionId) ||
        (card &&
          sourceId &&
          sourceId !== card.sourceId &&
          sourceMap.get(sourceId)?.cardId !== card.id &&
          !(
            card.boardReference?.kind === "source" &&
            card.boardReference.id === sourceId &&
            (!card.boardReference.versionId ||
              card.boardReference.versionId === versionId)
          ) &&
          !(
            card.boardReference?.kind === "passage" &&
            passageMap.get(card.boardReference.id)?.sourceId === sourceId &&
            card.boardReference.versionId === versionId
          ))
      )
        throw new Error(
          "Archived item summary has an invalid target or source version.",
        );
      if (!Array.isArray(value.citations) || value.citations.length > 1000)
        throw new Error("Invalid archived item summary citations.");
      const insightCitations = value.citations.map((entry) =>
        validateCitation(entry),
      );
      if (
        new Set(insightCitations.map((entry) => entry.id)).size !==
          insightCitations.length ||
        new Set(insightCitations.map((entry) => entry.label)).size !==
          insightCitations.length ||
        insightCitations.some(
          (entry) => !/^[1-9]\d*$/.test(entry.label) || !entry.quote.trim(),
        )
      )
        throw new Error("Invalid archived item summary citation labels.");
      for (const citation of insightCitations) {
        const original = citations.find((entry) => entry.id === citation.id);
        const passage = passageMap.get(citation.passageId),
          version = versionMap.get(citation.versionId);
        if (
          !original ||
          stableJSON(citation) !== stableJSON(original) ||
          !passage ||
          !version ||
          citation.sourceId !== sourceId ||
          citation.versionId !== versionId ||
          citation.locator !== passage.locator ||
          citation.sourceTitle !== version.title ||
          citation.acquiredAt !== version.acquiredAt ||
          !passage.text.includes(citation.quote)
        )
          throw new Error("Invalid archived item summary citation anchor.");
      }
      const markdown = text(value.markdown, 200_000);
      if (!markdown.trim()) throw new Error("Archived item summary is empty.");
      const labels = new Set(insightCitations.map((entry) => entry.label));
      if (
        [...markdown.matchAll(/\[(?:S)?(\d+)\]/g)].some(
          (match) => !labels.has(match[1]),
        )
      )
        throw new Error(
          "Archived item summary refers to unavailable citations.",
        );
      associateQuotedText(markdown, insightCitations);
      if (
        !value.coverage ||
        typeof value.coverage !== "object" ||
        Array.isArray(value.coverage)
      )
        throw new Error("Invalid archived item summary coverage.");
      const coverage = value.coverage as Record<string, unknown>;
      if (!Array.isArray(coverage.warnings) || coverage.warnings.length > 1000)
        throw new Error("Invalid archived item summary warnings.");
      const counts = {
        availablePassages: n(coverage.availablePassages),
        selectedPassages: n(coverage.selectedPassages),
        processedUnits: n(coverage.processedUnits),
        totalUnits: n(coverage.totalUnits),
      };
      if (
        counts.selectedPassages > counts.availablePassages ||
        counts.processedUnits > counts.totalUnits ||
        insightCitations.length > counts.selectedPassages
      )
        throw new Error("Invalid archived item summary coverage counts.");
      itemInsight = {
        id: ident(value.id),
        runId: ident(value.runId),
        target,
        itemTitle: text(value.itemTitle),
        question: text(value.question),
        markdown,
        citations: insightCitations,
        createdAt: timestamp(value.createdAt),
        provider: text(value.provider),
        model: text(value.model),
        cardUpdatedAt:
          value.cardUpdatedAt === undefined
            ? undefined
            : timestamp(value.cardUpdatedAt),
        sourceId,
        versionId,
        methodRevision:
          value.methodRevision === undefined
            ? undefined
            : n(value.methodRevision),
        briefRevision:
          value.briefRevision === undefined
            ? undefined
            : n(value.briefRevision),
        boardRecordSignature:
          value.boardRecordSignature === undefined
            ? undefined
            : (() => {
                const signature = text(value.boardRecordSignature, 64);
                if (!/^board-v1-[a-f0-9]{16}$/.test(signature))
                  throw new Error("Invalid linked-record change signature.");
                return signature;
              })(),
        coverage: {
          ...counts,
          status: text(coverage.status, 100),
          warnings: coverage.warnings.map((entry) => text(entry, 10000)),
        },
      };
    }
    return {
      id: ident(r.id),
      projectId,
      question: text(r.question),
      instructions: text(r.instructions),
      kind: text(r.kind),
      createdAt: timestamp(r.createdAt),
      provider: text(r.provider),
      model: text(r.model),
      templateVersion: text(r.templateVersion),
      citations,
      sourceVersions: r.sourceVersions.map(ident),
      exclusions: r.exclusions.map((v) => text(v)),
      response: text(r.response),
      status: choice(r.status, ["completed", "failed", "cancelled"]),
      ...(r.passages !== undefined
        ? {
            passages: (() => {
              if (!Array.isArray(r.passages) || r.passages.length > 100_000)
                throw new Error("Invalid retrieved passages.");
              return r.passages.map((entry) => {
                const saved = passageMap.get(ident((entry as Passage)?.id));
                if (
                  !saved ||
                  saved.text !== (entry as Passage).text ||
                  saved.versionId !== (entry as Passage).versionId
                )
                  throw new Error(
                    "Retrieved passage differs from saved evidence.",
                  );
                return saved;
              });
            })(),
          }
        : {}),
      ...(r.queries !== undefined
        ? {
            queries: (() => {
              const q = r.queries as Record<string, unknown>;
              const entries = (value: unknown) => {
                if (!Array.isArray(value) || value.length > 100)
                  throw new Error("Invalid retrieval queries.");
                return value.map((entry) => text(entry, 10000));
              };
              return {
                support: entries(q.support),
                counter: entries(q.counter),
                gaps: entries(q.gaps),
              };
            })(),
          }
        : {}),
      ...(r.groundingWarnings !== undefined
        ? {
            groundingWarnings: (() => {
              if (
                !Array.isArray(r.groundingWarnings) ||
                r.groundingWarnings.length > 10_000
              )
                throw new Error("Invalid grounding warnings.");
              return r.groundingWarnings.map((entry) => text(entry, 10000));
            })(),
          }
        : {}),
      ...(r.pedigreeSnapshotId !== undefined
        ? { pedigreeSnapshotId: ident(r.pedigreeSnapshotId) }
        : {}),
      ...validatedRunAudit(r, passageMap, sourceMap),
      ...(itemInsight ? { itemInsight } : {}),
    };
  });
  const discoveries: DiscoveryCandidate[] = arr("discoveries").map((d) => ({
    id: ident(d.id),
    projectId,
    planId: ident(d.planId),
    title: text(d.title),
    url: url(d.url)!,
    description: text(d.description),
    status: choice(d.status, ["pending", "accepted", "dismissed", "failed"]),
    capturedAt: optional(d.capturedAt),
    error: optional(d.error),
  }));
  const acceptedRuns = new Set<string>();
  for (const [index, claim] of claims.entries()) {
    const value = claimRecords[index].itemReview;
    if (value === undefined) continue;
    if (raw.schemaVersion === 2 && !snapshotState)
      throw new Error("Accepted reviewer notes require a version 3 archive.");
    const reviewRunId = (value as Record<string, unknown>)?.runId;
    claim.itemReview = validatedItemReview(
      value,
      projectId,
      sourceMap,
      versionMap,
      passageMap,
      runs.find((run) => run.id === reviewRunId),
      Boolean(snapshotState),
    );
    if (acceptedRuns.has(claim.itemReview.runId))
      throw new Error(
        "An item summary can have only one accepted reviewer-note record.",
      );
    acceptedRuns.add(claim.itemReview.runId);
  }
  for (const collection of [claims, tasks, runs, discoveries])
    if (new Set(collection.map((x) => x.id)).size !== collection.length)
      throw new Error("Duplicate research identifiers.");
  for (const task of tasks)
    if (task.sourceIds.some((id) => !sourceMap.has(id)))
      throw new Error("Task refers to a missing source.");
  let pedigree = emptyPedigreeState();
  let pedigreeRevisions: PedigreeRevision[] = [];
  let pedigreeSnapshots: PedigreeSnapshot[] = [];
  if (
    raw.schemaVersion === 3 ||
    raw.schemaVersion === 4 ||
    raw.schemaVersion === 5
  ) {
    const state = raw.pedigree as Record<string, unknown> | undefined;
    if (!state || typeof state !== "object")
      throw new Error("Version 3 archive is missing pedigree records.");
    if (
      raw.schemaVersion === 3 &&
      [state.gaps, state.decisions].some(
        (rows) => Array.isArray(rows) && rows.length,
      )
    )
      throw new Error("Gap and decision records require archive version 4.");
    const rebased: Record<string, unknown> = {};
    for (const key of Object.values(PEDIGREE_COLLECTIONS)) {
      const rows =
        state[key] === undefined &&
        raw.schemaVersion === 3 &&
        ["gaps", "decisions"].includes(key)
          ? []
          : state[key];
      if (!Array.isArray(rows))
        throw new Error("Invalid pedigree archive collection.");
      rebased[key] = rows.map((entity) => ({ ...entity, projectId }));
    }
    pedigree = validatePedigreeState(rebased, projectId);
    validatePedigreeReferences(pedigree, {
      sources,
      versions,
      passages,
      claims,
      tasks,
    });
    pedigreeRevisions = arr("pedigreeRevisions").map((record) => {
      const kind = choice(
        record.kind,
        Object.keys(PEDIGREE_COLLECTIONS) as PedigreeEntityKind[],
      );
      const data = validatePedigreeEntity(
        kind,
        { ...(record.data as object), projectId },
        projectId,
      );
      const revision = n(record.revision),
        entityId = ident(record.entityId),
        createdAt = timestamp(record.createdAt);
      if (
        revision < 1 ||
        data.revision !== revision ||
        data.id !== entityId ||
        data.updatedAt !== createdAt
      )
        throw new Error("Invalid immutable pedigree revision.");
      return {
        id: ident(record.id),
        projectId,
        entityId,
        kind,
        revision,
        createdAt,
        data,
      };
    });
    if (
      new Set(pedigreeRevisions.map((revision) => revision.id)).size !==
        pedigreeRevisions.length ||
      new Set(
        pedigreeRevisions.map(
          (revision) => `${revision.entityId}:${revision.revision}`,
        ),
      ).size !== pedigreeRevisions.length
    )
      throw new Error("Duplicate pedigree revisions.");
    for (const [kind, key] of Object.entries(PEDIGREE_COLLECTIONS) as [
      PedigreeEntityKind,
      keyof PedigreeState,
    ][])
      for (const entity of pedigree[key]) {
        const revision = pedigreeRevisions.find(
          (revision) =>
            revision.kind === kind &&
            revision.entityId === entity.id &&
            revision.revision === entity.revision,
        );
        if (!revision || stableJSON(revision.data) !== stableJSON(entity))
          throw new Error(
            "Current pedigree record does not match its immutable revision.",
          );
      }
    pedigreeSnapshots = arr("pedigreeSnapshots", 10_000).map((snapshot) =>
      validatePedigreeSnapshot(snapshot, projectId),
    );
    for (const snapshot of pedigreeSnapshots)
      for (const claim of snapshot.claims)
        if (claim.itemReview)
          validatedItemReview(
            claim.itemReview,
            projectId,
            new Map(snapshot.sources.map((source) => [source.id, source])),
            new Map(
              snapshot.sourceVersions.map((version) => [version.id, version]),
            ),
            new Map(snapshot.passages.map((passage) => [passage.id, passage])),
            runs.find((run) => run.id === claim.itemReview!.runId),
          );
    if (
      new Set(pedigreeSnapshots.map((snapshot) => snapshot.id)).size !==
      pedigreeSnapshots.length
    )
      throw new Error("Duplicate pedigree snapshots.");
    for (const run of runs)
      if (
        run.pedigreeSnapshotId &&
        !pedigreeSnapshots.some(
          (snapshot) => snapshot.id === run.pedigreeSnapshotId,
        )
      )
        throw new Error("Analysis run refers to a missing pedigree snapshot.");
  }
  if (
    raw.schemaVersion === 2 &&
    tasks.some((task) => task.assumptionId || task.methodId)
  ) {
    if (!snapshotState)
      throw new Error(
        "Legacy archive task refers to missing pedigree records.",
      );
    validatePedigreeReferences(snapshotState, {
      sources,
      versions,
      passages,
      claims,
      tasks,
    });
  }
  for (const card of projectCards ?? []) {
    if (!card.boardReference) continue;
    if (raw.schemaVersion < 4)
      throw new Error("Linked research board items require archive version 4.");
    const ref = validateBoardReference(card.boardReference);
    if (
      ref.kind === "source" &&
      ref.versionId &&
      versionMap.has(ref.versionId) &&
      versionMap.get(ref.versionId)!.sourceId !== ref.id
    )
      throw new Error(
        "Board source reference points to a different historical version.",
      );
    if (
      ref.kind === "passage" &&
      passageMap.has(ref.id) &&
      passageMap.get(ref.id)!.versionId !== ref.versionId
    )
      throw new Error(
        "Board passage reference has an invalid historical version.",
      );
    if (
      ref.kind === "review" &&
      claims.some((claim) => claim.id === ref.id && !claim.itemReview)
    )
      throw new Error("Board review reference has no accepted reviewer notes.");
    const kinds = new Map<string, string>();
    for (const [kind, key] of Object.entries(PEDIGREE_COLLECTIONS) as [
      PedigreeEntityKind,
      keyof PedigreeState,
    ][])
      for (const entity of pedigree[key] ?? []) kinds.set(entity.id, kind);
    if (kinds.has(ref.id) && kinds.get(ref.id) !== ref.kind)
      throw new Error(
        "Board reference does not match its saved research record type.",
      );
  }
  const drafts =
    raw.drafts === undefined
      ? []
      : arr("drafts", 10000).map((draft) => validateDraft(draft, projectId));
  if (drafts.length && raw.schemaVersion !== 5)
    throw new Error("Private draft buffers require archive version 5.");
  if (new Set(drafts.map((draft) => draft.key)).size !== drafts.length)
    throw new Error("Duplicate private draft keys.");
  return {
    schemaVersion: raw.schemaVersion,
    sources,
    versions,
    passages,
    claims,
    tasks,
    runs,
    discoveries,
    jobs: [],
    pedigree,
    pedigreeRevisions,
    pedigreeSnapshots,
    ...(raw.schemaVersion === 5 ? { drafts } : {}),
  };
}
