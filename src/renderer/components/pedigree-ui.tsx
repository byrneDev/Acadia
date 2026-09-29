import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Passage, ResearchState } from "../../shared/research";

type DraftSession<T> = { value: T; dirty: boolean; saving: boolean };
const drafts = new Map<string, DraftSession<unknown>>();
const draftListeners = new Map<string, Set<() => void>>();

function draftSession<T>(key: string, initial: T): DraftSession<T> {
  if (!drafts.has(key))
    drafts.set(key, { value: initial, dirty: false, saving: false });
  return drafts.get(key) as DraftSession<T>;
}

function publishDraft<T>(key: string, session: DraftSession<T>) {
  drafts.set(key, session);
  draftListeners.get(key)?.forEach((listener) => listener());
}

function olderRevision(current: unknown, incoming: unknown) {
  return Boolean(
    current &&
    incoming &&
    typeof current === "object" &&
    typeof incoming === "object" &&
    "id" in current &&
    "id" in incoming &&
    current.id === incoming.id &&
    "revision" in current &&
    "revision" in incoming &&
    typeof current.revision === "number" &&
    typeof incoming.revision === "number" &&
    current.revision > incoming.revision,
  );
}

export function reconcileSavedDraft<T>(
  current: T | undefined,
  submitted: T,
  saved: T,
  reset?: T,
): { value: T; dirty: boolean } {
  if (current === undefined || current === submitted)
    return { value: reset ?? saved, dirty: false };
  if (
    current &&
    saved &&
    typeof current === "object" &&
    typeof saved === "object" &&
    "id" in current &&
    "id" in saved &&
    current.id === saved.id
  ) {
    const metadata = saved as Record<string, unknown>;
    return {
      value: {
        ...current,
        revision: metadata.revision,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
      },
      dirty: true,
    };
  }
  return { value: current, dirty: true };
}

