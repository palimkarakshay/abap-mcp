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

**Honesty requirement:** every report carries a scope note saying this is the *language-level*
half of readiness; released-API usage needs a system's ATC (`SAP_CP_READINESS`). A tool that
overstated its verdict would be worse than no tool.

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

## 6. Text-in/JSON-out; no filesystem, no network

Tools accept source as strings and return structured JSON. The server makes zero network calls
and never touches the filesystem — the entire attack surface is a parser over text the caller
explicitly provides. This also keeps it trivially safe to run anywhere (CI, a locked-down
laptop, a customer engagement) and honest about privacy: code never leaves the process.

**Rejected for v0.1:** a `lint_directory` tool (filesystem access; the mcp-kit `wrap-abaplint`
recipe and the abaplint CLI already serve that need) and an HTTP transport (stdio covers every
current client; HTTP adds an auth surface for no demonstrated demand).

## 7. mcp-kit discipline, vendored not depended

The server follows [mcp-kit](https://github.com/palimkarakshay/mcp-kit)'s production patterns — a
typed `ToolSpec` consumed by both registration and a description lint, structured error results
instead of crashes, stdout reserved for JSON-RPC (logs to stderr). The two small pattern files
are vendored with attribution because `@mcp-kit/core` isn't on npm and a public repo can't
depend on a workspace path.

Tool-description quality is **CI-enforced**: an in-repo rubric test requires verb-first names, a
"Use this when…" sentence, explicit non-goals, every parameter described, and a worked example on
every tool. The full mcp-kit lint scores all seven tools 100/100 — and grading this server
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

## 10. Scope: seven tools, one domain, no padding

The tool list maps one-to-one to verbs an agent actually issues during ABAP work: lint, check
readiness, scaffold, browse rules, explain a finding, format, outline. Nothing speculative
(no "run ABAP" — impossible offline; no docs search — exists elsewhere; no system bridge —
decision 1). A small surface the model can't mis-select beats a broad one it can.
