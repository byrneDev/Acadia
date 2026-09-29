import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeProject, requestResearchModel } from "../src/main/analysis";
import { createDemoProject } from "../src/shared/project";
import type { AISettings } from "../src/shared/types";

const fixtureKey = "fixture-only-key-never-a-real-credential";
const privateMessage = `Provider diagnostic containing ${fixtureKey} and private-request-data.`;
const openai: AISettings = {
  provider: "compatible",
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: fixtureKey,
};
const messages = [{ role: "user", content: "Summarize saved evidence." }];

afterEach(() => vi.unstubAllGlobals());

function rejectWith(body: unknown, status = 429) {
  const network = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", network);
  return network;
}

async function errorMessage(request: Promise<unknown>): Promise<string> {
  const error: unknown = await request.then(
    () => undefined,
    (cause: unknown) => cause,
  );
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).not.toContain(fixtureKey);
  expect(message).not.toContain("private-request-data");
  expect(message).not.toContain(privateMessage);
  return message;
}

describe("OpenAI HTTP 429 guidance", () => {
  const accountLimits = [
    {
      code: "credit_balance_exhausted",
      semantics: [/credit|balance/i, /exhaust|empty|add|fund|top.?up/i],
    },
    {
      code: "organization_spend_limit_exceeded",
      semantics: [/organi[sz]ation/i, /spend|budget|billing/i, /limit|cap/i],
    },
    {
      code: "project_spend_limit_exceeded",
      semantics: [/project/i, /spend|budget|billing/i, /limit|cap/i],
    },
    {
      code: "organization_usage_limit_exceeded",
      semantics: [/organi[sz]ation/i, /usage/i, /limit|cap/i],
    },
    {
      code: "insufficient_quota",
      semantics: [/quota|credits|billing|balance/i],
    },
  ];

  it.each(accountLimits)(
    "explains $code as an account limit rather than a temporary request-rate limit",
    async ({ code, semantics }) => {
      const network = rejectWith({
        error: { code, type: "request_error", message: privateMessage },
      });
      const message = await errorMessage(
        requestResearchModel(openai, messages),
      );
      for (const meaning of semantics) expect(message).toMatch(meaning);
      expect(message).not.toMatch(/too many requests|slow down|per.minute/i);
      expect(network).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    { type: "insufficient_quota" },
    { code: null, type: "insufficient_quota" },
    { code: "unrecognized-provider-code", type: "insufficient_quota" },
  ])("recognizes quota from error.type: %j", async (details) => {
    rejectWith({ error: { ...details, message: privateMessage } });
    const message = await errorMessage(requestResearchModel(openai, messages));
    expect(message).toMatch(/quota|credits|billing|balance/i);
    expect(message).not.toContain("unrecognized-provider-code");
    expect(message).not.toMatch(/too many requests|slow down|per.minute/i);
  });

  it.each(["rate_limit_exceeded", "slow_down"])(
    "gives retry guidance for %s without claiming credits are exhausted",
    async (code) => {
      rejectWith({ error: { code, message: privateMessage } });
      const message = await errorMessage(
        requestResearchModel(openai, messages),
      );
      expect(message).toMatch(/rate|too many|slow down|request limit/i);
      expect(message).toMatch(/wait|retry|try again|later|reduce/i);
      expect(message).not.toMatch(
        /credits? (?:are |is )?exhausted|add credits|top.?up|spend limit exceeded/i,
      );
    },
  );

  it("also recognizes a rate-limit error.type", async () => {
    rejectWith({
      error: { type: "rate_limit_error", message: privateMessage },
    });
    const message = await errorMessage(requestResearchModel(openai, messages));
    expect(message).toMatch(/rate|too many|slow down|request limit/i);
    expect(message).toMatch(/wait|retry|try again|later|reduce/i);
    expect(message).not.toMatch(/billing|credits|quota/i);
  });

  it("uses a numeric Retry-After value as bounded retry guidance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "rate_limit_exceeded" } }),
            { status: 429, headers: { "Retry-After": "2.2" } },
          ),
      ),
    );
    const message = await errorMessage(requestResearchModel(openai, messages));
    expect(message).toMatch(/3 seconds/i);
  });

  it.each([
    fixtureKey,
    "-1",
    "0",
    "999999999999999999999999",
    "Wed, 01 Oct 2026 10:00:00 GMT",
  ])(
    "does not expose unsafe or unsupported Retry-After text: %s",
    async (retryAfter) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({ error: { code: "rate_limit_exceeded" } }),
              { status: 429, headers: { "Retry-After": retryAfter } },
            ),
        ),
      );
      const message = await errorMessage(
        requestResearchModel(openai, messages),
      );
      expect(message).toMatch(/wait|retry|try again/i);
      expect(message).not.toMatch(
        /at least -|Infinity|NaN|999999999999999999999999|Wed, 01 Oct/i,
      );
    },
  );

  it("does not expose an unknown error code or provider diagnostic", async () => {
    const unknownCode = `unknown-${fixtureKey}`;
    rejectWith({
      error: { code: unknownCode, type: "mystery", message: privateMessage },
    });
    const message = await errorMessage(requestResearchModel(openai, messages));
    expect(message).toMatch(/HTTP\s*429/i);
    expect(message).not.toContain(unknownCode);
    expect(message.length).toBeLessThan(1500);
  });
});

