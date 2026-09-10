/**
 * SAP AI Core client for the abap-mcp-genai online module (F09, see docs/ROADMAP-2026-09.md §3
 * row 6 and docs/GENAI.md).
 *
 * INVARIANT (AGENTS.md): the default abap-mcp stdio server (src/cli.ts / src/server.ts) never
 * touches the network. This file is imported ONLY by src/genai/tools.ts and src/genai.ts — a
 * separate, opt-in entry point, exactly like src/http.ts is a separate transport. Nothing here
 * is reachable from `npx abap-mcp`.
 *
 * PRIVACY: every function in this file either sends the caller-supplied ABAP source text to the
 * caller's own SAP AI Core tenant (completion()) or queries that tenant's model catalog
 * (listModels()) — see docs/GENAI.md and PRIVACY.md. This module never logs request bodies,
 * prompts, source text, tokens, or the service key — only generic status/context strings ever
 * reach an error message or stderr.
 *
 * Auth flow (XSUAA client-credentials) and the Orchestration V2 request/response shapes below
 * are sourced from SAP's own documentation, fact-checked in
 * ~/docs/reports/abap-mcp-sap-ai-upgrade-2026-09-09/raw/{sap-abap-1-model,genai-hub-orchestration-api}/VERIFIED.md:
 *  - token endpoint:        POST {serviceKey.url}/oauth/token (Basic clientid:clientsecret, grant_type=client_credentials)
 *    https://help.sap.com/docs/sap-ai-core/generative-ai/get-auth-token-5ec7ec0626ed4b55a496a48feab2b56b
 *  - deployment discovery:  GET {AI_API_URL}/v2/lm/deployments (header AI-Resource-Group), find the
 *    RUNNING entry whose configurationName is "defaultOrchestrationConfig", read its deploymentUrl
 *    https://help.sap.com/docs/sap-ai-core/generative-ai/get-an-orchestration-deployment-url
 *  - completion:            POST {deploymentUrl}/v2/completion (Bearer + AI-Resource-Group)
 *    https://help.sap.com/docs/sap-ai-core/generative-ai/orchestration-workflow-v2 ,
 *    https://help.sap.com/docs/sap-ai-core/generative-ai/example-payloads-for-inferencing-sap-abap-1
 *  - model catalog:         GET {AI_API_URL}/v2/lm/scenarios/foundation-models/models
 *    https://help.sap.com/docs/sap-ai-core/generative-ai/choose-model
 * Orchestration V1 (`{deploymentUrl}/completion`) is EOL 2026-10-31 and is never implemented here.
 * SAP-ABAP-1 rejects any request carrying a `role: "system"` message (confirmed change, 2026-04-27)
 * — completion() refuses to send one whenever the target model is sap-abap-1.
 */
import { readFileSync } from "node:fs";

import { toolError, invalidInput } from "../errors.js";

// ---------------------------------------------------------------------------
// Config / service key
// ---------------------------------------------------------------------------

export interface GenAiServiceKey {
  clientid: string;
  clientsecret: string;
  /** XSUAA base URL; the token endpoint is `${url}/oauth/token`. */
  url: string;
  serviceurls: {
    /** SAP AI Core API base, e.g. https://api.ai.<region>.ml.hana.ondemand.com */
    AI_API_URL: string;
  };
}

export interface GenAiEnvConfig {
  serviceKey: GenAiServiceKey;
  resourceGroup: string;
  orchestrationUrl?: string;
  tokenTimeoutMs: number;
  requestTimeoutMs: number;
}

const DEFAULT_TOKEN_TIMEOUT_MS = 15_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
/** Refresh the cached token this far ahead of its stated expiry. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidServiceKey(value: unknown): value is GenAiServiceKey {
  if (!isRecord(value)) return false;
  if (typeof value["clientid"] !== "string" || value["clientid"].length === 0) return false;
  if (typeof value["clientsecret"] !== "string" || value["clientsecret"].length === 0) return false;
  if (typeof value["url"] !== "string" || value["url"].length === 0) return false;
  const serviceurls = value["serviceurls"];
  if (!isRecord(serviceurls)) return false;
  return typeof serviceurls["AI_API_URL"] === "string" && serviceurls["AI_API_URL"].length > 0;
}

/**
 * Load and parse the SAP AI Core service key from the environment. Reads either
 * `AICORE_SERVICE_KEY` (the JSON text itself) or `AICORE_SERVICE_KEY_FILE` (a path to it — this
 * opt-in online entry point is explicitly allowed to read that one file; the default stdio server
 * never reads user-supplied paths). Never echoes the key's contents into an error message.
 */
