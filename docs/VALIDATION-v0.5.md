# Acadia 0.5.0 validation record

Prepared on **September 29, 2026** on Apple Silicon macOS. This record separates source checks, live-model observations, package creation and native execution. It does not treat a cross-built installer as a tested operating system.

V0.5 adds per-item AI summaries, explicitly accepted Reviewer Notes, the research-to-delivery board picker, canonical linked records, revisioned gaps and decisions, and portable archive format v4. The desktop GUI refresh, methods library, analytical pedigree, delivery planning, PMIS handoffs and Power BI exports from the v0.4 source milestone are retained. There was no separate v0.4.0 GitHub binary release; its [historical validation record](VALIDATION-v0.4.md) remains unchanged.

## Recorded checks

| Check                                       | Observed result                                                                                                                                                                                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Final v0.5.0 typecheck and production build | **Passed** on Apple Silicon macOS.                                                                                                                                                                                               |
| Final v0.5.0 unit/research suite            | **318 passed, 1 skipped across 29 files** (28 passed, 1 skipped). The live-model evaluation is opt-in.                                                                                                                           |
| Final v0.5.0 native Electron suite          | **35 passed on Apple Silicon macOS** in 1.3 minutes, using the production build and isolated fictional investigations. This is source-build validation, not validation of the final packaged installers.                         |
| GitHub source and native package checks     | **Passed on macOS ARM64, Windows x64 and Ubuntu x64** at the release commit. Exact runs, counts and tested executables are recorded below. Package creation, integrity verification and native execution remain separate checks. |
| Public release and download integrity       | **Passed**: public v0.5.0 release, all four packages and `SHA256SUMS.txt` downloaded anonymously; file sizes and SHA-256 values matched GitHub metadata, and all package hashes matched the published manifest.                  |

The copy of this record committed at tag `v0.5.0` and bundled by its release workflow describes the local source-validation checkpoint before publication. No local v0.5 installers were built for that checkpoint. This version on `main` adds subsequent GitHub verification results; it does not alter the tagged source or packaged application. No result is inferred from an earlier version or from package creation alone.

## GitHub source and native package verification

Both runs used release commit **`92b959e2fd77ef7746f13d4da1035c02f8111f0e`**, tagged **`v0.5.0`**. Results were checked in the individual job logs on September 29, 2026 local time (September 30 UTC).

