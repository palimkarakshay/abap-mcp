#!/usr/bin/env node
/**
 * Offline host-routing regression eval.
 *
 * This intentionally does not call a model. It reads the exact tool/prompt
 * metadata exposed over MCP, runs a small host-like semantic/lexical router,
 * and fails when realistic intents stop selecting the expected capability.
 * The heuristic is not intended to impersonate ChatGPT or Codex; it is a
 * deterministic smoke test for metadata separability and honesty boundaries.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const CASES_PATH = join(HERE, "cases.json");
const REPORT_JSON = join(HERE, "report.json");
const REPORT_MD = join(HERE, "report.md");
const WRITE_REPORTS = process.argv.includes("--write");

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "before", "by", "can", "do", "does", "for", "from",
  "give", "have", "help", "i", "in", "into", "is", "it", "me", "my", "of", "on", "or", "our", "please",
  "that", "the", "their", "them", "these", "this", "to", "using", "want", "we", "what", "when", "where",
  "which", "with", "would", "you"
]);

// Small, capability-neutral vocabulary bridges. They map natural host queries
// to words already present in MCP names/descriptions; they never map a fixture
// id to a capability or bypass the exposed metadata.
const EXPANSIONS = new Map([
  ["lint", ["analysis", "findings", "rules", "correctness", "style"]],
  ["linter", ["lint", "analysis", "findings", "rules"]],
  ["pretty", ["format", "indentation", "case"]],
  ["print", ["format"]],
  ["boilerplate", ["scaffold", "generate", "artifacts"]],
  ["bootstrap", ["scaffold", "generate"]],
  ["coach", ["mentor", "teach", "guidance"]],
  ["teaching", ["mentor", "explain", "guidance"]],
  ["catalog", ["list", "rules", "available"]],
  ["available", ["list", "discover"]],
  ["rationale", ["explain", "why", "rule"]],
  ["structure", ["outline", "classes", "methods", "forms"]],
  ["diagram", ["outline", "mermaid", "structure"]],
  ["refactor", ["compare", "before", "after", "rework"]],
  ["regression", ["compare", "introduced", "findings"]],
  ["compliant", ["readiness", "ready", "cloud"]],
  ["successor", ["released", "api", "replacement"]],
  ["allowlist", ["released", "api", "state"]],
  ["backlog", ["plan", "migration", "phases", "work", "items"]],
  ["engagement", ["workflow", "consultant", "plan"]],
  ["workflow", ["procedure", "guided", "session"]]
]);

const DOMAIN_TERMS = new Set([
  "abap", "abaplint", "adt", "atc", "bapi", "bdef", "cds", "clean", "core", "dynpro", "fiori", "mara",
  "kna1", "rap", "released", "s4hana", "sap", "steampunk", "transaction"
]);

// Requests the server explicitly cannot perform. A host should abstain instead
// of choosing a tool merely because a non-goal sentence happens to share words.
const UNSUPPORTED = [
  { reason: "live SAP connection", re: /\b(connect|log\s*in|sign\s*in)\b.{0,45}\b(live|sap|s\/4|s4hana|system)\b/i },
  { reason: "run ATC in a system", re: /\b(run|execute|trigger)\b.{0,30}\batc\b/i },
  { reason: "runtime debugging", re: /\b(debug|trace)\b.{0,45}\b(runtime|transaction|update task|sap)\b/i },
  { reason: "activate or publish in SAP", re: /\b(activate|publish|deploy|transport|import)\b.{0,60}\b(adt|artifact|binding|sap|system)\b/i },
  { reason: "read live SAP data", re: /\b(read|query|export|download)\b.{0,50}\b(production|live|current)\b.{0,40}\b(table|rows|data|sap)\b/i },
  { reason: "execute ABAP in SAP", re: /\b(execute|run)\b.{0,35}\babap\b.{0,45}\b(sap|system|business input)\b/i },
  { reason: "network refresh", re: /\b(fetch|download|refresh|look up)\b.{0,55}\b(today|latest|online|internet|authoritative)\b/i }
];

function normalizeToken(raw) {
  let t = raw.toLowerCase();
  if (t.length > 5 && t.endsWith("ies")) t = `${t.slice(0, -3)}y`;
  else if (t.length > 5 && t.endsWith("ing")) t = t.slice(0, -3);
  else if (t.length > 4 && t.endsWith("ed")) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) t = t.slice(0, -1);
  return t;
}

function tokenize(text) {
  return (text.toLowerCase().replace(/[_/\-]+/g, " ").match(/[a-z0-9]+/g) ?? [])
    .map(normalizeToken)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

function queryTerms(text) {
  const base = tokenize(text);
  const weighted = new Map();
  const add = (token, weight) => weighted.set(token, Math.max(weighted.get(token) ?? 0, weight));
  for (const token of base) {
    add(token, 1);
    for (const synonym of EXPANSIONS.get(token) ?? []) add(normalizeToken(synonym), 0.72);
  }
  return weighted;
}

function splitMetadata(description) {
  const sentences = description.split(/(?<=[.!?])\s+/);
  const negative = [];
  const positive = [];
  for (const sentence of sentences) {
    (/\b(does not|do not|cannot|can't|not a|no SAP system|out of scope|never)\b/i.test(sentence)
      ? negative
      : positive).push(sentence);
  }
  return { positive: positive.join(" "), negative: negative.join(" ") };
}

function termWeights(card) {
  const weights = new Map();
  const addText = (text, weight) => {
    for (const token of tokenize(text)) weights.set(token, Math.max(weights.get(token) ?? 0, weight));
  };
  const split = splitMetadata(card.description);
  addText(card.name, 4.2);
  addText(card.title, 3.2);
  addText(split.positive, 1);
  return { positive: weights, negative: new Set(tokenize(split.negative)) };
}

function promptCue(text) {
  return /\b(for the rest of (this|our) session|mentor|coach|one concept at a time|act as (the|a)|lead consultant|senior consultant|end-to-end .{0,20}workflow|guided workflow|offer to execute)\b/i.test(text);
}

function directToolCue(text) {
  return /\b(run|check|list|show|format|pretty-print|create|generate|compare|structured output|now|one rule|bundled snapshot)\b/i.test(text);
}

function unsupportedReason(intent) {
  // "without connecting/running ..." states the desired offline boundary and
  // must not be mistaken for an instruction to perform the forbidden action.
  const scrubbed = intent.replace(/\b(without|do not|don't|not)\b.{0,55}\b(connect(?:ing)?|run(?:ning)?|execut(?:e|ing)|fetch(?:ing)?)\b[^,.;]*/gi, " ");
  return UNSUPPORTED.find((rule) => rule.re.test(scrubbed))?.reason;
}

