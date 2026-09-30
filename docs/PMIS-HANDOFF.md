# Deliverable plans and PMIS handoff

A delivery plan proposes work in response to an analysis. It does not establish that the intervention is justified or that the research gap is resolved.

In Releaser, choose **Plan a deliverable** after selecting an analysis. Describe the gap and deliverable, and link saved research gaps and finding assessments where available. These links retain the selected revision numbers. Changing a gap or finding later does not silently change a plan's historical basis.

Use **Prepare work packages** or **Edit work packages** to refine the work. A software work package has a requirement; a curriculum work package has a learning objective. Record an acceptance test or assessment and link saved verification passages. Each verification reference retains its passage, source, and immutable source-version ID. Unknown owners and dates remain empty. Dependency IDs retain task relationships without inventing a schedule.

The editor saves a private draft locally. **Close — keep draft** preserves unapplied edits, including across restart. **Save work packages** validates and applies the plan to the report. **Discard draft** explicitly removes only unapplied edits. If the saved plan changed while a private draft was open, review the conflict before applying or discarding the buffer. Save a report revision to freeze the applied work packages with the report.

A work-package status of **complete** does not change the gap's status. Review the verification observations, limitations, and remaining criteria, then deliberately update the gap in **Gaps & decisions**.

## Review the export mapping

**Export to PMIS** shows destination identity, owner and dependency mappings, missing assignments/dates, and repeat-import limitations before creating local files. It does not contact an external service. The package contains:

- `delivery-plan.json`: full structured plan with stable work-package IDs and exact research references.
- `work-packages.csv`: general import table including requirements, objectives, tests, and reference tuples.
- `monday.csv`, `jira.csv`, and `planner.json`: destination-oriented adapters.
- `import-mapping.json`: the same mapping and unresolved-field summary shown in the app.
- `IMPORT-RECEIPT-TEMPLATE.csv`: space to record each destination item ID, URL, and target project/plan.
- `Import-Planner.ps1`, import instructions, and the research report.

| Destination | Identity and mapping                                                                                                                                  | Repeat-import limitation                                                                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monday      | Retain Acadia ID; map text/date/status fields deliberately. Configure member assignments and native dependencies in the destination.                  | Select the appropriate matching-column and duplicate behavior; an ordinary new-item import can create duplicates.                                                                             |
| Jira        | Retain Acadia Work Package ID in a suitable field and record created issue keys. Map available issue types and date formats.                          | The CSV is not an update/synchronization client. Reimporting without an appropriate destination workflow can create duplicates.                                                               |
| Planner     | Use the included preview-first importer against an existing basic plan. It retains Acadia IDs in a local receipt and provenance in task descriptions. | Preserve the receipt for partial-import recovery. It does not synchronize later edits; inspect interrupted create operations before retrying and do not reuse receipts across accounts/plans. |

Reference documentation: [Monday CSV import](https://support.monday.com/hc/en-us/articles/360000219209-Import-files-from-Excel), [Jira CSV import](https://support.atlassian.com/jira-software-cloud/docs/create-issues-using-the-csv-importer/), [Microsoft Graph Planner overview](https://learn.microsoft.com/en-us/graph/planner-concept-overview).

## Validation boundary

Local tests cover stable identifiers, exact revision references, dependencies, safe CSV quoting/formula neutralization, JSON payloads, mapping previews, and report retention. **Live Monday, Jira, and Planner tenant imports have not been verified by these tests.** A destination acceptance check must use an authorized test workspace, record the actual imported identities and field mappings, verify date/owner/dependency handling, and test repeated/interrupted import behavior. Keep the receipt with the export; a local file alone cannot prove the destination applied it correctly.

Power BI uses a separate local data bundle described in [POWER-BI.md](POWER-BI.md). It does not publish a dashboard or replace the PMIS adapters.
