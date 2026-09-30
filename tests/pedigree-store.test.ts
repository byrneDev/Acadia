import { DatabaseSync } from "node:sqlite";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ResearchStore,
  contentHash,
  snapshotHash,
  validateResearchArchive,
} from "../src/main/research-store";
import { createBlankProject } from "../src/shared/project";
import {
  createAppraisal,
  createAssumption,
  createFinding,
  createMethodRow,
  createMethodWorksheet,
  createOrigin,
  createReviewIssue,
  METHOD_REGISTRY,
  validatePedigreeEntity,
  type RootCauseRow,
  type RiskRow,
} from "../src/shared/pedigree";
import type { ResearchClaim } from "../src/shared/research";

const directories: string[] = [],
  stores: ResearchStore[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {}
  }
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "acadia-pedigree-"));
  directories.push(directory);
  const store = new ResearchStore(directory);
  stores.push(store);
  const project = createBlankProject();
  project.question = "Does the pilot improve outcomes?";
  const timestamp = new Date().toISOString();
  project.cards = [
    "The pilot improved outcomes in the laboratory.",
    "The field audit did not find improved outcomes.",
  ].map((content, index) => ({
    id: `card-${index}`,
    kind: "note",
    title: `Observation ${index}`,
    content,
    x: index * 200,
    y: 100,
    tags: [],
    status: "unreviewed",
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  store.saveProject(project);
  const state = store.state(project.id),
    passages = state.sources.map(
      (source) => store.getSource(source.id).passages[0],
    );
  const claim: ResearchClaim = {
    id: "claim-pilot",
    projectId: project.id,
    title: "Pilot improves outcomes",
    question: project.question,
    status: "provisional",
    alternatives: "Laboratory context differs from field conditions.",
    limitations: "Small field sample.",
    updatedAt: timestamp,
    links: passages.map((passage, index) => ({
      id: `evidence-${index}`,
      passageId: passage.id,
      quote: passage.text,
      rationale: "Observed result",
      relation: index ? "contradicts" : "supports",
    })),
  };
  store.saveClaim(claim);
  store.saveTask({
    id: "task-field",
    projectId: project.id,
    title: "Replicate in the field",
    question: project.question,
    status: "planned",
    criterion: "Independent field observations",
    sourceIds: [],
    claimId: claim.id,
    updatedAt: timestamp,
  });
  return { directory, store, project, state, passages, claim };
}

describe("versioned research pedigree", () => {
  it("recovers transaction depth after a failed commit and rolls back subsequent work normally", async () => {
    const { store, project } = await fixture();
    const db = (store as unknown as { db: DatabaseSync }).db;
    const exec = db.exec.bind(db);
    let failCommit = true;
    db.exec = (sql: string) => {
      if (sql === "COMMIT" && failCommit) {
        failCommit = false;
        throw new Error("Simulated commit failure");
      }
      return exec(sql);
    };
    const task = store.state(project.id).tasks[0];
    try {
      expect(() =>
        store.transaction(() =>
          store.saveTask({ ...task, title: "Must roll back" }),
        ),
      ).toThrow(/commit failure/);
      expect(store.state(project.id).tasks[0]).toEqual(task);
      expect(() =>
        store.transaction(() => {
          store.saveTask({ ...task, title: "Must also roll back" });
          throw new Error("Later interrupted transaction");
        }),
      ).toThrow(/Later interrupted/);
      expect(store.state(project.id).tasks[0]).toEqual(task);
      store.transaction(() =>
        store.saveTask({ ...task, title: "Committed normally" }),
      );
      expect(store.state(project.id).tasks[0].title).toBe("Committed normally");
    } finally {
      db.exec = exec;
    }
  });
  it("strips credential key variants before export/hash while retaining legitimate token-count controls", async () => {
    const { store, project, state } = await fixture();
    const source = {
      ...state.sources[0],
      api_key: "secret-api",
      access_token: "secret-access",
      "client-secret": "secret-client",
    };
    store.saveSource(source);
    const snapshot = store.createPedigreeSnapshot(project.id);
    expect(snapshotHash(snapshot)).toBe(snapshot.hash);
    store.saveRun({
      id: "audit-run",
      projectId: project.id,
      question: project.question,
      instructions: "",
      kind: "answer",
      createdAt: new Date().toISOString(),
      provider: "compatible",
      model: "model",
      templateVersion: "v4",
      citations: [],
      exclusions: [],
      sourceVersions: [],
      response: "",
      status: "completed",
      requests: [
        {
          provider: "compatible",
          endpoint: "https://example.org/v1",
          model: "model",
          messages: [{ role: "user", content: "Synthetic audit request" }],
          parameters: {
            max_tokens: 1200,
            token_count: 14,
            temperature: 0.2,
            api_key: "secret-api",
            options: {
              refresh_token: "secret-refresh",
              "client-secret": "secret-client",
              max_tokens: 500,
            },
          },
        },
      ],
    });
    const archive = store.exportResearch(project.id);
    expect(JSON.stringify(archive)).not.toContain("secret-");
    expect(archive.runs[0].requests?.[0].parameters).toEqual({
      max_tokens: 1200,
      token_count: 14,
      temperature: 0.2,
      options: { max_tokens: 500 },
    });
    const normalized = validateResearchArchive(archive, project.id);
    expect(normalized.pedigreeSnapshots?.[0]).toEqual(snapshot);
    expect(snapshotHash(normalized.pedigreeSnapshots![0])).toBe(snapshot.hash);
  });
  it("guards current finding and task links while allowing deletion when only a historical snapshot refers to them", async () => {
    const { store, project, claim } = await fixture();
    expect(() => store.deleteClaim(claim.id)).toThrow(
      /linked to a research task/,
    );
    store.saveTask({ ...store.state(project.id).tasks[0], claimId: undefined });
    const worksheet = createMethodWorksheet(project.id, "risk");
    const row = createMethodRow("risk");
    row.claimIds = [claim.id];
    row.taskIds = ["task-field"];
    worksheet.rows = [row] as typeof worksheet.rows;
    const saved = store.saveMethod(worksheet);
    const snapshot = store.createPedigreeSnapshot(project.id);
    expect(() => store.deleteClaim(claim.id)).toThrow(
      /Keep its research history/,
    );
    expect(() => store.deleteTask("task-field")).toThrow(
      /referenced by a method/,
    );
    store.saveMethod({
      ...saved,
      rows: saved.rows.map((r) => ({ ...r, claimIds: [], taskIds: [] })),
    } as typeof saved);
    store.deleteTask("task-field");
    store.deleteClaim(claim.id);
    expect(store.state(project.id).claims).toEqual([]);
    expect(store.state(project.id).tasks).toEqual([]);
    expect(store.getPedigreeSnapshot(snapshot.id).claims[0].id).toBe(claim.id);
    expect(store.getPedigreeSnapshot(snapshot.id).tasks[0].id).toBe(
      "task-field",
    );
    expect(() =>
      validateResearchArchive(store.exportResearch(project.id), project.id),
    ).not.toThrow();
  });
  it("guards assessment and review issue references without preventing an unrelated task's deletion", async () => {
    const { store, project, claim } = await fixture();
    store.deleteTask("task-field");
    store.saveFinding(createFinding(project.id, claim.id));
    expect(() => store.deleteClaim(claim.id)).toThrow(/assessment or method/);
    const other = { ...claim, id: "claim-other", links: [] };
    store.saveClaim(other);
    store.saveReviewIssue(
      createReviewIssue(project.id, { kind: "finding", id: other.id }),
    );
    expect(() => store.deleteClaim(other.id)).toThrow(/assessment or method/);
    expect(() =>
      validateResearchArchive(store.exportResearch(project.id), project.id),
    ).not.toThrow();
  });
  it("rolls back a replacement import that collides after deletions, retaining passages, indexes and snapshots", async () => {
    const { store, project } = await fixture();
    const snapshot = store.createPedigreeSnapshot(project.id);
    const other = createBlankProject();
    other.cards = [
      { ...project.cards[0], id: "foreign-card", sourceId: undefined },
    ];
    store.saveProject(other);
    store.activeProjectId = project.id;
    const before = store.exportResearch(project.id),
      foreignBefore = store.exportResearch(other.id);
    const matches = store.search(project.id, "laboratory");
    expect(matches.length).toBeGreaterThan(0);
    expect(() =>
      store.importResearch(project.id, foreignBefore, { replace: true }),
    ).toThrow(/another project/);
    expect(store.exportResearch(project.id)).toEqual(before);
    expect(store.exportResearch(other.id)).toEqual(foreignBefore);
    expect(store.search(project.id, "laboratory")).toEqual(matches);
    expect(store.getPedigreeSnapshot(snapshot.id)).toEqual(snapshot);
    expect(store.activeProjectId).toBe(project.id);
  });
  it("persists finding review issues by claim ID before an assessment exists and retains them through archive import", async () => {
    const { store, project, claim } = await fixture();
    expect(store.pedigreeState(project.id).findings).toHaveLength(0);
    const issue = store.saveReviewIssue({
      ...createReviewIssue(project.id, { kind: "finding", id: claim.id }),
      summary: "The field evidence conflicts with the provisional finding.",
      claimId: claim.id,
      origin: "ai",
    });
    expect(store.pedigreeState(project.id).issues[0]).toEqual(issue);
    expect(() =>
      store.saveReviewIssue({
        ...createReviewIssue(project.id, {
          kind: "finding",
          id: "foreign-claim",
        }),
      }),
    ).toThrow(/Review target/);
    const snapshot = store.createPedigreeSnapshot(project.id);
    expect(store.getPedigreeSnapshot(snapshot.id).state.issues[0]).toEqual(
      issue,
    );
    const archive = store.exportResearch(project.id);
    const directory = await mkdtemp(join(tmpdir(), "acadia-finding-review-"));
    directories.push(directory);
    const destination = new ResearchStore(directory);
    stores.push(destination);
    destination.importResearch(project.id, archive);
    destination.saveProject(project);
    expect(destination.pedigreeState(project.id).issues[0]).toEqual(issue);
    expect(
      destination.getPedigreeSnapshot(snapshot.id).state.issues[0],
    ).toEqual(issue);
  });
  it("preserves gap-linked tasks across snapshots and archive import, and rejects foreign gap references", async () => {
    const { store, project } = await fixture();
    const assumption = store.saveAssumption(createAssumption(project.id));
    const method = store.saveMethod(createMethodWorksheet(project.id, "risk"));
    const task = {
      ...store.state(project.id).tasks[0],
      assumptionId: assumption.id,
      methodId: method.id,
    };
    store.saveTask(task);
    expect(() =>
      store.saveTask({ ...task, assumptionId: "foreign-assumption" }),
    ).toThrow(/assumption/);
    expect(() =>
      store.saveTask({ ...task, methodId: "foreign-method" }),
    ).toThrow(/method/);
    const snapshot = store.createPedigreeSnapshot(project.id);
    expect(store.getPedigreeSnapshot(snapshot.id).tasks[0]).toMatchObject({
      assumptionId: assumption.id,
      methodId: method.id,
    });
    const archive = store.exportResearch(project.id);
    const directory = await mkdtemp(join(tmpdir(), "acadia-pedigree-import-"));
    directories.push(directory);
    const destination = new ResearchStore(directory);
    stores.push(destination);
    destination.importResearch(project.id, archive);
    destination.saveProject(project);
    expect(destination.state(project.id).tasks[0]).toEqual(task);
    const invalid = structuredClone(archive);
    invalid.tasks[0].methodId = "foreign-method";
    expect(() => destination.importResearch(project.id, invalid)).toThrow(
      /task method/,
    );
    expect(destination.state(project.id).tasks[0]).toEqual(task);
  });
  it("seeds an explicitly unassessed brief without inventing appraisals or findings", async () => {
    const { store, project } = await fixture();
    const state = store.pedigreeState(project.id);
    expect(project.schemaVersion).toBe(5);
    expect(state.briefs).toHaveLength(1);
    expect(state.briefs[0]).toMatchObject({
      question: project.question,
      revision: 1,
      reviewStatus: "unassessed",
      scope: "",
      decision: "",
    });
    expect(state.appraisals).toEqual([]);
    expect(state.findings).toEqual([]);
    expect(
      store.getPedigreeRevisions("brief", state.briefs[0].id)[0].data,
    ).toEqual(state.briefs[0]);
  });
  it("appends immutable assessment revisions, rejects stale writes, and strips credentials", async () => {
    const { store, project, state, passages } = await fixture();
    const input = {
      ...createAppraisal(
        project.id,
        state.sources[0].id,
        passages[0].versionId,
      ),
      passageIds: [passages[0].id],
      rationale: "Review protocol and population.",
      apiKey: "never-save-this",
    };
    const first = store.saveAppraisal(input);
    const second = store.saveAppraisal({
      ...first,
      reviewStatus: "reviewed",
      limitations: "Laboratory only.",
    });
    expect(first.revision).toBe(1);
    expect(second.revision).toBe(2);
    expect(() =>
      store.saveAppraisal({ ...first, rationale: "Stale edit" }),
    ).toThrow(/changed since/);
    const revisions = store.getPedigreeRevisions("appraisal", first.id);
    expect(revisions.map((revision) => revision.revision)).toEqual([1, 2]);
    expect(revisions[0].data).toEqual(first);
    expect(JSON.stringify(store.exportResearch(project.id))).not.toContain(
      "never-save-this",
    );
  });
  it("enforces exact source versions and project ownership across appraisals, findings, and worksheet evidence", async () => {
    const { store, project, state, passages, claim } = await fixture();
    expect(() =>
      store.saveAppraisal({
        ...createAppraisal(
          project.id,
          state.sources[0].id,
          passages[0].versionId,
        ),
        passageIds: [passages[1].id],
      }),
    ).toThrow(/assessed source version/);
    expect(() =>
      store.saveFinding({
        ...createFinding(project.id, claim.id),
        assumptionIds: ["missing-assumption"],
      }),
    ).toThrow(/assumption reference/);
    const other = createBlankProject();
    store.saveProject(other);
    expect(() => store.saveFinding(createFinding(other.id, claim.id))).toThrow(
      /finding claim/,
    );
    const worksheet = createMethodWorksheet(project.id, "risk"),
      row = createMethodRow("risk") as RiskRow;
    row.passageIds = ["foreign-passage"];
    worksheet.rows = [row];
    expect(() => store.saveMethod(worksheet)).toThrow(/passage reference/);
    expect(() =>
      store.saveOrigin(
        createOrigin(project.id, state.sources[0].id, state.sources[0].id),
      ),
    ).toThrow(/own origin/);
  });
  it("retains all seven record kinds, typed rows, history, and frozen evidence after a source update and v3 roundtrip", async () => {
    const { store, project, state, passages, claim } = await fixture();
    const brief = store.pedigreeState(project.id).briefs[0];
    store.saveBrief({
      ...brief,
      decision: "Whether to fund a field replication",
      scope: "One pilot",
      reviewStatus: "reviewed",
    });
    store.saveAppraisal({
      ...createAppraisal(
        project.id,
        state.sources[0].id,
        passages[0].versionId,
      ),
      origin: "primary",
      passageIds: [passages[0].id],
      reviewStatus: "reviewed",
    });
    store.saveOrigin({
      ...createOrigin(project.id, state.sources[0].id, state.sources[1].id),
      kind: "same-study",
      status: "confirmed",
      rationale: "Shared pilot protocol.",
    });
    const assumption = store.saveAssumption({
      ...createAssumption(project.id),
      statement: "Field conditions are comparable",
      claimIds: [claim.id],
      passageIds: [passages[1].id],
    });
    const finding = store.saveFinding({
      ...createFinding(project.id, claim.id),
      classification: "inference",
      assumptionIds: [assumption.id],
      confidence: "low",
      confidenceBasis: "Conflicting field observation",
      supportReview: "partial",
      reviewStatus: "reviewed",
    });
    const method = createMethodWorksheet(project.id, "risk");
    const row = createMethodRow("risk") as RiskRow;
    Object.assign(row, {
      text: "Field benefit may not replicate",
      passageIds: [passages[1].id],
      claimIds: [claim.id],
      assumptionIds: [assumption.id],
      taskIds: ["task-field"],
      likelihood: "moderate",
      likelihoodBasis: "Negative field audit",
      impact: "high",
      impactBasis: "Funding decision",
      causes: "Context mismatch",
      consequences: "Failed deployment",
      controls: "Replication before funding",
    });
    method.rows = [row];
    const savedMethod = store.saveMethod(method);
    store.saveReviewIssue({
      ...createReviewIssue(project.id, { kind: "finding", id: claim.id }),
      summary: "Reconsider external validity",
      detail: "Laboratory finding conflicts with the field audit.",
      passageIds: [passages[1].id],
      claimIds: [claim.id],
      assumptionIds: [assumption.id],
      taskIds: ["task-field"],
      methodId: savedMethod.id,
    });
    const snapshot = store.createPedigreeSnapshot(project.id);
    expect(snapshot.hash).toBe(snapshotHash(snapshot));
    project.cards[0].content = "Updated laboratory report withdrawn.";
    store.saveProject(project);
    store.saveClaim({ ...claim, title: "Benefit remains uncertain" });
    store.saveFinding({
      ...finding,
      confidence: "unassessed",
      reviewStatus: "draft",
    });
    const frozen = store.getPedigreeSnapshot(snapshot.id);
    expect(frozen.claims[0].title).toBe("Pilot improves outcomes");
    expect(
      frozen.passages.find((passage) => passage.id === passages[0].id)?.text,
    ).toBe(passages[0].text);
    expect(frozen.state.findings[0].confidence).toBe("low");
    const archive = store.exportResearch(project.id);
    expect(archive.schemaVersion).toBe(5);
    const targetDirectory = await mkdtemp(
      join(tmpdir(), "acadia-pedigree-import-"),
    );
    directories.push(targetDirectory);
    const target = { store: new ResearchStore(targetDirectory) };
    stores.push(target.store);
    target.store.importResearch(project.id, archive, { replace: true });
    expect(target.store.pedigreeState(project.id)).toEqual(
      store.pedigreeState(project.id),
    );
    expect(target.store.getPedigreeSnapshot(snapshot.id)).toEqual(snapshot);
    expect(
      target.store.getPedigreeRevisions("finding", finding.id),
    ).toHaveLength(2);
    const corrupt = structuredClone(archive);
    corrupt.pedigreeSnapshots![0].passages[0].text = "Tampered evidence";
    expect(() =>
      target.store.importResearch(project.id, corrupt, { replace: true }),
    ).toThrow(/snapshot hash/);
    expect(target.store.getPedigreeSnapshot(snapshot.id)).toEqual(snapshot);
  });
  it("treats v2 imports as unassessed and rejects future archives before writes", async () => {
    const { store, project } = await fixture();
    const legacy = store.exportResearch(project.id);
    legacy.schemaVersion = 2;
    delete legacy.pedigree;
    delete legacy.pedigreeRevisions;
    delete legacy.pedigreeSnapshots;
    expect(validateResearchArchive(legacy, project.id).pedigree).toEqual({
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
    const original = store.exportResearch(project.id);
    expect(() =>
      store.importResearch(
        project.id,
        { ...legacy, schemaVersion: 6 },
        { replace: true },
      ),
    ).toThrow(/Unsupported research archive/);
    expect(store.exportResearch(project.id)).toEqual(original);
  });
});

describe("fixed typed method registry", () => {
  it.each(METHOD_REGISTRY.map((method) => method.kind))(
    "validates a %s worksheet and rejects missing core fields",
    (kind) => {
      const method = createMethodWorksheet("project-test", kind);
      method.rows = [createMethodRow(kind)] as never;
      expect(validatePedigreeEntity("method", method)).toEqual(method);
      const bad = structuredClone(method);
      (bad.rows[0] as unknown as Record<string, unknown>).passageIds = [
        "invalid reference",
      ];
      expect(() => validatePedigreeEntity("method", bad)).toThrow(/identifier/);
    },
  );
  it("rejects Why-chain cycles and out-of-range readiness assessments", () => {
    const method = createMethodWorksheet("project-test", "root-cause"),
      a = createMethodRow("root-cause") as RootCauseRow,
      b = createMethodRow("root-cause") as RootCauseRow;
    a.parentId = b.id;
    b.parentId = a.id;
    method.rows = [a, b];
    expect(() => validatePedigreeEntity("method", method)).toThrow(/cycle/);
    const trl = createMethodWorksheet("project-test", "trl");
    trl.rows = [{ ...createMethodRow("trl"), assessedLevel: 10 }] as never;
    expect(() => validatePedigreeEntity("method", trl)).toThrow(
      /integer from 1 to 9/,
    );
  });
});

describe("SQLite v5 migration recovery", () => {
  it("backs up committed WAL data consistently before transactional migration", async () => {
    const { store, directory, project } = await fixture();
    store.close();
    const legacy = new DatabaseSync(join(directory, "research.sqlite"));
    try {
      legacy.exec(
        "PRAGMA journal_mode=WAL; DROP TABLE pedigree_entities; DROP TABLE pedigree_revisions; DROP TABLE pedigree_snapshots; PRAGMA user_version=2;",
      );
      project.question = "Question committed in WAL before migration";
      legacy
        .prepare("UPDATE projects SET data=? WHERE id=?")
        .run(JSON.stringify(project), project.id);
      const migrated = new ResearchStore(directory);
      stores.push(migrated);
      expect(migrated.pedigreeState(project.id).briefs[0]).toMatchObject({
        question: project.question,
        reviewStatus: "unassessed",
      });
      const backup = new DatabaseSync(migrated.migrationBackupPath!, {
        readOnly: true,
      });
      try {
        expect(
          (
            backup.prepare("PRAGMA user_version").get() as {
              user_version: number;
            }
          ).user_version,
        ).toBe(2);
        expect(
          JSON.parse(
            (
              backup
                .prepare("SELECT data FROM projects WHERE id=?")
                .get(project.id) as { data: string }
            ).data,
          ).question,
        ).toBe(project.question);
        expect(
          backup
            .prepare(
              "SELECT name FROM sqlite_master WHERE name='pedigree_entities'",
            )
            .get(),
        ).toBeUndefined();
      } finally {
        backup.close();
      }
    } finally {
      legacy.close();
    }
  });
  it("rolls back a failed schema change and leaves a usable recovery backup", async () => {
    const { store, directory, project } = await fixture();
    store.close();
    const legacy = new DatabaseSync(join(directory, "research.sqlite"));
    legacy.exec(
      "DROP TABLE pedigree_entities; DROP TABLE pedigree_revisions; DROP TABLE pedigree_snapshots; CREATE VIEW pedigree_entities AS SELECT id, id AS project_id, 'brief' AS kind, data FROM projects; PRAGMA user_version=2;",
    );
    legacy.close();
    expect(() => new ResearchStore(directory)).toThrow(
      /could not migrate.*previous database was preserved/i,
    );
    const retained = new DatabaseSync(join(directory, "research.sqlite"));
    try {
      expect(
        (
          retained.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(2);
      expect(
        retained.prepare("SELECT id FROM projects WHERE id=?").get(project.id),
      ).toBeDefined();
      expect(
        retained
          .prepare(
            "SELECT name FROM sqlite_master WHERE name='pedigree_snapshots'",
          )
          .get(),
      ).toBeUndefined();
      expect(
        (await readdir(join(directory, "recovery"))).some((file) =>
          file.endsWith(".sqlite"),
        ),
      ).toBe(true);
    } finally {
      retained.close();
    }
  });
  it("rejects a newer database schema without mutating the database", async () => {
    const { store, directory } = await fixture();
    store.close();
    const path = join(directory, "research.sqlite"),
      future = new DatabaseSync(path);
    future.exec("PRAGMA user_version=6; PRAGMA wal_checkpoint(TRUNCATE);");
    future.close();
    const before = contentHash(await readFile(path));
    expect(() => new ResearchStore(directory)).toThrow(/newer Acadia version/);
    expect(contentHash(await readFile(path))).toBe(before);
  });
});
