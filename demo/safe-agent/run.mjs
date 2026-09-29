#!/usr/bin/env node
// Safe-agent demo runner: "Can an AI agent safely change ABAP?"
// For each synthetic task it runs the abap-mcp gates (readiness / lint / rapcheck / unittest --run /
// fix / grep policy) on the BASELINE (what an unassisted LLM plausibly wrote) and on the SOLUTION,
// then prints a scorecard. Baselines must FAIL their gates; solutions must PASS. Offline, no deps.
//
//   node demo/safe-agent/run.mjs              all tasks, table on stdout
//   node demo/safe-agent/run.mjs --task 05    one task (number or slug fragment)
//   node demo/safe-agent/run.mjs --scan DIR   policy-only check of any folder of .abap files (live demo)
//   node demo/safe-agent/run.mjs --json       also write report.json + report.md next to this file
// Exit 1 if any solution fails, any baseline unexpectedly passes, or an expected blocker is not reported.
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, cpSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CLI = join(ROOT, "dist", "cli.js");
const TASKS = join(HERE, "tasks");
const args = process.argv.slice(2);
const WRITE_JSON = args.includes("--json");
const ONLY = args.includes("--task") ? args[args.indexOf("--task") + 1] : null;
const ALWAYS_BLOCKING = ["parser_error", "check_syntax"]; // a file that does not parse is never "passing"

if (!existsSync(CLI)) { console.error(`dist/cli.js missing - run "npm run build" first`); process.exit(2); }
const policy = JSON.parse(readFileSync(join(HERE, "policy.json"), "utf8"));

