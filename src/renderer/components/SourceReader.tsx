import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, X, Sparkles } from "lucide-react";
import type { Project, ResearchCard } from "../../shared/types";
import type {
  Inclusion,
  ResearchClaim,
  ResearchState,
  SourceDetail,
  Passage,
} from "../../shared/research";
import { Modal } from "./Dialogs";
import { OriginalPageComparison } from "./OriginalPageComparison";
import { SourcePedigree } from "./PedigreeWorkspace";
import { ReviewerNotes } from "./ReviewerNotes";
import { AddToBoardButton, useBoardMapping } from "./BoardMappingContext";
import {
  PASSAGES_PER_PAGE,
  clampPassagePage,
  passagePage,
  readEvidenceDraft,
  saveEvidenceDraft,
  type EvidenceDraft,
} from "./workspaceViewState";

const api = () => window.acadia!;
export function Policy({
  value,
  onChange,
  label,
}: {
  value: Inclusion;
  onChange: (p: Inclusion) => void;
  label: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as Inclusion)}
    >
      <option value="include">Include</option>
      <option value="pin">Pin in analysis</option>
      <option value="exclude">Exclude</option>
    </select>
  );
}

export function SourceReader({
  sourceId,
  versionId,
  passageId,
  research,
  project,
  onClose,
  onError,
  onBoard,
  onNavigate,
  onSummarize,
  readOnly = false,
  embedded = false,
}: {
  sourceId: string;
  versionId?: string;
  passageId?: string;
  research: ResearchState;
  project: Project;
  onClose: () => void;
  onError: (e: unknown) => void;
  onBoard?: (card: Partial<ResearchCard>) => void;
  onNavigate?: (
    sourceId: string,
    versionId?: string,
    passageId?: string,
  ) => void;
  onSummarize?: (sourceId: string, versionId?: string) => void;
  readOnly?: boolean;
  embedded?: boolean;
}) {
  const boardMapping = useBoardMapping();
  const [detail, setDetail] = useState<SourceDetail>();
  const [version, setVersion] = useState(versionId);
  const [draft, setDraft] = useState<EvidenceDraft>();
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [discardConfirmation, setDiscardConfirmation] = useState(false);
  const [page, setPage] = useState(0);
  const [jump, setJump] = useState("");
  const [comparison, setComparison] = useState<Passage>();
  useEffect(() => setComparison(undefined), [sourceId, versionId, version]);
  const body = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const versionSelect = useRef<HTMLSelectElement>(null);
  const capture = useRef<HTMLFormElement>(null);
  const trigger = useRef(document.activeElement as HTMLElement | null);
  const restoreOnClose = useRef(false);
  const focusedRequest = useRef("");
  const manualVersionChange = useRef(false);
  const navigationRequest = JSON.stringify([sourceId, versionId, passageId]);
  useEffect(() => {
    const origin = document.activeElement;
    // A second citation in the same source reuses this reader instance.
    // Remember its live origin before moving focus into the new passage.
    if (
      origin instanceof HTMLElement &&
      origin !== document.body &&
      origin.isConnected &&
      !origin.closest(".source-reader-panel, .source-reader") &&
      origin.matches(
        "button,a[href],input,select,textarea,[tabindex],[contenteditable=true]",
      )
    )
      trigger.current = origin;
  }, [navigationRequest]);
  useEffect(
    () => () => {
      if (!embedded || !restoreOnClose.current) return;
      const target = trigger.current;
      requestAnimationFrame(() => {
        if (target?.isConnected && !document.querySelector("dialog[open]"))
          target.focus({ preventScroll: true });
      });
    },
    [embedded],
  );
  function closeReader() {
    restoreOnClose.current = true;
    onClose();
  }
  const activeVersion = version || detail?.source.currentVersionId;
  const versionsSignature = JSON.stringify(
    research.versions.filter((v) => v.sourceId === sourceId),
  );
  const sourcePolicy = research.sources.find(
    (s) => s.id === sourceId,
  )?.inclusion;
  useEffect(() => {
    let alive = true;
    setLoadError("");
    api()
      .getSource(sourceId, version)
      .then((d) => {
        if (alive) setDetail(d);
      })
      .catch((e) => {
        if (!alive) return;
        // A changed release can revoke access to a previously visible passage.
        // Never leave the last successful response visible behind an error.
        setDetail(undefined);
        setDraft(undefined);
        setLoadError(
          e instanceof Error ? e.message : "Could not load this source.",
        );
        onError(e);
      });
    return () => {
      alive = false;
    };
  }, [sourceId, version, versionsSignature, sourcePolicy]);
  useEffect(() => {
    if (!activeVersion) return;
    setDraft(
      readOnly
        ? undefined
        : readEvidenceDraft(project.id, sourceId, activeVersion),
    );
  }, [project.id, sourceId, activeVersion, readOnly]);
  useEffect(() => {
    if (detail) setPage(passagePage(detail.passages, passageId));
  }, [detail?.source.id, activeVersion, passageId]);
  const visiblePage = clampPassagePage(page, detail?.passages.length || 0);
  useEffect(() => {
    if (!detail) return;
    if (manualVersionChange.current) {
      manualVersionChange.current = false;
      versionSelect.current?.focus({ preventScroll: true });
      return;
    }
    if (focusedRequest.current === navigationRequest) return;
    const hasTarget =
      passageId && detail.passages.some((p) => p.id === passageId);
    if (hasTarget && visiblePage !== passagePage(detail.passages, passageId))
      return;
    const frame = requestAnimationFrame(() => {
      const target = hasTarget
        ? document.getElementById(`passage-${passageId}`)
        : heading.current;
      if (!target) return;
      if (hasTarget) target.scrollIntoView({ block: "center" });
      if (embedded) target.focus({ preventScroll: true });
      focusedRequest.current = navigationRequest;
    });
    return () => cancelAnimationFrame(frame);
  }, [detail, passageId, visiblePage, embedded, navigationRequest]);
  const v = detail?.versions.find((entry) => entry.id === activeVersion);
  function updateDraft(next?: EvidenceDraft) {
    const draftVersion =
      next?.passage.versionId || draft?.passage.versionId || activeVersion;
    if (draftVersion)
      saveEvidenceDraft(project.id, sourceId, draftVersion, next);
    setDraft(next);
  }
  function continueDraft() {
    if (!draft || !detail) return;
    setPage(passagePage(detail.passages, draft.passage.id));
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        capture.current?.scrollIntoView({ block: "nearest" }),
      ),
    );
  }
  async function saveEvidence() {
    if (!draft || saving) return;
    const existing = research.claims.find((c) => c.id === draft.claimId);
    if (draft.claimId && !existing) {
      setNotice(
        "This claim is no longer available. Choose another claim or create a new one.",
      );
      return;
    }
    if (!existing && !draft.title.trim()) return;
    const claim: ResearchClaim = existing
      ? { ...existing, links: [...existing.links] }
      : {
          id: crypto.randomUUID(),
          projectId: project.id,
          title: draft.title.trim(),
          question: project.question,
          status: "unreviewed",
          alternatives: "",
          limitations: "",
          links: [],
          updatedAt: new Date().toISOString(),
        };
    claim.links.push({
      id: crypto.randomUUID(),
      passageId: draft.passage.id,
      quote: draft.quote,
      relation: draft.relation,
      rationale: draft.rationale,
    });
    claim.updatedAt = new Date().toISOString();
    setSaving(true);
    try {
      await api().saveClaim(claim);
      updateDraft(undefined);
      setNotice("Passage linked to evidence.");
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  }
  const captureForm = draft && !readOnly && (
    <form
      className="evidence-capture"
      ref={capture}
      onSubmit={(e) => {
        e.preventDefault();
        void saveEvidence();
      }}
    >
      <h3>Link evidence</h3>
      <p className="muted">
        {draft.passage.locator} · This private draft is saved on this computer.
        Save evidence link to apply it to the investigation.
      </p>
      <blockquote>{draft.quote}</blockquote>
      <label className="field">
        Claim
        <select
          value={draft.claimId}
          onChange={(e) => updateDraft({ ...draft, claimId: e.target.value })}
        >
          <option value="">Create a new claim</option>
          {research.claims.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </label>
      {!draft.claimId && (
        <label className="field">
          Claim to examine
          <input
            required
            value={draft.title}
            onChange={(e) => updateDraft({ ...draft, title: e.target.value })}
          />
        </label>
      )}
      <label className="field">
        Relationship
        <select
          value={draft.relation}
          aria-label="Relationship"
          onChange={(e) =>
            updateDraft({
              ...draft,
              relation: e.target.value as EvidenceDraft["relation"],
            })
          }
        >
          <option value="supports">Supports</option>
          <option value="contradicts">Contradicts</option>
          <option value="context">Context only</option>
        </select>
      </label>
      <label className="field">
        Researcher assessment
        <textarea
          value={draft.rationale}
          onChange={(e) => updateDraft({ ...draft, rationale: e.target.value })}
          placeholder="Why does this passage support or challenge the claim?"
        />
      </label>
      <div className="modal-actions">
        <button
          type="button"
          className="button quiet"
          disabled={saving}
          onClick={() => setDiscardConfirmation(true)}
        >
          Discard draft…
        </button>
        <button
          className="button primary"
          disabled={saving || (!draft.claimId && !draft.title.trim())}
        >
          {saving ? "Saving…" : "Save evidence link"}
        </button>
      </div>
      {discardConfirmation && (
        <div role="group" aria-label="Confirm discard evidence draft">
          <p>Discard this unfinished evidence link?</p>
          <button type="button" onClick={() => setDiscardConfirmation(false)}>
            Keep editing
          </button>
          <button
            type="button"
            onClick={() => {
              updateDraft(undefined);
              setDiscardConfirmation(false);
            }}
          >
            Discard evidence draft
          </button>
        </div>
      )}
    </form>
  );
  const pagination = detail && detail.passages.length > PASSAGES_PER_PAGE && (
    <nav className="reader-pagination" aria-label="Source passages">
      <div>
        <button
          className="icon-button"
          aria-label="Previous passages"
          disabled={!visiblePage}
          onClick={() => {
            setPage(visiblePage - 1);
            body.current?.scrollTo({ top: 0 });
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <span>
          {visiblePage * PASSAGES_PER_PAGE + 1}–
          {Math.min(
            (visiblePage + 1) * PASSAGES_PER_PAGE,
            detail.passages.length,
          )}{" "}
          of {detail.passages.length} passages
        </span>
        <button
          className="icon-button"
          aria-label="Next passages"
          disabled={
            (visiblePage + 1) * PASSAGES_PER_PAGE >= detail.passages.length
          }
          onClick={() => {
            setPage(visiblePage + 1);
            body.current?.scrollTo({ top: 0 });
          }}
        >
          <ChevronRight size={16} />
        </button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const index = Math.max(
            0,
            Math.min(detail.passages.length - 1, Number(jump) - 1),
          );
          setPage(Math.floor(index / PASSAGES_PER_PAGE));
          requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              document
                .getElementById(`passage-${detail.passages[index]?.id}`)
                ?.scrollIntoView({ block: "center" }),
            ),
          );
        }}
      >
        <input
          type="number"
          min="1"
          max={detail.passages.length}
          required
          aria-label="Passage number"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          placeholder="Passage"
        />
        <button className="text-button">Go</button>
      </form>
    </nav>
  );
  const content = (
    <div className="source-reader" ref={body}>
      {!readOnly && comparison && (
        <OriginalPageComparison
          passage={comparison}
          sourceTitle={detail?.source.title || "Source"}
          onClose={() => setComparison(undefined)}
        />
      )}
      {loadError && (
        <p role="alert" className="reader-load-error">
          {loadError}
        </p>
      )}
      {!detail && !loadError && <p role="status">Opening saved source…</p>}
      {detail && (
        <>
          <div className="reader-controls">
            <label>
              Version
              <select
                ref={versionSelect}
                aria-label="Source version"
                value={activeVersion}
                onChange={(e) => {
                  manualVersionChange.current = true;
                  setVersion(e.target.value);
                  setDetail(undefined);
                  setDraft(undefined);
                  setNotice("");
                }}
              >
                {detail.versions.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {new Date(entry.acquiredAt).toLocaleString()} ·{" "}
                    {entry.method} · {entry.status}
                  </option>
                ))}
              </select>
            </label>
            {!readOnly && (
              <label>
                Source use
                <Policy
                  value={detail.source.inclusion}
                  label="Source inclusion"
                  onChange={(p) =>
                    api().setSourcePolicy(sourceId, p).catch(onError)
                  }
                />
              </label>
            )}
            {(v?.assetId || detail.source.assetId) && (
              <button
                className="button quiet"
                onClick={() =>
                  api()
                    .openAsset(v?.assetId || detail.source.assetId!)
                    .catch(onError)
                }
              >
                Open original
              </button>
            )}
            {!readOnly && boardMapping && (
              <AddToBoardButton
                reference={{
                  kind: "source",
                  id: sourceId,
                  versionId: activeVersion,
                }}
              />
            )}
            {!readOnly &&
              !boardMapping &&
              onBoard &&
              !project.cards.some(
                (c) => c.sourceId === sourceId || c.id === detail.source.cardId,
              ) && (
                <button
                  className="button quiet"
                  onClick={() =>
                    onBoard({
                      title: detail.source.title,
                      kind: detail.source.kind === "web" ? "link" : "document",
                      sourceId,
                      assetId: detail.source.assetId,
                      url: detail.source.url,
                      content: "",
                    })
                  }
                >
                  Add to board
                </button>
              )}
          </div>
          {!readOnly && onSummarize && (
            <button
              className="button quiet item-insight-trigger"
              onClick={() => onSummarize(sourceId, activeVersion)}
            >
              <Sparkles size={16} />
              AI summary & research advice
            </button>
          )}
          {!readOnly && onNavigate && (
            <ReviewerNotes
              displayedVersionId={activeVersion}
              claims={research.claims.filter(
                (claim) => claim.itemReview?.sourceId === sourceId,
              )}
              onCitation={(citation) =>
                onNavigate(
                  citation.sourceId,
                  citation.versionId,
                  citation.passageId,
                )
              }
            />
          )}
          <div className={`coverage ${v?.status === "ready" ? "" : "warning"}`}>
            <strong>
              {v?.status.toUpperCase()} · {v?.processedUnits}/{v?.totalUnits}{" "}
              units processed · {v?.method} text
            </strong>
            <span>
              {v?.error || "Passages retain their source version and location."}
            </span>
            {detail.source.duplicateOf && (
              <span>
                Duplicate content: this source is not independent corroboration.
              </span>
            )}
            <details className="source-provenance">
              <summary>Source details and extraction</summary>
              <small>
                {[v?.author, v?.publisher, v?.publishedAt]
                  .filter(Boolean)
                  .join(" · ")}{" "}
                · acquired{" "}
                {v?.acquiredAt && new Date(v.acquiredAt).toLocaleString()}
                <br />
                SHA-256: {v?.hash}
              </small>
              {!readOnly && (
                <div className="reader-controls">
                  <button
                    className="button quiet"
                    onClick={() =>
                      api().reprocessSource(sourceId, false).catch(onError)
                    }
                  >
                    Retry native extraction / recapture
                  </button>
                  <button
                    className="button quiet"
                    onClick={() =>
                      api().reprocessSource(sourceId, true).catch(onError)
                    }
                  >
                    Run English OCR
                  </button>
                </div>
              )}
            </details>
            {!readOnly && v?.status === "needs-ocr" && (
              <button
                className="button quiet"
                onClick={() =>
                  api().reprocessSource(sourceId, true).catch(onError)
                }
              >
                Run English OCR
              </button>
            )}
          </div>
          {!readOnly && activeVersion && (
            <SourcePedigree
              project={project}
              research={research}
              sourceId={sourceId}
              versionId={activeVersion}
              onError={onError}
              onSource={onNavigate}
            />
          )}
          {notice && (
            <p role="status" className="reader-notice">
              {notice}
            </p>
          )}
          {draft && (
            <div className="reader-draft-notice">
              <span>Unfinished evidence link · {draft.passage.locator}</span>
              <button className="text-button" onClick={continueDraft}>
                Continue editing
              </button>
            </div>
          )}
          {!readOnly && (
            <p className="muted">
              Select text within a passage, then choose “Use selection as
              evidence”. You can also cite the whole passage.
            </p>
          )}
          {pagination}
          <div className="passage-list">
            {detail.passages
              .slice(
                visiblePage * PASSAGES_PER_PAGE,
                (visiblePage + 1) * PASSAGES_PER_PAGE,
              )
              .map((p) => (
                <article
                  id={`passage-${p.id}`}
                  tabIndex={-1}
                  className={`source-passage ${passageId === p.id ? "citation-target" : ""} ${p.inclusion === "exclude" ? "excluded" : ""}`}
                  key={p.id}
                >
                  <div className="passage-heading">
                    <strong>{p.locator}</strong>
                    <span>
                      {p.method === "ocr"
                        ? "OCR — verify against original"
                        : p.method}
                    </span>
                    {!readOnly && (
                      <Policy
                        label={`Inclusion ${p.locator}`}
                        value={p.inclusion}
                        onChange={(inclusion) =>
                          api()
                            .setPassagePolicy(p.id, inclusion)
                            .then(() =>
                              setDetail(
                                (d) =>
                                  d && {
                                    ...d,
                                    passages: d.passages.map((entry) =>
                                      entry.id === p.id
                                        ? { ...entry, inclusion }
                                        : entry,
                                    ),
                                  },
                              ),
                            )
                            .catch(onError)
                        }
                      />
                    )}
                  </div>
                  <p className="passage-text">{p.text}</p>
                  {!readOnly &&
                    p.page &&
                    (v?.assetId || detail.source.assetId) && (
                      <button
                        className="text-button"
                        onClick={() => setComparison(p)}
                      >
                        Compare original page {p.page}
                      </button>
                    )}
                  {!readOnly && (
                    <AddToBoardButton
                      reference={{
                        kind: "passage",
                        id: p.id,
                        versionId: p.versionId,
                      }}
                      label="Add passage to board"
                    />
                  )}
                  {!readOnly && (
                    <button
                      className="text-button"
                      onClick={(e) => {
                        if (draft) {
                          setNotice(
                            "Finish or discard your unfinished evidence link before selecting another passage.",
                          );
                          continueDraft();
                          return;
                        }
                        const selected = window.getSelection();
                        const textElement = e.currentTarget
                          .closest("article")
                          ?.querySelector(".passage-text");
                        const inside =
                          textElement &&
                          selected?.anchorNode &&
                          selected.focusNode &&
                          textElement.contains(selected.anchorNode) &&
                          textElement.contains(selected.focusNode);
                        const quote = inside ? selected.toString().trim() : "";
                        updateDraft({
                          passage: p,
                          quote:
                            quote && p.text.includes(quote) ? quote : p.text,
                          claimId: "",
                          title: "",
                          relation: "supports",
                          rationale: "",
                        });
                        setNotice("");
                        requestAnimationFrame(() =>
                          capture.current?.scrollIntoView({ block: "nearest" }),
                        );
                      }}
                    >
                      Use selection as evidence
                    </button>
                  )}
                  {draft?.passage.id === p.id && captureForm}
                </article>
              ))}
          </div>
          {!detail.passages.length && (
            <p className="research-empty">
              No extracted passages are available.{" "}
              {v?.status === "processing" || v?.status === "queued"
                ? "Extraction is in progress."
                : "Retry extraction, run OCR, or add a manual excerpt as a note."}
            </p>
          )}
        </>
      )}
    </div>
  );
  if (embedded)
    return (
      <aside
        className="source-reader-panel"
        aria-label="Source reader"
        onKeyDown={(e) => {
          if (
            e.key === "Escape" &&
            !e.defaultPrevented &&
            (e.target as HTMLElement).tagName !== "SELECT"
          ) {
            e.preventDefault();
            e.stopPropagation();
            closeReader();
          }
        }}
      >
        <header className="source-reader-panel-head">
          <div>
            <span className="eyebrow">Saved source passage</span>
            <h2 ref={heading} tabIndex={-1}>
              {detail?.source.title || "Source reader"}
            </h2>
          </div>
          <button
            className="icon-button"
            onClick={closeReader}
            aria-label="Close source reader"
            title={
              draft
                ? "Close reader; keep unfinished evidence link for this session"
                : "Close source reader"
            }
          >
            <X size={18} />
          </button>
        </header>
        {content}
      </aside>
    );
  return (
    <Modal
      title={detail?.source.title || "Loading source…"}
      subtitle="Immutable source version · passage reader"
      onClose={closeReader}
      wide
    >
      {content}
    </Modal>
  );
}
