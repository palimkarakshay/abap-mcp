import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { ALL_TOOLS } from "./abap.tools.js";
import { ALL_PROMPTS, registerPrompts } from "./prompts.js";
import { registerTools } from "./tool.js";

export const SERVER_NAME = "abap-mcp";
export const SERVER_VERSION = "0.5.0";

/** Build a fully-wired MCP server instance (one per transport connection). */
export function buildServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerTools(server, ALL_TOOLS);
  registerPrompts(server, ALL_PROMPTS);
  return server;
}
