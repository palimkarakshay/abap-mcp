# abap-mcp — design decision log

A record of the decisions that shaped this server, with the alternatives that were rejected and
why. Written so a reviewer (or an interviewer) can reconstruct the reasoning, not just the result.

## 1. The gap: offline static analysis, not another system bridge

Survey of the ABAP × MCP landscape (June 2026): every credible server is either
(a) **system-connected** — ADT/RFC bridges needing a live SAP system and credentials
(mario-andreschak's ADT servers, ABAP_CHECK_MCP via RFC, SAP's own MCP server GA'ing ~Q2 2026),
(b) **docs-only** — searchable keyword documentation, or (c) an MCP **SDK written in ABAP**
(abap-ai/mcp — the inverse problem).

Nobody served the layer where coding agents actually operate: **source files in a git checkout**.
An agent editing an abapGit repo cannot get lint feedback, a cloud-readiness verdict, or correct
RAP boilerplate without a system connection it usually doesn't have and shouldn't need.
That asymmetry — agents work on files, ABAP tooling assumes systems — is the product thesis.

**Rejected:** building yet another ADT bridge (crowded, credential-heavy, SAP's official one will
win that lane) and bundling docs search (existing servers do it; composition over duplication —
run both servers side by side).

## 2. abaplint as the engine

[abaplint](https://abaplint.org) is the de-facto open-source ABAP static analyzer: a complete
ABAP parser written in TypeScript, ~180 rules, version-aware down to `Cloud` as a language level.
TypeScript-native means it runs **in-process** — no RFC, no subprocess, no system.

Prior art made this a low-risk bet: the same engine already powers RAP Dojo's in-browser
exercise linting (`/api/lint-abap`), so the integration pattern — fresh in-memory `Registry` per
call, `MemoryFile`, filename-driven object typing — was proven before this repo existed.

**Rejected:** wrapping SAP's ATC remotely (needs a system), regex-grepping for forbidden
statements (a parser knows `WRITE` from `WRITE` inside a string literal; greps don't).

## 3. Every API empirically probed before the design was committed

abaplint's API surface was verified with probe scripts before any production code was written.
Three probe findings shaped the architecture:

1. **`version: "Cloud"` turns classic statements into `parser_error`** ("Statement does not
   exist in ABAPCloud") while the same file is clean at `v758` → readiness can be computed as a
   *diff of two parses* (decision 4).
2. **Negative probe:** deliberately broken BDEF/SRVD files produced **zero** findings — abaplint
   stores those artifacts without deep parsing. A "validated by abaplint" claim over those file
   types would have been **vacuous**. CDS views, however, are genuinely checked via the
   `cds_parser_error` rule (the broken view was caught). This single probe defined the honest
   validation contract in decision 5.
3. The rule catalog (`ArtifactsRules.getRules()`) carries metadata, tags, and examples →
   `explain_abap_rule` can be a thin projection of the analyzer's own docs instead of a copy
   that drifts.

## 4. Cloud readiness = a dual-parse diff, not a checklist

`check_cloud_readiness` parses the input twice — once at a classic baseline (default `v758`),
once at `Cloud` — and diffs the findings:

- present only at Cloud → a **cloud blocker** (valid classic ABAP that ABAP Cloud removed);
- present at the baseline too → **broken code**, reported separately and *not* counted as
  migration work.

This separation is the analytical core: a naive single-pass checker inflates migration estimates
with pre-existing bugs. Blockers are then categorized by leading statement (dynpro, list output,
report events, native SQL, …) with remediation hints, and scored by a deliberately transparent
formula (`100 − 5×blockers`, banded verdicts) — a conversation starter, not an oracle.

**Honesty requirement:** every report carries a scope note. The objective *score* stays
language-level; the released-API half is covered separately and conservatively (decision 11),
and a target system's own ATC check (`"Usage of Released APIs (Cloudification Repository)"` for
SAP Cloud ERP Public Edition / `"Usage of APIs (Cloudification Repository)"` for Private Edition &
on-prem, via check variants such as `ABAP_CLEAN_CORE_DEVELOPMENT` / `ABAP_CLEAN_CORE_READINESS`)
remains authoritative — the real vocabulary is curated in `src/data/atc-vocabulary.json` and
exposed on every readiness report as `cleanCoreVocabulary`; our own `grade` is blocker density
(`gradeMeaning: "blocker-density"`), never to be confused with SAP's Clean Core Level A–D.
A tool that overstated its verdict would be worse than no tool.

## 5. The scaffolder validates its own output through the analyzer

`scaffold_rap_bo` emits the canonical RAP managed-BO stack (the SAP `/DMO` reference shape:
root view with semantic admin fields, `strict(2)` BDEF, etag/lock discipline, optional draft,
projection with `transactional_query`, metadata extension, OData V4 service definition).

Before returning, every artifact abaplint *can* check (classes, CDS views) is **round-tripped
through the same parser the lint tool uses, at Cloud level** — the generator and the linter share
one definition of "valid", so the scaffold cannot drift into syntax the lint would reject. A CI
test pins `validationIssues = []` for the draft and non-draft variants.

Artifacts abaplint can't deeply parse (BDEF/SRVD — see probe finding 3.2) are golden-tested
templates, explicitly labeled `validated: "template"`, with ADT activation named as the final
arbiter. **Rejected:** claiming blanket "machine-validated" status — the negative probe proved
that would be a lie for two of the eight files.

## 6. Text-in/JSON-out; no filesystem; local and remote transports

Tools accept source as strings and return structured JSON. The analysis engine makes zero network
calls and never touches the user's filesystem — its attack surface is a parser over text the caller
explicitly provides. With the default stdio transport, analysis stays in the local server process.
The optional Streamable HTTP transport sends that same text to the machine hosting the endpoint;
it therefore has a separate privacy and operations contract documented in `PRIVACY.md`.

**Rejected for v0.1:** a `lint_directory` tool (filesystem access; the mcp-kit `wrap-abaplint`
recipe and the abaplint CLI already serve that need). HTTP was also deferred while local clients
were the only target. ChatGPT web's remote-MCP/plugin model created a concrete need, so the HTTP
edition was later added as a separate entry point: stateless `/mcp`, loopback bind by default,
optional bearer authentication, bounded bodies, concurrency and rate controls, and no source-body
logging. Stdio remains the zero-operations default.

## 7. mcp-kit discipline, vendored not depended

The server follows [mcp-kit](https://github.com/palimkarakshay/mcp-kit)'s production patterns — a
typed `ToolSpec` consumed by both registration and a description lint, structured error results
instead of crashes, stdout reserved for JSON-RPC (logs to stderr). The two small pattern files
are vendored with attribution because `@mcp-kit/core` isn't on npm and a public repo can't
depend on a workspace path.

Tool-description quality is **CI-enforced**: an in-repo rubric test requires verb-first names, a
"Use this when…" sentence, explicit non-goals, every parameter described, and a worked example on
every tool. The original eight-tool surface scored 100/100 in the full mcp-kit lint — and grading this server
surfaced a gap in the kit itself (its imperative-verb whitelist lacked `lint`/`scaffold`/
`explain`), fixed upstream in the same session: the consumer improved the kit.

## 8. Statelessness as a concurrency strategy

Every call builds a fresh abaplint `Registry` from the request's own files. No caches, no shared
mutable state → concurrent tool calls cannot interact, and the server needs no lifecycle
management. The cost (re-parsing per call) is irrelevant at MCP call rates; the correctness win
is structural. Inputs are still bounded (32 files / 100k chars / 500 findings) because a parser
is compute even when it isn't I/O.

## 9. Agent ergonomics over protocol minimalism

- Filenames are **inferred** from source shape (`CLASS …` → `.clas.abap`) because agents
  shouldn't need to know abapGit naming to lint a snippet — but explicit names are validated
  against the convention, since the filename *is* abaplint's object-typing signal.
- Every finding carries the **offending line excerpt** and a **rules.abaplint.org URL**, so an
  agent can fix code without re-opening the file and a human can read the docs.
- The default lint preset (`style`) disables whole-program semantic checks that would
  false-positive on isolated snippets (the "missing object" noise problem); `full` re-enables
  them for whole-repo calls. Defaults match the common call, flags match the careful one.

## 10. Scope: ten tools and three prompts, one domain, no padding

The tool list maps one-to-one to verbs an agent actually issues during ABAP work: lint, check
readiness, plan a migration, compare a rework, scaffold, check released-API status, browse rules,
explain a finding, format, and outline. Three prompts compose those primitives into review,
mentoring, and migration workflows. Nothing speculative (no "run ABAP" — impossible offline; no
docs search — exists elsewhere; no system bridge — decision 1). A small surface the model can
route reliably beats a broad one it cannot.

## 11. Released-API check: SAP's own list, bundled and dated — not a guess

Decision 4 deliberately left released-API coverage to a system's ATC. That gap is now *partially*
closed offline, honestly, using **SAP's own published data** rather than a hand-maintained
blocklist that would rot.

**Source.** SAP publishes the [ABAP Cloudification Repository](https://github.com/SAP/abap-atc-cr-cv-s4hc)
(`SAP/abap-atc-cr-cv-s4hc`, **Apache-2.0**): ~34.7k objects each tagged `released`,
`deprecated`, or `notToBeReleased`, with successor hints. A dev-only build script
(`scripts/build-released-api-index.mjs`) fetches it and transforms it into a compact name→state
index (`src/data/released-apis.json`: uppercased objectKey → `[objectType, state,
applicationComponent]`, ~2.2 MB), stamped with a `snapshotDate` and `source`. **This is the only
network access in the project, and it never runs at serve time** — the server imports the bundled
JSON, a package asset exactly like abaplint's own rule data. Apache-2.0 requires attribution when
redistributing; it is credited in README, here, and in the data file's `source`/`license` fields.

**Three states, mapped honestly.** SAP's `notToBeReleased` (classic DDIC tables, internal
objects) and "absent from the list" both surface as our `not-released` — *"not a released API as
of the snapshot"*, never "proven safe to ignore". `deprecated` and `released` are taken verbatim.

**`check_released_api`** is the direct lookup (names in → states + curated CDS successors out).
**Readiness integration** is the cautious part: the source is walked via abaplint's AST (not
regex) for the references the parser exposes as first-class expressions — DB tables in every SQL
statement kind (`DatabaseTable`, incl. joins/FROM) and function modules in `CALL FUNCTION`
(`FunctionName`). Matches against the snapshot become `releasedApiFindings` — a **separate, dated,
informational** field. They are *not* folded into `cloudBlockerCount`/`score`: those are
objective parser-level numbers, and mixing in a dated heuristic list would corrupt the one number
the tool can stand behind. Only direct non-released *table* access and *deprecated* usage are
flagged; a `CALL FUNCTION` simply absent from the list is too noisy to report without a system to
confirm against. The successor map (`src/data/table-successors.json`) is hand-curated for ~30
common tables, using SAP's published successors where available (e.g. `MARA → I_Product`).

**Rejected:** counting released-API hits in the score (decision 4's objectivity is the product's
credibility); a regex sweep for table names (a parser distinguishes a table from an identically
named variable; greps don't); shipping the full 9 MB upstream file (dropped fields not needed for
a name→state lookup).

## Decision 9 — assessment & rework surfaces: grade, focus, compare, Mermaid (2026-06-11)

Four additions, one principle: **new lenses over the same objective numbers, never new
subjectivity.**

**A–D grade (`check_cloud_readiness.grade`).** Assessments are communicated in letter grades,
not blocker counts. The grade is a pure banding of blocker *density* (blockers ÷ files: A = 0,
B ≤ 0.5/file, C ≤ 2/file, D worse) — density, because 30 blockers across 100 files and across
10 files are different stories, and an absolute band would flip every whole-repo run to D.
It derives from the same parser-level count as the score; decision 4's objectivity invariant
is untouched. **Rejected:** folding released-API findings into the grade (dated snapshot data
corrupting the one number we can stand behind — same reasoning as decision 4).

**Focus packs (`lint_abap.focus`).** Themed review passes (performance / security / Clean ABAP
style) previously required hand-picked rule lists. `focus` keeps only rules carrying the
matching **abaplint tag** — the analyzer's own taxonomy, so the pack cannot drift from the
rules that actually exist. Parser errors always stay on (focused findings on unparseable code
would be garbage); explicit `rules` overrides still win. Org-specific packs deliberately stay
**data, not code**: a JSON rules map (`--rules-file`, also accepts full abaplint.json) — this
server ships no company's conventions. **Rejected:** a curated in-repo rule list per theme
(drifts), an `org` preset (whose org?).

**`compare_abap`.** "Is the rework better?" needs a referee, not a diff. Findings are matched
by **content** (rule + message + offending line text), never line numbers — moved code is not
noise; the multiset match means duplicates pair off one-to-one. Blocker/score/grade movement
reuses checkCloudReadiness verbatim; structure changes come from the outline. The CLI exits 1
on introduced findings or a rising blocker count — a regression gate for modernization PRs and
AI rewrites. **Rejected:** line-based matching (every refactor would "introduce" everything it
moved), functional-equivalence claims (a parser cannot promise behavior; the matchNote says so
on every call).

**Mermaid outlines (`get_abap_outline.mermaid`).** Structure visuals for handovers and docs.
Text out (a Mermaid classDiagram), rendered by whatever already renders Mermaid — no image
generation, no new dependency, nothing leaves the no-network envelope. Identifiers are
sanitized (`~`, `/`, `.` → `_`) because Mermaid is stricter than ABAP about names.

## 16. Executing ABAP Unit offline (supersedes the "no run ABAP" stance in §10) — 2026-09-10

§10 rejected "run ABAP" as *impossible offline*. That was true when it was written and is no
longer true. **The stance is superseded, not deleted** — §10 stays on the record as the reasoning
of its date, and this section states what changed.

**What changed.** `@abaplint/transpiler` + `@abaplint/runtime` (MIT) matured into a working
ABAP → JavaScript compiler with an ABAP kernel written in ABAP itself, `open-abap-core`
(MIT, 706 sources), including `cl_abap_unit_assert` and a `KERNEL_UNIT_RUNNER` that returns a
**structured** per-method result table (class, test class, method, status, expected, actual,
message, runtime, JS location, console). abaplint's own repositories — and SAP's own open-source
ABAP projects — run their test suites this way in CI. A measured spike on the target hardware:
parse 1.3 s, transpile 2.2 s, execute 0.4 s. That is inside an agent's patience.

**Why it matters more than another lens on static text.** TH Köln's ABAP benchmark (arXiv
2601.15188, 180 tasks, create → activate → ABAP Unit, ≤5 feedback rounds) moves Claude Opus 4.5
from 31.6% to 78.7% and GPT-5 from 19.3% to 77.1% *purely* by feeding execution results back into
the loop. abap-mcp already shipped the static half of that loop; `run_abap_unit` is the
executable half, and it is the only one that exists without a system and credentials.

**What stays exactly as true as it was in §10.**
- **It is not SAP's kernel.** It is the open-abap kernel on Node. No database (any ABAP SQL
  aborts the method), no CDS, no EML/RAP runtime, no AMDP, no authority checks, no locks, no
  ATC, no activation. Constructs in that list are detected in the AST and returned in
  `unsupported` — a green run must never be able to hide them.
- **A green run is evidence about pure logic, never proof of system behavior.** Every result
  carries `RUN_SCOPE_NOTE` verbatim, and the honest static lint at the caller's target ABAP
  version travels next to the run, produced by the same `runAbaplint` every other tool uses.
- **No network, in either direction.** The library is a package-bundled asset
  (`src/data/open-abap-core.json`, 1.3 MB / 178 KB gzipped, built by the dev-only
  `scripts/build-open-abap-lib.mjs` — the second script in the repo that may touch the network,
  and like the first it never runs at serve time).
- **No user filesystem.** The only path the engine touches is a `mkdtemp` directory it creates
  under `os.tmpdir()` and removes in a `finally`. Sources come in as text, as always.

**The execution boundary, deliberately narrow.** The child is started with `execFile` (never a
shell) on `process.execPath`, in the server-owned temp directory, with a scrubbed environment
(`PATH` only — the caller's ABAP must not see this process's configuration), a hard timeout
(20 s default, 60 s cap) with `SIGKILL`, and a bounded output buffer. On a timeout or a crash,
every method that had not reported is returned as `error` — silence is never read as a pass.
Temp paths are stripped from every message before it leaves the module, and nothing is logged.

**Opt-in on MCP, always on in the CLI.** Executing transpiled code is a different trust decision
from parsing text, so the MCP surface gates the tool behind `ABAP_MCP_ENABLE_RUN=1`
(`RUN_TOOLS_ENABLED`); a developer who runs our binary has already made that decision, so
`abap-mcp unittest --run` is always available and exits 1 on any failure — the CI gate.

**Rejected:** shipping the *transpiled* library (443 KB gzipped and opaque — the ABAP sources are
smaller, auditable, and let the parse double as the syntax check); caching the parsed registry
across calls (§8's statelessness is worth 1.3 s); running the tests in-process (a caller's endless
loop would take the server with it); Node's experimental permission model (it would break Node 20,
which `engines` still supports); claiming ATC or activation coverage of any kind.