function scoreCard(card, intent, terms) {
  const metadata = termWeights(card);
  let score = 0;
  const matched = [];
  for (const [term, queryWeight] of terms) {
    const metadataWeight = metadata.positive.get(term);
    if (metadataWeight !== undefined) {
      score += queryWeight * metadataWeight;
      matched.push(term);
    }
    if (metadata.negative.has(term)) score -= queryWeight * 0.8;
  }

  const normalizedIntent = ` ${tokenize(intent).join(" ")} `;
  const normalizedName = tokenize(card.name).join(" ");
  const normalizedTitle = tokenize(card.title).join(" ");
  if (normalizedName.length > 2 && normalizedIntent.includes(` ${normalizedName} `)) score += 8;
  if (normalizedTitle.length > 2 && normalizedIntent.includes(` ${normalizedTitle} `)) score += 6;

  const wantsPrompt = promptCue(intent);
  const wantsTool = directToolCue(intent);
  if (wantsPrompt) score += card.kind === "prompt" ? 5.5 : -1.5;
  if (wantsTool && !wantsPrompt) score += card.kind === "tool" ? 1.5 : -0.5;

  // Reward coverage of distinct user concepts, so one repeated generic term
  // cannot beat a card matching the full intent.
  score += Math.min(new Set(matched).size, 8) * 0.3;
  return { score: +score.toFixed(3), matched: [...new Set(matched)].sort() };
}

