import { useEffect, useRef, useState } from "react";
import type { Project } from "../../shared/types";
import type { Passage, ResearchState } from "../../shared/research";
import {
  createMethodRow,
  createMethodWorksheet,
  METHOD_REGISTRY,
  type MethodKind,
  type MethodRow,
  type MethodWorksheet,
  type PedigreeState,
  type HypothesisRow,
  type SwotRow,
  type RootCauseRow,
  type RiskRow,
  type TrlRow,
} from "../../shared/pedigree";
import type { MethodAssistanceProposal } from "../../shared/pedigree-analysis";
import { latestRecords, usePedigree } from "./pedigree-state";
import {
  FormActions,
  PassagePicker,
  SelectField,
  TextField,
  usePedigreeDraft,
} from "./pedigree-ui";
import { RecordHistory } from "./PedigreeWorkspace";
import { ChallengeReview } from "./ChallengeReview";
import "./PedigreeWorkspace.css";

type Props = {
  project: Project;
  research: ResearchState;
  onError: (error: unknown) => void;
  onSource: (sourceId: string, versionId?: string, passageId?: string) => void;
  onBoard?: (method: MethodWorksheet) => void;
  requestedMethod?: { id: string; key: number };
  onMethodRequestHandled?: () => void;
};
const selections = new Map<string, { id: string; unsaved?: MethodWorksheet }>();
const assistance = new Map<string, { jobId: string; snapshot: string }>();

export function replaceMethodRow(
  method: MethodWorksheet,
  row: MethodRow,
): MethodWorksheet {
  return {
    ...method,
    rows: method.rows.map((current) => (current.id === row.id ? row : current)),
  } as MethodWorksheet;
}
export function removeMethodRow(
  method: MethodWorksheet,
  rowId: string,
): MethodWorksheet {
  if (
    method.kind === "root-cause" &&
    method.rows.some((row) => row.parentId === rowId)
  )
    throw new Error("Reassign this cause’s child rows before removing it.");
  return {
    ...method,
    rows: method.rows.filter((row) => row.id !== rowId),
  } as MethodWorksheet;
}
export function canApplyMethodProposal(
  current: MethodWorksheet,
  proposal: MethodAssistanceProposal,
  snapshot: string,
): boolean {
  return (
    current.id === proposal.methodId &&
    current.revision === proposal.methodRevision &&
    JSON.stringify(current) === snapshot
  );
}