/** Private session drafts survive navigation; saving remains an explicit action. */
export function usePedigreeDraft<T>(key: string, initial: T) {
  const subscribe = useCallback(
    (listener: () => void) => {
      let listeners = draftListeners.get(key);
      if (!listeners) draftListeners.set(key, (listeners = new Set()));
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) draftListeners.delete(key);
      };
    },
    [key],
  );
  const session = useSyncExternalStore(
    subscribe,
    () => draftSession(key, initial),
    () => draftSession(key, initial),
  );
  const initialText = JSON.stringify(initial);
  useEffect(() => {
    const current = draftSession(key, initial);
    if (
      !current.dirty &&
      !current.saving &&
      !olderRevision(current.value, initial) &&
      JSON.stringify(current.value) !== initialText
    )
      publishDraft(key, { ...current, value: initial });
  }, [key, initialText]);
  function edit(next: T) {
    publishDraft(key, {
      ...draftSession(key, initial),
      value: next,
      dirty: true,
    });
  }
  function acceptSaved(submitted: T, next: T, reset?: T) {
    const current = draftSession(key, initial);
    if (olderRevision(current.value, next)) return;
    const result = reconcileSavedDraft(
      current.dirty ? current.value : undefined,
      submitted,
      next,
      reset,
    );
    publishDraft(key, { ...current, ...result });
  }
  function saved(next: T, reset?: T) {
    acceptSaved(session.value, next, reset);
  }
  async function persist(work: (value: T) => Promise<T>, reset?: T) {
    const current = draftSession(key, initial);
    if (current.saving) throw new Error("This assessment is already saving.");
    publishDraft(key, { ...current, saving: true });
    try {
      const next = await work(current.value);
      acceptSaved(current.value, next, reset);
      return next;
    } finally {
      publishDraft(key, { ...draftSession(key, initial), saving: false });
    }
  }
  return { ...session, edit, saved, persist };
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  required = false,
  rows = 3,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
  rows?: number;
}) {
  return (
    <label className="field pedigree-field">
      <span>{label}</span>
      {rows === 1 ? (
        <input
          aria-label={label}
          value={value}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <textarea
          aria-label={label}
          value={value}
          rows={rows}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (T | { value: T; label: string })[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="field pedigree-field">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((entry) => {
          const option =
            typeof entry === "string"
              ? { value: entry, label: entry.replaceAll("-", " ") }
              : entry;
          return (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function FormActions({
  busy,
  disabled = false,
  dirty,
  label = "Save assessment",
  notice,
  children,
}: {
  busy: boolean;
  disabled?: boolean;
  dirty?: boolean;
  label?: string;
  notice?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pedigree-actions">
      <button
        className="button primary"
        disabled={busy || disabled}
        type="submit"
      >
        {busy ? "Saving…" : label}
      </button>
      {children}
      {notice && <span role="status">{notice}</span>}
      {dirty && <span>Unsaved changes · kept for this session</span>}
    </div>
  );
}

export function PassagePicker({
  research,
  selected,
  onChange,
  onSource,
  onError,
  label = "Supporting passages",
  restrictedSource,
}: {
  research: ResearchState;
  selected: string[];
  onChange: (ids: string[]) => void;
  onSource?: (sourceId: string, versionId?: string, passageId?: string) => void;
  onError: (error: unknown) => void;
  label?: string;
  restrictedSource?: { sourceId: string; versionId: string };
}) {
  const [sourceId, setSourceId] = useState(restrictedSource?.sourceId || "");
  const [query, setQuery] = useState("");
  const [passages, setPassages] = useState<Passage[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState<Record<string, Passage>>({});
  const selectedKey = selected.join("|");
  useEffect(() => {
    let live = true;
    Promise.all(selected.map((id) => window.acadia!.getPassage(id)))
      .then((items) => {
        if (live) setResolved(Object.fromEntries(items.map((p) => [p.id, p])));
      })
      .catch(onError);
    return () => {
      live = false;
    };
  }, [selectedKey]);
  const versionId =
    restrictedSource?.versionId ||
    research.sources.find((s) => s.id === sourceId)?.currentVersionId;
  useEffect(() => {
    let live = true;
    setPassages([]);
    if (!sourceId) return;
    setLoading(true);
    window
      .acadia!.getSource(sourceId, versionId)
      .then((detail) => {
        if (live) setPassages(detail.passages);
      })
      .catch(onError)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [sourceId, versionId]);
  const matches = passages.filter(
    (p) =>
      !query.trim() ||
      `${p.locator} ${p.text}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <fieldset className="pedigree-passages">
      <legend>{label}</legend>
      {selected.length > 0 && (
        <ul className="pedigree-selected-passages">
          {selected.map((id) => {
            const p = resolved[id];
            const source = research.sources.find((s) => s.id === p?.sourceId);
            return (
              <li key={id}>
                <button
                  type="button"
                  disabled={!p || !onSource}
                  onClick={() => p && onSource?.(p.sourceId, p.versionId, p.id)}
                >
                  {source?.title || "Saved passage"} ·{" "}
                  {p?.locator || "Loading…"}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${p?.locator || "passage"}`}
                  onClick={() =>
                    onChange(selected.filter((other) => other !== id))
                  }
                >
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!restrictedSource && (
        <SelectField
          label={`${label}: source`}
          value={sourceId}
          onChange={setSourceId}
          options={[
            { value: "", label: "Choose a source" },
            ...research.sources.map((source) => ({
              value: source.id,
              label: source.title,
            })),
          ]}
        />
      )}
      {sourceId && (
        <>
          <TextField
            label={`${label}: find passage`}
            value={query}
            onChange={setQuery}
            rows={1}
          />
          {loading && <p role="status">Loading located passages…</p>}
          <div className="pedigree-passage-options">
            {matches.slice(0, 30).map((passage) => (
              <label key={passage.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(passage.id)}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? [...selected, passage.id]
                        : selected.filter((id) => id !== passage.id),
                    )
                  }
                />
                <span>
                  <strong>
                    {passage.locator} · {passage.method}
                  </strong>
                  <span>{passage.text}</span>
                </span>
              </label>
            ))}
          </div>
          {matches.length > 30 && (
            <p className="muted">
              Showing 30 of {matches.length} matching passages. Refine the
              search to locate another passage.
            </p>
          )}
          {!loading && !matches.length && (
            <p className="muted">
              No passages match. Check extraction coverage or choose another
              source.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}
