/**
 * Tests for the abap-mcp-genai online, opt-in module (F09): rubric coverage for GENAI_TOOLS
 * (mirrors the mcp-kit discipline in server.test.ts), the MCP wire for the genai server, and
 * GenAiClient's HTTP behavior against a mocked `fetch` — token request shape, orchestration-URL
 * discovery/caching, V2 completion request shape (no system role for sap-abap-1), model-listing
 * parse, and error shaping (401 -> auth, 429 -> rate_limit, network failure -> network, missing
 * service key -> not_configured).
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { McpToolError } from "../errors.js";
import { buildGenAiServer, GENAI_SERVER_INSTRUCTIONS } from "../genai.js";
import {
  GenAiClient,
  loadServiceKeyFromEnv,
  type GenAiServiceKey,
} from "../genai/client.js";
import { explainWithSapAbap1, GENAI_TOOLS, listGenaiHubModels } from "../genai/tools.js";

// ---------------------------------------------------------------------------
// Fetch mocking helpers
// ---------------------------------------------------------------------------

type FetchLike = typeof fetch;

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A fetch stub that returns queued responses in order and records every call it saw. */
function mockFetchSequence(...responses: (Response | "network-error")[]): { fetch: FetchLike; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[index++];
    if (next === undefined) throw new Error("mockFetchSequence: ran out of queued responses");
    if (next === "network-error") throw new TypeError("fetch failed");
    return next;
  }) as FetchLike;
  return { fetch: fetchImpl, calls };
}

const TEST_SERVICE_KEY: GenAiServiceKey = {
  clientid: "sb-clientid-1234",
  clientsecret: "s3cr3t-not-real",
  url: "https://subaccount.authentication.sap.hana.ondemand.com",
  serviceurls: { AI_API_URL: "https://api.ai.example.hana.ondemand.com" },
};

function headerValue(init: RequestInit, name: string): string | undefined {
  const headers = init.headers as Record<string, string> | undefined;
  return headers?.[name];
}

const DEPLOYMENTS_RESPONSE = {
  count: 2,
  resources: [
    { id: "d1", status: "UNKNOWN", configurationName: "other-config", deploymentUrl: "" },
    {
      id: "d2",
      status: "RUNNING",
      configurationName: "defaultOrchestrationConfig",
      scenarioId: "llm-orchestration",
      deploymentUrl: "https://orch.example.hana.ondemand.com/",
    },
  ],
};

const COMPLETION_RESPONSE = {
  request_id: "a0dd9ce1-c9d2-986c-9c0b-2c93d47b8bc0",
  final_result: {
    model: "sap-abap-1",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "The class ZCL_ADD_TEST is a simple utility class." },
        finish_reason: "stop",
      },
    ],
    usage: { completion_tokens: 172, prompt_tokens: 422, total_tokens: 594 },
  },
};

const MODELS_RESPONSE = {
  count: 2,
  resources: [
    {
      accessType: "Remote",
      allowedScenarios: [{ executableId: "orchestration", scenarioId: "orchestration" }],
      executableId: "orchestration",
      model: "sap-abap-1",
      provider: "SAP",
      versions: [
        { name: "latest", isLatest: true, contextLength: 128000, deprecated: false, retirementDate: "" },
      ],
    },
    {
      accessType: "Remote",
      allowedScenarios: [
        { executableId: "azure-openai", scenarioId: "foundation-models" },
        { executableId: "orchestration", scenarioId: "orchestration" },
      ],
      executableId: "azure-openai",
      model: "gpt-4o",
      provider: "OpenAI",
      versions: [{ name: "2024-05-13", isLatest: false, contextLength: 128000 }],
    },
  ],
};

const tokenResponse = () => jsonResponse(200, { access_token: "token-1", expires_in: 3600, token_type: "bearer" });

// ---------------------------------------------------------------------------
// GENAI_TOOLS rubric (mirrors the mcp-kit discipline in server.test.ts)
// ---------------------------------------------------------------------------

