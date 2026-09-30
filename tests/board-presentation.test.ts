import { describe, expect, it } from "vitest";
import { createBlankProject } from "../src/shared/project";
import { createGap, emptyPedigreeState } from "../src/shared/pedigree";
import type { Passage, ResearchState } from "../src/shared/research";
import type { ResearchCard } from "../src/shared/types";
import { presentBoardCard } from "../src/renderer/components/boardPresentation";

const timestamp = "2026-09-29T12:00:00.000Z";
function fixture() {
  const project = createBlankProject(),
    pedigree = emptyPedigreeState();
  const research: ResearchState = {
    sources: [],
    versions: [],
    claims: [],
    tasks: [],
    jobs: [],
    discoveries: [],
    runs: [],
  };
  const card: ResearchCard = {
    id: "placement",
    kind: "note",
    title: "Old cached title",
    content: "Obsolete cached text",
    x: 150,
    y: 260,
    tags: [],
    status: "unreviewed",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  return { project, pedigree, research, card };
}
describe("linked board presentation", () => {
  it("follows canonical edits without changing saved card text, position, or assessment", () => {
    const { project, pedigree, research, card } = fixture();
    const gap = {
      ...createGap(project.id),
      title: "Missing field comparison",
      missingInformation: "Matched-load trial",
      status: "investigating" as const,
    };
    pedigree.gaps.push(gap);
    card.boardReference = { kind: "gap", id: gap.id };
    const original = structuredClone(card);
    const first = presentBoardCard(card, project, research, pedigree, {});
    expect(first.card.title).toBe(gap.title);
    expect(first.status).toBe("investigating");
    gap.title = "Long-term field comparison";
    expect(
      presentBoardCard(card, project, research, pedigree, {}).card.title,
    ).toBe(gap.title);
    expect(card).toEqual(original);
    expect(first.card.x).toBe(150);
    expect(first.card.status).toBe("unreviewed");
  });
  it("keeps an exact historical passage and marks it historical after the source advances", () => {
    const { project, pedigree, research, card } = fixture();
    research.sources.push({
      id: "source",
      projectId: project.id,
      title: "New source title",
      kind: "document",
      currentVersionId: "version-2",
      inclusion: "include",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    research.versions.push({
      id: "version-1",
      sourceId: "source",
      title: "Original field study",
      acquiredAt: timestamp,
      hash: "historical",
      status: "ready",
      method: "native",
      totalUnits: 300,
      processedUnits: 300,
    });
    const passage: Passage = {
      id: "last-page",
      sourceId: "source",
      versionId: "version-1",
      locator: "Page 300",
      page: 300,
      text: "The field result contradicted the early laboratory claim.",
      method: "native",
      inclusion: "include",
    };
    card.boardReference = {
      kind: "passage",
      id: passage.id,
      versionId: passage.versionId,
    };
    const view = presentBoardCard(card, project, research, pedigree, {
      [passage.id]: passage,
    });
    expect(view.card.title).toBe("Original field study · Page 300");
    expect(view.card.content).toBe(passage.text);
    expect(view.historical).toBe(true);
    expect(view.unavailable).toBe(false);
  });
  it("shows a missing record as unavailable instead of treating cached analysis as source text", () => {
    const { project, pedigree, research, card } = fixture();
    card.boardReference = { kind: "claim", id: "deleted-claim" };
    const view = presentBoardCard(card, project, research, pedigree, {});
    expect(view.unavailable).toBe(true);
    expect(view.reference).toEqual(card.boardReference);
    expect(view.card.content).not.toContain("Obsolete cached text");
    expect(view.card.x).toBe(card.x);
  });
});
