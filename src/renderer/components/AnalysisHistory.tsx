import { useEffect, useState } from "react";
import type { AnalysisRun } from "../../shared/research";
import { PageNavigation } from "./SearchPages";
export function AnalysisHistory({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false),
    [offset, setOffset] = useState(0),
    [total, setTotal] = useState(0);
  const [runs, setRuns] = useState<AnalysisRun[]>([]),
    [full, setFull] = useState<Record<string, AnalysisRun>>({});
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setError("");
    void window
      .acadia!.listAnalysisRunsPage({ offset, limit: 20 })
      .then((page) => {
        if (alive) {
          setRuns(page.items);
          setTotal(page.total);
        }
      })
      .catch(() => {
        if (alive)
          setError(
            "Analysis history could not be read. Close and reopen history to retry.",
          );
      });
    return () => {
      alive = false;
    };
  }, [projectId, offset, open]);
  return (
    <details
      className="audit-history"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>Analysis history{open ? ` (${total})` : ""}</summary>
      {error && <p role="alert">{error}</p>}
      {runs.map((run) => (
        <details
          key={run.id}
          onToggle={(event) => {
            if (event.currentTarget.open && !full[run.id])
              void window
                .acadia!.getAnalysisRun(run.id)
                .then((value) => {
                  setError("");
                  setFull((current) => ({ ...current, [run.id]: value }));
                })
                .catch(() =>
                  setError(
                    "This saved run could not be read. Your research records are unchanged.",
                  ),
                );
          }}
        >
          <summary>
            {new Date(run.createdAt).toLocaleString()} · {run.kind} ·{" "}
            {run.provider}/{run.model}
          </summary>
          <p>{run.question}</p>
          <p>
            {run.citations.length} citations · {run.sourceVersions.length}{" "}
            source versions · {run.exclusions.length} exclusions
          </p>
          {full[run.id] ? (
            <pre>
              {JSON.stringify(
                {
                  instructions: full[run.id].instructions,
                  queries: full[run.id].queries,
                  groundingWarnings: full[run.id].groundingWarnings,
                  sourceVersions: full[run.id].sourceVersions,
                  retrieval: full[run.id].retrieval,
                },
                null,
                2,
              )}
            </pre>
          ) : (
            <p role="status">Loading historical inputs…</p>
          )}
        </details>
      ))}
      <PageNavigation
        label="Analysis history"
        offset={offset}
        limit={20}
        total={total}
        onChange={setOffset}
      />
    </details>
  );
}
