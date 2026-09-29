import { describe, expect, it } from "vitest";
import {
  appendReportContent,
  applyReportChallenge,
  reportFingerprint,
} from "../src/shared/report-changes";
import {
  markdownToReport,
  reportCitations,
  reportDocument,
  reportToMarkdown,
} from "../src/shared/report";
import type { Citation } from "../src/shared/research";
import type { ResearchOutput } from "../src/shared/types";
const c: Citation = {
  id: "citation",
  label: "1",
  sourceId: "source",
  versionId: "version",
  passageId: "passage",
  sourceTitle: "Study",
  locator: "Page 1",
  quote: "The study lacks a control.",
  acquiredAt: "2026-09-29T00:00:00Z",
  verified: true,
};
function fixture(): ResearchOutput {
  const markdown =
    "# Findings\n\n**Keep the bold prefix.** The filter caused improvement [1]. Preserve the trailing words.\n\n| Item | Status |\n| --- | --- |\n| Field study | Uncontrolled [1] |\n\n## Untouched ending\n\nKeep this *italic* section.";
  return {
    id: "report",
    kind: "hypothesis",
    title: "Findings",
    markdown,
    document: markdownToReport(markdown, [c]),
    citations: [c],
    sourceIds: ["source"],
    provider: "fixture",
    createdAt: "2026-09-29T00:00:00Z",
    boardUpdatedAt: "2026-09-29T00:00:00Z",
  };
}
describe("reviewed report mutations", () => {
  it("changes an exact inline range while keeping marks, tables, citations and surrounding content", () => {
    const output = fixture(),
      document = structuredClone(reportDocument(output));
    const change = {
      original: "The filter caused improvement [1].",
      proposed:
        "The improvement followed installation; causality is uncertain [1].",
      rationale: "No control",
      citationIds: [c.id],
    };
    const result = applyReportChallenge(output, document, change, [c]);
    expect(reportDocument(result).content?.[0]).toEqual(document.content?.[0]);
    expect(reportDocument(result).content?.slice(2)).toEqual(
      document.content?.slice(2),
    );
    expect(reportDocument(result).content?.[1].content?.[0]).toEqual(
      document.content?.[1].content?.[0],
    );
    expect(result.markdown).toContain("**Keep the bold prefix.**");
    expect(result.markdown).toContain("Preserve the trailing words.");
    expect(result.markdown).toContain("causality is uncertain [1]");
    expect(reportCitations(result)).toEqual([c]);
    expect(reportDocument(output)).toEqual(document);
  });
  it("changes an exact complete block without serializing untouched sections through Markdown", () => {
    const output = fixture(),
      document = structuredClone(reportDocument(output));
    document.content![2].attrs = { customTableWidth: 840 };
    output.document = document;
    const original = reportToMarkdown(
      { type: "doc", content: [document.content![1]] },
      [c],
    );
    const result = applyReportChallenge(
      output,
      document,
      {
        original,
        proposed: "A controlled trial is needed [1].",
        rationale: "Alternative explanations",
        citationIds: [c.id],
      },
      [c],
    );
    expect(result.document?.content?.[2]).toEqual(document.content![2]);
    expect(result.document?.content?.[2].attrs).toEqual({
      customTableWidth: 840,
    });
  });
  it("refuses newer edits including formatting-only changes", () => {
    const output = fixture(),
      original = structuredClone(reportDocument(output));
    output.document!.content![2].attrs = { customTableWidth: 920 };
    expect(() =>
      applyReportChallenge(
        output,
        original,
        {
          original: "The filter caused improvement [1].",
          proposed: "Uncertain [1].",
          rationale: "No control",
          citationIds: [c.id],
        },
        [c],
      ),
    ).toThrow("report changed");
  });
  it("resolves explicit labels before positional fallbacks and normalizes appendix numbering", () => {
    const first = { ...c, id: "first", label: "S7" };
    const second = {
      ...c,
      id: "second",
      label: "S1",
      passageId: "second-passage",
    };
    const explicit = markdownToReport("One [1], seven [S7].", [first, second]);
    expect(
      explicit
        .content![0].content!.filter((n) => n.type === "citation")
        .map((n) => n.attrs?.citationId),
    ).toEqual(["second", "first"]);
    const output = {
      ...fixture(),
      citations: [first, second],
      document: markdownToReport("Existing [S7].", [first, second]),
    };
    const appended = appendReportContent(output, reportFingerprint(output), {
      markdown: "## Appendix\n\nFirst [1], second [2].",
      citations: [first, second],
    });
    const refs = appended
      .document!.content!.at(-1)!
      .content!.filter((n) => n.type === "citation")
      .map((n) => n.attrs?.citationId);
    expect(refs).toEqual(["first", "second"]);
  });
  it("appends a preview without changing existing nodes and rejects stale preview application", () => {
    const output = fixture(),
      fingerprint = reportFingerprint(output),
      document = structuredClone(reportDocument(output));
    const added: Citation = {
      ...c,
      id: "new-citation",
      label: "2",
      passageId: "other-passage",
    };
    const appendix = {
      markdown: "## Analytical pedigree\n\nNo concurrent control [2].",
      citations: [c, added],
    };
    const result = appendReportContent(output, fingerprint, appendix);
    expect(
      result.document?.content?.slice(0, document.content!.length),
    ).toEqual(document.content);
    expect(result.markdown).toContain("No concurrent control [2]");
    expect(result.citations).toHaveLength(2);
    output.document!.content!.push({
      type: "paragraph",
      content: [{ type: "text", text: "New private thought" }],
    });
    expect(() => appendReportContent(output, fingerprint, appendix)).toThrow(
      "draft changed",
    );
  });
});
