import type {
  Citation,
  Passage,
  ReportDocument,
  ResearchState,
} from "./research";
import type { PedigreeSnapshot, PedigreeState, SourceOrigin } from "./pedigree";
import type { ResearchOutput } from "./types";
import {
  mergeCitations,
  reportCitations,
  reportDocument,
  reportToMarkdown,
} from "./report";

export interface AnalyticalCheck {
  id: string;
  message: string;
  severity: "warning" | "error";
}
export function originSummary(
  sources: ResearchState["sources"],
  origins: SourceOrigin[],
) {
  const included = sources.filter((s) => s.inclusion !== "exclude");
  const ids = new Set(included.map((s) => s.id)),
    parent = new Map(included.map((s) => [s.id, s.id]));
  const root = (id: string): string => {
    const p = parent.get(id)!;
    return p === id ? id : root(p);
  };
  const known = new Set<string>();
  for (const edge of origins.filter(
    (o) =>
      o.status === "confirmed" &&
      ids.has(o.sourceId) &&
      ids.has(o.relatedSourceId),
  )) {
    parent.set(root(edge.sourceId), root(edge.relatedSourceId));
    known.add(edge.sourceId);
    known.add(edge.relatedSourceId);
  }
  for (const source of included)
    if (source.duplicateOf && ids.has(source.duplicateOf))
      parent.set(root(source.id), root(source.duplicateOf));
  return {
    sourceCount: included.length,
    fileCount: included.filter((s) => s.kind === "document").length,
    sharedOriginGroups: new Set([...known].map(root)).size,
    unknownIndependence: included.filter(
      (s) => !known.has(s.id) && !s.duplicateOf,
    ).length,
    duplicateFiles: included.filter((s) => s.duplicateOf).length,
  };
}

export function pedigreeChanged(
  snapshot: PedigreeSnapshot,
  live: PedigreeState,
  research: ResearchState,
): string[] {
  const changed: string[] = [];
  for (const key of [
    "briefs",
    "appraisals",
    "origins",
    "findings",
    "assumptions",
    "methods",
    "issues",
  ] as const) {
    if (
      snapshot.state[key].length !== live[key].length ||
      snapshot.state[key].some(
        (saved) =>
          !live[key].some(
            (now) => now.id === saved.id && now.revision === saved.revision,
          ),
      )
    )
      changed.push(key);
  }
  if (
    snapshot.sources.length !== research.sources.length ||
    snapshot.sources.some((s) => {
      const now = research.sources.find((entry) => entry.id === s.id);
      return (
        !now ||
        now.currentVersionId !== s.currentVersionId ||
        now.inclusion !== s.inclusion ||
        now.updatedAt !== s.updatedAt
      );
    }) ||
    snapshot.sourceVersions.some((v) => {
      const now = research.versions.find((entry) => entry.id === v.id);
      return (
        !now ||
        now.status !== v.status ||
        now.processedUnits !== v.processedUnits ||
        now.totalUnits !== v.totalUnits
      );
    })
  )
    changed.push("source versions and selection");
  if (
    snapshot.claims.some(
      (c) =>
        JSON.stringify(research.claims.find((now) => now.id === c.id)) !==
        JSON.stringify(c),
    ) ||
    snapshot.claims.length !== research.claims.length
  )
    changed.push("evidence links");
  return changed;
}

