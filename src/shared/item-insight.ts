import type { Citation } from "./research";

/** An explicit request to review one collected item, never the whole board. */
export interface ItemInsightTarget {
  kind: "card" | "source";
  id: string;
  versionId?: string;
}

export interface ItemInsight {
  id: string;
  runId: string;
  target: ItemInsightTarget;
  itemTitle: string;
  question: string;
  markdown: string;
  citations: Citation[];
  createdAt: string;
  provider: string;
  model: string;
  cardUpdatedAt?: string;
  sourceId?: string;
  versionId?: string;
  methodRevision?: number;
  briefRevision?: number;
  boardRecordSignature?: string;
  coverage: {
    availablePassages: number;
    selectedPassages: number;
    processedUnits: number;
    totalUnits: number;
    status: string;
    warnings: string[];
  };
}

export interface ItemInsightAcceptance {
  runId: string;
  notes: string;
}

/** Explicit researcher acceptance; this is interpretation, not a new source. */
export interface ItemInsightReview {
  runId: string;
  insightId: string;
  target: ItemInsightTarget;
  acceptedAt: string;
  notes: string;
  citations: Citation[];
  sourceId?: string;
  versionId?: string;
}

export function validateItemInsightTarget(value: unknown): ItemInsightTarget {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Choose a collected item to summarize.");
  const v = value as Record<string, unknown>;
  const id = (entry: unknown): entry is string =>
    typeof entry === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(entry);
  if (
    !["card", "source"].includes(String(v.kind)) ||
    !id(v.id) ||
    (v.versionId !== undefined && !id(v.versionId))
  )
    throw new Error("Invalid collected item or source version.");
  return {
    kind: v.kind as ItemInsightTarget["kind"],
    id: v.id,
    ...(v.versionId === undefined ? {} : { versionId: v.versionId as string }),
  };
}
