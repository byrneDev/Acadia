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
  PanelRight,
  Plus,
  X,
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
  ProjectPlanContext,
} from "../../shared/types";
import type {
  Citation,
  ReportDocument,
  ResearchState,
  ReportRevision,
} from "../../shared/research";
import {
  changedCitationSources,
  releasedReport,
  reportCitations,
  reportDocument,
  snapshotRevision,
  reportToMarkdown,
} from "../../shared/report";
import ReportEditor from "./ReportEditor";
import { Modal } from "./Dialogs";
import { ChallengeReview } from "./ChallengeReview";
import { usePedigree } from "./pedigree-state";
import {
  DeliverablePlanFields,
  createPlanContext,
} from "./DeliverablePlanFields";
import { DeliveryPlanPanel } from "./DeliveryPlanPanel";
import ReportPedigreePanel from "./ReportPedigreePanel";
import type { PedigreeSnapshot } from "../../shared/pedigree";
import type { ChallengeProposal } from "../../shared/pedigree-analysis";
import {
  analyticalChecks,
  citationIntegrity,
  pedigreeAppendix,
  pedigreeChanged,
} from "../../shared/report-pedigree";
import {
  appendReportContent,
  applyReportChallenge,
  reportFingerprint,
} from "../../shared/report-changes";
import { operationErrorMessage } from "../../shared/ui-errors";
import {
  readReportWorkspace,
  writeReportWorkspace,
} from "./report-workspace-state";
import "./Releaser.css";
import { AddToBoardButton } from "./BoardMappingContext";

