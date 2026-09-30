import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchStore, contentHash } from "../src/main/research-store";
import { ResearchService } from "../src/main/research-service";
import { requestResearchModel } from "../src/main/analysis";
import { createBlankProject } from "../src/shared/project";
import {
  createAppraisal,
  createBrief,
  createFinding,
  createMethodRow,
  createMethodWorksheet,
  createOrigin,
} from "../src/shared/pedigree";
import type {
  ChallengeProposal,
  MethodAssistanceProposal,
  ModelRequestAudit,
} from "../src/shared/pedigree-analysis";
import type { AISettings, ResearchOutput } from "../src/shared/types";
import type { ResearchJob } from "../src/shared/research";
const local: AISettings = {
  provider: "ollama",
  endpoint: "http://127.0.0.1:11434",
  model: "fixture-model",
};
const fixtures: { store: ResearchStore; path: string }[] = [];
const stamp = "2026-09-29T12:00:00.000Z";
function fixture(settings = local) {
  const path = mkdtempSync(join(tmpdir(), "acadia-pedigree-service-")),
    store = new ResearchStore(path);
  fixtures.push({ store, path });
  const project = createBlankProject();
  project.question =
    "Does the Cedar filter cause reduced turbidity in the field?";
  project.privacy = {
    mode: "local",
    provider: settings.provider,
    endpoint: settings.endpoint,
    model: settings.model,
  };
  store.saveProject(project);
  const add = (id: string, text: string, pin = false) => {
    store.saveSource({
      id,
      projectId: project.id,
      title: id,
      kind: "document",
      currentVersionId: `${id}-v1`,
      inclusion: pin ? "pin" : "include",
      createdAt: stamp,
      updatedAt: stamp,
    });
    store.addVersion(
      {
        id: `${id}-v1`,
        sourceId: id,
        title: id,
        hash: contentHash(text),
        acquiredAt: stamp,
        status: "ready",
        method: "native",
        totalUnits: 1,
        processedUnits: 1,
      },
      [
        {
          id: `${id}-p1`,
          sourceId: id,
          versionId: `${id}-v1`,
          text,
          locator: "Page 1",
          method: "native",
          inclusion: "include",
        },
      ],
    );
  };
  add(
    "study",
    "Cedar filter turbidity declined in a vendor before-after study. There was no random allocation or concurrent control; seasonal changes were not measured.",
  );
  add(
    "syndication",
    "Cedar filter improves turbidity, according to the vendor's same before-after study. This article collected no independent observations.",
  );
  add(
    "counter",
    "Independent Cedar field trial found no improvement in turbidity. A negative result contradicts the proposed effect.",
    true,
  );
  add(
    "gap",
    "Cedar baseline turbidity and seasonal confounding remain unknown. Long-term outcomes were not measured.",
  );
  add(
    "irrelevant",
    "Cedar sample containers were blue. This observation does not measure filtration performance.",
  );
  const appraisal = createAppraisal(project.id, "study", "study-v1");
  store.saveAppraisal({
    ...appraisal,
    methods: "Before-after convenience sample",
    limitations: "No concurrent control; seasonal confounding",
    origin: "primary",
    reviewStatus: "reviewed",
  });
  store.saveOrigin({
    ...createOrigin(project.id, "study", "syndication"),
    status: "confirmed",
    kind: "same-study",
    rationale: "Article cites the vendor study and collected no data",
  });
  const claim = {
    id: "causal-claim",
    projectId: project.id,
    title: "The Cedar filter caused the observed improvement",
    question: project.question,
    status: "provisional" as const,
    alternatives: "Seasonal turbidity change",
    limitations: "No controlled comparison",
    links: [
      {
        id: "link",
        passageId: "irrelevant-p1",
        relation: "supports" as const,
        rationale: "Needs relevance review",
        quote: "Cedar sample containers were blue.",
      },
    ],
    updatedAt: stamp,
  };
  store.saveClaim(claim);
  store.saveFinding({
    ...createFinding(project.id, claim.id),
    classification: "inference",
    reasoning: "Observed change after installation",
    supportReview: "unassessed",
  });
  const service = new ResearchService(
    store,
    {
      startCapture: () => {
        throw new Error("No automatic outside research");
      },
    },
    () => settings,
    () => undefined,
    () => {},
  );
  return { store, project, service, add, claim };
}
const response = (value: unknown) =>
  new Response(JSON.stringify({ message: { content: JSON.stringify(value) } }));
