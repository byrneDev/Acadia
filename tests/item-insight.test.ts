import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ResearchStore,
  contentHash,
  validateResearchArchive,
} from "../src/main/research-store";
import { ResearchService } from "../src/main/research-service";
import { createBlankProject } from "../src/shared/project";
import { createMethodRow, createMethodWorksheet } from "../src/shared/pedigree";
import type { AISettings, ResearchCard } from "../src/shared/types";
import type { ResearchJob } from "../src/shared/research";
import type { ItemInsight } from "../src/shared/item-insight";

const fixtures: { store: ResearchStore; path: string }[] = [];
const local: AISettings = {
  provider: "ollama",
  endpoint: "http://127.0.0.1:11434",
  model: "fixture-model",
};
const stamp = "2026-09-29T12:00:00.000Z";
function fixture(settings = local) {
  const path = mkdtempSync(join(tmpdir(), "acadia-item-summary-"));
  const store = new ResearchStore(path);
  fixtures.push({ store, path });
  const project = createBlankProject();
  project.question =
    "Does the Cedar prototype need another controlled field trial?";
  project.privacy = {
    mode: "local",
    provider: settings.provider,
    endpoint: settings.endpoint,
    model: settings.model,
  };
  store.saveProject(project);
  const service = new ResearchService(
    store,
    {
      startCapture: () => {
        throw new Error("No web capture is allowed");
      },
    },
    () => settings,
    () => undefined,
    () => {},
  );
  const addCard = (
    id: string,
    content: string,
    patch: Partial<ResearchCard> = {},
  ) => {
    project.cards.push({
      id,
      kind: "note",
      title: id,
      content,
      x: 0,
      y: 0,
      tags: [],
      status: "unreviewed",
      createdAt: stamp,
      updatedAt: stamp,
      ...patch,
    });
    store.saveProject(project);
    return project.cards.find((entry) => entry.id === id)!;
  };
  const addSource = (
    id: string,
    texts: string[],
    status: "ready" | "partial" | "failed" = "ready",
  ) => {
    store.saveSource({
      id,
      projectId: project.id,
      title: id,
      kind: "document",
      currentVersionId: `${id}-v1`,
      inclusion: "include",
      createdAt: stamp,
      updatedAt: stamp,
    });
    store.addVersion(
      {
        id: `${id}-v1`,
        sourceId: id,
        title: id,
        hash: contentHash(texts.join("\n")),
        acquiredAt: stamp,
        status,
        method: "native",
        totalUnits: texts.length + (status === "partial" ? 3 : 0),
        processedUnits: texts.length,
      },
      texts.map((text, index) => ({
        id: `${id}-p${index + 1}`,
        sourceId: id,
        versionId: `${id}-v1`,
        text,
        locator: `Page ${index + 1}`,
        page: index + 1,
        method: "native",
        inclusion: "include",
      })),
    );
    return id;
  };
  return { store, project, service, addCard, addSource };
}
function model(answer?: (input: any, request: any) => unknown) {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)),
      input = JSON.parse(request.messages[1].content);
    return new Response(
      JSON.stringify({
        message: {
          content: JSON.stringify(
            answer
              ? answer(input, request)
              : {
                  markdown: `## Summary\n\nThe recorded observation needs verification.${input.source_passages.length ? " [1]" : ""}\n\n## Use in this investigation\n\nConsider this a lead for the next field trial.\n\n## Limits / cannot conclude\n\nThis item alone cannot establish causality.\n\n## Suggested next steps\n\nPropose a controlled test; no task was created.`,
                },
          ),
        },
      }),
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
async function finish(store: ResearchStore, job: ResearchJob) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const current = store.getJob(job.id)!;
    if (["completed", "failed", "cancelled"].includes(current.status))
      return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Item summary fixture did not finish");
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const fixture of fixtures.splice(0)) {
    fixture.store.close();
    rmSync(fixture.path, { recursive: true, force: true });
  }
});

