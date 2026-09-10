/**
 * Gate for the bundled SAP knowledge base (F05).
 *
 * Three jobs:
 *  1. Schema-check every row so a hand-edited JSON file cannot ship broken.
 *  2. Prove the summaries are OUR prose — a hard 45-word cap, plus (when the
 *     research corpus happens to be on this machine) a verbatim-overlap probe
 *     against the raw NOTES files the rows were written from.
 *  3. Exercise the tools and the MCP resources over a real wire.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import {
  cleanCoreEntries,
  explainAbapRelease,
  KNOWLEDGE_CONFIDENCE,
  KNOWLEDGE_CURATED_DATE,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_PRODUCTS,
  KNOWLEDGE_RELEASES,
  KNOWLEDGE_SCOPE_NOTE,
  KNOWLEDGE_SOURCE_KINDS,
  knowledgeManifest,
  lookupSapKnowledge,
  releaseDeltas,
  sapAiCards,
} from "../abap/knowledge.js";
import { KNOWLEDGE_FILE_URIS, registerKnowledgeResources } from "../resources.js";
import { registerTools } from "../tool.js";
import { KNOWLEDGE_TOOLS } from "../tools/knowledge.tools.js";

const RELEASES = new Set<string>(KNOWLEDGE_RELEASES);
const PRODUCTS = new Set<string>(KNOWLEDGE_PRODUCTS);
const KINDS = new Set<string>(KNOWLEDGE_KINDS);
const SOURCE_KINDS = new Set<string>(KNOWLEDGE_SOURCE_KINDS);
const CONFIDENCE = new Set<string>(KNOWLEDGE_CONFIDENCE);

const MAX_SUMMARY_WORDS = 45;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isWellFormedUrl(value: string): boolean {
  if (!value.startsWith("https://")) return false;
  try {
    const url = new URL(value);
    return url.hostname.includes(".") && !url.hostname.endsWith(".");
  } catch {
    return false;
  }
}

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = new McpServer(
    { name: "abap-mcp-knowledge-test", version: "0.0.0" },
    { instructions: "knowledge fixture" },
  );
  registerTools(server, KNOWLEDGE_TOOLS);
  registerKnowledgeResources(server);
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("bundled knowledge base — release deltas", () => {
  const deltas = releaseDeltas();

  it("ships a usefully sized, uniquely keyed set of rows", () => {
    expect(deltas.length).toBeGreaterThanOrEqual(60);
    expect(deltas.length).toBeLessThanOrEqual(100);
    const ids = deltas.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every release train in the 2502-2608 window plus ABAP Platform 2025", () => {
    const seen = new Set(deltas.map((d) => d.release));
    for (const release of ["2502", "2508", "2511", "2602", "2605", "2608", "platform-2025"]) {
      expect(seen, `no row for release ${release}`).toContain(release);
    }
  });

  for (const delta of deltas) {
    describe(delta.id, () => {
      it("has every required field with a valid value", () => {
        expect(delta.id).toMatch(/^[a-z0-9][a-z0-9-.]*$/);
        expect(delta.title.length).toBeGreaterThanOrEqual(10);
        expect(delta.summary.length).toBeGreaterThanOrEqual(20);
        expect(RELEASES.has(delta.release), `bad release ${delta.release}`).toBe(true);
        expect(KINDS.has(delta.kind), `bad kind ${delta.kind}`).toBe(true);
        expect(SOURCE_KINDS.has(delta.sourceKind), `bad sourceKind ${delta.sourceKind}`).toBe(true);
        expect(CONFIDENCE.has(delta.confidence), `bad confidence ${delta.confidence}`).toBe(true);
        expect(delta.products.length).toBeGreaterThanOrEqual(1);
        for (const product of delta.products) {
          expect(PRODUCTS.has(product), `bad product ${product}`).toBe(true);
        }
        expect(delta.keywords.length).toBeGreaterThanOrEqual(3);
      });

      it("cites a well-formed https source", () => {
        expect(isWellFormedUrl(delta.sourceUrl), `bad sourceUrl ${delta.sourceUrl}`).toBe(true);
      });

      it(`summarizes in ${MAX_SUMMARY_WORDS} words or fewer (our prose, not SAP's)`, () => {
        expect(wordCount(delta.summary)).toBeLessThanOrEqual(MAX_SUMMARY_WORDS);
      });

      it("keeps optional fields well-typed when present", () => {
        if (delta.abapRelease !== undefined) expect(delta.abapRelease).toMatch(/^\d+\.\d+$/);
        if (delta.minRelease !== undefined) expect(RELEASES.has(delta.minRelease)).toBe(true);
        if (delta.supersedes !== undefined) expect(delta.supersedes.length).toBeGreaterThanOrEqual(1);
        if (delta.syntaxSketch !== undefined) expect(delta.syntaxSketch.length).toBeGreaterThanOrEqual(10);
      });
    });
  }
});

describe("bundled knowledge base — clean core", () => {
  const entries = cleanCoreEntries();

  it("covers the levels, the contracts and the ATC vocabulary", () => {
    const ids = new Set(entries.map((e) => e.id));
    for (const id of [
      "clean-core-level-a",
      "clean-core-level-b",
      "clean-core-level-c",
      "clean-core-level-d",
      "levels-replace-three-tier",
      "release-contract-c0",
      "release-contract-c1",
      "release-contract-c2",
      "release-contract-c3",
      "atc-variant-abap-clean-core-development",
      "atc-variant-abap-clean-core-readiness",
      "atc-check-usage-of-apis",
      "object-classifications-schema",
      "object-release-info-schema",
      "edition-names",
    ]) {
      expect(ids, `missing clean-core entry ${id}`).toContain(id);
    }
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it("keeps our own A-D grade distinct from SAP's Clean Core Level A-D", () => {
    const entry = entries.find((e) => e.id === "abap-mcp-grade-is-not-sap-level");
    expect(entry).toBeDefined();
    expect(entry!.summary.toLowerCase()).toContain("density");
  });

  it("records that API_RELEASE_STATE_CHECK is not a real ATC check", () => {
    const entry = entries.find((e) => e.id === "atc-no-api-release-state-check");
    expect(entry).toBeDefined();
    expect(entry!.confidence).toBe("confirmed");
  });

  for (const entry of entries) {
    it(`${entry.id} is schema-valid and cited`, () => {
      expect(entry.id).toMatch(/^[a-z0-9][a-z0-9-.]*$/);
      expect(entry.topic.length).toBeGreaterThanOrEqual(3);
      expect(entry.title.length).toBeGreaterThanOrEqual(10);
      expect(wordCount(entry.summary)).toBeLessThanOrEqual(MAX_SUMMARY_WORDS);
      expect(SOURCE_KINDS.has(entry.sourceKind)).toBe(true);
      expect(CONFIDENCE.has(entry.confidence)).toBe(true);
      expect(isWellFormedUrl(entry.sourceUrl), `bad sourceUrl ${entry.sourceUrl}`).toBe(true);
      expect(entry.keywords.length).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("bundled knowledge base — SAP AI decision cards", () => {
  const cards = sapAiCards();

  it("ships one card per option the roadmap named", () => {
    const ids = cards.map((c) => c.id);
    expect(ids).toEqual([
      "sap-abap-1",
      "generative-ai-hub-orchestration",
      "abap-ai-sdk-islm",
      "joule-for-developers",
      "official-adt-mcp-server",
      "custom-code-migration-agent",
      "community-servers",
    ]);
  });

  for (const card of cards) {
    it(`${card.id} carries whenToUse, whenNotToUse, sources, confidence and asOf`, () => {
      expect(card.whenToUse.length).toBeGreaterThanOrEqual(40);
      expect(card.whenNotToUse.length).toBeGreaterThanOrEqual(40);
      expect(card.sources.length).toBeGreaterThanOrEqual(1);
      for (const source of card.sources) {
        expect(isWellFormedUrl(source), `bad source ${source} on ${card.id}`).toBe(true);
      }
      expect(CONFIDENCE.has(card.confidence)).toBe(true);
      expect(card.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(wordCount(card.summary)).toBeLessThanOrEqual(MAX_SUMMARY_WORDS);
      expect(card.keywords.length).toBeGreaterThanOrEqual(3);
    });
  }

  it("records the load-bearing SAP-ABAP-1 limits", () => {
    const card = cards.find((c) => c.id === "sap-abap-1")!;
    const blob = JSON.stringify(card);
    expect(blob).toContain("2026-04-27");
    expect(blob).toContain("128,000");
    expect(blob).toContain("experimental");
  });

  it("records the ADT MCP server's 20 tools and the two Joule-gated ones", () => {
    const card = cards.find((c) => c.id === "official-adt-mcp-server")!;
    const tools = card["tools"] as { name: string; toolset: string; jouleLicence: boolean }[];
    expect(tools.length).toBe(20);
    expect(tools.filter((t) => t.jouleLicence).map((t) => t.name)).toEqual([
      "abap_atc_apply_ai_fix",
      "abap_atc_get_ai_fix_result",
    ]);
    expect(new Set(tools.map((t) => t.toolset)).size).toBe(8);
  });

  it("records the ABAP AI SDK class inventory", () => {
    const card = cards.find((c) => c.id === "abap-ai-sdk-islm")!;
    const names = (card["classInventory"] as { name: string }[]).map((c) => c.name);
    for (const expected of [
      "CL_AIC_ISLM_COMPL_API_FACTORY",
      "IF_AIC_ISLM_COMPL_API_FACTORY",
      "IF_AIC_COMPLETION_API",
      "IF_AIC_MESSAGE_CONTAINER",
      "CL_AIC_ISLM_PROMPT_TPL_FACTORY",
      "CL_AIC_ISLM_ORCH_API_FACTORY",
      "IF_AIC_ORCHESTRATION_API",
      "CX_AIC_API_FACTORY",
      "CX_AIC_COMPLETION_API",
    ]) {
      expect(names, `missing ${expected}`).toContain(expected);
    }
    expect(card["errorCodes"]).toEqual([
      "CONTEXT_LENGTH_EXCEEDED",
      "INVALID_PROMPT",
      "CONTENT_FILTER",
    ]);
  });

  it("records the orchestration V1 end-of-life date and the V2 endpoint", () => {
    const card = cards.find((c) => c.id === "generative-ai-hub-orchestration")!;
    expect(JSON.stringify(card)).toContain("2026-10-31");
    expect(JSON.stringify(card)).toContain("/v2/completion");
  });
});

describe("provenance manifest", () => {
  const manifest = knowledgeManifest();

  it("stamps every bundled file with a curation date, licence and sources", () => {
    expect(manifest.curatedDate).toBe(KNOWLEDGE_CURATED_DATE);
    for (const file of ["abap-release-deltas.json", "clean-core.json", "sap-ai-options.json"]) {
      const entry = manifest.files[file];
      expect(entry, `no manifest entry for ${file}`).toBeDefined();
      expect(entry!.license).toBe("abap-mcp original summaries (MIT) over cited sources");
      expect(entry!.curatedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry!.sources.length).toBeGreaterThanOrEqual(5);
      for (const source of entry!.sources) {
        expect(isWellFormedUrl(source.url), `bad manifest url ${source.url}`).toBe(true);
        expect(source.licence.length).toBeGreaterThanOrEqual(5);
        expect(source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("names every distinct sourceUrl used by the two cited-row files", () => {
    const manifestUrls = new Set(
      Object.values(manifest.files).flatMap((f) => f.sources.map((s) => s.url)),
    );
    // Row URLs may be deeper than the manifest's page-level entries, so compare hosts.
    const manifestHosts = new Set([...manifestUrls].map((u) => new URL(u).hostname));
    for (const row of [...releaseDeltas(), ...cleanCoreEntries()]) {
      expect(manifestHosts, `unlisted source host for ${row.id}`).toContain(
        new URL(row.sourceUrl).hostname,
      );
    }
  });
});

describe("no verbatim SAP prose", () => {
  /**
   * The hard rule is the word cap, enforced above on every row. When the
   * research corpus this bundle was written from is present on the machine, we
   * additionally probe for long sentences copied out of the raw NOTES files.
   */
  const corpus = "/home/akshay/docs/reports/abap-mcp-sap-ai-upgrade-2026-09-09/raw";

  function rawNotes(): string {
    if (!existsSync(corpus)) return "";
    const chunks: string[] = [];
    for (const dir of readdirSync(corpus)) {
      const notes = join(corpus, dir, "NOTES.md");
      if (existsSync(notes) && statSync(notes).isFile()) chunks.push(readFileSync(notes, "utf8"));
    }
    return chunks.join("\n").toLowerCase().replace(/\s+/g, " ");
  }

  it("has no long summary sentence that also appears in the raw research notes", () => {
    const haystack = rawNotes();
    if (haystack === "") {
      // Corpus not on this machine; the word cap above is the enforced rule.
      expect(releaseDeltas().every((d) => wordCount(d.summary) <= MAX_SUMMARY_WORDS)).toBe(true);
      return;
    }
    const offenders: string[] = [];
    const rows = [
      ...releaseDeltas().map((d) => ({ id: d.id, summary: d.summary })),
      ...cleanCoreEntries().map((e) => ({ id: e.id, summary: e.summary })),
      ...sapAiCards().map((c) => ({ id: c.id, summary: c.summary })),
    ];
    for (const row of rows) {
      for (const sentence of row.summary.split(/(?<=[.!?])\s+/)) {
        if (wordCount(sentence) <= 25) continue;
        const normalized = sentence.toLowerCase().replace(/\s+/g, " ").trim();
        if (haystack.includes(normalized)) offenders.push(`${row.id}: ${sentence}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("explainAbapRelease", () => {
  it("returns the draft-on-table-entities row for sinceRelease 2605", () => {
    const result = explainAbapRelease({ sinceRelease: "2605" });
    expect(result.deltas.map((d) => d.id)).toContain("rap-draft-on-cds-table-entities-2605");
    expect(result.scopeNote).toBe(KNOWLEDGE_SCOPE_NOTE);
    expect(result.curatedDate).toBe(KNOWLEDGE_CURATED_DATE);
  });

  it("excludes releases older than the sinceRelease floor", () => {
    const result = explainAbapRelease({ sinceRelease: "2605" });
    expect(result.deltas.length).toBeGreaterThan(0);
    for (const delta of result.deltas) {
      expect(["2605", "2608"]).toContain(delta.release);
    }
  });

  it("filters by kind and product together", () => {
    const result = explainAbapRelease({ kind: "rap", product: "s4hc-private" });
    expect(result.deltas.length).toBeGreaterThan(0);
    for (const delta of result.deltas) {
      expect(delta.kind).toBe("rap");
      expect(delta.products).toContain("s4hc-private");
    }
  });

  it("matches a free-text topic against keywords and titles", () => {
    const result = explainAbapRelease({ topic: "buffer on table entity" });
    expect(result.deltas.map((d) => d.id)).toContain("cds-table-entity-buffering-2508");
  });

  it("returns an empty, still-scoped result for an unknown topic", () => {
    const result = explainAbapRelease({ topic: "zzz-nonexistent-feature-name" });
    expect(result.deltas).toEqual([]);
    expect(result.matchCount).toBe(0);
    expect(result.scopeNote).toContain("authoritative");
  });
});

describe("lookupSapKnowledge", () => {
  it("returns the SAP-ABAP-1 card with the 2026-04-27 system-prompt fact", () => {
    const result = lookupSapKnowledge({ query: "sap-abap-1 system prompt" });
    expect(result.hits.length).toBeGreaterThan(0);
    const top = result.hits[0]!;
    expect(top.id).toBe("sap-abap-1");
    expect(top.area).toBe("sap-ai");
    expect(JSON.stringify(top.detail)).toContain("2026-04-27");
    expect(top.matches.join(" ")).toContain("2026-04-27");
    expect(top.sources.length).toBeGreaterThanOrEqual(3);
    expect(result.scopeNote).toBe(KNOWLEDGE_SCOPE_NOTE);
  });

  it("narrows to one area on request", () => {
    const result = lookupSapKnowledge({ query: "release contract C1", area: "clean-core" });
    expect(result.hits.length).toBeGreaterThan(0);
    for (const hit of result.hits) expect(hit.area).toBe("clean-core");
    expect(result.hits.map((h) => h.id)).toContain("release-contract-c1");
  });

  it("finds release deltas by feature name", () => {
    const result = lookupSapKnowledge({ query: "factory action http 201", area: "release" });
    expect(result.hits[0]!.id).toBe("rap-factory-action-http-201-2508");
  });

  it("honours the limit and reports truncation", () => {
    const result = lookupSapKnowledge({ query: "rap", limit: 2 });
    expect(result.hits.length).toBe(2);
    expect(result.truncated).toBe(true);
    expect(result.matchCount).toBeGreaterThan(2);
  });
});

describe("knowledge tools over the wire", () => {
  it("lists exactly the two knowledge tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["explain_abap_release", "search_sap_knowledge"]);
  });

  it("explain_abap_release returns the 2605 draft row over the wire", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "explain_abap_release",
      arguments: { sinceRelease: "2605" },
    })) as {
      isError?: boolean;
      structuredContent?: { scopeNote: string; deltas: { id: string; release: string }[] };
    };
    expect(result.isError ?? false).toBe(false);
    const sc = result.structuredContent!;
    expect(sc.deltas.map((d) => d.id)).toContain("rap-draft-on-cds-table-entities-2605");
    expect(sc.scopeNote).toContain("authoritative");
  });

  it("search_sap_knowledge returns the SAP-ABAP-1 card over the wire", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "search_sap_knowledge",
      arguments: { query: "sap-abap-1 system prompt" },
    })) as {
      isError?: boolean;
      structuredContent?: { hits: { id: string; detail: Record<string, unknown> }[] };
    };
    expect(result.isError ?? false).toBe(false);
    const hits = result.structuredContent!.hits;
    expect(hits[0]!.id).toBe("sap-abap-1");
    expect(JSON.stringify(hits[0]!.detail)).toContain("2026-04-27");
  });
});

describe("knowledge resources over the wire", () => {
  it("lists the whole-file resources and every individual card", async () => {
    const client = await connectedClient();
    const { resources } = await client.listResources();
    const uris = resources.map((r) => r.uri);
    for (const uri of KNOWLEDGE_FILE_URIS) {
      expect(uris, `missing file resource ${uri}`).toContain(uri);
    }
    expect(uris).toContain("abap-mcp://knowledge/sap-ai/sap-abap-1");
    expect(uris).toContain("abap-mcp://knowledge/release/rap-draft-on-cds-table-entities-2605");
    expect(uris).toContain("abap-mcp://knowledge/clean-core/release-contract-c1");
    expect(uris.length).toBeGreaterThanOrEqual(
      KNOWLEDGE_FILE_URIS.length +
        releaseDeltas().length +
        cleanCoreEntries().length +
        sapAiCards().length,
    );
  });

  it("exposes the three per-card URI templates", async () => {
    const client = await connectedClient();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual([
      "abap-mcp://knowledge/clean-core/{id}",
      "abap-mcp://knowledge/release/{id}",
      "abap-mcp://knowledge/sap-ai/{id}",
    ]);
  });

  it("reads one card as JSON and as Markdown", async () => {
    const client = await connectedClient();
    const result = await client.readResource({ uri: "abap-mcp://knowledge/sap-ai/sap-abap-1" });
    expect(result.contents.length).toBe(2);
    const json = result.contents.find((c) => c.mimeType === "application/json")!;
    const markdown = result.contents.find((c) => c.mimeType === "text/markdown")!;
    const parsed = JSON.parse(json.text as string) as { id: string };
    expect(parsed.id).toBe("sap-abap-1");
    expect(markdown.text as string).toContain("# SAP-ABAP-1");
    expect(markdown.text as string).toContain(KNOWLEDGE_SCOPE_NOTE);
  });

  it("reads a whole knowledge file with its record count and scope note", async () => {
    const client = await connectedClient();
    const result = await client.readResource({ uri: "abap-mcp://knowledge/release-deltas" });
    const json = result.contents.find((c) => c.mimeType === "application/json")!;
    const parsed = JSON.parse(json.text as string) as {
      area: string;
      recordCount: number;
      scopeNote: string;
      records: unknown[];
    };
    expect(parsed.area).toBe("release");
    expect(parsed.recordCount).toBe(releaseDeltas().length);
    expect(parsed.records.length).toBe(releaseDeltas().length);
    expect(parsed.scopeNote).toBe(KNOWLEDGE_SCOPE_NOTE);
  });

  it("reads the provenance manifest", async () => {
    const client = await connectedClient();
    const result = await client.readResource({ uri: "abap-mcp://knowledge/manifest" });
    const json = result.contents.find((c) => c.mimeType === "application/json")!;
    const parsed = JSON.parse(json.text as string) as { files: Record<string, unknown> };
    expect(Object.keys(parsed.files).sort()).toEqual([
      "abap-release-deltas.json",
      "clean-core.json",
      "sap-ai-options.json",
    ]);
  });

  it("rejects an unknown card id", async () => {
    const client = await connectedClient();
    await expect(
      client.readResource({ uri: "abap-mcp://knowledge/sap-ai/does-not-exist" }),
    ).rejects.toThrow();
  });
});

describe("knowledge tool description rubric (mcp-kit discipline)", () => {
  const VERBS = ["get", "list", "search", "run", "create", "check", "compare", "lint", "scaffold", "explain", "format", "plan", "fix"];

  for (const tool of KNOWLEDGE_TOOLS) {
    describe(tool.name, () => {
      it("is verb-first snake_case", () => {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(VERBS).toContain(tool.name.split("_")[0]);
      });

      it("says when to use it and what it does not do", () => {
        expect(tool.description).toMatch(/Use this when/);
        expect(tool.description).toMatch(/(does not|not a|cannot)/);
      });

      it("describes every input parameter", () => {
        for (const [field, schema] of Object.entries(tool.inputSchema)) {
          const description = (schema as ZodType).description;
          expect(description, `${tool.name}.${field} needs .describe()`).toBeTruthy();
          expect(description!.length).toBeGreaterThanOrEqual(12);
        }
      });

      it("ships at least one worked example", () => {
        expect(tool.examples?.length ?? 0).toBeGreaterThanOrEqual(1);
      });

      it("is annotated read-only (this server never mutates anything)", () => {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      });

      it("states the knowledge is dated and that the target system is authoritative", () => {
        expect(tool.description).toContain(KNOWLEDGE_CURATED_DATE);
        expect(tool.description.toLowerCase()).toContain("authoritative");
      });
    });
  }
});
