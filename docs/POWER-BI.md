# Power BI research data handoff

Acadia exports an investigation as linked UTF-8 CSV tables for Power BI. The bundle includes a data dictionary, a relationship guide and a Power Query M loader. It describes the evidence workflow and delivery work, rather than performing statistical analysis or assigning a research quality score.

Exporting creates local files. It does not connect to Microsoft, upload research, create a Power BI report or configure a refresh schedule. Researcher-written fields can still contain sensitive information; review the export folder before sharing it.

## Import the bundle

1. Extract the export into a dedicated folder and keep the files together.
2. Open Power BI Desktop and choose **Transform data**. Create a **Text** parameter named `AcadiaFolder` containing the full path to the folder, for example `C:\Research\Acadia-export`.
3. Create a blank query named `AcadiaTable`. Open **Advanced Editor** and paste the complete contents of `PowerQuery-AcadiaTable.m`.
4. Create one blank query for each table you need. Enter `= AcadiaTable("sources")` and name that query `sources`. Repeat for `source_versions`, `passages`, `claims`, `evidence_links`, `findings` and the other names in `data-dictionary.json`.
5. Choose **Close & Apply**, then configure relationships in Model view using `RELATIONSHIPS.md`. Use many-to-one relationships with single-direction filtering from the unique key to the foreign key. Keep alternate paths inactive unless a measure explicitly needs them.
6. Keep the export folder in place. To refresh, deliberately replace its files with another export and refresh Power BI, or change the folder parameter. Keep separate dated folders when preserving prior exports matters.

Each CSV has a different schema. Do not use **Combine Files** across all CSVs: that feature expects files that can be transformed consistently. The supplied loader reads each table separately, uses UTF-8, preserves quoted line breaks, and applies the declared types. CSV support and the options used by the loader are documented by Microsoft in [Csv.Document](https://learn.microsoft.com/en-us/powerquery-m/csv-document) and the [Folder connector](https://learn.microsoft.com/en-us/power-query/connectors/folder).

Relationships are recommendations, not automatic model changes. Power BI needs a unique key on the one side; bridge tables preserve associations where either underlying entity can appear multiple times. Review cardinality, active relationships and filter direction as described in [Create and manage relationships in Power BI Desktop](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-create-and-manage-relationships).

## Included data

| Tables                                                                    | Meaning                                                                                       |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `projects`, `briefs`                                                      | Investigation question and current research brief                                             |
| `sources`, `source_versions`, `passages`                                  | Source identities, hashes, acquisition dates, extraction coverage and exact passage locators  |
| `claims`, `evidence_links`, `findings`                                    | Claims, supporting and conflicting links, current researcher assessments                      |
| `appraisals`, `appraisal_passages`, `origins`                             | Appraisals tied to exact versions and proposed/confirmed/rejected shared-origin relationships |
| `assumptions` and association tables                                      | Assumptions, validation needs and linked evidence/claims                                      |
| `methods`, `method_rows`, `hypothesis_evaluations` and association tables | Hypotheses, SWOT, Why chains, risk and TRL worksheets with their typed fields                 |
| `research_tasks`, `task_sources`                                          | Follow-up work tied to claims, assumptions or method gaps                                     |
| `review_issues` and association tables                                    | Review issues, disposition and linked evidence/work                                           |
| `analyses`, `analysis_source_versions`, `analysis_citations`              | Run metadata and source/citation relationships without requests or responses                  |
| `reports`, `report_revisions`, `report_citations`                         | Report metadata, saved revision identities, release selection and citation locators           |
| `delivery_plans`, `delivery_work_packages`, `work_package_dependencies`   | Editable or historical delivery plans and their work/dependency relationships                 |
| `quality_warnings`                                                        | Current deterministic completeness warnings from Acadia                                       |

The data dictionary lists every column, type, nullable state, table grain, key, relationship and exported row count. Assessment tables hold current revisions only. Report revisions are listed separately; the export does not contain a full pedigree revision history or the contents of immutable analysis snapshots.

## Interpret the fields correctly

- **Confidence** is the researcher's qualitative `unassessed`, `low`, `moderate` or `high` judgement. It is not a probability, a citation-validation result or proof that a finding is true.
- **Support review** records the researcher's assessment of whether evidence supports a claim. Supporting and conflicting links remain separate records.
- **Quotation location status** checks the saved source version, passage and quote locally. A verified location does not establish relevance, causation, independent corroboration or claim support. `recordedVerified` retains the earlier recorded citation flag; the separately exported location status reflects this export's local check.
- **Source independence** remains `unassessed` when no confirmed origin relationship is known. Proposed or rejected relationships do not prove independence. Duplicate files are labeled and must not be counted as independent evidence.
- **Extraction status and units** show readiness and coverage. A partial, failed, OCR-needed or cancelled extraction is not a fully analyzed document. OCR text has a distinct extraction method.
- **Quality warnings** are local completeness checks, not a numerical quality score. An empty warning table does not establish a sound conclusion.
- **TRL levels** are researcher-entered integers where assessed; blank means unassessed. The worksheet does not certify compliance with a standard.

IDs remain text. Revision numbers, page/paragraph numbers, extraction units and TRL levels use whole-number types. Boolean and ISO date/timestamp columns have explicit types. Bibliographic `publishedAt` stays text because a source may give only a year or other partial date. Empty nullable cells load as `null`; blank researcher assessments must not be interpreted as zero or false.

CSV values that could become spreadsheet formulas are prefixed with an apostrophe. The loader intentionally preserves that prefix. Commas, quotation marks and multiline researcher notes remain valid quoted CSV cells.

## Avoid double counting and ambiguous relationships

A work package or citation can occur in an editable draft and multiple saved revisions. Export keys include report/revision scope so each row remains unique. Filter `delivery_plans.scope` or `report_citations.scope` before counting current work or references. Use `report_revisions.isReleased` to find the selected released revision. Do not add historical work-package rows to the current workload.

Bridge tables describe associations; their row counts are not counts of independent observations. Self-links for duplicate sources, Why-chain parents and work-package dependencies should use an inactive relationship or a separate dimension for each role. Polymorphic review targets (`targetKind` and `targetId`) must not be joined indiscriminately to every possible target table.

Snapshot IDs and source-analysis IDs preserve provenance references; snapshot contents and deleted reports are not supplied by this bundle. Missing historical or legacy references must remain visible as missing rather than receiving fabricated replacement records. Follow passage/version identifiers in Acadia to inspect the actual source.

## Excluded by default

The bundle excludes original files, source URLs (which may contain tokens), extracted passage text, quotation text, report bodies, model prompts/responses/request payloads, credentials, endpoint URLs, raw extraction errors and rebuildable search indexes. It retains researcher-written brief, appraisal, finding, assumption, method, issue and work-package fields; those remain potentially sensitive research content.

The exporter and import script are covered by local format, privacy, key and relationship tests. A live Power BI Desktop import/model has to be checked on a Windows installation; local tests do not establish native Power BI validation.
