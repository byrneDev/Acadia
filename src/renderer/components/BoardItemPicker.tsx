import { useEffect, useMemo, useState } from "react";
import { Search, Plus, Upload, ArrowRight } from "lucide-react";
import type { CardKind, Project, ResearchCard } from "../../shared/types";
import type {
  Passage,
  ResearchState,
  SourceDetail,
} from "../../shared/research";
import {
  createMethodWorksheet,
  METHOD_REGISTRY,
  type MethodKind,
  type PedigreeState,
} from "../../shared/pedigree";
import type { BoardReference } from "../../shared/board";
import { Modal } from "./Dialogs";
import "./BoardItemPicker.css";

type CreateKind =
  | "brief"
  | "claim"
  | "assumption"
  | "task"
  | "gap"
  | "decision"
  | "report"
  | "delivery-plan";
type Choice = {
  id: string;
  label: string;
  group: string;
  detail: string;
  basic?: CardKind;
  upload?: CardKind;
  record?: BoardReference["kind"];
  method?: MethodKind;
  existingOnly?: boolean;
};
const choices: Choice[] = [
  {
    id: "brief",
    label: "Research brief / question",
    group: "Frame the investigation",
    detail: "Link the investigation question, scope and success criteria.",
    record: "brief",
  },
  {
    id: "note",
    label: "note",
    group: "Frame the investigation",
    detail: "Capture a free-form observation or idea.",
    basic: "note",
  },
  {
    id: "question",
    label: "question",
    group: "Frame the investigation",
    detail: "Place a standalone question on the board.",
    basic: "question",
  },
  {
    id: "hypothesis",
    label: "hypothesis",
    group: "Frame the investigation",
    detail: "Record an explanation to test; it remains unverified.",
    basic: "hypothesis",
  },
  {
    id: "source",
    label: "Existing source",
    group: "Collect sources",
    detail: "Link an original already saved in the source library.",
    record: "source",
    existingOnly: true,
  },
  {
    id: "link",
    label: "link",
    group: "Collect sources",
    detail:
      "Record a website address and your observations. Capture the page in Sources when ready.",
    basic: "link",
  },
  {
    id: "document",
    label: "Document",
    group: "Collect sources",
    detail: "Import a PDF, Word document or text file.",
    upload: "document",
  },
  {
    id: "image",
    label: "Image",
    group: "Collect sources",
    detail: "Import a photograph or illustration with its original file.",
    upload: "image",
  },
  {
    id: "audio",
    label: "Audio",
    group: "Collect sources",
    detail: "Import an audio file. Transcription is not automatic.",
    upload: "audio",
  },
  {
    id: "video",
    label: "Video",
    group: "Collect sources",
    detail: "Import a video file. Its content is not automatically analyzed.",
    upload: "video",
  },
  {
    id: "passage",
    label: "Exact source passage",
    group: "Collect sources",
    detail: "Place a saved passage with its exact historical source location.",
    record: "passage",
    existingOnly: true,
  },
  {
    id: "claim",
    label: "Finding / claim",
    group: "Examine evidence",
    detail:
      "Link a finding and its supporting, conflicting or contextual evidence.",
    record: "claim",
  },
  {
    id: "review",
    label: "Accepted Reviewer Notes",
    group: "Examine evidence",
    detail: "Link notes explicitly reviewed and accepted by the researcher.",
    record: "review",
    existingOnly: true,
  },
  {
    id: "assumption",
    label: "Assumption",
    group: "Examine evidence",
    detail: "Make a consequential assumption and its test visible.",
    record: "assumption",
  },
  ...METHOD_REGISTRY.map((entry): Choice => ({
    id: `method-${entry.kind}`,
    label: entry.label,
    group: "Apply methods",
    detail: entry.description,
    record: "method",
    method: entry.kind,
  })),
  {
    id: "gap",
    label: "Research gap",
    group: "Investigate gaps",
    detail: "Record missing information, why it matters and how to resolve it.",
    record: "gap",
  },
  {
    id: "task",
    label: "Research task",
    group: "Investigate gaps",
    detail: "Link follow-up work, completion criteria and resulting evidence.",
    record: "task",
  },
  {
    id: "decision",
    label: "Decision",
    group: "Decide and deliver",
    detail:
      "Record a decision, its rationale and conditions for reconsideration.",
    record: "decision",
  },
  {
    id: "delivery-plan",
    label: "Deliverable project plan",
    group: "Decide and deliver",
    detail:
      "Connect an analysis gap to software, curriculum or another deliverable.",
    record: "delivery-plan",
  },
  {
    id: "report",
    label: "Report",
    group: "Decide and deliver",
    detail: "Link an editable Releaser report; placement does not release it.",
    record: "report",
  },
];

