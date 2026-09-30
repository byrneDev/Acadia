# Acadia 1.0 release-candidate validation

Current candidate: **1.0.0-rc.1**. This is implementation and qualification work, not a declaration that the final 1.0 release gates have passed. The published v0.5.0 release and its historical validation remain unchanged.

## Automated checks

The local validation host is an Apple M2 Mac with 24 GB RAM, macOS 27.0, Node 24.21.0 and the locked Electron runtime. A fixture test is not a live service, hardware, or independent-user evaluation. Cross-platform CI and native package jobs produce their own reports and checksummed assurance records; local Mac execution alone does not establish Windows or Ubuntu acceptance.

The deterministic suite currently passes **369 tests**, with three opt-in evaluations skipped in its default invocation. Coverage includes actual SQLite disk-full rollback, interrupted jobs, backup staging corruption, a forced Electron process termination, private draft recovery, empty-board recovery before archive replacement, archive parity and size limits, historical evidence, balanced retrieval under many pins, and late counterevidence inside a pinned source. The complete local native Electron suite passes **49 scenarios**, with the opt-in scale scenario skipped in its default invocation and separately executed successfully. Type checking and the production build pass. These results were recorded on 2026-09-30; the locally packaged Mac application also passed all 49 scenarios. Remote candidate package validation is recorded below when available.

The long-report fixture generates 90 table rows over 12 PDF pages. DOCX, PDF and Markdown checks retain the final row, Unicode, limitations, author/date/publisher/DOI and historical page/paragraph locator. Visual inspection of PDF [page 1](screenshots/v1.0/report-page-1.png), [page 6](screenshots/v1.0/report-page-6.png) and [page 12](screenshots/v1.0/report-page-12.png) found readable repeated headers and columns without clipping or overlap. This is automated generation plus agent visual review; human verification in Word and destination readers remains a release gate.

## Scale measurements

The [backend benchmark](evaluations/v1-scale-backend.json) and [desktop benchmark](evaluations/v1-scale-desktop.json) use 1,000 fictional sources, 100,000 passages, 500 linked cards and 250 large stored analysis runs. These are development-tree measurements on the recorded 24 GB host, including concurrent local evaluation work, not repeated qualification measurements on the required 16 GB/SSD machines.

| Measurement | Observed |
| --- | --- |
| Launch to rendered usable board | 2.825 seconds |
| Broad indexed search, final page of 100,000 matches through desktop bridge | 694 ms |
| Exact indexed lookup through desktop bridge, ten calls | 0.2–3.3 ms |
| Keyboard move to committed position, including save debounce | 515 ms |
| Renderer frame gap during interaction | 18.7 ms p95; 66.7 ms maximum |

Candidate search and full historical snapshot creation now run in workers. The backend retrieval/snapshot pass took about 2.32 seconds total with a measured maximum event-loop gap near 211 ms rather than one synchronous 2.51-second operation. Main heap after the operation was about 169 MB; peak process resident memory remained about 0.7 GB because workers also consume memory. Full run serialization remains a roughly 195 ms synchronous step in that fixture. Memory and responsiveness are disclosed separately from search/startup targets.

## Research-quality evaluation

The versioned Cedar fixture deliberately combines a flawed primary pilot, syndicated copies, a contradictory repeat, an irrelevant but valid citation, a causal overclaim, incomplete extraction, many pins and a decisive missing observation. Automated retrieval/provenance checks are separate from model response reliability and semantic support review.

The [initial qwen3.5:9b local evaluation](evaluations/v1-local-model-baseline.json) retrieved all four critical evidence passages, excluded the failed extraction and recorded the shared origin. It also exposed two application validation defects: an appraisal UUID was accepted as if it were an ordinary prose reference, and an answer containing escaped newlines/trailing JSON text was accepted. The challenge proposal failed its structured contract. Exact raw failures are now regression fixtures and those malformed outputs are rejected without changing research. Do not describe this initial run as a qualified model result.

