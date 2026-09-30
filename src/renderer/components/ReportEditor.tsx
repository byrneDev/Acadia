import { useEffect, useRef, useState } from "react";
import { Node as TiptapNode } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import type {
  Citation,
  ReportDocument,
  SectionProposal,
} from "../../shared/research";
import type { ResearchOutput } from "../../shared/types";
import {
  canApplySection,
  markdownToReport,
  mergeCitations,
  reportCitations,
  reportDocument,
  reportToMarkdown,
} from "../../shared/report";
import "./ReportEditor.css";
import { PassageCitationPicker } from "./PassageCitationPicker";

export const CitationNode = TiptapNode.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { citationId: { default: "" }, label: { default: "?" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-acadia-citation]",
        getAttrs: (element) => ({
          citationId: element.getAttribute("data-acadia-citation"),
          label: element.getAttribute("data-label"),
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        "data-acadia-citation": node.attrs.citationId,
        "data-label": node.attrs.label,
        class: "report-citation",
        role: "button",
        tabindex: "0",
        title: "Open saved source passage",
      },
      `[${node.attrs.label}]`,
    ];
  },
  renderText({ node }) {
    return `[${node.attrs.label}]`;
  },
});

interface Props {
  output: ResearchOutput;
  readOnly?: boolean;
  onChange: (output: ResearchOutput) => void;
  onCitation: (citation: Citation) => void;
}
interface Selection {
  from: number;
  to: number;
  text: string;
  snapshot: string;
}

