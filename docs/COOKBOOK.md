# abap-mcp Cookbook — practical recipes for ABAP developers

How to actually use this thing day-to-day: with an AI assistant (MCP), without one (CLI),
in CI, and in agentic workflows. Every recipe works offline — no SAP system, no credentials.

---

## 1. Setup in 60 seconds

```bash
# Claude Code (global)
claude mcp add abap-mcp -- npx -y abap-mcp

# per-repo .mcp.json (Cursor / Claude Code / anything MCP)
{ "mcpServers": { "abap-mcp": { "command": "npx", "args": ["-y", "abap-mcp"] } } }

# no AI at all — the same engine as a CLI
npx abap-mcp lint src/
npx abap-mcp readiness src/ --fail-below 80
```

**Tip — pin it in the repo's CLAUDE.md / AGENTS.md** so the assistant uses it without being asked:

> Before claiming any ABAP change is done, run it through abap-mcp `lint_abap`
> (preset `style`, `abapVersion` matching this system). For anything headed to
> ABAP Cloud, run `check_cloud_readiness` too.

That one paragraph turns "AI writes plausible ABAP" into "AI writes ABAP that parses and passes lint."

## 2. Daily-driver recipes (with an AI assistant)

**The fix-until-clean loop.** Paste a method or class and say:
*"Lint this with abap-mcp and fix every finding; re-lint until clean; explain anything you can't fix."*
The agent loops lint → edit → lint without you re-prompting — findings carry the offending line
and a docs URL, so it fixes without re-reading the whole file.

**Code review without a transport.** On an abapGit PR:
*"Run lint_abap on the changed files and check_cloud_readiness on anything touched —
summarize what a reviewer should care about, ordered by severity."*
You get an ATC-style pass *before* anything reaches the system. The dual-parse readiness
diff means pre-existing breakage isn't mislabeled as migration work.

**Explain findings to juniors.** `explain_abap_rule` returns the Clean ABAP rationale —
*"explain exit_or_check like I'm a new ABAPer, with the good/bad example"* turns every lint
finding into a teaching moment. This is the cheapest mentoring multiplier on a team.

**Navigating monster legacy objects.** A 6,000-line function group include is context-poison
for an LLM. `get_abap_outline` first: the agent sees classes/methods/FORMs, picks the two
routines that matter, and reads only those. Outline → targeted read is the difference between
an agent that times out and one that answers.

**Explaining code to functional people — with a picture.** `get_abap_outline` with
`mermaid: true` (CLI: `outline --mermaid`) returns a Mermaid classDiagram: classes, method
visibility, inheritance, interface realization, legacy FORMs. Paste it into anything that
renders Mermaid (GitHub, docs sites, wikis) and you have the structure slide for the
walkthrough meeting — generated, not drawn. Pair it with *"now explain what each method does
in functional terms"* and one tool call covers both the technical and the functional audience.

**Themed review passes.** `lint_abap` with `focus: "Performance"` (or `"Security"`,
`"Styleguide"`) restricts findings to abaplint's rules carrying that tag — *"do a performance
pass over this include"* becomes one call instead of a hand-picked rule list. Parser errors
always surface. Layer your org's own pack on top with `rules` overrides — that's how
company-specific best practices (naming, thresholds, banned statements) ride along: keep the
pack as a JSON file in the repo and the CLI (`--rules-file org-pack.json`) and your AI
assistant apply the identical config.

