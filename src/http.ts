#!/usr/bin/env node

import { timingSafeEqual } from "node:crypto";
import {
  createServer as createNodeHttpServer,
  type IncomingMessage,
  type Server as NodeHttpServer,
  type ServerResponse,
} from "node:http";
import { isIP, type AddressInfo } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

import { SERVER_NAME, SERVER_VERSION, buildServer } from "./server.js";

export const DEFAULT_HTTP_HOST = "127.0.0.1";
export const DEFAULT_HTTP_PORT = 3000;
export const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
export const DEFAULT_MAX_CONCURRENT_REQUESTS = 4;
export const DEFAULT_RATE_LIMIT = Object.freeze({ maxRequests: 60, windowMs: 60_000 });

export interface HttpRateLimitOptions {
  /** Requests accepted from one socket address during each fixed window. */
  maxRequests: number;
  /** Fixed-window duration in milliseconds. */
  windowMs: number;
}

export interface HttpServerOptions {
  /** Listen address. Defaults to loopback; choose a non-loopback address explicitly. */
  host?: string;
  /** Listen port. Use 0 to ask the OS for an ephemeral port (useful in tests). */
  port?: number;
  /** Optional shared bearer token required by /mcp. Health checks remain unauthenticated. */
  bearerToken?: string;
  /** Browser origins permitted to call /mcp. Requests without Origin are server-to-server. */
  allowedOrigins?: readonly string[];
  /** Explicit escape hatch when authentication is enforced by an upstream proxy. */
  allowUnauthenticatedNetwork?: boolean;
  /** Maximum decoded JSON request body size. Defaults to 4 MiB. */
  maxBodyBytes?: number;
  /** Maximum MCP requests being processed at once. Defaults to 4. */
  maxConcurrentRequests?: number;
  /** Per-socket-address fixed-window limit. Set false only behind another rate limiter. */
  rateLimit?: HttpRateLimitOptions | false;
}

export interface RunningHttpServer {
  server: NodeHttpServer;
  host: string;
  port: number;
  /** Base URL without the /mcp path. */
  url: string;
  close(): Promise<void>;
}

interface ResolvedHandlerOptions {
  bearerToken?: string;
  allowedOrigins: ReadonlySet<string>;
  maxBodyBytes: number;
  maxConcurrentRequests: number;
  rateLimit: HttpRateLimitOptions | false;
}

interface RateWindow {
  count: number;
  startedAt: number;
}

class PayloadTooLargeError extends Error {}
class InvalidJsonError extends Error {}

