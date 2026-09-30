import { useMemo, useState } from "react";
import type { ResearchOutput } from "../../shared/types";
import {
  draftDeliveryPlan,
  newWorkPackage,
  validateDeliveryPlan,
  pmisMappingPreview,
  type DeliveryPlan,
  type WorkPackage,
} from "../../shared/pmis";
import type { ResearchState } from "../../shared/research";
import type { PedigreeState } from "../../shared/pedigree";
import { useBoardMapping } from "./BoardMappingContext";
import { useDurableDraft } from "./durableDrafts";
import {
  DeliveryRecordFields,
  VerificationEvidenceField,
} from "./DeliveryTraceability";
import { Modal } from "./Dialogs";
import "./DeliveryPlanPanel.css";

export function DeliveryPlanPanel({
  output,
  projectId,
  research,
  pedigree,
  readOnly,
  onChange,
  onError,
}: {
  output: ResearchOutput;
  projectId: string;
  research?: ResearchState | null;
  pedigree?: PedigreeState | null;
  readOnly: boolean;
  onChange: (output: ResearchOutput) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  if (output.kind !== "project-plan" && !output.deliveryPlan) return null;
  const prepare = () => {
    setOpen(true);
    setNotice("");
  };
  const exportPlan = async () => {
    setBusy(true);
    try {
      const path = await window.acadia!.exportProjectPlan(output);
      if (path) {
        setNotice(
          "PMIS package exported with mapping instructions and research report.",
        );
        setPreview(false);
      }
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="delivery-plan-panel"
      aria-label="Deliverable work packages"
    >
      <h3>Deliverable work packages</h3>
      <p>
        {output.deliveryPlan
          ? `${output.deliveryPlan.tasks.length} work packages · ${output.deliveryPlan.reviewStatus}`
          : "Prepare work packages from the plan’s work-breakdown table, then review and edit them before a PMIS handoff."}
      </p>
      <div className="delivery-actions">
        {!readOnly && (
          <button className="button quiet" onClick={prepare}>
            {output.deliveryPlan
              ? "Edit work packages"
              : "Prepare work packages"}
          </button>
        )}
        {output.deliveryPlan && !readOnly && (
          <button className="button quiet" onClick={() => setPreview(true)}>
            Export to PMIS
          </button>
        )}
      </div>
      {notice && <p role="status">{notice}</p>}
      {readOnly && output.deliveryPlan && (
        <table>
          <thead>
            <tr>
              <th>Work package</th>
              <th>Acceptance criteria</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {output.deliveryPlan.tasks.map((t) => (
              <tr key={t.id}>
                <td>{t.title}</td>
                <td>{t.acceptanceCriteria || "Unassessed"}</td>
                <td>{t.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open && !readOnly && (
        <DeliveryPlanEditor
          output={output}
          projectId={projectId}
          research={research}
          pedigree={pedigree}
          onChange={onChange}
          onClose={() => setOpen(false)}
          onError={onError}
          onSaved={() => {
            setOpen(false);
            setNotice(
              "Work packages saved. Save a report revision to freeze this plan.",
            );
          }}
        />
      )}
      {preview && (
        <Modal
          title="PMIS handoff"
          wide
          subtitle="Export local import files for Monday, Jira, Planner, or another PMIS."
          onClose={() => setPreview(false)}
        >
          <p>
            {output.deliveryPlan?.tasks.length || 0} work packages ·{" "}
            {output.deliveryPlan?.reviewStatus || "draft"}. The ZIP includes a
            source report and stable task/dependency identifiers.
          </p>
          {output.deliveryPlan && (
            <>
              <table className="delivery-mapping">
                <thead>
                  <tr>
                    <th>Destination</th>
                    <th>Identity / mapping</th>
                    <th>Repeat import</th>
                  </tr>
                </thead>
                <tbody>
                  {pmisMappingPreview(output.deliveryPlan).destinations.map(
                    (d) => (
                      <tr key={d.name}>
                        <td>{d.name}</td>
                        <td>
                          {d.identity}
                          <br />
                          {d.assignments}
                          <br />
                          {d.dependencies}
                        </td>
                        <td>{d.repeatImport}</td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
              <p>
                {pmisMappingPreview(output.deliveryPlan).unassignedOwners}{" "}
                unassigned owners ·{" "}
                {pmisMappingPreview(output.deliveryPlan).unscheduledTasks}{" "}
                unscheduled tasks ·{" "}
                {
                  pmisMappingPreview(output.deliveryPlan)
                    .withoutVerificationEvidence
                }{" "}
                work packages without verification passages.
              </p>
            </>
          )}
          <ul>
            <li>
              <strong>Monday:</strong> CSV with task names, phases, dates and
              descriptions.
            </li>
            <li>
              <strong>Jira:</strong> CSV with task summaries, acceptance
              criteria and provenance.
            </li>
            <li>
              <strong>Planner:</strong> JSON plus an interactive Microsoft Graph
              PowerShell importer for an existing basic plan.
            </li>
          </ul>
          <p>
            Dependencies and owners are preserved as data. Native scheduling
            links and assignments need destination setup. The included guide
            explains each mapping. Exporting does not send data to these
            services. These mappings have not been verified against a live
            tenant; review the included import preview and retain destination
            IDs before repeating an import.
          </p>
          <div className="modal-actions">
            <button className="button quiet" onClick={() => setPreview(false)}>
              Cancel
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void exportPlan()}
            >
              {busy ? "Exporting…" : "Export PMIS package"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function DeliveryPlanEditor({
  output,
  projectId,
  research,
  pedigree,
  onChange,
  onClose,
  onSaved,
  onError,
}: {
  output: ResearchOutput;
  projectId: string;
  research?: ResearchState | null;
  pedigree?: PedigreeState | null;
  onChange: (output: ResearchOutput) => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
  onError: (error: unknown) => void;
}) {
  const initial = useMemo(
    () => output.deliveryPlan || draftDeliveryPlan(output),
    [output.id, output.deliveryPlan],
  );
  const draft = useDurableDraft({
    projectId,
    key: `delivery-plan:${output.id}`,
    kind: "delivery-plan",
    targetId: output.id,
    initial,
    baseSignature: JSON.stringify(output.deliveryPlan || null),
  });
  const working = draft.value;
  const mapping = useBoardMapping();
  const [busy, setBusy] = useState(false);
  const setWorking = (
    next: DeliveryPlan | ((value: DeliveryPlan) => DeliveryPlan),
  ) => draft.edit(typeof next === "function" ? next(working) : next);
  const edit = (id: string, patch: Partial<WorkPackage>) =>
    setWorking((p) => ({
      ...p,
      reviewStatus: "draft",
      tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  const close = async () => {
    try {
      await draft.flush();
      onClose();
    } catch (error) {
      onError(error);
    }
  };
  const discard = async () => {
    if (
      !window.confirm(
        "Discard this private work-package draft? The saved report plan will remain.",
      )
    )
      return;
    try {
      await draft.discard();
      onClose();
    } catch (error) {
      onError(error);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await draft.persist(async (value) => {
        const plan = validateDeliveryPlan({
          ...value,
          updatedAt: new Date().toISOString(),
        });
        await onChange({ ...output, deliveryPlan: plan });
        return plan;
      });
      onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Delivery work packages"
      subtitle="Review the work that will be handed to your project management system."
      wide
      onClose={() => void close()}
    >
      <div className="delivery-packages-editor">
        {draft.loading && <p role="status">Loading saved draft…</p>}
        {draft.recovered && (
          <p role="status">Recovered your private work-package draft.</p>
        )}
        {draft.error && <p role="alert">{draft.error}</p>}
        {draft.conflict && (
          <p role="alert">
            The saved plan changed after this draft began. Review the draft,
            then explicitly keep it or discard it.{" "}
            <button
              className="button quiet"
              onClick={draft.acknowledgeConflict}
            >
              Keep reviewed draft over latest plan
            </button>
          </p>
        )}
        <p role="status">
          {draft.saving || draft.sequence > draft.written
            ? "Saving private draft…"
            : draft.dirty
              ? "Private draft saved locally; apply it to update the report."
              : "No unapplied changes."}
        </p>
        <DeliveryRecordFields
          pedigree={pedigree}
          research={research}
          value={working}
          onChange={(patch) =>
            setWorking({ ...working, ...patch, reviewStatus: "draft" })
          }
        />
        {!working.tasks.length && (
          <p>
            No work-breakdown table was found. Add work packages manually; no
            tasks have been inferred from unrelated report text.
          </p>
        )}
        {working.tasks.map((task, index) => (
          <details
            key={task.id}
            open={index === 0}
            className="delivery-work-package"
          >
            <summary>
              {index + 1}. {task.title || "Untitled work package"}
            </summary>
            <label className="field">
              Task title
              <input
                value={task.title}
                maxLength={255}
                onChange={(e) => edit(task.id, { title: e.target.value })}
              />
            </label>
            <label className="field">
              Phase / bucket
              <input
                value={task.phase}
                maxLength={255}
                onChange={(e) => edit(task.id, { phase: e.target.value })}
              />
            </label>
            <label className="field">
              Deliverable / description
              <textarea
                value={task.description}
                rows={3}
                onChange={(e) => edit(task.id, { description: e.target.value })}
              />
            </label>
            <label className="field">
              Acceptance criteria
              <textarea
                value={task.acceptanceCriteria}
                rows={3}
                onChange={(e) =>
                  edit(task.id, { acceptanceCriteria: e.target.value })
                }
              />
            </label>
            <label className="field">
              {working.deliverableType === "curriculum"
                ? "Learning objective"
                : "Requirement"}
              <textarea
                aria-label={`${working.deliverableType === "curriculum" ? "Learning objective" : "Requirement"} for work package ${index + 1}`}
                value={
                  (working.deliverableType === "curriculum"
                    ? task.learningObjective
                    : task.requirement) || ""
                }
                onChange={(e) =>
                  edit(
                    task.id,
                    working.deliverableType === "curriculum"
                      ? { learningObjective: e.target.value }
                      : { requirement: e.target.value },
                  )
                }
              />
            </label>
            <label className="field">
              Acceptance test / assessment
              <textarea
                aria-label={`Acceptance test for work package ${index + 1}`}
                value={task.acceptanceTest || ""}
                onChange={(e) =>
                  edit(task.id, { acceptanceTest: e.target.value })
                }
              />
            </label>
            <DeliveryRecordFields
              label={`Work package ${index + 1}`}
              pedigree={pedigree}
              research={research}
              value={task}
              onChange={(patch) => edit(task.id, patch)}
            />
            <VerificationEvidenceField
              label={`Work package ${index + 1}`}
              value={task.verificationEvidence || []}
              onOpen={
                mapping
                  ? (ref) => {
                      void draft
                        .flush()
                        .then(() => {
                          onClose();
                          mapping.openRecord({
                            kind: "passage",
                            id: ref.passageId,
                            versionId: ref.versionId,
                          });
                        })
                        .catch(onError);
                    }
                  : undefined
              }
              onChange={(value) =>
                edit(task.id, { verificationEvidence: value })
              }
            />
            <label className="field">
              Dependencies
              <select
                multiple
                aria-label={`Dependencies for work package ${index + 1}`}
                value={task.dependencyIds}
                onChange={(e) =>
                  edit(task.id, {
                    dependencyIds: Array.from(
                      e.target.selectedOptions,
                      (o) => o.value,
                    ),
                  })
                }
              >
                {working.tasks
                  .filter((t) => t.id !== task.id)
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title || "Untitled work package"}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              Other prerequisites / dependency notes
              <textarea
                value={task.dependencyNotes}
                rows={2}
                onChange={(e) =>
                  edit(task.id, { dependencyNotes: e.target.value })
                }
              />
            </label>
            <div className="delivery-fields-row">
              <label className="field">
                Status
                <select
                  aria-label={`Status for work package ${index + 1}`}
                  value={task.status}
                  onChange={(e) =>
                    edit(task.id, {
                      status: e.target.value as WorkPackage["status"],
                    })
                  }
                >
                  {["planned", "doing", "blocked", "complete"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Owner (text)
                <input
                  value={task.owner}
                  maxLength={255}
                  onChange={(e) => edit(task.id, { owner: e.target.value })}
                />
              </label>
              <label className="field">
                Due date
                <input
                  type="date"
                  value={task.dueDate}
                  onChange={(e) => edit(task.id, { dueDate: e.target.value })}
                />
              </label>
            </div>
            <button
              className="button quiet"
              onClick={() =>
                setWorking((p) =>
                  p
                    ? {
                        ...p,
                        reviewStatus: "draft",
                        tasks: p.tasks
                          .filter((t) => t.id !== task.id)
                          .map((t) => ({
                            ...t,
                            dependencyIds: t.dependencyIds.filter(
                              (id) => id !== task.id,
                            ),
                          })),
                      }
                    : p,
                )
              }
            >
              Remove work package
            </button>
          </details>
        ))}
        <button
          className="button quiet"
          onClick={() =>
            setWorking((p) =>
              p
                ? {
                    ...p,
                    reviewStatus: "draft",
                    tasks: [...p.tasks, newWorkPackage()],
                  }
                : p,
            )
          }
        >
          Add work package
        </button>
        <label className="field">
          Plan review
          <select
            aria-label="Plan review"
            value={working.reviewStatus}
            onChange={(e) =>
              setWorking({
                ...working,
                reviewStatus: e.target.value as DeliveryPlan["reviewStatus"],
              })
            }
          >
            <option value="draft">Draft — review pending</option>
            <option value="reviewed">Reviewed by researcher</option>
          </select>
        </label>
        <p className="subtle-note">
          These work packages are used for PMIS exports and appended to report
          exports. They retain the report’s research gap. Account assignments
          and native scheduling links are configured in the destination system.
        </p>
      </div>
      <div className="modal-actions">
        <button className="button quiet" onClick={() => void close()}>
          Close — keep draft
        </button>
        <button className="button quiet" onClick={() => void discard()}>
          Discard draft
        </button>
        <button
          className="button primary"
          disabled={draft.loading || draft.conflict || busy}
          onClick={() => void save()}
        >
          Save work packages
        </button>
      </div>
    </Modal>
  );
}
