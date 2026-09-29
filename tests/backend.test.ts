import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestResearchModel } from "../src/main/analysis";
import type { AISettings } from "../src/shared/types";
import {
  assetRecord,
  atomicWrite,
  escapeHTML,
  externalURL,
  fileType,
  MAX_ASSET_BYTES,
  outputHTML,
  readJSON,
  safeAssetId,
  safeFileName,
} from "../src/main/storage";

const ID = "698b56f5-adb2-44ce-b0b3-3fb7c851f5c6";
const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("local research model requests", () => {
  const ollama: AISettings = {
    provider: "ollama",
    endpoint: "http://127.0.0.1:11434",
    model: "qwen3.5:9b",
  };
  const messages = [{ role: "user", content: "Return a short JSON answer." }];
  function respond(payload: unknown) {
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) =>
      Response.json(payload),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("disables Ollama thinking and reserves an explicit context for concise query expansion", async () => {
    const fetchMock = respond({
      message: { content: '{"support":["hours"]}' },
    });
    await expect(
      requestResearchModel(ollama, messages, undefined, {
        maxTokens: 384,
        timeoutMs: 45_000,
      }),
    ).resolves.toBe('{"support":["hours"]}');
    const request = fetchMock.mock.calls[0][1]!;
    expect(JSON.parse(request.body as string)).toMatchObject({
      model: "qwen3.5:9b",
      messages,
      format: "json",
      stream: false,
      think: false,
      options: { num_predict: 384, num_ctx: 8192, temperature: 0.2 },
    });
    expect(request.redirect).toBe("error");
  });

  it("budgets multibyte passage text and the full response above the old 4K context", async () => {
    const fetchMock = respond({ message: { content: '{"markdown":"Done"}' } });
    await requestResearchModel(ollama, [
      { role: "user", content: "é".repeat(8000) },
    ]);
    expect(
      JSON.parse(fetchMock.mock.calls[0][1]!.body as string).options,
    ).toEqual({
      num_predict: 4096,
      num_ctx: 24576,
      temperature: 0.2,
    });
  });

  it("passes an explicit report schema to Ollama without altering the prompt", async () => {
    const fetchMock = respond({
      message: { content: '{"markdown":"Done [1]."}' },
    });
    const jsonSchema = {
      type: "object",
      properties: { markdown: { type: "string", minLength: 1 } },
      required: ["markdown"],
      additionalProperties: false,
    } as const;
    await requestResearchModel(ollama, messages, undefined, { jsonSchema });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.format).toEqual(jsonSchema);
    expect(body.messages).toEqual(messages);
    expect(body.think).toBe(false);
    expect(body).not.toHaveProperty("response_format");
  });

  it("reserves local context for multibyte schema content as well as messages", async () => {
    const fetchMock = respond({ message: { content: '{"markdown":"Done"}' } });
    await requestResearchModel(ollama, messages, undefined, {
      jsonSchema: { type: "object", description: "é".repeat(8000) },
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body.options.num_ctx).toBe(24576);
  });

  it("rejects an oversized schema before starting local model work", async () => {
    const fetchMock = respond({ message: { content: "unused" } });
    await expect(
      requestResearchModel(ollama, messages, undefined, {
        jsonSchema: { type: "object", description: "x".repeat(61_000) },
      }),
    ).rejects.toThrow(/safe context budget of 65,536/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a nonserializable local schema before sending a request", async () => {
    const fetchMock = respond({ message: { content: "unused" } });
    const jsonSchema: Record<string, unknown> = { type: "object" };
    jsonSchema.properties = jsonSchema;
    await expect(
      requestResearchModel(ollama, messages, undefined, { jsonSchema }),
    ).rejects.toThrow(/schema must be JSON serializable/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not require structured-output support from compatible endpoints", async () => {
    const fetchMock = respond({
      choices: [{ message: { content: '{"markdown":"Done"}' } }],
    });
    await requestResearchModel(
      {
        provider: "compatible",
        endpoint: "https://example.com/v1",
        model: "test",
      },
      messages,
      undefined,
      { jsonSchema: { type: "object", description: "x".repeat(70_000) } },
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    expect(body).not.toHaveProperty("format");
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("options");
    expect(body.messages).toEqual(messages);
  });

  it("rejects an oversized local prompt before sending evidence to the model", async () => {
    const fetchMock = respond({ message: { content: "unused" } });
    await expect(
      requestResearchModel(ollama, [
        { role: "user", content: "x".repeat(61_000) },
      ]),
    ).rejects.toThrow(/safe context budget of 65,536/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(["length", "max_tokens"])(
    "rejects a truncated Ollama response (%s) even when its JSON is readable",
    async (done_reason) => {
      respond({ message: { content: '{"markdown":"Partial"}' }, done_reason });
      await expect(requestResearchModel(ollama, messages)).rejects.toThrow(
        /incomplete.*output limit/,
      );
    },
  );

  it("retains compatible-provider credentials only in headers and excludes Ollama options", async () => {
    const apiKey = "test-secret-not-for-the-prompt";
    const fetchMock = respond({
      choices: [{ message: { content: '{"markdown":"Complete"}' } }],
    });
    await requestResearchModel(
      {
        provider: "compatible",
        endpoint: "https://api.openai.com/v1",
        model: "test-model",
        apiKey,
      },
      messages,
    );
    const request = fetchMock.mock.calls[0][1]!;
    const body = JSON.parse(request.body as string);
    expect(body).toMatchObject({ max_completion_tokens: 4096, store: false });
    expect(body).not.toHaveProperty("think");
    expect(body).not.toHaveProperty("options");
    expect(body).not.toHaveProperty("max_tokens");
    expect(request.body).not.toContain(apiKey);
    expect(request.headers).toMatchObject({
      Authorization: `Bearer ${apiKey}`,
    });
  });

  it("rejects compatible-provider responses that hit their token limit", async () => {
    respond({
      choices: [
        {
          message: { content: '{"markdown":"Partial"}' },
          finish_reason: "length",
        },
      ],
    });
    await expect(
      requestResearchModel(
        {
          provider: "compatible",
          endpoint: "https://example.com/v1",
          model: "test",
        },
        messages,
      ),
    ).rejects.toThrow(/incomplete/);
  });

  it("discards returned credentials without exposing them in its error", async () => {
    const apiKey = "test-secret-not-for-output";
    respond({ message: { content: `An unsafe response: ${apiKey}` } });
    await expect(
      requestResearchModel({ ...ollama, apiKey }, messages),
    ).rejects.toThrow(
      "The provider returned credential material; its response was discarded.",
    );
  });

  it("enforces the short expansion timeout instead of waiting for the full local report budget", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: RequestInit) =>
          new Promise((_resolve, reject) =>
            init!.signal!.addEventListener("abort", () =>
              reject(new Error("aborted")),
            ),
          ),
      ),
    );
    const result = requestResearchModel(ollama, messages, undefined, {
      maxTokens: 384,
      timeoutMs: 45_000,
    });
    const assertion = expect(result).rejects.toThrow(
      /timed out after 45 seconds/,
    );
    await vi.advanceTimersByTimeAsync(45_000);
    await assertion;
  });

  it("does not send a request when cancellation was already requested", async () => {
    const fetchMock = respond({ message: { content: "unused" } });
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestResearchModel(ollama, messages, controller.signal),
    ).rejects.toThrow(/cancelled/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("local workspace storage", () => {
  it("atomically replaces a longer save and leaves no temporary files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acadia-storage-"));
    directories.push(directory);
    const path = join(directory, "workspace.json");
    await atomicWrite(path, JSON.stringify({ content: "a".repeat(10_000) }));
    await atomicWrite(path, JSON.stringify({ content: "short" }));
    expect(await readJSON(path)).toEqual({ content: "short" });
    expect(await readdir(directory)).toEqual(["workspace.json"]);
    if (process.platform !== "win32")
      expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("distinguishes a missing save from corrupted JSON", async () => {
    const directory = await mkdtemp(join(tmpdir(), "acadia-storage-"));
    directories.push(directory);
    const path = join(directory, "workspace.json");
    expect(await readJSON(path)).toBeUndefined();
    await atomicWrite(path, "{broken");
    await expect(readJSON(path)).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe("{broken");
  });
});

describe("attachment boundaries", () => {
  it("derives internal paths and MIME from a validated ID and extension", () => {
    expect(assetRecord(ID, "Research.PDF", 42)).toEqual({
      id: ID,
      fileName: "Research.PDF",
      storedName: `${ID}.pdf`,
      mimeType: "application/pdf",
      size: 42,
    });
    expect(fileType("Interview.mp3").kind).toBe("audio");
  });

  it("rejects path traversal, executable types, invalid size, and malformed IDs", () => {
    expect(() => safeAssetId("../../secrets")).toThrow();
    expect(() => assetRecord(ID, "../secrets.pdf", 10)).toThrow();
    expect(() => assetRecord(ID, "script.js", 10)).toThrow();
    expect(() => assetRecord(ID, "paper.pdf", MAX_ASSET_BYTES + 1)).toThrow();
    expect(() => assetRecord(ID, "paper.pdf", -1)).toThrow();
    expect(() => assetRecord(ID, "paper.pdf", NaN)).toThrow();
  });
});

describe("external navigation and output escaping", () => {
  it("permits only credential-free HTTP links", () => {
    expect(externalURL("https://example.com/research?q=connections")).toBe(
      "https://example.com/research?q=connections",
    );
    for (const link of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "data:text/html,hi",
      "https://user:secret@example.com",
      "relative/link",
    ]) {
      expect(() => externalURL(link)).toThrow();
    }
  });

  it("prints source HTML as text and retains readable Markdown headings", () => {
    const html = outputHTML(
      "<script>title</script>",
      "# Findings\n\n<script>alert(1)</script>\n\n**Evidence** and `code`\n\n```\n<img src=x onerror=alert(1)>\n```",
    );
    expect(html).toContain("<h1>Findings</h1>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("<strong>Evidence</strong>");
    expect(html).toContain("default-src 'none'");
    expect(escapeHTML(`"'&<>`)).toBe("&quot;&#39;&amp;&lt;&gt;");
  });

  it("keeps export filenames local and portable", () => {
    expect(safeFileName("../../Research: evidence?")).toBe(
      "..-..-Research- evidence-",
    );
    expect(safeFileName("...")).toBe("Acadia");
  });
});
