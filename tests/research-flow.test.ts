import { describe, expect, it } from "vitest";
import {
  createDecision,
  createGap,
  emptyPedigreeState,
  validatePedigreeEntity,
  validatePedigreeState,
} from "../src/shared/pedigree";

describe("research gaps and decisions", () => {
  it("starts with unresolved gaps and proposed decisions without manufactured evidence", () => {
    const gap = createGap("investigation");
    const decision = createDecision("investigation");
    expect(gap.status).toBe("open");
    expect(decision.status).toBe("proposed");
    expect(gap.revision).toBe(0);
    expect(gap.passageIds).toEqual([]);
    expect(decision.claimIds).toEqual([]);
    expect(validatePedigreeEntity("gap", gap, "investigation")).toEqual(gap);
    expect(
      validatePedigreeEntity("decision", decision, "investigation"),
    ).toEqual(decision);
  });

  it("retains explicit evidence, task, assumption and deliverable links", () => {
    const state = emptyPedigreeState();
    state.gaps.push({
      ...createGap("investigation"),
      title: "Missing load comparison",
      missingInformation: "No matched-load comparison",
      importance: "Separate a treatment effect from load changes",
      resolutionCriteria: "Compare machines under equivalent load",
      claimIds: ["claim"],
      taskIds: ["task"],
      passageIds: ["passage"],
      status: "investigating",
    });
    state.decisions.push({
      ...createDecision("investigation"),
      title: "Pilot before rollout",
      action: "Build a comparison pilot",
      rationale: "The current result does not establish causation",
      alternatives: "Immediate rollout; wait for another study",
      claimIds: ["claim"],
      assumptionIds: ["assumption"],
      outputIds: ["plan"],
    });
    expect(
      validatePedigreeState(JSON.parse(JSON.stringify(state)), "investigation"),
    ).toEqual(state);
  });

  it("imports historical pedigree states without inventing gap or decision records", () => {
    const {
      gaps: _gaps,
      decisions: _decisions,
      ...historical
    } = emptyPedigreeState();
    expect(validatePedigreeState(historical, "investigation")).toEqual(
      emptyPedigreeState(),
    );
    expect(historical).not.toHaveProperty("gaps");
    expect(() =>
      validatePedigreeState({ ...historical, gaps: null }, "investigation"),
    ).toThrow();
  });

  it("rejects cross-project records, unknown statuses, duplicate references and duplicate identities", () => {
    const gap = createGap("investigation");
    const decision = createDecision("investigation");
    expect(() => validatePedigreeEntity("gap", gap, "other")).toThrow(
      /another project/,
    );
    expect(() =>
      validatePedigreeEntity("decision", {
        ...decision,
        status: "approved-by-ai",
      }),
    ).toThrow();
    expect(() =>
      validatePedigreeEntity("gap", { ...gap, taskIds: ["task", "task"] }),
    ).toThrow(/Duplicate/);
    expect(() =>
      validatePedigreeState(
        {
          ...emptyPedigreeState(),
          gaps: [gap],
          decisions: [{ ...decision, id: gap.id }],
        },
        "investigation",
      ),
    ).toThrow(/unique across/);
  });
});
