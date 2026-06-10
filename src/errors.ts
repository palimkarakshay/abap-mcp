/**
 * Structured tool failure — the one way tools in this server fail.
 *
 * Pattern adapted from @mcp-kit/core (github.com/palimkarakshay/mcp-kit, MIT):
 * handlers throw `McpToolError` (or anything), the registration wrapper turns
 * it into an MCP error result instead of crashing the request.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolErrorCode = "invalid_input" | "not_found" | "internal";

export class McpToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

/** The caller passed arguments the tool cannot work with. */
export function invalidInput(message: string, details?: Record<string, unknown>): McpToolError {
  return new McpToolError("invalid_input", message, details);
}

/** The named thing (rule key, …) does not exist. */
export function notFound(message: string, details?: Record<string, unknown>): McpToolError {
  return new McpToolError("not_found", message, details);
}

/** Convert any thrown value into a structured MCP error result. */
export function errorResult(err: unknown): CallToolResult {
  const e =
    err instanceof McpToolError
      ? err
      : new McpToolError("internal", err instanceof Error ? err.message : String(err));
  // IMPORTANT: do NOT attach `structuredContent` here. Every tool declares an `outputSchema`
  // describing its *success* shape, and the MCP SDK validates `structuredContent` against that
  // schema even when `isError: true`. An error payload ({ error: … }) cannot satisfy a success
  // schema, so strict clients (OpenClaw, the MCP inspector, the VSCode/ADT integrations) reject
  // the whole result with `-32602` and the model never sees the real, actionable message —
  // it just gives up and answers from memory. The spec permits an absent `structuredContent`
  // on error results, so the human-readable `code: message` text carries the error instead.
  return {
    isError: true,
    content: [{ type: "text", text: `${e.code}: ${e.message}` }],
  };
}