**Judging a rework.** `compare_abap` (CLI: `compare old/ new/`) is the objective referee for
*"is the refactored version actually better?"*: findings resolved vs introduced (matched by
content, so moved code isn't noise), blocker/score/grade movement, methods/FORMs added and
removed. The CLI exits 1 when the rework introduces findings or raises the blocker count —
a regression gate for modernization PRs and AI-generated rewrites alike.

**Greenfield RAP without the wizard.** *"Scaffold a draft-enabled RAP BO for entity Booking,
table zbooking, key booking_id, fields carrier_id:abap.char(3), price:abap.curr(16,2)"* —
eight artifacts, activation order, suggested table DDL. Paste into ADT, activate in the listed
order, create the service binding, done. Every class/CDS artifact was already round-tripped
through abaplint at Cloud level before you saw it (`validated: "abaplint"`); behavior/service
definitions are canonical templates (`validated: "template"`) — ADT activation is their arbiter.

## 3. Power usage — flags and presets that matter

- **`preset: "style"` (default)** is snippet-friendly: whole-program semantic checks are off so
  isolated code isn't drowned in "unknown object" noise. **`"full"`** turns them on — use it when
  you provide *all* referenced objects in one call (e.g. a class plus its interface).
  **`"syntax-only"`** is the objective gate: parser + CDS parser errors, nothing opinionated.
- **Rule overrides** mirror abaplint.json: `rules: { "line_length": { "length": 120 }, "7bit_ascii": false }`.
  Match your team's existing ruleset so AI feedback agrees with your CI. On the CLI,
  `--rules-file path.json` accepts a bare rules map **or** a full abaplint.json — one org pack,
  three consumers (CI, terminal, AI assistant).
- **`focus`** (`Performance` | `Security` | `Styleguide`) keeps only rules tagged accordingly —
  themed passes without rule-list curation. Explicit `rules` overrides still win, so a focused
  pass can re-enable or re-tune individual rules.
- **`abapVersion`** matters: lint at `v758` for on-prem work, at `Cloud` for Steampunk/BTP ABAP.
  The same statement can be fine in one and illegal in the other — that asymmetry IS the
  readiness check.
- **Filename = object type.** `zcl_x.clas.abap` parses as a class, `zx.prog.abap` as a report.
  Omit the filename and it's inferred from the source's first statement; pass it explicitly
  when linting locals/testclasses includes.
- **32 files / 100k chars per call.** The CLI batches automatically; over MCP, send chunks and
  aggregate — or let the agent do it (they're good at loops).

## 4. Whole-repo migration triage (the consulting use case)

Estimating an S/4HANA / ABAP Cloud migration usually starts with ATC runs on a system someone
has to provision access to. With an abapGit export you can get the language-level half in
seconds, locally:

```bash
npx abap-mcp readiness src/ --json > readiness.json
npx abap-mcp readiness src/ --fail-below 80   # exit 1 below score 80 — a ratchet for CI
```

The JSON gives blocker counts by category (dynpro, list output, native SQL, report events…)
with file:line for every finding — enough to size remediation buckets, split work between
"mechanical" (WRITE→OData) and "redesign" (dynpro flows), and track the score sprint over
sprint. The readiness JSON also carries `releasedApiFindings` — direct access to non-released
classic tables and deprecated-API usage found in the source, with CDS successor hints — *dated
and separate from the score* (see §4a). The report's scope note keeps you honest with clients:
the objective score is the statement-level half; the released-API list is a per-edition bundled
snapshot (`--edition s4hc|btp|pce`, default `s4hc`), and the system's own ATC check
(`"Usage of Released APIs (Cloudification Repository)"` / `"Usage of APIs (Cloudification Repository)"`)
is still authoritative.

**Tip:** run it per package directory (`readiness src/zfi/ src/zsd/ …`) to get per-team scores.

## 4b. Graded tech-debt assessment — the A–D deliverable

Every readiness report now carries a `grade`: **A** = no cloud blockers, **B** = ≤ 0.5
blockers/file, **C** = ≤ 2 blockers/file, **D** = worse. It is banded on blocker *density*
(blockers ÷ files), so a single object and a 500-file package grade on the same scale — and it
is derived from the same objective parser-level count as the score, with nothing subjective
mixed in. The report spells this out as `gradeMeaning: "blocker-density"` — **this is not SAP's
own Clean Core Level A–D** (a different, ATC-derived concept; see `cleanCoreVocabulary` on the
report, or `src/data/atc-vocabulary.json`, for what SAP's Level A–D actually means).

The consulting workflow on an abapGit export:

```bash
for pkg in src/*/; do
  npx abap-mcp readiness "$pkg" --json | jq -r '"\(.grade)\t\(.score)\t\(.cloudBlockerCount) blockers\t'"$pkg"'"'
done | sort
```

That's the executive page of a Clean Core assessment: a graded per-package table, generated in
seconds, each grade backed by file:line findings in categorized buckets (the remediation
appendix). Track grade movement sprint over sprint, or wire `--fail-below` into CI as the
ratchet. **Say what it is honestly:** the grade covers the language-level half (statements ABAP
Cloud removed) plus dated released-API observations — the target system's ATC remains the
authoritative word, and the report's scope note says so on every call.

## 4a. Released-API check — "is MARA released? what do I use instead?"

The other half of Clean Core: not just *does it parse in Cloud*, but *may I touch this object at
all*. `check_released_api` (CLI: `released`) looks objects up in SAP's bundled Cloudification
snapshot and tells you `released` / `deprecated` / `not-released`, with a curated CDS successor
for common classic tables:

```bash
npx abap-mcp released MARA I_Product BAPI_MATERIAL_GET_DETAIL
#   MARA                       not-released  TABL      → use I_Product
#   I_Product                  released      CDS_STOB
#   BAPI_MATERIAL_GET_DETAIL   not-released  FUNC
npx abap-mcp released MARA --json     # same, machine-readable, with snapshotDate + source
```

With an assistant: *"For each table this report SELECTs from, check_released_api it and, if it's
not released, swap in the released CDS successor."* The agent gets the successor hint inline
(`MARA → I_Product`), so it can rewrite `SELECT … FROM mara` to `SELECT … FROM i_product`
without you naming the view. This is exactly what `readiness`'s `releasedApiFindings` surfaces
automatically for the tables it finds.

**Honest edges:** the list is SAP's own published data but only as current as the bundled
**snapshot date** (printed on every call); it covers the objects in the file, not every API; and
"not-released / absent" means *"not a released API as of the snapshot"*, not proof — the target
system's ATC stays authoritative.

## 5. CI gates for abapGit repos

```yaml
# .github/workflows/abap-quality.yml
name: ABAP quality
on: [pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npx -y abap-mcp lint src/ --preset syntax-only          # hard gate: must parse
      - run: npx -y abap-mcp readiness src/ --fail-below 75          # ratchet: keep raising it
```

Both checks run in ~seconds with no SAP connectivity — they slot in front of the abapGit pull,
so broken or cloud-regressing code never reaches the dev system. (For full rule coverage in CI
you can also use the abaplint CLI directly; abap-mcp's value here is the readiness diff and one
consistent engine between CI, the CLI, and your AI assistant.)

## 6. Agentic workflows (see `examples/claude-code/`)

**Zero-setup: the built-in prompts.** Since 0.5.0 the server ships the consultant playbook as
three MCP prompts — no files to copy. In Claude Code they surface as slash commands
(`/mcp__abap-mcp__abap-review`, `…abap-mentor`, `…abap-migration-plan`); other prompt-capable
clients list them natively. `abap-review` = the reviewer flow below; `abap-mentor` = standing
over-the-shoulder teaching mode; `abap-migration-plan` = drive `plan_cloud_migration` into a
client-ready phased plan and offer to execute phase 1. The subagent files below remain the
richer, customizable versions of the same flows.

**The migration backlog in one call.** `plan_cloud_migration` (CLI: `abap-mcp plan src/`)
turns the readiness diff into a phased work breakdown — repair-the-baseline first, then quick
wins, core rework, UI re-architecture, with released-API work separate and snapshot-dated.
Every item has an S/M/L effort band and a recipe; every phase has re-checkable exit criteria,
so an agent (or a team standup) can walk the backlog and prove each step with `compare_abap`.

**Test-first rework and sequencing (0.7.0).** Before touching a class, `scaffold_abap_unit`
(CLI: `abap-mcp unittest src/ --out tests/`) generates its failing-by-default ABAP Unit harness —
fill the skeletons, get green, then rework with `compare_abap` as the referee.
`get_object_dependencies` (CLI: `abap-mcp deps src/ --mermaid`) draws who-reads-what across the
provided objects with released-API flags on the tables, so the migration order (leaves first)
falls out of the graph instead of guesswork. Readiness categories and plan items now also carry
a curated `rewrite` / `example` before-after skeleton for the canonical Cloud substitution.

**The reviewer subagent.** Drop `abap-code-reviewer.md` into `.claude/agents/` — a subagent
whose system prompt mandates: outline first, lint every changed object, readiness-check
anything cloud-bound, explain each finding with the rule rationale, never approve with parser
errors. Then: *"use the abap-code-reviewer agent on this PR."*

**The migration-sweep loop.** `abap-cloud-migrator.md` runs the loop ABAP teams do manually:
readiness-check a package → take the top category → rewrite those statements (WRITE→returning
JSON/OData, SELECT-OPTIONS→RAP filter params, FORM→method) → re-check → repeat until the
score stops improving → emit a summary of what needs human redesign. On abapGit exports this
is a genuine "leave it running over lunch" job — every iteration is verified by the same
parser, so the agent can't hallucinate progress.

**The scaffold-and-fill pattern.** Agent scaffolds the BO, then fills behavior implementations
(validations, determinations) with lint as the gate after each method. Generated skeleton +
verified increments beats one-shot generation every time.

**Maker-checker with two models.** Have one model do the migration sweep and a second do
`lint_abap --preset full` + review on the result. Disagreement = human looks. The engine being
deterministic makes it the perfect referee between two LLMs.

## 7. Use cases by persona

| Who | Pain today | Recipe |
| --- | --- | --- |
| ABAP dev with AI assistant | AI writes ABAP that *looks* right | CLAUDE.md mandate (§1) + fix-until-clean (§2) |
| Reviewer | review queue, no system access from laptop | PR review recipe (§2), reviewer subagent (§6) |
| Tech lead sizing S/4 move | weeks waiting for ATC access | repo triage (§4), graded A–D table (§4b) |
| Reviewer judging a refactor / AI rewrite | "looks better" isn't evidence | compare_abap regression gate (§2) |
| RAP newcomer | BDEF syntax + activation order maze | scaffold + explain rules (§2), academy: rapdojo.lumivara.tech |
| Team onboarding juniors | seniors repeating Clean ABAP lore | explain_abap_rule as a teaching tool (§2) |
| abapGit team | nothing gates a PR before the system | CI gates (§5) |
| Consultant doing assessments | client security says no system access | graded assessment on an export (§4b) — zero credentials is the feature |
| Functional/technical handover | code walkthroughs without visuals | outline → Mermaid diagram (§2) |
| Agent builders | agents need deterministic ABAP feedback | library API (`import { runAbaplint } from "abap-mcp"`), maker-checker (§6) |

## 8. Gotchas — honest edges

- **Not ATC.** The readiness *score* is language-level: "ready" means *no language-level
  blockers*. Released-API coverage (`check_released_api` + `releasedApiFindings`) is real but
  *partial and dated* — a bundled snapshot of SAP's published list, covering referenced tables and
  function modules, not every API; authorization checks and performance remain system concerns.
  The system's ATC is authoritative; the report says this on every call — repeat it to clients.
- **BDEF/SRVD aren't deep-parsed** by abaplint (probe-verified) — scaffold marks them
  `validated: "template"`; activation in ADT is their real check.
- **Don't lint generated/SAP-namespace code** — the namespace gate expects Z/Y custom code.
- **Two snippets, same object name** = rejected on purpose (they'd silently shadow each other).
- **Severity ≠ priority.** abaplint severities are rule defaults; triage by category and your
  own ruleset, not raw counts.

## 9. v0.11 recipes — the knowledge base, the unit-test loop, and pairing with an online server

### Offline-verify then write in-system with SAP ADT MCP / abap-adt-mcp

abap-mcp never touches a system; SAP's official ADT MCP server (GA, ships in ADT for Eclipse/VS
Code) and the community `abap-adt-mcp` do — and neither has an offline lint, readiness grade, or
released-API check of its own. Run both side by side:

1. **Offline first.** `fix_abap` → `lint_abap` → `check_cloud_readiness` (or `scaffold_rap_bo` /
   `scaffold_abap_unit` / `scaffold_abap_ai_sdk` for new objects) until the files are clean —
   entirely local, no credentials touched yet.
2. **Write and activate in the system.** Hand the same files to SAP's official server
   (`abap_creation-create_object`, `abap_activate_objects`) or `abap-adt-mcp`
   (`setObjectSource`, `activateByName`).
3. **Run the real tests.** `abap_run_unit_tests` / `abap_run_atc` (or `unitTestRun` /
   `createAtcRun` on `abap-adt-mcp`) — the real ABAP Unit and ATC runs abap-mcp cannot perform.
4. **Verify again, offline.** If the online server returned modified source, `compare_abap` or
   `check_cloud_readiness` it before calling the change done — the loop is provable from both ends.

With an assistant: *"Lint and grade this class with abap-mcp, then use SAP's ADT MCP server to
write, activate and run ATC on it, then compare_abap the result against what you started with."*
`get_abap_agent_rules({ pairedWith: ["sap-adt-mcp"] })` emits this division of labour as a paste-
ready AGENTS.md block for the repo.

### The unit-test loop with run_abap_unit

`run_abap_unit` executes ABAP Unit tests offline by transpiling to JavaScript and running on the
bundled open-abap kernel — no database, CDS, EML/RAP, AMDP, authority checks or locks, and it says
so in every result's `scopeNote`. It is **opt-in** on the MCP surface
(`ABAP_MCP_ENABLE_RUN=1`) and **always on** in the CLI:

```bash
claude mcp add abap-mcp --env ABAP_MCP_ENABLE_RUN=1 -- npx -y abap-mcp   # opt in on the MCP surface
npx abap-mcp unittest --run src/                        # every test class found under src/
npx abap-mcp unittest --run src/ --only ZCL_CALC>ADD_WORKS --timeout-ms 10000
```

With an assistant: *"Write the failing test first with scaffold_abap_unit, then run_abap_unit
until it's green; treat a green run as evidence about pure logic only."* The CLI exits 1 on any
failure, so `unittest --run` slots into the same CI gate as `lint --preset syntax-only`.

### Ask the knowledge base before designing a 2025+ RAP feature

Before assuming a RAP feature exists (or is new), ask the bundled, dated (curated 2026-09-10)
knowledge base instead of guessing from training-data memory:

```bash
npx abap-mcp release --since 2605 --kind rap          # what's new in RAP at/after the 2605 train
npx abap-mcp knowledge "draft table entity"            # free-text search across the whole bundle
```

With an assistant: *"Before you implement draft on this CDS table entity, call explain_abap_release
for 'draft table entity' and confirm the minimum release."* Rows flagged `pre-2502` exist
specifically to stop an agent presenting an established feature (business events, late numbering)
as a 2025-26 novelty. Every row carries a cited `sourceUrl` and a `confirmed`/`reported` confidence
flag — read both before it goes in a client deliverable.

### Scaffold a Generative AI Hub call from ABAP

`scaffold_abap_ai_sdk` generates a validated ABAP class calling the Generative AI Hub through the
ABAP AI SDK (ISLM) — the class/method names are checked against abap-mcp's own bundled stubs, not
guessed from memory (a real hallucination surface: e.g. inventing `CL_AIC_PROMPT_TEMPLATE`):

```bash
npx abap-mcp aisdk --scenario ZDEMO_AI_SCENARIO --interaction function-calling --test --out ./out
```

With an assistant: *"Scaffold an ABAP AI SDK function-calling class for scenario ZSTOCK_AGENT with
a get_current_stock_level tool, plus a unit-test skeleton."* Read the returned `setupSteps` —
manual ISLM configuration (extended AI Core plan, `SAP_COM_0A69`, INTS/INTM deploy+activate) this
tool cannot perform — and the `validated: "abaplint-syntax"` label: the ABAP parses against
abap-mcp's own `IF_AIC_*` stubs, not a guarantee it matches SAP's real API signatures exactly.

### Which edition am I on? (s4hc/btp/pce)

Released-API state genuinely differs by SAP edition. `check_released_api`, readiness, `deps`, and
the CLI all take `--edition` (`s4hc` = S/4HANA Cloud Public Edition, `btp` = BTP ABAP environment,
`pce` = Private Cloud Edition / on-premise; default `s4hc`):

```bash
npx abap-mcp released MARA --edition s4hc     # Public Edition state + SAP's own successor
npx abap-mcp released MARA --edition pce      # same object, Private Cloud Edition state
npx abap-mcp readiness src/ --edition btp     # readiness's releasedApiFindings for BTP
```

Pick the edition that matches the actual target system — a Private Cloud on-prem team checking
against the Public Edition snapshot (or vice versa) will get plausible-looking but wrong verdicts.
`successorSource` on each finding tells you whether the successor came from SAP's own published
data (`"sap"`) or abap-mcp's curated fallback (`"curated"`, used only when SAP's data has none).
