import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import {
  ResearchStore,
  validateResearchArchive,
} from "../src/main/research-store";
import { validateProject } from "../src/shared/project";
import { citationIntegrity } from "../src/shared/report-pedigree";

it("ships a portable fictional pedigree fixture with controlled contradictions, dependency and all five manual methods", () => {
  const zip = new AdmZip("docs/samples/Analytical-pedigree-sample.acadia");
  const project = validateProject(JSON.parse(zip.readAsText("project.json")));
  const records = validateResearchArchive(
    JSON.parse(zip.readAsText("research.json")),
    project.id,
  );
  expect(project.schemaVersion).toBe(3);
  expect(records.schemaVersion).toBe(3);
  expect(project.privacy).toEqual({ mode: "local", provider: "offline" });
  expect(records.sources).toHaveLength(5);
  if (!records.pedigree) throw new Error("V3 sample is missing its research pedigree.");
  expect(records.pedigree.methods.map((m) => m.kind).sort()).toEqual([
    "hypotheses",
    "risk",
    "root-cause",
    "swot",
    "trl",
  ]);
  expect(
    records.pedigree.origins.some(
      (o) => o.status === "confirmed" && o.kind === "same-study",
    ),
  ).toBe(true);
  expect(records.sources.find((s) => s.id === "cedar-counter")?.inclusion).toBe(
    "pin",
  );
  expect(records.claims[0].links.map((l) => l.relation)).toContain(
    "contradicts",
  );
  expect(records.tasks).toHaveLength(2);
  expect(records.jobs).toEqual([]);
  expect(records.runs).toEqual([]);
  expect(
    records.passages.every((p) =>
      p.text.includes("FICTIONAL TRAINING EVIDENCE"),
    ),
  ).toBe(true);
  const path = mkdtempSync(join(tmpdir(), "acadia-sample-roundtrip-")),
    store = new ResearchStore(path);
  try {
    store.transaction(() => {
      store.importResearch(project.id, records);
      store.saveProject(project);
    });
    const report = store.getProject(project.id)!.outputs[0];
    expect(citationIntegrity(report, (id) => store.getPassage(id))).toEqual([]);
    const historical = store.getPedigreeSnapshot(
      report.revisions![0].pedigreeSnapshotId!,
    );
    expect(historical.state.findings[0].classification).toBe("hypothesis");
    expect(historical.state.methods).toHaveLength(5);
    expect(
      store
        .search(project.id, "containers blue")
        .some((p) => p.id === "cedar-irrelevant-p1"),
    ).toBe(true);
    expect(
      store
        .search(project.id, "unknown seasonal baseline")
        .some((p) => p.id === "cedar-gap-p1"),
    ).toBe(true);
  } finally {
    store.close();
    rmSync(path, { recursive: true, force: true });
  }
});
