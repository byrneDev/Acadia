import { expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createBlankProject } from "../src/shared/project";
import {
  createAppraisal,
  createFinding,
  createOrigin,
} from "../src/shared/pedigree";
import type { ChallengeProposal } from "../src/shared/pedigree-analysis";
import type {
  AnalysisRun,
  ResearchAnswer,
  ResearchJob,
} from "../src/shared/research";
import { ResearchService } from "../src/main/research-service";
import { contentHash, ResearchStore } from "../src/main/research-store";

/** Explicit opt-in. Uses only the synthetic fixture below and one loopback model.
 * Model-quality outcomes are recorded separately; a completed request is not a
 * passing quality judgment. CI does not download or invoke a model.
 */
it.skipIf(process.env.ACADIA_LOCAL_EVAL !== "1")(
  "records a live local-model analytical-quality example from synthetic evidence",
  async () => {
    const endpoint = "http://127.0.0.1:11434";
    const model = "qwen3.5:9b";
    const directory = mkdtempSync(
      join(tmpdir(), "acadia-synthetic-evaluation-"),
    );
    const output = resolve("docs/evaluations/v0.4-local-model.json");
    const started = new Date().toISOString();
    const document: Record<string, unknown> = {
      evaluationVersion: 1,
      startedAt: started,
      provider: "ollama",
      endpoint,
      model,
      scope:
        "One live-model example using wholly synthetic research; not a general accuracy claim or standards certification.",
      privacy:
        "Isolated temporary SQLite store. No existing profile, user document, credential, web search, or remote service was read.",
      metrics: {},
      manualReview: {
        status: "pending",
        note: "Inspect actual responses and classify reasoning separately from transport, parsing, retrieval, and provenance checks.",
      },
    };
    let store: ResearchStore | undefined;
    let projectId = "";
    const nativeFetch = globalThis.fetch;
    const destinations: string[] = [];
    vi.stubGlobal("fetch", ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string" || input instanceof URL ? input : input.url,
      );
      if (
        url.origin !== endpoint ||
        !["/api/tags", "/api/chat"].includes(url.pathname)
      )
        throw new Error(
          "Synthetic evaluation blocked a non-approved network destination.",
        );
      destinations.push(`${url.origin}${url.pathname}`);
      return nativeFetch(input, init);
    }) as typeof fetch);
    try {
      const inventoryResponse = await fetch(`${endpoint}/api/tags`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!inventoryResponse.ok)
        throw new Error(
          `Local model inventory returned HTTP ${inventoryResponse.status}.`,
        );
      const inventory = (await inventoryResponse.json()) as {
        models: { name: string; digest: string; details?: unknown }[];
      };
      const selected = inventory.models.find((entry) => entry.name === model);
      if (!selected)
        throw new Error(
          `Required installed model ${model} is unavailable. No model was installed or substituted.`,
        );
      document.modelIdentity = selected;
      store = new ResearchStore(directory);
      const project = createBlankProject();
      projectId = project.id;
      project.title = "SYNTHETIC Cedar industrial pilot evaluation";
      project.question =
        "Did the Cedar filter cause reduced machine downtime, and is a full factory rollout justified?";
      project.privacy = { mode: "local", provider: "ollama", endpoint, model };
      store.saveProject(project);
      const stamp = "2026-09-29T12:00:00.000Z";
      const fixture = [
        {
          id: "flawed-primary",
          category: "support",
          text: "SYNTHETIC PRIMARY PILOT: Cedar filter was fitted on six convenience-selected machines for four days. Downtime fell from ten stops to four stops per shift, a 60 percent before/after decrease. No comparison group or random assignment was used. Production load and staffing changed in the same week. These observations do not establish that Cedar caused the improvement.",
        },
        {
          id: "syndicated-a",
          category: "dependency",
          text: "SYNTHETIC TRADE ARTICLE: Cedar achieves a 60 percent downtime improvement. This article quotes the six-machine, four-day Cedar primary pilot press release; it collected no independent measurements.",
        },
        {
          id: "syndicated-b",
          category: "dependency",
          text: "SYNTHETIC NEWS SUMMARY: Cedar cut machine stoppages. The figures come entirely from the same six-machine, four-day pilot as the trade article. This is secondary reporting, not another experiment.",
        },
        {
          id: "counter-field",
          category: "counter",
          text: "SYNTHETIC COUNTEREVIDENCE: A load-matched repeat found no downtime improvement with Cedar under high production load. Comparable low-load shifts without Cedar also fell to four stops. This contradicts attributing the original decrease uniquely to the filter, although the short repeat does not settle all possible benefits.",
        },
        {
          id: "irrelevant-calendar",
          category: "irrelevant",
          text: "SYNTHETIC ADMINISTRATIVE RECORD: The Cedar maintenance meeting occurred on Friday at 14:00. This is a scheduling record. It contains no downtime observations, filter effectiveness comparison, durability test, or safety outcomes.",
        },
        {
          id: "alternative-explanation",
          category: "alternative",
          text: "SYNTHETIC ALTERNATIVE EXPLANATION: Reduced production load or changed staffing, rather than Cedar, could account for the downtime decrease. Distinguish filter effect from operating-condition effects with a randomized or matched-load comparison that holds staffing constant.",
        },
        {
          id: "decisive-gap",
          category: "gap",
          text: "SYNTHETIC MISSING INFORMATION: No randomized or matched-load field comparison with stable staffing has yet been completed. That comparison is the decisive missing observation for the causal claim. There are no six-month downtime, injury-rate, worker-safety, or durability outcomes. Long-term effects are unknown, not zero.",
        },
      ];
      function add(id: string, text: string, pinned = false) {
        store!.saveSource({
          id,
          projectId: project.id,
          title: id,
          kind: "document",
          currentVersionId: `${id}-v1`,
          inclusion: pinned ? "pin" : "include",
          createdAt: stamp,
          updatedAt: stamp,
        });
        store!.addVersion(
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
              page: 1,
              method: "native",
              inclusion: "include",
            },
          ],
        );
      }
      for (const source of fixture) add(source.id, source.text);
      for (let index = 0; index < 12; index++)
        add(
          `pinned-context-${index}`,
          `SYNTHETIC PINNED CEDAR CONTEXT ${index}. ` +
            "Equipment inventory, administrative scheduling and workshop layout provide context but no comparative effectiveness observation. ".repeat(
              20,
            ),
          true,
        );
      for (const id of ["syndicated-a", "syndicated-b"])
        store.saveOrigin({
          ...createOrigin(project.id, id, "flawed-primary"),
          kind: "same-study",
          status: "confirmed",
          rationale:
            "The article explicitly derives all measurements from the same primary pilot.",
        });
      store.saveAppraisal({
        ...createAppraisal(project.id, "flawed-primary", "flawed-primary-v1"),
        evidenceType: "uncontrolled before/after pilot",
        origin: "primary",
        methods:
          "Six convenience-selected machines over four days; no randomized or matched control.",
        limitations: "Production load and staffing changed simultaneously.",
        applicability: "Insufficient to infer full-factory performance.",
        rationale: "Observational change is not isolated causal evidence.",
        passageIds: ["flawed-primary-p1"],
        reviewStatus: "reviewed",
      });
      store.saveClaim({
        id: "unsupported-causal-claim",
        projectId: project.id,
        title:
          "Cedar caused a 60 percent reduction in downtime and therefore justifies a full factory rollout.",
        question: project.question,
        status: "provisional",
        alternatives:
          "Production load or staffing changes could explain the decrease.",
        limitations: "No matched-load comparison or long-term observation.",
        links: [
          {
            id: "irrelevant-valid-link",
            passageId: "irrelevant-calendar-p1",
            quote: fixture.find((entry) => entry.id === "irrelevant-calendar")!
              .text,
            relation: "supports",
            rationale:
              "Deliberately incorrect relation in this synthetic evaluation: the passage exists but does not support the claim.",
          },
        ],
        updatedAt: stamp,
      });
      store.saveFinding({
        ...createFinding(project.id, "unsupported-causal-claim"),
        classification: "inference",
        reasoning:
          "Synthetic test target: infer causation from a before/after observation.",
        confidence: "unassessed",
        supportReview: "unassessed",
      });
      document.fixture = {
        sources: fixture,
        pinnedContextPassages: 12,
        knownFindings: {
          supported: "A short uncontrolled pilot observed fewer stops.",
          unsupported:
            "Cedar uniquely caused the decrease or justifies full rollout.",
          dependency:
            "The two articles and primary pilot share one evidence origin.",
          contradiction:
            "High-load repeat did not improve; low-load no-filter shifts also improved.",
          alternative:
            "Operating conditions or staffing may explain the original decrease.",
          missing:
            "Controlled or matched-load comparison with stable staffing and long-term outcomes.",
          irrelevantCitation:
            "A real meeting schedule is valid provenance but irrelevant to effectiveness.",
          abstention:
            "Six-month injury-rate effect cannot be estimated from this collection.",
        },
      };
      const service = new ResearchService(
        store,
        {
          startCapture() {
            throw new Error("External capture is disabled in this evaluation.");
          },
        },
        () => ({ provider: "ollama", endpoint, model }),
        () => undefined,
        () => {},
      );
      async function finish(job: ResearchJob): Promise<ResearchJob> {
        const deadline = Date.now() + 360_000;
        while (Date.now() < deadline) {
          const current = store!.getJob(job.id)!;
          if (["completed", "failed", "cancelled"].includes(current.status))
            return current;
          await new Promise((done) => setTimeout(done, 250));
        }
        service.cancelJob(job.id);
        throw new Error(
          "Synthetic model evaluation exceeded its six-minute job limit.",
        );
      }
      console.log(
        "Live synthetic evaluation: generating decision brief with balanced evidence retrieval.",
      );
      let reportStatus = "completed";
      try {
        const result = await service.analyze(
          project,
          "decision-brief",
          "Evaluate causal attribution, shared evidence origins, alternative explanations, counterevidence and the decisive missing test. Do not recommend rollout unless the evidence establishes the effect.",
        );
        document.decisionBrief = result;
      } catch (error) {
        reportStatus = "failed";
        document.decisionBrief = {
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
      }
      console.log(
        "Live synthetic evaluation: challenging a causally unsupported claim with an irrelevant but valid citation.",
      );
      const challenge = await finish(
        service.challenge(project, {
          kind: "finding",
          id: "unsupported-causal-claim",
        }),
      );
      document.challenge = challenge;
      console.log(
        "Live synthetic evaluation: asking about unavailable six-month worker-safety outcomes.",
      );
      const abstention = await finish(
        service.ask(
          project,
          "What is the exact six-month percentage reduction in worker injury rate caused by Cedar?",
        ),
      );
      document.abstention = abstention;
      const runs = store.state(project.id).runs;
      const reportRun = runs.find((run) => run.kind === "decision-brief");
      const challengeResult =
        challenge.status === "completed"
          ? (challenge.result as ChallengeProposal)
          : undefined;
      const answer =
        abstention.status === "completed"
          ? (abstention.result as ResearchAnswer)
          : undefined;
      const categories =
        challengeResult?.issues.map((issue) => issue.category) || [];
      const challengeText = JSON.stringify(challengeResult || "");
      const retrieved = new Set(
        reportRun?.passages?.map((passage) => passage.id) || [],
      );
      const metrics = {
        transportAndStructure: {
          reportStatus,
          challengeStatus: challenge.status,
          abstentionStatus: abstention.status,
          failedRuns: runs
            .filter((run) => run.status !== "completed")
            .map((run) => ({
              kind: run.kind,
              status: run.status,
              warnings: run.groundingWarnings,
            })),
        },
        retrieval: {
          relevantSupportingPassagePresent: retrieved.has("flawed-primary-p1"),
          counterevidencePresent: retrieved.has("counter-field-p1"),
          decisiveGapPresent: retrieved.has("decisive-gap-p1"),
          alternativePresent: retrieved.has("alternative-explanation-p1"),
          selectedPassageCount: retrieved.size,
          policy: reportRun?.retrieval?.policy,
          selectedByPool: reportRun?.retrieval?.selections.reduce(
            (count, entry) => ({
              ...count,
              [entry.pool]: (count[entry.pool] || 0) + 1,
            }),
            {} as Record<string, number>,
          ),
        },
        supportReview: {
          proposalCategories: categories,
          unsupportedOrCausalIssueProposed: categories.some((category) =>
            ["unsupported-claim", "causal-inference"].includes(category),
          ),
          irrelevantCitationMentioned:
            /irrelevant|meeting|schedul|unrelated|does not support/i.test(
              challengeText,
            ),
          note: "These are observable output indicators. Semantic correctness requires the manual review recorded separately.",
        },
        contradictionHandling: {
          counterPassageRetrieved: retrieved.has("counter-field-p1"),
          contradictionIssueProposed: categories.includes("contradiction"),
          sameOriginIssueProposed: categories.includes("source-independence"),
        },
        abstention: {
          completed: abstention.status === "completed",
          explicitInsufficientEvidenceFlag: answer?.insufficient ?? null,
          answer: answer?.answer ?? null,
          note: "A flag alone is insufficient; inspect whether the answer invents a six-month effect.",
        },
      };
      document.metrics = metrics;
      document.runs = runs.map((run: AnalysisRun) => ({ ...run }));
      document.networkDestinations = [...new Set(destinations)];
      expect(document.networkDestinations).toEqual(
        expect.arrayContaining([
          `${endpoint}/api/tags`,
          `${endpoint}/api/chat`,
        ]),
      );
    } catch (error) {
      document.evaluationError =
        error instanceof Error ? error.message : String(error);
      if (store && projectId) document.runs = store.state(projectId).runs;
      throw error;
    } finally {
      document.finishedAt = new Date().toISOString();
      document.elapsedSeconds = Math.round(
        (Date.now() - Date.parse(started)) / 1000,
      );
      mkdirSync(resolve("docs/evaluations"), { recursive: true });
      writeFileSync(output, JSON.stringify(document, null, 2) + "\n");
      console.log(`Synthetic evaluation artifact: ${output}`);
      store?.close();
      rmSync(directory, { recursive: true, force: true });
      vi.unstubAllGlobals();
    }
  },
  1_200_000,
);
