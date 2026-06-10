/**
 * CLI layer over the same engine the MCP server exposes.
 *
 * Deliberate split: the MCP *server* stays text-in/no-filesystem (its security
 * story); the *CLI* is a local developer tool, so reading files from disk here
 * is fine. Both call the identical engine — one definition of "clean".
 */
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

import type { AbapSource, AbapVersion, Finding } from "./abap/engine.js";
import { ABAP_VERSIONS, MAX_FILES, runAbaplint } from "./abap/engine.js";
import { outlineAbap } from "./abap/outline.js";
import type { ReadinessReport } from "./abap/readiness.js";
import { checkCloudReadiness, SCOPE_NOTE } from "./abap/readiness.js";
import { lookupReleased, RELEASED_API_SNAPSHOT, suggestSuccessor } from "./abap/released.js";
import { explainRule, listRules } from "./abap/rules.js";
import type { ScaffoldField } from "./abap/scaffold.js";
import { scaffoldRapBo } from "./abap/scaffold.js";

const ABAP_FILE_RE =
  /\.(clas\.abap|clas\.locals_imp\.abap|clas\.locals_def\.abap|clas\.testclasses\.abap|prog\.abap|intf\.abap|fugr\.abap|ddls\.asddls|bdef\.asbdef|srvd\.srvdsrv|ddlx\.asddlx)$/;

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
}

/** Recursively collect analyzable sources from file/dir paths. */
export function collectFiles(paths: string[], io: CliIo): AbapSource[] {
  const found: AbapSource[] = [];
  const visitedDirs = new Set<string>();
  const visit = (p: string): void => {
    const st = statSync(p);
    if (st.isDirectory()) {
      if (basename(p) === ".git" || basename(p) === "node_modules") return;
      // statSync follows symlinks — track real paths so a symlink cycle
      // can't recurse forever.
      const real = realpathSync(p);
      if (visitedDirs.has(real)) return;
      visitedDirs.add(real);
      for (const entry of readdirSync(p)) visit(join(p, entry));
      return;
    }
    const name = basename(p).toLowerCase();
    if (ABAP_FILE_RE.test(name)) {
      found.push({ filename: name, source: readFileSync(p, "utf8") });
    } else if ([".abap", ".asddls", ".asbdef"].includes(extname(name))) {
      io.err(`skip ${p}: not an abapGit-style filename (e.g. zcl_x.clas.abap)`);
    }
  };
  for (const p of paths) visit(p);
  return found;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function parseFlags(argv: string[]): { flags: Map<string, string | true>; rest: string[] } {
  const flags = new Map<string, string | true>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(key, next);
        i++;
      } else {
        flags.set(key, true);
      }
    } else {
      rest.push(a);
    }
  }
  return { flags, rest };
}

function asVersion(v: string | true | undefined, fallback: AbapVersion): AbapVersion {
  if (typeof v !== "string") return fallback;
  if ((ABAP_VERSIONS as readonly string[]).includes(v)) return v as AbapVersion;
  throw new Error(`Unknown ABAP version "${v}". Valid: ${ABAP_VERSIONS.join(", ")}`);
}

function fmtFinding(f: Finding): string {
  return `${f.file}:${f.line}:${f.column} [${f.severity}] ${f.rule}: ${f.message}`;
}

export function cmdLint(argv: string[], io: CliIo): number {
  const { flags, rest } = parseFlags(argv);
  const files = collectFiles(rest.length > 0 ? rest : ["."], io);
  if (files.length === 0) {
    io.err("No ABAP sources found.");
    return 2;
  }
  const version = asVersion(flags.get("abap-version"), "v758");
  const presetRaw = flags.get("preset");
  const preset =
    presetRaw === "full" || presetRaw === "syntax-only" ? presetRaw : ("style" as const);
  const all: Finding[] = [];
  for (const batch of chunk(files, MAX_FILES)) {
    all.push(...runAbaplint(batch, { version, preset }).findings);
  }
  if (flags.has("json")) {
    io.out(JSON.stringify({ files: files.length, findings: all }, null, 2));
  } else {
    for (const f of all) io.out(fmtFinding(f));
    io.out(`${all.length} finding(s) in ${files.length} file(s) [${preset} @ ${version}]`);
  }
  return all.some((f) => f.severity === "Error") ? 1 : 0;
}

/** Merge per-batch readiness reports into one repo-level report. */
export function mergeReadiness(reports: ReadinessReport[], baseline: AbapVersion): ReadinessReport {
  const categories = new Map<string, ReadinessReport["categories"][number]>();
  let blockers = 0;
  const broken: ReadinessReport["brokenAtBaseline"] = [];
  const releasedApiFindings: ReadinessReport["releasedApiFindings"] = [];
  let snapshotDate = "";
  for (const r of reports) {
    blockers += r.cloudBlockerCount;
    broken.push(...r.brokenAtBaseline);
    releasedApiFindings.push(...r.releasedApiFindings);
    snapshotDate = r.releasedApiSnapshotDate;
    for (const c of r.categories) {
      const cur = categories.get(c.category);
      if (cur === undefined) categories.set(c.category, { ...c, findings: [...c.findings] });
      else {
        cur.count += c.count;
        cur.findings.push(...c.findings);
      }
    }
  }
  const score = Math.max(0, 100 - 5 * blockers);
  const verdict =
    blockers === 0
      ? "ready"
      : blockers <= 5
        ? "minor-rework"
        : blockers <= 20
          ? "moderate-rework"
          : "significant-rework";
  return {
    verdict,
    score,
    cloudBlockerCount: blockers,
    categories: [...categories.values()].sort((a, b) => b.count - a.count),
    brokenAtBaseline: broken,
    releasedApiFindings,
    releasedApiSnapshotDate: snapshotDate,
    baselineVersion: baseline,
    scopeNote: SCOPE_NOTE,
  };
}

