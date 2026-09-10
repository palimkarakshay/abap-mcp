/**
 * Bundled SAP knowledge base: ABAP Cloud / RAP release deltas, Clean Core
 * governance vocabulary, and decision cards for the SAP AI options an ABAP
 * team can reach in 2026.
 *
 * Like `released.ts`, the data under src/data/knowledge/ is a PACKAGE-BUNDLED
 * asset: importing it touches no network and no user filesystem, so it does not
 * violate the server's "text in, JSON out, offline" contract. Every row is an
 * original abap-mcp summary written over a cited source — no help.sap.com,
 * community.sap.com or SAP Note prose is reproduced (see MANIFEST.json).
 *
 * Knowledge here is DATED. Both public query functions append a scope note
 * saying so, because the only authoritative answer about a customer's own
 * system is that system's own release notes.
 */
import deltasData from "../data/knowledge/abap-release-deltas.json" with { type: "json" };
import cleanCoreData from "../data/knowledge/clean-core.json" with { type: "json" };
import manifestData from "../data/knowledge/MANIFEST.json" with { type: "json" };
import sapAiData from "../data/knowledge/sap-ai-options.json" with { type: "json" };

/* ------------------------------------------------------------------ types */

/** Release identifiers, oldest first. `platform-2025` (SAP_BASIS 816, GA 2025-10-08) sits between the 2508 and 2511 cloud trains. */
export const KNOWLEDGE_RELEASES = [
  "pre-2502",
  "2502",
  "2505",
  "2508",
  "platform-2025",
  "2511",
  "2602",
  "2605",
  "2608",
] as const;
export type KnowledgeRelease = (typeof KNOWLEDGE_RELEASES)[number];

export const KNOWLEDGE_PRODUCTS = ["btp", "s4hc-public", "s4hc-private", "onprem"] as const;
export type KnowledgeProduct = (typeof KNOWLEDGE_PRODUCTS)[number];

export const KNOWLEDGE_KINDS = [
  "language",
  "cds",
  "sql",
  "rap",
  "testing",
  "atc",
  "tooling",
  "eml",
] as const;
export type KnowledgeKind = (typeof KNOWLEDGE_KINDS)[number];

export const KNOWLEDGE_SOURCE_KINDS = [
  "help.sap.com",
  "sap-blog",
  "sap-github",
  "news.sap.com",
] as const;
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number];

export const KNOWLEDGE_CONFIDENCE = ["confirmed", "reported"] as const;
export type KnowledgeConfidence = (typeof KNOWLEDGE_CONFIDENCE)[number];

export const KNOWLEDGE_AREAS = ["release", "clean-core", "sap-ai"] as const;
export type KnowledgeArea = (typeof KNOWLEDGE_AREAS)[number];

/** One verified release-delta fact. */
export interface ReleaseDelta {
  id: string;
  title: string;
  /** Original abap-mcp prose, never SAP text. */
  summary: string;
  syntaxSketch?: string;
  release: KnowledgeRelease;
  abapRelease?: string;
  products: KnowledgeProduct[];
  kind: KnowledgeKind;
  minRelease?: string;
  supersedes?: string[];
  sourceUrl: string;
  sourceKind: KnowledgeSourceKind;
  confidence: KnowledgeConfidence;
  keywords: string[];
}

/** One Clean Core / released-API governance fact. */
export interface CleanCoreEntry {
  id: string;
  topic: string;
  title: string;
  summary: string;
  note?: string;
  atcPriority?: string;
  licence?: string;
  supersedes?: string[];
  sourceUrl: string;
  sourceKind: KnowledgeSourceKind;
  confidence: KnowledgeConfidence;
  keywords: string[];
}

/** One SAP-AI decision card. Card-specific fields vary, so extra keys are allowed. */
export interface SapAiCard {
  id: string;
  title: string;
  kind: string;
  asOf: string;
  confidence: KnowledgeConfidence;
  summary: string;
  whenToUse: string;
  whenNotToUse: string;
  sources: string[];
  keywords: string[];
  [extra: string]: unknown;
}

export interface KnowledgeManifestSource {
  url: string;
  licence: string;
  retrievedAt: string;
}

export interface KnowledgeManifestFile {
  curatedDate: string;
  license: string;
  recordKey: string;
  sources: KnowledgeManifestSource[];
}

export interface KnowledgeManifest {
  manifestVersion: string;
  curatedDate: string;
  scopeNote: string;
  provenancePolicy: string;
  files: Record<string, KnowledgeManifestFile>;
}

/* ---------------------------------------------------------------- loaders */

const deltas = (deltasData as unknown as { deltas: ReleaseDelta[] }).deltas;
const cleanCore = (cleanCoreData as unknown as { entries: CleanCoreEntry[] }).entries;
const sapAi = (sapAiData as unknown as { cards: SapAiCard[] }).cards;
const manifest = manifestData as unknown as KnowledgeManifest;

/** The date this knowledge base was curated. Every answer is stamped with it. */
export const KNOWLEDGE_CURATED_DATE: string = manifest.curatedDate;