The [source CI run](https://github.com/byrneDev/Acadia/actions/runs/36657889438) passed typechecking, production builds, **318 unit/research tests with 1 skipped across 29 files**, and **35 Electron scenarios on each platform**. These scenarios exercised the source-built application on macOS ARM64, Windows x64 and Ubuntu x64; they did not use final installers.

The [native release package run](https://github.com/byrneDev/Acadia/actions/runs/36658465522) separately rebuilt and tested the release on each operating system. Every package job passed typechecking and **318 unit/research tests with 1 skipped across 29 files** before packaging. Its native Electron results were:

| Platform / runner            | Native application exercised                                                                                                                                         | Packaged Electron result      |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| macOS ARM64 / `macos-15`     | Packaged `Acadia.app/Contents/MacOS/Acadia`, then archived with executable permissions in the release ZIP.                                                           | **35 passed in 2.7 minutes**. |
| Windows x64 / `windows-2025` | Packaged `win-unpacked/Acadia.exe`; the same job also built the NSIS installer.                                                                                      | **35 passed in 2.1 minutes**. |
| Ubuntu x64 / `ubuntu-24.04`  | `.deb` installed through apt; desktop entry and applicable AppArmor profile checked, then `/opt/Acadia/acadia` tested under D-Bus/Xvfb. The AppImage was also built. | **35 passed in 1.2 minutes**. |

These are native automated runner checks, using isolated profiles and fictional investigations. They do not establish interactive Windows installer/upgrade behavior, normal Ubuntu AppImage launch, or physical display and input compatibility. The complete release workflow, including package jobs, combined asset verification and publication, passed.

## Publication and public-download verification

GitHub published [Acadia v0.5.0](https://github.com/byrneDev/Acadia/releases/tag/v0.5.0) at **2026-09-30 02:14:54 UTC**. Its latest-release API returned `v0.5.0` with `draft: false` and `prerelease: false`; the anonymous release page returned HTTP 200.

All four public packages and `SHA256SUMS.txt` were then downloaded anonymously over HTTPS with `curl`. Every downloaded file's byte count and SHA-256 matched its GitHub API metadata. The SHA-256 of every package also matched the downloaded published manifest. The [machine-readable delivery record](release-validation/v0.5.0.json) preserves the exact filenames, sizes, hashes, public URLs, release commit and workflow links.

These download checks establish public availability and transfer integrity for those bytes. They do not add interactive installation or hardware coverage beyond the native checks above, and checksums are not a substitute for publisher signing.

## Evidence and board acceptance

The fixed fictional Cedar investigation contains a laboratory result, field counterevidence, an accepted item review, an assumption, an unresolved matched-comparison gap, its planned task, a proposed decision and a validation deliverable. Deterministic fixtures exercise the following boundaries:

- **Item summaries:** opening the dialog does not call AI; an explicit request uses the selected project model and only the selected item's eligible content. Tests cover passage/source exclusions, long-document sampling through the last passage, partial extraction, media limitations, cancellation, malformed responses, project ownership and local-only enforcement.
- **Reviewer Notes:** the researcher edits the proposal, inspects references and explicitly accepts it. Acceptance preserves the original notes, records the date and exact historical passages, and creates provisional evidence with context links. It does not mark a claim supported, create an independent source or call a model. Duplicate acceptance is idempotent; provenance cannot be rewritten by later evidence edits.
- **Canonical board records:** all twelve linked record kinds use their authoritative data. Editing a saved record updates its card; adding it again focuses the existing placement. Missing references remain visibly unavailable, and removing a placement keeps the record. Historical passage and review cards retain their source versions.
- **Gaps, decisions and tasks:** links and revisions survive restart and archive round trips. Drawing a connection does not change a finding, task, gap or decision status. Current references guard against destructive claim/task deletion. An interrupted task-linking operation leaves the saved task recoverable.
- **Source independence:** placing methods, findings, reviews, tasks or reports adds no independent source. Legacy method-card source copies remain accessible to historical citations but are excluded from new retrieval. Shared origins and duplicate files remain distinct from independent corroboration.
- **AI context:** linked-item summaries read the canonical saved record, including the exact selected passage. Changed records and source versions prompt review; older linked summaries lacking a change signature are not presented as verified current inputs.

The two board-mapping native scenarios exercise every picker choice, authoritative readers/editors, duplicate focusing, updated previews, placement-only removal, source counts, file import and historical paragraph 125 through version selection, search and paging. The complete labeled research-to-delivery chain survives restart. Separate item-summary and acceptance scenarios cover saved advice, historical citation navigation, human acceptance and audience access denial. Picker and board screenshots use fictional investigations.

## Storage, reports and privacy

Storage checks include consistent backups of committed SQLite WAL contents before migration, failed-migration rollback, newer-schema refusal, interrupted-job recovery, immutable snapshots, failed replacement-import recovery, and archive versions 1–3 importing into the v4 workflow. Source versions, accepted reviews and citations survive removed board placements and source updates. Invalid or cross-project references are rejected. Historical snapshot hashes are preserved when older archives lack new collections.

The existing report and export suites continue checking readable tables, citation locators, bibliographies, retained report sections, revisions and local PMIS/Power BI files. Power BI tests cover UTF-8/CSV quoting, formula neutralization, typed keys and relationships, contradictions, unknown origins, and omission of source text/model payloads. These checks do not prove a live import into Power BI Desktop, Monday, Jira or Planner.

Audience-window tests exercise the explicit released snapshot, exact cited historical passages, restricted APIs and original-file access. Working drafts, uncited passages and private project metadata stay in the Collector. Separate windows on one computer and simulated input do not establish physical two-display or touchscreen compatibility.

## Historical local-model observations

No new general model-accuracy pass is claimed for v0.5. Routine tests use deterministic synthetic responses.

The [v0.4 three-workflow evaluation](evaluations/v0.4-local-model.json) remains an earlier observation: the decision brief was accepted; a challenge proposal failed its response schema; an insufficient-evidence answer failed exact-quotation validation. Its [original interpretation and limitations](VALIDATION-v0.4.md#live-local-model-evaluation) are retained unchanged.

The separate [item-summary development audit](evaluations/v0.4-item-summary-local-model.json) records two real Ollama `qwen3.5:9b` attempts on one short fictional Cedar note. The application still reported version 0.4.0 when these development checks ran; the filename and recorded metadata retain that fact.

| Attempt                   | Observed outcome                                                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial item instructions | Rejected after **55.8 seconds**: added punctuation inside a quotation failed exact-source validation. The raw response also confused a missing control group with missing baseline observations. No summary was accepted.                     |
| Revised item instructions | Accepted after **47.7 seconds**: cited paraphrases preserved the measurements, retained confounders and missing long-term outcomes, withheld rollout support and proposed a matched comparison. The saved citation matched the exact passage. |

Each attempt used one explicit loopback request and a disposable store. No real investigation, user document, credential, external search or cloud fallback was involved. The second followed a targeted prompt refinement; it was not an automatic retry. The quotation validator was not weakened. This one-note example, reviewed by the development agent, does not establish accuracy for long documents, incomplete extraction, media or arbitrary research.

## Platform and delivery limits

The native release jobs built a macOS Apple Silicon ZIP containing `Acadia.app`, a Windows x64 NSIS installer, and Ubuntu x64 `.deb` and `.AppImage` packages. The table above identifies which packaged executable was tested on each runner; building an installer or AppImage alone does not establish its interactive installation or launch behavior. The exact release assets and checksum file identify the delivered bytes.

- Interactive Windows install/upgrade, normal Ubuntu desktop/AppImage launch, Linux keyring behavior and distribution-specific sandbox behavior require their own checks beyond automated runner scenarios.
- Power BI Desktop import and live Monday/Jira/Planner tenant imports are not validated by local export tests. Acadia does not execute a tenant importer or publish data automatically.
- Physical touchscreens, two physical displays, mixed-DPI layouts, projectors and assistive technologies remain separate acceptance work.
- Packages are unsigned; the macOS application is not notarized. Checksums verify download integrity, not publisher identity.

**Portable format v4 requires Acadia v0.5 or later.** Earlier archives remain importable, but v0.4 cannot open v4 exports. Export important investigations before upgrading and keep an independent backup. Same-disk migration copies do not protect against disk failure; local research files are not an encrypted vault.

Citation validity, evidential support and researcher confidence remain separate judgments. Review OCR and analytical conclusions against their sources.
