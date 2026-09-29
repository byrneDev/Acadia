import { describe, expect, it } from "vitest";
import AdmZip from "adm-zip";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Transform } from "@tiptap/pm/transform";
import { Fragment } from "@tiptap/pm/model";
import { CitationNode } from "../src/renderer/components/ReportEditor";
import type { Citation, SourceRecord } from "../src/shared/research";
import type { Project, ResearchOutput } from "../src/shared/types";
import {
  canApplySection,
  changedCitationSources,
  markdownToReport,
  mergeCitations,
  releasedReport,
  reportCitations,
  reportToMarkdown,
  snapshotRevision,
} from "../src/shared/report";
import {
  exportReportDocx,
  exportReportMarkdown,
  outputHTML,
} from "../src/main/report-export";

const citation: Citation = {
  id: "citation-immutable",
  label: "S1",
  sourceId: "source-A",
  versionId: "version-original",
  passageId: "page-204",
  sourceTitle: "Trial findings",
  locator: "Page 204",
  quote: "The comparison group improved by 12%.",
  acquiredAt: "2026-09-29T12:00:00Z",
  verified: true,
};
const output = (): ResearchOutput => ({
  id: "report-A",
  kind: "decision-brief",
  title: "Pilot decision",
  createdAt: "2026-09-29T12:10:00Z",
  provider: "Offline",
  boardUpdatedAt: "2026-09-29T12:00:00Z",
  sourceIds: ["card-A"],
  citations: [structuredClone(citation)],
  markdown:
    "# Pilot decision\n\nExisting findings [S1].\n\n## Alternatives\n\n| Choice | Evidence |\n| --- | --- |\n| Continue | Comparison group [S1] |\n| Stop | Missing cost data |\n\n## Limitations\n\nNo long-term follow-up is available.",
});
const project = (outputs: ResearchOutput[]): Project => ({
  schemaVersion: 2,
  id: "project-A",
  title: "Pilot",
  question: "Continue?",
  cards: [],
  connections: [],
  outputs,
  createdAt: "",
  updatedAt: "",
});

