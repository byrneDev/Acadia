import { useEffect } from "react";
import type {
  Project,
  ProjectPlanContext,
  ResearchOutput,
} from "../../shared/types";
import type { PedigreeState } from "../../shared/pedigree";
import { DeliveryRecordFields } from "./DeliveryTraceability";
import type { ResearchState } from "../../shared/research";

export function createPlanContext(output: ResearchOutput): ProjectPlanContext {
  return {
    analysisOutputId: output.id,
    deliverableType: "software",
    gap: "",
    deliverable: "",
    acceptanceCriteria: "",
  };
}
export function DeliverablePlanFields({
  project,
  research,
  pedigree,
  selectedOutput,
  value,
  onChange,
}: {
  project: Project;
  research?: ResearchState | null;
  pedigree?: PedigreeState | null;
  selectedOutput?: ResearchOutput;
  value?: ProjectPlanContext;
  onChange: (value: ProjectPlanContext) => void;
}) {
  const analyses = project.outputs.filter((o) => o.kind !== "project-plan");
  const selected = analyses.find((o) => o.id === value?.analysisOutputId);
  useEffect(() => {
    if (!value && analyses.length)
      onChange(
        createPlanContext(
          analyses.find((o) => o.id === selectedOutput?.id) || analyses[0],
        ),
      );
  }, [value, selectedOutput?.id, project.id]);
  if (!value || !analyses.length)
    return (
      <p className="subtle-note">
        Create an analysis first, then select the evidence gap and deliverable
        it could support.
      </p>
    );
  const update = (patch: Partial<ProjectPlanContext>) =>
    onChange({ ...value, ...patch });
  return (
    <fieldset className="delivery-plan-fields">
      <legend>Bridge an analysis gap to a deliverable</legend>
      <p className="subtle-note">
        The plan will propose work and decision gates. Review whether the
        proposed solution addresses the evidence gap before approving delivery.
      </p>
      <label className="field">
        Based on analysis
        <select
          value={value.analysisOutputId}
          onChange={(e) =>
            update({
              analysisOutputId: e.target.value,
              analysisRevisionId: undefined,
            })
          }
        >
          {analyses.map((o) => (
            <option key={o.id} value={o.id}>
              {o.title}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Analysis version
        <select
          value={value.analysisRevisionId || ""}
          onChange={(e) =>
            update({ analysisRevisionId: e.target.value || undefined })
          }
        >
          <option value="">Current draft snapshot</option>
          {selected?.revisions?.map((r, i) => (
            <option key={r.id} value={r.id}>
              Revision {i + 1} —{" "}
              {r.note || new Date(r.createdAt).toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Deliverable type
        <select
          aria-label="Deliverable type"
          value={value.deliverableType}
          onChange={(e) =>
            update({
              deliverableType: e.target
                .value as ProjectPlanContext["deliverableType"],
            })
          }
        >
          <option value="software">Software</option>
          <option value="curriculum">Curriculum</option>
          <option value="other">Other deliverable</option>
        </select>
      </label>
      <label className="field">
        Linked finding or gap (optional)
        <select
          value={value.gapClaimId || ""}
          onChange={(e) => {
            const claim = research?.claims.find((c) => c.id === e.target.value);
            update({
              gapClaimId: e.target.value || undefined,
              ...(claim && !value.gap
                ? {
                    gap: [claim.title, claim.limitations]
                      .filter(Boolean)
                      .join(" — "),
                  }
                : {}),
            });
          }}
        >
          <option value="">Describe a gap below</option>
          {research?.claims.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      <DeliveryRecordFields
        pedigree={pedigree}
        research={research}
        value={value}
        onChange={update}
      />
      <label className="field">
        Gap to bridge
        <textarea
          rows={3}
          maxLength={8000}
          value={value.gap}
          onChange={(e) => update({ gap: e.target.value })}
          placeholder="What current condition or unmet need did the analysis establish?"
        />
      </label>
      <label className="field">
        Proposed deliverable
        <textarea
          rows={2}
          maxLength={8000}
          value={value.deliverable}
          onChange={(e) => update({ deliverable: e.target.value })}
          placeholder={
            value.deliverableType === "curriculum"
              ? "A curriculum for the identified performance need and learners"
              : "An application or other output that could address this gap"
          }
        />
      </label>
      <label className="field">
        Acceptance criteria
        <textarea
          rows={3}
          maxLength={8000}
          value={value.acceptanceCriteria}
          onChange={(e) => update({ acceptanceCriteria: e.target.value })}
          placeholder="What observable result would demonstrate that this deliverable bridges the gap?"
        />
      </label>
      <p className="subtle-note">
        After drafting, review the editable work packages and export a Monday,
        Jira, Planner, or generic PMIS handoff.
      </p>
    </fieldset>
  );
}
