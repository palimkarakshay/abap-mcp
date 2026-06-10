#!/usr/bin/env node
/**
 * Entry point. With a subcommand it acts as a local CLI; with none it starts
 * the MCP server on stdio (back-compatible with `claude mcp add abap-mcp`).
 * stdout is the JSON-RPC channel in server mode — banner goes to stderr.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { runCli } from "./cli-commands.js";
import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const code = runCli(process.argv.slice(2), {
    out: (s) => console.log(s),
    err: (s) => console.error(s),
  });
  if (code !== null) {
    process.exit(code);
  }
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio (offline; no SAP system required)`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