export function availableCauseParents(
  rows: RootCauseRow[],
  rowId: string,
): RootCauseRow[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return rows.filter((row) => {
    const visited = new Set<string>();
    let current: RootCauseRow | undefined = row;
    while (current) {
      if (current.id === rowId || visited.has(current.id)) return false;
      visited.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return true;
  });
}

export function MethodsWorkspace(props: Props) {
  const { state, error } = usePedigree(props.project.id);
  const [selection, setSelection] = useState(selections.get(props.project.id));
  function select(next: { id: string; unsaved?: MethodWorksheet }) {
    selections.set(props.project.id, next);
    setSelection(next);
  }
  useEffect(() => {
    if (error) props.onError(error);
  }, [error]);
  useEffect(() => {
    if (
      props.requestedMethod &&
      state?.methods.some((m) => m.id === props.requestedMethod!.id)
    ) {
      select({ id: props.requestedMethod.id });
      props.onMethodRequestHandled?.();
    }
  }, [props.requestedMethod?.key, state]);
  if (!state)
    return (
      <main className="pedigree-workspace">
        <p role="status">
          {error
            ? "Methods could not be loaded."
            : "Loading analytical methods…"}
        </p>
      </main>
    );
  const methods = latestRecords(state.methods);
  const selected =
    methods.find((m) => m.id === selection?.id) || selection?.unsaved;
  return (
    <main className="pedigree-workspace">
      <div className="research-heading">
        <div>
          <span className="eyebrow">ANALYTICAL METHODS</span>
          <h2>Make an explanation testable.</h2>
          <p>
            Choose a worksheet, connect observations, and retain the reasoning
            behind each assessment.
          </p>
        </div>
      </div>
      <div className="method-registry">
        {METHOD_REGISTRY.map((method) => (
          <button
            type="button"
            key={method.kind}
            onClick={() => {
              const created = createMethodWorksheet(
                props.project.id,
                method.kind,
              );
              select({ id: created.id, unsaved: created });
            }}
          >
            <strong>{method.label}</strong>
            <span>{method.description}</span>
          </button>
        ))}
      </div>
      <div className="method-layout">
        <nav className="method-list" aria-label="Saved worksheets">
          {methods.map((method) => (
            <button
              type="button"
              key={method.id}
              aria-current={selected?.id === method.id ? "true" : undefined}
              onClick={() => select({ id: method.id })}
            >
              <strong>{method.title}</strong>
              <small>
                {
                  METHOD_REGISTRY.find((entry) => entry.kind === method.kind)
                    ?.label
                }{" "}
                · revision {method.revision}
              </small>
            </button>
          ))}
          {!methods.length && (
            <p className="muted">Saved worksheets appear here.</p>
          )}
        </nav>
        {selected ? (
          <MethodEditor
            key={selected.id}
            {...props}
            method={selected}
            state={state}
            onSaved={(method) => select({ id: method.id, unsaved: method })}
          />
        ) : (
          <p className="research-empty">
            Choose a method to begin. Manual worksheets work without an AI
            connection.
          </p>
        )}
      </div>
    </main>
  );
}

function MethodEditor({
  project,
  research,
  method,
  state,
  onError,
  onSource,
  onBoard,
  onSaved,
}: Props & {
  method: MethodWorksheet;
  state: PedigreeState;
  onSaved: (method: MethodWorksheet) => void;
}) {
  const draft = usePedigreeDraft(`method:${project.id}:${method.id}`, method);
  const { value, edit } = draft;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [assistanceState, setAssistanceState] = useState(
    assistance.get(method.id),
  );
  const [showProposal, setShowProposal] = useState(true);
  const workingCopy = useRef(value);
  workingCopy.current = value;
  const recovered = [...research.jobs]
    .reverse()
    .find(
      (entry) =>
        entry.kind === "method-assistance" &&
        entry.status === "completed" &&
        (entry.result as MethodAssistanceProposal | undefined)?.methodId ===
          method.id,
    );
  const job =
    research.jobs.find((job) => job.id === assistanceState?.jobId) || recovered;
  const proposal =
    job?.status === "completed"
      ? (job.result as MethodAssistanceProposal | undefined)
      : undefined;
  const proposalSnapshot =
    assistanceState?.snapshot ||
    (proposal?.methodRevision === method.revision
      ? JSON.stringify(method)
      : "");
  const aiRunning = Boolean(job && ["queued", "running"].includes(job.status));
  const configured = Boolean(
    project.privacy?.provider && project.privacy.provider !== "offline",
  );
  async function save() {
    const saved = await draft.persist((value) =>
      window.acadia!.saveMethod(value),
    );
    onSaved(saved);
    return saved;
  }
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  function update(row: MethodRow) {
    edit(replaceMethodRow(value, row));
  }
  async function taskFromGap(row: MethodRow) {
    const title = row.nextTest.trim();
    if (!title) return;
    await action(async () => {
      const before = workingCopy.current;
      // A new worksheet must exist before a task can reference it.
      if (!before.revision) {
        const persisted = await window.acadia!.saveMethod(before);
        await draft.saved(persisted);
        onSaved(persisted);
        workingCopy.current = {
          ...workingCopy.current,
          revision: persisted.revision,
          createdAt: persisted.createdAt,
          updatedAt: persisted.updatedAt,
        };
      }
      const sourceIds = [
        ...new Set(
          (
            await Promise.all(
              row.passageIds.map((id) => window.acadia!.getPassage(id)),
            )
          ).map((p) => p.sourceId),
        ),
      ];
      const taskId = crypto.randomUUID();
      await window.acadia!.saveTask({
        id: taskId,
        projectId: project.id,
        title: title.slice(0, 200),
        question: before.objective || project.question,
        claimId: row.claimIds[0],
        methodId: before.id,
        status: "planned",
        criterion: title,
        sourceIds,
        updatedAt: new Date().toISOString(),
      });
      const current = workingCopy.current;
      const liveRow = current.rows.find((item) => item.id === row.id);
      if (liveRow) {
        const linked = replaceMethodRow(current, {
          ...liveRow,
          taskIds: [...liveRow.taskIds, taskId],
        });
        edit(linked);
        workingCopy.current = linked;
        const saved = await window.acadia!.saveMethod(linked);
        await draft.saved(saved);
        onSaved(saved);
      }
      setNotice("Research task created and linked to this worksheet.");
    });
  }
  return (
    <section aria-label="Method worksheet">
      <form
        className="pedigree-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action(async () => {
            await save();
            setNotice("Worksheet revision saved.");
          });
        }}
      >
        <TextField
          label="Worksheet title"
          rows={1}
          required
          value={value.title}
          onChange={(title) => edit({ ...value, title })}
        />
        <TextField
          label="Method objective"
          value={value.objective}
          onChange={(objective) => edit({ ...value, objective })}
        />
        {value.kind === "hypotheses" && (
          <p className="method-reference">
            Evaluate observations against each explanation. A large number of
            supporting passages is not proof; concentrate on evidence that
            distinguishes explanations and on what would disconfirm them.
          </p>
        )}
        {value.kind === "risk" && (
          <p className="method-reference">
            Likelihood and impact are qualitative researcher assessments. Record
            the basis for each; these categories are not numerical probabilities
            or a calculated risk score.
          </p>
        )}
        {value.kind === "swot" && (
          <p className="method-reference">
            Strengths and weaknesses describe internal conditions; opportunities
            and threats describe external conditions. Distinguish observations
            from assumptions and connect each to an implication or action.
          </p>
        )}
        {value.kind === "root-cause" && <CauseTree rows={value.rows} />}
        {value.kind === "trl" && (
          <div className="method-reference">
            <strong>NASA-informed readiness worksheet</strong>
            <p>
              Assess a defined technology element in a stated environment.
              Record demonstrated performance and remaining criteria. Levels are
              researcher judgments, not certification or an automatic measure of
              project success.
            </p>
            <ol>
              {[
                "Basic principles observed",
                "Technology concept formulated",
                "Experimental proof of concept",
                "Technology validated in a laboratory",
                "Technology validated in a relevant environment",
                "System/subsystem prototype demonstrated in a relevant environment",
                "System prototype demonstrated in an operational environment",
                "Actual system completed and qualified",
                "Actual system proven through successful operation",
              ].map((level) => (
                <li key={level}>{level}</li>
              ))}
            </ol>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                window
                  .acadia!.openExternal(
                    "https://www.nasa.gov/reference/system-engineering-handbook-appendix/",
                  )
                  .catch(onError)
              }
            >
              NASA Systems Engineering Handbook · Appendix G.4
            </button>
          </div>
        )}
        {value.kind === "hypotheses" && value.rows.length > 0 && (
          <HypothesisMatrix
            method={value}
            research={research}
            onSource={onSource}
            onError={onError}
          />
        )}
        {value.kind === "swot" && (
          <div className="pedigree-grid method-swot-summary">
            {(["strength", "weakness", "opportunity", "threat"] as const).map(
              (category) => (
                <section className="pedigree-record" key={category}>
                  <h3>{category[0].toUpperCase() + category.slice(1)}s</h3>
                  {value.rows
                    .filter((row) => row.category === category)
                    .map((row) => (
                      <p key={row.id}>
                        {row.text || "Observation not recorded"}{" "}
                        <small>· {row.observationKind}</small>
                      </p>
                    ))}
                </section>
              ),
            )}
          </div>
        )}
        {value.rows.map((row, index) => (
          <details
            className="method-row"
            key={row.id}
            id={`method-row-${row.id}`}
          >
            <summary>
              {index + 1}.{" "}
              {row.text ||
                ("element" in row && row.element) ||
                "New assessment"}
            </summary>
            <RowFields
              kind={value.kind}
              row={row}
              rows={value.rows}
              onChange={update}
            />
            <PassagePicker
              research={research}
              selected={row.passageIds}
              onChange={(passageIds) =>
                update({
                  ...row,
                  passageIds,
                  ...("evaluations" in row
                    ? {
                        evaluations: row.evaluations.filter((e) =>
                          passageIds.includes(e.passageId),
                        ),
                      }
                    : {}),
                })
              }
              onSource={onSource}
              onError={onError}
              label={`Evidence for row ${index + 1}`}
            />
            {value.kind === "hypotheses" && (
              <HypothesisEvaluations
                row={row as HypothesisRow}
                research={research}
                onChange={update}
                onSource={onSource}
                onError={onError}
              />
            )}
            <fieldset className="pedigree-link-options">
              <legend>Linked findings</legend>
              {research.claims.length ? (
                research.claims.map((claim) => (
                  <label key={claim.id}>
                    <input
                      type="checkbox"
                      checked={row.claimIds.includes(claim.id)}
                      onChange={(event) =>
                        update({
                          ...row,
                          claimIds: event.target.checked
                            ? [...row.claimIds, claim.id]
                            : row.claimIds.filter((id) => id !== claim.id),
                        })
                      }
                    />
                    {claim.title}
                  </label>
                ))
              ) : (
                <p className="muted">
                  Create a claim in Evidence to link it here.
                </p>
              )}
            </fieldset>
            <fieldset className="pedigree-link-options">
              <legend>Linked assumptions</legend>
              {state.assumptions.length ? (
                state.assumptions.map((a) => (
                  <label key={a.id}>
                    <input
                      type="checkbox"
                      checked={row.assumptionIds.includes(a.id)}
                      onChange={(event) =>
                        update({
                          ...row,
                          assumptionIds: event.target.checked
                            ? [...row.assumptionIds, a.id]
                            : row.assumptionIds.filter((id) => id !== a.id),
                        })
                      }
                    />
                    {a.statement}
                  </label>
                ))
              ) : (
                <p className="muted">
                  Record assumptions in Evidence to link them here.
                </p>
              )}
            </fieldset>
            <TextField
              label={`Next test or evidence gap for row ${index + 1}`}
              value={row.nextTest}
              onChange={(nextTest) => update({ ...row, nextTest })}
            />
            {row.taskIds.length > 0 && (
              <ul>
                {row.taskIds.map((id) => {
                  const task = research.tasks.find((t) => t.id === id);
                  return (
                    <li key={id}>
                      {task?.title || "Linked task"} ·{" "}
                      {task?.status || "unavailable"}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="pedigree-actions">
              <button
                type="button"
                className="button quiet"
                disabled={busy || !row.nextTest.trim()}
                onClick={() => void taskFromGap(row)}
              >
                Create linked research task
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  try {
                    edit(removeMethodRow(value, row.id));
                  } catch (error) {
                    onError(error);
                  }
                }}
              >
                Remove row {index + 1}
              </button>
            </div>
          </details>
        ))}
        <button
          type="button"
          className="button quiet"
          onClick={() => {
            const row = createMethodRow(value.kind);
            edit({ ...value, rows: [...value.rows, row] } as MethodWorksheet);
            requestAnimationFrame(() => {
              const element = document.getElementById(
                `method-row-${row.id}`,
              ) as HTMLDetailsElement | null;
              if (element) {
                element.open = true;
                element
                  .querySelector<HTMLInputElement>("input,textarea")
                  ?.focus();
              }
            });
          }}
        >
          Add{" "}
          {value.kind === "hypotheses"
            ? "hypothesis"
            : value.kind === "trl"
              ? "technology element"
              : "assessment row"}
        </button>
        <TextField
          label="Method limitations"
          value={value.limitations}
          onChange={(limitations) => edit({ ...value, limitations })}
        />
        <TextField
          label="Recommended next steps"
          value={value.nextSteps}
          onChange={(nextSteps) => edit({ ...value, nextSteps })}
        />
        <SelectField
          label="Worksheet review status"
          value={value.reviewStatus}
          options={["unassessed", "draft", "reviewed"]}
          onChange={(reviewStatus) => edit({ ...value, reviewStatus })}
        />
        <FormActions
          busy={busy}
          dirty={draft.dirty}
          draft={draft}
          notice={notice}
          label="Save worksheet"
        >
          {onBoard && (
            <button
              type="button"
              className="button quiet"
              disabled={busy}
              onClick={() =>
                action(async () => {
                  const saved = await save();
                  onBoard(saved);
                  setNotice("Worksheet linked on the board.");
                })
              }
            >
              Add to board
            </button>
          )}
        </FormActions>
        {method.revision > 0 && (
          <RecordHistory kind="method" id={method.id} onError={onError} />
        )}
      </form>
      <details className="pedigree-section">
        <summary>AI assistance · proposed changes</summary>
        <p>
          Save the worksheet, then ask the configured project model to propose
          improvements. Review the proposal before applying it.
        </p>
        <button
          type="button"
          className="button quiet"
          disabled={
            !configured || busy || aiRunning || draft.dirty || !method.revision
          }
          onClick={() =>
            action(async () => {
              const snapshot = JSON.stringify(workingCopy.current);
              const job = await window.acadia!.assistMethod(method.id);
              const current = { jobId: job.id, snapshot };
              assistance.set(method.id, current);
              setAssistanceState(current);
              setShowProposal(true);
            })
          }
        >
          {aiRunning
            ? "Preparing worksheet proposal…"
            : "Propose worksheet improvements"}
        </button>
        {!configured && (
          <p className="pedigree-inline-note">
            All worksheet fields can be completed manually. AI assistance
            requires a configured project model.
          </p>
        )}
        {job && <p role="status">{job.message}</p>}
        {proposal && showProposal && (
          <section className="pedigree-section" aria-label="Worksheet proposal">
            <h3>Proposed worksheet revision</h3>
            <p>{proposal.summary}</p>
            <MethodPreview method={proposal.proposedMethod} />
            <div className="small-actions">
              {proposal.citations.map((citation) => (
                <button
                  key={citation.id}
                  type="button"
                  onClick={() =>
                    onSource(
                      citation.sourceId,
                      citation.versionId,
                      citation.passageId,
                    )
                  }
                >
                  {citation.sourceTitle} · {citation.locator}
                </button>
              ))}
            </div>
            {proposal.issues.map((issue) => (
              <p key={issue.id}>
                <strong>{issue.summary}</strong> · {issue.detail}
              </p>
            ))}
            {proposal.limitations.map((limitation, i) => (
              <p key={i}>{limitation}</p>
            ))}
            {!canApplyMethodProposal(value, proposal, proposalSnapshot) && (
              <p role="status">
                The worksheet changed after this request. Save your current work
                and request a new proposal.
              </p>
            )}
            <div className="pedigree-actions">
              <button
                type="button"
                className="button primary"
                disabled={
                  !canApplyMethodProposal(value, proposal, proposalSnapshot)
                }
                onClick={() => {
                  edit({ ...proposal.proposedMethod, reviewStatus: "draft" });
                  setShowProposal(false);
                  setNotice(
                    "Proposal applied to the editable worksheet. Review and save its revision.",
                  );
                }}
              >
                Apply proposal to draft
              </button>
              <button
                type="button"
                className="button quiet"
                onClick={() => setShowProposal(false)}
              >
                Dismiss proposal
              </button>
            </div>
          </section>
        )}
      </details>
      {method.revision > 0 && (
        <ChallengeReview
          project={project}
          research={research}
          target={{ kind: "method", id: method.id }}
          onError={onError}
          onSource={onSource}
        />
      )}
    </section>
  );
}

function CauseTree({ rows }: { rows: RootCauseRow[] }) {
  function branch(
    parentId?: string,
    ancestors = new Set<string>(),
  ): React.ReactNode {
    const children = rows.filter(
      (row) => row.parentId === parentId && !ancestors.has(row.id),
    );
    if (!children.length) return null;
    return (
      <ol>
        {children.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                const element = document.getElementById(
                  `method-row-${row.id}`,
                ) as HTMLDetailsElement | null;
                if (element) {
                  element.open = true;
                  element.scrollIntoView({ block: "nearest" });
                  element
                    .querySelector<HTMLTextAreaElement>("textarea")
                    ?.focus({ preventScroll: true });
                }
              }}
            >
              {row.text || "Proposed cause"} · {row.causalStatus}
            </button>
            {branch(row.id, new Set([...ancestors, row.id]))}
          </li>
        ))}
      </ol>
    );
  }
  return rows.length ? (
    <section className="method-reference method-cause-tree">
      <h3>Cause tree / Why chain</h3>
      {branch()}
    </section>
  ) : null;
}

