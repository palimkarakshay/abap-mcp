#!/usr/bin/env node
/**
 * stdio entry point. stdout is the JSON-RPC channel — anything human-facing
 * goes to stderr, or the protocol stream corrupts (mcp-kit invariant).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

async function main(): Promise<void> {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
  console.error(`${SERVER_NAME} v${SERVER_VERSION} ready on stdio (offline; no SAP system required)`);
}

main().catch((err) => {
  console.error("fatal:", err);
  process.exit(1);
});