export function loadServiceKeyFromEnv(env: NodeJS.ProcessEnv = process.env): GenAiServiceKey {
  const inline = env["AICORE_SERVICE_KEY"];
  const filePath = env["AICORE_SERVICE_KEY_FILE"];

  let raw: string;
  if (inline !== undefined && inline.trim().length > 0) {
    raw = inline;
  } else if (filePath !== undefined && filePath.trim().length > 0) {
    try {
      raw = readFileSync(filePath, "utf8");
    } catch {
      throw toolError(
        "not_configured",
        `AICORE_SERVICE_KEY_FILE is set but the file could not be read: ${filePath}`,
        { hint: "Check the path and file permissions, or set AICORE_SERVICE_KEY to the JSON text directly." },
      );
    }
  } else {
    throw toolError(
      "not_configured",
      "No SAP AI Core service key is configured (AICORE_SERVICE_KEY / AICORE_SERVICE_KEY_FILE are both unset).",
      {
        hint:
          "Create an SAP AI Core service instance/key on the extended plan and set AICORE_SERVICE_KEY to its " +
          "JSON, or AICORE_SERVICE_KEY_FILE to a path containing it. See docs/GENAI.md.",
      },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw toolError("not_configured", "The configured SAP AI Core service key is not valid JSON.");
  }
  if (!isValidServiceKey(parsed)) {
    throw toolError(
      "not_configured",
      "The configured SAP AI Core service key is missing required fields " +
        "(clientid, clientsecret, url, serviceurls.AI_API_URL).",
    );
  }
  return parsed;
}

function parseTimeoutEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Resolve the full genai config from the environment (service key, resource group, timeouts). */
export function resolveConfigFromEnv(env: NodeJS.ProcessEnv = process.env): GenAiEnvConfig {
  const serviceKey = loadServiceKeyFromEnv(env);
  const resourceGroup = env["AICORE_RESOURCE_GROUP"]?.trim() || "default";
  const orchestrationUrl = env["AICORE_ORCHESTRATION_URL"]?.trim();
  return {
    serviceKey,
    resourceGroup,
    ...(orchestrationUrl !== undefined && orchestrationUrl.length > 0 ? { orchestrationUrl } : {}),
    tokenTimeoutMs: parseTimeoutEnv(env, "AICORE_TOKEN_TIMEOUT_MS", DEFAULT_TOKEN_TIMEOUT_MS),
    requestTimeoutMs: parseTimeoutEnv(env, "AICORE_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS),
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

type FetchLike = typeof fetch;

function trimTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

interface FetchJsonResult {
  status: number;
  json: unknown;
}

async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  context: string,
): Promise<FetchJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw toolError("timeout", `Timed out after ${timeoutMs}ms while ${context}.`);
    }
    throw toolError("network", `Network error while ${context} — could not reach SAP AI Core.`);
  } finally {
    clearTimeout(timer);
  }

  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "";
  }
  let json: unknown;
  if (text.length > 0) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  return { status: response.status, json };
}

/** Map an SAP AI Core HTTP status to the agent-ergonomic error kind (never throws on 2xx). */
function classifyStatus(status: number, context: string): never {
  if (status === 401 || status === 403) {
    throw toolError("auth", `SAP AI Core returned HTTP ${status} (unauthorized) while ${context}.`, {
      hint: "Check that the service key is current, unexpired, and scoped to this AI Resource Group.",
    });
  }
  if (status === 429) {
    throw toolError("rate_limit", `SAP AI Core returned HTTP 429 (rate limited) while ${context}.`, {
      hint: "Wait and retry, or reduce call volume.",
    });
  }
  if (status >= 500) {
    throw toolError("network", `SAP AI Core returned HTTP ${status} (server error) while ${context}.`);
  }
  throw toolError("internal", `SAP AI Core returned HTTP ${status} while ${context}.`);
}

