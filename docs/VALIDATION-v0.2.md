# Acadia 0.2 validation record

Validated on macOS Apple Silicon, September 29, 2026. Each native test uses a disposable user-data profile. Existing research and the previous v0.1 application were preserved.

## Automated checks

- TypeScript checks and production Electron build pass.
- 92 unit/integration tests cover original board/storage behavior, SQLite/FTS5, source extraction, privacy policy, retrieval, discovery approval, citations, report editing, export structure, and recovery.
- 13 native Electron scenarios pass against the packaged macOS application. These cover board editing/relationships/restart, imports/originals, portable export/import, release synchronization and write denial, simulated touch/compact windows, evidence/tasks/Q&A, source changes and historical citations, DOCX paragraphs, scanned-PDF local OCR, legacy migration/backups, invalid legacy input preservation, tables in actual DOCX/PDF exports, AI section proposal isolation/stale rejection, and reports with source-only collections.
- Actual English Tesseract OCR recognizes a rendered scanned PDF page in the packaged app. No remote OCR data download is needed.
- Exported PDF pages were rendered and visually checked for table readability and bibliography layout. DOCX content was checked inside the produced archive.
- Dependency audit reported no known vulnerabilities at build time.

## Research quality fixtures

The fixed Cedar investigation places supporting lab evidence, an exact duplicate, a field contradiction at paragraph 317, and missing long-term durability evidence after 85 earlier board items. Tests require the late field evidence to be retrievable and citable, duplicate lab content not to count twice, contradictory evidence to remain visible, and the durability gap to remain explicit. They exercise creation of a claim and gap-linked task in the native interface.

A separate generated 205-page PDF verifies full-document extraction and retrieval beyond the former page cutoff. Tests check failed extraction, OCR labeling, cancelled work and retries, exclusions/pins, fabricated-quotation rejection, immutable source versions, source changes, archive round-trips, transactional rollback, and interrupted job recovery.

The included fictional library-hours sample is a compact user-facing investigation with known survey support, observed pilot counterevidence, alternative explanations, and missing data. It can be opened as a portable `.acadia` project.

## Privacy and external services

Policy tests reject cloud document processing in local projects before a network request. New local projects default to the offline engine. Credential reuse requires the same provider and normalized endpoint. Tests enforce a project-owned, single-use approved Brave plan, five-query/twenty-candidate limits, no candidate page capture before acceptance, and no source/board expansion merely from a search result.

Provider and search tests use controlled responses; a local mock model is exercised through the real Electron bridge for report proposals. No live paid model or Brave account was used. These tests verify workflow, grounding, and policy enforcement; they do not establish the quality of every model or subject-matter conclusion.

## Distribution and remaining hardware checks

macOS Apple Silicon application and Windows x64 NSIS installer/portable package are built. Windows package contents include the matching native PDF canvas binary, OCR worker, WASM core, and English trained data. Cross-building a Windows package is not native Windows execution.

The builds are unsigned and the Mac build is not notarized. Native Windows installation/runtime, physical two-monitor behavior, physical touchscreen input, mixed-DPI monitors, and Intel Mac execution remain unverified. Automated tests exercise a separate Electron output window and simulated touch; they do not substitute for those hardware checks.

## Practical limits

Imports retain entire supported documents without the former leading-text or 200-page cutoff. Search/analysis still has a disclosed finite context budget; pin evidence when it must be included. Partial or failed coverage is displayed and never asserted as complete. Large files are bounded to 250 MB each and portable projects to approximately 1 GB. OCR is English printed text; recognition must be checked against the original.
