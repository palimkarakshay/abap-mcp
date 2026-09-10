# abap-mcp roadmap — SAP AI + agentic upgrade (2026-09-10)

**Basis:** a 9-topic, fact-checked research corpus (SAP-ABAP-1, Generative AI Hub, ABAP AI SDK/ISLM,
SAP's official ADT MCP server, ABAP Cloud/RAP 2025–26, Clean Core, OSS ecosystem, MCP 2026-07-28,
agentic-ABAP practice), an independent codex web-research report, a repo audit, and two feasibility
spikes. Corpus: `~/docs/reports/abap-mcp-sap-ai-upgrade-2026-09-09/` (owner's box; `CONTEXT.md` is
the entry point). Every claim below traces to a `VERIFIED.md` fact there.

## 0. Thesis — what abap-mcp becomes

abap-mcp stops being "abaplint behind MCP" and becomes **the offline SAP-knowledge substrate a coding
agent consults before it writes ABAP, and the offline verifier it consults after**: bundled, dated,
cited SAP facts (release deltas, edition-correct released-API state with SAP's own successors,
RAP/BDEF semantics, ABAP-AI integration shapes) plus two feedback engines nobody ships offline — an
ABAP Unit runner (transpiled to Node) and a BDEF/SRVD semantic checker. Every other ABAP MCP server
(SAP's official one and ~21 community bridges) needs a live system and credentials. Ours runs in a
repo, in CI, in a PR, inside a plugin bundle — and pairs with the online servers instead of competing.

## 1. Can this MCP directly help agentic AI? — yes, and the evidence says it is the larger lever

- **The feedback loop is worth ~47 points.** TH Köln's ABAP benchmark (arXiv 2601.15188; 180 tasks,
  create → activate → ABAP Unit, ≤5 feedback rounds; extended by Marian Zeis): Claude Opus 4.5 goes
  31.6% → 78.7% and GPT-5 19.3% → 77.1% across rounds. The delta *is* the tool loop. Today abap-mcp
  supplies the static half (lint/readiness); `run_abap_unit` supplies the executable half.
- **SAP's specialist model is not the shortcut.** `sap-abap-1` is explain-first (code generation
  "experimental and not recommended for productive use"), orchestration-only, rejects system prompts
  since 2026-04-27, and scores ~20% on the same benchmark while costing more per completed task.
  Value = make a frontier model *factually correct about SAP*, not "route to SAP's model".
- **The failure modes are knowledge failures.** Haiku 4.5 failed systematically by writing CDS-style
  `abap.char(20)` inside classic ABAP and never recovered because parser messages were misleading —
  a lint + explain + release-context problem. Community teams hand-roll pre-push lint gates because
  nothing offline exists (the "sap-harness" series). The offline niche is empty in every survey.
- **SAP's official ADT MCP server (GA Q2 2026, 20 tools / 8 toolsets, 18 licence-free)** has no
  edit, delete, table-read or read-back/verification tool. A composed loop — SAP writes/activates,
  abap-mcp verifies offline — is cheap, legal, and the exact gap SAP left.
- **Honest limits stay labelled:** no activation, no ATC, no customer-specific release list; transpiled
  execution is the open-abap kernel, not SAP's. A real system's ABAP Unit + ATC remain authoritative.

## 2. Licensing boundary for bundled knowledge

Bundleable: `SAP/abap-atc-cr-cv-s4hc` (Apache-2.0: all three edition files + `objectClassifications_SAP.json` +
successors), `SAP-samples/abap-cheat-sheets` and `abap-partner-reference-application` (Apache-2.0 code),
`SAP-docs/sap-artificial-intelligence` (CC-BY-4.0 excerpts with attribution), abaplint metadata (MIT),
`@abaplint/transpiler`/`runtime`/open-abap-core (MIT). **Not** bundleable: help.sap.com prose (incl. the
`abap-ai` deliverable and the ABAP Keyword Documentation), community.sap.com blog text, SAP Notes — cite
URL + release id, write our own one-line summary. Every knowledge file carries `curatedDate` + `sources[]`
+ licence; a dev-only link checker runs before release.

## 3. Ranked feature list

Priority = ship decision; effort S/M/L/XL. "Touches" names real modules. IDs are stable for tracking.

### Wave 1 — v0.11.0 "correct SAP knowledge + the execution loop" (P0)

