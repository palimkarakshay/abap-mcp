/**
 * CLI subcommands added in v0.11 (knowledge, release, aisdk, rules).
 *
 * Kept in their own module so the v0.10 command file stays readable; the
 * dispatcher in cli-commands.ts routes to these. Same contract: the CLI may
 * print to the caller's terminal, the MCP server never touches the user's
 * filesystem.
 */
import { scaffoldAbapAiSdk } from "./abap/aisdk.js";
import type { AisdkInteraction } from "./abap/aisdk.js";
import { explainAbapRelease, lookupSapKnowledge } from "./abap/knowledge.js";
import type { KnowledgeArea } from "./abap/knowledge.js";
import { buildAgentRules } from "./tools/agent-rules.tools.js";

export interface ExtraCliIo {
  out: (s: string) => void;
  err: (s: string) => void;
  writeFile?: (path: string, content: string) => void;
}

function flagsOf(argv: string[]): { flags: Map<string, string | true>; rest: string[] } {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(a.slice(2), next);
        i++;
      } else flags.set(a.slice(2), true);
    } else rest.push(a);
  }
  return { flags, rest };
}

function str(v: string | true | undefined): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** `abap-mcp release [--since 2502] [--kind rap] [--product btp] [--json] [topic words…]` */
export function cmdRelease(argv: string[], io: ExtraCliIo): number {
  const { flags, rest } = flagsOf(argv);
  const q = {
    ...(rest.length > 0 ? { topic: rest.join(" ") } : {}),
    ...(str(flags.get("since")) !== undefined ? { sinceRelease: str(flags.get("since"))! } : {}),
    ...(str(flags.get("kind")) !== undefined ? { kind: str(flags.get("kind"))! } : {}),
    ...(str(flags.get("product")) !== undefined ? { product: str(flags.get("product"))! } : {}),
    ...(str(flags.get("limit")) !== undefined ? { limit: Number(str(flags.get("limit"))) } : {}),
  };
  const result = explainAbapRelease(q);
  if (flags.has("json")) {
    io.out(JSON.stringify(result, null, 2));
    return 0;
  }
  io.out(`${result.matchCount} release delta(s)${result.truncated ? " (truncated)" : ""} — ${result.scopeNote}`);
  for (const d of result.deltas) {
    io.out(`\n[${d.release}] ${d.title}  (${d.kind}, ${d.confidence})`);
    io.out(`  ${d.summary}`);
    io.out(`  source: ${d.sourceUrl}`);
  }
  return 0;
}

/** `abap-mcp knowledge [--area release|clean-core|sap-ai] [--limit 5] [--json] <question>` */
export function cmdKnowledge(argv: string[], io: ExtraCliIo): number {
  const { flags, rest } = flagsOf(argv);
  if (rest.length === 0) {
    io.err("usage: abap-mcp knowledge [--area release|clean-core|sap-ai] [--limit N] [--json] <question>");
    return 2;
  }
  const area = str(flags.get("area"));
  const result = lookupSapKnowledge({
    query: rest.join(" "),
    ...(area !== undefined ? { area: area as KnowledgeArea | "all" } : {}),
    ...(str(flags.get("limit")) !== undefined ? { limit: Number(str(flags.get("limit"))) } : {}),
  });
  if (flags.has("json")) {
    io.out(JSON.stringify(result, null, 2));
    return 0;
  }
  io.out(`${result.matchCount} hit(s) for "${result.query}" — ${result.scopeNote}`);
  for (const h of result.hits) {
    io.out(`\n[${h.area}] ${h.title}  (${h.confidence}, score ${h.score})`);
    io.out(`  ${h.summary}`);
    for (const s of h.sources.slice(0, 3)) io.out(`  source: ${s}`);
  }
  return 0;
}