export interface BoardItemPickerProps {
  project: Project;
  research: ResearchState;
  pedigree: PedigreeState;
  onClose(): void;
  onAddReference(
    reference: BoardReference,
    placement?: { tags: string[] },
  ): Promise<void>;
  onAddBasic(values: Partial<ResearchCard>): void;
  onImport(kind?: CardKind): void;
  onCreateRecord(
    kind: CreateKind,
    initial?: { title: string; content: string },
  ): void;
}

export function BoardItemPicker({
  project,
  research,
  pedigree,
  onClose,
  onAddReference,
  onAddBasic,
  onImport,
  onCreateRecord,
}: BoardItemPickerProps) {
  const [choiceId, setChoiceId] = useState("note");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<BoardReference>();
  const [sourceId, setSourceId] = useState("");
  const [versionId, setVersionId] = useState("");
  const [detail, setDetail] = useState<SourceDetail>();
  const [passageQuery, setPassageQuery] = useState("");
  const [found, setFound] = useState<Passage[] | undefined>();
  const [passagePage, setPassagePage] = useState(0);
  const [recordQuery, setRecordQuery] = useState("");
  const choice = choices.find((entry) => entry.id === choiceId)!;
  const visible = choices.filter((entry) =>
    `${entry.label} ${entry.detail} ${entry.group}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const sources = research.sources.filter((source) => !source.derived);
  useEffect(() => {
    let alive = true;
    setDetail(undefined);
    if (sourceId)
      window
        .acadia!.getSource(sourceId, versionId || undefined)
        .then((value) => {
          if (alive) setDetail(value);
        })
        .catch((error) => {
          if (alive) setError(String(error));
        });
    return () => {
      alive = false;
    };
  }, [project.id, sourceId, versionId]);
  const records = useMemo((): {
    reference: BoardReference;
    title: string;
    detail?: string;
  }[] => {
    const record = choice.record;
    if (record === "source")
      return sources.map((source) => ({
        reference: { kind: record, id: source.id },
        title: source.title,
        detail: source.kind,
      }));
    if (record === "brief")
      return pedigree.briefs.map((brief) => ({
        reference: { kind: record, id: brief.id },
        title: brief.question || "Research brief",
        detail: brief.scope,
      }));
    if (record === "claim" || record === "review")
      return research.claims
        .filter((claim) => Boolean(claim.itemReview) === (record === "review"))
        .map((claim) => ({
          reference: { kind: record, id: claim.id },
          title: claim.title,
          detail: claim.status,
        }));
    if (record === "assumption")
      return pedigree.assumptions.map((assumption) => ({
        reference: { kind: record, id: assumption.id },
        title: assumption.statement,
        detail: assumption.status,
      }));
    if (record === "task")
      return research.tasks.map((task) => ({
        reference: { kind: record, id: task.id },
        title: task.title,
        detail: task.status,
      }));
    if (record === "method")
      return pedigree.methods
        .filter((method) => method.kind === choice.method)
        .map((method) => ({
          reference: { kind: record, id: method.id },
          title: method.title,
          detail: method.objective,
        }));
    if (record === "gap" || record === "decision")
      return pedigree[record === "gap" ? "gaps" : "decisions"].map((entry) => ({
        reference: { kind: record, id: entry.id },
        title: entry.title,
      }));
    if (record === "report" || record === "delivery-plan")
      return project.outputs
        .filter(
          (output) =>
            (output.kind === "project-plan") === (record === "delivery-plan"),
        )
        .map((output) => ({
          reference: { kind: record, id: output.id },
          title: output.title,
          detail: output.kind,
        }));
    return [];
  }, [choice, project.outputs, research, pedigree]);
  function choose(next: Choice) {
    setChoiceId(next.id);
    setMode(next.existingOnly ? "existing" : "new");
    setError("");
    setTitle("");
    setContent("");
    setUrl("");
    setTags("");
    setCreated(undefined);
    setFound(undefined);
    setRecordQuery("");
  }
  async function place(reference: BoardReference) {
    setBusy(true);
    setError("");
    try {
      await onAddReference(reference);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "The record could not be placed. It remains saved in its workspace.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (busy) return;
    if (choice.method) {
      setBusy(true);
      try {
        const reference = created || {
          kind: "method" as const,
          id: (
            await window.acadia!.saveMethod({
              ...createMethodWorksheet(project.id, choice.method),
              title: title.trim() || choice.label,
              objective: content,
            })
          ).id,
        };
        setCreated(reference);
        await onAddReference(reference, {
          tags: tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean)
            .slice(0, 20),
        });
      } catch (error) {
        setError(
          `${error instanceof Error ? error.message : "Could not add this worksheet."} If the worksheet was saved, retry here to place that same record.`,
        );
      } finally {
        setBusy(false);
      }
      return;
    }
    if (choice.basic) {
      if (!title.trim()) return;
      if (choice.basic === "link") {
        try {
          if (!["http:", "https:"].includes(new URL(url).protocol))
            throw new Error();
        } catch {
          setError("Enter a complete http:// or https:// link.");
          return;
        }
      }
      onAddBasic({
        kind: choice.basic,
        title: title.trim(),
        content,
        ...(choice.basic === "link" ? { url } : {}),
        tags: tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 20),
      });
    } else if (choice.record)
      onCreateRecord(choice.record as CreateKind, { title, content });
  }
  const shownPassages = found || detail?.passages || [];
  const lastPassagePage = Math.max(0, Math.ceil(shownPassages.length / 50) - 1);
  const visiblePassagePage = Math.min(passagePage, lastPassagePage);
  useEffect(() => {
    setPassagePage(0);
  }, [sourceId, versionId, found]);
  return (
    <Modal
      title="Add to the Collector"
      subtitle="Choose the record that fits your research. Linked items stay connected to their workspace."
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="board-item-picker">
        <aside className="board-item-categories" aria-label="Item types">
          <label className="board-picker-search">
            <Search size={16} />
            <input
              aria-label="Search item types"
              placeholder="Search items…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {[...new Set(visible.map((entry) => entry.group))].map((group) => (
            <section key={group}>
              <h3>{group}</h3>
              {visible
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    aria-pressed={entry.id === choice.id}
                    aria-label={entry.label}
                    disabled={busy}
                    onClick={() => choose(entry)}
                  >
                    {entry.basic
                      ? entry.label[0].toUpperCase() + entry.label.slice(1)
                      : entry.label}
                  </button>
                ))}
            </section>
          ))}
          {!visible.length && <p>No matching item types.</p>}
        </aside>
        <section
          className="board-picker-detail"
          aria-label="Selected item type"
        >
          <h3>{choice.label}</h3>
          <p>{choice.detail}</p>
          {choice.record && !choice.existingOnly && (
            <div className="board-picker-modes" aria-label="Create or link">
              <button
                type="button"
                aria-pressed={mode === "new"}
                disabled={busy}
                onClick={() => setMode("new")}
              >
                Create new
              </button>
              <button
                type="button"
                aria-pressed={mode === "existing"}
                disabled={busy}
                onClick={() => setMode("existing")}
              >
                Use existing
              </button>
            </div>
          )}
          {choice.upload ? (
            <div>
              <p>
                Import keeps the original file and reports any extraction limits
                in Sources.
              </p>
              <button
                className="button primary"
                onClick={() => onImport(choice.upload)}
              >
                <Upload size={16} />
                Import {choice.label.toLowerCase()}
              </button>
            </div>
          ) : mode === "existing" && choice.record ? (
            <>
              {choice.record === "passage" ? (
                <>
                  <label className="field">
                    Source
                    <select
                      aria-label="Source"
                      value={sourceId}
                      disabled={busy}
                      onChange={(event) => {
                        setSourceId(event.target.value);
                        setVersionId("");
                        setFound(undefined);
                      }}
                    >
                      <option value="">Choose a saved source</option>
                      {sources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {detail && (
                    <label className="field">
                      Source version
                      <select
                        aria-label="Source version"
                        value={versionId || detail.source.currentVersionId}
                        disabled={busy}
                        onChange={(event) => {
                          setVersionId(event.target.value);
                          setFound(undefined);
                        }}
                      >
                        {detail.versions.map((version) => (
                          <option key={version.id} value={version.id}>
                            {new Date(version.acquiredAt).toLocaleString()} ·{" "}
                            {version.status}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <form
                    className="board-picker-passage-search"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      setBusy(true);
                      setError("");
                      try {
                        setFound(
                          sourceId
                            ? (detail?.passages || []).filter((passage) =>
                                `${passage.locator} ${passage.text}`
                                  .toLowerCase()
                                  .includes(passageQuery.trim().toLowerCase()),
                              )
                            : await window.acadia!.searchSources(passageQuery),
                        );
                      } catch (error) {
                        setError(String(error));
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    <input
                      aria-label="Find an exact passage"
                      value={passageQuery}
                      disabled={busy}
                      onChange={(event) => {
                        setPassageQuery(event.target.value);
                        setFound(undefined);
                        setPassagePage(0);
                      }}
                      placeholder={
                        sourceId
                          ? "Search the selected source version"
                          : "Search current source versions"
                      }
                    />
                    <button
                      className="button quiet"
                      disabled={
                        busy ||
                        !passageQuery.trim() ||
                        Boolean(sourceId && !detail)
                      }
                    >
                      Search passages
                    </button>
                  </form>
                  <div className="board-picker-records">
                    {shownPassages
                      .slice(
                        visiblePassagePage * 50,
                        (visiblePassagePage + 1) * 50,
                      )
                      .map((passage) => (
                        <button
                          disabled={busy}
                          key={passage.id}
                          onClick={() =>
                            void place({
                              kind: "passage",
                              id: passage.id,
                              versionId: passage.versionId,
                            })
                          }
                        >
                          <strong>
                            {
                              sources.find(
                                (source) => source.id === passage.sourceId,
                              )?.title
                            }{" "}
                            · {passage.locator}
                          </strong>
                          <span>{passage.text.slice(0, 320)}</span>
                        </button>
                      ))}
                  </div>
                  {shownPassages.length > 0 && (
                    <div className="board-picker-pagination">
                      <button
                        type="button"
                        className="button quiet"
                        disabled={!visiblePassagePage}
                        onClick={() => setPassagePage(visiblePassagePage - 1)}
                      >
                        Previous passages
                      </button>
                      <span>
                        Passages {visiblePassagePage * 50 + 1}–
                        {Math.min(
                          (visiblePassagePage + 1) * 50,
                          shownPassages.length,
                        )}{" "}
                        of {shownPassages.length}
                      </span>
                      <button
                        type="button"
                        className="button quiet"
                        disabled={visiblePassagePage >= lastPassagePage}
                        onClick={() => setPassagePage(visiblePassagePage + 1)}
                      >
                        Next passages
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="board-picker-records">
                  <label className="field">
                    Find saved records
                    <input
                      value={recordQuery}
                      onChange={(event) => setRecordQuery(event.target.value)}
                    />
                  </label>
                  {records
                    .filter((record) =>
                      `${record.title} ${record.detail || ""}`
                        .toLowerCase()
                        .includes(recordQuery.toLowerCase()),
                    )
                    .map((record) => (
                      <button
                        type="button"
                        key={`${record.reference.kind}:${record.reference.id}`}
                        disabled={busy}
                        onClick={() => void place(record.reference)}
                      >
                        <strong>{record.title}</strong>
                        {record.detail && <span>{record.detail}</span>}
                        <small>
                          Add to board <ArrowRight size={13} />
                        </small>
                      </button>
                    ))}
                  {!records.length && (
                    <p>
                      No saved {choice.label.toLowerCase()} available.{" "}
                      {choice.existingOnly
                        ? "Create or review it in its research workspace first."
                        : "Use Create new to begin."}
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <form onSubmit={submit}>
              {!choice.basic && !choice.method && (
                <p className="board-picker-explanation">
                  Continue to the research editor to create and save this
                  record. Then use Add to board there; an unfinished draft is
                  never placed as a completed record.
                </p>
              )}
              {(choice.basic || choice.method) && (
                <>
                  <label className="field">
                    Title
                    <input
                      aria-label="Title"
                      required={Boolean(choice.basic)}
                      maxLength={300}
                      value={title}
                      disabled={busy || Boolean(created)}
                      placeholder={
                        choice.method
                          ? choice.label
                          : "Give this item a clear title"
                      }
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  </label>
                  {choice.basic === "link" && (
                    <label className="field">
                      Source URL
                      <input
                        type="url"
                        required
                        value={url}
                        onChange={(event) => setUrl(event.target.value)}
                      />
                    </label>
                  )}
                  <label className="field">
                    {choice.method
                      ? "Worksheet objective"
                      : choice.basic === "hypothesis"
                        ? "Working hypothesis"
                        : "Notes & observations"}
                    <textarea
                      rows={5}
                      maxLength={100000}
                      value={content}
                      disabled={busy || Boolean(created)}
                      onChange={(event) => setContent(event.target.value)}
                    />
                  </label>
                  {(choice.basic || choice.method) && (
                    <label className="field">
                      Tags <span className="muted">separate with commas</span>
                      <input
                        value={tags}
                        maxLength={500}
                        onChange={(event) => setTags(event.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              <button className="button primary" disabled={busy}>
                <Plus size={16} />
                {busy
                  ? "Adding…"
                  : choice.method
                    ? "Add worksheet to board"
                    : choice.basic
                      ? "Add item"
                      : "Continue to editor"}
              </button>
            </form>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {busy && <p role="status">Saving your board placement…</p>}
        </section>
      </div>
    </Modal>
  );
}
export default BoardItemPicker;
