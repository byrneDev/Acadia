import { ArrowUpRight, Link2, Trash2, X, Sparkles } from "lucide-react";
import type { Connection, Project } from "../../shared/types";
import type { BoardPresentation } from "./boardPresentation";

export function LinkedItemInspector({
  item,
  project,
  onClose,
  onOpen,
  onRemove,
  onConnection,
  onCard,
  onSummarize,
}: {
  item: BoardPresentation;
  project: Project;
  onClose: () => void;
  onOpen: () => void;
  onRemove: () => void;
  onConnection: (connection: Connection) => void;
  onCard: (id: string) => void;
  onSummarize?: () => void;
}) {
  const connections = project.connections.filter(
    (v) => v.source === item.card.id || v.target === item.card.id,
  );
  return (
    <aside className="inspector" aria-label="Linked item details">
      <div className="panel-heading">
        <span>ITEM DETAILS</span>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close details"
        >
          <X size={16} />
        </button>
      </div>
      <div className="inspector-content">
        <span className="kind-badge">
          <Link2 size={14} />
          {item.label}
        </span>
        <h2>{item.card.title}</h2>
        <p className="linked-record-status">{item.status}</p>
        {item.historical && (
          <p className="item-insight-notice">
            A newer source version is available. This card retains the original
            historical evidence.
          </p>
        )}
        <p className="inspector-notes">{item.card.content}</p>
        <button
          className="button primary full"
          disabled={item.unavailable}
          onClick={onOpen}
        >
          <ArrowUpRight size={16} />
          {item.reference?.kind === "method"
            ? "Open worksheet"
            : `Open ${item.label.toLowerCase()}`}
        </button>
        {onSummarize && !item.unavailable && (
          <button
            className="button quiet full item-insight-trigger"
            onClick={onSummarize}
          >
            <Sparkles size={16} />
            AI summary & research advice
          </button>
        )}
        <p className="subtle-note">
          This card links to a saved research record. Its title and preview
          follow that record; removing the card keeps the record.
        </p>
        <div className="detail-section">
          <span className="eyebrow">CONNECTIONS / {connections.length}</span>
          {connections.map((connection) => {
            const otherId =
              connection.source === item.card.id
                ? connection.target
                : connection.source;
            return (
              <div key={connection.id} className="connection-row">
                <button onClick={() => onConnection(connection)}>
                  {connection.relation}
                </button>
                <button onClick={() => onCard(otherId)}>
                  {project.cards.find((v) => v.id === otherId)?.title ||
                    "Unavailable item"}
                </button>
              </div>
            );
          })}
          {!connections.length && (
            <p className="muted">
              Connect this record to the evidence and work it informs.
            </p>
          )}
        </div>
      </div>
      <div className="inspector-actions">
        <button className="button quiet" onClick={onRemove}>
          <Trash2 size={16} />
          Remove from board
        </button>
      </div>
    </aside>
  );
}
