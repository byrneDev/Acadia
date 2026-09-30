import type { ResearchOutput } from "../../src/shared/types";
import type { Citation } from "../../src/shared/research";
import { markdownToReport } from "../../src/shared/report";

/** Fictional, deterministic print stress case: multi-page tables, long words and historical metadata. */
export function longReportFixture(citation?: Citation): ResearchOutput {
  const references: Citation[] = citation
    ? [citation]
    : [
        {
          id: "long-citation",
          label: "S1",
          sourceId: "long-source",
          versionId: "long-version",
          passageId: "long-passage",
          sourceTitle: "Fictional field verification study",
          author: "A. Researcher and B. Reviewer",
          publisher: "Acadia synthetic laboratory",
          publishedAt: "2024-06",
          doi: "10.0000/fictional.acadia.validation",
          locator: "Page 302, paragraph 8",
          quote:
            "Synthetic observations do not establish operational effectiveness.",
          acquiredAt: "2026-09-30T10:00:00Z",
          verified: true,
        },
      ];
  const markdown = `# Long research report\n\nThis is a fictional export validation fixture [1].\n\n## Research method and limitations\n\nThe evidence is synthetic. Measurements demonstrate export coverage, not research effectiveness. Source versions and locators must remain visible.\n\n## Multi-page method table\n\n| Observation | Interpretation | Discriminating test |\n| --- | --- | --- |\n${Array.from({ length: 90 }, (_, index) => `| Observation ${String(index + 1).padStart(3, "0")} — simulated workshop | A bounded statement with a possible alternative explanation and uncertainty. | Record an independent observation; preserve this row marker ENDROW${index + 1}. |`).join("\n")}\n\n## Nested working notes\n\n- First observation\n  - Nested rationale retained\n  - Alternate explanation remains unresolved\n- Follow-up task with no invented due date\n\n## Long identifier\n\n${"verification-".repeat(35)}ENDIDENTIFIER\n\n## Final limitations\n\nFINAL-LIMITATION: Completing proposed work does not resolve the research gap. Review field evidence manually [1].`;
  return {
    id: "long-report",
    kind: "whitepaper",
    title: "Long research report",
    markdown,
    document: markdownToReport(markdown, references),
    citations: references,
    provider: "Manual",
    createdAt: "2026-09-30T10:00:00Z",
    boardUpdatedAt: "2026-09-30T10:00:00Z",
    sourceIds: references.map((c) => c.sourceId),
  };
}
