import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import type { Citation, ReportDocument } from "../shared/research";
import type { ResearchOutput } from "../shared/types";
import {
  citationDescription,
  citationNumber,
  reportCitations,
  reportDocument,
  reportToMarkdown,
  markdownToReport,
} from "../shared/report";
import { deliveryPlanMarkdown } from "../shared/pmis";
import { escapeHTML } from "./storage";
function exportDocument(output: ResearchOutput): ReportDocument {
  const document = reportDocument(output);
  return output.deliveryPlan
    ? {
        ...document,
        content: [
          ...(document.content || []),
          ...(markdownToReport(deliveryPlanMarkdown(output.deliveryPlan))
            .content || []),
        ],
      }
    : document;
}

export function exportReportMarkdown(output: ResearchOutput): string {
  const citations = reportCitations(output);
  return `${reportToMarkdown(exportDocument(output), citations)}${citations.length ? `\n\n## Bibliography\n\n${citations.map((citation, index) => `[${index + 1}] ${citationDescription(citation)}${citation.quote ? `\n\n> ${citation.quote.replace(/\n/g, "\n> ")}` : ""}`).join("\n\n")}` : ""}\n`;
}

/** Restrictive structured renderer. No HTML, images, script, or remote resource loading. */
export function reportBodyHTML(
  document: ReportDocument,
  citations: Citation[],
): string {
  const render = (node: ReportDocument): string => {
    const children = () => (node.content || []).map(render).join("");
    if (node.type === "text") {
      let text = escapeHTML(node.text || "");
      for (const mark of node.marks || []) {
        const tag = (
          { bold: "strong", italic: "em", strike: "s", code: "code" } as Record<
            string,
            string
          >
        )[mark.type];
        if (tag) text = `<${tag}>${text}</${tag}>`;
        else if (
          mark.type === "link" &&
          /^https?:\/\//i.test(String(mark.attrs?.href))
        )
          text = `<a href="${escapeHTML(String(mark.attrs!.href))}">${text}</a>`;
      }
      return text;
    }
    if (node.type === "citation")
      return `<sup class="citation">[${citationNumber(node, citations)}]</sup>`;
    if (node.type === "hardBreak") return "<br>";
    if (node.type === "horizontalRule") return "<hr>";
    if (node.type === "table") {
      const rows = node.content || [];
      let firstBody = rows.findIndex(
        (row) =>
          !row.content?.length ||
          !row.content.every((cell) => cell.type === "tableHeader"),
      );
      if (firstBody < 0) firstBody = rows.length;
      const header = firstBody
        ? `<thead>${rows.slice(0, firstBody).map(render).join("")}</thead>`
        : "";
      return `<table>${header}<tbody>${rows.slice(firstBody).map(render).join("")}</tbody></table>`;
    }
    if (node.type === "heading") {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 2));
      return `<h${level}>${children()}</h${level}>`;
    }
    const tag = (
      {
        doc: "div",
        paragraph: "p",
        blockquote: "blockquote",
        bulletList: "ul",
        orderedList: "ol",
        listItem: "li",
        codeBlock: "pre",
        table: "table",
        tableRow: "tr",
        tableCell: "td",
        tableHeader: "th",
      } as Record<string, string>
    )[node.type];
    return tag ? `<${tag}>${children()}</${tag}>` : children();
  };
  return render(document);
}

export function outputHTML(output: ResearchOutput): string {
  const citations = reportCitations(output);
  const bibliography = citations.length
    ? `<section class="bibliography"><h2>Bibliography</h2><ol>${citations.map((citation) => `<li>${escapeHTML(citationDescription(citation))}${citation.quote ? `<blockquote>${escapeHTML(citation.quote)}</blockquote>` : ""}</li>`).join("")}</ol></section>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHTML(output.title)}</title><style>@page{size:A4;margin:19mm 18mm}body{color:#18231f;font:11pt/1.55 Arial,sans-serif}h1{font-size:25pt;line-height:1.2}h2{font-size:17pt;border-bottom:1px solid #ccd5cb;padding-bottom:5px}h3{font-size:13pt}h1,h2,h3,h4{break-after:avoid}p,li{overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#f0f4f2;padding:12px}table{border-collapse:collapse;width:100%;font-size:9pt;table-layout:fixed}th,td{border:1px solid #bbc8ba;padding:7px;vertical-align:top;overflow-wrap:anywhere}th{background:#edf2e9}tr{break-inside:avoid}thead{display:table-header-group}blockquote{margin:12px 0;padding:6px 12px;border-left:2px solid #889b7b;font-size:10pt}a{color:#2c593c}.brand{font-size:9pt;letter-spacing:2px;color:#67776e;border-bottom:1px solid #b6c7bd;padding-bottom:12px;margin-bottom:24px}.citation{color:#456234;font-weight:bold}.bibliography{font-size:9pt}.bibliography li{margin-bottom:14px}.bibliography blockquote{font-size:9pt}hr{border:0;border-top:1px solid #cbd4c9}</style></head><body><div class="brand">ACADIA / RELEASER</div>${reportBodyHTML(exportDocument(output), citations)}${bibliography}</body></html>`;
}

