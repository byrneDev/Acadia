import { describe, expect, it } from "vitest";
import {
  associateQuotedText,
  balancedPassages,
  sourceIndependenceGroups,
  validateChallengeProposal,
  validateMethodProposal,
} from "../src/shared/pedigree-analysis";
import {
  createMethodRow,
  createMethodWorksheet,
  createOrigin,
  emptyPedigreeState,
  type PedigreeSnapshot,
} from "../src/shared/pedigree";
import type { Citation, Passage } from "../src/shared/research";
import { validateCitedMarkdown } from "../src/main/research-service";
const passage = (id: string, length = 80): Passage => ({
  id,
  sourceId: id,
  versionId: `${id}-v1`,
  text: id.padEnd(length, "."),
  locator: "Page 1",
  method: "native",
  inclusion: "include",
});
const citation = (label: string, quote: string): Citation => ({
  id: `cite-${label}`,
  label,
  sourceId: `source-${label}`,
  versionId: `version-${label}`,
  passageId: `passage-${label}`,
  sourceTitle: `Study ${label}`,
  locator: "Page 1",
  quote,
  acquiredAt: "2026-09-29T00:00:00.000Z",
  verified: true,
});
const snapshot = (): PedigreeSnapshot => ({
  id: "snapshot",
  projectId: "project",
  schemaVersion: 1,
  createdAt: "2026-09-29T00:00:00.000Z",
  hash: "hash",
  state: emptyPedigreeState(),
  claims: [],
  tasks: [],
  passages: [],
  sources: [],
  sourceVersions: [],
  sourceIds: [],
});

describe("balanced evidence selection", () => {
  it("reserves count and character space for counterevidence and gaps even under an abundant pin/support pool", () => {
    const pools = {
      pins: Array.from({ length: 12 }, (_, i) => passage(`pin-${i}`)),
      support: Array.from({ length: 12 }, (_, i) => passage(`support-${i}`)),
      counter: [passage("negative-control")],
      gaps: [passage("unmeasured-baseline")],
    };
    const result = balancedPassages(
      pools,
      { characters: 800, passages: 8 },
      new Map(),
    );
    expect(result.passages).toHaveLength(8);
    expect(result.passages.map((p) => p.id)).toEqual([
      "pin-0",
      "support-0",
      "negative-control",
      "unmeasured-baseline",
      "pin-1",
      "support-1",
      "pin-2",
      "support-2",
    ]);
    expect(result.manifest.perPool).toEqual({ characters: 200, passages: 2 });
    expect(
      result.manifest.selections.filter((s) => s.redistributed),
    ).toHaveLength(2);
    expect(
      result.manifest.omissions.every((o) => o.reason === "context-budget"),
    ).toBe(true);
    expect(balancedPassages(pools, result.manifest.limits, new Map())).toEqual(
      result,
    );
  });
  it("redistributes unused character allowance and records duplicates separately from independent support", () => {
    const pin = passage("counter-pin", 150),
      support = passage("support", 250),
      copy = passage("copy", 100);
    const result = balancedPassages(
      { pins: [pin], support: [support, copy], counter: [pin], gaps: [] },
      { characters: 500, passages: 8 },
      new Map([
        [pin.versionId, "same"],
        [copy.versionId, "same"],
        [support.versionId, "other"],
      ]),
    );
    expect(result.passages.map((p) => p.id)).toEqual([pin.id, support.id]);
    expect(
      result.manifest.omissions.find((o) => o.passageId === copy.id)?.reason,
    ).toBe("duplicate-file");
    expect(result.manifest.usedCharacters).toBe(400);
    // An oversized pin cannot consume the reservations belonging to other pools.
    expect(
      result.manifest.selections.find((s) => s.passageId === support.id)
        ?.redistributed,
    ).toBe(true);
  });
  it("marks confirmed syndicated/common-study sources as dependent without assuming proposed links are true", () => {
    const state = emptyPedigreeState();
    state.origins = [
      {
        ...createOrigin("project", "study", "syndication"),
        status: "confirmed",
      },
      createOrigin("project", "study", "independent"),
    ];
    expect(
      sourceIndependenceGroups(["study", "syndication", "independent"], state),
    ).toEqual([["study", "syndication"], ["independent"]]);
  });
});