// ---- CLI helper: exit codes carry findings, so never throw on non-zero ------------------
function cli(cliArgs) {
  return new Promise((res, rej) => {
    execFile("node", [CLI, ...cliArgs], { cwd: ROOT, maxBuffer: 64 << 20, timeout: 50000 }, (err, stdout, stderr) => {
      if (err && err.code === undefined) return rej(err); // spawn failure / timeout
      res({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}
async function cliJson(cliArgs) {
  const r = await cli([...cliArgs, "--json"]);
  try { return JSON.parse(r.stdout); } catch { throw new Error(`abap-mcp ${cliArgs[0]} gave no JSON (exit ${r.code}): ${(r.stderr || r.stdout).slice(0, 200)}`); }
}
const rel = (p) => p.replace(ROOT + "/", "");
const uniq = (a) => [...new Set(a)];

// ---- gates: each returns { pass, ids, detail } -------------------------------------------
async function gReadiness(dir, x) {
  const r = await cliJson(["readiness", rel(dir), "--edition", x.edition ?? "btp"]);
  const rapi = (r.releasedApiFindings ?? []).map((f) => `released:${f.object}`);
  const ids = uniq([...(r.categories ?? []).map((c) => c.category), ...rapi]);
  const pass = r.verdict === "ready" && rapi.length === 0;
  return { pass, ids, grade: r.grade, detail: `${r.grade}/${r.score}` + (rapi.length ? ` ${rapi.map((s) => s.slice(9)).join(",")} not released` : r.cloudBlockerCount ? ` ${r.cloudBlockerCount} blockers` : "") };
}
async function lintBlocking(dir, x) {
  const extra = x.lintFocus ? ["--focus", x.lintFocus] : [];
  const r = await cliJson(["lint", rel(dir), "--abap-version", "Cloud", ...extra]);
  const bad = new Set([...ALWAYS_BLOCKING, ...(x.lintFail ?? [])]);
  return (r.findings ?? []).filter((f) => bad.has(f.rule));
}
async function gLint(dir, x) {
  const f = await lintBlocking(dir, x);
  return { pass: f.length === 0, ids: uniq(f.map((v) => v.rule)), detail: f.length ? `${f.length} blocking` : "clean" };
}
async function gRapcheck(dir) {
  const r = await cliJson(["rapcheck", rel(dir)]);
  const errs = (r.findings ?? []).filter((f) => f.severity === "error");
  return { pass: errs.length === 0, ids: uniq(errs.map((f) => f.rule)), detail: errs.length ? `${errs.length} errors` : "0 errors" };
}
async function gUnit(dir) {
  const r = await cliJson(["unittest", "--run", rel(dir), "--abap-version", "Cloud"]);
  if (r.available === false) throw new Error("ABAP Unit runner unavailable");
  const total = r.results.length;
  const bad = r.results.filter((t) => t.status !== "pass");
  return { pass: total > 0 && bad.length === 0, ids: bad.map((t) => `${t.className}>${t.methodName}`), detail: `${total - bad.length}/${total} pass` };
}
function stripComments(src) {
  return src.split("\n").filter((l) => !/^\s*[*"]/.test(l)).map((l) => l.replace(/(^|\s)"[^']*$/, "$1")).join("\n");
}
function gPolicy(dir, ruleIds) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".abap")).map((f) => [f, stripComments(readFileSync(join(dir, f), "utf8"))]);
  const hits = [];
  for (const id of ruleIds) {
    const rule = policy.rules.find((r) => r.id === id);
    if (!rule) throw new Error(`unknown policy rule ${id}`);
    const re = new RegExp(rule.pattern, "i"), ctx = rule.context ? new RegExp(rule.context, "i") : null;
    for (const [name, src] of files) {
      if (ctx && !ctx.test(src)) continue;
      const m = re.test(src);
      if (rule.kind === "forbidden" && m) hits.push({ id, name });
      if (rule.kind === "required" && !m) hits.push({ id, name });
    }
  }
  return { pass: hits.length === 0, ids: uniq(hits.map((h) => h.id)), detail: hits.length ? `${hits.length} violation(s)` : `${ruleIds.length} rules clean` };
}
async function gFix(dir, x) {
  const r = await cliJson(["fix", rel(dir), "--abap-version", "v758"]);
  const bad = new Set(x.lintFail ?? []);
  const fixed = (r.fixed ?? []).filter((f) => bad.has(f.rule));
  return { pass: fixed.length === 0, ids: uniq(fixed.map((f) => f.rule)), detail: fixed.length ? `${fixed.length} auto-fixable` : "nothing to fix", fixedCount: fixed.length };
}
// Apply `fix --write` to a scratch copy of the baseline and re-lint: proves the deterministic fixer alone converges.
async function autofixProof(dir, x) {
  const tmp = mkdtempSync(join(tmpdir(), "safe-agent-"));
  try {
    cpSync(dir, tmp, { recursive: true });
    await cli(["fix", tmp, "--write", "--abap-version", "v758"]);
    const f = await lintBlocking(tmp, x);
    return { ok: f.length === 0, left: f.length };
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}

async function runGate(g, dir, x) {
  if (g === "readiness") return gReadiness(dir, x);
  if (g === "lint") return gLint(dir, x);
  if (g === "rapcheck") return gRapcheck(dir);
  if (g === "unittest") return gUnit(dir);
  if (g === "policy") return gPolicy(dir, x.policy ?? policy.default);
  if (g === "fix") return gFix(dir, x);
  throw new Error(`unknown gate ${g}`);
}

// ---- per-task driver ---------------------------------------------------------------------
async function runTask(name) {
  const dir = join(TASKS, name);
  const x = JSON.parse(readFileSync(join(dir, "expect.json"), "utf8"));
  const b = join(dir, "baseline"), s = join(dir, "solution");
  const gates = [...x.gate.map((g) => ({ g, blind: false })), ...(x.blindGates ?? []).map((g) => ({ g, blind: true }))];
  const rows = await Promise.all(gates.map(async ({ g, blind }) => {
    const [bs, ss] = await Promise.all([runGate(g, b, x), runGate(g, s, x)]);
    const removed = bs.ids.filter((i) => !ss.ids.includes(i));
    return { task: name, gate: g, blind, baseline: bs, solution: ss, removed };
  }));
  // solutions must also honour the always-on safety-net policy
  const net = gPolicy(s, uniq([...(x.policy ?? []), ...policy.default]));
  const cmp = await cliJson(["compare", rel(b), rel(s)]);
  const compare = { resolved: cmp.resolved.length, introduced: cmp.introduced.length, blockers: [cmp.before.cloudBlockerCount, cmp.after.cloudBlockerCount], grade: [cmp.before.grade, cmp.after.grade] };
  const problems = [];
  for (const r of rows) {
    if (r.blind) { if (!r.baseline.pass) problems.push(`${r.gate}: expected blind spot but baseline failed`); }
    else if (x.baselineShouldFail && r.baseline.pass) problems.push(`${r.gate}: baseline unexpectedly PASSED`);
    if (!r.solution.pass) problems.push(`${r.gate}: solution FAILED (${r.solution.ids.join(",") || r.solution.detail})`);
  }
  if (!net.pass) problems.push(`safety-net policy: solution violates ${net.ids.join(",")}`);
  const seen = new Set(rows.filter((r) => !r.blind).flatMap((r) => r.baseline.ids));
  const missing = (x.expectedBlockers ?? []).filter((i) => !seen.has(i));
  if (missing.length) problems.push(`expected blockers not reported on baseline: ${missing.join(",")}`);
  let autofix = null;
  if (x.autofix) {
    autofix = await autofixProof(b, x);
    if (!autofix.ok) problems.push(`autofix left ${autofix.left} blocking finding(s)`);
  }
  return { task: name, notes: x.notes, rows, compare, autofix, problems };
}

// ---- render ------------------------------------------------------------------------------
const cell = (r, side) => {
  const v = r[side];
  if (r.blind && side === "baseline") return `PASS (blind) ${v.detail}`;
  return `${v.pass ? "PASS" : "FAIL"} ${v.detail}`;
};
const changed = (r) => (r.blind ? "no signal - static tools cannot see this bug" : r.removed.length ? `resolved ${r.removed.join(", ")}` : "-");
function table(head, body) {
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => String(c).padEnd(w[i])).join("  ");
  return [line(head), w.map((n) => "-".repeat(n)).join("  "), ...body.map(line)].join("\n");
}

if (args.includes("--scan")) { // live-demo helper: default forbidden set against whatever the agent just wrote
  const d = resolve(args[args.indexOf("--scan") + 1] ?? ".");
  const forbidden = policy.rules.filter((r) => r.kind === "forbidden").map((r) => r.id);
  const p = gPolicy(d, forbidden);
  console.log(p.pass ? `policy OK: ${d} violates none of ${forbidden.length} forbidden patterns` : `policy VIOLATIONS in ${d}: ${p.ids.join(", ")}`);
  process.exit(p.pass ? 0 : 1);
}
const t0 = Date.now();
let names = readdirSync(TASKS).filter((n) => statSync(join(TASKS, n)).isDirectory()).sort();
if (ONLY) names = names.filter((n) => n.startsWith(ONLY.padStart(2, "0")) || n.includes(ONLY));
if (!names.length) { console.error(`no task matches ${ONLY}`); process.exit(2); }

const results = [];
for (let i = 0; i < names.length; i += 4) results.push(...(await Promise.all(names.slice(i, i + 4).map(runTask))));

const head = ["task", "gate", "baseline (unassisted)", "solution (gated)", "what changed"];
const body = results.flatMap((t) => t.rows.map((r) => [t.task, r.gate, cell(r, "baseline"), cell(r, "solution"), changed(r)]));
const cmpHead = ["task", "compare: resolved", "introduced", "blockers", "grade"];
const cmpBody = results.map((t) => [t.task, t.compare.resolved, t.compare.introduced, t.compare.blockers.join(" -> "), t.compare.grade.join(" -> ")]);
const problems = results.flatMap((t) => t.problems.map((p) => `${t.task}: ${p}`));
const gated = results.flatMap((t) => t.rows.filter((r) => !r.blind));
const caught = gated.filter((r) => !r.baseline.pass).length, cleared = results.flatMap((t) => t.rows).filter((r) => r.solution.pass).length;
const secs = ((Date.now() - t0) / 1000).toFixed(1);
const summary = `${results.length} tasks · ${gated.length} gates: baseline caught ${caught}/${gated.length} · solution passes ${cleared}/${results.flatMap((t) => t.rows).length} · ${secs}s`;

console.log(`\nSafe-agent scorecard - "Can an AI agent safely change ABAP?" (all code synthetic: Northwind Bikes, ZNWB)\n`);
console.log(table(head, body));
console.log(`\n${table(cmpHead, cmpBody)}`);
for (const t of results) if (t.autofix) console.log(`\n${t.task}: abap-mcp fix on the baseline alone -> ${t.autofix.ok ? "0 blocking findings left" : t.autofix.left + " left"}`);
console.log(`\n${summary}`);
console.log(problems.length ? `\nFAILED:\n${problems.map((p) => "  - " + p).join("\n")}` : `\nOK: every baseline fails its gate, every solution passes.`);

if (WRITE_JSON) {
  writeFileSync(join(HERE, "report.json"), JSON.stringify({ generated: new Date().toISOString(), summary, results, problems }, null, 2));
  let md = `# Safe-agent report\n\n> Regenerate: \`node demo/safe-agent/run.mjs --json\`. All code is synthetic (Northwind Bikes, package ZNWB).\n\n**${summary}**\n\n`;
  md += `| ${head.join(" | ")} |\n|${head.map(() => "---").join("|")}|\n${body.map((r) => `| ${r.join(" | ")} |`).join("\n")}\n\n`;
  md += `## Compare (baseline vs solution)\n\n| ${cmpHead.join(" | ")} |\n|${cmpHead.map(() => "---").join("|")}|\n${cmpBody.map((r) => `| ${r.join(" | ")} |`).join("\n")}\n\n`;
  md += `## Why each bug matters\n\n${results.map((t) => `- **${t.task}** - ${t.notes}`).join("\n")}\n\n`;
  md += problems.length ? `## Problems\n\n${problems.map((p) => `- ${p}`).join("\n")}\n` : `**Result: OK** - every baseline fails its gate, every solution passes.\n`;
  writeFileSync(join(HERE, "report.md"), md);
  console.log(`wrote demo/safe-agent/report.json + report.md`);
}
process.exit(problems.length ? 1 : 0);
