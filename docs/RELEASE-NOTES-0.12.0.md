# abap-mcp v0.12.0 — the two files abaplint cannot read

RAP behavior definitions and CDS service definitions were the blind spot in every previous release.
abaplint stores a `.bdef.asbdef` behind a **single regex** (`behavior_definition.js` exposes only
`listEntities()`) and does not parse a `.srvd.srvdsrv` **at all** — so `lint_abap` returned zero
findings for both, and nothing told the caller whether that meant "clean" or "never parsed". The
scaffold's own BDEF and SRVD carried `validated: "template"` for the same reason: golden-tested, but
machine-checked by nothing.

v0.12.0 closes that with a checker of our own: a tokenizer, a recursive-descent BDL/SDL grammar with
error recovery, and a 48-rule registry, all offline, in `src/abap/rap/`.

**18 tools ship by default** (up from 17), a 19th (`run_abap_unit`) stays opt-in, and the 4 MCP
prompts are unchanged. `npm run check` — 1378 tests across 31 files, typecheck, build, and the
35-case routing eval — stays green.

## What's new

### `check_rap_behavior` — a native BDEF/SRVD checker
Give it a behavior definition, a service definition, and (optionally) the base BDEF and the
`.ddls.asddls` views it depends on. It reports:

- **the consistency set** — draft ⇄ `draft table` ⇄ `total etag` ⇄ `lock master` ⇄
  `authorization master` ⇄ numbering, and the ETag master/dependent obligation;
- **strict-mode obligations** — the rules that only bind when the BDEF declares `strict`/`strict(2)`
  (pass `strict: true` to see what a BO would have to fix before it can be released under a C0/C1
  contract);
- **coherence rules** across actions, operations, validations, determinations, determine actions,
  draft actions, side effects and events;
- **cross-file rules**, and only for the files you pass in the same call: projection → base BDEF,
  BDEF → CDS entity and its elements, service `expose` → CDS entities;
- **release gating** (`RAP900`) when you pass `abapRelease` — from a bundled, dated transcription of
  the ABAP-Cloud columns of SAP's RAP BDL feature tables.

CLI: `abap-mcp rapcheck [paths…] [--release 2508] [--strict] [--json]`, exit 1 on errors only.

Two of the ids describe the *call* rather than your RAP: `RAP-DUP` (error) reports an entity
characteristic declared twice on one entity — the parser keeps the first and would otherwise judge a
file you did not write — and `RAP-INPUT` (warning) reports two files passed under one filename, which
used to switch off every cross-file rule silently. A call with no `.bdef.asbdef` and no
`.srvd.srvdsrv` is refused outright with a structured `invalid_input` error instead of returning an
empty, clean-looking report; `abap-mcp rapcheck` has always refused the same call with exit 2.

Which entity is the BO *root* is derived, not read off statement order: the one entity whose CDS view
is a `define root view entity` when you pass the `.ddls`, else the first `define behavior for` (SAP's
documented convention). No SAP source states that root-first is enforced, so a legal behavior
definition that declares a child before the root is read in either order and reports nothing.

### `lint_abap` routes and merges
A `lint_abap` call (or `abap-mcp lint`) containing a BDEF/SRVD now runs the RAP checker over the
whole set and merges its findings under namespaced keys — `rap/RAP026`, `rap/SRVD003`,
`rap/RAP900` — with abaplint's severity casing, the hint appended to the message, and
`rapChecked` / `rapScopeNote` on the result. New `rapCheck` parameter (default `true`; CLI
`--no-rap`) opts out for a CI job that compares abaplint finding counts across versions.

### The fourth `validated` label: `"rap-checker"`
`scaffold_rap_bo` now runs its own generated CDS + BDEF + SRVD through the checker in one call, so
the cross-file rules run on our own output, and returns them as `rapFindings`. The BDEF and SRVD are
labelled `validated: "rap-checker"` — parsed by abap-mcp's own parser at a stamped `grammarVersion`
**and** clean under the rule set at a stamped `rulesVersion`. It never claims abaplint parsed them,
that SAP's parser would accept them, or that they would activate. A file with findings keeps
`"template"`; the `.ddlx.asddlx` keeps `"template"` permanently, because nothing checks metadata
extensions. The keystone test now asserts `validationIssues === []` **and** `rapFindings === []`
(infos included) for both the draft and non-draft variants.

One template fix fell out of that gate, exactly as intended: the draft projection BDEF now emits
`use action Edit/Activate/Discard/Resume/Prepare`, which strict mode requires (RAP018).

## The honesty design, on purpose

