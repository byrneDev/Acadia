import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { RequestOptions } from "node:https";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import AdmZip from "adm-zip";
import type { AssetRecord } from "./storage";
import { externalURL } from "./storage";
import { contentHash, ResearchStore } from "./research-store";
import type {
  Passage,
  ResearchJob,
  SourceRecord,
  SourceVersion,
} from "../shared/research";

const date = () => new Date().toISOString();
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
export function publicAddress(address: string): boolean {
  const ip = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    return !(
      p[0] === 0 ||
      p[0] === 10 ||
      p[0] === 127 ||
      (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
      p[0] >= 224 ||
      (p[0] === 198 && (p[1] === 18 || p[1] === 19)) ||
      (p[0] === 192 && p[1] === 0) ||
      (p[0] === 198 && p[1] === 51 && p[2] === 100) ||
      (p[0] === 203 && p[1] === 0 && p[2] === 113)
    );
  }
  // Only globally routed IPv6 unicast; this excludes loopback, mapped IPv4,
  // link-local, unique-local, multicast and transition/service ranges.
  return (
    isIP(ip) === 6 &&
    /^[23]/.test(ip) &&
    !/^2001:(?:db8|0|10|20)(?::|$)/.test(ip) &&
    !/^2002:/.test(ip)
  );
}
export async function fetchPublicPage(
  value: string,
  signal: AbortSignal,
  redirects = 0,
): Promise<{ url: string; html: string }> {
  if (redirects > 5)
    throw new Error(
      "Too many website redirects. Import a manual excerpt or PDF instead.",
    );
  const url = new URL(externalURL(value));
  if (url.port && url.port !== "80" && url.port !== "443")
    throw new Error(
      "Only public websites on standard HTTP/HTTPS ports can be captured.",
    );
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    (!hostname.includes(".") && !isIP(hostname))
  )
    throw new Error("Private network sites cannot be captured.");
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookup(hostname, { all: true });
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
    throw new Error(
      "Private or reserved network addresses cannot be captured.",
    );
  if (signal.aborted) throw new Error("Cancelled");
  return new Promise((resolve, reject) => {
    const address = addresses[0];
    const options: RequestOptions = {
      method: "GET",
      headers: {
        "User-Agent": "Acadia/0.2 (research capture)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "identity",
      },
      signal,
      // DNS is pinned to the public address already checked, preventing rebinding.
      lookup: ((_host: unknown, opts: unknown, callback: unknown) => {
        const cb = callback as (...args: unknown[]) => void;
        if ((opts as { all?: boolean }).all) cb(null, [address]);
        else cb(null, address.address, address.family);
      }) as RequestOptions["lookup"],
    };
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      options,
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode ?? 0) &&
          response.headers.location
        ) {
          response.resume();
          fetchPublicPage(
            new URL(response.headers.location, url).href,
            signal,
            redirects + 1,
          ).then(resolve, reject);
          return;
        }
        if ((response.statusCode ?? 500) >= 400) {
          response.resume();
          reject(
            new Error(
              `Website returned ${response.statusCode}. Import a manual excerpt or PDF if sign-in is required.`,
            ),
          );
          return;
        }
        if (
          !/text\/html|application\/xhtml\+xml/i.test(
            String(response.headers["content-type"] ?? ""),
          )
        ) {
          response.resume();
          reject(
            new Error(
              "This URL is not an HTML page. Download and import the document instead.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > 10 * 1024 * 1024) {
            request.destroy(
              new Error("Website exceeds the 10 MB capture limit."),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            url: url.href,
            html: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.setTimeout(30000, () =>
      request.destroy(new Error("Website capture timed out.")),
    );
    request.on("error", reject);
    request.end();
  });
}

/** Parse an inert document: JSDOM does not execute scripts or load subresources. */
export function readableSnapshot(
  html: string,
  url: string,
): {
  title: string;
  author?: string;
  publisher?: string;
  publishedAt?: string;
  snapshot: string;
  paragraphs: string[];
} {
  const dom = new JSDOM(html, { url });
  try {
    const article = new Readability(dom.window.document, {
      maxElemsToParse: 50000,
      charThreshold: 80,
    }).parse();
    if (!article?.content || !article.textContent?.trim())
      throw new Error(
        "No readable article was found. Import a manual excerpt or PDF instead.",
      );
    const purify = createDOMPurify(dom.window);
    const snapshot = purify.sanitize(article.content, {
      ALLOWED_TAGS: [
        "p",
        "div",
        "section",
        "article",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "pre",
        "code",
        "strong",
        "em",
        "ul",
        "ol",
        "li",
        "table",
        "thead",
        "tbody",
        "tr",
        "td",
        "th",
        "br",
      ],
      ALLOWED_ATTR: [],
    });
    const reader = new JSDOM(snapshot);
    try {
      const paragraphs = Array.from(
        reader.window.document.querySelectorAll(
          "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,tr",
        ),
      )
        .filter((el) => !el.querySelector("p,li,blockquote,pre,tr"))
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "")
        .filter(Boolean);
      if (!paragraphs.length)
        paragraphs.push(reader.window.document.body.textContent?.trim() ?? "");
      return {
        title: article.title ?? new URL(url).hostname,
        author: article.byline ?? undefined,
        publisher: article.siteName ?? undefined,
        publishedAt: article.publishedTime ?? undefined,
        snapshot,
        paragraphs,
      };
    } finally {
      reader.window.close();
    }
  } finally {
    dom.window.close();
  }
}

