import { useEffect, useState } from "react";
import { Sparkles, RefreshCw, Square, Settings2 } from "lucide-react";
import type { Project } from "../../shared/types";
import type {
  Citation,
  ResearchJob,
  ResearchState,
  ResearchClaim,
  Passage,
} from "../../shared/research";
import type { ItemInsight, ItemInsightTarget } from "../../shared/item-insight";
import type { PedigreeState } from "../../shared/pedigree";
import { boardRecordSignature } from "../../shared/board";
import { Modal } from "./Dialogs";
import { usePedigree } from "./pedigree-state";
import "./ItemInsightDialog.css";
import { ItemInsightMarkdown } from "./ItemInsightMarkdown";
import { ReviewerNotes } from "./ReviewerNotes";
import { useDurableDraft } from "./durableDrafts";
import { DraftStatus } from "./DraftStatus";

const sameTarget = (a: ItemInsightTarget | undefined, b: ItemInsightTarget) =>
  a?.kind === b.kind && a.id === b.id && a.versionId === b.versionId;

/** Resolve the same saved record that the desktop summary service reads. */
export function itemInsightContext(
  project: Project,
  research: ResearchState,
  target: ItemInsightTarget,
  pedigree?: PedigreeState,
  passage?: Passage | null,
) {
  const card =
    target.kind === "card"
      ? project.cards.find((entry) => entry.id === target.id)
      : undefined;
  const reference = card?.boardReference;
  const linkedKind = reference?.kind || (card?.methodId ? "method" : undefined);
  const linkedId = reference?.id || card?.methodId;
  const review = ["claim", "review"].includes(linkedKind || "")
    ? research.claims.find((entry) => entry.id === linkedId)?.itemReview
    : undefined;
  const sourceId =
    target.kind === "source"
      ? target.id
      : linkedKind === "source"
        ? linkedId
        : linkedKind === "passage"
          ? passage?.sourceId
          : review?.sourceId ||
            (!linkedKind
              ? card?.sourceId ||
                research.sources.find((entry) => entry.cardId === card?.id)?.id
              : undefined);
  const source = research.sources.find((entry) => entry.id === sourceId);
  const selectedVersion =
    target.versionId ||
    reference?.versionId ||
    review?.versionId ||
    source?.currentVersionId;
  const version = research.versions.find(
    (entry) => entry.id === selectedVersion,
  );
  const method =
    linkedKind === "method"
      ? pedigree?.methods.find((entry) => entry.id === linkedId)
      : undefined;
  const record =
    linkedKind === "source"
      ? source
      : linkedKind === "passage"
        ? passage
        : linkedKind === "claim" || linkedKind === "review"
          ? research.claims.find((entry) => entry.id === linkedId)
          : linkedKind === "task"
            ? research.tasks.find((entry) => entry.id === linkedId)
            : linkedKind === "brief"
              ? pedigree?.briefs.find((entry) => entry.id === linkedId)
              : linkedKind === "assumption"
                ? pedigree?.assumptions.find((entry) => entry.id === linkedId)
                : linkedKind === "gap"
                  ? pedigree?.gaps.find((entry) => entry.id === linkedId)
                  : linkedKind === "decision"
                    ? pedigree?.decisions.find((entry) => entry.id === linkedId)
                    : linkedKind === "method"
                      ? method
                      : linkedKind === "report" ||
                          linkedKind === "delivery-plan"
                        ? project.outputs.find((entry) => entry.id === linkedId)
                        : undefined;
  const loading = Boolean(
    (linkedKind === "passage" && passage === undefined) ||
    (["brief", "assumption", "gap", "decision", "method"].includes(
      linkedKind || "",
    ) &&
      !pedigree),
  );
  const unavailable =
    !loading &&
    Boolean(
      (target.kind === "card" && !card) ||
      (target.kind === "source" && (!source || !version)) ||
      (linkedKind && !record) ||
      (linkedKind === "source" && !version) ||
      (linkedKind === "passage" &&
        (!source || !version || passage?.versionId !== selectedVersion)) ||
      (linkedKind === "review" && !review),
    );
  const title =
    linkedKind === "passage" && passage && version
      ? `${version.title} · ${passage.locator}`
      : linkedKind === "source" || target.kind === "source"
        ? version?.title || source?.title
        : record && "title" in record
          ? record.title
          : record && "statement" in record
            ? record.statement
            : record && "question" in record
              ? record.question
              : card?.title;
  return {
    card,
    reference,
    source,
    selectedVersion,
    version,
    method,
    record,
    loading,
    unavailable,
    title: title || "Collected item",
    excluded:
      source?.inclusion === "exclude" ||
      (linkedKind === "passage" && passage?.inclusion === "exclude"),
    passageExcluded:
      linkedKind === "passage" && passage?.inclusion === "exclude",
    historical: Boolean(
      source && selectedVersion && source.currentVersionId !== selectedVersion,
    ),
  };
}

