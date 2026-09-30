import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResearchStore,
  snapshotHash,
  validateResearchArchive,
} from "../src/main/research-store";
import { ResearchService } from "../src/main/research-service";
import { createBlankProject, validateProject } from "../src/shared/project";
import {
  createAssumption,
  createDecision,
  createGap,
  createMethodWorksheet,
} from "../src/shared/pedigree";
import {
  boardRecordSignature,
  validateBoardReference,
  type BoardReference,
} from "../src/shared/board";
import type { ResearchJob } from "../src/shared/research";
import type { ItemInsight } from "../src/shared/item-insight";

const fixtures: { store: ResearchStore; path: string }[] = [];
const timestamp = "2026-09-29T12:00:00.000Z";
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "acadia-board-")),
    store = new ResearchStore(path),
    project = createBlankProject();
  fixtures.push({ store, path });
  project.question = "Does Cedar need another trial?";
  project.privacy = {
    mode: "local",
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "fixture",
  };
  project.cards.push({
    id: "original-source-card",
    title: "Original Cedar note",
    kind: "note",
    content:
      "The Cedar pilot needs a controlled comparison.\n\nThe Cedar field result remains provisional.",
    x: 37,
    y: 91,
    tags: [],
    status: "unreviewed",
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  store.saveProject(project);
  const source = store.getSource(project.cards[0].sourceId!);
  const service = new ResearchService(
    store,
    {
      startCapture: () => {
        throw new Error("No outside research");
      },
    },
    () => ({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "fixture",
    }),
    () => undefined,
    () => {},
  );
  return { path, store, project, source, service };
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const { store, path } of fixtures.splice(0)) {
    try {
      store.close();
    } catch {}
    rmSync(path, { recursive: true, force: true });
  }
});
async function finish(store: ResearchStore, job: ResearchJob) {
  for (let i = 0; i < 200; i++) {
    const state = store.getJob(job.id)!;
    if (["completed", "failed", "cancelled"].includes(state.status))
      return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Summary job did not finish");
}
function model(check?: (input: any) => void) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body),
        input = JSON.parse(request.messages[1].content);
      check?.(input);
      return new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              markdown: `## Summary\n\nThis material needs further review.${input.source_passages.length ? " [1]" : ""}`,
            }),
          },
        }),
      );
    }),
  );
}

