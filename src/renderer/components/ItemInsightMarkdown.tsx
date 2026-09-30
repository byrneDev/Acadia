import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Citation } from "../../shared/research";
import "./ItemInsightDialog.css";

// Link plain citation text without turning model-generated URLs into navigation.
function referenceLinks(citations: Citation[]) {
  const labels = new Set(citations.map((citation) => citation.label));
  return () => (tree: { type: string; children?: unknown[] }) => {
    type Node = {
      type: string;
      value?: string;
      url?: string;
      children?: Node[];
    };
    const visit = (node: Node) => {
      if (!node.children || ["link", "code", "inlineCode"].includes(node.type))
        return;
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) {
          visit(child);
          return [child];
        }
        const next: Node[] = [];
        let cursor = 0;
        for (const match of child.value.matchAll(/\[(\d+)\]/g)) {
          if (!labels.has(match[1])) continue;
          if (match.index! > cursor)
            next.push({
              type: "text",
              value: child.value.slice(cursor, match.index),
            });
          next.push({
            type: "link",
            url: `#item-citation-${match[1]}`,
            children: [{ type: "text", value: match[0] }],
          });
          cursor = match.index! + match[0].length;
        }
        if (cursor < child.value.length)
          next.push({ type: "text", value: child.value.slice(cursor) });
        return next;
      });
    };
    visit(tree as Node);
  };
}

export function ItemInsightMarkdown({
  markdown,
  citations,
  onCitation,
}: {
  markdown: string;
  citations: Citation[];
  onCitation: (citation: Citation) => void;
}) {
  return (
    <div className="item-insight-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, referenceLinks(citations)]}
        components={{
          a: ({ href, children }) => {
            const citation = citations.find(
              (entry) => href === `#item-citation-${entry.label}`,
            );
            return citation ? (
              <button
                type="button"
                className="item-insight-citation"
                aria-label={`Open reference [${citation.label}] · ${citation.sourceTitle} · ${citation.locator}`}
                onClick={() => onCitation(citation)}
              >
                {children}
              </button>
            ) : (
              <span>{children}</span>
            );
          },
          img: ({ alt }) => (
            <span>{alt ? `[Image: ${alt}]` : "[Image omitted]"}</span>
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
