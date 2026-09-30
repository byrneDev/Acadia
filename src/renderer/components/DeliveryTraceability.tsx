import { useRef, useState } from "react";
import { PageNavigation } from "./SearchPages";
import type { PedigreeState } from "../../shared/pedigree";
import type { ResearchState, SearchHit } from "../../shared/research";
import type {
  DeliveryRecordRef,
  VerificationEvidenceRef,
} from "../../shared/pmis";

export function DeliveryRecordFields({
  pedigree,
  research,
  value,
  onChange,
  label = "Plan",
}: {
  pedigree?: PedigreeState | null;
  research?: ResearchState | null;
  value: { gapRefs?: DeliveryRecordRef[]; findingRefs?: DeliveryRecordRef[] };
  onChange: (patch: {
    gapRefs?: DeliveryRecordRef[];
    findingRefs?: DeliveryRecordRef[];
  }) => void;
  label?: string;
}) {
  return (
    <div className="delivery-fields-row">
      {(["gap", "finding"] as const).map((kind) => {
        const field = kind === "gap" ? "gapRefs" : "findingRefs";
        const selected = value[field] || [];
        const records =
          kind === "gap"
            ? (pedigree?.gaps || []).map((g) => ({ ...g, label: g.title }))
            : (pedigree?.findings || []).map((f) => ({
                ...f,
                label:
                  research?.claims.find((c) => c.id === f.claimId)?.title ||
                  f.claimId,
              }));
        const choices = records.map((r) => ({
          id: r.id,
          revision: r.revision,
          label: `${r.label} · revision ${r.revision}`,
        }));
        for (const ref of selected)
          if (
            !choices.some((c) => c.id === ref.id && c.revision === ref.revision)
          )
            choices.push({
              ...ref,
              label: `${records.find((r) => r.id === ref.id)?.label || ref.id} · historical revision ${ref.revision}`,
            });
        return (
          <label className="field" key={kind}>
            {kind === "gap"
              ? "Saved research gaps"
              : "Saved finding assessments"}
            <select
              multiple
              aria-label={`${label} ${kind} references`}
              value={selected.map((r) => `${r.id}@${r.revision}`)}
              onChange={(e) =>
                onChange({
                  [field]: Array.from(e.target.selectedOptions, (option) => {
                    const [id, revision] = option.value.split("@");
                    return { id, revision: Number(revision) };
                  }),
                })
              }
            >
              {choices.map((c) => (
                <option
                  key={`${c.id}@${c.revision}`}
                  value={`${c.id}@${c.revision}`}
                >
                  {c.label}
                </option>
              ))}
            </select>
            <small>
              Linked revisions remain fixed when research changes. Select a new
              revision explicitly.
            </small>
          </label>
        );
      })}
    </div>
  );
}

export function VerificationEvidenceField({
  value,
  onChange,
  label,
  onOpen,
}: {
  value: VerificationEvidenceRef[];
  onChange: (value: VerificationEvidenceRef[]) => void;
  label: string;
  onOpen?: (value: VerificationEvidenceRef) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [paging, setPaging] = useState({ offset: 0, total: 0, limit: 20 });
  const request = useRef(0);
  const search = async (offset = 0) => {
    const token = ++request.current;
    setBusy(true);
    setError("");
    try {
      const result = await window.acadia!.searchSourcesPage(query, {
        offset,
        limit: 20,
      });
      if (token !== request.current) return;
      setHits(result.items);
      setPaging({
        offset: result.offset,
        total: result.total,
        limit: result.limit,
      });
    } catch {
      if (token !== request.current) return;
      setError(
        "Could not search saved passages. Your selected references are unchanged.",
      );
    } finally {
      if (token === request.current) setBusy(false);
    }
  };
  return (
    <fieldset className="delivery-verification">
      <legend>Verification evidence</legend>
      <p>
        Link saved test or assessment observations. A reference does not itself
        establish that the work passed or the gap is resolved.
      </p>
      <label className="field">
        Search current source passages
        <input
          aria-label={`${label} verification search`}
          value={query}
          onChange={(e) => {
            request.current++;
            setBusy(false);
            setQuery(e.target.value);
            setHits([]);
            setPaging({ offset: 0, total: 0, limit: 20 });
          }}
        />
      </label>
      <button
        className="button quiet"
        disabled={!query.trim() || busy}
        onClick={() => void search()}
      >
        {busy ? "Searching…" : "Find verification passages"}
      </button>
      {error && <p role="alert">{error}</p>}
      <ul>
        {hits.map((hit) => (
          <li key={hit.id}>
            <p>
              {hit.sourceTitle} · {hit.locator}
            </p>
            <p>{hit.text}</p>
            <button
              className="button quiet"
              disabled={value.some((v) => v.passageId === hit.id)}
              onClick={() =>
                onChange([
                  ...value,
                  {
                    passageId: hit.id,
                    sourceId: hit.sourceId,
                    versionId: hit.versionId,
                  },
                ])
              }
            >
              Link passage as verification
            </button>
          </li>
        ))}
      </ul>
      {paging.total > 0 && (
        <PageNavigation
          label={`${label} verification results`}
          {...paging}
          onChange={(offset) => void search(offset)}
        />
      )}
      <ul aria-label={`${label} saved verification references`}>
        {value.map((ref) => (
          <li key={ref.passageId}>
            <span>
              Passage {ref.passageId} · source {ref.sourceId} · version{" "}
              {ref.versionId}
            </span>
            {onOpen && (
              <button className="button quiet" onClick={() => onOpen(ref)}>
                Open verification passage
              </button>
            )}
            <button
              className="button quiet"
              onClick={() =>
                onChange(value.filter((v) => v.passageId !== ref.passageId))
              }
            >
              Remove verification reference
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
