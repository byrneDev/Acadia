import { expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir, arch, cpus, totalmem, platform } from "node:os";
import { join, resolve } from "node:path";
import { ResearchStore } from "../src/main/research-store";
import {
  ResearchService,
  validateCitedMarkdown,
} from "../src/main/research-service";
import { createBlankProject } from "../src/shared/project";
import type {
  AnalysisRun,
  ResearchAnswer,
  ResearchJob,
} from "../src/shared/research";
import type { ChallengeProposal } from "../src/shared/pedigree-analysis";
import {
  QUALITY_FIXTURE_V1,
  seedQualityFixtureV1,
} from "./fixtures/analytical-quality-v1";

const capture = {
  startCapture() {
    throw new Error("Web discovery is disabled in this synthetic evaluation.");
  },
};
function retrievalMetrics(run?: AnalysisRun) {
  const selected = new Set(run?.citations.map((c) => c.passageId));
  return {
    expected: QUALITY_FIXTURE_V1.expected,
    retrieved: QUALITY_FIXTURE_V1.expected.mustRetrieve.filter((id) =>
      selected.has(id),
    ),
    missing: QUALITY_FIXTURE_V1.expected.mustRetrieve.filter(
      (id) => !selected.has(id),
    ),
    excluded: QUALITY_FIXTURE_V1.expected.mustExclude.filter(
      (id) => !selected.has(id),
    ),
    dependencyRecorded:
      run?.retrieval?.independentSourceGroups?.some((group) =>
        QUALITY_FIXTURE_V1.expected.dependentGroup.every((id) =>
          group.includes(id),
        ),
      ) ?? false,
    policy: run?.retrieval?.policy,
    candidatePolicy: run?.retrieval?.candidatePolicy,
    selectedPassageCount: selected.size,
    omittedPinCount: run?.retrieval?.omissions.filter(
      (o) =>
        o.passageId.startsWith("pinned-context-") &&
        o.reason === "context-budget",
    ).length,
  };
}
it("runs the versioned analytical-quality retrieval and provenance regressions without a model", async () => {
  const directory = mkdtempSync(join(tmpdir(), "acadia-quality-v1-"));
  const store = new ResearchStore(directory),
    project = createBlankProject();
  project.privacy = { mode: "local", provider: "offline" };
  seedQualityFixtureV1(store, project);
  const service = new ResearchService(
    store,
    capture,
    () => ({ provider: "offline", endpoint: "", model: "" }),
    () => undefined,
    () => {},
  );
  try {
    const output = await service.analyze(project, "decision-brief", ""),
      run = store.getAnalysisRun(project.id, output.runId!);
    const metrics = retrievalMetrics(run);
    expect(metrics.missing).toEqual([]);
    expect(metrics.excluded).toEqual([
      ...QUALITY_FIXTURE_V1.expected.mustExclude,
    ]);
    expect(metrics.dependencyRecorded).toBe(true);
    expect(metrics.omittedPinCount).toBeGreaterThan(0);
    expect(metrics.candidatePolicy).toBe("pin-independent-v1");
    const calendar = run.citations.find((c) => c.passageId === "calendar-p1")!,
      counter = run.citations.find((c) => c.passageId === "counter-p1")!;
    expect(calendar.verified).toBe(true);
    expect(store.pedigreeState(project.id).findings[0].supportReview).toBe(
      "unassessed",
    );
    expect(() =>
      validateCitedMarkdown(
        JSON.stringify({
          markdown: `Cedar caused the improvement: “${counter.quote}” [${calendar.label}]`,
        }),
        run.citations,
      ),
    ).toThrow(/cited source/);
    const empty = createBlankProject();
    empty.question = "What is the exact long-term effect?";
    empty.privacy = { mode: "local", provider: "offline" };
    store.saveProject(empty);
    const noEvidence = await service.analyze(empty, "decision-brief", "");
    expect(noEvidence.markdown).toContain("Insufficient evidence");
    expect(noEvidence.citations).toEqual([]);
    expect(QUALITY_FIXTURE_V1.rubric.map((r) => r.dimension)).toEqual([
      "retrieval",
      "support-review",
      "contradiction-handling",
      "abstention",
    ]);
  } finally {
    await service.shutdown();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

it("fits the complete Cedar challenge in the local context budget without duplicating reference inventories in its schema", async () => {
  const directory = mkdtempSync(join(tmpdir(), "acadia-quality-v1-budget-"));
  const store = new ResearchStore(directory),
    project = createBlankProject();
  project.privacy = {
    mode: "local",
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "fixture-model",
  };
  seedQualityFixtureV1(store, project);
  const service = new ResearchService(
    store,
    capture,
    () => ({ provider: "offline", endpoint: "", model: "" }),
    () => undefined,
    () => {},
  );
  let requests = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)),
        input = JSON.parse(body.messages[1].content);
      let response: unknown = {
        support: ["Cedar"],
        counter: ["Cedar counterevidence"],
        gaps: ["Cedar missing observation"],
      };
      if (input.source_passages) {
        requests++;
        expect(input.source_passages).toHaveLength(120);
        expect(body.options.num_ctx).toBeLessThanOrEqual(65536);
        expect(JSON.stringify(body.format).length).toBeLessThan(2500);
        expect(
          body.format.properties.issues.items.properties.category.enum,
        ).toContain("causal-inference");
        const passage = input.source_passages.find(
          (p: { passageId: string }) => p.passageId === "primary-p1",
        );
        expect(passage.citationId).toBeTruthy();
        response = {
          summary: "Causal attribution requires a controlled comparison",
          issues: [
            {
              category: "causal-inference",
              summary: "No causal isolation",
              detail: "The pilot confounds load and staffing changes.",
              passageIds: [passage.passageId],
              claimIds: ["unsupported-causal-claim"],
              assumptionIds: [],
            },
          ],
          limitations: ["Synthetic fixture"],
          suggestedChanges: [],
        };
      }
      return new Response(
        JSON.stringify({ message: { content: JSON.stringify(response) } }),
      );
    }),
  );
  try {
    const job = service.challenge(project, {
      kind: "finding",
      id: "unsupported-causal-claim",
    });
    await vi.waitFor(() =>
      expect(["completed", "failed"]).toContain(store.getJob(job.id)?.status),
    );
    const result = store.getJob(job.id)!;
    expect(result.status, result.message).toBe("completed");
    expect(requests).toBe(1);
    expect(store.pedigreeState(project.id).findings[0].supportReview).toBe(
      "unassessed",
    );
  } finally {
    await service.shutdown();
    store.close();
    rmSync(directory, { recursive: true, force: true });
    vi.unstubAllGlobals();
  }
});

