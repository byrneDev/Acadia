import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { createEvidenceSampleProject } from "../src/shared/project";
import { ResearchStore } from "../src/main/research-store";
const directory = mkdtempSync(join(tmpdir(), "acadia-sample-"));
const store = new ResearchStore(directory);
try {
  const project = createEvidenceSampleProject();
  store.saveProject(project);
  const sources = store.state(project.id).sources;
  const supportive = store.getSource(
    sources.find((s) => s.cardId === "sample-1")!.id,
  ).passages[0];
  const contrary = store.getSource(
    sources.find((s) => s.cardId === "sample-2")!.id,
  ).passages[0];
  store.saveClaim({
    id: "sample-claim",
    projectId: project.id,
    title: "Evening opening would meet substantial unmet demand",
    question: project.question,
    status: "disputed",
    alternatives:
      "Survey interest may not translate into visits. The short pilot may miss seasonal demand.",
    limitations:
      "Convenience sample, only four pilot weeks, no non-user survey or cost-per-additional-visit measure.",
    cardId: "sample-0",
    updatedAt: project.updatedAt,
    links: [
      {
        id: "sample-support-link",
        passageId: supportive.id,
        quote: supportive.text,
        relation: "supports",
        rationale:
          "Stated interest suggests potential demand; the sampling method limits inference.",
      },
      {
        id: "sample-contrary-link",
        passageId: contrary.id,
        quote: contrary.text,
        relation: "contradicts",
        rationale:
          "Observed attendance was low and costs exceeded budget during this pilot.",
      },
    ],
  });
  store.saveTask({
    id: "sample-task",
    projectId: project.id,
    title: "Evaluate sustained demand and additional visit cost",
    question: project.question,
    claimId: "sample-claim",
    status: "planned",
    criterion:
      "Collect a longer attendance series, a non-user survey, and incremental operating costs; compare the evidence with the original claim.",
    sourceIds: [],
    updatedAt: project.updatedAt,
  });
  const archive = new AdmZip();
  archive.addFile("project.json", Buffer.from(JSON.stringify(project)));
  archive.addFile("assets.json", Buffer.from("[]"));
  archive.addFile(
    "research.json",
    Buffer.from(JSON.stringify(store.exportResearch(project.id))),
  );
  mkdirSync("docs/samples", { recursive: true });
  writeFileSync("docs/samples/Library-hours-sample.acadia", archive.toBuffer());
  console.log("Created docs/samples/Library-hours-sample.acadia");
} finally {
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
