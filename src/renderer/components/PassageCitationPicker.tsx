import { useEffect, useState } from "react";
import type {
  Citation,
  Passage,
  ResearchState,
  SearchHit,
} from "../../shared/research";
import { Modal } from "./Dialogs";
import { PageNavigation } from "./SearchPages";

export function PassageCitationPicker({
  onSelect,
  onClose,
}: {
  onSelect: (citation: Citation) => void;
  onClose: () => void;
}) {
  const [state, setState] = useState<ResearchState>();
  const [query, setQuery] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<(Passage | SearchHit)[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Passage | SearchHit>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    void window
      .acadia!.researchState()
      .then((value) => {
        if (alive) setState(value);
      })
      .catch(() =>
        setError("The source library could not be loaded. Close and retry."),
      );
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    setOffset(0);
    setSelected(undefined);
  }, [query, sourceId, versionId]);
  useEffect(() => {
    let alive = true;
    setItems([]);
    setTotal(0);
    setError("");
    if (!sourceId && query.trim().length < 2) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(() => {
      const read = sourceId
        ? window.acadia!.getSourcePassagesPage(
            sourceId,
            versionId || undefined,
            query,
            { offset, limit: 20 },
          )
        : window.acadia!.searchSourcesPage(query, { offset, limit: 20 });
      void read
        .then((page) => {
          if (alive) {
            setItems(page.items);
            setTotal(page.total);
          }
        })
        .catch(() => {
          if (alive)
            setError(
              "Passages could not be loaded. Change the search or try again.",
            );
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, sourceId, versionId, offset]);
  return (
    <Modal
      title="Cite a source passage"
      subtitle="Choose an exact saved passage. Citation validity does not establish support for your statement."
      wide
      onClose={onClose}
    >
      <label className="field">
        Search passage text
        <input
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the collection, or choose a source to browse…"
        />
      </label>
      <div className="reader-controls">
        <label className="field">
          Source
          <select
            aria-label="Source"
            value={sourceId}
            onChange={(e) => {
              const id = e.target.value;
              setSourceId(id);
              setVersionId(
                state?.sources.find((s) => s.id === id)?.currentVersionId || "",
              );
            }}
          >
            <option value="">All included current sources</option>
            {state?.sources
              .filter((s) => !s.derived)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                  {s.inclusion === "exclude"
                    ? " · excluded from AI retrieval"
                    : ""}
                </option>
              ))}
          </select>
        </label>
        {sourceId && (
          <label className="field">
            Saved version
            <select
              aria-label="Saved version"
              value={versionId}
              onChange={(e) => setVersionId(e.target.value)}
            >
              {state?.versions
                .filter((v) => v.sourceId === sourceId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {new Date(v.acquiredAt).toLocaleString()} · {v.status}
                    {v.id ===
                    state.sources.find((s) => s.id === sourceId)
                      ?.currentVersionId
                      ? " · current"
                      : " · historical"}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <p role="status">
        {busy
          ? "Searching saved passages…"
          : !sourceId && query.trim().length < 2
            ? "Enter two characters or choose a source to browse all its passages."
            : `${total} matching passages`}
      </p>
      <div className="search-results citation-passage-results">
        {items.map((passage) => (
          <button
            type="button"
            key={passage.id}
            aria-pressed={selected?.id === passage.id}
            onClick={() => setSelected(passage)}
          >
            <strong>
              {"sourceTitle" in passage
                ? passage.sourceTitle
                : state?.sources.find((s) => s.id === passage.sourceId)?.title}
            </strong>
            <small>
              {passage.locator} · {passage.method}
              {passage.inclusion === "exclude"
                ? " · excluded from AI retrieval"
                : ""}
            </small>
            <span>
              {passage.text.slice(0, 260)}
              {passage.text.length > 260 ? "…" : ""}
            </span>
          </button>
        ))}
      </div>
      {total > 0 && (
        <PageNavigation
          label="Citation passages"
          offset={offset}
          limit={20}
          total={total}
          onChange={setOffset}
        />
      )}
      {selected && (
        <section aria-label="Selected citation passage">
          <h3>{selected.locator}</h3>
          <blockquote className="citation-passage-preview">
            {selected.text}
          </blockquote>
          <p>
            This citation keeps this exact source version after future updates.
          </p>
        </section>
      )}
      <div className="modal-actions">
        <button className="button quiet" onClick={onClose}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={!selected || busy}
          onClick={async () => {
            if (!selected) return;
            setBusy(true);
            setError("");
            try {
              onSelect(await window.acadia!.createPassageCitation(selected.id));
            } catch {
              setError(
                "This passage could not be cited. Confirm that its saved source remains available.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Insert selected passage citation
        </button>
      </div>
    </Modal>
  );
}