export function cmdReadiness(argv: string[], io: CliIo): number {
  const { flags, rest } = parseFlags(argv);
  const files = collectFiles(rest.length > 0 ? rest : ["."], io);
  if (files.length === 0) {
    io.err("No ABAP sources found.");
    return 2;
  }
  const baseline = asVersion(flags.get("baseline"), "v758");
  const reports = chunk(files, MAX_FILES).map((b) => checkCloudReadiness(b, baseline));
  const merged = mergeReadiness(reports, baseline);
  if (flags.has("json")) {
    io.out(JSON.stringify({ files: files.length, ...merged }, null, 2));
  } else {
    io.out(`ABAP Cloud readiness: ${merged.verdict} (score ${merged.score})`);
    io.out(`${merged.cloudBlockerCount} cloud blocker(s) across ${files.length} file(s)`);
    for (const c of merged.categories) io.out(`  ${c.category.padEnd(18)} ${String(c.count).padStart(4)}  ${c.label}`);
    if (merged.brokenAtBaseline.length > 0)
      io.out(`${merged.brokenAtBaseline.length} finding(s) broken at ${baseline} regardless (fix first; not migration work)`);
    if (merged.releasedApiFindings.length > 0) {
      io.out(`${merged.releasedApiFindings.length} released-API note(s) (snapshot ${merged.releasedApiSnapshotDate}; informational, not scored):`);
      for (const f of merged.releasedApiFindings)
        io.out(`  ${f.file}:${f.line} [${f.state}] ${f.object}${f.successor !== undefined ? ` → ${f.successor}` : ""}`);
    }
    io.out(`Note: ${merged.scopeNote}`);
  }
  const failBelow = flags.get("fail-below");
  if (typeof failBelow === "string" && merged.score < Number(failBelow)) return 1;
  return 0;
}

export function cmdScaffold(argv: string[], io: CliIo): number {
  const { flags } = parseFlags(argv);
  const entityName = flags.get("entity");
  const sqlTable = flags.get("table");
  const keyField = flags.get("key");
  if (typeof entityName !== "string" || typeof sqlTable !== "string" || typeof keyField !== "string") {
    io.err("Usage: abap-mcp scaffold --entity Travel --table ztravel --key travel_id [--fields a:abap.char(6),b] [--no-draft] [--provided-key] [--out DIR]");
    return 2;
  }
  const fields: ScaffoldField[] = [];
  const fieldsRaw = flags.get("fields");
  if (typeof fieldsRaw === "string") {
    for (const part of fieldsRaw.split(",")) {
      const [name, type] = part.split(":");
      if (name !== undefined && name.length > 0) fields.push(type !== undefined ? { name, type } : { name });
    }
  }
  const result = scaffoldRapBo({
    entityName,
    sqlTable,
    keyField,
    managedUuidKey: !flags.has("provided-key"),
    fields,
    draft: !flags.has("no-draft"),
    prefix: flags.get("prefix") === "Y" ? "Y" : "Z",
  });
  const outDir = typeof flags.get("out") === "string" ? (flags.get("out") as string) : null;
  if (outDir !== null) {
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    for (const f of result.files) {
      const target = join(outDir, f.filename);
      if (existsSync(target) && !flags.has("force")) {
        io.err(`refusing to overwrite ${target} (use --force)`);
        return 1;
      }
      writeFileSync(target, f.content, "utf8");
      io.out(`wrote ${target}  [${f.validated}]`);
    }
    const suggestionTarget = join(outDir, `${sqlTable.toLowerCase()}.tabl.suggestion.txt`);
    if (existsSync(suggestionTarget) && !flags.has("force")) {
      io.err(`refusing to overwrite ${suggestionTarget} (use --force)`);
      return 1;
    }
    writeFileSync(suggestionTarget, result.suggestedTableDdl, "utf8");
    io.out(`wrote ${suggestionTarget}`);
  } else {
    for (const f of result.files) {
      io.out(`\n===== ${f.filename}  [validated: ${f.validated}] =====`);
      io.out(f.content);
    }
    io.out(`\n===== suggested table DDL =====\n${result.suggestedTableDdl}`);
  }
  io.out(`\nActivation order:\n${result.activationOrder.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`);
  io.out(`\nNext steps:\n${result.nextSteps.map((s) => `  - ${s}`).join("\n")}`);
  if (result.validationIssues.length > 0) {
    io.err(`WARNING: ${result.validationIssues.length} abaplint finding(s) on generated code`);
    return 1;
  }
  return 0;
}

