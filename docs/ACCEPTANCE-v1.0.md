# Acadia 1.0 acceptance journeys

This is a test procedure, not a passing acceptance record. Use the exact candidate version and source commit, an isolated profile, fictional evidence, and a separate backup. Record the machine, operating system, package checksum, input devices, assistive technology and observed failures. Keep credentials out of the record.

## Independent research journeys

At least five independent researchers must each complete both journeys without developer intervention. Record where guidance was sufficient, where the participant became stuck, whether they recovered, and the final exported artifacts. Fix and retest every data-loss, privacy, citation-integrity or workflow-blocking defect before approving 1.0.

1. Open **Workspace guide** and create the software practice investigation. Inspect the question, pilot source, conflicting field observation and unresolved comparison gap. Explain why a saved citation does not establish support and why an unreviewed finding is not a settled conclusion.
2. Refine the brief and save it. Appraise a source using its actual limitations. Record a supported observation and a consequential assumption separately. Add a missing observation to the gap and a task with completion criteria. Place selected records on the board and remove one placement; confirm its underlying research record remains available.
3. Edit the report manually. Insert a citation from the collection, open the exact historical passage, and inspect an original PDF page alongside extracted text. Add a method table and limitations. Save a revision, release it, then make a private edit. Confirm the audience display continues showing the released version.
4. Follow the software plan from gap and finding through requirement, work package, acceptance test and saved verification passage. Mark work complete and confirm the gap stays open until explicitly reviewed. Export DOCX, PDF, Markdown, the portable project and PMIS handoff. Inspect the bibliography, tables and final page, and reopen the archive in an isolated profile.
5. Create the curriculum practice investigation. Repeat the evidence/review/report cycle and follow the plan through a learning objective, instruction, assessment criterion and resulting evidence. Complete and export this second investigation independently.

AI is optional for these journeys. When evaluating AI separately, choose an explicitly configured project model, inspect its proposals, and accept or reject them yourself. Recovering an unaccepted Reviewer Notes draft must not restore the human acceptance checkbox. No test may count generated text as human-reviewed simply because it exists.

## Recovery, installations and devices

| Exercise | Required observation |
| --- | --- |
| Clean install on each supported platform | Verify package identity/signature where applicable, original-file import, local OCR, manual report editing, export and clean shutdown. |
| Upgrade from v0.5 | Back up first; open a copy of a v0.5 library with originals, historical reports and linked records. Verify automatic migration backup, retained counts/relationships and historical citations. Retain the v0.5 copy for rollback; do not downgrade a migrated database in place. |
| Restore and interrupted work | Restore a checked library backup, confirm the replaced workspace is preserved, and reopen private drafts. Cancel or interrupt a fixture job; confirm explicit retry is required. Simulate failures only in disposable profiles. |
| Keyboard and screen reader | Complete both journeys with keyboard-only navigation, then supported screen readers on macOS, Windows and Ubuntu. Verify focus recovery, modal labels, save/error announcements, long tables, board movement and citation navigation. |
| Physical touch and displays | Exercise actual touch hardware, a second display, disconnect/reconnect and mixed scaling. Confirm no draft, credential, private job result or unreleased report appears in the audience window. |
| Long reports | Inspect multipage DOCX and PDF outputs in target readers, including Unicode, repeated table headers, the final row, method appendices, historical locators and limitations. Automated text presence alone is insufficient. |
| PMIS and Power BI | Follow [PMIS handoff](PMIS-HANDOFF.md) and [Power BI](POWER-BI.md) in real disposable destination configurations. Record field mappings, row counts, rejected values, relationship reconciliation and repeat-import behavior. |

## Performance and model qualification

Run the checked-in opt-in scale fixture on documented 16 GB/SSD reference machines. Measure whole-application opening against five seconds and indexed search against one second, recording repeated measurements and their distribution. Record memory, board input response, renderer frame gaps and report editing separately; a store-constructor timing is not whole-application startup.

```sh
ACADIA_SCALE_EVALUATION=1 ACADIA_SCALE_PROFILE=/absolute/disposable/acadia-scale-profile npx vitest run tests/scale-v1.test.ts
ACADIA_SCALE_PROFILE=/absolute/disposable/acadia-scale-profile npx playwright test tests/scale-v1-e2e.spec.ts
ACADIA_QUALITY_EVALUATION=1 ACADIA_QUALITY_MODEL=qwen3.5:9b npx vitest run tests/analytical-quality-v1.test.ts
```

The model evaluation uses fictional fixture data and an explicitly selected installed loopback Ollama model; it never installs a model or uses cloud fallback. Its runner completing does not mean every generated response passed. Review retrieval, reference/quotation validity, support assessment, contradictions, abstention and contract reliability separately. Preserve failed responses and review rationale. Models without recorded review remain unqualified.

Use the exact-commit acceptance format in [Releasing](RELEASING.md) only after these real-world checks have occurred. Its validator checks the completeness of the record; an identified reviewer must verify the evidence behind it.
