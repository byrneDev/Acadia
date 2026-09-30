import { validateBoardReference } from "./board";
import type {
  CardKind,
  Connection,
  EvidenceStatus,
  OutputKind,
  Project,
  Relation,
  ResearchCard,
  ResearchOutput,
  ProjectPlanContext,
} from "./types";
import type { Citation, ReportDocument } from "./research";
import { validateDeliveryPlan } from "./pmis";

export const OUTPUT_LABELS: Record<OutputKind, string> = {
  hypothesis: "Hypothesis",
  "research-plan": "Research plan",
  whitepaper: "Whitepaper",
  "gap-analysis": "Gap analysis",
  "needs-analysis": "Needs analysis",
  "decision-brief": "Decision brief",
  "project-plan": "Deliverable project plan",
};

const CARD_KINDS: CardKind[] = [
  "note",
  "question",
  "hypothesis",
  "link",
  "document",
  "image",
  "audio",
  "video",
];
const STATUSES: EvidenceStatus[] = ["unreviewed", "supported", "disputed"];
const RELATIONS: Relation[] = [
  "relates to",
  "supports",
  "contradicts",
  "derived from",
  "investigate",
  "informs",
  "identifies gap",
  "addresses",
  "depends on",
  "produces",
];
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const ASSET_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createBlankProject(): Project {
  const now = new Date().toISOString();
  return {
    schemaVersion: 4,
    privacy: { mode: "local" },
    groups: [],
    views: [],
    id: crypto.randomUUID(),
    title: "Untitled research",
    question: "",
    cards: [],
    connections: [],
    outputs: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createDemoProject(): Project {
  const project = createBlankProject();
  project.title = "The connected research studio";
  project.question =
    "How can we turn a collection of ideas into research that others can trace, challenge, and build on?";
  const card = (
    id: string,
    kind: CardKind,
    title: string,
    content: string,
    x: number,
    y: number,
    tags: string[],
  ): ResearchCard => ({
    id,
    kind,
    title,
    content,
    x,
    y,
    tags,
    status: "unreviewed",
    createdAt: project.createdAt,
    updatedAt: project.createdAt,
  });
  project.cards = [
    card(
      "demo-question",
      "question",
      "Start with a question",
      "How can every conclusion lead back to its evidence?\n\nThis is an illustrative design board. These cards are working ideas, not observed research findings.",
      30,
      30,
      ["starting point"],
    ),
    card(
      "demo-collector",
      "note",
      "Collect without losing context",
      "Keep the original source, a short annotation, and the question it helps answer. Drop documents and media onto the Collector; add web links and your own observations.",
      390,
      0,
      ["capture", "provenance"],
    ),
    card(
      "demo-hypothesis",
      "hypothesis",
      "A working hypothesis",
      "Making the links between claims and sources visible may make a research argument easier to review.\n\nUntested proposal: compare review accuracy and time with and without a connected board.",
      760,
      70,
      ["test this"],
    ),
    card(
      "demo-connections",
      "note",
      "Connections carry meaning",
      "Label why two ideas belong together: supports, contradicts, derived from, or investigate. A drawn connection records your interpretation; it does not verify the claim.",
      20,
      330,
      ["relationships"],
    ),
    card(
      "demo-gap",
      "question",
      "What would change our mind?",
      "Which sources are independent? What evidence disagrees? What is missing? Define what would disprove the hypothesis before collecting only confirming material.",
      390,
      320,
      ["counterevidence", "unknowns"],
    ),
    card(
      "demo-research",
      "note",
      "Design the next investigation",
      "Draft a small comparison task. Define success criteria, recruit appropriate reviewers, record the review process, and compare results. No experiment has been conducted on this sample board.",
      760,
      380,
      ["next steps"],
    ),
    card(
      "demo-release",
      "note",
      "From Collector to Releaser",
      "Open the Releaser on another display. Turn the board into a hypothesis, research plan, whitepaper, gap analysis, or needs analysis. Offline mode creates a source-linked outline; connect an AI provider for synthesis.",
      1110,
      210,
      ["release"],
    ),
  ];
  project.connections = [
    {
      id: "demo-edge-1",
      source: "demo-question",
      target: "demo-collector",
      relation: "investigate",
    },
    {
      id: "demo-edge-2",
      source: "demo-collector",
      target: "demo-hypothesis",
      relation: "relates to",
    },
    {
      id: "demo-edge-3",
      source: "demo-question",
      target: "demo-connections",
      relation: "relates to",
    },
    {
      id: "demo-edge-4",
      source: "demo-connections",
      target: "demo-gap",
      relation: "investigate",
    },
    {
      id: "demo-edge-5",
      source: "demo-gap",
      target: "demo-hypothesis",
      relation: "investigate",
    },
    {
      id: "demo-edge-6",
      source: "demo-hypothesis",
      target: "demo-research",
      relation: "investigate",
    },
    {
      id: "demo-edge-7",
      source: "demo-research",
      target: "demo-release",
      relation: "derived from",
    },
  ];
  return project;
}

function fail(path: string, issue: string): never {
  throw new Error(`Invalid project: ${path} ${issue}.`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(path, "must be an object");
  return value as Record<string, unknown>;
}
function string(value: unknown, path: string, max = 1000): string {
  if (typeof value !== "string" || value.length > max)
    fail(path, `must be text no longer than ${max} characters`);
  return value;
}
function id(value: unknown, path: string): string {
  const result = string(value, path, 128);
  if (!SAFE_ID.test(result)) fail(path, "has an invalid identifier");
  return result;
}
function date(value: unknown, path: string): string {
  const result = string(value, path, 40);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    fail(path, "must be a valid UTC date");
  const canonical = result.includes(".")
    ? result.replace(
        /\.(\d{1,3})Z$/,
        (_, ms: string) => `.${ms.padEnd(3, "0")}Z`,
      )
    : result.replace(/Z$/, ".000Z");
  if (new Date(result).toISOString() !== canonical)
    fail(path, "contains an invalid calendar date");
  return result;
}
function array(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max)
    fail(path, `must be an array of at most ${max} items`);
  return value;
}
function member<T extends string>(
  value: unknown,
  choices: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    fail(path, "has an unsupported value");
  return value as T;
}
function position(value: unknown, path: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    Math.abs(value) > 1e9
  )
    fail(path, "must be a finite canvas coordinate within one billion units");
  return value;
}
function unique(values: string[], path: string): void {
  if (new Set(values).size !== values.length)
    fail(path, "contains duplicate identifiers");
}
function optionalText(
  value: unknown,
  path: string,
  max: number,
): string | undefined {
  return value === undefined ? undefined : string(value, path, max);
}

/** Validate and reconstruct an import. Unknown fields never enter trusted app state. */
export function validateProject(value: unknown): Project {
  const p = object(value, "root");
  if (
    p.schemaVersion !== 1 &&
    p.schemaVersion !== 2 &&
    p.schemaVersion !== 3 &&
    p.schemaVersion !== 4
  )
    fail("schemaVersion", "is not supported (expected 1, 2, 3, or 4)");
  let textSize = 0;
  const budget = (amount: number): void => {
    textSize += amount;
    if (textSize > 30_000_000)
      fail("content", "exceeds the 30 million character workspace limit");
  };
  const cards: ResearchCard[] = array(p.cards, "cards", 5000).map(
    (value, index) => {
      const path = `cards[${index}]`,
        c = object(value, path);
      const content = string(c.content, `${path}.content`, 1_000_000);
      const extraction = optionalText(
        c.extraction,
        `${path}.extraction`,
        1_000_000,
      );
      budget(content.length + (extraction?.length ?? 0));
      const url = optionalText(c.url, `${path}.url`, 8192);
      if (url) {
        try {
          const parsed = new URL(url);
          if (
            !["http:", "https:"].includes(parsed.protocol) ||
            parsed.username ||
            parsed.password
          )
            fail(`${path}.url`, "must be an HTTP(S) URL without credentials");
        } catch {
          fail(`${path}.url`, "must be an HTTP(S) URL without credentials");
        }
      }
      const assetId = optionalText(c.assetId, `${path}.assetId`, 36);
      if (assetId !== undefined && !ASSET_ID.test(assetId))
        fail(`${path}.assetId`, "must be a UUID");
      const result: ResearchCard = {
        id: id(c.id, `${path}.id`),
        kind: member(c.kind, CARD_KINDS, `${path}.kind`),
        title: string(c.title, `${path}.title`, 1000),
        content,
        x: position(c.x, `${path}.x`),
        y: position(c.y, `${path}.y`),
        tags: array(c.tags, `${path}.tags`, 100).map((tag, i) =>
          string(tag, `${path}.tags[${i}]`, 100),
        ),
        status: member(c.status, STATUSES, `${path}.status`),
        url,
        assetId,
        fileName: optionalText(c.fileName, `${path}.fileName`, 1000),
        mimeType: optionalText(c.mimeType, `${path}.mimeType`, 255),
        extraction,
        sourceId:
          c.sourceId === undefined
            ? undefined
            : id(c.sourceId, `${path}.sourceId`),
        methodId:
          c.methodId === undefined
            ? undefined
            : id(c.methodId, `${path}.methodId`),
        boardReference:
          c.boardReference === undefined
            ? undefined
            : validateBoardReference(c.boardReference),
        createdAt: date(c.createdAt, `${path}.createdAt`),
        updatedAt: date(c.updatedAt, `${path}.updatedAt`),
      };
      if (result.boardReference && p.schemaVersion !== 4)
        fail(`${path}.boardReference`, "requires portable project version 4");
      if (
        result.boardReference &&
        result.methodId &&
        (result.boardReference.kind !== "method" ||
          result.boardReference.id !== result.methodId)
      )
        fail(
          `${path}.methodId`,
          "does not match its authoritative board reference",
        );
      budget(
        result.title.length +
          result.tags.reduce((n, tag) => n + tag.length, 0) +
          (url?.length ?? 0) +
          (result.fileName?.length ?? 0),
      );
      return result;
    },
  );
  unique(
    cards.map((c) => c.id),
    "cards",
  );
  const cardIds = new Set(cards.map((c) => c.id));
  const connections: Connection[] = array(
    p.connections,
    "connections",
    25_000,
  ).map((value, index) => {
    const path = `connections[${index}]`,
      c = object(value, path);
    const source = id(c.source, `${path}.source`),
      target = id(c.target, `${path}.target`);
    if (!cardIds.has(source) || !cardIds.has(target))
      fail(path, "refers to a missing card");
    if (source === target) fail(path, "cannot connect a card to itself");
    return {
      id: id(c.id, `${path}.id`),
      source,
      target,
      relation: member(c.relation, RELATIONS, `${path}.relation`),
    };
  });
  unique(
    connections.map((c) => c.id),
    "connections",
  );
  const outputs: ResearchOutput[] = array(p.outputs, "outputs", 1000).map(
    (value, index) => {
      const path = `outputs[${index}]`,
        o = object(value, path);
      const markdown = string(o.markdown, `${path}.markdown`, 1_000_000);
      budget(markdown.length);
      const sourceIds = array(o.sourceIds, `${path}.sourceIds`, 5000).map(
        (s, i) => id(s, `${path}.sourceIds[${i}]`),
      );
      unique(sourceIds, `${path}.sourceIds`);
      budget(sourceIds.reduce((n, sourceId) => n + sourceId.length, 0));
      // Released outputs retain historical provenance when a source is later deleted.
      return {
        id: id(o.id, `${path}.id`),
        kind: member(
          o.kind,
          Object.keys(OUTPUT_LABELS) as OutputKind[],
          `${path}.kind`,
        ),
        title: string(o.title, `${path}.title`, 2000),
        markdown,
        provider: string(o.provider, `${path}.provider`, 1000),
        sourceIds,
        createdAt: date(o.createdAt, `${path}.createdAt`),
        boardUpdatedAt: date(o.boardUpdatedAt, `${path}.boardUpdatedAt`),
        citations:
          o.citations === undefined
            ? undefined
            : array(o.citations, `${path}.citations`, 10000).map((v, i) =>
                validateCitation(v, `${path}.citations[${i}]`),
              ),
        runId: o.runId === undefined ? undefined : id(o.runId, `${path}.runId`),
        pedigreeSnapshotId:
          o.pedigreeSnapshotId === undefined
            ? undefined
            : id(o.pedigreeSnapshotId, `${path}.pedigreeSnapshotId`),
        plan:
          o.plan === undefined ? undefined : validateProjectPlanContext(o.plan),
        deliveryPlan:
          o.deliveryPlan === undefined
            ? undefined
            : validateDeliveryPlan(o.deliveryPlan),
        document:
          o.document === undefined
            ? undefined
            : validateReportDocument(o.document),
        revisions:
          o.revisions === undefined
            ? undefined
            : array(o.revisions, `${path}.revisions`, 1000).map((v, i) => {
                const r = object(v, `${path}.revisions[${i}]`);
                const md = string(r.markdown, "revision markdown", 1_000_000);
                budget(md.length);
                return {
                  id: id(r.id, "revision id"),
                  createdAt: date(r.createdAt, "revision date"),
                  document: validateReportDocument(r.document),
                  markdown: md,
                  citations: array(
                    r.citations,
                    "revision citations",
                    10000,
                  ).map((v) => validateCitation(v)),
                  note: string(r.note, "revision note", 10000),
                  pedigreeSnapshotId:
                    r.pedigreeSnapshotId === undefined
                      ? undefined
                      : id(r.pedigreeSnapshotId, "revision pedigree snapshot"),
                  plan:
                    r.plan === undefined
                      ? undefined
                      : validateProjectPlanContext(r.plan),
                  deliveryPlan:
                    r.deliveryPlan === undefined
                      ? undefined
                      : validateDeliveryPlan(r.deliveryPlan),
                  review:
                    r.review === undefined
                      ? undefined
                      : (() => {
                          const review = object(r.review, "revision review");
                          if (typeof review.acknowledged !== "boolean")
                            fail(
                              "revision review acknowledgement",
                              "must be boolean",
                            );
                          return {
                            checkedAt: date(review.checkedAt, "review date"),
                            warnings: array(
                              review.warnings,
                              "review warnings",
                              1000,
                            ).map((warning) =>
                              string(warning, "review warning", 10000),
                            ),
                            acknowledged: review.acknowledged as boolean,
                          };
                        })(),
                };
              }),
        releasedRevisionId:
          o.releasedRevisionId === undefined
            ? undefined
            : id(o.releasedRevisionId, `${path}.releasedRevisionId`),
      };
    },
  );
  unique(
    outputs.map((o) => o.id),
    "outputs",
  );
  for (const output of outputs) {
    if (
      output.releasedRevisionId &&
      !output.revisions?.some((r) => r.id === output.releasedRevisionId)
    )
      fail("releasedRevisionId", "refers to a missing report revision");
  }
  const privacy =
    p.privacy === undefined
      ? { mode: "local" as const }
      : (() => {
          const settings = object(p.privacy, "privacy");
          return {
            mode: member(
              settings.mode,
              ["local", "cloud"] as const,
              "privacy.mode",
            ),
            provider:
              settings.provider === undefined
                ? undefined
                : member(
                    settings.provider,
                    ["offline", "ollama", "compatible"] as const,
                    "privacy.provider",
                  ),
            endpoint: (() => {
              const endpoint = optionalText(
                settings.endpoint,
                "privacy.endpoint",
                8192,
              );
              if (endpoint) {
                try {
                  const u = new URL(endpoint);
                  if (
                    !["http:", "https:"].includes(u.protocol) ||
                    u.username ||
                    u.password ||
                    u.search ||
                    u.hash
                  )
                    fail(
                      "privacy.endpoint",
                      "must be an HTTP(S) endpoint without credentials, query or fragment",
                    );
                } catch {
                  fail(
                    "privacy.endpoint",
                    "must be an HTTP(S) endpoint without credentials, query or fragment",
                  );
                }
              }
              return endpoint;
            })(),
            model: optionalText(settings.model, "privacy.model", 1000),
          };
        })();
  const groups =
    p.groups === undefined
      ? []
      : array(p.groups, "groups", 1000).map((v) => {
          const g = object(v, "group");
          return {
            id: id(g.id, "group.id"),
            title: string(g.title, "group.title", 1000),
            color: string(g.color, "group.color", 100),
            cardIds: array(g.cardIds, "group.cardIds", 5000)
              .map((v) => id(v, "group.cardId"))
              .filter((v) => cardIds.has(v)),
          };
        });
  const views =
    p.views === undefined
      ? []
      : array(p.views, "views", 1000).map((v) => {
          const w = object(v, "view");
          const zoom = position(w.zoom, "view.zoom");
          if (zoom <= 0 || zoom > 10)
            fail("view.zoom", "must be between 0 and 10");
          return {
            id: id(w.id, "view.id"),
            title: string(w.title, "view.title", 1000),
            x: position(w.x, "view.x"),
            y: position(w.y, "view.y"),
            zoom,
          };
        });
  unique(
    groups.map((g) => g.id),
    "groups",
  );
  unique(
    views.map((v) => v.id),
    "views",
  );
  const releasedOutputId =
    p.releasedOutputId === undefined
      ? undefined
      : id(p.releasedOutputId, "releasedOutputId");
  if (releasedOutputId && !outputs.some((o) => o.id === releasedOutputId))
    fail("releasedOutputId", "refers to a missing output");
  return {
    schemaVersion: p.schemaVersion,
    privacy,
    groups,
    views,
    releasedOutputId,
    id: id(p.id, "id"),
    title: string(p.title, "title", 1000),
    question: string(p.question, "question", 10_000),
    cards,
    connections,
    outputs,
    createdAt: date(p.createdAt, "createdAt"),
    updatedAt: date(p.updatedAt, "updatedAt"),
  };
}

export function validateProjectPlanContext(value: unknown): ProjectPlanContext {
  const p = object(value, "project plan context");
  return {
    analysisOutputId: id(p.analysisOutputId, "analysis output"),
    analysisRevisionId:
      p.analysisRevisionId === undefined
        ? undefined
        : id(p.analysisRevisionId, "analysis revision"),
    gapClaimId:
      p.gapClaimId === undefined ? undefined : id(p.gapClaimId, "gap finding"),
    gap: string(p.gap, "gap", 30000),
    deliverableType: member(
      p.deliverableType,
      ["software", "curriculum", "other"] as const,
      "deliverable type",
    ),
    deliverable: string(p.deliverable, "deliverable", 30000),
    acceptanceCriteria: string(
      p.acceptanceCriteria,
      "acceptance criteria",
      30000,
    ),
    analysisTitle:
      p.analysisTitle === undefined
        ? undefined
        : string(p.analysisTitle, "analysis title", 2000),
    analysisMarkdown:
      p.analysisMarkdown === undefined
        ? undefined
        : string(p.analysisMarkdown, "analysis snapshot", 1_000_000),
    analysisCitations:
      p.analysisCitations === undefined
        ? undefined
        : array(p.analysisCitations, "analysis citations", 10000).map((v) =>
            validateCitation(v),
          ),
  };
}

export function validateCitation(value: unknown, path = "citation"): Citation {
  const c = object(value, path);
  const url = optionalText(c.url, `${path}.url`, 8192);
  if (url) {
    try {
      const parsed = new URL(url);
      if (
        !["http:", "https:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        fail(path, "contains an unsafe URL");
    } catch {
      fail(path, "contains an unsafe URL");
    }
  }
  return {
    id: id(c.id, `${path}.id`),
    label: string(c.label, `${path}.label`, 100),
    sourceId:
      c.legacyCardId && c.sourceId === ""
        ? ""
        : id(c.sourceId, `${path}.sourceId`),
    versionId:
      c.legacyCardId && c.versionId === ""
        ? ""
        : id(c.versionId, `${path}.versionId`),
    passageId:
      c.legacyCardId && c.passageId === ""
        ? ""
        : id(c.passageId, `${path}.passageId`),
    sourceTitle: string(c.sourceTitle, `${path}.sourceTitle`, 2000),
    locator: string(c.locator, `${path}.locator`, 1000),
    quote: string(c.quote, `${path}.quote`, 4_000_000),
    url,
    acquiredAt: date(c.acquiredAt, `${path}.acquiredAt`),
    verified: c.verified === true,
    legacyCardId:
      c.legacyCardId === undefined
        ? undefined
        : id(c.legacyCardId, `${path}.legacyCardId`),
  };
}

export function validateReportDocument(value: unknown): ReportDocument {
  let count = 0,
    totalText = 0;
  const visit = (value: unknown, depth = 0): ReportDocument => {
    if (depth > 40 || ++count > 100000) fail("document", "is too complex");
    const node = object(value, "document node"),
      type = string(node.type, "document type", 100);
    totalText += typeof node.text === "string" ? node.text.length : 0;
    if (totalText > 10_000_000)
      fail("document", "exceeds the 10 million character limit");
    if (
      ![
        "doc",
        "paragraph",
        "text",
        "heading",
        "bulletList",
        "orderedList",
        "listItem",
        "blockquote",
        "codeBlock",
        "hardBreak",
        "horizontalRule",
        "table",
        "tableRow",
        "tableCell",
        "tableHeader",
        "citation",
      ].includes(type)
    )
      fail("document node", "has unsupported type");
    const attrs: Record<string, unknown> = {};
    if (node.attrs) {
      const raw = object(node.attrs, "document attributes");
      for (const key of [
        "level",
        "start",
        "colspan",
        "rowspan",
        "colwidth",
        "citationId",
        "id",
        "label",
        "language",
        "textAlign",
      ])
        if (raw[key] !== undefined) {
          const val = raw[key];
          if (
            ["string", "number"].includes(typeof val) ||
            val === null ||
            (Array.isArray(val) && val.every((v) => typeof v === "number"))
          )
            attrs[key] = val;
        }
    }
    const marks =
      node.marks === undefined
        ? undefined
        : array(node.marks, "marks", 20).map((v) => {
            const m = object(v, "mark");
            const type = member(
              m.type,
              [
                "bold",
                "italic",
                "strike",
                "code",
                "underline",
                "link",
              ] as const,
              "mark.type",
            );
            if (type === "link") {
              const a = object(m.attrs, "link attributes");
              const href = string(a.href, "link href", 8192);
              if (href) {
                try {
                  const u = new URL(href);
                  if (
                    !["https:", "http:"].includes(u.protocol) ||
                    u.username ||
                    u.password
                  )
                    fail("link", "contains an unsafe URL");
                } catch {
                  fail("link", "contains an unsafe URL");
                }
              }
              return { type, attrs: { href } };
            }
            return { type };
          });
    return {
      type,
      attrs: Object.keys(attrs).length ? attrs : undefined,
      text:
        node.text === undefined
          ? undefined
          : string(node.text, "document text", 1_000_000),
      marks,
      content:
        node.content === undefined
          ? undefined
          : array(node.content, "document content", 100000).map((v) =>
              visit(v, depth + 1),
            ),
    };
  };
  const result = visit(value);
  if (result.type !== "doc") fail("document", "must have a doc root");
  return result;
}

/** Fixed illustrative investigation: the disagreement and missing long-term evidence are intentional. */
export function createEvidenceSampleProject(): Project {
  const project = createBlankProject();
  project.title = "Sample investigation: library opening hours";
  project.question =
    "Should the community library extend evening opening hours?";
  const entries: [string, string, string][] = [
    [
      "question",
      "Decision to investigate",
      "Should the library remain open until 9 pm? This is a fictional training investigation, not real research.",
    ],
    [
      "note",
      "Supporting evidence — patron survey",
      "Fictional survey: 120 of 200 respondents requested evening access. The convenience sample only included current library patrons.",
    ],
    [
      "note",
      "Counterevidence — evening pilot",
      "Fictional four-week pilot: after 7 pm attendance averaged 8 visits per night and staffing costs exceeded the pilot budget. This contradicts the assumption of high immediate demand.",
    ],
    [
      "note",
      "Alternative explanation",
      "The survey and pilot can both be accurate: stated interest may not translate to visits, and a short pilot may miss seasonal demand.",
    ],
    [
      "question",
      "Missing evidence",
      "No long-term attendance series, non-user survey, transport access study, or cost per additional visit is available. Further investigation is required.",
    ],
  ];
  project.cards = entries.map(([kind, title, content], i) => ({
    id: `sample-${i}`,
    kind: kind as CardKind,
    title,
    content,
    x: (i % 3) * 370,
    y: Math.floor(i / 3) * 330,
    tags: ["fictional sample"],
    status: i === 2 ? "disputed" : "unreviewed",
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  }));
  project.connections = [
    {
      id: "sample-support",
      source: "sample-1",
      target: "sample-0",
      relation: "supports",
    },
    {
      id: "sample-counter",
      source: "sample-2",
      target: "sample-0",
      relation: "contradicts",
    },
    {
      id: "sample-gap",
      source: "sample-4",
      target: "sample-0",
      relation: "investigate",
    },
  ];
  return project;
}
