# Acadia 0.5.0 — Reviewed evidence and research-to-delivery boards

Acadia 0.5 connects **Question → Sources → Reviewed Evidence → Findings → Gaps → Tasks → Deliverables** on the Collector canvas, while retaining the Releaser's editable reports and private released-display workflow.

## New in 0.5

- **AI advice for each item:** explicitly summarize a card or saved source version and receive possible research uses, limitations and suggested next steps. Historical passage cards use the exact selected passage; coverage and exclusions remain visible.
- **Human-accepted Reviewer Notes:** review and edit the proposal, inspect its citations, then explicitly accept it into the item's Reviewer Notes and Evidence. Original notes remain intact. Acceptance records interpretation with historical references; it does not automatically establish evidential support.
- **A complete Add item picker:** search grouped choices for briefs, sources, exact passages, findings, accepted reviews, assumptions, five methods, gaps, tasks, decisions, reports and delivery plans. Create a record or place an existing one.
- **Linked board cards:** previews follow saved research records; opening a card reaches its authoritative reader or editor. Repeated placement focuses the existing card, and removing it retains the record. Analytical cards do not become additional independent sources.
- **Revisioned gaps and decisions:** connect missing information and resolution criteria to tasks, then record proposed actions, alternatives, assumptions and deliverables. Status changes remain deliberate researcher edits.
- **Portable format v4:** retain linked board records, gap/decision revisions, accepted notes and historical evidence. Import formats v1–v3 with recovery backups.

This release also includes the v0.4 source milestone: the refreshed desktop GUI, source appraisals and origins, five research methods, Challenge analysis, analytical pedigree, software/curriculum delivery planning, Monday/Jira/Planner handoffs and Power BI exports. Those features were previously pushed as source; no separate v0.4.0 GitHub binary release was published.

## Downloads and upgrading

| Platform            | Download                                                                                        |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| macOS Apple Silicon | ZIP containing `Acadia.app`; extract and move it to Applications.                               |
| Windows x64         | NSIS `.exe` installer.                                                                          |
| Ubuntu 24.04 x64    | `.deb` installer or `.AppImage`; consult the Ubuntu guide for desktop and sandbox requirements. |

Export important investigations before upgrading and keep an independent backup. **V4 projects require Acadia v0.5 or later**; v0.4 cannot open newly exported v4 projects. Older archives remain importable. Restart a development run once to load the new Electron bridge.

Read the [quick start](https://github.com/byrneDev/Acadia/blob/v0.5.0/docs/QUICK-START.md), [research-to-delivery guide](https://github.com/byrneDev/Acadia/blob/v0.5.0/docs/RESEARCH-TO-DELIVERY.md), [Ubuntu guide](https://github.com/byrneDev/Acadia/blob/v0.5.0/docs/LINUX.md), and [local AI setup](https://github.com/byrneDev/Acadia/blob/v0.5.0/docs/LOCAL-AI.md). Models and credentials are not included. All methods work manually; AI and approved external search remain optional.

## Validation and known limits

Release commit **`92b959e2fd77ef7746f13d4da1035c02f8111f0e`** (`v0.5.0`) passed [source CI on macOS ARM64, Windows x64 and Ubuntu x64](https://github.com/byrneDev/Acadia/actions/runs/36657889438): typecheck, production build, **318 unit/research tests passed with 1 skipped**, and **35 Electron scenarios passed on each platform**.

The [native release package run](https://github.com/byrneDev/Acadia/actions/runs/36658465522) separately passed the same **318 unit/research tests with 1 skipped** and **35 packaged Electron scenarios on each platform**. Tests used the packaged macOS app, Windows unpacked application, and Ubuntu application installed from the `.deb`. All three package jobs and the combined asset-verification job passed. These automated checks use fictional investigations and isolated profiles; they do not establish interactive Windows installation/upgrade or normal Ubuntu AppImage launch.

The complete release workflow passed and GitHub published v0.5.0 at **2026-09-30 02:14:54 UTC** as its latest release, with neither draft nor prerelease status. The public release page returned HTTP 200. All four packages and `SHA256SUMS.txt` were downloaded anonymously; every file's size and SHA-256 matched GitHub metadata, and all package hashes matched the published manifest. The [delivery verification record](https://github.com/byrneDev/Acadia/blob/main/docs/release-validation/v0.5.0.json) records the exact assets and hashes.

The [tagged and bundled validation record](https://github.com/byrneDev/Acadia/blob/v0.5.0/docs/VALIDATION-v0.5.md) preserves the earlier local source-validation checkpoint. The [current validation record](https://github.com/byrneDev/Acadia/blob/main/docs/VALIDATION-v0.5.md) adds the exact native workflow and public-download outcomes and distinguishes them from historical live-model observations.

Physical multi-monitor, touchscreen, mixed-DPI and assistive-technology checks remain separate. Power BI Desktop and live PMIS tenant imports have not been established by the local file-export tests. The earlier local-model evaluations retain both accepted and rejected responses; no general research-accuracy pass is claimed.

Packages are unsigned; the macOS app is not notarized. Verify downloads against `SHA256SUMS.txt`. Acadia remains an early-access 0.x application: review OCR and AI conclusions against the original evidence, retain limitations, and keep project backups.
