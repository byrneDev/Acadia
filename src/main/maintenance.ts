import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assetRecord, atomicWrite, type AssetRecord } from "./storage";
import type {
  BackupInfo,
  DiagnosticReport,
  UpdateCheck,
} from "../shared/maintenance";

interface Manifest {
  format: 1;
  createdAt: string;
  files: { name: string; bytes: number; sha256: string }[];
}
async function hashFile(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function backupFile(name: string) {
  return (
    ["research.sqlite", "assets.json", "workspace.json"].includes(name) ||
    /^assets\/[a-f0-9-]+\.[a-z0-9]+$/i.test(name)
  );
}
function checkDatabase(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("PRAGMA quick_check").get()?.quick_check !== "ok")
      throw new Error("Backup database integrity check failed.");
    const version = Number(
      db.prepare("PRAGMA user_version").get()?.user_version,
    );
    if (version > 5)
      throw new Error("This backup requires a newer Acadia version.");
    if (
      !db.prepare("SELECT name FROM sqlite_master WHERE name='projects'").get()
    )
      throw new Error("Backup has no research library.");
  } finally {
    db.close();
  }
}

/** A backup is an independently checked directory, never a copy of live WAL files. */
export async function createWorkspaceBackup(
  root: string,
  directory: string,
): Promise<BackupInfo> {
  if (
    resolve(directory) === resolve(root) ||
    resolve(directory).startsWith(resolve(root) + sep)
  )
    throw new Error("Choose a backup location outside the live workspace.");
  await mkdir(directory, { recursive: true });
  const createdAt = new Date().toISOString();
  const name = `Acadia-backup-${createdAt.replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const temporary = join(directory, `.${name}.partial`),
    destination = join(directory, name);
  await mkdir(join(temporary, "assets"), { recursive: true });
  try {
    const catalogText = await readFile(join(root, "assets.json"), "utf8").catch(
      (e) => {
        if (e.code !== "ENOENT") throw e;
        return "{}";
      },
    );
    const catalog = JSON.parse(catalogText) as Record<string, AssetRecord>;
    if (!catalog || Array.isArray(catalog) || typeof catalog !== "object")
      throw new Error(
        "Attachment catalog is invalid. Preserve the workspace and restore an earlier backup.",
      );
    const db = new DatabaseSync(join(root, "research.sqlite"), {
      readOnly: true,
    });
    try {
      db.prepare("VACUUM INTO ?").run(join(temporary, "research.sqlite"));
    } finally {
      db.close();
    }
    await atomicWrite(join(temporary, "assets.json"), catalogText);
    const names = ["research.sqlite", "assets.json"];
    for (const [id, entry] of Object.entries(catalog)) {
      const record = assetRecord(id, entry.fileName, entry.size);
      const file = `assets/${record.storedName}`;
      const source = join(root, file);
      const info = await lstat(source);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== record.size)
        throw new Error(
          "A research attachment is missing or changed. Backup was not completed.",
        );
      await copyFile(source, join(temporary, file));
      names.push(file);
    }
    const workspace = await readFile(join(root, "workspace.json")).catch(
      (e) => {
        if (e.code !== "ENOENT") throw e;
        return undefined;
      },
    );
    if (workspace) {
      await atomicWrite(join(temporary, "workspace.json"), workspace);
      names.push("workspace.json");
    }
    checkDatabase(join(temporary, "research.sqlite"));
    verifyCatalog(join(temporary, "research.sqlite"), catalog);
    const files: Manifest["files"] = [];
    for (const file of names)
      files.push({
        name: file,
        bytes: (await stat(join(temporary, file))).size,
        sha256: await hashFile(join(temporary, file)),
      });
    await atomicWrite(
      join(temporary, "backup.json"),
      JSON.stringify(
        { format: 1, createdAt, files } satisfies Manifest,
        null,
        2,
      ),
    );
    await rename(temporary, destination);
    return {
      path: destination,
      createdAt,
      files: files.length,
      bytes: files.reduce((n, f) => n + f.bytes, 0),
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function validateWorkspaceBackup(path: string): Promise<Manifest> {
  const manifest = JSON.parse(
    await readFile(join(path, "backup.json"), "utf8"),
  ) as Manifest;
  if (
    manifest.format !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 100_003 ||
    !Number.isFinite(Date.parse(manifest.createdAt))
  )
    throw new Error("This is not a supported Acadia backup.");
  const names = new Set<string>();
  const assetDirectory = await lstat(join(path, "assets")).catch(
    () => undefined,
  );
  if (assetDirectory?.isSymbolicLink())
    throw new Error("Backup attachment directory must not be a symbolic link.");
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.name !== "string" ||
      !backupFile(file.name) ||
      names.has(file.name) ||
      !Number.isSafeInteger(file.bytes) ||
      file.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    )
      throw new Error("Backup manifest is invalid.");
    names.add(file.name);
    const info = await lstat(join(path, file.name));
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size !== file.bytes ||
      (await hashFile(join(path, file.name))) !== file.sha256
    )
      throw new Error(
        "Backup failed its integrity check. No workspace was replaced.",
      );
  }
  if (!names.has("research.sqlite") || !names.has("assets.json"))
    throw new Error("Backup is incomplete.");
  const catalog = JSON.parse(
    await readFile(join(path, "assets.json"), "utf8"),
  ) as Record<string, AssetRecord>;
  if (!catalog || Array.isArray(catalog) || typeof catalog !== "object")
    throw new Error("Backup attachment catalog is invalid.");
  for (const [id, entry] of Object.entries(catalog)) {
    const record = assetRecord(id, entry.fileName, entry.size);
    if (
      !manifest.files.some(
        (f) =>
          f.name === `assets/${record.storedName}` && f.bytes === record.size,
      )
    )
      throw new Error("Backup is missing an original attachment.");
  }
  checkDatabase(join(path, "research.sqlite"));
  verifyCatalog(join(path, "research.sqlite"), catalog);
  return manifest;
}
function verifyCatalog(
  databasePath: string,
  catalog: Record<string, AssetRecord>,
) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    for (const table of ["sources", "versions"]) {
      if (!db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table))
        continue;
      for (const row of db
        .prepare(
          `SELECT json_extract(data,'$.assetId') AS asset FROM ${table} WHERE json_extract(data,'$.assetId') IS NOT NULL`,
        )
        .all())
        if (typeof row.asset !== "string" || !catalog[row.asset])
          throw new Error(
            "The backup attachment catalog is missing an original research file.",
          );
    }
  } finally {
    db.close();
  }
}

/** Caller closes SQLite/workers first; original workspace is retained alongside the replacement. */
export async function restoreWorkspaceBackup(
  root: string,
  backup: string,
): Promise<string> {
  const manifest = await validateWorkspaceBackup(backup);
  const stage = `${root}-restore-${randomUUID()}`,
    preserved = `${root}-preserved-${Date.now()}-${randomUUID().slice(0, 8)}`;
  let moved = false;
  try {
    await mkdir(stage, { recursive: true });
    for (const file of manifest.files) {
      await mkdir(dirname(join(stage, file.name)), { recursive: true });
      await copyFile(join(backup, file.name), join(stage, file.name));
    }
    // Validate the copied bytes against the original checked manifest, not a
    // manifest that may have changed while an external backup was being read.
    await atomicWrite(join(stage, "backup.json"), JSON.stringify(manifest));
    await validateWorkspaceBackup(stage);
    await rm(join(stage, "backup.json"));
    // Credentials belong to this installation and are never read from a backup.
    for (const name of ["settings.json", "search-settings.json"])
      await copyFile(join(root, name), join(stage, name)).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
    await rename(root, preserved);
    moved = true;
    try {
      await rename(stage, root);
    } catch (error) {
      await rename(preserved, root);
      moved = false;
      throw error;
    }
    return preserved;
  } finally {
    if (!moved) await rm(stage, { recursive: true, force: true });
  }
}
export async function listWorkspaceBackups(
  directory: string,
): Promise<BackupInfo[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const result: BackupInfo[] = [];
  for (const entry of entries.filter(
    (e) => e.isDirectory() && e.name.startsWith("Acadia-backup-"),
  )) {
    try {
      const manifest = JSON.parse(
        await readFile(join(directory, entry.name, "backup.json"), "utf8"),
      ) as Manifest;
      if (manifest.format === 1 && Array.isArray(manifest.files))
        result.push({
          path: join(directory, entry.name),
          createdAt: manifest.createdAt,
          files: manifest.files.length,
          bytes: manifest.files.reduce((n, f) => n + f.bytes, 0),
        });
    } catch {
      /* Incomplete backups are not offered as completed backups. */
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function releaseUpdate(
  currentVersion: string,
  payload: unknown,
  platform: string,
  arch: string,
): UpdateCheck {
  const release = payload as {
    tag_name?: unknown;
    html_url?: unknown;
    draft?: boolean;
    prerelease?: boolean;
    assets?: { name: string; browser_download_url: string }[];
  };
  if (
    !release ||
    typeof release.tag_name !== "string" ||
    !/^v\d+\.\d+\.\d+$/.test(release.tag_name) ||
    release.draft ||
    release.prerelease ||
    release.html_url !==
      `https://github.com/byrneDev/Acadia/releases/tag/${release.tag_name}`
  )
    throw new Error("GitHub returned unsupported release metadata.");
  const latestVersion = release.tag_name.slice(1),
    a = latestVersion.split(".").map(Number),
    b = currentVersion.split(/[.-]/).slice(0, 3).map(Number);
  const difference = a.findIndex((n, i) => n !== b[i]);
  const available =
    difference >= 0
      ? a[difference] > b[difference]
      : currentVersion.includes("-");
  const suffix =
    platform === "darwin" && arch === "arm64"
      ? "macOS-arm64.zip"
      : platform === "win32" && arch === "x64"
        ? "Windows-x64.exe"
        : platform === "linux" && arch === "x64"
          ? "linux-x64.deb"
          : undefined;
  const name = suffix ? `Acadia-${latestVersion}-${suffix}` : undefined;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((x) => x.name === name)
    : undefined;
  const expected = name
    ? `https://github.com/byrneDev/Acadia/releases/download/${release.tag_name}/${name}`
    : undefined;
  const downloadUrl =
    asset?.browser_download_url === expected ? expected : undefined;
  return {
    currentVersion,
    latestVersion,
    available,
    releaseUrl: release.html_url,
    downloadUrl,
    message: available
      ? "Export or back up your work, quit Acadia, then install the matching download. Updates are never installed automatically."
      : "No newer stable release was found. Nothing was downloaded or installed.",
  };
}
export class Diagnostics {
  private events: DiagnosticReport["events"] = [];
  record(operation: string, error: unknown) {
    const code = (error as { code?: unknown })?.code;
    this.events.push({
      time: new Date().toISOString(),
      operation: /^[a-z-]{1,64}$/.test(operation) ? operation : "application",
      code:
        typeof code === "string" &&
        /^(E[A-Z0-9_]{1,30}|SQLITE_[A-Z_]{1,30})$/.test(code)
          ? code
          : "OPERATION_FAILED",
    });
    this.events = this.events.slice(-200);
  }
  report(appVersion: string): DiagnosticReport {
    return {
      schemaVersion: 1,
      appVersion,
      platform: process.platform,
      architecture: process.arch,
      generatedAt: new Date().toISOString(),
      events: [...this.events],
      privacy:
        "Contains version, platform, timestamps, operation identifiers and error codes only. No source text, paths, credentials, prompts, model responses, or project titles.",
    };
  }
}
