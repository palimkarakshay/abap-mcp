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
and a target system's ATC (`API_RELEASE_STATE_CHECK` / `SAP_CP_READINESS`) remains authoritative.
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
