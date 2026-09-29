import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Compass,
  FileText,
  FlaskConical,
  Layers3,
  LoaderCircle,
  Radio,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
} from "lucide-react";
import type {
  AISettings,
  OutputKind,
  Project,
  ResearchOutput,
} from "../../shared/types";
import type { Citation, ResearchState } from "../../shared/research";
import {
  changedCitationSources,
  releasedReport,
  reportCitations,
  snapshotRevision,
} from "../../shared/report";
import ReportEditor from "./ReportEditor";
import { operationErrorMessage } from "../../shared/ui-errors";
import "./Releaser.css";

interface ReleaserProps {
  project: Project;
  settings: AISettings;
  onOutput: (output: ResearchOutput) => void;
  onSettings: () => void;
  readOnly?: boolean;
  onSource: (id: string) => void;
  onUpdateOutput: (output: ResearchOutput) => void;
  onRelease: (outputId: string, revisionId: string) => void;
  onCitation: (citation: Citation) => void;
}
const OUTPUT_KINDS = [
  {
    id: "decision-brief",
    title: "Decision brief",
    detail: "Compare choices and recommend a path.",
    icon: Target,
  },
  {
    id: "hypothesis",
    title: "Hypothesis",
    detail: "Surface a claim worth testing.",
    icon: FlaskConical,
  },
  {
    id: "research-plan",
    title: "Research plan",
    detail: "Turn unknowns into next steps.",
    icon: Compass,
  },
  {
    id: "whitepaper",
    title: "Whitepaper",
    detail: "Develop an evidence-led narrative.",
    icon: FileText,
  },
  {
    id: "gap-analysis",
    title: "Gap analysis",
    detail: "Find what the evidence is missing.",
    icon: Layers3,
  },
  {
    id: "needs-analysis",
    title: "Needs analysis",
    detail: "Frame needs, constraints, and priorities.",
    icon: Target,
  },
] as const;
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

