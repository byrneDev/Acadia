import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  ResearchStore,
  validateResearchArchive,
} from "../src/main/research-store";
import {
  Ingestion,
  publicAddress,
  readableSnapshot,
} from "../src/main/ingestion";
import {
  createBlankProject,
  createDemoProject,
  createEvidenceSampleProject,
  validateProject,
} from "../src/shared/project";
import type { Project } from "../src/shared/types";
import type { ResearchJob } from "../src/shared/research";

const roots: string[] = [];
const stores: ResearchStore[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "acadia-evidence-"));
  roots.push(root);
  await mkdir(join(root, "assets"));
  const store = new ResearchStore(root);
  stores.push(store);
  const project = createBlankProject();
  store.saveProject(project);
  return { root, store, project };
}
afterEach(async () => {
  for (const store of stores.splice(0))
    try {
      store.close();
    } catch {}
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const card = (project: Project, i: number, text: string) => ({
  id: `source-${i}`,
  kind: "note" as const,
  title: `Source ${i}`,
  content: text,
  x: 0,
  y: 0,
  tags: [],
  status: "unreviewed" as const,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
});
async function complete(store: ResearchStore, job: ResearchJob) {
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const state = store.getJob(job.id)!;
    if (["completed", "failed", "cancelled"].includes(state.status))
      return state;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Job timeout");
}
function pdf(pages: number, blank = false): Buffer {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const pageIds: number[] = [];
  for (let p = 1; p <= pages; p++) {
    const pageId = objects.length + 1,
      streamId = pageId + 1;
    pageIds.push(pageId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
    );
    const stream = blank
      ? ""
      : `BT /F1 16 Tf 40 740 Td (${p === pages ? "ENDDOCUMENT zirconium counterevidence" : "Research material"} page ${p}) Tj ET`;
    objects.push(
      `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    );
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pages} >>`;
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(output));
    output += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join(
      "",
    )}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output);
}

describe("normalized evidence foundation", () => {
  it("retrieves a relevant source beyond card 80 and preserves old citations after edits and deletion", async () => {
    const { store, project } = await fixture();
    project.cards = Array.from({ length: 100 }, (_, i) =>
      card(
        project,
        i,
        i === 99
          ? "Rare zirconium result near the end."
          : "Other unrelated material.",
      ),
    );
    store.saveProject(project);
    const hit = store.search(project.id, "zirconium")[0];
    expect(hit.sourceTitle).toBe("Source 99");
    project.cards[99].content = "Updated conclusion differs.";
    store.saveProject(project);
    expect(store.search(project.id, "zirconium")).toEqual([]);
    expect(store.getPassage(hit.id).text).toContain("zirconium");
    project.cards = [];
    store.saveProject(project);
    expect(store.getPassage(hit.id).versionId).toBe(hit.versionId);
  });
  it("records duplicate content, exclusions, and immutable versions independently of card annotations", async () => {
    const { store, project } = await fixture();
    project.cards = [
      card(project, 1, "Duplicated finding."),
      card(project, 2, "Duplicated finding."),
    ];
    store.saveProject(project);
    const state = store.state(project.id);
    expect(state.sources[1].duplicateOf).toBe(state.sources[0].id);
    const version = state.versions[0];
    expect(() => store.addVersion(version)).toThrow(/immutable/);
    store.setSourcePolicy(state.sources[0].id, "exclude");
    store.setPassagePolicy(
      store.getSource(state.sources[1].id).passages[0].id,
      "exclude",
    );
    expect(store.search(project.id, "finding")).toEqual([]);
  });
  it("migrates schema1 without trusting extraction errors or stripping positions and outputs", async () => {
    const { store } = await fixture();
    const project = createDemoProject();
    project.schemaVersion = 1;
    project.cards[0].extraction =
      "[This PDF has no extractable text. OCR is not included; open the original.]";
    const positions = project.cards.map((c) => [c.x, c.y]);
    store.saveProject(project);
    expect(project.schemaVersion).toBe(2);
    expect(project.cards.map((c) => [c.x, c.y])).toEqual(positions);
    expect(project.cards[0].extraction).toBeUndefined();
    expect(store.getSource(project.cards[0].sourceId!).passages).toHaveLength(
      0,
    );
    expect(store.state(project.id).versions[0].status).toBe("failed");
  });
  it("roundtrips historical passages and rejects broken archives transactionally without credentials", async () => {
    const { store, project } = await fixture();
    project.cards = [card(project, 1, "Archived text.")];
    store.saveProject(project);
    const original = store.exportResearch(project.id);
    const second = await fixture();
    second.store.importResearch(second.project.id, original);
    expect(second.store.search(second.project.id, "Archived")[0].text).toBe(
      "Archived text.",
    );
    const broken = structuredClone(original);
    broken.passages[0].versionId = "missing";
    expect(() =>
      second.store.importResearch(second.project.id, broken),
    ).toThrow(/reference/);
    expect(second.store.search(second.project.id, "Archived")).toHaveLength(1);
    expect(() =>
      validateResearchArchive(
        {
          ...original,
          sources: [{ ...original.sources[0], inclusion: "hacked" }],
        },
        project.id,
      ),
    ).toThrow();
    expect(JSON.stringify(original)).not.toContain("apiKey");
  });
  it("recovers interrupted jobs without restarting external work and protects active-project state", async () => {
    const { store, root, project } = await fixture();
    store.activeProjectId = project.id;
    const job: ResearchJob = {
      id: randomUUID(),
      projectId: project.id,
      kind: "discovery",
      label: "Search",
      status: "running",
      progress: 0.5,
      message: "running",
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
    store.saveJob(job);
    store.close();
    stores.splice(stores.indexOf(store), 1);
    const reopened = new ResearchStore(root);
    stores.push(reopened);
    expect(reopened.activeProjectId).toBe(project.id);
    expect(reopened.getJob(job.id)?.status).toBe("failed");
    expect(reopened.getJob(job.id)?.message).toContain("Retry explicitly");
  });
  it("rolls back replacement when an archive collides with another local investigation", async () => {
    const { store, project } = await fixture();
    project.cards = [card(project, 1, "Keep this original evidence.")];
    store.saveProject(project);
    const target = createBlankProject();
    target.cards = [card(target, 2, "Target research remains recoverable.")];
    store.saveProject(target);
    const archive = store.exportResearch(project.id);
    expect(() =>
      store.importResearch(target.id, archive, { replace: true }),
    ).toThrow(/another project/);
    expect(store.search(target.id, "recoverable")[0].text).toBe(
      "Target research remains recoverable.",
    );
    expect(store.search(project.id, "original")[0].text).toBe(
      "Keep this original evidence.",
    );
  });
  it("retrieves final segments of long notes and validates report revision compatibility", async () => {
    const { store, project } = await fixture();
    project.cards = [
      card(
        project,
        1,
        "Ordinary material. ".repeat(10000) + " ENDNOTE zirconium.",
      ),
    ];
    store.saveProject(project);
    expect(store.search(project.id, "ENDNOTE")[0].text).toContain("ENDNOTE");
    expect(
      store.search(project.id, "ENDNOTE")[0].text.length,
    ).toBeLessThanOrEqual(4000);
    project.outputs = [
      {
        id: "old-output",
        kind: "hypothesis",
        title: "Legacy output",
        markdown: "Old card [S1]",
        createdAt: project.createdAt,
        provider: "offline",
        sourceIds: [project.cards[0].id],
        boardUpdatedAt: project.updatedAt,
        citations: [
          {
            id: "legacy-source-1",
            label: "S1",
            sourceId: "",
            versionId: "",
            passageId: "",
            sourceTitle: "Old source",
            locator: "Card-level reference",
            quote: "",
            acquiredAt: project.createdAt,
            verified: false,
            legacyCardId: project.cards[0].id,
          },
        ],
        document: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: "A source link",
                  marks: [
                    { type: "link", attrs: { href: "https://example.com" } },
                  ],
                },
              ],
            },
          ],
        },
      },
    ];
    expect(
      validateProject(project).outputs[0].citations?.[0].legacyCardId,
    ).toBe(project.cards[0].id);
  });
  it("claims a discovery plan only once and only for its owning project", async () => {
    const { store, project } = await fixture();
    store.saveDiscoveryPlan({
      id: "plan-1",
      projectId: project.id,
      question: "q",
      queries: ["q"],
      purpose: "Investigate",
      destination: "Brave",
      maxQueries: 5,
      maxCaptures: 20,
      createdAt: project.createdAt,
    });
    expect(store.claimDiscoveryPlan("other", "plan-1")).toBe(false);
    expect(store.claimDiscoveryPlan(project.id, "plan-1")).toBe(true);
    expect(store.claimDiscoveryPlan(project.id, "plan-1")).toBe(false);
  });
});

