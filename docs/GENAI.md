# abap-mcp-genai — the online, opt-in companion

`abap-mcp-genai` is a **separate binary** from the offline `abap-mcp` server, shipped from this
same repo (`src/genai.ts` + `src/genai/`). Nothing in the default `abap-mcp` server imports it,
and it registers nothing into the default server's tool list — the offline invariant in
`AGENTS.md` ("no outbound analysis network calls") holds exactly as before. You opt in to this
module explicitly, per-project, by adding a second MCP server entry.

It gives you two tools, both calling **your own** SAP AI Core tenant:

- `explain_with_sap_abap_1` — ask SAP's own `sap-abap-1` foundation model (fine-tuned on SAP
  S/4HANA ABAP and CDS) to explain a class, method, or code snippet in English.
- `list_genai_hub_models` — list the foundation models your tenant's Generative AI Hub currently
  has deployed, with context length, deprecation and retirement info.

Read this whole page before enabling it — it sends your ABAP source to SAP, not to abap-mcp's
authors, and it is not a substitute for the offline server's `lint_abap` / `check_cloud_readiness`.

## Why this is a separate module, not a flag on `abap-mcp`

`abap-mcp` is deliberately offline: it never fetches a URL and never needs a credential. Bolting
network calls onto that server behind a flag would make "is my source leaving this machine"
depend on a runtime setting nobody reliably checks before pasting in production code. Shipping a
second binary instead means the answer is visible in your MCP config: if `abap-mcp-genai` isn't
listed, nothing here ever runs.

## 1. Prerequisites — an SAP AI Core service key on the extended plan

You need an SAP BTP subaccount with an **SAP AI Core** service instance on the **extended**
service plan (the standard plan cannot reach the Orchestration service that `sap-abap-1` requires
— see [SAP Help: Service Plans](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/c7244c6a7e3b4ffc928a2564c216e7c7.html)
and [Update a Service Plan](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/924f892e67b7443fbb4476b3e81959b2.html)
if you currently have `standard`).

1. In the BTP cockpit, create (or reuse) an SAP AI Core service instance on the `extended` plan.
2. Create a **service key** for it
   ([SAP Help: Use a Service Key](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/use-a-service-key-3a97465bf6164400a4b5c1641007e3d6)).
   The key is a JSON document shaped like:
   ```json
   {
     "clientid": "sb-...",
     "clientsecret": "...",
     "url": "https://<subaccount>.authentication.<region>.hana.ondemand.com",
     "serviceurls": { "AI_API_URL": "https://api.ai.<region>.ml.hana.ondemand.com" }
   }
   ```
   Only these four fields are read; extra fields in a real service key are ignored.
