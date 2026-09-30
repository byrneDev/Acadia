import { useEffect, useRef, useState } from "react";
import type { Project } from "../../shared/types";
import type { ResearchState, ResearchTask } from "../../shared/research";
import {
  createDecision,
  createGap,
  type PedigreeState,
  type ResearchDecision,
  type ResearchGap,
} from "../../shared/pedigree";
import { usePedigree } from "./pedigree-state";
import { RecordHistory } from "./PedigreeWorkspace";
import {
  FormActions,
  PassagePicker,
  SelectField,
  TextField,
  usePedigreeDraft,
} from "./pedigree-ui";
import "./ResearchFlowWorkspace.css";

type FlowKind = "gap" | "decision";
type FlowReference = { kind: FlowKind; id: string };
export interface ResearchFlowRequest {
  kind: FlowKind;
  id?: string;
  key: number;
}
interface Props {
  project: Project;
  research: ResearchState;
  onError: (error: unknown) => void;
  onSource?: (sourceId: string, versionId?: string, passageId?: string) => void;
  request?: ResearchFlowRequest;
  onRequestHandled?: () => void;
  onAddToBoard?: (reference: FlowReference) => void | Promise<void>;
}

function LinkedRecords({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: { id: string; title: string; status?: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const missing = selected.filter((id) => !options.some((o) => o.id === id));
  return (
    <fieldset className="flow-links">
      <legend>{label}</legend>
      {!options.length && !missing.length && (
        <p className="muted">No records available yet.</p>
      )}
      {[
        ...options,
        ...missing.map((id) => ({
          id,
          title: "Unavailable record",
          status: id,
        })),
      ].map((option) => (
        <label key={option.id}>
          <input
            type="checkbox"
            checked={selected.includes(option.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, option.id]
                  : selected.filter((id) => id !== option.id),
              )
            }
          />
          <span>
            {option.title}
            {option.status && <small>{option.status}</small>}
          </span>
        </label>
      ))}
    </fieldset>
  );
}

export function ResearchFlowWorkspace(props: Props) {
  const { state, error } = usePedigree(props.project.id);
  const [selection, setSelection] = useState<{
    kind: FlowKind;
    id?: string;
    saved?: ResearchGap | ResearchDecision;
  }>();
  const [query, setQuery] = useState("");
  const handled = useRef<number | undefined>(undefined);
  useEffect(() => {
    setSelection(undefined);
    setQuery("");
    handled.current = undefined;
  }, [props.project.id]);
  useEffect(() => {
    if (error) props.onError(error);
  }, [error]);
  useEffect(() => {
    if (!props.request || handled.current === props.request.key) return;
    handled.current = props.request.key;
    setSelection({ kind: props.request.kind, id: props.request.id });
    setQuery("");
    props.onRequestHandled?.();
  }, [props.request?.key]);

  if (!state)
    return (
      <main className="pedigree-workspace">
        <p role="status">
          {error
            ? "Gaps and decisions could not be loaded."
            : "Loading gaps and decisions…"}
        </p>
      </main>
    );

  const records = [
    ...state.gaps.map((record) => ({ kind: "gap" as const, record })),
    ...state.decisions.map((record) => ({ kind: "decision" as const, record })),
  ];
  const visible = records.filter(({ kind, record }) =>
    `${kind} ${record.title} ${record.status} ${"missingInformation" in record ? record.missingInformation : record.action}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  const chosen = selection?.id
    ? records.find(
        ({ kind, record }) =>
          kind === selection.kind && record.id === selection.id,
      ) ||
      (selection.saved
        ? { kind: selection.kind, record: selection.saved }
        : undefined)
    : undefined;

  return (
    <main className="pedigree-workspace flow-workspace">
      <div className="research-heading">
        <div>
          <span className="eyebrow">GAPS & DECISIONS</span>
          <h2>Connect missing evidence to the next action.</h2>
          <p>
            Record what remains unknown, the work needed to resolve it, and the
            reasoning behind a decision. Status changes are yours to make.
          </p>
        </div>
        <div className="flow-create-actions">
          <button
            className="button"
            onClick={() => setSelection({ kind: "gap" })}
          >
            New research gap
          </button>
          <button
            className="button"
            onClick={() => setSelection({ kind: "decision" })}
          >
            New decision
          </button>
        </div>
      </div>
      <div className="flow-columns">
        <aside className="flow-list" aria-label="Gaps and decisions">
          <TextField
            label="Find gaps and decisions"
            value={query}
            onChange={setQuery}
            rows={1}
          />
          {!visible.length && (
            <p className="muted">
              {records.length
                ? "No matching records."
                : "Create a gap or decision to connect the investigation to useful work."}
            </p>
          )}
          {visible.map(({ kind, record }) => (
            <button
              className={`flow-record ${selection?.id === record.id ? "selected" : ""}`}
              key={record.id}
              aria-pressed={selection?.id === record.id}
              onClick={() => setSelection({ kind, id: record.id })}
            >
              <small>
                {kind === "gap" ? "Research gap" : "Decision"} · {record.status}
              </small>
              <strong>{record.title || "Untitled"}</strong>
              <span>
                {"missingInformation" in record
                  ? record.missingInformation
                  : record.action}
              </span>
            </button>
          ))}
        </aside>
        <section className="flow-editor" aria-label="Gap or decision editor">
          {!selection && (
            <div className="flow-empty">
              <h3>From a finding to a deliverable</h3>
              <p>
                Select a record to review its reasoning and links, or create a
                new gap or decision. Board placement is an explicit separate
                action.
              </p>
            </div>
          )}
          {selection?.id && !chosen && (
            <p role="status">
              This record is unavailable. Its board placement and historical
              references are preserved.
            </p>
          )}
          {selection?.kind === "gap" && (!selection.id || chosen) && (
            <GapEditor
              {...props}
              state={state}
              key={`gap:${selection.id || "new"}`}
              record={chosen?.record as ResearchGap | undefined}
              onSaved={(record) =>
                setSelection({ kind: "gap", id: record.id, saved: record })
              }
            />
          )}
          {selection?.kind === "decision" && (!selection.id || chosen) && (
            <DecisionEditor
              {...props}
              state={state}
              key={`decision:${selection.id || "new"}`}
              record={chosen?.record as ResearchDecision | undefined}
              onSaved={(record) =>
                setSelection({ kind: "decision", id: record.id, saved: record })
              }
            />
          )}
        </section>
      </div>
    </main>
  );
}

function GapEditor({
  project,
  research,
  record,
  onSaved,
  onError,
  onSource,
  onAddToBoard,
}: Props & {
  state: PedigreeState;
  record?: ResearchGap;
  onSaved: (record: ResearchGap) => void;
}) {
  const [empty] = useState(() => createGap(project.id));
  const draft = usePedigreeDraft(
    `gap:${project.id}:${record?.id || "new"}`,
    record || empty,
  );
  const { value, edit } = draft;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskCriterion, setTaskCriterion] = useState("");
  const valid = Boolean(value.title.trim() && value.missingInformation.trim());
  async function save(place = false) {
    setBusy(true);
    setNotice("");
    try {
      const saved = await draft.persist(
        (submitted) => window.acadia!.saveGap(submitted),
        record ? undefined : createGap(project.id),
      );
      onSaved(saved);
      if (place) await onAddToBoard?.({ kind: "gap", id: saved.id });
      setNotice("Saved a new revision.");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  async function createTask() {
    setBusy(true);
    setNotice("");
    let created: ResearchTask | undefined;
    try {
      const gap = await draft.persist((submitted) =>
        window.acadia!.saveGap(submitted),
      );
      const task: ResearchTask = {
        id: crypto.randomUUID(),
        projectId: project.id,
        title: taskTitle.trim(),
        question: gap.missingInformation,
        ...(gap.claimIds[0] ? { claimId: gap.claimIds[0] } : {}),
        criterion: taskCriterion.trim() || gap.resolutionCriteria,
        status: "planned",
        sourceIds: [],
        updatedAt: new Date().toISOString(),
      };
      await window.acadia!.saveTask(task);
      created = task;
      const linked = await draft.persist(
        (submitted) =>
          window.acadia!.saveGap({
            ...submitted,
            taskIds: [...new Set([...submitted.taskIds, task.id])],
          }),
        record ? undefined : createGap(project.id),
      );
      setTaskTitle("");
      setTaskCriterion("");
      onSaved(linked);
      setNotice("Created a planned research task and linked it to this gap.");
    } catch (error) {
      if (created)
        setNotice(
          `Task “${created.title}” was saved in Tasks, but linking it failed. Select it under Related research tasks and save the gap.`,
        );
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="pedigree-form flow-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3>{record ? "Research gap" : "New research gap"}</h3>
      <fieldset className="flow-fields" disabled={busy}>
        <TextField
          label="Gap title"
          value={value.title}
          onChange={(title) => edit({ ...value, title })}
          required
          rows={1}
        />
        <TextField
          label="Missing information"
          value={value.missingInformation}
          onChange={(missingInformation) =>
            edit({ ...value, missingInformation })
          }
          required
        />
        <TextField
          label="Why this gap matters"
          value={value.importance}
          onChange={(importance) => edit({ ...value, importance })}
        />
        <TextField
          label="Resolution criteria"
          value={value.resolutionCriteria}
          onChange={(resolutionCriteria) =>
            edit({ ...value, resolutionCriteria })
          }
          hint="Describe the observation or result needed to resolve this gap."
        />
        <SelectField
          label="Gap status"
          value={value.status}
          options={["open", "investigating", "resolved"]}
          onChange={(status) => edit({ ...value, status })}
        />
        <p className="muted">
          Only your saved assessment changes this status. Completing a linked
          task does not automatically resolve the gap.
        </p>
        <LinkedRecords
          label="Related findings"
          options={research.claims.map((claim) => ({
            id: claim.id,
            title: claim.title,
            status: claim.status,
          }))}
          selected={value.claimIds}
          onChange={(claimIds) => edit({ ...value, claimIds })}
        />
        <LinkedRecords
          label="Related research tasks"
          options={research.tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
          }))}
          selected={value.taskIds}
          onChange={(taskIds) => edit({ ...value, taskIds })}
        />
        <PassagePicker
          label="Resolution evidence"
          research={research}
          selected={value.passageIds}
          onChange={(passageIds) => edit({ ...value, passageIds })}
          onSource={onSource}
          onError={onError}
        />
        <details className="pedigree-section flow-task">
          <summary>Create a task for this gap</summary>
          <TextField
            label="Follow-up task"
            value={taskTitle}
            onChange={setTaskTitle}
            rows={1}
          />
          <TextField
            label="Task completion criteria"
            value={taskCriterion}
            onChange={setTaskCriterion}
            hint="Leave blank to use the gap’s resolution criteria. Due dates and resulting evidence can be edited in Tasks."
          />
          <button
            type="button"
            className="button"
            disabled={!valid || !taskTitle.trim()}
            onClick={() => void createTask()}
          >
            Save gap and create task
          </button>
        </details>
      </fieldset>
      <FormActions
        busy={busy}
        dirty={draft.dirty}
        draft={draft}
        disabled={!valid}
        label="Save research gap"
        notice={notice}
      >
        {onAddToBoard && (
          <button
            type="button"
            className="button"
            disabled={busy || !valid}
            onClick={() => void save(true)}
          >
            Add to board
          </button>
        )}
      </FormActions>
      {record && <RecordHistory kind="gap" id={record.id} onError={onError} />}
    </form>
  );
}

function DecisionEditor({
  project,
  research,
  state,
  record,
  onSaved,
  onError,
  onAddToBoard,
}: Props & {
  state: PedigreeState;
  record?: ResearchDecision;
  onSaved: (record: ResearchDecision) => void;
}) {
  const [empty] = useState(() => createDecision(project.id));
  const draft = usePedigreeDraft(
    `decision:${project.id}:${record?.id || "new"}`,
    record || empty,
  );
  const { value, edit } = draft;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const valid = Boolean(value.title.trim() && value.action.trim());
  async function save(place = false) {
    setBusy(true);
    setNotice("");
    try {
      const saved = await draft.persist(
        (submitted) => window.acadia!.saveDecision(submitted),
        record ? undefined : createDecision(project.id),
      );
      onSaved(saved);
      if (place) await onAddToBoard?.({ kind: "decision", id: saved.id });
      setNotice("Saved a new revision.");
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="pedigree-form flow-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3>{record ? "Decision" : "New decision"}</h3>
      <fieldset className="flow-fields" disabled={busy}>
        <TextField
          label="Decision title"
          value={value.title}
          onChange={(title) => edit({ ...value, title })}
          required
          rows={1}
        />
        <TextField
          label="Proposed or chosen action"
          value={value.action}
          onChange={(action) => edit({ ...value, action })}
          required
        />
        <TextField
          label="Decision rationale"
          value={value.rationale}
          onChange={(rationale) => edit({ ...value, rationale })}
        />
        <TextField
          label="Alternatives considered"
          value={value.alternatives}
          onChange={(alternatives) => edit({ ...value, alternatives })}
        />
        <SelectField
          label="Decision status"
          value={value.status}
          options={["proposed", "made", "reconsider"]}
          onChange={(status) => edit({ ...value, status })}
        />
        <p className="muted">
          Record a decision as made only after your review. Links show the
          reasoning used; they do not establish support automatically.
        </p>
        <LinkedRecords
          label="Supporting findings"
          options={research.claims.map((claim) => ({
            id: claim.id,
            title: claim.title,
            status: claim.status,
          }))}
          selected={value.claimIds}
          onChange={(claimIds) => edit({ ...value, claimIds })}
        />
        <LinkedRecords
          label="Consequential assumptions"
          options={state.assumptions.map((assumption) => ({
            id: assumption.id,
            title: assumption.statement,
            status: assumption.status,
          }))}
          selected={value.assumptionIds}
          onChange={(assumptionIds) => edit({ ...value, assumptionIds })}
        />
        <LinkedRecords
          label="Linked deliverables and reports"
          options={project.outputs.map((output) => ({
            id: output.id,
            title: output.title,
            status: output.kind.replaceAll("-", " "),
          }))}
          selected={value.outputIds}
          onChange={(outputIds) => edit({ ...value, outputIds })}
        />
      </fieldset>
      <FormActions
        busy={busy}
        dirty={draft.dirty}
        draft={draft}
        disabled={!valid}
        label="Save decision"
        notice={notice}
      >
        {onAddToBoard && (
          <button
            type="button"
            className="button"
            disabled={busy || !valid}
            onClick={() => void save(true)}
          >
            Add to board
          </button>
        )}
      </FormActions>
      {record && (
        <RecordHistory kind="decision" id={record.id} onError={onError} />
      )}
    </form>
  );
}