**2026-09-10 (post-review hardening).** `WRITE '@KERNEL ...'.` emits raw JavaScript, not
transpiled ABAP, so every source is now scanned (case-insensitive) and the run refused first.
The permission-model rejection above no longer holds: `engines.node` moved to `>=22` (matching
`@abaplint/core@2.120.48`'s own floor), so the child also runs under `--permission` there (temp
dir + the runtime's dependency graph only, no child processes/workers — `sandbox` on
`UnitRunResult`; older Node stays unsandboxed). The CLI no longer truncates >32 files or exits 0
on zero discovered test methods.

## 17. Bundled knowledge base + the licensing boundary — 2026-09-10

`explain_abap_release` / `search_sap_knowledge` needed dated SAP facts (release deltas, Clean Core
governance, SAP-AI options) an agent can consult before writing ABAP — the same problem decision 11
solved for released-API state, generalized to prose. **Bundleable:** SAP's own Apache-2.0 GitHub
data (`SAP/abap-atc-cr-cv-s4hc`) and CC-BY-4.0 documentation excerpts (`SAP-docs/sap-artificial-
intelligence`), attributed. **Not bundleable:** help.sap.com prose, community.sap.com blog text,
SAP Notes — their licence doesn't permit redistribution. The line held by writing **abap-mcp's own
original summary** of every fact, citing the source URL rather than copying its wording, with a
`confirmed`/`reported` confidence flag for how independently a fact was checked. `MANIFEST.json`
records curation date, licence and every source URL per bundled file — decision 11's provenance
discipline, now applied to prose.

