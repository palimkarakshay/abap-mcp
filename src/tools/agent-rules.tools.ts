/**
 * get_abap_agent_rules — emit the AGENTS.md / CLAUDE.md block for an ABAP repo.
 *
 * SAP now ships an AGENTS.md template with its official ADT MCP server; this
 * tool produces the offline-verification counterpart: the rules a coding agent
 * should follow when abap-mcp is connected (lint before commit, readiness
 * gate, the unit-test loop, pairing with the online servers). Pure text
 * generation — no filesystem, no network.
 */
import { z } from "zod";

import { defineTool } from "../tool.js";

export interface AgentRulesOptions {
  target: "Cloud" | "classic";
  pairedWith: ("sap-adt-mcp" | "abap-adt-mcp" | "none")[];
  runEnabled: boolean;
  packagePrefix: string;
  edition: "s4hc" | "btp" | "pce";
}

export function buildAgentRules(o: AgentRulesOptions): string {
  const cloud = o.target === "Cloud";
  const paired = o.pairedWith.filter((p) => p !== "none");
  const lines: string[] = [];
  lines.push("## ABAP rules for coding agents (abap-mcp)");
  lines.push("");
  lines.push(
    `- **Target:** ${cloud ? "ABAP Cloud (ABAP for Cloud Development) — released APIs only, RAP for transactional apps, classes only (no reports, dynpros, FORMs)." : "classic ABAP (on-prem baseline) — still prefer modern syntax; run check_cloud_readiness to see the migration distance."}`,
  );
  lines.push(`- **Naming:** customer objects start with \`${o.packagePrefix}\`; abapGit file names (\`zcl_x.clas.abap\`, \`zi_x.ddls.asddls\`, \`zi_x.bdef.asbdef\`).`);
  lines.push("- **Never deliver code you have not linted.** Run `fix_abap` (mechanical fixes) then `lint_abap` at the target level on every file you write or change; a file is done when findings are zero or consciously waived with a reason.");
  if (cloud) {
    lines.push(
      `- **Readiness gate:** \`check_cloud_readiness\` must return grade A (blocker-density band, not SAP's Clean Core Level) before a commit; released-API observations use the bundled SAP snapshot for edition \`${o.edition}\` — the target system's ATC ("Usage of APIs (Cloudification Repository)", variant ABAP_CLEAN_CORE_DEVELOPMENT) remains authoritative.`,
    );
    lines.push("- **Released APIs:** before using any SAP table/CDS view/class/function, call `check_released_api`; use the successor it names, never a classic table (MARA → I_Product, KNA1 → I_Customer …).");
  }
  lines.push("- **New objects start from validated scaffolds:** `scaffold_rap_bo` for a RAP business object, `scaffold_abap_unit` for a failing-by-default test harness, `scaffold_abap_ai_sdk` for a Generative AI Hub call through the ABAP AI SDK. Hand-written boilerplate is a bug.");
  lines.push("- **2025+ features:** do not guess syntax or availability — ask `explain_abap_release` / `search_sap_knowledge` (bundled, dated SAP release deltas with sources) and quote the minimum release in your plan.");
  if (o.runEnabled) {
    lines.push("- **Test loop:** write the ABAP Unit test first, then `run_abap_unit` (offline, transpiled to Node) until it is green; treat the result as evidence for pure logic only — no database, CDS, EML or authority checks are exercised.");
  } else {
    lines.push("- **Test loop:** generate tests with `scaffold_abap_unit`; run them in the SAP system (ADT / the online MCP server). Enable `ABAP_MCP_ENABLE_RUN=1` (or `abap-mcp unittest --run`) to execute pure-logic tests offline.");
  }
  lines.push("- **Prove rework:** after a refactor run `compare_abap` before-vs-after; the readiness grade may not regress.");
  if (paired.length > 0) {
    const names = paired
      .map((p) => (p === "sap-adt-mcp" ? "SAP's official ADT MCP server (`abap_creation-*`, `abap_activate_objects`, `abap_run_unit_tests`, `abap_run_atc`)" : "`abap-adt-mcp` (`setObjectSource`, `activateByName`, `unitTestRun`, `createAtcRun`)"))
      .join(" and ");
    lines.push(`- **Division of labour:** abap-mcp verifies offline (lint, readiness, scaffolds, unit loop); ${names} writes, activates and tests in the system. Never activate code that has not passed the offline gates; after activation, read the ATC/ABAP Unit results back and fix before moving on.`);
  } else {
    lines.push("- **System hand-off:** abap-mcp has no SAP connection. Deliver files in activation order with the assumptions register; ADT activation, ATC and a real ABAP Unit run remain the final arbiters.");
  }
  lines.push("- **Honesty:** behavior/service definitions are template-validated (abaplint does not parse them); say so when it matters. Bundled SAP data is snapshot-dated; quote the date.");
  return lines.join("\n");
}

