import { useEffect, useState } from "react";
import type { Project } from "../../shared/types";
import type { ResearchClaim, ResearchState } from "../../shared/research";
import {
  createBrief,
  createAppraisal,
  createOrigin,
  createFinding,
  createAssumption,
  type SourceOrigin as OriginRelationship,
  type FindingAssessment,
  type ResearchAssumption as Assumption,
  type PedigreeState,
  type PedigreeRevision,
} from "../../shared/pedigree";
import {
  entityMeta,
  latestRecords,
  usePedigree,
  originSummary,
} from "./pedigree-state";
import { ChallengeReview } from "./ChallengeReview";
import {
  FormActions,
  PassagePicker,
  SelectField,
  TextField,
  usePedigreeDraft,
} from "./pedigree-ui";
import "./PedigreeWorkspace.css";

type SharedProps = {
  project: Project;
  research: ResearchState;
  onError: (error: unknown) => void;
  onSource?: (sourceId: string, versionId?: string, passageId?: string) => void;
  onQuestionSaved?: (question: string) => void;
};
const reviewOptions = ["unassessed", "draft", "reviewed"] as const;
const api = () => window.acadia!;

function useSave(onError: SharedProps["onError"]) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function save(
    work: () => Promise<void>,
    message = "Saved a new revision.",
  ) {
    setBusy(true);
    setNotice("");
    try {
      await work();
      setNotice(message);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return { busy, notice, save };
}

export function RecordHistory({
  kind,
  id,
  onError,
}: {
  kind: Parameters<ReturnType<typeof api>["pedigreeRevisions"]>[0];
  id: string;
  onError: SharedProps["onError"];
}) {
  const [records, setRecords] = useState<PedigreeRevision[]>([]);
  return (
    <details
      className="pedigree-history"
      onToggle={(event) => {
        if (event.currentTarget.open)
          api().pedigreeRevisions(kind, id).then(setRecords).catch(onError);
      }}
    >
      <summary>Revision history</summary>
      {!records.length && <p>No saved revisions yet.</p>}
      {[...records].reverse().map((value, index) => {
        const record = value.data as unknown as Record<string, unknown>;
        return (
          <article key={index}>
            <strong>Revision {String(record.revision || index + 1)}</strong>
            <p>
              {record.updatedAt
                ? new Date(String(record.updatedAt)).toLocaleString()
                : ""}
            </p>
            <dl>
              {Object.entries(record)
                .filter(
                  ([key, val]) =>
                    ![
                      "id",
                      "projectId",
                      "createdAt",
                      "updatedAt",
                      "revision",
                      "sourceId",
                      "versionId",
                      "claimId",
                    ].includes(key) &&
                    typeof val === "string" &&
                    val,
                )
                .map(([key, val]) => (
                  <div className="pedigree-history-field" key={key}>
                    <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                    <dd>{String(val)}</dd>
                  </div>
                ))}
            </dl>
          </article>
        );
      })}
    </details>
  );
}

export function PedigreeWorkspace(props: SharedProps) {
  const { state, error } = usePedigree(props.project.id);
  useEffect(() => {
    if (error) props.onError(error);
  }, [error]);
  if (!state)
    return (
      <main className="pedigree-workspace">
        <p role="status">
          {error
            ? "Research brief could not be loaded."
            : "Loading research brief…"}
        </p>
      </main>
    );
  return (
    <main className="pedigree-workspace">
      <div className="research-heading">
        <div>
          <span className="eyebrow">RESEARCH BRIEF</span>
          <h2>Define the decision before the search.</h2>
          <p>
            Record scope, selection criteria, and the observations that would
            make this investigation useful.
          </p>
        </div>
      </div>
      <BriefForm {...props} state={state} />
    </main>
  );
}

function BriefForm({
  project,
  state,
  onError,
  onQuestionSaved,
}: SharedProps & { state: PedigreeState }) {
  const saved = latestRecords(state.briefs).at(-1);
  const [empty] = useState(() => createBrief(project.id, project.question));
  const initial = saved || empty;
  const draft = usePedigreeDraft(`brief:${project.id}`, initial);
  const { value, edit } = draft;
  const action = useSave(onError);
  return (
    <form
      className="pedigree-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.save(async () => {
          const result = await draft.persist((submitted) =>
            api().saveResearchBrief(submitted),
          );
          if (result.question !== project.question)
            onQuestionSaved?.(result.question);
        });
      }}
    >
      <TextField
        label="Research question"
        value={value.question}
        required
        onChange={(question) => edit({ ...value, question })}
      />
      <TextField
        label="Decision to inform"
        value={value.decision}
        onChange={(decision) => edit({ ...value, decision })}
        hint="Who needs to decide what, and which options are being considered?"
      />
      <TextField
        label="Scope and boundaries"
        value={value.scope}
        onChange={(scope) => edit({ ...value, scope })}
      />
      <div className="pedigree-grid">
        <TextField
          label="Coverage starts"
          value={value.dateFrom}
          rows={1}
          onChange={(dateFrom) => edit({ ...value, dateFrom })}
          hint="Optional date, YYYY-MM-DD"
        />
        <TextField
          label="Coverage ends"
          value={value.dateTo}
          rows={1}
          onChange={(dateTo) => edit({ ...value, dateTo })}
          hint="Optional date, YYYY-MM-DD"
        />
      </div>
      <div className="pedigree-grid">
        <TextField
          label="Include evidence when"
          value={value.inclusionCriteria}
          onChange={(inclusionCriteria) =>
            edit({ ...value, inclusionCriteria })
          }
        />
        <TextField
          label="Exclude evidence when"
          value={value.exclusionCriteria}
          onChange={(exclusionCriteria) =>
            edit({ ...value, exclusionCriteria })
          }
        />
      </div>
      <TextField
        label="Success and completion criteria"
        value={value.successCriteria}
        onChange={(successCriteria) => edit({ ...value, successCriteria })}
      />
      <SelectField
        label="Brief review status"
        value={value.reviewStatus}
        options={reviewOptions}
        onChange={(reviewStatus) => edit({ ...value, reviewStatus })}
      />
      <FormActions
        busy={action.busy || draft.saving}
        dirty={draft.dirty}
        notice={action.notice}
        label="Save research brief"
      />
      {saved && <RecordHistory kind="brief" id={saved.id} onError={onError} />}
    </form>
  );
}