describe("complete document ingestion and safe capture", () => {
  it("indexes all 205 PDF pages and opens the exact final-page passage", async () => {
    const { root, store, project } = await fixture();
    const assetId = randomUUID(),
      name = `${assetId}.pdf`;
    await writeFile(join(root, "assets", name), pdf(205));
    project.cards = [{ ...card(project, 1, ""), kind: "document", assetId }];
    store.saveProject(project);
    const service = new Ingestion(store, root, () => ({
      id: assetId,
      fileName: "long.pdf",
      storedName: name,
      mimeType: "application/pdf",
      size: 1000,
    }));
    const job = service.startFile(project.id, project.cards[0].sourceId!);
    expect((await complete(store, job)).status).toBe("completed");
    const hit = store.search(project.id, "ENDDOCUMENT")[0];
    expect(hit.page).toBe(205);
    expect(hit.locator).toBe("Page 205");
    expect(store.getSource(hit.sourceId).versions.at(-1)?.processedUnits).toBe(
      205,
    );
  }, 30000);
  it("labels scanned pages as needing OCR, never as successfully extracted evidence", async () => {
    const { root, store, project } = await fixture();
    const assetId = randomUUID(),
      name = `${assetId}.pdf`;
    await writeFile(join(root, "assets", name), pdf(1, true));
    project.cards = [{ ...card(project, 1, ""), kind: "document", assetId }];
    store.saveProject(project);
    const service = new Ingestion(store, root, () => ({
      id: assetId,
      fileName: "scan.pdf",
      storedName: name,
      mimeType: "application/pdf",
      size: 1000,
    }));
    await complete(
      store,
      service.startFile(project.id, project.cards[0].sourceId!),
    );
    const detail = store.getSource(project.cards[0].sourceId!);
    expect(detail.versions.at(-1)?.status).toBe("needs-ocr");
    expect(detail.passages).toHaveLength(0);
  });
  it("cancels document processing and preserves the original for a retry", async () => {
    const { root, store, project } = await fixture();
    const assetId = randomUUID(),
      name = `${assetId}.txt`;
    await writeFile(
      join(root, "assets", name),
      Array(1000).fill("Research paragraph.").join("\n\n"),
    );
    project.cards = [{ ...card(project, 1, ""), kind: "document", assetId }];
    store.saveProject(project);
    const service = new Ingestion(store, root, () => ({
      id: assetId,
      fileName: "long.txt",
      storedName: name,
      mimeType: "text/plain",
      size: 20000,
    }));
    const job = service.startFile(project.id, project.cards[0].sourceId!);
    service.cancelJob(job.id);
    expect((await complete(store, job)).status).toBe("cancelled");
    expect((await complete(store, service.retry(job.id))).status).toBe(
      "completed",
    );
    expect(store.getSource(project.cards[0].sourceId!).passages).toHaveLength(
      1000,
    );
  });
  it("recognizes image text using bundled local English OCR data", async () => {
    const { createCanvas } = await import("@napi-rs/canvas");
    const canvas = createCanvas(1000, 160);
    const context = canvas.getContext("2d");
    context.fillStyle = "white";
    context.fillRect(0, 0, 1000, 160);
    context.fillStyle = "black";
    context.font = "44px Arial";
    context.fillText("Research evidence remains traceable.", 30, 90);
    const { root, store, project } = await fixture();
    const assetId = randomUUID(),
      name = `${assetId}.png`;
    await writeFile(join(root, "assets", name), canvas.toBuffer("image/png"));
    project.cards = [{ ...card(project, 1, ""), kind: "image", assetId }];
    store.saveProject(project);
    const service = new Ingestion(store, root, () => ({
      id: assetId,
      fileName: "scan.png",
      storedName: name,
      mimeType: "image/png",
      size: 20000,
    }));
    const job = await complete(
      store,
      service.startFile(project.id, project.cards[0].sourceId!, true),
    );
    expect(job.status, job.message).toBe("completed");
    const detail = store.getSource(project.cards[0].sourceId!);
    expect(detail.passages[0].method).toBe("ocr");
    expect(detail.passages[0].text).toMatch(/evidence remains traceable/i);
    expect(detail.versions.at(-1)?.status).toBe("ready");
  }, 30000);
  it("sanitizes web snapshots with stable readable paragraphs and rejects private network addresses", () => {
    const article = readableSnapshot(
      "<html><title>Research</title><body><article><h1>Research</h1><p>" +
        "A useful public finding. ".repeat(30) +
        '</p><p>Counterevidence remains relevant.</p><script>globalThis.infected=true</script><img src="http://127.0.0.1/tracker" onerror="alert(1)"></article></body></html>',
      "https://example.com/research",
    );
    expect(article.paragraphs.some((p) => p.includes("Counterevidence"))).toBe(
      true,
    );
    expect(article.snapshot).not.toMatch(/<script|<img|onerror/);
    expect(publicAddress("127.0.0.1")).toBe(false);
    expect(publicAddress("192.168.1.1")).toBe(false);
    expect(publicAddress("::ffff:127.0.0.1")).toBe(false);
    expect(publicAddress("8.8.8.8")).toBe(true);
  });
  it("keeps the sample investigation counterevidence and known gap visible", () => {
    const project = validateProject(createEvidenceSampleProject());
    expect(project.connections.some((c) => c.relation === "contradicts")).toBe(
      true,
    );
    expect(project.cards.some((c) => c.title === "Missing evidence")).toBe(
      true,
    );
    expect(
      project.cards.every((c) => c.tags.includes("fictional sample")),
    ).toBe(true);
  });
});

it("portable snapshots retain unfinished text without claiming a worker is still running", async () => {
  const { store, project } = await fixture();
  project.cards = [card(project, 999, "Known evidence already extracted.")];
  store.saveProject(project);
  const source = store.state(project.id).sources[0];
  store.updateVersionStatus(source.currentVersionId, {
    status: "processing",
    totalUnits: 20,
    processedUnits: 1,
  });
  const snapshot = store.exportResearch(project.id);
  expect(
    snapshot.versions.find((v) => v.id === source.currentVersionId)?.status,
  ).toBe("partial");
  expect(snapshot.passages[0].text).toContain("Known evidence");
  expect(snapshot.versions[0].error).toContain("Reprocess");
  expect(store.getVersion(source.currentVersionId).status).toBe("processing");
});
