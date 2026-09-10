/**
 * Structured tool failure — the one way tools in this server fail.
 *
 * Pattern adapted from @mcp-kit/core (github.com/palimkarakshay/mcp-kit, MIT):
 * handlers throw `McpToolError` (or anything), the registration wrapper turns
 * it into an MCP error result instead of crashing the request.
 *
 * Agent-ergonomic contract (v0.11): every error carries a machine-readable
 * `kind`, an optional `hint` (what to change) and `nextTools` (where to go
 * instead), so a coding agent can recover instead of retrying blindly or
 * answering from memory.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export type ToolErrorCode =
  | "invalid_input"
  | "not_found"
  | "internal"
  | "not_configured"
  | "not_available"
  | "unsupported"
  | "timeout"
  | "auth"
  | "rate_limit"
  | "network";

export interface ToolErrorOptions {
  /** One sentence on what the caller should change or do next. */
  hint?: string | undefined;
  /** Tool names that are the right next call instead of retrying this one. */
  nextTools?: string[] | undefined;
  details?: Record<string, unknown> | undefined;
}

export class McpToolError extends Error {
  public readonly hint: string | undefined;
  public readonly nextTools: readonly string[];
  public readonly details: Record<string, unknown> | undefined;

  constructor(
    public readonly code: ToolErrorCode,
    message: string,
    detailsOrOptions?: Record<string, unknown> | ToolErrorOptions,
  ) {
    super(message);
    this.name = "McpToolError";
    const opts: ToolErrorOptions = isOptions(detailsOrOptions)
      ? detailsOrOptions
      : { details: detailsOrOptions };
    this.hint = opts.hint;
    this.nextTools = opts.nextTools ?? [];
    this.details = opts.details;
  }

  /** `kind` is the spec-facing alias of `code` (same value). */
  get kind(): ToolErrorCode {
    return this.code;
  }
}

function isOptions(v: unknown): v is ToolErrorOptions {
  if (v === null || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return "hint" in o || "nextTools" in o || "details" in o;
}

/** The caller passed arguments the tool cannot work with. */
export function invalidInput(
  message: string,
  detailsOrOptions?: Record<string, unknown> | ToolErrorOptions,
): McpToolError {
  return new McpToolError("invalid_input", message, detailsOrOptions);
}

/** The named thing (rule key, …) does not exist. */
export function notFound(
  message: string,
  detailsOrOptions?: Record<string, unknown> | ToolErrorOptions,
): McpToolError {
  return new McpToolError("not_found", message, detailsOrOptions);
}

/** Generic constructor for the remaining kinds (not_configured, timeout, auth, …). */
export function toolError(
  code: ToolErrorCode,
  message: string,
  options?: ToolErrorOptions,
): McpToolError {
  return new McpToolError(code, message, options);
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
  // on error results, so the human-readable text carries the contract instead:
  //   <kind>: <message>
  //   hint: <what to change>            (when known)
  //   next: <tool, tool>                (when known)
  const lines = [`${e.code}: ${e.message}`];
  if (e.hint !== undefined) lines.push(`hint: ${e.hint}`);
  if (e.nextTools.length > 0) lines.push(`next: ${e.nextTools.join(", ")}`);
  return {
    isError: true,
    content: [{ type: "text", text: lines.join("\n") }],
  };
}
