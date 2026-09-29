import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import type { CardKind } from "../shared/types";

export const MAX_ASSET_BYTES = 250 * 1024 * 1024;
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
export const MAX_TEXT_CHARS = 150_000;
export const ASSET_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AssetRecord {
  id: string;
  fileName: string;
  storedName: string;
  mimeType: string;
  size: number;
}

const FILE_TYPES: Record<string, { mime: string; kind: CardKind }> = {
  ".pdf": { mime: "application/pdf", kind: "document" },
  ".docx": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "document",
  },
  ".xlsx": {
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "document",
  },
  ".pptx": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    kind: "document",
  },
  ".doc": { mime: "application/msword", kind: "document" },
  ".xls": { mime: "application/vnd.ms-excel", kind: "document" },
  ".ppt": { mime: "application/vnd.ms-powerpoint", kind: "document" },
  ".odt": { mime: "application/vnd.oasis.opendocument.text", kind: "document" },
  ".ods": {
    mime: "application/vnd.oasis.opendocument.spreadsheet",
    kind: "document",
  },
  ".odp": {
    mime: "application/vnd.oasis.opendocument.presentation",
    kind: "document",
  },
  ".rtf": { mime: "application/rtf", kind: "document" },
  ".txt": { mime: "text/plain", kind: "document" },
  ".md": { mime: "text/markdown", kind: "document" },
  ".csv": { mime: "text/csv", kind: "document" },
  ".tsv": { mime: "text/tab-separated-values", kind: "document" },
  ".json": { mime: "application/json", kind: "document" },
  ".png": { mime: "image/png", kind: "image" },
  ".jpg": { mime: "image/jpeg", kind: "image" },
  ".jpeg": { mime: "image/jpeg", kind: "image" },
  ".webp": { mime: "image/webp", kind: "image" },
  ".gif": { mime: "image/gif", kind: "image" },
  ".avif": { mime: "image/avif", kind: "image" },
  ".bmp": { mime: "image/bmp", kind: "image" },
  ".tif": { mime: "image/tiff", kind: "image" },
  ".tiff": { mime: "image/tiff", kind: "image" },
  ".svg": { mime: "image/svg+xml", kind: "image" },
  ".mp3": { mime: "audio/mpeg", kind: "audio" },
  ".wav": { mime: "audio/wav", kind: "audio" },
  ".ogg": { mime: "audio/ogg", kind: "audio" },
  ".m4a": { mime: "audio/mp4", kind: "audio" },
  ".aac": { mime: "audio/aac", kind: "audio" },
  ".flac": { mime: "audio/flac", kind: "audio" },
  ".mp4": { mime: "video/mp4", kind: "video" },
  ".webm": { mime: "video/webm", kind: "video" },
  ".mov": { mime: "video/quicktime", kind: "video" },
  ".m4v": { mime: "video/mp4", kind: "video" },
};

export function fileType(fileName: string): { mime: string; kind: CardKind } {
  const type = FILE_TYPES[extname(fileName).toLowerCase()];
  if (!type)
    throw new Error(
      `“${basename(fileName)}” is not a supported research file. Import a document, image, audio, or video file.`,
    );
  return type;
}

export function safeAssetId(value: unknown): string {
  if (typeof value !== "string" || !ASSET_ID.test(value))
    throw new Error("Invalid attachment identifier.");
  return value;
}

export function assetRecord(
  id: string,
  fileName: string,
  size: number,
): AssetRecord {
  safeAssetId(id);
  const cleanName = basename(fileName)
    .replace(/[\u0000-\u001f]/g, "")
    .slice(0, 240);
  if (
    !cleanName ||
    cleanName !== fileName ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    size > MAX_ASSET_BYTES
  ) {
    throw new Error("Invalid attachment metadata.");
  }
  const type = fileType(cleanName);
  return {
    id,
    fileName: cleanName,
    storedName: id + extname(cleanName).toLowerCase(),
    mimeType: type.mime,
    size,
  };
}

/** Every replacement is written and flushed alongside its destination first. */
export async function atomicWrite(
  path: string,
  value: string | Buffer,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function readJSON(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function externalURL(value: unknown): string {
  if (typeof value !== "string" || value.length > 8192)
    throw new Error("Invalid link.");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a complete https:// or http:// link.");
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Only http:// and https:// research links can be opened.");
  }
  return parsed.href;
}

export function escapeHTML(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}

export function safeFileName(value: string): string {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
      .replace(/[. ]+$/, "")
      .trim()
      .slice(0, 100) || "Acadia"
  );
}

/** Render plain Markdown safely for native PDF output; embedded HTML is text. */
export function outputHTML(title: string, markdown: string): string {
  let inCode = false;
  let codeLines: string[] = [];
  const body: string[] = [];
  const inline = (text: string): string =>
    escapeHTML(text)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      if (inCode) {
        body.push(`<pre>${escapeHTML(codeLines.join("\n"))}</pre>`);
        codeLines = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      codeLines.push(line);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading)
      body.push(
        `<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`,
      );
    else if (/^[-*]\s+/.test(line))
      body.push(
        `<p class="bullet">• ${inline(line.replace(/^[-*]\s+/, ""))}</p>`,
      );
    else if (line.trim()) body.push(`<p>${inline(line)}</p>`);
    else body.push('<div class="space"></div>');
  }
  if (codeLines.length)
    body.push(`<pre>${escapeHTML(codeLines.join("\n"))}</pre>`);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escapeHTML(title)}</title><style>@page{size:A4;margin:19mm 18mm}body{color:#18231f;font:11pt/1.55 -apple-system,BlinkMacSystemFont,Arial,sans-serif}h1{font-size:25pt;line-height:1.2;margin-bottom:22px}h2{font-size:17pt;margin:26px 0 10px;border-bottom:1px solid #cbd7d0;padding-bottom:6px}h3{font-size:13pt;margin-top:20px}h1,h2,h3,h4{break-after:avoid}p{margin:6px 0;overflow-wrap:anywhere}.bullet{padding-left:12px}.space{height:5px}pre{white-space:pre-wrap;background:#f0f4f2;padding:12px;overflow-wrap:anywhere}code{font-family:monospace;font-size:10pt}.brand{font-size:9pt;letter-spacing:2px;color:#67776e;border-bottom:1px solid #b6c7bd;padding-bottom:12px;margin-bottom:24px}</style></head><body><div class="brand">ACADIA / RELEASER</div>${body.join("\n")}</body></html>`;
}
