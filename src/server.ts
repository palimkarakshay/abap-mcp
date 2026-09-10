import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ALL_TOOLS } from "./abap.tools.js";
import { ALL_PROMPTS, registerPrompts } from "./prompts.js";
import { registerKnowledgeResources } from "./resources.js";
import { registerTools } from "./tool.js";
import type { AnyToolSpec } from "./tool.js";
import { RUN_TOOLS } from "./tools/run.tools.js";

export const SERVER_NAME = "abap-mcp";
export const SERVER_VERSION = "0.11.0";
export const SERVER_INSTRUCTIONS =
  "Use abap-mcp for offline analysis of ABAP source text. Start general reviews with lint_abap; for ABAP Cloud or Clean Core questions use check_cloud_readiness, then plan_cloud_migration when the user wants an actionable backlog. The tools cannot read workspace files: the client must pass source text — for whole-repo sweeps prefer the bundled CLI (npx abap-mcp readiness src/) through your shell instead of passing dozens of files through tool calls. " +
  "Before designing around any ABAP Cloud or RAP feature from 2025 onward, ask explain_abap_release (bundled, dated release deltas with sources) and search_sap_knowledge (Clean Core levels, ATC variants, SAP-ABAP-1, Generative AI Hub, the ABAP AI SDK, SAP's official ADT MCP server) instead of guessing; the same knowledge is readable as abap-mcp://knowledge/… resources. " +
  "Use check_released_api for explicit SAP object release-state lookups (pass the edition: s4hc, btp or pce), scaffold_rap_bo for a new managed RAP BO, scaffold_abap_unit for a failing-by-default test harness on an existing class, scaffold_abap_ai_sdk for an ABAP class that calls the Generative AI Hub through the ABAP AI SDK, get_abap_agent_rules for the AGENTS.md block of an ABAP repo, get_object_dependencies to sequence migration work or read impact, fix_abap to apply abaplint's deterministic auto-fixes (the mechanical first pass before any hand or model rewrite), and compare_abap to verify a rewrite. " +
  "When run_abap_unit is present (opt-in via ABAP_MCP_ENABLE_RUN=1) use it to execute ABAP Unit tests offline and iterate until green — it runs transpiled code on the open-abap kernel, so it proves pure logic only. " +
  "They do not connect to SAP or run ATC. Released-API observations come from a dated bundled snapshot, so the target system remains authoritative; pair abap-mcp with SAP's official ADT MCP server or abap-adt-mcp for in-system activation, ATC and unit runs. Use the packaged prompts for guided review, mentoring, migration, and spec-to-code workflows.";

/** True when the caller opted in to the code-executing tool for this process. */
export function runToolsEnabled(): boolean {
  return process.env["ABAP_MCP_ENABLE_RUN"] === "1";
}

/** The tool inventory this process exposes: the offline core plus the opt-in runner. */
export function serverTools(): readonly AnyToolSpec[] {
  return runToolsEnabled() ? [...ALL_TOOLS, ...RUN_TOOLS] : ALL_TOOLS;
}

/** Build a fully-wired MCP server instance (one per transport connection). */
export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, serverTools());
  registerPrompts(server, ALL_PROMPTS);
  registerKnowledgeResources(server);
  return server;
}
