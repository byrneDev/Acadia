import type { ResearchOutput, WorkspaceState } from "../shared/types";
import type { ResearchClaim, ResearchTask } from "../shared/research";

/** Fictional practice records. No model calls, imported reviews or inferred human acceptance. */
export async function createGuidedSample(
  kind: "software" | "curriculum" = "software",
): Promise<WorkspaceState> {
  const api = window.acadia!;
  const workspace = await api.newProject(),
    project = workspace.project,
    stamp = new Date().toISOString();
  const id = () => crypto.randomUUID();
  const base = () => ({
    id: id(),
    projectId: project.id,
    revision: 0,
    createdAt: stamp,
    updatedAt: stamp,
  });
  project.title = `Cedar ${kind === "software" ? "software pilot" : "learning pilot"} — fictional practice`;
  project.question =
    kind === "software"
      ? "Should Cedar deliver a software tool to reduce processing errors?"
      : "Should Cedar develop a curriculum to reduce processing errors?";
  project.cards = [
    [
      "Pilot observation — fictional",
      "In a fictional two-week Cedar pilot, 20 volunteers made 12 errors per 100 tasks before the intervention and 8 afterwards. The same participants repeated familiar tasks. There was no comparison group.",
    ],
    [
      "Conflicting field observation — fictional",
      "In a separate fictional field exercise with unfamiliar tasks, 20 participants made 13 errors per 100 tasks before the intervention and 13 afterwards. Workload and supervision differed from the pilot.",
    ],
    [
      "Missing observation — fictional",
      "No matched comparison, sustained-use measurement, accessibility evaluation, or total delivery-cost estimate is available. Neither observation establishes that the intervention caused an improvement.",
    ],
  ].map(([title, content], i) => ({
    id: id(),
    kind: "note" as const,
    title,
    content,
    x: i * 340,
    y: 0,
    tags: ["fictional", "practice"],
    status: "unreviewed" as const,
    createdAt: stamp,
    updatedAt: stamp,
  }));
  await api.save(project);
  const state = await api.researchState();
  const orderedSources = project.cards.map((card) =>
    state.sources.find((source) => source.cardId === card.id),
  );
  if (orderedSources.some((source) => !source))
    throw new Error(
      "The practice sources are still being indexed. The new investigation remains in your library.",
    );
  const passages = (
    await Promise.all(orderedSources.map((source) => api.getSource(source!.id)))
  ).flatMap((s) => s.passages);
  const claim: ResearchClaim = {
    id: id(),
    projectId: project.id,
    title: "The pilot reports fewer errors; causation remains unassessed",
    question: project.question,
    status: "unreviewed",
    alternatives:
      "Practice effects, participant selection, workload or supervision could explain the difference.",
    limitations:
      "Fictional practice data. No matched comparison or sustained outcome.",
    links: passages.map((p) => ({
      id: id(),
      passageId: p.id,
      relation: "context" as const,
      rationale: "Practice source awaiting your assessment.",
      quote: p.text,
    })),
    updatedAt: stamp,
  };
  await api.saveClaim(claim);
  const finding = await api.saveFindingAssessment({
    ...base(),
    claimId: claim.id,
    classification: "source-assertion",
    reasoning:
      "Compare the observations and assess their applicability before proposing a causal conclusion.",
    assumptionIds: [],
    confidence: "unassessed",
    confidenceBasis: "",
    wouldChange:
      "A matched comparison on unfamiliar tasks with sustained improvement.",
    supportReview: "unassessed",
    reviewStatus: "unassessed",
  });
  const task: ResearchTask = {
    id: id(),
    projectId: project.id,
    title: "Design a matched comparison",
    question: project.question,
    claimId: claim.id,
    status: "planned",
    criterion:
      "Define comparable groups, unfamiliar tasks, accessibility checks and a sustained-use observation before recommending rollout.",
    sourceIds: [],
    updatedAt: stamp,
  };
  await api.saveTask(task);
  const gap = await api.saveGap({
    ...base(),
    title: "Does the intervention cause a sustained improvement?",
    missingInformation:
      "Matched comparison, longer-term outcome, accessibility and cost evidence.",
    importance:
      "A deliverable would consume time and money without proof that it addresses the observed problem.",
    resolutionCriteria: task.criterion,
    claimIds: [claim.id],
    taskIds: [task.id],
    passageIds: passages.map((p) => p.id),
    status: "open",
  });
  const citations = await Promise.all(
    passages.map((p) => api.createPassageCitation(p.id)),
  );
  citations.forEach((c, i) => (c.label = String(i + 1)));
  const report: ResearchOutput = {
    id: id(),
    kind: "decision-brief",
    title: "Cedar practice decision brief — draft",
    markdown:
      "# Research question\n\n" +
      project.question +
      "\n\n## Evidence to review\n\nThe fictional pilot reports fewer errors, while the field observation reports no improvement. [1] [2]\n\n## What remains unknown\n\nA matched comparison and sustained outcome are missing. Review the sources and write your own assessment. [3]\n\n## Proposed next step\n\nDesign a test before committing to rollout. This is a practice draft, not a reviewed conclusion.",
    createdAt: stamp,
    provider: "Manual fictional sample — no AI",
    sourceIds: state.sources.map((s) => s.id),
    boardUpdatedAt: stamp,
    citations,
  };
  const plan: ResearchOutput = {
    ...report,
    id: id(),
    kind: "project-plan",
    title: `Cedar ${kind} deliverable — draft`,
    markdown: `# Proposed ${kind} deliverable\n\nBridge the matched-comparison gap through a small, testable pilot. No task completion automatically resolves the gap.\n\n## Acceptance\n\nCollect comparison evidence and review it before deciding whether to expand.`,
    deliveryPlan: {
      schemaVersion: 1,
      id: id(),
      title: `Cedar ${kind} pilot`,
      sourceOutputId: report.id,
      gap: gap.missingInformation,
      gapRefs: [{ id: gap.id, revision: gap.revision }],
      findingRefs: [{ id: finding.id, revision: finding.revision }],
      deliverableType: kind,
      updatedAt: stamp,
      reviewStatus: "draft",
      tasks: [
        {
          id: id(),
          title:
            kind === "software"
              ? "Build an observable prototype"
              : "Develop one assessable learning module",
          phase: "Pilot",
          description:
            "Create only the smallest deliverable needed for the comparison.",
          acceptanceCriteria: task.criterion,
          dependencyIds: [],
          dependencyNotes: "",
          status: "planned",
          owner: "",
          dueDate: "",
          ...(kind === "software"
            ? { requirement: "Record error rates on matched unfamiliar tasks." }
            : {
                learningObjective:
                  "Complete unfamiliar tasks with fewer processing errors.",
              }),
          acceptanceTest:
            "Compare groups under matched conditions and retain resulting evidence.",
          verificationEvidence: [],
          gapRefs: [{ id: gap.id, revision: gap.revision }],
          findingRefs: [{ id: finding.id, revision: finding.revision }],
        },
      ],
    },
  };
  const latest = (await api.load()).project;
  latest.outputs.push(report, plan);
  await api.save(latest);
  const decision = await api.saveDecision({
    ...base(),
    title: "Propose a bounded pilot",
    action: "Investigate the gap before committing to rollout.",
    rationale: "The available observations do not establish causation.",
    alternatives:
      "Retain the current process; investigate a different intervention.",
    claimIds: [claim.id],
    assumptionIds: [],
    outputIds: [plan.id],
    status: "proposed",
  });
  for (const reference of [
    { kind: "claim" as const, id: claim.id },
    { kind: "gap" as const, id: gap.id },
    { kind: "task" as const, id: task.id },
    { kind: "decision" as const, id: decision.id },
    { kind: "report" as const, id: report.id },
    { kind: "delivery-plan" as const, id: plan.id },
  ])
    await api.addBoardReference(reference);
  const sample = await api.load();
  // These fixed positions belong only to the explicitly requested fictional
  // sample. Ordinary investigations retain their freely arranged canvas.
  const cardFor = (recordId: string) =>
    sample.project.cards.find((card) => card.boardReference?.id === recordId)!;
  const orderedCards = [
    ...project.cards.map((card) =>
      sample.project.cards.find((saved) => saved.id === card.id)!,
    ),
    cardFor(claim.id),
    cardFor(gap.id),
    cardFor(task.id),
    cardFor(report.id),
    cardFor(decision.id),
    cardFor(plan.id),
  ];
  orderedCards.forEach((card, index) => {
    card.x = (index % 3) * 410;
    card.y = Math.floor(index / 3) * 380;
  });
  sample.project.connections = [
    ...project.cards.map((card) => ({
      id: id(),
      source: card.id,
      target: cardFor(claim.id).id,
      relation: "informs" as const,
    })),
    {
      id: id(),
      source: cardFor(claim.id).id,
      target: cardFor(gap.id).id,
      relation: "identifies gap",
    },
    {
      id: id(),
      source: cardFor(task.id).id,
      target: cardFor(gap.id).id,
      relation: "addresses",
    },
    {
      id: id(),
      source: cardFor(gap.id).id,
      target: cardFor(decision.id).id,
      relation: "informs",
    },
    {
      id: id(),
      source: cardFor(claim.id).id,
      target: cardFor(report.id).id,
      relation: "informs",
    },
    {
      id: id(),
      source: cardFor(decision.id).id,
      target: cardFor(plan.id).id,
      relation: "produces",
    },
    {
      id: id(),
      source: cardFor(plan.id).id,
      target: cardFor(task.id).id,
      relation: "depends on",
    },
  ];
  await api.save(sample.project);
  return api.load();
}
