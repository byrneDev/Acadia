import type { BoardReference } from "../../shared/board";
import type { PedigreeState } from "../../shared/pedigree";
import type { Passage, ResearchState } from "../../shared/research";
import type { Project, ResearchCard } from "../../shared/types";

export const boardLabels: Record<BoardReference["kind"], string> = {
  brief: "Research brief",
  source: "Source",
  passage: "Source passage",
  claim: "Finding / claim",
  review: "Accepted Reviewer Notes",
  assumption: "Assumption",
  task: "Research task",
  method: "Research method",
  gap: "Research gap",
  decision: "Decision",
  report: "Report",
  "delivery-plan": "Deliverable project plan",
};
export interface BoardPresentation {
  card: ResearchCard;
  reference?: BoardReference;
  label: string;
  status: string;
  unavailable: boolean;
  historical: boolean;
}
export function presentBoardCard(
  card: ResearchCard,
  project: Project,
  research: ResearchState,
  pedigree: PedigreeState | undefined,
  passages: Record<string, Passage | null>,
): BoardPresentation {
  const reference =
    card.boardReference ||
    (card.methodId
      ? { kind: "method" as const, id: card.methodId }
      : undefined);
  const base = {
    card,
    reference,
    label: reference ? boardLabels[reference.kind] : card.kind,
    status: card.status as string,
    unavailable: false,
    historical: false,
  };
  if (!reference) return base;
  const { kind, id } = reference;
  const result = (
    title: string,
    content: string,
    status: string,
    historical = false,
  ) => ({
    ...base,
    card: { ...card, title, content },
    status,
    historical,
  });
  const pending = () =>
    result(
      card.title || boardLabels[kind],
      "Opening linked research record…",
      "Loading",
    );
  if (
    ["brief", "assumption", "method", "gap", "decision"].includes(kind) &&
    !pedigree
  )
    return pending();
  if (kind === "brief") {
    const record = pedigree?.briefs.find((v) => v.id === id);
    if (record)
      return result(
        record.question || "Research brief",
        record.scope || record.decision,
        record.reviewStatus,
      );
  } else if (kind === "source") {
    const record = research.sources.find((v) => v.id === id);
    const version = research.versions.find(
      (v) => v.id === (reference.versionId || record?.currentVersionId),
    );
    if (record && version)
      return result(
        version.title,
        `${record.kind} · ${version.processedUnits}/${version.totalUnits} units extracted`,
        version.status,
        Boolean(
          reference.versionId &&
          reference.versionId !== record.currentVersionId,
        ),
      );
  } else if (kind === "passage") {
    const record = passages[id];
    if (record === undefined) return pending();
    const version = research.versions.find((v) => v.id === reference.versionId);
    const source = research.sources.find((v) => v.id === record?.sourceId);
    if (record && version && record.versionId === reference.versionId)
      return result(
        `${version.title} · ${record.locator}`,
        record.text,
        record.method === "ocr" ? "OCR passage" : "Saved passage",
        source?.currentVersionId !== reference.versionId,
      );
  } else if (kind === "claim" || kind === "review") {
    const record = research.claims.find((v) => v.id === id);
    if (record && (kind !== "review" || record.itemReview)) {
      const review = record.itemReview;
      const source = research.sources.find((v) => v.id === review?.sourceId);
      return result(
        record.title,
        kind === "review"
          ? review!.notes
          : pedigree?.findings.find((v) => v.claimId === id)?.reasoning ||
              record.limitations ||
              record.question,
        kind === "review" ? "Human accepted" : record.status,
        Boolean(
          review?.versionId &&
          source &&
          review.versionId !== source.currentVersionId,
        ),
      );
    }
  } else if (kind === "assumption") {
    const record = pedigree?.assumptions.find((v) => v.id === id);
    if (record)
      return result(
        record.statement || "Assumption",
        record.basis || record.consequence,
        record.status,
      );
  } else if (kind === "task") {
    const record = research.tasks.find((v) => v.id === id);
    if (record)
      return result(
        record.title,
        record.criterion || record.question,
        record.status,
      );
  } else if (kind === "method") {
    const record = pedigree?.methods.find((v) => v.id === id);
    if (record)
      return result(
        record.title,
        record.objective || record.nextSteps,
        record.reviewStatus,
      );
  } else if (kind === "gap") {
    const record = pedigree?.gaps?.find((v) => v.id === id);
    if (record)
      return result(
        record.title,
        record.missingInformation || record.importance,
        record.status,
      );
  } else if (kind === "decision") {
    const record = pedigree?.decisions?.find((v) => v.id === id);
    if (record)
      return result(
        record.title,
        record.action || record.rationale,
        record.status,
      );
  } else if (kind === "report" || kind === "delivery-plan") {
    const record = project.outputs.find((v) => v.id === id);
    if (record && (kind !== "delivery-plan" || record.kind === "project-plan"))
      return result(
        record.title,
        record.plan?.deliverable ||
          record.markdown.replace(/[#*`>]/g, "").slice(0, 700),
        record.releasedRevisionId ? "Has released version" : "Draft",
      );
  }
  return {
    ...base,
    unavailable: true,
    status: "Unavailable",
    card: {
      ...card,
      content:
        "This linked record is unavailable. Its board position and connections have been preserved.",
    },
  };
}
