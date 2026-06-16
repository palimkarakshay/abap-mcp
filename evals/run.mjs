#!/usr/bin/env node
// abap-mcp eval harness — measures how reliably an LLM assesses ABAP Cloud readiness,
// anchored against abap-mcp's DETERMINISTIC readiness oracle (the ground truth).
//
//   pipeline:  ABAP source ──► [oracle]  abap-mcp readiness --json   (deterministic ground truth)
//                          └─► [agent]   LLM assesses readiness from source alone  (system under test)
//                          └─► [judge]   LLM-as-judge scores the agent's answer    (no oracle access)
//
//   metrics:   cloud-ready accuracy · grade accuracy · category precision/recall ·
//              judge↔oracle agreement (Cohen's κ) · failure taxonomy · judge-reliability
//
//   modes:     EVAL_MODE=stub (default — replays fixtures, offline, deterministic, CI-safe)
//              EVAL_MODE=live (calls an OpenAI-compatible model: EVAL_BASE_URL/EVAL_API_KEY/EVAL_MODEL)
//
// Run:  node evals/run.mjs        (from repo root)
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const CASES_DIR = join(HERE, "cases");
const MODE = process.env.EVAL_MODE ?? "stub";

// Issue vocabulary we score on (the "other" residual bucket is intentionally NOT scored —
// it's a catch-all an assessor wouldn't reasonably name).
const MEANINGFUL = ["native-sql", "list-output", "dynpro", "report-program", "report-events", "non-released-api"];

// ---- oracle: the deterministic ground truth from abap-mcp itself ----------------------
function oracle(absFile) {
  const out = execFileSync("node", ["dist/cli.js", "readiness", absFile, "--json"], { cwd: ROOT }).toString();
  const r = JSON.parse(out);
  const cats = (r.categories ?? []).map((c) => c.category).filter((c) => MEANINGFUL.includes(c));
  return { cloudReady: r.verdict === "ready", verdict: r.verdict, grade: r.grade, score: r.score, categories: [...new Set(cats)] };
}

// ---- agent under test + LLM-as-judge (stub replays fixtures; live calls a model) -------
const agentStub = JSON.parse(readFileSync(join(HERE, "fixtures", "agent.stub.json")));
const judgeStub = JSON.parse(readFileSync(join(HERE, "fixtures", "judge.stub.json")));

async function callModel(prompt) {
  const base = process.env.EVAL_BASE_URL, key = process.env.EVAL_API_KEY, model = process.env.EVAL_MODEL;
  if (!base || !key || !model) throw new Error("live mode needs EVAL_BASE_URL / EVAL_API_KEY / EVAL_MODEL");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "";
}
function jsonFrom(text) { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}; }

async function agent(id, source) {
  if (MODE === "stub") return agentStub[id];
  const out = await callModel(
    `You are an SAP ABAP Cloud-readiness reviewer. Given the ABAP source, decide if it is ABAP Cloud ready.\n` +
    `Reply ONLY JSON: {"cloudReady":bool,"grade":"A|B|C|D","issues":[<any of ${MEANINGFUL.join(",")}>],"explanation":str}\n\nSOURCE:\n${source}`);
  return jsonFrom(out);
}
async function judge(id, source, ans) {
  if (MODE === "stub") return judgeStub[id];
  const out = await callModel(
    `You grade an ABAP Cloud-readiness assessment against this rubric (you do NOT have the ground truth):\n` +
    `PASS only if: the cloudReady verdict is defensible, every named issue is actually present in the source, and no real ` +
    `Cloud-incompatible statement is missed. Reply ONLY JSON: {"pass":bool,"reason":str}\n\nSOURCE:\n${source}\n\nASSESSMENT:\n${JSON.stringify(ans)}`);
  return jsonFrom(out);
}

// ---- metrics --------------------------------------------------------------------------
function kappa(pairs) {
  const n = pairs.length; if (!n) return 0;
  let agree = 0, jp = 0, ac = 0;
  for (const [j, a] of pairs) { if (j === a) agree++; if (j) jp++; if (a) ac++; }
  const po = agree / n, pPass = jp / n, pCorrect = ac / n;
  const pe = pPass * pCorrect + (1 - pPass) * (1 - pCorrect);
  return pe === 1 ? 0 : +((po - pe) / (1 - pe)).toFixed(3);
}

// ---- run ------------------------------------------------------------------------------
const manifest = JSON.parse(readFileSync(join(CASES_DIR, "manifest.json")));
const rows = [];
const tax = {};
const bump = (t) => (tax[t] = (tax[t] ?? 0) + 1);

for (const c of manifest) {
  const abs = join(CASES_DIR, c.file);
  const source = readFileSync(abs, "utf8");
  const o = oracle(abs);
  const a = await agent(c.id, source);
  const j = await judge(c.id, source, a);

  const truth = new Set(o.categories);
  const pred = new Set((a.issues ?? []).filter((x) => MEANINGFUL.includes(x)));
  let tp = 0, fp = 0, fn = 0;
  for (const p of pred) (truth.has(p) ? tp++ : fp++);
  for (const t of truth) if (!pred.has(t)) fn++;

  const cloudReadyMatch = a.cloudReady === o.cloudReady;
  const gradeMatch = a.grade === o.grade;
  const agentCorrect = cloudReadyMatch && fp === 0 && fn === 0;

  const tags = [];
  if (!cloudReadyMatch) tags.push("wrong-cloud-ready");
  if (!gradeMatch) tags.push("wrong-grade");
  if (fn > 0) tags.push("missed-category");
  if (fp > 0) tags.push("hallucinated-category");
  if (j.pass && !agentCorrect) tags.push("judge-false-accept");
  if (!j.pass && agentCorrect) tags.push("judge-false-reject");
  tags.forEach(bump);

  rows.push({ id: c.id, pattern: c.pattern, oracle: o, agent: a, judge: j, tp, fp, fn, cloudReadyMatch, gradeMatch, agentCorrect, tags });
}

