# Use abap-mcp with ChatGPT and Codex

abap-mcp supports two deliberately separate deployment modes:

| Surface | Transport | Where ABAP is analyzed | Recommended setup |
| --- | --- | --- | --- |
| Codex CLI / IDE | local stdio | your machine | `codex mcp add` |
| ChatGPT desktop | local stdio | your machine | shared Codex config or Settings UI |
| Codex plugin | local stdio + skills | your machine | repo marketplace |
| ChatGPT web | remote Streamable HTTP | the endpoint operator's machine | HTTPS `/mcp` |

## Local: one command for Codex and ChatGPT desktop

Install [Node.js 20+](https://nodejs.org), then run:

```bash
codex mcp add abap-mcp -- npx -y abap-mcp
```

Codex CLI, the Codex IDE extension, and ChatGPT desktop share MCP configuration on the same host.
Restart the desktop app or IDE extension after adding the server. Use `/mcp` to verify the
connection.

If you prefer the ChatGPT desktop UI:

1. Open **Settings → MCP servers**.
2. Select **Add server** and choose **STDIO**.
3. Use `abap-mcp` as the name, `npx` as the command, and `-y abap-mcp` as the arguments.
4. Save and restart.

The server cannot resolve workspace paths by itself. Codex or ChatGPT must read a requested file
and send its source text in the tool call. Start with: “List your ABAP tools,” or “Review this ABAP
class with `lint_abap`.”

## Codex plugin: tools plus reusable workflows

The repository is also a Codex marketplace. Install it with:

```bash
codex plugin marketplace add palimkarakshay/abap-mcp
codex plugin add abap-mcp@abap-mcp
```

The plugin starts the same local stdio server and adds three discoverable skills:

- `abap-review` for an evidence-backed review and before/after verification;
- `abap-mentor` for guided ABAP/RAP explanations; and
- `abap-migration-plan` for a phased ABAP Cloud backlog.

For a clone that is not yet published, add the repository path instead of the GitHub slug:

```bash
codex plugin marketplace add /absolute/path/to/abap-mcp
codex plugin add abap-mcp@abap-mcp
```

## Remote: ChatGPT web

ChatGPT web uses remote MCP-backed tools. It does not read local Codex configuration or start the
stdio command. This project supplies a Streamable HTTP endpoint but intentionally does not deploy
one for you.

Build and run it on loopback:

```bash
npm install
npm run build
ABAP_MCP_HTTP_BEARER_TOKEN=<strong-random-token> npm run start:http
```

The MCP URL is `http://127.0.0.1:3000/mcp`; `/healthz` is an unauthenticated liveness probe. Put
the MCP endpoint behind an HTTPS reverse proxy or a secure development tunnel. Keep the raw
process on loopback when the proxy runs on the same machine. The built-in bearer mode is useful
for direct Codex Streamable HTTP connections and private development.

For a hosting platform that requires a non-loopback listener, set `ABAP_MCP_HTTP_HOST`
explicitly. The process refuses an unauthenticated non-loopback listener unless
`ABAP_MCP_HTTP_ALLOW_UNAUTHENTICATED_NETWORK=true` is explicitly set because an upstream gateway
already enforces access and abuse controls, or because the operator has deliberately chosen an
anonymous read-only endpoint.

### HTTP controls

| Variable | Default | Purpose |
| --- | --- | --- |
| `ABAP_MCP_HTTP_HOST` | `127.0.0.1` | listen address |
| `ABAP_MCP_HTTP_PORT` | `3000` | listen port |
| `ABAP_MCP_HTTP_BEARER_TOKEN` | unset | shared bearer token required by `/mcp` |
| `ABAP_MCP_HTTP_ALLOWED_ORIGINS` | none | comma-separated browser origins allowed to call `/mcp`; server-to-server calls normally omit `Origin` |
| `ABAP_MCP_HTTP_MAX_BODY_BYTES` | `4194304` | maximum JSON body size |
| `ABAP_MCP_HTTP_MAX_CONCURRENT_REQUESTS` | `4` | in-process concurrency cap |
| `ABAP_MCP_HTTP_RATE_LIMIT_REQUESTS` | `60` | requests per client address per window |
| `ABAP_MCP_HTTP_RATE_LIMIT_WINDOW_MS` | `60000` | fixed rate-limit window |
| `ABAP_MCP_HTTP_ALLOW_UNAUTHENTICATED_NETWORK` | `false` | opt out only when an upstream proxy authenticates |

The built-in rate limiter is per process and per socket address. Behind a reverse proxy, clients
may all appear under the proxy address; multi-instance or proxied deployments should enforce the
real client limit at the gateway. The server does not log source text, arguments, results, or
request bodies. Review [PRIVACY.md](../PRIVACY.md) before hosting other people's code.

Published ChatGPT plugins may be anonymous when their tools are read-only. If the published
endpoint is authenticated, implement the MCP OAuth 2.1 discovery flow expected by ChatGPT; the
built-in shared bearer check is not a replacement for that publishing requirement.

### Connect in ChatGPT developer mode

1. In ChatGPT, open **Settings → Security and login** and enable **Developer mode** (availability
   can depend on account and workspace policy).
2. Open **Plugins**, select the plus button, and create a connection.
3. Enter the public HTTPS URL including `/mcp`, using anonymous access or a supported OAuth flow.
4. Review the ten discovered tools and test representative requests before sharing the connection.

For local development, use OpenAI's secure MCP tunnel or another HTTPS forwarding service rather
than making a laptop port public. A public plugin submission requires a stable public HTTPS MCP
endpoint. After ChatGPT registers that remote connection and provides its real `plugin_asdk_app…`
identifier, the plugin can add an `.app.json`. This repository does not ship a placeholder ID.

## What the host should route where

- General review or a pasted snippet → `lint_abap`
- ABAP Cloud / Clean Core assessment → `check_cloud_readiness`
- Actionable migration backlog → `plan_cloud_migration`
- Named SAP object release status → `check_released_api`
- Before/after proof → `compare_abap`
- New managed RAP object → `scaffold_rap_bo`
- Large-object navigation → `get_abap_outline`

The MCP initialization response also publishes these cross-tool instructions so Codex can use
them during tool selection. Released-API observations are snapshot-dated and partial; a target
system's ATC remains authoritative.
