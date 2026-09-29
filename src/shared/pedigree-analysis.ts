import type { Citation, Passage } from "./research";
import {
  validatePedigreeEntity,
  type MethodWorksheet,
  type PedigreeSnapshot,
  type PedigreeState,
} from "./pedigree";

export const RETRIEVAL_POOLS = ["pins", "support", "counter", "gaps"] as const;
export type RetrievalPool = (typeof RETRIEVAL_POOLS)[number];
export interface RetrievalSelection {
  passageId: string;
  pool: RetrievalPool;
  matchedPools: RetrievalPool[];
  reason: string;
  characters: number;
  redistributed: boolean;
}
export interface RetrievalOmission {
  passageId: string;
  reason:
    | "duplicate-file"
    | "context-budget"
    | "not-retrieved"
    | "source-excluded"
    | "passage-excluded"
    | "incomplete-extraction"
    | "superseded-version";
  detail: string;
}
export interface RetrievalManifest {
  policy: "balanced-four-pools-v1";
  limits: { characters: number; passages: number };
  perPool: { characters: number; passages: number };
  selections: RetrievalSelection[];
  omissions: RetrievalOmission[];
  usedCharacters: number;
  independentSourceGroups?: string[][];
}
export interface ModelRequestAudit {
  provider: string;
  endpoint: string;
  model: string;
  messages: { role: string; content: string }[];
  parameters: Record<string, unknown>;
}
export interface QuoteAssociation {
  quote: string;
  start: number;
  end: number;
  labels: string[];
  matchingLabels: string[];
  status: "verified" | "ambiguous";
}
export interface QuotationReview {
  associations: QuoteAssociation[];
  warnings: string[];
}
export interface ChallengeTarget {
  kind: "finding" | "method" | "report";
  id: string;
}
export interface AnalysisIssueProposal {
  id: string;
  category:
    | "unsupported-claim"
    | "causal-inference"
    | "contradiction"
    | "source-independence"
    | "method-limitation"
    | "missing-evidence"
    | "assumption";
  summary: string;
  detail: string;
  passageIds: string[];
  claimIds: string[];
  assumptionIds: string[];
}
export interface ChallengeProposal {
  id: string;
  runId: string;
  target: ChallengeTarget;
  summary: string;
  issues: AnalysisIssueProposal[];
  limitations: string[];
  citations: Citation[];
  suggestedChanges?: {
    original: string;
    proposed: string;
    rationale: string;
    citationIds: string[];
  }[];
  quotationAssociations?: QuoteAssociation[];
  groundingWarnings?: string[];
}
export interface MethodAssistanceProposal {
  id: string;
  runId: string;
  methodId: string;
  methodRevision: number;
  summary: string;
  proposedMethod: MethodWorksheet;
  issues: AnalysisIssueProposal[];
  limitations: string[];
  citations: Citation[];
}

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("The model returned an invalid proposal object.");
  return value as Record<string, unknown>;
};
const proposalText = (value: unknown, max = 30_000): string => {
  if (typeof value !== "string" || value.length > max)
    throw new Error("The model returned invalid proposal text.");
  return value;
};
const list = (value: unknown, max = 200): unknown[] => {
  if (!Array.isArray(value) || value.length > max)
    throw new Error("The model returned an invalid proposal collection.");
  return value;
};
function references(value: unknown, allowed: Set<string>): string[] {
  const result = list(value).map((v) => proposalText(v, 128));
  if (result.some((id) => !allowed.has(id)))
    throw new Error(
      "The proposal cites an unknown or unavailable evidence reference. No writing was changed.",
    );
  return [...new Set(result)];
}
export function validateIssueProposals(
  value: unknown,
  citations: Citation[],
  snapshot: PedigreeSnapshot,
): AnalysisIssueProposal[] {
  const passageIds = new Set(citations.map((c) => c.passageId));
  const claimIds = new Set(snapshot.claims.map((c) => c.id));
  const assumptionIds = new Set(snapshot.state.assumptions.map((a) => a.id));
  const categories: AnalysisIssueProposal["category"][] = [
    "unsupported-claim",
    "causal-inference",
    "contradiction",
    "source-independence",
    "method-limitation",
    "missing-evidence",
    "assumption",
  ];
  return list(value).map((input) => {
    const v = record(input);
    if (!categories.includes(v.category as AnalysisIssueProposal["category"]))
      throw new Error("The proposal returned an unknown review category.");
    return {
      id: crypto.randomUUID(),
      category: v.category as AnalysisIssueProposal["category"],
      summary: proposalText(v.summary, 2000),
      detail: proposalText(v.detail),
      passageIds: references(v.passageIds, passageIds),
      claimIds: references(v.claimIds, claimIds),
      assumptionIds: references(v.assumptionIds, assumptionIds),
    };
  });
}
export function validateChallengeProposal(
  input: unknown,
  context: {
    target: ChallengeTarget;
    original: string;
    runId: string;
    citations: Citation[];
    snapshot: PedigreeSnapshot;
  },
): ChallengeProposal {
  const v = record(input);
  const citations = context.citations;
  const quotationAssociations: QuoteAssociation[] = [],
    groundingWarnings: string[] = [];
  const changes = list(v.suggestedChanges ?? [], 30).map((input) => {
    const change = record(input),
      original = proposalText(change.original),
      proposed = proposalText(change.proposed);
    if (!original.trim() || !context.original.includes(original))
      throw new Error(
        "The proposed edit does not match the reviewed writing. No writing was changed.",
      );
    // Require a unique, literal anchor; duplicate text needs a narrower selection.
    if (
      context.original.indexOf(original) !==
      context.original.lastIndexOf(original)
    )
      throw new Error(
        "The proposed edit has an ambiguous writing location. No writing was changed.",
      );
    const citationIds = references(
      change.citationIds ?? [],
      new Set(citations.map((c) => c.id)),
    );
    for (const match of proposed.matchAll(/\[(?:S)?(\d+)\]/g)) {
      if (
        !citations.some(
          (c) => c.label === match[1] && citationIds.includes(c.id),
        )
      )
        throw new Error(
          "The suggested writing uses an unlisted citation. No writing was changed.",
        );
    }
    for (const match of original.matchAll(/\[(?:S)?(\d+)\]/g)) {
      if (!proposed.includes(`[${match[1]}]`))
        throw new Error(
          "The suggested writing removed an existing citation. Request a revision that preserves its citations.",
        );
    }
    const review = associateQuotedText(
      proposed,
      citations.filter((c) => citationIds.includes(c.id)),
    );
    quotationAssociations.push(...review.associations);
    groundingWarnings.push(...review.warnings);
    return {
      original,
      proposed,
      rationale: proposalText(change.rationale),
      citationIds,
    };
  });
  return {
    id: crypto.randomUUID(),
    runId: context.runId,
    target: context.target,
    summary: proposalText(v.summary),
    issues: validateIssueProposals(v.issues, citations, context.snapshot),
    limitations: list(v.limitations).map((v) => proposalText(v)),
    citations,
    suggestedChanges: changes,
    quotationAssociations,
    groundingWarnings,
  };
}
export function validateMethodProposal(
  input: unknown,
  current: MethodWorksheet,
  context: { runId: string; citations: Citation[]; snapshot: PedigreeSnapshot },
): MethodAssistanceProposal {
  const v = record(input),
    proposed = record(v.proposedMethod);
  const method = validatePedigreeEntity(
    "method",
    {
      ...proposed,
      id: current.id,
      projectId: current.projectId,
      kind: current.kind,
      revision: current.revision,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      reviewStatus: "draft",
    },
    current.projectId,
  ) as MethodWorksheet;
  const passages = new Set(context.citations.map((c) => c.passageId)),
    claims = new Set(context.snapshot.claims.map((c) => c.id));
  const assumptions = new Set(
      context.snapshot.state.assumptions.map((a) => a.id),
    ),
    tasks = new Set(context.snapshot.tasks.map((t) => t.id));
  for (const row of method.rows) {
    references(row.passageIds, passages);
    references(row.claimIds, claims);
    references(row.assumptionIds, assumptions);
    references(row.taskIds, tasks);
    if ("evaluations" in row)
      for (const evaluation of row.evaluations)
        references([evaluation.passageId], passages);
  }
  return {
    id: crypto.randomUUID(),
    runId: context.runId,
    methodId: current.id,
    methodRevision: current.revision,
    summary: proposalText(v.summary),
    proposedMethod: method,
    issues: validateIssueProposals(
      v.issues ?? [],
      context.citations,
      context.snapshot,
    ),
    limitations: list(v.limitations).map((v) => proposalText(v)),
    citations: context.citations,
  };
}

