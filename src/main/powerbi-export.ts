import type { Project } from "../shared/types";
import type { Citation, Passage, ResearchState } from "../shared/research";
import type { PedigreeState } from "../shared/pedigree";
import type { DeliveryPlan } from "../shared/pmis";
import { csvCell } from "../shared/pmis";
import { analyticalChecks } from "../shared/report-pedigree";

type DataType = "text" | "integer" | "boolean" | "date" | "datetimezone";
type Cell = string | number | boolean | null | undefined;
interface Column {
  name: string;
  type: DataType;
  nullable: boolean;
}
interface Table {
  name: string;
  grain: string;
  primaryKey: string[];
  columns: Column[];
  rows: Record<string, Cell>[];
}
interface Relationship {
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  cardinality: "many-to-one";
  suggestedActive: boolean;
}
const composite = (...parts: string[]) =>
  parts.map(encodeURIComponent).join(":");
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

/** Explicitly allowlisted local research metadata; never model payloads, credentials, or source text. */
export function buildPowerBiFiles(
  project: Project,
  research: ResearchState,
  pedigree: PedigreeState,
  passages: Passage[],
): Record<string, string> {
  const tables: Table[] = [],
    relationships: Relationship[] = [];
  const table = (
    name: string,
    grain: string,
    primaryKey: string[],
    declaration: string,
    rows: Record<string, Cell>[],
  ) => {
    const columns = declaration
      .split(/\s+/)
      .filter(Boolean)
      .map((field): Column => {
        const [raw, type = "text"] = field.split(":");
        return {
          name: raw.replace(/\?$/, ""),
          type: type as DataType,
          nullable: raw.endsWith("?"),
        };
      });
    tables.push({ name, grain, primaryKey, columns, rows });
  };
  const relation = (
    fromTable: string,
    fromColumn: string,
    toTable: string,
    toColumn = "id",
    suggestedActive = true,
  ) =>
    relationships.push({
      fromTable,
      fromColumn,
      toTable,
      toColumn,
      cardinality: "many-to-one",
      suggestedActive,
    });
  const revisionFields =
    "id projectId revision:integer createdAt:datetimezone updatedAt:datetimezone";
  const meta = (entity: {
    id: string;
    projectId: string;
    revision: number;
    createdAt: string;
    updatedAt: string;
  }) => ({
    id: entity.id,
    projectId: entity.projectId,
    revision: entity.revision,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  });
  const passageMap = new Map(passages.map((p) => [p.id, p]));
  const sourceMap = new Map(research.sources.map((s) => [s.id, s]));
  const knownShared = new Set(
    pedigree.origins
      .filter((o) => o.status === "confirmed")
      .flatMap((o) => [o.sourceId, o.relatedSourceId]),
  );
  table(
    "projects",
    "One investigation at export time; not an analytical score.",
    ["id"],
    "id title question createdAt:datetimezone updatedAt:datetimezone schemaVersion:integer releasedOutputId?",
    [
      {
        id: project.id,
        title: project.title,
        question: project.question,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        schemaVersion: project.schemaVersion,
        releasedOutputId: project.releasedOutputId,
      },
    ],
  );
  table(
    "sources",
    "One source record. Unknown independence is not independent corroboration.",
    ["id"],
    "id projectId title kind currentVersionId inclusion derived:boolean includedEvidence:boolean evidenceRole duplicateOf? independenceStatus createdAt:datetimezone updatedAt:datetimezone",
    research.sources.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      title: s.title,
      kind: s.kind,
      currentVersionId: s.currentVersionId,
      inclusion: s.inclusion,
      derived: Boolean(s.derived),
      includedEvidence: !s.derived && s.inclusion !== "exclude",
      evidenceRole: s.derived ? "historical-analytical-copy" : "source",
      duplicateOf: s.duplicateOf,
      independenceStatus: s.duplicateOf
        ? "duplicate-file"
        : knownShared.has(s.id)
          ? "shared-origin-confirmed"
          : "unassessed",
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  );
  table(
    "source_versions",
    "One immutable acquired source version. Coverage counts extraction units, not credibility.",
    ["id"],
    "id sourceId contentHash acquiredAt:datetimezone title author? publisher? publishedAt? extractionStatus extractionMethod totalUnits:integer processedUnits:integer isCurrent:boolean",
    research.versions.map((v) => ({
      id: v.id,
      sourceId: v.sourceId,
      contentHash: v.hash,
      acquiredAt: v.acquiredAt,
      title: v.title,
      author: v.author,
      publisher: v.publisher,
      publishedAt: v.publishedAt,
      extractionStatus: v.status,
      extractionMethod: v.method,
      totalUnits: v.totalUnits,
      processedUnits: v.processedUnits,
      isCurrent: sourceMap.get(v.sourceId)?.currentVersionId === v.id,
    })),
  );
  table(
    "passages",
    "One saved passage locator, without extracted text. Historical versions remain distinct.",
    ["id"],
    "id sourceId versionId locator page?:integer paragraph?:integer extractionMethod inclusion",
    passages.map((p) => ({
      id: p.id,
      sourceId: p.sourceId,
      versionId: p.versionId,
      locator: p.locator,
      page: p.page,
      paragraph: p.paragraph,
      extractionMethod: p.method,
      inclusion: p.inclusion,
    })),
  );
  table(
    "claims",
    "One current evidence claim; a researcher status is not citation verification.",
    ["id"],
    "id projectId title question status alternatives limitations updatedAt:datetimezone",
    research.claims.map((c) => ({
      id: c.id,
      projectId: c.projectId,
      title: c.title,
      question: c.question,
      status: c.status,
      alternatives: c.alternatives,
      limitations: c.limitations,
      updatedAt: c.updatedAt,
    })),
  );
  table(
    "research_gaps",
    "Current manually reviewed gap state. Completed delivery work never resolves a gap automatically.",
    ["id"],
    `${revisionFields} title missingInformation importance resolutionCriteria status`,
    pedigree.gaps.map((g) => ({
      ...meta(g),
      title: g.title,
      missingInformation: g.missingInformation,
      importance: g.importance,
      resolutionCriteria: g.resolutionCriteria,
      status: g.status,
    })),
  );
  table(
    "decisions",
    "Current researcher decision, separate from proposed delivery work.",
    ["id"],
    `${revisionFields} title action rationale alternatives status`,
    pedigree.decisions.map((d) => ({
      ...meta(d),
      title: d.title,
      action: d.action,
      rationale: d.rationale,
      alternatives: d.alternatives,
      status: d.status,
    })),
  );
  table(
    "accepted_reviews",
    "One human-accepted item review per canonical claim. Private notes and quotations omitted; acceptance does not imply evidential support.",
    ["id"],
    "id claimId runId insightId acceptedAt:datetimezone targetKind targetId targetVersionId? sourceId? versionId? noteLength:integer citationCount:integer",
    research.claims.flatMap((c) =>
      c.itemReview
        ? [
            {
              id: c.id,
              claimId: c.id,
              runId: c.itemReview.runId,
              insightId: c.itemReview.insightId,
              acceptedAt: c.itemReview.acceptedAt,
              targetKind: c.itemReview.target.kind,
              targetId: c.itemReview.target.id,
              targetVersionId: c.itemReview.target.versionId,
              sourceId: c.itemReview.sourceId,
              versionId: c.itemReview.versionId,
              noteLength: c.itemReview.notes.length,
              citationCount: c.itemReview.citations.length,
            },
          ]
        : [],
    ),
  );
  const linkRows = research.claims.flatMap((c) =>
    c.links.map((link) => {
      const passage = passageMap.get(link.passageId);
      return {
        id: composite(c.id, link.id),
        evidenceLinkId: link.id,
        claimId: c.id,
        passageId: link.passageId,
        relation: link.relation,
        rationale: link.rationale,
        quotationLocationStatus:
          passage &&
          normalize(link.quote) &&
          normalize(passage.text).includes(normalize(link.quote))
            ? passage.method === "legacy"
              ? "legacy"
              : "verified"
            : "unverified",
      };
    }),
  );
  table(
    "evidence_links",
    "One claim-to-passage link. Supports and contradicts are retained separately; quotes omitted.",
    ["id"],
    "id evidenceLinkId claimId passageId relation rationale quotationLocationStatus",
    linkRows,
  );
  table(
    "briefs",
    "Current revision of the investigation brief; empty fields remain unassessed.",
    ["id"],
    `${revisionFields} question decision scope dateFrom?:date dateTo?:date inclusionCriteria exclusionCriteria successCriteria reviewStatus`,
    pedigree.briefs.map((b) => ({
      ...meta(b),
      question: b.question,
      decision: b.decision,
      scope: b.scope,
      dateFrom: b.dateFrom,
      dateTo: b.dateTo,
      inclusionCriteria: b.inclusionCriteria,
      exclusionCriteria: b.exclusionCriteria,
      successCriteria: b.successCriteria,
      reviewStatus: b.reviewStatus,
    })),
  );
  table(
    "findings",
    "Current researcher finding assessment. Confidence is qualitative, never a probability or quality score.",
    ["id"],
    `${revisionFields} claimId classification reasoning confidence confidenceBasis wouldChange supportReview reviewStatus`,
    pedigree.findings.map((f) => ({
      ...meta(f),
      claimId: f.claimId,
      classification: f.classification,
      reasoning: f.reasoning,
      confidence: f.confidence,
      confidenceBasis: f.confidenceBasis,
      wouldChange: f.wouldChange,
      supportReview: f.supportReview,
      reviewStatus: f.reviewStatus,
    })),
  );
  table(
    "appraisals",
    "Current appraisal revision for an exact source/version pair. Unknown origin stays unknown.",
    ["id"],
    `${revisionFields} sourceId versionId evidenceType origin methods applicability currency limitations bias rationale reviewStatus`,
    pedigree.appraisals.map((a) => ({
      ...meta(a),
      sourceId: a.sourceId,
      versionId: a.versionId,
      evidenceType: a.evidenceType,
      origin: a.origin,
      methods: a.methods,
      applicability: a.applicability,
      currency: a.currency,
      limitations: a.limitations,
      bias: a.bias,
      rationale: a.rationale,
      reviewStatus: a.reviewStatus,
    })),
  );
  table(
    "origins",
    "Current source-to-source origin assertion; proposed/rejected edges are not confirmed dependencies.",
    ["id"],
    `${revisionFields} sourceId relatedSourceId kind status rationale`,
    pedigree.origins.map((o) => ({
      ...meta(o),
      sourceId: o.sourceId,
      relatedSourceId: o.relatedSourceId,
      kind: o.kind,
      status: o.status,
      rationale: o.rationale,
    })),
  );
  table(
    "assumptions",
    "Current assumption revision; no assumption recorded does not imply no assumptions exist.",
    ["id"],
    `${revisionFields} statement basis consequence validation status`,
    pedigree.assumptions.map((a) => ({
      ...meta(a),
      statement: a.statement,
      basis: a.basis,
      consequence: a.consequence,
      validation: a.validation,
      status: a.status,
    })),
  );
  table(
    "methods",
    "Current worksheet revision. Methods are researcher aids, not standards certification.",
    ["id"],
    `${revisionFields} kind title objective limitations nextSteps reviewStatus`,
    pedigree.methods.map((m) => ({
      ...meta(m),
      kind: m.kind,
      title: m.title,
      objective: m.objective,
      limitations: m.limitations,
      nextSteps: m.nextSteps,
      reviewStatus: m.reviewStatus,
    })),
  );
  const rowPairs = pedigree.methods.flatMap((m) =>
    m.rows.map((row) => ({ method: m, row, rowKey: composite(m.id, row.id) })),
  );
  table(
    "method_rows",
    "One worksheet row with method-specific typed columns. Blank fields do not apply to that method.",
    ["id"],
    "id methodId rowId kind text nextTest predictions? discriminatingTest? observationKind? category? implications? actions? parentRowId? causalStatus? rationale? testEvidence? causes? consequences? controls? likelihood? likelihoodBasis? impact? impactBasis? mitigation? owner? residualRisk? element? environment? assessedLevel?:integer criteria? demonstrated? requiredEvidence?",
    rowPairs.map(({ method, row, rowKey }) => ({
      id: rowKey,
      methodId: method.id,
      rowId: row.id,
      kind: method.kind,
      text: row.text,
      nextTest: row.nextTest,
      ...("predictions" in row
        ? {
            predictions: row.predictions,
            discriminatingTest: row.discriminatingTest,
          }
        : {}),
      ...("category" in row
        ? {
            observationKind: row.observationKind,
            category: row.category,
            implications: row.implications,
            actions: row.actions,
          }
        : {}),
      ...("causalStatus" in row
        ? {
            parentRowId: row.parentId
              ? composite(method.id, row.parentId)
              : undefined,
            causalStatus: row.causalStatus,
            rationale: row.rationale,
            testEvidence: row.testEvidence,
          }
        : {}),
      ...("likelihood" in row
        ? {
            causes: row.causes,
            consequences: row.consequences,
            controls: row.controls,
            likelihood: row.likelihood,
            likelihoodBasis: row.likelihoodBasis,
            impact: row.impact,
            impactBasis: row.impactBasis,
            mitigation: row.mitigation,
            owner: row.owner,
            residualRisk: row.residualRisk,
          }
        : {}),
      ...("assessedLevel" in row
        ? {
            element: row.element,
            environment: row.environment,
            assessedLevel: row.assessedLevel,
            criteria: row.criteria,
            demonstrated: row.demonstrated,
            requiredEvidence: row.requiredEvidence,
          }
        : {}),
    })),
  );
  table(
    "hypothesis_evaluations",
    "One passage assessment against one hypothesis row; assessment is a researcher judgement.",
    ["methodRowId", "ordinal"],
    "methodRowId ordinal:integer passageId assessment rationale",
    rowPairs.flatMap(({ row, rowKey }) =>
      "evaluations" in row
        ? row.evaluations.map((e, index) => ({
            methodRowId: rowKey,
            ordinal: index + 1,
            passageId: e.passageId,
            assessment: e.assessment,
            rationale: e.rationale,
          }))
        : [],
    ),
  );
  table(
    "research_tasks",
    "One follow-up task with direct claim, assumption or method gap links.",
    ["id"],
    "id projectId title question claimId? assumptionId? methodId? status dueDate?:date criterion updatedAt:datetimezone",
    research.tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      title: t.title,
      question: t.question,
      claimId: t.claimId,
      assumptionId: t.assumptionId,
      methodId: t.methodId,
      status: t.status,
      dueDate: t.dueDate,
      criterion: t.criterion,
      updatedAt: t.updatedAt,
    })),
  );
  table(
    "review_issues",
    "Current unresolved or resolved review issue; no model request or response is exported.",
    ["id"],
    `${revisionFields} targetKind targetId category summary detail status rationale origin runId? reportId? claimId? methodId?`,
    pedigree.issues.map((i) => ({
      ...meta(i),
      targetKind: i.target.kind,
      targetId: i.target.id,
      category: i.category,
      summary: i.summary,
      detail: i.detail,
      status: i.status,
      rationale: i.rationale,
      origin: i.origin,
      runId: i.runId,
      reportId: i.reportId,
      claimId: i.claimId,
      methodId: i.methodId,
    })),
  );

  const bridge = (
    name: string,
    left: string,
    right: string,
    rows: Record<string, Cell>[],
    leftTable: string,
    rightTable: string,
  ) => {
    const unique = [
      ...new Map(
        rows.map((row) => [
          composite(String(row[left]), String(row[right])),
          row,
        ]),
      ).values(),
    ];
    table(
      name,
      `One ${leftTable}-to-${rightTable} association; use a bridge, not a direct many-to-many join.`,
      [left, right],
      `${left} ${right}`,
      unique,
    );
    relation(name, left, leftTable);
    relation(name, right, rightTable, "id", false);
  };
  for (const [field, target, key] of [
    ["claimIds", "claims", "claimId"],
    ["taskIds", "research_tasks", "taskId"],
    ["passageIds", "passages", "passageId"],
  ] as const)
    bridge(
      `gap_${target}`,
      "gapId",
      key,
      pedigree.gaps.flatMap((g) =>
        g[field].map((id) => ({ gapId: g.id, [key]: id })),
      ),
      "research_gaps",
      target,
    );
  for (const [field, target, key] of [
    ["claimIds", "claims", "claimId"],
    ["assumptionIds", "assumptions", "assumptionId"],
    ["outputIds", "reports", "reportId"],
  ] as const)
    bridge(
      `decision_${target}`,
      "decisionId",
      key,
      pedigree.decisions.flatMap((d) =>
        d[field].map((id) => ({ decisionId: d.id, [key]: id })),
      ),
      "decisions",
      target,
    );
  bridge(
    "appraisal_passages",
    "appraisalId",
    "passageId",
    pedigree.appraisals.flatMap((a) =>
      a.passageIds.map((passageId) => ({ appraisalId: a.id, passageId })),
    ),
    "appraisals",
    "passages",
  );
  bridge(
    "finding_assumptions",
    "findingId",
    "assumptionId",
    pedigree.findings.flatMap((f) =>
      f.assumptionIds.map((assumptionId) => ({
        findingId: f.id,
        assumptionId,
      })),
    ),
    "findings",
    "assumptions",
  );
  bridge(
    "assumption_passages",
    "assumptionId",
    "passageId",
    pedigree.assumptions.flatMap((a) =>
      a.passageIds.map((passageId) => ({ assumptionId: a.id, passageId })),
    ),
    "assumptions",
    "passages",
  );
  bridge(
    "assumption_claims",
    "assumptionId",
    "claimId",
    pedigree.assumptions.flatMap((a) =>
      a.claimIds.map((claimId) => ({ assumptionId: a.id, claimId })),
    ),
    "assumptions",
    "claims",
  );
  for (const [field, target, key] of [
    ["passageIds", "passages", "passageId"],
    ["claimIds", "claims", "claimId"],
    ["assumptionIds", "assumptions", "assumptionId"],
    ["taskIds", "research_tasks", "taskId"],
  ] as const) {
    bridge(
      `method_row_${target}`,
      "methodRowId",
      key,
      rowPairs.flatMap(({ row, rowKey }) =>
        row[field].map((id) => ({ methodRowId: rowKey, [key]: id })),
      ),
      "method_rows",
      target,
    );
    bridge(
      `review_issue_${target}`,
      "issueId",
      key,
      pedigree.issues.flatMap((i) =>
        i[field].map((id) => ({ issueId: i.id, [key]: id })),
      ),
      "review_issues",
      target,
    );
  }
  bridge(
    "task_sources",
    "taskId",
    "sourceId",
    research.tasks.flatMap((t) =>
      t.sourceIds.map((sourceId) => ({ taskId: t.id, sourceId })),
    ),
    "research_tasks",
    "sources",
  );
  table(
    "analyses",
    "One analysis run's metadata only. Prompts, responses, requests, endpoint URLs and retrieved document text are excluded.",
    ["id"],
    "id projectId kind createdAt:datetimezone provider model templateVersion status pedigreeSnapshotId? citationCount:integer sourceVersionCount:integer exclusionCount:integer groundingWarningCount:integer",
    research.runs.map((r) => ({
      id: r.id,
      projectId: r.projectId,
      kind: r.kind,
      createdAt: r.createdAt,
      provider: r.provider,
      model: r.model,
      templateVersion: r.templateVersion,
      status: r.status,
      pedigreeSnapshotId: r.pedigreeSnapshotId,
      citationCount: r.citations.length,
      sourceVersionCount: r.sourceVersions.length,
      exclusionCount: r.exclusions.length,
      groundingWarningCount: r.groundingWarnings?.length || 0,
    })),
  );
  bridge(
    "analysis_source_versions",
    "analysisId",
    "versionId",
    research.runs.flatMap((r) =>
      r.sourceVersions.map((versionId) => ({ analysisId: r.id, versionId })),
    ),
    "analyses",
    "source_versions",
  );
  table(
    "reports",
    "One editable report; release selection is explicit and report content is omitted.",
    ["id"],
    "id projectId kind title createdAt:datetimezone provider runId? pedigreeSnapshotId? releasedRevisionId? sourceAnalysisId? sourceAnalysisRevisionId? gapClaimId? gap? deliverableType? deliverable? acceptanceCriteria?",
    project.outputs.map((o) => ({
      id: o.id,
      projectId: project.id,
      kind: o.kind,
      title: o.title,
      createdAt: o.createdAt,
      provider: o.provider,
      runId: o.runId,
      pedigreeSnapshotId: o.pedigreeSnapshotId,
      releasedRevisionId: o.releasedRevisionId,
      sourceAnalysisId: o.plan?.analysisOutputId,
      sourceAnalysisRevisionId: o.plan?.analysisRevisionId,
      gapClaimId: o.plan?.gapClaimId,
      gap: o.plan?.gap,
      deliverableType: o.plan?.deliverableType,
      deliverable: o.plan?.deliverable,
      acceptanceCriteria: o.plan?.acceptanceCriteria,
    })),
  );
  table(
    "report_revisions",
    "One immutable saved report revision; current drafts are not revisions. Released state is local selection at export time.",
    ["id"],
    "id revisionId reportId createdAt:datetimezone pedigreeSnapshotId? isReleased:boolean reviewCheckedAt?:datetimezone reviewAcknowledged?:boolean reviewWarningCount:integer citationCount:integer sourceAnalysisId? sourceAnalysisRevisionId? gapClaimId? gap? deliverableType? deliverable? acceptanceCriteria?",
    project.outputs.flatMap((o) =>
      (o.revisions || []).map((r) => ({
        id: composite(o.id, r.id),
        revisionId: r.id,
        reportId: o.id,
        createdAt: r.createdAt,
        pedigreeSnapshotId: r.pedigreeSnapshotId,
        isReleased: o.releasedRevisionId === r.id,
        reviewCheckedAt: r.review?.checkedAt,
        reviewAcknowledged: r.review?.acknowledged,
        reviewWarningCount: r.review?.warnings.length || 0,
        citationCount: r.citations.length,
        sourceAnalysisId: r.plan?.analysisOutputId,
        sourceAnalysisRevisionId: r.plan?.analysisRevisionId,
        gapClaimId: r.plan?.gapClaimId,
        gap: r.plan?.gap,
        deliverableType: r.plan?.deliverableType,
        deliverable: r.plan?.deliverable,
        acceptanceCriteria: r.plan?.acceptanceCriteria,
      })),
    ),
  );
  const citationRow = (c: Citation, scope: string) => {
    const p = passageMap.get(c.passageId),
      legacy = Boolean(c.legacyCardId && !c.passageId);
    const matches =
      p &&
      p.sourceId === c.sourceId &&
      p.versionId === c.versionId &&
      p.locator === c.locator &&
      normalize(c.quote) &&
      normalize(p.text).includes(normalize(c.quote));
    return {
      id: composite(scope, c.id),
      citationId: c.id,
      sourceId: c.sourceId || undefined,
      versionId: c.versionId || undefined,
      passageId: c.passageId || undefined,
      locator: c.locator,
      acquiredAt: c.acquiredAt,
      recordedVerified: c.verified,
      quotationLocationStatus:
        legacy || p?.method === "legacy"
          ? "legacy"
          : matches
            ? "verified"
            : "unverified",
      legacyCardId: c.legacyCardId,
    };
  };
  const citationFields =
    "id citationId sourceId? versionId? passageId? locator acquiredAt:datetimezone recordedVerified:boolean quotationLocationStatus legacyCardId?";
  table(
    "accepted_review_citations",
    "One frozen reference attached to human-accepted notes. Location validity remains separate from evidential support.",
    ["id"],
    `${citationFields} reviewId`,
    research.claims.flatMap((c) =>
      (c.itemReview?.citations || []).map((ref) => ({
        ...citationRow(ref, c.id),
        reviewId: c.id,
      })),
    ),
  );
  relation("accepted_reviews", "claimId", "claims");
  relation("accepted_reviews", "runId", "analyses", "id", false);
  relation("accepted_review_citations", "reviewId", "accepted_reviews");
  table(
    "analysis_citations",
    "One citation per run; location checked against saved passage locally, independent of support and confidence. Quote text omitted.",
    ["id"],
    `${citationFields} analysisId`,
    research.runs.flatMap((r) =>
      r.citations.map((c) => ({ ...citationRow(c, r.id), analysisId: r.id })),
    ),
  );
  table(
    "report_citations",
    "One citation per editable draft or immutable report revision. Scope keys prevent draft/revision double counting.",
    ["id"],
    `${citationFields} reportId reportRevisionId? scope`,
    project.outputs.flatMap((o) => [
      ...(o.citations || []).map((c) => ({
        ...citationRow(c, composite(o.id, "draft")),
        reportId: o.id,
        scope: "draft",
      })),
      ...(o.revisions || []).flatMap((r) =>
        r.citations.map((c) => ({
          ...citationRow(c, composite(o.id, r.id)),
          reportId: o.id,
          reportRevisionId: composite(o.id, r.id),
          scope: "revision",
        })),
      ),
    ]),
  );

  const planRows: Record<string, Cell>[] = [],
    workRows: Record<string, Cell>[] = [],
    dependencies: Record<string, Cell>[] = [],
    verification: Record<string, Cell>[] = [],
    deliveryRefs: Record<string, Cell>[] = [];
  const addRefs = (
    ownerId: string,
    ownerKind: "plan" | "work-package",
    value: Pick<DeliveryPlan, "gapRefs" | "findingRefs">,
  ) => {
    for (const [kind, refs, current] of [
      ["gap", value.gapRefs, pedigree.gaps],
      ["finding", value.findingRefs, pedigree.findings],
    ] as const)
      for (const ref of refs || [])
        deliveryRefs.push({
          id: composite(ownerId, kind, ref.id),
          ownerKind,
          deliveryPlanId: ownerKind === "plan" ? ownerId : undefined,
          workPackageId: ownerKind === "work-package" ? ownerId : undefined,
          recordKind: kind,
          gapId: kind === "gap" ? ref.id : undefined,
          findingId: kind === "finding" ? ref.id : undefined,
          recordRevision: ref.revision,
          currentRevisionMatches:
            current.find((r) => r.id === ref.id)?.revision === ref.revision,
        });
  };
  const addPlan = (
    plan: DeliveryPlan,
    reportId: string,
    revisionId?: string,
  ) => {
    const key = composite(reportId, revisionId || "draft", plan.id);
    addRefs(key, "plan", plan);
    planRows.push({
      id: key,
      planId: plan.id,
      reportId,
      reportRevisionId: revisionId
        ? composite(reportId, revisionId)
        : undefined,
      scope: revisionId ? "revision" : "draft",
      title: plan.title,
      sourceOutputId: plan.sourceOutputId,
      sourceRevisionId: plan.sourceRevisionId,
      gap: plan.gap,
      deliverableType: plan.deliverableType,
      updatedAt: plan.updatedAt,
      reviewStatus: plan.reviewStatus,
    });
    for (const task of plan.tasks) {
      const workKey = composite(key, task.id);
      addRefs(workKey, "work-package", task);
      for (const ref of task.verificationEvidence || [])
        verification.push({
          id: composite(workKey, ref.passageId),
          workPackageId: workKey,
          ...ref,
        });
      workRows.push({
        id: workKey,
        workPackageId: task.id,
        deliveryPlanId: key,
        title: task.title,
        phase: task.phase,
        description: task.description,
        acceptanceCriteria: task.acceptanceCriteria,
        requirement: task.requirement,
        learningObjective: task.learningObjective,
        acceptanceTest: task.acceptanceTest,
        dependencyNotes: task.dependencyNotes,
        status: task.status,
        owner: task.owner,
        dueDate: task.dueDate,
      });
      for (const id of task.dependencyIds)
        dependencies.push({
          workPackageId: workKey,
          dependsOnWorkPackageId: composite(key, id),
        });
    }
  };
  for (const output of project.outputs) {
    if (output.deliveryPlan) addPlan(output.deliveryPlan, output.id);
    for (const revision of output.revisions || [])
      if (revision.deliveryPlan)
        addPlan(revision.deliveryPlan, output.id, revision.id);
  }
  table(
    "delivery_plans",
    "One delivery plan per draft or revision; filter scope before aggregating current work.",
    ["id"],
    "id planId reportId reportRevisionId? scope title sourceOutputId sourceRevisionId? gap deliverableType updatedAt:datetimezone reviewStatus",
    planRows,
  );
  table(
    "delivery_work_packages",
    "One work package in one draft/revision plan. Original workPackageId repeats across revisions; id is the unique export key.",
    ["id"],
    "id workPackageId deliveryPlanId title phase description acceptanceCriteria requirement? learningObjective? acceptanceTest? dependencyNotes status owner dueDate?:date",
    workRows,
  );
  table(
    "delivery_record_references",
    "One plan/work-package reference to an exact gap/finding revision. Relationships expose current record labels only; compare currentRevisionMatches before interpreting current assessment as the saved assessment.",
    ["id"],
    "id ownerKind deliveryPlanId? workPackageId? recordKind gapId? findingId? recordRevision:integer currentRevisionMatches:boolean",
    deliveryRefs,
  );
  table(
    "work_package_verification",
    "One exact saved passage reference proposed as verification evidence. Presence is not proof of acceptance or gap resolution.",
    ["id"],
    "id workPackageId passageId sourceId versionId",
    verification,
  );
  for (const [column, target] of [
    ["deliveryPlanId", "delivery_plans"],
    ["workPackageId", "delivery_work_packages"],
    ["gapId", "research_gaps"],
    ["findingId", "findings"],
  ])
    relation("delivery_record_references", column, target, "id", false);
  relation(
    "work_package_verification",
    "workPackageId",
    "delivery_work_packages",
  );
  for (const [column, target] of [
    ["passageId", "passages"],
    ["sourceId", "sources"],
    ["versionId", "source_versions"],
  ])
    relation("work_package_verification", column, target, "id", false);
  bridge(
    "work_package_dependencies",
    "workPackageId",
    "dependsOnWorkPackageId",
    dependencies,
    "delivery_work_packages",
    "delivery_work_packages",
  );
  table(
    "quality_warnings",
    "One deterministic current completeness warning, not an AI confidence or numerical quality score.",
    ["id"],
    "id projectId severity message",
    analyticalChecks(pedigree, research, passages).map((c) => ({
      id: c.id,
      projectId: project.id,
      severity: c.severity,
      message: c.message,
    })),
  );

  for (const t of tables)
    if (t.columns.some((c) => c.name === "projectId"))
      relation(t.name, "projectId", "projects");
  relation("source_versions", "sourceId", "sources");
  relation("passages", "versionId", "source_versions");
  relation("passages", "sourceId", "sources", "id", false);
  relation("sources", "duplicateOf", "sources", "id", false);
  relation("evidence_links", "claimId", "claims");
  relation("evidence_links", "passageId", "passages", "id", false);
  relation("findings", "claimId", "claims", "id", false);
  relation("appraisals", "versionId", "source_versions", "id", false);
  relation("appraisals", "sourceId", "sources", "id", false);
  relation("origins", "sourceId", "sources", "id", false);
  relation("origins", "relatedSourceId", "sources", "id", false);
  relation("method_rows", "methodId", "methods");
  relation("method_rows", "parentRowId", "method_rows", "id", false);
  relation("hypothesis_evaluations", "methodRowId", "method_rows");
  relation("hypothesis_evaluations", "passageId", "passages", "id", false);
  for (const [column, target] of [
    ["claimId", "claims"],
    ["assumptionId", "assumptions"],
    ["methodId", "methods"],
  ])
    relation("research_tasks", column, target, "id", false);
  relation("report_revisions", "reportId", "reports");
  relation("reports", "runId", "analyses", "id", false);
  relation("projects", "releasedOutputId", "reports", "id", false);
  for (const [column, target] of [
    ["runId", "analyses"],
    ["reportId", "reports"],
    ["claimId", "claims"],
    ["methodId", "methods"],
  ])
    relation("review_issues", column, target, "id", false);
  relation("analysis_citations", "analysisId", "analyses");
  relation("report_citations", "reportId", "reports");
  relation(
    "report_citations",
    "reportRevisionId",
    "report_revisions",
    "id",
    false,
  );
  for (const name of [
    "analysis_citations",
    "report_citations",
    "accepted_review_citations",
  ])
    for (const [column, target] of [
      ["sourceId", "sources"],
      ["versionId", "source_versions"],
      ["passageId", "passages"],
    ])
      relation(name, column, target, "id", false);
  relation("delivery_plans", "reportId", "reports");
  relation(
    "delivery_plans",
    "reportRevisionId",
    "report_revisions",
    "id",
    false,
  );
  relation("delivery_work_packages", "deliveryPlanId", "delivery_plans");
  const files: Record<string, string> = {};
  for (const t of tables)
    files[`${t.name}.csv`] =
      "\uFEFF" +
      [
        t.columns.map((c) => c.name),
        ...t.rows.map((row) =>
          t.columns.map((c) =>
            row[c.name] === null || row[c.name] === undefined
              ? ""
              : String(row[c.name]),
          ),
        ),
      ]
        .map((row) => row.map(csvCell).join(","))
        .join("\r\n") +
      "\r\n";
  files["data-dictionary.json"] = JSON.stringify(
    {
      format: "acadia-powerbi-v1",
      projectId: project.id,
      projectUpdatedAt: project.updatedAt,
      encoding: "UTF-8 with BOM",
      currentAssessmentsOnly: true,
      excluded: [
        "source originals",
        "source URLs",
        "passage and quotation text",
        "report bodies",
        "accepted review note bodies",
        "model prompts and responses",
        "model request payloads",
        "credentials",
        "rebuildable search indexes",
      ],
      tables: tables.map(({ rows, ...t }) => ({ ...t, rowCount: rows.length })),
      relationships,
      semantics: {
        confidence:
          "Researcher qualitative judgement, not a probability or proof.",
        quotationLocationStatus:
          "Local text/location match only; not evidence that a claim is supported.",
        origin:
          "Unknown or proposed relationships must not be treated as independence.",
        publishedAt:
          "Text preserves incomplete publication dates such as years.",
        blank:
          "Blank nullable values load as null. Blank researcher text is unassessed, not zero or false.",
        spreadsheetSafety:
          "Formula-like text is prefixed with an apostrophe. The prefix is intentionally preserved by the loader.",
        derivedSources:
          "Keep historical analytical copies for citation joins; filter includedEvidence=true for source-library evidence counts. File counts are never independent-origin counts.",
        gapResolution:
          "Gap states change only by researcher review. Work-package completion and attached verification evidence do not resolve a gap.",
        revisionScope:
          "Filter draft/revision scope; repeating work packages and citations across revisions must not be summed as new evidence.",
      },
    },
    null,
    2,
  );
  files["PowerQuery-AcadiaTable.m"] = powerQuery(tables);
  files["RELATIONSHIPS.md"] = relationshipGuide(relationships);
  files["README.md"] = POWER_BI_README;
  return files;
}

