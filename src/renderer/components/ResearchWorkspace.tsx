import { useEffect, useState } from "react";
import type { Project, ResearchCard, Connection } from "../../shared/types";
import type {
  ResearchState,
  ResearchClaim,
  ResearchTask,
  ResearchAnswer,
  DiscoveryPlan,
  ConnectionSuggestion,
  ProjectSummary,
  SearchHit,
} from "../../shared/research";
import { Modal } from "./Dialogs";
import { ReviewerNotes } from "./ReviewerNotes";
import { AddToBoardButton } from "./BoardMappingContext";
import "./ResearchWorkspace.css";
import { Policy } from "./SourceReader";
import { subscribeResearch } from "./researchSubscription";
import {
  AssumptionRegister,
  FindingAssessmentPanel,
  OriginSummary,
} from "./PedigreeWorkspace";
import {
  readResearchTextDraft,
  saveResearchTextDraft,
} from "./workspaceViewState";
export { SourceReader } from "./SourceReader";
const api = () => window.acadia!;
const now = () => new Date().toISOString();
const empty: ResearchState = {
  sources: [],
  versions: [],
  claims: [],
  tasks: [],
  jobs: [],
  discoveries: [],
  runs: [],
};
export type ResearchView =
  | "board"
  | "sources"
  | "evidence"
  | "tasks"
  | "inquiry"
  | "discovery"
  | "brief"
  | "methods"
  | "flow";
