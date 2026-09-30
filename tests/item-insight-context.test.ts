import { describe, expect, it } from "vitest";
import { createBlankProject } from "../src/shared/project";
import { boardRecordSignature } from "../src/shared/board";
import {
  createGap,
  createMethodWorksheet,
  emptyPedigreeState,
} from "../src/shared/pedigree";
import type { ItemInsight } from "../src/shared/item-insight";
import type {
  Passage,
  ResearchState,
  SourceRecord,
  SourceVersion,
} from "../src/shared/research";
import {
  itemInsightContext,
  itemInsightIsStale,
} from "../src/renderer/components/ItemInsightDialog";

function fixture() {
  const project = createBlankProject();
  const stamp = new Date().toISOString();
  project.question = "Will this work in the field?";
  project.cards.push({
    id: "card",
    kind: "note",
    title: "Old cached title",
    content: "Old preview",
    status: "unreviewed",
    tags: [],
    x: 0,
    y: 0,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const source: SourceRecord = {
    id: "source",
    projectId: project.id,
    title: "Current source",
    kind: "document",
    currentVersionId: "v2",
    inclusion: "include",
    createdAt: stamp,
    updatedAt: stamp,
  };
  const old: SourceVersion = {
    id: "v1",
    sourceId: source.id,
    title: "Historical source",
    hash: "hash",
    acquiredAt: stamp,
    status: "partial",
    method: "native",
    totalUnits: 200,
    processedUnits: 125,
  };
  const current: SourceVersion = {
    ...old,
    id: "v2",
    title: "Current source",
    status: "ready",
    processedUnits: 200,
  };
  const passage: Passage = {
    id: "passage",
    sourceId: source.id,
    versionId: old.id,
    text: "Historical observation.",
    locator: "Page 125",
    page: 125,
    method: "native",
    inclusion: "include",
  };
  const research: ResearchState = {
    sources: [source],
    versions: [old, current],
    claims: [],
    tasks: [],
    jobs: [],
    discoveries: [],
    runs: [],
  };
  const pedigree = emptyPedigreeState();
  const target = { kind: "card" as const, id: "card" };
  const insight: ItemInsight = {
    id: "insight",
    runId: "run",
    target,
    itemTitle: "Saved title",
    question: project.question,
    markdown: "Summary",
    citations: [],
    createdAt: stamp,
    provider: "ollama",
    model: "fixture",
    cardUpdatedAt: stamp,
    coverage: {
      availablePassages: 1,
      selectedPassages: 1,
      processedUnits: 125,
      totalUnits: 200,
      status: "partial",
      warnings: [],
    },
  };
  return { project, research, pedigree, source, old, passage, target, insight };
}

describe("canonical item summary context", () => {
  it("uses the linked historical source version and its extraction/exclusion policy", () => {
    const f = fixture();
    f.project.cards[0].boardReference = {
      kind: "source",
      id: f.source.id,
      versionId: f.old.id,
    };
    f.source.inclusion = "exclude";
    const context = itemInsightContext(
      f.project,
      f.research,
      f.target,
      f.pedigree,
    );
    expect(context.title).toBe("Historical source");
    expect(context.version).toEqual(f.old);
    expect(context.historical).toBe(true);
    expect(context.excluded).toBe(true);
    expect(context.unavailable).toBe(false);
  });

  it("waits for the exact passage and refuses excluded or mismatched historical passages", () => {
    const f = fixture();
    f.project.cards[0].boardReference = {
      kind: "passage",
      id: f.passage.id,
      versionId: f.old.id,
    };
    expect(
      itemInsightContext(f.project, f.research, f.target, f.pedigree).loading,
    ).toBe(true);
    const context = itemInsightContext(
      f.project,
      f.research,
      f.target,
      f.pedigree,
      { ...f.passage, inclusion: "exclude" },
    );
    expect(context.title).toBe("Historical source · Page 125");
    expect(context.excluded).toBe(true);
    expect(context.selectedVersion).toBe("v1");
    expect(
      itemInsightContext(f.project, f.research, f.target, f.pedigree, {
        ...f.passage,
        versionId: "v2",
      }).unavailable,
    ).toBe(true);
    expect(
      itemInsightContext(f.project, f.research, f.target, f.pedigree, null)
        .unavailable,
    ).toBe(true);
  });

  it("tracks method and gap changes without requiring the board card to change", () => {
    const f = fixture();
    const method = {
      ...createMethodWorksheet(f.project.id, "risk"),
      title: "Field rollout risks",
      revision: 1,
    };
    f.pedigree.methods.push(method);
    f.project.cards[0].boardReference = { kind: "method", id: method.id };
    const insight = {
      ...f.insight,
      methodRevision: 1,
      boardRecordSignature: boardRecordSignature(method),
    };
    let context = itemInsightContext(
      f.project,
      f.research,
      f.target,
      f.pedigree,
    );
    expect(context.title).toBe("Field rollout risks");
    expect(context.source).toBeUndefined();
    expect(
      itemInsightIsStale(insight, context, f.project.question, f.pedigree),
    ).toBe(false);
    method.revision = 2;
    context = itemInsightContext(f.project, f.research, f.target, f.pedigree);
    expect(
      itemInsightIsStale(insight, context, f.project.question, f.pedigree),
    ).toBe(true);
    const gap = {
      ...createGap(f.project.id),
      title: "Need a controlled comparison",
      revision: 1,
    };
    f.pedigree.gaps.push(gap);
    f.project.cards[0].boardReference = { kind: "gap", id: gap.id };
    const gapInsight = {
      ...f.insight,
      boardRecordSignature: boardRecordSignature(gap),
    };
    expect(
      itemInsightIsStale(
        gapInsight,
        itemInsightContext(f.project, f.research, f.target, f.pedigree),
        f.project.question,
        f.pedigree,
      ),
    ).toBe(false);
    gap.taskIds.push("new-task");
    expect(
      itemInsightIsStale(
        gapInsight,
        itemInsightContext(f.project, f.research, f.target, f.pedigree),
        f.project.question,
        f.pedigree,
      ),
    ).toBe(true);
  });

  it("detects edited reports and never assumes legacy linked summaries are current", () => {
    const f = fixture();
    const report = {
      id: "report",
      kind: "whitepaper" as const,
      title: "Current report title",
      markdown: "First draft",
      createdAt: f.insight.createdAt,
      provider: "manual",
      sourceIds: [],
      boardUpdatedAt: f.project.updatedAt,
    };
    f.project.outputs.push(report);
    f.project.cards[0].boardReference = { kind: "report", id: report.id };
    const context = itemInsightContext(
      f.project,
      f.research,
      f.target,
      f.pedigree,
    );
    expect(context.title).toBe(report.title);
    expect(
      itemInsightIsStale(f.insight, context, f.project.question, f.pedigree),
    ).toBe(true);
    const insight = {
      ...f.insight,
      boardRecordSignature: boardRecordSignature(report),
    };
    expect(
      itemInsightIsStale(insight, context, f.project.question, f.pedigree),
    ).toBe(false);
    report.markdown = "Revised conclusion";
    expect(
      itemInsightIsStale(
        insight,
        itemInsightContext(f.project, f.research, f.target, f.pedigree),
        f.project.question,
        f.pedigree,
      ),
    ).toBe(true);
  });
});
