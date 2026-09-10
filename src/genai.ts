#!/usr/bin/env node
/**
 * Entry point for **abap-mcp-genai** — the online, OPT-IN companion to the offline abap-mcp
 * stdio server (src/cli.ts / src/server.ts). This is a SEPARATE binary, exactly like
 * src/http.ts is a separate transport: nothing in src/server.ts imports from src/genai/, so the
 * default `npx abap-mcp` server never gains network access because this file exists.
 *
 * Like src/http.ts, the pieces are exported (buildGenAiServer, runGenAiServer) and main() only
 * runs when this file is invoked directly — so it stays importable/testable without opening
 * stdio or requiring a service key.
 *
 * Registered in package.json as the `abap-mcp-genai` bin (dist/genai.js) — a separate
 * process from the offline stdio server, never wired into it.
 * See docs/GENAI.md.
 */
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadServiceKeyFromEnv } from "./genai/client.js";
import { GENAI_TOOLS } from "./genai/tools.js";
import { SERVER_VERSION } from "./server.js";
import { registerTools } from "./tool.js";

export const GENAI_SERVER_NAME = "abap-mcp-genai";
export const GENAI_SERVER_VERSION = SERVER_VERSION;
export const GENAI_SERVER_INSTRUCTIONS =
  "abap-mcp-genai is the online, opt-in companion to the offline abap-mcp server: it calls the caller's own " +
  "SAP AI Core Generative AI Hub tenant (never a shared or vendor-hosted one) to run SAP's sap-abap-1 model " +
  "for ABAP explanation, and to list what models that tenant currently has available. Source text sent " +
  "through explain_with_sap_abap_1 leaves this machine and is processed by the caller's own SAP AI Core " +
  "tenant; list_genai_hub_models sends no source, only a metadata query. This is not a replacement for the " +
  "offline abap-mcp server: keep using lint_abap / check_cloud_readiness / scaffold_rap_bo / scaffold_abap_unit " +
  "there for anything that must stay local and deterministic — sap-abap-1 explains code, it does not lint, " +
  "generate, or validate it. Requires AICORE_SERVICE_KEY (the service key JSON) or AICORE_SERVICE_KEY_FILE " +
  "(a path to it); the process exits at startup with a clear error if neither is configured.";

/** Build a fully-wired abap-mcp-genai server instance (one per transport connection). */
export function buildGenAiServer(): McpServer {
  const server = new McpServer(
    { name: GENAI_SERVER_NAME, version: GENAI_SERVER_VERSION },
    { instructions: GENAI_SERVER_INSTRUCTIONS },
  );
  registerTools(server, GENAI_TOOLS);
  return server;
}

/**
 * Start the stdio server. Exits (via `process.exitCode`, never a hard `process.exit`) with a
 * clear stderr message instead of connecting when no service key is configured, so a host that
 * launches this by mistake gets an actionable message rather than a silently-idle process.
 */
export async function runGenAiServer(): Promise<void> {
  try {
    loadServiceKeyFromEnv();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${GENAI_SERVER_NAME}: not configured — ${message}`);
    console.error(
      `${GENAI_SERVER_NAME}: set AICORE_SERVICE_KEY (service key JSON) or AICORE_SERVICE_KEY_FILE (a path to ` +
        "it) and retry. See docs/GENAI.md for how to obtain a service key.",
    );
    process.exitCode = 1;
    return;
  }

  const server = buildGenAiServer();
  await server.connect(new StdioServerTransport());
  console.error(
    `${GENAI_SERVER_NAME} v${GENAI_SERVER_VERSION} ready on stdio (online, opt-in — source you send it leaves ` +
      "this machine; see docs/GENAI.md).",
  );
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  runGenAiServer().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`${GENAI_SERVER_NAME} fatal: ${message}`);
    process.exitCode = 1;
  });
}