export const getAbapAgentRules = defineTool({
  name: "get_abap_agent_rules",
  title: "Get the AGENTS.md rules block for an ABAP repo",
  description:
    "Generate the ABAP section of a repository's AGENTS.md / CLAUDE.md: the lint-before-commit rule, the ABAP Cloud " +
    "readiness gate, released-API discipline, scaffold-first, the offline unit-test loop, and the division of labour " +
    "with an online ADT MCP server. Use this when you set up a new ABAP repo for agentic development or want a " +
    "team's coding-agent rules to reference the abap-mcp tools consistently. It does not write the file (paste the " +
    "returned markdown yourself), does not read the workspace, and is not a substitute for the project's own " +
    "conventions — it encodes the tool contract, nothing project-specific beyond the parameters you pass. " +
    'Example: { "target": "Cloud", "pairedWith": ["sap-adt-mcp"], "runEnabled": true }.',
  inputSchema: {
    target: z
      .enum(["Cloud", "classic"])
      .default("Cloud")
      .describe('"Cloud" (default) for ABAP Cloud / Steampunk repos, "classic" for on-prem baselines that still migrate.'),
    pairedWith: z
      .array(z.enum(["sap-adt-mcp", "abap-adt-mcp", "none"]))
      .default(["none"])
      .describe('Online ADT MCP servers the agent can also use: "sap-adt-mcp" (SAP official, ships with ADT), "abap-adt-mcp" (community), or "none".'),
    runEnabled: z
      .boolean()
      .default(false)
      .describe("True when run_abap_unit is enabled (ABAP_MCP_ENABLE_RUN=1) so the rules prescribe the offline test loop."),
    packagePrefix: z
      .string()
      .default("Z")
      .describe('Customer namespace/prefix for new objects, e.g. "Z", "Y" or "/ACME/".'),
    edition: z
      .enum(["s4hc", "btp", "pce"])
      .default("s4hc")
      .describe('Released-API edition the readiness gate should quote: "s4hc" (S/4HANA Cloud Public Edition), "btp" (BTP ABAP Environment), "pce" (Private Cloud Edition).'),
  },
  outputSchema: {
    markdown: z.string().describe("The AGENTS.md section, ready to paste."),
    ruleCount: z.number().describe("Number of rules emitted."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Rules for an ABAP Cloud repo where SAP's official ADT MCP server does the activation.",
      arguments: { target: "Cloud", pairedWith: ["sap-adt-mcp"], runEnabled: true },
    },
    {
      description: "Rules for a classic on-prem repo with no online server.",
      arguments: { target: "classic", pairedWith: ["none"], packagePrefix: "Y" },
    },
  ],
  handler: (args) => {
    const markdown = buildAgentRules({
      target: args.target,
      pairedWith: args.pairedWith,
      runEnabled: args.runEnabled,
      packagePrefix: args.packagePrefix,
      edition: args.edition,
    });
    const ruleCount = markdown.split("\n").filter((l) => l.startsWith("- ")).length;
    return {
      content: [{ type: "text", text: markdown }],
      structuredContent: { markdown, ruleCount },
    };
  },
});

export const AGENT_RULES_TOOLS = [getAbapAgentRules] as const;