const n = rows.length;
const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
const TP = sum((r) => r.tp), FP = sum((r) => r.fp), FN = sum((r) => r.fn);
const metrics = {
  cases: n,
  cloudReadyAccuracy: +(sum((r) => r.cloudReadyMatch) / n).toFixed(3),
  gradeAccuracy: +(sum((r) => r.gradeMatch) / n).toFixed(3),
  agentObjectiveAccuracy: +(sum((r) => r.agentCorrect) / n).toFixed(3),
  categoryPrecision: +(TP / (TP + FP || 1)).toFixed(3),
  categoryRecall: +(TP / (TP + FN || 1)).toFixed(3),
  judgeRawAgreement: +(sum((r) => r.judge.pass === r.agentCorrect) / n).toFixed(3),
  judgeKappaVsOracle: kappa(rows.map((r) => [!!r.judge.pass, r.agentCorrect])),
  failureTaxonomy: tax,
};
const unreliable = rows.filter((r) => r.tags.includes("judge-false-accept") || r.tags.includes("judge-false-reject"));

writeFileSync(join(HERE, "report.json"), JSON.stringify({ mode: MODE, metrics, rows }, null, 2));

// ---- markdown report ------------------------------------------------------------------
const pct = (x) => `${(x * 100).toFixed(0)}%`;
let md = `# abap-mcp eval report\n\n`;
md += `**Mode:** \`${MODE}\` · **Cases:** ${n} · Oracle = abap-mcp deterministic readiness · Agent + Judge = LLM.\n\n`;
md += `> Regenerate: \`node evals/run.mjs\` (set \`EVAL_MODE=live\` + EVAL_* env to run against a real model).\n\n`;
md += `## Headline metrics\n\n| Metric | Value | Reads as |\n|---|---|---|\n`;
md += `| Cloud-ready accuracy | ${pct(metrics.cloudReadyAccuracy)} | LLM's ready/not-ready vs oracle |\n`;
md += `| Grade accuracy (A–D) | ${pct(metrics.gradeAccuracy)} | exact-grade match vs oracle |\n`;
md += `| Category recall | ${pct(metrics.categoryRecall)} | real Cloud blockers the LLM caught |\n`;
md += `| Category precision | ${pct(metrics.categoryPrecision)} | named blockers that were real (no hallucination) |\n`;
md += `| Agent objective-correct | ${pct(metrics.agentObjectiveAccuracy)} | perfect cases (right verdict + every category, none invented) |\n`;
md += `| **Judge↔oracle Cohen's κ** | **${metrics.judgeKappaVsOracle}** | agreement beyond chance — **the number that matters** |\n`;
md += `| Judge raw agreement | ${pct(metrics.judgeRawAgreement)} | raw % (misleading on its own — see κ) |\n\n`;
md += `## Failure taxonomy\n\n`;
md += Object.keys(tax).length ? Object.entries(tax).map(([t, c]) => `- \`${t}\` × ${c}`).join("\n") : "_none_";
md += `\n\n## Per-case\n\n| Case | Pattern | Oracle (grade/verdict) | Agent grade | Caught | Judge | Tags |\n|---|---|---|---|---|---|---|\n`;
for (const r of rows) {
  md += `| ${r.id} | ${r.pattern} | ${r.oracle.grade} / ${r.oracle.verdict} | ${r.agent.grade} | ${r.tp}/${r.tp + r.fn} | ${r.judge.pass ? "PASS" : "fail"} | ${r.tags.join(", ") || "—"} |\n`;
}
md += `\n## Where the LLM-judge is unreliable (the point of this harness)\n\n`;
if (unreliable.length) {
  for (const r of unreliable) {
    const kind = r.tags.includes("judge-false-accept") ? "FALSE-ACCEPT" : "FALSE-REJECT";
    md += `- **${r.id} — ${kind}:** judge said \`${r.judge.pass ? "PASS" : "fail"}\` but the agent was \`${r.agentCorrect ? "correct" : "wrong"}\` vs the oracle`;
    if (r.fn > 0) md += ` (missed ${r.fn} real Cloud blocker(s) — e.g. an unmigrated statement the judge let through)`;
    md += `. _Judge reason:_ "${r.judge.reason ?? ""}"\n`;
  }
} else md += "_No judge disagreements in this run._\n";
md += `\n**Takeaway:** raw judge agreement (${pct(metrics.judgeRawAgreement)}) hides the risk — Cohen's κ = **${metrics.judgeKappaVsOracle}** shows the LLM-judge adds little signal beyond "always pass" and even green-lit code that still contains a real Cloud blocker. **Gate on the deterministic abap-mcp oracle; use the LLM only to explain, never as the sole arbiter.** (N=${n} is illustrative — the method, not the absolute number, is the deliverable.)\n`;

writeFileSync(join(HERE, "report.md"), md);
console.log(`[eval] mode=${MODE} cases=${n} κ=${metrics.judgeKappaVsOracle} grade-acc=${pct(metrics.gradeAccuracy)} recall=${pct(metrics.categoryRecall)}`);
console.log(`[eval] wrote evals/report.md + evals/report.json`);