export function useResearch(projectId?: string) {
  const [research, setResearch] = useState<ResearchState>(empty);
  useEffect(() => {
    setResearch(empty);
    if (!projectId) return;
    return subscribeResearch(projectId, setResearch);
  }, [projectId]);
  return research;
}
export function Jobs({
  research,
  onError,
}: {
  research: ResearchState;
  onError: (e: unknown) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = research.jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const interrupted = research.jobs.filter(
    (j) => j.status === "failed" || j.status === "cancelled",
  );
  if (!research.jobs.length) return null;
  return (
    <div className="research-jobs">
      <button onClick={() => setExpanded(!expanded)}>
        {active.length
          ? `${active.length} background job${active.length > 1 ? "s" : ""}`
          : "Background activity"}
        {interrupted.length ? ` · ${interrupted.length} need review` : ""}{" "}
        {expanded ? "▴" : "▾"}
      </button>
      {expanded && (
        <div className="job-list">
          {[...research.jobs]
            .reverse()
            .slice(0, 12)
            .map((j) => (
              <div className="job-row" key={j.id}>
                <div>
                  <strong>{j.label}</strong>
                  <small>
                    {j.status} · {j.message}
                  </small>
                  <progress
                    max="1"
                    value={j.progress > 1 ? j.progress / 100 : j.progress}
                  />
                </div>
                {["queued", "running"].includes(j.status) && (
                  <button
                    className="button quiet"
                    onClick={() => api().cancelJob(j.id).catch(onError)}
                  >
                    Cancel
                  </button>
                )}
                {j.sourceId &&
                  ["extract", "ocr", "capture"].includes(j.kind) &&
                  ["failed", "cancelled"].includes(j.status) && (
                    <button
                      className="button quiet"
                      onClick={() =>
                        api()
                          .reprocessSource(j.sourceId!, j.kind === "ocr")
                          .catch(onError)
                      }
                    >
                      Retry
                    </button>
                  )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
export function ProjectLibrary({
  currentId,
  onSwitch,
  onClose,
  onError,
}: {
  currentId: string;
  onSwitch: (id: string) => void;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    api().listProjects().then(setProjects).catch(onError);
  }, []);
  return (
    <Modal
      title="Project library"
      subtitle="Investigations saved on this computer"
      onClose={onClose}
      wide
    >
      <div className="project-library-list">
        {projects.map((p) => (
          <button
            className="research-card"
            key={p.id}
            onClick={() => onSwitch(p.id)}
            disabled={p.id === currentId}
          >
            <span className="eyebrow">
              {p.id === currentId
                ? "CURRENT INVESTIGATION"
                : new Date(p.updatedAt).toLocaleDateString()}
            </span>
            <h3>{p.title}</h3>
            <p>{p.question || "No research question yet"}</p>
            <small>
              {p.cardCount} board items · {p.sourceCount} sources
            </small>
          </button>
        ))}
      </div>
    </Modal>
  );
}
interface Props {
  project: Project;
  research: ResearchState;
  view: ResearchView;
  onError: (e: unknown) => void;
  onSource: (source: string, version?: string, passage?: string) => void;
  onCard: (id: string) => void;
  onConnection: (connection: Connection) => void;
  requestedClaim?: { id: string; key: number };
  onClaimRequestHandled?: () => void;
  requestedTask?: { id: string; key: number };
  onTaskRequestHandled?: () => void;
  requestedAssumption?: { id: string; key: number };
  onAssumptionRequestHandled?: () => void;
}
export default function ResearchWorkspace(props: Props) {
  const { project, research, view, onError, onSource, onCard, onConnection } =
    props;
  const [textDraft] = useState(() => readResearchTextDraft(project.id));
  const [query, setQuery] = useState(textDraft?.query || "");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searched, setSearched] = useState(false);
  const [url, setUrl] = useState(textDraft?.url || "");
  const [claim, setClaim] = useState<ResearchClaim>();
  const [task, setTask] = useState<ResearchTask>();
  const [question, setQuestion] = useState(
    textDraft?.question ?? project.question,
  );
  const [answerId, setAnswerId] = useState("");
  const [plan, setPlan] = useState<DiscoveryPlan>();
  const [queries, setQueries] = useState(textDraft?.queries || "");
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [suggestId, setSuggestId] = useState("");
  const [decided, setDecided] = useState<string[]>([]);
  const [working, setWorking] = useState(false);
  const [highlightedClaim, setHighlightedClaim] = useState<string>();
  const [assessmentClaim, setAssessmentClaim] = useState<string>();
  useEffect(() => {
    saveResearchTextDraft(project.id, { query, url, question, queries });
  }, [project.id, query, url, question, queries]);
  useEffect(() => {
    const request = props.requestedClaim;
    if (view === "evidence" && request?.id === "new") {
      setClaim(newClaim());
      props.onClaimRequestHandled?.();
      return;
    }
    if (
      view !== "evidence" ||
      !request ||
      !research.claims.some((c) => c.id === request.id)
    )
      return;
    setHighlightedClaim(request.id);
    setClaim(research.claims.find((entry) => entry.id === request.id));
    const frame = requestAnimationFrame(() => {
      const row = document.getElementById(`claim-${request.id}`);
      row?.scrollIntoView({ block: "center" });
      row?.focus({ preventScroll: true });
      props.onClaimRequestHandled?.();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    view,
    props.requestedClaim?.id,
    props.requestedClaim?.key,
    research.claims,
  ]);
  useEffect(() => {
    const request = props.requestedTask;
    if (view !== "tasks" || !request) return;
    const existing = research.tasks.find((entry) => entry.id === request.id);
    if (request.id !== "new" && !existing) return;
    setTask(existing || newTask());
    props.onTaskRequestHandled?.();
  }, [view, props.requestedTask?.id, props.requestedTask?.key, research.tasks]);
  useEffect(() => {
    api().hasSearchKey().then(setHasKey).catch(onError);
  }, []);
  const action = async (fn: () => Promise<unknown>) => {
    setWorking(true);
    try {
      await fn();
    } catch (e) {
      onError(e);
    } finally {
      setWorking(false);
    }
  };
  const answer = research.jobs.find((j) => j.id === answerId);
  const result = answer?.result as ResearchAnswer | undefined;
  const suggestions = research.jobs.find((j) => j.id === suggestId)?.result as
    ConnectionSuggestion[] | undefined;
  const newClaim = (): ResearchClaim => ({
    id: crypto.randomUUID(),
    projectId: project.id,
    title: "",
    question: project.question,
    status: "unreviewed",
    alternatives: "",
    limitations: "",
    links: [],
    updatedAt: now(),
  });
  const newTask = (c?: ResearchClaim): ResearchTask => ({
    id: crypto.randomUUID(),
    projectId: project.id,
    title: c ? `Investigate: ${c.title}` : "",
    question: c?.question || project.question,
    claimId: c?.id,
    status: "planned",
    criterion: c?.limitations || "",
    sourceIds: [],
    updatedAt: now(),
  });
  async function openPassage(id: string) {
    try {
      const p = await api().getPassage(id);
      onSource(p.sourceId, p.versionId, p.id);
    } catch (e) {
      onError(e);
    }
  }
  return (
    <main className="research-workspace">
      {view === "sources" && (
        <>
          <div className="research-heading">
            <div>
              <span className="eyebrow">SOURCE LIBRARY</span>
              <h2>Read the whole collection.</h2>
              <p>Originals, versions, and precise passages stay connected.</p>
            </div>
            <span>
              {research.sources.filter((source) => !source.derived).length}{" "}
              sources
            </span>
          </div>
          <OriginSummary project={project} research={research} />
          <form
            className="research-inline"
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                setHits(await api().searchSources(query));
                setSearched(true);
              });
            }}
          >
            <input
              aria-label="Search full documents"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search full documents, including pinned passages…"
            />
            <button className="button primary" disabled={working}>
              Search collection
            </button>
            <button
              type="button"
              className="button quiet"
              onClick={() => {
                setSearched(false);
                setQuery("");
              }}
            >
              All sources
            </button>
          </form>
          <form
            className="research-inline"
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await api().captureUrl(url);
                setUrl("");
              });
            }}
          >
            <input
              type="url"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https:// — capture a public website"
              aria-label="Website URL"
            />
            <button className="button quiet" disabled={working}>
              Capture website
            </button>
          </form>
          {searched ? (
            <div className="research-list">
              {hits.map((h) => (
                <button
                  className="research-card"
                  key={h.id}
                  onClick={() => onSource(h.sourceId, h.versionId, h.id)}
                >
                  <span className="eyebrow">
                    {h.sourceTitle} · {h.locator}
                  </span>
                  <p>{h.text}</p>
                </button>
              ))}
              {!hits.length && (
                <p className="research-empty">
                  No matching included passages. Check extraction coverage and
                  exclusions.
                </p>
              )}
            </div>
          ) : (
            <div className="research-list">
              {research.sources
                .filter((s) => !s.derived)
                .map((s) => {
                  const v = research.versions.find(
                    (v) => v.id === s.currentVersionId,
                  );
                  return (
                    <div className="research-card source-summary" key={s.id}>
                      <button onClick={() => onSource(s.id)}>
                        <span className="eyebrow">
                          {s.kind} · {s.inclusion}
                        </span>
                        <h3>{s.title}</h3>
                        <p
                          className={
                            v?.status === "ready" ? "" : "warning-text"
                          }
                        >
                          {v?.status || "Pending"} · {v?.processedUnits || 0}/
                          {v?.totalUnits || 0} units ·{" "}
                          {v?.method || "awaiting extraction"}
                        </p>
                        {s.duplicateOf && (
                          <small>Duplicate — not independent support</small>
                        )}
                      </button>
                      <AddToBoardButton
                        reference={{ kind: "source", id: s.id }}
                      />
                      <Policy
                        label={`Use ${s.title}`}
                        value={s.inclusion}
                        onChange={(v) =>
                          api().setSourcePolicy(s.id, v).catch(onError)
                        }
                      />
                    </div>
                  );
                })}
              {!research.sources.some((source) => !source.derived) && (
                <p className="research-empty">
                  Import documents, capture a website, or add notes to begin.
                </p>
              )}
            </div>
          )}
        </>
      )}
      {view === "evidence" && (
        <>
          <div className="research-heading">
            <div>
              <span className="eyebrow">EVIDENCE & EXPLANATIONS</span>
              <h2>Make the reasoning visible.</h2>
              <p>
                Supporting and conflicting passages sit beside your assessment.
              </p>
            </div>
            <button
              className="button primary"
              onClick={() => setClaim(newClaim())}
            >
              New claim
            </button>
          </div>
          <div className="evidence-table-wrap">
            <table className="evidence-table">
              <thead>
                <tr>
                  <th>Claim / question</th>
                  <th>Supporting evidence</th>
                  <th>Conflicting evidence</th>
                  <th>Assessment / alternatives / gaps</th>
                </tr>
              </thead>
              <tbody>
                {research.claims.map((c) => (
                  <tr
                    key={c.id}
                    id={`claim-${c.id}`}
                    tabIndex={-1}
                    data-search-target={highlightedClaim === c.id || undefined}
                    style={
                      highlightedClaim === c.id
                        ? {
                            outline: "2px solid var(--phosphor)",
                            outlineOffset: "-2px",
                            background:
                              "var(--accent-surface, var(--panel-lift))",
                          }
                        : undefined
                    }
                  >
                    <td>
                      <button
                        className="claim-title"
                        onClick={() => setClaim(c)}
                      >
                        {c.title}
                      </button>
                      <p>{c.question}</p>
                      <span className="eyebrow">{c.status}</span>
                      {c.itemReview && (
                        <p className="subtle-note">
                          Reviewer Notes · human accepted
                        </p>
                      )}
                      <div className="small-actions">
                        <AddToBoardButton
                          reference={{
                            kind: c.itemReview ? "review" : "claim",
                            id: c.id,
                          }}
                        />
                        <button onClick={() => setAssessmentClaim(c.id)}>
                          Assess finding
                        </button>
                        {c.cardId && (
                          <button onClick={() => onCard(c.cardId!)}>
                            Reveal on board
                          </button>
                        )}
                        <button onClick={() => setTask(newTask(c))}>
                          Investigate gap
                        </button>
                      </div>
                    </td>
                    {(["supports", "contradicts"] as const).map((relation) => (
                      <td key={relation}>
                        {c.links
                          .filter((l) => l.relation === relation)
                          .map((l) => (
                            <button
                              className={`evidence-quote ${relation}`}
                              key={l.id}
                              onClick={() => openPassage(l.passageId)}
                            >
                              <q>{l.quote}</q>
                              <small>
                                {l.rationale || "Assessment not recorded"}
                              </small>
                            </button>
                          ))}
                        {!c.links.some((l) => l.relation === relation) && (
                          <span className="muted">No passages linked</span>
                        )}
                      </td>
                    ))}
                    <td>
                      <p>
                        {c.alternatives ||
                          "No alternative explanation recorded."}
                      </p>
                      <p className="warning-text">
                        {c.limitations || "Limitations not assessed."}
                      </p>
                      {c.links
                        .filter((l) => l.relation === "context")
                        .map((l) => (
                          <button
                            className="text-button"
                            key={l.id}
                            onClick={() => openPassage(l.passageId)}
                          >
                            Context: {l.quote.slice(0, 85)}
                          </button>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!research.claims.length && (
            <p className="research-empty">
              Start with a claim, or select a passage in Sources and turn it
              into evidence.
            </p>
          )}
          <AssumptionRegister
            project={project}
            research={research}
            onError={onError}
            onSource={onSource}
            requestedAssumption={props.requestedAssumption}
            onAssumptionRequestHandled={props.onAssumptionRequestHandled}
          />
        </>
      )}
      {view === "tasks" && (
        <>
          <div className="research-heading">
            <div>
              <span className="eyebrow">FOLLOW-UP RESEARCH</span>
              <h2>Turn gaps into a next step.</h2>
              <p>Define completion criteria and link the evidence you find.</p>
            </div>
            <button
              className="button primary"
              onClick={() => setTask(newTask())}
            >
              New research task
            </button>
          </div>
          <div className="task-columns">
            {(["planned", "doing", "blocked", "complete"] as const).map(
              (status) => (
                <section key={status}>
                  <h3>{status.toUpperCase()}</h3>
                  {research.tasks
                    .filter((t) => t.status === status)
                    .map((t) => (
                      <article className="research-card" key={t.id}>
                        <button
                          className="claim-title"
                          onClick={() => setTask(t)}
                        >
                          <h3>{t.title}</h3>
                        </button>
                        <p>{t.question}</p>
                        <small>
                          {t.criterion || "Add completion criteria"}
                        </small>
                        {t.dueDate && <span>Due {t.dueDate}</span>}
                        <span>{t.sourceIds.length} resulting sources</span>
                        <AddToBoardButton
                          reference={{ kind: "task", id: t.id }}
                        />
                      </article>
                    ))}
                </section>
              ),
            )}
          </div>
        </>
      )}
      {view === "inquiry" && (
        <>
          <div className="research-heading">
            <div>
              <span className="eyebrow">ASK THE COLLECTION</span>
              <h2>Follow the evidence.</h2>
              <p>
                Answers use included sources and distinguish gaps from findings.
              </p>
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => setAnswerId((await api().ask(question)).id));
            }}
          >
            <label className="field">
              Research question
              <textarea
                aria-label="Research question"
                rows={3}
                required
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            <button
              className="button primary"
              disabled={working || !question.trim()}
            >
              Ask with passage citations
            </button>
          </form>
          {answer && (
            <div className="answer-panel" role="status">
              <span className="eyebrow">
                {answer.status}{" "}
                {result?.insufficient ? "· INSUFFICIENT EVIDENCE" : ""}
              </span>
              <p className="answer-text">{result?.answer || answer.message}</p>
              <div className="citation-buttons">
                {result?.citations?.map((c) => (
                  <button
                    className="research-card"
                    key={c.id}
                    onClick={() =>
                      onSource(c.sourceId, c.versionId, c.passageId)
                    }
                  >
                    [{c.label}] {c.sourceTitle} · {c.locator}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="research-heading">
            <div>
              <h3>Proposed board connections</h3>
              <p>
                Review each connection before it becomes part of your board.
              </p>
            </div>
            <button
              className="button quiet"
              disabled={working}
              onClick={() =>
                action(async () => {
                  setSuggestId((await api().suggestConnections()).id);
                  setDecided([]);
                })
              }
            >
              Propose connections
            </button>
          </div>
          {Array.isArray(suggestions) &&
            suggestions
              .filter((s) => !decided.includes(s.id))
              .map((s) => (
                <div className="research-card" key={s.id}>
                  <h3>
                    {project.cards.find((c) => c.id === s.source)?.title} →{" "}
                    {project.cards.find((c) => c.id === s.target)?.title}
                  </h3>
                  <p>
                    {s.relation} · {s.rationale}
                  </p>
                  <div className="small-actions">
                    <button
                      onClick={() => {
                        onConnection({
                          id: crypto.randomUUID(),
                          source: s.source,
                          target: s.target,
                          relation: s.relation,
                        });
                        setDecided((d) => [...d, s.id]);
                      }}
                    >
                      Accept
                    </button>
                    <button onClick={() => setDecided((d) => [...d, s.id])}>
                      Reject
                    </button>
                  </div>
                </div>
              ))}
          {suggestId && !suggestions && (
            <p>{research.jobs.find((j) => j.id === suggestId)?.message}</p>
          )}
          <details className="audit-history">
            <summary>Analysis history ({research.runs.length})</summary>
            {research.runs
              .slice()
              .reverse()
              .map((r) => (
                <details key={r.id}>
                  <summary>
                    {new Date(r.createdAt).toLocaleString()} · {r.kind} ·{" "}
                    {r.provider}/{r.model}
                  </summary>
                  <p>{r.question}</p>
                  <p>
                    {r.citations.length} citations · {r.sourceVersions.length}{" "}
                    source versions · {r.exclusions.length} exclusions
                  </p>
                  <pre>
                    {JSON.stringify(
                      {
                        instructions: r.instructions,
                        queries: r.queries,
                        groundingWarnings: r.groundingWarnings,
                        sourceVersions: r.sourceVersions,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              ))}
          </details>
        </>
      )}
      {view === "discovery" && (
        <>
          <div className="research-heading">
            <div>
              <span className="eyebrow">SUPERVISED WEB DISCOVERY</span>
              <h2>Choose what enters the investigation.</h2>
              <p>
                Search approval is separate from your project’s analysis
                privacy.
              </p>
            </div>
          </div>
          <details className="search-key">
            <summary>
              Brave Search connection · {hasKey ? "configured" : "optional"}
            </summary>
            <p>
              No key? Generate query suggestions, then search manually and
              capture selected URLs in Sources.
            </p>
            <form
              className="research-inline"
              onSubmit={(e) => {
                e.preventDefault();
                action(async () => {
                  await api().saveSearchKey(key);
                  setKey("");
                  setHasKey(await api().hasSearchKey());
                });
              }}
            >
              <input
                type="password"
                aria-label="Brave Search API key"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="Brave Search API key"
                autoComplete="off"
              />
              <button className="button quiet">
                {key ? "Save search key" : "Remove saved key"}
              </button>
            </form>
          </details>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                const p = await api().planDiscovery(
                  question,
                  queries.trim()
                    ? queries
                        .split("\n")
                        .map((q) => q.trim())
                        .filter(Boolean)
                    : undefined,
                );
                setPlan(p);
                setQueries(p.queries.join("\n"));
              });
            }}
          >
            <label className="field">
              Question or evidence gap
              <textarea
                value={question}
                required
                onChange={(e) => setQuestion(e.target.value)}
              />
            </label>
            {!plan && queries.trim() && (
              <label className="field">
                Saved query draft (one per line)
                <textarea
                  rows={5}
                  value={queries}
                  onChange={(e) => setQueries(e.target.value)}
                />
                <span className="muted">
                  These queries have not been approved for a new search. Prepare
                  a plan to review its destination and limits.
                </span>
              </label>
            )}
            <button className="button primary" disabled={working}>
              Prepare search plan
            </button>
          </form>
          {plan && (
            <div className="discovery-plan">
              <h3>Review before searching</h3>
              <p>{plan.purpose}</p>
              <p>
                <strong>Destination:</strong> {plan.destination}
              </p>
              <p>
                <strong>Limits:</strong> {plan.maxQueries} queries ·{" "}
                {plan.maxCaptures} candidate captures. Only these query strings
                are sent. Candidate pages enter your library only when you
                accept them.
              </p>
              <label className="field">
                Proposed queries (one per line)
                <textarea
                  rows={5}
                  value={queries}
                  onChange={(e) => setQueries(e.target.value)}
                />
              </label>
              <div className="small-actions">
                {plan.queries.map((q) => (
                  <button
                    key={q}
                    onClick={() =>
                      api()
                        .openExternal(
                          `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
                        )
                        .catch(onError)
                    }
                  >
                    Search manually: {q}
                  </button>
                ))}
              </div>
              <button
                className="button primary"
                disabled={!hasKey || working}
                onClick={() =>
                  action(async () => {
                    if (queries.trim() !== plan.queries.join("\n")) {
                      const reviewed = await api().planDiscovery(
                        question,
                        queries
                          .split("\n")
                          .map((q) => q.trim())
                          .filter(Boolean),
                      );
                      setPlan(reviewed);
                      setQueries(reviewed.queries.join("\n"));
                      return;
                    }
                    await api().approveDiscovery(plan.id);
                    setPlan(undefined);
                    setQueries("");
                  })
                }
              >
                {queries.trim() !== plan.queries.join("\n")
                  ? "Review edited plan"
                  : "Approve this search run"}
              </button>
              {!hasKey && (
                <p className="muted">
                  Add a Brave Search key to run this plan inside Acadia.
                </p>
              )}
            </div>
          )}
          <h3 className="inbox-title">Discovery inbox</h3>
          <div className="research-list">
            {research.discoveries
              .filter((c) => c.status !== "dismissed")
              .map((c) => (
                <article className="research-card" key={c.id}>
                  <span className="eyebrow">{c.status}</span>
                  <h3>{c.title}</h3>
                  <p>{c.description}</p>
                  <button
                    className="text-button"
                    onClick={() => api().openExternal(c.url).catch(onError)}
                  >
                    {c.url}
                  </button>
                  {c.error && <p className="warning-text">{c.error}</p>}
                  {["pending", "failed"].includes(c.status) && (
                    <div className="small-actions">
                      <button
                        onClick={() =>
                          api().acceptDiscovery(c.id).catch(onError)
                        }
                      >
                        Accept and capture source
                      </button>
                      <button
                        onClick={() =>
                          api().dismissDiscovery(c.id).catch(onError)
                        }
                      >
                        Dismiss
                      </button>
                    </div>
                  )}
                </article>
              ))}
          </div>
        </>
      )}
      {assessmentClaim &&
        research.claims.some((c) => c.id === assessmentClaim) && (
          <Modal
            title="Finding assessment"
            onClose={() => setAssessmentClaim(undefined)}
            wide
          >
            <FindingAssessmentPanel
              project={project}
              research={research}
              claim={research.claims.find((c) => c.id === assessmentClaim)!}
              onError={onError}
              onSource={(sourceId, versionId, passageId) => {
                setAssessmentClaim(undefined);
                onSource(sourceId, versionId, passageId);
              }}
            />
          </Modal>
        )}
      {claim && (
        <Modal
          title={
            research.claims.some((c) => c.id === claim.id)
              ? "Examine claim"
              : "New claim"
          }
          onClose={() => setClaim(undefined)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await api().saveClaim({ ...claim, updatedAt: now() });
                setClaim(undefined);
              });
            }}
          >
            <label className="field">
              Claim
              <input
                required
                value={claim.title}
                onChange={(e) => setClaim({ ...claim, title: e.target.value })}
              />
            </label>
            {claim.itemReview && (
              <ReviewerNotes
                claims={[claim]}
                onCitation={(citation) => {
                  setClaim(undefined);
                  onSource(
                    citation.sourceId,
                    citation.versionId,
                    citation.passageId,
                  );
                }}
              />
            )}
            <label className="field">
              Question
              <textarea
                value={claim.question}
                onChange={(e) =>
                  setClaim({ ...claim, question: e.target.value })
                }
              />
            </label>
            <label className="field">
              Assessment
              <select
                value={claim.status}
                onChange={(e) =>
                  setClaim({
                    ...claim,
                    status: e.target.value as ResearchClaim["status"],
                  })
                }
              >
                {["unreviewed", "provisional", "supported", "disputed"].map(
                  (s) => (
                    <option key={s}>{s}</option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              Alternative explanations
              <textarea
                value={claim.alternatives}
                onChange={(e) =>
                  setClaim({ ...claim, alternatives: e.target.value })
                }
              />
            </label>
            <label className="field">
              Limitations and unresolved questions
              <textarea
                value={claim.limitations}
                onChange={(e) =>
                  setClaim({ ...claim, limitations: e.target.value })
                }
              />
            </label>
            <label className="field">
              Board item
              <select
                value={claim.cardId || ""}
                disabled={Boolean(claim.itemReview)}
                onChange={(e) =>
                  setClaim({ ...claim, cardId: e.target.value || undefined })
                }
              >
                <option value="">No board item</option>
                {project.cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            {claim.links.map((l) => (
              <div className="linked-evidence" key={l.id}>
                <q>{l.quote.slice(0, 200)}</q>
                <select
                  aria-label="Evidence relationship"
                  value={l.relation}
                  onChange={(e) =>
                    setClaim({
                      ...claim,
                      links: claim.links.map((x) =>
                        x.id === l.id
                          ? {
                              ...x,
                              relation: e.target.value as typeof l.relation,
                            }
                          : x,
                      ),
                    })
                  }
                >
                  {["supports", "contradicts", "context"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <textarea
                  aria-label="Passage assessment"
                  value={l.rationale}
                  onChange={(e) =>
                    setClaim({
                      ...claim,
                      links: claim.links.map((x) =>
                        x.id === l.id ? { ...x, rationale: e.target.value } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setClaim({
                      ...claim,
                      links: claim.links.filter((x) => x.id !== l.id),
                    })
                  }
                >
                  Remove link
                </button>
              </div>
            ))}
            <div className="modal-actions">
              {!claim.itemReview && (
                <button
                  type="button"
                  className="button danger"
                  onClick={() =>
                    action(async () => {
                      await api().deleteClaim(claim.id);
                      setClaim(undefined);
                    })
                  }
                >
                  Delete claim
                </button>
              )}
              <button className="button primary" disabled={working}>
                Save assessment
              </button>
            </div>
          </form>
        </Modal>
      )}
      {task && (
        <Modal title="Research task" onClose={() => setTask(undefined)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await api().saveTask({ ...task, updatedAt: now() });
                setTask(undefined);
              });
            }}
          >
            <label className="field">
              Task
              <input
                required
                value={task.title}
                onChange={(e) => setTask({ ...task, title: e.target.value })}
              />
            </label>
            <label className="field">
              Question or gap
              <textarea
                value={task.question}
                onChange={(e) => setTask({ ...task, question: e.target.value })}
              />
            </label>
            <label className="field">
              Linked claim
              <select
                value={task.claimId || ""}
                onChange={(e) =>
                  setTask({ ...task, claimId: e.target.value || undefined })
                }
              >
                <option value="">Investigation question</option>
                {research.claims.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Status
              <select
                value={task.status}
                onChange={(e) =>
                  setTask({
                    ...task,
                    status: e.target.value as ResearchTask["status"],
                  })
                }
              >
                {["planned", "doing", "blocked", "complete"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Due date (optional)
              <input
                type="date"
                value={task.dueDate || ""}
                onChange={(e) =>
                  setTask({ ...task, dueDate: e.target.value || undefined })
                }
              />
            </label>
            <label className="field">
              Completion criteria
              <textarea
                required
                value={task.criterion}
                onChange={(e) =>
                  setTask({ ...task, criterion: e.target.value })
                }
              />
            </label>
            <fieldset className="source-checklist">
              <legend>Resulting evidence sources</legend>
              {research.sources.map((s) => (
                <label key={s.id}>
                  <input
                    type="checkbox"
                    checked={task.sourceIds.includes(s.id)}
                    onChange={(e) =>
                      setTask({
                        ...task,
                        sourceIds: e.target.checked
                          ? [...task.sourceIds, s.id]
                          : task.sourceIds.filter((id) => id !== s.id),
                      })
                    }
                  />
                  {s.title}
                </label>
              ))}
            </fieldset>
            <div className="modal-actions">
              <button
                type="button"
                className="button danger"
                onClick={() =>
                  action(async () => {
                    await api().deleteTask(task.id);
                    setTask(undefined);
                  })
                }
              >
                Delete task
              </button>
              <button className="button primary" disabled={working}>
                Save task
              </button>
            </div>
          </form>
        </Modal>
      )}
    </main>
  );
}
