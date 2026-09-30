import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  validateWorkspaceBackup,
  releaseUpdate,
  Diagnostics,
} from "../src/main/maintenance";
import { testAIGeneration } from "../src/main/model-connection";
import { ResearchStore } from "../src/main/research-store";
import { createBlankProject } from "../src/shared/project";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, copyFile: vi.fn(actual.copyFile) };
});
const dirs: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.mocked(copyFile).mockReset();
  vi.mocked(copyFile).mockImplementation(
    (
      await vi.importActual<typeof import("node:fs/promises")>(
        "node:fs/promises",
      )
    ).copyFile,
  );
  for (const dir of dirs.splice(0))
    await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "acadia-maintenance-"));
  dirs.push(dir);
  const root = join(dir, "workspace");
  await mkdir(join(root, "assets"), { recursive: true });
  const id = randomUUID(),
    name = `${id}.txt`;
  const db = new DatabaseSync(join(root, "research.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL;CREATE TABLE projects(id TEXT,data TEXT);CREATE TABLE sources(data TEXT);PRAGMA user_version=5;",
  );
  db.prepare("INSERT INTO projects VALUES(?,?)").run(
    "test",
    JSON.stringify({ question: "Preserve evidence" }),
  );
  db.prepare("INSERT INTO sources VALUES(?)").run(
    JSON.stringify({ assetId: id }),
  );
  await writeFile(join(root, "assets", name), "original evidence");
  await writeFile(
    join(root, "assets.json"),
    JSON.stringify({
      [id]: { id, fileName: "original.txt", storedName: name, size: 17 },
    }),
  );
  await writeFile(
    join(root, "settings.json"),
    JSON.stringify({ apiKeyEncrypted: "installation-secret" }),
  );
  return { dir, root, db, id, name };
}
describe("consistent recoverable library backups", () => {
  it("rolls back a real SQLite disk-full failure without replacing the committed project", async () => {
    const dir = await mkdtemp(join(tmpdir(), "acadia-disk-full-"));
    dirs.push(dir);
    const store = new ResearchStore(dir),
      project = createBlankProject();
    try {
      project.title = "Committed before storage failure";
      store.saveProject(project);
      const db = (store as unknown as { db: DatabaseSync }).db;
      const pages = Number(db.prepare("PRAGMA page_count").get()?.page_count);
      db.exec(`PRAGMA max_page_count=${pages}`);
      const stamp = new Date().toISOString();
      const failed = {
        ...project,
        title: "Must not survive",
        cards: [
          {
            id: randomUUID(),
            kind: "note" as const,
            title: "Large write",
            content: "Evidence sentence. ".repeat(7000),
            x: 0,
            y: 0,
            tags: [],
            status: "unreviewed" as const,
            createdAt: stamp,
            updatedAt: stamp,
          },
        ],
      };
      expect(() => store.saveProject(failed)).toThrow(/full/i);
      expect(store.getProject(project.id)?.title).toBe(
        "Committed before storage failure",
      );
      expect(store.state(project.id).sources).toHaveLength(0);
    } finally {
      store.close();
    }
    const reopened = new ResearchStore(dir);
    try {
      expect(reopened.getProject(project.id)?.title).toBe(
        "Committed before storage failure",
      );
    } finally {
      reopened.close();
    }
  });
  it("captures committed WAL with originals, excludes credentials, and preserves the replaced library", async () => {
    const { dir, root, db, name } = await fixture();
    let backup;
    try {
      backup = await createWorkspaceBackup(root, join(dir, "backups"));
    } finally {
      db.close();
    }
    expect(await readdir(backup.path)).not.toContain("settings.json");
    await validateWorkspaceBackup(backup.path);
    await writeFile(join(root, "assets", name), "changed evidence");
    const preserved = await restoreWorkspaceBackup(root, backup.path);
    expect(await readFile(join(preserved, "assets", name), "utf8")).toBe(
      "changed evidence",
    );
    expect(await readFile(join(root, "assets", name), "utf8")).toBe(
      "original evidence",
    );
    expect(await readFile(join(root, "settings.json"), "utf8")).toContain(
      "installation-secret",
    );
    const restored = new DatabaseSync(join(root, "research.sqlite"), {
      readOnly: true,
    });
    try {
      expect(
        restored.prepare("SELECT count(*) AS n FROM projects").get()?.n,
      ).toBe(1);
    } finally {
      restored.close();
    }
  });
  it("refuses corrupted or incomplete backups before touching the active workspace", async () => {
    const { dir, root, db, name } = await fixture();
    let backup;
    try {
      backup = await createWorkspaceBackup(root, join(dir, "backups"));
    } finally {
      db.close();
    }
    await writeFile(join(backup.path, "assets", name), "tampered");
    await expect(restoreWorkspaceBackup(root, backup.path)).rejects.toThrow(
      "integrity",
    );
    expect(await readFile(join(root, "assets", name), "utf8")).toBe(
      "original evidence",
    );
    expect((await readdir(dir)).some((n) => n.includes("preserved"))).toBe(
      false,
    );
  });
  it.each(["changed bytes", "disk full"])(
    "preserves the active library when staging fails: %s",
    async (failure) => {
      const { dir, root, db, name } = await fixture();
      const backup = await createWorkspaceBackup(root, join(dir, "backups"));
      db.close();
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      vi.mocked(copyFile).mockImplementation(async (source, target, mode) => {
        if (
          String(target).includes("-restore-") &&
          String(target).endsWith(name)
        ) {
          if (failure === "disk full")
            throw Object.assign(new Error("No space left"), { code: "ENOSPC" });
          await writeFile(target, "corrupted copied bytes");
          return;
        }
        await actual.copyFile(source, target, mode);
      });
      await expect(restoreWorkspaceBackup(root, backup.path)).rejects.toThrow(
        failure === "disk full" ? "No space left" : "integrity",
      );
      expect(await readFile(join(root, "assets", name), "utf8")).toBe(
        "original evidence",
      );
      expect(
        (await readdir(dir)).some(
          (name) => name.includes("-preserved-") || name.includes("-restore-"),
        ),
      ).toBe(false);
    },
  );
  it("does not call an incomplete attachment catalog a successful backup", async () => {
    const { dir, root, db } = await fixture();
    try {
      await writeFile(join(root, "assets.json"), "{}");
      await expect(
        createWorkspaceBackup(root, join(dir, "backups")),
      ).rejects.toThrow("missing an original");
      expect(await readdir(join(dir, "backups"))).toEqual([]);
    } finally {
      db.close();
    }
  });
  it("rejects backup destinations inside the live workspace", async () => {
    const { root, db } = await fixture();
    try {
      await expect(
        createWorkspaceBackup(root, join(root, "backups")),
      ).rejects.toThrow("outside");
    } finally {
      db.close();
    }
  });
});
describe("explicit safe application maintenance", () => {
  const payload = {
    tag_name: "v1.0.1",
    html_url: "https://github.com/byrneDev/Acadia/releases/tag/v1.0.1",
    assets: [
      {
        name: "Acadia-1.0.1-macOS-arm64.zip",
        browser_download_url:
          "https://github.com/byrneDev/Acadia/releases/download/v1.0.1/Acadia-1.0.1-macOS-arm64.zip",
      },
    ],
  };
  it("chooses the exact official platform download without treating older versions as upgrades", () => {
    expect(releaseUpdate("1.0.0", payload, "darwin", "arm64")).toMatchObject({
      available: true,
      downloadUrl: payload.assets[0].browser_download_url,
    });
    expect(releaseUpdate("1.1.0", payload, "darwin", "arm64").available).toBe(
      false,
    );
    expect(
      releaseUpdate("1.0.1-rc.1", payload, "darwin", "arm64").available,
    ).toBe(true);
    expect(
      releaseUpdate(
        "1.0.0",
        {
          ...payload,
          assets: [
            {
              ...payload.assets[0],
              browser_download_url: "https://malicious.test/file.zip",
            },
          ],
        },
        "darwin",
        "arm64",
      ).downloadUrl,
    ).toBeUndefined();
    expect(() =>
      releaseUpdate(
        "1.0.0",
        { ...payload, html_url: "https://malicious.test" },
        "darwin",
        "arm64",
      ),
    ).toThrow();
  });
  it("never includes free-text errors, paths, prompts, or keys in bounded diagnostics", () => {
    const d = new Diagnostics();
    for (let i = 0; i < 230; i++)
      d.record("save", {
        message: "APIKEY /Users/private Confidential evidence",
        code: "ENOSPC",
      });
    const report = d.report("1.0.0");
    expect(report.events).toHaveLength(200);
    expect(report.events[0].code).toBe("ENOSPC");
    expect(JSON.stringify(report)).not.toMatch(/APIKEY|Users|Confidential/);
  });
  it("tests structured generation using only a synthetic prompt, and rejects malformed replies", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ message: { content: '{"answer":"4"}' } }),
          { headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const settings = {
      provider: "ollama" as const,
      endpoint: "http://127.0.0.1:11434",
      model: "synthetic",
    };
    await expect(testAIGeneration(settings)).resolves.toMatchObject({
      ok: true,
    });
    expect(
      JSON.parse(fetch.mock.calls[0][1].body).messages[1].content,
    ).toContain("2 + 2");
    fetch.mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "unstructured" } })),
    );
    await expect(testAIGeneration(settings)).rejects.toThrow("required JSON");
  });
});
