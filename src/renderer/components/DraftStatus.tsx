import { useState } from "react";
export interface DraftStatusValue {
  dirty: boolean;
  saving: boolean;
  committing?: boolean;
  loading?: boolean;
  pending?: boolean;
  error: string;
  recovered: boolean;
  conflict: boolean;
  value?: unknown;
  liveInitial?: unknown;
  flush: () => Promise<void>;
  discard: () => Promise<void>;
  acknowledgeConflict?: () => void;
}
export function DraftStatus({ draft }: { draft: DraftStatusValue }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  if (!draft.dirty && !draft.loading && !draft.error) return null;
  return (
    <div className="private-draft-status">
      <span role="status">
        {draft.error
          ? "Private draft save failed · retry before closing"
          : draft.loading
            ? "Loading private draft…"
            : draft.saving || draft.pending
              ? "Saving private draft…"
              : draft.recovered
                ? "Recovered private draft · not yet applied"
                : "Private draft saved locally · not yet applied"}
      </span>
      {(draft.error || error) && (
        <p role="alert">
          {draft.error || error}
          <button
            type="button"
            onClick={() => void draft.flush().catch(() => {})}
          >
            Retry draft save
          </button>
        </p>
      )}
      {draft.conflict && (
        <details>
          <summary>
            The saved record changed. Compare it with this draft before
            applying.
          </summary>
          <div className="draft-comparison">
            <label>
              Current saved record
              <textarea
                readOnly
                rows={8}
                value={JSON.stringify(draft.liveInitial, null, 2)}
              />
            </label>
            <label>
              Recovered editing draft
              <textarea
                readOnly
                rows={8}
                value={JSON.stringify(draft.value, null, 2)}
              />
            </label>
          </div>
          {draft.acknowledgeConflict && (
            <button type="button" onClick={draft.acknowledgeConflict}>
              I reviewed the current record; keep my draft
            </button>
          )}
        </details>
      )}
      {draft.dirty && !confirm && (
        <button
          type="button"
          className="text-button"
          onClick={() => setConfirm(true)}
        >
          Discard private draft…
        </button>
      )}
      {confirm && (
        <div role="group" aria-label="Confirm discard private draft">
          <p>Discard these unapplied edits and return to the saved record?</p>
          <button type="button" onClick={() => setConfirm(false)}>
            Keep editing
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                await draft.discard();
                setConfirm(false);
                setError("");
              } catch {
                setError(
                  "The draft could not be discarded. Your editing buffer remains available.",
                );
              }
            }}
          >
            Discard unapplied edits
          </button>
        </div>
      )}
    </div>
  );
}
