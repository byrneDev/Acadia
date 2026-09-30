# Acadia v1 release candidate — quick start

Acadia connects a research question to saved evidence, researcher assessments, and an editable report. The desktop interface retains the Acadia logo and lime accent while following the operating system’s appearance. The Collector is your research workspace; the Releaser develops reports and presents explicitly released revisions.

**This guide describes 1.0.0-rc.1 source behavior. V0.5.0 remains the published release; see [v1 validation](VALIDATION-v1.0.md) for candidate checks and pending production gates.**

Download the package for your platform from [GitHub Releases](https://github.com/byrneDev/Acadia/releases). For Ubuntu 24.04 x64 installation and troubleshooting, see [Acadia on Ubuntu](LINUX.md). Consult the release notes for the validation status of your exact build.

## Start an investigation

Use the project switcher and menu in the navigation sidebar to create a research board, open the **Project library**, import a portable `.acadia` project, or export one. Investigations stay in a local SQLite database. Switching projects does not require an export. Click the title to define the question and decision you want to investigate.

In **Workspace guide**, create either a fictional software or curriculum practice investigation. Each is separate from your current project and includes conflicting observations, an unreviewed finding, an open gap, follow-up work, a proposed decision and a draft deliverable. No model call or human acceptance is manufactured.

An optional fictional sample, `Library-hours-sample.acadia`, accompanies the release. Its survey favors later opening, its pilot provides counterevidence, and its missing information prevents a confident recommendation. It is a training example, not a real study.

## Desktop controls

**Appearance** in the sidebar offers System, Light, and Dark themes and comfortable, compact, or touch-sized controls. Navigation can collapse, and the navigation and source-reader dividers can be dragged or adjusted with arrow keys while focused. Desktop preferences and view positions stay on this computer; they are not part of portable research archives.

Use **Cmd/Ctrl+K** for commands and **Cmd/Ctrl+F** to search the investigation. The platform menu lists shortcuts for importing, opening projects, and presenting. Undo/redo follows the focused board or editor. In the focused board, **F** fits the view, **C** starts a connection from a selected item, and **Shift+F10** opens board actions. Arrow keys move selected board items in 10-unit steps; hold Shift for 40-unit steps. Editing text fields keeps their normal keyboard behavior. **Board items** reveals the optional list without confusing board cards with the Sources library.

The board remembers its position. Releaser remembers the selected report/revision, instructions, and scroll position. Private research drafts show save/recovery/conflict status and remain separate from explicitly saved records. Use the editor’s Save action to apply an assessment, or explicitly discard the buffer. Drafts are flushed before a project switch or normal close; a failed save keeps the workspace open for recovery. Source and passage searches use pages with total counts; citation links retain the exact historical passage.

## Collector views

- **Board:** arrange cards, draw meaningful connections, organize research areas, and save a view of the canvas. Use the hand tool, trackpad pan/pinch, or fit controls on a large display. Board undo/redo does not reverse changes in evidence records or reports.
- **Sources:** import PDF, DOCX, and text documents; capture a public website; search complete extracted passages. Open a source to inspect its version, acquisition date, content hash, extraction coverage, and page or paragraph locations. Highlight text inside a passage and choose **Use selection as evidence**. The original attachment opens as a viewing copy.
- **Evidence:** record a claim, link support and contradictions, assess alternative explanations, and identify limitations. You decide whether evidence supports a claim. Verified quotations confirm their saved location, not the truth of a conclusion.
- **Tasks:** link a follow-up to a question or evidence gap. Record a status, optional due date, completion criterion, and resulting evidence sources.
- **Gaps & decisions:** record missing information, resolution criteria, related tasks, proposed actions, alternatives and linked deliverables. Status changes remain deliberate researcher edits.
- **Ask & analyze:** ask the included collection a question with citations, inspect analysis history, or review proposed board connections. Accept or reject each suggestion.
- **Discover:** prepare and review external search queries. Nothing is searched until you approve the displayed plan. Accept selected candidates into the source library; use **Add to board** when you want a visual card.

Use Include, Pin, or Exclude for each source or passage. Pin relevant material that must be examined. Searches cover the indexed collection, while each model request has a finite passage/context budget disclosed in its limitations. Duplicated file content does not become independent corroboration.

**Add item** groups searchable choices by the research-to-delivery workflow. Use **Create new** to open the appropriate workspace, or **Use existing** to place a saved record. Accepted Reviewer Notes and exact passages must come from existing records. Each workspace also provides **Add to board**; repeating that action focuses the existing placement. Double-click a linked card or use **Open** in its inspector to edit the record. Removing the card leaves the record saved. See the [board mapping guide](RESEARCH-TO-DELIVERY.md) for the complete set of items.

## Extraction and local OCR

Imports run in the background. The activity strip shows progress, failures, and cancellation. Failed and scanned extraction is visibly distinguished from ready text. The reader provides retry and **Run English OCR**. PDF pages are rendered before local Tesseract recognition; the English language data ships with the application. No OCR service or model download is required.

Every reprocessing creates a new source version. Earlier citations keep their original passages. OCR passages are labeled. **Compare with original page** displays the saved PDF page beside the extracted text so you can inspect numbers, wording and omissions. An empty result may indicate a blank or unreadable page. Partial extraction never means the whole source was analyzed.

Public web capture stores a dated, sanitized, readable snapshot and paragraph locations. It does not log into sites or run page scripts. For inaccessible, login-dependent, or unsuitable pages, import a PDF or add a note with the excerpt and source URL. Audio/video transcription and quantitative dataset analysis are outside this release.

## Analysis privacy and optional connections

Open **Research engine settings**. Each project explicitly uses **Local** or **Server or cloud** analysis. A remote server through an SSH tunnel still requires the server/cloud choice. Local mode supports the offline outline engine or a model at a loopback address. Server/cloud mode requires a selected provider endpoint and model. Acadia never silently falls back to a cloud service.

**Find installed models** queries a local Ollama service only when clicked. **Test connection** checks the model inventory without submitting research or generating text; it does not verify generation or billing availability. **Test synthetic generation** separately checks a small fictional arithmetic response using the chosen model; it sends no research passages and does not establish analysis quality. Credential status shows secure/session-only/absent storage, and explicit removal controls clear saved keys. Named connection presets remember the endpoint, model, and privacy choice without API keys. A different authenticated connection may require entering its key again.

The offline engine organizes retrieved evidence and limitations; it does not infer conclusions. For AI synthesis, run your own Ollama model or enter a compatible chat-completions endpoint. Acadia does not install a language model. Model responses must follow the requested citation structure; an unsupported response is reported as a failure rather than applied.

When you initiate model analysis, the selected question, instructions, and retrieved included passages go to the configured provider. Keys stay outside project exports. Saved analysis credentials use the operating system's secure storage when available and otherwise remain session-only. Saving a Brave Search key requires usable secure storage; Acadia reports an error if it is unavailable. Saved keys are not returned to the interface's settings. Keep your own provider's costs and retention settings in mind.

Brave Search is independent of analysis. Add an optional Brave Search API key in Discover. An approved plan permits at most five queries and twenty candidate captures; further searches require another reviewed plan. Without a key, review suggested queries, search manually, and capture selected URLs. Query strings are shown before transmission.

## Write and release a report

In **Releaser**, select **New report**, then choose a decision brief, hypothesis, research plan, whitepaper, gap analysis, or needs analysis. The report composer opens automatically when there are no reports. Build an evidence brief or generate an AI draft. Edit headings, paragraphs, lists, tables, and persistent numbered citations directly. **Cite source passage** inserts an exact saved reference into your own writing without AI. Click a citation to open its historical passage beside the report. **Reports and evidence** shows the report library, outline, and source index when needed.

Select a section and request an AI revision. Acadia previews the proposal before applying it. Other writing and citations stay intact. If the selected text changed while a revision ran, select it again. Offline mode cannot perform AI revisions.

Draft edits save automatically. **Save revision** records a snapshot. **Save & release** explicitly selects a snapshot for the Releaser display. You can release an older saved revision from the history selector. Later private edits remain in the Collector window until you release again. Changes to cited sources flag the report for reconsideration while preserving the older evidence behind its citations.

Export **DOCX** for an editable Word document, **PDF** for print, or **Markdown** for text workflows. All three use the report structure and retain numbered citations, source locators, a bibliography, and the report's stated limitations.

## Displays, portability, and recovery

Connect your monitor or TV through your operating system, select **Present**, then choose the screen. The second window is read-only and starts empty until a report is explicitly released. Touch/trackpad board navigation is supported; verify your physical touchscreen and mixed-DPI setup before a live presentation.

The app saves locally and waits for the Collector's final save on close. Interrupted background work is marked for explicit retry at the next launch. The first migration backs up the legacy JSON and attachment manifest before its database transaction. Original files remain separate from database records.

The v1 candidate writes version 5 `.acadia` archives, including linked board references, gap and decision revisions, source versions, historical passages, originals, evidence, tasks, reports and analytical pedigree. **Opening v5 requires Acadia v1.0 or a v1 prerelease**; v0.5 cannot read it. Versions 1–4 remain importable with missing assessments initially unassessed. Archives include private draft buffers and exclude credentials and rebuildable search indexes. Importing a project already in the library replaces that investigation after saving a recovery archive. Old card-level citations remain labeled until originals are reprocessed; existing reports retain their legacy references. A missing linked record remains visibly unavailable on the board.

Each attachment is limited to 250 MB. Portable archives also limit each stored entry, including research history, to 250 MB; board/report JSON to 50 MB; the attachment catalog to 5 MB; originals to 5,000 files; and total expanded/compressed size to 1 GB. Export applies the same limits as import. If historical snapshots or originals exceed them, use a checked whole-library backup before splitting the investigation. These are storage safety limits, not leading-text or page-count cutoffs. Recovery archives and old source versions consume disk space; keep separate backups before managing application data.

## Item summaries and human review

For any collected card, use its sparkle button or select **AI summary & research advice** in its details. In the source reader, the same action reviews the selected saved version. Choose **Summarize & advise** to use the project's configured model. Opening the dialog alone does not call AI.

The saved response explains the item, possible uses in your investigation, limitations, and suggested next steps. References open the exact passages used. Long documents use a distributed passage sample with coverage shown; unreadable media or uncaptured websites require extracted text, notes, or a transcript. A linked source passage summarizes that exact historical passage. A method, finding or other analytical record is labeled as researcher work, not another independent source. Advice never changes your notes, review status, board connections, or tasks automatically. Summary history remains available after restarting and in portable project exports. Changed linked records prompt review or regeneration; excluded sources and passages remain excluded.

Under **Review and accept**, edit the proposed **Reviewer Notes** and inspect their numbered source references. Confirm **I have reviewed these notes and their source references**, then choose **Accept into Reviewer Notes**. The accepted text appears in the item's Reviewer Notes field and in Evidence as a dated, linked record. Original item notes and the AI proposal are preserved. Acceptance records your interpretation with context links; it does not automatically mark the claim supported or count it as another independent source. Each saved AI summary can be accepted once, and later accepted summaries add separate entries. Accepted notes and their historical references survive restart and portable export/import. Unaccepted review drafts are saved privately; accepting them remains an explicit human action.

## Research methods and delivery

The methods, GUI refresh, deliverable planning and data exports introduced in v0.4 remain available. Start in Research brief, appraise sources in their reader, then assess findings and assumptions in Evidence. Under **Add item → Apply methods**, choose a method and **Add worksheet to board**, then select its card and **Open worksheet**. The same worksheets remain available in Methods. Challenge analysis is an explicit optional AI action. In Releaser, preview the analytical pedigree appendix and review limitations before release.

After an analysis, choose **Plan a deliverable** for software, curriculum or another intervention. Link saved gaps and findings by revision, record a requirement or learning objective for each work package, define its acceptance test and attach verification passages. Review the PMIS mapping preview; retain destination IDs before repeating an import. Completing work never automatically resolves the research gap. **Close — keep draft** preserves private plan edits; **Save work packages** applies them to the report. Project menu → Export data for Power BI creates linked local CSV tables and import guidance. See [Research methods](RESEARCH-METHODS.md), [PMIS handoff](PMIS-HANDOFF.md), [Power BI](POWER-BI.md), and [v1 validation](VALIDATION-v1.0.md).

## Maintain this installation

Open **Backup, recovery and updates** from the Project menu. **Create backup…** creates a checked whole-library copy with originals and private drafts, excluding credentials. **Restore a checked backup…** validates a selected backup, preserves the current workspace and restarts Acadia. Keep an independent copy on another disk; a same-disk recovery folder is not disaster recovery.

A manual update check reads public GitHub release metadata only and offers the matching download; it never installs anything. Export redacted diagnostics for support when useful, reviewing the visible contents first. See [Recovery](RECOVERY.md) for the exact backup, restore and failure behavior. Physical device checks, real PMIS/Power BI imports and production signing remain separately recorded acceptance work.
