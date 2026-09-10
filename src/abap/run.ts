/**
 * Offline ABAP Unit execution — the executable half of the agent feedback loop.
 *
 * The ABAP sources are transpiled to JavaScript by @abaplint/transpiler against
 * the bundled open-abap-core library (MIT, `src/data/open-abap-core.json`) and
 * the result is executed by a **subprocess** in a server-owned temp directory:
 *
 *   parse (~1.3 s)  →  transpile (~2.2 s)  →  node <runner> (~0.4 s)
 *
 * What that is and is not, is the whole design (see RUN_SCOPE_NOTE): this is the
 * open-abap kernel, not SAP's. Pure logic runs; a database, CDS, EML/RAP, AMDP,
 * authority checks and locks do not exist. A green run is evidence, never proof,
 * and ABAP Unit on a real system stays authoritative — so every result carries
 * the honest lint at the caller's target ABAP version alongside the run.
 *
 * Boundaries kept:
 *  - fresh registry per call (statelessness = the concurrency strategy);
 *  - inputs bounded by the same MAX_FILES / MAX_FILE_CHARS caps as every tool;
 *  - the only filesystem the run touches is a `mkdtemp` directory this module
 *    creates and removes in a `finally` — no user path is ever read or written,
 *    and the ABAP library is a package-bundled asset like the released-API
 *    snapshot (loaded lazily so the stdio server pays nothing at startup);
 *  - the child is spawned with execFile (never a shell), a scrubbed environment,
 *    a hard timeout + SIGKILL and a bounded output buffer;
 *  - no source text is ever logged; results are returned, not printed.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import * as abaplint from "@abaplint/core";

import type { AbapSource, AbapVersion, Finding } from "./engine.js";
import { boundFiles, runAbaplint } from "./engine.js";

const execFileAsync = promisify(execFile);

/** The honesty label that travels with every run result. */
export const RUN_SCOPE_NOTE =
  "ABAP transpiled to JavaScript by @abaplint/transpiler and executed on Node against the open-abap " +
  "kernel — not the SAP ABAP kernel. No database, no CDS, no EML/RAP runtime, no AMDP, no authority " +
  "checks, no locks. A green run is evidence the pure logic works; ABAP Unit on a real system remains " +
  "authoritative.";

export const RUN_DEFAULT_TIMEOUT_MS = 20_000;
export const RUN_MAX_TIMEOUT_MS = 60_000;
export const RUN_MIN_TIMEOUT_MS = 1_000;
/** Temp directories are created as <os.tmpdir()>/<TEMP_DIR_PREFIX><random>. */
export const TEMP_DIR_PREFIX = "abap-mcp-run-";

const MAX_CHILD_OUTPUT_BYTES = 4_000_000;
const MAX_MESSAGE_CHARS = 2_000;
/** open-abap is the transpiler's own language level; the caller's level is linted separately. */
const LIB_SYNTAX_VERSION = "open-abap";

export type UnitStatus = "pass" | "fail" | "error" | "skipped";

export interface UnitMethodResult {
  /** Global class the test class belongs to, upper-cased. */
  className: string;
  /** Local FOR TESTING class, upper-cased. */
  testClassName: string;
  /** Test method, upper-cased. */
  methodName: string;
  status: UnitStatus;
  /** Expected value from cl_abap_unit_assert, when the assertion carried one. */
  expected?: string;
  actual?: string;
  message?: string;
  /** Wall time the open-abap runner measured for the method. */
  runtimeMs: number;
  /** Location in the transpiled JavaScript, temp path stripped. */
  jsLocation?: string;
  /** Anything the method wrote to the console during the run. */
  console?: string;
}

export interface UnitRunUnavailable {
  /** Machine-readable cause, stable across releases. */
  kind: "library-bundle-missing" | "transpiler-not-resolvable" | "runtime-not-resolvable";
  message: string;
  hint: string;
}

export interface UnitRunResult {
  /** False when the run could not even be attempted (see `unavailable`). */
  available: boolean;
  unavailable?: UnitRunUnavailable;
  results: UnitMethodResult[];
  passed: number;
  failed: number;
  errored: number;
  skipped: number;
  /** Inputs (or constructs inside them) the offline kernel cannot execute. */
  unsupported: { file: string; reason: string }[];
  /** The honest static lint at the caller's target version — independent of the run. */
  lint: { findings: Finding[]; abapVersion: AbapVersion };
  /** Parser / syntax problems that stopped or endangered the transpile, at open-abap level. */
  transpileIssues: Finding[];
  durationMs: { parse: number; transpile: number; execute: number };
  scopeNote: string;
}