function requireInteger(name: string, value: number, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer >= ${minimum}`);
  }
  return value;
}

function resolveHandlerOptions(options: HttpServerOptions): ResolvedHandlerOptions {
  const maxBodyBytes = requireInteger(
    "maxBodyBytes",
    options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
    1,
  );
  const maxConcurrentRequests = requireInteger(
    "maxConcurrentRequests",
    options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS,
    1,
  );
  const rateLimit = options.rateLimit ?? DEFAULT_RATE_LIMIT;
  if (rateLimit !== false) {
    requireInteger("rateLimit.maxRequests", rateLimit.maxRequests, 1);
    requireInteger("rateLimit.windowMs", rateLimit.windowMs, 1);
  }
  if (options.bearerToken === "") {
    throw new RangeError("bearerToken must be non-empty when provided");
  }

  return {
    ...(options.bearerToken === undefined ? {} : { bearerToken: options.bearerToken }),
    allowedOrigins: new Set(options.allowedOrigins ?? []),
    maxBodyBytes,
    maxConcurrentRequests,
    rateLimit,
  };
}

function commonHeaders(res: ServerResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>> = {},
  headOnly = false,
): void {
  if (res.headersSent) return;
  commonHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(headOnly ? undefined : JSON.stringify(body));
}

function sendMcpError(
  res: ServerResponse,
  status: number,
  message: string,
  headers: Readonly<Record<string, string>> = {},
): void {
  sendJson(
    res,
    status,
    { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
    headers,
  );
}

function tokenMatches(authorization: string | undefined, expected: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const declaredLength = req.headers["content-length"];
  if (declaredLength !== undefined) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new InvalidJsonError("Invalid Content-Length header");
    }
    if (parsedLength > maxBytes) {
      req.resume();
      throw new PayloadTooLargeError();
    }
  }

  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    bytes += buffer.byteLength;
    if (bytes > maxBytes) {
      req.resume();
      throw new PayloadTooLargeError();
    }
    chunks.push(buffer);
  }
  if (bytes === 0) throw new InvalidJsonError("Request body must contain JSON");

  try {
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")) as unknown;
  } catch {
    throw new InvalidJsonError("Request body must contain valid JSON");
  }
}

function parsePositiveEnvInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key];
  if (raw === undefined) return fallback;
  return requireInteger(key, Number(raw), 1);
}

function parseBooleanEnv(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  if (raw === undefined) return false;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new RangeError(`${key} must be true, false, 1, or 0`);
}

function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host === "::1") return true;
  return isIP(host) === 4 && host.split(".")[0] === "127";
}

/** Resolve executable configuration without reading config files or secrets from disk. */
export function httpServerOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): HttpServerOptions {
  const host = env["ABAP_MCP_HTTP_HOST"] ?? DEFAULT_HTTP_HOST;
  const port = parsePositiveEnvInteger(env, "ABAP_MCP_HTTP_PORT", DEFAULT_HTTP_PORT);
  const maxBodyBytes = parsePositiveEnvInteger(
    env,
    "ABAP_MCP_HTTP_MAX_BODY_BYTES",
    DEFAULT_MAX_BODY_BYTES,
  );
  const maxConcurrentRequests = parsePositiveEnvInteger(
    env,
    "ABAP_MCP_HTTP_MAX_CONCURRENT_REQUESTS",
    DEFAULT_MAX_CONCURRENT_REQUESTS,
  );
  const maxRequests = parsePositiveEnvInteger(
    env,
    "ABAP_MCP_HTTP_RATE_LIMIT_REQUESTS",
    DEFAULT_RATE_LIMIT.maxRequests,
  );
  const windowMs = parsePositiveEnvInteger(
    env,
    "ABAP_MCP_HTTP_RATE_LIMIT_WINDOW_MS",
    DEFAULT_RATE_LIMIT.windowMs,
  );
  const bearerToken = env["ABAP_MCP_HTTP_BEARER_TOKEN"];
  const allowedOrigins = env["ABAP_MCP_HTTP_ALLOWED_ORIGINS"]
    ?.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    host,
    port,
    ...(bearerToken === undefined ? {} : { bearerToken }),
    ...(allowedOrigins === undefined ? {} : { allowedOrigins }),
    allowUnauthenticatedNetwork: parseBooleanEnv(
      env,
      "ABAP_MCP_HTTP_ALLOW_UNAUTHENTICATED_NETWORK",
    ),
    maxBodyBytes,
    maxConcurrentRequests,
    rateLimit: { maxRequests, windowMs },
  };
}

/**
 * Create (but do not listen with) the guarded Node HTTP server.
 *
 * Each POST receives a fresh MCP server and stateless transport. Request bodies are
 * never logged, persisted, or shared between requests.
 */
export function createHttpServer(options: HttpServerOptions = {}): NodeHttpServer {
  const resolved = resolveHandlerOptions(options);
  const windows = new Map<string, RateWindow>();
  let activeRequests = 0;
  let lastRateSweep = Date.now();

  const isRateLimited = (address: string, now: number): { limited: boolean; retryAfter: number } => {
    if (resolved.rateLimit === false) return { limited: false, retryAfter: 0 };
    const { maxRequests, windowMs } = resolved.rateLimit;

    if (now - lastRateSweep >= windowMs) {
      for (const [key, value] of windows) {
        if (now - value.startedAt >= windowMs) windows.delete(key);
      }
      lastRateSweep = now;
    }

    const existing = windows.get(address);
    if (existing === undefined || now - existing.startedAt >= windowMs) {
      windows.set(address, { count: 1, startedAt: now });
      return { limited: false, retryAfter: 0 };
    }
    existing.count += 1;
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - existing.startedAt)) / 1000));
    return { limited: existing.count > maxRequests, retryAfter };
  };

  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    commonHeaders(res);
    let pathname: string;
    try {
      pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    } catch {
      sendJson(res, 400, { error: "Bad request URL" });
      return;
    }

    if (pathname === "/healthz" && (req.method === "GET" || req.method === "HEAD")) {
      sendJson(
        res,
        200,
        { status: "ok", server: SERVER_NAME, version: SERVER_VERSION, transport: "streamable-http" },
        {},
        req.method === "HEAD",
      );
      return;
    }

    if (pathname !== "/mcp") {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !resolved.allowedOrigins.has(origin)) {
      sendMcpError(res, 403, "Browser origin is not allowed");
      return;
    }
    if (origin !== undefined) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, MCP-Protocol-Version");
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendMcpError(res, 405, "Method not allowed; this stateless endpoint accepts POST", {
        Allow: "POST, OPTIONS",
      });
      return;
    }

    const rate = isRateLimited(req.socket.remoteAddress ?? "unknown", Date.now());
    if (rate.limited) {
      sendMcpError(res, 429, "Rate limit exceeded", { "Retry-After": String(rate.retryAfter) });
      return;
    }

    if (
      resolved.bearerToken !== undefined &&
      !tokenMatches(req.headers.authorization, resolved.bearerToken)
    ) {
      sendMcpError(res, 401, "Missing or invalid bearer token", {
        "WWW-Authenticate": 'Bearer realm="abap-mcp"',
      });
      return;
    }

    if (activeRequests >= resolved.maxConcurrentRequests) {
      sendMcpError(res, 503, "Server is at its concurrent request limit", { "Retry-After": "1" });
      return;
    }

    activeRequests += 1;
    try {
      let body: unknown;
      try {
        body = await readJsonBody(req, resolved.maxBodyBytes);
      } catch (error) {
        if (error instanceof PayloadTooLargeError) {
          sendMcpError(res, 413, `Request body exceeds ${resolved.maxBodyBytes} bytes`, {
            Connection: "close",
          });
          return;
        }
        if (error instanceof InvalidJsonError) {
          sendMcpError(res, 400, error.message);
          return;
        }
        throw error;
      }

      const mcpServer = buildServer();
      const transport = new StreamableHTTPServerTransport({
        enableJsonResponse: true,
      });
      try {
        // SDK 1.30's Node wrapper implements Transport at runtime, but its accessor
        // declarations are incompatible with exactOptionalPropertyTypes.
        await mcpServer.connect(transport as unknown as Transport);
        await transport.handleRequest(req, res, body);
      } finally {
        await mcpServer.close().catch(() => undefined);
      }
    } finally {
      activeRequests -= 1;
    }
  };

  const server = createNodeHttpServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) {
        sendMcpError(res, 500, "Internal server error");
      } else if (!res.writableEnded) {
        res.destroy();
      }
    });
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

/** Create and start the guarded HTTP server. */
export async function startHttpServer(options: HttpServerOptions = {}): Promise<RunningHttpServer> {
  const host = options.host ?? DEFAULT_HTTP_HOST;
  const port = requireInteger("port", options.port ?? DEFAULT_HTTP_PORT, 0);
  if (
    !isLoopbackHost(host) &&
    options.bearerToken === undefined &&
    options.allowUnauthenticatedNetwork !== true
  ) {
    throw new Error(
      "A non-loopback listener requires bearerToken, or allowUnauthenticatedNetwork=true when an upstream proxy enforces authentication",
    );
  }
  const server = createHttpServer(options);

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveListen();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    throw new Error("HTTP server did not expose a TCP address");
  }
  const bound = address as AddressInfo;
  const urlHost = bound.address.includes(":") ? `[${bound.address}]` : bound.address;

  return {
    server,
    host: bound.address,
    port: bound.port,
    url: `http://${urlHost}:${bound.port}`,
    close: async () => {
      if (!server.listening) return;
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
      });
    },
  };
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  startHttpServer(httpServerOptionsFromEnv())
    .then((running) => {
      console.error(`${SERVER_NAME} Streamable HTTP listening at ${running.url}/mcp`);
      let stopping = false;
      const stop = (): void => {
        if (stopping) return;
        stopping = true;
        void running.close().finally(() => process.exit(0));
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`${SERVER_NAME} HTTP startup failed: ${message}`);
      process.exitCode = 1;
    });
}
