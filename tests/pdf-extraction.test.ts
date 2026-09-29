import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPDFText } from "../src/main/pdf-extraction";

describe("PDF text capture", () => {
  it("extracts readable research text from a PDF with an embedded open-license font", async () => {
    const data = await readFile(
      join(process.cwd(), "tests/fixtures/chromium-text.pdf"),
    );
    const text = await extractPDFText(data);
    expect(text).toContain("Experiment brief");
    expect(text).toContain(
      "A comparison group is required before attributing the improvement",
    );
    expect(text).not.toContain("could not be extracted");
  }, 30000);

  it("rejects a malformed file so import can keep the original with an extraction notice", async () => {
    await expect(
      extractPDFText(Buffer.from("This is not a PDF document.")),
    ).rejects.toThrow();
  });
});
