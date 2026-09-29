import { describe, expect, it } from "vitest";
import { operationErrorMessage } from "../src/shared/ui-errors";

describe("renderer operation errors", () => {
  it("removes Electron's generate wrapper while retaining actionable grounding details", () => {
    expect(
      operationErrorMessage(
        new Error(
          "Error invoking remote method 'acadia:generate': Error: Grounding check failed: reference [2] has no verified source quotation.",
        ),
        "Generation failed.",
      ),
    ).toBe(
      "Grounding check failed: reference [2] has no verified source quotation.",
    );
  });
  it("handles nested wrappers and already-readable failures", () => {
    expect(
      operationErrorMessage(
        'Error: Error invoking remote method "acadia:export-output": Error: Choose a writable folder.',
        "Export failed.",
      ),
    ).toBe("Choose a writable folder.");
    expect(
      operationErrorMessage(
        new Error("AI provider returned HTTP 401. Check its credentials."),
        "Generation failed.",
      ),
    ).toBe("AI provider returned HTTP 401. Check its credentials.");
  });
  it("does not rewrite wrapper-like text inside the message", () => {
    const message =
      "The source contains: Error invoking remote method 'acadia:generate': Error: sample.";
    expect(operationErrorMessage(message, "Generation failed.")).toBe(message);
  });
  it("uses a clear fallback for absent or wrapper-only messages", () => {
    expect(operationErrorMessage(undefined, "Generation failed.")).toBe(
      "Generation failed.",
    );
    expect(
      operationErrorMessage(
        new Error("Error invoking remote method 'acadia:generate': Error: "),
        "Generation failed.",
      ),
    ).toBe("Generation failed.");
  });
});