describe("canonical research-to-delivery board references", () => {
  it("places every record type, deduplicates placement, and creates no independent source or ancestry mutation", async () => {
    const { store, project, source, service } = fixture();
    const claim = {
      id: "finding",
      projectId: project.id,
      title: "Field result remains uncertain",
      question: project.question,
      status: "provisional" as const,
      alternatives: "Seasonal changes",
      limitations: "No controlled comparison",
      links: [],
      updatedAt: timestamp,
    };
    store.saveClaim(claim);
    store.saveTask({
      id: "followup",
      projectId: project.id,
      title: "Design a controlled trial",
      question: project.question,
      status: "planned",
      criterion: "Approved protocol",
      sourceIds: [source.source.id],
      updatedAt: timestamp,
    });
    const assumption = store.saveAssumption({
      ...createAssumption(project.id),
      statement: "The next site is comparable",
    });
    const method = store.saveMethod({
      ...createMethodWorksheet(project.id, "swot"),
      objective: "Compare trial options",
    });
    const gap = store.saveGap({
      ...createGap(project.id),
      title: "Missing controlled observation",
      claimIds: [claim.id],
      taskIds: ["followup"],
    });
    project.outputs.push(
      {
        id: "report",
        kind: "decision-brief",
        title: "Research decision",
        markdown: "Review the uncertain findings.",
        createdAt: timestamp,
        provider: "researcher",
        sourceIds: [],
        boardUpdatedAt: timestamp,
      },
      {
        id: "plan",
        kind: "project-plan",
        title: "Trial deliverable",
        markdown: "Design and validate a test protocol.",
        createdAt: timestamp,
        provider: "researcher",
        sourceIds: [],
        boardUpdatedAt: timestamp,
      },
    );
    store.saveProject(project);
    const decision = store.saveDecision({
      ...createDecision(project.id),
      title: "Commission trial",
      claimIds: [claim.id],
      assumptionIds: [assumption.id],
      outputIds: ["report"],
    });
    model();
    const insight = (
      await finish(
        store,
        service.summarizeItem(project, {
          kind: "source",
          id: source.source.id,
        }),
      )
    ).result as ItemInsight;
    const review = service.acceptItemInsight(project, {
      runId: insight.runId,
      notes: "Reviewed interpretation remains conditional. [1]",
    });
    const references: BoardReference[] = [
      { kind: "brief", id: store.pedigreeState(project.id).briefs[0].id },
      { kind: "source", id: source.source.id },
      {
        kind: "passage",
        id: source.passages[0].id,
        versionId: source.passages[0].versionId,
      },
      { kind: "claim", id: claim.id },
      { kind: "review", id: review.id },
      { kind: "assumption", id: assumption.id },
      { kind: "task", id: "followup" },
      { kind: "method", id: method.id },
      { kind: "gap", id: gap.id },
      { kind: "decision", id: decision.id },
      { kind: "report", id: "report" },
      { kind: "delivery-plan", id: "plan" },
    ];
    let board = project;
    for (const reference of references) {
      const result = store.addBoardReference(board, reference);
      board = result.project;
      expect(store.addBoardReference(board, reference).cardId).toBe(
        result.cardId,
      );
    }
    expect(board.cards).toHaveLength(12); // Existing original source is focused, not duplicated.
    expect(store.state(project.id).sources).toHaveLength(1);
    expect(store.listProjects()[0].sourceCount).toBe(1);
    expect(store.getSource(source.source.id).source.cardId).toBe(
      "original-source-card",
    );
    expect(
      store.state(project.id).claims.find((entry) => entry.id === claim.id)
        ?.cardId,
    ).toBeUndefined();
    expect(
      board.cards.find((entry) => entry.methodId === method.id),
    ).toMatchObject({
      content: method.objective,
      tags: ["method", "swot"],
      boardReference: { kind: "method", id: method.id },
    });
    const archive = validateResearchArchive(
      store.exportResearch(project.id),
      project.id,
      undefined,
      board.cards,
    );
    expect(archive.schemaVersion).toBe(4);
    expect(archive.pedigree?.gaps[0].id).toBe(gap.id);
    expect(archive.pedigree?.decisions[0].id).toBe(decision.id);
    const destination = fixture();
    destination.store.importResearch(project.id, archive, {
      projectCards: board.cards,
    });
    destination.store.saveProject(board);
    expect(destination.store.getProject(project.id)?.cards).toEqual(
      board.cards,
    );
    expect(destination.store.pedigreeState(project.id).decisions[0]).toEqual(
      decision,
    );
    expect(
      destination.store.resolveBoardReference(board, {
        kind: "passage",
        id: source.passages[0].id,
        versionId: source.passages[0].versionId,
      }).content,
    ).toBe(source.passages[0].text);
    expect(() => store.deleteClaim(claim.id)).toThrow(/referenced/);
    expect(() => store.deleteTask("followup")).toThrow(/referenced/);
    const reviewCard = board.cards.find(
      (entry) => entry.boardReference?.kind === "review",
    )!;
    store.setPassagePolicy(
      review.itemReview!.citations[0].passageId,
      "exclude",
    );
    const requestsBefore = vi.mocked(fetch).mock.calls.length;
    expect(() =>
      service.summarizeItem(board, { kind: "card", id: reviewCard.id }),
    ).toThrow(/excluded source or passage/);
    expect(vi.mocked(fetch).mock.calls).toHaveLength(requestsBefore);
  });

  it("retains historical passage placement and unavailable deleted records while rejecting malformed and foreign references", () => {
    const { store, project, source } = fixture();
    const passage = source.passages[0];
    const result = store.addBoardReference(project, {
      kind: "passage",
      id: passage.id,
      versionId: passage.versionId,
    });
    const board = result.project;
    board.cards[0].content = "Updated Cedar observation.";
    store.saveProject(board);
    expect(
      store.resolveBoardReference(
        board,
        board.cards.find((card) => card.id === result.cardId)!.boardReference!,
      ).content,
    ).toBe(passage.text);
    expect(() =>
      store.addBoardReference(board, {
        kind: "passage",
        id: passage.id,
        versionId: store.getSource(source.source.id).source.currentVersionId,
      }),
    ).toThrow(/exact historical/);
    expect(() =>
      validateBoardReference({ kind: "passage", id: passage.id }),
    ).toThrow();
    expect(() =>
      validateBoardReference({
        kind: "claim",
        id: "finding",
        versionId: passage.versionId,
      }),
    ).toThrow();
    const unavailable = structuredClone(board);
    unavailable.cards.push({
      ...unavailable.cards[1],
      id: "removed-record-card",
      boardReference: { kind: "claim", id: "removed-claim" },
    });
    store.saveProject(unavailable);
    expect(
      store.resolveBoardReference(
        unavailable,
        unavailable.cards.at(-1)!.boardReference!,
        false,
      ).available,
    ).toBe(false);
    const other = createBlankProject();
    store.saveProject(other);
    const foreign = store.saveMethod({
      ...createMethodWorksheet(other.id, "risk"),
      title: "Other investigation",
    });
    expect(() =>
      store.addBoardReference(board, { kind: "method", id: foreign.id }),
    ).toThrow(/another investigation/);
    const forged = structuredClone(board);
    forged.cards[1].boardReference = { kind: "method", id: foreign.id };
    expect(() => store.saveProject(forged)).toThrow(/another investigation/);
    const malformed = structuredClone(board);
    malformed.cards[1].boardReference = {
      kind: "claim",
      id: "x",
      versionId: "x",
    };
    expect(() => validateProject(malformed)).toThrow(/Invalid board reference/);
  });

  it("summarizes source, exact historical passage, current method and updated derived record from canonical data", async () => {
    const { store, project, source, service } = fixture();
    // Add a historical source pin so a source reference has its own placement.
    const previous = source.source.currentVersionId;
    project.cards[0].content = "New Cedar note is different.";
    store.saveProject(project);
    let result = store.addBoardReference(project, {
      kind: "source",
      id: source.source.id,
      versionId: previous,
    });
    model((input) => {
      expect(input.source_passages).toHaveLength(2);
      expect(input.source_passages[0].text).toContain("controlled comparison");
    });
    expect(
      (
        await finish(
          store,
          service.summarizeItem(result.project, {
            kind: "card",
            id: result.cardId,
          }),
        )
      ).status,
    ).toBe("completed");
    result = store.addBoardReference(result.project, {
      kind: "passage",
      id: source.passages[1].id,
      versionId: previous,
    });
    model((input) => {
      expect(input.source_passages).toHaveLength(1);
      expect(input.source_passages[0].passageId).toBe(source.passages[1].id);
    });
    expect(
      (
        await finish(
          store,
          service.summarizeItem(result.project, {
            kind: "card",
            id: result.cardId,
          }),
        )
      ).status,
    ).toBe("completed");
    let method = store.saveMethod({
      ...createMethodWorksheet(project.id, "swot"),
      objective: "Initial objective",
    });
    result = store.addBoardReference(result.project, {
      kind: "method",
      id: method.id,
    });
    method = store.saveMethod({
      ...method,
      objective: "CURRENT CANONICAL OBJECTIVE",
    });
    model((input) => {
      expect(input.linked_method.objective).toBe(method.objective);
      expect(input.source_passages).toHaveLength(0);
    });
    expect(
      (
        await finish(
          store,
          service.summarizeItem(result.project, {
            kind: "card",
            id: result.cardId,
          }),
        )
      ).status,
    ).toBe("completed");
    let gap = store.saveGap({
      ...createGap(project.id),
      title: "Missing test",
      missingInformation: "Old gap",
    });
    result = store.addBoardReference(result.project, {
      kind: "gap",
      id: gap.id,
    });
    gap = store.saveGap({
      ...gap,
      missingInformation: "CURRENT CANONICAL GAP",
    });
    model((input) => {
      expect(input.researcher_notes.text).toContain(gap.missingInformation);
      expect(input.source_passages).toHaveLength(0);
      expect(input.coverage.warnings.join(" ")).toContain(
        "not an independent original source",
      );
    });
    const gapResult = await finish(
      store,
      service.summarizeItem(result.project, {
        kind: "card",
        id: result.cardId,
      }),
    );
    expect(gapResult.status).toBe("completed");
    const gapInsight = gapResult.result as ItemInsight;
    expect(gapInsight.boardRecordSignature).toBe(boardRecordSignature(gap));
    expect(boardRecordSignature({ a: 1, b: 2 })).toBe(
      boardRecordSignature({ b: 2, a: 1 }),
    );
    expect(
      boardRecordSignature({
        ...gap,
        missingInformation: "Changed after summary",
      }),
    ).not.toBe(gapInsight.boardRecordSignature);
    const archived = validateResearchArchive(
      store.exportResearch(project.id),
      project.id,
      undefined,
      result.project.cards,
    );
    expect(
      archived.runs.find((run) => run.id === gapInsight.runId)?.itemInsight
        ?.boardRecordSignature,
    ).toBe(gapInsight.boardRecordSignature);
    expect(store.state(project.id).sources).toHaveLength(1);
  });

  it("backs up v3 and excludes old method-card text while preserving historical citations and snapshot hash", () => {
    const { store, path, project, source } = fixture();
    const method = store.saveMethod({
      ...createMethodWorksheet(project.id, "swot"),
      objective: "Canonical method objective",
    });
    const snapshot = store.createPedigreeSnapshot(project.id);
    // Simulate a real v3 snapshot without the newly introduced collections.
    delete (snapshot.state as any).gaps;
    delete (snapshot.state as any).decisions;
    snapshot.hash = snapshotHash(snapshot);
    const legacy = structuredClone(project);
    legacy.schemaVersion = 3;
    legacy.cards[0].methodId = method.id;
    store.close();
    const db = new DatabaseSync(join(path, "research.sqlite"));
    db.prepare("UPDATE projects SET data=? WHERE id=?").run(
      JSON.stringify(legacy),
      legacy.id,
    );
    db.prepare("UPDATE pedigree_snapshots SET data=? WHERE id=?").run(
      JSON.stringify(snapshot),
      snapshot.id,
    );
    db.exec("PRAGMA user_version=3; PRAGMA wal_checkpoint(TRUNCATE);");
    db.close();
    const migrated = new ResearchStore(path);
    fixtures.push({ store: migrated, path });
    expect(migrated.migrationBackupPath).toContain("to-v4");
    const backup = new DatabaseSync(migrated.migrationBackupPath!, {
      readOnly: true,
    });
    expect(
      (backup.prepare("PRAGMA user_version").get() as any).user_version,
    ).toBe(3);
    backup.close();
    expect(migrated.getProject(project.id)?.schemaVersion).toBe(4);
    expect(migrated.getSource(source.source.id).source).toMatchObject({
      derived: true,
      inclusion: "exclude",
    });
    expect(migrated.getPassage(source.passages[0].id).text).toBe(
      source.passages[0].text,
    );
    expect(migrated.search(project.id, "Cedar")).toHaveLength(0);
    expect(migrated.listProjects()[0].sourceCount).toBe(0);
    expect(() => migrated.setSourcePolicy(source.source.id, "include")).toThrow(
      /independent source/,
    );
    const archive = validateResearchArchive(
      migrated.exportResearch(project.id),
      project.id,
      undefined,
      migrated.getProject(project.id)!.cards,
    );
    expect(archive.pedigreeSnapshots![0].hash).toBe(snapshot.hash);
    expect(archive.pedigreeSnapshots![0].sources[0].inclusion).toBe("include");
  });
});
