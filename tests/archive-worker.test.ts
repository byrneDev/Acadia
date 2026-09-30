import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import {
  buildPortableArchive,
  assertPortableArchiveSizes,
  PORTABLE_ARCHIVE_LIMITS,
} from "../src/main/archive-worker";
import {
  ResearchStore,
  contentHash,
  validateResearchArchive,
} from "../src/main/research-store";
import { assetRecord } from "../src/main/storage";
import { createBlankProject, validateProject } from "../src/shared/project";
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
describe("portable archive worker", () => {
  it("matches complete canonical export while keeping historical passages, drafts and only project originals", async () => {
    const root = await mkdtemp(join(tmpdir(), "acadia-archive-worker-"));
    directories.push(root);
    await mkdir(join(root, "assets"));
    const store = new ResearchStore(root),
      project = createBlankProject(),
      foreign = createBlankProject();
    const text = "Original exact evidence.\nThe outcome is still uncertain.",
      asset = assetRecord(randomUUID(), "study.txt", Buffer.byteLength(text)),
      unrelated = assetRecord(randomUUID(), "unrelated.txt", 3);
    try {
      store.saveProject(project);
      store.saveProject(foreign);
      await writeFile(join(root, "assets", asset.storedName), text);
      await writeFile(join(root, "assets", unrelated.storedName), "KEY");
      await writeFile(
        join(root, "settings.json"),
        JSON.stringify({ apiKey: "synthetic-installation-secret" }),
      );
      const stamp = "2026-09-30T10:00:00.000Z";
      store.saveSource({
        id: "study",
        projectId: project.id,
        assetId: asset.id,
        title: "Fictional source",
        kind: "document",
        currentVersionId: "study-v1",
        inclusion: "include",
        createdAt: stamp,
        updatedAt: stamp,
      });
      store.addVersion(
        {
          id: "study-v1",
          sourceId: "study",
          title: "Original",
          assetId: asset.id,
          hash: contentHash(text),
          acquiredAt: stamp,
          status: "ready",
          method: "native",
          totalUnits: 1,
          processedUnits: 1,
        },
        [
          {
            id: "study-p1",
            sourceId: "study",
            versionId: "study-v1",
            text,
            locator: "Page 1",
            page: 1,
            method: "native",
            inclusion: "include",
          },
        ],
      );
      store.addVersion(
        {
          id: "study-v2",
          sourceId: "study",
          title: "Processing revision",
          assetId: asset.id,
          hash: contentHash(text),
          acquiredAt: stamp,
          status: "processing",
          method: "native",
          totalUnits: 2,
          processedUnits: 1,
        },
        [
          {
            id: "study-v2-p1",
            sourceId: "study",
            versionId: "study-v2",
            text,
            locator: "Page 1",
            page: 1,
            method: "native",
            inclusion: "include",
          },
        ],
      );
      store.saveResearchDraft({
        projectId: project.id,
        key: "private-brief",
        kind: "brief",
        value: {
          buffer: { scope: "Unaccepted interpretation" },
          baseSignature: "initial",
        },
        expectedRevision: 0,
      });
      store.saveResearchDraft({
        projectId: foreign.id,
        key: "foreign-private",
        kind: "brief",
        value: { text: "Do not export another investigation" },
        expectedRevision: 0,
      });
      store.createPedigreeSnapshot(project.id);
      const expected = store.exportResearch(project.id);
      const bytes = await buildPortableArchive({
        root,
        databasePath: join(root, "research.sqlite"),
        projectJSON: JSON.stringify(project),
        assets: [asset, unrelated],
      });
      const zip = new AdmZip(bytes),
        research = JSON.parse(zip.readAsText("research.json"));
      expect(research).toEqual(expected);
      expect(() => validateResearchArchive(research, project.id)).not.toThrow();
      expect(
        validateProject(JSON.parse(zip.readAsText("project.json")))
          .schemaVersion,
      ).toBe(5);
      expect(
        zip
          .getEntries()
          .map((e) => e.entryName)
          .sort(),
      ).toEqual(
        [
          "project.json",
          "research.json",
          "assets.json",
          `assets/${asset.id}`,
        ].sort(),
      );
      expect(JSON.parse(zip.readAsText("assets.json"))).toEqual([asset]);
      expect(zip.readAsText(`assets/${asset.id}`)).toBe(text);
      expect(zip.readAsText("research.json")).not.toMatch(
        /synthetic-installation-secret|foreign-private|Do not export another/,
      );
      expect(
        research.versions.find((v: { id: string }) => v.id === "study-v2")
          .status,
      ).toBe("partial");
      expect(
        store.versions("study").find((v) => v.id === "study-v2")?.status,
      ).toBe("processing");
      // Same byte count is not sufficient to preserve historical citation integrity.
      await writeFile(
        join(root, "assets", asset.storedName),
        "x".repeat(Buffer.byteLength(text)),
      );
      await expect(
        buildPortableArchive({
          root,
          databasePath: join(root, "research.sqlite"),
          projectJSON: JSON.stringify(project),
          assets: [asset],
        }),
      ).rejects.toThrow(/historical content hash/);
    } finally {
      store.close();
    }
  });
  it("rejects every import size/count ceiling before a non-importable export can be written", () => {
    const caps = PORTABLE_ARCHIVE_LIMITS,
      base = { project: 2, research: 2, manifest: 2, assets: [] as number[] };
    expect(() => assertPortableArchiveSizes(base)).not.toThrow();
    for (const invalid of [
      { ...base, project: caps.project + 1 },
      { ...base, research: caps.entry + 1 },
      { ...base, manifest: caps.manifest + 1 },
      { ...base, assets: [caps.entry + 1] },
      { ...base, assets: Array(caps.assets + 1).fill(0) },
      {
        ...base,
        assets: [
          caps.entry,
          caps.entry,
          caps.entry,
          caps.entry,
          30 * 1024 * 1024,
        ],
      },
      { ...base, compressed: caps.total + 1 },
      { ...base, assets: [-1] },
    ])
      expect(() => assertPortableArchiveSizes(invalid)).toThrow(
        /whole-library backup/,
      );
    expect(() =>
      assertPortableArchiveSizes({
        ...base,
        research: caps.entry,
        project: caps.project,
        manifest: caps.manifest,
      }),
    ).not.toThrow();
  });
});
