import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  ResearchStore,
  contentHash,
  validateResearchArchive,
  snapshotHash,
} from "../src/main/research-store";
import { ResearchService } from "../src/main/research-service";
import { createBlankProject } from "../src/shared/project";
import { createGap, createDecision } from "../src/shared/pedigree";
import {
  pedigreeAppendix,
  pedigreeChanged,
  analyticalChecks,
} from "../src/shared/report-pedigree";
import type { Citation, Passage, ResearchJob } from "../src/shared/research";
import type { ItemInsight } from "../src/shared/item-insight";

const roots = new Set<string>(),
  stores = new Set<ResearchStore>(),
  services = new Set<ResearchService>();
const stamp = "2026-09-30T10:00:00.000Z";
function fixture() {
  const path = mkdtempSync(join(tmpdir(), "acadia-v1-backend-"));
  roots.add(path);
  const store = new ResearchStore(path);
  stores.add(store);
  const project = createBlankProject();
  project.question = "Does Cedar improve field performance?";
  project.privacy = {
    mode: "local",
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "fixture",
  };
  store.saveProject(project);
  const service = new ResearchService(
    store,
    {
      startCapture() {
        throw new Error("No external capture");
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
  services.add(service);
  const add = (id: string, texts: string[], pin = false) => {
    store.saveSource({
      id,
      projectId: project.id,
      title: id,
      kind: "document",
      currentVersionId: `${id}-v1`,
      inclusion: pin ? "pin" : "include",
      createdAt: stamp,
      updatedAt: stamp,
    });
    const passages: Passage[] = texts.map((text, index) => ({
      id: `${id}-p${index + 1}`,
      sourceId: id,
      versionId: `${id}-v1`,
      text,
      locator: `Page ${index + 1}`,
      page: index + 1,
      method: "native",
      inclusion: "include",
    }));
    store.addVersion(
      {
        id: `${id}-v1`,
        sourceId: id,
        title: id,
        author: "Fixture researcher",
        publisher: "Fictional institute",
        doi: "10.0000/fictional-fixture",
        hash: contentHash(texts.join("\n")),
        acquiredAt: stamp,
        status: "ready",
        method: "native",
        totalUnits: texts.length,
        processedUnits: texts.length,
      },
      passages,
    );
    return passages;
  };
  return { path, store, project, service, add };
}
afterEach(async () => {
  await Promise.all([...services].map((service) => service.shutdown()));
  services.clear();
  for (const store of stores) store.close();
  stores.clear();
  for (const path of roots) rmSync(path, { recursive: true, force: true });
  roots.clear();
  vi.unstubAllGlobals();
});
async function finished(store: ResearchStore, job: ResearchJob) {
  await vi.waitFor(() =>
    expect(["completed", "failed", "cancelled"]).toContain(
      store.getJob(job.id)?.status,
    ),
  );
  return store.getJob(job.id)!;
}
describe("v1 production research boundaries", () => {
  it("builds full historical snapshots in a cancellable worker and returns only validation context", async () => {
    const { store, project, add } = fixture();
    add("history", ["Original exact historical passage."]);
    store.addVersion(
      {
        id: "history-v2",
        sourceId: "history",
        title: "Revised source",
        hash: contentHash("Revised passage"),
        acquiredAt: stamp,
        status: "ready",
        method: "native",
        totalUnits: 1,
        processedUnits: 1,
      },
      [
        {
          id: "history-v2-p1",
          sourceId: "history",
          versionId: "history-v2",
          text: "Revised passage",
          locator: "Page 1",
          method: "native",
          inclusion: "include",
        },
      ],
    );
    const context = await store.createPedigreeSnapshotAsync(project.id, {
      passageIds: ["history-p1"],
    });
    expect(context).not.toHaveProperty("passages");
    const snapshot = store.getPedigreeSnapshot(context.id);
    expect(snapshot.passages.map((p) => p.id)).toEqual([
      "history-p1",
      "history-v2-p1",
    ]);
    expect(snapshot.hash).toBe(snapshotHash(snapshot));
    expect(
      validateResearchArchive(
        store.exportResearch(project.id),
        project.id,
      ).pedigreeSnapshots?.find((s) => s.id === context.id),
    ).toEqual(snapshot);
    await expect(
      store.createPedigreeSnapshotAsync(project.id, {
        passageIds: ["foreign-passage"],
      }),
    ).rejects.toThrow(/outside this investigation/);
    const controller = new AbortController();
    const pending = store.createPedigreeSnapshotAsync(
      project.id,
      {},
      controller.signal,
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(store.getPedigreeSnapshot(context.id)).toEqual(snapshot);
  });
  it("retrieves unpinned counterevidence despite more than sixty higher-priority pins", async () => {
    const { store, project, service, add } = fixture();
    project.privacy = { mode: "local", provider: "offline" };
    for (let i = 0; i < 135; i++)
      add(
        `pin-${i}`,
        [
          `Cedar field performance benefits improves successful observation ${i}.`,
        ],
        true,
      );
    add("negative", [
      "Independent Cedar controlled field test found no improvement. Negative result contradicts claimed performance benefit.",
    ]);
    add("unknown", [
      "Cedar field performance causal mechanism remains unknown. Missing observation: randomized matched seasonal control.",
    ]);
    // Legacy pin-prioritized search demonstrates why balancing only after search is insufficient.
    expect(
      store
        .search(project.id, "Cedar", 40)
        .every((hit) => hit.sourceId.startsWith("pin-")),
    ).toBe(true);
    expect(
      store
        .searchCandidates(project.id, "Cedar", 40)
        .map((hit) => hit.sourceId),
    ).toContain("negative");
    const output = await service.analyze(project, "decision-brief", "");
    const run = store.getAnalysisRun(project.id, output.runId!);
    expect(
      run.citations.some((citation) => citation.sourceId === "negative"),
    ).toBe(true);
    expect(
      run.retrieval?.selections.find(
        (selection) => selection.passageId === "negative-p1",
      )?.pool,
    ).not.toBe("pins");
    expect(
      run.retrieval?.omissions.some(
        (omission) =>
          omission.passageId.startsWith("pin-") &&
          omission.reason === "context-budget",
      ),
    ).toBe(true);
  });
  it("retrieves a late contradiction from a pinned source as well as preserving unpinned candidates", async () => {
    const { store, project, service, add } = fixture();
    project.privacy = { mode: "local", provider: "offline" };
    add(
      "pinned-long",
      [
        ...Array.from(
          { length: 180 },
          (_, i) =>
            `Cedar performance administrative context ${i}; no effectiveness measurement.`,
        ),
        "Cedar counterevidence contradiction failure adverse: the matched controlled field experiment found no improvement.",
      ],
      true,
    );
    add("unpinned-control", [
      "Cedar counterevidence contradiction failure adverse: independent matched test found no improvement.",
    ]);
    const candidates = await store.searchCandidatesBatchAsync(project.id, [
      "counterevidence contradiction failure adverse",
    ]);
    expect(candidates[0].map((p) => p.id)).toEqual(
      expect.arrayContaining(["pinned-long-p181", "unpinned-control-p1"]),
    );
    const output = await service.analyze(project, "decision-brief", "");
    expect(output.citations?.map((c) => c.passageId)).toEqual(
      expect.arrayContaining(["pinned-long-p181", "unpinned-control-p1"]),
    );
    const run = store.getAnalysisRun(project.id, output.runId!);
    expect(
      run.retrieval?.selections.find((p) => p.passageId === "pinned-long-p181")
        ?.matchedPools,
    ).toContain("counter");
    expect(
      run.retrieval?.omissions.some(
        (p) =>
          p.passageId.startsWith("pinned-long-") &&
          p.reason === "context-budget",
      ),
    ).toBe(true);
  });
  it("persists isolated optimistic private drafts across reopen/archive without accepting any evidence", () => {
    const { store, project, path } = fixture();
    const original = store.exportResearch(project.id);
    const draft = store.saveResearchDraft({
      projectId: project.id,
      key: `claim:${project.id}:new`,
      kind: "claim",
      value: { title: "Unfinished private wording", links: [] },
      expectedRevision: 0,
    });
    expect(() =>
      store.saveResearchDraft({ ...draft, expectedRevision: 0 }),
    ).toThrow(/another editor/);
    const revised = store.saveResearchDraft({
      ...draft,
      value: { title: "Corrected but still private" },
      expectedRevision: 1,
    });
    expect(() => store.deleteResearchDraft(project.id, draft.key, 1)).toThrow(
      /newer writing/,
    );
    expect(store.state(project.id).claims).toEqual(original.claims);
    expect(store.getProject(project.id)?.outputs).toEqual([]);
    const archive = validateResearchArchive(
      store.exportResearch(project.id),
      project.id,
    );
    expect(archive.schemaVersion).toBe(5);
    expect(archive.drafts).toEqual([revised]);
    store.close();
    stores.delete(store);
    const reopened = new ResearchStore(path);
    stores.add(reopened);
    expect(reopened.researchDrafts(project.id)).toEqual([revised]);
    const target = fixture();
    target.store.importResearch(project.id, archive);
    target.store.saveProject(project);
    expect(target.store.researchDrafts(project.id)).toEqual([revised]);
    expect(() =>
      validateResearchArchive({ ...archive, schemaVersion: 4 }, project.id),
    ).toThrow(/version 5/);
    expect(() =>
      validateResearchArchive(
        { ...archive, drafts: [{ ...revised, projectId: "foreign" }] },
        project.id,
      ),
    ).toThrow(/owner/);
    expect(() =>
      reopened.saveResearchDraft({
        projectId: project.id,
        key: "secret",
        kind: "report",
        value: { apiKey: "must-not-persist" },
        expectedRevision: 0,
      }),
    ).toThrow(/credentials/);
    expect(
      readFileSync(join(path, "research.sqlite")).includes(
        Buffer.from("must-not-persist"),
      ),
    ).toBe(false);
    reopened.deleteResearchDraft(project.id, draft.key, 2);
    expect(reopened.researchDrafts(project.id)).toEqual([]);
  });
  it("backs up a v4 library before v5 without manufacturing private drafts or changing historical evidence", () => {
    const { store, project, path, add } = fixture();
    add("retained", ["Historical evidence remains exact."]);
    const snapshot = store.createPedigreeSnapshot(project.id),
      before = store.exportResearch(project.id);
    store.close();
    stores.delete(store);
    const legacy = new DatabaseSync(join(path, "research.sqlite"));
    try {
      legacy.exec(
        "DROP TABLE private_drafts; PRAGMA user_version=4; PRAGMA wal_checkpoint(TRUNCATE);",
      );
    } finally {
      legacy.close();
    }
    const upgraded = new ResearchStore(path);
    stores.add(upgraded);
    expect(upgraded.migrationBackupPath).toContain("to-v5");
    const backup = new DatabaseSync(upgraded.migrationBackupPath!, {
      readOnly: true,
    });
    try {
      expect(
        (
          backup.prepare("PRAGMA user_version").get() as {
            user_version: number;
          }
        ).user_version,
      ).toBe(4);
    } finally {
      backup.close();
    }
    expect(upgraded.researchDrafts(project.id)).toEqual([]);
    expect(upgraded.exportResearch(project.id).passages).toEqual(
      before.passages,
    );
    expect(upgraded.getPedigreeSnapshot(snapshot.id)).toEqual(snapshot);
  });
  it("pages complete source history and search while keeping model prompts out of routine state", () => {
    const { store, project, add } = fixture();
    add(
      "long",
      Array.from(
        { length: 245 },
        (_, index) => `Cedar searchable historical observation ${index + 1}.`,
      ),
    );
    expect(
      store.searchSourcesPage(project.id, "Cedar", { offset: 240, limit: 20 }),
    ).toMatchObject({ total: 245, offset: 240, items: expect.any(Array) });
    expect(
      store.searchSourcesPage(project.id, "Cedar", { offset: 240, limit: 20 })
        .items,
    ).toHaveLength(5);
    expect(
      store.getSourcePassagesPage(project.id, "long", undefined, "245").items[0]
        .id,
    ).toBe("long-p245");
    const other = createBlankProject();
    store.saveProject(other);
    expect(() => store.getSourcePassagesPage(other.id, "long")).toThrow(
      /another investigation/,
    );
    for (let i = 0; i < 105; i++)
      store.saveRun({
        id: `run-${i}`,
        projectId: project.id,
        question: project.question,
        instructions: "PRIVATE FULL INSTRUCTIONS",
        kind: "fixture",
        createdAt: stamp,
        provider: "fixture",
        model: "fixture",
        templateVersion: "v1",
        citations: [],
        exclusions: [],
        sourceVersions: [],
        response: "PRIVATE FULL RESPONSE",
        status: "completed",
        requests: [
          {
            provider: "fixture",
            endpoint: "http://127.0.0.1",
            model: "fixture",
            messages: [{ role: "user", content: "PRIVATE PROMPT" }],
            parameters: {},
          },
        ],
      });
    const state = store.state(project.id, { lightweight: true });
    expect(state.runCount).toBe(105);
    expect(state.runs).toHaveLength(100);
    expect(JSON.stringify(state)).not.toContain("PRIVATE");
    expect(state.runs.every((run) => run.summaryOnly)).toBe(true);
    expect(
      store.listAnalysisRunsPage(project.id, { offset: 100, limit: 20 }).items,
    ).toHaveLength(5);
    expect(store.getAnalysisRun(project.id, "run-0").instructions).toBe(
      "PRIVATE FULL INSTRUCTIONS",
    );
    expect(() => store.getAnalysisRun(other.id, "run-0")).toThrow(
      /unavailable/,
    );
    expect(
      store.exportResearch(project.id).runs[0].requests?.[0].messages[0]
        .content,
    ).toBe("PRIVATE PROMPT");
  });
  it("serializes model work, cancels queued work before transmission and settles shutdown", async () => {
    const { store, project, service, add } = fixture();
    add("one", ["Cedar result remains uncertain."]);
    const fetcher = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const first = service.summarizeItem(project, { kind: "source", id: "one" });
    const second = service.summarizeItem(project, {
      kind: "source",
      id: "one",
    });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(store.getJob(second.id)?.status).toBe("queued");
    service.cancelJob(second.id);
    expect(store.getJob(second.id)?.message).toContain("no request was sent");
    await service.shutdown();
    expect((await finished(store, first)).status).toBe("cancelled");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(() =>
      service.summarizeItem(project, { kind: "source", id: "one" }),
    ).toThrow(/shutting down/);
  });
  it("includes gaps, decisions and accepted-review provenance in appendix and stale checks without changing snapshots", () => {
    const { store, project, add } = fixture();
    const passages = add("basis", ["A controlled observation is missing."]);
    const gap = store.saveGap({
      ...createGap(project.id),
      title: "Control gap",
      missingInformation: "Matched control",
      resolutionCriteria: "Run comparison",
      passageIds: [passages[0].id],
    });
    const decision = store.saveDecision({
      ...createDecision(project.id),
      title: "Commission trial",
      action: "Measure a control",
      rationale: "Causality is unknown",
    });
    const snapshot = store.createPedigreeSnapshot(project.id),
      frozen = JSON.stringify(snapshot);
    const appendix = pedigreeAppendix(snapshot, []);
    expect(appendix.markdown).toContain("### Evidence gaps");
    expect(appendix.markdown).toContain("Control gap");
    expect(appendix.markdown).toContain("### Decisions");
    expect(appendix.citations[0]).toMatchObject({
      author: "Fixture researcher",
      doi: "10.0000/fictional-fixture",
    });
    store.saveGap({ ...gap, status: "resolved" });
    store.saveDecision({ ...decision, status: "made" });
    expect(
      pedigreeChanged(
        snapshot,
        store.pedigreeState(project.id),
        store.state(project.id),
      ),
    ).toEqual(expect.arrayContaining(["gaps", "decisions"]));
    expect(
      analyticalChecks(
        store.pedigreeState(project.id),
        store.state(project.id),
      ).some((check) => check.id === `decision-basis-${decision.id}`),
    ).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(frozen);
  });
  it("relabels accepted-review citations in the appendix and flags changed historical basis", async () => {
    const { store, project, service, add } = fixture();
    add("reviewed", ["The uncontrolled pilot does not establish causality."]);
    const unrelated = add("context", [
      "Context source has a different original reference.",
    ])[0];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              message: {
                content: JSON.stringify({
                  markdown:
                    "## Summary\n\nCausal support remains unassessed. [1]",
                }),
              },
            }),
          ),
      ),
    );
    const job = await finished(
      store,
      service.summarizeItem(project, { kind: "source", id: "reviewed" }),
    );
    expect(job.status, job.message).toBe("completed");
    const insight = job.result as ItemInsight;
    const accepted = service.acceptItemInsight(project, {
      runId: insight.runId,
      notes: "A controlled comparison is still needed. [1]",
    });
    const snapshot = store.createPedigreeSnapshot(project.id),
      frozen = JSON.stringify(snapshot);
    const citation: Citation = {
      id: "already-cited",
      label: "1",
      sourceId: unrelated.sourceId,
      versionId: unrelated.versionId,
      passageId: unrelated.id,
      sourceTitle: "Context",
      locator: unrelated.locator,
      quote: unrelated.text,
      verified: true,
      acquiredAt: stamp,
    };
    const appendix = pedigreeAppendix(snapshot, [citation]);
    expect(appendix.markdown).toContain("### Accepted Reviewer Notes");
    expect(appendix.markdown).toContain(
      "A controlled comparison is still needed. [2]",
    );
    expect(appendix.markdown).toContain(insight.runId);
    const completed = store.getAnalysisRun(project.id, insight.runId);
    for (let index = 0; index < 105; index++) {
      const { itemInsight: _insight, ...record } = completed;
      store.saveRun({ ...record, id: `newer-run-${index}`, kind: "fixture" });
    }
    const currentBrief = store.pedigreeState(project.id).briefs[0];
    store.saveBrief({
      ...currentBrief,
      scope: "New scope with the same question",
    });
    const light = store.state(project.id, { lightweight: true });
    expect(light.runs.some((run) => run.id === insight.runId)).toBe(false);
    expect(light.runs).toHaveLength(100);
    expect(light.itemReviewBases).toEqual([
      {
        runId: insight.runId,
        question: insight.question,
        briefRevision: insight.briefRevision,
      },
    ]);
    expect(
      analyticalChecks(store.pedigreeState(project.id), light).some(
        (check) => check.id === `stale-review-${accepted.id}`,
      ),
    ).toBe(true);
    store.addVersion(
      {
        id: "reviewed-v2",
        sourceId: "reviewed",
        title: "New report",
        hash: contentHash("Changed observation"),
        acquiredAt: stamp,
        status: "ready",
        method: "native",
        totalUnits: 1,
        processedUnits: 1,
      },
      [
        {
          id: "reviewed-v2-p1",
          sourceId: "reviewed",
          versionId: "reviewed-v2",
          text: "Changed observation",
          locator: "Page 1",
          method: "native",
          inclusion: "include",
        },
      ],
    );
    expect(
      analyticalChecks(
        store.pedigreeState(project.id),
        store.state(project.id),
      ).some((check) => check.id === `stale-review-${accepted.id}`),
    ).toBe(true);
    expect(JSON.stringify(snapshot)).toBe(frozen);
    expect(
      store.state(project.id).claims[0].itemReview?.citations[0].versionId,
    ).toBe("reviewed-v1");
  });
});