export function itemInsightIsStale(
  insight: ItemInsight,
  context: ReturnType<typeof itemInsightContext>,
  question: string,
  pedigree?: PedigreeState,
): boolean {
  const { card, selectedVersion, version, method, reference, record } = context;
  return Boolean(
    context.unavailable ||
    insight.question.trim() !== question.trim() ||
    (insight.briefRevision !== undefined &&
      pedigree &&
      insight.briefRevision !== (pedigree.briefs[0]?.revision ?? 0)) ||
    (insight.cardUpdatedAt && card?.updatedAt !== insight.cardUpdatedAt) ||
    (insight.versionId &&
      selectedVersion &&
      insight.versionId !== selectedVersion) ||
    (insight.versionId === version?.id &&
      version &&
      (insight.coverage.processedUnits !== version.processedUnits ||
        insight.coverage.status !== version.status)) ||
    (insight.methodRevision !== undefined &&
      method &&
      method.revision !== insight.methodRevision) ||
    (reference &&
      record &&
      (!insight.boardRecordSignature ||
        insight.boardRecordSignature !== boardRecordSignature(record))),
  );
}

function ItemReviewForm({
  projectId,
  insight,
  acceptedClaim,
  beforeRun,
  onCitation,
  onEvidence,
}: {
  projectId: string;
  insight: ItemInsight;
  acceptedClaim?: ResearchClaim;
  beforeRun: () => Promise<void>;
  onCitation: (citation: Citation) => void;
  onEvidence?: (id: string) => void;
}) {
  const draft = useDurableDraft({
    projectId,
    key: `item-review:${insight.runId}`,
    kind: "item-review",
    targetId: insight.runId,
    initial: insight.markdown,
    baseSignature: insight.runId,
  });
  const notes = draft.value;
  const [reviewed, setReviewed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedClaim, setSavedClaim] = useState<ResearchClaim>();
  const accepted = acceptedClaim || savedClaim;
  const available = typeof window.acadia?.acceptItemInsight === "function";
  if (accepted)
    return (
      <>
        <p role="status" className="item-review-accepted">
          Accepted into Reviewer Notes and saved as evidence.
        </p>
        <ReviewerNotes
          claims={[accepted]}
          onCitation={onCitation}
          onEvidence={onEvidence}
        />
      </>
    );
  return (
    <form
      className="item-review-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (!reviewed || saving || !notes.trim() || !available) return;
        setSaving(true);
        setError("");
        try {
          await beforeRun();
          await draft.persist(async (notes) => {
            const claim = await window.acadia!.acceptItemInsight({
              runId: insight.runId,
              notes,
            });
            setSavedClaim(claim);
            return notes;
          });
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "The reviewed notes could not be saved.",
          );
        } finally {
          setSaving(false);
        }
      }}
    >
      <h3>Review and accept</h3>
      <DraftStatus draft={draft} />
      <p>
        Edit the proposed text for your investigation. Acceptance saves a dated
        Reviewer Notes entry and a linked evidence record. Your original item
        notes are preserved.
      </p>
      <label className="field">
        Reviewer Notes
        <textarea
          rows={12}
          maxLength={30000}
          required
          value={notes}
          disabled={saving || draft.loading}
          onChange={(event) => {
            draft.edit(event.target.value);
            setReviewed(false);
          }}
        />
      </label>
      <p className="subtle-note">
        Keep numbered references for statements drawn from the source.
        Acceptance records your interpretation; supporting or conflicting
        evidence is assessed separately.
      </p>
      <label className="item-review-confirm">
        <input
          type="checkbox"
          checked={reviewed}
          disabled={saving}
          onChange={(event) => setReviewed(event.target.checked)}
        />
        I have reviewed these notes and their source references
      </label>
      {!available && (
        <p role="status" className="item-insight-notice">
          Restart Acadia to load the Reviewer Notes service.
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="button primary"
        disabled={
          saving ||
          draft.loading ||
          draft.conflict ||
          !reviewed ||
          !notes.trim() ||
          !available
        }
      >
        {saving ? "Saving reviewed notes…" : "Accept into Reviewer Notes"}
      </button>
    </form>
  );
}