export interface RunAbapUnitOptions {
  /** Wall-clock budget for the child process; default 20 s, capped at 60 s. */
  timeoutMs?: number | undefined;
  /** Run only these tests, as "CLASS>METHOD" (the class may be the global or the local test class). */
  only?: string[] | undefined;
  /** ABAP version for the separate, honest static lint. Default "Cloud". */
  abapVersion?: AbapVersion | undefined;
}

interface OpenAbapLibrary {
  source: string;
  license: string;
  commit: string;
  retrievedAt: string;
  files: { name: string; content: string }[];
}

interface TestMethod {
  className: string;
  testClassName: string;
  methodName: string;
}

let cachedLibrary: OpenAbapLibrary | undefined;

/**
 * Load the bundled open-abap-core sources.
 *
 * Deliberately lazy (and via createRequire rather than a static JSON import):
 * the bundle is 1.3 MB and only `run_abap_unit` needs it, so the stdio server
 * and every other tool start without paying for it. It is a package asset —
 * `dist/data/open-abap-core.json`, put there by scripts/copy-data.mjs — not a
 * user path, so the "no user filesystem" boundary is intact.
 */
export function loadOpenAbapLibrary(): OpenAbapLibrary {
  if (cachedLibrary !== undefined) return cachedLibrary;
  const require = createRequire(import.meta.url);
  const lib = require("../data/open-abap-core.json") as OpenAbapLibrary;
  if (!Array.isArray(lib.files) || lib.files.length === 0) {
    throw new Error("open-abap-core.json contains no files");
  }
  cachedLibrary = lib;
  return lib;
}

function clampTimeout(ms: number | undefined): number {
  if (ms === undefined || !Number.isFinite(ms)) return RUN_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.round(ms), RUN_MIN_TIMEOUT_MS), RUN_MAX_TIMEOUT_MS);
}

function toFinding(issue: abaplint.Issue, lines: Map<string, string[]>): Finding {
  const start = issue.getStart();
  const excerpt = (lines.get(issue.getFilename())?.[start.getRow() - 1] ?? "").trim().slice(0, 100);
  return {
    rule: issue.getKey(),
    message: issue.getMessage(),
    severity: String(issue.getSeverity()),
    file: issue.getFilename(),
    line: start.getRow(),
    column: start.getCol(),
    excerpt,
    docsUrl: `https://rules.abaplint.org/${issue.getKey()}/`,
  };
}

/**
 * The transpiler reports validation problems by throwing one Error whose
 * message is `key, message, filename:row` per line. Parse it back into the
 * same Finding shape the rest of the server speaks, so a failed transpile is
 * actionable instead of opaque.
 */
function findingsFromTranspileError(err: unknown): Finding[] {
  const raw = err instanceof Error ? err.message : String(err);
  const out: Finding[] = [];
  for (const line of raw.split("\n")) {
    const m = /^([a-z0-9_]+), ([\s\S]*), ([^,]*):(\d+)$/.exec(line.trim());
    if (m === null) continue;
    out.push({
      rule: m[1]!,
      message: m[2]!,
      severity: "Error",
      file: m[3]!,
      line: Number(m[4]),
      column: 1,
      excerpt: "",
      docsUrl: `https://rules.abaplint.org/${m[1]!}/`,
    });
  }
  if (out.length === 0) {
    out.push({
      rule: "transpile_error",
      message: raw.slice(0, MAX_MESSAGE_CHARS),
      severity: "Error",
      file: "",
      line: 1,
      column: 1,
      docsUrl: "https://github.com/abaplint/transpiler",
      excerpt: "",
    });
  }
  return out;
}

/** ABAP-SQL statement kinds, mirroring engine.ts's object-reference walk. */
const SQL_STATEMENTS = new Set([
  "Select",
  "SelectLoop",
  "InsertDatabase",
  "UpdateDatabase",
  "DeleteDatabase",
  "ModifyDatabase",
]);

const EML_STATEMENTS = new Map<string, string>([
  ["ReadEntities", "READ ENTITIES"],
  ["ModifyEntities", "MODIFY ENTITIES"],
  ["CommitEntities", "COMMIT ENTITIES"],
  ["RollbackEntities", "ROLLBACK ENTITIES"],
  ["RaiseEntityEvent", "RAISE ENTITY EVENT"],
]);