function mockModel(final: (input: any, request: any) => unknown) {
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)),
      input = JSON.parse(request.messages[1].content);
    return response(
      input.source_passages
        ? final(input, request)
        : {
            support: ["Cedar turbidity"],
            counter: ["Cedar negative contradiction"],
            gaps: ["Cedar unknown baseline"],
          },
    );
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
async function completed(store: ResearchStore, job: ResearchJob) {
  for (let i = 0; i < 150; i++) {
    const current = store.getJob(job.id)!;
    if (["completed", "failed", "cancelled"].includes(current.status))
      return current;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Fixture job did not finish");
}
afterEach(() => {
  vi.unstubAllGlobals();
  for (const f of fixtures.splice(0)) {
    f.store.close();
    rmSync(f.path, { recursive: true, force: true });
  }
});

describe("on-demand critical research with fixed contradictory fixtures", () => {
  it("projects drafting assessments to substantive fields and numbered passages without losing saved provenance", async () => {
    const { store, project, service } = fixture();
    const pedigree = store.pedigreeState(project.id),
      appraisal = pedigree.appraisals[0];
    mockModel((input) => {
      const assessment = input.research_pedigree.source_appraisals[0];
      expect(assessment).toMatchObject({
        source: "study",
        limitations: appraisal.limitations,
        methods: appraisal.methods,
        reviewStatus: appraisal.reviewStatus,
      });
      expect(assessment.passageLabels).toContain(
        input.source_passages.find((p: any) => p.passageId === "study-p1")
          .label,
      );
      for (const value of [
        appraisal.id,
        appraisal.projectId,
        appraisal.createdAt,
      ])
        expect(JSON.stringify(input.research_pedigree)).not.toContain(value);
      expect(JSON.stringify(input.researcher_annotations)).not.toContain(
        "projectId",
      );
      return {
        markdown: `The uncontrolled comparison needs further study [${assessment.passageLabels[0]}].`,
      };
    });
    const output = await service.analyze(project, "decision-brief", "");
    const run = store.getAnalysisRun(project.id, output.runId!);
    expect(run.templateVersion).toBe("acadia-evidence-1.0-interface-1");
    expect(
      store.getPedigreeSnapshot(run.pedigreeSnapshotId!).state.appraisals,
    ).toEqual(pedigree.appraisals);
  });
  it.each(["ollama", "compatible"] as const)(
    "uses explicit challenge identifiers and validates a complete %s proposal",
    async (provider) => {
      const settings: AISettings =
        provider === "ollama"
          ? local
          : {
              provider: "compatible",
              endpoint: "http://127.0.0.1:8080/v1",
              model: "fixture-model",
            };
      const { store, project, service, claim } = fixture(settings);
      const before = JSON.stringify(store.pedigreeState(project.id));
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: unknown, init?: RequestInit) => {
          const request = JSON.parse(String(init?.body)),
            input = JSON.parse(request.messages[1].content);
          let result: unknown = {
            support: ["Cedar"],
            counter: ["Cedar counter"],
            gaps: ["Cedar unknown"],
          };
          if (input.source_passages) {
            const passage = input.source_passages.find(
              (p: any) => p.passageId === "study-p1",
            );
            expect(passage.citationId).toBeTruthy();
            expect(passage.id).toBeUndefined();
            expect(request.messages[0].content).toContain(
              "source_passages.citationId",
            );
            if (provider === "ollama") {
              expect(request.format.required).toEqual([
                "summary",
                "issues",
                "limitations",
                "suggestedChanges",
              ]);
              const issue = request.format.properties.issues.items;
              expect(issue.required).toEqual([
                "category",
                "summary",
                "detail",
                "passageIds",
                "claimIds",
                "assumptionIds",
              ]);
              expect(issue.properties.passageIds.items).toEqual({
                type: "string",
              });
              expect(JSON.stringify(request.format)).not.toContain("maxLength");
              expect(issue.properties.claimIds.items.enum).toBeUndefined();
              expect(issue.properties.assumptionIds.maxItems).toBe(0);
              expect(
                request.format.properties.suggestedChanges.items.properties
                  .citationIds.items.enum,
              ).toBeUndefined();
              expect(request.format.additionalProperties).toBe(false);
            } else {
              expect(request.format).toBeUndefined();
              expect(request.response_format).toBeUndefined();
            }
            result = {
              summary: "Causal support needs investigation",
              issues: [
                {
                  category: "causal-inference",
                  summary: "Control missing",
                  detail: "The comparison cannot isolate causation.",
                  passageIds: [passage.passageId],
                  claimIds: [claim.id],
                  assumptionIds: [],
                },
              ],
              limitations: ["No controlled comparison"],
              suggestedChanges: [
                {
                  original: claim.title,
                  proposed: `The observed association needs a controlled comparison [${passage.label}].`,
                  rationale: "Qualify causal wording",
                  citationIds: [passage.citationId],
                },
              ],
            };
          }
          return new Response(
            JSON.stringify(
              provider === "ollama"
                ? { message: { content: JSON.stringify(result) } }
                : {
                    choices: [{ message: { content: JSON.stringify(result) } }],
                  },
            ),
          );
        }),
      );
      const job = await completed(
        store,
        service.challenge(project, { kind: "finding", id: claim.id }),
      );
      expect(job.status, job.message).toBe("completed");
      const proposal = job.result as ChallengeProposal;
      expect(proposal.suggestedChanges).toHaveLength(1);
      expect(
        proposal.citations.some(
          (c) => c.id === proposal.suggestedChanges![0].citationIds[0],
        ),
      ).toBe(true);
      expect(store.state(project.id).claims[0].title).toBe(claim.title);
      expect(JSON.stringify(store.pedigreeState(project.id))).toBe(before);
    },
  );
  it("supplies quality, dependent origins, counter pins and relevance limitations, saving proposals without altering assessments", async () => {
    const { store, project, service, claim } = fixture();
    const before = structuredClone(store.pedigreeState(project.id));
    const fetcher = mockModel((input, request) => {
      expect(request.messages[0].content).toContain("irrelevant passage");
      expect(request.messages[0].content).toContain(
        "association alone does not establish causation",
      );
      expect(
        input.research_pedigree.source_appraisals[0].limitations,
      ).toContain("No concurrent control");
      expect(
        input.research_pedigree.independent_source_groups.map(
          (group: { source: string }[]) =>
            group.map((entry) => entry.source).sort(),
        ),
      ).toContainEqual(["study", "syndication"]);
      expect(
        input.source_passages.some((p: any) => p.passageId === "counter-p1"),
      ).toBe(true);
      return {
        summary: "The causal conclusion exceeds the evidence",
        issues: [
          {
            category: "causal-inference",
            summary: "Uncontrolled comparison",
            detail: "Seasonal changes remain an alternative explanation.",
            passageIds: ["study-p1", "counter-p1"],
            claimIds: [claim.id],
            assumptionIds: [],
          },
          {
            category: "unsupported-claim",
            summary: "Irrelevant evidence",
            detail:
              "Container color is validly cited but does not measure filter performance.",
            passageIds: ["irrelevant-p1"],
            claimIds: [claim.id],
            assumptionIds: [],
          },
          {
            category: "source-independence",
            summary: "Syndication",
            detail: "The article is not independent corroboration.",
            passageIds: ["syndication-p1"],
            claimIds: [],
            assumptionIds: [],
          },
        ],
        limitations: ["An independent controlled field study is needed"],
        suggestedChanges: [],
      };
    });
    expect(fetcher).not.toHaveBeenCalled();
    const job = await completed(
      store,
      service.challenge(project, { kind: "finding", id: claim.id }),
    );
    expect(job.status, job.message).toBe("completed");
    const proposal = job.result as ChallengeProposal;
    expect(proposal.issues).toHaveLength(3);
    expect(store.pedigreeState(project.id)).toEqual(before);
    expect(store.state(project.id).claims[0]).toEqual(claim);
    const run = store.state(project.id).runs[0];
    expect(run.requests).toHaveLength(2);
    expect(run.requests?.[1].parameters).toMatchObject({
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 6000 },
    });
    expect(
      run.retrieval?.selections.find((s) => s.passageId === "counter-p1")?.pool,
    ).toBe("pins");
    expect(store.getPedigreeSnapshot(run.pedigreeSnapshotId!).state).toEqual(
      before,
    );
  });
  it("returns complete method proposals with exact current revision, rejecting invented links without writing", async () => {
    const { store, project, service } = fixture();
    const method = store.saveMethod(
      createMethodWorksheet(project.id, "hypotheses"),
    );
    mockModel((input) => ({
      summary: "Compare seasonal change",
      proposedMethod: {
        ...input.current_worksheet,
        rows: [
          {
            ...input.worksheet_row_shape,
            text: "Seasonality explains observed changes",
            passageIds: ["gap-p1"],
            predictions: "Control and installed sites change together",
            discriminatingTest: "Concurrent controls",
          },
        ],
      },
      issues: [],
      limitations: ["Untested hypothesis"],
    }));
    const job = await completed(
      store,
      service.assistMethod(project, method.id),
    );
    expect(job.status, job.message).toBe("completed");
    const proposal = job.result as MethodAssistanceProposal;
    expect(proposal.methodRevision).toBe(method.revision);
    expect(proposal.proposedMethod.rows).toHaveLength(1);
    expect(store.pedigreeState(project.id).methods[0]).toEqual(method);
    mockModel((input) => ({
      summary: "Invalid",
      proposedMethod: {
        ...input.current_worksheet,
        rows: [{ ...input.worksheet_row_shape, passageIds: ["invented"] }],
      },
      issues: [],
      limitations: [],
    }));
    const failed = await completed(
      store,
      service.assistMethod(project, method.id),
    );
    expect(failed.status).toBe("failed");
    expect(failed.message).toContain("unknown or unavailable");
    expect(store.pedigreeState(project.id).methods[0]).toEqual(method);
  });
  it("keeps report challenge edits as proposals with exact anchors and stable original citation IDs", async () => {
    const { store, project, service } = fixture();
    const output: ResearchOutput = {
      id: "report",
      kind: "hypothesis",
      title: "Causal finding",
      markdown: "Cedar caused improvement [7].",
      provider: "fixture",
      sourceIds: ["study"],
      createdAt: stamp,
      boardUpdatedAt: stamp,
      citations: [
        {
          id: "existing-cite",
          label: "7",
          sourceId: "study",
          versionId: "study-v1",
          passageId: "study-p1",
          sourceTitle: "study",
          locator: "Page 1",
          quote: store.getPassage("study-p1").text,
          acquiredAt: stamp,
          verified: true,
        },
      ],
    };
    project.outputs.push(output);
    store.saveProject(project);
    const original = JSON.stringify(output);
    mockModel((input) => {
      expect(
        input.source_passages.find((c: any) => c.passageId === "study-p1"),
      ).toMatchObject({ citationId: "existing-cite", label: "1" });
      return {
        summary: "Qualify the causal claim",
        issues: [],
        limitations: ["No control"],
        suggestedChanges: [
          {
            original: input.target_original.trim(),
            proposed:
              "Cedar was associated with improvement; causality remains uncertain [1].",
            rationale: "No control",
            citationIds: ["existing-cite"],
          },
        ],
      };
    });
    const job = await completed(
      store,
      service.challenge(project, { kind: "report", id: output.id }),
    );
    expect(job.status, job.message).toBe("completed");
    expect((job.result as ChallengeProposal).suggestedChanges).toHaveLength(1);
    expect(JSON.stringify(output)).toBe(original);
  });
  it("uses the saved brief question and scope, while explicit collection questions remain explicit", async () => {
    const { store, project, service } = fixture();
    const brief = store.saveBrief({
      ...(store.pedigreeState(project.id).briefs[0] || createBrief(project.id)),
      question: "Does Cedar outperform a concurrent field control?",
      scope: "Field deployment only",
      inclusionCriteria: "Concurrent comparison",
      successCriteria: "Measured turbidity change",
    });
    const questions: string[] = [];
    mockModel((input) => {
      questions.push(input.research_question);
      expect(input.research_pedigree.brief.scope).toBe(brief.scope);
      expect(input.research_pedigree.brief.inclusionCriteria).toBe(
        brief.inclusionCriteria,
      );
      return {
        markdown: `Qualified finding [${input.source_passages[0].label}].`,
      };
    });
    await service.analyze(project, "hypothesis", "");
    const answer = await completed(
      store,
      service.ask(project, "What remains unknown about Cedar?"),
    );
    expect(answer.status).toBe("completed");
    expect(questions).toEqual([
      brief.question,
      "What remains unknown about Cedar?",
    ]);
    expect(
      store.state(project.id).runs.find((r) => r.kind === "hypothesis")
        ?.question,
    ).toBe(brief.question);
  });
  it("makes no cloud fallback or automatic model call in offline mode", async () => {
    const { store, project, service, claim } = fixture({
      provider: "offline",
      endpoint: "",
      model: "",
    });
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const job = await completed(
      store,
      service.challenge(project, { kind: "finding", id: claim.id }),
    );
    expect(job.status).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
    expect(store.state(project.id).runs[0].requests).toEqual([]);
  });
});