/**
 * The honesty note appended to every knowledge answer. The bundle is dated; a
 * customer's own system is the only authority on what that system supports.
 */
export const KNOWLEDGE_SCOPE_NOTE = `bundled knowledge curated ${KNOWLEDGE_CURATED_DATE}; the target system's release notes are authoritative`;

/** All release-delta rows, in file order. */
export function releaseDeltas(): readonly ReleaseDelta[] {
  return deltas;
}

/** All Clean Core governance rows, in file order. */
export function cleanCoreEntries(): readonly CleanCoreEntry[] {
  return cleanCore;
}

/** All SAP-AI decision cards, in file order. */
export function sapAiCards(): readonly SapAiCard[] {
  return sapAi;
}

/** The provenance manifest for the bundled knowledge files. */
export function knowledgeManifest(): KnowledgeManifest {
  return manifest;
}

/* -------------------------------------------------------------- internals */

const releaseIndex = new Map<string, number>(KNOWLEDGE_RELEASES.map((r, i) => [r, i]));

function orderOf(release: string): number {
  return releaseIndex.get(release) ?? -1;
}

function terms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9_.\-/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

/** Flatten any record to a lowercase haystack; card-specific nested fields are searchable too. */
function haystack(record: unknown): string {
  return JSON.stringify(record).toLowerCase();
}

/** Pull the sentences of a JSON blob that mention a term, for a compact "why this matched". */
function matchingFragments(record: unknown, queryTerms: string[], max: number): string[] {
  const fragments: string[] = [];
  const seen = new Set<string>();
  const walk = (value: unknown): void => {
    if (fragments.length >= max) return;
    if (typeof value === "string") {
      const lower = value.toLowerCase();
      if (value.length >= 20 && queryTerms.some((t) => lower.includes(t)) && !seen.has(value)) {
        seen.add(value);
        fragments.push(value.length > 320 ? `${value.slice(0, 317)}...` : value);
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) walk(item);
    }
  };
  walk(record);
  return fragments;
}

function scoreRecord(
  queryTerms: string[],
  rawQuery: string,
  parts: { title: string; id: string; keywords: string[]; summary: string; rest: string },
): number {
  const title = parts.title.toLowerCase();
  const id = parts.id.toLowerCase();
  const keywords = parts.keywords.join(" ").toLowerCase();
  const summary = parts.summary.toLowerCase();
  let score = 0;
  for (const term of queryTerms) {
    if (title.includes(term)) score += 8;
    if (id.includes(term)) score += 6;
    if (keywords.includes(term)) score += 5;
    if (summary.includes(term)) score += 3;
    else if (parts.rest.includes(term)) score += 1;
  }
  const phrase = rawQuery.trim().toLowerCase();
  if (phrase.length >= 4 && (title.includes(phrase) || parts.rest.includes(phrase))) score += 10;
  return score;
}

/* --------------------------------------------------------- explainAbapRelease */

export interface ExplainAbapReleaseQuery {
  /** Free-text topic, matched against ids, titles, keywords and summaries. */
  topic?: string;
  /** Only rows at this release or newer, in the chronological order of KNOWLEDGE_RELEASES. */
  sinceRelease?: string;
  /** Only rows that apply to this product. */
  product?: string;
  /** Only rows of this kind. */
  kind?: string;
  /** Cap on returned rows (default 60). */
  limit?: number;
}

export interface ExplainAbapReleaseResult {
  curatedDate: string;
  scopeNote: string;
  query: {
    topic?: string;
    sinceRelease?: string;
    product?: string;
    kind?: string;
  };
  matchCount: number;
  truncated: boolean;
  deltas: ReleaseDelta[];
}

/**
 * Answer "what changed in ABAP Cloud / RAP, and when" from the bundled deltas.
 *
 * Filters are ANDed. Results are sorted newest release first, then by title, so
 * a caller that asks "since 2605" reads the newest facts at the top.
 */
export function explainAbapRelease(q: ExplainAbapReleaseQuery = {}): ExplainAbapReleaseResult {
  const limit = q.limit !== undefined && q.limit > 0 ? Math.min(q.limit, 200) : 60;
  const sinceOrder = q.sinceRelease !== undefined ? orderOf(q.sinceRelease) : -1;
  const topicTerms = q.topic !== undefined && q.topic.trim() !== "" ? terms(q.topic) : [];

  const scored: { delta: ReleaseDelta; score: number }[] = [];
  for (const delta of deltas) {
    if (q.kind !== undefined && delta.kind !== q.kind) continue;
    if (q.product !== undefined && !delta.products.includes(q.product as KnowledgeProduct)) continue;
    if (sinceOrder >= 0 && orderOf(delta.release) < sinceOrder) continue;

    let score = 0;
    if (topicTerms.length > 0) {
      score = scoreRecord(topicTerms, q.topic ?? "", {
        title: delta.title,
        id: delta.id,
        keywords: delta.keywords,
        summary: delta.summary,
        rest: haystack(delta),
      });
      if (score === 0) continue;
    }
    scored.push({ delta, score });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const orderDiff = orderOf(b.delta.release) - orderOf(a.delta.release);
    if (orderDiff !== 0) return orderDiff;
    return a.delta.title.localeCompare(b.delta.title);
  });

  const query: ExplainAbapReleaseResult["query"] = {};
  if (q.topic !== undefined) query.topic = q.topic;
  if (q.sinceRelease !== undefined) query.sinceRelease = q.sinceRelease;
  if (q.product !== undefined) query.product = q.product;
  if (q.kind !== undefined) query.kind = q.kind;

  return {
    curatedDate: KNOWLEDGE_CURATED_DATE,
    scopeNote: KNOWLEDGE_SCOPE_NOTE,
    query,
    matchCount: scored.length,
    truncated: scored.length > limit,
    deltas: scored.slice(0, limit).map((s) => s.delta),
  };
}