/**
 * Statically flag constructs the open-abap kernel cannot execute, so an agent
 * is told *why* a method blew up (or would have) instead of reading a
 * JavaScript stack. Conservative on purpose: only statements the parser hands
 * us as first-class expressions are reported.
 */
function findUnsupported(registry: abaplint.IRegistry): { file: string; reason: string }[] {
  const out: { file: string; reason: string }[] = [];
  const seen = new Set<string>();
  const push = (file: string, reason: string): void => {
    const key = `${file}|${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ file, reason });
  };

  for (const obj of registry.getObjects()) {
    if (registry.isDependency(obj) || !(obj instanceof abaplint.ABAPObject)) continue;
    for (const file of obj.getABAPFiles()) {
      const filename = file.getFilename();
      for (const st of file.getStatements()) {
        const type = st.get().constructor.name;
        const row = st.getFirstToken().getStart().getRow();
        if (SQL_STATEMENTS.has(type)) {
          const table =
            st.findFirstExpression(abaplint.Expressions.DatabaseTable)?.concatTokens().trim() ??
            "(unknown)";
          push(
            filename,
            `ABAP SQL against database table ${table.toUpperCase()} (line ${row}): the open-abap kernel has no database — the statement returns a void value or aborts the run. Isolate the read behind an interface and pass a test double.`,
          );
        } else if (type === "CallFunction") {
          const fm =
            st.findFirstExpression(abaplint.Expressions.FunctionName)?.concatTokens().replace(/'/g, "").trim() ??
            "(dynamic)";
          push(
            filename,
            `CALL FUNCTION '${fm.toUpperCase()}' (line ${row}): function modules are not part of the bundled open-abap library — the call aborts the run.`,
          );
        } else if (EML_STATEMENTS.has(type)) {
          push(
            filename,
            `${EML_STATEMENTS.get(type)!} (line ${row}): there is no RAP/EML runtime offline — test RAP behavior with cl_abap_behavior_test_environment on a real system.`,
          );
        } else if (type === "AuthorityCheck") {
          push(
            filename,
            `AUTHORITY-CHECK (line ${row}): no authorization objects exist offline — the check cannot be exercised here.`,
          );
        } else if (type === "MethodImplementation" && /BY\s+DATABASE\s+(PROCEDURE|FUNCTION)/i.test(st.concatTokens())) {
          push(
            filename,
            `AMDP method (line ${row}): SQLScript runs in HANA, never in the transpiled JavaScript.`,
          );
        } else if (type === "Submit" || type === "CallTransaction" || type === "CallScreen") {
          push(
            filename,
            `${type === "Submit" ? "SUBMIT" : type === "CallTransaction" ? "CALL TRANSACTION" : "CALL SCREEN"} (line ${row}): classic runtime control flow has no offline equivalent.`,
          );
        }
      }
    }
  }
  return out;
}

/** Mirrors the transpiler's own unitTestScriptOpen discovery, so the two lists agree. */
function discoverTestMethods(registry: abaplint.IRegistry): TestMethod[] {
  const out: TestMethod[] = [];
  for (const obj of registry.getObjects()) {
    if (registry.isDependency(obj) || !(obj instanceof abaplint.Objects.Class)) continue;
    for (const file of obj.getABAPFiles()) {
      for (const def of file.getInfo().listClassDefinitions()) {
        if (!def.isForTesting || def.isGlobal || def.methods.length === 0) continue;
        for (const method of def.methods) {
          if (!method.isForTesting) continue;
          out.push({
            className: obj.getName().toUpperCase(),
            testClassName: def.name.toUpperCase(),
            methodName: method.name.toUpperCase(),
          });
        }
      }
    }
  }
  return out;
}

function methodKey(m: TestMethod): string {
  return `${m.className}>${m.testClassName}>${m.methodName}`;
}

function matchesOnly(m: TestMethod, filters: string[]): boolean {
  return filters.some((raw) => {
    const filter = raw.trim().toUpperCase();
    if (filter.length === 0) return false;
    const idx = filter.lastIndexOf(">");
    if (idx < 0) return filter === m.methodName;
    const left = filter.slice(0, idx).trim();
    const right = filter.slice(idx + 1).trim();
    return (left === m.className || left === m.testClassName) && right === m.methodName;
  });
}

/**
 * The generated open runner appends one four-line block per test method. Drop
 * the blocks that `only` deselected so unselected tests are never executed
 * (the transpiler exposes no filter for this, and the exact @abaplint
 * transpiler version is pinned, so the shape is stable).
 */
const RUNNER_BLOCK_RE =
  /[ \t]*ls_input\.get\(\)\.class_name\.set\("([^"]*)"\);\n[ \t]*ls_input\.get\(\)\.testclass_name\.set\("([^"]*)"\);\n[ \t]*ls_input\.get\(\)\.method_name\.set\("([^"]*)"\);\n[ \t]*abap\.statements\.append\(\{source: ls_input, target: lt_input\}\);\n/g;

export function filterRunnerScript(script: string, selected: Set<string>): string {
  return script.replace(RUNNER_BLOCK_RE, (block, cls: string, testCls: string, method: string) =>
    selected.has(`${cls.toUpperCase()}>${testCls.toUpperCase()}>${method.toUpperCase()}`) ? block : "",
  );
}

function stripTempPath(text: string, dir: string): string {
  const asUrl = pathToFileURL(`${dir}/`).href;
  return text.split(asUrl).join("./").split(`${dir}/`).join("./").split(dir).join(".");
}

interface RunnerRow {
  class_name?: string;
  testclass_name?: string;
  method_name?: string;
  expected?: string;
  actual?: string;
  status?: string;
  runtime?: number;
  message?: string;
  js_location?: string;
  console?: string;
}

/**
 * open-abap's KERNEL_UNIT_RUNNER knows SUCCESS / FAILED / SKIPPED only, and
 * reports an uncaught non-assertion exception as FAILED with the fixed message
 * "Some exception raised". Split that into fail (an assertion said no) vs
 * error (the code blew up) — the two mean different things to an agent.
 */
const KERNEL_EXCEPTION_MESSAGE = "Some exception raised";

function statusFromRow(row: RunnerRow): { status: UnitStatus; message: string } {
  const status = (row.status ?? "").toUpperCase();
  const message = row.message ?? "";
  if (status === "SUCCESS") return { status: "pass", message };
  if (status === "SKIPPED") return { status: "skipped", message };
  if (status === "FAILED") {
    if (message === KERNEL_EXCEPTION_MESSAGE) {
      return {
        status: "error",
        message:
          "uncaught exception (not an assertion failure) — the open-abap runner reports it as \"Some exception raised\" without the exception class; see jsLocation",
      };
    }
    return { status: "fail", message };
  }
  return { status: "error", message: message.length > 0 ? message : `unknown runner status "${row.status ?? ""}"` };
}

function assign(target: UnitMethodResult, key: "expected" | "actual" | "message" | "jsLocation" | "console", value: string | undefined): void {
  if (value === undefined || value.length === 0) return;
  target[key] = value.slice(0, MAX_MESSAGE_CHARS);
}

function summarize(result: UnitRunResult): UnitRunResult {
  result.passed = result.results.filter((r) => r.status === "pass").length;
  result.failed = result.results.filter((r) => r.status === "fail").length;
  result.errored = result.results.filter((r) => r.status === "error").length;
  result.skipped = result.results.filter((r) => r.status === "skipped").length;
  return result;
}

/** Files the transpiler can turn into JavaScript. CDS/BDEF/SRVD/DDLX cannot be executed. */
function isTranspilable(filename: string): boolean {
  return filename.endsWith(".abap");
}

export async function runAbapUnit(
  files: AbapSource[],
  opts: RunAbapUnitOptions = {},
): Promise<UnitRunResult> {
  const bounded = boundFiles(files);
  const abapVersion: AbapVersion = opts.abapVersion ?? "Cloud";
  const timeoutMs = clampTimeout(opts.timeoutMs);

  // The honest lint is independent of the run: the caller's target ABAP version,
  // syntax-only preset, exactly what lint_abap would say about these files.
  const lintFindings = runAbaplint(files, { version: abapVersion, preset: "syntax-only" }).findings;

  const result: UnitRunResult = {
    available: true,
    results: [],
    passed: 0,
    failed: 0,
    errored: 0,
    skipped: 0,
    unsupported: [],
    lint: { findings: lintFindings, abapVersion },
    transpileIssues: [],
    durationMs: { parse: 0, transpile: 0, execute: 0 },
    scopeNote: RUN_SCOPE_NOTE,
  };

  const unavailable = (kind: UnitRunUnavailable["kind"], message: string, hint: string): UnitRunResult => {
    result.available = false;
    result.unavailable = { kind, message: message.slice(0, MAX_MESSAGE_CHARS), hint };
    return result;
  };

  let library: OpenAbapLibrary;
  try {
    library = loadOpenAbapLibrary();
  } catch (err) {
    return unavailable(
      "library-bundle-missing",
      `The bundled open-abap-core library could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
      "Reinstall the package (the bundle ships as dist/data/open-abap-core.json; a source checkout needs `npm run build`). Static analysis (lint_abap, check_cloud_readiness) is unaffected.",
    );
  }

  let Transpiler: typeof import("@abaplint/transpiler").Transpiler;
  try {
    ({ Transpiler } = await import("@abaplint/transpiler"));
  } catch (err) {
    return unavailable(
      "transpiler-not-resolvable",
      `@abaplint/transpiler could not be loaded: ${err instanceof Error ? err.message : String(err)}`,
      "Reinstall the package so its dependencies are present, then retry; the static tools work without it.",
    );
  }

  let runtimeEntry: string;
  try {
    runtimeEntry = createRequire(import.meta.url).resolve("@abaplint/runtime");
  } catch (err) {
    return unavailable(
      "runtime-not-resolvable",
      `@abaplint/runtime could not be resolved from ${import.meta.url}: ${err instanceof Error ? err.message : String(err)}`,
      "Reinstall the package (the ABAP runtime is a regular dependency); the generated JavaScript imports it by absolute path, so a partial install is the usual cause.",
    );
  }

  // Non-ABAP inputs are reported, not transpiled: the transpiler rejects
  // unknown object types outright, so one CDS file would fail the whole run.
  const runnable = bounded.filter((f) => isTranspilable(f.filename));
  for (const f of bounded) {
    if (isTranspilable(f.filename)) continue;
    result.unsupported.push({
      file: f.filename,
      reason:
        "not executable offline: CDS views, behavior definitions and service definitions have no transpiled JavaScript form (abaplint does not even deep-parse BDEF/SRVD). Lint them with lint_abap and test them on a system.",
    });
  }
  if (runnable.length === 0) {
    return summarize(result);
  }

  const registry = new abaplint.Registry(
    new abaplint.Config(
      JSON.stringify({
        global: {
          files: "/**/*.*",
          skipGeneratedGatewayClasses: true,
          skipGeneratedPersistentClasses: true,
          skipGeneratedFunctionGroups: true,
        },
        syntax: { version: LIB_SYNTAX_VERSION, errorNamespace: "^(Z|Y|LCL_|TY_|LIF_)" },
        rules: { parser_error: true, unknown_types: true, check_syntax: true },
      }),
    ),
  );
  const parseStart = Date.now();
  for (const f of library.files) {
    registry.addDependency(new abaplint.MemoryFile(f.name, f.content));
  }
  const userLines = new Map<string, string[]>();
  for (const f of runnable) {
    registry.addFile(new abaplint.MemoryFile(f.filename, f.source));
    userLines.set(f.filename, f.source.split("\n"));
  }
  registry.parse();
  result.durationMs.parse = Date.now() - parseStart;

  // Only the caller's files can be at fault; the library is a fixed dependency.
  result.transpileIssues = registry
    .findIssues()
    .filter((i) => userLines.has(i.getFilename()))
    .map((i) => toFinding(i, userLines));
  result.unsupported.push(...findUnsupported(registry));

  const methods = discoverTestMethods(registry);
  const selected = new Set(
    (opts.only === undefined || opts.only.length === 0
      ? methods
      : methods.filter((m) => matchesOnly(m, opts.only!))
    ).map(methodKey),
  );
  for (const m of methods) {
    if (selected.has(methodKey(m))) continue;
    result.results.push({
      className: m.className,
      testClassName: m.testClassName,
      methodName: m.methodName,
      status: "skipped",
      message: "not selected by the `only` filter",
      runtimeMs: 0,
    });
  }
  if (selected.size === 0) return summarize(result);

  const transpileStart = Date.now();
  let output: import("@abaplint/transpiler").IOutput;
  try {
    output = await new Transpiler({
      addFilenames: true,
      addCommonJS: true,
      // Unknown (SAP-system) types become runtime errors rather than compile
      // errors: an agent gets per-method feedback on the code that DOES run,
      // instead of one wall-of-text failure for the whole submission.
      unknownTypes: "runtimeError" as import("@abaplint/transpiler").UnknownTypesEnum,
    }).run(registry);
  } catch (err) {
    result.durationMs.transpile = Date.now() - transpileStart;
    result.transpileIssues.push(...findingsFromTranspileError(err));
    for (const m of methods) {
      if (!selected.has(methodKey(m))) continue;
      result.results.push({
        className: m.className,
        testClassName: m.testClassName,
        methodName: m.methodName,
        status: "error",
        message: "not executed: the sources could not be transpiled — see transpileIssues",
        runtimeMs: 0,
      });
    }
    return summarize(result);
  }
  result.durationMs.transpile = Date.now() - transpileStart;

  const dir = mkdtempSync(join(tmpdir(), TEMP_DIR_PREFIX));
  try {
    for (const obj of output.objects) {
      // Defence in depth: object names come from the registry, but nothing may
      // escape the server-owned directory.
      if (obj.filename.includes("/") || obj.filename.includes("\\") || obj.filename.includes("..")) {
        continue;
      }
      writeFileSync(join(dir, obj.filename), obj.chunk.getCode());
    }
    // The generated init imports "@abaplint/runtime" by bare specifier, which a
    // temp directory outside any node_modules cannot resolve (and NODE_PATH does
    // not apply to ESM). Rewrite it to this installation's absolute file URL —
    // that is what makes the run work under `npx abap-mcp` and global installs.
    writeFileSync(
      join(dir, "init.mjs"),
      output.initializationScript.replace(
        /from "@abaplint\/runtime"/,
        `from ${JSON.stringify(pathToFileURL(runtimeEntry).href)}`,
      ),
    );
    // Informational: the schema the run would have had, had there been a DB.
    writeFileSync(join(dir, "databaseSetup.json"), JSON.stringify(output.databaseSetup));
    const runner = join(dir, "index.mjs");
    writeFileSync(runner, filterRunnerScript(output.unitTestScriptOpen, selected));

    const executeStart = Date.now();
    let timedOut = false;
    let childError = "";
    try {
      await execFileAsync(process.execPath, [runner], {
        cwd: dir,
        timeout: timeoutMs,
        killSignal: "SIGKILL",
        maxBuffer: MAX_CHILD_OUTPUT_BYTES,
        // Scrubbed environment: the child executes the caller's ABAP logic, so
        // it gets nothing of this process's configuration or secrets.
        env: { PATH: process.env["PATH"] ?? "" },
        windowsHide: true,
      });
    } catch (err) {
      const e = err as { killed?: boolean; signal?: string; stdout?: string; stderr?: string; message?: string };
      timedOut = e.killed === true || e.signal === "SIGKILL" || e.signal === "SIGTERM";
      const stdout = String(e.stdout ?? "");
      const stderr = String(e.stderr ?? "");
      childError = stripTempPath(`${stdout}\n${stderr}`.trim() || String(e.message ?? ""), dir)
        .split("\n")
        .slice(0, 20)
        .join("\n")
        .slice(0, MAX_MESSAGE_CHARS);
    }
    result.durationMs.execute = Date.now() - executeStart;

    let rows: RunnerRow[] = [];
    try {
      rows = JSON.parse(readFileSync(join(dir, "output.json"), "utf8")) as RunnerRow[];
    } catch {
      rows = [];
    }

    const reported = new Set<string>();
    for (const row of rows) {
      const key = `${(row.class_name ?? "").trim().toUpperCase()}>${(row.testclass_name ?? "").trim().toUpperCase()}>${(row.method_name ?? "").trim().toUpperCase()}`;
      if (!selected.has(key)) continue;
      reported.add(key);
      const [className = "", testClassName = "", methodName = ""] = key.split(">");
      const { status, message } = statusFromRow(row);
      const mapped: UnitMethodResult = {
        className,
        testClassName,
        methodName,
        status,
        runtimeMs: typeof row.runtime === "number" ? row.runtime : 0,
      };
      assign(mapped, "expected", row.expected);
      assign(mapped, "actual", row.actual);
      assign(mapped, "message", message);
      assign(mapped, "jsLocation", row.js_location === undefined ? undefined : stripTempPath(row.js_location, dir));
      assign(mapped, "console", row.console === undefined ? undefined : stripTempPath(row.console, dir));
      result.results.push(mapped);
    }

    // Anything the runner never got to: a timeout, or a crash that took the
    // process down mid-suite. Never silently absent — that would read as a pass.
    for (const m of methods) {
      const key = methodKey(m);
      if (!selected.has(key) || reported.has(key)) continue;
      result.results.push({
        className: m.className,
        testClassName: m.testClassName,
        methodName: m.methodName,
        status: "error",
        runtimeMs: 0,
        message: timedOut
          ? `timeout after ${timeoutMs} ms — the run was killed before this method reported a result`
          : `the run ended before this method reported a result${childError.length > 0 ? `: ${childError}` : ""}`,
      });
    }
    return summarize(result);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