export default function Releaser({
  project,
  settings,
  onOutput,
  onSettings,
  readOnly = false,
  onSource,
  onUpdateOutput,
  onRelease,
  onCitation,
}: ReleaserProps) {
  const [kind, setKind] = useState<OutputKind>("decision-brief");
  const [instructions, setInstructions] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revisionId, setRevisionId] = useState("");
  const [revisionNote, setRevisionNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<"md" | "pdf" | "docx" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [generationFailure, setGenerationFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [research, setResearch] = useState<ResearchState | null>(null);
  const activeProject = useRef(project.id);
  activeProject.current = project.id;
  const outputs = useMemo(
    () =>
      [...project.outputs].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [project.outputs],
  );
  const draft =
    outputs.find((output) => output.id === selectedId) ?? outputs[0];
  const historical = draft?.revisions?.find(
    (revision) => revision.id === revisionId,
  );
  const selectedOutput = readOnly
    ? releasedReport(project)
    : historical
      ? {
          ...draft,
          document: historical.document,
          markdown: historical.markdown,
          citations: historical.citations,
          createdAt: historical.createdAt,
        }
      : draft;
  const citations = selectedOutput ? reportCitations(selectedOutput) : [];
  const changed = research
    ? changedCitationSources(citations, research.sources)
    : [];
  const stale = changed.length > 0;
  const currentKind = OUTPUT_KINDS.find((output) => output.id === kind)!;
  const effectiveProvider =
    project.privacy?.provider ||
    (project.privacy?.mode === "local" ? "offline" : settings.provider);
  const offline = effectiveProvider === "offline";
  const outputOffline = selectedOutput
    ? /offline/i.test(selectedOutput.provider)
    : offline;
  const activeJobs =
    research?.jobs.filter(
      (job) =>
        job.kind === "analysis" && ["queued", "running"].includes(job.status),
    ) || [];
  const hasResearch =
    project.cards.length > 0 || (research?.sources.length || 0) > 0;

  useEffect(() => {
    setSelectedId(null);
    setRevisionId("");
    setError("");
    setGenerationFailure("");
    setNotice("");
    setInstructions("");
    setResearch(null);
  }, [project.id]);
  useEffect(() => {
    if (!window.acadia) return;
    let active = true;
    const refresh = () =>
      window
        .acadia!.researchState()
        .then((state) => {
          if (active) setResearch(state);
        })
        .catch(() => undefined);
    void refresh();
    const unsubscribe = window.acadia.onResearchChanged(() => void refresh());
    return () => {
      active = false;
      unsubscribe();
    };
  }, [project.id]);

  async function generate() {
    if (readOnly || generating || !hasResearch) return;
    if (!window.acadia) {
      setError("Open the Acadia desktop app to create a research output.");
      return;
    }
    const projectId = project.id;
    setGenerating(true);
    setError("");
    setGenerationFailure("");
    setNotice("");
    try {
      const result = await window.acadia.generate(
        project,
        kind,
        instructions.trim(),
      );
      if (activeProject.current !== projectId) return;
      onOutput(result);
      setSelectedId(result.id);
      setRevisionId("");
      setNotice(
        "Draft created. Edit and save a revision, then explicitly release it to the second display.",
      );
    } catch (cause) {
      if (activeProject.current === projectId)
        setGenerationFailure(
          operationErrorMessage(cause, "Could not create the research output."),
        );
    } finally {
      setGenerating(false);
    }
  }
  async function exportDocument(format: "md" | "pdf" | "docx") {
    if (!selectedOutput || exporting) return;
    if (!window.acadia) {
      setError("Open the Acadia desktop app to export a report.");
      return;
    }
    setExporting(format);
    setError("");
    setNotice("");
    try {
      if (await window.acadia.exportOutput(selectedOutput, format))
        setNotice(
          `${format === "md" ? "Markdown" : format.toUpperCase()} exported with bibliography.`,
        );
    } catch (cause) {
      setError(operationErrorMessage(cause, "Could not export the report."));
    } finally {
      setExporting(null);
    }
  }
  function saveRevision() {
    if (!draft || readOnly || historical) return;
    const revision = snapshotRevision(
      draft,
      revisionNote.trim() || "Saved revision",
    );
    onUpdateOutput({
      ...draft,
      document: revision.document,
      markdown: revision.markdown,
      citations: revision.citations,
      revisions: [...(draft.revisions || []), revision],
    });
    setRevisionNote("");
    setNotice(
      "Revision saved. Your released display remains on its selected revision.",
    );
  }
  function release() {
    if (!draft || readOnly) return;
    if (historical) {
      onRelease(draft.id, historical.id);
      setNotice("Selected revision released to the second display.");
      return;
    }
    const revision = snapshotRevision(
      draft,
      revisionNote.trim() || "Released revision",
    );
    onUpdateOutput({
      ...draft,
      document: revision.document,
      markdown: revision.markdown,
      citations: revision.citations,
      revisions: [...(draft.revisions || []), revision],
    });
    onRelease(draft.id, revision.id);
    setRevisionNote("");
    setNotice(
      "A saved snapshot is now on the Releaser display. Continue editing privately.",
    );
  }
  function navigateCitation(citation: Citation) {
    if (citation.legacyCardId && !citation.passageId)
      onSource(citation.legacyCardId);
    else onCitation(citation);
  }
  const visibleOutputs = readOnly
    ? selectedOutput
      ? [selectedOutput]
      : []
    : outputs;
  return (
    <section
      className={`release-workspace${readOnly ? " release-readonly" : ""}`}
      aria-label="Releaser research workspace"
    >
      {!readOnly && (
        <aside
          className="release-composer"
          aria-label="Create a research output"
        >
          <div className="release-panel-heading">
            <span className="eyebrow">FROM EVIDENCE TO INSIGHT</span>
            <h2>
              Give your research
              <br />
              <span>direction.</span>
            </h2>
            <p>
              Compare explanations. Make the evidence behind each decision
              visible.
            </p>
          </div>
          <div
            className="release-kind-list"
            role="group"
            aria-label="Output type"
          >
            {OUTPUT_KINDS.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`release-kind${kind === item.id ? " is-selected" : ""}`}
                  aria-pressed={kind === item.id}
                  onClick={() => setKind(item.id)}
                  disabled={generating}
                >
                  <span className="release-kind-icon">
                    <Icon size={19} strokeWidth={1.6} />
                  </span>
                  <span className="release-kind-copy">
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                  </span>
                  <span className="release-kind-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                </button>
              );
            })}
          </div>
          <label
            className="release-instructions"
            htmlFor="release-instructions"
          >
            <span className="eyebrow">
              RESEARCH DIRECTION <span>OPTIONAL</span>
            </span>
            <textarea
              id="release-instructions"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              disabled={generating}
              maxLength={8000}
              placeholder="Audience, question, decision, scope, or constraint…"
              rows={4}
            />
          </label>
          <div className="release-engine">
            <span
              className={`release-engine-indicator${offline ? " is-offline" : ""}`}
            />
            <div>
              <strong>
                {offline
                  ? "Offline evidence brief"
                  : effectiveProvider === "ollama"
                    ? "Ollama AI"
                    : project.privacy?.mode === "local"
                      ? "Local compatible AI"
                      : "Configured cloud AI"}
              </strong>
              <p>
                {offline
                  ? "Structured evidence. No AI inference."
                  : project.privacy?.model ||
                    settings.model ||
                    "Choose a model in settings."}
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Configure research engine"
              onClick={onSettings}
            >
              <Settings2 size={16} />
            </button>
          </div>
          <p className="release-composer-note">
            Searches indexed passages across the full source library. Pinned
            evidence is retained; excluded material stays out. Extraction
            coverage and unresolved gaps remain visible.
          </p>
          <button
            type="button"
            className="button primary release-generate"
            onClick={() => void generate()}
            disabled={generating || !hasResearch}
          >
            {generating ? (
              <LoaderCircle className="release-spin" size={17} />
            ) : (
              <Sparkles size={17} />
            )}
            <span>
              {generating
                ? "Working with your evidence…"
                : offline
                  ? "Build evidence brief"
                  : "Generate document"}
            </span>
            {!generating && <ArrowUpRight size={17} />}
          </button>
          {activeJobs.map((job) => (
            <div className="release-job" key={job.id}>
              <progress value={job.progress} max={100} />
              <p>{job.message}</p>
              <button
                type="button"
                onClick={() =>
                  void window.acadia
                    ?.cancelJob(job.id)
                    .catch((cause) => setError(String(cause)))
                }
              >
                Cancel analysis
              </button>
            </div>
          ))}
          <p className="release-composer-note">
            {project.privacy?.mode === "cloud"
              ? "Selected passages are sent to this project’s configured provider. Source and citation checks remain separate from evaluating a claim."
              : "Local project: offline processing or a local model only. Outside web research requires separate approval."}
          </p>
        </aside>
      )}
      <div className="release-main">
        <header className="release-document-toolbar">
          <div className="release-document-label">
            <Radio size={16} />
            <span>RELEASER</span>
            <span className="release-toolbar-divider" />
            <span className="release-document-count">
              {readOnly
                ? "RELEASED SNAPSHOT"
                : `${outputs.length.toString().padStart(2, "0")} OUTPUT${outputs.length === 1 ? "" : "S"}`}
            </span>
          </div>
          {selectedOutput && (
            <div className="release-export-actions">
              {(["md", "docx", "pdf"] as const).map((format) => (
                <button
                  key={format}
                  type="button"
                  className="button quiet"
                  onClick={() => void exportDocument(format)}
                  disabled={Boolean(exporting)}
                  title={`Export ${format === "md" ? "Markdown" : format.toUpperCase()}`}
                >
                  {exporting === format ? (
                    <LoaderCircle className="release-spin" size={14} />
                  ) : (
                    <ArrowDownToLine size={14} />
                  )}
                  <span>
                    {format === "md" ? "Markdown" : format.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          )}
        </header>
        <div className="release-messages" aria-live="polite" aria-atomic="true">
          {generationFailure && !readOnly && (
            <div
              className="release-message is-error"
              role="alert"
              id="release-generation-error"
            >
              <TriangleAlert size={16} />
              <span>
                <strong>
                  {selectedOutput
                    ? "Generation failed — previous report still shown."
                    : "Generation failed — no report created."}
                </strong>
                <br />
                {generationFailure}
                <br />
                No new draft was saved. Your existing reports and released
                version are unchanged. Retry generation or adjust the research
                direction.
              </span>
              <button
                type="button"
                onClick={() => setGenerationFailure("")}
                aria-label="Dismiss generation error"
              >
                ×
              </button>
            </div>
          )}
          {error && (
            <div className="release-message is-error" role="alert">
              <TriangleAlert size={16} />
              <span>{error}</span>
              <button
                type="button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                ×
              </button>
            </div>
          )}
          {notice && (
            <div className="release-message is-success">
              <Check size={16} />
              <span>{notice}</span>
              <button
                type="button"
                onClick={() => setNotice("")}
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
          {stale && (
            <div className="release-message is-stale">
              <TriangleAlert size={15} />
              <span>
                {changed.length} cited source version
                {changed.length === 1 ? " has" : "s have"} changed or been
                removed. Citations still open the saved evidence; reconsider
                affected findings.
              </span>
            </div>
          )}
        </div>
        {selectedOutput ? (
          <div className="release-document-scroll">
            {!readOnly && (
              <div className="release-revision-bar">
                <label>
                  Version
                  <select
                    aria-label="Report version"
                    value={revisionId}
                    onChange={(event) => setRevisionId(event.target.value)}
                  >
                    <option value="">Working draft</option>
                    {[...(draft.revisions || [])]
                      .reverse()
                      .map((revision, index) => (
                        <option key={revision.id} value={revision.id}>
                          {(draft.revisions?.length || 0) - index}.{" "}
                          {revision.note} · {formatDate(revision.createdAt)}
                          {revision.id === draft.releasedRevisionId
                            ? " · Released"
                            : ""}
                        </option>
                      ))}
                  </select>
                </label>
                {!historical && (
                  <input
                    aria-label="Revision note"
                    placeholder="Revision note (optional)"
                    value={revisionNote}
                    onChange={(event) => setRevisionNote(event.target.value)}
                    maxLength={160}
                  />
                )}
                <button
                  type="button"
                  disabled={Boolean(historical)}
                  onClick={saveRevision}
                >
                  Save revision
                </button>
                <button
                  type="button"
                  className="release-publish"
                  onClick={release}
                >
                  <Radio size={13} />
                  {historical ? "Release this revision" : "Save & release"}
                </button>
              </div>
            )}
            <article
              className="release-document"
              aria-describedby={
                generationFailure && !readOnly
                  ? "release-generation-error"
                  : undefined
              }
            >
              <div className="release-document-kicker">
                <span>
                  RESEARCH OUTPUT /{" "}
                  {OUTPUT_KINDS.find(
                    (item) => item.id === selectedOutput.kind,
                  )?.title.toUpperCase()}
                </span>
                <span className={outputOffline ? "release-mode-offline" : ""}>
                  {readOnly
                    ? "RELEASED REVISION"
                    : generationFailure
                      ? "PREVIOUS REPORT · GENERATION FAILED"
                      : historical
                        ? "SAVED REVISION"
                        : "WORKING DRAFT"}
                </span>
              </div>
              <div className="release-document-meta">
                <span>
                  <span className="release-meta-dot" />
                  {project.title}
                </span>
                <time dateTime={selectedOutput.createdAt}>
                  {formatDate(selectedOutput.createdAt)}
                </time>
              </div>
              <ReportEditor
                key={`${selectedOutput.id}-${readOnly ? selectedOutput.releasedRevisionId : revisionId || "draft"}`}
                output={selectedOutput}
                readOnly={readOnly || Boolean(historical)}
                onChange={onUpdateOutput}
                onCitation={navigateCitation}
              />
              {citations.length > 0 && (
                <section
                  className="release-bibliography"
                  aria-label="Report bibliography"
                >
                  <h2>Bibliography</h2>
                  <ol>
                    {citations.map((citation) => (
                      <li key={citation.id}>
                        <button
                          type="button"
                          onClick={() => navigateCitation(citation)}
                        >
                          <strong>{citation.sourceTitle}</strong> —{" "}
                          {citation.locator}
                        </button>
                        <small>
                          {citation.legacyCardId
                            ? "Legacy card-level reference"
                            : `${citation.verified ? "Quotation location verified" : "Quotation location unverified"} · ${citation.acquiredAt.slice(0, 10)}`}
                        </small>
                        {citation.quote && (
                          <blockquote>{citation.quote}</blockquote>
                        )}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <footer className="release-document-footer">
                <ShieldCheck size={15} />
                <span>
                  {outputOffline
                    ? "Organized from saved evidence. No AI-generated conclusions."
                    : "Evaluate each claim against its cited evidence and consider the stated alternatives and limitations."}{" "}
                  {!readOnly &&
                    !historical &&
                    "Draft edits save automatically; the second display changes only when you release a revision."}
                </span>
              </footer>
            </article>
          </div>
        ) : (
          <div className="release-empty">
            <div className="release-empty-grid" aria-hidden="true" />
            <span className="release-empty-symbol">
              <BookOpen size={31} strokeWidth={1.3} />
            </span>
            <span className="eyebrow">YOUR EVIDENCE. THE NEXT CHAPTER.</span>
            <h2>
              Collected ideas.
              <br />
              <span>Released potential.</span>
            </h2>
            <p>
              {readOnly
                ? "No report has been released. Save and release a revision from the main Acadia window to show it here."
                : `Build a ${currentKind.title.toLowerCase()} from your indexed evidence, competing explanations, and research questions.`}
            </p>
            {!readOnly && (
              <div className="release-evidence-summary">
                <div>
                  <strong>
                    {String(
                      research?.sources.length || project.cards.length,
                    ).padStart(2, "0")}
                  </strong>
                  <span>COLLECTED SOURCES</span>
                </div>
                <div>
                  <strong>
                    {String(project.connections.length).padStart(2, "0")}
                  </strong>
                  <span>CONNECTIONS</span>
                </div>
                <div>
                  <strong>
                    {String(research?.claims.length || 0).padStart(2, "0")}
                  </strong>
                  <span>RESEARCH CLAIMS</span>
                </div>
              </div>
            )}
            <div className="release-empty-footnote">
              {readOnly
                ? "Released snapshots appear here. Working drafts remain private."
                : "Every citation leads back to a saved source passage."}
            </div>
          </div>
        )}
      </div>
      <aside
        className="release-archive"
        aria-label="Saved outputs and evidence"
      >
        <div className="release-archive-section">
          <div className="release-sidebar-heading">
            <span className="eyebrow">
              {readOnly ? "RELEASED REPORT" : "OUTPUT LIBRARY"}
            </span>
            <span>{visibleOutputs.length.toString().padStart(2, "0")}</span>
          </div>
          {visibleOutputs.length ? (
            <div className="release-output-list">
              {visibleOutputs.map((output) => (
                <button
                  type="button"
                  key={output.id}
                  className={`release-output-item${selectedOutput?.id === output.id ? " is-selected" : ""}`}
                  aria-pressed={selectedOutput?.id === output.id}
                  disabled={readOnly}
                  onClick={() => {
                    setSelectedId(output.id);
                    setRevisionId("");
                    setNotice("");
                  }}
                >
                  <FileText size={16} />
                  <span>
                    <strong>{output.title}</strong>
                    <small>
                      {formatDate(output.createdAt)}
                      {project.releasedOutputId === output.id
                        ? " · RELEASED"
                        : " · DRAFT"}
                    </small>
                  </span>
                  <ChevronRight size={13} />
                </button>
              ))}
            </div>
          ) : (
            <div className="release-library-empty">
              <FileText size={23} strokeWidth={1.3} />
              <p>
                A place for what
                <br />
                comes next.
              </p>
              <span>
                {readOnly
                  ? "Awaiting a released revision."
                  : "Your saved outputs will appear here."}
              </span>
            </div>
          )}
        </div>
        <div className="release-archive-section release-sources-section">
          <div className="release-sidebar-heading">
            <span className="eyebrow">EVIDENCE INDEX</span>
            <span>{citations.length.toString().padStart(2, "0")}</span>
          </div>
          {citations.length ? (
            <div className="release-source-list">
              {citations.map((citation, index) => (
                <button
                  key={citation.id}
                  type="button"
                  className="release-source-item"
                  onClick={() => navigateCitation(citation)}
                  title={`Open saved passage: ${citation.locator}`}
                >
                  <span className="release-source-label">{index + 1}</span>
                  <span>
                    <strong>{citation.sourceTitle}</strong>
                    <small>{citation.locator}</small>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              ))}
            </div>
          ) : (
            <p className="release-evidence-empty">
              Saved source passages and provenance appear alongside each report.
            </p>
          )}
        </div>
        <div className="release-archive-bottom">
          <span className="release-meta-dot" />
          <span>
            {readOnly
              ? "SELECTED RELEASED REVISION"
              : "GROUNDED IN YOUR EVIDENCE"}
          </span>
        </div>
      </aside>
    </section>
  );
}
export { Releaser };
