# Roadmap

Acadia is preparing **1.0.0-rc.1**, a candidate for qualification. **v0.5.0 remains the published release.** A production v1 release depends on evidence that the research workflow, recovery and distribution are dependable. This document describes priorities, not committed dates.

## Implemented candidate foundation

- Collector, source library, evidence, tasks, cited questions and answers, supervised discovery and a private released display.
- Versioned source passages, original PDF comparison, local English OCR, coverage tracking, paged readers/search and explicit local/cloud settings.
- Versioned briefs, appraisals, shared-origin review, findings, assumptions, five editable research methods and on-demand challenge proposals.
- Per-item AI proposals accepted into Reviewer Notes by the researcher, preserving provenance and provisional evidence status.
- Canonical board links, manual gaps and decisions, keyboard board movement, and guided fictional software/curriculum practice investigations.
- Recoverable private drafts with conflict review; manual citations, report revisions, bibliography metadata and DOCX/PDF/Markdown exports.
- Delivery plans with gap/finding revisions, requirements or learning objectives, acceptance tests and historical verification evidence. Work completion does not resolve a gap automatically.
- Local Monday/Jira/Planner handoffs with mapping previews and repeat-import limits; Power BI tables for research, delivery and accepted reviews.
- Portable archive format v5 with legacy v1–v4 import, checked whole-library backups, startup recovery, redacted diagnostics and manual update checks.
- Native packaging targets for Ubuntu 24.04 x64, Apple Silicon macOS and Windows x64, with fail-closed production release gates.

The [changelog](../CHANGELOG.md), [candidate validation](VALIDATION-v1.0.md) and [published releases](https://github.com/byrneDev/Acadia/releases) distinguish implementation from measured results and released artifacts.

## Gates before production v1

### Recoverable work and dependable distribution

Complete clean installation and recoverable v0.5 upgrade acceptance on each supported system. Exercise the Windows installer and Ubuntu AppImage normally, in addition to the packaged executable. Configure and verify Developer ID signing, notarization and Windows Authenticode signing. No open data-loss, privacy, citation-integrity or core-workflow blocker may remain. Candidate builds can remain explicitly unsigned prereleases; that does not satisfy the production gate.

### Demonstrated research quality

Publish separate reviewed evaluations for each advertised provider/model configuration, including retrieval, support review, contradictions and insufficient-evidence behavior across repeated fixed investigations. Preserve failures and limitations rather than advertising a model based only on a successful connection or one well-formed response. Complete the declared 1,000-source/100,000-passage/500-card benchmark on the approved 16 GB/SSD reference machine, recording the one-second indexed-search and five-second opening targets, observed p95 timings, board responsiveness, memory use and environment.

### Real destination and human acceptance

Verify Monday, Jira and Planner imports in authorized live test tenants, including field mappings, stable identifiers, dates, owners, dependencies and repeat/interrupted imports. Validate Power BI Desktop relationships, refresh and totals on Windows. Local CSV/JSON tests do not establish these outcomes.

Record five independent testers completing both software and curriculum investigations from question through evidence, findings, gaps, deliverable plan and cited report. Record failures, fixes and retests. Validate keyboard and screen-reader journeys, physical touch, two displays, disconnect/reconnect and mixed scaling on named hardware. Automated or simulated interactions do not replace this acceptance.

The [release process](RELEASING.md) requires reviewed evidence tied to the final commit. These checks are pending unless the validation record explicitly identifies completed evidence.

## After qualification

Improve coverage and response time using measured investigations, expand real document and OCR fixtures, and refine navigation from claims and delivery tasks to historical evidence. Additional architectures, OCR languages or advertised models require their own packaging, accuracy and usability validation.

## Deliberately deferred

Remote collaboration, cloud synchronization, autonomous background investigations, audio/video transcription, quantitative dataset analysis, full systematic reviews, weighted decision optimization, external publishing and automatic update installation remain outside v1. Individual work-package cards, automatic board layout and a dedicated experiment/protocol editor are also deferred.

To propose work, open an [issue](https://github.com/byrneDev/Acadia/issues) explaining the research task, the limitation and an example of success. Define concrete behavior and verification before expanding the scope.
