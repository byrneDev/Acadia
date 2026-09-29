import { describe, expect, it } from "vitest";
import {
  defaultReportWorkspace,
  readReportWorkspace,
  writeReportWorkspace,
} from "../src/renderer/components/report-workspace-state";

function storage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => entries.set(key, value),
  };
}

describe("per-project report navigation", () => {
  it("restores draft instructions, saved revision selection, panels, and reading position independently for each investigation", () => {
    const local = storage();
    const remembered = {
      ...defaultReportWorkspace(false),
      selectedId: "report-1",
      revisionId: "revision-3",
      instructions: "Compare the pilot with the control group.",
      inspectorOpen: true,
      scrollPositions: { "report-1:revision-3": 764 },
    };
    writeReportWorkspace("pilot", remembered, local);
    writeReportWorkspace("unrelated", defaultReportWorkspace(true), local);
    expect(readReportWorkspace("pilot", false, local)).toEqual(remembered);
    expect(readReportWorkspace("unrelated", true, local)).toEqual(
      defaultReportWorkspace(true),
    );
  });
  it("makes creating the first report available even when a stale view preference says closed", () => {
    const local = storage();
    writeReportWorkspace("empty", defaultReportWorkspace(false), local);
    expect(readReportWorkspace("empty", true, local).composerOpen).toBe(true);
  });
  it("discards invalid values and unbounded saved text without failing project startup", () => {
    const local = {
      getItem: () =>
        JSON.stringify({
          kind: "unrecognized",
          selectedId: 45,
          instructions: "x".repeat(9000),
          revisionNote: "n".repeat(200),
          inspectorOpen: "true",
          scrollPositions: { negative: -8, text: "600", valid: 1250 },
        }),
    };
    const restored = readReportWorkspace("project", false, local);
    expect(restored.kind).toBe("decision-brief");
    expect(restored.selectedId).toBe(null);
    expect(restored.instructions).toHaveLength(8000);
    expect(restored.revisionNote).toHaveLength(160);
    expect(restored.inspectorOpen).toBe(false);
    expect(restored.scrollPositions).toEqual({ valid: 1250 });
  });
  it.each(["{broken", "null", "[]", "123"])(
    "recovers malformed stored preferences %s",
    (value) => {
      expect(
        readReportWorkspace("project", false, { getItem: () => value }),
      ).toEqual(defaultReportWorkspace(false));
    },
  );
  it("keeps project startup and editing available when local preference storage is blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("Storage disabled");
      },
      setItem: () => {
        throw new Error("Quota exceeded");
      },
    };
    expect(readReportWorkspace("project", true, blocked)).toEqual(
      defaultReportWorkspace(true),
    );
    expect(() =>
      writeReportWorkspace("project", defaultReportWorkspace(false), blocked),
    ).not.toThrow();
  });
});
