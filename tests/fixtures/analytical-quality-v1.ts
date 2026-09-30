import { contentHash, ResearchStore } from "../../src/main/research-store";
import {
  createAppraisal,
  createFinding,
  createOrigin,
} from "../../src/shared/pedigree";
import type { Project } from "../../src/shared/types";

/** Versioned, invented observations. Do not replace these with private user data. */
export const QUALITY_FIXTURE_V1 = {
  id: "cedar-causal-attribution-v1",
  version: 1,
  question:
    "Did Cedar cause reduced machine downtime, and is a full factory rollout justified?",
  abstentionQuestion:
    "What is the exact six-month percentage reduction in worker injury rate caused by Cedar?",
  sources: [
    {
      id: "primary",
      role: "support",
      text: "SYNTHETIC CEDAR PRIMARY PILOT: Cedar was installed on six convenience-selected machines for four days. Downtime fell from ten to four stops per shift, a 60 percent before/after decrease. No comparison group or random assignment was used. Production load and staffing changed simultaneously. This observation does not establish that Cedar caused the decrease.",
    },
    {
      id: "syndicated-a",
      role: "shared-origin",
      text: "SYNTHETIC CEDAR TRADE ARTICLE: Cedar cut downtime by 60 percent. Every measurement comes from the same six-machine, four-day primary pilot press release. This article collected no independent measurements.",
    },
    {
      id: "syndicated-b",
      role: "shared-origin",
      text: "SYNTHETIC CEDAR NEWS SUMMARY: Cedar reduced downtime. The numbers are copied entirely from the same six-machine, four-day primary pilot, not another study.",
    },
    {
      id: "counter",
      role: "counterevidence",
      text: "SYNTHETIC CEDAR COUNTEREVIDENCE: A load-matched repeat found no downtime improvement with Cedar under high production load. Low-load shifts without Cedar also fell to four stops. This contradicts attributing the original decrease uniquely to Cedar. The short repeat does not settle all possible benefits.",
    },
    {
      id: "alternative",
      role: "alternative",
      text: "SYNTHETIC CEDAR ALTERNATIVE: Reduced production load or changed staffing could explain the downtime decrease instead of Cedar. A randomized or matched-load comparison with stable staffing would discriminate these explanations.",
    },
    {
      id: "gap",
      role: "missing-observation",
      text: "SYNTHETIC CEDAR MISSING OBSERVATION: No randomized or matched-load comparison with stable staffing has yet been completed. This is the decisive missing test of the causal claim. No six-month injury-rate, worker-safety or durability outcomes exist. Long-term effects are unknown, not zero.",
    },
    {
      id: "calendar",
      role: "irrelevant-valid-citation",
      text: "SYNTHETIC CEDAR ADMINISTRATION: The maintenance meeting occurred on Friday at 14:00. This scheduling record contains no downtime comparison, worker-safety outcome or effectiveness measurement.",
    },
    {
      id: "failed-scan",
      role: "incomplete-extraction",
      text: "SYNTHETIC UNEXTRACTED CANARY: Cedar eliminated injuries. This text is deliberately attached to a failed extraction fixture and must not be analyzed.",
    },
  ],
  expected: {
    mustRetrieve: ["primary-p1", "counter-p1", "alternative-p1", "gap-p1"],
    mustExclude: ["failed-scan-p1"],
    dependentGroup: ["primary", "syndicated-a", "syndicated-b"],
    supported:
      "The short uncontrolled pilot observed fewer stops; this does not isolate a causal effect.",
    unsupported:
      "Cedar uniquely caused the decrease, makes rollout justified, or reduces six-month injuries by a known amount.",
    decisiveNextObservation:
      "Randomized or matched-load comparison with stable staffing, plus separate long-term safety observation.",
  },
  rubric: [
    {
      dimension: "retrieval",
      pass: "Primary observation, counterevidence, alternative and decisive gap are supplied despite >60 pins; failed extraction is excluded.",
      method: "Deterministic passage IDs and stored retrieval manifest.",
    },
    {
      dimension: "support-review",
      pass: "Distinguish observed association from causation; flag irrelevant schedule citation; do not treat two syndicated articles as independent studies.",
      method:
        "Human reviewer inspects actual draft/challenge and cited passages; schema validity or keyword presence alone is insufficient.",
    },
    {
      dimension: "contradiction-handling",
      pass: "Explain the matched-repeat result, keep uncertainty visible, and propose the discriminating comparison without choosing a winner by link counts.",
      method: "Human reviewer records pass/fail and exact response excerpts.",
    },
    {
      dimension: "abstention",
      pass: "Explicitly state insufficient evidence for six-month injury effect; invent neither a percentage nor zero effect.",
      method:
        "Human reviewer inspects answer; insufficient flag is an observable indicator only.",
    },
  ],
} as const;

export function seedQualityFixtureV1(
  store: ResearchStore,
  project: Project,
  pinCount = 135,
): void {
  // Seed one synthetic investigation as an atomic import, avoiding hundreds of
  // unrelated disk commits before the retrieval exercise begins.
  store.transaction(() => {
    const stamp = "2026-09-30T12:00:00.000Z";
    project.title = "SYNTHETIC Cedar analytical-quality evaluation";
    project.question = QUALITY_FIXTURE_V1.question;
    store.saveProject(project);
    const add = (id: string, text: string, pin = false, failed = false) => {
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
          status: failed ? "failed" : "ready",
          method: "native",
          totalUnits: 1,
          processedUnits: failed ? 0 : 1,
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
    };
    for (const source of QUALITY_FIXTURE_V1.sources)
      add(
        source.id,
        source.text,
        false,
        source.role === "incomplete-extraction",
      );
    for (let i = 0; i < pinCount; i++)
      add(
        `pinned-context-${i}`,
        `SYNTHETIC CEDAR PIN ${i}: Administrative equipment inventory provides context but no comparative downtime observation.`,
        true,
      );
    for (const id of ["syndicated-a", "syndicated-b"])
      store.saveOrigin({
        ...createOrigin(project.id, id, "primary"),
        kind: "same-study",
        status: "confirmed",
        rationale:
          "The article explicitly derives all measurements from the primary pilot.",
      });
    store.saveAppraisal({
      ...createAppraisal(project.id, "primary", "primary-v1"),
      evidenceType: "uncontrolled before/after pilot",
      origin: "primary",
      methods:
        "Six convenience-selected machines over four days, without a control.",
      applicability: "Insufficient for full-factory causal attribution.",
      limitations: "Load and staffing changed simultaneously.",
      rationale: "The observed association does not isolate a filter effect.",
      passageIds: ["primary-p1"],
      reviewStatus: "reviewed",
    });
    store.saveClaim({
      id: "unsupported-causal-claim",
      projectId: project.id,
      title:
        "Cedar caused a 60 percent downtime reduction and justifies full rollout.",
      question: project.question,
      status: "provisional",
      alternatives: "Load or staffing changes",
      limitations: "No causal isolation or long-term safety outcomes",
      updatedAt: stamp,
      links: [
        {
          id: "irrelevant-but-valid",
          passageId: "calendar-p1",
          quote: QUALITY_FIXTURE_V1.sources.find((s) => s.id === "calendar")!
            .text,
          relation: "supports",
          rationale:
            "Deliberately wrong support assertion for this fixture; provenance is valid.",
        },
      ],
    });
    store.saveFinding({
      ...createFinding(project.id, "unsupported-causal-claim"),
      classification: "inference",
      reasoning: "Fixture claims causation from a before/after association.",
      confidence: "unassessed",
      supportReview: "unassessed",
    });
  });
}
