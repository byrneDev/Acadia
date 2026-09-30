// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { createBlankProject } from "../src/shared/project";
import {
  createDecision,
  createGap,
  emptyPedigreeState,
  type PedigreeState,
  type ResearchDecision,
  type ResearchGap,
} from "../src/shared/pedigree";
import type { ResearchState, ResearchDraftInput } from "../src/shared/research";
import {
  ResearchFlowWorkspace,
  type ResearchFlowRequest,
} from "../src/renderer/components/ResearchFlowWorkspace";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((work) => work());
  vi.restoreAllMocks();
});
const emptyResearch = (): ResearchState => ({
  sources: [],
  versions: [],
  claims: [],
  tasks: [],
  jobs: [],
  discoveries: [],
  runs: [],
});

async function mount(state: PedigreeState, request: ResearchFlowRequest) {
  const project = createBlankProject();
  project.id =
    state.gaps[0]?.projectId ||
    state.decisions[0]?.projectId ||
    crypto.randomUUID();
  const api = {
    researchDrafts: vi.fn(async () => []),
    saveResearchDraft: vi.fn(async (input: ResearchDraftInput) => ({
      ...input,
      revision: input.expectedRevision + 1,
      updatedAt: new Date().toISOString(),
    })),
    deleteResearchDraft: vi.fn(async () => {}),
    pedigreeState: vi.fn(async () => state),
    onResearchChanged: vi.fn(() => () => {}),
    getPassage: vi.fn(),
    saveGap: vi.fn(async (gap: ResearchGap) => ({
      ...gap,
      revision: gap.revision + 1,
    })),
    saveDecision: vi.fn(async (decision: ResearchDecision) => ({
      ...decision,
      revision: decision.revision + 1,
    })),
    saveTask: vi.fn(async () => {}),
    pedigreeRevisions: vi.fn(async () => []),
  };
  Object.assign(window, { acadia: api });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onError = vi.fn();
  const onAddToBoard = vi.fn();
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  await act(async () =>
    root.render(
      createElement(ResearchFlowWorkspace, {
        project,
        research: emptyResearch(),
        request,
        onError,
        onAddToBoard,
      }),
    ),
  );
  return { container, api, onError, onAddToBoard };
}

function button(container: HTMLElement, text: string) {
  const result = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  );
  if (!result) throw new Error(`Missing button: ${text}`);
  return result;
}

async function fill(container: HTMLElement, label: string, value: string) {
  const input = container.querySelector(
    `[aria-label="${label}"]`,
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("manual research-flow workspace", () => {
  it("shows an existing gap and places its saved record without changing status or creating a task", async () => {
    const gap = {
      ...createGap(crypto.randomUUID()),
      revision: 2,
      title: "Matched-load comparison",
      missingInformation: "Equivalent field loads have not been compared",
    };
    const state = { ...emptyPedigreeState(), gaps: [gap] };
    const view = await mount(state, { kind: "gap", id: gap.id, key: 1 });
    expect(view.container.textContent).toContain("Research gap");
    await act(async () => button(view.container, "Add to board").click());
    expect(view.api.saveGap).toHaveBeenCalledWith(gap);
    expect(view.onAddToBoard).toHaveBeenCalledWith({ kind: "gap", id: gap.id });
    expect(view.api.saveTask).not.toHaveBeenCalled();
    expect(
      (
        view.container.querySelector(
          '[aria-label="Gap status"]',
        ) as HTMLSelectElement
      ).value,
    ).toBe("open");
    expect(view.onError).not.toHaveBeenCalled();
  });

  it("saves an explicit decision status change without mutating other records or placing a card", async () => {
    const decision = {
      ...createDecision(crypto.randomUUID()),
      revision: 1,
      title: "Run a pilot",
      action: "Test under matched load",
    };
    const view = await mount(
      { ...emptyPedigreeState(), decisions: [decision] },
      { kind: "decision", id: decision.id, key: 2 },
    );
    const status = view.container.querySelector(
      '[aria-label="Decision status"]',
    ) as HTMLSelectElement;
    await act(async () => {
      status.value = "made";
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button(view.container, "Save decision").click());
    expect(view.api.saveDecision).toHaveBeenCalledWith({
      ...decision,
      status: "made",
    });
    expect(view.onAddToBoard).not.toHaveBeenCalled();
    expect(view.api.saveGap).not.toHaveBeenCalled();
    expect(view.onError).not.toHaveBeenCalled();
  });

  it("keeps unavailable records visible instead of manufacturing a new gap", async () => {
    const view = await mount(emptyPedigreeState(), {
      kind: "gap",
      id: "missing-gap",
      key: 3,
    });
    expect(view.container.textContent).toContain("This record is unavailable");
    expect(view.container.querySelector('[aria-label="Gap title"]')).toBeNull();
    expect(view.api.saveGap).not.toHaveBeenCalled();
  });

  it("creates a planned gap task without resolving the gap and explains recovery if linking fails", async () => {
    const gap = {
      ...createGap(crypto.randomUUID()),
      revision: 2,
      title: "Missing load comparison",
      missingInformation: "Equivalent loads were not compared",
      resolutionCriteria: "A matched-load field test",
    };
    const view = await mount(
      { ...emptyPedigreeState(), gaps: [gap] },
      { kind: "gap", id: gap.id, key: 4 },
    );
    view.api.saveGap
      .mockResolvedValueOnce({ ...gap, revision: 3 })
      .mockRejectedValueOnce(new Error("Connection interrupted"));
    await fill(view.container, "Follow-up task", "Run matched-load comparison");
    await act(async () =>
      button(view.container, "Save gap and create task").click(),
    );
    expect(view.api.saveTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Run matched-load comparison",
        question: gap.missingInformation,
        criterion: gap.resolutionCriteria,
        status: "planned",
      }),
    );
    expect(view.api.saveGap).toHaveBeenLastCalledWith(
      expect.objectContaining({
        revision: 3,
        status: "open",
        taskIds: [expect.any(String)],
      }),
    );
    expect(view.container.textContent).toContain(
      "was saved in Tasks, but linking it failed",
    );
    expect(view.onError).toHaveBeenCalledOnce();
    expect(view.onAddToBoard).not.toHaveBeenCalled();
  });
});
