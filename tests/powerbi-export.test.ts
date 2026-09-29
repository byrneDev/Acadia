import { describe, expect, it } from "vitest";
import { buildPowerBiFiles } from "../src/main/powerbi-export";
import { createBlankProject } from "../src/shared/project";
import {
  createAppraisal,
  createAssumption,
  createBrief,
  createFinding,
  createMethodRow,
  createMethodWorksheet,
  createOrigin,
  createReviewIssue,
  emptyPedigreeState,
  METHOD_REGISTRY,
} from "../src/shared/pedigree";
import type { Citation, Passage, ResearchState } from "../src/shared/research";
import type { DeliveryPlan } from "../src/shared/pmis";
const at = "2026-09-29T12:00:00.000Z";

/** Independent RFC4180 parser: tests must check what a consuming application receives. */
function parseCsv(input: string): Record<string, string>[] {
  const text = input.replace(/^\uFEFF/, ""),
    rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  const [header, ...data] = rows;
  return data.map((values) =>
    Object.fromEntries(header.map((name, i) => [name, values[i]])),
  );
}
function fixture() {
  const project = createBlankProject();
  project.id = "investigation";
  project.title = '=HYPERLINK("private", "Évidence")';
  project.question = "Does the pilot improve outcomes?";
  project.createdAt = project.updatedAt = at;
  const passages: Passage[] = [
    {
      id: "p1",
      sourceId: "s1",
      versionId: "v1",
      text: "PRIVATE_PASSAGE improved outcomes",
      locator: "Page 302, paragraph 8",
      page: 302,
      paragraph: 8,
      method: "native",
      inclusion: "include",
    },
    {
      id: "p2",
      sourceId: "s2",
      versionId: "v2",
      text: "PRIVATE_PASSAGE field outcomes deteriorated",
      locator: "Page 7",
      page: 7,
      method: "ocr",
      inclusion: "pin",
    },
  ];
  const citation: Citation = {
    id: "cite",
    label: "",
    sourceId: "s1",
    versionId: "v1",
    passageId: "p1",
    sourceTitle: "Lab study",
    locator: passages[0].locator,
    quote: "improved outcomes",
    acquiredAt: at,
    verified: true,
    url: "https://private.example/?token=PRIVATE_URL_TOKEN",
  };
  const research: ResearchState = {
    sources: [
      {
        id: "s1",
        projectId: project.id,
        title: "Lab study",
        kind: "document",
        currentVersionId: "v1",
        inclusion: "include",
        createdAt: at,
        updatedAt: at,
        assetId: "PRIVATE_ORIGINAL",
        url: "https://user:PRIVATE_URL_TOKEN@private.example",
      },
      {
        id: "s2",
        projectId: project.id,
        title: "Field audit",
        kind: "document",
        currentVersionId: "v2",
        inclusion: "pin",
        createdAt: at,
        updatedAt: at,
      },
      {
        id: "s3",
        projectId: project.id,
        title: "Lab copy",
        kind: "document",
        currentVersionId: "v3",
        inclusion: "include",
        duplicateOf: "s1",
        createdAt: at,
        updatedAt: at,
      },
    ],
    versions: ["v1", "v2", "v3"].map((id, i) => ({
      id,
      sourceId: `s${i + 1}`,
      hash: i === 2 ? "same-content" : `hash-${i}`,
      acquiredAt: at,
      title: `Version ${i}`,
      status: i === 1 ? "partial" : "ready",
      method: i === 1 ? "ocr" : "native",
      totalUnits: 302,
      processedUnits: i === 1 ? 7 : 302,
      publishedAt: "2024",
      snapshot: "PRIVATE_SNAPSHOT_HTML",
      error: "PRIVATE_EXTRACTION_ERROR",
    })),
    claims: [
      {
        id: "c1",
        projectId: project.id,
        title: "Pilot helps",
        question: project.question,
        status: "disputed",
        alternatives: "Lab conditions differ.",
        limitations: "No independent replication.",
        updatedAt: at,
        links: passages.map((p, i) => ({
          id: `link-${i}`,
          passageId: p.id,
          quote: p.text,
          rationale: 'Line 1, with comma\nLine 2 "quoted" — Évidence',
          relation: i ? "contradicts" : "supports",
        })),
      },
    ],
    tasks: [
      {
        id: "t1",
        projectId: project.id,
        title: "Replicate pilot",
        question: project.question,
        claimId: "c1",
        assumptionId: "a1",
        methodId: "method-risk",
        status: "planned",
        dueDate: "2026-10-12",
        criterion: "Include field observations",
        sourceIds: ["s2"],
        updatedAt: at,
      },
    ],
    jobs: [],
    discoveries: [],
    runs: [
      {
        id: "run1",
        projectId: project.id,
        question: "PRIVATE_RUN_QUESTION",
        instructions: "PRIVATE_INSTRUCTIONS",
        kind: "decision-brief",
        createdAt: at,
        provider: "offline",
        model: "local-model",
        templateVersion: "v4",
        citations: [citation],
        exclusions: ["PRIVATE_EXCLUSION_TEXT"],
        sourceVersions: ["v1", "v2"],
        response: "PRIVATE_RESPONSE",
        status: "completed",
        passages,
        queries: { support: ["PRIVATE_QUERY"], counter: [], gaps: [] },
        requests: [{ secret: "PRIVATE_REQUEST" }] as never,
        groundingWarnings: ["PRIVATE_GROUNDING_WARNING"],
      },
    ],
  };
  const pedigree = emptyPedigreeState();
  pedigree.briefs = [
    { ...createBrief(project.id, project.question), id: "b1" },
  ];
  pedigree.appraisals = [
    {
      ...createAppraisal(project.id, "s1", "v1"),
      id: "app1",
      origin: "unknown",
      passageIds: ["p1"],
      reviewStatus: "draft",
    },
  ];
  pedigree.assumptions = [
    {
      ...createAssumption(project.id),
      id: "a1",
      statement: "The lab generalizes",
      passageIds: ["p1"],
      claimIds: ["c1"],
    },
  ];
  pedigree.findings = [
    {
      ...createFinding(project.id, "c1"),
      id: "f1",
      confidence: "moderate",
      supportReview: "partial",
      confidenceBasis: "Conflicting field evidence",
      assumptionIds: ["a1"],
    },
  ];
  pedigree.origins = [
    { ...createOrigin(project.id, "s1", "s2"), id: "o1", status: "proposed" },
  ];
  pedigree.methods = METHOD_REGISTRY.map(({ kind }) => {
    const method = createMethodWorksheet(project.id, kind),
      row = createMethodRow(kind);
    method.id = `method-${kind}`;
    row.id = `row-${kind}`;
    row.text = `Recorded ${kind}`;
    row.passageIds = ["p1", "p2"];
    row.claimIds = ["c1"];
    row.assumptionIds = ["a1"];
    row.taskIds = ["t1"];
    if ("evaluations" in row)
      row.evaluations = [
        {
          passageId: "p2",
          assessment: "contradicts",
          rationale: "Field mismatch",
        },
      ];
    if ("assessedLevel" in row) row.assessedLevel = 4;
    if ("causes" in row) {
      row.causes = "Unsupported generalization";
      row.likelihood = "moderate";
    }
    if ("category" in row) {
      row.observationKind = "assumption";
      row.category = "threat";
    }
    method.rows = [row] as typeof method.rows;
    return method;
  });
  pedigree.issues = [
    {
      ...createReviewIssue(project.id, { kind: "claim", id: "c1" }),
      id: "issue1",
      summary: "Reconcile conflict",
      passageIds: ["p2"],
      claimIds: ["c1"],
      taskIds: ["t1"],
      assumptionIds: ["a1"],
    },
  ];
  const deliveryPlan: DeliveryPlan = {
    schemaVersion: 1,
    id: "plan1",
    title: "Build pilot",
    sourceOutputId: "report1",
    gap: "Lack of field outcomes",
    deliverableType: "software",
    updatedAt: at,
    reviewStatus: "draft",
    tasks: [
      {
        id: "w1",
        title: "Protocol",
        phase: "Design",
        description: "Field protocol",
        acceptanceCriteria: "Reviewed",
        dependencyIds: [],
        dependencyNotes: "",
        status: "planned",
        owner: "",
        dueDate: "",
      },
      {
        id: "w2",
        title: "Trial",
        phase: "Validation",
        description: "Run trial",
        acceptanceCriteria: "Results recorded",
        dependencyIds: ["w1"],
        dependencyNotes: "",
        status: "doing",
        owner: "Researcher",
        dueDate: "2026-10-12",
      },
    ],
  };
  project.outputs = [
    {
      id: "report1",
      kind: "project-plan",
      title: "Pilot plan",
      markdown: "PRIVATE_REPORT_BODY",
      createdAt: at,
      provider: "offline",
      sourceIds: ["s1", "s2"],
      boardUpdatedAt: at,
      runId: "run1",
      citations: [citation],
      deliveryPlan,
      releasedRevisionId: "r1",
      revisions: [
        {
          id: "r1",
          createdAt: at,
          document: {
            type: "doc",
            content: [{ type: "text", text: "PRIVATE_DOCUMENT_BODY" }],
          },
          markdown: "PRIVATE_REVISION_BODY",
          citations: [citation],
          note: "PRIVATE_REVISION_NOTE",
          deliveryPlan: structuredClone(deliveryPlan),
          review: {
            checkedAt: at,
            warnings: ["Historical missing evidence"],
            acknowledged: true,
          },
        },
      ],
    },
  ];
  return { project, research, pedigree, passages };
}

