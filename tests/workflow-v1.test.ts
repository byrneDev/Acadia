import { afterEach, describe, expect, it, vi } from "vitest";
import { keyboardBoardPositions } from "../src/renderer/components/boardKeyboard";
import {
  clearDraftBuffer,
  flushDrafts,
  hydrateDrafts,
  readDraftBuffer,
  writeDraftBuffer,
} from "../src/renderer/components/durableDrafts";
import type { ResearchDraft, ResearchDraftInput } from "../src/shared/research";
afterEach(() => vi.unstubAllGlobals());
describe("keyboard board placement", () => {
  it("moves only selected research cards on the grid, preserving grouped selection", () => {
    const nodes = [
      { id: "a", type: "research", selected: true, position: { x: 20, y: 30 } },
      {
        id: "b",
        type: "research",
        selected: true,
        position: { x: -40, y: 50 },
      },
      { id: "area", type: "area", selected: true, position: { x: 0, y: 0 } },
      { id: "c", type: "research", position: { x: 90, y: 90 } },
    ];
    expect(keyboardBoardPositions(nodes, "ArrowRight")).toEqual([
      { id: "a", x: 30, y: 30 },
      { id: "b", x: -30, y: 50 },
    ]);
    expect(keyboardBoardPositions(nodes, "ArrowUp", true)).toEqual([
      { id: "a", x: 20, y: -10 },
      { id: "b", x: -40, y: 10 },
    ]);
    expect(keyboardBoardPositions(nodes, "Delete")).toEqual([]);
    expect(nodes[0].position).toEqual({ x: 20, y: 30 });
  });
});
describe("private draft persistence", () => {
  it("recovers a stored editing buffer without converting it to accepted research", async () => {
    const projectId = "recovery-project";
    vi.stubGlobal("window", {
      acadia: {
        researchDrafts: vi.fn().mockResolvedValue([
          {
            projectId,
            key: "claim:existing",
            kind: "claim",
            revision: 4,
            updatedAt: new Date().toISOString(),
            value: {
              buffer: { title: "Unapplied wording" },
              baseSignature: "old",
            },
          },
        ]),
      },
    });
    await hydrateDrafts(projectId);
    expect(readDraftBuffer(projectId, "claim:existing")).toEqual({
      title: "Unapplied wording",
    });
    expect(readDraftBuffer("other-project", "claim:existing")).toBeUndefined();
  });
  it("serializes rapid edits with optimistic revisions and scopes every write", async () => {
    const projectId = "serial-project",
      rows: ResearchDraftInput[] = [];
    const save = vi.fn(
      async (input: ResearchDraftInput): Promise<ResearchDraft> => {
        rows.push(input);
        await Promise.resolve();
        return {
          ...input,
          revision: input.expectedRevision + 1,
          updatedAt: new Date().toISOString(),
        };
      },
    );
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("window", {
      acadia: {
        researchDrafts: vi.fn().mockResolvedValue([]),
        saveResearchDraft: save,
        deleteResearchDraft: remove,
      },
    });
    await hydrateDrafts(projectId);
    writeDraftBuffer(projectId, "task:new", "task", {
      title: "first",
      claimId: undefined,
    });
    const pending = flushDrafts(projectId);
    await Promise.resolve();
    writeDraftBuffer(projectId, "task:new", "task", { title: "latest" });
    await pending;
    expect(
      Object.hasOwn((rows[0].value as { buffer: object }).buffer, "claimId"),
    ).toBe(false);
    expect(rows.map((row) => [row.projectId, row.expectedRevision])).toEqual([
      [projectId, 0],
      [projectId, 1],
    ]);
    expect(readDraftBuffer(projectId, "task:new")).toEqual({ title: "latest" });
    await clearDraftBuffer(projectId, "task:new");
    expect(remove).toHaveBeenCalledWith(projectId, "task:new", 2);
    expect(readDraftBuffer(projectId, "task:new")).toBeUndefined();
  });
  it("keeps failed-save content recoverable in the editor and rejects a close flush", async () => {
    const projectId = "failed-draft-project";
    const save = vi
      .fn()
      .mockRejectedValue(new Error("simulated disk unavailable"));
    vi.stubGlobal("window", {
      acadia: {
        researchDrafts: vi.fn().mockResolvedValue([]),
        saveResearchDraft: save,
        deleteResearchDraft: vi.fn(),
      },
    });
    await hydrateDrafts(projectId);
    writeDraftBuffer(projectId, "task:new", "task", {
      title: "Keep this unfinished task",
    });
    await expect(flushDrafts(projectId)).rejects.toThrow(
      "private research draft",
    );
    expect(readDraftBuffer(projectId, "task:new")).toEqual({
      title: "Keep this unfinished task",
    });
    save.mockImplementation(async (input: ResearchDraftInput) => ({
      ...input,
      revision: 1,
      updatedAt: new Date().toISOString(),
    }));
    await flushDrafts(projectId);
    await clearDraftBuffer(projectId, "task:new");
  });
});