describe("explicit single-item AI summary and research advice", () => {
  it("samples through the last page, sends no unrelated collection content, and saves exact historical anchors", async () => {
    const { store, project, service, addSource, addCard } = fixture();
    addSource(
      "selected",
      Array.from(
        { length: 300 },
        (_, index) =>
          `Page ${index + 1} Cedar observation. ${"Specific measurement data. ".repeat(80)}`,
      ),
    );
    addSource("unrelated", ["PRIVATE UNRELATED SOURCE"]);
    addCard("unrelated-card", "PRIVATE UNRELATED NOTE");
    const before = JSON.stringify({
      cards: project.cards,
      pedigree: store.pedigreeState(project.id),
      claims: store.state(project.id).claims,
      tasks: store.state(project.id).tasks,
    });
    const fetcher = model((input) => {
      expect(JSON.stringify(input)).not.toContain("PRIVATE UNRELATED");
      expect(input.source_passages).toHaveLength(32);
      expect(input.source_passages[0].passageId).toBe("selected-p1");
      expect(input.source_passages.at(-1).passageId).toBe("selected-p300");
      expect(
        input.source_passages.reduce(
          (sum: number, passage: any) => sum + passage.text.length,
          0,
        ),
      ).toBeLessThanOrEqual(18000);
      return {
        markdown:
          "## Summary\n\nCedar measurements were recorded. [1]\n\n## Use in this investigation\n\nPropose checking the final page too. [32]\n\n## Limits / cannot conclude\n\nSampled text is not a full-document review.\n\n## Suggested next steps\n\nVerify the measurement method.",
      };
    });
    const job = service.summarizeItem(project, {
      kind: "source",
      id: "selected",
    });
    expect(store.getJob(job.id)?.itemTarget).toEqual({
      kind: "source",
      id: "selected",
    });
    const done = await finish(store, job),
      insight = done.result as ItemInsight;
    expect(done.status).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(insight.coverage).toMatchObject({
      availablePassages: 300,
      selectedPassages: 32,
      status: "ready",
    });
    expect(insight.coverage.warnings.join(" ")).toContain("first and last");
    expect(insight.citations.at(-1)?.passageId).toBe("selected-p300");
    const run = store
      .state(project.id)
      .runs.find((entry) => entry.id === insight.runId)!;
    expect(run.itemInsight).toEqual(insight);
    expect(insight.briefRevision).toBe(
      store.pedigreeState(project.id).briefs[0].revision,
    );
    expect(run.requests).toHaveLength(1);
    expect(
      JSON.stringify({
        cards: project.cards,
        pedigree: store.pedigreeState(project.id),
        claims: store.state(project.id).claims,
        tasks: store.state(project.id).tasks,
      }),
    ).toBe(before);
    const archive = validateResearchArchive(
      store.exportResearch(project.id),
      project.id,
      undefined,
      project.cards,
    );
    expect(
      archive.runs.find((entry) => entry.id === run.id)?.itemInsight,
    ).toEqual(insight);
  });

  it("honors source and passage exclusions without leaking duplicated note text", async () => {
    const { store, project, service, addCard } = fixture();
    const card = addCard(
      "notes",
      "Cedar sensor performance needs checking.\n\nEXCLUDED SECRET MEASUREMENT.",
    );
    const detail = store.getSource(card.sourceId!);
    store.setPassagePolicy(detail.passages[1].id, "exclude");
    model((input) => {
      expect(JSON.stringify(input)).not.toContain("EXCLUDED SECRET");
      expect(input.researcher_notes.text).toBe("");
      return { markdown: "## Summary\n\nThe sensor needs checking. [1]" };
    });
    const done = await finish(
      store,
      service.summarizeItem(project, { kind: "card", id: card.id }),
    );
    expect(done.status).toBe("completed");
    expect((done.result as ItemInsight).coverage.warnings.join(" ")).toContain(
      "excluded",
    );
    store.setSourcePolicy(card.sourceId!, "exclude");
    expect(() =>
      service.summarizeItem(project, { kind: "card", id: card.id }),
    ).toThrow(/excluded/);
  });

  it("labels uncaptured manual URLs and media annotations without fetching or pretending to read the original", async () => {
    const { store, project, service, addCard } = fixture();
    const link = addCard(
      "link",
      "A colleague suggested comparing Cedar's field protocol.",
      { kind: "link", url: "https://example.com/private-login" },
    );
    const fetcher = model((input, request) => {
      expect(request.messages[0].content).toContain(
        "Do not claim to have viewed media or uncaptured sites",
      );
      expect(input.item.extractionMethod).toBe("manual");
      expect(input.coverage.warnings.join(" ")).toContain("was not accessed");
      return {
        markdown:
          "## Summary\n\nResearcher notes suggest comparing field protocols. [1]",
      };
    });
    expect(
      (
        await finish(
          store,
          service.summarizeItem(project, { kind: "card", id: link.id }),
        )
      ).status,
    ).toBe("completed");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("127.0.0.1");
    const media = addCard(
      "recording",
      "My observation: equipment was outdoors.",
      { kind: "video", assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    );
    model((input) => {
      expect(input.source_passages).toEqual([]);
      expect(input.coverage.warnings.join(" ")).toContain("has not been read");
      return {
        markdown:
          "## Summary\n\nThe researcher noted equipment outdoors; the video was not analyzed.",
      };
    });
    expect(
      (
        await finish(
          store,
          service.summarizeItem(project, { kind: "card", id: media.id }),
        )
      ).status,
    ).toBe("completed");
  });

  it("does not call a model without readable text or in offline mode, and exposes incomplete extraction", async () => {
    const { store, project, service, addSource } = fixture();
    addSource("failed", [], "failed");
    const fetcher = model();
    const failed = await finish(
      store,
      service.summarizeItem(project, { kind: "source", id: "failed" }),
    );
    expect(failed.status).toBe("failed");
    expect(failed.message).toContain("extract/OCR");
    expect(fetcher).not.toHaveBeenCalled();
    addSource("partial", ["Cedar passed one test."], "partial");
    const partial = await finish(
      store,
      service.summarizeItem(project, { kind: "source", id: "partial" }),
    );
    expect((partial.result as ItemInsight).coverage).toMatchObject({
      status: "partial",
      processedUnits: 1,
      totalUnits: 4,
    });
    expect(
      (partial.result as ItemInsight).coverage.warnings.join(" "),
    ).toContain("Missing or failed extraction has not been analyzed");
    project.privacy = { mode: "local", provider: "offline" };
    const offline = await finish(
      store,
      service.summarizeItem(project, { kind: "source", id: "partial" }),
    );
    expect(offline.status).toBe("failed");
    expect(offline.message).toContain("Offline mode");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-project targets and never falls back to a cloud endpoint for local projects", async () => {
    const first = fixture(),
      second = fixture();
    second.addSource("foreign", ["Foreign evidence"]);
    // The service's store does not contain the foreign source: no request/job is created.
    expect(() =>
      first.service.summarizeItem(first.project, {
        kind: "source",
        id: "foreign",
      }),
    ).toThrow();
    expect(() =>
      first.service.summarizeItem(first.project, {
        kind: "card",
        id: "foreign-card",
      }),
    ).toThrow(/current investigation/);
    first.store.saveProject(second.project);
    first.store.saveSource({ ...second.store.getSource("foreign").source });
    const foreignVersion = second.store.getSource("foreign").versions[0];
    first.store.addVersion(
      foreignVersion,
      second.store.getSource("foreign").passages,
    );
    expect(() =>
      first.service.summarizeItem(first.project, {
        kind: "source",
        id: "foreign",
      }),
    ).toThrow(/current investigation/);
    first.addSource("local", ["Selected evidence"]);
    first.project.privacy = {
      mode: "local",
      provider: "compatible",
      endpoint: "https://api.example.com/v1",
      model: "remote",
    };
    const fetcher = model();
    const done = await finish(
      first.store,
      first.service.summarizeItem(first.project, {
        kind: "source",
        id: "local",
      }),
    );
    expect(done.status).toBe("failed");
    expect(done.message).toContain("local-only");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps previous successful insight when a regeneration fabricates a reference or misattributes a quotation", async () => {
    const { store, project, service, addSource } = fixture();
    addSource("selected", [
      "The pilot found improvement.",
      "The controlled test found no improvement.",
    ]);
    model();
    const good = (
      await finish(
        store,
        service.summarizeItem(project, { kind: "source", id: "selected" }),
      )
    ).result as ItemInsight;
    model(() => ({ markdown: "## Summary\n\nA claim [99]" }));
    expect(
      (
        await finish(
          store,
          service.summarizeItem(project, { kind: "source", id: "selected" }),
        )
      ).status,
    ).toBe("failed");
    model(() => ({
      markdown: "## Summary\n\n“The controlled test found no improvement.” [1]",
    }));
    const wrongQuote = await finish(
      store,
      service.summarizeItem(project, { kind: "source", id: "selected" }),
    );
    expect(wrongQuote.status).toBe("failed");
    expect(wrongQuote.message).toContain("absent from the cited source");
    expect(
      store
        .state(project.id)
        .runs.filter((entry) => entry.itemInsight)
        .map((entry) => entry.itemInsight),
    ).toEqual([good]);
    expect(
      store.state(project.id).runs.filter((entry) => entry.status === "failed"),
    ).toHaveLength(2);
  });

  it("cancels in-flight work, preserves earlier insight, and records sanitized model input", async () => {
    const secret = "fixture-credential-never-export",
      { store, project, service, addSource } = fixture({
        ...local,
        apiKey: secret,
      });
    addSource("selected", ["Cedar trial needs a control."]);
    model();
    const firstResult = await finish(
      store,
      service.summarizeItem(project, { kind: "source", id: "selected" }),
    );
    expect(firstResult.status, firstResult.message).toBe("completed");
    const good = firstResult.result as ItemInsight;
    expect(good.markdown).not.toContain(secret);
    model(() => ({
      markdown: `## Summary\n\nReview the control. [1]\n\n${secret}`,
    }));
    const leaked = await finish(
      store,
      service.summarizeItem(project, { kind: "source", id: "selected" }),
    );
    expect(leaked.status).toBe("failed");
    expect(leaked.message).toContain("credential material");
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            started();
            init.signal.addEventListener(
              "abort",
              () => reject(new DOMException("Cancelled", "AbortError")),
              { once: true },
            );
          }),
      ),
    );
    const job = service.summarizeItem(project, {
      kind: "source",
      id: "selected",
    });
    await waiting;
    service.cancelJob(job.id);
    expect((await finish(store, job)).status).toBe("cancelled");
    // Let the rejection settle so run persistence has completed too.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(
      store
        .state(project.id)
        .runs.some((entry) => entry.status === "cancelled"),
    ).toBe(true);
    expect(
      store.state(project.id).runs.find((entry) => entry.id === good.runId)
        ?.itemInsight,
    ).toEqual(good);
    expect(JSON.stringify(store.exportResearch(project.id))).not.toContain(
      secret,
    );
  });

  it("keeps an old version's exact citations across updates, card deletion and portable reimport", async () => {
    const { store, project, service, addCard } = fixture();
    const card = addCard(
      "selected-note",
      "The first field observation was provisional.",
    );
    model();
    const insight = (
      await finish(
        store,
        service.summarizeItem(project, { kind: "card", id: card.id }),
      )
    ).result as ItemInsight;
    project.cards[0].content = "A later update changes the observation.";
    project.cards[0].updatedAt = "2026-09-29T13:00:00.000Z";
    store.saveProject(project);
    expect(store.getSource(card.sourceId!).source.currentVersionId).not.toBe(
      insight.versionId,
    );
    project.cards = [];
    store.saveProject(project);
    const archive = validateResearchArchive(
      store.exportResearch(project.id),
      project.id,
      undefined,
      project.cards,
    );
    expect(archive.runs[0].itemInsight).toEqual(insight);
    store.importResearch(project.id, archive, { replace: true });
    const restored = store
      .state(project.id)
      .runs.find((entry) => entry.id === insight.runId)!.itemInsight!;
    expect(restored).toEqual(insight);
    expect(store.getPassage(restored.citations[0].passageId).text).toContain(
      "first field observation",
    );
    const tampered = structuredClone(archive);
    tampered.runs[0].itemInsight!.citations[0].locator = "Page 999";
    expect(() =>
      validateResearchArchive(tampered, project.id, undefined, []),
    ).toThrow(/citation anchor/);
    const fake = structuredClone(archive);
    fake.runs[0].itemInsight!.sourceId = "foreign-source";
    expect(() =>
      validateResearchArchive(fake, project.id, undefined, []),
    ).toThrow(/invalid target/);
  });

  it("uses only the linked worksheet with an explicit research-advice proposal and no method mutation", async () => {
    const { store, project, service, addCard } = fixture();
    const worksheet = createMethodWorksheet(project.id, "swot");
    worksheet.objective = "Compare a possible Cedar prototype trial";
    worksheet.rows = [
      { ...createMethodRow("swot"), text: "A field test remains necessary" },
    ] as typeof worksheet.rows;
    const saved = store.saveMethod(worksheet);
    const other = createMethodWorksheet(project.id, "swot");
    other.objective = "PRIVATE UNRELATED WORKSHEET";
    store.saveMethod(other);
    const card = addCard("method-card", "", { methodId: saved.id });
    model((input) => {
      expect(input.linked_method.id).toBe(saved.id);
      expect(JSON.stringify(input)).not.toContain("PRIVATE UNRELATED");
      expect(input.coverage.warnings.join(" ")).toContain(
        "linked sources were not loaded",
      );
      return {
        markdown:
          "## Summary\n\nThe worksheet proposes a field test.\n\n## Use in this investigation\n\nReview its assumptions before selecting a design.",
      };
    });
    const before = store.pedigreeState(project.id);
    const done = await finish(
      store,
      service.summarizeItem(project, { kind: "card", id: card.id }),
    );
    expect(done.status).toBe("completed");
    expect((done.result as ItemInsight).methodRevision).toBe(saved.revision);
    expect(store.pedigreeState(project.id)).toEqual(before);
  });

  it("bounds a large worksheet and rejects an empty worksheet without inventing content", async () => {
    const { store, project, service, addCard } = fixture();
    const empty = createMethodWorksheet(project.id, "risk");
    empty.rows = [createMethodRow("risk")] as typeof empty.rows;
    const savedEmpty = store.saveMethod(empty);
    const emptyCard = addCard("empty-method", "", { methodId: savedEmpty.id });
    const fetcher = model();
    const emptyResult = await finish(
      store,
      service.summarizeItem(project, { kind: "card", id: emptyCard.id }),
    );
    expect(emptyResult.status).toBe("failed");
    expect(emptyResult.message).toContain("No readable content");
    expect(fetcher).not.toHaveBeenCalled();
    const method = createMethodWorksheet(project.id, "risk");
    method.objective = "Test bounded guidance";
    method.rows = Array.from({ length: 30 }, () => ({
      ...createMethodRow("risk"),
      text: "Large risk description. ".repeat(80),
      causes: "Long explanation. ".repeat(80),
      consequences: "Unassessed outcomes. ".repeat(80),
      controls: "Proposed controls. ".repeat(80),
      likelihoodBasis: "Unknown likelihood. ".repeat(80),
      impactBasis: "Unknown impact. ".repeat(80),
      mitigation: "Proposed mitigation. ".repeat(80),
    })) as typeof method.rows;
    const saved = store.saveMethod(method);
    const card = addCard("large-method", "", { methodId: saved.id });
    model((input) => {
      expect(JSON.stringify(input.linked_method).length).toBeLessThanOrEqual(
        6000,
      );
      expect(input.linked_method.rows.length).toBeGreaterThan(0);
      expect(input.coverage.warnings.join(" ")).toContain(
        "of 30 rows were supplied",
      );
      return {
        markdown:
          "## Summary\n\nThis worksheet lists proposed risks that need validation.",
      };
    });
    expect(
      (
        await finish(
          store,
          service.summarizeItem(project, { kind: "card", id: card.id }),
        )
      ).status,
    ).toBe("completed");
  });
});

