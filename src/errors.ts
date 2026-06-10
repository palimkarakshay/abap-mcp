/**
 * Structured tool failure — the one way tools in this server fail.
 *
 * Pattern adapted from @mcp-kit/core (github.com/lumivarahq/mcp-kit, MIT):
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
  return {
    isError: true,
    content: [{ type: "text", text: `${e.code}: ${e.message}` }],
    structuredContent: { error: { code: e.code, message: e.message, details: e.details ?? null } },
  };
}