export function SourcePedigree(
  props: SharedProps & { sourceId: string; versionId: string },
) {
  const { state, error } = usePedigree(props.project.id);
  useEffect(() => {
    if (error) props.onError(error);
  }, [error]);
  if (!state) return null;
  return (
    <>
      <details className="pedigree-section">
        <summary>
          Source appraisal ·{" "}
          {state.appraisals.some(
            (a) =>
              a.sourceId === props.sourceId && a.versionId === props.versionId,
          )
            ? "assessment recorded"
            : "unassessed"}
        </summary>
        <p>
          Assess this saved version. A passage location check does not establish
          source quality.
        </p>
        <AppraisalForm
          key={`${props.sourceId}:${props.versionId}`}
          {...props}
          state={state}
        />
      </details>
      <details className="pedigree-section">
        <summary>Evidence origins and dependencies</summary>
        <OriginForm {...props} state={state} />
      </details>
    </>
  );
}

export function OriginSummary({
  project,
  research,
}: Pick<SharedProps, "project" | "research">) {
  const { state } = usePedigree(project.id);
  if (!state) return null;
  const count = originSummary(research, state);
  return (
    <div className="pedigree-counts" aria-label="Evidence origin coverage">
      <span>{count.documents} included source records</span>
      <span>{count.linkedFamilies} confirmed shared-origin groups</span>
      <span>{count.duplicateFiles} exact duplicate files</span>
      <span>
        {count.unknownIndependence} unlinked sources · independence unknown
      </span>
      {count.proposed > 0 && (
        <span>{count.proposed} origin relationships await review</span>
      )}
    </div>
  );
}

