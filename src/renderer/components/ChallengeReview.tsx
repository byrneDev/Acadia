import { useEffect, useState } from "react";
import type { Project } from "../../shared/types";
import type { ResearchState } from "../../shared/research";
import { createReviewIssue, type ReviewIssue } from "../../shared/pedigree";
import type {
  ChallengeProposal,
  ChallengeTarget,
} from "../../shared/pedigree-analysis";
import { usePedigree } from "./pedigree-state";
import {
  FormActions,
  PassagePicker,
  SelectField,
  TextField,
  usePedigreeDraft,
} from "./pedigree-ui";

const jobs = new Map<string, string>();
export function ChallengeReview({
  project,
  research,
  target,
  onError,
  onSource,
  onApplyChange,
}: {
  project: Project;
  research: ResearchState;
  target: ChallengeTarget;
  onError: (error: unknown) => void;
  onSource?: (sourceId: string, versionId?: string, passageId?: string) => void;
  onApplyChange?: (
    change: NonNullable<ChallengeProposal["suggestedChanges"]>[number],
    proposal: ChallengeProposal,
  ) => void;
}) {
  const key = `${project.id}:${target.kind}:${target.id}`;
  const [jobId, setJobId] = useState(jobs.get(key));
  const [busy, setBusy] = useState(false);
  const [recorded, setRecorded] = useState<string[]>([]);
  useEffect(() => {
    setJobId(jobs.get(key));
    setRecorded([]);
  }, [key]);
  const { state, error } = usePedigree(project.id);
  useEffect(() => {
    if (error) onError(error);
  }, [error]);
  const recovered = [...research.jobs].reverse().find((entry) => {
    if (entry.kind !== "challenge" || entry.status !== "completed")
      return false;
    const result = entry.result as ChallengeProposal | undefined;
    return (
      result?.target?.kind === target.kind && result.target.id === target.id
    );
  });
  const job =
    research.jobs.find(
      (entry) => entry.id === jobId && jobs.get(key) === jobId,
    ) || recovered;
  const proposal =
    job?.status === "completed"
      ? (job.result as ChallengeProposal | undefined)
      : undefined;
  const running =
    busy || Boolean(job && ["queued", "running"].includes(job.status));
  const configured = Boolean(
    project.privacy?.provider && project.privacy.provider !== "offline",
  );
  const issues =
    state?.issues.filter(
      (issue) =>
        issue.target.kind === target.kind && issue.target.id === target.id,
    ) || [];
  async function challenge() {
    setBusy(true);
    try {
      const job = await window.acadia!.challengeAnalysis(target);
      jobs.set(key, job.id);
      setJobId(job.id);
      setRecorded([]);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="pedigree-section">
      <summary>Challenge and review</summary>
      <p>
        Examine unsupported conclusions, competing explanations, dependencies,
        and missing tests. Proposed issues require your review.
      </p>
      <button
        type="button"
        className="button quiet"
        disabled={running || !configured}
        onClick={() => void challenge()}
      >
        {running ? "Preparing challenge…" : "Challenge analysis with AI"}
      </button>
      {!configured && (
        <p className="pedigree-inline-note">
          Manual review is available below. Configure the project’s analysis
          model to request AI proposals.
        </p>
      )}
      {job && (
        <p role="status" className="pedigree-inline-note">
          {job.message}
        </p>
      )}
      {proposal && (
        <section className="pedigree-section" aria-label="Challenge proposal">
          <h3>Proposed review</h3>
          <p>{proposal.summary}</p>
          {proposal.issues.map((issue) => (
            <article className="pedigree-record" key={issue.id}>
              <strong>{issue.summary}</strong>
              <p>{issue.detail}</p>
              <small>{issue.category.replaceAll("-", " ")}</small>
              <div className="small-actions">
                {issue.passageIds.map((id) => {
                  const c = proposal.citations.find((c) => c.passageId === id);
                  return (
                    c && (
                      <button
                        type="button"
                        key={id}
                        onClick={() =>
                          onSource?.(c.sourceId, c.versionId, c.passageId)
                        }
                      >
                        {c.sourceTitle} · {c.locator}
                      </button>
                    )
                  );
                })}
              </div>
              <button
                type="button"
                className="button quiet"
                disabled={
                  recorded.includes(issue.id) ||
                  issues.some(
                    (saved) =>
                      saved.runId === proposal.runId &&
                      saved.summary === issue.summary,
                  ) ||
                  busy
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    await window.acadia!.saveReviewIssue({
                      ...createReviewIssue(project.id, target),
                      ...issue,
                      id: crypto.randomUUID(),
                      target,
                      origin: "ai",
                      runId: proposal.runId,
                      status: "open",
                      rationale: "",
                      taskIds: [],
                    });
                    setRecorded((ids) => [...ids, issue.id]);
                  } catch (error) {
                    onError(error);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {recorded.includes(issue.id) ||
                issues.some(
                  (saved) =>
                    saved.runId === proposal.runId &&
                    saved.summary === issue.summary,
                )
                  ? "Issue recorded"
                  : "Record issue for review"}
              </button>
            </article>
          ))}
          {proposal.suggestedChanges?.map((change, index) => (
            <article key={index} className="pedigree-record">
              <strong>Suggested wording</strong>
              <p>Existing: {change.original}</p>
              <p>Proposed: {change.proposed}</p>
              <p>{change.rationale}</p>
              {onApplyChange && (
                <button
                  type="button"
                  className="button quiet"
                  onClick={() => onApplyChange(change, proposal)}
                >
                  Apply this wording
                </button>
              )}
            </article>
          ))}
          {proposal.limitations.length > 0 && (
            <p>{proposal.limitations.join(" ")}</p>
          )}
        </section>
      )}
      <div className="pedigree-record-list">
        {issues.map((issue) => (
          <IssueForm
            key={issue.id}
            project={project}
            research={research}
            initial={issue}
            onError={onError}
            onSource={onSource}
          />
        ))}
      </div>
      <details className="pedigree-section">
        <summary>Add a manual review issue</summary>
        <IssueForm
          key={`new:${key}`}
          project={project}
          research={research}
          target={target}
          onError={onError}
          onSource={onSource}
        />
      </details>
    </details>
  );
}

function IssueForm({
  project,
  research,
  initial,
  target,
  onError,
  onSource,
}: {
  project: Project;
  research: ResearchState;
  initial?: ReviewIssue;
  target?: ChallengeTarget;
  onError: (error: unknown) => void;
  onSource?: (sourceId: string, versionId?: string, passageId?: string) => void;
}) {
  const [empty] = useState(() =>
    createReviewIssue(project.id, target || initial!.target),
  );
  const draft = usePedigreeDraft(
    `issue:${project.id}:${initial?.id || `${target?.kind}:${target?.id}:new`}`,
    initial || empty,
  );
  const { value, edit } = draft;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <form
      className="pedigree-form pedigree-record"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setNotice("");
        try {
          await draft.persist(
            (value) => window.acadia!.saveReviewIssue(value),
            initial ? undefined : createReviewIssue(project.id, empty.target),
          );
          setNotice("Review issue saved.");
        } catch (error) {
          onError(error);
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField
        label="Review issue"
        required
        value={value.summary}
        onChange={(summary) => edit({ ...value, summary })}
        rows={1}
      />
      <TextField
        label="Issue details"
        value={value.detail}
        onChange={(detail) => edit({ ...value, detail })}
      />
      <SelectField
        label="Issue disposition"
        value={value.status}
        options={["open", "acknowledged", "resolved", "dismissed"]}
        onChange={(status) => edit({ ...value, status })}
      />
      <TextField
        label="Disposition reasoning"
        value={value.rationale}
        required={value.status === "resolved" || value.status === "dismissed"}
        onChange={(rationale) => edit({ ...value, rationale })}
      />
      <PassagePicker
        research={research}
        selected={value.passageIds}
        onChange={(passageIds) => edit({ ...value, passageIds })}
        onSource={onSource}
        onError={onError}
        label="Review evidence"
      />
      <FormActions
        busy={busy}
        dirty={draft.dirty}
        draft={draft}
        notice={notice}
        label="Save review issue"
      >
        <button
          type="button"
          className="button quiet"
          disabled={busy || !value.summary.trim()}
          onClick={async () => {
            setBusy(true);
            setNotice("");
            try {
              const saved = await window.acadia!.saveReviewIssue(value);
              await draft.saved(saved);
              const sourceIds = [
                ...new Set(
                  (
                    await Promise.all(
                      value.passageIds.map((id) =>
                        window.acadia!.getPassage(id),
                      ),
                    )
                  ).map((p) => p.sourceId),
                ),
              ];
              const taskId = crypto.randomUUID();
              await window.acadia!.saveTask({
                id: taskId,
                projectId: project.id,
                title: value.summary.slice(0, 200),
                question: project.question,
                claimId:
                  value.claimIds[0] ||
                  (value.target.kind === "finding"
                    ? value.target.id
                    : undefined),
                methodId:
                  value.target.kind === "method" ? value.target.id : undefined,
                assumptionId: value.assumptionIds[0],
                status: "planned",
                criterion: value.detail || value.summary,
                sourceIds,
                updatedAt: new Date().toISOString(),
              });
              const linked = { ...saved, taskIds: [...saved.taskIds, taskId] };
              draft.edit(linked);
              const result = await window.acadia!.saveReviewIssue(linked);
              await draft.saved(result);
              setNotice("Research task created and linked to this issue.");
            } catch (error) {
              onError(error);
            } finally {
              setBusy(false);
            }
          }}
        >
          Create linked research task
        </button>
      </FormActions>
      {value.taskIds.length > 0 && (
        <ul>
          {value.taskIds.map((id) => {
            const task = research.tasks.find((t) => t.id === id);
            return (
              <li key={id}>
                {task?.title || "Linked research task"} ·{" "}
                {task?.status || "unavailable"}
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