/* ------------------------------------------------------- lookupSapKnowledge */

export interface LookupSapKnowledgeQuery {
  query: string;
  area?: KnowledgeArea | "all";
  limit?: number;
}

export interface KnowledgeHit {
  area: KnowledgeArea;
  id: string;
  title: string;
  summary: string;
  confidence: KnowledgeConfidence;
  score: number;
  /** Every source URL backing this card. */
  sources: string[];
  /** The strings in the record that mentioned the query terms. */
  matches: string[];
  /** The full underlying record, so the caller does not need a second lookup. */
  detail: Record<string, unknown>;
}

export interface LookupSapKnowledgeResult {
  curatedDate: string;
  scopeNote: string;
  query: string;
  area: KnowledgeArea | "all";
  matchCount: number;
  truncated: boolean;
  hits: KnowledgeHit[];
}

/**
 * Rank the whole bundled knowledge base against a free-text question and return
 * cards with their sources. `area` narrows to one of the three files.
 */
export function lookupSapKnowledge(q: LookupSapKnowledgeQuery): LookupSapKnowledgeResult {
  const area: KnowledgeArea | "all" = q.area ?? "all";
  const limit = q.limit !== undefined && q.limit > 0 ? Math.min(q.limit, 25) : 5;
  const queryTerms = terms(q.query);

  const hits: KnowledgeHit[] = [];

  const consider = (
    recordArea: KnowledgeArea,
    id: string,
    title: string,
    summary: string,
    keywords: string[],
    confidence: KnowledgeConfidence,
    sources: string[],
    record: Record<string, unknown>,
  ): void => {
    const rest = haystack(record);
    const score = scoreRecord(queryTerms, q.query, { title, id, keywords, summary, rest });
    if (score <= 0) return;
    hits.push({
      area: recordArea,
      id,
      title,
      summary,
      confidence,
      score,
      sources,
      matches: matchingFragments(record, queryTerms, 4),
      detail: record,
    });
  };

  if (queryTerms.length > 0) {
    if (area === "all" || area === "release") {
      for (const d of deltas) {
        consider("release", d.id, d.title, d.summary, d.keywords, d.confidence, [d.sourceUrl], d as unknown as Record<string, unknown>);
      }
    }
    if (area === "all" || area === "clean-core") {
      for (const e of cleanCore) {
        consider("clean-core", e.id, e.title, e.summary, e.keywords, e.confidence, [e.sourceUrl], e as unknown as Record<string, unknown>);
      }
    }
    if (area === "all" || area === "sap-ai") {
      for (const c of sapAi) {
        consider("sap-ai", c.id, c.title, c.summary, c.keywords, c.confidence, c.sources, c as unknown as Record<string, unknown>);
      }
    }
  }

  hits.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.id.localeCompare(b.id)));

  return {
    curatedDate: KNOWLEDGE_CURATED_DATE,
    scopeNote: KNOWLEDGE_SCOPE_NOTE,
    query: q.query,
    area,
    matchCount: hits.length,
    truncated: hits.length > limit,
    hits: hits.slice(0, limit),
  };
}

/* ------------------------------------------------- resource-facing helpers */

/** Render one knowledge record as Markdown, for the text/markdown resource variant. */
export function renderKnowledgeMarkdown(
  area: KnowledgeArea,
  record: Record<string, unknown>,
): string {
  const lines: string[] = [];
  const title = typeof record["title"] === "string" ? record["title"] : String(record["id"] ?? "");
  lines.push(`# ${title}`, "");
  const summary = record["summary"];
  if (typeof summary === "string") lines.push(summary, "");

  const skip = new Set(["id", "title", "summary"]);
  for (const [key, value] of Object.entries(record)) {
    if (skip.has(key) || value === undefined || value === null) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      lines.push(`- **${key}**: ${String(value)}`);
    } else if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      lines.push(`- **${key}**: ${(value as string[]).join(", ")}`);
    } else {
      lines.push(`- **${key}**:`, "", "```json", JSON.stringify(value, null, 2), "```", "");
    }
  }
  lines.push("", `_area: ${area} — ${KNOWLEDGE_SCOPE_NOTE}._`);
  return lines.join("\n");
}
