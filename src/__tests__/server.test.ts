/**
 * End-to-end over a real MCP wire: client ↔ in-memory transport ↔ server.
 * Plus a mini description-lint mirroring the mcp-kit rubric, so model-facing
 * docs quality is CI-enforced, not aspirational.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { ALL_TOOLS } from "../abap.tools.js";
import { buildServer } from "../server.js";

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP server wire", () => {
  it("lists all nine tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_cloud_readiness",
      "check_released_api",
      "compare_abap",
      "explain_abap_rule",
      "format_abap",
      "get_abap_outline",
      "lint_abap",
      "list_abap_rules",
      "scaffold_rap_bo",
    ]);
  });

  it("compare_abap reports grade movement over the wire", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "compare_abap",
      arguments: {
        before: [{ source: "REPORT zold.\nWRITE: / 'hi'." }],
        after: [
          {
            source:
              "CLASS zcl_new DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS get RETURNING VALUE(rv) TYPE string.\nENDCLASS.\nCLASS zcl_new IMPLEMENTATION.\n METHOD get.\n rv = 'hi'.\n ENDMETHOD.\nENDCLASS.",
          },
        ],
      },
    })) as {
      isError?: boolean;
      structuredContent?: { before: { grade: string }; after: { grade: string; cloudBlockerCount: number } };
    };
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent!.before.grade).not.toBe("A");
    expect(result.structuredContent!.after.grade).toBe("A");
    expect(result.structuredContent!.after.cloudBlockerCount).toBe(0);
  });

  it("lint_abap round-trips over the wire with structured content", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "lint_abap",
      arguments: { files: [{ source: "REPORT ztest.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF." }] },
    })) as { isError?: boolean; structuredContent?: { findings: unknown[] } };
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent!.findings.length).toBeGreaterThan(0);
  });

  it("scaffold_rap_bo returns validated artifacts over the wire", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "scaffold_rap_bo",
      arguments: { entityName: "Trip", sqlTable: "ztrip", keyField: "trip_id" },
    })) as { isError?: boolean; structuredContent?: { files: { filename: string }[]; validationIssues: unknown[] } };
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent!.files.length).toBe(8);
    expect(result.structuredContent!.validationIssues).toEqual([]);
  });

  it("check_released_api resolves table/CDS/BAPI states over the wire", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "check_released_api",
      arguments: { objects: ["MARA", "I_Product"] },
    })) as {
      isError?: boolean;
      structuredContent?: {
        snapshotDate: string;
        results: { name: string; state: string; successor?: string }[];
      };
    };
    expect(result.isError ?? false).toBe(false);
    expect(result.structuredContent!.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const byName = Object.fromEntries(result.structuredContent!.results.map((r) => [r.name, r]));
    expect(byName["MARA"]!.state).toBe("not-released");
    expect(byName["MARA"]!.successor).toBe("I_Product");
    expect(byName["I_Product"]!.state).toBe("released");
  });

  it("bad input becomes a structured error result, not a crash", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "explain_abap_rule",
      arguments: { rule: "no_such_rule_xyz" },
    })) as { isError?: boolean; content: { type: string; text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not_found");
  });
});

describe("tool description rubric (mcp-kit discipline)", () => {
  const VERBS = ["get", "list", "search", "run", "create", "check", "compare", "lint", "scaffold", "explain", "format"];

  for (const tool of ALL_TOOLS) {
    describe(tool.name, () => {
      it("is verb-first snake_case", () => {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(VERBS).toContain(tool.name.split("_")[0]);
      });

      it("says when to use it and what it does not do", () => {
        expect(tool.description).toMatch(/Use this when/);
        expect(tool.description).toMatch(/(does not|not a|cannot)/);
      });

      it("describes every input parameter", () => {
        for (const [field, schema] of Object.entries(tool.inputSchema)) {
          const description = (schema as ZodType).description;
          expect(description, `${tool.name}.${field} needs .describe()`).toBeTruthy();
          expect(description!.length).toBeGreaterThanOrEqual(12);
        }
      });

      it("ships at least one worked example", () => {
        expect(tool.examples?.length ?? 0).toBeGreaterThanOrEqual(1);
      });

      it("is annotated read-only (this server never mutates anything)", () => {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      });
    });
  }
});
