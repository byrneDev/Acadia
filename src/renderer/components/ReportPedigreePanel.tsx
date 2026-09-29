import type { Citation } from "../../shared/research";
import type { PedigreeSnapshot } from "../../shared/pedigree";

export default function ReportPedigreePanel({
  snapshot,
  onCitation,
}: {
  snapshot: PedigreeSnapshot;
  onCitation: (citation: Citation) => void;
}) {
  const passageLink = (id: string) => {
    const p = snapshot.passages.find((p) => p.id === id),
      version = snapshot.sourceVersions.find((v) => v.id === p?.versionId);
    return p ? (
      <button
        type="button"
        key={id}
        onClick={() =>
          onCitation({
            id: `snapshot-${id}`,
            label: "",
            sourceId: p.sourceId,
            versionId: p.versionId,
            passageId: p.id,
            sourceTitle: version?.title || p.sourceId,
            locator: p.locator,
            quote: p.text,
            acquiredAt: version?.acquiredAt || snapshot.createdAt,
            verified: p.method !== "legacy",
          })
        }
      >
        {version?.title || p.sourceId} · {p.locator}
      </button>
    ) : (
      <span key={id}>Missing passage: {id}</span>
    );
  };
  return (
    <section
      className="release-pedigree"
      aria-label="Historical analytical pedigree"
    >
      <h3>Analytical pedigree</h3>
      <p>
        Recorded {new Date(snapshot.createdAt).toLocaleString()}. This is the
        saved historical basis for the selected report version.
      </p>
      <small>Snapshot {snapshot.id}</small>
      {snapshot.state.briefs.map((brief) => (
        <details key={brief.id}>
          <summary>Research brief · revision {brief.revision}</summary>
          <dl>
            {[
              ["Question", brief.question],
              ["Decision", brief.decision],
              ["Scope", brief.scope],
              [
                "Dates",
                [brief.dateFrom, brief.dateTo].filter(Boolean).join(" to "),
              ],
              ["Inclusion", brief.inclusionCriteria],
              ["Exclusion", brief.exclusionCriteria],
              ["Success", brief.successCriteria],
              ["Review", brief.reviewStatus],
            ].map(([label, content]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{content || "Unassessed"}</dd>
              </div>
            ))}
          </dl>
        </details>
      ))}
      <details>
        <summary>Findings and reasoning ({snapshot.claims.length})</summary>
        {snapshot.claims.map((claim) => {
          const finding = snapshot.state.findings.find(
            (f) => f.claimId === claim.id,
          );
          return (
            <section key={claim.id}>
              <h4>{claim.title}</h4>
              <p>
                {finding?.classification || "Unassessed classification"} ·{" "}
                {finding?.supportReview || "Unassessed support"}
              </p>
              <p>{finding?.reasoning || "Reasoning not recorded"}</p>
              <p>
                Confidence: {finding?.confidence || "unassessed"}.{" "}
                {finding?.confidenceBasis || "No written confidence basis"}
              </p>
              <p>Alternatives: {claim.alternatives || "Unassessed"}</p>
              <p>Limitations: {claim.limitations || "Unassessed"}</p>
              <p>
                Would change the assessment:{" "}
                {finding?.wouldChange || "Unassessed"}
              </p>
              {claim.links.map((link) => (
                <div key={link.id}>
                  <strong>{link.relation}</strong>
                  <p>{link.rationale}</p>
                  {passageLink(link.passageId)}
                </div>
              ))}
            </section>
          );
        })}
      </details>
      <details>
        <summary>Source quality ({snapshot.state.appraisals.length})</summary>
        {snapshot.state.appraisals.map((a) => (
          <section key={a.id}>
            <h4>
              {snapshot.sourceVersions.find((v) => v.id === a.versionId)
                ?.title || a.sourceId}
            </h4>
            <p>
              Revision {a.revision} · {a.reviewStatus} · {a.evidenceType} ·{" "}
              {a.origin}
            </p>
            <dl>
              {[
                ["Methods", a.methods],
                ["Applicability", a.applicability],
                ["Currency", a.currency],
                ["Limitations", a.limitations],
                ["Bias", a.bias],
                ["Rationale", a.rationale],
              ].map(([label, content]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{content || "Unassessed"}</dd>
                </div>
              ))}
            </dl>
            {a.passageIds.map(passageLink)}
          </section>
        ))}
      </details>
      <details>
        <summary>
          Origins and dependence ({snapshot.state.origins.length})
        </summary>
        {snapshot.state.origins.map((origin) => (
          <section key={origin.id}>
            <h4>
              {snapshot.sources.find((s) => s.id === origin.sourceId)?.title ||
                origin.sourceId}{" "}
              →{" "}
              {snapshot.sources.find((s) => s.id === origin.relatedSourceId)
                ?.title || origin.relatedSourceId}
            </h4>
            <p>
              {origin.kind} · {origin.status} · revision {origin.revision}
            </p>
            <p>{origin.rationale || "No rationale recorded"}</p>
          </section>
        ))}
      </details>
      <details>
        <summary>Assumptions ({snapshot.state.assumptions.length})</summary>
        {snapshot.state.assumptions.map((a) => (
          <section key={a.id}>
            <h4>{a.statement}</h4>
            <p>
              {a.status} · revision {a.revision}
            </p>
            <p>Basis: {a.basis || "Unassessed"}</p>
            <p>Consequence: {a.consequence || "Unassessed"}</p>
            <p>Validation: {a.validation || "Unassessed"}</p>
            {a.passageIds.map(passageLink)}
          </section>
        ))}
      </details>
      <details>
        <summary>Methods ({snapshot.state.methods.length})</summary>
        {snapshot.state.methods.map((method) => (
          <section key={method.id}>
            <h4>{method.title}</h4>
            <p>
              {method.objective || "No objective recorded"} · revision{" "}
              {method.revision} · {method.reviewStatus}
            </p>
            {method.rows.map((row) => (
              <details key={row.id}>
                <summary>{row.text || "Unassessed row"}</summary>
                <dl>
                  {Object.entries(row)
                    .filter(
                      ([key]) => !["id", "text", "passageIds"].includes(key),
                    )
                    .map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>
                          {Array.isArray(value)
                            ? value
                                .map((item) =>
                                  typeof item === "object"
                                    ? JSON.stringify(item)
                                    : item,
                                )
                                .join("; ") || "None recorded"
                            : String(value ?? "Unassessed") || "Unassessed"}
                        </dd>
                      </div>
                    ))}
                </dl>
                {row.passageIds.map(passageLink)}
              </details>
            ))}
            <p>Limitations: {method.limitations || "Unassessed"}</p>
            <p>Next steps: {method.nextSteps || "Unassessed"}</p>
          </section>
        ))}
      </details>
      <details>
        <summary>Review issues ({snapshot.state.issues.length})</summary>
        {snapshot.state.issues.map((issue) => (
          <section key={issue.id}>
            <h4>{issue.summary}</h4>
            <p>
              {issue.status} · revision {issue.revision}
            </p>
            <p>{issue.detail}</p>
            <p>{issue.rationale || "No disposition rationale"}</p>
            {issue.passageIds.map(passageLink)}
          </section>
        ))}
      </details>
    </section>
  );
}