function RowFields({
  kind,
  row,
  rows,
  onChange,
}: {
  kind: MethodKind;
  row: MethodRow;
  rows: MethodRow[];
  onChange: (row: MethodRow) => void;
}) {
  const text = (key: string, label: string, value: string, hint?: string) => (
    <TextField
      key={key}
      label={label}
      value={value}
      hint={hint}
      onChange={(value) => onChange({ ...row, [key]: value })}
    />
  );
  return (
    <div className="pedigree-form">
      {text(
        "text",
        kind === "hypotheses"
          ? "Hypothesis"
          : kind === "root-cause"
            ? "Observation or proposed cause"
            : kind === "risk"
              ? "Risk event"
              : kind === "trl"
                ? "Assessment summary"
                : "SWOT observation",
        row.text,
      )}
      {kind === "hypotheses" && (
        <>
          {text(
            "predictions",
            "Expected observations if true",
            (row as HypothesisRow).predictions,
          )}
          {text(
            "discriminatingTest",
            "Discriminating test",
            (row as HypothesisRow).discriminatingTest,
            "What would distinguish this explanation from the alternatives?",
          )}
        </>
      )}
      {kind === "swot" && (
        <>
          <div className="pedigree-grid">
            <SelectField
              label="SWOT quadrant"
              value={(row as SwotRow).category}
              options={["strength", "weakness", "opportunity", "threat"]}
              onChange={(category) => onChange({ ...row, category } as SwotRow)}
            />
            <SelectField
              label="Observation or assumption"
              value={(row as SwotRow).observationKind}
              options={["observation", "assumption"]}
              onChange={(observationKind) =>
                onChange({ ...row, observationKind } as SwotRow)
              }
            />
          </div>
          {text("implications", "Implications", (row as SwotRow).implications)}
          {text("actions", "Actions to consider", (row as SwotRow).actions)}
        </>
      )}
      {kind === "root-cause" && (
        <>
          <SelectField
            label="Parent observation or cause"
            value={(row as RootCauseRow).parentId || ""}
            options={[
              { value: "", label: "Top-level observation" },
              ...availableCauseParents(rows as RootCauseRow[], row.id).map(
                (r, i) => ({
                  value: r.id,
                  label: r.text || `Cause ${i + 1}`,
                }),
              ),
            ]}
            onChange={(parentId) =>
              onChange({
                ...row,
                parentId: parentId || undefined,
              } as RootCauseRow)
            }
          />
          <SelectField
            label="Causal assessment"
            value={(row as RootCauseRow).causalStatus}
            options={[
              "unassessed",
              "possible",
              "supported",
              "tested",
              "rejected",
            ]}
            onChange={(causalStatus) =>
              onChange({ ...row, causalStatus } as RootCauseRow)
            }
          />
          {text(
            "rationale",
            "Why this could explain its parent",
            (row as RootCauseRow).rationale,
          )}
          {text(
            "testEvidence",
            "Test result and conditions",
            (row as RootCauseRow).testEvidence,
            "A proposed Why chain is not an established causal finding.",
          )}
        </>
      )}
      {kind === "risk" && (
        <>
          {(
            [
              ["causes", "Causes"],
              ["consequences", "Consequences"],
              ["controls", "Existing controls"],
            ] as const
          ).map(([key, label]) => text(key, label, (row as RiskRow)[key]))}
          <div className="pedigree-grid">
            <SelectField
              label="Qualitative likelihood"
              value={(row as RiskRow).likelihood}
              options={["unassessed", "low", "moderate", "high"]}
              onChange={(likelihood) =>
                onChange({ ...row, likelihood } as RiskRow)
              }
            />
            <SelectField
              label="Qualitative impact"
              value={(row as RiskRow).impact}
              options={["unassessed", "low", "moderate", "high"]}
              onChange={(impact) => onChange({ ...row, impact } as RiskRow)}
            />
          </div>
          {(
            [
              ["likelihoodBasis", "Likelihood reasoning"],
              ["impactBasis", "Impact reasoning"],
              ["mitigation", "Proposed mitigation"],
              ["owner", "Owner or unassigned"],
              ["residualRisk", "Residual risk and uncertainty"],
            ] as const
          ).map(([key, label]) => text(key, label, (row as RiskRow)[key]))}
        </>
      )}
      {kind === "trl" && (
        <>
          {text("element", "Technology element", (row as TrlRow).element)}
          {text(
            "environment",
            "Assessment environment",
            (row as TrlRow).environment,
          )}
          <SelectField
            label="Researcher-assessed TRL"
            value={
              (row as TrlRow).assessedLevel === null
                ? ""
                : String((row as TrlRow).assessedLevel)
            }
            options={[
              { value: "", label: "Unassessed" },
              ...Array.from({ length: 9 }, (_, i) => ({
                value: String(i + 1),
                label: `TRL ${i + 1}`,
              })),
            ]}
            onChange={(level) =>
              onChange({
                ...row,
                assessedLevel: level ? Number(level) : null,
              } as TrlRow)
            }
          />
          {text(
            "criteria",
            "Applicable readiness criteria",
            (row as TrlRow).criteria,
          )}
          {text(
            "demonstrated",
            "Demonstrated capability and conditions",
            (row as TrlRow).demonstrated,
          )}
          {text(
            "requiredEvidence",
            "Remaining criteria and required evidence",
            (row as TrlRow).requiredEvidence,
          )}
        </>
      )}
    </div>
  );
}

