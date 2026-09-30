import type { Passage } from "../../shared/research";
import {
  readDraftBuffer,
  writeDraftBuffer,
  clearDraftBuffer,
} from "./durableDrafts";

export interface BoardViewport {
  x: number;
  y: number;
  zoom: number;
}
const boardKey = (projectId: string) => `acadia.board.viewport.v1.${projectId}`;
export function parseBoardViewport(
  value: string | null,
): BoardViewport | undefined {
  try {
    const v = value ? JSON.parse(value) : undefined;
    if (
      v &&
      typeof v.x === "number" &&
      Number.isFinite(v.x) &&
      typeof v.y === "number" &&
      Number.isFinite(v.y) &&
      typeof v.zoom === "number" &&
      Number.isFinite(v.zoom) &&
      v.zoom >= 0.12 &&
      v.zoom <= 2.5
    )
      return { x: v.x, y: v.y, zoom: v.zoom };
  } catch {
    /* Invalid local preferences must never prevent a project opening. */
  }
  return undefined;
}
export function readBoardViewport(
  projectId: string,
): BoardViewport | undefined {
  try {
    return parseBoardViewport(localStorage.getItem(boardKey(projectId)));
  } catch {
    return undefined;
  }
}
export function saveBoardViewport(projectId: string, viewport: BoardViewport) {
  try {
    localStorage.setItem(boardKey(projectId), JSON.stringify(viewport));
  } catch {
    /* Research saves remain independent of optional view preferences. */
  }
}

export const PASSAGES_PER_PAGE = 40;
export function passagePage(
  passages: Pick<Passage, "id">[],
  passageId?: string,
) {
  const index = passageId ? passages.findIndex((p) => p.id === passageId) : -1;
  return index < 0 ? 0 : Math.floor(index / PASSAGES_PER_PAGE);
}
export function clampPassagePage(page: number, length: number) {
  return Math.max(
    0,
    Math.min(
      Math.max(0, Math.ceil(length / PASSAGES_PER_PAGE) - 1),
      Math.floor(page) || 0,
    ),
  );
}
export interface EvidenceDraft {
  passage: Passage;
  quote: string;
  claimId: string;
  title: string;
  relation: "supports" | "contradicts" | "context";
  rationale: string;
}
// In-memory fallbacks accompany the private durable editing buffers.
// They never create evidence or an accepted review.
const evidenceDrafts = new Map<string, EvidenceDraft>();
const evidenceDraftKey = (
  projectId: string,
  sourceId: string,
  versionId: string,
) => JSON.stringify([projectId, sourceId, versionId]);
export function readEvidenceDraft(
  projectId: string,
  sourceId: string,
  versionId: string,
) {
  return (
    readDraftBuffer<EvidenceDraft>(
      projectId,
      `evidence:${sourceId}:${versionId}`,
    ) || evidenceDrafts.get(evidenceDraftKey(projectId, sourceId, versionId))
  );
}
export function saveEvidenceDraft(
  projectId: string,
  sourceId: string,
  versionId: string,
  draft?: EvidenceDraft,
) {
  const key = evidenceDraftKey(projectId, sourceId, versionId);
  if (draft) evidenceDrafts.set(key, draft);
  else evidenceDrafts.delete(key);
  if (typeof window !== "undefined" && window.acadia?.saveResearchDraft) {
    if (draft)
      writeDraftBuffer(
        projectId,
        `evidence:${sourceId}:${versionId}`,
        "source-evidence",
        draft,
      );
    else
      void clearDraftBuffer(
        projectId,
        `evidence:${sourceId}:${versionId}`,
      ).catch(() => {});
  }
}

export interface ResearchTextDraft {
  query: string;
  url: string;
  question: string;
  queries: string;
}
const researchTextDrafts = new Map<string, ResearchTextDraft>();
export function readResearchTextDraft(projectId: string) {
  return (
    readDraftBuffer<ResearchTextDraft>(projectId, "research-text") ||
    researchTextDrafts.get(projectId)
  );
}
export function saveResearchTextDraft(
  projectId: string,
  draft: ResearchTextDraft,
) {
  // Keep only unsent text. Keys, responses, and discovery approvals never enter this cache.
  researchTextDrafts.set(projectId, {
    query: draft.query,
    url: draft.url,
    question: draft.question,
    queries: draft.queries,
  });
  if (typeof window !== "undefined" && window.acadia?.saveResearchDraft)
    writeDraftBuffer(
      projectId,
      "research-text",
      "inquiry-text",
      researchTextDrafts.get(projectId)!,
    );
}

/** Drop only fallback buffers after a successful same-ID archive replacement. */
export function clearWorkspaceDraftFallbacks(projectId: string) {
  researchTextDrafts.delete(projectId);
  for (const key of evidenceDrafts.keys())
    if ((JSON.parse(key) as string[])[0] === projectId)
      evidenceDrafts.delete(key);
}
