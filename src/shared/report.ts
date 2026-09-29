import MarkdownIt from "markdown-it";
import type {
  Citation,
  ReportDocument,
  ReportRevision,
  SourceRecord,
} from "./research";
import type { Project, ResearchOutput } from "./types";

const parser = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false,
});
type Token = ReturnType<typeof parser.parse>[number];
export function reportCitations(output: ResearchOutput): Citation[] {
  return output.citations?.length
    ? output.citations
    : output.sourceIds.map((id, index) => ({
        id: `legacy-${id}`,
        label: `S${index + 1}`,
        sourceId: "",
        versionId: "",
        passageId: "",
        sourceTitle: `Legacy board source ${index + 1}`,
        locator: "Card-level reference",
        quote: "",
        acquiredAt: output.createdAt,
        verified: false,
        legacyCardId: id,
      }));
}

function inline(tokens: Token[], citations: Citation[]): ReportDocument[] {
  const nodes: ReportDocument[] = [];
  const marks: NonNullable<ReportDocument["marks"]> = [];
  const addText = (text: string, code = false) => {
    if (!text) return;
    const add = (value: string) =>
      value &&
      nodes.push({
        type: "text",
        text: value,
        ...(marks.length ? { marks: structuredClone(marks) } : {}),
        ...(code ? { marks: [{ type: "code" }] } : {}),
      });
    if (code) {
      add(text);
      return;
    }
    let cursor = 0;
    for (const match of text.matchAll(/\[(S?\d+)\]/g)) {
      const citation = citations.find(
        (entry, index) =>
          entry.label.replace(/[\[\]]/g, "") === match[1] ||
          String(index + 1) === match[1],
      );
      if (!citation) continue;
      add(text.slice(cursor, match.index));
      nodes.push({
        type: "citation",
        attrs: {
          citationId: citation.id,
          label: String(citations.indexOf(citation) + 1),
        },
      });
      cursor = match.index! + match[0].length;
    }
    add(text.slice(cursor));
  };
  for (const token of tokens) {
    if (token.type === "text") addText(token.content);
    else if (token.type === "code_inline") addText(token.content, true);
    else if (token.type === "softbreak" || token.type === "hardbreak")
      nodes.push({ type: "hardBreak" });
    else if (token.type === "image")
      addText(`[Referenced image: ${token.content || "image"}]`);
    else if (token.type.endsWith("_open")) {
      const type = (
        {
          strong_open: "bold",
          em_open: "italic",
          s_open: "strike",
          link_open: "link",
        } as Record<string, string>
      )[token.type];
      if (type === "link") {
        const href = String(token.attrGet("href") || "");
        marks.push({
          type,
          attrs: { href: /^https?:\/\//i.test(href) ? href : "" },
        });
      } else if (type) marks.push({ type });
    } else if (token.type.endsWith("_close")) marks.pop();
  }
  return nodes;
}

/** Parse Markdown as text tokens; raw HTML and remote images never enter the document. */
export function markdownToReport(
  markdown: string,
  citations: Citation[] = [],
): ReportDocument {
  const root: ReportDocument = { type: "doc", content: [] };
  const stack: ReportDocument[] = [root];
  const append = (node: ReportDocument) =>
    stack[stack.length - 1].content!.push(node);
  const ignored = new Set([
    "thead_open",
    "thead_close",
    "tbody_open",
    "tbody_close",
  ]);
  for (const token of parser.parse(markdown, {})) {
    if (ignored.has(token.type)) continue;
    if (token.type === "inline") {
      const parent = stack[stack.length - 1];
      const content = inline(token.children || [], citations);
      if (parent.type === "tableCell" || parent.type === "tableHeader")
        append({ type: "paragraph", content });
      else parent.content!.push(...content);
    } else if (token.type === "fence" || token.type === "code_block")
      append({
        type: "codeBlock",
        content: token.content
          ? [{ type: "text", text: token.content.replace(/\n$/, "") }]
          : [],
      });
    else if (token.type === "hr") append({ type: "horizontalRule" });
    else if (token.nesting === 1) {
      const type = (
        {
          paragraph_open: "paragraph",
          heading_open: "heading",
          blockquote_open: "blockquote",
          bullet_list_open: "bulletList",
          ordered_list_open: "orderedList",
          list_item_open: "listItem",
          table_open: "table",
          tr_open: "tableRow",
          th_open: "tableHeader",
          td_open: "tableCell",
        } as Record<string, string>
      )[token.type];
      if (!type) continue;
      const node: ReportDocument = { type, content: [] };
      if (type === "heading")
        node.attrs = { level: Number(token.tag.slice(1)) };
      if (type === "orderedList")
        node.attrs = { start: Number(token.attrGet("start") || 1) };
      if (type === "tableCell" || type === "tableHeader")
        node.attrs = { colspan: 1, rowspan: 1, colwidth: null };
      append(node);
      stack.push(node);
    } else if (token.nesting === -1 && stack.length > 1) {
      const closed = stack.pop()!;
      if (
        (closed.type === "tableCell" || closed.type === "tableHeader") &&
        !closed.content?.length
      )
        closed.content = [{ type: "paragraph" }];
    }
  }
  if (!root.content?.length) root.content = [{ type: "paragraph" }];
  return root;
}

export function reportDocument(output: ResearchOutput): ReportDocument {
  return (
    output.document ||
    markdownToReport(output.markdown, reportCitations(output))
  );
}

export function citationNumber(node: ReportDocument, citations: Citation[]) {
  const index = citations.findIndex(
    (citation) => citation.id === node.attrs?.citationId,
  );
  return index >= 0 ? String(index + 1) : "?";
}

function escapeMarkdown(value: string) {
  return value.replace(/[\\`*_[\]<>]/g, "\\$&");
}
export function reportToMarkdown(
  document: ReportDocument,
  citations: Citation[] = [],
): string {
  const render = (node: ReportDocument): string => {
    const children = () => (node.content || []).map(render).join("");
    if (node.type === "text") {
      let text = escapeMarkdown(node.text || "");
      for (const mark of node.marks || []) {
        if (mark.type === "bold") text = `**${text}**`;
        if (mark.type === "italic") text = `*${text}*`;
        if (mark.type === "strike") text = `~~${text}~~`;
        if (mark.type === "code")
          text = `\`${(node.text || "").replace(/`/g, "\\`")}\``;
        if (
          mark.type === "link" &&
          /^https?:\/\//i.test(String(mark.attrs?.href))
        )
          text = `[${text}](${String(mark.attrs!.href).replace(/[()\s]/g, (c) => encodeURIComponent(c))})`;
      }
      return text;
    }
    if (node.type === "citation") return `[${citationNumber(node, citations)}]`;
    if (node.type === "hardBreak") return "  \n";
    if (node.type === "heading")
      return `${"#".repeat(Math.min(6, Math.max(1, Number(node.attrs?.level) || 2)))} ${children()}\n\n`;
    if (node.type === "paragraph") return `${children()}\n\n`;
    if (node.type === "horizontalRule") return "\n---\n\n";
    if (node.type === "codeBlock")
      return `\`\`\`\n${(node.content || []).map((entry) => entry.text || "").join("")}\n\`\`\`\n\n`;
    if (node.type === "blockquote")
      return (
        children()
          .trim()
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n") + "\n\n"
      );
    if (node.type === "bulletList" || node.type === "orderedList")
      return (
        (node.content || [])
          .map(
            (item, index) =>
              `${node.type === "bulletList" ? "-" : `${index + (Number(node.attrs?.start) || 1)}.`} ${render(item).trim().replace(/\n/g, "\n  ")}`,
          )
          .join("\n") + "\n\n"
      );
    if (node.type === "table") {
      const rows = (node.content || []).map((row) =>
        (row.content || []).map((cell) =>
          render(cell).trim().replace(/\|/g, "\\|").replace(/\n+/g, " "),
        ),
      );
      if (!rows.length) return "";
      return (
        [rows[0], rows[0].map(() => "---"), ...rows.slice(1)]
          .map((row) => `| ${row.join(" | ")} |`)
          .join("\n") + "\n\n"
      );
    }
    return children();
  };
  return render(document).trim();
}

