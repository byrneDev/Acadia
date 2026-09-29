import type {
  OutputKind,
  Project,
  ResearchCard,
  ResearchOutput,
} from "./types";
import { OUTPUT_LABELS } from "./project";

export const SYNTHESIS_LIMITS = {
  cards: 80,
  textPerCard: 4000,
  totalText: 120_000,
  connections: 500,
  instructions: 8000,
} as const;
export interface EvidenceSource {
  label: string;
  card: ResearchCard;
  text: string;
  truncated: boolean;
}
export interface EvidenceInput {
  sources: EvidenceSource[];
  connections: { source: string; target: string; relation: string }[];
  omittedCards: number;
  omittedConnections: number;
  truncatedCards: number;
}
export function gatherEvidence(project: Project): EvidenceInput {
  let remaining = SYNTHESIS_LIMITS.totalText;
  const sources: EvidenceSource[] = [];
  for (const card of project.cards.slice(0, SYNTHESIS_LIMITS.cards)) {
    if (remaining <= 0) break;
    const savedText = [
      card.content,
      card.extraction ? `Extracted file text:\n${card.extraction}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    const text = savedText.slice(
      0,
      Math.min(remaining, SYNTHESIS_LIMITS.textPerCard),
    );
    sources.push({
      label: `S${sources.length + 1}`,
      card,
      text,
      truncated: text.length < savedText.length,
    });
    remaining -= text.length;
  }
  const labels = new Map(sources.map((s) => [s.card.id, s.label]));
  const eligible = project.connections.filter(
    (c) => labels.has(c.source) && labels.has(c.target),
  );
  const connections = eligible
    .slice(0, SYNTHESIS_LIMITS.connections)
    .map((c) => ({
      source: labels.get(c.source)!,
      target: labels.get(c.target)!,
      relation: c.relation,
    }));
  return {
    sources,
    connections,
    omittedCards: project.cards.length - sources.length,
    omittedConnections: project.connections.length - connections.length,
    truncatedCards: sources.filter((s) => s.truncated).length,
  };
}

export function markdownText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/[\\`*_[\]<>#|]/g, "\\$&")
    .trim();
}
export function evidenceDisclosure(input: EvidenceInput): string {
  return `Scope: ${input.sources.length} cards and ${input.connections.length} connections included. ${input.omittedCards} cards and ${input.omittedConnections} connections omitted; ${input.truncatedCards} card texts shortened. Limits: first ${SYNTHESIS_LIMITS.cards} cards, ${SYNTHESIS_LIMITS.textPerCard.toLocaleString("en-US")} text characters per card, ${SYNTHESIS_LIMITS.totalText.toLocaleString("en-US")} total text characters, and ${SYNTHESIS_LIMITS.connections} connections. Only saved card notes, extracted document text, and metadata are used. Linked pages are not fetched; image, audio, and video files are not interpreted. Evidence status and connections are user annotations, not independent verification.`;
}
export function evidenceRegister(input: EvidenceInput): string {
  if (!input.sources.length)
    return "No sources have been collected. Add source material before drawing conclusions.";
  return input.sources
    .map((s) => {
      const url = s.card.url
        ? `\n\nURL recorded on card: ${markdownText(s.card.url)}`
        : "";
      const file = s.card.fileName
        ? `\n\nFile: ${markdownText(s.card.fileName)}. ${s.card.extraction ? "Saved extraction text or its extraction-status notice is included in the bounded source text." : "No extracted file text is available."}`
        : "";
      return `### [${s.label}] ${markdownText(s.card.title || "Untitled card")}\n\nCard ID: \`${s.card.id}\` · ${s.card.kind} · user status: ${s.card.status}\n\n> ${markdownText(s.text.slice(0, 600)) || "No saved text to analyze."}${s.text.length > 600 ? " … (register excerpt)" : ""}${s.truncated ? " (source text truncated for this run)" : ""}${url}${file}`;
    })
    .join("\n\n");
}
function sourceList(sources: EvidenceSource[], fallback: string): string {
  return sources.length
    ? sources
        .map(
          (s) =>
            `- [${s.label}] **${markdownText(s.card.title || "Untitled card")}** — ${markdownText(s.text.slice(0, 360)) || "No saved text."}${s.text.length > 360 ? " …" : ""}`,
        )
        .join("\n")
    : fallback;
}
function unknowns(input: EvidenceInput): string {
  const questions = input.sources.filter((s) => s.card.kind === "question");
  const missingText = input.sources.filter((s) => !s.text.trim());
  const disputed = input.sources.filter((s) => s.card.status === "disputed");
  return [
    sourceList(
      questions,
      "- No explicit research questions were captured as question cards.",
    ),
    missingText.length
      ? `- Obtain usable text or a researcher-written description for ${missingText.map((s) => `[${s.label}]`).join(", ")}.`
      : "",
    disputed.length
      ? `- Resolve disputed material: ${disputed.map((s) => `[${s.label}]`).join(", ")}.`
      : "",
    "- Assess source independence, date, method, bias, and relevance. Card labels alone do not establish reliability.",
    "- Identify evidence that would falsify the working interpretation and record alternative explanations.",
  ]
    .filter(Boolean)
    .join("\n");
}
function relationshipOutline(input: EvidenceInput): string {
  return input.connections.length
    ? input.connections
        .map(
          (c) =>
            `- [${c.source}] **${c.relation}** [${c.target}]${c.relation === "contradicts" ? " — unresolved contradiction recorded on the board." : ""}`,
        )
        .join("\n")
    : "No explicit relationships have been drawn. Connect sources to claims and record the reason for each connection.";
}

export function createOfflineOutput(
  project: Project,
  kind: OutputKind,
  instructions = "",
): ResearchOutput {
  const input = gatherEvidence(project);
  const hypotheses = input.sources.filter((s) => s.card.kind === "hypothesis");
  const question = markdownText(
    project.question || "Research question has not been defined.",
  );
  let body: string;
  switch (kind) {
    case "project-plan":
      body = `## Gap and proposed deliverable\n\n${question}\n\nSelect an existing analysis and describe the gap before approving a delivery plan. Compare software, curriculum, process changes, and further research as appropriate.\n\n## Planning worksheet\n\n| Phase | Deliverable | Depends on | Completion criteria |\n| --- | --- | --- | --- |\n| Validate need | Gap, users and alternatives | Reviewed analysis | Researcher accepts the intervention rationale |\n| Define and design | Requirements or learning objectives | Validated need | Measurable acceptance criteria are agreed |\n| Produce and pilot | Reviewable software, materials or other deliverable | Approved design | Proposed solution tested under stated conditions |\n| Validate and hand off | Test record and maintenance responsibilities | Pilot results | Acceptance criteria met or limitations explicitly accepted |\n\nOwners, dates, effort and budgets are unassessed. This offline outline does not establish feasibility or approve work.\n\n## Unresolved research\n\n${unknowns(input)}`;
      break;
    case "hypothesis":
      body = `## Working propositions\n\n${sourceList(hypotheses, "No hypothesis card is present. Write a falsifiable proposition, its predicted observation, and the condition that would disprove it.")}\n\n## Test design to complete\n\n1. Define the proposed relationship and competing explanations.\n2. Specify an observable outcome, comparison, and decision threshold before collecting results.\n3. Connect supporting and contradicting sources to each proposition.\n4. Record a conclusion only after evaluating the evidence.\n\n## Unresolved questions\n\n${unknowns(input)}`;
      break;
    case "research-plan":
      body = `## Purpose\n\nInvestigate: ${question}\n\n## Proposed work sequence\n\n1. **Frame the inquiry.** Confirm scope, stakeholders, and what decision the research should inform.\n2. **Audit the collection.** Review the source register below; obtain originals and assess credibility.\n3. **Test the propositions.** Define methods, comparison criteria, and counterevidence before testing.\n4. **Close priority gaps.** Assign an owner, due date, and acceptance criterion to each unresolved question.\n5. **Review and release.** Have a reviewer trace each material claim to its sources.\n\nOwners, dates, effort estimates, and acceptance criteria have not been supplied and require researcher input.\n\n## Questions to schedule\n\n${unknowns(input)}`;
      break;
    case "whitepaper":
      body = `## Executive summary — outline\n\nResearch question: ${question}\n\nThis source-linked outline contains no newly established findings. Complete the argument after reviewing the underlying evidence.\n\n## Working argument\n\n${sourceList(hypotheses, "A central proposition has not been recorded.")}\n\n## Method and evidence\n\nDescribe how sources were selected, what was excluded, and how claims were evaluated. Use the source register below to build the evidence discussion.\n\n## Limitations and counterarguments\n\n${unknowns(input)}\n\n## Conclusions and recommendations — pending\n\nState only conclusions supported by reviewed sources. Identify who should act, what decision is required, and which uncertainties remain.`;
      break;
    case "gap-analysis":
      body = `## Intended knowledge state\n\nAnswer the research question: ${question}\n\n## Recorded state\n\nThe included collection contains ${input.sources.length} cards, ${hypotheses.length} hypothesis cards, and ${input.sources.filter((s) => s.card.status === "unreviewed").length} cards marked unreviewed. These counts describe the board, not evidence quality.\n\n## Gaps requiring review\n\n${unknowns(input)}\n\n## Gap closure plan\n\nFor each gap, record the missing information, its effect on the decision, a source or collection method, an owner, and a completion criterion. Rank gaps by decision impact and uncertainty. Priorities have not been inferred from card order.`;
      break;
    case "needs-analysis":
      body = `## Decision context\n\n${question}\n\n## Needs to establish\n\n- Identify the people or organization facing the problem and validate the need with them.\n- Describe the current condition using dated, traceable evidence.\n- Define the desired condition and measurable success criteria.\n- Identify constraints, resources, dependencies, and alternatives.\n\n## Questions and missing evidence\n\n${unknowns(input)}\n\n## Prioritization to complete\n\nFor each proposed need, record the affected stakeholder, evidence reference, consequence of inaction, importance, and confidence. No stakeholder demand, budget, or priority has been assumed.`;
      break;
    case "decision-brief":
      body = `## Decision to inform\n\n${question}\n\n## Options and criteria\n\nRecord feasible options, a comparison baseline, and measurable decision criteria. No preferred option has been inferred.\n\n## Evidence to review\n\n${sourceList(input.sources, "Insufficient evidence: no research sources have been collected.")}\n\n## Counterevidence and uncertainty\n\n${unknowns(input)}\n\n## Recommendation — pending\n\nCompare the options against the reviewed evidence. State conditions that would change the recommendation and the next verification step.`;
      break;
    default:
      throw new Error("Choose a supported Releaser output type.");
  }
  const direction = instructions.trim()
    ? `\n\n## Requested direction\n\n> ${markdownText(instructions.slice(0, SYNTHESIS_LIMITS.instructions))}\n\nOffline mode records this direction but does not interpret custom instructions. Use an AI provider or edit the exported outline for a tailored narrative.`
    : "";
  return {
    id: crypto.randomUUID(),
    kind,
    title: `${OUTPUT_LABELS[kind]} · ${project.title}`,
    markdown: `# ${OUTPUT_LABELS[kind]}\n\n> Offline · rule-based evidence outline. No AI model was called. This document organizes saved research; it does not verify claims or report new findings.\n\n${body}${direction}\n\n## Recorded connections\n\n${relationshipOutline(input)}\n\n## Source register\n\n${evidenceRegister(input)}\n\n## Scope and provenance\n\n${evidenceDisclosure(input)}\n\nBoard snapshot: ${project.updatedAt}.`,
    provider: "Offline · rule-based outline",
    sourceIds: input.sources.map((s) => s.card.id),
    createdAt: new Date().toISOString(),
    boardUpdatedAt: project.updatedAt,
  };
}
