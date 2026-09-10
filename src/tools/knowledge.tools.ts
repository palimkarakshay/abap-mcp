/**
 * Knowledge tools over the bundled SAP knowledge base (src/data/knowledge/).
 *
 * Same rubric as src/abap.tools.ts: verb-first snake_case name, what it operates
 * on, an explicit "Use this when …", explicit non-goals, every parameter
 * described, at least one worked example, readOnlyHint on everything.
 *
 * NOTE: these specs are intentionally NOT registered here. The integrator wires
 * them into ALL_TOOLS.
 */
import { z } from "zod";

import {
  explainAbapRelease,
  KNOWLEDGE_AREAS,
  KNOWLEDGE_CONFIDENCE,
  KNOWLEDGE_CURATED_DATE,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_PRODUCTS,
  KNOWLEDGE_RELEASES,
  KNOWLEDGE_SOURCE_KINDS,
  lookupSapKnowledge,
} from "../abap/knowledge.js";
import type { AnyToolSpec } from "../tool.js";
import { defineTool } from "../tool.js";

const releaseEnum = z.enum(KNOWLEDGE_RELEASES);
const productEnum = z.enum(KNOWLEDGE_PRODUCTS);
const kindEnum = z.enum(KNOWLEDGE_KINDS);
const confidenceEnum = z.enum(KNOWLEDGE_CONFIDENCE);
const sourceKindEnum = z.enum(KNOWLEDGE_SOURCE_KINDS);
const areaEnum = z.enum(KNOWLEDGE_AREAS);

const deltaShape = z.object({
  id: z.string().describe("Stable row id, also its resource id under abap-mcp://knowledge/release/."),
  title: z.string().describe("Short headline for the change."),
  summary: z.string().describe("Original abap-mcp summary of the change, never SAP's own wording."),
  syntaxSketch: z
    .string()
    .optional()
    .describe("Short illustrative ABAP or CDS snippet written for this entry; a shape hint, not drop-in code."),
  release: releaseEnum.describe("Release the change belongs to, or platform-2025 / pre-2502."),
  abapRelease: z
    .string()
    .optional()
    .describe('ABAP language release, e.g. "9.19" for the 2605 cloud train or "8.16" for ABAP Platform 2025.'),
  products: z.array(productEnum).describe("Products this row was verified for."),
  kind: kindEnum.describe("Facet: language, cds, sql, rap, testing, atc, tooling or eml."),
  minRelease: z
    .string()
    .optional()
    .describe("Lowest release that supports the feature, when the source stated one."),
  supersedes: z
    .array(z.string())
    .optional()
    .describe("Objects or artifacts this change replaces or deprecates, when named."),
  sourceUrl: z.string().describe("The cited SAP source this summary was written from."),
  sourceKind: sourceKindEnum.describe("Which kind of SAP source the URL points at."),
  confidence: confidenceEnum.describe(
    '"confirmed" = independently fact-checked against the source; "reported" = single-source or search-snippet only.',
  ),
  keywords: z.array(z.string()).describe("Search terms this row answers to."),
});

