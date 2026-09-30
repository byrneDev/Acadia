import { Modal } from "./Dialogs";
import type { ResearchView } from "./ResearchWorkspace";
export function ResearchGuide({
  onClose,
  onNavigate,
  onSample,
  onMaintenance,
  busy,
  error,
}: {
  onClose: () => void;
  onNavigate: (view: ResearchView | "releaser") => void;
  onSample: (kind: "software" | "curriculum") => void;
  onMaintenance: () => void;
  busy: boolean;
  error?: string;
}) {
  const steps: {
    title: string;
    text: string;
    view: ResearchView | "releaser";
  }[] = [
    {
      title: "1. Frame the investigation",
      text: "Record the question, decision, scope and success criteria. Leave unassessed fields explicit.",
      view: "brief",
    },
    {
      title: "2. Collect and verify sources",
      text: "Import documents or capture websites. Check extraction coverage, compare OCR with the original, and preserve dated versions.",
      view: "sources",
    },
    {
      title: "3. Review evidence",
      text: "Link exact passages as support, contradiction or context. AI item advice becomes Reviewer Notes only after your explicit review and acceptance.",
      view: "evidence",
    },
    {
      title: "4. Examine explanations",
      text: "Use a manual method, record assumptions and test competing explanations. Challenge analysis is optional and never marks a method reviewed.",
      view: "methods",
    },
    {
      title: "5. Investigate gaps and decide",
      text: "Define the missing observation and completion criteria, link a research task, then record a proposed decision. Only you resolve gaps or make decisions.",
      view: "flow",
    },
    {
      title: "6. Write and release findings",
      text: "Create a report, add exact passage citations, edit limitations, and save revisions. The audience display changes only when you explicitly release a revision.",
      view: "releaser",
    },
    {
      title: "7. Bridge the gap to delivery",
      text: "From an analysis, create a software, curriculum or other deliverable plan. Review work packages and export local PMIS handoff files; no remote tenant is changed automatically.",
      view: "releaser",
    },
  ];
  return (
    <Modal
      title="From fragments to understanding"
      subtitle="Question → Sources → Reviewed Evidence → Findings → Gaps → Tasks → Deliverables"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        Start anywhere and keep the canvas freely arranged. The steps provide
        guidance; they do not certify that a conclusion is supported. Every
        method works without AI.
      </p>
      {error && <p role="alert">{error}</p>}
      <ol className="research-guide-steps">
        {steps.map((step) => (
          <li key={step.title}>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
            <button
              className="button quiet"
              disabled={busy}
              onClick={() => onNavigate(step.view)}
            >
              Open{" "}
              {step.view === "flow"
                ? "Gaps & decisions"
                : step.view === "brief"
                  ? "Research brief"
                  : step.view}
            </button>
          </li>
        ))}
      </ol>
      <section className="research-guide-samples">
        <h3>Try a fictional investigation</h3>
        <p>
          Each choice creates a separate practice project with conflicting
          observations, an unreviewed finding, an open gap, a task, a proposed
          decision and draft reports. Your current investigation stays in the
          project library. No model, cloud service or external search is used.
        </p>
        <div className="modal-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => onSample("software")}
          >
            Create software practice investigation
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => onSample("curriculum")}
          >
            Create curriculum practice investigation
          </button>
        </div>
        {busy && (
          <p role="status">Preparing the separate practice investigation…</p>
        )}
      </section>
      <p>
        Use Cmd/Ctrl+K for commands and Cmd/Ctrl+F to search. On the board, F
        fits the view, C connects a selected item, and arrow keys move a focused
        selected card. Shift+F10 opens board actions. Appearance provides system
        themes and touch-sized controls.
      </p>
      <div className="modal-actions">
        <button
          className="button quiet"
          disabled={busy}
          onClick={onMaintenance}
        >
          Backup, recovery and updates
        </button>
        <button className="button primary" disabled={busy} onClick={onClose}>
          Back to research
        </button>
      </div>
    </Modal>
  );
}