The grammar is derived from SAP's published feature tables and keyword documentation plus a
**102-file corpus of Apache-2.0 SAP sample BDEF/SRVD sources** (17 repositories, in
`evals/rap/fixtures/` with provenance). A corpus is a sample of BDL, not the language — six legal
constructs never appear in it, and twelve more have no confirmed syntax diagram. So the parser is
two-tier and always will be:

| Situation | Reported as |
|---|---|
| Punctuation-level breakage — unbalanced braces, a statement that hits EOF without `;` | `RAP-PARSE`, **error** |
| A well-formed statement outside our vocabulary | `RAP000`, **info** — *"a limit of the checker, not necessarily an error in your file"* |

Both tiers apply to service definitions as well as behavior definitions, and they are **exclusive**:
an unknown SDL statement is an info, a punctuation error is an error and never also an info, and
`SRVD001`/`SRVD007` never claim anything about a file whose body the checker could not fully read. A rule whose only evidence is the file set you happened to pass is a
**warning**, not an error, even at `confidence: "confirmed"` — `RAP002` and `SRVD006` both say "not
found among the sources in this call", because absence there means "not supplied", not "does not
exist".

A rule of the form *"X must be declared"* suppresses itself when an unreadable statement could have
been that X, and `summary.suppressedByUnknown` counts it (both parsers feed that one counter) — the
suppression is scoped to the file the missing declaration would have to be *in*, so an unreadable
header statement in a **base** BDEF silences `RAP008` on its projection. A cross-file rule likewise
stays silent, and counts in `summary.baseUnresolved`, when a projection view's `as projection on`
target names a base entity no BDEF in the call defines — the checker will not fall back to matching
some other base by alias. The severity counts (`errors`/`warnings`/`infos`) are taken over the
**uncapped** finding set, with `summary.omitted` saying how many findings the report cap dropped, so
`abap-mcp rapcheck` still exits 1 on an error whose finding did not fit. Only rules with `confidence: "confirmed"`
may carry severity `error`; inferred, community-reported and conflicting rules are capped at
`warning` and end their message with a bracketed provenance clause — a test enforces both halves.
Every report carries `grammarVersion`, `rulesVersion` and `scopeNote` verbatim, the same dating
discipline the knowledge base uses.

## What it still cannot do

It does not connect to SAP, activate anything, or run ATC. It cannot see DDIC tables, behavior-pool
classes, or CDS field types, so the catalog rules that need them are **not implemented** rather than
guessed — RAP015/RAP043/RAP055 (handler methods), RAP027 (draft-table fields), RAP042/RAP044 and
RAP040's `raw(16)` half (ABAP types), the composition-tree set (RAP004/RAP005/RAP021/RAP033/
RAP062/RAP063/RAP075 and RAP031's reachability half), RAP069–RAP074 (naming conventions, v1.1 behind
a `conventions` option) and RAP078–RAP080 (BDEF extensions, whose body grammar is unconfirmed —
extensions parse permissively and are never rule-checked). All of it is listed in
`docs/RAP-RULES.md` and `docs/specs/rap-checker-design.md` §3.6.

ADT activation in the target system remains the only authority on whether these objects are valid.

## Testing

- **Corpus gate:** all 79 BDEFs and 23 SRVDs parse with zero `RAP-PARSE` errors and zero `RAP000`
  unknowns; fixture counts are asserted so a deleted fixture fails CI instead of weakening the gate.
- **Golden rule fixtures:** every registered rule ships `ok`/`bad` fixtures, and meta-tests assert no
  rule can ship untested, undocumented, or with a severity its confidence does not license.
- **Anti-noise expectation file** (`evals/rap/corpus-expectations.json`): the findings the rule set
  produces on SAP's own samples are pinned by number and identity, so a rule that suddenly fires
  forty more times is a false-positive regression, not a silent change.
- **Hallucination seeds:** one deterministic case per model-invented RAP defect — `draft action
  Reject` (RAP081), a factory action with a `result` clause (RAP048), `with draft` on an entity
  (RAP024), `provider contracts odata_v4_web_api` (SRVD002).

## Upgrading

Nothing is removed. Two shapes changed, both additive:

- `ScaffoldResult` gains `rapFindings`, and `ScaffoldFile.validated` gains the value
  `"rap-checker"` — a consumer matching on the exact strings `"abaplint" | "template"` should add it.
- `lint_abap` gains `rapChecked` and (when true) `rapScopeNote`, plus `rap/…` findings for BDEF/SRVD
  calls. `rapCheck: false` restores the previous, abaplint-only output exactly.
