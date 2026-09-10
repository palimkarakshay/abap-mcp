# abap-mcp v0.11.0 — SAP knowledge, edition-aware release checks, and an offline unit-test loop

abap-mcp stops being "abaplint behind MCP" and becomes the offline SAP-knowledge substrate a
coding agent consults **before** it writes ABAP, and the offline verifier it consults **after**.
This release adds a dated, cited knowledge base; edition-aware released-API data with SAP's own
successors; a validated ABAP AI SDK scaffolder; an offline ABAP Unit runner; and an opt-in online
companion for SAP's own explanation model — while keeping the default server's "zero outbound
network calls" invariant exactly as strict as it always was.

17 tools ship by default (up from 13), an 18th (`run_abap_unit`) is opt-in, and the 4 MCP prompts
are unchanged. `npm run check` — 851 tests across 20 files, typecheck, build, and the routing
eval — stays green.

## What's new

### Bundled SAP knowledge base — `explain_abap_release`, `search_sap_knowledge`
A dated (curated 2026-09-10) knowledge base ships with the package: 100 ABAP Cloud / CDS / RAP /
EML / ATC release-delta rows across the 2502–2608 trains plus ABAP Platform 2025 (with pre-2502
chronology corrections so an agent can't present an established feature as a 2025-26 novelty), 55
Clean Core entries (Levels A–D, release contracts C0–C3, the real ATC vocabulary), and 7 SAP-AI
decision cards (SAP-ABAP-1, Generative AI Hub, the ABAP AI SDK, Joule for Developers, SAP's
official ADT MCP server, …). Every row is abap-mcp's own original summary over a cited source URL
with a `confirmed`/`reported` confidence flag — never copied SAP prose. Reach it as tools, as CLI
subcommands (`release`, `knowledge`), or as MCP resources under `abap-mcp://knowledge/…` (a
provenance manifest, three whole-file resources, and per-card resources).

### Edition-aware released-API checks with SAP's own successors
`check_released_api`, `check_cloud_readiness`, `get_object_dependencies`, and the CLI now take an
`edition` parameter (`s4hc` = S/4HANA Cloud Public Edition, `btp` = BTP ABAP environment, `pce` =
Private Cloud Edition / on-premise; default `s4hc`), backed by SAP's three separate published
Cloudification lists instead of one. Each finding carries SAP's own successor(s) when published
(`successorSource: "sap"`), falling back to the existing curated CDS-successor map only when SAP's
data has none (`successorSource: "curated"`), plus a classicAPI/noAPI/internalAPI classification
from SAP's companion schema.

### Honest ATC vocabulary — `atc-vocabulary.json` and `gradeMeaning`
The server previously referenced an invented ATC check identifier and misused a real but unrelated
legacy variant as if it were the released-API check. Both are fixed: the real check and variant
names (current and deprecated-with-successor) are curated in `src/data/atc-vocabulary.json` and
exposed on every readiness report as `cleanCoreVocabulary`. Every report now also carries
`gradeMeaning: "blocker-density"` — our A–D band is a blocker-density banding, never to be confused
with SAP's own Clean Core Level A–D. A regression test scans the shipped source and docs for the
wrong identifiers on every run.

### Offline ABAP Unit execution — `run_abap_unit`, `abap-mcp unittest --run`
The executable half of the agent feedback loop: sources are transpiled to JavaScript by
`@abaplint/transpiler` against a bundled open-abap kernel (`open-abap-core`, MIT) and executed in a
sandboxed subprocess (server-owned temp directory, hard timeout + `SIGKILL`, scrubbed environment,
no shell, no network) — one pass/fail/error/skipped row per test method, alongside the honest
static lint at the caller's target ABAP version. It proves pure logic only: no database (any ABAP
SQL aborts the method), no CDS, no EML/RAP runtime, no AMDP, no authority checks, no locks, no ATC,
no activation — constructs it can't execute come back in `unsupported`, never as a silent pass.
Opt-in on the MCP surface (`ABAP_MCP_ENABLE_RUN=1`); always available in the CLI, where
`abap-mcp unittest --run` exits 1 on any failure — a CI gate for the test loop itself.

### ABAP AI SDK scaffolding — `scaffold_abap_ai_sdk`, `abap-mcp aisdk`
Generates a validated ABAP class calling the Generative AI Hub through the ABAP AI SDK (powered by
ISLM): seven interaction shapes (`string`, `messages`, `prompt-template`, `function-calling`,
`structured-output`, `streaming`, `orchestration`), including a fix for a bug in SAP's own upstream
`function-calling` sample (an undeclared `tool_calls` table used before it's declared). Generated
sources are round-tripped through abaplint against abap-mcp's own bundled `IF_AIC_*`/`CL_AIC_*`
stub declarations, labelled `validated: "abaplint-syntax"` — proves the ABAP parses, not that it
matches SAP's real API surface exactly. Returns the manual ISLM setup steps (extended AI Core plan,
`SAP_COM_0A69`, INTS/INTM deploy+activate) it has no way to perform itself.

### AGENTS.md rules generator — `get_abap_agent_rules`, `abap-mcp agent-rules`
Emits the ABAP section of a repository's AGENTS.md / CLAUDE.md: lint-before-commit, the readiness
gate, released-API discipline, scaffold-first, the offline unit-test loop, and the division of
labour with an online ADT MCP server — parameterized by target (Cloud/classic), which online server
is paired, whether the unit-test loop is enabled, package prefix, and edition.

