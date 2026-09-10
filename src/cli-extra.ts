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
import type { AbapSource } from "./abap/engine.js";
import { MAX_FILE_CHARS } from "./abap/engine.js";
import { KNOWLEDGE_RELEASES, explainAbapRelease, lookupSapKnowledge } from "./abap/knowledge.js";
import type { KnowledgeArea, KnowledgeRelease } from "./abap/knowledge.js";
import { MAX_RAP_FILES, checkRapBehavior } from "./abap/rap/index.js";
import { buildAgentRules } from "./tools/agent-rules.tools.js";

export interface ExtraCliIo {
  out: (s: string) => void;
  err: (s: string) => void;
  /**
   * Reads analyzable sources from file/dir paths. Injected by the dispatcher
   * in cli-commands.ts (which owns `collectFiles`) rather than imported from
   * there: cli-commands.ts already imports this module, and a back-import
   * would make the two files a cycle.
   */
  readSources?: (paths: string[]) => AbapSource[];
  writeFile?: (path: string, content: string) => void;
  /** Existence check for --out overwrite guarding (mirrors cmdScaffold/cmdUnittest in cli-commands.ts). */
  exists?: (path: string) => boolean;
}

// Flags that never take a value — without this list, a boolean flag directly
// followed by a positional (`knowledge --json "clean core level C"`, `release
// --json rap`) would swallow that positional as its own value, leaving the
// command with no topic/question and a usage error. Every other recognized
// flag here (since/kind/product/limit/area/scenario/interaction/class/prefix/
// out/target/paired/edition) takes a value.
const BOOLEAN_FLAGS = new Set(["json", "test", "run", "force", "strict"]);

