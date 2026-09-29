import type { Citation, ReportDocument } from "./research";
import type { ResearchOutput } from "./types";
import {
  markdownToReport,
  mergeCitations,
  reportCitations,
  reportDocument,
  reportToMarkdown,
} from "./report";
import type { ChallengeProposal } from "./pedigree-analysis";

export function reportFingerprint(output: ResearchOutput): string {
  return JSON.stringify({
    document: reportDocument(output),
    citations: reportCitations(output),
    deliveryPlan: output.deliveryPlan,
  });
}
function relabel(document: ReportDocument, citations: Citation[]): void {
  if (document.type === "citation")
    document.attrs = {
      ...document.attrs,
      label: String(
        citations.findIndex((c) => c.id === document.attrs?.citationId) + 1,
      ),
    };
  document.content?.forEach((n) => relabel(n, citations));
}
export function appendReportContent(
  output: ResearchOutput,
  expected: string,
  appendix: { markdown: string; citations: Citation[] },
): ResearchOutput {
  if (reportFingerprint(output) !== expected)
    throw new Error(
      "The draft changed while this preview was open. Preview the appendix again to preserve your latest writing.",
    );
  const citations = mergeCitations(reportCitations(output), appendix.citations),
    added = markdownToReport(
      appendix.markdown,
      appendix.citations.map((c, i) => ({ ...c, label: String(i + 1) })),
    );
  relabel(added, citations);
  const document = {
    ...structuredClone(reportDocument(output)),
    content: [
      ...structuredClone(reportDocument(output).content || []),
      ...(added.content || []),
    ],
  };
  return {
    ...output,
    document,
    citations,
    markdown: reportToMarkdown(document, citations),
  };
}

/** Replace only a uniquely identified node range. Untouched formatting, tables,
 * citation objects and surrounding content are retained verbatim. */
export function applyReportChallenge(
  output: ResearchOutput,
  originalDocument: ReportDocument,
  change: NonNullable<ChallengeProposal["suggestedChanges"]>[number],
  proposalCitations: Citation[],
): ResearchOutput {
  const current = reportDocument(output),
    original = change.original.trim();
  if (JSON.stringify(current) !== JSON.stringify(originalDocument))
    throw new Error(
      "The report changed after this challenge began. Run the challenge again before applying wording.",
    );
  const markdown = reportToMarkdown(current, reportCitations(output));
  if (
    !original ||
    !markdown.includes(original) ||
    markdown.indexOf(original) !== markdown.lastIndexOf(original)
  )
    throw new Error(
      "The original wording is missing or ambiguous. Select the passage in the editor for a section revision.",
    );
  const relevantCitations = proposalCitations.filter((c) =>
    change.citationIds.includes(c.id),
  );
  const citations = mergeCitations(reportCitations(output), relevantCitations),
    replacement = markdownToReport(change.proposed, relevantCitations);
  relabel(replacement, citations);
  const document = structuredClone(current);
  const blocks: { parent: ReportDocument; start: number; count: number }[] = [];
  const findBlocks = (parent: ReportDocument) => {
    if (
      parent.content?.some(
        (n) => !["text", "citation", "hardBreak"].includes(n.type),
      )
    ) {
      for (let start = 0; start < parent.content.length; start++) {
        for (let end = start + 1; end <= parent.content.length; end++) {
          const text = reportToMarkdown(
            { type: "doc", content: parent.content.slice(start, end) },
            reportCitations(output),
          );
          if (text === original)
            blocks.push({ parent, start, count: end - start });
          if (text.length > original.length) break;
        }
      }
    }
    parent.content?.forEach(findBlocks);
  };
  findBlocks(document);
  if (blocks.length === 1) {
    const match = blocks[0];
    match.parent.content!.splice(
      match.start,
      match.count,
      ...(replacement.content || []),
    );
  } else if (!blocks.length) {
    const parsed = markdownToReport(
      original,
      reportCitations(output).map((c, i) => ({ ...c, label: String(i + 1) })),
    );
    if (
      parsed.content?.length !== 1 ||
      parsed.content[0].type !== "paragraph" ||
      replacement.content?.length !== 1 ||
      replacement.content[0].type !== "paragraph"
    )
      throw new Error(
        "This change spans a structural boundary. Use the editor's selected-section revision to preserve formatting.",
      );
    const textOf = (node: ReportDocument): string =>
      node.type === "text"
        ? node.text || ""
        : node.type === "citation"
          ? `[${reportCitations(output).findIndex((c) => c.id === node.attrs?.citationId) + 1}]`
          : node.type === "hardBreak"
            ? "\n"
            : (node.content || []).map(textOf).join("");
    const needle = textOf(parsed.content[0]),
      matches: { node: ReportDocument; start: number }[] = [];
    const visit = (node: ReportDocument) => {
      if (["paragraph", "heading"].includes(node.type)) {
        const text = textOf(node),
          start = text.indexOf(needle);
        if (start >= 0 && start === text.lastIndexOf(needle))
          matches.push({ node, start });
      }
      node.content?.forEach(visit);
    };
    visit(document);
    if (matches.length !== 1)
      throw new Error(
        "This wording does not identify a unique editor range. Select the passage for a section revision.",
      );
    const { node, start } = matches[0],
      end = start + needle.length;
    const before: ReportDocument[] = [],
      after: ReportDocument[] = [];
    let offset = 0;
    for (const child of node.content || []) {
      const length = textOf(child).length,
        next = offset + length;
      if (next <= start) before.push(child);
      else if (offset >= end) after.push(child);
      else {
        if (
          child.type !== "text" &&
          ((start > offset && start < next) || (end > offset && end < next))
        )
          throw new Error(
            "A proposed change cuts through a citation. Select the full passage before revising.",
          );
        if (child.type === "text") {
          if (start > offset)
            before.push({
              ...child,
              text: child.text!.slice(0, start - offset),
            });
          if (end < next)
            after.push({ ...child, text: child.text!.slice(end - offset) });
        }
      }
      offset = next;
    }
    node.content = [
      ...before,
      ...(replacement.content[0].content || []),
      ...after,
    ];
  } else
    throw new Error(
      "The original wording identifies more than one editor range. Select the passage for a section revision.",
    );
  return {
    ...output,
    document,
    citations,
    markdown: reportToMarkdown(document, citations),
  };
}