### Agent-ergonomic error contract
Every tool failure now carries a machine-readable `kind`, an optional `hint` (what to change), and
`nextTools` (the right tool to call instead) — printed as `<kind>: <message>` / `hint: …` /
`next: …` so a coding agent can recover instead of retrying blindly or answering from memory.

### Online companion — `abap-mcp-genai` (new bin, opt-in, separate process)
A second binary, never imported by the default server: `explain_with_sap_abap_1` (ask SAP's own
ABAP-tuned model, via your own SAP AI Core tenant's Generative AI Hub orchestration service, to
explain a class/method/snippet) and `list_genai_hub_models` (metadata only). **Your ABAP source
leaves the machine when you use `explain_with_sap_abap_1`** — it goes to SAP infrastructure under
your organization's own SAP AI Core contract, never to abap-mcp's authors. Full setup, environment
variables, and the privacy contract are in [docs/GENAI.md](GENAI.md); read it before enabling.

## Upgrade notes

- **Node.js 22 or newer is now required** (`engines.node >= 22`): `@abaplint/core` 2.120.48 and the transpiler declare a Node 22 floor, and the offline runner uses Node's permission model to sandbox the test subprocess on Node ≥ 22.

- `@abaplint/core` bumped `^2.120.13` → `^2.120.48`. Two new dependencies, pinned exactly (not
  `^`, matching this project's non-semver-upstream policy): `@abaplint/runtime` and
  `@abaplint/transpiler`, both `2.13.82` — required by `run_abap_unit`.
- Package size grew with the bundled knowledge base and the vendored open-abap kernel library:
  **1.2 MB packed / 10.3 MB unpacked** (confirmed via `npm pack --dry-run`, 111 files), up from a
  released-API-snapshot-only package in 0.10.x. Nothing in the growth is loaded eagerly by the
  stdio server beyond what each tool call needs.
- New bin: `abap-mcp-genai` (`dist/genai.js`), alongside the existing `abap-mcp` and
  `abap-mcp-http`. It requires `AICORE_SERVICE_KEY` or `AICORE_SERVICE_KEY_FILE` to start at all.
- `check_released_api` / readiness / deps / the CLI default to `edition: "s4hc"` when omitted —
  existing calls keep working, but confirm it's the right edition for your target system (see
  docs/COOKBOOK.md §9, "Which edition am I on?").
- `ABAP_MCP_ENABLE_RUN=1` is required to see `run_abap_unit` over MCP; nothing else changes for
  callers who don't opt in.

## Honesty caveats — read before you rely on any of the above

- `run_abap_unit` runs on the **open-abap kernel, not SAP's** — a green run is evidence about pure
  logic, never proof of behavior on a real system; ABAP Unit on that system remains authoritative.
- `scaffold_abap_ai_sdk`'s `validated: "abaplint-syntax"` label means the code parses against
  **abap-mcp's own** stub declarations of SAP's AIC types, not a guarantee it matches SAP's real
  API signatures exactly.
- Released-API and knowledge-base data are **dated, bundled snapshots** — every result carries its
  curation/snapshot date, and a target system's own release notes / ATC run remain authoritative.
- Our readiness `grade` (`gradeMeaning: "blocker-density"`) is **not** SAP's Clean Core Level A–D;
  the real vocabulary lives in `cleanCoreVocabulary` on every report.
- `abap-mcp-genai` sends your ABAP source to SAP over the network when you call
  `explain_with_sap_abap_1` — it is a deliberately separate, opt-in binary for exactly this reason.

## Pairing with the online ADT MCP servers

abap-mcp verifies offline, before and after: `lint_abap` / `check_cloud_readiness` /
`compare_abap` on code before it's written to a system, then again on what SAP's official ADT MCP
server (GA, ships in ADT for Eclipse and VS Code; 20 tools across 8 toolsets, 18 licence-free) or
the community `abap-adt-mcp` (MIT, 173 online tools) just wrote, activated, or ran ATC against.
Neither online server needs abap-mcp, and abap-mcp never needs credentials — see
[docs/COOKBOOK.md](COOKBOOK.md#offline-verify-then-write-in-system-with-sap-adt-mcp--abap-adt-mcp)
for the full step list, and `get_abap_agent_rules` for the rule text to paste into a repo's
AGENTS.md.

## Credits

- [abaplint](https://github.com/abaplint/abaplint) by Lars Hvam (MIT) — the parser, rule engine,
  transpiler and runtime underneath every tool here, including the new `run_abap_unit`.
- [open-abap/open-abap-core](https://github.com/open-abap/open-abap-core) (MIT) — the ABAP
  standard-library kernel `run_abap_unit` transpiles and executes against.
- [SAP/abap-atc-cr-cv-s4hc](https://github.com/SAP/abap-atc-cr-cv-s4hc) (Apache-2.0) — SAP's
  official ABAP Cloudification Repository: the edition-specific released-API lists, successors,
  and object classifications this release adds.
- [SAP-samples/abap-cheat-sheets](https://github.com/SAP-samples/abap-cheat-sheets) and
  [SAP-docs/sap-artificial-intelligence](https://github.com/SAP-docs/sap-artificial-intelligence)
  (Apache-2.0 code / CC-BY-4.0 documentation) — cited sources behind the bundled SAP-AI knowledge
  cards and the ABAP AI SDK scaffold, summarized in this project's own words, never reproduced.
- [mcp-kit](https://github.com/palimkarakshay/mcp-kit) — the production-MCP patterns this server
  follows, including the agent-ergonomic error contract's origin pattern.

MIT © Akshay Palimkar. Not affiliated with or endorsed by SAP SE. "SAP", "ABAP" and "RAP" are
trademarks of SAP SE; this is an independent open-source tool for developers working with them.