export function analyticalChecks(
  state: PedigreeState,
  research: ResearchState,
  passages?: Passage[],
): AnalyticalCheck[] {
  const checks: AnalyticalCheck[] = [];
  const warn = (id: string, message: string) =>
    checks.push({ id, message, severity: "warning" });
  const brief = state.briefs[0];
  if (
    !brief ||
    [
      brief.question,
      brief.decision,
      brief.scope,
      brief.inclusionCriteria,
      brief.successCriteria,
    ].some((v) => !v.trim())
  )
    warn(
      "brief",
      "Research brief has unassessed question, decision, scope, inclusion or success criteria.",
    );
  if (brief?.reviewStatus !== "reviewed")
    warn("brief-review", "Research brief has not been marked reviewed.");
  for (const source of research.sources.filter(
    (s) => s.inclusion !== "exclude",
  )) {
    const version = research.versions.find(
      (v) => v.id === source.currentVersionId,
    );
    if (
      !version ||
      version.status !== "ready" ||
      version.processedUnits < version.totalUnits
    )
      warn(
        `extraction-${source.id}`,
        `${source.title}: extraction is ${version?.status || "missing"}; coverage ${version?.processedUnits || 0}/${version?.totalUnits || 0}.`,
      );
    const appraisal = state.appraisals.find(
      (a) =>
        a.sourceId === source.id && a.versionId === source.currentVersionId,
    );
    if (!appraisal || appraisal.reviewStatus !== "reviewed")
      warn(
        `appraisal-${source.id}`,
        `${source.title}: current source version has no reviewed appraisal.`,
      );
    if (
      state.appraisals.some(
        (a) =>
          a.sourceId === source.id && a.versionId !== source.currentVersionId,
      ) &&
      !appraisal
    )
      warn(
        `stale-appraisal-${source.id}`,
        `${source.title}: the prior appraisal concerns an older source version.`,
      );
  }
  const origins = originSummary(research.sources, state.origins);
  if (origins.unknownIndependence)
    warn(
      "independence",
      `${origins.unknownIndependence} source(s) have unassessed independence; do not treat file counts as independent corroboration.`,
    );
  for (const claim of research.claims) {
    const finding = state.findings.find((f) => f.claimId === claim.id);
    if (
      !finding ||
      finding.reviewStatus !== "reviewed" ||
      finding.supportReview === "unassessed"
    )
      warn(
        `finding-${claim.id}`,
        `${claim.title}: evidential support remains unreviewed.`,
      );
    if (
      finding &&
      finding.confidence !== "unassessed" &&
      !finding.confidenceBasis.trim()
    )
      warn(
        `confidence-${claim.id}`,
        `${claim.title}: confidence has no written basis.`,
      );
    if (!claim.links.length)
      warn(
        `links-${claim.id}`,
        `${claim.title}: no supporting or conflicting passages have been linked.`,
      );
    if (passages)
      for (const link of claim.links)
        if (!passages.some((p) => p.id === link.passageId))
          warn(
            `missing-${link.id}`,
            `${claim.title}: an evidence passage is missing.`,
          );
  }
  for (const method of state.methods)
    if (method.reviewStatus !== "reviewed")
      warn(
        `method-${method.id}`,
        `${method.title}: method worksheet has unresolved review.`,
      );
  for (const assumption of state.assumptions)
    if (assumption.status !== "supported")
      warn(
        `assumption-${assumption.id}`,
        `Assumption requires investigation: ${assumption.statement || "Untitled assumption"}.`,
      );
  for (const issue of state.issues.filter(
    (i) => i.status === "open" || i.status === "acknowledged",
  ))
    warn(
      `issue-${issue.id}`,
      `${issue.summary}: ${issue.status === "acknowledged" ? "acknowledged limitation" : "unresolved review issue"}.`,
    );
  return checks;
}

/** Location integrity alone does not establish relevance or evidential support. */
export function citationIntegrity(
  output: ResearchOutput,
  lookup: (id: string) => Passage | undefined,
): string[] {
  const citations = reportCitations(output),
    errors: string[] = [],
    seen = new Set<string>();
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
  for (const citation of citations) {
    if (seen.has(citation.id))
      errors.push(`Duplicate citation identifier ${citation.id}.`);
    seen.add(citation.id);
    if (citation.legacyCardId && !citation.passageId) continue;
    const passage = lookup(citation.passageId);
    if (
      !passage ||
      passage.sourceId !== citation.sourceId ||
      passage.versionId !== citation.versionId ||
      passage.locator !== citation.locator ||
      !normalize(passage.text).includes(normalize(citation.quote))
    )
      errors.push(
        `Citation [${citations.indexOf(citation) + 1}] does not match its saved source passage.`,
      );
  }
  const visit = (node: ReportDocument) => {
    if (
      node.type === "citation" &&
      !citations.some((c) => c.id === node.attrs?.citationId)
    )
      errors.push("A citation node refers to a missing bibliography entry.");
    node.content?.forEach(visit);
  };
  visit(reportDocument(output));
  const textNodes = (node: ReportDocument): string =>
    node.type === "codeBlock" ||
    node.marks?.some((mark) => mark.type === "code")
      ? ""
      : node.type === "text"
        ? node.text || ""
        : (node.content || []).map(textNodes).join(" ");
  for (const match of textNodes(reportDocument(output)).matchAll(
    /\[(S?\d+)\]/g,
  )) {
    const n = Number(match[1].replace(/^S/, ""));
    if (n < 1 || n > citations.length)
      errors.push(`Reference [${match[1]}] has no saved citation.`);
  }
  return [...new Set(errors)];
}