describe("bounded and provider-specific failures", () => {
  it.each([
    {
      provider: "compatible" as const,
      endpoint: "https://other-provider.example/v1",
    },
    {
      provider: "ollama" as const,
      endpoint: "http://127.0.0.1:11434",
    },
    {
      provider: "compatible" as const,
      endpoint: "https://api.openai.com.other-provider.example/v1",
    },
  ])(
    "does not attribute a non-OpenAI endpoint's 429 to OpenAI billing: $endpoint",
    async (provider) => {
      rejectWith({
        error: { code: "credit_balance_exhausted", message: privateMessage },
      });
      const message = await errorMessage(
        requestResearchModel({ ...openai, ...provider }, messages),
      );
      expect(message).toMatch(/HTTP\s*429/i);
      expect(message).not.toMatch(/OpenAI|platform\.openai\.com/i);
    },
  );

  it.each([
    [
      "malformed JSON",
      () => new Response(`{"error": ${privateMessage}`, { status: 429 }),
    ],
    [
      "HTML",
      () => new Response(`<html>${privateMessage}</html>`, { status: 429 }),
    ],
    ["empty body", () => new Response(null, { status: 429 })],
    [
      "unexpected JSON shape",
      () => new Response(JSON.stringify([privateMessage]), { status: 429 }),
    ],
    [
      "oversized streamed body",
      () =>
        new Response(
          JSON.stringify({
            error: {
              message: privateMessage + "x".repeat(1_000_001),
              code: "insufficient_quota",
            },
          }),
          { status: 429 },
        ),
    ],
    [
      "oversized declared body",
      () =>
        new Response(
          JSON.stringify({
            error: { code: "insufficient_quota", message: privateMessage },
          }),
          { status: 429, headers: { "Content-Length": "2000000" } },
        ),
    ],
  ] as const)(
    "keeps useful HTTP 429 guidance for %s",
    async (_label, response) => {
      const network = vi.fn(async () => response());
      vi.stubGlobal("fetch", network);
      const message = await errorMessage(
        requestResearchModel(openai, messages),
      );
      expect(message).toMatch(/HTTP\s*429/i);
      expect(message).toMatch(/retry|try|check|limit|provider|usage/i);
      expect(message).not.toMatch(/JSON|1 MB response limit/i);
      expect(message.length).toBeLessThan(1500);
      expect(network).toHaveBeenCalledTimes(1);
    },
  );

  it("does not turn an unrelated HTTP status into a billing diagnosis", async () => {
    rejectWith(
      { error: { code: "insufficient_quota", message: privateMessage } },
      503,
    );
    const message = await errorMessage(requestResearchModel(openai, messages));
    expect(message).toMatch(/HTTP\s*503/i);
    expect(message).not.toMatch(
      /credits? (?:are |is )?exhausted|add credits|top.?up/i,
    );
  });
});

describe("legacy board-generation error handling", () => {
  it.each([
    { code: "insufficient_quota", meaning: /quota|credits|billing|balance/i },
    {
      code: "rate_limit_exceeded",
      meaning: /rate|too many|slow down|request limit/i,
    },
  ])("keeps $code actionable in analyzeProject", async ({ code, meaning }) => {
    rejectWith({ error: { code, message: privateMessage } });
    const message = await errorMessage(
      analyzeProject(createDemoProject(), "hypothesis", "", openai),
    );
    expect(message).toMatch(meaning);
  });

  it("also redacts malformed provider diagnostics in analyzeProject", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(privateMessage, { status: 429 })),
    );
    const message = await errorMessage(
      analyzeProject(createDemoProject(), "hypothesis", "", openai),
    );
    expect(message).toMatch(/HTTP\s*429/i);
  });
});