export default function ReportEditor({
  output,
  readOnly = false,
  onChange,
  onCitation,
}: Props) {
  const current = useRef({ output, onChange, onCitation });
  current.current = { output, onChange, onCitation };
  const [selection, setSelection] = useState<Selection | null>(null);
  const [instructions, setInstructions] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [proposal, setProposal] = useState<SectionProposal | null>(null);
  const [citationId, setCitationId] = useState("");
  const [citationPicker, setCitationPicker] = useState(false);
  const citationInsertion = useRef<
    { from: number; to: number; snapshot: string } | undefined
  >(undefined);
  const requestedSelection = useRef<Selection | null>(null);
  const mounted = useRef(true);
  const revisionsCitations = useRef<Citation[] | null>(null);
  const lastDocument = useRef(output.document);
  const markdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingMarkdown = useRef<ReportDocument | null>(null);

  const flushMarkdown = () => {
    if (markdownTimer.current) clearTimeout(markdownTimer.current);
    markdownTimer.current = null;
    const document = pendingMarkdown.current;
    pendingMarkdown.current = null;
    const latest = current.current.output;
    // A newer revision or externally replaced document always wins.
    if (!document || latest.document !== document) return;
    const markdown = reportToMarkdown(document, reportCitations(latest));
    if (markdown === latest.markdown) return;
    const next = { ...latest, markdown };
    current.current.output = next;
    current.current.onChange(next);
  };

  const openCitation = (id: string) => {
    const citation = reportCitations(current.current.output).find(
      (entry) => entry.id === id,
    );
    if (citation) current.current.onCitation(citation);
  };
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          link: {
            openOnClick: false,
            autolink: false,
            protocols: ["http", "https"],
          },
        }),
        TableKit.configure({ table: { resizable: true } }),
        CitationNode,
      ],
      content: reportDocument(output),
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: "release-markdown report-tiptap",
          "aria-label": readOnly
            ? "Released report"
            : "Editable research report",
          spellcheck: "true",
        },
        handleClick: (_view, _position, event) => {
          const target = (event.target as Element)?.closest(
            "[data-acadia-citation]",
          );
          if (target) {
            openCitation(target.getAttribute("data-acadia-citation") || "");
            return true;
          }
          const link = (event.target as Element)?.closest("a");
          if (link) {
            event.preventDefault();
            if (/^https?:\/\//i.test(link.getAttribute("href") || ""))
              void window.acadia
                ?.openExternal(link.getAttribute("href")!)
                .catch(() => setError("The link could not be opened."));
            return true;
          }
          return false;
        },
        handleKeyDown: (_view, event) => {
          if (event.key !== "Enter" && event.key !== " ") return false;
          const target = (event.target as Element)?.closest(
            "[data-acadia-citation]",
          );
          if (target) {
            event.preventDefault();
            openCitation(target.getAttribute("data-acadia-citation") || "");
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: updated }) => {
        const document = updated.getJSON() as ReportDocument;
        const citations =
          revisionsCitations.current || reportCitations(current.current.output);
        revisionsCitations.current = null;
        const next = {
          ...current.current.output,
          document,
          citations,
          // Structured content is canonical and is saved immediately. Markdown
          // is a derived export cache; batching it avoids walking a long report
          // on every keystroke. Export/revision boundaries also derive it fresh.
          markdown: current.current.output.markdown,
        };
        lastDocument.current = document;
        pendingMarkdown.current = document;
        current.current.output = next;
        current.current.onChange(next);
        if (markdownTimer.current) clearTimeout(markdownTimer.current);
        markdownTimer.current = setTimeout(flushMarkdown, 350);
      },
      onBlur: flushMarkdown,
      onSelectionUpdate: ({ editor: updated }) => {
        const { from, to } = updated.state.selection;
        if (from === to) return;
        setSelection({
          from,
          to,
          text: updated.state.doc.textBetween(from, to, "\n", (node) =>
            node.type.name === "citation" ? `[${node.attrs.label}]` : "",
          ),
          snapshot: JSON.stringify(updated.getJSON()),
        });
      },
    },
    [output.id, readOnly],
  );

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      flushMarkdown();
    };
  }, []);
  useEffect(() => {
    if (!editor) return;
    if (output.document && output.document === lastDocument.current) return;
    const document = reportDocument(output);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(document)) {
      pendingMarkdown.current = null;
      if (markdownTimer.current) clearTimeout(markdownTimer.current);
      markdownTimer.current = null;
      editor.commands.setContent(document, { emitUpdate: false });
    }
    lastDocument.current = output.document;
  }, [editor, output.document, output.markdown]);

  useEffect(() => {
    if (!editor || readOnly) return;
    const command = (event: Event) => {
      if (!editor.view.dom.contains(document.activeElement)) return;
      const action = (event as CustomEvent<string>).detail;
      if (action === "undo") editor.commands.undo();
      if (action === "redo") editor.commands.redo();
    };
    const flush = () => flushMarkdown();
    window.addEventListener("acadia:editor-command", command);
    window.addEventListener("acadia:flush-report", flush);
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("acadia:editor-command", command);
      window.removeEventListener("acadia:flush-report", flush);
      window.removeEventListener("beforeunload", flush);
    };
  }, [editor, readOnly]);

  useEffect(() => {
    if (!jobId || !window.acadia) return;
    let active = true;
    const refresh = async () => {
      try {
        const state = await window.acadia!.researchState();
        if (!active) return;
        const job = state.jobs.find((entry) => entry.id === jobId);
        if (!job) return;
        setStatus(job.message || job.status);
        if (job.status === "completed") {
          setProposal(job.result as SectionProposal);
          setJobId(null);
        }
        if (job.status === "failed" || job.status === "cancelled") {
          setError(job.message);
          setJobId(null);
        }
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Revision status is unavailable.",
          );
      }
    };
    const unsubscribe = window.acadia.onResearchChanged(() => void refresh());
    void refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [jobId]);

  async function requestRevision() {
    if (!selection || !editor || !window.acadia || jobId) return;
    setError("");
    setProposal(null);
    if (JSON.stringify(editor.getJSON()) !== selection.snapshot) {
      setError(
        "The selected passage changed. Select it again before requesting a revision.",
      );
      return;
    }
    const original = editor.state.doc.textBetween(
      selection.from,
      selection.to,
      "\n",
      (node) => (node.type.name === "citation" ? `[${node.attrs.label}]` : ""),
    );
    if (
      !canApplySection(
        editor.getJSON(),
        selection.snapshot,
        original,
        selection.text,
      )
    ) {
      setError(
        "The selected passage changed. Select it again before requesting a revision.",
      );
      return;
    }
    requestedSelection.current = selection;
    setStatus("Preparing section revision…");
    try {
      const job = await window.acadia.reviseSection(
        output.id,
        selection.text,
        instructions.trim(),
      );
      if (mounted.current) setJobId(job.id);
    } catch (cause) {
      if (mounted.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not revise the section.",
        );
        setStatus("");
      }
    }
  }

  function applyProposal() {
    const requested = requestedSelection.current;
    if (!editor || !proposal || !requested) return;
    if (JSON.stringify(editor.getJSON()) !== requested.snapshot) {
      setError(
        "This report changed while the revision was prepared. Select the passage again to avoid replacing newer work.",
      );
      return;
    }
    const original = editor.state.doc.textBetween(
      requested.from,
      Math.min(requested.to, editor.state.doc.content.size),
      "\n",
      (node) => (node.type.name === "citation" ? `[${node.attrs.label}]` : ""),
    );
    if (
      !canApplySection(
        editor.getJSON(),
        requested.snapshot,
        original,
        requested.text,
      ) ||
      proposal.original !== requested.text
    ) {
      setError(
        "This report changed while the revision was prepared. Select the passage again to avoid replacing newer work.",
      );
      return;
    }
    const citations = mergeCitations(
      reportCitations(output),
      proposal.citations || [],
    );
    const replacement = markdownToReport(
      proposal.proposed,
      proposal.citations || [],
    );
    // Relabel citation nodes against the merged, stable report bibliography.
    const relabel = (node: ReportDocument) => {
      if (node.type === "citation")
        node.attrs = {
          ...node.attrs,
          label: String(
            citations.findIndex(
              (entry) => entry.id === node.attrs?.citationId,
            ) + 1,
          ),
        };
      node.content?.forEach(relabel);
    };
    relabel(replacement);
    revisionsCitations.current = citations;
    const content =
      replacement.content?.length === 1 &&
      replacement.content[0].type === "paragraph"
        ? replacement.content[0].content || []
        : replacement.content || [];
    const applied = editor
      .chain()
      .focus()
      .insertContentAt({ from: requested.from, to: requested.to }, content)
      .run();
    if (!applied) {
      revisionsCitations.current = null;
      setError(
        "This selection could not be replaced. Select a complete passage and request the revision again.",
      );
      return;
    }
    setProposal(null);
    setSelection(null);
    setStatus("Revision applied only to the selected passage.");
  }

  if (!editor) return null;
  const citations = reportCitations(output);
  return (
    <div className="report-editor">
      {!readOnly && (
        <>
          <div
            className="report-editor-tools"
            role="toolbar"
            aria-label="Report formatting"
          >
            <button
              type="button"
              onClick={() => {
                citationInsertion.current = {
                  from: editor.state.selection.from,
                  to: editor.state.selection.to,
                  snapshot: JSON.stringify(editor.getJSON()),
                };
                setCitationPicker(true);
              }}
            >
              Cite source passage
            </button>
            <button
              type="button"
              aria-label="Heading 1"
              aria-pressed={editor.isActive("heading", { level: 1 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 1 }).run()
              }
            >
              H1
            </button>
            <button
              type="button"
              aria-label="Heading 2"
              aria-pressed={editor.isActive("heading", { level: 2 })}
              onClick={() =>
                editor.chain().focus().toggleHeading({ level: 2 }).run()
              }
            >
              H2
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().setParagraph().run()}
            >
              Text
            </button>
            <button
              type="button"
              aria-pressed={editor.isActive("bold")}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <b>Bold</b>
            </button>
            <button
              type="button"
              aria-pressed={editor.isActive("italic")}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <i>Italic</i>
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleBulletList().run()}
            >
              • List
            </button>
            <button
              type="button"
              onClick={() => editor.chain().focus().toggleOrderedList().run()}
            >
              1. List
            </button>
            <button
              type="button"
              onClick={() =>
                editor
                  .chain()
                  .focus()
                  .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
            >
              Table
            </button>
            {editor.isActive("table") && (
              <>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().addRowAfter().run()}
                >
                  + Row
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().addColumnAfter().run()}
                >
                  + Column
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().deleteTable().run()}
                >
                  Remove table
                </button>
              </>
            )}
            <button
              type="button"
              aria-label="Undo report edit"
              onClick={() => editor.chain().focus().undo().run()}
            >
              Undo
            </button>
            <button
              type="button"
              aria-label="Redo report edit"
              onClick={() => editor.chain().focus().redo().run()}
            >
              Redo
            </button>
            {citations.length > 0 && (
              <span className="report-citation-tools">
                <select
                  aria-label="Insert source citation"
                  value={citationId}
                  onChange={(event) => setCitationId(event.target.value)}
                >
                  <option value="">Choose citation…</option>
                  {citations.map((citation, index) => (
                    <option key={citation.id} value={citation.id}>
                      [{index + 1}] {citation.sourceTitle} · {citation.locator}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={!citationId}
                  onClick={() =>
                    editor
                      .chain()
                      .focus()
                      .insertContent({
                        type: "citation",
                        attrs: {
                          citationId,
                          label: String(
                            citations.findIndex(
                              (entry) => entry.id === citationId,
                            ) + 1,
                          ),
                        },
                      })
                      .run()
                  }
                >
                  Insert
                </button>
              </span>
            )}
          </div>
          {citationPicker && (
            <PassageCitationPicker
              onClose={() => setCitationPicker(false)}
              onSelect={(citation) => {
                const insertion = citationInsertion.current;
                if (
                  !insertion ||
                  insertion.snapshot !== JSON.stringify(editor.getJSON())
                ) {
                  setError(
                    "The report changed while choosing a citation. Place the cursor again and reopen the citation picker.",
                  );
                  setCitationPicker(false);
                  return;
                }
                const merged = mergeCitations(
                  reportCitations(current.current.output),
                  [citation],
                );
                revisionsCitations.current = merged;
                const inserted = editor
                  .chain()
                  .focus()
                  .insertContentAt(insertion.to, {
                    type: "citation",
                    attrs: {
                      citationId: citation.id,
                      label: String(
                        merged.findIndex((entry) => entry.id === citation.id) +
                          1,
                      ),
                    },
                  })
                  .run();
                if (!inserted) {
                  revisionsCitations.current = null;
                  setError(
                    "The citation could not be inserted here. Place the cursor in a paragraph and retry.",
                  );
                } else
                  setStatus(
                    "Exact historical passage citation added. Review whether it supports your writing.",
                  );
                setCitationPicker(false);
              }}
            />
          )}
          <details className="report-section-tools">
            <summary>AI revision of selected text</summary>
            <p>
              Select text in the report, describe the change, then review the
              proposal before applying it.
            </p>
            {selection && (
              <blockquote>
                {selection.text.slice(0, 320)}
                {selection.text.length > 320 ? "…" : ""}
              </blockquote>
            )}
            <textarea
              aria-label="Section revision instructions"
              placeholder="Strengthen the explanation, compare alternatives, or clarify limitations…"
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              maxLength={8000}
            />
            <button
              type="button"
              disabled={
                !selection ||
                !instructions.trim() ||
                Boolean(jobId) ||
                !window.acadia
              }
              onClick={() => void requestRevision()}
            >
              Propose revision
            </button>
            {jobId && (
              <button
                type="button"
                onClick={() =>
                  void window.acadia
                    ?.cancelJob(jobId)
                    .catch((cause) => setError(String(cause)))
                }
              >
                Cancel revision
              </button>
            )}
            {status && <p role="status">{status}</p>}
            {error && <p role="alert">{error}</p>}
            {proposal && (
              <div className="report-proposal">
                <h3>Review section revision</h3>
                <div className="report-proposal-columns">
                  <div>
                    <strong>Original</strong>
                    <pre>{proposal.original}</pre>
                  </div>
                  <div>
                    <strong>Proposed</strong>
                    <pre>{proposal.proposed}</pre>
                  </div>
                </div>
                <button type="button" onClick={applyProposal}>
                  Apply to selected text
                </button>
                <button type="button" onClick={() => setProposal(null)}>
                  Discard proposal
                </button>
              </div>
            )}
          </details>
        </>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
