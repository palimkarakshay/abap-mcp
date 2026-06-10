/**
 * Typed tool helper: one `ToolSpec` object is the single source of truth for a
 * tool's name, description, schemas, annotations and worked examples — the
 * same object that registers the tool is the one a description lint can grade,
 * so model-facing docs can't drift from what's enforced.
 *
 * Pattern adapted from @mcp-kit/core (github.com/lumivarahq/mcp-kit, MIT).
 */
import type { McpServer, ToolCallback } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { ZodRawShape } from "zod";

import { errorResult } from "./errors.js";

export interface ToolExample {
  /** One line on why you would make this call. */
  description: string;
  /** Concrete arguments, matching the tool's input schema. */
  arguments: Record<string, unknown>;
}

export interface ToolSpec<InputShape extends ZodRawShape = ZodRawShape> {
  /** Verb-first, snake_case, unique within the server. */
  name: string;
  title?: string;
  /** What it operates on, "Use this when …", and what it does NOT handle. */
  description: string;
  /** Zod raw shape; every field `.describe(...)`d. */
  inputSchema: InputShape;
  outputSchema?: ZodRawShape;
  annotations?: ToolAnnotations;
  /** At least one worked example — examples are documentation. */
  examples?: ToolExample[];
  handler: ToolCallback<InputShape>;
}

// `any` is deliberate: a heterogeneous list of tools cannot share one generic.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyToolSpec = ToolSpec<any>;

/** Identity helper that pins the generic so handler args are typed. */
export function defineTool<InputShape extends ZodRawShape>(
  spec: ToolSpec<InputShape>,
): ToolSpec<InputShape> {
  return spec;
}

function wrapHandler(handler: ToolCallback<ZodRawShape>): ToolCallback<ZodRawShape> {
  const wrapped = async (...args: unknown[]): Promise<CallToolResult> => {
    try {
      return await (handler as (...a: unknown[]) => CallToolResult | Promise<CallToolResult>)(
        ...args,
      );
    } catch (err) {
      return errorResult(err);
    }
  };
  return wrapped as unknown as ToolCallback<ZodRawShape>;
}

export function registerTool(server: McpServer, spec: AnyToolSpec): void {
  const config: {
    title?: string;
    description: string;
    inputSchema: ZodRawShape;
    outputSchema?: ZodRawShape;
    annotations?: ToolAnnotations;
  } = {
    description: spec.description,
    inputSchema: spec.inputSchema,
  };
  if (spec.title !== undefined) config.title = spec.title;
  if (spec.outputSchema !== undefined) config.outputSchema = spec.outputSchema;
  if (spec.annotations !== undefined) config.annotations = spec.annotations;

  server.registerTool(spec.name, config, wrapHandler(spec.handler as ToolCallback<ZodRawShape>));
}

export function registerTools(server: McpServer, specs: readonly AnyToolSpec[]): void {
  for (const spec of specs) registerTool(server, spec);
}