export async function exportReportDocx(
  output: ResearchOutput,
): Promise<Buffer> {
  const citations = reportCitations(output);
  const inline = (nodes: ReportDocument[]): ParagraphChild[] =>
    nodes.flatMap((node): ParagraphChild[] => {
      if (node.type === "hardBreak") return [new TextRun({ break: 1 })];
      if (node.type === "citation")
        return [
          new TextRun({
            text: `[${citationNumber(node, citations)}]`,
            superScript: true,
            color: "456234",
          }),
        ];
      if (node.type === "text")
        return [
          new TextRun({
            text: node.text || "",
            bold: node.marks?.some((mark) => mark.type === "bold"),
            italics: node.marks?.some((mark) => mark.type === "italic"),
            strike: node.marks?.some((mark) => mark.type === "strike"),
            font: node.marks?.some((mark) => mark.type === "code")
              ? "Consolas"
              : undefined,
          }),
        ];
      return inline(node.content || []);
    });
  const headings = [
    HeadingLevel.HEADING_1,
    HeadingLevel.HEADING_2,
    HeadingLevel.HEADING_3,
    HeadingLevel.HEADING_4,
    HeadingLevel.HEADING_5,
    HeadingLevel.HEADING_6,
  ];
  const blocks = (nodes: ReportDocument[], depth = 0): (Paragraph | Table)[] =>
    nodes.flatMap((node): (Paragraph | Table)[] => {
      if (node.type === "table")
        return [
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: (node.content || []).map(
              (row) =>
                new TableRow({
                  tableHeader: row.content?.every(
                    (cell) => cell.type === "tableHeader",
                  ),
                  children: (row.content || []).map((cell) => {
                    const children = blocks(cell.content || []);
                    return new TableCell({
                      children: children.length
                        ? children
                        : [new Paragraph("")],
                      shading:
                        cell.type === "tableHeader"
                          ? { fill: "EDF2E9" }
                          : undefined,
                    });
                  }),
                }),
            ),
          }),
        ];
      if (node.type === "bulletList" || node.type === "orderedList")
        return (node.content || []).flatMap((item, index) => {
          const [first, ...rest] = item.content || [];
          const prefix =
            node.type === "bulletList"
              ? "• "
              : `${index + (Number(node.attrs?.start) || 1)}. `;
          return [
            new Paragraph({
              children: [new TextRun(prefix), ...inline(first?.content || [])],
              indent: { left: 240 * (depth + 1) },
              spacing: { after: 100 },
            }),
            ...blocks(rest, depth + 1),
          ];
        });
      if (node.type === "blockquote")
        return blocks(node.content || [], depth + 1);
      if (node.type === "horizontalRule")
        return [
          new Paragraph({
            text: "________________________________",
            spacing: { after: 140 },
          }),
        ];
      if (node.type === "doc" || node.type === "listItem")
        return blocks(node.content || [], depth);
      return [
        new Paragraph({
          children: inline(node.content || []),
          heading:
            node.type === "heading"
              ? headings[
                  Math.min(5, Math.max(0, (Number(node.attrs?.level) || 2) - 1))
                ]
              : undefined,
          spacing: { after: 160 },
          keepNext: node.type === "heading",
          indent: depth ? { left: depth * 240 } : undefined,
        }),
      ];
    });
  const children: (Paragraph | Table)[] = [
    new Paragraph({
      children: [
        new TextRun({ text: "ACADIA / RELEASER", color: "67776E", size: 18 }),
      ],
      spacing: { after: 300 },
    }),
    ...blocks(exportDocument(output).content || []),
  ];
  if (citations.length) {
    children.push(
      new Paragraph({ text: "Bibliography", heading: HeadingLevel.HEADING_2 }),
    );
    for (const [index, citation] of citations.entries()) {
      children.push(
        new Paragraph({
          text: `[${index + 1}] ${citationDescription(citation)}`,
          spacing: { after: 100 },
        }),
      );
      if (citation.quote)
        children.push(
          new Paragraph({
            children: [new TextRun({ text: citation.quote, italics: true })],
            indent: { left: 240 },
            spacing: { after: 200 },
          }),
        );
    }
  }
  return Packer.toBuffer(
    new Document({
      title: output.title,
      creator: "Acadia",
      styles: {
        default: {
          document: {
            run: { font: "Arial", size: 22 },
            paragraph: { spacing: { line: 300 } },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: { top: 1080, right: 1020, bottom: 1080, left: 1020 },
            },
          },
          children,
        },
      ],
    }),
  );
}