describe("human review of item summaries into evidence", () => {
  it("requires explicit acceptance, preserves edited reviewer notes and original item, and accepts a run only once", async () => {
    const { store, project, service, addCard } = fixture();
    const card = addCard(
      "review-target",
      "Cedar observations need an independent controlled trial.",
    );
    const fetcher = model();
    const completed = await finish(
      store,
      service.summarizeItem(project, { kind: "card", id: card.id }),
    );
    const insight = completed.result as ItemInsight;
    expect(store.state(project.id).claims).toHaveLength(0);
    const originalCard = structuredClone(project.cards[0]),
      originalRun = structuredClone(store.state(project.id).runs[0]);
    const notes =
      "My reviewed interpretation: use this as a design lead, not proof of effect. [1]";
    const accepted = service.acceptItemInsight(project, {
      runId: insight.runId,
      notes,
    });
    expect(accepted).toMatchObject({
      title: "Reviewed notes: review-target",
      status: "provisional",
      cardId: card.id,
      itemReview: {
        runId: insight.runId,
        insightId: insight.id,
        notes,
        target: insight.target,
        citations: insight.citations,
      },
    });
    expect(accepted.links).toHaveLength(1);
    expect(accepted.links[0].relation).toBe("context");
    expect(accepted.limitations).toContain(
      "does not establish support or independent corroboration",
    );
    expect(project.cards[0]).toEqual(originalCard);
    expect(store.state(project.id).runs[0]).toEqual(originalRun);
    expect(store.state(project.id).sources).toHaveLength(1);
    expect(
      service.acceptItemInsight(project, {
        runId: insight.runId,
        notes: ` ${notes} `,
      }),
    ).toEqual(accepted);
    expect(
      service.acceptItemInsight(project, {
        runId: insight.runId,
        notes: notes.replace("[1]", "[S1]"),
      }),
    ).toEqual(accepted);
    expect(() =>
      service.acceptItemInsight(project, {
        runId: insight.runId,
        notes: "Different review. [1]",
      }),
    ).toThrow(/already been accepted/);
    expect(store.state(project.id).claims).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects wrong references, misquoted passages, blank notes, and foreign or deleted targets without adding evidence", async () => {
    const { store, project, service, addCard } = fixture();
    const card = addCard("review-target", "The trial was not controlled.");
    model();
    const insight = (
      await finish(
        store,
        service.summarizeItem(project, { kind: "card", id: card.id }),
      )
    ).result as ItemInsight;
    for (const notes of [
      "",
      "  ",
      "Unsupported [99]",
      "“The trial was controlled.” [1]",
      "An unreferenced assertion",
    ]) {
      expect(() =>
        service.acceptItemInsight(project, { runId: insight.runId, notes }),
      ).toThrow();
    }
    expect(() =>
      service.acceptItemInsight(project, {
        runId: "foreign-run",
        notes: "Wrong run [1]",
      }),
    ).toThrow(/this investigation/);
    project.cards = [];
    store.saveProject(project);
    expect(() =>
      service.acceptItemInsight(project, {
        runId: insight.runId,
        notes: "Review [1]",
      }),
    ).toThrow(/removed/);
    expect(store.state(project.id).claims).toHaveLength(0);
  });

  it("protects acceptance metadata and item association while allowing researcher assessment edits", async () => {
    const { store, project, service, addCard } = fixture();
    const card = addCard(
      "review-target",
      "Cedar test observations were provisional.",
    );
    addCard("other-card", "Different item.");
    model();
    const insight = (
      await finish(
        store,
        service.summarizeItem(project, { kind: "card", id: card.id }),
      )
    ).result as ItemInsight;
    const accepted = service.acceptItemInsight(project, {
      runId: insight.runId,
      notes: "Review this provisional lead. [1]",
    });
    expect(() =>
      store.saveClaim({ ...accepted, id: "forged-acceptance" }),
    ).toThrow(/explicit review/);
    expect(() =>
      store.saveClaim({ ...accepted, itemReview: undefined }),
    ).toThrow(/immutable/);
    expect(() =>
      store.saveClaim({
        ...accepted,
        itemReview: { ...accepted.itemReview!, notes: "Replaced [1]" },
      }),
    ).toThrow(/immutable/);
    expect(() =>
      store.saveClaim({ ...accepted, cardId: "other-card" }),
    ).toThrow(/original item/);
    store.saveClaim({
      ...accepted,
      status: "disputed",
      alternatives: "Seasonal changes could explain the observation.",
    });
    expect(store.state(project.id).claims[0].status).toBe("disputed");
    expect(store.state(project.id).claims[0].itemReview).toEqual(
      accepted.itemReview,
    );
    expect(() => store.deleteClaim(accepted.id)).toThrow(/review history/);
  });

  it("preserves reviewed notes, source versions and frozen pedigree on archive roundtrip after item updates and removal", async () => {
    const { store, project, service, addCard } = fixture();
    const card = addCard(
      "review-target",
      "The original Cedar observation was provisional.",
    );
    model();
    const insight = (
      await finish(
        store,
        service.summarizeItem(project, { kind: "card", id: card.id }),
      )
    ).result as ItemInsight;
    const accepted = service.acceptItemInsight(project, {
      runId: insight.runId,
      notes: "My accepted interpretation remains conditional. [1]",
    });
    const snapshot = store.createPedigreeSnapshot(project.id);
    project.cards[0].content = "Later measurements differ.";
    store.saveProject(project);
    project.cards = [];
    store.saveProject(project);
    const archive = validateResearchArchive(
      store.exportResearch(project.id),
      project.id,
      undefined,
      project.cards,
    );
    expect(archive.claims[0].itemReview).toEqual(accepted.itemReview);
    expect(archive.pedigreeSnapshots![0].claims[0].itemReview).toEqual(
      accepted.itemReview,
    );
    expect(archive.pedigreeSnapshots![0].hash).toBe(snapshot.hash);
    store.importResearch(project.id, archive, { replace: true });
    expect(store.state(project.id).claims[0].itemReview).toEqual(
      accepted.itemReview,
    );
    const tampered = structuredClone(archive);
    tampered.claims[0].itemReview!.insightId = "fabricated-insight";
    expect(() => validateResearchArchive(tampered, project.id)).toThrow(
      /completed item summary/,
    );
    const duplicate = structuredClone(archive);
    duplicate.claims.push({
      ...structuredClone(duplicate.claims[0]),
      id: "duplicate-acceptance",
    });
    expect(() => validateResearchArchive(duplicate, project.id)).toThrow(
      /only one accepted/,
    );
    const mergedDuplicate = structuredClone(archive);
    mergedDuplicate.claims[0].id = "different-claim-same-review";
    mergedDuplicate.pedigreeSnapshots = [];
    expect(() => store.importResearch(project.id, mergedDuplicate)).toThrow(
      /already has an accepted/,
    );
    expect(store.state(project.id).claims).toHaveLength(1);
    const altered = structuredClone(archive);
    altered.claims[0].itemReview!.citations[0].locator = "Page 999";
    expect(() => validateResearchArchive(altered, project.id)).toThrow(
      /historical citation/,
    );
  });

  it("remaps reviewed-note citations in analysis and withholds the interpretation when its source is excluded", async () => {
    const { store, project, service, addCard, addSource } = fixture();
    addSource("priority", [
      "Cedar baseline and controlled trial methods remain uncertain.",
    ]);
    store.setSourcePolicy("priority", "pin");
    const card = addCard(
      "review-target",
      "Cedar field trial observations were provisional.",
    );
    model();
    const insight = (
      await finish(
        store,
        service.summarizeItem(project, { kind: "card", id: card.id }),
      )
    ).result as ItemInsight;
    service.acceptItemInsight(project, {
      runId: insight.runId,
      notes: "ACCEPTED REVIEW INTERPRETATION: a conditional design lead. [1]",
    });
    const finalInputs: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const request = JSON.parse(String(init?.body)),
          input = JSON.parse(request.messages[1].content);
        if (!input.source_passages)
          return new Response(
            JSON.stringify({
              message: {
                content: JSON.stringify({
                  support: ["Cedar"],
                  counter: ["Cedar"],
                  gaps: ["Cedar"],
                }),
              },
            }),
          );
        finalInputs.push(input);
        return new Response(
          JSON.stringify({
            message: {
              content: JSON.stringify({
                markdown: "Cedar needs further investigation. [1]",
              }),
            },
          }),
        );
      }),
    );
    expect(
      (await finish(store, service.ask(project, "What does Cedar need next?")))
        .status,
    ).toBe("completed");
    const input = finalInputs[0],
      annotation = input.researcher_annotations.find(
        (entry: any) => entry.itemReview,
      );
    const assigned = input.source_passages.find(
      (entry: any) => entry.passageId === insight.citations[0].passageId,
    ).label;
    expect(assigned).not.toBe("1");
    expect(annotation.itemReview.notes).toContain(`[${assigned}]`);
    expect(annotation.itemReview.notes).not.toContain("[1]");
    expect(annotation.itemReview.citations[0].label).toBe(assigned);
    store.setSourcePolicy(card.sourceId!, "exclude");
    expect(
      (await finish(store, service.ask(project, "What does Cedar need next?")))
        .status,
    ).toBe("completed");
    expect(JSON.stringify(finalInputs[1])).not.toContain(
      "ACCEPTED REVIEW INTERPRETATION",
    );
    expect(store.state(project.id).sources).toHaveLength(2);
  });
});
