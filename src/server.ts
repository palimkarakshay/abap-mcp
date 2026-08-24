import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ALL_TOOLS } from "./abap.tools.js";
import { ALL_PROMPTS, registerPrompts } from "./prompts.js";
import { registerTools } from "./tool.js";

export const SERVER_NAME = "abap-mcp";
export const SERVER_VERSION = "0.6.0";
export const SERVER_INSTRUCTIONS =
  "Use abap-mcp for offline analysis of ABAP source text. Start general reviews with lint_abap; for ABAP Cloud or Clean Core questions use check_cloud_readiness, then plan_cloud_migration when the user wants an actionable backlog. Use check_released_api for explicit SAP object release-state lookups, scaffold_rap_bo for a new managed RAP BO, and compare_abap to verify a rewrite. The tools cannot read workspace files: the client must pass source text. They do not connect to SAP or run ATC. Released-API observations come from a dated bundled snapshot, so the target system remains authoritative. Use the packaged prompts for guided review, mentoring, and migration workflows.";

/** Build a fully-wired MCP server instance (one per transport connection). */
export function buildServer(): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  registerTools(server, ALL_TOOLS);
  registerPrompts(server, ALL_PROMPTS);
  return server;
}
