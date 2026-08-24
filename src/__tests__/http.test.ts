import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { afterEach, describe, expect, it } from "vitest";

import { startHttpServer, type RunningHttpServer } from "../http.js";

const runningServers: RunningHttpServer[] = [];

async function start(
  options: Parameters<typeof startHttpServer>[0] = {},
): Promise<RunningHttpServer> {
  const running = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    rateLimit: false,
    ...options,
  });
  runningServers.push(running);
  return running;
}

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((running) => running.close()));
});

describe("Streamable HTTP server", () => {
  it("serves an unauthenticated health probe without exposing request data", async () => {
    const running = await start({ bearerToken: "health-does-not-need-this" });
    const response = await fetch(`${running.url}/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "ok",
      server: "abap-mcp",
      transport: "streamable-http",
    });
  });

  it("lists the real tool registry through the SDK Streamable HTTP client", async () => {
    const running = await start();
    const transport = new StreamableHTTPClientTransport(new URL(`${running.url}/mcp`));
    const client = new Client({ name: "http-test-client", version: "0.0.0" });

    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(10);
      expect(tools.map((tool) => tool.name)).toContain("check_cloud_readiness");
      expect(transport.sessionId).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it("requires the configured bearer token on the MCP endpoint", async () => {
    const running = await start({ bearerToken: "correct-horse-battery-staple" });
    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "raw-test", version: "0.0.0" },
      },
    };

    const denied = await fetch(`${running.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initialize),
    });
    expect(denied.status).toBe(401);
    expect(denied.headers.get("www-authenticate")).toContain("Bearer");

    const accepted = await fetch(`${running.url}/mcp`, {
      method: "POST",
      headers: {
        Authorization: "Bearer correct-horse-battery-staple",
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify(initialize),
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()) as { result?: unknown }).toHaveProperty("result");
  });

  it("rejects browser origins unless the operator explicitly allows them", async () => {
    const running = await start({ allowedOrigins: ["https://trusted.example"] });
    const request = (origin: string) =>
      fetch(`${running.url}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: origin },
        body: "{}",
      });

    expect((await request("https://untrusted.example")).status).toBe(403);
    const trusted = await request("https://trusted.example");
    expect(trusted.status).not.toBe(403);
    expect(trusted.headers.get("access-control-allow-origin")).toBe("https://trusted.example");
  });

  it("refuses an accidentally unauthenticated non-loopback listener", async () => {
    await expect(
      startHttpServer({ host: "0.0.0.0", port: 0, rateLimit: false }),
    ).rejects.toThrow("non-loopback listener requires bearerToken");
  });

  it("caps request bodies before parsing them", async () => {
    const running = await start({ maxBodyBytes: 64 });
    const response = await fetch(`${running.url}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "x".repeat(128) }),
    });

    expect(response.status).toBe(413);
    expect(await response.text()).toContain("exceeds 64 bytes");
  });

  it("rate-limits repeated MCP requests from one socket address", async () => {
    const running = await start({ rateLimit: { maxRequests: 1, windowMs: 60_000 } });
    const request = () =>
      fetch(`${running.url}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });

    const first = await request();
    expect(first.status).not.toBe(429);
    const second = await request();
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
