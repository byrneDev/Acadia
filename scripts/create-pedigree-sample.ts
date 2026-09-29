/** Rebuild with: npx esbuild scripts/create-pedigree-sample.ts --bundle --platform=node --format=cjs --packages=external --outfile=tmp/create-pedigree-sample.cjs
 * Then: node tmp/create-pedigree-sample.cjs. No model or network service is called.
 */
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createBlankProject, validateProject } from "../src/shared/project";
import {
  ResearchStore,
  contentHash,
  validateResearchArchive,
} from "../src/main/research-store";
import {
  createAppraisal,
  createAssumption,
  createFinding,
  createMethodRow,
  createMethodWorksheet,
  createOrigin,
  createReviewIssue,
  type MethodKind,
  type MethodWorksheet,
} from "../src/shared/pedigree";
import { markdownToReport, snapshotRevision } from "../src/shared/report";
import type { Citation, ResearchClaim } from "../src/shared/research";
import type { ResearchOutput } from "../src/shared/types";
const directory = mkdtempSync(join(tmpdir(), "acadia-pedigree-sample-"));
const store = new ResearchStore(directory);
const stamp = "2026-09-29T12:00:00.000Z";
try {
  const project = {
    ...createBlankProject(),
    id: "acadia-pedigree-sample",
    title: "Fictional investigation: Cedar field performance",
    question:
      "Does the Cedar filter cause a meaningful reduction in field turbidity, and what evidence would justify deployment?",
    createdAt: stamp,
    updatedAt: stamp,
    privacy: { mode: "local" as const, provider: "offline" as const },
  };
  store.saveProject(project);
  store.saveBrief({
    ...store.pedigreeState(project.id).briefs[0],
    decision:
      "Decide whether to authorize a controlled field pilot, not general deployment.",
    scope:
      "Fictional illustrative research only. Compare measured turbidity under representative field conditions; do not extrapolate to health outcomes.",
    dateFrom: "2026-01-01",
    dateTo: "2026-09-29",
    inclusionCriteria:
      "Dated observations reporting measurement method, comparison conditions and limitations; distinguish primary observations from repeated reporting.",
    exclusionCriteria:
      "Marketing repetition without original data is not independent corroboration. No claims about real products, communities or health effects.",
    successCriteria:
      "A pre-specified, adequately controlled field evaluation can distinguish device effect from seasonal variation, documents uncertainty, and measures maintenance burden.",
    reviewStatus: "reviewed",
  });
  const sources = [
    {
      id: "cedar-primary",
      title: "Fictional vendor before-after study",
      text: "FICTIONAL TRAINING EVIDENCE. Cedar filter laboratory and site readings fell from a median 18 to 12 turbidity units after installation at 12 selected sites. The vendor selected convenient sites, used no concurrent control and did not measure seasonal water changes. This association does not isolate a causal filter effect.",
      origin: "primary" as const,
      methods:
        "Convenience sample; before-after observations; no concurrent control.",
      limitations:
        "Selection bias, vendor interest and uncontrolled seasonality prevent causal attribution.",
      inclusion: "include" as const,
    },
    {
      id: "cedar-syndication",
      title: "Fictional syndicated Cedar news article",
      text: "FICTIONAL TRAINING EVIDENCE. Cedar reduces turbidity, reports a trade newsletter quoting the fictional vendor's 12-site before-after study. The newsletter collected no new measurements and repeats the same median 18-to-12 result. This is a secondary report of the same study, not an independent replication.",
      origin: "secondary" as const,
      methods: "Secondary summary of the fictional vendor study.",
      limitations:
        "Shared reporting origin; no independent observations or review of raw measurements.",
      inclusion: "include" as const,
    },
    {
      id: "cedar-counter",
      title: "Fictional independent field comparison",
      text: "FICTIONAL TRAINING EVIDENCE. A six-week Cedar field comparison at eight other sites found no meaningful turbidity improvement relative to concurrent untreated observations. The result contradicts a claim of established field benefit, but the short duration and small sample leave uncertainty about season-specific performance and maintenance effects.",
      origin: "primary" as const,
      methods: "Small concurrent field comparison lasting six weeks.",
      limitations:
        "Short follow-up and small sample; does not establish absence of every possible benefit.",
      inclusion: "pin" as const,
    },
    {
      id: "cedar-gap",
      title: "Fictional evidence coverage memorandum",
      text: "FICTIONAL TRAINING EVIDENCE. Seasonal baseline changes, calibration logs, operator consistency, long-term maintenance costs and performance after fouling are unknown or unmeasured in the supplied collection. No observation shows that training alone would fix the performance uncertainty. A controlled protocol and measurement-quality checks are needed before choosing an intervention.",
      origin: "primary" as const,
      methods: "Audit of this fictional collection's documented coverage.",
      limitations:
        "An absence in this collection is not proof that no evidence exists elsewhere.",
      inclusion: "include" as const,
    },
    {
      id: "cedar-irrelevant",
      title: "Fictional container inventory",
      text: "FICTIONAL TRAINING EVIDENCE. The Cedar sample containers were blue. Container color is accurately recorded but is not a measure of turbidity reduction, filter efficacy or operator competence.",
      origin: "primary" as const,
      methods: "Inventory observation only.",
      limitations:
        "Valid quotation location; irrelevant to a causal performance claim.",
      inclusion: "include" as const,
    },
  ];
  for (const [index, entry] of sources.entries()) {
    store.saveSource({
      id: entry.id,
      projectId: project.id,
      cardId: `card-${entry.id}`,
      title: entry.title,
      kind: "note",
      currentVersionId: `${entry.id}-v1`,
      inclusion: entry.inclusion,
      createdAt: stamp,
      updatedAt: stamp,
    });
    store.addVersion(
      {
        id: `${entry.id}-v1`,
        sourceId: entry.id,
        title: entry.title,
        hash: contentHash(entry.text),
        acquiredAt: stamp,
        author: "Acadia fictional evaluation fixture",
        publisher: "Fictional training scenario",
        publishedAt: "2026-09-29",
        status: "ready",
        method: "manual",
        totalUnits: 1,
        processedUnits: 1,
      },
      [
        {
          id: `${entry.id}-p1`,
          sourceId: entry.id,
          versionId: `${entry.id}-v1`,
          text: entry.text,
          locator: "Paragraph 1",
          paragraph: 1,
          method: "manual",
          inclusion: "include",
        },
      ],
    );
    store.saveAppraisal({
      ...createAppraisal(project.id, entry.id, `${entry.id}-v1`),
      id: `appraisal-${entry.id}`,
      evidenceType: "Fictional illustrative record",
      origin: entry.origin,
      methods: entry.methods,
      applicability:
        entry.id === "cedar-irrelevant"
          ? "Does not address filter performance."
          : "Applies only to the described fictional settings; transfer remains uncertain.",
      currency:
        "Dated fictional fixture, not a current real-world observation.",
      limitations: entry.limitations,
      bias:
        entry.id === "cedar-primary"
          ? "Vendor-selected sites and commercial framing."
          : "Small, deliberately simplified educational record.",
      rationale:
        "Reviewed as an example of how to record evidence limitations, not as validated scientific research.",
      passageIds: [`${entry.id}-p1`],
      reviewStatus: "reviewed",
    });
    project.cards.push({
      id: `card-${entry.id}`,
      kind: "note",
      title: entry.title,
      content: entry.text,
      x: (index % 3) * 390,
      y: Math.floor(index / 3) * 290,
      tags: [
        "fictional",
        entry.id === "cedar-counter" ? "counterevidence" : "research pedigree",
      ],
      status: entry.id === "cedar-counter" ? "disputed" : "unreviewed",
      sourceId: entry.id,
      createdAt: stamp,
      updatedAt: stamp,
    });
  }
  store.saveOrigin({
    ...createOrigin(project.id, "cedar-primary", "cedar-syndication"),
    id: "origin-same-study",
    kind: "same-study",
    status: "confirmed",
    rationale:
      "The article explicitly repeats the vendor's same 12-site observations and collected no measurements.",
  });
  const claim: ResearchClaim = {
    id: "cedar-causal-claim",
    projectId: project.id,
    title: "Cedar causes a meaningful field turbidity reduction",
    question: project.question,
    status: "disputed",
    alternatives:
      "Seasonal source-water changes, site selection and measurement differences may explain the observed reduction.",
    limitations:
      "The uncontrolled positive study conflicts with the small field comparison. No population-level or health-effect claim is supported.",
    updatedAt: stamp,
    links: [
      {
        id: "cedar-support",
        passageId: "cedar-primary-p1",
        relation: "supports",
        quote: sources[0].text,
        rationale:
          "Positive before-after association supports further investigation but not causal attribution.",
      },
      {
        id: "cedar-conflict",
        passageId: "cedar-counter-p1",
        relation: "contradicts",
        quote: sources[2].text,
        rationale:
          "Concurrent field comparison found no meaningful improvement within its tested conditions.",
      },
      {
        id: "cedar-context",
        passageId: "cedar-gap-p1",
        relation: "context",
        quote: sources[3].text,
        rationale:
          "Missing baselines and maintenance observations prevent closing key alternatives.",
      },
    ],
  };
  store.saveClaim(claim);
  const assumption = store.saveAssumption({
    ...createAssumption(project.id),
    id: "cedar-seasonal-assumption",
    statement:
      "Seasonal change would have been similar across treated and untreated sites.",
    basis: "Not established by the positive before-after study.",
    consequence:
      "If false, the apparent improvement may not be attributable to Cedar.",
    validation:
      "Measure concurrent untreated observations and pre-specify seasonal strata.",
    passageIds: ["cedar-primary-p1", "cedar-gap-p1"],
    claimIds: [claim.id],
    status: "challenged",
  });
  store.saveFinding({
    ...createFinding(project.id, claim.id),
    id: "cedar-causal-assessment",
    classification: "hypothesis",
    reasoning:
      "The positive association is plausible but confounded; the contradictory comparison and missing baseline prevent a defensible causal conclusion.",
    assumptionIds: [assumption.id],
    confidence: "low",
    confidenceBasis:
      "Written researcher judgment based on uncontrolled positive observations, a small contrary comparison, and unresolved applicability. This is not a probability or proof.",
    wouldChange:
      "Replicated controlled field observations with verified calibration and durable improvement beyond maintenance and seasonal effects.",
    supportReview: "partial",
    reviewStatus: "reviewed",
  });
  const methodIds: string[] = [];
  for (const [index, kind] of (
    ["hypotheses", "swot", "root-cause", "risk", "trl"] as MethodKind[]
  ).entries()) {
    const method = {
      ...createMethodWorksheet(project.id, kind),
      id: `cedar-method-${kind}`,
      objective:
        "Record an explicitly provisional analysis of the fictional Cedar deployment decision.",
      limitations:
        "Fictional, simplified worksheet. Evidence and methods are not independently validated; no certification or qualification is implied.",
      nextSteps:
        "Compare alternatives and conduct the linked controlled field evaluation before committing to deployment.",
      reviewStatus: "draft" as const,
    };
    const common = {
      id: `cedar-row-${kind}`,
      text: "Cedar performance remains conditional on unresolved evidence",
      passageIds: ["cedar-primary-p1", "cedar-counter-p1", "cedar-gap-p1"],
      claimIds: [claim.id],
      assumptionIds: [assumption.id],
      taskIds: [],
      nextTest:
        "Controlled, calibrated concurrent comparison with seasonal coverage.",
    };
    let rows: unknown[];
    if (kind === "hypotheses")
      rows = [
        {
          ...createMethodRow(kind),
          ...common,
          text: "Cedar has a material treatment effect under representative field conditions",
          predictions:
            "Treated sites improve more than concurrent controls after accounting for season and calibration.",
          discriminatingTest:
            "Pre-specified concurrent controlled field comparison.",
          evaluations: [
            {
              passageId: "cedar-primary-p1",
              assessment: "supports",
              rationale: "Positive association, with confounding limits.",
            },
            {
              passageId: "cedar-counter-p1",
              assessment: "contradicts",
              rationale: "No meaningful improvement in the comparison.",
            },
          ],
        },
        {
          ...createMethodRow(kind),
          ...common,
          id: "cedar-row-seasonality",
          text: "Seasonal change or measurement bias explains the vendor observation",
          predictions:
            "Untreated sites show similar improvement or calibration correction removes the difference.",
          discriminatingTest:
            "Untreated concurrent controls plus blind calibration checks.",
          evaluations: [
            {
              passageId: "cedar-gap-p1",
              assessment: "unassessed",
              rationale: "Baseline and calibration evidence is missing.",
            },
          ],
        },
      ];
    else if (kind === "swot")
      rows = [
        {
          ...createMethodRow(kind),
          ...common,
          category: "weakness",
          observationKind: "observation",
          text: "The evidence base lacks a controlled long-term positive field result",
          implications: "Deployment claims would exceed the current evidence.",
          actions: "Prioritize a controlled pilot and transparent reporting.",
        },
      ];
    else if (kind === "root-cause")
      rows = [
        {
          ...createMethodRow(kind),
          ...common,
          text: "Seasonality may explain part of the observed reduction",
          causalStatus: "possible",
          testEvidence:
            "No discriminating test is recorded; the memorandum identifies missing seasonal baselines.",
          rationale:
            "A temporal association alone does not distinguish competing causes.",
        },
      ];
    else if (kind === "risk")
      rows = [
        {
          ...createMethodRow(kind),
          ...common,
          text: "Deployment without a durable benefit",
          causes:
            "Confounded measurements and untested maintenance assumptions.",
          consequences: "Wasted effort and continued unmet performance need.",
          controls: "Staged evaluation with an explicit stop gate.",
          likelihood: "unassessed",
          impact: "moderate",
          likelihoodBasis: "The collection cannot quantify likelihood.",
          impactBasis:
            "Fictional scenario judgment: deployment diverts limited pilot resources.",
          mitigation: "Conduct a controlled pilot before broad deployment.",
          owner: "Unassigned",
          residualRisk:
            "Longer-term performance remains uncertain after a short pilot.",
        },
      ];
    else
      rows = [
        {
          ...createMethodRow(kind),
          ...common,
          text: "Cedar filter element",
          element: "Fictional treatment element and operating procedure",
          environment: "Representative field water with seasonal variation",
          assessedLevel: null,
          criteria:
            "Demonstrate repeatable, calibrated performance and maintainability in the intended environment.",
          demonstrated:
            "An uncontrolled positive before-after result and a small contrary comparison only.",
          requiredEvidence:
            "Controlled representative-environment tests, maintenance evidence, and a reviewed assessment basis. No readiness level or certification is assigned.",
        },
      ];
    store.saveMethod({ ...method, rows } as MethodWorksheet);
    methodIds.push(method.id);
  }
  store.saveTask({
    id: "cedar-controlled-pilot-task",
    projectId: project.id,
    title: "Design a calibrated, controlled field pilot",
    question: project.question,
    claimId: claim.id,
    assumptionId: assumption.id,
    methodId: methodIds[0],
    status: "planned",
    criterion:
      "Approve pre-specified comparison conditions, seasonal coverage, calibration checks, maintenance observations, outcome criteria and a stop/go review. Record pilot results as new sources and link resulting evidence.",
    sourceIds: ["cedar-gap"],
    updatedAt: stamp,
  });
  store.saveTask({
    id: "cedar-operator-gap-task",
    projectId: project.id,
    title: "Determine whether an operator curriculum is justified",
    question:
      "Is the measurement gap caused by an observable operator performance need?",
    claimId: claim.id,
    status: "planned",
    criterion:
      "Observe current operator tasks and calibration performance, distinguish knowledge/skill needs from equipment/process constraints, and compare training with other interventions before proposing curriculum.",
    sourceIds: ["cedar-gap"],
    updatedAt: stamp,
  });
  store.saveReviewIssue({
    ...createReviewIssue(project.id, { kind: "claim", id: claim.id }),
    id: "cedar-causal-review",
    category: "causal-inference",
    summary: "Causal attribution remains unresolved",
    detail:
      "The vendor observation and repeated article are not independent controlled demonstrations. The field comparison conflicts with a claim of established benefit.",
    status: "acknowledged",
    rationale:
      "Retain this limitation while designing a discriminating field evaluation.",
    passageIds: ["cedar-primary-p1", "cedar-counter-p1"],
    claimIds: [claim.id],
    assumptionIds: [assumption.id],
    taskIds: ["cedar-controlled-pilot-task"],
    origin: "researcher",
  });
  project.connections = [
    {
      id: "cedar-reporting-edge",
      source: "card-cedar-syndication",
      target: "card-cedar-primary",
      relation: "derived from",
      label: "Same observations; not independent support",
    },
    {
      id: "cedar-conflict-edge",
      source: "card-cedar-counter",
      target: "card-cedar-primary",
      relation: "contradicts",
      label: "Different result; compare methods and conditions",
    },
    {
      id: "cedar-gap-edge",
      source: "card-cedar-gap",
      target: "card-cedar-counter",
      relation: "investigate",
      label: "Close the discriminating-evidence gap",
    },
  ];
  store.saveProject(project);
  const snapshot = store.createPedigreeSnapshot(project.id);
  const citations: Citation[] = [
    "cedar-primary",
    "cedar-counter",
    "cedar-gap",
    "cedar-syndication",
  ].map((id, index) => ({
    id: `cite-${id}`,
    label: String(index + 1),
    sourceId: id,
    versionId: `${id}-v1`,
    passageId: `${id}-p1`,
    sourceTitle: sources.find((s) => s.id === id)!.title,
    locator: "Paragraph 1",
    quote: store.getPassage(`${id}-p1`).text,
    acquiredAt: stamp,
    verified: true,
  }));
  const markdown =
    "# Fictional Cedar decision brief\n\nThis is a deliberately simplified fictional training investigation, not real scientific evidence or product guidance. All sources and findings were authored as a fixed example; no AI model was called.\n\n## Decision and evidence\n\nAuthorize design of a controlled field pilot, subject to researcher review. The positive before-after association does not establish causality [1]. A small concurrent comparison found no meaningful benefit [2]. Seasonal baselines, calibration and maintenance observations remain missing [3]. The newsletter repeats the primary study and is not independent corroboration [4].\n\n## Competing explanations and limits\n\nA device effect, seasonal changes, site selection and measurement bias remain competing explanations. Valid source locations do not prove that evidence supports the causal claim. The blue-container inventory is deliberately irrelevant to efficacy despite being accurately citable.\n\n## Proposed next step\n\nUse the competing-hypotheses, SWOT, root-cause, risk and readiness worksheets to define discriminating tests. Complete the linked pilot-design and operator-needs tasks before proposing deployment or an instructional solution. Owners, dates, budgets and readiness level remain unassigned.\n\n## How to inspect this sample\n\nOpen the Research brief, Sources and Evidence views; inspect the confirmed source-origin link and the pinned counterevidence. Open Methods to inspect all five manually authored worksheets. In the report inspector, review this saved analytical pedigree. Preview an appendix or plan a deliverable only after reviewing the gap. Release review should still show unresolved limitations.";
  const output: ResearchOutput = {
    id: "cedar-sample-report",
    kind: "decision-brief",
    title: "Fictional Cedar decision brief",
    markdown,
    document: markdownToReport(markdown, citations),
    citations,
    sourceIds: citations.map((c) => c.sourceId),
    createdAt: stamp,
    boardUpdatedAt: stamp,
    provider: "Offline · manually authored fictional example",
    pedigreeSnapshotId: snapshot.id,
  };
  output.revisions = [
    snapshotRevision(
      output,
      "Fictional worked example — review limitations",
      "cedar-sample-revision",
    ),
  ];
  project.outputs = [output];
  store.saveProject(project);
  const records = store.exportResearch(project.id),
    saved = store.getProject(project.id)!;
  validateProject(saved);
  validateResearchArchive(records, saved.id);
  const archive = new AdmZip();
  archive.addFile("project.json", Buffer.from(JSON.stringify(saved, null, 2)));
  archive.addFile("assets.json", Buffer.from("[]"));
  archive.addFile(
    "research.json",
    Buffer.from(JSON.stringify(records, null, 2)),
  );
  mkdirSync("docs/samples", { recursive: true });
  const path = "docs/samples/Analytical-pedigree-sample.acadia";
  writeFileSync(path, archive.toBuffer());
  console.log(
    JSON.stringify({
      path,
      schemaVersion: saved.schemaVersion,
      sources: records.sources.length,
      methods: records.pedigree.methods.length,
      tasks: records.tasks.length,
      snapshots: records.pedigreeSnapshots.length,
    }),
  );
} finally {
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