export const explainAbapReleaseTool = defineTool({
  name: "explain_abap_release",
  title: "Explain ABAP Cloud / RAP release deltas",
  description:
    "Look up what changed in ABAP Cloud, CDS, ABAP SQL, RAP, EML, ABAP Unit, ATC and the development tools across the " +
    "2502 to 2608 release trains plus ABAP Platform 2025 (SAP_BASIS 816), from a dated knowledge base bundled with this " +
    "package. Each row carries an original summary, an optional syntax sketch, the release and ABAP release, the products " +
    "it was verified for, the cited SAP source URL, and a confidence flag (\"confirmed\" = fact-checked, \"reported\" = " +
    "single-source). " +
    "Use this when you are about to write or review ABAP and need to know whether a language, CDS or RAP feature exists " +
    "in the target release — for example before using CDS table entities as draft persistence, BUFFER ON, RAP change " +
    "documents, global side effects, or a feature-control attribute. Filter by sinceRelease to see only what is new " +
    "since the customer's current level. Rows flagged pre-2502 exist to stop an agent presenting an established feature " +
    "(business events, late numbering, prechecks, bgPF) as a 2025-26 novelty. " +
    "It does not connect to any SAP system, does not read release notes live, and is not a complete changelog — it is a " +
    `curated snapshot (curated ${KNOWLEDGE_CURATED_DATE}) and the target system's own release notes stay authoritative. ` +
    'For released-API state of a specific object use check_released_api; for Clean Core levels and ATC vocabulary use search_sap_knowledge. ' +
    'Example: explain_abap_release({ "sinceRelease": "2605", "kind": "rap" }).',
  inputSchema: {
    topic: z
      .string()
      .optional()
      .describe(
        'Free-text topic matched against row ids, titles, keywords and summaries, e.g. "draft table entity", "side effects", "change documents". Omit it to browse a whole release or facet.',
      ),
    sinceRelease: releaseEnum
      .optional()
      .describe(
        'Return only rows at this release or newer, chronologically: pre-2502, 2502, 2505, 2508, platform-2025, 2511, 2602, 2605, 2608. Use the customer\'s current level, e.g. "2508", to see what upgrading buys them.',
      ),
    product: productEnum
      .optional()
      .describe(
        'Restrict to one product: "btp" (SAP BTP ABAP environment), "s4hc-public", "s4hc-private" or "onprem". Rows list the products their source actually verified.',
      ),
    kind: kindEnum
      .optional()
      .describe(
        'Restrict to one facet: "language", "cds", "sql", "rap", "testing", "atc", "tooling" or "eml". Use it to answer "what is new in RAP" without wading through tooling rows.',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Maximum rows to return, 1 to 200; defaults to 60. Raise it only when you really want a full release dump."),
  },
  outputSchema: {
    curatedDate: z.string().describe("Date the bundled knowledge base was curated."),
    scopeNote: z.string().describe("Dated-knowledge caveat to repeat to the user."),
    matchCount: z.number().describe("How many rows matched before the limit was applied."),
    truncated: z.boolean().describe("True when more rows matched than were returned."),
    deltas: z.array(deltaShape).describe("Matching release-delta rows, newest release first."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "What is new for RAP at or after the 2605 train.",
      arguments: { sinceRelease: "2605", kind: "rap" },
    },
    {
      description: "Find out when draft support on CDS table entities arrived.",
      arguments: { topic: "draft table entity" },
    },
    {
      description: "Everything the bundle records for ABAP Platform 2025 on private cloud.",
      arguments: { sinceRelease: "platform-2025", product: "s4hc-private" },
    },
  ],
  handler: (args) => {
    const result = explainAbapRelease({
      ...(args.topic !== undefined ? { topic: args.topic } : {}),
      ...(args.sinceRelease !== undefined ? { sinceRelease: args.sinceRelease } : {}),
      ...(args.product !== undefined ? { product: args.product } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
    const text =
      result.deltas.length === 0
        ? `No bundled release-delta row matched. ${result.scopeNote}.`
        : `${result.matchCount} row(s) matched${result.truncated ? `, showing ${result.deltas.length}` : ""}.\n` +
          result.deltas
            .map((d) => `[${d.release}${d.abapRelease !== undefined ? `/${d.abapRelease}` : ""}] ${d.title} (${d.kind}, ${d.confidence})\n  ${d.summary}\n  ${d.sourceUrl}`)
            .join("\n") +
          `\n\n${result.scopeNote}.`;
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        curatedDate: result.curatedDate,
        scopeNote: result.scopeNote,
        matchCount: result.matchCount,
        truncated: result.truncated,
        deltas: result.deltas,
      } as unknown as Record<string, unknown>,
    };
  },
});

const hitShape = z.object({
  area: areaEnum.describe("Which bundled file the card came from."),
  id: z.string().describe("Stable card id, also its MCP resource id."),
  title: z.string().describe("Short headline for the card."),
  summary: z.string().describe("Original abap-mcp summary of the card."),
  confidence: confidenceEnum.describe('"confirmed" = fact-checked against the source; "reported" = single-source.'),
  score: z.number().describe("Relevance score; higher matched more of the query."),
  sources: z.array(z.string()).describe("Every source URL backing this card."),
  matches: z.array(z.string()).describe("The strings inside the card that mentioned the query terms."),
  detail: z.record(z.string(), z.unknown()).describe("The full underlying record, so no second lookup is needed."),
});

export const searchSapKnowledgeTool = defineTool({
  name: "search_sap_knowledge",
  title: "Search the bundled SAP knowledge base",
  description:
    "Search one dated, cited knowledge bundle covering three areas: ABAP Cloud / RAP release deltas, Clean Core " +
    "governance (SAP's extensibility Levels A-D, release contracts C0 to C4, the real ATC check and variant names, and " +
    "the SAP/abap-atc-cr-cv-s4hc Cloudification Repository file and schema inventory), and decision cards for the SAP AI " +
    "options an ABAP team can reach (SAP-ABAP-1, the Generative AI Hub orchestration API, the ABAP AI SDK powered by " +
    "ISLM, Joule for Developers, SAP's official ADT MCP server, the custom code migration agent, and the community MCP " +
    "ecosystem). Every hit returns its sources, a confidence flag and the full card. " +
    "Use this when a question is about SAP facts rather than about a piece of source text — which Clean Core level a " +
    "pattern lands in, what a C1 release contract guarantees, which ATC variant to run, whether SAP-ABAP-1 accepts a " +
    "system prompt, which classes the ABAP AI SDK exposes, or what SAP's own MCP server can and cannot do. " +
    "It does not connect to any SAP system, does not run ATC, does not fetch anything live, and is not a substitute for " +
    `a real ATC run or for SAP's own documentation — it is a curated snapshot (curated ${KNOWLEDGE_CURATED_DATE}) and ` +
    "the target system and SAP's current documentation stay authoritative. " +
    "For release-timeline questions prefer explain_abap_release; for the release state of a specific object use " +
    "check_released_api; to analyze actual source text use lint_abap or check_cloud_readiness. " +
    'Example: search_sap_knowledge({ "query": "sap-abap-1 system prompt" }).',
  inputSchema: {
    query: z
      .string()
      .min(2)
      .describe(
        'The question or terms to search for, e.g. "clean core level C", "release contract C1", "sap-abap-1 system prompt", "ADT MCP server tools". Names, identifiers and class names work well.',
      ),
    area: z
      .enum([...KNOWLEDGE_AREAS, "all"])
      .optional()
      .describe(
        'Restrict the search: "release" (release deltas), "clean-core" (levels, contracts, ATC and repository facts), "sap-ai" (the AI decision cards), or "all" (default).',
      ),
    limit: z
      .number()
      .int()
      .min(1)
      .max(25)
      .optional()
      .describe("Maximum ranked cards to return, 1 to 25; defaults to 5. The SAP-AI cards are large, so keep this small."),
  },
  outputSchema: {
    curatedDate: z.string().describe("Date the bundled knowledge base was curated."),
    scopeNote: z.string().describe("Dated-knowledge caveat to repeat to the user."),
    matchCount: z.number().describe("How many cards matched before the limit was applied."),
    truncated: z.boolean().describe("True when more cards matched than were returned."),
    hits: z.array(hitShape).describe("Ranked cards, most relevant first."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Check whether SAP's ABAP model accepts a system prompt before wiring an integration.",
      arguments: { query: "sap-abap-1 system prompt" },
    },
    {
      description: "Get SAP's meaning of Clean Core Level C and its ATC priority.",
      arguments: { query: "clean core level C internal objects", area: "clean-core" },
    },
    {
      description: "Look up the ABAP AI SDK factory and exception classes.",
      arguments: { query: "CL_AIC_ISLM_COMPL_API_FACTORY exception", area: "sap-ai", limit: 2 },
    },
  ],
  handler: (args) => {
    const result = lookupSapKnowledge({
      query: args.query,
      ...(args.area !== undefined && args.area !== "all" ? { area: args.area } : {}),
      ...(args.limit !== undefined ? { limit: args.limit } : {}),
    });
    const text =
      result.hits.length === 0
        ? `Nothing in the bundled knowledge base matched "${result.query}". ${result.scopeNote}.`
        : `${result.matchCount} card(s) matched${result.truncated ? `, showing ${result.hits.length}` : ""}.\n` +
          result.hits
            .map(
              (h) =>
                `[${h.area}] ${h.title} (${h.confidence})\n  ${h.summary}\n  sources: ${h.sources.join(" ")}`,
            )
            .join("\n") +
          `\n\n${result.scopeNote}.`;
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        curatedDate: result.curatedDate,
        scopeNote: result.scopeNote,
        matchCount: result.matchCount,
        truncated: result.truncated,
        hits: result.hits,
      } as unknown as Record<string, unknown>,
    };
  },
});

/** The knowledge tools. Not registered here — the integrator wires ALL_TOOLS. */
export const KNOWLEDGE_TOOLS: readonly AnyToolSpec[] = [explainAbapReleaseTool, searchSapKnowledgeTool];
