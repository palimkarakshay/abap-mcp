/**
 * CLI layer over the same engine the MCP server exposes.
 *
 * Deliberate split: the MCP *server* stays text-in/no-filesystem (its security
 * story); the *CLI* is a local developer tool, so reading files from disk here
 * is fine. Both call the identical engine — one definition of "clean".
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync, statSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { basename, extname, join } from "node:path";

import { compareAbap } from "./abap/compare.js";
import { McpToolError } from "./errors.js";
import type { AbapSource, AbapVersion, Finding, FocusTag } from "./abap/engine.js";
import { ABAP_VERSIONS, FOCUS_TAGS, MAX_FILE_CHARS, MAX_FILES, runAbaplint } from "./abap/engine.js";
import { getObjectDependencies } from "./abap/deps.js";
import { fixAbap } from "./abap/fix.js";
import { outlineAbap, outlineToMermaid } from "./abap/outline.js";
import { planCloudMigration } from "./abap/plan.js";
import type { UnitRunResult } from "./abap/run.js";
import { runAbapUnit } from "./abap/run.js";
import { scaffoldAbapUnit } from "./abap/unittest.js";
import type { ReadinessReport } from "./abap/readiness.js";
import { checkCloudReadiness, gradeReadiness, SCOPE_NOTE } from "./abap/readiness.js";
import type { ReleasedEdition } from "./abap/released.js";
import { DEFAULT_EDITION, lookupReleased, RELEASED_API_SNAPSHOTS, RELEASED_EDITIONS, suggestSuccessor } from "./abap/released.js";
import { explainRule, listRules } from "./abap/rules.js";
import { cmdAgentRules, cmdAisdk, cmdKnowledge, cmdRapcheck, cmdRelease, EXTRA_USAGE } from "./cli-extra.js";
import { RAP_SCOPE_NOTE, containsRapFiles, checkRapBehavior, rapFindingsToLintFindings } from "./abap/rap/index.js";
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
      const source = readFileSync(p, "utf8");
      if (source.length > MAX_FILE_CHARS) {
        // Sweep-friendly: one oversized file must not kill a whole-repo run.
        io.err(`skip ${p}: ${source.length} chars exceeds the ${MAX_FILE_CHARS}-char cap (analyze it in parts)`);
        return;
      }
      found.push({ filename: name, source });
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

function asEdition(v: string | true | undefined): ReleasedEdition {
  if (typeof v !== "string") return DEFAULT_EDITION;
  if ((RELEASED_EDITIONS as readonly string[]).includes(v)) return v as ReleasedEdition;
  throw new Error(`Unknown edition "${v}". Valid: ${RELEASED_EDITIONS.join(", ")}`);
}

function asFocus(v: string | true | undefined): FocusTag | undefined {
  if (typeof v !== "string") return undefined;
  const match = FOCUS_TAGS.find((t) => t.toLowerCase() === v.toLowerCase());
  if (match === undefined) throw new Error(`Unknown focus "${v}". Valid: ${FOCUS_TAGS.join(", ")}`);
  return match;
}

function asPreset(v: string | true | undefined): "style" | "full" | "syntax-only" {
  return v === "full" || v === "syntax-only" ? v : "style";
}

/** Read rule overrides from a JSON file — either a bare rules map or a full abaplint.json with a "rules" key. */
function rulesFromFile(v: string | true | undefined): Record<string, unknown> | undefined {
  if (typeof v !== "string") return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(v, "utf8")) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Cannot read --rules-file ${v}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const inner = parsed["rules"];
  return typeof inner === "object" && inner !== null ? (inner as Record<string, unknown>) : parsed;
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
  const preset = asPreset(flags.get("preset"));
  const focus = asFocus(flags.get("focus"));
  const rules = rulesFromFile(flags.get("rules-file"));
  // Same routing as lint_abap (spec §5.2): BDEF/SRVD get abap-mcp's own RAP
  // checker merged in under rap/ keys, because abaplint returns nothing at
  // all for those file types. --no-rap opts out.
  const rapWanted = !flags.has("no-rap");
  const all: Finding[] = [];
  let rapChecked = false;
  for (const batch of chunk(files, MAX_FILES)) {
    all.push(...runAbaplint(batch, { version, preset, focus, rules }).findings);
    if (rapWanted && containsRapFiles(batch)) {
      rapChecked = true;
      all.push(...rapFindingsToLintFindings(checkRapBehavior(batch).findings));
    }
  }
  if (flags.has("json")) {
    io.out(
      JSON.stringify(
        { files: files.length, findings: all, rapChecked, ...(rapChecked ? { rapScopeNote: RAP_SCOPE_NOTE } : {}) },
        null,
        2,
      ),
    );
  } else {
    for (const f of all) io.out(fmtFinding(f));
    io.out(`${all.length} finding(s) in ${files.length} file(s) [${preset}${focus !== undefined ? `:${focus}` : ""} @ ${version}]`);
    if (rapChecked) io.err(RAP_SCOPE_NOTE);
  }
  return all.some((f) => f.severity === "Error") ? 1 : 0;
}

