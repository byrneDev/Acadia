import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  FileText,
  Link2,
  Lightbulb,
  CircleHelp,
  Image,
  Music2,
  Film,
  StickyNote,
  ArrowUpRight,
  Layers,
} from "lucide-react";
import type { ResearchCard } from "../../shared/types";
export const cardIcons = {
  note: StickyNote,
  question: CircleHelp,
  hypothesis: Lightbulb,
  link: Link2,
  document: FileText,
  image: Image,
  audio: Music2,
  video: Film,
};
export type BoardNode = Node<{ card: ResearchCard }, "research">;
export default memo(function ResearchNode({
  data,
  selected,
}: NodeProps<BoardNode>) {
  const card = data.card,
    Icon = card.methodId ? Layers : cardIcons[card.kind];
  return (
    <article
      className={`research-card kind-${card.kind} ${selected ? "is-selected" : ""}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        aria-label={`Connect to ${card.title}`}
      />
      <div className="card-heading">
        <span>
          <Icon size={13} />
          {card.methodId ? "Research method" : card.kind}
        </span>
        <span className={`status-dot ${card.status}`} title={card.status} />
      </div>
      {card.kind === "image" && card.assetId && (
        <img
          className="card-image"
          src={window.acadia!.assetURL(card.assetId)}
          alt={card.title}
          draggable={false}
        />
      )}
      <h3>{card.title}</h3>
      <p>
        {card.content ||
          card.extraction ||
          card.fileName ||
          (card.kind === "link"
            ? "Add notes about this source."
            : "Open to add your observations.")}
      </p>
      {card.url && (
        <div className="card-url">
          <ArrowUpRight size={12} />
          {(() => {
            try {
              return new URL(card.url).hostname;
            } catch {
              return card.url;
            }
          })()}
        </div>
      )}
      <div className="card-bottom">
        <span>
          {card.tags
            .slice(0, 2)
            .map((t) => `#${t}`)
            .join("  ") || "RESEARCH ITEM"}
        </span>
        <span>{card.id.slice(0, 5).toUpperCase()}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        aria-label={`Connect from ${card.title}`}
      />
    </article>
  );
});
