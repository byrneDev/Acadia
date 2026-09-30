// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  createBrief,
  createMethodRow,
  createMethodWorksheet,
  createOrigin,
  emptyPedigreeState,
  type ResearchBrief,
  type RootCauseRow,
} from "../src/shared/pedigree";
import {
  availableCauseParents,
  canApplyMethodProposal,
  removeMethodRow,
  replaceMethodRow,
} from "../src/renderer/components/MethodsWorkspace";
import { originSummary } from "../src/renderer/components/pedigree-state";
import {
  reconcileSavedDraft,
  usePedigreeDraft,
} from "../src/renderer/components/pedigree-ui";
import {
  flushDrafts,
  hydrateDrafts,
} from "../src/renderer/components/durableDrafts";
import type { ResearchState } from "../src/shared/research";
import type { MethodAssistanceProposal } from "../src/shared/pedigree-analysis";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const mountedForms = new Set<() => void>();
afterEach(() => {
  for (const unmount of mountedForms) unmount();
});

async function prepareDraftStore() {
  Object.assign(window, {
    acadia: {
      researchDrafts: async () => [],
      saveResearchDraft: async (input: { expectedRevision: number }) => ({
        ...input,
        revision: input.expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      }),
      deleteResearchDraft: async () => {},
    },
  });
  await hydrateDrafts("p");
}

function mountBriefDraft(key: string, initial: ResearchBrief) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  let draft!: ReturnType<typeof usePedigreeDraft<ResearchBrief>>;
  function Form() {
    draft = usePedigreeDraft(key, initial);
    return createElement("button", { disabled: draft.saving }, "Save");
  }
  const unmount = () => {
    act(() => root.unmount());
    container.remove();
    mountedForms.delete(unmount);
  };
  mountedForms.add(unmount);
  act(() => root.render(createElement(Form)));
  return {
    get draft() {
      return draft;
    },
    container,
    rerender(next: ResearchBrief) {
      initial = next;
      act(() => root.render(createElement(Form)));
    },
    unmount,
  };
}

describe("method workspace safety", () => {
  it("offers only acyclic parent choices and prevents deleting a cause used by children", () => {
    const top = {
      ...createMethodRow("root-cause"),
      id: "top",
      text: "Failure",
    } as RootCauseRow;
    const child = {
      ...createMethodRow("root-cause"),
      id: "child",
      parentId: "top",
    } as RootCauseRow;
    const grandchild = {
      ...createMethodRow("root-cause"),
      id: "grandchild",
      parentId: "child",
    } as RootCauseRow;
    const unrelated = {
      ...createMethodRow("root-cause"),
      id: "other",
    } as RootCauseRow;
    const rows = [top, child, grandchild, unrelated];
    expect(availableCauseParents(rows, "top").map((row) => row.id)).toEqual([
      "other",
    ]);
    expect(availableCauseParents(rows, "child").map((row) => row.id)).toEqual([
      "top",
      "other",
    ]);
    const method = {
      ...createMethodWorksheet("p", "root-cause"),
      kind: "root-cause" as const,
      rows,
    };
    expect(() => removeMethodRow(method, "top")).toThrow(/Reassign/);
    expect(
      removeMethodRow(method, "grandchild").rows.map((row) => row.id),
    ).toEqual(["top", "child", "other"]);
  });
  it("replaces only the intended row while retaining links and other assessments", () => {
    const first = {
      ...createMethodRow("risk"),
      text: "First",
      passageIds: ["p1"],
    };
    const second = {
      ...createMethodRow("risk"),
      text: "Second",
      taskIds: ["t1"],
    };
    const method = {
      ...createMethodWorksheet("p", "risk"),
      rows: [first, second],
    } as ReturnType<typeof createMethodWorksheet>;
    const result = replaceMethodRow(method, {
      ...first,
      nextTest: "Measure adverse outcome",
    });
    expect(result.rows[0].passageIds).toEqual(["p1"]);
    expect(result.rows[1]).toBe(second);
    expect(method.rows[0].nextTest).toBe("");
  });
  it("refuses stale or wrong-target AI proposals", () => {
    const current = { ...createMethodWorksheet("p", "swot"), revision: 3 };
    const proposal = {
      methodId: current.id,
      methodRevision: 3,
    } as MethodAssistanceProposal;
    const snapshot = JSON.stringify(current);
    expect(canApplyMethodProposal(current, proposal, snapshot)).toBe(true);
    expect(
      canApplyMethodProposal(
        { ...current, objective: "New private writing" },
        proposal,
        snapshot,
      ),
    ).toBe(false);
    expect(
      canApplyMethodProposal({ ...current, revision: 4 }, proposal, snapshot),
    ).toBe(false);
    expect(
      canApplyMethodProposal(
        current,
        { ...proposal, methodId: "another" },
        snapshot,
      ),
    ).toBe(false);
  });
});