/** Confirmed common origins form dependent evidence groups; proposed links stay
 * visible for review but never silently become established dependencies. */
export function sourceIndependenceGroups(
  sourceIds: string[],
  state: PedigreeState,
): string[][] {
  const parent = new Map(sourceIds.map((id) => [id, id]));
  const root = (id: string): string => {
    let p = id;
    while (parent.get(p) && parent.get(p) !== p) p = parent.get(p)!;
    return p;
  };
  for (const origin of state.origins)
    if (
      origin.status === "confirmed" &&
      parent.has(origin.sourceId) &&
      parent.has(origin.relatedSourceId)
    )
      parent.set(root(origin.relatedSourceId), root(origin.sourceId));
  const groups = new Map<string, string[]>();
  for (const id of sourceIds) {
    const key = root(id);
    groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return [...groups.values()];
}

/** Equal reservations first; only unused capacity is then shared round-robin.
 * A source's duplicate file cannot consume another independent evidence slot.
 */
export function balancedPassages(
  pools: Record<RetrievalPool, Passage[]>,
  limits: { characters: number; passages: number },
  hashByVersion: ReadonlyMap<string, string>,
): { passages: Passage[]; manifest: RetrievalManifest } {
  const perPool = {
    characters: Math.floor(limits.characters / 4),
    passages: Math.floor(limits.passages / 4),
  };
  const membership = new Map<string, RetrievalPool[]>();
  const candidates = new Map<string, Passage>();
  const queues = Object.fromEntries(
    RETRIEVAL_POOLS.map((pool) => {
      const unique = [...new Map(pools[pool].map((p) => [p.id, p])).values()];
      for (const p of unique) {
        candidates.set(p.id, p);
        membership.set(p.id, [...(membership.get(p.id) || []), pool]);
      }
      return [pool, unique];
    }),
  ) as Record<RetrievalPool, Passage[]>;
  const selected = new Set<string>();
  const owner = new Map<string, string>();
  // Honor the researcher's chosen copy even if it must await redistribution.
  for (const p of queues.pins) {
    const hash = hashByVersion.get(p.versionId);
    if (hash && !owner.has(hash)) owner.set(hash, p.sourceId);
  }
  const passages: Passage[] = [];
  const selections: RetrievalSelection[] = [];
  const used = Object.fromEntries(
    RETRIEVAL_POOLS.map((p) => [p, { characters: 0, passages: 0 }]),
  ) as Record<RetrievalPool, { characters: number; passages: number }>;
  let usedCharacters = 0;
  const isDuplicate = (p: Passage) => {
    const hash = hashByVersion.get(p.versionId);
    return Boolean(hash && owner.has(hash) && owner.get(hash) !== p.sourceId);
  };
  const take = (pool: RetrievalPool, reserved: boolean): boolean => {
    const p = queues[pool].find(
      (candidate) =>
        !selected.has(candidate.id) &&
        !isDuplicate(candidate) &&
        passages.length < limits.passages &&
        usedCharacters + candidate.text.length <= limits.characters &&
        (!reserved ||
          (used[pool].passages < perPool.passages &&
            used[pool].characters + candidate.text.length <=
              perPool.characters)),
    );
    if (!p) return false;
    selected.add(p.id);
    const hash = hashByVersion.get(p.versionId);
    if (hash) owner.set(hash, p.sourceId);
    passages.push(p);
    usedCharacters += p.text.length;
    used[pool].characters += p.text.length;
    used[pool].passages++;
    selections.push({
      passageId: p.id,
      pool,
      matchedPools: membership.get(p.id)!,
      characters: p.text.length,
      redistributed: !reserved,
      reason: `${pool === "pins" ? "Researcher-pinned evidence" : `Retrieved for ${pool === "counter" ? "counterevidence" : pool === "gaps" ? "missing information" : "supporting evidence"}`}${reserved ? "; equal reserved pool allowance" : "; unused pool allowance redistributed"}.`,
    });
    return true;
  };
  for (const reserved of [true, false]) {
    let progress = true;
    while (progress) {
      progress = false;
      for (const pool of RETRIEVAL_POOLS)
        if (take(pool, reserved)) progress = true;
    }
  }
  const omissions = [...candidates.values()]
    .filter((p) => !selected.has(p.id))
    .map((p): RetrievalOmission => ({
      passageId: p.id,
      reason: isDuplicate(p) ? "duplicate-file" : "context-budget",
      detail: isDuplicate(p)
        ? "Same captured content hash as an included source; not independent corroboration."
        : `Did not fit the ${limits.characters}-character / ${limits.passages}-passage budget after equal pool reservations and redistribution.`,
    }));
  return {
    passages,
    manifest: {
      policy: "balanced-four-pools-v1",
      limits,
      perPool,
      selections,
      omissions,
      usedCharacters,
    },
  };
}

/** Locating literal text is a provenance check, never an entailment judgment. */
export function associateQuotedText(
  markdown: string,
  cited: Citation[],
): QuotationReview {
  const known = new Map(cited.map((c) => [c.label.replace(/^S/, ""), c]));
  const associations: QuoteAssociation[] = [];
  const warnings: string[] = [];
  for (const match of markdown.matchAll(/“([^”\n]+)”|"([^"\n]+)"/g)) {
    const quote = match[1] ?? match[2];
    const start = match.index!;
    const end = start + match[0].length;
    const before =
      markdown
        .slice(Math.max(0, start - 160), start)
        .match(/((?:\[(?:S)?\d+\][ \t,;]*)+)[ \t:]*$/)?.[1] || "";
    const after =
      markdown
        .slice(end, end + 160)
        .match(/^[ \t.,;:!?]*((?:\[(?:S)?\d+\][ \t,;]*)+)/)?.[1] || "";
    const labels = [
      ...new Set(
        [...`${before} ${after}`.matchAll(/\[(?:S)?(\d+)\]/g)].map((m) => m[1]),
      ),
    ];
    const matchingLabels = labels.filter((label) =>
      known.get(label)?.quote.includes(quote),
    );
    if (labels.length && !matchingLabels.length)
      throw new Error(
        `Grounding check failed: quoted text is absent from the cited source passages at its adjacent citation${labels.length === 1 ? "" : "s"} ${labels.map((label) => `[${label}]`).join(", ")}. No draft was applied.`,
      );
    if (!labels.length && !cited.some((c) => c.quote.includes(quote)))
      throw new Error(
        "Grounding check failed: quoted text is absent from the cited source passages. No draft was applied.",
      );
    const ambiguous =
      !labels.length ||
      labels.length !== matchingLabels.length ||
      Boolean(before && after && before.trim() !== after.trim());
    const status = ambiguous ? "ambiguous" : "verified";
    if (ambiguous)
      warnings.push(
        `Quotation at characters ${start}–${end} has ${!labels.length ? "no adjacent citation" : "ambiguous attribution across adjacent citations"}; verify its association before release.`,
      );
    associations.push({ quote, start, end, labels, matchingLabels, status });
  }
  return { associations, warnings };
}

export function redactCredentialText(
  value: string,
  credential?: string,
): string {
  return credential
    ? value.split(credential).join("[redacted credential]")
    : value;
}