function AppraisalForm({
  project,
  research,
  state,
  sourceId,
  versionId,
  onError,
  onSource,
}: SharedProps & {
  state: PedigreeState;
  sourceId: string;
  versionId: string;
}) {
  const saved = latestRecords(state.appraisals).find(
    (a) => a.sourceId === sourceId && a.versionId === versionId,
  );
  const [empty] = useState(() =>
    createAppraisal(project.id, sourceId, versionId),
  );
  const initial = saved || empty;
  const draft = usePedigreeDraft(
    `appraisal:${project.id}:${versionId}`,
    initial,
  );
  const { value, edit } = draft;
  const action = useSave(onError);
  return (
    <form
      className="pedigree-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.save(async () =>
          draft.saved(await api().saveSourceAppraisal(value)),
        );
      }}
    >
      <TextField
        label="Evidence type"
        rows={1}
        value={value.evidenceType}
        onChange={(evidenceType) => edit({ ...value, evidenceType })}
        hint="For example: controlled study, field observation, interview, commentary, or unknown."
      />
      <SelectField
        label="Primary or secondary evidence"
        value={value.origin}
        options={["unknown", "primary", "secondary"]}
        onChange={(origin) => edit({ ...value, origin })}
      />
      {(
        [
          ["methods", "Methods and context"],
          ["applicability", "Applicability to this question"],
          ["currency", "Currency and date relevance"],
          ["limitations", "Limitations and unknowns"],
          ["bias", "Potential bias or interests"],
          ["rationale", "Appraisal reasoning"],
        ] as const
      ).map(([key, label]) => (
        <TextField
          key={key}
          label={label}
          value={value[key]}
          onChange={(text) => edit({ ...value, [key]: text })}
          hint={
            key === "methods"
              ? "Leave unassessed matters explicit; do not infer missing methods."
              : undefined
          }
        />
      ))}
      <PassagePicker
        research={research}
        selected={value.passageIds}
        onChange={(passageIds) => edit({ ...value, passageIds })}
        onSource={onSource}
        onError={onError}
        label="Appraisal evidence"
        restrictedSource={{ sourceId, versionId }}
      />
      <SelectField
        label="Appraisal review status"
        value={value.reviewStatus}
        options={reviewOptions}
        onChange={(reviewStatus) => edit({ ...value, reviewStatus })}
      />
      <FormActions
        busy={action.busy}
        dirty={draft.dirty}
        notice={action.notice}
        label="Save source appraisal"
      />
      {saved && (
        <RecordHistory kind="appraisal" id={saved.id} onError={onError} />
      )}
    </form>
  );
}

function OriginForm({
  project,
  research,
  state,
  sourceId,
  onError,
}: SharedProps & { state: PedigreeState; sourceId: string }) {
  const [initial] = useState(() => createOrigin(project.id, sourceId, ""));
  const draft = usePedigreeDraft(`origin:${project.id}:${sourceId}`, initial);
  const { value, edit } = draft;
  const action = useSave(onError);
  const origins = latestRecords(state.origins).filter(
    (o) => o.sourceId === sourceId || o.relatedSourceId === sourceId,
  );
  return (
    <>
      <p>
        Shared studies, datasets, or reporting can produce several documents
        from one evidence origin. Unlinked sources have unknown independence.
      </p>
      <div className="pedigree-record-list">
        {origins.map((origin) => (
          <article className="pedigree-record" key={origin.id}>
            <header>
              <strong>{origin.kind.replaceAll("-", " ")}</strong>
              <small>{origin.status}</small>
            </header>
            <p>
              {research.sources.find(
                (s) =>
                  s.id ===
                  (origin.sourceId === sourceId
                    ? origin.relatedSourceId
                    : origin.sourceId),
              )?.title || "Saved source"}
            </p>
            <p>{origin.rationale}</p>
            <div className="small-actions">
              <button type="button" onClick={() => edit(origin)}>
                Edit relationship
              </button>
              {origin.status !== "confirmed" && (
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() =>
                    action.save(async () => {
                      await api().saveOriginRelationship({
                        ...origin,
                        status: "confirmed",
                      });
                    })
                  }
                >
                  Confirm dependency
                </button>
              )}
              {origin.status !== "rejected" && (
                <button
                  type="button"
                  disabled={action.busy}
                  onClick={() =>
                    action.save(async () => {
                      await api().saveOriginRelationship({
                        ...origin,
                        status: "rejected",
                      });
                    })
                  }
                >
                  Reject proposal
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <form
        className="pedigree-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.save(async () => {
            const result = await api().saveOriginRelationship(value);
            draft.saved(result, { ...initial, ...entityMeta(project.id) });
          });
        }}
      >
        <SelectField
          label="Related source"
          value={value.relatedSourceId}
          options={[
            { value: "", label: "Choose a source" },
            ...research.sources
              .filter((s) => s.id !== sourceId)
              .map((s) => ({ value: s.id, label: s.title })),
          ]}
          onChange={(relatedSourceId) => edit({ ...value, relatedSourceId })}
        />
        <SelectField
          label="Shared origin relationship"
          value={value.kind}
          options={[
            "same-study",
            "same-dataset",
            "derived-from",
            "same-reporting",
          ]}
          onChange={(kind) => edit({ ...value, kind })}
        />
        <TextField
          label="Dependency reasoning"
          required
          value={value.rationale}
          onChange={(rationale) => edit({ ...value, rationale })}
        />
        <SelectField
          label="Relationship status"
          value={value.status}
          options={["proposed", "confirmed", "rejected"]}
          onChange={(status) => edit({ ...value, status })}
        />
        <FormActions
          busy={action.busy}
          disabled={!value.relatedSourceId}
          dirty={draft.dirty}
          notice={action.notice}
          label="Save origin relationship"
        />
      </form>
    </>
  );
}

