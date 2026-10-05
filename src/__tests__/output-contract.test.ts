/**
 * Output-schema contract: every tool's structuredContent must validate against
 * the outputSchema the server advertises. The SDK client only enforces this
 * AFTER tools/list has cached the schemas — which every real client does first
 * and a test that calls a tool directly never does. Listing first here is the
 * whole point: without it a result with an undeclared key passes silently and
 * then fails in the field with -32602.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ALL_TOOLS } from "../abap.tools.js";
import { buildServer } from "../server.js";
import type { ToolExample } from "../tool.js";
import { RUN_TOOLS } from "../tools/run.tools.js";

async function listedClient(): Promise<Client> {
  // Opt in to run_abap_unit so the opt-in tool is held to the same contract.
  process.env["ABAP_MCP_ENABLE_RUN"] = "1";
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "contract-client", version: "0.0.0" });
  await client.connect(clientTransport);
  await client.listTools();
  return client;
}

const CLASSIC_REPORT = [
  "REPORT zold.",
  "TABLES mara.",
  "DATA lt_mara TYPE TABLE OF mara.",
  "SELECT * FROM mara INTO TABLE lt_mara.",
  "SELECT * FROM bseg INTO TABLE @DATA(lt_bseg).",
  "CALL FUNCTION 'POPUP_TO_CONFIRM'.",
  "WRITE: / 'hi'.",
  "CALL SCREEN 100.",
  "EXEC SQL.",
  "ENDEXEC.",
  "MOVE 1 TO sy-subrc.",
].join("\n");

const CLASS_A = [
  "CLASS zcl_a DEFINITION PUBLIC INHERITING FROM zcl_b CREATE PUBLIC.",
  "  PUBLIC SECTION.",
  "    INTERFACES zif_c.",
  "    METHODS run.",
  "ENDCLASS.",
  "CLASS zcl_a IMPLEMENTATION.",
  "  METHOD run.",
  "    SELECT * FROM mara INTO TABLE @DATA(lt_mara).",
  "    SELECT * FROM vbak INTO TABLE @DATA(lt_vbak).",
  "    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'.",
  "  ENDMETHOD.",
  "ENDCLASS.",
].join("\n");

const FILES = [
  { filename: "zold.prog.abap", source: CLASSIC_REPORT },
  { filename: "zcl_a.clas.abap", source: CLASS_A },
];

/** Inputs chosen to populate the optional branches the worked examples leave empty. */
const EXTRA_CASES: Record<string, ToolExample[]> = {
  check_cloud_readiness: [
    { description: "every edition, many categories", arguments: { files: FILES } },
    { description: "btp edition", arguments: { files: FILES, edition: "btp" } },
    { description: "pce edition", arguments: { files: FILES, edition: "pce" } },
  ],
  get_object_dependencies: [
    { description: "released annotations + mermaid", arguments: { files: FILES, mermaid: true } },
    { description: "pce edition", arguments: { files: FILES, edition: "pce" } },
  ],
  plan_cloud_migration: [{ description: "full plan", arguments: { files: FILES } }],
  lint_abap: [{ description: "full preset", arguments: { files: FILES, preset: "full" } }],
  fix_abap: [{ description: "fixable source", arguments: { files: FILES } }],
  check_released_api: [
    { description: "mixed names", arguments: { objects: ["MARA", "BSEG", "I_PRODUCT", "ZNOPE", "POPUP_TO_CONFIRM"] } },
  ],
};

describe("output-schema contract (client lists tools first)", () => {
  for (const spec of [...ALL_TOOLS, ...RUN_TOOLS]) {
    const cases = [...(spec.examples ?? []), ...(EXTRA_CASES[spec.name] ?? [])];
    it(`${spec.name}: declares an example to check`, () => {
      expect(cases.length).toBeGreaterThan(0);
    });
    for (const [i, example] of cases.entries()) {
      it(`${spec.name} #${i + 1} (${example.description}) matches its output schema`, async () => {
        const client = await listedClient();
        // A schema mismatch surfaces as a thrown McpError (-32602) from callTool.
        const result = await client.callTool({ name: spec.name, arguments: example.arguments });
        expect(result.isError ?? false).toBe(false);
      }, 60_000);
    }
  }
});

describe("input-schema hygiene", () => {
  /** VS Code rejects a whole chat request when any tool's array parameter lacks `items`. */
  function arraysWithoutItems(schema: unknown, path: string, out: string[]): string[] {
    if (schema === null || typeof schema !== "object") return out;
    const node = schema as Record<string, unknown>;
    if (node["type"] === "array" && node["items"] === undefined && node["prefixItems"] === undefined) out.push(path);
    for (const [key, value] of Object.entries(node)) {
      if (Array.isArray(value)) value.forEach((v, i) => arraysWithoutItems(v, `${path}/${key}/${i}`, out));
      else arraysWithoutItems(value, `${path}/${key}`, out);
    }
    return out;
  }

  it("every array parameter in every tool's input schema declares items", async () => {
    const client = await listedClient();
    const { tools } = await client.listTools();
    const offenders = tools.flatMap((t) => arraysWithoutItems(t.inputSchema, t.name, []));
    expect(offenders).toEqual([]);
  });

  it("a null rule override is rejected as invalid input, not as an internal error", async () => {
    const client = await listedClient();
    const result = await client.callTool({
      name: "lint_abap",
      arguments: { files: [{ source: "REPORT z." }], rules: { exit_or_check: null } },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).not.toContain("Cannot read properties");
  });
});

describe("version manifests", () => {
  it("the Codex plugin manifest and server.json carry the package.json version", () => {
    const root = join(import.meta.dirname, "../..");
    const read = (rel: string): { version: string; packages?: { version: string }[] } =>
      JSON.parse(readFileSync(join(root, rel), "utf8")) as { version: string; packages?: { version: string }[] };
    const version = read("package.json").version;
    expect(read("plugins/abap-mcp/.codex-plugin/plugin.json").version).toBe(version);
    const server = read("server.json");
    expect([server.version, ...(server.packages ?? []).map((p) => p.version)]).toEqual([version, version]);
  });
});