// ---------------------------------------------------------------------------
// Completion (Orchestration V2 /v2/completion)
// ---------------------------------------------------------------------------

export interface CompletionMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompletionModel {
  name: string;
  version: string;
  temperature: number;
  maxTokens: number;
}

export interface CompletionRequest {
  template: CompletionMessage[];
  model: CompletionModel;
}

export interface CompletionUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CompletionResult {
  requestId: string;
  content: string;
  model: string;
  version: string;
  finishReason: string;
  usage: CompletionUsage;
}

function extractResources(json: unknown): Record<string, unknown>[] {
  if (!isRecord(json)) return [];
  const resources = json["resources"];
  if (!Array.isArray(resources)) return [];
  return resources.filter(isRecord);
}

// ---------------------------------------------------------------------------
// Model catalog (GET /v2/lm/scenarios/foundation-models/models)
// ---------------------------------------------------------------------------

export interface ModelVersionSummary {
  name: string;
  isLatest: boolean;
  contextLength?: number;
  deprecated?: boolean;
  retirementDate?: string;
}

export interface ModelSummary {
  model: string;
  provider: string;
  executableId: string;
  allowedScenarios: string[];
  versions: ModelVersionSummary[];
}

export interface ModelListResult {
  resourceGroup: string;
  count: number;
  models: ModelSummary[];
}

function toVersionSummary(raw: unknown): ModelVersionSummary | undefined {
  if (!isRecord(raw) || typeof raw["name"] !== "string") return undefined;
  const summary: ModelVersionSummary = {
    name: raw["name"],
    isLatest: raw["isLatest"] === true,
  };
  if (typeof raw["contextLength"] === "number") summary.contextLength = raw["contextLength"];
  if (typeof raw["deprecated"] === "boolean") summary.deprecated = raw["deprecated"];
  if (typeof raw["retirementDate"] === "string" && raw["retirementDate"].length > 0) {
    summary.retirementDate = raw["retirementDate"];
  }
  return summary;
}