function PassageLabel({
  id,
  research,
  onSource,
  onError,
}: {
  id: string;
  research: ResearchState;
  onSource: Props["onSource"];
  onError: Props["onError"];
}) {
  const [passage, setPassage] = useState<Passage>();
  useEffect(() => {
    let alive = true;
    window
      .acadia!.getPassage(id)
      .then((p) => {
        if (alive) setPassage(p);
      })
      .catch(onError);
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <button
      type="button"
      className="text-button method-passage-link"
      disabled={!passage}
      onClick={() =>
        passage && onSource(passage.sourceId, passage.versionId, passage.id)
      }
    >
      {research.sources.find((s) => s.id === passage?.sourceId)?.title ||
        "Saved evidence"}{" "}
      · {passage?.locator || "Loading passage…"}
    </button>
  );
}

function HypothesisEvaluations({
  row,
  research,
  onChange,
  onSource,
  onError,
}: {
  row: HypothesisRow;
  research: ResearchState;
  onChange: (row: HypothesisRow) => void;
  onSource: Props["onSource"];
  onError: Props["onError"];
}) {
  return (
    <div className="pedigree-form">
      {row.passageIds.map((id) => {
        const evaluation = row.evaluations.find((e) => e.passageId === id) || {
          passageId: id,
          assessment: "unassessed" as const,
          rationale: "",
        };
        const change = (next: typeof evaluation) =>
          onChange({
            ...row,
            evaluations: [
              ...row.evaluations.filter((e) => e.passageId !== id),
              next,
            ],
          });
        return (
          <section className="pedigree-record" key={id}>
            <PassageLabel
              id={id}
              research={research}
              onSource={onSource}
              onError={onError}
            />
            <SelectField
              label="Evidence relationship to hypothesis"
              value={evaluation.assessment}
              options={["unassessed", "supports", "contradicts", "neutral"]}
              onChange={(assessment) => change({ ...evaluation, assessment })}
            />
            <TextField
              label="Diagnostic value and reasoning"
              value={evaluation.rationale}
              onChange={(rationale) => change({ ...evaluation, rationale })}
            />
          </section>
        );
      })}
    </div>
  );
}

function HypothesisMatrix({
  method,
  research,
  onSource,
  onError,
}: {
  method: Extract<MethodWorksheet, { kind: "hypotheses" }>;
  research: ResearchState;
  onSource: Props["onSource"];
  onError: Props["onError"];
}) {
  const ids = [...new Set(method.rows.flatMap((row) => row.passageIds))];
  if (!ids.length) return null;
  return (
    <div className="method-matrix">
      <table>
        <caption>
          Evidence against competing explanations · no support tally
        </caption>
        <thead>
          <tr>
            <th>Evidence</th>
            {method.rows.map((row, i) => (
              <th key={row.id}>{row.text || `Hypothesis ${i + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => (
            <tr key={id}>
              <th>
                <PassageLabel
                  id={id}
                  research={research}
                  onSource={onSource}
                  onError={onError}
                />
              </th>
              {method.rows.map((row) => {
                const evaluation = row.evaluations.find(
                  (e) => e.passageId === id,
                );
                return (
                  <td key={row.id}>
                    <strong>{evaluation?.assessment || "unassessed"}</strong>
                    <p>
                      {evaluation?.rationale || "Diagnostic value not recorded"}
                    </p>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MethodPreview({ method }: { method: MethodWorksheet }) {
  return (
    <div className="pedigree-record-list">
      <h4>{method.title}</h4>
      <p>{method.objective}</p>
      {method.rows.map((row, i) => (
        <article className="pedigree-record" key={row.id}>
          <strong>
            {i + 1}. {row.text || "Proposed assessment"}
          </strong>
          <dl>
            {Object.entries(row)
              .filter(
                ([key, value]) =>
                  !["id", "text", "parentId"].includes(key) &&
                  (typeof value === "string" || typeof value === "number") &&
                  value !== "",
              )
              .map(([key, value]) => (
                <div key={key}>
                  <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
          </dl>
          <p>
            {row.passageIds.length} located passages ·{" "}
            {row.assumptionIds.length} linked assumptions · {row.taskIds.length}{" "}
            linked tasks
          </p>
          {"evaluations" in row &&
            row.evaluations.map((evaluation) => (
              <p key={evaluation.passageId}>
                {evaluation.assessment} · {evaluation.rationale}
              </p>
            ))}
        </article>
      ))}
      <p>Limitations: {method.limitations || "Not assessed"}</p>
      <p>Next steps: {method.nextSteps || "Not recorded"}</p>
    </div>
  );
}
