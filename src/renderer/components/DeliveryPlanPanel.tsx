import { useEffect, useState } from "react";
import type { ResearchOutput } from "../../shared/types";
import {
  draftDeliveryPlan,
  newWorkPackage,
  validateDeliveryPlan,
  type DeliveryPlan,
  type WorkPackage,
} from "../../shared/pmis";
import { Modal } from "./Dialogs";
import "./DeliveryPlanPanel.css";

export function DeliveryPlanPanel({
  output,
  readOnly,
  onChange,
  onError,
}: {
  output: ResearchOutput;
  readOnly: boolean;
  onChange: (output: ResearchOutput) => void;
  onError: (error: unknown) => void;
}) {
  const [open, setOpen] = useState(false),
    [preview, setPreview] = useState(false);
  const [working, setWorking] = useState<DeliveryPlan | undefined>(
    output.deliveryPlan,
  );
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setWorking(output.deliveryPlan);
    setNotice("");
  }, [output.id, output.deliveryPlan]);
  if (output.kind !== "project-plan" && !output.deliveryPlan) return null;
  const edit = (id: string, patch: Partial<WorkPackage>) =>
    setWorking((p) =>
      p
        ? {
            ...p,
            reviewStatus: "draft",
            tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
          }
        : p,
    );
  const prepare = () => {
    try {
      setWorking(output.deliveryPlan || draftDeliveryPlan(output));
      setOpen(true);
      setNotice("");
    } catch (error) {
      onError(error);
    }
  };
  const save = () => {
    if (!working) return;
    try {
      const plan = validateDeliveryPlan({
        ...working,
        updatedAt: new Date().toISOString(),
      });
      onChange({ ...output, deliveryPlan: plan });
      setNotice(
        "Work packages saved. Save a report revision to freeze this plan.",
      );
      setOpen(false);
    } catch (error) {
      onError(error);
    }
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
      {open && working && (
        <Modal
          title="Delivery work packages"
          subtitle="Review the work that will be handed to your project management system."
          wide
          onClose={() => setOpen(false)}
        >
          <div className="delivery-packages-editor">
            {!working.tasks.length && (
              <p>
                No work-breakdown table was found. Add work packages manually;
                no tasks have been inferred from unrelated report text.
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
                    onChange={(e) =>
                      edit(task.id, { description: e.target.value })
                    }
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
                      onChange={(e) =>
                        edit(task.id, { dueDate: e.target.value })
                      }
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
                    reviewStatus: e.target
                      .value as DeliveryPlan["reviewStatus"],
                  })
                }
              >
                <option value="draft">Draft — review pending</option>
                <option value="reviewed">Reviewed by researcher</option>
              </select>
            </label>
            <p className="subtle-note">
              These work packages are used for PMIS exports and appended to
              report exports. They retain the report’s research gap. Account
              assignments and native scheduling links are configured in the
              destination system.
            </p>
          </div>
          <div className="modal-actions">
            <button className="button quiet" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="button primary" onClick={save}>
              Save work packages
            </button>
          </div>
        </Modal>
      )}
      {preview && (
        <Modal
          title="PMIS handoff"
          subtitle="Export local import files for Monday, Jira, Planner, or another PMIS."
          onClose={() => setPreview(false)}
        >
          <p>
            {output.deliveryPlan?.tasks.length || 0} work packages ·{" "}
            {output.deliveryPlan?.reviewStatus || "draft"}. The ZIP includes a
            source report and stable task/dependency identifiers.
          </p>
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
            services.
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
