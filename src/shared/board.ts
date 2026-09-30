import type { ResearchCard } from "./types";

export const BOARD_REFERENCE_KINDS = [
  "brief",
  "source",
  "passage",
  "claim",
  "review",
  "assumption",
  "task",
  "method",
  "gap",
  "decision",
  "report",
  "delivery-plan",
] as const;
export interface BoardReference {
  kind: (typeof BOARD_REFERENCE_KINDS)[number];
  id: string;
  versionId?: string;
}

export function validateBoardReference(value: unknown): BoardReference {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a research record to place on the board.");
  const raw = value as Record<string, unknown>;
  const identifier = (entry: unknown): entry is string =>
    typeof entry === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(entry);
  if (
    !BOARD_REFERENCE_KINDS.includes(raw.kind as BoardReference["kind"]) ||
    !identifier(raw.id) ||
    (raw.versionId !== undefined &&
      (!identifier(raw.versionId) ||
        !["source", "passage"].includes(String(raw.kind)))) ||
    (raw.kind === "passage" && raw.versionId === undefined)
  )
    throw new Error("Invalid board reference or historical source version.");
  return {
    kind: raw.kind as BoardReference["kind"],
    id: raw.id,
    ...(raw.versionId ? { versionId: raw.versionId as string } : {}),
  };
}

export function isLinkedBoardCard(
  card: Pick<ResearchCard, "boardReference" | "methodId">,
): boolean {
  return Boolean(card.boardReference || card.methodId);
}

export function boardReferenceKey(reference: BoardReference): string {
  return `${reference.kind}:${reference.id}:${reference.versionId ?? ""}`;
}

/** A portable change indicator, not a cryptographic provenance guarantee. */
export function boardRecordSignature(record: unknown): string {
  const ordered = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(ordered)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(([, entry]) => entry !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, entry]) => [key, ordered(entry)]),
          )
        : value;
  const text = JSON.stringify(ordered(record)) ?? "null";
  let first = 0x811c9dc5,
    second = 0x9e3779b9;
  for (let index = 0; index < text.length; index++) {
    first = Math.imul(first ^ text.charCodeAt(index), 0x01000193);
    second = Math.imul(second ^ text.charCodeAt(index), 0x85ebca6b);
  }
  return `board-v1-${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
}
