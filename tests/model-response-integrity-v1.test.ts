import { expect, it } from "vitest";
import { validateCitedMarkdown } from "../src/main/research-service";
import fixture from "./fixtures/model-response-integrity-v1.json";
import type { Citation } from "../src/shared/research";
const available = fixture.cases[0].available as Citation[];
it("rejects exact live-model appraisal UUID references instead of accepting them as citations", () => {
  const response = fixture.cases.find((c) => c.kind === "decision-brief")!;
  expect(() =>
    validateCitedMarkdown(response.raw, response.available as Citation[]),
  ).toThrow(/record identifier/);
});
it("rejects the exact live-model escaped-newline and JSON-wrapper body", () => {
  const response = fixture.cases.find((c) => c.kind === "answer")!;
  expect(() => JSON.parse(response.raw)).not.toThrow();
  expect(() =>
    validateCitedMarkdown(response.raw, response.available as Citation[]),
  ).toThrow(/malformed draft body/);
});
it("never salvages malformed or truncated JSON into a report", () => {
  for (const raw of [
    '{"markdown":"An assertion [1]"',
    '{"markdown":"unescaped\nnewline [1]"}',
    'prefix {"markdown":"An assertion [1]"}',
  ])
    expect(() => validateCitedMarkdown(raw, available)).toThrow(
      /structured response/,
    );
});
it("preserves ordinary Markdown links, reference links, images and code while validating actual citations", () => {
  const uuid = "2835b239-88aa-4d1e-9c9a-6dfe4acf75a3";
  const markdown = `Limited observation [1]. See [${uuid}](https://example.com/record) and [999](https://example.com/number).\n\n[${uuid}][record]\n\n[record]: https://example.com/record\n\nLiteral code: \`[${uuid}]\\n\\n\`.\n\n\`\`\`json\n{"markdown":"example"}\n\`\`\`\n\n![999](https://example.com/image.png)`;
  const result = validateCitedMarkdown(JSON.stringify({ markdown }), available);
  expect(result.markdown).toBe(markdown);
  expect(result.citations.map((c) => c.label)).toEqual(["1"]);
});
it("rejects naked source record IDs, but parses ordinary JSON line escapes correctly", () => {
  expect(() =>
    validateCitedMarkdown(
      JSON.stringify({
        markdown: `Limited observation [${available[0].sourceId}] [1].`,
      }),
      available,
    ),
  ).toThrow(/record identifier/);
  const markdown = "## Summary\n\nLimited observation [1].";
  expect(
    validateCitedMarkdown(JSON.stringify({ markdown }), available).markdown,
  ).toBe(markdown);
});
