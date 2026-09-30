import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const {
  releasePolicy,
  debianVersion,
  validateAcceptance,
  acceptanceChecks,
} = require("../.github/scripts/release-policy.cjs");
const commit = "a".repeat(40);
function acceptance() {
  return {
    schemaVersion: 1,
    version: "1.0.0",
    sourceCommit: commit,
    reviewedBy: "Fictional reviewer",
    reviewedAt: "2026-09-30T10:00:00Z",
    checks: Object.fromEntries(
      acceptanceChecks.map((key: string) => [
        key,
        {
          status: "passed",
          environment: "Synthetic test environment",
          evidence: `Synthetic evidence record for ${key}`,
        },
      ]),
    ),
    blockers: {
      dataLoss: 0,
      privacy: 0,
      citationIntegrity: 0,
      coreWorkflow: 0,
      reviewedBy: "Synthetic blocker reviewer",
      evidence: "Synthetic blocker review only",
    },
    scale: {
      status: "passed",
      evidence: "Synthetic scale evidence only",
      referenceMachine: {
        os: "Synthetic OS",
        cpu: "Synthetic CPU",
        memory: "Synthetic memory",
        storage: "Synthetic storage",
        memoryGiB: 16,
        ssd: true,
      },
      targets: {
        sources: 1000,
        passages: 100000,
        boardCards: 500,
        searchP95Ms: 1000,
        projectOpenP95Ms: 2000,
      },
      observed: {
        sources: 1000,
        passages: 100000,
        boardCards: 500,
        searchP95Ms: 500,
        projectOpenP95Ms: 1500,
        interactionP95Ms: 50,
        peakMemoryMiB: 600,
      },
    },
    advertisedModels: ["fictional:model"],
    modelEvaluations: [
      {
        model: "fictional:model",
        provider: "synthetic",
        fixture: "synthetic fixture",
        runs: 3,
        status: "passed",
        evidence: "Synthetic model evaluation only",
        reviewedBy: "Synthetic model reviewer",
        reviewedAt: "2026-09-30T10:00:00Z",
        dimensions: Object.fromEntries(
          [
            "retrieval",
            "supportReview",
            "contradictionHandling",
            "abstention",
          ].map((key) => [
            key,
            { status: "passed", evidence: `Synthetic ${key} evidence only` },
          ]),
        ),
      },
    ],
    testers: Array.from({ length: 5 }, (_, i) => ({
      id: `synthetic-${i}`,
      status: "passed",
      platform: "synthetic fixture",
      evidence: `Synthetic acceptance evidence ${i}`,
      workflows: {
        software: {
          status: "passed",
          evidence: `Synthetic software scenario ${i}`,
        },
        curriculum: {
          status: "passed",
          evidence: `Synthetic curriculum scenario ${i}`,
        },
      },
    })),
  };
}
describe("production release gates", () => {
  it("matches locked Electron Builder Debian control versions while retaining app/asset prerelease names", () => {
    const {
      LinuxTargetHelper,
    } = require("app-builder-lib/out/targets/LinuxTargetHelper.js");
    for (const version of [
      "0.5.0",
      "1.0.0-rc.1",
      "1.0.0-beta-test.2",
      "1.0.0",
    ]) {
      const actual = LinuxTargetHelper.prototype.getSanitizedVersion.call(
        { packager: { appInfo: { version } } },
        "deb",
      );
      expect(debianVersion(version)).toBe(actual);
    }
    expect(debianVersion("1.0.0-rc.1")).toBe("1.0.0~rc.1");
    expect(releasePolicy("1.0.0-rc.1").prerelease).toBe(true);
  });
  it("makes every stable major1+ release require signing while RC remains explicitly prerelease", () => {
    expect(releasePolicy("0.5.0")).toEqual({
      prerelease: false,
      production: false,
      signingRequired: false,
    });
    expect(releasePolicy("1.0.0-rc.1")).toEqual({
      prerelease: true,
      production: false,
      signingRequired: false,
    });
    expect(releasePolicy("1.0.0-rc.1", true).signingRequired).toBe(true);
    expect(releasePolicy("1.0.0")).toEqual({
      prerelease: false,
      production: true,
      signingRequired: true,
    });
    expect(releasePolicy("2.1.0", false).signingRequired).toBe(true);
  });
  it("requires both human workflows, bounded scale results, model-specific review and zero blockers", () => {
    const a = acceptance();
    a.testers[0].workflows.curriculum.status = "pending";
    expect(() => validateAcceptance(a, "1.0.0", commit)).toThrow(/curriculum/);
    const b = acceptance();
    b.blockers.citationIntegrity = 1;
    expect(() => validateAcceptance(b, "1.0.0", commit)).toThrow(/blockers/);
    const c = acceptance();
    c.scale.observed.searchP95Ms = 1001;
    expect(() => validateAcceptance(c, "1.0.0", commit)).toThrow(/searchP95Ms/);
    const d = acceptance();
    d.scale.observed.passages = 99;
    expect(() => validateAcceptance(d, "1.0.0", commit)).toThrow(/passages/);
    const e = acceptance();
    e.scale.referenceMachine.cpu = "";
    expect(() => validateAcceptance(e, "1.0.0", commit)).toThrow(
      /reference machine/,
    );
    const f = acceptance();
    f.advertisedModels.push("untested:model");
    expect(() => validateAcceptance(f, "1.0.0", commit)).toThrow(
      /untested:model/,
    );
    const g = acceptance();
    g.modelEvaluations[0].dimensions.abstention.status = "pending";
    expect(() => validateAcceptance(g, "1.0.0", commit)).toThrow(/abstention/);
    const h = acceptance();
    h.modelEvaluations[0].runs = 1;
    expect(() => validateAcceptance(h, "1.0.0", commit)).toThrow(/repeated/);
    const relaxed = acceptance();
    relaxed.scale.targets.searchP95Ms = 2000;
    expect(() => validateAcceptance(relaxed, "1.0.0", commit)).toThrow(
      /ceilings/,
    );
    const tiny = acceptance();
    tiny.scale.targets.sources = 1;
    expect(() => validateAcceptance(tiny, "1.0.0", commit)).toThrow(
      /population/,
    );
    const larger = acceptance();
    larger.scale.referenceMachine.memoryGiB = 64;
    expect(() => validateAcceptance(larger, "1.0.0", commit)).toThrow(
      /reference machine/,
    );
    const memory = acceptance();
    memory.scale.observed.peakMemoryMiB = NaN;
    expect(() => validateAcceptance(memory, "1.0.0", commit)).toThrow(
      /peakMemory/,
    );
  });
  it("rejects absent, mismatched, incomplete and unreviewed external acceptance", () => {
    expect(() => validateAcceptance(undefined, "1.0.0", commit)).toThrow();
    const value = acceptance();
    expect(() => validateAcceptance(value, "1.0.0", commit)).not.toThrow();
    expect(() => validateAcceptance(value, "1.0.1", commit)).toThrow(/exact/);
    expect(() => validateAcceptance(value, "1.0.0", "b".repeat(40))).toThrow(
      /exact/,
    );
    for (const key of acceptanceChecks) {
      const missing = acceptance();
      delete missing.checks[key];
      expect(() => validateAcceptance(missing, "1.0.0", commit)).toThrow(key);
    }
    expect(() =>
      validateAcceptance(
        { ...value, testers: value.testers.slice(0, 4) },
        "1.0.0",
        commit,
      ),
    ).toThrow(/five/);
    expect(() =>
      validateAcceptance(
        { ...value, testers: Array(5).fill(value.testers[0]) },
        "1.0.0",
        commit,
      ),
    ).toThrow(/distinct/);
    expect(() =>
      validateAcceptance({ ...value, reviewedBy: "" }, "1.0.0", commit),
    ).toThrow(/reviewer/);
  });
});