describe("GENAI_TOOLS rubric (mcp-kit discipline)", () => {
  const VERBS = ["get", "list", "search", "run", "create", "check", "compare", "lint", "scaffold", "explain", "format", "plan", "fix"];

  it("registers exactly the two genai tools", () => {
    expect(GENAI_TOOLS.map((t) => t.name).sort()).toEqual(["explain_with_sap_abap_1", "list_genai_hub_models"]);
  });

  for (const tool of GENAI_TOOLS) {
    describe(tool.name, () => {
      it("is verb-first snake_case", () => {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(VERBS).toContain(tool.name.split("_")[0]);
      });

      it("says when to use it and what it does not do", () => {
        expect(tool.description).toMatch(/Use this when/);
        expect(tool.description).toMatch(/(does not|not a|cannot)/);
      });

      it("plainly states the privacy contract (source leaves the machine)", () => {
        expect(tool.description).toMatch(/PRIVACY/);
        expect(tool.description).toContain("leaves the machine");
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

      it("is read-only but flagged open-world (it calls the network)", () => {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.openWorldHint).toBe(true);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// MCP wire
// ---------------------------------------------------------------------------

describe("abap-mcp-genai MCP server wire", () => {
  it("registers only the genai tools and states its opt-in/online nature", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = buildGenAiServer();
    await server.connect(serverTransport);
    const client = new Client({ name: "test-client", version: "0.0.0" });
    await client.connect(clientTransport);

    expect(client.getInstructions()).toBe(GENAI_SERVER_INSTRUCTIONS);
    expect(GENAI_SERVER_INSTRUCTIONS).toContain("opt-in");
    expect(GENAI_SERVER_INSTRUCTIONS).toContain("offline abap-mcp server");

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["explain_with_sap_abap_1", "list_genai_hub_models"]);
  });
});

// ---------------------------------------------------------------------------
// loadServiceKeyFromEnv
// ---------------------------------------------------------------------------

describe("loadServiceKeyFromEnv", () => {
  const tmpFiles: string[] = [];
  afterEach(() => {
    for (const f of tmpFiles.splice(0)) rmSync(f, { force: true });
  });

  it("fails with kind not_configured when neither env var is set", () => {
    expect(() => loadServiceKeyFromEnv({})).toThrowError(McpToolError);
    try {
      loadServiceKeyFromEnv({});
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      expect((err as McpToolError).kind).toBe("not_configured");
    }
  });

  it("fails with kind not_configured on invalid JSON", () => {
    try {
      loadServiceKeyFromEnv({ AICORE_SERVICE_KEY: "{not json" });
      expect.unreachable();
    } catch (err) {
      expect((err as McpToolError).kind).toBe("not_configured");
    }
  });

  it("fails with kind not_configured when required fields are missing", () => {
    try {
      loadServiceKeyFromEnv({ AICORE_SERVICE_KEY: JSON.stringify({ clientid: "x" }) });
      expect.unreachable();
    } catch (err) {
      expect((err as McpToolError).kind).toBe("not_configured");
    }
  });

  it("parses a valid inline AICORE_SERVICE_KEY", () => {
    const key = loadServiceKeyFromEnv({ AICORE_SERVICE_KEY: JSON.stringify(TEST_SERVICE_KEY) });
    expect(key).toEqual(TEST_SERVICE_KEY);
  });

  it("reads AICORE_SERVICE_KEY_FILE from disk (this entry point may read that one file)", () => {
    const dir = mkdtempSync(join(tmpdir(), "abap-mcp-genai-test-"));
    const file = join(dir, "key.json");
    writeFileSync(file, JSON.stringify(TEST_SERVICE_KEY), "utf8");
    tmpFiles.push(file);
    const key = loadServiceKeyFromEnv({ AICORE_SERVICE_KEY_FILE: file });
    expect(key).toEqual(TEST_SERVICE_KEY);
  });

  it("fails with kind not_configured when AICORE_SERVICE_KEY_FILE cannot be read", () => {
    try {
      loadServiceKeyFromEnv({ AICORE_SERVICE_KEY_FILE: "/nonexistent/path/key.json" });
      expect.unreachable();
    } catch (err) {
      expect((err as McpToolError).kind).toBe("not_configured");
    }
  });
});

// ---------------------------------------------------------------------------
// GenAiClient — token request shape + caching
// ---------------------------------------------------------------------------

describe("GenAiClient.getAccessToken", () => {
  it("POSTs client-credentials with Basic auth to {url}/oauth/token", async () => {
    const { fetch: fetchImpl, calls } = mockFetchSequence(tokenResponse());
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    const token = await client.getAccessToken();

    expect(token).toBe("token-1");
    expect(calls.length).toBe(1);
    expect(calls[0]!.url).toBe(`${TEST_SERVICE_KEY.url}/oauth/token`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(headerValue(calls[0]!.init, "Authorization")).toBe(
      `Basic ${Buffer.from(`${TEST_SERVICE_KEY.clientid}:${TEST_SERVICE_KEY.clientsecret}`).toString("base64")}`,
    );
    expect(headerValue(calls[0]!.init, "Content-Type")).toBe("application/x-www-form-urlencoded");
    expect(calls[0]!.init.body).toBe("grant_type=client_credentials");
  });

  it("caches the token across calls instead of re-requesting it", async () => {
    const { fetch: fetchImpl, calls } = mockFetchSequence(tokenResponse());
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    await client.getAccessToken();
    await client.getAccessToken();

    expect(calls.length).toBe(1);
  });

  it("classifies a 401 as kind auth", async () => {
    const { fetch: fetchImpl } = mockFetchSequence(jsonResponse(401, { error: "unauthorized" }));
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    try {
      await client.getAccessToken();
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      expect((err as McpToolError).kind).toBe("auth");
    }
  });

  it("classifies a fetch-level failure as kind network", async () => {
    const { fetch: fetchImpl } = mockFetchSequence("network-error");
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    try {
      await client.getAccessToken();
      expect.unreachable();
    } catch (err) {
      expect((err as McpToolError).kind).toBe("network");
    }
  });
});

// ---------------------------------------------------------------------------
// GenAiClient — orchestration URL discovery + caching
// ---------------------------------------------------------------------------

describe("GenAiClient.resolveOrchestrationUrl", () => {
  it("skips discovery entirely when an explicit override is configured", async () => {
    const { fetch: fetchImpl, calls } = mockFetchSequence();
    const client = new GenAiClient({
      serviceKey: TEST_SERVICE_KEY,
      orchestrationUrl: "https://override.example.com/",
      fetchImpl,
    });

    const url = await client.resolveOrchestrationUrl();

    expect(url).toBe("https://override.example.com");
    expect(calls.length).toBe(0);
  });

  it("discovers the RUNNING defaultOrchestrationConfig deployment and caches it", async () => {
    const { fetch: fetchImpl, calls } = mockFetchSequence(tokenResponse(), jsonResponse(200, DEPLOYMENTS_RESPONSE));
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, resourceGroup: "default", fetchImpl });

    const first = await client.resolveOrchestrationUrl();
    const second = await client.resolveOrchestrationUrl();

    expect(first).toBe("https://orch.example.hana.ondemand.com");
    expect(second).toBe(first);
    // token + deployments list = 2 calls total, never repeated on the second resolve.
    expect(calls.length).toBe(2);
    const deploymentsCall = calls.find((c) => c.url.endsWith("/v2/lm/deployments"))!;
    expect(deploymentsCall.init.method).toBe("GET");
    expect(headerValue(deploymentsCall.init, "AI-Resource-Group")).toBe("default");
    expect(headerValue(deploymentsCall.init, "Authorization")).toBe("Bearer token-1");
  });

  it("fails with kind not_configured when no RUNNING deployment exists", async () => {
    const { fetch: fetchImpl } = mockFetchSequence(tokenResponse(), jsonResponse(200, { count: 0, resources: [] }));
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    try {
      await client.resolveOrchestrationUrl();
      expect.unreachable();
    } catch (err) {
      expect((err as McpToolError).kind).toBe("not_configured");
    }
  });
});

// ---------------------------------------------------------------------------
// GenAiClient — V2 completion request shape
// ---------------------------------------------------------------------------

describe("GenAiClient.completion", () => {
  it("POSTs to {deploymentUrl}/v2/completion with the documented headers and no system role", async () => {
    const { fetch: fetchImpl, calls } = mockFetchSequence(
      tokenResponse(),
      jsonResponse(200, DEPLOYMENTS_RESPONSE),
      jsonResponse(200, COMPLETION_RESPONSE),
    );
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, resourceGroup: "default", fetchImpl });

    const result = await client.completion({
      template: [{ role: "user", content: "Explain the ABAP class below." }],
      model: { name: "sap-abap-1", version: "latest", temperature: 0.1, maxTokens: 2000 },
    });

    expect(result.content).toBe(COMPLETION_RESPONSE.final_result.choices[0]!.message.content);
    expect(result.requestId).toBe(COMPLETION_RESPONSE.request_id);
    expect(result.usage).toEqual({ promptTokens: 422, completionTokens: 172, totalTokens: 594 });

    const completionCall = calls.find((c) => c.url.endsWith("/v2/completion"))!;
    expect(completionCall.url).toBe("https://orch.example.hana.ondemand.com/v2/completion");
    expect(completionCall.init.method).toBe("POST");
    expect(headerValue(completionCall.init, "Authorization")).toBe("Bearer token-1");
    expect(headerValue(completionCall.init, "AI-Resource-Group")).toBe("default");
    expect(headerValue(completionCall.init, "Content-Type")).toBe("application/json");

    const body = JSON.parse(completionCall.init.body as string) as {
      config: { modules: { prompt_templating: { prompt: { template: { role: string; content: string }[] }; model: { name: string; version: string; params: { temperature: number; max_tokens: number } } } } };
    };
    const template = body.config.modules.prompt_templating.prompt.template;
    expect(template.every((m) => m.role !== "system")).toBe(true);
    expect(template[0]!.role).toBe("user");
    expect(body.config.modules.prompt_templating.model).toEqual({
      name: "sap-abap-1",
      version: "latest",
      params: { temperature: 0.1, max_tokens: 2000 },
    });
  });

  it("refuses a system-role message to sap-abap-1 (invalid_input, no network call)", async () => {
    const { fetch: fetchImpl, calls } = mockFetchSequence();
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    try {
      await client.completion({
        template: [
          { role: "system" as never, content: "You are a helpful assistant." },
          { role: "user", content: "Explain this." },
        ],
        model: { name: "sap-abap-1", version: "latest", temperature: 0.1, maxTokens: 2000 },
      });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(McpToolError);
      expect((err as McpToolError).kind).toBe("invalid_input");
    }
    expect(calls.length).toBe(0);
  });

  it("classifies a 429 as kind rate_limit", async () => {
    const { fetch: fetchImpl } = mockFetchSequence(
      tokenResponse(),
      jsonResponse(200, DEPLOYMENTS_RESPONSE),
      jsonResponse(429, { error: "rate limited" }),
    );
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    try {
      await client.completion({
        template: [{ role: "user", content: "Explain this." }],
        model: { name: "sap-abap-1", version: "latest", temperature: 0.1, maxTokens: 2000 },
      });
      expect.unreachable();
    } catch (err) {
      expect((err as McpToolError).kind).toBe("rate_limit");
    }
  });

  it("classifies a network failure as kind network", async () => {
    const { fetch: fetchImpl } = mockFetchSequence(tokenResponse(), jsonResponse(200, DEPLOYMENTS_RESPONSE), "network-error");
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    try {
      await client.completion({
        template: [{ role: "user", content: "Explain this." }],
        model: { name: "sap-abap-1", version: "latest", temperature: 0.1, maxTokens: 2000 },
      });
      expect.unreachable();
    } catch (err) {
      expect((err as McpToolError).kind).toBe("network");
    }
  });
});

// ---------------------------------------------------------------------------
// GenAiClient — model listing parse
// ---------------------------------------------------------------------------

describe("GenAiClient.listModels", () => {
  it("GETs the foundation-models catalog and parses versions/context/deprecation", async () => {
    const { fetch: fetchImpl, calls } = mockFetchSequence(tokenResponse(), jsonResponse(200, MODELS_RESPONSE));
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, resourceGroup: "default", fetchImpl });

    const result = await client.listModels();

    expect(result.resourceGroup).toBe("default");
    expect(result.count).toBe(2);
    const abap1 = result.models.find((m) => m.model === "sap-abap-1")!;
    expect(abap1.provider).toBe("SAP");
    expect(abap1.allowedScenarios).toEqual(["orchestration"]);
    expect(abap1.versions).toEqual([
      { name: "latest", isLatest: true, contextLength: 128000, deprecated: false },
    ]);

    const catalogCall = calls.find((c) => c.url.endsWith("/v2/lm/scenarios/foundation-models/models"))!;
    expect(catalogCall.init.method).toBe("GET");
    expect(headerValue(catalogCall.init, "AI-Resource-Group")).toBe("default");
    expect(headerValue(catalogCall.init, "Authorization")).toBe("Bearer token-1");
  });

  it("filters case-insensitively by model or provider substring", async () => {
    const { fetch: fetchImpl } = mockFetchSequence(tokenResponse(), jsonResponse(200, MODELS_RESPONSE));
    const client = new GenAiClient({ serviceKey: TEST_SERVICE_KEY, fetchImpl });

    const result = await client.listModels("SAP-ABAP");

    expect(result.count).toBe(1);
    expect(result.models[0]!.model).toBe("sap-abap-1");
  });
});

// ---------------------------------------------------------------------------
// Exported tool handlers exist and are wired (sanity, no network)
// ---------------------------------------------------------------------------

describe("tool handler wiring", () => {
  it("both tool handlers are async functions", () => {
    expect(typeof explainWithSapAbap1.handler).toBe("function");
    expect(typeof listGenaiHubModels.handler).toBe("function");
  });
});
