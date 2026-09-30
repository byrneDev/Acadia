# Roadmap

Acadia's direction is a research workspace in which a reader can follow a finding back to the evidence, see credible alternatives, and understand what remains unknown. The application is in its 0.x early-access series. This document describes priorities, not committed dates or promised features.

## Available foundation

- Collector board, source library, claims/evidence, tasks, cited questions and answers, and supervised discovery.
- Located document passages, source versions, extraction coverage, local English OCR, and portable projects.
- Explicit local/cloud analysis configuration, optional Brave search, and recorded analysis provenance.
- Editable cited reports, proposed section revisions, immutable snapshots, separate released display, and DOCX/PDF/Markdown exports.
- Versioned briefs/appraisals, shared-origin review, finding assessments, assumptions, five manual research methods and explicit AI challenge proposals.
- Per-item AI summaries accepted by the researcher into Reviewer Notes with historical evidence provenance.
- Searchable research-to-delivery board items, canonical linked cards, revisioned gaps and decisions, and portable archive format v4.
- Deliverable project plans, editable work packages, local Monday/Jira/Planner handoffs and Power BI data exports.
- Distribution targets for Ubuntu 24.04 x64, Apple Silicon macOS, and Windows x64.

The [changelog](../CHANGELOG.md) and [release notes](https://github.com/byrneDev/Acadia/releases) distinguish implemented behavior from the platform combinations actually validated.

## Near-term priorities

### Dependable distribution

Expand native installation, upgrade, and runtime checks across the release targets. Make package provenance and validation easy to inspect. Establish trusted signing and notarization where practical, and improve recovery guidance and upgrade confidence.

### Research quality

Grow the fixed investigation fixtures to cover ambiguous evidence, contradictory studies, weak source independence, and failed retrieval. Improve how coverage, omissions, source changes, and unsupported conclusions are communicated. Evaluate local-model compatibility without presenting one model's passing example as general research accuracy.

### Usability and accessibility

Exercise keyboard, screen-reader, physical touchscreen, multiple-display, and mixed-DPI workflows. Improve navigation between a claim, its passages, and its board context. Keep the canvas usable as investigations grow and make long reports easier to review.

### Document reliability and scale

Broaden extraction fixtures, inspect OCR failure modes, and profile long-document and large-library behavior. Strengthen recovery and archival workflows while preserving original files, immutable citations, and clear processing status.

## Deliberately deferred

Remote collaboration, cloud synchronization, autonomous background investigations, audio/video transcription, quantitative dataset analysis, full systematic reviews, weighted decision optimization, external publishing, and automatic application updates are outside the current release. Individual work-package cards, automatic board layout and a dedicated experiment/protocol editor are also deferred. Additional OCR languages and architectures require their own packaging, accuracy, and usability validation before becoming supported targets.

To propose work, open an [issue](https://github.com/byrneDev/Acadia/issues) explaining the research task, the limitation you encounter, and an example of success. An accepted issue or pull request should define concrete behavior and verification before implementation expands the scope.