**Rejected:** copying help.sap.com text with attribution (attribution doesn't grant redistribution
rights); a live doc-search tool (violates the offline invariant, decision 1's rejected lane).

## 18. Edition-aware released-API data + SAP's own successors supersede the curated map — 2026-09-10

Decision 11 shipped one snapshot and a 30-table hand-curated successor map. Two gaps: SAP publishes
**three** edition-specific lists (Public Edition `objectReleaseInfoLatest`, BTP `_BTPLatest`,
Private Cloud `_PCELatest`) with materially different release states per object, and the upstream
data already carries `successors[]` for most objects — the curated map was redundant wherever SAP
already answered. `check_released_api` / readiness / deps / the CLI now take an `edition` parameter
(`s4hc` default, `btp`, `pce`); each record carries `successorSource: "sap" | "curated" | "none"`
so a caller can tell SAP's guidance from abap-mcp's fallback. `table-successors.json` **stays**,
demoted to a fallback used only when `successors[]` is absent. `api-classifications.json`
(classicAPI/noAPI/internalAPI, same source repo) rides along on the same `edition`.

**Rejected:** dropping the curated map (still needed where SAP's data doesn't cover it); one
merged cross-edition file (editions genuinely disagree on release state).

## 19. `scaffold_abap_ai_sdk` validated against abap-mcp's own stubs — the fourth label — 2026-09-10

`scaffold_rap_bo` validates against abaplint's real parser (`"abaplint"`); BDEF/SRVD templates are
golden-tested only (`"template"`, decision 5). The ABAP AI SDK scaffolder needed a third answer:
it parses fine, but only because abap-mcp *also* ships its own declarations of the referenced
`IF_AIC_*`/`CL_AIC_*`/`CX_AIC_*` types (`src/data/aic-stubs/*.abap`) — written from SAP's docs, not
SAP source, not guaranteed to match SAP's real signatures exactly. Labelling that `"abaplint"`
would overclaim; the new label, `validated: "abaplint-syntax"`, says precisely what was checked:
the ABAP parses against *our* stand-in types. The upstream SAP sample for `function-calling` has a
known bug (an undeclared `tool_calls` table used before declaration); the golden template fixes
it, so the scaffold is also more correct than the source it studied.

**Rejected:** claiming `"abaplint"` (implies parity with SAP's real API, unverifiable without a
system); shipping SAP's actual class signatures (not ours to redistribute, and would drift).

## 20. The opt-in online companion, `abap-mcp-genai` — 2026-09-10

Every other decision in this log defends "zero outbound network calls" as a hard invariant.
SAP-ABAP-1 (the fine-tuned explanation model, reachable only through a tenant's own Generative AI
Hub orchestration service) breaks that invariant by definition — there is no offline version.
Bolting it onto `abap-mcp` behind an env flag would make "does my source leave this machine" depend
on a runtime setting nobody reliably audits before pasting production code. A **separate binary**
(`abap-mcp-genai`, `src/genai.ts` + `src/genai/`) makes the answer visible in the MCP config
itself: if it isn't listed, nothing here ever calls out. It speaks Orchestration **V2** only (V1
retires 2026-10-31), authenticates with the caller's own XSUAA client-credentials grant against
their own `AICORE_SERVICE_KEY`, and sends only two things over the wire: the source text passed to
`explain_with_sap_abap_1`, and no source at all for the metadata-only `list_genai_hub_models`.