function route(cards, intent) {
  const unsupported = unsupportedReason(intent);
  if (unsupported !== undefined) return { selected: null, reason: unsupported, ranking: [] };

  const baseTokens = tokenize(intent);
  const inDomain = baseTokens.some((token) => DOMAIN_TERMS.has(token));
  if (!inDomain) return { selected: null, reason: "outside ABAP/SAP domain", ranking: [] };

  const terms = queryTerms(intent);
  const ranking = cards
    .map((card) => ({ kind: card.kind, name: card.name, ...scoreCard(card, intent, terms) }))
    .sort((a, b) => b.score - a.score || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
  const top = ranking[0];
  const runnerUp = ranking[1];
  const threshold = promptCue(intent) ? 6 : 7;
  if (top === undefined || top.score < threshold) {
    return { selected: null, reason: `low metadata confidence (${top?.score ?? 0} < ${threshold})`, ranking: ranking.slice(0, 5) };
  }
  return {
    selected: { kind: top.kind, name: top.name },
    reason: `top metadata score ${top.score}; margin ${+(top.score - (runnerUp?.score ?? 0)).toFixed(3)}`,
    ranking: ranking.slice(0, 5)
  };
}

async function exposedCapabilities() {
  let buildServer;
  try {
    ({ buildServer } = await import("../../dist/server.js"));
  } catch (error) {
    throw new Error(`Cannot load dist/server.js. Run \"npm run build\" first. (${error.message})`);
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  const client = new Client({ name: "abap-mcp-routing-eval", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const [{ tools }, { prompts }] = await Promise.all([client.listTools(), client.listPrompts()]);
    return [
      ...tools.map((item) => ({
        kind: "tool",
        name: item.name,
        title: item.title ?? item.name,
        description: item.description ?? ""
      })),
      ...prompts.map((item) => ({
        kind: "prompt",
        name: item.name,
        title: item.title ?? item.name,
        description: item.description ?? ""
      }))
    ];
  } finally {
    await client.close();
    await server.close();
  }
}

const cases = JSON.parse(readFileSync(CASES_PATH, "utf8"));
const cards = await exposedCapabilities();
const rows = cases.map((testCase) => {
  const actual = route(cards, testCase.intent);
  const passed = testCase.expected.kind === "none"
    ? actual.selected === null
    : actual.selected?.kind === testCase.expected.kind && actual.selected?.name === testCase.expected.name;
  return { ...testCase, actual, passed };
});

const expectedTargets = new Set(
  cases.filter((testCase) => testCase.expected.kind !== "none")
    .map((testCase) => `${testCase.expected.kind}:${testCase.expected.name}`)
);
const uncovered = cards
  .map((card) => `${card.kind}:${card.name}`)
  .filter((key) => !expectedTargets.has(key));
const unknownTargets = [...expectedTargets].filter((key) => !cards.some((card) => `${card.kind}:${card.name}` === key));
const failures = rows.filter((row) => !row.passed);
const negativeRows = rows.filter((row) => row.expected.kind === "none");
const summary = {
  passed: failures.length === 0 && uncovered.length === 0 && unknownTargets.length === 0,
  cases: rows.length,
  passingCases: rows.length - failures.length,
  failingCases: failures.length,
  toolCount: cards.filter((card) => card.kind === "tool").length,
  promptCount: cards.filter((card) => card.kind === "prompt").length,
  abstentionCases: negativeRows.length,
  correctAbstentions: negativeRows.filter((row) => row.passed).length,
  uncoveredCapabilities: uncovered,
  unknownFixtureTargets: unknownTargets
};

if (WRITE_REPORTS) {
  writeFileSync(REPORT_JSON, `${JSON.stringify({ generatedAt: new Date().toISOString(), mode: "offline-metadata", summary, capabilities: cards, rows }, null, 2)}\n`);
}

const selectedLabel = (selected) => selected === null ? "none" : `${selected.kind}:${selected.name}`;
let markdown = "# abap-mcp host-routing eval report\n\n";
markdown += `**Mode:** offline metadata · **Result:** ${summary.passed ? "PASS" : "FAIL"} · `;
markdown += `**Cases:** ${summary.passingCases}/${summary.cases} · **Surface:** ${summary.toolCount} tools + ${summary.promptCount} prompts\n\n`;
markdown += "This deterministic smoke test ranks the exact descriptions exposed by MCP. It makes no model or network calls.\n\n";
markdown += "| Case | Expected | Selected | Result | Reason |\n|---|---|---|---|---|\n";
for (const row of rows) {
  const expected = row.expected.kind === "none" ? "none" : `${row.expected.kind}:${row.expected.name}`;
  markdown += `| ${row.id} | ${expected} | ${selectedLabel(row.actual.selected)} | ${row.passed ? "PASS" : "**FAIL**"} | ${row.actual.reason} |\n`;
}
markdown += "\n## Coverage checks\n\n";
markdown += `- Uncovered exposed capabilities: ${uncovered.length === 0 ? "none" : uncovered.join(", ")}\n`;
markdown += `- Fixture targets missing from MCP: ${unknownTargets.length === 0 ? "none" : unknownTargets.join(", ")}\n`;
markdown += `- Unsupported-request abstentions: ${summary.correctAbstentions}/${summary.abstentionCases}\n`;
if (failures.length > 0) {
  markdown += "\n## Failed rankings\n\n";
  for (const row of failures) {
    markdown += `### ${row.id}\n\n\`${row.intent}\`\n\n`;
    markdown += "```json\n" + JSON.stringify(row.actual.ranking, null, 2) + "\n```\n\n";
  }
}
if (WRITE_REPORTS) writeFileSync(REPORT_MD, markdown);

console.log(`[routing-eval] ${summary.passed ? "PASS" : "FAIL"}: ${summary.passingCases}/${summary.cases} cases; ${summary.toolCount} tools + ${summary.promptCount} prompts; abstentions ${summary.correctAbstentions}/${summary.abstentionCases}`);
if (WRITE_REPORTS) console.log("[routing-eval] wrote evals/routing/report.json + evals/routing/report.md");
if (!summary.passed) {
  for (const row of failures) {
    console.error(`[routing-eval] ${row.id}: expected ${row.expected.kind}:${row.expected.name ?? "none"}, got ${selectedLabel(row.actual.selected)}`);
  }
  if (uncovered.length > 0) console.error(`[routing-eval] uncovered: ${uncovered.join(", ")}`);
  if (unknownTargets.length > 0) console.error(`[routing-eval] unknown fixture targets: ${unknownTargets.join(", ")}`);
  process.exitCode = 1;
}