| # | ID | Feature | Kind | Effort |
|---|----|---------|------|--------|
| 1 | F04 | **Fix the server's own hallucinated ATC identifiers** (`API_RELEASE_STATE_CHECK` does not exist; `SAP_CP_READINESS` is a legacy Cloud-readiness variant, not the released-API check). Encode the real vocabulary in `src/data/atc-vocabulary.json`: checks "Usage of Released APIs (Cloudification Repository)" / "Usage of APIs (Cloudification Repository)", variants `ABAP_CLEAN_CORE_DEVELOPMENT` (BTP / S/4 ≥ 2025 FPS01), `ABAP_CLEAN_CORE_READINESS` (ECC / S/4 < 2023), `ABAP_CLOUD_DEVELOPMENT_3TIER` (deprecated → CLEAN_CORE_DEVELOPMENT). Add `gradeMeaning:"blocker-density"` so our A–D band is never confused with SAP's **Clean Core Level A–D**. Regression test forbids the wrong strings anywhere in `src/**`/`docs/**`. | data + honesty | S |
| 2 | F03 | **Edition-correct released-API data + SAP's own successors.** Fetch all three upstream files (Public Edition `objectReleaseInfoLatest`, BTP `_BTPLatest`, Private Cloud `_PCELatest`) and keep `successors[]` + `successorClassification` (today we ship a 33-row hand-curated map on top of data that already has thousands of successors). `check_released_api`/readiness/deps/CLI gain `edition: "s4hc"|"btp"|"pce"`; `successorSource: "sap"|"curated"|"none"`; classicAPI/noAPI/internalAPI classification from `objectClassifications_SAP.json` (F15 folded in). Size budget test on `dist/`. | data + tool | M |
| 3 | F05 | **Bundled ABAP Cloud / RAP knowledge base (2502 → 2608 + Platform 2025) + `explain_abap_release` + `lookup_sap_knowledge` + MCP resources.** One row per verified fact (CDS table entities, writable entities, `BUFFER ON`, RAP change documents → business events, global/event-driven side effects, collaborative draft (2508, cross-BO 2602), reorder actions, factory actions → HTTP 201, draft on table entities (2605), RAP Recommendations via ISLM (2602), AMDP Test Double Framework, SAP_BASIS 816 ≠ "ABAP 9", …), Clean Core Level A–D + release contracts C0–C3, and **SAP-AI option cards** (SAP-ABAP-1, Gen AI Hub orchestration, ABAP AI SDK, Joule for Developers pricing, official ADT MCP server; F08 folded in). Original prose + `sourceUrl` + `confidence` from the fact-check. Served as tools and as `abap-mcp://knowledge/<id>` resources (F06) with a provenance manifest (F20). | data + tools + resources | L |
| 4 | F02 | **`run_abap_unit` — offline execution feedback.** `@abaplint/transpiler` + `@abaplint/runtime` + vendored open-abap-core (MIT): parse 1.3 s + transpile 2.2 s + run 0.4 s measured. Structured per-method results (status/expected/actual/message/runtime) from the open runner; separate honest lint at Cloud/baseline; subprocess `node` with timeout/kill, server-owned temp dir, output caps. Opt-in on the MCP surface (`ABAP_MCP_ENABLE_RUN=1`), always available in the CLI (`abap-mcp unittest --run`, exit 1 on failure = CI gate). `RUN_SCOPE_NOTE`: open-abap kernel, no DB/CDS/EML/AMDP/auth. DESIGN.md §10 ("no run ABAP") gets a dated superseding entry. | engine + tool + cli | XL |
| 5 | F07 | **`scaffold_abap_ai_sdk`** — validated ABAP class calling the Generative AI Hub through the ABAP AI SDK (ISLM): variants `string`, `messages`, `prompt-template` (`CL_AIC_ISLM_PROMPT_TPL_FACTORY`), `function-calling` (the DO-loop, with the upstream sample's undeclared-`tool_calls` bug fixed), `structured-output`, `streaming`, `orchestration` (with its three documented limitations). `setupSteps` (extended plan, SAP_COM_0A69, INTS/INTM, F4469/F4470) and `constraints` (error codes, temperature range, Cross Trace). Round-tripped through abaplint at syntax-only with bundled `IF_AIC_*` stubs → label `validated:"abaplint-syntax"`. | scaffold + data | M |
| 6 | F09 | **Opt-in online module `abap-mcp-genai`** (separate bin/entry, never in the default stdio server): `explain_with_sap_abap_1` (Orchestration V2 `POST {deploymentUrl}/v2/completion`, `AI-Resource-Group`, XSUAA client-credentials from `AICORE_SERVICE_KEY`, no system prompt, SAP's three official prompt templates) + `list_genai_hub_models` (`/v2/lm/scenarios/foundation-models/models`). Privacy contract: source text leaves the machine — say so. Fetch mocked in tests. | online-optin | M |
| 7 | F18 | **Agent-ergonomic result contract:** every error result becomes `{kind, hint, nextTools}`; long outputs carry `truncated`+`nextCursor`; descriptions state token cost. | protocol | S |
| 8 | F12 | **`get_abap_agent_rules`** — emits an `AGENTS.md`/`CLAUDE.md` block for an ABAP repo (SAP itself now ships an AGENTS.md template for its MCP server): lint-before-commit, readiness gate, `run_abap_unit` loop, pairing with the online servers, ABAP Cloud rules. | tool | S |
| 9 | F19 | **Pairing story:** README/AGENTS.md "Related projects" gains SAP's official ADT MCP server (tool names, licence gates) and `williansaez/abap-adt-mcp`; a COOKBOOK recipe "offline verify → online write/activate/test"; retire the private online-bridge spec. | docs | S |

### Wave 2 — v0.12.0 "RAP semantics + distribution" (P1)

| # | ID | Feature | Effort |
|---|----|---------|--------|
| 10 | F01 | **`check_rap_behavior` — native BDEF/SRVD semantic checker** (abaplint parses neither): tokenizer + recursive-descent grammar for `managed/unmanaged/abstract/projection/interface` BDEFs; rules: `strict(2)`, draft ⇒ `draft table` + `etag master` + `lock master` + `total etag`, authorization master/instance, numbering (early/late/managed), mandatory create/update/delete vs projection `use`, association `with draft`, validation/determination triggers, side-effects syntax, release-gated features by `minRelease` (from F05), SRVD `expose` set ⊆ known CDS names. Strengthens the scaffold keystone test (BDEF/SRVD stop being unverifiable templates → third label `validated:"rap-checker"`). | XL |
| 11 | F16 | **`scaffold_rap_bo` v2:** CDS table entity persistence (2025+), draft on table entities, side effects, business events, unmanaged/interface variants, value helps, authorization stubs, RAP BO test double harness (`cl_abap_behavior_test_environment`). | L |
| 12 | F13 | **`check_cloud_readiness` v2:** Clean Core Level hint (A–D, SAP's meaning), language-version reality (8.16 vs 9.x), ATC-shaped output + CI exit codes (`--format atc-json`, F21). | M |
| 13 | F14 | **Evals:** an ABAP-hallucination pack (`abap.char(20)`, invented class names, wrong RAP syntax) and an execution-feedback pack (pass@round0 vs pass@round3 with `run_abap_unit`) — the proof asset. | M |
| 14 | F11 | **Packaging:** Claude Code plugin marketplace in-repo (`.claude-plugin/`) with Agent Skills mirroring the prompts (+ new `abap-ai-sdk`, `abap-unit-loop` skills), Codex plugin pin fixed, Cursor/Gemini CLI install rows, `docs/TOOLS.md` generated from `tools/list` + contract test. | M |
| 15 | F22 | **Lazy data loading + size budget:** editions/successors/knowledge loaded on demand; a `dist/` size cap test; `list_abap_knowledge` index. | S |
| 16 | — | **Release ops:** npm **trusted publishing** (GitHub Actions OIDC + provenance) so the weekly upgrade cron stops failing on web-OTP; MCP registry publish in the same workflow. | S |
| 17 | F17 | Pin `@abaplint/core` exactly (non-semver upstream, ~30 patch releases/month) + an `AbapCloud` focus pack. | S |

### Wave 3 — v1.0.0 "agent-native" (P2)

| # | ID | Feature | Effort |
|---|----|---------|--------|
| 18 | F10 | **MCP 2026-07-28 / TypeScript SDK v2** (`@modelcontextprotocol/server` 2.0): stateless core, `resultType`, cacheable list results, MRTR-style elicitation for missing scaffold parameters, deliberate non-adoption of deprecated Sampling/Roots/Logging; API freeze + deprecation policy. | L |
| 19 | — | **"Spec → working SAP app" layer** (from the codex use-case study): a versioned application spec (entity, fields, statuses, roles, validations) as the source of truth; `abap-from-spec` v2 drives scaffold → `check_rap_behavior` → `run_abap_unit` offline, then hands off to SAP's official ADT MCP (`abap_creation-*`, `abap_activate_objects`, `abap_run_unit_tests`, `abap_run_atc`) or abap-adt-mcp for create/activate/test in-system. Target user: functional consultant / process owner with zero ABAP. | XL |
| 20 | — | Skills-over-MCP (SEP-2640 `skill://` resources) once clients ship it; Docker image on GHCR; README translations. | M |

### Explicitly rejected / deferred
- Building an ADT/live-system bridge (SAP's server + abap-adt-mcp + ~20 others own it).
- Any network call inside the default stdio server (F09 is a separate binary, opt-in, labelled).
- Copying help.sap.com / community.sap.com text into the package (licence).
- Using MCP Sampling (deprecated 2026-07-28); SAP-ABAP-1 as a code generator (benchmarks + SAP's own label).

## 4. Release gates (every wave)
`npm run check` (typecheck → tests → build → routing eval) stays the CI gate; keystone `validationIssues === []`
never relaxed; forbidden-identifier guard from F04 on every build; every new tool ≥1 routing case and ≥1
deterministic hallucination case; `npm publish` + MCP-registry publish remain owner-HITL.