**Rejected:** a flag on the default server (audit-hostile, above); calling a shared/vendor-hosted
endpoint (every caller's ABAP source would transit infrastructure abap-mcp's author controls).

## 21. Agent-ergonomic error contract — 2026-09-10

Errors used to be a bare message string. An agent that gets `"invalid_input: …"` with nothing else
either retries blindly with the same bad arguments or gives up and answers from memory — both worse
than the tool call never having happened. Every thrown `McpToolError` now carries a machine-
readable `kind` (the existing error-code enum, aliased as `kind` for the spec-facing name), an
optional `hint` (one sentence on what to change), and `nextTools` (the right tool to call instead,
when there is one). `errorResult()` intentionally omits `structuredContent` on errors: the MCP SDK
validates `structuredContent` against the tool's *success* schema even when `isError: true`, so
attaching an error shape there gets the whole result rejected by strict clients (OpenClaw, the MCP
inspector) before the model ever sees the message.

**Rejected:** a separate error `outputSchema` per tool (more surface to keep honest than the fixed
three-line text contract); silently swallowing `hint`/`nextTools` when absent (empty is signal too).

## 22. A native BDEF/SRVD checker, and a fourth `validated` label — 2026-09-10

`abaplint` does not deep-parse RAP behavior definitions (`behavior_definition.js` is one regex and
`listEntities()`) and does not parse service definitions at all (`service_definition.js` is a naming
stub). So every BDEF and SRVD this server ever saw produced **zero findings** — and a caller could
not tell "clean" from "not parsed". That silence is the honesty problem `check_rap_behavior` exists
to fix: a tokenizer, a recursive-descent BDL/SDL grammar, and a rule registry of our own
(`src/abap/rap/`), fed by SAP's published feature tables and keyword documentation plus a 102-file
corpus of Apache-2.0 SAP sample sources (`evals/rap/fixtures/`).

