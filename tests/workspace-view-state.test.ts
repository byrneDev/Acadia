import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PASSAGES_PER_PAGE,
  clampPassagePage,
  passagePage,
  parseBoardViewport,
  readBoardViewport,
  saveBoardViewport,
  readEvidenceDraft,
  saveEvidenceDraft,
  readResearchTextDraft,
  saveResearchTextDraft,
  type EvidenceDraft,
} from "../src/renderer/components/workspaceViewState";

afterEach(() => vi.unstubAllGlobals());

describe("local board viewport preferences", () => {
  it("keeps projects isolated and persists only viewport numbers", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    saveBoardViewport("first", { x: -370, y: 82, zoom: 0.42 });
    saveBoardViewport("second", { x: 0, y: -15, zoom: 2.1 });
    expect(readBoardViewport("first")).toEqual({ x: -370, y: 82, zoom: 0.42 });
    expect(readBoardViewport("second")).toEqual({ x: 0, y: -15, zoom: 2.1 });
    expect(readBoardViewport("missing")).toBeUndefined();
    expect(
      [...values.values()].every(
        (value) => Object.keys(JSON.parse(value)).join(",") === "x,y,zoom",
      ),
    ).toBe(true);
  });
  it.each([
    null,
    "invalid json",
    "null",
    "{}",
    '{"x":0,"y":0,"zoom":0}',
    '{"x":0,"y":0,"zoom":9}',
    '{"x":"0","y":0,"zoom":1}',
    '{"x":1e400,"y":0,"zoom":1}',
  ])("rejects damaged or unsafe preferences: %s", (value) => {
    expect(parseBoardViewport(value)).toBeUndefined();
  });
  it("does not prevent research when browser storage is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("quota");
      },
    });
    expect(readBoardViewport("project")).toBeUndefined();
    expect(() =>
      saveBoardViewport("project", { x: 0, y: 0, zoom: 1 }),
    ).not.toThrow();
  });
});

describe("bounded source navigation", () => {
  const passages = Array.from({ length: 10013 }, (_, index) => ({
    id: `passage-${index}`,
  }));
  it("opens a late exact passage without rendering the entire source", () => {
    const index = 10001;
    const page = passagePage(passages, `passage-${index}`);
    const visible = passages.slice(
      page * PASSAGES_PER_PAGE,
      (page + 1) * PASSAGES_PER_PAGE,
    );
    expect(visible.length).toBeLessThanOrEqual(40);
    expect(visible).toContainEqual({ id: `passage-${index}` });
    expect(passagePage(passages, "missing")).toBe(0);
  });
  it("keeps navigation within valid bounds when the document changes", () => {
    expect(clampPassagePage(2000, passages.length)).toBe(250);
    expect(clampPassagePage(-9, passages.length)).toBe(0);
    expect(clampPassagePage(12, 0)).toBe(0);
    expect(clampPassagePage(12, 40)).toBe(0);
    expect(clampPassagePage(12, 41)).toBe(1);
  });
});

describe("unfinished evidence forms", () => {
  it("restores an exact version without leaking across source or project contexts", () => {
    const draft: EvidenceDraft = {
      passage: {
        id: "passage",
        sourceId: "source",
        versionId: "original-version",
        text: "Measured evidence",
        locator: "Page 900",
        method: "native",
        inclusion: "include",
      },
      quote: "Measured evidence",
      claimId: "",
      title: "Working claim",
      relation: "contradicts",
      rationale: "This challenges the working explanation.",
    };
    saveEvidenceDraft("project", "source", "original-version", draft);
    expect(readEvidenceDraft("project", "source", "original-version")).toEqual(
      draft,
    );
    expect(
      readEvidenceDraft("other", "source", "original-version"),
    ).toBeUndefined();
    expect(
      readEvidenceDraft("project", "source", "updated-version"),
    ).toBeUndefined();
    expect(
      readEvidenceDraft("project", "other-source", "original-version"),
    ).toBeUndefined();
    saveEvidenceDraft("project", "source", "original-version");
    expect(
      readEvidenceDraft("project", "source", "original-version"),
    ).toBeUndefined();
  });
});

describe("unsent research text", () => {
  it("isolates project drafts and stores no credentials, responses or approvals", () => {
    const input = {
      query: "source phrase",
      url: "https://example.invalid/draft",
      question: "Unsent question",
      queries: "Edited query",
      apiKey: "secret",
      approved: true,
      response: "generated output",
    };
    saveResearchTextDraft("draft-project", input);
    expect(readResearchTextDraft("draft-project")).toEqual({
      query: input.query,
      url: input.url,
      question: input.question,
      queries: input.queries,
    });
    expect(readResearchTextDraft("another-project")).toBeUndefined();
  });
});
