# Changelog

Acadia follows a 0.x early-access release series. Entries describe application changes; platform validation is recorded separately in each release. Earlier versions were distributed as local development packages before the public repository.

## 0.4.0

- Added versioned research briefs, source appraisals, confirmed shared origins, finding assessments and an assumptions register. Citation integrity, evidence support and qualitative confidence remain separate.
- Added competing-hypotheses, SWOT, root-cause, risk and technology-readiness worksheets with shared evidence, assumptions and gap tasks.
- Exposed all five research methods in the Collector's Add item dialog; each creates a linked board card with an Open worksheet action.
- Added explicit Challenge analysis, validated review proposals, balanced retrieval with omission records, and quotation checks associated with the cited reference.
- Added historical pedigree inspection, editable analytical appendices, release limitation review, reproducible sanitized model inputs and portable archive format v3 with recoverable migration.
- Added deliverable project plans for software, curriculum and other interventions; editable work packages export to Monday/Jira CSV and Planner integration packages.
- Added linked Power BI research-data tables, a data dictionary and relationship/import guidance.

- Reworked the desktop workspace around a compact navigation sidebar, contextual source reader, and document-first Releaser. Retained the approved Acadia identity and explicit released-display boundary.
- Added System/Light/Dark appearance, comfortable/compact/touch controls, platform menus and shortcuts, command search, investigation search, and restored window geometry with display-disconnection recovery.
- Preserved board viewport and report editing context across view changes; added keyboard board connections and bounded source-reader pages that retain exact historical citation navigation.
- Added named connection presets without credentials, deliberate model inventory checks, and explicit local-versus-server/cloud setup guidance.
- Coalesced research refreshes and moved derived Markdown serialization out of the typing path while retaining synchronous report-document updates and save-on-close protections.
- Added native GUI regression coverage. Native Windows/Ubuntu, assistive-technology, and physical touchscreen/mixed-display acceptance remain separate from automated macOS checks.

## 0.3.0

### Added

- Ubuntu 24.04 x64 packaging targets for Debian packages and AppImage distributions.
- Public repository documentation for development, support, security reporting, contribution, architecture, and release preparation.
- Cross-platform release preparation and a documented path for native package validation.

### Fixed

- Preserved canvas card measurements during selection and research updates, preventing an intermittent blank board after closing item details.
- Restricted audience-window APIs to the selected released revision and its historical citation passages. Unreleased source versions, uncited text, private project metadata, and original attachments stay in the Collector. A native regression covers the API, citation reader, attachment protocol, and release revocation.

This release establishes a public distribution baseline. It does not imply a completed independent security review or validation of every target device. Consult the release assets and validation notes for the builds actually provided.

## 0.2.3

- Adopted the approved Acadia app icon and full stacked logo.
- Applied the icon to the compact header and favicon, and the full logo to the loading screen and Workspace guide.
- Updated application packaging to use the approved icon artwork.

## 0.2.2

- Simplified the model response contract: Acadia resolves numbered references to saved passages and constructs authoritative citation records and bibliography.
- Retained rejection of unknown references and detected unsupported literal quotations; automatic quotation detection is not exhaustive.
- Improved Ollama structured-output and context-budget handling.
- Made failed generation clearly identify the retained previous report and hide Electron transport-wrapper text.
- Validated a live local-model report and navigation back to its saved source passages; details are in [Local AI](docs/LOCAL-AI.md).

## 0.2.1

- Improved local Ollama integration, response budgeting, and long-running request handling.
- Added local-model setup and troubleshooting guidance.

## 0.2.0

- Added the local project library, SQLite storage, FTS5 search, immutable source versions, and located source passages.
- Added complete supported-document extraction, background jobs, local English OCR, and dated readable web captures.
- Added claims with support and contradictions, gap-linked research tasks, cited questions and answers, and reviewed connection suggestions.
- Added explicit project analysis privacy, source/passage inclusion controls, duplicate detection, analysis provenance, and supervised Brave discovery.
- Added the decision brief, structured report editing, proposed section revisions, revision history, explicit released snapshots, and DOCX export.
- Introduced version 2 portable projects and recoverable migration from the original workspace format.

## 0.1.0

- Introduced the Electron Collector canvas, cards, labeled connections, file imports, search, autosave, and portable projects.
- Introduced the Releaser workspace and separate output window.
- Added offline evidence outlines, configurable model connections, and Markdown/PDF exports.
- Created initial Apple Silicon macOS and Windows x64 development packages.