3. Most tenants already have a **running orchestration deployment** in the default resource
   group — `abap-mcp-genai` discovers and caches it automatically (see §3). You only need to
   create one by hand
   ([SAP Help: Create a Deployment for Orchestration](https://help.sap.com/docs/sap-ai-core/sap-ai-core-service-guide/create-deployment-for-orchestration))
   if discovery reports none found.
4. `sap-abap-1` itself needs no separate deployment or subscription step beyond the above — it is
   selected per-request inside the orchestration call (§4), not deployed as its own model.

A 30-day free trial of `sap-abap-1` is available through the Generative AI Hub's "Try now"
feature if you want to test this module before committing to the extended plan.

## 2. Environment variables

| Variable | Required | Meaning |
|---|---|---|
| `AICORE_SERVICE_KEY` | one of these two | The service key JSON **as a string** (e.g. from a secrets manager). |
| `AICORE_SERVICE_KEY_FILE` | one of these two | Path to a file containing the service key JSON. `abap-mcp-genai` is the only part of this repo allowed to read an arbitrary file path — the offline server never does. |
| `AICORE_RESOURCE_GROUP` | no (default `"default"`) | The AI Resource Group to query and call into. |
| `AICORE_ORCHESTRATION_URL` | no | Skip deployment discovery and call this orchestration deployment URL directly. Use this if your tenant's default resource group has more than one running orchestration deployment and discovery picks the wrong one. |
| `AICORE_TOKEN_TIMEOUT_MS` | no (default `15000`) | Timeout for the XSUAA token request. |
| `AICORE_REQUEST_TIMEOUT_MS` | no (default `60000`) | Timeout for deployment discovery, completion, and model-listing calls. |

Exactly one of `AICORE_SERVICE_KEY` / `AICORE_SERVICE_KEY_FILE` must be set. If neither is set,
`abap-mcp-genai` prints a clear message to stderr and exits instead of starting a server that can
never do anything — it will not sit there silently returning `not_configured` errors on every call.

## 3. What actually happens on a call (so you can audit it)

1. **Token.** `abap-mcp-genai` exchanges your service key for a short-lived XSUAA access token
   (`POST {serviceKey.url}/oauth/token`, HTTP Basic `clientid:clientsecret`,
   `grant_type=client_credentials`), and caches it in memory until shortly before it expires.
2. **Orchestration URL.** Unless `AICORE_ORCHESTRATION_URL` is set, it calls
   `GET {AI_API_URL}/v2/lm/deployments` (header `AI-Resource-Group`) and picks the `RUNNING`
   deployment whose `configurationName` is `defaultOrchestrationConfig` (falling back to any
   `RUNNING` deployment reporting `scenarioId: "llm-orchestration"`) — then caches that URL in
   memory for the life of the process.
   ([SAP Help: Get an Orchestration Deployment URL](https://help.sap.com/docs/sap-ai-core/generative-ai/get-an-orchestration-deployment-url))
3. **Completion.** `explain_with_sap_abap_1` sends
   `POST {orchestrationDeploymentUrl}/v2/completion` with headers `Authorization: Bearer <token>`,
   `AI-Resource-Group: <group>`, `Content-Type: application/json`, and a body of the shape:
   ```json
   {
     "config": {
       "modules": {
         "prompt_templating": {
           "prompt": { "template": [{ "role": "user", "content": "…your code, wrapped in one of the three prompts below…" }] },
           "model": { "name": "sap-abap-1", "version": "latest", "params": { "temperature": 0.1, "max_tokens": 2000 } }
         }
       }
     }
   }
   ```
   This is Orchestration **V2** — the only version implemented. **V1** (`POST
   {deploymentUrl}/completion`) is deprecated and scheduled for decommissioning on
   **2026-10-31**; this module never speaks it.
   ([SAP Help: Orchestration Workflow V2](https://help.sap.com/docs/sap-ai-core/generative-ai/orchestration-workflow-v2),
   [SAP Help: Example Payloads for Inferencing SAP-ABAP-1](https://help.sap.com/docs/sap-ai-core/generative-ai/example-payloads-for-inferencing-sap-abap-1))
4. **Models.** `list_genai_hub_models` calls
   `GET {AI_API_URL}/v2/lm/scenarios/foundation-models/models` (same two headers) and returns the
   parsed catalog, filtered client-side if you passed `filter`.
   ([SAP Help: Choose a Model](https://help.sap.com/docs/sap-ai-core/generative-ai/choose-model))

The three prompt shapes `explain_with_sap_abap_1` builds (for `mode: "class"|"method"|"snippet"`)
mirror the **structure** — section count and headers — of SAP's own
["Prompting Templates" for SAP-ABAP-1](https://help.sap.com/docs/sap-ai-core/generative-ai/prompting-templates),
reworded in this module's own language (that page is CC-BY-4.0 via
[SAP-docs/sap-artificial-intelligence](https://github.com/SAP-docs/sap-artificial-intelligence);
see the attribution comment in `src/genai/tools.ts`).

## 4. Privacy contract — what leaves this machine

- **`explain_with_sap_abap_1` sends your ABAP source text over the network** to the SAP AI Core
  tenant identified by your own `AICORE_SERVICE_KEY` / `AICORE_SERVICE_KEY_FILE`. It goes to SAP
  infrastructure under your organization's own SAP contract — never to abap-mcp's authors, never
  to any third party this module chooses on your behalf.
- **`list_genai_hub_models` sends no source** — it is a metadata-only query against the same
  tenant (which models are deployed, their context length, deprecation status).
- This module **never logs** request bodies, prompts, source text, access tokens, or the service
  key itself — see the header comment in `src/genai/client.ts`. Errors surfaced back to the
  calling agent carry only an HTTP status and a generic description, never the response body or
  request content.
- What SAP AI Core itself does with the request beyond that (content-safety filtering, retention,
  region, any masking/grounding modules) is governed by your organization's own SAP AI Core
  contract and configuration, not by this module — check your tenant's own SAP AI Core / BTP
  documentation and data-processing agreement for what SAP itself does with it.
- This is the same boundary described in the repo's top-level `PRIVACY.md` for the offline server
  and `abap-mcp-http`, extended to cover this third, deliberately-separate transport.

## 5. Registering it with Claude Code / Codex

The `abap-mcp-genai` bin ships with the package, so registration mirrors the
offline server (`docs/COOKBOOK.md` §1), with the service key supplied as an environment variable
rather than left to the process's ambient environment:

```bash
# Claude Code (global) — the service key stays in your shell/secret manager, not in the command
claude mcp add abap-mcp-genai --env AICORE_SERVICE_KEY_FILE=/path/to/service-key.json -- npx -y abap-mcp-genai
```

```json
// per-repo .mcp.json
{
  "mcpServers": {
    "abap-mcp": { "command": "npx", "args": ["-y", "abap-mcp"] },
    "abap-mcp-genai": {
      "command": "npx",
      "args": ["-y", "abap-mcp-genai"],
      "env": { "AICORE_SERVICE_KEY_FILE": "/path/to/service-key.json" }
    }
  }
}
```

```bash
# Codex CLI
codex mcp add abap-mcp-genai --env AICORE_SERVICE_KEY_FILE=/path/to/service-key.json -- npx -y abap-mcp-genai
```

Prefer `AICORE_SERVICE_KEY_FILE` over inlining `AICORE_SERVICE_KEY` in a committed config file —
point it at a path your secret manager writes at runtime, and never commit the key itself
(`AGENTS.md`'s "no secrets in commits" rule applies here too).

## 6. Limits — read this before you rely on it

- **Explain-first model.** `sap-abap-1` supports code-to-text explanation; SAP itself labels its
  code-generation capability *"experimental and not recommended for productive use."*
  `explain_with_sap_abap_1` only exposes the explanation scenario — it will not write or fix ABAP
  for you. Keep using `abap-mcp`'s offline `fix_abap` / `scaffold_rap_bo` / `scaffold_abap_unit`
  for anything you need generated or corrected.
- **System prompts are rejected.** Since a 2026-04-27 SAP change, `sap-abap-1`'s system prompt is
  predefined and managed by SAP — a request carrying a `role: "system"` message fails outright.
  `explain_with_sap_abap_1` never sends one; `GenAiClient.completion()` refuses to for any request
  targeting `sap-abap-1` even if a caller tried to construct one directly.
- **Independent benchmarks put `sap-abap-1` well behind frontier general models**, both on code
  generation and on explanation/understanding (TH Köln paper + Marian Zeis's extended benchmark,
  Feb–Mar 2026: `sap-abap-1` 10.67%→19.89% cumulative success across feedback rounds vs. Claude
  Opus 4.5's 31.61%→78.72%; a follow-up found even Claude Haiku 4.5 beat it on the pure
  explanation benchmark). Treat its output as **one input among several**, not ground truth —
  cross-check anything load-bearing against `abap-mcp`'s offline tools or a human reviewer.
- **Orchestration V1 is not implemented and won't be.** SAP is decommissioning
  `{deploymentUrl}/completion` (V1) on **2026-10-31**. This module speaks only Orchestration V2
  (`/v2/completion`).
- **Context window:** SAP documents a 128,000-token maximum, with ~120,000 tokens
  (~250,000 characters) usable for input code after reserving room for instructions and output.
  Very large classes are truncated by SAP's own model, not by this module — pass only the
  relevant method/section when a class is huge (this is also SAP's own best-practice advice).
- **Pricing and rate limits are governed by your own SAP AI Core contract and SAP Note 3437766**
  (paywalled to S-users) — this module reports token `usage` and a `requestId` on every call so
  you can reconcile against your own billing, but does not enforce or predict cost.
- **Live tenant data, not a bundled snapshot.** Unlike `check_released_api`'s dated,
  package-bundled SAP Cloudification snapshot, `list_genai_hub_models` reflects your tenant live,
  at call time — there is nothing to keep in sync with a release.

## 7. Pairing with the offline server

Run both servers side by side. A natural loop:

1. `check_cloud_readiness` / `lint_abap` (offline) — objective, deterministic, no network.
2. `explain_with_sap_abap_1` (online, opt-in) — SAP's own model's read on unfamiliar legacy code,
   as a second opinion before you touch it.
3. Back to the offline server (`fix_abap`, `scaffold_abap_unit`, `compare_abap`) to make and
   verify the actual change.

Nothing in step 2 is required for steps 1 or 3 — every other abap-mcp workflow in
`docs/COOKBOOK.md` works exactly the same with `abap-mcp-genai` never installed.