export function cmdOutline(argv: string[], io: CliIo): number {
  const { flags, rest } = parseFlags(argv);
  const files = collectFiles(rest.length > 0 ? rest : ["."], io);
  if (files.length === 0) {
    io.err("No ABAP sources found.");
    return 2;
  }
  const outlines = chunk(files, MAX_FILES).flatMap((b) => outlineAbap(b));
  if (flags.has("json")) {
    io.out(JSON.stringify(outlines, null, 2));
    return 0;
  }
  for (const o of outlines) {
    if (!o.parseable) continue;
    for (const c of o.classes) {
      io.out(`${o.file}: class ${c.name}${c.isGlobal ? "" : " (local)"}${c.superClass !== null ? ` extends ${c.superClass}` : ""}`);
      for (const m of c.methods) io.out(`    ${m.visibility.padEnd(9)} ${m.name}`);
    }
    for (const i of o.interfaces) io.out(`${o.file}: interface ${i}`);
    for (const f of o.forms) io.out(`${o.file}: form ${f}`);
  }
  return 0;
}

export function cmdExplain(argv: string[], io: CliIo): number {
  const { rest } = parseFlags(argv);
  const key = rest[0];
  if (key === undefined) {
    io.err("Usage: abap-mcp explain <rule_key>");
    return 2;
  }
  const d = explainRule(key);
  io.out(`${d.key} — ${d.title}\n${d.shortDescription}\n${d.extendedInformation}\nDocs: ${d.docsUrl}`);
  return 0;
}

export function cmdReleased(argv: string[], io: CliIo): number {
  const { flags, rest } = parseFlags(argv);
  if (rest.length === 0) {
    io.err("Usage: abap-mcp released <object-name…>   [--type TABL|CDS_STOB|FUNC|…] [--json]");
    return 2;
  }
  const type = typeof flags.get("type") === "string" ? (flags.get("type") as string) : undefined;
  const results = rest.map((name) => {
    const hit = lookupReleased(name, type);
    const successor = suggestSuccessor(name);
    return { ...hit, successor };
  });
  if (flags.has("json")) {
    io.out(JSON.stringify({ snapshotDate: RELEASED_API_SNAPSHOT.snapshotDate, source: RELEASED_API_SNAPSHOT.source, results }, null, 2));
    return 0;
  }
  io.out(`Released-API status (SAP Cloudification snapshot ${RELEASED_API_SNAPSHOT.snapshotDate}):`);
  for (const r of results) {
    const tail = r.successor !== undefined ? `  → use ${r.successor}` : "";
    const provenance = r.recorded ? "" : " (not in snapshot)";
    io.out(`  ${r.name.padEnd(34)} ${r.state.padEnd(13)} ${(r.objectType ?? "").padEnd(9)}${provenance}${tail}`);
  }
  return 0;
}

export function cmdRules(argv: string[], io: CliIo): number {
  const { flags } = parseFlags(argv);
  const q = flags.get("query");
  const t = flags.get("tag");
  const rules = listRules(typeof q === "string" ? q : undefined, typeof t === "string" ? t : undefined);
  for (const r of rules) io.out(`${r.key.padEnd(36)} ${r.title}`);
  io.out(`${rules.length} rule(s)`);
  return 0;
}

export const USAGE = `abap-mcp — SAP ABAP analysis for AI agents (MCP server) and humans (CLI)

Usage:
  abap-mcp                       start the MCP server on stdio (for AI clients)
  abap-mcp lint [paths…]         lint files/dirs   [--abap-version v758|Cloud] [--preset style|full|syntax-only] [--json]
  abap-mcp readiness [paths…]    ABAP Cloud readiness diff   [--baseline v758] [--fail-below N] [--json]
  abap-mcp scaffold …            generate a RAP managed BO   (--entity --table --key [--fields n:type,…] [--no-draft] [--provided-key] [--out DIR])
  abap-mcp outline [paths…]      classes/methods/forms structure   [--json]
  abap-mcp released <names…>     released-API status from the bundled SAP snapshot   [--type TABL|FUNC|…] [--json]
  abap-mcp explain <rule>        explain an abaplint rule
  abap-mcp rules                 list rules   [--query q] [--tag Security]

Exit codes: 0 ok · 1 findings/validation failed · 2 usage error`;

export function runCli(argv: string[], io: CliIo): number | null {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "serve":
      return null; // caller starts the MCP server
    case "lint":
      return cmdLint(rest, io);
    case "readiness":
      return cmdReadiness(rest, io);
    case "scaffold":
      return cmdScaffold(rest, io);
    case "outline":
      return cmdOutline(rest, io);
    case "released":
      return cmdReleased(rest, io);
    case "explain":
      return cmdExplain(rest, io);
    case "rules":
      return cmdRules(rest, io);
    case "help":
    case "--help":
    case "-h":
      io.out(USAGE);
      return 0;
    default:
      io.err(`Unknown command "${cmd}".\n\n${USAGE}`);
      return 2;
  }
}
