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
import { ALL_PROMPTS } from "../prompts.js";
import { buildServer, SERVER_INSTRUCTIONS } from "../server.js";

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("MCP server wire", () => {
  it("publishes concise server-wide routing and honesty instructions", async () => {
    const client = await connectedClient();
    expect(client.getInstructions()).toBe(SERVER_INSTRUCTIONS);
    expect(SERVER_INSTRUCTIONS.slice(0, 512)).toContain("check_cloud_readiness");
    expect(SERVER_INSTRUCTIONS.slice(0, 512)).toContain("cannot read workspace files");
    expect(SERVER_INSTRUCTIONS).toContain("do not connect to SAP or run ATC");
  });

  it("lists all twelve tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "check_cloud_readiness",
      "check_released_api",
      "compare_abap",
      "explain_abap_rule",
      "format_abap",
      "get_abap_outline",
      "get_object_dependencies",
      "lint_abap",
      "list_abap_rules",
      "plan_cloud_migration",
      "scaffold_abap_unit",
      "scaffold_rap_bo",
    ]);
  });

  it("scaffold_abap_unit returns a validated failing-by-default harness over the wire", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "scaffold_abap_unit",
      arguments: {
        files: [
          {
            filename: "zcl_travel.clas.abap",
            source:
              "CLASS zcl_travel DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS get_total RETURNING VALUE(rv) TYPE i.\nENDCLASS.\nCLASS zcl_travel IMPLEMENTATION.\n METHOD get_total.\n rv = 1.\n ENDMETHOD.\nENDCLASS.",
          },
        ],
      },
    })) as {
      isError?: boolean;
      structuredContent?: {
        files: { filename: string; content: string; validated: string }[];
        validationIssues: unknown[];
      };
    };
    expect(result.isError ?? false).toBe(false);
    const sc = result.structuredContent!;
    expect(sc.files.length).toBe(1);
    expect(sc.files[0]!.filename).toBe("zcl_travel.clas.testclasses.abap");
    expect(sc.files[0]!.content).toContain("FOR TESTING");
    expect(sc.files[0]!.content).toContain("cl_abap_unit_assert=>fail");
    expect(sc.validationIssues).toEqual([]);
  });

  it("get_object_dependencies flags non-released targets over the wire", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "get_object_dependencies",
      arguments: {
        files: [
          {
            filename: "zcl_pricing.clas.abap",
            source:
              "CLASS zcl_pricing DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS load.\nENDCLASS.\nCLASS zcl_pricing IMPLEMENTATION.\n METHOD load.\n SELECT SINGLE matnr FROM mara INTO @DATA(lv).\n ENDMETHOD.\nENDCLASS.",
          },
        ],
        mermaid: true,
      },
    })) as {
      isError?: boolean;
      structuredContent?: {
        nodes: { name: string; releasedState?: string; successor?: string }[];
        edges: { from: string; to: string; kind: string }[];
        mermaid?: string;
      };
    };
    expect(result.isError ?? false).toBe(false);
    const g = result.structuredContent!;
    const mara = g.nodes.find((n) => n.name === "MARA");
    expect(mara?.releasedState).toBe("not-released");
    expect(mara?.successor).toBe("I_Product");
    expect(g.edges).toContainEqual({ from: "ZCL_PRICING", to: "MARA", kind: "db-access" });
    expect(g.mermaid).toContain("graph LR");
  });

  it("plan_cloud_migration phases blockers into a backlog over the wire", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "plan_cloud_migration",
      arguments: {
        files: [
          {
            filename: "zold_report.prog.abap",
            source: "REPORT zold_report.\nWRITE: / 'hi'.\nCALL SCREEN 100.",
          },
        ],
      },
    })) as {
      isError?: boolean;
      structuredContent?: {
        summary: { cloudBlockerCount: number; workItemCount: number; estimatedEffort: string };
        phases: { kind: string; findingCount: number; effort: string; items: unknown[]; exitCriteria: string }[];
      };
    };
    expect(result.isError ?? false).toBe(false);
    const plan = result.structuredContent!;
    expect(plan.summary.cloudBlockerCount).toBeGreaterThan(0);
    expect(plan.phases.length).toBeGreaterThan(0);
    for (const p of plan.phases) {
      expect(["S", "M", "L"]).toContain(p.effort);
      expect(p.items.length).toBeGreaterThan(0);
      expect(p.exitCriteria.length).toBeGreaterThan(0);
    }
    // The migration phases account for every blocker — no silent drops.
    const migrationFindings = plan.phases
      .filter((p) => p.kind === "migration")
      .reduce((n, p) => n + p.findingCount, 0);
    expect(migrationFindings).toBe(plan.summary.cloudBlockerCount);
  });

  it("lists the three guided-workflow prompts and renders one", async () => {
    const client = await connectedClient();
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      "abap-mentor",
      "abap-migration-plan",
      "abap-review",
    ]);
    const got = await client.getPrompt({ name: "abap-review", arguments: { focus: "Security" } });
    const text = (got.messages[0]!.content as { type: string; text: string }).text;
    expect(got.messages[0]!.role).toBe("user");
    expect(text).toContain("lint_abap");
    expect(text).toContain("Security");
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
  const VERBS = ["get", "list", "search", "run", "create", "check", "compare", "lint", "scaffold", "explain", "format", "plan"];

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

describe("tool routing metadata", () => {
  it("describes readiness and explicit API lookup as complementary", () => {
    const readiness = ALL_TOOLS.find((tool) => tool.name === "check_cloud_readiness")!;
    const releasedApi = ALL_TOOLS.find((tool) => tool.name === "check_released_api")!;

    expect(readiness.description).toContain("released-API observations");
    expect(readiness.description).toContain("not exhaustive dependency discovery");
    expect(readiness.description).not.toContain("does not check released-API usage");
    expect(releasedApi.description).toContain("complements check_cloud_readiness");
    expect(releasedApi.description).not.toContain("deliberately leaves");
  });
});

describe("prompt description rubric", () => {
  for (const prompt of ALL_PROMPTS) {
    describe(prompt.name, () => {
      it("has a kebab-case name, a title and a real description", () => {
        expect(prompt.name).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(prompt.title.length).toBeGreaterThanOrEqual(12);
        expect(prompt.description.length).toBeGreaterThanOrEqual(40);
      });

      it("describes every argument", () => {
        for (const [field, schema] of Object.entries(prompt.args)) {
          const description = (schema as ZodType).description;
          expect(description, `${prompt.name}.${field} needs .describe()`).toBeTruthy();
          expect(description!.length).toBeGreaterThanOrEqual(12);
        }
      });

      it("renders with no arguments and grounds itself in real tools", () => {
        const text = prompt.build({});
        expect(text.length).toBeGreaterThanOrEqual(200);
        const toolNames = ["lint_abap", "check_cloud_readiness", "plan_cloud_migration", "scaffold_rap_bo", "compare_abap"];
        expect(toolNames.some((t) => text.includes(t))).toBe(true);
      });
    });
  }
});
