# Acadia 0.4.0 validation record

Prepared on **September 29, 2026** on Apple Silicon macOS. This record separates functional tests, a live local-model evaluation, package creation and native execution. A package produced on this Mac is not evidence that it runs on Windows or Ubuntu.

The release adds the desktop GUI refresh, research briefs and source appraisals, source-origin review, finding assessments and assumptions, five research method worksheets, explicit AI challenge proposals, retrieval/quotation audit records, frozen report pedigree, format-v3 portable projects, deliverable project plans, PMIS handoffs and Power BI data exports.

## Functional validation

| Check                                    | Observed result                                                                                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript and production Electron build | Passed after the final application changes.                                                                                                         |
| Final complete unit/research suite       | **284 passed, 1 skipped across 23 files** (22 passed, 1 skipped). The live-model evaluation is opt-in and excluded from routine runs.               |
| Storage/export regression subset         | 66 tests passed across pedigree storage, evidence foundation, research service and Power BI export after the transaction/review-target corrections. |
| Current complete native Electron suite   | **29 passed on Apple Silicon macOS** against the production build, using isolated profiles. Includes creating all five methods from Add item, worksheet editing, cancellation, and persistence after restart. |
| Earlier packaged application baseline   | **28 passed** against the locally packaged `Acadia.app` before the Add-item menu follow-up. Those local installers require rebuilding to include that follow-up; the current source suite does not validate older package bytes. |

Automated suites use isolated profiles and fictional evidence. Coverage includes versioned appraisals and findings, historical source passages, contradictory evidence, typed worksheets, review proposals, source ownership, exact citation anchors, report revisions, private draft/released-display boundaries, document exports and portable project round trips. GUI checks exercise themes, native edit behavior, keyboard navigation, source-reader paging and explicit model-connection diagnostics. A deferred-save regression verifies that reopening a brief during an unfinished save preserves edits and receives the new revision; the returned question is applied only to its original active project. These checks establish tested behavior, not general research accuracy.

Storage regressions include a consistent backup of committed SQLite WAL contents before schema migration; rollback of failed migrations; refusal to open a newer schema; interrupted-work preservation; immutable snapshot/hash validation; recovery after a replacement import fails after deletions; and rollback/commit behavior after a simulated commit failure. Current claim/task links prevent destructive deletion; historical snapshots alone do not prevent deletion. Credential-key variants are stripped while legitimate generation controls such as `max_tokens` remain intact, and snapshot hashes cover the sanitized persisted data.

Exports are checked for source locators, tables, bibliographies, editable structure, preserved report sections and linked delivery work. Power BI tests check CSV quoting/UTF-8/formula neutralization, explicit types, unique keys, relationships, all five method kinds, retained contradictions/unknown origin, and omission of source text/model payloads. Two targeted native delivery scenarios also passed, including real PMIS and Power BI ZIP creation. A packaged-app check also opened the fixed five-method investigation, exported its pedigree appendix to a 13-page PDF and editable DOCX, and produced a Power BI example bundle. Rendered PDF pages were visually checked for readable method assessments, repeated table headers, source references and limitations. These are file-format/application export checks, not native Word rendering or live destination-application imports.

## Live local-model evaluation

The [recorded synthetic evaluation](evaluations/v0.4-local-model.json) used **Ollama `qwen3.5:9b`**, quantization `Q4_K_M`, through the configured loopback service. The stored model digest begins `6488c96fa5fa`. The evaluation began at `2026-09-29T22:43:05.588Z`; the recorded manual inspection completed at `2026-09-29T22:50:57.568Z`.

The fixture concerns a fictional Cedar industrial pilot. It includes an uncontrolled before/after improvement, two articles derived from that same experiment, contrary field observations, a valid but irrelevant meeting-schedule citation, an alternative explanation, missing long-term outcomes and oversized pinned context. It uses a temporary SQLite store and synthetic text. No private investigation, user document, credential, web search or remote analysis service was used.

| Workflow                     | Delivered result                      | What the observed response establishes                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Decision brief               | **Accepted.**                         | Rejected immediate full rollout, separated observation from causal attribution, retained counterevidence and operating-condition alternatives, recognized the shared origin of the two articles, and proposed a controlled or matched comparison.                              |
| Challenge finding            | **Rejected by proposal validation.**  | The response was JSON but used `detailed` instead of required `detail`. No proposal was applied. Its raw reasoning identified confounding, contradictions, gaps and shared origins, but missed the specifically irrelevant meeting-schedule link attached to the causal claim. |
| Insufficient-evidence answer | **Rejected by quotation validation.** | The raw answer correctly declined to invent a six-month injury-rate effect. It nevertheless placed an abbreviated phrase containing an ellipsis inside quotation marks; that exact string was absent from the saved passage. No validated answer was applied.                  |

**One of three workflows produced an accepted result in this single fixture.** This is not an estimated success rate or a general quality pass. Correct ideas in rejected text do not count as usable validated results. Proposal-category metrics count accepted proposals only, so their false values do not mean the rejected raw response omitted every relevant topic.

Retrieval supplied 15 passages, covering the primary pilot, counterevidence, decisive gap and alternative explanation under the 24,000-character local-model budget. Eight oversized pinned passages occupied 20,912 of the 22,817 supplied passage characters. Pool labels record retrieval intent; they do not independently establish an evidence stance. All seven short substantive passages fit in this example, so it does not establish robustness against every pinned-source saturation pattern.

The JSON retains the prompts, actual responses, validation outcomes and agent-conducted manual review for this fictional fixture. It is not independent expert review or standards certification. The observed schema-adherence, irrelevant-link detection and quotation-fidelity failures remain documented. Future prompt, retrieval or model changes require a separately identified evaluation rather than rewriting this result as a pass.

## Packages and remaining platform checks

The intended distribution is an Apple Silicon macOS app/ZIP, Windows x64 NSIS installer, and Ubuntu x64 Debian/AppImage packages. The local release handoff records artifact creation and inspection separately in `HANDOFF.md`, with artifact checksums in `SHA256SUMS.txt` and the source-file hashes in `SOURCE-MANIFEST.sha256`. Windows/Linux packages prepared on this Mac are cross-built; their native checks remain outstanding. The functional results above describe the tested application source, and the handoff identifies any additional packaged-app checks.

- Native Windows and Ubuntu execution for **v0.4** is unverified. Earlier release CI results do not validate this version.
- Interactive Windows install/upgrade, normal Ubuntu desktop/AppImage launch, Linux keyring behavior and distribution-specific sandbox integration remain separate acceptance checks.
- Power BI Desktop import and model relationships have not been exercised on a Windows installation.
- Live Monday/Jira/Planner tenant imports have not been performed. PMIS exports create local files; Acadia does not execute the Planner importer or connect to a tenant automatically.
- Physical touchscreens, two physical displays, mixed-DPI arrangements, projectors and assistive technologies remain unverified. Native separate-window and simulated-input checks do not establish hardware compatibility.
- Packages remain unsigned, and the macOS app is not notarized. Checksums establish artifact integrity rather than publisher identity.

Before upgrading, export important investigations and keep an independent backup. New portable exports use format v3 and require Acadia 0.4 or later; older archives remain importable with new assessment fields unassessed. Migration recovery copies on the same disk do not protect against disk failure. Research files, originals and the local database are ordinary local data, not an encrypted vault.

Citation-location validity, evidential support and researcher confidence remain different assessments. Review OCR and analytical conclusions against their sources; an exact citation or reproducible input record does not guarantee a defensible conclusion or identical model output.