interface Running {
  controller: AbortController;
  terminate?: () => Promise<unknown>;
  versionId?: string;
}
export class Ingestion {
  private running = new Map<string, Running>();
  private workQueue: (() => void)[] = [];
  private active = 0;
  private stopping = false;
  private completions = new Map<
    string,
    { promise: Promise<void>; resolve: () => void }
  >();
  async shutdown(options: { timeoutMs?: number } = {}): Promise<void> {
    this.stopping = true;
    const pending = [...this.completions.values()].map(
      (entry) => entry.promise,
    );
    for (const id of [...this.running.keys()]) this.cancelJob(id);
    const timeoutMs = options.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
      throw new Error("Invalid extraction shutdown timeout.");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.all(pending),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  "Extraction workers have not stopped. Keep Acadia open or retry shutdown; completed pages remain saved.",
                ),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private drain() {
    while (this.active < 2 && this.workQueue.length) {
      this.active++;
      setImmediate(this.workQueue.shift()!);
    }
  }
  constructor(
    private store: ResearchStore,
    private storageRoot: string,
    private assets: (id: string) => AssetRecord | undefined,
    private onChange: () => void = () => {},
  ) {}
  private makeJob(
    projectId: string,
    kind: ResearchJob["kind"],
    label: string,
    sourceId?: string,
  ): ResearchJob {
    if (this.stopping)
      throw new Error("Extraction is shutting down; no new jobs can start.");
    const job: ResearchJob = {
      id: randomUUID(),
      projectId,
      kind,
      label,
      sourceId,
      status: "queued",
      progress: 0,
      message: "Queued",
      createdAt: date(),
      updatedAt: date(),
    };
    this.store.saveJob(job);
    this.onChange();
    return job;
  }
  private update(job: ResearchJob, patch: Partial<ResearchJob>) {
    Object.assign(job, patch, { updatedAt: date() });
    this.store.saveJob(job);
    this.onChange();
  }
  private launch(job: ResearchJob, work: (running: Running) => Promise<void>) {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    this.completions.set(job.id, { promise, resolve });
    const running: Running = { controller: new AbortController() };
    if (job.sourceId) {
      const detail = this.store.getSource(job.sourceId);
      if (
        detail.versions.find((v) => v.id === detail.source.currentVersionId)
          ?.status === "queued"
      )
        running.versionId = detail.source.currentVersionId;
    }
    this.running.set(job.id, running);
    this.workQueue.push(
      () =>
        void (async () => {
          try {
            if (running.controller.signal.aborted) throw new Error("Cancelled");
            this.update(job, { status: "running", message: "Starting…" });
            await work(running);
            if (running.controller.signal.aborted) throw new Error("Cancelled");
            this.update(job, {
              status: "completed",
              progress: 1,
              message: "Complete",
            });
          } catch (error) {
            const cancelled = running.controller.signal.aborted;
            const message = cancelled
              ? "Cancelled. Completed pages remain available; retry creates a new immutable version."
              : error instanceof Error
                ? error.message
                : "Extraction failed.";
            this.update(job, {
              status: cancelled ? "cancelled" : "failed",
              message,
            });
            if (running.versionId)
              this.store.updateVersionStatus(running.versionId, {
                status: cancelled ? "cancelled" : "failed",
                error: message,
              });
            this.onChange();
          } finally {
            await running.terminate?.().catch(() => undefined);
            this.running.delete(job.id);
            this.active--;
            this.completions.get(job.id)?.resolve();
            this.completions.delete(job.id);
            this.drain();
          }
        })(),
    );
    this.drain();
  }
  cancelJob(id: string) {
    const running = this.running.get(id);
    if (running) {
      running.controller.abort();
      const job = this.store.getJob(id);
      if (job) this.update(job, { message: "Cancellation requested" });
      if (running.versionId)
        this.store.updateVersionStatus(running.versionId, {
          status: "cancelled",
          error: "Cancelled by researcher.",
        });
      void running.terminate?.().catch(() => undefined);
    } else {
      const job = this.store.getJob(id);
      if (job && (job.status === "queued" || job.status === "running"))
        this.update(job, { status: "cancelled", message: "Cancelled" });
    }
  }
  retry(id: string): ResearchJob {
    const job = this.store.getJob(id);
    if (!job) throw new Error("Job not found.");
    if (job.kind === "capture" && job.sourceId)
      return this.startCapture(
        job.projectId,
        this.store.getSource(job.sourceId).source.url!,
      );
    if (job.sourceId)
      return this.startFile(job.projectId, job.sourceId, job.kind === "ocr");
    throw new Error("This job cannot be retried as an import.");
  }
  startFile(projectId: string, sourceId: string, ocr = false): ResearchJob {
    const source = this.store.getSource(sourceId).source;
    if (source.derived)
      throw new Error(
        "Analytical board references are not importable source documents.",
      );
    if (source.projectId !== projectId)
      throw new Error("Source belongs to another project.");
    if (!source.assetId) {
      if (source.url) return this.startCapture(projectId, source.url, sourceId);
      throw new Error("This source has no original attachment.");
    }
    if (
      [...this.running.keys()].some(
        (id) => this.store.getJob(id)?.sourceId === sourceId,
      )
    )
      throw new Error("This source already has an active extraction job.");
    const asset = this.assets(source.assetId);
    if (!asset) throw new Error("Original attachment is missing.");
    const job = this.makeJob(
      projectId,
      ocr ? "ocr" : "extract",
      `${ocr ? "OCR" : "Read"} ${source.title}`,
      sourceId,
    );
    this.launch(job, async (running) => {
      const buffer = await readFile(
        join(this.storageRoot, "assets", asset.storedName),
      );
      if (running.controller.signal.aborted) throw new Error("Cancelled");
      const version: SourceVersion = {
        id: randomUUID(),
        sourceId,
        hash: contentHash(buffer),
        acquiredAt: date(),
        title: source.title,
        assetId: asset.id,
        status: "processing",
        method: ocr ? "ocr" : "native",
        totalUnits: 0,
        processedUnits: 0,
      };
      if (running.versionId)
        this.store.updateVersionStatus(running.versionId, {
          status: "cancelled",
          error:
            "Placeholder superseded by extraction from the original attachment.",
        });
      this.store.addVersion(version);
      running.versionId = version.id;
      const append = (
        text: string,
        unit: number,
        method: Passage["method"],
        locator: string,
      ) => {
        // Split oversized pages into anchored segments without discarding any text.
        for (let offset = 0; offset < text.length; offset += 4000) {
          const part = text.slice(offset, offset + 4000).trim();
          if (part)
            this.store.addPassage({
              id: randomUUID(),
              sourceId,
              versionId: version.id,
              text: part,
              locator:
                locator +
                (text.length > 4000
                  ? `, segment ${Math.floor(offset / 4000) + 1}`
                  : ""),
              ...(asset.mimeType === "application/pdf"
                ? { page: unit }
                : { paragraph: unit }),
              method,
              inclusion: "include",
            });
        }
      };
      if (asset.mimeType === "application/pdf") {
        const { CanvasFactory, getData } = await import("pdf-parse/worker");
        const { PDFParse } = await import("pdf-parse");
        PDFParse.setWorker(getData());
        const parser = new PDFParse({ data: buffer, CanvasFactory });
        let ocrWorker:
          | Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>
          | undefined;
        running.terminate = async () => {
          await ocrWorker?.terminate();
          await parser.destroy();
        };
        try {
          const info = await parser.getInfo();
          this.store.updateVersionMetadata(version.id, {
            title:
              typeof info.info?.Title === "string" &&
              info.info.Title.length <= 500 &&
              !/^data:/i.test(info.info.Title)
                ? info.info.Title
                : undefined,
            author:
              typeof info.info?.Author === "string"
                ? info.info.Author
                : undefined,
            publishedAt:
              typeof info.info?.CreationDate === "string"
                ? info.info.CreationDate
                : undefined,
          });
          version.totalUnits = info.total;
          let missing = 0;
          this.store.updateVersionStatus(version.id, {
            totalUnits: info.total,
          });
          for (let page = 1; page <= info.total; page++) {
            if (running.controller.signal.aborted) throw new Error("Cancelled");
            let text =
              (
                await parser.getText({ partial: [page], pageJoiner: "" })
              ).pages[0]?.text.trim() ?? "";
            let method: Passage["method"] = "native";
            if (ocr && !text) {
              ocrWorker ??= await this.ocrWorker();
              const screenshot = (
                await parser.getScreenshot({
                  partial: [page],
                  scale: 2,
                  imageDataUrl: false,
                  imageBuffer: true,
                })
              ).pages[0];
              if (!screenshot)
                throw new Error(`Could not render page ${page} for OCR.`);
              text = (
                await ocrWorker.recognize(Buffer.from(screenshot.data))
              ).data.text.trim();
              method = "ocr";
            }
            if (!text) missing++;
            else
              append(
                text,
                page,
                method,
                `Page ${page}${method === "ocr" ? " (OCR)" : ""}`,
              );
            version.processedUnits = page;
            this.store.updateVersionStatus(version.id, {
              processedUnits: page,
            });
            this.update(job, {
              progress: page / info.total,
              message: `${ocr ? "Reading/OCR" : "Reading"} page ${page} of ${info.total}${missing ? `; ${missing} without recognized text` : ""}`,
            });
            await tick();
          }
          this.store.updateVersionStatus(version.id, {
            status: missing ? (ocr ? "partial" : "needs-ocr") : "ready",
            error: missing
              ? `${missing} of ${info.total} pages contain no recognized text. ${ocr ? "They may be blank or unreadable; review originals." : "Run local OCR and review originals."}`
              : undefined,
          });
        } finally {
          await running.terminate?.();
          running.terminate = undefined;
        }
      } else if (asset.mimeType.startsWith("image/")) {
        if (!ocr) {
          this.store.updateVersionStatus(version.id, {
            status: "needs-ocr",
            totalUnits: 1,
            error: "Run local OCR to recognize text in this image.",
          });
          return;
        }
        const worker = await this.ocrWorker();
        running.terminate = () => worker.terminate();
        const text = (await worker.recognize(buffer)).data.text.trim();
        append(text, 1, "ocr", "Image text (OCR)");
        this.store.updateVersionStatus(version.id, {
          status: text ? "ready" : "partial",
          totalUnits: 1,
          processedUnits: 1,
          error: text
            ? undefined
            : "No text was recognized. Review the original image.",
        });
      } else {
        let paragraphs: string[];
        if (extname(asset.fileName).toLowerCase() === ".docx") {
          const archive = new AdmZip(buffer);
          const core = archive.getEntry("docProps/core.xml");
          if (core && core.header.size <= 1_000_000) {
            const metadata = new JSDOM(core.getData().toString("utf8"), {
              contentType: "application/xml",
            });
            try {
              const text = (name: string) =>
                metadata.window.document
                  .getElementsByTagName(name)[0]
                  ?.textContent?.trim() || undefined;
              this.store.updateVersionMetadata(version.id, {
                title: text("dc:title"),
                author: text("dc:creator"),
                publishedAt: text("dcterms:created"),
              });
            } finally {
              metadata.window.close();
            }
          }
          const mammoth = await import("mammoth");
          const converted = await mammoth.convertToHtml({ buffer });
          const document = new JSDOM(converted.value);
          try {
            paragraphs = Array.from(
              document.window.document.querySelectorAll(
                "p,h1,h2,h3,h4,h5,h6,li,td",
              ),
            )
              .filter((el) => !el.querySelector("p,li"))
              .map((el) => el.textContent?.trim() ?? "");
          } finally {
            document.window.close();
          }
        } else if (
          asset.mimeType.startsWith("text/") ||
          [".json", ".csv", ".tsv", ".md", ".txt"].includes(
            extname(asset.fileName).toLowerCase(),
          )
        )
          paragraphs = buffer.toString("utf8").split(/\r?\n\s*\r?\n/);
        else
          throw new Error(
            "This attachment format has no text extractor. Keep the original and add a manual source note.",
          );
        this.store.updateVersionStatus(version.id, {
          totalUnits: paragraphs.length,
        });
        for (let i = 0; i < paragraphs.length; i++) {
          if (running.controller.signal.aborted) throw new Error("Cancelled");
          append(paragraphs[i], i + 1, "native", `Paragraph ${i + 1}`);
          if (i % 25 === 0 || i === paragraphs.length - 1) {
            this.store.updateVersionStatus(version.id, {
              processedUnits: i + 1,
            });
            this.update(job, {
              progress: (i + 1) / paragraphs.length,
              message: `Reading paragraph ${i + 1} of ${paragraphs.length}`,
            });
            await tick();
          }
        }
        const hasText = paragraphs.some((p) => p.trim());
        this.store.updateVersionStatus(version.id, {
          status: hasText ? "ready" : "partial",
          processedUnits: paragraphs.length,
          error: hasText ? undefined : "Document contains no extractable text.",
        });
      }
      job.result = { sourceId, versionId: version.id };
    });
    return job;
  }
  private async ocrWorker() {
    const { createWorker, OEM } = await import("tesseract.js");
    // Package-local English data prevents Tesseract's normal CDN fallback.
    const language = await import("@tesseract.js-data/eng");
    return createWorker("eng", OEM.LSTM_ONLY, {
      langPath: language.langPath,
      cacheMethod: "none",
      gzip: true,
    });
  }
  captureUrl(projectId: string, url: string) {
    return this.startCapture(projectId, url);
  }
  startCapture(
    projectId: string,
    value: string,
    existingSourceId?: string,
  ): ResearchJob {
    const url = externalURL(value);
    const project = this.store.getProject(projectId);
    if (!project) throw new Error("Project not found.");
    const source: SourceRecord = existingSourceId
      ? this.store.getSource(existingSourceId).source
      : {
          id: randomUUID(),
          projectId,
          title: new URL(url).hostname,
          kind: "web",
          url,
          currentVersionId: "",
          inclusion: "include",
          createdAt: date(),
          updatedAt: date(),
        };
    if (source.derived)
      throw new Error(
        "Analytical board references cannot be captured as independent evidence.",
      );
    if (source.projectId !== projectId)
      throw new Error("Source belongs to another project.");
    if (
      [...this.running.keys()].some(
        (id) => this.store.getJob(id)?.sourceId === source.id,
      )
    )
      throw new Error("This source already has an active capture job.");
    if (!existingSourceId) {
      const version: SourceVersion = {
        id: randomUUID(),
        sourceId: source.id,
        hash: contentHash(url + date()),
        acquiredAt: date(),
        title: source.title,
        url,
        status: "queued",
        method: "native",
        totalUnits: 0,
        processedUnits: 0,
      };
      this.store.saveSource(source);
      this.store.addVersion(version);
      source.currentVersionId = version.id;
    }
    const job = this.makeJob(projectId, "capture", `Capture ${url}`, source.id);
    this.launch(job, async (running) => {
      if (!existingSourceId) running.versionId = source.currentVersionId;
      this.update(job, { message: "Fetching public website…", progress: 0.1 });
      const response = await fetchPublicPage(url, running.controller.signal);
      if (running.controller.signal.aborted) throw new Error("Cancelled");
      const article = readableSnapshot(response.html, response.url);
      const version: SourceVersion = {
        id: randomUUID(),
        sourceId: source.id,
        hash: contentHash(article.snapshot),
        acquiredAt: date(),
        title: article.title,
        author: article.author,
        publisher: article.publisher,
        publishedAt: article.publishedAt,
        url: response.url,
        status: "processing",
        method: "native",
        totalUnits: article.paragraphs.length,
        processedUnits: 0,
        snapshot: article.snapshot,
      };
      this.store.addVersion(version);
      running.versionId = version.id;
      for (let i = 0; i < article.paragraphs.length; i++) {
        if (running.controller.signal.aborted) throw new Error("Cancelled");
        for (
          let offset = 0;
          offset < article.paragraphs[i].length;
          offset += 4000
        ) {
          const part = article.paragraphs[i]
            .slice(offset, offset + 4000)
            .trim();
          if (part)
            this.store.addPassage({
              id: randomUUID(),
              sourceId: source.id,
              versionId: version.id,
              text: part,
              locator:
                `Paragraph ${i + 1}` +
                (article.paragraphs[i].length > 4000
                  ? `, segment ${Math.floor(offset / 4000) + 1}`
                  : ""),
              paragraph: i + 1,
              method: "native",
              inclusion: "include",
            });
        }
        if (i % 25 === 0 || i === article.paragraphs.length - 1) {
          this.store.updateVersionStatus(version.id, { processedUnits: i + 1 });
          this.update(job, {
            progress: 0.2 + (0.8 * (i + 1)) / article.paragraphs.length,
            message: `Saving paragraph ${i + 1} of ${article.paragraphs.length}`,
          });
          await tick();
        }
      }
      this.store.updateVersionStatus(version.id, {
        status: "ready",
        processedUnits: article.paragraphs.length,
      });
      this.store.saveSource({
        ...this.store.getSource(source.id).source,
        title: article.title,
        url: response.url,
        updatedAt: date(),
      });
      const latest = this.store.getProject(projectId)!;
      const card = latest.cards.find((c) => c.sourceId === source.id);
      if (card) {
        card.title = article.title;
        card.url = response.url;
        card.updatedAt = date();
        latest.updatedAt = date();
        this.store.saveProject(latest);
      }
      job.result = { sourceId: source.id, versionId: version.id };
    });
    return job;
  }
}