function flagsOf(argv: string[]): { flags: Map<string, string | true>; rest: string[] } {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else flags.set(key, true);
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

/** `abap-mcp aisdk --scenario ZDEMO_AI --interaction function-calling [--class ZCL_X] [--prefix Y] [--test] [--out DIR] [--force] [--json]` */
export function cmdAisdk(argv: string[], io: ExtraCliIo): number {
  const { flags } = flagsOf(argv);
  const scenario = str(flags.get("scenario"));
  const interaction = (str(flags.get("interaction")) ?? "string") as AisdkInteraction;
  if (scenario === undefined) {
    io.err("usage: abap-mcp aisdk --scenario <ISLM scenario> [--interaction string|messages|prompt-template|function-calling|structured-output|streaming|orchestration] [--class NAME] [--prefix Z|Y] [--test] [--out DIR] [--force] [--json]");
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
  let overwriteBlocked = false;
  if (outDir !== undefined && io.writeFile !== undefined) {
    // Guard existing files the same way cmdScaffold/cmdUnittest do in
    // cli-commands.ts: refuse to clobber without --force, report every file
    // that was skipped (not just the first), and let the caller retry with
    // --force once they have seen the whole list.
    const skipped: string[] = [];
    for (const f of result.files) {
      const target = `${outDir}/${f.filename}`;
      if (io.exists?.(target) === true && !flags.has("force")) {
        skipped.push(target);
        continue;
      }
      io.writeFile(target, f.content);
    }
    const writtenCount = result.files.length - skipped.length;
    if (writtenCount > 0) io.out(`wrote ${writtenCount} file(s) to ${outDir}`);
    if (skipped.length > 0) {
      overwriteBlocked = true;
      io.err(`refusing to overwrite ${skipped.length} existing file(s) (use --force): ${skipped.join(", ")}`);
    }
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
  }
  return overwriteBlocked || result.validationIssues.length > 0 ? 1 : 0;
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

/**
 * `abap-mcp rapcheck [paths…] [--release 2508] [--strict] [--json]`
 *
 * Spec §4.2. Sweeping a directory brings the `.ddls.asddls` views along
 * automatically, which is what turns on the cross-file half of the rule set
 * in the common case.
 */
export function cmdRapcheck(argv: string[], io: ExtraCliIo): number {
  const { flags, rest } = flagsOf(argv);
  const read = io.readSources;
  if (read === undefined) {
    io.err("rapcheck needs filesystem access; run it through the abap-mcp CLI.");
    return 2;
  }
  const all = read(rest.length > 0 ? rest : ["."]);
  const files = all.filter((f) => {
    if (!/\.(?:bdef\.asbdef|srvd\.srvdsrv|ddls\.asddls)$/i.test(f.filename ?? "")) return false;
    if (f.source.length > MAX_FILE_CHARS) {
      // Sweep-friendly, like collectFiles: one oversized file must not kill a
      // whole-repo run — and it is skipped loudly, never silently truncated.
      io.err(`skip ${f.filename ?? "(unnamed)"}: ${f.source.length} chars exceeds the ${MAX_FILE_CHARS}-char cap`);
      return false;
    }
    return true;
  });
  if (!files.some((f) => /\.(?:bdef\.asbdef|srvd\.srvdsrv)$/i.test(f.filename ?? ""))) {
    io.err("No RAP behavior or service definitions found (.bdef.asbdef / .srvd.srvdsrv).");
    return 2;
  }

  const releaseRaw = str(flags.get("release"));
  if (releaseRaw !== undefined && !(KNOWLEDGE_RELEASES as readonly string[]).includes(releaseRaw)) {
    io.err(`Unknown release "${releaseRaw}". Valid: ${KNOWLEDGE_RELEASES.join(", ")}`);
    return 2;
  }

  // One call keeps the cross-file rules working; the library cap is the only
  // ceiling (a bigger sweep is checked in batches of MAX_RAP_FILES, each
  // batch self-contained — the same trade cmdLint makes with MAX_FILES).
  const batches: AbapSource[][] = [];
  for (let i = 0; i < files.length; i += MAX_RAP_FILES) batches.push(files.slice(i, i + MAX_RAP_FILES));

  const reports = batches.map((batch) =>
    checkRapBehavior(
      batch.map((f) => ({ filename: f.filename, source: f.source })),
      {
        ...(releaseRaw !== undefined ? { abapRelease: releaseRaw as KnowledgeRelease } : {}),
        ...(flags.has("strict") ? { strict: true } : {}),
      },
    ),
  );
  const first = reports[0]!;
  const findings = reports.flatMap((r) => r.findings);
  // `summary.*` is counted over the UNCAPPED finding set (see
  // `checkRapBehavior`), so `errors` here is a fact about the sources — not
  // about how much of the list survived the report cap. It has to be: when
  // the cap dropped the errors, this command used to print "0 error(s)" and
  // exit 0 on a file the checker had just judged invalid, and a CI gate built
  // on that exit code waved it through.
  const errors = reports.reduce((n, r) => n + r.summary.errors, 0);
  const warnings = reports.reduce((n, r) => n + r.summary.warnings, 0);
  const infos = reports.reduce((n, r) => n + r.summary.infos, 0);
  const checked = reports.reduce((n, r) => n + r.summary.filesChecked, 0);
  const omitted = reports.reduce((n, r) => n + r.summary.omitted, 0);

  if (flags.has("json")) {
    io.out(
      JSON.stringify(
        {
          files: reports.flatMap((r) => r.files),
          findings,
          summary: {
            errors,
            warnings,
            infos,
            filesChecked: checked,
            rulesRun: first.summary.rulesRun,
            suppressedByUnknown: reports.reduce((n, r) => n + r.summary.suppressedByUnknown, 0),
            unknownConstructs: reports.reduce((n, r) => n + r.summary.unknownConstructs, 0),
            baseUnresolved: reports.reduce((n, r) => n + r.summary.baseUnresolved, 0),
            omitted,
            truncated: reports.some((r) => r.summary.truncated),
          },
          scopeNote: first.scopeNote,
          grammarVersion: first.grammarVersion,
          rulesVersion: first.rulesVersion,
          ...(first.releaseGate !== undefined
            ? {
                releaseGate: {
                  ...first.releaseGate,
                  gatedConstructs: reports.reduce((n, r) => n + (r.releaseGate?.gatedConstructs ?? 0), 0),
                },
              }
            : {}),
          validated: first.validated,
        },
        null,
        2,
      ),
    );
    return errors > 0 ? 1 : 0;
  }

  for (const f of findings) io.out(`${f.severity} ${f.file}:${f.line}:${f.column} ${f.rule} ${f.message}`);
  io.out(
    `${errors} error(s), ${warnings} warning(s), ${infos} info(s) in ${checked} RAP file(s) ` +
      (omitted > 0 ? `(${omitted} finding(s) omitted by the report cap) ` : "") +
      `[grammar ${first.grammarVersion}, rules ${first.rulesVersion}]`,
  );
  // stdout carries the findings; the honesty note goes to stderr so `--json`
  // and piped output stay machine-clean.
  io.err(first.scopeNote);
  return errors > 0 ? 1 : 0;
}

export const EXTRA_USAGE = `  release [--since 2502] [--kind rap|cds|sql|language|testing|atc|tooling|eml] [--product btp] [--json] [topic…]
                                bundled ABAP Cloud / RAP release deltas (dated, sourced)
  knowledge [--area release|clean-core|sap-ai] [--json] <question>
                                search the bundled SAP knowledge base (Clean Core, ATC variants, SAP-ABAP-1, ABAP AI SDK …)
  aisdk --scenario <ISLM> [--interaction …] [--out DIR]   scaffold an ABAP AI SDK (Generative AI Hub) call, abaplint-checked
  agent-rules [--target Cloud] [--paired sap-adt-mcp] [--run]   print the AGENTS.md rules block for an ABAP repo`;
