// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  DraftStatus,
  type DraftStatusValue,
} from "../src/renderer/components/DraftStatus";
import { OriginalPageComparison } from "../src/renderer/components/OriginalPageComparison";
import { AnalysisHistory } from "../src/renderer/components/AnalysisHistory";
import { DraftRecoveryNotice } from "../src/renderer/components/WorkspaceRecovery";
import {
  hydrateDrafts,
  writeDraftBuffer,
  flushDrafts,
  clearDraftBuffer,
} from "../src/renderer/components/durableDrafts";
import type { ResearchDraftInput } from "../src/shared/research";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const dispose: (() => void)[] = [];
afterEach(() => {
  dispose.splice(0).forEach((fn) => fn());
  vi.restoreAllMocks();
});
function mount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  dispose.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  return { container, root };
}

describe("workflow recovery and accessible feedback", () => {
  it("announces failed private saves instead of simultaneously claiming the draft is saved", async () => {
    const { container, root } = mount();
    const draft: DraftStatusValue = {
      dirty: true,
      saving: false,
      pending: true,
      recovered: true,
      conflict: false,
      error: "Storage unavailable",
      flush: vi.fn(async () => {}),
      discard: vi.fn(async () => {}),
    };
    await act(async () => root.render(createElement(DraftStatus, { draft })));
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "save failed",
    );
    expect(
      container.querySelector('[role="status"]')?.textContent,
    ).not.toContain("saved locally");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Retry draft save",
    )!;
    await act(async () => retry.click());
    expect(draft.flush).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(
        createElement(DraftStatus, {
          draft: { ...draft, error: "", pending: false, recovered: false },
        }),
      ),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "saved locally",
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows unopened recovered drafts and does not double-count them when their buffer is edited", async () => {
    const projectId = crypto.randomUUID();
    Object.assign(window, {
      acadia: {
        researchDrafts: async () => [
          {
            key: "source-evidence:old",
            projectId,
            kind: "source-evidence",
            revision: 1,
            updatedAt: new Date().toISOString(),
            value: {
              buffer: { text: "Private old passage" },
              baseSignature: "source-evidence:old",
            },
          },
        ],
        saveResearchDraft: async (input: ResearchDraftInput) => ({
          ...input,
          revision: input.expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        }),
        deleteResearchDraft: async () => {},
      },
    });
    const { container, root } = mount();
    await act(async () =>
      root.render(createElement(DraftRecoveryNotice, { projectId })),
    );
    await act(async () => {
      await hydrateDrafts(projectId);
    });
    expect(container.textContent).toContain(
      "1 private editing draft saved locally",
    );
    expect(container.textContent).toContain(
      "source evidence · recovered draft",
    );
    await act(async () => {
      await clearDraftBuffer(projectId, "source-evidence:old");
    });
    expect(container.textContent).toBe("");
    await act(async () => {
      await hydrateDrafts(projectId, true);
    });
    expect(container.textContent).toContain(
      "1 private editing draft saved locally",
    );
    await act(async () => {
      writeDraftBuffer(projectId, "source-evidence:old", "source-evidence", {
        text: "Continuing recovered work",
      });
      await flushDrafts(projectId);
    });
    expect(container.querySelectorAll("li")).toHaveLength(1);
    await act(async () => {
      await clearDraftBuffer(projectId, "source-evidence:old");
    });
    expect(container.textContent).toBe("");
  });

  it("retains the PDF navigation button and keyboard focus while the next original page renders", async () => {
    const originalShow = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "showModal",
    );
    const originalClose = Object.getOwnPropertyDescriptor(
      HTMLDialogElement.prototype,
      "close",
    );
    Object.defineProperties(HTMLDialogElement.prototype, {
      showModal: {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.open = true;
        },
      },
      close: {
        configurable: true,
        value: function (this: HTMLDialogElement) {
          this.open = false;
        },
      },
    });
    let finish!: (value: {
      dataUrl: string;
      page: number;
      totalPages: number;
    }) => void;
    const second = new Promise<{
      dataUrl: string;
      page: number;
      totalPages: number;
    }>((resolve) => {
      finish = resolve;
    });
    Object.assign(window, {
      acadia: {
        getSourcePagePreview: vi
          .fn()
          .mockResolvedValueOnce({
            dataUrl: "data:image/png;base64,AA==",
            page: 1,
            totalPages: 3,
          })
          .mockReturnValueOnce(second),
      },
    });
    const { container, root } = mount();
    dispose.push(() => {
      for (const [key, descriptor] of [
        ["showModal", originalShow],
        ["close", originalClose],
      ] as const) {
        if (descriptor)
          Object.defineProperty(HTMLDialogElement.prototype, key, descriptor);
        else Reflect.deleteProperty(HTMLDialogElement.prototype, key);
      }
    });
    await act(async () =>
      root.render(
        createElement(OriginalPageComparison, {
          passage: {
            id: "passage",
            sourceId: "source",
            versionId: "version",
            page: 1,
            text: "Selected evidence",
            locator: "Page 1",
            method: "native",
            inclusion: "include",
          },
          sourceTitle: "Saved PDF",
          onClose: () => {},
        }),
      ),
    );
    const next = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Next page",
    )!;
    next.focus();
    await act(async () => next.click());
    expect(next.isConnected).toBe(true);
    expect(document.activeElement).toBe(next);
    expect(container.textContent).toContain(
      "Rendering the saved original page",
    );
    await act(async () => {
      finish({ dataUrl: "data:image/png;base64,AA==", page: 2, totalPages: 3 });
      await second;
    });
    expect(document.activeElement).toBe(next);
    expect(container.textContent).toContain("selected passage remains Page 1");
  });

  it("clears the history failure alert after the instructed close-and-reopen retry succeeds", async () => {
    Object.assign(window, {
      acadia: {
        listAnalysisRunsPage: vi
          .fn()
          .mockRejectedValueOnce(new Error("Unavailable"))
          .mockResolvedValueOnce({ items: [], total: 0, offset: 0, limit: 20 }),
      },
    });
    const { container, root } = mount();
    await act(async () =>
      root.render(
        createElement(AnalysisHistory, { projectId: crypto.randomUUID() }),
      ),
    );
    const details = container.querySelector("details")!;
    const toggle = async (open: boolean) => {
      await act(async () => {
        details.open = open;
        details.dispatchEvent(new Event("toggle"));
      });
    };
    await toggle(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "could not be read",
    );
    await toggle(false);
    await toggle(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
