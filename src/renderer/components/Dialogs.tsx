import type {
  ProjectPrivacy,
  ResearchClaim,
  Citation,
} from "../../shared/research";
import { ReviewerNotes } from "./ReviewerNotes";
import { useEffect, useLayoutEffect, useRef, useState, useId } from "react";
import {
  X,
  ArrowUpRight,
  Trash2,
  FileUp,
  Monitor,
  GitCompareArrows,
  LayoutGrid,
  GitBranch,
  ShieldAlert,
  Rocket,
  Layers,
  Sparkles,
} from "lucide-react";
import { METHOD_REGISTRY, type MethodKind } from "../../shared/pedigree";
import "./CardDialog.css";
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
  const opener = useRef(document.activeElement);
  const titleId = useId();
  const subtitleId = useId();
  useLayoutEffect(() => {
    const d = ref.current!;
    d.showModal();
    d.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      d.close();
      if (
        opener.current instanceof HTMLElement &&
        opener.current.isConnected &&
        !document.querySelector("dialog[open]")
      )
        opener.current.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={subtitle ? subtitleId : undefined}
      className={`modal ${wide ? "wide" : ""}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-head">
        <div>
          <span className="eyebrow">ACADIA / WORKSPACE</span>
          <h2 id={titleId}>{title}</h2>
          {subtitle && (
            <p id={subtitleId} className="muted">
              {subtitle}
            </p>
          )}
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
const methodIcons = {
  hypotheses: GitCompareArrows,
  swot: LayoutGrid,
  "root-cause": GitBranch,
  risk: ShieldAlert,
  trl: Rocket,
};
export function CardDialog({
  initial,
  onSave,
  onClose,
  onImport,
  onSaveMethod,
}: {
  initial?: ResearchCard;
  onSave: (values: Partial<ResearchCard>) => void;
  onClose: () => void;
  onImport: () => void;
  onSaveMethod: (values: {
    kind: MethodKind;
    title: string;
    objective: string;
    tags: string[];
  }) => Promise<void>;
}) {
  const [kind, setKind] = useState<CardKind>(initial?.kind || "note");
  const [methodKind, setMethodKind] = useState<MethodKind>();
  const method = METHOD_REGISTRY.find((entry) => entry.kind === methodKind);
  const [title, setTitle] = useState(initial?.title || "");
  const [content, setContent] = useState(initial?.content || "");
  const [url, setUrl] = useState(initial?.url || "");
  const [tags, setTags] = useState(initial?.tags.join(", ") || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const close = () => {
    if (!saving) onClose();
  };
  return (
    <Modal
      title={initial ? "Edit research item" : "Add to the Collector"}
      subtitle={
        initial
          ? "Capture the idea. Follow the connection."
          : "Capture an idea or add a linked research worksheet."
      }
      onClose={close}
      wide={!initial}
    >
      <form
        className={!initial ? "collector-add-form" : undefined}
        onSubmit={async (e) => {
          e.preventDefault();
          if (saving) return;
          const parsedTags = tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 20);
          if (method) {
            setSaving(true);
            setError("");
            try {
              await onSaveMethod({
                kind: method.kind,
                title: title.trim() || method.label,
                objective: content,
                tags: parsedTags,
              });
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "The worksheet could not be added. Your draft is still here; try again.",
              );
            } finally {
              setSaving(false);
            }
            return;
          }
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
            tags: parsedTags,
          });
        }}
      >
        {!initial && (
          <aside className="collector-add-options" aria-label="Item types">
            <fieldset disabled={saving}>
              <legend>Capture</legend>
              <div className="kind-picker">
                {kinds.map((k) => {
                  const Icon = cardIcons[k];
                  return (
                    <button
                      type="button"
                      className={!methodKind && kind === k ? "active" : ""}
                      aria-pressed={!methodKind && kind === k}
                      onClick={() => {
                        setKind(k);
                        setMethodKind(undefined);
                        setError("");
                      }}
                      key={k}
                    >
                      <Icon size={19} />
                      {k}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <fieldset disabled={saving}>
              <legend>Research methods</legend>
              <div className="collector-method-picker">
                {METHOD_REGISTRY.map((entry) => {
                  const Icon = methodIcons[entry.kind];
                  return (
                    <button
                      key={entry.kind}
                      type="button"
                      aria-pressed={methodKind === entry.kind}
                      className={methodKind === entry.kind ? "active" : ""}
                      onClick={() => {
                        setMethodKind(entry.kind);
                        setError("");
                      }}
                    >
                      <Icon size={18} aria-hidden="true" />
                      <span>{entry.label}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <button
              className="button quiet collector-import"
              type="button"
              disabled={saving}
              onClick={onImport}
            >
              <FileUp size={16} />
              Import files
            </button>
            <p className="muted collector-import-note">
              Documents, images, audio, and video
            </p>
          </aside>
        )}
        <fieldset className="collector-add-details" disabled={saving}>
          {method && (
            <div className="collector-method-description">
              <h3>{method.label}</h3>
              <p>{method.description}</p>
              <p className="muted">
                Adds a card linked to an editable worksheet. Open it from the
                board to add evidence, assumptions, and follow-up tasks. Works
                without AI.
              </p>
            </div>
          )}
          <label className="field">
            Title
            <input
              autoFocus
              data-autofocus
              required={!method}
              maxLength={300}
              placeholder={
                method
                  ? method.label
                  : kind === "question"
                    ? "What do we need to understand?"
                    : "Give this item a clear title"
              }
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {!method && kind === "link" && (
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
            {method
              ? "Worksheet objective"
              : kind === "hypothesis"
                ? "Working hypothesis"
                : "Notes & observations"}
            <textarea
              rows={method ? 4 : 6}
              value={content}
              maxLength={100000}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                method
                  ? "What question or decision will this worksheet help you examine?"
                  : "What makes this useful? Add context, excerpts, or the next question."
              }
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
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button type="submit" className="button primary">
              {saving
                ? "Adding worksheet…"
                : initial
                  ? "Save changes"
                  : method
                    ? "Add worksheet to board"
                    : "Add item"}
            </button>
          </div>
        </fieldset>
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
  onMethod,
  onReadSource,
  onSummarize,
  reviewerClaims = [],
  reviewerSourceVersion,
  onCitation,
  onEvidence,
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
  onMethod?: (id: string) => void;
  onReadSource?: () => void;
  onSummarize?: () => void;
  reviewerClaims?: ResearchClaim[];
  reviewerSourceVersion?: string;
  onCitation?: (citation: Citation) => void;
  onEvidence?: (id: string) => void;
  onConnection: (c: Connection) => void;
  onError: (e: unknown) => void;
}) {
  const Icon = card.methodId ? Layers : cardIcons[card.kind];
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
          {card.methodId ? "Research method" : card.kind}
        </span>
        <h2>{card.title}</h2>
        {onReadSource && (
          <button className="button primary full" onClick={onReadSource}>
            Open source
          </button>
        )}
        {onSummarize && (
          <button
            className="button quiet full item-insight-trigger"
            onClick={onSummarize}
          >
            <Sparkles size={16} />
            AI summary & research advice
          </button>
        )}
        {card.methodId && onMethod && (
          <button
            className="button primary full"
            onClick={() => onMethod(card.methodId!)}
          >
            Open worksheet
          </button>
        )}
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
        {onCitation && (
          <ReviewerNotes
            claims={reviewerClaims}
            displayedVersionId={reviewerSourceVersion}
            onCitation={onCitation}
            onEvidence={onEvidence}
          />
        )}
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
    "informs",
    "identifies gap",
    "addresses",
    "depends on",
    "produces",
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
      <p className="subtle-note">
        Board connections describe relationships. They do not change evidence
        assessments, confidence, or task completion.
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
  type Preset = {
    id: string;
    name: string;
    provider: AISettings["provider"];
    endpoint: string;
    model: string;
    mode: ProjectPrivacy["mode"];
  };
  const [presets, setPresets] = useState<Preset[]>(() => {
    try {
      const rows = JSON.parse(
        localStorage.getItem("acadia-connection-presets") || "[]",
      );
      return Array.isArray(rows)
        ? rows
            .filter(
              (p) =>
                p &&
                typeof p.id === "string" &&
                typeof p.name === "string" &&
                typeof p.endpoint === "string" &&
                typeof p.model === "string" &&
                ["offline", "ollama", "compatible"].includes(p.provider) &&
                ["local", "cloud"].includes(p.mode),
            )
            .slice(0, 20)
            .map((p) => ({
              id: p.id,
              name: p.name,
              provider: p.provider,
              endpoint: p.endpoint,
              model: p.model,
              mode: p.mode,
            }))
        : [];
    } catch {
      return [];
    }
  });
  const [presetName, setPresetName] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [diagnostic, setDiagnostic] = useState("");
  const [checking, setChecking] = useState(false);
  const [credential, setCredential] =
    useState<import("../../shared/maintenance").CredentialStatus>();
  useEffect(() => {
    void window.acadia
      ?.credentialStatus?.()
      .then(setCredential)
      .catch(() => undefined);
  }, []);
  const requestId = useRef(0);
  useEffect(() => {
    requestId.current++;
    setModels([]);
    setDiagnostic("");
    setChecking(false);
  }, [s.endpoint, s.provider]);
  useEffect(() => {
    requestId.current++;
    setDiagnostic("");
    setChecking(false);
  }, [s.model]);
  useEffect(
    () => () => {
      requestId.current++;
    },
    [],
  );
  const check = async (inventory: boolean) => {
    const id = ++requestId.current;
    setChecking(true);
    setError("");
    setDiagnostic("");
    try {
      if (inventory) {
        if (!window.acadia?.listLocalModels)
          throw new Error("Restart Acadia to enable model discovery.");
        const result = await window.acadia.listLocalModels(s.endpoint);
        if (requestId.current !== id) return;
        setModels(result.map((m) => m.name));
        setDiagnostic(
          result.length
            ? "Installed models found. Choose one below."
            : "The server is reachable, but no models are installed.",
        );
      } else {
        if (!window.acadia?.testAIConnection)
          throw new Error("Restart Acadia to enable connection checks.");
        const result = await window.acadia.testAIConnection(s);
        if (requestId.current === id) setDiagnostic(result.message);
      }
    } catch (e) {
      if (requestId.current === id)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (requestId.current === id) setChecking(false);
    }
  };
  const [mode, setMode] = useState(privacy.mode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Research engine"
      subtitle="Choose where the Releaser develops your research."
      onClose={() => {
        if (!busy) onClose();
      }}
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
        <div className="connection-presets">
          <label className="field">
            Saved connection
            <select
              aria-label="Saved connection"
              defaultValue=""
              onChange={(e) => {
                const p = presets.find((p) => p.id === e.target.value);
                if (!p) return;
                set({
                  provider: p.provider,
                  endpoint: p.endpoint,
                  model: p.model,
                  apiKey: "",
                });
                setMode(p.mode);
                setPresetName(p.name);
              }}
            >
              <option value="">Choose a connection…</option>
              {presets.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
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
              <option value="cloud">Server or cloud — selected provider</option>
            </select>
          </label>
          <p>
            {mode === "local"
              ? "Use this only for a model running on this computer. For a remote server, including an SSH tunnel, choose server or cloud analysis."
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
                model: "",
                apiKey: "",
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
            {models.length > 0 && (
              <label className="field">
                Installed models
                <select
                  aria-label="Installed models"
                  value={models.includes(s.model) ? s.model : ""}
                  onChange={(e) => set({ ...s, model: e.target.value })}
                >
                  <option value="" disabled>
                    Choose an installed model…
                  </option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
            <div className="connection-diagnostics">
              {s.provider === "ollama" && (
                <button
                  type="button"
                  className="button quiet"
                  disabled={checking || !s.endpoint}
                  onClick={() => void check(true)}
                >
                  Find installed models
                </button>
              )}
              <button
                type="button"
                className="button quiet"
                disabled={checking || !s.endpoint || !s.model}
                onClick={() => void check(false)}
              >
                {checking ? "Checking…" : "Test connection"}
              </button>
              <button
                type="button"
                className="button quiet"
                disabled={checking || !s.endpoint || !s.model}
                onClick={async () => {
                  const request = ++requestId.current;
                  setChecking(true);
                  setError("");
                  setDiagnostic("");
                  try {
                    const result = await window.acadia!.testAIGeneration(s);
                    if (requestId.current === request)
                      setDiagnostic(result.message);
                  } catch (e) {
                    if (requestId.current === request)
                      setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    if (requestId.current === request) setChecking(false);
                  }
                }}
              >
                Test synthetic generation
              </button>
              <p className="muted">
                The generation test sends only a fictional arithmetic prompt to
                the selected service. Cloud providers may charge for it.
                Untested models have no demonstrated research-quality rating.
              </p>
              {credential && (
                <p role="status">
                  Saved analysis key:{" "}
                  {credential.analysis === "secure"
                    ? "stored securely"
                    : credential.analysis === "session"
                      ? "session only"
                      : "absent"}
                  .{" "}
                  {credential.secureStorageAvailable
                    ? "Operating-system secure storage is available."
                    : "Secure storage is unavailable; keys cannot persist securely."}
                </p>
              )}
              {credential?.analysis !== "absent" && credential && (
                <button
                  type="button"
                  className="button quiet"
                  disabled={checking}
                  onClick={async () => {
                    try {
                      setCredential(
                        await window.acadia!.removeCredential("analysis"),
                      );
                      set({ ...s, apiKey: "" });
                      setDiagnostic(
                        "Saved analysis key removed from this installation.",
                      );
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Remove saved analysis key
                </button>
              )}
              {credential?.search !== "absent" && credential && (
                <button
                  type="button"
                  className="button quiet"
                  disabled={checking}
                  onClick={async () => {
                    try {
                      setCredential(
                        await window.acadia!.removeCredential("search"),
                      );
                      setDiagnostic("Saved search key removed.");
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  Remove saved search key
                </button>
              )}
              {diagnostic && <p role="status">{diagnostic}</p>}
            </div>
            <p className="settings-note">
              Your question, retrieved source passages, and instructions are
              sent to this server when you start analysis. Source content is
              never sent to a different provider as a fallback. Cloud usage may
              incur charges from your provider.
            </p>
          </>
        )}
        <details className="connection-remember">
          <summary>Remember this connection</summary>
          <div className="connection-presets">
            <label className="field">
              Connection name
              <input
                value={presetName}
                maxLength={80}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="This Mac, Research server, OpenAI…"
              />
            </label>
            <button
              type="button"
              className="button quiet"
              disabled={!presetName.trim()}
              onClick={() => {
                try {
                  if (s.provider !== "offline") {
                    const url = new URL(s.endpoint);
                    if (url.username || url.password || url.search || url.hash)
                      throw new Error(
                        "Use a server URL without credentials or query parameters.",
                      );
                  }
                  const next = [
                    ...presets.filter((p) => p.name !== presetName.trim()),
                    {
                      id: crypto.randomUUID(),
                      name: presetName.trim(),
                      provider: s.provider,
                      endpoint: s.endpoint,
                      model: s.model,
                      mode,
                    },
                  ].slice(-20);
                  localStorage.setItem(
                    "acadia-connection-presets",
                    JSON.stringify(next),
                  );
                  setPresets(next);
                  setDiagnostic(
                    "Connection remembered. API keys are not included in connection presets.",
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              Remember
            </button>
          </div>
          <p className="muted">
            Presets remember the server, model, and privacy choice. API keys
            remain in the app’s protected credential settings.
          </p>
        </details>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
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
