import { describe, expect, it } from "vitest";
import {
  createBrief,
  createFinding,
  createOrigin,
  createMethodWorksheet,
  createMethodRow,
  emptyPedigreeState,
  type HypothesisRow,
  type TrlRow,
  type PedigreeSnapshot,
} from "../src/shared/pedigree";
import {
  analyticalChecks,
  citationIntegrity,
  originSummary,
  pedigreeAppendix,
  pedigreeChanged,
} from "../src/shared/report-pedigree";
import { markdownToReport } from "../src/shared/report";
import type { Citation, Passage, ResearchState } from "../src/shared/research";
import type { ResearchOutput } from "../src/shared/types";
import { outputHTML } from "../src/main/report-export";
const timestamp = "2026-09-29T12:00:00Z";
const passage: Passage = {
  id: "passage-1",
  sourceId: "source-1",
  versionId: "version-1",
  text: "The pilot measured no improvement under field conditions.",
  locator: "Page 204",
  page: 204,
  method: "native",
  inclusion: "include",
};
const citation: Citation = {
  id: "citation-1",
  label: "S1",
  sourceId: passage.sourceId,
  versionId: passage.versionId,
  passageId: passage.id,
  quote: passage.text,
  locator: passage.locator,
  sourceTitle: "Independent field audit",
  acquiredAt: timestamp,
  verified: true,
};
const report: ResearchOutput = {
  id: "report-1",
  kind: "decision-brief",
  title: "Pilot finding",
  provider: "offline",
  sourceIds: [],
  createdAt: timestamp,
  boardUpdatedAt: timestamp,
  markdown: "# Findings\n\nThe pilot succeeded [1].",
  citations: [citation],
};
function fixture() {
  const state = emptyPedigreeState();
  state.briefs = [createBrief("project-1", "Did the pilot succeed?")];
  state.findings = [createFinding("project-1", "claim-1")];
  const research: ResearchState = {
    sources: [
      {
        id: passage.sourceId,
        projectId: "project-1",
        title: citation.sourceTitle,
        kind: "document",
        currentVersionId: passage.versionId,
        inclusion: "include",
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
    versions: [
      {
        id: passage.versionId,
        sourceId: passage.sourceId,
        title: citation.sourceTitle,
        acquiredAt: timestamp,
        hash: "hash",
        method: "native",
        status: "ready",
        totalUnits: 204,
        processedUnits: 204,
      },
    ],
    claims: [
      {
        id: "claim-1",
        projectId: "project-1",
        title: "Pilot succeeded",
        question: "Did it?",
        status: "provisional",
        alternatives: "Laboratory setting differs from field use.",
        limitations: "Small field sample",
        updatedAt: timestamp,
        links: [
          {
            id: "link-1",
            passageId: passage.id,
            relation: "contradicts",
            rationale: "No improvement observed",
            quote: passage.text,
          },
        ],
      },
    ],
    tasks: [],
    jobs: [],
    discoveries: [],
    runs: [],
  };
  const snapshot: PedigreeSnapshot = {
    schemaVersion: 1,
    id: "snapshot-1",
    projectId: "project-1",
    hash: "hash",
    createdAt: timestamp,
    state: structuredClone(state),
    claims: structuredClone(research.claims),
    tasks: [],
    passages: [passage],
    sources: structuredClone(research.sources),
    sourceVersions: structuredClone(research.versions),
    sourceIds: [passage.sourceId],
  };
  return { state, research, snapshot };
}
describe("report analytical pedigree", () => {
  it("prints readable method assessments and repeatable table headers with evaluation-only citations", () => {
    const { snapshot } = fixture();
    snapshot.claims = [];
    const hypotheses = createMethodWorksheet("project-1", "hypotheses");
    const row = createMethodRow("hypotheses") as HypothesisRow;
    row.text = "The filter improves field performance";
    row.predictions = "Treated sites outperform matched controls";
    row.evaluations = [
      {
        passageId: passage.id,
        assessment: "contradicts",
        rationale: "No field improvement observed",
      },
    ];
    if (hypotheses.kind === "hypotheses") hypotheses.rows = [row];
    const readiness = createMethodWorksheet("project-1", "trl");
    const maturity = createMethodRow("trl") as TrlRow;
    maturity.text = "Filter assembly";
    maturity.assessedLevel = null;
    if (readiness.kind === "trl") readiness.rows = [maturity];
    snapshot.state.methods = [hypotheses, readiness];
    const appendix = pedigreeAppendix(snapshot, []);
    expect(appendix.citations.map((c) => c.passageId)).toEqual([passage.id]);
    expect(appendix.markdown).toContain(
      "Evidence [1]: contradicts — No field improvement observed",
    );
    expect(appendix.markdown).toContain("Readiness level: Unassessed");
    expect(appendix.markdown).not.toContain('"passageId"');
    expect(appendix.markdown).not.toContain("assessedLevel");
    const html = outputHTML({
      ...report,
      markdown: appendix.markdown,
      citations: appendix.citations,
    });
    expect(html).toContain("<thead><tr><th>");
    expect(html).toContain("</thead><tbody>");
    expect(html).toContain(
      'Evidence <sup class="citation">[1]</sup>: contradicts',
    );
  });
  it("does not convert a valid but contradicting citation into evidential support", () => {
    const { state, research } = fixture();
    expect(
      citationIntegrity(report, (id) =>
        id === passage.id ? passage : undefined,
      ),
    ).toEqual([]);
    expect(state.findings[0].supportReview).toBe("unassessed");
    expect(
      analyticalChecks(state, research, [passage]).some(
        (c) => c.id === "finding-claim-1",
      ),
    ).toBe(true);
    expect(
      citationIntegrity(
        { ...report, citations: [{ ...citation, versionId: "wrong-version" }] },
        () => passage,
      ),
    ).toHaveLength(1);
    expect(
      citationIntegrity(
        { ...report, document: markdownToReport("Missing [99].") },
        () => passage,
      ).join(),
    ).toContain("99");
    expect(
      citationIntegrity(
        {
          ...report,
          document: markdownToReport("`array[99]`\n\n```\n[999]\n```"),
        },
        () => passage,
      ),
    ).toEqual([]);
  });
  it("separates confirmed shared origins, duplicates, and unknown independence", () => {
    const { research } = fixture();
    research.sources.push(
      { ...research.sources[0], id: "syndicated" },
      { ...research.sources[0], id: "unrelated" },
      { ...research.sources[0], id: "copy", duplicateOf: "source-1" },
    );
    const origin = {
      ...createOrigin("project-1", "source-1", "syndicated"),
      status: "confirmed" as const,
    };
    expect(originSummary(research.sources, [origin])).toMatchObject({
      sourceCount: 4,
      sharedOriginGroups: 1,
      unknownIndependence: 1,
      duplicateFiles: 1,
    });
  });
  it("flags changed briefs/appraisals/evidence while leaving the historical snapshot intact", () => {
    const { state, research, snapshot } = fixture();
    state.briefs[0].revision += 1;
    state.briefs[0].scope = "Different scope";
    research.sources[0].currentVersionId = "version-2";
    expect(pedigreeChanged(snapshot, state, research)).toEqual([
      "briefs",
      "source versions and selection",
    ]);
    expect(snapshot.state.briefs[0].scope).toBe("");
    expect(snapshot.passages[0].versionId).toBe("version-1");
  });
  it("retains counterevidence, exact historical locators and unassessed limitations in editable appendices", () => {
    const { snapshot } = fixture();
    const appendix = pedigreeAppendix(snapshot, [citation]);
    expect(appendix.citations).toHaveLength(1);
    expect(appendix.markdown).toContain("Conflicting passages: [1]");
    expect(appendix.markdown).toContain("Support review: unassessed");
    expect(appendix.markdown).toContain("unassessed independence");
    expect(appendix.citations[0].locator).toBe("Page 204");
    expect(report.markdown).not.toContain("analytical pedigree");
  });
  it("warns on incomplete extraction even when a valid passage exists", () => {
    const { state, research } = fixture();
    research.versions[0].status = "partial";
    research.versions[0].processedUnits = 1;
    expect(
      analyticalChecks(state, research, [passage]).find(
        (c) => c.id === "extraction-source-1",
      )?.message,
    ).toContain("1/204");
  });
  it("flags new sources and changed inclusion policies without changing old source bytes", () => {
    const { state, research, snapshot } = fixture();
    research.sources[0].inclusion = "exclude";
    expect(pedigreeChanged(snapshot, state, research)).toContain(
      "source versions and selection",
    );
    research.sources[0].inclusion = "include";
    research.sources.push({ ...research.sources[0], id: "new-source" });
    expect(pedigreeChanged(snapshot, state, research)).toContain(
      "source versions and selection",
    );
  });
});