The [evaluation after stricter response validation](evaluations/v1-local-model.json), recorded on September 30, 2026 with Ollama `qwen3.5:9b` (`Q4_K_M`) on the M2/24 GB host, again retrieved all four critical passages, excluded the failed extraction, recorded the shared origin and disclosed 22 pins omitted by the context budget. **None of its three generated outputs passed validation:** the decision brief used an internal appraisal UUID as a citation; the challenge supplied invalid evidence references rather than the required citation identifiers; the answer included quotation text that was not literal in the supplied passages. Acadia rejected all three without applying a report, proposal or answer. The runner completed and saved the evidence; its passing test status is not a passing model-quality result.

The [follow-up after prompt/interface clarification](evaluations/v1-local-model-interface.json) retained the same retrieval checks and produced **one accepted response out of three**: the Q&A response passed citation/quotation checks and set the insufficient-evidence flag. The report was rejected for nonliteral quotations. The challenge was blocked before transmission because repeating evidence identifiers in its response schema exceeded the local context budget. Removing the redundant identifier inventories retained exact server-side validation and brought the complete fixture within budget. A [challenge-only retry](evaluations/v1-local-model-challenge-retry.json) then received HTTP 400 from Ollama before producing text. A small synthetic diagnostic isolated the provider error to large string-length grammar constraints; those limits remain enforced by Acadia after generation and are no longer expanded in the provider schema. These intermediate failures remain part of the record.

Support review, semantic contradiction handling and abstention remain **not reviewed** in the saved rubric. Retrieving contrary evidence is separate from explaining it correctly, and an insufficient-evidence flag alone cannot establish semantic abstention quality. The complete Acadia/model workflow has not passed all three operations in one recorded run; the result does not isolate model capability from application prompt/interface design. No human semantic review or research-quality certification is claimed. A connection or simple JSON compatibility check does not establish reliability for these research tasks.

## Required external qualification

| Gate | Status |
| --- | --- |
| Developer ID signing and Apple notarization | Not verified; local inspection found an Apple Development identity only, which is not a public distribution identity. |
| Windows production signing | Not verified; release signing credentials have not been configured in this workspace. |
| Clean installation and v0.5 upgrade on supported desktop systems | An actual published v0.5 Mac app followed by the locally packaged candidate preserved a fictional project, position, original attachment and historical passages, and created a checked automatic backup ([record](evaluations/v1-mac-upgrade.json)). Installer/Gatekeeper acceptance and Windows/Ubuntu upgrade journeys remain pending. |
| Monday, Jira and Planner live destination imports | Not performed; local export tests do not establish tenant compatibility. |
| Power BI Desktop import and totals reconciliation | Not performed. |
| Physical touch, two displays, disconnect/reconnect and mixed scaling | Not performed. |
| VoiceOver, NVDA and Ubuntu assistive-technology journeys | Not performed. |
| Five independent testers completing software and curriculum investigations | Not performed. |
| Advertised model research-quality matrix | No model is certified by synthetic response tests; publish the versioned evaluation results before advertising a tested configuration. |

The final 1.0 release requires recorded evidence for these gates. A release candidate may be distributed as a prerelease with explicit limitations; unsigned candidates must not be described as production signed builds.

## Compatibility and limits

Portable format v5 adds recoverable private drafts and delivery traceability. Imports retain v1–v4 histories; missing assessments and provenance remain unknown. Released report snapshots remain immutable, and private drafts never count as accepted evidence or appear on the audience display.

Backups exclude installation credentials. Research content itself is not encrypted. Keep an independent backup on another device. Portable archives are bounded to 1 GB overall, 250 MB per entry including complete research history, 50 MB for the board/report record, 5 MB for the catalog and 5,000 originals. Full research serialization and archive compression run off the Electron main event loop. Export enforces the same limits as import. Use a whole-library backup for larger histories. The professional-project benchmark is 1,000 sources, 100,000 passages and 500 board cards; source/attachment count does not override these byte limits.

Recovery, OCR, citation correctness, evidential support and model quality are separate checks. No automatic external research, cloud fallback, background update installation or telemetry is added.

See the [acceptance journeys](ACCEPTANCE-v1.0.md) for the independent software/curriculum, reference-machine, assistive technology, physical hardware and destination-import procedures. Production release automation requires signed/notarized packages and exact-commit acceptance evidence; absent prerequisites remain failures, not silently waived checks.