/** Merge per-batch readiness reports into one repo-level report. */
export function mergeReadiness(reports: ReadinessReport[], baseline: AbapVersion): ReadinessReport {
  const categories = new Map<string, ReadinessReport["categories"][number]>();
  let blockers = 0;
  let fileCount = 0;
  const broken: ReadinessReport["brokenAtBaseline"] = [];
  const releasedApiFindings: ReadinessReport["releasedApiFindings"] = [];
  let snapshotDate = "";
  // Per-batch reports were all produced by the same checkCloudReadiness call
  // site with the same edition, so the first report's edition-derived fields
  // (edition, scopeNote, cleanCoreVocabulary) apply to the merge as a whole.
  const first = reports[0];
  for (const r of reports) {
    blockers += r.cloudBlockerCount;
    fileCount += r.fileCount;
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
    grade: gradeReadiness(blockers, fileCount),
    gradeMeaning: "blocker-density",
    cloudBlockerCount: blockers,
    fileCount,
    categories: [...categories.values()].sort((a, b) => b.count - a.count),
    brokenAtBaseline: broken,
    releasedApiFindings,
    releasedApiSnapshotDate: snapshotDate,
    edition: first?.edition ?? DEFAULT_EDITION,
    baselineVersion: baseline,
    scopeNote: first?.scopeNote ?? SCOPE_NOTE,
    cleanCoreVocabulary: first?.cleanCoreVocabulary ?? { checks: [], variants: [] },
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
  const edition = asEdition(flags.get("edition"));
  const reports = chunk(files, MAX_FILES).map((b) => checkCloudReadiness(b, baseline, edition));
  const merged = mergeReadiness(reports, baseline);
  if (flags.has("json")) {
    io.out(JSON.stringify({ files: files.length, ...merged }, null, 2));
  } else {
    io.out(`ABAP Cloud readiness: ${merged.verdict} (score ${merged.score}, grade ${merged.grade})`);
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

export function cmdPlan(argv: string[], io: CliIo): number {
  const { flags, rest } = parseFlags(argv);
  const files = collectFiles(rest.length > 0 ? rest : ["."], io);
  if (files.length === 0) {
    io.err("No ABAP sources found.");
    return 2;
  }
  const baseline = asVersion(flags.get("baseline"), "v758");
  const edition = asEdition(flags.get("edition"));
  const reports = chunk(files, MAX_FILES).map((b) => checkCloudReadiness(b, baseline, edition));
  const plan = planCloudMigration(mergeReadiness(reports, baseline));
  if (flags.has("json")) {
    io.out(JSON.stringify(plan, null, 2));
    return 0;
  }
  const s = plan.summary;
  io.out(
    `ABAP Cloud migration plan — score ${s.score}, grade ${s.grade}, ${s.cloudBlockerCount} blocker(s) → ` +
      `${s.workItemCount} work item(s) in ${s.phaseCount} phase(s); effort ${s.estimatedEffort}`,
  );
  for (const p of plan.phases) {
    io.out(`\nPhase ${p.phase} — ${p.title}  [${p.kind}, effort ${p.effort}, ${p.itemCount} item(s)]`);
    io.out(`  ${p.goal}`);
    for (const i of p.items)
      io.out(`  - ${i.object}  ${i.category}×${i.findingCount} [${i.effort}]  ${i.recipe}`);
    io.out(`  exit: ${p.exitCriteria}`);
  }
  io.out(`\nLoop: ${plan.suggestedLoop}`);
  return 0;
}

/** The one server definition every client gets — keep in lockstep with the README. */
const SETUP_DEF = { name: "abap-mcp", command: "npx", args: ["-y", "abap-mcp"] };
const SETUP_JSON_BLOCK = JSON.stringify(
  { servers: { "abap-mcp": { type: "stdio", command: SETUP_DEF.command, args: SETUP_DEF.args } } },
  null,
  2,
);
const INSTALL_GUIDE = "https://github.com/palimkarakshay/abap-mcp/blob/main/docs/INSTALL.md";
const VSCODE_BADGE_URL =
  "https://vscode.dev/redirect/mcp/install?name=abap-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22abap-mcp%22%5D%7D";

/** True when `bin` exists on PATH (probed with --version; never throws). */
function binExists(bin: string): boolean {
  try {
    return spawnSync(bin, ["--version"], { stdio: "ignore", timeout: 15_000 }).status === 0;
  } catch {
    return false;
  }
}

function setupVsCode(bin: string, io: CliIo): boolean {
  try {
    const r = spawnSync(bin, ["--add-mcp", JSON.stringify(SETUP_DEF)], { stdio: "ignore", timeout: 30_000 });
    if (r.status === 0) {
      io.out(`✓ ${bin}: abap-mcp registered.`);
      io.out(`  Next: restart ${bin === "code" ? "VS Code" : bin}, open Copilot Chat, switch to Agent mode,`);
      io.out('  and ask: "list your ABAP tools" — you should see thirteen.');
      return true;
    }
  } catch {
    /* fall through to manual guidance */
  }
  io.out(`✗ ${bin}: could not register automatically (is the '${bin}' command on your PATH?).`);
  io.out(`  Easiest manual path: open ${VSCODE_BADGE_URL}`);
  io.out("  in a browser — it opens VS Code with abap-mcp pre-filled; click Install.");
  return false;
}

function setupClaude(io: CliIo): boolean {
  try {
    const r = spawnSync("claude", ["mcp", "add", "abap-mcp", "--", "npx", "-y", "abap-mcp"], {
      stdio: "ignore",
      timeout: 30_000,
    });
    if (r.status === 0) {
      io.out("✓ claude: abap-mcp registered (Claude Code).");
      return true;
    }
  } catch {
    /* fall through */
  }
  io.out("✗ claude: could not register automatically.");
  io.out("  Manual: claude mcp add abap-mcp -- npx -y abap-mcp");
  return false;
}

function printEclipse(io: CliIo): void {
  io.out("Eclipse / ADT — via the GitHub Copilot plugin (stock ADT has no MCP client):");
  io.out("  1. In Eclipse: Help → Eclipse Marketplace → search \"GitHub Copilot\" → Install, restart.");
  io.out("  2. Sign in to Copilot (the Copilot icon in the status bar).");
  io.out("  3. Copilot icon → Edit preferences → MCP.");
  io.out("  4. Paste this configuration and apply:");
  for (const line of SETUP_JSON_BLOCK.split("\n")) io.out(`     ${line}`);
  io.out('  5. Open Copilot Chat (Agent mode) and ask: "list your ABAP tools".');
  io.out(`  Full walkthrough with prerequisites: ${INSTALL_GUIDE}`);
}

export function cmdSetup(argv: string[], io: CliIo): number {
  const { rest } = parseFlags(argv);
  const target = (rest[0] ?? "auto").toLowerCase();
  io.out("abap-mcp setup — registers this server with your editor. Nothing is sent anywhere;");
  io.out("analysis runs on your machine only.\n");
  switch (target) {
    case "vscode":
      setupVsCode("code", io);
      return 0;
    case "vscode-insiders":
      setupVsCode("code-insiders", io);
      return 0;
    case "claude":
      setupClaude(io);
      return 0;
    case "eclipse":
    case "adt":
      printEclipse(io);
      return 0;
    case "auto": {
      let found = 0;
      if (binExists("code")) {
        found++;
        setupVsCode("code", io);
      }
      if (binExists("code-insiders")) {
        found++;
        setupVsCode("code-insiders", io);
      }
      if (binExists("claude")) {
        found++;
        setupClaude(io);
      }
      if (found === 0) {
        io.out("No supported editor CLI found on PATH (looked for: code, code-insiders, claude).");
        io.out(`  VS Code one-click: ${VSCODE_BADGE_URL}`);
        io.out("  Or from a VS Code terminal: npx abap-mcp setup vscode");
      }
      io.out("");
      io.out("Using Eclipse / ADT? Run: npx abap-mcp setup eclipse");
      io.out(`Newcomer walkthrough (both editors, from zero): ${INSTALL_GUIDE}`);
      return 0;
    }
    default:
      io.err("Usage: abap-mcp setup [auto|vscode|vscode-insiders|eclipse|claude]");
      return 2;
  }
}

/** Like collectFiles, but keeps the full path per basename so --write can put fixes back. */
function collectFilesWithPaths(paths: string[], io: CliIo): { files: AbapSource[]; pathOf: Map<string, string[]> } {
  const files = collectFiles(paths, io);
  const pathOf = new Map<string, string[]>();
  const visit = (p: string): void => {
    const st = statSync(p);
    if (st.isDirectory()) {
      if (basename(p) === ".git" || basename(p) === "node_modules") return;
      for (const entry of readdirSync(p)) visit(join(p, entry));
      return;
    }
    const name = basename(p).toLowerCase();
    if (ABAP_FILE_RE.test(name)) {
      const list = pathOf.get(name) ?? [];
      list.push(p);
      pathOf.set(name, list);
    }
  };
  for (const p of paths) visit(p);
  return { files, pathOf };
}

export function cmdFix(argv: string[], io: CliIo): number {
  const { flags, rest } = parseFlags(argv);
  const { files, pathOf } = collectFilesWithPaths(rest.length > 0 ? rest : ["."], io);
  if (files.length === 0) {
    io.err("No ABAP sources found.");
    return 2;
  }
  const opts = {
    version: asVersion(flags.get("abap-version"), "v758"),
    preset: asPreset(flags.get("preset")),
    rules: rulesFromFile(flags.get("rules-file")),
  };
  let fixedCount = 0;
  let remaining = 0;
  const results = chunk(files, MAX_FILES).map((b) => fixAbap(b, opts));
  for (const r of results) {
    fixedCount += r.fixedCount;
    remaining += r.remaining.length;
    if (r.stoppedEarly !== undefined) io.err(`note: ${r.stoppedEarly}`);
  }
  if (flags.has("json")) {
    io.out(
      JSON.stringify(
        {
          fixedCount,
          remainingCount: remaining,
          files: results.flatMap((r) => r.files),
          fixed: results.flatMap((r) => r.fixed),
          remaining: results.flatMap((r) => r.remaining),
        },
        null,
        2,
      ),
    );
    return 0;
  }
  const changed = results.flatMap((r) => r.files.filter((f) => f.changed));
  if (flags.has("write")) {
    for (const f of changed) {
      const targets = pathOf.get(f.filename) ?? [];
      if (targets.length !== 1) {
        io.err(`skip write ${f.filename}: ${targets.length === 0 ? "path unknown" : "ambiguous (same name in several folders)"}`);
        continue;
      }
      writeFileSync(targets[0]!, f.source, "utf8");
      io.out(`fixed ${targets[0]}`);
    }
  } else {
    for (const r of results)
      for (const fx of r.fixed) io.out(`${fx.file}:${fx.line} ${fx.rule}: ${fx.message}`);
    if (changed.length > 0) io.out(`(dry run — use --write to apply, --json for the corrected sources)`);
  }
  io.out(`${fixedCount} fix(es) across ${changed.length} file(s); ${remaining} finding(s) have no machine fix`);
  return 0;
}

export function cmdUnittest(argv: string[], io: CliIo): number | Promise<number> {
  const { flags, rest } = parseFlags(argv);
  // `--run` is a boolean flag, but parseFlags hands the next bare token to the
  // preceding flag — so in `unittest --run src/` the path lands there. Take it
  // back, otherwise the command would silently sweep the whole working tree.
  const runFlag = flags.get("run");
  const paths = typeof runFlag === "string" ? [...rest, runFlag] : rest;
  const files = collectFiles(paths.length > 0 ? paths : ["."], io);
  if (files.length === 0) {
    io.err("No ABAP sources found.");
    return 2;
  }

  // `--run` EXECUTES the tests offline (transpiled to JavaScript, open-abap
  // kernel) instead of scaffolding skeletons — the CI gate of the red-green
  // loop: exit 1 on any failure or error. It is the one asynchronous command,
  // so it returns a promise the entry point awaits; every other path stays
  // synchronous.
  if (flags.has("run")) {
    // Never truncate a caller's file list to fit the runner cap — a dropped file
    // is a dropped test, and a dropped test that would have failed is a false
    // green with exit 0. Reject and say so instead.
    if (files.length > MAX_FILES) {
      io.err(
        `error: ${files.length} files exceed the runner limit of ${MAX_FILES} per run — split the directory or pass explicit files`,
      );
      return 2;
    }
    return (async (): Promise<number> => {
      let result: UnitRunResult;
      try {
        result = await runAbapUnit(files, {
          abapVersion: asVersion(flags.get("abap-version"), "Cloud"),
          ...(typeof flags.get("only") === "string"
            ? { only: (flags.get("only") as string).split(",").map((s) => s.trim()).filter((s) => s.length > 0) }
            : {}),
          ...(typeof flags.get("timeout-ms") === "string"
            ? { timeoutMs: Number(flags.get("timeout-ms")) }
            : {}),
        });
      } catch (err) {
        // runAbapUnit throws (rather than an `available:false` result) for input it refuses to
        // even attempt — e.g. an `@KERNEL` directive. Same {kind, hint, nextTools} contract
        // errorResult() gives MCP callers, rendered for a terminal instead.
        const e =
          err instanceof McpToolError ? err : new McpToolError("internal", err instanceof Error ? err.message : String(err));
        if (flags.has("json")) {
          io.out(JSON.stringify({ error: { kind: e.kind, message: e.message, hint: e.hint, nextTools: e.nextTools } }, null, 2));
        } else {
          io.err(`${e.kind}: ${e.message}`);
          if (e.hint !== undefined) io.err(`hint: ${e.hint}`);
          if (e.nextTools.length > 0) io.err(`next: ${e.nextTools.join(", ")}`);
        }
        return 1;
      }
      // Zero methods discovered — whether because the input holds no FOR TESTING
      // method at all, or a parse/transpile problem (see transpileIssues below)
      // kept the registry from ever finding one — must never read as a quiet
      // pass: there is nothing here for "0 failed, 0 errored" to be honest about.
      const noMethodsFound = result.available && result.results.length === 0;
      if (flags.has("json")) {
        io.out(JSON.stringify(result, null, 2));
        if (!result.available) return 1;
        if (noMethodsFound) return 1;
        return result.failed + result.errored > 0 ? 1 : 0;
      }

      const STATUS: Record<UnitRunResult["results"][number]["status"], string> = {
        pass: "PASS ",
        fail: "FAIL ",
        error: "ERROR",
        skipped: "SKIP ",
      };
      if (!result.available) {
        io.err(`Offline execution unavailable (${result.unavailable?.kind ?? "unknown"}): ${result.unavailable?.message ?? ""}`);
        io.err(result.unavailable?.hint ?? "");
      }
      for (const issue of result.transpileIssues) io.err(`transpile ${fmtFinding(issue)}`);
      for (const u of result.unsupported) io.err(`unsupported ${u.file}: ${u.reason}`);
      let currentClass = "";
      for (const r of result.results) {
        const cls = `${r.className}=>${r.testClassName}`;
        if (cls !== currentClass) {
          io.out(`\n${cls}`);
          currentClass = cls;
        }
        const detail =
          r.status === "fail" && (r.expected !== undefined || r.actual !== undefined)
            ? `  exp <${r.expected ?? ""}> act <${r.actual ?? ""}>${r.message !== undefined ? ` — ${r.message}` : ""}`
            : r.message !== undefined
              ? `  ${r.message}`
              : "";
        io.out(`  ${STATUS[r.status]} ${r.methodName.padEnd(32)} ${String(r.runtimeMs).padStart(5)} ms${detail}`);
        if (r.jsLocation !== undefined && (r.status === "fail" || r.status === "error")) {
          io.out(`        at ${r.jsLocation}`);
        }
      }
      if (noMethodsFound) {
        io.err("no test methods found — nothing to run (see the transpile/unsupported issues above, if any).");
      }
      const total = result.durationMs.parse + result.durationMs.transpile + result.durationMs.execute;
      io.out(
        `\n${result.results.length} test method(s): ${result.passed} passed, ${result.failed} failed, ` +
          `${result.errored} errored, ${result.skipped} skipped in ${(total / 1000).toFixed(1)}s ` +
          `(parse ${result.durationMs.parse} ms, transpile ${result.durationMs.transpile} ms, run ${result.durationMs.execute} ms)`,
      );
      if (result.lint.findings.length > 0) {
        io.out(
          `${result.lint.findings.length} static finding(s) at ${result.lint.abapVersion} — see "abap-mcp lint" for the detail.`,
        );
      }
      io.out(`\n${result.scopeNote}`);
      if (!result.available) return 1;
      if (noMethodsFound) return 1;
      return result.failed + result.errored > 0 ? 1 : 0;
    })();
  }
  const version = asVersion(flags.get("abap-version"), "v758");
  const result = scaffoldAbapUnit(files.slice(0, MAX_FILES), version);
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
      io.out(`wrote ${target}  [${f.validated}] for ${f.forClass}`);
    }
  } else if (flags.has("json")) {
    io.out(JSON.stringify(result, null, 2));
  } else {
    for (const f of result.files) {
      io.out(`\n===== ${f.filename}  [validated: ${f.validated}] =====`);
      io.out(f.content);
    }
  }
  for (const s of result.skipped) io.err(`skip ${s.object}: ${s.reason}`);
  if (!flags.has("json")) io.out(`\nNext steps:\n${result.nextSteps.map((s) => `  - ${s}`).join("\n")}`);
  if (result.validationIssues.length > 0) {
    io.err(`WARNING: ${result.validationIssues.length} abaplint finding(s) on generated code`);
    return 1;
  }
  return 0;
}

export function cmdDeps(argv: string[], io: CliIo): number {
  const { flags, rest } = parseFlags(argv);
  const files = collectFiles(rest.length > 0 ? rest : ["."], io);
  if (files.length === 0) {
    io.err("No ABAP sources found.");
    return 2;
  }
  if (files.length > MAX_FILES) {
    io.err(`deps is object-level: at most ${MAX_FILES} files per call — narrow the path.`);
    return 2;
  }
  const graph = getObjectDependencies(
    files,
    asVersion(flags.get("abap-version"), "v758"),
    flags.has("mermaid"),
    asEdition(flags.get("edition")),
  );
  if (flags.has("mermaid")) {
    io.out(graph.mermaid ?? "");
    return 0;
  }
  if (flags.has("json")) {
    io.out(JSON.stringify(graph, null, 2));
    return 0;
  }
  for (const e of graph.edges) io.out(`${e.from}  --${e.kind}-->  ${e.to}`);
  const flagged = graph.nodes.filter((n) => n.releasedState !== undefined && n.releasedState !== "released");
  for (const n of flagged)
    io.out(`⚠ ${n.name}: ${n.releasedState}${n.successor !== undefined ? ` → use ${n.successor}` : ""}`);
  io.out(`${graph.nodes.length} node(s), ${graph.edges.length} edge(s)  (snapshot ${graph.releasedApiSnapshotDate})`);
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
  if (flags.has("mermaid")) {
    io.out(outlineToMermaid(outlines));
    return 0;
  }
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

export function cmdCompare(argv: string[], io: CliIo): number {
  const { flags, rest } = parseFlags(argv);
  if (rest.length !== 2) {
    io.err(
      "Usage: abap-mcp compare BEFORE_PATH AFTER_PATH   [--abap-version v758|Cloud] [--preset style|full|syntax-only] [--focus Performance|Security|Styleguide] [--rules-file abaplint.json] [--no-rap] [--json]",
    );
    return 2;
  }
  const before = collectFiles([rest[0]!], io);
  const after = collectFiles([rest[1]!], io);
  if (before.length === 0 || after.length === 0) {
    io.err("No ABAP sources found on one side.");
    return 2;
  }
  if (before.length > MAX_FILES || after.length > MAX_FILES) {
    io.err(`compare is object-level: at most ${MAX_FILES} files per side — narrow each path to the object(s) under review.`);
    return 2;
  }
  const report = compareAbap(before, after, {
    version: asVersion(flags.get("abap-version"), "v758"),
    preset: asPreset(flags.get("preset")),
    focus: asFocus(flags.get("focus")),
    rules: rulesFromFile(flags.get("rules-file")),
  });
  if (flags.has("json")) {
    io.out(JSON.stringify(report, null, 2));
  } else {
    io.out(`lint: ${report.introduced.length} introduced, ${report.resolved.length} resolved, ${report.unchangedCount} unchanged`);
    for (const f of report.introduced) io.out(`  + ${fmtFinding(f)}`);
    for (const f of report.resolved) io.out(`  - ${fmtFinding(f)}`);
    io.out(
      `readiness: blockers ${report.before.cloudBlockerCount} → ${report.after.cloudBlockerCount}, ` +
        `score ${report.before.score} → ${report.after.score}, grade ${report.before.grade} → ${report.after.grade}`,
    );
    const oc = report.outlineChanges;
    const structural = [
      ...oc.classesAdded.map((s) => `+ class ${s}`),
      ...oc.classesRemoved.map((s) => `- class ${s}`),
      ...oc.methodsAdded.map((s) => `+ method ${s}`),
      ...oc.methodsRemoved.map((s) => `- method ${s}`),
      ...oc.formsAdded.map((s) => `+ form ${s}`),
      ...oc.formsRemoved.map((s) => `- form ${s}`),
    ];
    if (structural.length > 0) {
      io.out("structure:");
      for (const s of structural) io.out(`  ${s}`);
    }
  }
  // Regression gate: new findings or more cloud blockers fail the rework.
  return report.introduced.length > 0 || report.after.cloudBlockerCount > report.before.cloudBlockerCount ? 1 : 0;
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
    io.err("Usage: abap-mcp released <object-name…>   [--type TABL|CDS_STOB|FUNC|…] [--edition s4hc|btp|pce] [--json]");
    return 2;
  }
  const type = typeof flags.get("type") === "string" ? (flags.get("type") as string) : undefined;
  const edition = asEdition(flags.get("edition"));
  const results = rest.map((name) => {
    const hit = lookupReleased(name, type, edition);
    // hit.successorSource already encodes the priority (curated wins when present).
    const successor = hit.successorSource === "curated" ? suggestSuccessor(name) : hit.successors?.[0]?.name;
    return { ...hit, successor };
  });
  const snapshot = RELEASED_API_SNAPSHOTS[edition];
  if (flags.has("json")) {
    io.out(JSON.stringify({ snapshotDate: snapshot.snapshotDate, source: snapshot.source, edition, results }, null, 2));
    return 0;
  }
  io.out(`Released-API status (SAP Cloudification snapshot ${snapshot.snapshotDate}, edition ${edition}):`);
  for (const r of results) {
    const tail = r.successor !== undefined ? `  → use ${r.successor}${r.successorSource === "sap" ? " (SAP)" : " (curated)"}` : "";
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
  abap-mcp setup [target]        register abap-mcp with your editor (auto-detects; targets: vscode, vscode-insiders, eclipse, claude)
  abap-mcp lint [paths…]         lint files/dirs   [--abap-version v758|Cloud] [--preset style|full|syntax-only] [--focus Performance|Security|Styleguide] [--rules-file abaplint.json] [--no-rap] [--json]
  abap-mcp fix [paths…]          apply abaplint's deterministic auto-fixes (keyword case, MOVE→=, …)   [--write] [--abap-version …] [--preset …] [--rules-file …] [--json]
  abap-mcp readiness [paths…]    ABAP Cloud readiness diff, scored + graded A–D   [--baseline v758] [--edition s4hc|btp|pce] [--fail-below N] [--json]
  abap-mcp plan [paths…]         phased migration backlog from the readiness diff — work items, S/M/L efforts, exit criteria   [--baseline v758] [--edition s4hc|btp|pce] [--json]
  abap-mcp compare BEFORE AFTER  what a rework changed: findings resolved/introduced, blocker/score/grade movement, structure   [--preset …] [--focus …] [--json]
  abap-mcp scaffold …            generate a RAP managed BO   (--entity --table --key [--fields n:type,…] [--no-draft] [--provided-key] [--out DIR])
  abap-mcp unittest [paths…]     scaffold failing-by-default ABAP Unit test classes for global classes   [--abap-version v758|Cloud] [--out DIR] [--json]
  abap-mcp unittest --run […]    EXECUTE the ABAP Unit tests offline (transpiled to JS, open-abap kernel, Node-permission-sandboxed on Node 22+ — no DB/CDS/EML, no @KERNEL); max 32 files (exit 2 above that), exit 1 on any failure/error or zero test methods found   [--only CLASS>METHOD,…] [--timeout-ms 20000] [--abap-version Cloud] [--json]
  abap-mcp deps [paths…]         dependency graph: db/function refs (+released state), inherits/implements, textual   [--mermaid] [--edition s4hc|btp|pce] [--json]
  abap-mcp outline [paths…]      classes/methods/forms structure   [--mermaid] [--json]
  abap-mcp released <names…>     released-API status from the bundled SAP snapshot   [--type TABL|FUNC|…] [--edition s4hc|btp|pce] [--json]
  abap-mcp explain <rule>        explain an abaplint rule
  abap-mcp rules                 list rules   [--query q] [--tag Security]
  abap-mcp rapcheck [paths…]     check RAP behavior/service definitions (BDEF/SRVD) — syntax + draft/etag/lock/authorization consistency, strict-mode obligations, projection use vs base, service expose vs CDS (abaplint parses neither file type)   [--release 2508] [--strict] [--json]
${EXTRA_USAGE}

Exit codes: 0 ok · 1 findings/validation failed · 2 usage error`;

export function runCli(argv: string[], io: CliIo): number | Promise<number> | null {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case undefined:
    case "serve":
      return null; // caller starts the MCP server
    case "setup":
      return cmdSetup(rest, io);
    case "lint":
      return cmdLint(rest, io);
    case "fix":
      return cmdFix(rest, io);
    case "readiness":
      return cmdReadiness(rest, io);
    case "plan":
      return cmdPlan(rest, io);
    case "compare":
      return cmdCompare(rest, io);
    case "scaffold":
      return cmdScaffold(rest, io);
    case "unittest":
      return cmdUnittest(rest, io);
    case "deps":
      return cmdDeps(rest, io);
    case "outline":
      return cmdOutline(rest, io);
    case "released":
      return cmdReleased(rest, io);
    case "explain":
      return cmdExplain(rest, io);
    case "rules":
      return cmdRules(rest, io);
    case "release":
      return cmdRelease(rest, io);
    case "knowledge":
      return cmdKnowledge(rest, io);
    case "aisdk":
      return cmdAisdk(rest, {
        ...io,
        writeFile: (path, content) => {
          mkdirSync(join(path, ".."), { recursive: true });
          writeFileSync(path, content, "utf8");
        },
        exists: existsSync,
      });
    case "agent-rules":
      return cmdAgentRules(rest, io);
    case "rapcheck":
      return cmdRapcheck(rest, { ...io, readSources: (paths) => collectFiles(paths, io) });
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