const plain = (value: string) =>
  value.replace(/[\r\n]+/g, " ").replace(/[|\\`*_[\]<>]/g, (c) => `\\${c}`);
const value = (v: string) => plain(v || "Unassessed");
/** Build an editable appendix; adding it never replaces any existing writing. */
export function pedigreeAppendix(
  snapshot: PedigreeSnapshot,
  existing: Citation[],
) {
  const { state } = snapshot;
  const needed = new Set<string>([
    ...snapshot.claims.flatMap((c) => c.links.map((l) => l.passageId)),
    ...state.appraisals.flatMap((a) => a.passageIds),
    ...state.assumptions.flatMap((a) => a.passageIds),
    ...state.methods.flatMap((m) => m.rows.flatMap((r) => r.passageIds)),
    ...state.methods.flatMap((m) =>
      m.kind === "hypotheses"
        ? m.rows.flatMap((r) => r.evaluations.map((e) => e.passageId))
        : [],
    ),
  ]);
  const additions = snapshot.passages
    .filter((p) => needed.has(p.id))
    .map((p): Citation => {
      const version = snapshot.sourceVersions.find(
        (v) => v.id === p.versionId,
      )!;
      return {
        id: `passage-${p.id}`,
        label: "",
        sourceId: p.sourceId,
        versionId: p.versionId,
        passageId: p.id,
        sourceTitle: version?.title || "Historical source",
        locator: p.locator,
        quote: p.text,
        acquiredAt: version?.acquiredAt || snapshot.createdAt,
        verified: p.method !== "legacy",
        ...(version?.url ? { url: version.url } : {}),
      };
    });
  // Reuse existing references by exact passage, regardless of their generated citation IDs.
  const citations = mergeCitations(
    existing,
    additions.filter(
      (c) =>
        !existing.some(
          (e) => e.passageId === c.passageId && e.versionId === c.versionId,
        ),
    ),
  );
  const refs = (ids: string[]) =>
    ids
      .map((id) => {
        const i = citations.findIndex((c) => c.passageId === id);
        return i < 0 ? "Missing passage" : `[${i + 1}]`;
      })
      .join(" ") || "No passage linked";
  const brief = state.briefs[0],
    origins = originSummary(snapshot.sources, state.origins);
  const checks = analyticalChecks(
    state,
    {
      sources: snapshot.sources,
      versions: snapshot.sourceVersions,
      claims: snapshot.claims,
      tasks: snapshot.tasks,
      jobs: [],
      discoveries: [],
      runs: [],
    },
    snapshot.passages,
  );
  let markdown = `## Research approach and analytical pedigree\n\nSnapshot: ${snapshot.id}. Recorded ${snapshot.createdAt}. Methods are researcher-editable aids; this record does not imply standards certification or independently validated conclusions.\n\n### Research brief\n\n| Field | Recorded basis |\n| --- | --- |\n${[
    ["Question", brief?.question],
    ["Decision", brief?.decision],
    ["Scope", brief?.scope],
    ["Dates", [brief?.dateFrom, brief?.dateTo].filter(Boolean).join(" to ")],
    ["Inclusion criteria", brief?.inclusionCriteria],
    ["Exclusion criteria", brief?.exclusionCriteria],
    ["Success criteria", brief?.successCriteria],
    ["Review status", brief?.reviewStatus],
  ]
    .map(([field, content]) => `| ${field} | ${value(content || "")} |`)
    .join(
      "\n",
    )}\n\n### Evidence basis\n\n${origins.sourceCount} included source records (${origins.fileCount} documents); ${origins.sharedOriginGroups} confirmed shared-origin groups; ${origins.duplicateFiles} duplicate files; ${origins.unknownIndependence} with unassessed independence. Groups are not proof of independence from one another.\n\n| Source appraisal | Review | Methods, applicability and limitations | References |\n| --- | --- | --- | --- |\n${state.appraisals.map((a) => `| ${value(snapshot.sourceVersions.find((v) => v.id === a.versionId)?.title || a.sourceId)}; revision ${a.revision} | ${a.reviewStatus}; ${a.origin} | ${value([a.methods, a.applicability, a.limitations, a.bias, a.rationale].filter(Boolean).join("; "))} | ${refs(a.passageIds)} |`).join("\n") || "| Unassessed | Unassessed | No appraisals recorded | No passage linked |"}\n\n### Findings and reasoning\n`;
  for (const claim of snapshot.claims) {
    const finding = state.findings.find((f) => f.claimId === claim.id);
    markdown += `\n#### ${value(claim.title)}\n\nClassification: ${finding?.classification || "unassessed"}. Support review: ${finding?.supportReview || "unassessed"}. Researcher confidence: ${finding?.confidence || "unassessed"}; ${value(finding?.confidenceBasis || "")}.\n\nReasoning: ${value(finding?.reasoning || "")}\n\nSupporting passages: ${refs(claim.links.filter((l) => l.relation === "supports").map((l) => l.passageId))}. Conflicting passages: ${refs(claim.links.filter((l) => l.relation === "contradicts").map((l) => l.passageId))}.\n\nAlternatives: ${value(claim.alternatives)}. Limitations: ${value(claim.limitations)}.\n\nWhat would change this assessment: ${value(finding?.wouldChange || "")}\n`;
  }
  markdown += `\n### Assumptions\n\n| Assumption | Consequence | Validation / review |\n| --- | --- | --- |\n${state.assumptions.map((a) => `| ${value(a.statement)} ${refs(a.passageIds)} | ${value(a.consequence)} | ${value(a.validation)}; ${a.status} |`).join("\n") || "| No assumptions recorded | Unassessed | Not evidence that no assumptions exist |"}\n`;
  for (const method of state.methods) {
    markdown += `\n### Method: ${value(method.title)}\n\n${value(method.objective)}. Revision ${method.revision}; ${method.reviewStatus}.\n\n| Observation / proposition | Assessment and reasoning | Next test | References |\n| --- | --- | --- | --- |\n`;
    for (const row of method.rows) {
      const details: string[] = [];
      const add = (
        label: string,
        content: string | number | null | undefined,
      ) =>
        details.push(
          `${label}: ${value(content == null ? "Unassessed" : String(content))}`,
        );
      if ("predictions" in row) {
        add("Predicted observation", row.predictions);
        add("Discriminating test", row.discriminatingTest);
        for (const evaluation of row.evaluations)
          details.push(
            `Evidence ${refs([evaluation.passageId])}: ${evaluation.assessment} — ${value(evaluation.rationale)}`,
          );
      } else if ("category" in row) {
        add("Quadrant", row.category);
        add("Basis", row.observationKind);
        add("Implications", row.implications);
        add("Actions", row.actions);
      } else if ("causalStatus" in row) {
        if (row.parentId)
          add(
            "Parent cause",
            method.rows.find((r) => r.id === row.parentId)?.text ||
              "Missing cause",
          );
        add("Cause assessment", row.causalStatus);
        add("Reasoning", row.rationale);
        add("Investigation or test evidence", row.testEvidence);
      } else if ("likelihood" in row) {
        add("Causes", row.causes);
        add("Consequences", row.consequences);
        add("Existing controls", row.controls);
        add(
          "Likelihood",
          `${row.likelihood} — ${row.likelihoodBasis || "Basis unassessed"}`,
        );
        add(
          "Impact",
          `${row.impact} — ${row.impactBasis || "Basis unassessed"}`,
        );
        add("Mitigation", row.mitigation);
        add("Owner", row.owner || "Unassigned");
        add("Residual risk", row.residualRisk);
      } else if ("assessedLevel" in row) {
        add("Technology element", row.element);
        add("Test environment", row.environment);
        add("Readiness level", row.assessedLevel);
        add("Maturity criteria", row.criteria);
        add("Demonstrated capability", row.demonstrated);
        add("Remaining evidence", row.requiredEvidence);
      }
      if (row.claimIds.length)
        add(
          "Related findings",
          row.claimIds
            .map(
              (id) =>
                snapshot.claims.find((c) => c.id === id)?.title ||
                "Missing finding",
            )
            .join("; "),
        );
      if (row.assumptionIds.length)
        add(
          "Assumptions",
          row.assumptionIds
            .map(
              (id) =>
                state.assumptions.find((a) => a.id === id)?.statement ||
                "Missing assumption",
            )
            .join("; "),
        );
      if (row.taskIds.length)
        add(
          "Follow-up work",
          row.taskIds
            .map((id) => {
              const task = snapshot.tasks.find((t) => t.id === id);
              return task ? `${task.title} (${task.status})` : "Missing task";
            })
            .join("; "),
        );
      markdown += `| ${value(row.text)} | ${details.join("; ") || "Unassessed"} | ${value(row.nextTest)} | ${refs(row.passageIds)} |\n`;
    }
    markdown += `\nLimitations: ${value(method.limitations)}. Next steps: ${value(method.nextSteps)}.\n`;
  }
  markdown += `\n### Unresolved issues and limitations\n\n${checks.length ? checks.map((c) => `- ${value(c.message)}`).join("\n") : "No local completeness warnings found. This is not an assessment that conclusions are true."}\n\nCitation-location validity, evidential support and researcher confidence are separate assessments. Reproducible input records do not guarantee identical model output.\n`;
  return { markdown, citations };
}