export function FindingAssessmentPanel(
  props: SharedProps & { claim: ResearchClaim },
) {
  const { state, error } = usePedigree(props.project.id);
  useEffect(() => {
    if (error) props.onError(error);
  }, [error]);
  if (!state) return null;
  return (
    <>
      <FindingForm key={props.claim.id} {...props} state={state} />
      <ChallengeReview
        project={props.project}
        research={props.research}
        target={{ kind: "finding", id: props.claim.id }}
        onError={props.onError}
        onSource={props.onSource}
      />
    </>
  );
}

function FindingForm({
  project,
  claim,
  state,
  onError,
}: SharedProps & { claim: ResearchClaim; state: PedigreeState }) {
  const saved = latestRecords(state.findings).find(
    (finding) => finding.claimId === claim.id,
  );
  const [empty] = useState(() => createFinding(project.id, claim.id));
  const initial = saved || empty;
  const draft = usePedigreeDraft(`finding:${project.id}:${claim.id}`, initial);
  const { value, edit } = draft;
  const action = useSave(onError);
  const assumptions = latestRecords(state.assumptions);
  return (
    <details className="pedigree-section" open>
      <summary>
        Reasoning and support assessment ·{" "}
        {saved?.supportReview || "unassessed"}
      </summary>
      <p>{claim.title}</p>
      <form
        className="pedigree-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.save(async () =>
            draft.saved(await api().saveFindingAssessment(value)),
          );
        }}
      >
        <SelectField
          label="Finding classification"
          value={value.classification}
          options={[
            "unassessed",
            "source-assertion",
            "inference",
            "hypothesis",
          ]}
          onChange={(classification) => edit({ ...value, classification })}
        />
        <TextField
          label="How the evidence supports this finding"
          value={value.reasoning}
          onChange={(reasoning) => edit({ ...value, reasoning })}
        />
        <SelectField
          label="Support review"
          value={value.supportReview}
          options={[
            "unassessed",
            "supported",
            "partial",
            "unsupported",
            "contradicted",
          ]}
          onChange={(supportReview) => edit({ ...value, supportReview })}
        />
        <SelectField
          label="Researcher confidence"
          value={value.confidence}
          options={["unassessed", "low", "moderate", "high"]}
          onChange={(confidence) => edit({ ...value, confidence })}
        />
        <TextField
          label="Basis for confidence and uncertainty"
          value={value.confidenceBasis}
          onChange={(confidenceBasis) => edit({ ...value, confidenceBasis })}
          hint="Explain source quality, independence, agreement, and what remains unknown. This is a researcher judgment, not a calculated probability."
        />
        <TextField
          label="What would change this assessment?"
          value={value.wouldChange}
          onChange={(wouldChange) => edit({ ...value, wouldChange })}
        />
        <fieldset className="pedigree-link-options">
          <legend>Assumptions used</legend>
          {assumptions.length ? (
            assumptions.map((a) => (
              <label key={a.id}>
                <input
                  type="checkbox"
                  checked={value.assumptionIds.includes(a.id)}
                  onChange={(event) =>
                    edit({
                      ...value,
                      assumptionIds: event.target.checked
                        ? [...value.assumptionIds, a.id]
                        : value.assumptionIds.filter((id) => id !== a.id),
                    })
                  }
                />
                {a.statement}
              </label>
            ))
          ) : (
            <p className="muted">Record assumptions below to link them here.</p>
          )}
        </fieldset>
        <SelectField
          label="Finding review status"
          value={value.reviewStatus}
          options={reviewOptions}
          onChange={(reviewStatus) => edit({ ...value, reviewStatus })}
        />
        <FormActions
          busy={action.busy}
          dirty={draft.dirty}
          notice={action.notice}
          label="Save finding assessment"
        />
        {saved && (
          <RecordHistory kind="finding" id={saved.id} onError={onError} />
        )}
      </form>
    </details>
  );
}