**The fourth label.** `ScaffoldFile.validated` becomes four-valued: `"abaplint"` (real parser),
`"abaplint-syntax"` (§19 — our own AIC stubs), `"template"` (golden-tested only), and now
`"rap-checker"` — parsed by our own BDL/SDL parser at a stamped `grammarVersion` **and** checked
against the rule set at a stamped `rulesVersion` with zero error/warning findings. It explicitly
does not claim abaplint parsed it, that SAP's parser would accept it, or that the object would
activate; `RAP_SCOPE_NOTE` says so on every report, the way `KNOWLEDGE_SCOPE_NOTE` dates the
knowledge base. The label is never the optimistic default: a file with findings keeps `"template"`
and the findings surface. `.ddlx.asddlx` stays `"template"` — nothing checks metadata extensions,
and inventing a claim there would repeat exactly the mistake §5 was written to avoid.

**Two-tier parsing, non-negotiable.** The corpus is a *sample* of BDL, not the language: six legal
constructs never appear in it and twelve more have no confirmed syntax diagram. A parser built to
reject what it does not recognise would report legal RAP as broken. So punctuation-level breakage is
`RAP-PARSE` at severity `error`, and a well-formed statement outside our vocabulary is `RAP000` at
severity **`info`** with a message that says it is a limit of the checker, not a defect in the file.
Rules of the form *"X must be declared"* suppress themselves when an unreadable statement could have
been that X, and `summary.suppressedByUnknown` counts it, so a coverage gap is measurable rather
than invisible. The same instinct sets the severity policy: only `confidence: "confirmed"` rules may
be `error`; inferred/community-reported/conflicting ones are capped at `warning` and carry a
bracketed provenance clause. A test enforces both halves, and a checked-in expectation file pins
what the rule set produces on SAP's own samples so a false-positive regression fails CI.

**`lint_abap` routes and merges** (`rapCheck`, default `true`; CLI `--no-rap`): the RAP findings come
back namespaced `rap/RAP026` with abaplint's severity casing, and `rapChecked`/`rapScopeNote` say
whether the second checker ran. An agent linting an abapGit directory should not have to know to call
a second tool for the two file types that produce nothing without it.

**Rejected:** folding RAP findings into `check_cloud_readiness` (readiness is `diff(Cloud, baseline)`
and BDL has no classic dialect to diff — it would repeat the `releasedApiFindings` mistake §4's
invariant already forbids); making the parser strict enough to reject unknown constructs (see above);
implementing the catalog rules that need behavior-pool classes, DDIC tables or CDS field types
(RAP015/RAP027/RAP042/RAP043/RAP055 and the composition-tree set) — a BDEF-only checker can only
guess there, and a guessed error is worse than no tool.
