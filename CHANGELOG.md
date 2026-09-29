# Changelog

Acadia follows a 0.x early-access release series. Entries describe application changes; platform validation is recorded separately in each release. Earlier versions were distributed as local development packages before the public repository.

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
