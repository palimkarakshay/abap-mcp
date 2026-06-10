import { describe, expect, it } from "vitest";

import { errorResult, McpToolError } from "../errors.js";

describe("errorResult", () => {
  // Regression: every tool's outputSchema describes its SUCCESS shape, and the
  // MCP SDK validates structuredContent against it even when isError is true.
  // An error payload can never satisfy a success schema, so strict clients
  // reject the whole result with -32602 and the caller never sees the message.
  // Error results must therefore carry text only.
  it("never attaches structuredContent", () => {
    const typed = errorResult(new McpToolError("invalid-input", "bad source"));
    expect(typed.isError).toBe(true);
    expect(typed.structuredContent).toBeUndefined();
    expect(typed.content[0]).toMatchObject({ type: "text" });
    expect((typed.content[0] as { text: string }).text).toContain("invalid-input");

    const plain = errorResult(new Error("boom"));
    expect(plain.isError).toBe(true);
    expect(plain.structuredContent).toBeUndefined();
  });
});