export function ItemInsightDialog({
  project,
  research,
  target,
  beforeRun,
  onClose,
  onCitation,
  onSettings,
  onEvidence,
}: {
  project: Project;
  research: ResearchState;
  target: ItemInsightTarget;
  beforeRun: () => Promise<void>;
  onClose: () => void;
  onCitation: (citation: Citation) => void;
  onSettings: () => void;
  onEvidence?: (id: string) => void;
}) {
  const [starting, setStarting] = useState(false);
  const [pendingJob, setPendingJob] = useState<ResearchJob>();
  const [selectedRunId, setSelectedRunId] = useState<string>();
  const [error, setError] = useState("");
  const { state: pedigree } = usePedigree(project.id);
  const passageRef =
    target.kind === "card"
      ? project.cards.find((entry) => entry.id === target.id)?.boardReference
      : undefined;
  const passageId = passageRef?.kind === "passage" ? passageRef.id : undefined;
  const [passageResult, setPassageResult] = useState<{
    projectId: string;
    id: string;
    value: Passage | null;
  }>();
  useEffect(() => {
    let alive = true;
    if (!passageId) return;
    setPassageResult(undefined);
    window
      .acadia!.getPassage(passageId)
      .then((value) => {
        if (alive)
          setPassageResult({ projectId: project.id, id: passageId, value });
      })
      .catch(() => {
        if (alive)
          setPassageResult({
            projectId: project.id,
            id: passageId,
            value: null,
          });
      });
    return () => {
      alive = false;
    };
  }, [project.id, passageId, research.versions, research.sources]);
  const passage =
    passageResult?.projectId === project.id && passageResult?.id === passageId
      ? passageResult.value
      : undefined;
  const context = itemInsightContext(
    project,
    research,
    target,
    pedigree,
    passage,
  );
  const {
    title,
    source,
    version,
    historical,
    loading,
    unavailable,
    excluded,
    passageExcluded,
  } = context;
  const question =
    pedigree?.briefs[0]?.question.trim() || project.question.trim();
  const saved = research.runs
    .filter(
      (run) =>
        run.status === "completed" &&
        run.itemInsight &&
        sameTarget(run.itemInsight.target, target),
    )
    .map((run) => run.itemInsight!)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const insight =
    saved.find((entry) => entry.runId === selectedRunId) || saved[0];
  const matchingJobs = research.jobs.filter(
    (job) => job.kind === "item-summary" && sameTarget(job.itemTarget, target),
  );
  const currentJob = matchingJobs.sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  )[0];
  const job = pendingJob
    ? research.jobs.find((entry) => entry.id === pendingJob.id) || pendingJob
    : currentJob;
  const running =
    starting || Boolean(job && ["queued", "running"].includes(job.status));
  const configured = Boolean(
    project.privacy?.provider && project.privacy.provider !== "offline",
  );
  const available = typeof window.acadia?.summarizeItem === "function";
  const stale =
    insight && itemInsightIsStale(insight, context, question, pedigree);
  async function summarize() {
    if (running || loading || unavailable || excluded) return;
    setStarting(true);
    setError("");
    try {
      await beforeRun();
      const created = await window.acadia!.summarizeItem(target);
      setPendingJob(created);
      setSelectedRunId(undefined);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The item could not be summarized. Try again.",
      );
    } finally {
      setStarting(false);
    }
  }
  return (
    <Modal
      title="AI summary & research advice"
      subtitle={title}
      wide
      onClose={onClose}
    >
      <div className="item-insight-context">
        <span>Research question</span>
        <p>
          {question ||
            "No question yet. The AI can summarize this item and suggest exploratory uses; add a Research brief for more specific advice."}
        </p>
        <small>
          {project.privacy?.mode === "cloud"
            ? "Selected server/cloud model"
            : "Local analysis"}{" "}
          · {project.privacy?.model || "No AI model selected"}
        </small>
      </div>
      <p className="item-insight-intro">
        Summarize the available content, explain its possible role in this
        investigation, and suggest limitations and next steps. Review and edit
        the proposal before accepting it into Reviewer Notes and Evidence.
      </p>
      {!configured && (
        <div className="item-insight-notice">
          <p>
            Select an AI model for this project to create a summary. Saved
            summaries remain available.
          </p>
          <button className="button quiet" onClick={onSettings}>
            <Settings2 size={16} />
            AI settings
          </button>
        </div>
      )}
      {!available && (
        <p className="item-insight-notice" role="status">
          Restart Acadia to load the updated AI summary service. Your research
          will be saved normally.
        </p>
      )}
      {loading && (
        <p className="item-insight-notice" role="status">
          Loading the linked research record…
        </p>
      )}
      {unavailable && (
        <p className="item-insight-notice" role="status">
          This linked research record is unavailable. Saved summaries and
          historical references remain available below.
        </p>
      )}
      {passageExcluded && (
        <p className="item-insight-notice">
          This passage is excluded from AI analysis. Include the passage in its
          source reader before summarizing it.
        </p>
      )}
      {source?.inclusion === "exclude" && (
        <p className="item-insight-notice">
          This source is excluded from AI analysis. Change its source-use
          setting if you want to summarize it.
        </p>
      )}
      {historical && (
        <p className="item-insight-notice">
          A newer source version is available. This item and its summary use the
          selected historical source version.
        </p>
      )}
      {version && version.status !== "ready" && (
        <p className="item-insight-notice">
          Source extraction is {version.status} ({version.processedUnits}/
          {version.totalUnits} units). Any available notes or passages will be
          labeled as partial coverage.
        </p>
      )}
      <div className="item-insight-actions">
        <button
          className="button primary"
          disabled={
            running ||
            !configured ||
            !available ||
            loading ||
            unavailable ||
            excluded
          }
          onClick={() => void summarize()}
        >
          {insight ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {running
            ? "Summarizing…"
            : insight
              ? "Regenerate summary"
              : "Summarize & advise"}
        </button>
        {running && job && (
          <button
            className="button quiet"
            onClick={() =>
              window
                .acadia!.cancelJob(job.id)
                .catch((error) =>
                  setError(
                    error instanceof Error ? error.message : String(error),
                  ),
                )
            }
          >
            <Square size={14} />
            Cancel summary
          </button>
        )}
      </div>
      {running && (
        <div className="item-insight-progress" role="status">
          <progress max={100} value={job?.progress || 0} />
          <p>{job?.message || "Saving the current item…"}</p>
          <small>
            You can close this dialog while the summary runs. The result is
            saved with this investigation.
          </small>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!running && job && ["failed", "cancelled"].includes(job.status) && (
        <p className="item-insight-notice" role="status">
          {job.message}
          {insight
            ? " Your previous summary is preserved below."
            : " Your item and notes are unchanged."}
        </p>
      )}
      {insight && (
        <section className="item-insight-result" aria-label="Item AI summary">
          <div className="item-insight-result-heading">
            <h3>Saved AI summary</h3>
            <span>For researcher review</span>
          </div>
          {saved.length > 1 && (
            <label className="field">
              Saved item summaries
              <select
                aria-label="Saved item summaries"
                value={insight.runId}
                onChange={(event) => setSelectedRunId(event.target.value)}
              >
                {saved.map((entry) => (
                  <option key={entry.runId} value={entry.runId}>
                    {new Date(entry.createdAt).toLocaleString()} · {entry.model}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="item-insight-meta">
            {new Date(insight.createdAt).toLocaleString()} · {insight.model} ·{" "}
            {insight.coverage.selectedPassages}/
            {insight.coverage.availablePassages} passages used
          </p>
          {stale && (
            <p className="item-insight-notice" role="status">
              The item, research question, or source version has changed since
              this summary. Review it or regenerate before relying on it.
            </p>
          )}
          {insight.coverage.warnings.length > 0 && (
            <details className="item-insight-coverage" open>
              <summary>Content coverage and limitations</summary>
              <ul>
                {insight.coverage.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <ItemInsightMarkdown
            markdown={insight.markdown}
            citations={insight.citations}
            onCitation={onCitation}
          />
          {insight.citations.length > 0 && (
            <details className="item-insight-citations">
              <summary>Source passages ({insight.citations.length})</summary>
              {insight.citations.map((citation) => (
                <button
                  className="item-insight-source"
                  key={citation.id}
                  onClick={() => onCitation(citation)}
                >
                  <strong>
                    [{citation.label}] {citation.sourceTitle}
                  </strong>
                  <span>
                    {citation.locator} · saved{" "}
                    {new Date(citation.acquiredAt).toLocaleDateString()}
                  </span>
                  <q>{citation.quote}</q>
                </button>
              ))}
            </details>
          )}
          <ItemReviewForm
            key={insight.runId}
            projectId={project.id}
            insight={insight}
            acceptedClaim={research.claims.find(
              (claim) => claim.itemReview?.runId === insight.runId,
            )}
            beforeRun={beforeRun}
            onCitation={onCitation}
            onEvidence={onEvidence}
          />
          <p className="item-insight-footnote">
            AI advice is a proposal. Exact references identify the saved
            passages; they do not establish source quality or prove a
            conclusion.
          </p>
        </section>
      )}
    </Modal>
  );
}
