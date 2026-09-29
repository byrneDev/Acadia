import type { ProjectPrivacy } from "../../shared/research";
import { useEffect, useRef, useState } from "react";
import { X, ArrowUpRight, Trash2, FileUp, Monitor } from "lucide-react";
import type {
  AISettings,
  CardKind,
  Connection,
  DisplayInfo,
  Project,
  Relation,
  ResearchCard,
} from "../../shared/types";
import { cardIcons } from "./ResearchNode";
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">ACADIA / WORKSPACE</span>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
const kinds: CardKind[] = ["note", "question", "hypothesis", "link"];
export function CardDialog({
  initial,
  onSave,
  onClose,
  onImport,
}: {
  initial?: ResearchCard;
  onSave: (values: Partial<ResearchCard>) => void;
  onClose: () => void;
  onImport: () => void;
}) {
  const [kind, setKind] = useState<CardKind>(initial?.kind || "note");
  const [title, setTitle] = useState(initial?.title || "");
  const [content, setContent] = useState(initial?.content || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [tags, setTags] = useState(initial?.tags.join(", ") || "");
  const [error, setError] = useState("");
  return (
    <Modal
      title={initial ? "Edit research item" : "Add to the Collector"}
      subtitle="Capture the idea. Follow the connection."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          if (kind === "link") {
            try {
              const u = new URL(url);
              if (!["http:", "https:"].includes(u.protocol)) throw 0;
            } catch {
              setError("Enter a complete http:// or https:// link.");
              return;
            }
          }
          onSave({
            kind,
            title: title.trim(),
            content,
            url: kind === "link" ? url : undefined,
            tags: tags
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, 20),
          });
        }}
      >
        {!initial && (
          <div className="kind-picker">
            {kinds.map((k) => {
              const Icon = cardIcons[k];
              return (
                <button
                  type="button"
                  className={kind === k ? "active" : ""}
                  onClick={() => setKind(k)}
                  key={k}
                >
                  <Icon size={19} />
                  {k}
                </button>
              );
            })}
          </div>
        )}
        <label className="field">
          Title
          <input
            autoFocus
            required
            maxLength={300}
            placeholder={
              kind === "question"
                ? "What do we need to understand?"
                : "Give this item a clear title"
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {kind === "link" && (
          <label className="field">
            Source URL
            <input
              required
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
          </label>
        )}
        <label className="field">
          {kind === "hypothesis"
            ? "Working hypothesis"
            : "Notes & observations"}
          <textarea
            rows={6}
            value={content}
            maxLength={100000}
            onChange={(e) => setContent(e.target.value)}
            placeholder="What makes this useful? Add context, excerpts, or the next question."
          />
        </label>
        <label className="field">
          Tags <span className="muted">separate with commas</span>
          <input
            value={tags}
            maxLength={500}
            onChange={(e) => setTags(e.target.value)}
            placeholder="research, methodology, follow-up"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          {!initial && (
            <button className="button quiet" type="button" onClick={onImport}>
              <FileUp size={16} />
              Import files
            </button>
          )}
          <button type="submit" className="button primary">
            {initial ? "Save changes" : "Add item"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function Inspector({
  card,
  connections,
  project,
  onClose,
  onEdit,
  onChange,
  onDelete,
  onSource,
  onConnection,
  onError,
}: {
  card: ResearchCard;
  connections: Connection[];
  project: Project;
  onClose: () => void;
  onEdit: () => void;
  onChange: (v: Partial<ResearchCard>) => void;
  onDelete: () => void;
  onSource: (id: string) => void;
  onConnection: (c: Connection) => void;
  onError: (e: unknown) => void;
}) {
  const Icon = cardIcons[card.kind];
  return (
    <aside className="inspector">
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
        <span className={`kind-badge kind-${card.kind}`}>
          <Icon size={14} />
          {card.kind}
        </span>
        <h2>{card.title}</h2>
        {card.kind === "image" && card.assetId && (
          <img
            className="inspector-image"
            src={window.acadia!.assetURL(card.assetId)}
            alt={card.title}
          />
        )}
        {card.kind === "audio" && card.assetId && (
          <audio controls src={window.acadia!.assetURL(card.assetId)} />
        )}
        {card.kind === "video" && card.assetId && (
          <video controls src={window.acadia!.assetURL(card.assetId)} />
        )}
        <p className="inspector-notes">
          {card.content ||
            "No observations yet. Edit this item to add context."}
        </p>
        {card.url && (
          <button
            className="source-link"
            onClick={() =>
              window.acadia!.openExternal(card.url!).catch(onError)
            }
          >
            <ArrowUpRight size={15} />
            <span>{card.url}</span>
          </button>
        )}
        {card.assetId && (
          <button
            className="button quiet full"
            onClick={() =>
              window.acadia!.openAsset(card.assetId!).catch(onError)
            }
          >
            <ArrowUpRight size={15} />
            Open original file
          </button>
        )}
        {card.extraction && (
          <details className="extraction-note">
            <summary>Extracted source text</summary>
            <pre>{card.extraction}</pre>
          </details>
        )}
        {card.assetId && !card.extraction && (
          <p className="extraction-note">
            No text extracted. Add notes or a transcript to include this source
            in synthesis.
          </p>
        )}
        <label className="field">
          Evidence review
          <select
            value={card.status}
            onChange={(e) =>
              onChange({ status: e.target.value as ResearchCard["status"] })
            }
          >
            <option value="unreviewed">Unreviewed</option>
            <option value="supported">Supported by my review</option>
            <option value="disputed">Disputed / conflicting</option>
          </select>
        </label>
        <p className="subtle-note">
          Review status records your assessment. It is not independent
          verification.
        </p>
        <div className="tag-row">
          {card.tags.map((t) => (
            <span key={t}>#{t}</span>
          ))}
        </div>
        <div className="detail-section">
          <span className="eyebrow">CONNECTIONS / {connections.length}</span>
          {connections.length ? (
            connections.map((c) => {
              const other = project.cards.find(
                (n) => n.id === (c.source === card.id ? c.target : c.source),
              );
              return (
                <div className="connection-row" key={c.id}>
                  <button onClick={() => onConnection(c)}>
                    {c.source === card.id ? "→" : "←"} {c.relation}
                  </button>
                  <button onClick={() => onSource(other!.id)}>
                    {other?.title}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="muted">
              Drag from this card’s right handle to another card’s left handle.
            </p>
          )}
        </div>
        <div className="detail-section">
          <span className="eyebrow">PROVENANCE</span>
          <dl>
            <dt>Added</dt>
            <dd>{new Date(card.createdAt).toLocaleDateString()}</dd>
            <dt>Source ID</dt>
            <dd className="mono">{card.id}</dd>
          </dl>
        </div>
      </div>
      <div className="inspector-actions">
        <button className="button primary" onClick={onEdit}>
          Edit item
        </button>
        <button
          className="icon-button danger"
          aria-label="Delete item"
          onClick={onDelete}
        >
          <Trash2 size={17} />
        </button>
      </div>
    </aside>
  );
}
export function ConnectionDialog({
  connection,
  project,
  onSave,
  onDelete,
  onClose,
}: {
  connection: Connection;
  project: Project;
  onSave: (relation: Relation) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [relation, setRelation] = useState(connection.relation);
  const relations: Relation[] = [
    "relates to",
    "supports",
    "contradicts",
    "derived from",
    "investigate",
  ];
  return (
    <Modal title="A meaningful connection" onClose={onClose}>
      <p className="connection-endpoint">
        {project.cards.find((c) => c.id === connection.source)?.title}
      </p>
      <label className="field">
        Relationship
        <select
          value={relation}
          onChange={(e) => setRelation(e.target.value as Relation)}
        >
          {relations.map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <p className="connection-endpoint">
        → {project.cards.find((c) => c.id === connection.target)?.title}
      </p>
      <div className="modal-actions">
        <button className="button quiet danger" onClick={onDelete}>
          Remove connection
        </button>
        <button className="button primary" onClick={() => onSave(relation)}>
          Save connection
        </button>
      </div>
    </Modal>
  );
}
export function SettingsDialog({
  settings,
  privacy,
  onPrivacy,
  onSave,
  onClose,
}: {
  privacy: ProjectPrivacy;
  onPrivacy: (privacy: ProjectPrivacy) => void;
  settings: AISettings;
  onSave: (s: AISettings) => Promise<void>;
  onClose: () => void;
}) {
  const [s, set] = useState({ ...settings, apiKey: "" });
  const [mode, setMode] = useState(privacy.mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Research engine"
      subtitle="Choose where the Releaser develops your research."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            if (
              mode === "local" &&
              s.provider !== "offline" &&
              !["localhost", "127.0.0.1", "[::1]"].includes(
                new URL(s.endpoint).hostname,
              )
            )
              throw new Error(
                "Local analysis requires a loopback model endpoint. Choose cloud analysis to send passages to this provider.",
              );
            await onSave(s);
            onPrivacy({
              mode,
              provider: s.provider,
              endpoint: s.endpoint,
              model: s.model,
            });
            onClose();
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="privacy-settings">
          <label className="field">
            Analysis privacy for this project
            <select
              value={mode}
              onChange={(e) =>
                setMode(e.target.value as ProjectPrivacy["mode"])
              }
            >
              <option value="local">Local — this computer only</option>
              <option value="cloud">Cloud — selected provider</option>
            </select>
          </label>
          <p>
            {mode === "local"
              ? "Document passages stay on this computer. Local model endpoints must use localhost."
              : "Included passages may be sent to the provider below when you start analysis."}{" "}
            External web discovery always requires its own approved plan.
          </p>
        </div>
        <label className="field">
          Engine
          <select
            value={s.provider}
            onChange={(e) => {
              const provider = e.target.value as AISettings["provider"];
              set({
                ...s,
                provider,
                endpoint:
                  provider === "ollama"
                    ? "http://127.0.0.1:11434"
                    : provider === "compatible"
                      ? "https://api.openai.com/v1"
                      : "",
                model: provider === "ollama" ? "llama3.2" : "",
              });
            }}
          >
            <option value="offline">Offline evidence outline — no AI</option>
            <option value="ollama">Ollama — local AI</option>
            <option value="compatible">
              Compatible API — cloud or local AI
            </option>
          </select>
        </label>
        {s.provider === "offline" ? (
          <p className="settings-note">
            Create structured evidence outlines without a model or connection.
            These organize the material you collected; they do not infer
            findings or perform an AI analysis.
          </p>
        ) : (
          <>
            <label className="field">
              {s.provider === "ollama" ? "Ollama server" : "API base URL"}
              <input
                type="url"
                value={s.endpoint}
                required
                onChange={(e) => set({ ...s, endpoint: e.target.value })}
              />
            </label>
            <label className="field">
              Model name
              <input
                value={s.model}
                required
                onChange={(e) => set({ ...s, model: e.target.value })}
                placeholder="Enter an installed or provider-supported model"
              />
            </label>
            {s.provider === "compatible" && (
              <label className="field">
                API key{" "}
                <span className="muted">
                  blank keeps key for the same provider and server
                </span>
                <input
                  type="password"
                  autoComplete="off"
                  value={s.apiKey}
                  onChange={(e) => set({ ...s, apiKey: e.target.value })}
                />
              </label>
            )}
            <p className="settings-note">
              Your question, retrieved source passages, and instructions are
              sent to this server when you start analysis. Source content is
              never sent to a different provider as a fallback. Cloud usage may
              incur charges from your provider.
            </p>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button disabled={busy} className="button primary" type="submit">
            {busy ? "Saving…" : "Save engine"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function DisplayDialog({
  displays,
  onClose,
  onOpen,
}: {
  displays: DisplayInfo[];
  onClose: () => void;
  onOpen: (id?: number) => void;
}) {
  return (
    <Modal
      title="Open the Releaser"
      subtitle="A separate output window, connected to your Collector."
      onClose={onClose}
    >
      <div className="display-list">
        {displays.map((d) => (
          <button key={d.id} onClick={() => onOpen(d.id)}>
            <Monitor size={24} />
            <span>
              <strong>{d.label}</strong>
              <small>
                {d.primary ? "Primary display" : "Extended display"}
              </small>
            </span>
            <ArrowUpRight size={18} />
          </button>
        ))}
      </div>
      <p className="muted">
        You can move the window to another screen and enter fullscreen. Outputs
        update when you save a new release.
      </p>
    </Modal>
  );
}
