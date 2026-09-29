# Acadia — quick start

Acadia connects a research question to saved evidence, researcher assessments, and an editable report. The application keeps the RND Portal appearance. The Collector is your research workspace; the Releaser develops reports and presents explicitly released revisions.

Download the package for your platform from [GitHub Releases](https://github.com/byrneDev/Acadia/releases). For Ubuntu 24.04 x64 installation and troubleshooting, see [Acadia on Ubuntu](LINUX.md). Consult the release notes for the validation status of your exact build.

## Start an investigation

Use the menu beside the project title to create a research board, open the **Project library**, import a portable `.acadia` project, or export one. Investigations stay in a local SQLite database. Switching projects does not require an export. Click the title to define the question and decision you want to investigate.

An optional fictional sample, `Library-hours-sample.acadia`, accompanies the release. Its survey favors later opening, its pilot provides counterevidence, and its missing information prevents a confident recommendation. It is a training example, not a real study.

## Collector views

- **Board:** arrange cards, draw meaningful connections, organize research areas, and save a view of the canvas. Use the hand tool, trackpad pan/pinch, or fit controls on a large display. Board undo/redo does not reverse changes in evidence records or reports.
- **Sources:** import PDF, DOCX, and text documents; capture a public website; search complete extracted passages. Open a source to inspect its version, acquisition date, content hash, extraction coverage, and page or paragraph locations. Highlight text inside a passage and choose **Use selection as evidence**. The original attachment opens as a viewing copy.
- **Evidence:** record a claim, link support and contradictions, assess alternative explanations, and identify limitations. You decide whether evidence supports a claim. Verified quotations confirm their saved location, not the truth of a conclusion.
- **Tasks:** link a follow-up to a question or evidence gap. Record a status, optional due date, completion criterion, and resulting evidence sources.
- **Ask & analyze:** ask the included collection a question with citations, inspect analysis history, or review proposed board connections. Accept or reject each suggestion.
- **Discover:** prepare and review external search queries. Nothing is searched until you approve the displayed plan. Accept selected candidates into the source library; use **Add to board** when you want a visual card.

Use Include, Pin, or Exclude for each source or passage. Pin relevant material that must be examined. Searches cover the indexed collection, while each model request has a finite passage/context budget disclosed in its limitations. Duplicated file content does not become independent corroboration.

## Extraction and local OCR

Imports run in the background. The activity strip shows progress, failures, and cancellation. Failed and scanned extraction is visibly distinguished from ready text. The reader provides retry and **Run English OCR**. PDF pages are rendered before local Tesseract recognition; the English language data ships with the application. No OCR service or model download is required.

Every reprocessing creates a new source version. Earlier citations keep their original passages. OCR passages are labeled so you can verify them against the original. An empty result may indicate a blank or unreadable page. Partial extraction never means the whole source was analyzed.

Public web capture stores a dated, sanitized, readable snapshot and paragraph locations. It does not log into sites or run page scripts. For inaccessible, login-dependent, or unsuitable pages, import a PDF or add a note with the excerpt and source URL. Audio/video transcription and quantitative dataset analysis are outside this release.

## Analysis privacy and optional connections

Open **Research engine settings**. Each project explicitly uses **Local** or **Cloud** analysis. Local mode supports the offline outline engine or a model at a loopback address. Cloud mode requires a selected provider endpoint and model. Acadia never silently falls back to a cloud service.

The offline engine organizes retrieved evidence and limitations; it does not infer conclusions. For AI synthesis, run your own Ollama model or enter a compatible chat-completions endpoint. Acadia does not install a language model. Model responses must follow the requested citation structure; an unsupported response is reported as a failure rather than applied.

When you initiate model analysis, the selected question, instructions, and retrieved included passages go to the configured provider. Keys stay outside project exports. Saved analysis credentials use the operating system's secure storage when available and otherwise remain session-only. Saving a Brave Search key requires usable secure storage; Acadia reports an error if it is unavailable. Saved keys are not returned to the interface's settings. Keep your own provider's costs and retention settings in mind.

Brave Search is independent of analysis. Add an optional Brave Search API key in Discover. An approved plan permits at most five queries and twenty candidate captures; further searches require another reviewed plan. Without a key, review suggested queries, search manually, and capture selected URLs. Query strings are shown before transmission.

## Write and release a report

In **Releaser**, choose a decision brief, hypothesis, research plan, whitepaper, gap analysis, or needs analysis. Build an evidence brief or generate an AI draft. Edit headings, paragraphs, lists, tables, and persistent numbered citations directly. Click a citation to open its exact saved passage.

Select a section and request an AI revision. Acadia previews the proposal before applying it. Other writing and citations stay intact. If the selected text changed while a revision ran, select it again. Offline mode cannot perform AI revisions.

Draft edits save automatically. **Save revision** records a snapshot. **Save & release** explicitly selects a snapshot for the Releaser display. You can release an older saved revision from the history selector. Later private edits remain in the Collector window until you release again. Changes to cited sources flag the report for reconsideration while preserving the older evidence behind its citations.

Export **DOCX** for an editable Word document, **PDF** for print, or **Markdown** for text workflows. All three use the report structure and retain numbered citations, source locators, a bibliography, and the report's stated limitations.

## Displays, portability, and recovery

Connect your monitor or TV through your operating system, select **Open display**, then choose the screen. The second window is read-only and starts empty until a report is explicitly released. Touch/trackpad board navigation is supported; verify your physical touchscreen and mixed-DPI setup before a live presentation.

The app saves locally and waits for the Collector's final save on close. Interrupted background work is marked for explicit retry at the next launch. The first migration backs up the legacy JSON and attachment manifest before its database transaction. Original files remain separate from database records.

Version 2 `.acadia` exports include source versions, historical passages, original attachments, evidence, tasks, report revisions, and analysis provenance. They exclude credentials and rebuildable search indexes. Importing a project already in the library replaces that investigation after saving a recovery archive. Old card-level citations remain labeled until source originals are reprocessed; existing reports retain their legacy references.

Each attachment is limited to 250 MB and portable archives to approximately 1 GB. These are storage safety limits, not leading-text or page-count cutoffs. Recovery archives and old source versions consume disk space; keep separate backups before managing application data.
