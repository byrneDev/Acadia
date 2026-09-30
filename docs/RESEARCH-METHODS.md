# Research methods and analytical pedigree in Acadia

Acadia records how an assessment was made and what could change it. It does not certify a research method or establish a finding merely because an AI generated it.

The research-methods foundation arrived in v0.4. V0.5 adds item summaries reviewed and accepted into Reviewer Notes, and linked [research-to-delivery boards](RESEARCH-TO-DELIVERY.md) with revisioned gaps and decisions.

## A practical workflow

1. Open **Research brief**. Record the question, decision, scope, dates, inclusion and exclusion criteria, and success criteria. Saving creates a revision. Imported older projects begin with their existing question and unassessed fields.
2. In **Sources**, open a saved version and record its evidence type, primary/secondary origin, methods, applicability, currency, limitations and possible bias. Link the passages behind the appraisal. A source update needs a new appraisal; older versions remain accessible.
3. Confirm shared-origin relationships where several sources derive from the same study, dataset or reporting. Duplicate files, confirmed shared-origin groups and unassessed independence are distinct. Multiple articles about one experiment are not multiple independent experiments.
4. In **Evidence**, keep supporting and conflicting passages visible. Assess the finding's reasoning, classification, assumptions, alternatives, confidence and confidence basis. Record an observation that would change the assessment. A valid citation does not mark a finding supported.
5. From the board, choose **Add item → Apply methods**, select a method, then **Add worksheet to board**. Select its card and choose **Open worksheet** to link saved evidence, findings and assumptions or create a task for a missing test. You can also start in **Methods** and use **Add to board** later. Creating a worksheet does not run AI or mark it reviewed.
6. Draft a report. Review AI changes before applying them. Preview and edit the analytical pedigree appendix, then explicitly append it to your writing. Save a revision and review limitations before releasing it.

All five worksheets can be completed manually. AI assistance requires the selected project model. **Challenge analysis** runs only when requested; it returns review proposals rather than changing research records or declaring a method reviewed.

## The methods

| Method                 | Main use                                                                                                                               | Limitations to retain                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Competing hypotheses   | Compare alternatives against the same evidence; record predictions and discriminating tests.                                           | Supporting-link counts do not select a winner. Dependence, measurement quality and contradictory observations matter.         |
| SWOT                   | Organize cited observations or labeled assumptions into strengths, weaknesses, opportunities and threats; record implications/actions. | A quadrant is an organizing aid, not a causal explanation or ranking algorithm.                                               |
| Root cause / Why chain | Organize proposed causal links in a tree; distinguish possibilities from supported or tested causes.                                   | Repeating “why” does not establish causation. Preserve alternative causes and the tests behind causal claims.                 |
| Risk                   | Record causes, consequences, existing controls, mitigations, likelihood/impact and written reasons.                                    | Qualitative categories are judgments. Acadia does not multiply ordinal categories into a universal risk score.                |
| Technology readiness   | Compare claimed TRL 1–9 with demonstrations, operating conditions, criteria and missing evidence.                                      | NASA-informed guidance is not NASA certification. Maturity in one setting does not establish readiness for every application. |

Guidance adapted from [ICD 203](https://www.dni.gov/files/documents/ICD/ICD-203.pdf), [Queensland SWOT guidance](https://www.business.qld.gov.au/running-business/planning/swot-analysis), [ASQ cause-analysis tools](https://asq.org/quality-resources/root-cause-analysis/tools), and [NASA Systems Engineering Handbook appendices](https://www.nasa.gov/reference/system-engineering-handbook-appendix/). Acadia distinguishes evidence artifacts, analysis activities and researcher/model actions using [W3C PROV concepts](https://www.w3.org/TR/prov-overview/); it does not claim formal conformance or standards certification.

## Three separate judgments

- **Citation integrity:** the reference and detected quotation correspond to the saved source passage and version. Ambiguous quotation associations require review. Automatic quotation detection is not exhaustive.
- **Evidential support:** the researcher records whether the passage supports the particular finding, is partial, is irrelevant/unsupported, or contradicts it.
- **Researcher confidence:** unassessed, low, moderate or high with a written basis. This is not an AI probability of truth.

Retrieval reserves equal portions of the available passage/character budget for pinned material, support queries, counterevidence queries and gap queries, redistributing unused capacity. The run records selected passages, omitted pins and other omissions. These categories describe search intent, not established evidence polarity. Model context remains finite even though full documents are indexed.

Run records retain sanitized logical requests, effective generation settings, retrieval decisions, exact source passages and pedigree revision snapshots. Credentials are excluded. Repeating these inputs does not guarantee identical model output.

## Reports and releases

The pedigree inspector follows the historical brief, findings, reasoning, assumptions, source appraisals, origins and passages behind a saved analysis. Changed brief/appraisal/method/source records flag reconsideration while the historical record remains unchanged.

The appendix is an editable preview. Appending it preserves existing writing and citations. DOCX, PDF and Markdown retain its tables, references and limitations. Release review runs local checks without a model. You can **Release with limitations** after acknowledging advisory warnings; invalid references remain integrity errors. A saved release freezes the reviewed document and pedigree. The separate Releaser receives the released document and citations, not private analytical notes or subsequent drafts.

## From a gap to a deliverable

Use **Plan a deliverable** after an analysis. Select software, curriculum, or another deliverable; describe the gap, proposed intervention and acceptance criteria. The plan retains the selected analysis snapshot and can propose phases, dependencies, resources, decision gates, validation and handoff. A proposal to build software or a curriculum is not itself proof that it will solve the problem.

**Prepare work packages** reads the explicit work-breakdown table into an editable register. Review the tasks, dependencies, acceptance criteria, owners, dates and status. Unknown owners and dates remain blank. No project tasks are sent to another service automatically.

**Export to PMIS** creates a ZIP with Monday and Jira CSVs, generic CSV/JSON, the research report, and a Planner JSON payload plus an interactive PowerShell/Microsoft Graph importer. The included mapping guide explains destination-specific limits. Native account assignments and scheduling links require destination setup; Planner import targets an existing basic plan and is not a direct CSV upload. Acadia never runs the importer itself.

For reporting and dashboards, use **Project menu → Export data for Power BI**. See [Power BI data export](POWER-BI.md) for the linked tables, privacy boundaries and relationship setup.

## Storage and portability

Acadia v0.5 writes portable archive format **v4**, retaining linked board references and revisioned gaps and decisions alongside analytical pedigree. **V4 requires Acadia v0.5 or later**; v0.4 cannot read it. V1–V3 imports retain existing cards, assets, relationships and reports; missing appraisal/review fields stay unassessed. There is no lossy legacy export option. SQLite migration creates a consistent recovery backup before applying transactional schema changes. An interrupted job becomes visibly failed/recoverable; it does not silently become successful analysis.

Full systematic reviews, statistical dataset analysis, weighted decision optimization, collaboration and autonomous investigations remain outside this release.
