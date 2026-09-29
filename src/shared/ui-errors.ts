/** Keep the useful error message while removing Electron's transport wrapper. */
export function operationErrorMessage(
  cause: unknown,
  fallback: string,
): string {
  let message = (
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : ""
  ).trim();
  // Match only prefixes produced by our own IPC calls; never edit quoted source
  // material or a similarly worded phrase within the actual error message.
  for (let depth = 0; depth < 4; depth++) {
    const next = message
      .replace(/^Error:\s*/, "")
      .replace(/^Error invoking remote method (['"])acadia:[a-z-]+\1:\s*/, "")
      .replace(/^Error:\s*/, "")
      .trim();
    if (next === message) break;
    message = next;
  }
  return message || fallback;
}