describe("quotation provenance is separate from evidentiary support", () => {
  const relevant = citation(
    "1",
    "The field trial showed no improvement. No baseline was measured.",
  );
  const irrelevant = citation("2", "The sample containers were blue.");
  it("checks the adjacent citation even if the literal text occurs in a different cited source", () => {
    expect(() =>
      validateCitedMarkdown(
        JSON.stringify({
          markdown:
            "“The field trial showed no improvement.” [2]. Other context [1].",
        }),
        [relevant, irrelevant],
      ),
    ).toThrow("adjacent citation");
    expect(() =>
      associateQuotedText("“blue” [1]", [relevant, irrelevant]),
    ).toThrow("adjacent citation");
  });
  it("records ambiguous associations, including text found elsewhere but not adjacent", () => {
    expect(
      associateQuotedText("“The field trial showed no improvement.” [1][2]", [
        relevant,
        irrelevant,
      ]).warnings,
    ).toHaveLength(1);
    const result = associateQuotedText(
      "The source says “The field trial showed no improvement.” Later discussion refers to the study [1].",
      [relevant],
    );
    expect(result.associations[0].status).toBe("ambiguous");
    expect(result.warnings[0]).toContain("no adjacent citation");
  });
  it("does not promote a literally valid but irrelevant citation to support or proof of causality", () => {
    const result = validateCitedMarkdown(
      JSON.stringify({
        markdown:
          "The filter caused improvement because “The sample containers were blue.” [2].",
      }),
      [irrelevant],
    );
    expect(result.quotationAssociations[0].status).toBe("verified");
    expect(result.citations[0].verified).toBe(true); // Location only; a challenge assesses relevance.
  });
});

describe("proposal boundaries", () => {
  const c = citation("1", "No improvement was observed.");
  it("rejects a replacement with a missing/ambiguous original or invented citation", () => {
    const context = {
      target: { kind: "report" as const, id: "report" },
      original: "A causal conclusion.",
      runId: "run",
      citations: [c],
      snapshot: snapshot(),
    };
    const base = {
      summary: "Review causality",
      issues: [],
      limitations: [],
      suggestedChanges: [
        {
          original: "Missing",
          proposed: "Qualified [1]",
          rationale: "No control",
          citationIds: [c.id],
        },
      ],
    };
    expect(() => validateChallengeProposal(base, context)).toThrow(
      "does not match",
    );
    expect(() =>
      validateChallengeProposal(
        {
          ...base,
          suggestedChanges: [
            {
              ...base.suggestedChanges[0],
              original: context.original,
              citationIds: ["invented"],
            },
          ],
        },
        context,
      ),
    ).toThrow("unknown or unavailable");
    expect(context.original).toBe("A causal conclusion.");
  });
  it("checks method schema and all references while preserving current writing and revision", () => {
    const method = createMethodWorksheet("project", "hypotheses");
    const row = {
      ...createMethodRow("hypotheses"),
      passageIds: [c.passageId],
      text: "Alternative explanation",
    };
    const input = {
      summary: "Compare a control",
      proposedMethod: { ...method, rows: [row] },
      issues: [],
      limitations: ["No controlled comparison"],
    };
    const result = validateMethodProposal(input, method, {
      runId: "run",
      citations: [c],
      snapshot: snapshot(),
    });
    expect(result.methodRevision).toBe(method.revision);
    expect(result.proposedMethod.rows).toHaveLength(1);
    expect(method.rows).toEqual([]);
    expect(() =>
      validateMethodProposal(
        {
          ...input,
          proposedMethod: {
            ...method,
            rows: [{ ...row, taskIds: ["invented-task"] }],
          },
        },
        method,
        { runId: "run", citations: [c], snapshot: snapshot() },
      ),
    ).toThrow("unknown or unavailable");
  });
});