/** `abap-mcp aisdk --scenario ZDEMO_AI --interaction function-calling [--class ZCL_X] [--prefix Y] [--test] [--out DIR] [--json]` */
export function cmdAisdk(argv: string[], io: ExtraCliIo): number {
  const { flags } = flagsOf(argv);
  const scenario = str(flags.get("scenario"));
  const interaction = (str(flags.get("interaction")) ?? "string") as AisdkInteraction;
  if (scenario === undefined) {
    io.err("usage: abap-mcp aisdk --scenario <ISLM scenario> [--interaction string|messages|prompt-template|function-calling|structured-output|streaming|orchestration] [--class NAME] [--prefix Z|Y] [--test] [--out DIR] [--json]");
    return 2;
  }
  const prefix = str(flags.get("prefix"));
  const result = scaffoldAbapAiSdk({
    scenarioName: scenario,
    interaction,
    ...(str(flags.get("class")) !== undefined ? { className: str(flags.get("class"))! } : {}),
    ...(prefix === "Y" || prefix === "Z" ? { prefix } : {}),
    ...(flags.has("test") ? { withUnitTest: true } : {}),
  });
  if (flags.has("json")) {
    io.out(JSON.stringify(result, null, 2));
    return result.validationIssues.length > 0 ? 1 : 0;
  }
  const outDir = str(flags.get("out"));
  if (outDir !== undefined && io.writeFile !== undefined) {
    for (const f of result.files) io.writeFile(`${outDir}/${f.filename}`, f.content);
    io.out(`wrote ${result.files.length} file(s) to ${outDir}`);
  } else {
    for (const f of result.files) {
      io.out(`\n===== ${f.filename}  [validated: ${f.validated}] =====`);
      io.out(f.content);
    }
  }
  io.out(`\nSetup steps:\n${result.setupSteps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`);
  io.out(`\nConstraints:\n${result.constraints.map((s) => `  - ${s}`).join("\n")}`);
  io.out(`\nNext steps:\n${result.nextSteps.map((s) => `  - ${s}`).join("\n")}`);
  io.out(`\n${result.scopeNote}`);
  if (result.validationIssues.length > 0) {
    io.err(`WARNING: ${result.validationIssues.length} abaplint finding(s) on generated code`);
    return 1;
  }
  return 0;
}

/** `abap-mcp agent-rules [--target Cloud|classic] [--paired sap-adt-mcp,abap-adt-mcp] [--run] [--prefix Z] [--edition s4hc|btp|pce]` */
export function cmdAgentRules(argv: string[], io: ExtraCliIo): number {
  const { flags } = flagsOf(argv);
  const target = str(flags.get("target")) === "classic" ? "classic" : "Cloud";
  const pairedRaw = str(flags.get("paired"));
  const paired = (pairedRaw !== undefined ? pairedRaw.split(",") : ["none"]).filter(
    (p): p is "sap-adt-mcp" | "abap-adt-mcp" | "none" => p === "sap-adt-mcp" || p === "abap-adt-mcp" || p === "none",
  );
  const editionRaw = str(flags.get("edition"));
  const edition = editionRaw === "btp" || editionRaw === "pce" ? editionRaw : "s4hc";
  io.out(
    buildAgentRules({
      target,
      pairedWith: paired.length > 0 ? paired : ["none"],
      runEnabled: flags.has("run"),
      packagePrefix: str(flags.get("prefix")) ?? "Z",
      edition,
    }),
  );
  return 0;
}

export const EXTRA_USAGE = `  release [--since 2502] [--kind rap|cds|sql|language|testing|atc|tooling|eml] [--product btp] [--json] [topic…]
                                bundled ABAP Cloud / RAP release deltas (dated, sourced)
  knowledge [--area release|clean-core|sap-ai] [--json] <question>
                                search the bundled SAP knowledge base (Clean Core, ATC variants, SAP-ABAP-1, ABAP AI SDK …)
  aisdk --scenario <ISLM> [--interaction …] [--out DIR]   scaffold an ABAP AI SDK (Generative AI Hub) call, abaplint-checked
  agent-rules [--target Cloud] [--paired sap-adt-mcp] [--run]   print the AGENTS.md rules block for an ABAP repo`;