describe("Power BI research data handoff", () => {
  it("retains contradictions, unknown independence and qualitative confidence separately from citation integrity", () => {
    const f = fixture(),
      files = buildPowerBiFiles(f.project, f.research, f.pedigree, f.passages);
    expect(
      parseCsv(files["evidence_links.csv"]).map((r) => r.relation),
    ).toEqual(["supports", "contradicts"]);
    expect(
      parseCsv(files["evidence_links.csv"]).map(
        (r) => r.quotationLocationStatus,
      ),
    ).toEqual(["verified", "verified"]);
    expect(parseCsv(files["findings.csv"])[0]).toMatchObject({
      confidence: "moderate",
      supportReview: "partial",
      reviewStatus: "unassessed",
    });
    expect(parseCsv(files["appraisals.csv"])[0].origin).toBe("unknown");
    expect(
      parseCsv(files["sources.csv"]).map((r) => r.independenceStatus),
    ).toEqual(["unassessed", "unassessed", "duplicate-file"]);
    expect(parseCsv(files["source_versions.csv"])[1]).toMatchObject({
      extractionStatus: "partial",
      extractionMethod: "ocr",
      processedUnits: "7",
      totalUnits: "302",
    });
    expect(parseCsv(files["passages.csv"])[0]).toMatchObject({
      page: "302",
      locator: "Page 302, paragraph 8",
    });
    expect(
      parseCsv(files["quality_warnings.csv"]).some(
        (r) => r.id === "extraction-s2",
      ),
    ).toBe(true);
    expect(parseCsv(files["research_tasks.csv"])[0]).toMatchObject({
      assumptionId: "a1",
      methodId: "method-risk",
    });
  });
  it("exports only allowlisted data, without original text, URLs, private model inputs or responses", () => {
    const f = fixture(),
      before = JSON.stringify(f),
      files = buildPowerBiFiles(f.project, f.research, f.pedigree, f.passages);
    expect(Object.values(files).join("\n")).not.toContain("PRIVATE_");
    expect(JSON.stringify(f)).toBe(before);
    expect(parseCsv(files["analyses.csv"])[0]).toMatchObject({
      provider: "offline",
      model: "local-model",
      citationCount: "1",
      exclusionCount: "1",
      groundingWarningCount: "1",
    });
    expect(parseCsv(files["analysis_citations.csv"])[0]).toMatchObject({
      quotationLocationStatus: "verified",
      recordedVerified: "true",
      passageId: "p1",
    });
    f.project.outputs[0].citations![0] = {
      ...f.project.outputs[0].citations![0],
      locator: "Wrong location",
    };
    expect(
      parseCsv(
        buildPowerBiFiles(f.project, f.research, f.pedigree, f.passages)[
          "report_citations.csv"
        ],
      )[0].quotationLocationStatus,
    ).toBe("unverified");
  });
  it("roundtrips UTF-8, commas, quotes and multiline text while neutralizing spreadsheet formulas", () => {
    const f = fixture(),
      files = buildPowerBiFiles(f.project, f.research, f.pedigree, f.passages);
    expect(files["projects.csv"].charCodeAt(0)).toBe(0xfeff);
    expect(parseCsv(files["projects.csv"])[0].title).toBe(
      "'" + f.project.title,
    );
    expect(parseCsv(files["evidence_links.csv"])[0].rationale).toBe(
      f.research.claims[0].links[0].rationale,
    );
    f.pedigree.assumptions[0].statement = "\t@SUM(1,2)";
    expect(
      parseCsv(
        buildPowerBiFiles(f.project, f.research, f.pedigree, f.passages)[
          "assumptions.csv"
        ],
      )[0].statement,
    ).toBe("'\t@SUM(1,2)");
  });
  it("exports all five typed methods with numeric TRL and normalized evidence bridges", () => {
    const f = fixture(),
      files = buildPowerBiFiles(f.project, f.research, f.pedigree, f.passages);
    const rows = parseCsv(files["method_rows.csv"]);
    expect(rows.map((r) => r.kind)).toEqual(METHOD_REGISTRY.map((m) => m.kind));
    expect(rows.find((r) => r.kind === "trl")).toMatchObject({
      assessedLevel: "4",
    });
    expect(rows.find((r) => r.kind === "risk")).toMatchObject({
      likelihood: "moderate",
      causes: "Unsupported generalization",
      assessedLevel: "",
    });
    expect(rows.find((r) => r.kind === "swot")).toMatchObject({
      observationKind: "assumption",
      category: "threat",
    });
    expect(parseCsv(files["method_row_passages.csv"])).toHaveLength(10);
    expect(parseCsv(files["hypothesis_evaluations.csv"])[0]).toMatchObject({
      passageId: "p2",
      assessment: "contradicts",
      ordinal: "1",
    });
  });
  it("gives revision-scoped work packages unique keys and resolvable dependencies instead of counting snapshots as new work", () => {
    const f = fixture(),
      files = buildPowerBiFiles(f.project, f.research, f.pedigree, f.passages);
    const work = parseCsv(files["delivery_work_packages.csv"]),
      plans = parseCsv(files["delivery_plans.csv"]);
    expect(work).toHaveLength(4);
    expect(new Set(work.map((r) => r.id)).size).toBe(4);
    expect(new Set(work.map((r) => r.workPackageId)).size).toBe(2);
    expect(plans.map((p) => p.scope)).toEqual(["draft", "revision"]);
    expect(parseCsv(files["report_revisions.csv"])[0]).toMatchObject({
      isReleased: "true",
      reviewAcknowledged: "true",
      citationCount: "1",
    });
    for (const dependency of parseCsv(files["work_package_dependencies.csv"])) {
      const a = work.find((w) => w.id === dependency.workPackageId)!,
        b = work.find((w) => w.id === dependency.dependsOnWorkPackageId)!;
      expect(a.deliveryPlanId).toBe(b.deliveryPlanId);
    }
    expect(parseCsv(files["report_citations.csv"]).map((r) => r.scope)).toEqual(
      ["draft", "revision"],
    );
  });
  it("declares actual unique keys, resolvable relationships and typed folder import for every table", () => {
    const f = fixture(),
      files = buildPowerBiFiles(f.project, f.research, f.pedigree, f.passages),
      dictionary = JSON.parse(files["data-dictionary.json"]);
    for (const table of dictionary.tables) {
      const rows = parseCsv(files[`${table.name}.csv`]);
      expect(rows.length).toBe(table.rowCount);
      expect(
        new Set(
          rows.map((row) =>
            JSON.stringify(table.primaryKey.map((k: string) => row[k])),
          ),
        ).size,
        table.name,
      ).toBe(rows.length);
      expect(files["PowerQuery-AcadiaTable.m"]).toContain(`${table.name} = {`);
    }
    for (const relation of dictionary.relationships) {
      const parents = new Set(
        parseCsv(files[`${relation.toTable}.csv`]).map(
          (r) => r[relation.toColumn],
        ),
      );
      for (const child of parseCsv(files[`${relation.fromTable}.csv`]))
        if (child[relation.fromColumn])
          expect(
            parents.has(child[relation.fromColumn]),
            `${relation.fromTable}.${relation.fromColumn}`,
          ).toBe(true);
    }
    expect(files["PowerQuery-AcadiaTable.m"]).toContain(
      '{"assessedLevel", Int64.Type}',
    );
    expect(files["PowerQuery-AcadiaTable.m"]).toContain(
      '{"confidence", type text}',
    );
    expect(files["PowerQuery-AcadiaTable.m"]).toContain(
      '{"isReleased", type logical}',
    );
    expect(files["PowerQuery-AcadiaTable.m"]).toContain(
      '{"dueDate", type date}',
    );
    expect(files["PowerQuery-AcadiaTable.m"]).toContain(
      "QuoteStyle=QuoteStyle.Csv",
    );
    expect(files["PowerQuery-AcadiaTable.m"]).not.toMatch(
      /Web\.Contents|Authorization|apiKey/,
    );
  });
  it("keeps empty CSV schemas and deterministic output without generating any score", () => {
    const project = createBlankProject(),
      research: ResearchState = {
        sources: [],
        versions: [],
        claims: [],
        tasks: [],
        runs: [],
        discoveries: [],
        jobs: [],
      },
      pedigree = emptyPedigreeState();
    const files = buildPowerBiFiles(project, research, pedigree, []);
    expect(parseCsv(files["delivery_work_packages.csv"])).toEqual([]);
    expect(files["source_versions.csv"]).toContain('"contentHash"');
    expect(parseCsv(files["quality_warnings.csv"]).map((r) => r.id)).toEqual([
      "brief",
      "brief-review",
    ]);
    expect(files).toEqual(buildPowerBiFiles(project, research, pedigree, []));
    const allColumnNames = JSON.parse(
      files["data-dictionary.json"],
    ).tables.flatMap((t: { columns: { name: string }[] }) =>
      t.columns.map((c) => c.name),
    );
    expect(allColumnNames).not.toContain("qualityScore");
    expect(allColumnNames).not.toContain("confidencePercent");
  });
});