export function citationDescription(citation: Citation): string {
  const when = citation.acquiredAt
    ? ` Acquired ${citation.acquiredAt.slice(0, 10)}.`
    : "";
  return `${citation.sourceTitle} — ${citation.locator}.${citation.legacyCardId ? " Legacy card-level reference; passage not verified." : ` Source version ${citation.versionId}. ${citation.verified ? "Quotation location verified." : "Quotation location unverified."}`}${when}${citation.url ? ` ${citation.url}` : ""}`;
}

export function snapshotRevision(
  output: ResearchOutput,
  note = "Saved revision",
  id: string = crypto.randomUUID(),
): ReportRevision {
  const citations = structuredClone(reportCitations(output));
  const document = structuredClone(reportDocument(output));
  return {
    id,
    createdAt: new Date().toISOString(),
    document,
    markdown: reportToMarkdown(document, citations),
    citations,
    note,
  };
}

/** Audience display is deliberately independent of the editable draft. */
export function releasedReport(project: Project): ResearchOutput | undefined {
  const output = project.outputs.find(
    (entry) => entry.id === project.releasedOutputId,
  );
  const revision = output?.revisions?.find(
    (entry) => entry.id === output.releasedRevisionId,
  );
  return output && revision
    ? {
        ...output,
        document: revision.document,
        markdown: revision.markdown,
        citations: revision.citations,
        createdAt: revision.createdAt,
      }
    : undefined;
}

export function changedCitationSources(
  citations: Citation[],
  sources: SourceRecord[],
): Citation[] {
  return citations.filter(
    (citation) =>
      !citation.legacyCardId &&
      sources.find((source) => source.id === citation.sourceId)
        ?.currentVersionId !== citation.versionId,
  );
}

export function canApplySection(
  document: ReportDocument,
  snapshot: string,
  selectedText: string,
  original: string,
) {
  return JSON.stringify(document) === snapshot && selectedText === original;
}

/** Merge by immutable passage identity while keeping existing numbering stable. */
export function mergeCitations(
  existing: Citation[],
  proposed: Citation[],
): Citation[] {
  const merged = structuredClone(existing);
  for (const citation of proposed)
    if (!merged.some((entry) => entry.id === citation.id))
      merged.push(structuredClone(citation));
  return merged;
}