interface ReleaserProps {
  project: Project;
  settings: AISettings;
  onOutput: (output: ResearchOutput) => void;
  onSettings: () => void;
  readOnly?: boolean;
  requestNewReport?: number;
  requestNewDeliveryPlan?: number;
  onDeliveryPlanRequestHandled?: () => void;
  onRequestHandled?: () => void;
  requestedReport?: { id: string; key: number };
  research?: ResearchState | null;
  onSource: (id: string) => void;
  onUpdateOutput: (output: ResearchOutput) => void;
  onPersistOutput: (output: ResearchOutput) => Promise<void>;
  onRelease: (outputId: string, revisionId: string) => void;
  onCitation: (citation: Citation) => void;
}
const OUTPUT_KINDS = [
  {
    id: "project-plan",
    title: "Deliverable project plan",
    detail:
      "Bridge an analysis gap to software, curriculum, or another deliverable.",
    icon: Target,
  },
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
  requestNewReport,
  requestNewDeliveryPlan: newDeliveryPlanRequest,
  onDeliveryPlanRequestHandled,
  onRequestHandled,
  requestedReport,
  research: providedResearch,
  onSource,
  onUpdateOutput,
  onPersistOutput,
  onRelease,
  onCitation,
}: ReleaserProps) {
  const [savedView] = useState(() =>
    readReportWorkspace(project.id, !project.outputs.length),
  );
  const [kind, setKind] = useState<OutputKind>(savedView.kind);
  const [instructions, setInstructions] = useState(savedView.instructions);
  const [plan, setPlan] = useState<ProjectPlanContext | undefined>(
    savedView.plan,
  );
  const { state: livePedigree, error: pedigreeError } = usePedigree(
    project.id,
    !readOnly,
  );
  const [pedigreeSnapshot, setPedigreeSnapshot] =
    useState<PedigreeSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState("");
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [appendix, setAppendix] = useState<{
    output: ResearchOutput;
    targetId: string;
    fingerprint: string;
  } | null>(null);
  const [releaseReview, setReleaseReview] = useState<{
    output: ResearchOutput;
    fingerprint: string;
    snapshot: PedigreeSnapshot;
    warnings: string[];
    errors: string[];
    historicalId: string;
  } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(
    savedView.selectedId,
  );
  const [revisionId, setRevisionId] = useState(savedView.revisionId);
  const [revisionNote, setRevisionNote] = useState(savedView.revisionNote);
  const [composerOpen, setComposerOpen] = useState(savedView.composerOpen);
  const [inspectorOpen, setInspectorOpen] = useState(
    !readOnly && savedView.inspectorOpen,
  );
  const composer = useRef<HTMLDialogElement>(null);
  const documentScroll = useRef<HTMLDivElement>(null);
  const scrollPositions = useRef(savedView.scrollPositions);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState<"md" | "pdf" | "docx" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [generationFailure, setGenerationFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [loadedResearch, setResearch] = useState<ResearchState | null>(null);
  const research =
    providedResearch === undefined ? loadedResearch : providedResearch;
  const activeProject = useRef(project.id);
  activeProject.current = project.id;
  useEffect(
    () => () => {
      activeProject.current = "";
    },
    [],
  );
  const outputs = useMemo(
    () =>
      [...project.outputs].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    [project.outputs],
  );
  const knownOutputs = useRef(new Set(outputs.map((output) => output.id)));
  useEffect(() => {
    const added = outputs.find(
      (output) => !knownOutputs.current.has(output.id),
    );
    knownOutputs.current = new Set(outputs.map((output) => output.id));
    // A run started in an earlier mount can finish after returning to Reports.
    if (added && !readOnly) {
      setSelectedId(added.id);
      setRevisionId("");
      setComposerOpen(false);
    }
  }, [outputs, readOnly]);
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
          pedigreeSnapshotId: historical.pedigreeSnapshotId,
          plan: historical.plan,
          deliveryPlan: historical.deliveryPlan,
        }
      : draft;
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const latestSelected = useRef(selectedOutput);
  latestSelected.current = selectedOutput;
  function updateOutput(value: ResearchOutput) {
    if (latestDraft.current?.id === value.id) latestDraft.current = value;
    if (!historical && latestSelected.current?.id === value.id)
      latestSelected.current = value;
    onUpdateOutput(value);
  }
  const citations = useMemo(
    () => (selectedOutput ? reportCitations(selectedOutput) : []),
    [
      selectedOutput?.citations,
      selectedOutput?.sourceIds,
      selectedOutput?.createdAt,
    ],
  );
  const changed = useMemo(
    () => (research ? changedCitationSources(citations, research.sources) : []),
    [citations, research?.sources],
  );
  const stale = changed.length > 0;
  const outline = useMemo(() => {
    if (!inspectorOpen || !selectedOutput) return [];
    const headings: { label: string; level: number }[] = [];
    const text = (node: ReportDocument): string =>
      node.text || node.content?.map(text).join("") || "";
    const visit = (node: ReportDocument) => {
      if (node.type === "heading")
        headings.push({
          label: text(node) || "Untitled section",
          level: Number(node.attrs?.level) || 1,
        });
      node.content?.forEach(visit);
    };
    visit(reportDocument(selectedOutput));
    return headings;
  }, [inspectorOpen, selectedOutput?.document, selectedOutput?.markdown]);
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
  const analysisBusy = generating || activeJobs.length > 0;
  const hasResearch =
    project.cards.length > 0 || (research?.sources.length || 0) > 0;

  const hasInput =
    hasResearch || (kind === "project-plan" && Boolean(plan?.analysisOutputId));

  const scrollKey = `${selectedOutput?.id || "empty"}:${readOnly ? selectedOutput?.releasedRevisionId || "released" : revisionId || "draft"}`;
  const uiState = useRef(savedView);
  uiState.current = {
    kind,
    instructions,
    plan,
    selectedId,
    revisionId,
    revisionNote,
    composerOpen,
    inspectorOpen,
    scrollPositions: scrollPositions.current,
  };
  useEffect(() => {
    if (!readOnly) writeReportWorkspace(project.id, uiState.current);
  }, [
    project.id,
    readOnly,
    kind,
    instructions,
    plan,
    selectedId,
    revisionId,
    revisionNote,
    composerOpen,
    inspectorOpen,
  ]);
  useEffect(() => {
    const saveView = () => {
      if (!readOnly) writeReportWorkspace(project.id, uiState.current);
    };
    window.addEventListener("beforeunload", saveView);
    window.addEventListener("acadia:flush-report", saveView);
    return () => {
      window.removeEventListener("beforeunload", saveView);
      window.removeEventListener("acadia:flush-report", saveView);
      saveView();
    };
  }, [project.id, readOnly]);
  useEffect(() => {
    if (requestedReport && !readOnly) {
      window.dispatchEvent(new Event("acadia:flush-report"));
      setSelectedId(requestedReport.id);
      setRevisionId("");
      setComposerOpen(false);
      onRequestHandled?.();
    }
  }, [requestedReport, readOnly]);
  useEffect(() => {
    if (requestNewReport && !readOnly) {
      setComposerOpen(true);
      onRequestHandled?.();
    }
  }, [requestNewReport, readOnly]);
  useEffect(() => {
    if (!newDeliveryPlanRequest || readOnly) return;
    if (!selectedOutput || selectedOutput.kind === "project-plan")
      setError(
        "Choose an analysis report first, then use Plan a deliverable to connect its gap to the proposed work.",
      );
    else planDeliverable();
    if (onDeliveryPlanRequestHandled) onDeliveryPlanRequestHandled();
    else onRequestHandled?.();
  }, [newDeliveryPlanRequest, readOnly]);
  useEffect(() => {
    const dialog = composer.current;
    if (!dialog || readOnly) return;
    if (composerOpen && !dialog.open) dialog.showModal();
    else if (!composerOpen && dialog.open) dialog.close();
  }, [composerOpen, readOnly]);
  useEffect(() => {
    if (documentScroll.current)
      documentScroll.current.scrollTop =
        scrollPositions.current[scrollKey] || 0;
  }, [scrollKey]);
  useEffect(() => {
    // Imported/deleted revisions may invalidate a remembered selection.
    if (revisionId && !historical) setRevisionId("");
  }, [revisionId, historical]);
  function flushReport() {
    window.dispatchEvent(new Event("acadia:flush-report"));
  }
  useEffect(() => {
    if (!window.acadia || providedResearch !== undefined) return;
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
  }, [project.id, providedResearch !== undefined]);

  useEffect(() => {
    if (readOnly || !window.acadia || !selectedOutput?.pedigreeSnapshotId) {
      setPedigreeSnapshot(null);
      setSnapshotError("");
      return;
    }
    let active = true;
    setPedigreeSnapshot(null);
    setSnapshotError("");
    void window.acadia
      .getPedigreeSnapshot(selectedOutput.pedigreeSnapshotId)
      .then((snapshot) => {
        if (active) setPedigreeSnapshot(snapshot);
      })
      .catch((cause) => {
        if (active)
          setSnapshotError(
            operationErrorMessage(
              cause,
              "Could not load the saved analytical pedigree.",
            ),
          );
      });
    return () => {
      active = false;
    };
  }, [selectedOutput?.id, selectedOutput?.pedigreeSnapshotId, readOnly]);
  useEffect(() => {
    setAppendix(null);
    setReleaseReview(null);
  }, [selectedOutput?.id, revisionId]);
  const pedigreeChanges =
    !readOnly && pedigreeSnapshot && livePedigree && research
      ? pedigreeChanged(pedigreeSnapshot, livePedigree, research)
      : [];
  const handleError = (cause: unknown) =>
    setError(
      operationErrorMessage(
        cause,
        "The report operation could not be completed.",
      ),
    );
  function planDeliverable() {
    if (!selectedOutput || readOnly) return;
    flushReport();
    setPlan({
      ...createPlanContext(latestSelected.current!),
      ...(historical ? { analysisRevisionId: historical.id } : {}),
    });
    setKind("project-plan");
    setComposerOpen(true);
  }
  async function applyChallenge(
    change: NonNullable<ChallengeProposal["suggestedChanges"]>[number],
    proposal: ChallengeProposal,
  ) {
    if (readOnly || historical || !latestDraft.current) return;
    try {
      flushReport();
      const targetId = latestDraft.current.id;
      const run = await window.acadia!.getAnalysisRun(proposal.runId);
      if (activeProject.current !== project.id || latestDraft.current?.id !== targetId) return;
      const basis = run
        ? (JSON.parse(run.instructions) as {
            originalDocument?: ReportDocument;
          })
        : undefined;
      if (
        !basis?.originalDocument ||
        proposal.target.id !== latestDraft.current.id
      )
        throw new Error(
          "The report's exact challenge basis is unavailable. Run the challenge again before applying wording.",
        );
      updateOutput(
        applyReportChallenge(
          latestDraft.current,
          basis.originalDocument,
          change,
          proposal.citations,
        ),
      );
      setNotice(
        "Reviewed wording applied to its exact range. The surrounding report and released version are unchanged.",
      );
    } catch (cause) {
      handleError(cause);
    }
  }
  async function previewAppendix() {
    if (readOnly || historical || !latestDraft.current || !window.acadia)
      return;
    setSnapshotBusy(true);
    setError("");
    try {
      flushReport();
      const target = latestDraft.current,
        fingerprint = reportFingerprint(target);
      const snapshot = await window.acadia.createPedigreeSnapshot();
      if (
        activeProject.current !== project.id ||
        latestDraft.current?.id !== target.id
      )
        return;
      const content = pedigreeAppendix(snapshot, reportCitations(target));
      setAppendix({
        targetId: target.id,
        fingerprint,
        output: {
          ...target,
          id: `appendix-${target.id}`,
          document: undefined,
          markdown: content.markdown,
          citations: content.citations.map((c, i) => ({
            ...c,
            label: String(i + 1),
          })),
        },
      });
    } catch (cause) {
      handleError(cause);
    } finally {
      setSnapshotBusy(false);
    }
  }
  function appendReviewedContent() {
    if (!appendix || !latestDraft.current || readOnly || historical) return;
    try {
      if (latestDraft.current.id !== appendix.targetId)
        throw new Error(
          "The selected report changed. Preview this appendix again.",
        );
      updateOutput(
        appendReportContent(latestDraft.current, appendix.fingerprint, {
          markdown: reportToMarkdown(
            reportDocument(appendix.output),
            reportCitations(appendix.output),
          ),
          citations: reportCitations(appendix.output),
        }),
      );
      setAppendix(null);
      setNotice(
        "Analytical pedigree appended. You can edit it in the report before release.",
      );
    } catch (cause) {
      handleError(cause);
    }
  }
  async function generate() {
    if (readOnly || analysisBusy || !hasInput) return;
    if (!window.acadia) {
      setError("Open the Acadia desktop app to create a research output.");
      return;
    }
    const projectId = project.id;
    flushReport();
    setGenerating(true);
    setError("");
    setGenerationFailure("");
    setNotice("");
    try {
      const result = await window.acadia.generate(
        project,
        kind,
        instructions.trim(),
        kind === "project-plan" ? plan : undefined,
      );
      // App guards the originating project. Save a completed draft even when
      // the researcher has returned to Collector and this view was unmounted.
      onOutput(result);
      if (activeProject.current !== projectId) return;
      setSelectedId(result.id);
      setRevisionId("");
      setComposerOpen(false);
      setNotice(
        "Draft created. Edit and save a revision, then explicitly release it to the second display.",
      );
    } catch (cause) {
      if (activeProject.current === projectId) {
        setComposerOpen(false);
        setGenerationFailure(
          operationErrorMessage(cause, "Could not create the research output."),
        );
      }
    } finally {
      if (activeProject.current === projectId) setGenerating(false);
    }
  }
  async function exportDocument(format: "md" | "pdf" | "docx") {
    if (!selectedOutput || exporting) return;
    if (!window.acadia) {
      setError("Open the Acadia desktop app to export a report.");
      return;
    }
    flushReport();
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
  async function saveRevision() {
    if (!draft || readOnly || historical || snapshotBusy || !window.acadia)
      return;
    setSnapshotBusy(true);
    setError("");
    const outputId = draft.id;
    try {
      flushReport();
      const snapshot = await window.acadia.createPedigreeSnapshot();
      const current = latestDraft.current;
      if (
        activeProject.current !== project.id ||
        !current ||
        current.id !== outputId
      )
        return;
      const revision = {
        ...snapshotRevision(current, revisionNote.trim() || "Saved revision"),
        pedigreeSnapshotId: snapshot.id,
      };
      updateOutput({
        ...current,
        revisions: [...(current.revisions || []), revision],
      });
      setRevisionNote("");
      setNotice(
        "Revision and analytical pedigree saved. The released display remains on its selected revision.",
      );
    } catch (cause) {
      handleError(cause);
    } finally {
      setSnapshotBusy(false);
    }
  }
  async function release() {
    if (!latestSelected.current || readOnly || snapshotBusy || !window.acadia)
      return;
    setSnapshotBusy(true);
    setError("");
    try {
      flushReport();
      const output = latestSelected.current,
        fingerprint = reportFingerprint(output),
        historicalId = historical?.id || "";
      const snapshot = historical?.pedigreeSnapshotId
        ? await window.acadia.getPedigreeSnapshot(historical.pedigreeSnapshotId)
        : await window.acadia.createPedigreeSnapshot();
      if (
        activeProject.current !== project.id ||
        latestSelected.current?.id !== output.id
      )
        return;
      const evidence: ResearchState = {
        sources: snapshot.sources,
        versions: snapshot.sourceVersions,
        claims: snapshot.claims,
        tasks: snapshot.tasks,
        jobs: [],
        discoveries: [],
        runs: [],
      };
      const errors = citationIntegrity(output, (id) =>
        snapshot.passages.find((p) => p.id === id),
      );
      const warnings = analyticalChecks(
        snapshot.state,
        evidence,
        snapshot.passages,
      ).map((c) => c.message);
      if (historical && !historical.pedigreeSnapshotId)
        warnings.unshift(
          "This older revision has no historical analytical pedigree. The released copy records today's pedigree; it does not reconstruct the original analytical context.",
        );
      if (livePedigree && research) {
        const changed = pedigreeChanged(snapshot, livePedigree, research);
        if (changed.length)
          warnings.push(
            `The live investigation differs from this saved analytical basis: ${changed.join(", ")}. Reconsider affected findings.`,
          );
      }
      const run = research?.runs.find((r) => r.id === output.runId);
      warnings.push(...(run?.groundingWarnings || []));
      setReleaseReview({
        output,
        fingerprint,
        snapshot,
        warnings: [...new Set(warnings)],
        errors,
        historicalId,
      });
    } catch (cause) {
      handleError(cause);
    } finally {
      setSnapshotBusy(false);
    }
  }
  function confirmRelease() {
    if (!releaseReview || releaseReview.errors.length || readOnly) return;
    try {
      const current = latestDraft.current,
        selected = latestSelected.current;
      if (
        !current ||
        !selected ||
        current.id !== releaseReview.output.id ||
        reportFingerprint(selected) !== releaseReview.fingerprint ||
        (historical?.id || "") !== releaseReview.historicalId
      )
        throw new Error(
          "The selected report changed during release review. Review the latest version before releasing it.",
        );
      const revision: ReportRevision = {
        ...snapshotRevision(
          selected,
          revisionNote.trim() ||
            (historical
              ? `Released copy · ${historical.note}`
              : "Released revision"),
        ),
        pedigreeSnapshotId: releaseReview.snapshot.id,
        review: {
          checkedAt: new Date().toISOString(),
          warnings: releaseReview.warnings,
          acknowledged: true,
        },
      };
      updateOutput({
        ...current,
        revisions: [...(current.revisions || []), revision],
      });
      onRelease(current.id, revision.id);
      setReleaseReview(null);
      setRevisionNote("");
      setNotice(
        "The reviewed snapshot is now released. Further draft edits stay private.",
      );
    } catch (cause) {
      handleError(cause);
    }
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
      className={`release-workspace${readOnly ? " release-readonly" : ""}${inspectorOpen ? " has-inspector" : ""}`}
      aria-label="Releaser research workspace"
    >
      {!readOnly && releaseReview && (
        <Modal
          title="Review before release"
          subtitle="Citation location integrity and analytical quality are separate checks."
          wide
          onClose={() => setReleaseReview(null)}
        >
          {releaseReview.errors.length > 0 && (
            <div role="alert" className="release-review-errors">
              <h3>Citation integrity needs repair</h3>
              <ul>
                {releaseReview.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
              <p>Repair these references before release.</p>
            </div>
          )}
          <div className="release-review-list">
            <h3>
              {releaseReview.warnings.length
                ? "Limitations to acknowledge"
                : "Local completeness checks"}
            </h3>
            {releaseReview.warnings.length ? (
              <ul>
                {releaseReview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p>
                No local completeness warnings were found. This does not
                establish that the conclusions are true.
              </p>
            )}
          </div>
          <p>
            The second display receives only this report revision, its
            bibliography and any appendix you explicitly added. Analytical notes
            remain private.
          </p>
          <div className="modal-actions">
            <button type="button" onClick={() => setReleaseReview(null)}>
              Return to editing
            </button>
            <button
              type="button"
              className="button primary"
              disabled={Boolean(releaseReview.errors.length)}
              onClick={confirmRelease}
            >
              {releaseReview.warnings.length
                ? "Release with limitations"
                : "Release reviewed revision"}
            </button>
          </div>
        </Modal>
      )}
      {!readOnly && appendix && (
        <Modal
          title="Analytical pedigree appendix"
          subtitle="Review this content before appending it to the working draft."
          wide
          onClose={() => setAppendix(null)}
        >
          <div className="release-appendix-preview">
            <ReportEditor
              output={appendix.output}
              readOnly
              onChange={() => {}}
              onCitation={navigateCitation}
            />
          </div>
          <div className="modal-actions">
            <button type="button" onClick={() => setAppendix(null)}>
              Discard preview
            </button>
            <button
              type="button"
              className="button primary"
              onClick={appendReviewedContent}
            >
              Append to working draft
            </button>
          </div>
        </Modal>
      )}
      {!readOnly && (
        <dialog
          ref={composer}
          className="release-composer"
          aria-labelledby="new-report-heading"
          onCancel={() => setComposerOpen(false)}
          onClose={() => setComposerOpen(false)}
        >
          <div className="release-composer-top">
            <span>New report</span>
            <button
              type="button"
              aria-label="Close new report"
              onClick={() => setComposerOpen(false)}
            >
              <X size={18} />
            </button>
          </div>
          <div className="release-panel-heading">
            <h2 id="new-report-heading">What would you like to write?</h2>
            <p>
              Choose a format and direction. A new draft will use your included
              research and saved source passages.
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
          {kind === "project-plan" && (
            <DeliverablePlanFields
              project={project}
              research={research}
              pedigree={livePedigree}
              selectedOutput={selectedOutput}
              value={plan}
              onChange={setPlan}
            />
          )}
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
              onClick={() => {
                setComposerOpen(false);
                onSettings();
              }}
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
            disabled={
              analysisBusy ||
              !hasInput ||
              (kind === "project-plan" &&
                (!plan?.gap.trim() || !plan?.deliverable.trim()))
            }
          >
            {analysisBusy ? (
              <LoaderCircle className="release-spin" size={17} />
            ) : (
              <Sparkles size={17} />
            )}
            <span>
              {analysisBusy
                ? "Working with your evidence…"
                : offline
                  ? "Build evidence brief"
                  : "Generate document"}
            </span>
            {!analysisBusy && <ArrowUpRight size={17} />}
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
        </dialog>
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
          <div className="release-toolbar-actions">
            {!readOnly && (
              <button
                type="button"
                className="button quiet release-new"
                onClick={() => setComposerOpen(true)}
              >
                <Plus size={15} /> New report
              </button>
            )}
            {!readOnly && outputs.length > 0 && (
              <select
                className="release-report-switcher"
                aria-label="Current report"
                value={draft.id}
                onChange={(event) => {
                  flushReport();
                  setSelectedId(event.target.value);
                  setRevisionId("");
                  setNotice("");
                }}
              >
                {outputs.map((output) => (
                  <option value={output.id} key={output.id}>
                    {output.title}
                  </option>
                ))}
              </select>
            )}
            {!readOnly &&
              selectedOutput &&
              selectedOutput.kind !== "project-plan" && (
                <button
                  type="button"
                  className="button quiet"
                  onClick={planDeliverable}
                >
                  <Target size={15} /> Plan a deliverable
                </button>
              )}
            {selectedOutput && (
              <div className="release-export-actions">
                {!readOnly && (
                  <AddToBoardButton
                    reference={{
                      kind:
                        selectedOutput.kind === "project-plan"
                          ? "delivery-plan"
                          : "report",
                      id: selectedOutput.id,
                    }}
                  />
                )}
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
            <button
              type="button"
              className="release-inspector-toggle"
              aria-label="Reports and evidence"
              aria-pressed={inspectorOpen}
              onClick={() => setInspectorOpen(!inspectorOpen)}
              title="Reports and evidence"
            >
              <PanelRight size={17} />
            </button>
          </div>
        </header>
        {analysisBusy && !composerOpen && (
          <div className="release-background-job" role="status">
            <LoaderCircle size={15} className="release-spin" /> Creating a
            report from your evidence…{" "}
            <button type="button" onClick={() => setComposerOpen(true)}>
              View progress
            </button>
          </div>
        )}
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
          {!readOnly && pedigreeChanges.length > 0 && (
            <div className="release-message is-stale">
              <TriangleAlert size={15} />
              <span>
                Analytical basis changed: {pedigreeChanges.join(", ")}. This
                report retains its historical pedigree; reconsider affected
                findings.
              </span>
            </div>
          )}
          {!readOnly && Boolean(snapshotError || pedigreeError) && (
            <div className="release-message is-error">
              <span>
                {snapshotError ||
                  operationErrorMessage(
                    pedigreeError,
                    "Could not load analytical pedigree.",
                  )}
              </span>
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
          <div
            className="release-document-scroll"
            ref={documentScroll}
            onScroll={(event) => {
              scrollPositions.current[scrollKey] =
                event.currentTarget.scrollTop;
            }}
          >
            {!readOnly && (
              <div className="release-revision-bar">
                <label>
                  Version
                  <select
                    aria-label="Report version"
                    value={revisionId}
                    onChange={(event) => {
                      flushReport();
                      setRevisionId(event.target.value);
                    }}
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
                  disabled={Boolean(historical) || snapshotBusy}
                  onClick={() => void saveRevision()}
                >
                  Save revision
                </button>
                <button
                  type="button"
                  className="release-publish"
                  disabled={snapshotBusy}
                  onClick={() => void release()}
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
                onChange={updateOutput}
                onCitation={navigateCitation}
              />
              {selectedOutput.kind === "project-plan" && (
                <DeliveryPlanPanel
                  key={`${selectedOutput.id}-${revisionId}`}
                  output={selectedOutput}
                  projectId={project.id}
                  research={research}
                  pedigree={livePedigree}
                  readOnly={readOnly || Boolean(historical)}
                  onChange={async (value) => {
                    const current = latestDraft.current;
                    if (
                      current &&
                      current.id === value.id &&
                      !readOnly &&
                      !historical
                    ) {
                      const updated = {
                        ...current,
                        deliveryPlan: value.deliveryPlan,
                      };
                      await onPersistOutput(updated);
                      updateOutput(updated);
                    } else
                      throw new Error(
                        "The selected report changed. Reopen its saved work-package draft before applying it.",
                      );
                  }}
                  onError={handleError}
                />
              )}
              {!readOnly && !historical && research && (
                <ChallengeReview
                  key={selectedOutput.id}
                  project={project}
                  research={research}
                  target={{ kind: "report", id: selectedOutput.id }}
                  onError={handleError}
                  onSource={(sourceId, versionId, passageId) => {
                    const c = citations.find(
                      (c) =>
                        c.passageId === passageId && c.versionId === versionId,
                    );
                    if (c) navigateCitation(c);
                    else {
                      void window.acadia
                        ?.getPassage(passageId || "")
                        .then((p) =>
                          onCitation({
                            id: p.id,
                            label: "",
                            sourceId,
                            versionId: p.versionId,
                            passageId: p.id,
                            sourceTitle:
                              research.sources.find((s) => s.id === sourceId)
                                ?.title || sourceId,
                            locator: p.locator,
                            quote: p.text,
                            acquiredAt:
                              research.versions.find(
                                (v) => v.id === p.versionId,
                              )?.acquiredAt || "",
                            verified: p.method !== "legacy",
                          }),
                        )
                        .catch(handleError);
                    }
                  }}
                  onApplyChange={applyChallenge}
                />
              )}
              {!readOnly && !historical && (
                <div className="release-appendix-action">
                  <button
                    type="button"
                    disabled={snapshotBusy}
                    onClick={() => void previewAppendix()}
                  >
                    Preview analytical pedigree appendix
                  </button>
                  <p>
                    Append a reviewable record of methods, evidence quality,
                    reasoning and unresolved limitations.
                  </p>
                </div>
              )}
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
            {!readOnly && (
              <button
                type="button"
                className="button primary release-empty-create"
                onClick={() => setComposerOpen(true)}
              >
                <Plus size={16} /> Create first report
              </button>
            )}
            <div className="release-empty-footnote">
              {readOnly
                ? "Released snapshots appear here. Working drafts remain private."
                : "Every citation leads back to a saved source passage."}
            </div>
          </div>
        )}
      </div>
      {inspectorOpen && (
        <aside
          className="release-archive"
          aria-label="Saved outputs and evidence"
        >
          <div className="release-inspector-heading">
            <strong>Reports & evidence</strong>
            <button
              type="button"
              aria-label="Close report inspector"
              onClick={() => setInspectorOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
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
                      flushReport();
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
          {outline.length > 0 && (
            <nav
              className="release-archive-section release-outline"
              aria-label="Report outline"
            >
              <div className="release-sidebar-heading">
                <span className="eyebrow">OUTLINE</span>
              </div>
              {outline.map((heading, index) => (
                <button
                  type="button"
                  key={index}
                  className={heading.level > 1 ? "is-nested" : ""}
                  onClick={() => {
                    documentScroll.current
                      ?.querySelectorAll<HTMLElement>(
                        ".report-tiptap :is(h1,h2,h3,h4,h5,h6)",
                      )
                      [index]?.scrollIntoView({ block: "start" });
                  }}
                >
                  {heading.label}
                </button>
              ))}
            </nav>
          )}
          {!readOnly && (
            <div className="release-archive-section">
              {pedigreeSnapshot ? (
                <ReportPedigreePanel
                  snapshot={pedigreeSnapshot}
                  onCitation={navigateCitation}
                />
              ) : (
                <p className="release-evidence-empty">
                  {selectedOutput?.pedigreeSnapshotId
                    ? "Loading the saved analytical pedigree…"
                    : "No historical analytical pedigree is attached to this version. Save a revision to record the current research basis."}
                </p>
              )}
            </div>
          )}
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
                Saved source passages and provenance appear alongside each
                report.
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
      )}
    </section>
  );
}
export { Releaser };