describe("source origin display", () => {
  it("distinguishes linked families, exact duplicates and unresolved independence", () => {
    const pedigree = emptyPedigreeState();
    pedigree.origins = [
      { ...createOrigin("p", "a", "b"), status: "confirmed" },
      { ...createOrigin("p", "b", "c"), status: "proposed" },
      { ...createOrigin("p", "c", "d"), status: "rejected" },
    ];
    const research = {
      sources: ["a", "b", "c", "d", "e"].map((id) => ({
        id,
        currentVersionId: `${id}-v1`,
      })),
      versions: ["a", "b", "c", "d", "e"].map((id) => ({
        id: `${id}-v1`,
        hash: id === "e" ? "a" : id,
      })),
    } as ResearchState;
    expect(originSummary(research, pedigree)).toEqual({
      documents: 5,
      linkedFamilies: 1,
      duplicateFiles: 1,
      unknownIndependence: 2,
      proposed: 1,
    });
  });
});

describe("research form saves", () => {
  it("saves a new review issue draft without sending its composite routing key as a record ID", async () => {
    await prepareDraftStore();
    const writes = vi.fn(
      async (input: { expectedRevision: number; targetId?: string }) => {
        if (input.targetId?.includes(":")) throw new Error("Invalid record ID");
        return {
          ...input,
          revision: input.expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        };
      },
    );
    Object.assign(window.acadia!, { saveResearchDraft: writes });
    const initial = createBrief("p");
    const form = mountBriefDraft(`issue:p:finding:${initial.id}:new`, initial);
    act(() =>
      form.draft.edit({
        ...initial,
        scope: "Preserve this unaccepted review issue",
      }),
    );
    await act(async () => {
      await form.draft.flush();
    });
    expect(writes).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "review-issue", targetId: undefined }),
    );
    expect(form.draft.error).toBe("");
    await act(async () => {
      await form.draft.discard();
    });
  });
  it("retains and re-saves typing that arrives while the previous private draft is being cleared", async () => {
    const initial = { ...createBrief("p"), revision: 1 };
    await prepareDraftStore();
    let releaseDelete!: () => void;
    const deleting = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const remove = vi.fn().mockReturnValue(deleting);
    const writes = vi.fn(
      async (input: { expectedRevision: number; value: unknown }) => ({
        ...input,
        revision: input.expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      }),
    );
    Object.assign(window.acadia!, {
      deleteResearchDraft: remove,
      saveResearchDraft: writes,
    });
    const form = mountBriefDraft(`brief:p:${initial.id}`, initial);
    act(() => form.draft.edit({ ...initial, scope: "Submitted" }));
    let pending!: Promise<ResearchBrief>;
    await act(async () => {
      pending = form.draft.persist(async (value) => ({
        ...value,
        revision: 2,
      }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(remove).toHaveBeenCalledOnce();
    act(() =>
      form.draft.edit({ ...form.draft.value, scope: "Typing during clear" }),
    );
    let flushed = false;
    const closing = flushDrafts("p").then(() => {
      flushed = true;
    });
    expect(flushed).toBe(false);
    await act(async () => {
      releaseDelete();
      await pending;
      await closing;
    });
    expect(form.draft.value).toMatchObject({
      revision: 2,
      scope: "Typing during clear",
    });
    expect(form.draft.dirty).toBe(true);
    expect(writes.mock.calls.at(-1)?.[0]).toMatchObject({
      expectedRevision: 0,
      value: { buffer: { revision: 2, scope: "Typing during clear" } },
    });
    expect(flushed).toBe(true);
    form.rerender({ ...initial, revision: 2, scope: "Submitted" });
    await act(async () => {
      await flushDrafts("p");
    });
    expect(writes.mock.calls.at(-1)?.[0]).toMatchObject({
      value: {
        baseSignature: `${initial.id}:2`,
        buffer: { scope: "Typing during clear" },
      },
    });
    expect(form.draft.conflict).toBe(false);
  });
  it("delivers a pending save to the remounted form without losing newer typing or resubmitting a stale revision", async () => {
    const initial = { ...createBrief("p"), revision: 1 };
    const key = `brief:p:${initial.id}`;
    await prepareDraftStore();
    const first = mountBriefDraft(key, initial);
    act(() => first.draft.edit({ ...initial, scope: "Submitted scope" }));
    const submitted = first.draft.value;
    let resolveSave!: (value: ResearchBrief) => void;
    const response = new Promise<ResearchBrief>((resolve) => {
      resolveSave = resolve;
    });
    let pending!: Promise<ResearchBrief>;
    act(() => {
      pending = first.draft.persist(() => response);
    });
    act(() => first.draft.edit({ ...submitted, scope: "Newer unsaved scope" }));
    first.unmount();

    // The database can already have revision 2 while its IPC acknowledgement
    // is still pending in the now-unmounted first form.
    const saved = { ...submitted, revision: 2 };
    const reopened = mountBriefDraft(key, saved);
    expect(reopened.draft.value.scope).toBe("Newer unsaved scope");
    expect(reopened.container.querySelector("button")!.disabled).toBe(true);
    const duplicateSave = vi.fn();
    await expect(reopened.draft.persist(duplicateSave)).rejects.toThrow(
      /already saving/,
    );
    expect(duplicateSave).not.toHaveBeenCalled();
    await act(async () => {
      resolveSave(saved);
      await pending;
    });

    expect(reopened.draft.value).toMatchObject({
      revision: 2,
      scope: "Newer unsaved scope",
    });
    expect(reopened.draft.dirty).toBe(true);
    expect(reopened.container.querySelector("button")!.disabled).toBe(false);
    const saveNext = vi.fn(async (value: ResearchBrief) => ({
      ...value,
      revision: 3,
    }));
    await act(async () => {
      await reopened.draft.persist(saveNext);
    });
    expect(saveNext.mock.calls[0][0]).toMatchObject({
      revision: 2,
      scope: "Newer unsaved scope",
    });
    expect(reopened.draft.value.revision).toBe(3);
    expect(reopened.draft.dirty).toBe(false);
    reopened.unmount();

    const staleRefresh = mountBriefDraft(key, saved);
    expect(staleRefresh.draft.value.revision).toBe(3);
    expect(staleRefresh.draft.value.scope).toBe("Newer unsaved scope");
  });

  it("keeps a remounted draft editable and retryable after its pending save fails", async () => {
    const initial = { ...createBrief("p"), revision: 1 };
    const key = `brief:p:${initial.id}`;
    await prepareDraftStore();
    const first = mountBriefDraft(key, initial);
    act(() => first.draft.edit({ ...initial, scope: "Keep this scope" }));
    let rejectSave!: (error: Error) => void;
    const response = new Promise<ResearchBrief>((_, reject) => {
      rejectSave = reject;
    });
    let pending!: Promise<ResearchBrief>;
    act(() => {
      pending = first.draft.persist(() => response);
    });
    const failed = expect(pending).rejects.toThrow("Storage unavailable");
    first.unmount();
    const reopened = mountBriefDraft(key, initial);
    await act(async () => {
      rejectSave(new Error("Storage unavailable"));
      await failed;
    });
    expect(reopened.draft.value).toMatchObject({
      revision: 1,
      scope: "Keep this scope",
    });
    expect(reopened.draft.dirty).toBe(true);
    expect(reopened.draft.saving).toBe(false);
    await act(async () => {
      await reopened.draft.persist(async (value) => ({
        ...value,
        revision: 2,
      }));
    });
    expect(reopened.draft.value.revision).toBe(2);
  });

  it("keeps typing made during a pending save and advances only saved revision metadata", () => {
    const submitted = createBrief("p");
    const current = { ...submitted, scope: "Typing after Save was pressed" };
    const saved = {
      ...submitted,
      revision: 1,
      updatedAt: "2026-09-29T20:00:00.000Z",
    };
    const result = reconcileSavedDraft(current, submitted, saved);
    expect(result.value.scope).toBe(current.scope);
    expect(result.value.revision).toBe(1);
    expect(result.dirty).toBe(true);
  });
  it("clears a submitted draft and resets only when no newer typing exists", () => {
    const submitted = createBrief("p");
    const saved = { ...submitted, revision: 1 };
    const reset = createBrief("p");
    expect(reconcileSavedDraft(submitted, submitted, saved)).toEqual({
      value: saved,
      dirty: false,
    });
    expect(reconcileSavedDraft(submitted, submitted, saved, reset)).toEqual({
      value: reset,
      dirty: false,
    });
    const current = { ...submitted, scope: "Keep this" };
    expect(
      reconcileSavedDraft(current, submitted, saved, reset).value.scope,
    ).toBe("Keep this");
  });
});
