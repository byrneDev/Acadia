import { expect, it } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir, cpus, totalmem, platform, release, arch } from "node:os";
import { join, resolve, isAbsolute } from "node:path";
import { performance } from "node:perf_hooks";
import { ResearchStore, contentHash } from "../src/main/research-store";
import { ResearchService } from "../src/main/research-service";
import { createBlankProject } from "../src/shared/project";
import type { Passage } from "../src/shared/research";

/** Explicit local benchmark. Raw measurements are not a 16-GB reference-machine approval. */
it.skipIf(process.env.ACADIA_SCALE_EVALUATION !== "1")(
  "measures the v1 1000-source / 100000-passage / 500-card envelope",
  async () => {
    const profile = process.env.ACADIA_SCALE_PROFILE;
    if (profile && (!isAbsolute(profile) || existsSync(profile)))
      throw new Error(
        "ACADIA_SCALE_PROFILE must name a new, absent absolute directory; existing profiles are never replaced.",
      );
    const root = profile
      ? join(profile, "workspace")
      : mkdtempSync(join(tmpdir(), "acadia-scale-v1-"));
    const artifact = resolve("test-results/scale-v1.json");
    const stamp = new Date().toISOString();
    const result: Record<string, unknown> = {
      benchmarkVersion: 1,
      startedAt: stamp,
      dataset:
        "Synthetic Cedar passages only; no user profile, files or network",
      ...(profile ? { preservedSyntheticProfile: profile } : {}),
      requestedEnvelope: {
        sources: 1000,
        passages: 100000,
        cards: 500,
        analysisRuns: 250,
      },
      machine: {
        platform: platform(),
        release: release(),
        arch: arch(),
        cpu: cpus()[0]?.model,
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
        node: process.versions.node,
        sqlite: process.versions.sqlite,
      },
      referenceHardwareValidation:
        "NOT CLAIMED: these results describe only the recorded host",
      uiResponsivenessValidation:
        "Not measured by this backend benchmark; native UI responsiveness remains a separate acceptance check.",
      metrics: {},
      outcome: "running",
    };
    let store: ResearchStore | undefined, service: ResearchService | undefined;
    const metrics = result.metrics as Record<string, unknown>;
    const measure = <T>(name: string, work: () => T): T => {
      const start = performance.now();
      try {
        return work();
      } finally {
        metrics[name] = {
          milliseconds: performance.now() - start,
          memory: process.memoryUsage(),
        };
      }
    };
    try {
      store = new ResearchStore(root);
      const project = createBlankProject();
      project.question =
        "Does Cedar have a verified decisive terminal observation?";
      project.privacy = { mode: "local", provider: "offline" };
      store.saveProject(project);
      measure("seed", () => {
        store!.transaction(() => {
          for (let source = 0; source < 1000; source++) {
            const id = `source-${source}`,
              versionId = `${id}-v1`;
            const passages: Passage[] = Array.from(
              { length: 100 },
              (_, index) => ({
                id: `${id}-p${index}`,
                sourceId: id,
                versionId,
                text: `SYNTHETIC Cedar observation for batch${source} sample${index}. ${source === 999 && index === 99 ? "Decisive terminal observation terminalneedle has not yet been measured." : "A proposed effect needs a controlled field comparison."}`,
                locator: `Page ${index + 1}`,
                page: index + 1,
                method: "native",
                inclusion: "include",
              }),
            );
            store!.saveSource({
              id,
              projectId: project.id,
              title: `Synthetic source ${source}`,
              kind: "document",
              currentVersionId: versionId,
              inclusion: "include",
              createdAt: stamp,
              updatedAt: stamp,
            });
            store!.addVersion(
              {
                id: versionId,
                sourceId: id,
                title: `Synthetic source ${source}`,
                hash: contentHash(passages.map((p) => p.text).join("\n")),
                acquiredAt: stamp,
                status: "ready",
                method: "native",
                totalUnits: 100,
                processedUnits: 100,
              },
              passages,
            );
          }
        });
        project.cards = Array.from({ length: 500 }, (_, i) => ({
          id: `card-${i}`,
          kind: "note",
          title: `Linked source ${i}`,
          content: "",
          x: (i % 25) * 320,
          y: Math.floor(i / 25) * 180,
          tags: [],
          status: "unreviewed",
          createdAt: stamp,
          updatedAt: stamp,
          boardReference: { kind: "source", id: `source-${i}` },
        }));
        store!.saveProject(project);
        store!.activeProjectId = project.id;
        for (let i = 0; i < 250; i++)
          store!.saveRun({
            id: `audit-${i}`,
            projectId: project.id,
            kind: "synthetic-history",
            question: project.question,
            instructions: "Synthetic stored instructions ".repeat(1000),
            createdAt: stamp,
            provider: "fixture",
            model: "none",
            templateVersion: "scale-v1",
            citations: [],
            exclusions: [],
            sourceVersions: [],
            response: "Synthetic response ".repeat(1000),
            status: "completed",
            requests: [
              {
                provider: "fixture",
                endpoint: "http://127.0.0.1",
                model: "none",
                messages: [
                  {
                    role: "user",
                    content: "Synthetic historical prompt ".repeat(1000),
                  },
                ],
                parameters: {},
              },
            ],
          });
      });
      if (profile) {
        writeFileSync(
          join(profile, ".acadia-scale-fixture.json"),
          JSON.stringify({
            synthetic: true,
            projectId: project.id,
            sources: 1000,
            passages: 100000,
            cards: 500,
          }),
        );
        writeFileSync(
          join(root, "workspace.json"),
          JSON.stringify({ project }),
        );
        writeFileSync(join(root, "assets.json"), "{}");
      }
      expect(store.listSourcesPage(project.id).total).toBe(1000);
      expect(store.searchSourcesPage(project.id, "Cedar").total).toBe(100000);
      expect(store.getProject(project.id)?.cards).toHaveLength(500);
      store.close();
      store = undefined;
      store = measure("coldStoreOpen", () => new ResearchStore(root));
      measure("projectLibrary", () => store!.listProjects());
      const state = measure("routineResearchState", () =>
        store!.state(project.id, { lightweight: true }),
      );
      expect(state.runs).toHaveLength(100);
      expect(state.runCount).toBe(250);
      metrics.routinePayloadBytes = Buffer.byteLength(JSON.stringify(state));
      const searches: number[] = [];
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        const page = store.searchSourcesPage(project.id, "terminalneedle", {
          limit: 50,
        });
        searches.push(performance.now() - start);
        expect(page.items[0].id).toBe("source-999-p99");
        expect(page.total).toBe(1);
      }
      metrics.exactSearchMilliseconds = searches;
      measure("commonSearchFinalPage", () =>
        expect(
          store!.searchSourcesPage(project.id, "Cedar", {
            offset: 99950,
            limit: 50,
          }).items,
        ).toHaveLength(50),
      );
      measure("sourcePassagesLastPage", () =>
        expect(
          store!
            .getSourcePassagesPage(project.id, "source-999", undefined, "", {
              offset: 90,
              limit: 10,
            })
            .items.at(-1)?.id,
        ).toBe("source-999-p99"),
      );
      measure("historyFinalPage", () =>
        expect(
          store!.listAnalysisRunsPage(project.id, { offset: 200, limit: 50 })
            .items,
        ).toHaveLength(50),
      );
      service = new ResearchService(
        store,
        {
          startCapture() {
            throw new Error("No network in scale benchmark");
          },
        },
        () => ({ provider: "offline", endpoint: "", model: "" }),
        () => undefined,
        () => {},
      );
      const phases: Record<
        string,
        { calls: number; totalMilliseconds: number; maxMilliseconds: number }
      > = {};
      const profileCall = <T extends (...args: any[]) => any>(
        name: string,
        work: T,
      ): T =>
        ((...args: Parameters<T>) => {
          const start = performance.now();
          const record = () => {
            const elapsed = performance.now() - start;
            const phase = (phases[name] ??= {
              calls: 0,
              totalMilliseconds: 0,
              maxMilliseconds: 0,
            });
            phase.calls++;
            phase.totalMilliseconds += elapsed;
            phase.maxMilliseconds = Math.max(phase.maxMilliseconds, elapsed);
          };
          const result = work(...args);
          if (result instanceof Promise) return result.finally(record);
          record();
          return result;
        }) as T;
      store.state = profileCall("state", store.state.bind(store));
      store.retrievalPassagePage = profileCall(
        "passagePolicyPage",
        store.retrievalPassagePage.bind(store),
      );
      store.pinnedPassages = profileCall(
        "pinnedPassages",
        store.pinnedPassages.bind(store),
      );
      store.searchCandidates = profileCall(
        "searchCandidates",
        store.searchCandidates.bind(store),
      );
      store.searchCandidatesBatchAsync = profileCall(
        "candidateSearchWorker",
        store.searchCandidatesBatchAsync.bind(store),
      );
      store.createPedigreeSnapshotAsync = profileCall(
        "snapshotWorker",
        store.createPedigreeSnapshotAsync.bind(store),
      );
      store.saveRun = profileCall("saveRun", store.saveRun.bind(store));
      const analysisStart = performance.now();
      let lastTick = performance.now(),
        maxEventLoopGap = 0,
        eventLoopTicks = 0;
      const heartbeat = setInterval(() => {
        const now = performance.now();
        maxEventLoopGap = Math.max(maxEventLoopGap, now - lastTick);
        lastTick = now;
        eventLoopTicks++;
      }, 5);
      const output = await service
        .analyze(project, "decision-brief", "")
        .finally(() => {
          maxEventLoopGap = Math.max(
            maxEventLoopGap,
            performance.now() - lastTick,
          );
          clearInterval(heartbeat);
        });
      metrics.offlineRetrievalAndSnapshot = {
        milliseconds: performance.now() - analysisStart,
        memory: process.memoryUsage(),
        citations: output.citations?.length,
        maxEventLoopGapMilliseconds: maxEventLoopGap,
        eventLoopTicks,
        phases,
      };
      expect(
        output.citations?.some((c) => c.passageId === "source-999-p99"),
      ).toBe(true);
      result.outcome =
        "functional assertions passed; raw timings require review against declared hardware budgets";
    } catch (error) {
      result.outcome = "failed";
      result.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      await service?.shutdown();
      store?.close();
      result.finishedAt = new Date().toISOString();
      result.peakResidentSetKilobytes = process.resourceUsage().maxRSS;
      mkdirSync(resolve("test-results"), { recursive: true });
      writeFileSync(artifact, JSON.stringify(result, null, 2));
      if (!profile) rmSync(root, { recursive: true, force: true });
    }
  },
  120_000,
);