function powerQuery(tables: Table[]): string {
  const typeNames: Record<DataType, string> = {
    text: "type text",
    integer: "Int64.Type",
    boolean: "type logical",
    date: "type date",
    datetimezone: "type datetimezone",
  };
  const types = tables
    .map(
      (t) =>
        `        ${t.name} = {${t.columns.map((c) => `{${JSON.stringify(c.name)}, ${typeNames[c.type]}}`).join(", ")}}`,
    )
    .join(",\n");
  return `// Create a Text parameter named AcadiaFolder containing the exported folder path.\n// Create a blank query named AcadiaTable and paste this entire function into Advanced Editor.\n// Then create separate blank queries, e.g. = AcadiaTable("sources"). Do not combine unlike CSV schemas.\n(TableName as text) as table =>\nlet\n    Schemas = [\n${types}\n    ],\n    ColumnTypes = Record.Field(Schemas, TableName),\n    Separator = if Text.EndsWith(AcadiaFolder, "/") or Text.EndsWith(AcadiaFolder, "\\") then "" else "/",\n    Raw = Csv.Document(File.Contents(AcadiaFolder & Separator & TableName & ".csv"), [Delimiter=",", Encoding=65001, QuoteStyle=QuoteStyle.Csv]),\n    Headers = Table.PromoteHeaders(Raw, [PromoteAllScalars=true]),\n    Nulls = Table.ReplaceValue(Headers, "", null, Replacer.ReplaceValue, Table.ColumnNames(Headers)),\n    Typed = Table.TransformColumnTypes(Nulls, ColumnTypes, "en-US")\nin\n    Typed\n`;
}
function relationshipGuide(relationships: Relationship[]): string {
  return `# Acadia Power BI relationships\n\nImport each CSV as a separate table using PowerQuery-AcadiaTable.m. IDs are text. In Model view, create many-to-one relationships from each listed foreign-key column to the unique key. Use single-direction filtering from the one side to the many side. Begin with the suggested active relationships; alternate paths should stay inactive until you design a specific measure. No relationships are automatically created by these files.\n\n| Many-side table | Foreign key | One-side table | Unique key | Suggested active |\n| --- | --- | --- | --- | --- |\n${relationships.map((r) => `| ${r.fromTable} | ${r.fromColumn} | ${r.toTable} | ${r.toColumn} | ${r.suggestedActive ? "Yes" : "No; alternate path"} |`).join("\n")}\n\nBridge tables retain many-to-many evidence associations without pretending that rows are independent observations. Self-links (source duplicates, Why-chain parents, work-package dependencies) are role-playing relationships: leave them inactive or create an explicit dimension copy for the second role. Polymorphic review targetKind/targetId is a reference, not one relationship to every table. Snapshot IDs and source report IDs are provenance labels; snapshot contents and deleted source reports are not part of this handoff. A missing historical/legacy reference must remain visible as missing; do not fabricate a matching record.\n\nFilter delivery_plans.scope and report_citations.scope to draft or revision before counting. report_revisions.isReleased indicates the explicitly selected released revision. Current appraisals/findings/methods are not a historical assessment fact table. The export has no artificial research quality score.\n\n[Microsoft: create and manage relationships](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-create-and-manage-relationships).\n`;
}
export const POWER_BI_README = `# Acadia research data for Power BI

This local bundle describes research provenance, evidence links, researcher assessments, methods and delivery work packages. It is a data handoff, not statistical analysis or a Power BI report. Creating it makes no external connection. Researcher-written fields may contain sensitive information; choose where to store and share the folder.

1. Keep all files together. In Power BI Desktop choose Transform data, create a Text parameter named AcadiaFolder and set it to this folder's full path.
2. Create a blank query named AcadiaTable. In Advanced Editor paste PowerQuery-AcadiaTable.m.
3. Create one blank query per needed table. For example, enter = AcadiaTable("sources"), name the query sources, and repeat with source_versions, passages, claims, evidence_links and other table names in data-dictionary.json. The function applies explicit text, whole-number, date, timestamp and Boolean types. Do not combine all CSVs into one table; they have different schemas.
4. Close & Apply. Create relationships using RELATIONSHIPS.md and verify unique keys/cardinality. Automatic relationship detection is not enough for bridges and alternate paths.
5. Re-export to a new folder for a reproducible handoff, or deliberately replace the files in this folder and refresh. Acadia does not upload or schedule refresh. Refreshing replaces this snapshot; keep old bundles separately if needed.

CSV files are UTF-8 with a BOM and preserve commas, quotes and multiline notes. Spreadsheet formula-like text has a leading apostrophe. IDs remain text. Publication dates remain text to preserve partial dates; other declared dates/timestamps have explicit types. Blank nullable cells load as null.

Source originals, URLs, passage/quotation text, report bodies, model prompts/responses/request payloads, credentials and indexes are excluded. Passage IDs, source-version hashes and locators preserve traceability back to Acadia. Missing source references remain missing. No claim of independence is inferred from the absence of a confirmed relationship. Contradictory evidence and proposed/rejected origin links remain visible. Qualitative confidence, evidential support, citation-location validity and extraction coverage are separate fields; none is a probability of truth.

The quality_warnings table uses Acadia's deterministic completeness checks on current records. It is not a score. Findings/appraisals/methods contain only current revisions; report_revisions lists saved report revisions, and work packages/citations carry draft/revision scopes to prevent accidental double counting.

Microsoft references: [Csv.Document and UTF-8/quoted newlines](https://learn.microsoft.com/en-us/powerquery-m/csv-document); [Power BI relationships](https://learn.microsoft.com/en-us/power-bi/transform-model/desktop-create-and-manage-relationships); [Folder connector](https://learn.microsoft.com/en-us/power-query/connectors/folder).
`;