function toModelSummary(raw: Record<string, unknown>): ModelSummary | undefined {
  if (typeof raw["model"] !== "string" || typeof raw["provider"] !== "string") return undefined;
  const allowedScenariosRaw = Array.isArray(raw["allowedScenarios"]) ? raw["allowedScenarios"] : [];
  const allowedScenarios = [
    ...new Set(
      allowedScenariosRaw
        .filter(isRecord)
        .map((entry) => entry["scenarioId"])
        .filter((v): v is string => typeof v === "string"),
    ),
  ];
  const versionsRaw = Array.isArray(raw["versions"]) ? raw["versions"] : [];
  const versions = versionsRaw.map(toVersionSummary).filter((v): v is ModelVersionSummary => v !== undefined);
  return {
    model: raw["model"],
    provider: raw["provider"],
    executableId: typeof raw["executableId"] === "string" ? raw["executableId"] : "",
    allowedScenarios,
    versions,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface GenAiClientOptions {
  serviceKey: GenAiServiceKey;
  resourceGroup?: string;
  /** Explicit deployment URL override — skips the /v2/lm/deployments discovery call entirely. */
  orchestrationUrl?: string;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: FetchLike;
  tokenTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export class GenAiClient {
  private readonly serviceKey: GenAiServiceKey;
  private readonly resourceGroup: string;
  private readonly explicitOrchestrationUrl: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly tokenTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  private tokenCache: { accessToken: string; expiresAt: number } | undefined;
  private discoveredOrchestrationUrl: string | undefined;

  constructor(options: GenAiClientOptions) {
    this.serviceKey = options.serviceKey;
    this.resourceGroup = options.resourceGroup ?? "default";
    this.explicitOrchestrationUrl =
      options.orchestrationUrl !== undefined ? trimTrailingSlash(options.orchestrationUrl) : undefined;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.tokenTimeoutMs = options.tokenTimeoutMs ?? DEFAULT_TOKEN_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  /** XSUAA client-credentials token, cached in memory until shortly before it expires. */
  async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache !== undefined && this.tokenCache.expiresAt > now) {
      return this.tokenCache.accessToken;
    }

    const tokenUrl = `${trimTrailingSlash(this.serviceKey.url)}/oauth/token`;
    const basicAuth = Buffer.from(`${this.serviceKey.clientid}:${this.serviceKey.clientsecret}`).toString("base64");
    const { status, json } = await fetchJson(
      this.fetchImpl,
      tokenUrl,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${basicAuth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      },
      this.tokenTimeoutMs,
      "requesting an SAP AI Core access token",
    );
    if (status < 200 || status >= 300) classifyStatus(status, "requesting an SAP AI Core access token");

    const accessToken = isRecord(json) && typeof json["access_token"] === "string" ? json["access_token"] : undefined;
    if (accessToken === undefined || accessToken.length === 0) {
      throw toolError("auth", "SAP AI Core's token endpoint responded without an access_token.");
    }
    const expiresIn = isRecord(json) && typeof json["expires_in"] === "number" ? json["expires_in"] : undefined;
    const ttlMs = (expiresIn !== undefined && expiresIn > 0 ? expiresIn : 300) * 1000;
    this.tokenCache = { accessToken, expiresAt: now + Math.max(ttlMs - TOKEN_SAFETY_MARGIN_MS, 0) };
    return accessToken;
  }

  /**
   * Resolve the orchestration deployment base URL: the explicit `AICORE_ORCHESTRATION_URL`
   * override if one was configured, otherwise the tenant's default RUNNING orchestration
   * deployment, discovered once and cached in memory for the life of this client.
   */
  async resolveOrchestrationUrl(): Promise<string> {
    if (this.explicitOrchestrationUrl !== undefined) return this.explicitOrchestrationUrl;
    if (this.discoveredOrchestrationUrl !== undefined) return this.discoveredOrchestrationUrl;

    const token = await this.getAccessToken();
    const url = `${trimTrailingSlash(this.serviceKey.serviceurls.AI_API_URL)}/v2/lm/deployments`;
    const { status, json } = await fetchJson(
      this.fetchImpl,
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "AI-Resource-Group": this.resourceGroup },
      },
      this.requestTimeoutMs,
      "discovering the orchestration deployment URL",
    );
    if (status < 200 || status >= 300) classifyStatus(status, "discovering the orchestration deployment URL");

    const running = extractResources(json).filter(
      (entry) => entry["status"] === "RUNNING" && typeof entry["deploymentUrl"] === "string" && entry["deploymentUrl"].length > 0,
    );
    const preferred =
      running.find((entry) => entry["configurationName"] === "defaultOrchestrationConfig") ??
      running.find((entry) => entry["scenarioId"] === "llm-orchestration") ??
      running[0];
    if (preferred === undefined) {
      throw toolError(
        "not_configured",
        `No RUNNING orchestration deployment was found in AI Resource Group "${this.resourceGroup}".`,
        {
          hint:
            "Create one (SAP Help: \"Create a Deployment for Orchestration\") or set AICORE_ORCHESTRATION_URL " +
            "to an existing orchestration deployment's URL.",
        },
      );
    }
    const deploymentUrl = trimTrailingSlash(preferred["deploymentUrl"] as string);
    this.discoveredOrchestrationUrl = deploymentUrl;
    return deploymentUrl;
  }

  /** POST {deploymentUrl}/v2/completion. Refuses a `role: "system"` message for sap-abap-1. */
  async completion(request: CompletionRequest): Promise<CompletionResult> {
    if (request.template.length === 0) {
      throw invalidInput("completion() requires at least one template message.");
    }
    const isSapAbap1 = request.model.name.toLowerCase() === "sap-abap-1";
    if (isSapAbap1 && request.template.some((m) => (m.role as string) === "system")) {
      throw invalidInput(
        'sap-abap-1 rejects a "system" role message (its system prompt is predefined and managed by SAP) — ' +
          "fold any extra instructions into the user message instead.",
      );
    }

    const token = await this.getAccessToken();
    const baseUrl = await this.resolveOrchestrationUrl();
    const body = {
      config: {
        modules: {
          prompt_templating: {
            prompt: { template: request.template.map((m) => ({ role: m.role, content: m.content })) },
            model: {
              name: request.model.name,
              version: request.model.version,
              params: { temperature: request.model.temperature, max_tokens: request.model.maxTokens },
            },
          },
        },
      },
    };

    const { status, json } = await fetchJson(
      this.fetchImpl,
      `${baseUrl}/v2/completion`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "AI-Resource-Group": this.resourceGroup,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      this.requestTimeoutMs,
      `calling ${request.model.name}`,
    );
    if (status < 200 || status >= 300) classifyStatus(status, `calling ${request.model.name}`);

    const finalResult = isRecord(json) ? json["final_result"] : undefined;
    const choices = isRecord(finalResult) && Array.isArray(finalResult["choices"]) ? finalResult["choices"] : [];
    const firstChoice = choices.length > 0 ? choices[0] : undefined;
    const message = isRecord(firstChoice) ? firstChoice["message"] : undefined;
    const content = isRecord(message) && typeof message["content"] === "string" ? message["content"] : undefined;
    if (content === undefined) {
      throw toolError("internal", "SAP AI Core's completion response did not contain final_result.choices[0].message.content.");
    }

    const usageRaw = isRecord(finalResult) ? finalResult["usage"] : undefined;
    const usage: CompletionUsage = {
      promptTokens: isRecord(usageRaw) && typeof usageRaw["prompt_tokens"] === "number" ? usageRaw["prompt_tokens"] : 0,
      completionTokens:
        isRecord(usageRaw) && typeof usageRaw["completion_tokens"] === "number" ? usageRaw["completion_tokens"] : 0,
      totalTokens: isRecord(usageRaw) && typeof usageRaw["total_tokens"] === "number" ? usageRaw["total_tokens"] : 0,
    };

    return {
      requestId: isRecord(json) && typeof json["request_id"] === "string" ? json["request_id"] : "",
      content,
      model: isRecord(finalResult) && typeof finalResult["model"] === "string" ? finalResult["model"] : request.model.name,
      version: request.model.version,
      finishReason:
        isRecord(firstChoice) && typeof firstChoice["finish_reason"] === "string" ? firstChoice["finish_reason"] : "",
      usage,
    };
  }

  /** GET {AI_API_URL}/v2/lm/scenarios/foundation-models/models, optionally substring-filtered. */
  async listModels(filter?: string): Promise<ModelListResult> {
    const token = await this.getAccessToken();
    const url = `${trimTrailingSlash(this.serviceKey.serviceurls.AI_API_URL)}/v2/lm/scenarios/foundation-models/models`;
    const { status, json } = await fetchJson(
      this.fetchImpl,
      url,
      {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "AI-Resource-Group": this.resourceGroup },
      },
      this.requestTimeoutMs,
      "listing Generative AI Hub models",
    );
    if (status < 200 || status >= 300) classifyStatus(status, "listing Generative AI Hub models");

    const models = extractResources(json)
      .map(toModelSummary)
      .filter((m): m is ModelSummary => m !== undefined);
    const needle = filter?.trim().toLowerCase();
    const filtered =
      needle === undefined || needle.length === 0
        ? models
        : models.filter((m) => m.model.toLowerCase().includes(needle) || m.provider.toLowerCase().includes(needle));

    return { resourceGroup: this.resourceGroup, count: filtered.length, models: filtered };
  }
}

// ---------------------------------------------------------------------------
// Process-lifetime singleton used by src/genai/tools.ts
// ---------------------------------------------------------------------------

let sharedClient: GenAiClient | undefined;

/** Lazily build (once) and return the shared client, configured from the environment. */
export function getSharedGenAiClient(env: NodeJS.ProcessEnv = process.env): GenAiClient {
  if (sharedClient === undefined) {
    const config = resolveConfigFromEnv(env);
    sharedClient = new GenAiClient({
      serviceKey: config.serviceKey,
      resourceGroup: config.resourceGroup,
      ...(config.orchestrationUrl !== undefined ? { orchestrationUrl: config.orchestrationUrl } : {}),
      tokenTimeoutMs: config.tokenTimeoutMs,
      requestTimeoutMs: config.requestTimeoutMs,
    });
  }
  return sharedClient;
}

/** Test-only: forget the memoized singleton so the next call re-reads env/fetch. */
export function resetSharedGenAiClientForTests(): void {
  sharedClient = undefined;
}