describe("reproducible private requests and deliverable plans", () => {
  it("audits effective model parameters and redacts configured credentials from text", async () => {
    const requests: ModelRequestAudit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({ markdown: "Insufficient evidence." })),
    );
    await requestResearchModel(
      { ...local, apiKey: "fixture-private-key" },
      [{ role: "user", content: "Accidental fixture-private-key text" }],
      undefined,
      { maxTokens: 700, onRequest: (r) => requests.push(r) },
    );
    expect(JSON.stringify(requests)).not.toContain("fixture-private-key");
    expect(requests[0].messages[0].content).toContain("[redacted credential]");
    expect(requests[0].parameters).toMatchObject({
      stream: false,
      options: { num_predict: 700, temperature: 0.2 },
      timeoutMs: 360000,
    });
    expect(JSON.stringify(requests)).not.toContain("Authorization");
  });
  it.each(["software", "curriculum"] as const)(
    "creates an editable offline %s WBS from an immutable selected analysis",
    async (deliverableType) => {
      const { store, project, service } = fixture({
        provider: "offline",
        endpoint: "",
        model: "",
      });
      const analysis: ResearchOutput = {
        id: "analysis",
        kind: "gap-analysis",
        title: "Evidence gaps",
        markdown: "No controlled trial establishes causality.",
        provider: "fixture",
        sourceIds: [],
        createdAt: stamp,
        boardUpdatedAt: stamp,
      };
      project.outputs.push(analysis);
      store.saveProject(project);
      const plan = await service.analyze(project, "project-plan", "", {
        analysisOutputId: analysis.id,
        gap: "Researchers lack a consistent evidence review workflow",
        deliverableType,
        deliverable: "Evidence review support",
        acceptanceCriteria: "Every finding links to evidence and limitations",
      });
      expect(plan.markdown).toContain(
        "| Phase | Deliverable | Depends on | Completion criteria |",
      );
      expect(plan.markdown).toContain(
        deliverableType === "software" ? "Prototype" : "Define objectives",
      );
      expect(plan.markdown).toContain("Stop or revise the plan");
      analysis.markdown = "Later changed";
      expect(plan.plan?.analysisMarkdown).toContain("No controlled trial");
      expect(plan.pedigreeSnapshotId).toBeTruthy();
      expect(store.state(project.id).tasks).toEqual([]);
    },
  );
});