/** Never downloads a model or sends user data. Run only on explicit opt-in;
 * output indicators remain separate from the human semantic-quality rubric. */
it.skipIf(process.env.ACADIA_QUALITY_EVALUATION !== "1")(
  "records v1 local-model results against the versioned analytical-quality rubric",
  async () => {
    const challengeOnly = process.env.ACADIA_QUALITY_OPERATIONS === "challenge";
    if (process.env.ACADIA_QUALITY_OPERATIONS && !challengeOnly)
      throw new Error(
        "Only the challenge-only evaluation selector is supported; omit it for the complete fixture.",
      );
    const endpoint =
      process.env.ACADIA_QUALITY_ENDPOINT || "http://127.0.0.1:11434";
    const url = new URL(endpoint);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      url.protocol !== "http:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw new Error(
        "The quality evaluation requires an explicit loopback Ollama origin, without credentials or paths.",
      );
    const origin = url.origin,
      model = process.env.ACADIA_QUALITY_MODEL || "qwen3.5:9b";
    const directory = mkdtempSync(join(tmpdir(), "acadia-quality-v1-live-")),
      output = resolve(
        process.env.ACADIA_QUALITY_OUTPUT ||
          "test-results/analytical-quality-v1.json",
      );
    let store: ResearchStore | undefined,
      service: ResearchService | undefined,
      projectId = "";
    const document: Record<string, unknown> = {
      evaluationVersion: 1,
      fixture: QUALITY_FIXTURE_V1,
      startedAt: new Date().toISOString(),
      provider: "ollama",
      endpoint: origin,
      model,
      scope:
        "Synthetic fixture only. No private profile, document, web search, model installation or cloud fallback.",
      operations: challengeOnly
        ? ["challenge"]
        : ["report", "challenge", "abstention"],
      machine: {
        platform: platform(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        totalMemoryBytes: totalmem(),
      },
      semanticReview: {
        status: "pending-human-review",
        dimensions: QUALITY_FIXTURE_V1.rubric.map((rule) => ({
          ...rule,
          status: "not-reviewed",
          responseExcerpts: [],
          reviewerRationale: "",
        })),
      },
    };
    const nativeFetch = globalThis.fetch,
      destinations = new Set<string>();
    vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => {
      const destination = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (
        destination.origin !== origin ||
        !["/api/tags", "/api/chat"].includes(destination.pathname)
      )
        throw new Error(
          "Evaluation blocked a destination outside the approved local model.",
        );
      destinations.add(destination.href);
      return nativeFetch(input, init);
    }) as typeof fetch);
    try {
      const inventoryResponse = await fetch(`${origin}/api/tags`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!inventoryResponse.ok)
        throw new Error(
          `Local inventory returned HTTP ${inventoryResponse.status}.`,
        );
      const inventory = (await inventoryResponse.json()) as {
          models: { name: string; digest?: string }[];
        },
        selected = inventory.models.find((entry) => entry.name === model);
      if (!selected)
        throw new Error(
          `Installed model ${model} is unavailable. No model was installed or substituted.`,
        );
      document.modelIdentity = selected;
      store = new ResearchStore(directory);
      const project = createBlankProject();
      projectId = project.id;
      project.privacy = {
        mode: "local",
        provider: "ollama",
        endpoint: origin,
        model,
      };
      seedQualityFixtureV1(store, project);
      service = new ResearchService(
        store,
        capture,
        () => ({ provider: "ollama", endpoint: origin, model }),
        () => undefined,
        () => {},
      );
      const settled = async (job: ResearchJob) => {
        const deadline = Date.now() + 360000;
        while (Date.now() < deadline) {
          const latest = store!.getJob(job.id)!;
          if (["completed", "failed", "cancelled"].includes(latest.status))
            return latest;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        service!.cancelJob(job.id);
        throw new Error("Evaluation exceeded the six-minute per-job limit.");
      };
      const report = challengeOnly
        ? {
            status: "not-run",
            reason: "Explicit challenge-only contract check",
          }
        : await service
            .analyze(
              project,
              "decision-brief",
              "Evaluate causal attribution, shared origins, alternative explanations, contradictions and the decisive missing test. Keep limitations explicit.",
            )
            .then(
              (result) => ({ status: "completed", result }),
              (error) => ({
                status: "failed",
                error: error instanceof Error ? error.message : String(error),
              }),
            );
      const challenge = await settled(
        service.challenge(project, {
          kind: "finding",
          id: "unsupported-causal-claim",
        }),
      );
      const abstention = challengeOnly
        ? undefined
        : await settled(
            service.ask(project, QUALITY_FIXTURE_V1.abstentionQuestion),
          );
      document.outputs = {
        report,
        challenge,
        abstention: abstention ?? {
          status: "not-run",
          reason: "Explicit challenge-only contract check",
        },
      };
      const runs = store.state(project.id).runs,
        run = runs.find(
          (r) => r.kind === (challengeOnly ? "challenge" : "decision-brief"),
        );
      const proposal =
        challenge.status === "completed"
          ? (challenge.result as ChallengeProposal)
          : undefined;
      const answer =
        abstention?.status === "completed"
          ? (abstention.result as ResearchAnswer)
          : undefined;
      document.metrics = {
        transportAndContract: {
          report: report.status,
          challenge: challenge.status,
          abstention: abstention?.status ?? "not-run",
        },
        retrieval: retrievalMetrics(run),
        supportReview: {
          issueCategories:
            proposal?.issues.map((issue) => issue.category) ?? [],
          semanticJudgment: "not-reviewed",
        },
        contradictionHandling: {
          counterPassageRetrieved:
            run?.citations.some((c) => c.passageId === "counter-p1") ?? false,
          contradictionIssueProposed:
            proposal?.issues.some((i) => i.category === "contradiction") ??
            false,
          semanticJudgment: "not-reviewed",
        },
        abstention: {
          insufficientEvidenceFlag: answer?.insufficient ?? null,
          answer: answer?.answer ?? null,
          semanticJudgment: "not-reviewed",
        },
      };
      document.runs = runs;
      document.outcome =
        "Recorded raw model outputs. Request completion and observable indicators do not establish analytical quality; the separate rubric requires human review.";
      expect([...destinations]).toEqual(
        expect.arrayContaining([`${origin}/api/tags`, `${origin}/api/chat`]),
      );
    } catch (error) {
      document.outcome = "evaluation-failed";
      document.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await service?.shutdown();
      if (store && projectId) document.runs = store.state(projectId).runs;
      document.finishedAt = new Date().toISOString();
      document.networkDestinations = [...destinations];
      mkdirSync(resolve("test-results"), { recursive: true });
      writeFileSync(output, JSON.stringify(document, null, 2) + "\n");
      store?.close();
      rmSync(directory, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  },
  1200000,
);