export function AssumptionRegister(props: SharedProps) {
  const { state, error } = usePedigree(props.project.id);
  const [editing, setEditing] = useState<Assumption>();
  useEffect(() => {
    if (error) props.onError(error);
  }, [error]);
  if (!state) return null;
  const assumptions = latestRecords(state.assumptions);
  return (
    <details className="pedigree-section">
      <summary>Assumption register · {assumptions.length}</summary>
      <p>
        Make dependencies in your reasoning visible, and define how each could
        be tested.
      </p>
      <div className="pedigree-record-list">
        {assumptions.map((a) => (
          <article key={a.id} className="pedigree-record">
            <header>
              <strong>{a.statement}</strong>
              <small>{a.status}</small>
            </header>
            <p>{a.consequence || "Consequence not assessed"}</p>
            <button
              type="button"
              className="text-button"
              onClick={() => setEditing(a)}
            >
              Review assumption
            </button>
          </article>
        ))}
      </div>
      <AssumptionForm
        key={editing?.id || "new"}
        {...props}
        initial={editing}
        onSaved={() => setEditing(undefined)}
      />
    </details>
  );
}

function AssumptionForm({
  project,
  research,
  initial,
  onSaved,
  onError,
  onSource,
}: SharedProps & { initial?: Assumption; onSaved: () => void }) {
  const [empty] = useState(() => createAssumption(project.id));
  const draft = usePedigreeDraft(
    `assumption:${project.id}:${initial?.id || "new"}`,
    initial || empty,
  );
  const { value, edit } = draft;
  const action = useSave(onError);
  return (
    <form
      className="pedigree-form"
      onSubmit={(event) => {
        event.preventDefault();
        void action.save(async () => {
          const result = await api().saveAssumption(value);
          draft.saved(
            result,
            initial ? undefined : { ...empty, ...entityMeta(project.id) },
          );
          onSaved();
        });
      }}
    >
      <TextField
        label="Assumption statement"
        required
        value={value.statement}
        onChange={(statement) => edit({ ...value, statement })}
      />
      <TextField
        label="Basis for the assumption"
        value={value.basis}
        onChange={(basis) => edit({ ...value, basis })}
      />
      <TextField
        label="Consequence if wrong"
        value={value.consequence}
        onChange={(consequence) => edit({ ...value, consequence })}
      />
      <TextField
        label="How to validate or challenge it"
        value={value.validation}
        onChange={(validation) => edit({ ...value, validation })}
      />
      <SelectField
        label="Assumption status"
        value={value.status}
        options={["unassessed", "proposed", "supported", "challenged"]}
        onChange={(status) => edit({ ...value, status })}
      />
      <fieldset className="pedigree-link-options">
        <legend>Related findings</legend>
        {research.claims.map((claim) => (
          <label key={claim.id}>
            <input
              type="checkbox"
              checked={value.claimIds.includes(claim.id)}
              onChange={(event) =>
                edit({
                  ...value,
                  claimIds: event.target.checked
                    ? [...value.claimIds, claim.id]
                    : value.claimIds.filter((id) => id !== claim.id),
                })
              }
            />
            {claim.title}
          </label>
        ))}
      </fieldset>
      <PassagePicker
        research={research}
        selected={value.passageIds}
        onChange={(passageIds) => edit({ ...value, passageIds })}
        onSource={onSource}
        onError={onError}
        label="Assumption evidence"
      />
      <FormActions
        busy={action.busy}
        dirty={draft.dirty}
        notice={action.notice}
        label={initial ? "Save assumption revision" : "Save assumption"}
      >
        <button
          type="button"
          className="button quiet"
          disabled={
            action.busy || !value.statement.trim() || !value.validation.trim()
          }
          onClick={() =>
            action.save(async () => {
              const saved = await api().saveAssumption(value);
              draft.saved(saved);
              const sourceIds = [
                ...new Set(
                  (
                    await Promise.all(
                      value.passageIds.map((id) => api().getPassage(id)),
                    )
                  ).map((passage) => passage.sourceId),
                ),
              ];
              await api().saveTask({
                id: crypto.randomUUID(),
                projectId: project.id,
                title: `Validate: ${value.statement}`.slice(0, 200),
                question: project.question,
                claimId: value.claimIds[0],
                assumptionId: saved.id,
                status: "planned",
                criterion: value.validation,
                sourceIds,
                updatedAt: new Date().toISOString(),
              });
              draft.saved(
                saved,
                initial ? undefined : createAssumption(project.id),
              );
            }, "Assumption saved and validation task created.")
          }
        >
          Create validation task
        </button>
      </FormActions>
      {initial &&
        research.tasks.some((task) => task.assumptionId === initial.id) && (
          <ul>
            {research.tasks
              .filter((task) => task.assumptionId === initial.id)
              .map((task) => (
                <li key={task.id}>
                  {task.title} · {task.status}
                </li>
              ))}
          </ul>
        )}
      {initial && (
        <RecordHistory kind="assumption" id={initial.id} onError={onError} />
      )}
    </form>
  );
}
