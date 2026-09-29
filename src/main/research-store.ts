import { DatabaseSync } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Project } from "../shared/types";
import { validateProject, validateCitation } from "../shared/project";
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
} from "../shared/research";

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
function cleanData<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (key, val) =>
      /^(?:apiKey|searchKey|token|password|authorization|credential|credentials|secret)$/i.test(
        key,
      )
        ? undefined
        : val,
    ),
  ) as T;
}
function policy(value: unknown): asserts value is Inclusion {
  if (!["include", "pin", "exclude"].includes(value as string))
    throw new Error("Invalid inclusion policy.");
}
export interface ResearchArchive extends ResearchState {
  schemaVersion: 2;
  passages: Passage[];
}

/** Entity rows and FTS are separate from the lightweight board project. Original assets live on disk. */
export class ResearchStore {
  private db: DatabaseSync;
  private depth = 0;
  constructor(storageRoot: string) {
    mkdirSync(storageRoot, { recursive: true });
    this.db = new DatabaseSync(join(storageRoot, "research.sqlite"));
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
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
      CREATE TABLE IF NOT EXISTS discovery_plans(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,data TEXT NOT NULL,claimed INTEGER NOT NULL DEFAULT 0);`);
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
      this.depth--;
      if (outer) this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.depth--;
      if (outer) this.db.exec("ROLLBACK");
      throw error;
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
    clean.schemaVersion = 2;
    this.transaction(() => {
      this.syncCards(clean);
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
    });
    // Assign generated references back to the caller, without changing annotations.
    project.schemaVersion = 2;
    project.cards = clean.cards;
  }
  getProject(id: string): Project | undefined {
    checkId(id);
    return parse<Project>(
      this.db.prepare("SELECT data FROM projects WHERE id=?").get(id),
    );
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
              .prepare("SELECT count(*) AS n FROM sources WHERE project_id=?")
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
  state(projectId: string): ResearchState {
    const sources = this.list<SourceRecord>("sources", projectId);
    return {
      sources,
      versions: sources.flatMap((s) => this.versions(s.id)),
      claims: this.list("claims", projectId),
      tasks: this.list("tasks", projectId),
      jobs: this.list("jobs", projectId),
      discoveries: this.list("discoveries", projectId),
      runs: this.list("runs", projectId),
    };
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
    if (this.getVersion(passage.versionId).status !== "processing")
      throw new Error("Completed source passages are immutable.");
    this.insertPassage(passage);
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
      Pick<SourceVersion, "title" | "author" | "publisher" | "publishedAt">
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
    this.db
      .prepare("UPDATE passages SET data=? WHERE id=?")
      .run(JSON.stringify({ ...passage, inclusion }), id);
  }
  listPassages(
    projectId: string,
    options: { includeExcluded?: boolean; versionId?: string } = {},
  ): Passage[] {
    const filters = [
      "s.project_id=?",
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
        `SELECT p.data,s.data AS source,bm25(passage_fts) AS score FROM passage_fts JOIN passages p ON p.id=passage_fts.id JOIN sources s ON s.id=p.source_id WHERE passage_fts MATCH ? AND s.project_id=? AND json_extract(s.data,'$.inclusion')<>'exclude' AND json_extract(p.data,'$.inclusion')<>'exclude' AND p.version_id=json_extract(s.data,'$.currentVersionId') ORDER BY CASE WHEN json_extract(s.data,'$.inclusion')='pin' OR json_extract(p.data,'$.inclusion')='pin' THEN 0 ELSE 1 END,score LIMIT ?`,
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
  syncCards(project: Project) {
    for (const card of project.cards) {
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
  deleteClaim(id: string) {
    this.db.prepare("DELETE FROM claims WHERE id=?").run(id);
  }
  saveTask(value: ResearchTask) {
    if (!["planned", "doing", "blocked", "complete"].includes(value.status))
      throw new Error("Invalid task status.");
    this.write("tasks", value);
  }
  deleteTask(id: string) {
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
      schemaVersion: 2,
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
    options: { replace?: boolean } = {},
  ) {
    checkId(projectId);
    const data = validateResearchArchive(value, projectId);
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
      for (const claim of data.claims) this.saveClaim(claim);
      for (const task of data.tasks) this.saveTask(task);
      for (const run of data.runs) this.saveRun(run);
      for (const item of data.discoveries) this.saveDiscovery(item);
    });
  }
}

/** Reject malformed archives before beginning any write. Unknown fields and secrets are discarded. */
export function validateResearchArchive(
  value: unknown,
  projectId: string,
): ResearchArchive {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid research archive.");
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 2)
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
      (s.duplicateOf && !sourceMap.has(s.duplicateOf))
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
  const claims: ResearchClaim[] = arr("claims").map((c) => ({
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
  for (const collection of [claims, tasks, runs, discoveries])
    if (new Set(collection.map((x) => x.id)).size !== collection.length)
      throw new Error("Duplicate research identifiers.");
  for (const task of tasks)
    if (task.sourceIds.some((id) => !sourceMap.has(id)))
      throw new Error("Task refers to a missing source.");
  return {
    schemaVersion: 2,
    sources,
    versions,
    passages,
    claims,
    tasks,
    runs,
    discoveries,
    jobs: [],
  };
}