describe("structured research reports", () => {
  it("preserves headings, tables and immutable citation identity in Markdown conversion", () => {
    const document = markdownToReport(output().markdown, [citation]);
    expect(document.content?.[0]).toMatchObject({
      type: "heading",
      attrs: { level: 1 },
    });
    expect(
      document.content?.find((node) => node.type === "table")?.content,
    ).toHaveLength(3);
    const json = JSON.stringify(document);
    expect(json.match(/citation-immutable/g)).toHaveLength(2);
    expect(reportToMarkdown(document, [citation])).toContain(
      "Existing findings [1]",
    );
    expect(reportToMarkdown(document, [citation])).toContain(
      "| Continue | Comparison group [1] |",
    );
    const schema = getSchema([StarterKit, TableKit, CitationNode]);
    expect(() => schema.nodeFromJSON(document).check()).not.toThrow();
  });

  it("treats raw HTML, images and unsafe URLs as inert content in PDF output", () => {
    const report = output();
    report.markdown +=
      "\n\n<script>alert(1)</script>\n\n![tracking](https://tracker.example/image.png)\n\n[danger](javascript:alert(1))";
    const html = outputHTML(report);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("default-src 'none'");
    expect(html).toContain("<table>");
    expect(html).toContain("Page 204");
    expect(html).toContain("version-original");
    expect(html).toContain("No long-term follow-up");
  });

  it("saves immutable revisions and never shows a working draft on the audience display", () => {
    const report = output();
    const revision = snapshotRevision(
      report,
      "Approved pilot decision",
      "revision-1",
    );
    report.revisions = [revision];
    const research = project([report]);
    expect(releasedReport(research)).toBeUndefined();
    research.releasedOutputId = report.id;
    expect(releasedReport(research)).toBeUndefined();
    report.releasedRevisionId = revision.id;
    report.document = markdownToReport("# Confidential unfinished draft");
    report.markdown = "# Confidential unfinished draft";
    report.citations![0].quote = "Changed later";
    const visible = releasedReport(research)!;
    expect(visible.markdown).toContain("Existing findings");
    expect(visible.markdown).not.toContain("Confidential");
    expect(visible.citations![0].quote).toBe(citation.quote);
    expect(JSON.stringify(visible.document)).not.toContain("Confidential");
    report.releasedRevisionId = "missing-revision";
    expect(releasedReport(research)).toBeUndefined();
  });

  it("retains card-level legacy references without inventing verified passage provenance", () => {
    const report = output();
    delete report.citations;
    const legacy = reportCitations(report);
    expect(legacy[0]).toMatchObject({
      legacyCardId: "card-A",
      locator: "Card-level reference",
      verified: false,
    });
    expect(exportReportMarkdown(report)).toContain(
      "Legacy card-level reference; passage not verified",
    );
  });

  it("distinguishes changed source versions and continues citing the immutable original", () => {
    const record = {
      id: citation.sourceId,
      currentVersionId: "version-original",
    } as SourceRecord;
    expect(changedCitationSources([citation], [record])).toEqual([]);
    record.currentVersionId = "new-version";
    expect(changedCitationSources([citation], [record])).toEqual([citation]);
    expect(citation.versionId).toBe("version-original");
    expect(changedCitationSources([citation], [])).toEqual([citation]);
  });

  it("applies a section replacement without changing surrounding text or citation atoms", () => {
    const schema = getSchema([StarterKit, TableKit, CitationNode]);
    const document = markdownToReport(
      "Before [S1].\n\nOriginal conclusion.\n\nAfter [S1].",
      [citation],
    );
    const initial = schema.nodeFromJSON(document);
    let from = 0,
      to = 0;
    initial.descendants((node, position) => {
      if (node.isText && node.text === "Original conclusion.") {
        from = position;
        to = position + node.nodeSize;
      }
    });
    expect(from).toBeGreaterThan(0);
    const snapshot = JSON.stringify(document);
    const selectedText = initial.textBetween(from, to);
    expect(
      canApplySection(document, snapshot, selectedText, "Original conclusion."),
    ).toBe(true);
    const transformed = new Transform(initial)
      .replaceWith(from, to, Fragment.from(schema.text("Revised conclusion.")))
      .doc.toJSON();
    expect(transformed.content[0]).toEqual(document.content![0]);
    expect(transformed.content[2]).toEqual(document.content![2]);
    expect(
      JSON.stringify(transformed).match(/citation-immutable/g),
    ).toHaveLength(2);
    expect(
      canApplySection(
        transformed,
        snapshot,
        "Revised conclusion.",
        "Original conclusion.",
      ),
    ).toBe(false);
    expect(
      canApplySection(document, snapshot, selectedText, "Different text"),
    ).toBe(false);
  });

  it("merges new proposal citations without renumbering existing references", () => {
    const newCitation = {
      ...citation,
      id: "new-citation",
      passageId: "page-205",
    };
    const merged = mergeCitations([citation], [citation, newCitation]);
    expect(merged.map((entry) => entry.id)).toEqual([
      "citation-immutable",
      "new-citation",
    ]);
    merged[0].quote = "Different";
    expect(citation.quote).toBe("The comparison group improved by 12%.");
  });

  it("creates editable DOCX tables, headings, numbered citations, bibliography and limitations", async () => {
    const buffer = await exportReportDocx(output());
    const zip = new AdmZip(buffer);
    const xml = zip.readAsText("word/document.xml");
    expect(xml).toContain("<w:tbl>");
    expect(xml).toContain("Heading1");
    expect(xml).toContain("[1]");
    expect(xml).toContain("Bibliography");
    expect(xml).toContain("Page 204");
    expect(xml).toContain("version-original");
    expect(xml).toContain("The comparison group improved by 12%.");
    expect(xml).toContain("No long-term follow-up is available.");
    const markdown = exportReportMarkdown(output());
    expect(markdown).toContain("## Bibliography");
    expect(markdown).toContain("Page 204");
    expect(markdown).toContain("| Choice | Evidence |");
  });
});
