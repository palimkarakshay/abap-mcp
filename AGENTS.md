# abap-mcp

MCP server for SAP ABAP: **offline** static analysis (abaplint), edition-aware ABAP Cloud /
Clean Core readiness + released-API checks (`s4hc` / `btp` / `pce`), phased migration planning,
RAP managed-BO + ABAP AI SDK (ISLM) scaffolding, an opt-in offline ABAP Unit runner, a bundled
dated SAP knowledge base (release deltas / Clean Core / SAP-AI options) exposed as tools AND
`abap-mcp://knowledge/…` resources, plus 4 guided-workflow MCP prompts (abap-from-spec /
abap-review / abap-mentor / abap-migration-plan). No SAP system, no credentials, and no
user-filesystem — text in, structured JSON out (package-bundled data assets excepted; see
invariants). The default stdio server makes no outbound network calls; the opt-in
`abap-mcp-genai` binary is the ONLY networked entry point (see invariants). Lumivara product
line: **SAP**. **Public MIT** repo (`github.com/palimkarakshay/abap-mcp`); npm package `abap-mcp`
(bins: `abap-mcp`, `abap-mcp-http`, `abap-mcp-genai`; library).

## Package manager: npm — Node >= 22

## Commands (authoritative)
- `npm install`
- `npm run check`     — typecheck + vitest (851 tests / 20 files) + build + routing eval = **the CI gate**
- `npm run typecheck` / `npm test` / `npm run build` — the individual steps
- `npm run build`     — `tsc && node scripts/copy-data.mjs` (tsc does NOT copy the bundled `.json`)
- `node scripts/build-released-api-index.mjs` / `build-open-abap-lib.mjs` — **dev-only**, refresh
  the per-edition SAP released-API snapshots and the vendored open-abap-core library (network;
  never run at serve time). `check-knowledge-links.mjs` (dev-only too) HEAD-checks knowledge
  `sourceUrl`s — NOT part of `npm test`/`check` (SAP hosts 403 non-browser agents; red = look).
- `node dist/cli.js`  — stdio MCP server (`ABAP_MCP_ENABLE_RUN=1` also registers `run_abap_unit`)
- `node dist/http.js` — guarded Streamable HTTP (`127.0.0.1:3000/mcp` by default)
- `node dist/genai.js` (bin `abap-mcp-genai`) — the separate, opt-in ONLINE server; needs
  `AICORE_SERVICE_KEY`/`_FILE`; read `docs/GENAI.md` before enabling
- `npm run eval:routing` — deterministic host-routing gate over exact MCP metadata
- CLI subcommands (each also an MCP tool): `lint fix readiness plan compare scaffold unittest
  [--run] deps outline released explain rules release knowledge aisdk agent-rules` —
  `unittest --run` EXECUTES tests offline (open-abap kernel), exit 1 on failure = the test-loop gate
- Inspect: `npx @modelcontextprotocol/inspector --cli node dist/cli.js --method tools/list`
- Description lint (optional, cross-repo): `pnpm --filter @mcp-kit/lint run lint -- --root
  ~/projects/abap-mcp --threshold 90`. `server.test.ts`'s in-repo rubric enforces the same.

## Layout
- `src/abap.tools.ts` — the 13 original ToolSpecs (lint_abap, fix_abap, check_cloud_readiness
  [+A–D grade, edition-aware], plan_cloud_migration, compare_abap, scaffold_rap_bo,
  scaffold_abap_unit, get_object_dependencies, check_released_api [`edition`], list_abap_rules,
  explain_abap_rule, format_abap, get_abap_outline). `ALL_TOOLS` appends `KNOWLEDGE_TOOLS` +
  `AISDK_TOOLS` + `AGENT_RULES_TOOLS` (17 offline total); `serverTools()` in `src/server.ts` adds
  `RUN_TOOLS` (`run_abap_unit`) only when `ABAP_MCP_ENABLE_RUN=1`.
- `src/tools/` — one file per v0.11 feature: `knowledge.tools.ts` (explain_abap_release,
  search_sap_knowledge) · `aisdk.tools.ts` (scaffold_abap_ai_sdk) · `agent-rules.tools.ts`
  (get_abap_agent_rules + `buildAgentRules()`, reused by the CLI) · `run.tools.ts`
  (run_abap_unit + `RUN_TOOLS_ENABLED`).
- `src/prompts.ts` — the 4 PromptSpecs, rubric-tested like tools; mirrored as Codex plugin skills
  in `plugins/abap-mcp/skills/` — keep the two in lockstep.
- `src/resources.ts` — MCP resources over the bundled knowledge base: `abap-mcp://knowledge/
  manifest`, `/release-deltas`, `/clean-core`, `/sap-ai` (whole files) and `/release/{id}`,
  `/clean-core/{id}`, `/sap-ai/{id}` (single cards); registered in `buildServer()`.
- `src/abap/` — engine.ts · readiness.ts (dual-parse diff + edition-aware released-API
  cross-check + A–D grade + `cleanCoreVocabulary`) · plan.ts · compare.ts · fix.ts · released.ts
  (per-edition lookup + SAP/curated successors + classification) · scaffold.ts · unittest.ts ·
  deps.ts · rules.ts · formatter.ts · outline.ts · **knowledge.ts** (release-delta / Clean Core /
  SAP-AI lookups + Markdown rendering) · **aisdk.ts** (ABAP AI SDK generator) · **run.ts**
  (transpile + subprocess execution, `RUN_SCOPE_NOTE`).
