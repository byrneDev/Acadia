import type { Citation, ResearchClaim } from "../../shared/research";
import { ItemInsightMarkdown } from "./ItemInsightMarkdown";
import { AddToBoardButton } from "./BoardMappingContext";

/** One canonical evidence record supplies the item field and the Evidence view. */
export function ReviewerNotes({
  claims,
  onCitation,
  onEvidence,
  displayedVersionId,
}: {
  claims: ResearchClaim[];
  onCitation: (citation: Citation) => void;
  onEvidence?: (id: string) => void;
  displayedVersionId?: string;
}) {
  const reviewed = claims
    .filter((claim) => claim.itemReview)
    .sort((a, b) =>
      b.itemReview!.acceptedAt.localeCompare(a.itemReview!.acceptedAt),
    );
  return (
    <section className="reviewer-notes" aria-label="Reviewer Notes">
      <h3>Reviewer Notes</h3>
      {!reviewed.length && (
        <p className="muted">
          No accepted notes yet. Review an AI summary, edit its proposed notes,
          then accept them as evidence.
        </p>
      )}
      {reviewed.map((claim, index) => {
        const review = claim.itemReview!;
        return (
          <details key={claim.id} open={index === 0}>
            <summary>
              Human accepted · {new Date(review.acceptedAt).toLocaleString()}
            </summary>
            {review.citations[0] && (
              <p className="item-insight-meta">
                Source captured{" "}
                {new Date(review.citations[0].acquiredAt).toLocaleString()} ·{" "}
                {review.citations[0].sourceTitle}
              </p>
            )}
            {displayedVersionId &&
              review.versionId &&
              displayedVersionId !== review.versionId && (
                <p className="item-insight-notice">
                  These notes concern a different saved source version. Follow
                  their references to review the original passages.
                </p>
              )}
            <ItemInsightMarkdown
              markdown={review.notes}
              citations={review.citations}
              onCitation={onCitation}
            />
            <AddToBoardButton
              reference={{ kind: "review", id: claim.id }}
              label="Add Reviewer Notes to board"
            />
            {!review.citations.length && (
              <p className="subtle-note">
                Researcher interpretation without cited source passages.
              </p>
            )}
            {onEvidence && (
              <button
                type="button"
                className="text-button"
                onClick={() => onEvidence(claim.id)}
              >
                Open evidence record
              </button>
            )}
          </details>
        );
      })}
    </section>
  );
}