- `src/genai/` — `client.ts` (XSUAA token, deployment discovery, Orchestration V2 completion,
  model listing) + `tools.ts` (explain_with_sap_abap_1, list_genai_hub_models). Wired ONLY by
  `src/genai.ts` — never imported by `src/server.ts`.
- `src/data/` — `released-apis.{s4hc,btp,pce}.json` + `api-classifications.json` (SAP
  Cloudification Repository, Apache-2.0) · `table-successors.json` · `rewrite-recipes.json` ·
  `atc-vocabulary.json` (real ATC names, the F04 honesty fix) · `abap-ai-sdk.json` (ISLM shapes) ·
  `aic-stubs/*.abap` (our OWN `IF_AIC_*`/`CL_AIC_*` stubs, not SAP source) · `open-abap-core.json`
  (vendored MIT kernel for `run_abap_unit`) · `knowledge/` (100 release-delta rows, 55 Clean Core
  entries, 7 SAP-AI cards, `MANIFEST.json` provenance).
- `scripts/` — `build-released-api-index.mjs` · `build-open-abap-lib.mjs` ·
  `check-knowledge-links.mjs` (all dev-only, network) · `copy-data.mjs` (build: copies
  `src/data/**/*.json` → `dist/data/`, marks bins executable).
- `src/tool.ts`, `src/errors.ts` (agent-ergonomic `{kind, hint, nextTools}` error contract) —
  vendored mcp-kit patterns (attributed; keep in sync by hand).
- `src/server.ts` (`SERVER_INSTRUCTIONS`, `serverTools()`, `buildServer()`) + `src/cli.ts` +
  `src/http.ts` + `src/genai.ts` + `src/cli-commands.ts` (dispatcher + `USAGE`) +
  `src/cli-extra.ts` (v0.11 subcommands) + `src/index.ts`.
- `docs/DESIGN.md` — decision log · `docs/COOKBOOK.md` — user recipes · `docs/GENAI.md` —
  `abap-mcp-genai` setup, privacy contract, limits.
- `plugins/abap-mcp/` + `.agents/plugins/marketplace.json` — Codex plugin, 4 skills, local MCP.
- `evals/routing/` — offline metadata-routing fixtures (33 cases; 18 tools + 4 prompts).
- `examples/claude-code/` — subagents (reviewer, migrator), .mcp.json, CI workflow.

## Deploy: none hosted — ships as an npm package (`npm publish`, owner-run; needs npm login).
`abap-mcp-http` is self-hostable but not authorization to expose oraclebox or deploy publicly;
`abap-mcp-genai` is a separate binary an operator opts into per-project, never auto-started.

## Gotchas / invariants
- stdout is the JSON-RPC channel — anything human-facing goes to **stderr**.
- **Only `run_abap_unit` executes code**, and only when opted in (`ABAP_MCP_ENABLE_RUN=1`); the
  CLI's `unittest --run` always has it. It runs in a subprocess (`execFile`, never a shell) inside
  a `mkdtemp` **server-owned** temp dir, scrubbed env, hard timeout+SIGKILL — never a user path.
  Every source is scanned for `WRITE '@KERNEL ...'.` before transpiling and the whole run is
  refused if found (the transpiler emits the text after `@KERNEL` as raw JavaScript); on Node
  22+ the child additionally runs under Node's `--permission` model (fs read pinned to the temp
  dir + the open-abap runtime's own packages, fs write pinned to the temp dir, no child
  processes, no worker threads — see `sandbox` on `UnitRunResult`).
- **`abap-mcp-genai` is the only networked entry** — a wholly separate binary/process
  (`src/genai.ts`) that `src/server.ts` never imports; the default server's "zero outbound network
  calls" invariant is unaffected by its existence. Package-bundled assets (abaplint's own data,
  `src/data/*.json`, `open-abap-core.json`) remain fine and expected — only the three dev-only
  `scripts/*.mjs` touch the network, never at serve time.
- HTTP stays on `127.0.0.1` by default; non-loopback needs a bearer token. Never log request
  bodies, arguments, source, or results.
- abaplint does NOT deep-parse BDEF/SRVD — `validated` is load-bearing honesty, three-valued:
  `"abaplint"` (real parser) | `"template"` (golden-tested, BDEF/SRVD) | `"abaplint-syntax"`
  (scaffold_abap_ai_sdk, checked only against our OWN `aic-stubs` — never SAP's real surface).
- Readiness = diff(Cloud, baseline), both `syntax-only`; `releasedApiFindings` stays separate,
  informational, dated, and edition-scoped — never folded into `cloudBlockerCount`/`score`.
- **Our `grade`/`gradeMeaning: "blocker-density"` is NOT SAP's Clean Core Level A–D** — the real
  ATC check/variant names live only in `src/data/atc-vocabulary.json`; a regression test
  (`atc-vocabulary.test.ts`) forbids the invented ATC identifier and the bare deprecated-variant
  name anywhere in `src/**`/`docs/**`/README.md outside the files that legitimately own them.
- Knowledge base rows are abap-mcp's **own original summaries** over a cited `sourceUrl` — never
  reproduce help.sap.com / community.sap.com / SAP Note prose verbatim (see `MANIFEST.json`).
- The scaffold round-trip test (`validationIssues = []`) is the repo's keystone test; fix the
  template, never relax the test.
- Tool descriptions are rubric-tested in `server.test.ts` — verb-first name, "Use this when",
  non-goals, described params, ≥1 example, readOnlyHint on everything.
