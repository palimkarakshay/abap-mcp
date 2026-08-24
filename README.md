# abap-mcp

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_abap--mcp-0098FF?logo=githubcopilot&logoColor=white)](https://vscode.dev/redirect/mcp/install?name=abap-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22abap-mcp%22%5D%7D)
[![Install in VS Code Insiders](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?logo=githubcopilot&logoColor=white)](https://insiders.vscode.dev/redirect/mcp/install?name=abap-mcp&config=%7B%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22abap-mcp%22%5D%7D&quality=insiders)
[![npm](https://img.shields.io/npm/v/abap-mcp?logo=npm)](https://www.npmjs.com/package/abap-mcp)

**Make your AI coding agent an expert SAP ABAP & RAP consultant — local by default. No SAP
system, no credentials, one command to install.**

abap-mcp is a [Model Context Protocol](https://modelcontextprotocol.io) server that gives any AI
coding agent — Claude Code, GitHub Copilot, Cursor, Codex, Windsurf — real ABAP senses, built on
[abaplint](https://abaplint.org) (the open-source ABAP parser/linter). The agent brings the
reasoning; abap-mcp brings ground truth: a deterministic parser, objective scores, and validated
generators that keep the AI honest. It works on ABAP source wherever your agent works — a git
checkout, an abapGit export, a code review, CI — long before anything reaches a system.

- **New to ABAP or RAP?** Your agent becomes the senior consultant looking over your shoulder:
  every snippet linted against Clean ABAP as you write (`lint_abap`), every finding explained with
  its rationale and examples (`explain_abap_rule`), and `scaffold_rap_bo` starts you from a
  canonical, self-validated RAP business object instead of a blank editor.
- **Senior ABAP consultant?** It's your assessment and task engine: point your agent at a repo and
  get a scored, categorized ABAP Cloud readiness report with an A–D tech-debt grade
  (`check_cloud_readiness`), a phased migration backlog with efforts and exit criteria
  (`plan_cloud_migration`), an objective before/after verdict on every rework (`compare_abap`),
  released-API replacements (`check_released_api`), and CI gates that hold the line while the
  migration proceeds.

The default stdio edition is 100% local: the analysis engine makes **zero network calls** and
reads **no user files**. Sources go in as text and structured findings come back. The released-API
list and abaplint rule data are package-bundled. An optional guarded Streamable HTTP edition makes
the same tools available to remote clients such as ChatGPT web; in that mode, source text is sent
to the machine you host. See [privacy and data handling](PRIVACY.md).

## Why this exists

Every other ABAP MCP server is either a **bridge to a live SAP system** (ADT/RFC — needs
credentials, a system, and trust) or a **documentation search**. But AI coding agents spend most
of their time where the *files* are — editing abapGit repos, reviewing diffs, generating code —
long before anything reaches a system. This server gives agents the missing feedback loop at that
layer:

- *"Does this ABAP parse? Is it clean? How does it perform?"* → `lint_abap` (+ focus packs)
- *"Fix this block automatically — casing, obsolete syntax."* → `fix_abap` (deterministic, parser-guaranteed)
- *"How far is this classic report from ABAP Cloud? Grade it."* → `check_cloud_readiness` (A–D)
- *"Plan the migration — what do we tackle first?"* → `plan_cloud_migration` (phased backlog)
- *"This class has no tests — start me a harness."* → `scaffold_abap_unit` (failing-by-default)
- *"What depends on what? Migrate which object first?"* → `get_object_dependencies` (+ Mermaid)
- *"Did this rework make the code better or worse?"* → `compare_abap`
- *"Is MARA a released API? What do I use instead?"* → `check_released_api`
- *"Start me a correct RAP business object."* → `scaffold_rap_bo`
- *"What's in this 4,000-line class? Draw it."* → `get_abap_outline` (+ Mermaid)

## Install — 60 seconds

The only requirement is [Node.js 20+](https://nodejs.org). No SAP system, no credentials, no
API keys. **New to AI tooling (or ABAP)?** Follow the from-zero walkthrough in
**[docs/INSTALL.md](docs/INSTALL.md)** — or let the installer do it:

```bash
npx abap-mcp setup     # detects VS Code / Claude Code and registers the server; guides Eclipse
```

Otherwise, pick your client:

**Codex CLI · Codex IDE extension · ChatGPT desktop** — one command configures all three on the
same Codex host:

```bash
codex mcp add abap-mcp -- npx -y abap-mcp
```

Restart ChatGPT desktop or the IDE extension, then use `/mcp` to confirm `abap-mcp` is connected.
In ChatGPT desktop you can alternatively open **Settings → MCP servers → Add server**, choose
**STDIO**, and enter command `npx` with arguments `-y abap-mcp`.

**Codex plugin (MCP server + review/mentor/migration skills)**

```bash
codex plugin marketplace add palimkarakshay/abap-mcp
codex plugin add abap-mcp@abap-mcp
```

**ChatGPT web** cannot start a local `npx` process. It needs a deployed HTTPS `/mcp` endpoint or
a secure development tunnel. This repository ships the HTTP entry point and hardening controls,
but does not operate a public service. Follow the [OpenAI setup and self-hosting guide](docs/OPENAI.md).

**Claude Code**

```bash
claude mcp add abap-mcp -- npx -y abap-mcp
```

**VS Code (Copilot agent mode)** — one click on the *Install in VS Code* badge above, or one command:

```bash
code --add-mcp '{"name":"abap-mcp","command":"npx","args":["-y","abap-mcp"]}'
```

For a whole team, commit [`examples/vscode/mcp.json`](examples/vscode/mcp.json) as `.vscode/mcp.json`
in your abapGit repo — everyone who opens the folder gets the server offered automatically.

**Eclipse (via the GitHub Copilot plugin)** — Copilot Chat in Eclipse speaks MCP: open the
Copilot menu → *Edit preferences* → *MCP*, and add the same `"abap-mcp"` server block
(command `npx`, args `["-y", "abap-mcp"]`). Steps and prerequisites:
[GitHub's MCP docs, Eclipse tab](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp/extend-copilot-chat-with-mcp?tool=eclipse).
Stock ADT without Copilot has no MCP client today.

**Cursor · Windsurf · any MCP client** — add this to its
`mcp.json` / `.mcp.json` (project or global):

```json
{
  "mcpServers": {
    "abap-mcp": { "command": "npx", "args": ["-y", "abap-mcp"] }
  }
}
```

**Claude Desktop** — Settings → Developer → Edit Config, add the same `mcpServers` block to
`claude_desktop_config.json`, restart.

**From a clone** (contributing / hacking):

```bash
npm install && npm run build
claude mcp add abap-mcp -- node /path/to/abap-mcp/dist/cli.js
```

Connected? Ask your agent *"list your ABAP tools"* — you should see all thirteen, `lint_abap`
through `get_abap_outline`.

### First things to ask

- *"Here's my functional spec — build the RAP implementation from it."* (or run `/mcp__abap-mcp__abap-from-spec`)
- *"Lint this class against ABAP Cloud and explain the worst finding like I'm new to ABAP."*
- *"How cloud-ready is this repo? Grade it and plan the migration in phases."*
- *"Is MARA a released API? What do I use instead?"*
- *"Scaffold a RAP BO for entity Booking on table zbooking, draft enabled."*
- *"I reworked zcl_pricing — compare old vs new: did it actually get better?"*

### Guided workflows built in (MCP prompts)

The consultant's playbook ships both as four MCP prompts and as four Codex plugin skills. In
Claude Code the prompts appear as slash commands (`/mcp__abap-mcp__…`); prompt-capable clients
list them natively, while the Codex plugin discovers the corresponding skills:

| Prompt | What it sets up |
| --- | --- |
| `abap-from-spec` | **The blank-page killer.** Hand it a functional/tech spec — or a plain-language requirement — and the agent builds working, validated modern ABAP/RAP: spec → build plan with an ASSUMPTION register → deterministic `scaffold_rap_bo` foundation → behavior logic → every file gated through `fix_abap` + `lint_abap` until clean → filled unit tests → delivery in activation order. Nothing unlinted is ever delivered. |
| `abap-review` | A full senior-consultant code review: lint → triage → explain each finding's *why* → minimal fixes → prove the rework with `compare_abap`. Optional `focus` (Performance / Security / Styleguide). |
| `abap-mentor` | Over-the-shoulder mentoring mode for the rest of the session: every snippet is quietly linted and readiness-checked, findings become plain-language guidance, new objects start from validated scaffolds. |
| `abap-migration-plan` | A client-ready phased migration plan driven by `plan_cloud_migration` — current state, phases with S/M/L efforts and exit criteria, released-API work separated — then offers to execute phase 1. |

## CLI — same engine, no AI required

Every tool is also a subcommand, so it works in terminals and CI where no MCP client exists:

```bash
npx abap-mcp lint src/                          # lint files or whole directories
npx abap-mcp fix src/ --write                   # apply abaplint's deterministic auto-fixes in place
npx abap-mcp lint src/ --focus Performance      # themed pass: Performance | Security | Styleguide
npx abap-mcp lint src/ --rules-file org.json    # your org's abaplint rule pack, same engine
npx abap-mcp readiness src/ --fail-below 80     # repo-level ABAP Cloud readiness, scored + graded A–D
npx abap-mcp plan src/                          # phased migration backlog: work items, S/M/L efforts, exit criteria
npx abap-mcp unittest src/ --out tests/         # failing-by-default ABAP Unit skeletons for untested classes
npx abap-mcp deps src/ --mermaid                # dependency graph (+released-API flags) as a Mermaid diagram
npx abap-mcp compare old/ new/                  # rework verdict: findings resolved/introduced, grade movement
npx abap-mcp scaffold --entity Travel --table ztravel --key travel_id --out ./out
npx abap-mcp outline src/zcl_monster.clas.abap  # navigate big objects (--mermaid for a diagram)
npx abap-mcp released MARA I_Product            # released-API status + CDS successor
npx abap-mcp explain exit_or_check              # rule rationale
```

Directories are walked recursively (abapGit naming), batched automatically, and `readiness`
merges batches into one scored, categorized repo report. Exit codes are CI-friendly
(`1` on error findings / failed threshold).

## Agentic workflows, recipes & CI

**[docs/examples/abap2xlsx-assessment.md](docs/examples/abap2xlsx-assessment.md)** — what all
of this produces on a real, well-known open-source repo (100 files, three commands, no system).
**[docs/COOKBOOK.md](docs/COOKBOOK.md)** — practical recipes: the fix-until-clean loop,
PR review without a transport, whole-repo migration triage, CI gates, per-persona use cases.
**[examples/claude-code/](examples/claude-code/)** — drop-in agentic workflows that turn the
tools into that over-the-shoulder consultant: an `abap-code-reviewer` subagent, an
`abap-cloud-migrator` sweep loop (readiness score as the loop condition), an
`abap-tech-debt-assessor` (the graded A–D client deliverable), per-repo `.mcp.json`, and a
GitHub Actions quality gate for abapGit repos.

## Tools

| Tool | What it does |
| --- | --- |
| `lint_abap` | abaplint static analysis over ABAP/CDS/BDEF sources → structured findings with rule docs links. Presets: `style` (default, snippet-friendly), `full`, `syntax-only`; per-rule overrides for org rule packs; `focus` lens (`Performance` / `Security` / `Styleguide`) for themed reviews. |
| `check_cloud_readiness` | Dual-parse diff (classic baseline vs `Cloud`): statements that are valid today but illegal in ABAP Cloud become categorized blockers (dynpro, list output, native SQL, …) with a transparent score **and a density-banded A–D tech-debt grade**; code broken at the baseline is reported separately, not counted as migration work. Also surfaces a **separate, dated released-API cross-check** (`releasedApiFindings`): direct access to non-released classic tables and deprecated-API usage found in the source, with CDS successor hints — informational, not folded into the score. |
| `fix_abap` | abaplint's own machine-applicable corrections, applied and verified: keyword casing, obsolete statements with defined modern replacements (`MOVE` → `=`, …). Batches re-parse after every pass and a batch that would break the parse is discarded — output is parser-guaranteed, never guessed. Unfixable findings return as `remaining` for judgment-tier rework (prove it with `compare_abap`). |
| `plan_cloud_migration` | The task-manager layer over readiness: arranges every blocker into a phased, consulting-ordered backlog — repair-the-baseline first, then mechanical quick wins, core rework, UI re-architecture, and a separate snapshot-dated released-API phase. Each work item carries an S/M/L effort band, a remediation recipe and sample locations; each phase carries objective, re-checkable exit criteria. Deterministic: same readiness numbers, rearranged — no new judgments. |
| `compare_abap` | Before/after verdict on a rework: lint findings resolved vs introduced (matched by content, so moved code isn't noise), blocker/score/grade movement, and classes/methods/FORMs added or removed. The objective referee for refactors and AI rewrites. |
| `check_released_api` | Looks up objects (tables, CDS views, function modules, classes, …) in SAP's bundled Cloudification snapshot → `released` / `deprecated` / `not-released` per object, plus a curated CDS successor for common classic tables. The released-API half of readiness, offline. |
| `scaffold_rap_bo` | Generates the canonical RAP managed-BO stack (root view, behavior definition `strict(2)` + optional draft, behavior class + handler locals, projection, metadata extension, OData V4 service definition) plus suggested table DDL, activation order and next steps. |
| `scaffold_abap_unit` | Generates the local ABAP Unit test class for each global class: setup + one skeleton test per public method, every skeleton failing loudly with a TODO so generated-but-empty tests can't masquerade as coverage. Round-tripped through abaplint with the class under test. |
| `get_object_dependencies` | Dependency graph over the provided sources — parser-level table/function references (annotated with released-API state + CDS successors), inherits/implements structure, and honestly-labeled textual cross-references. Optional Mermaid flowchart. The sequencing companion to `plan_cloud_migration`. |
| `list_abap_rules` | Browse abaplint's ~180 rules (filter by text or tag). |
| `explain_abap_rule` | One rule in depth — rationale (often Clean ABAP), examples, docs URL. |
| `format_abap` | Offline pretty-printer (keyword case + indentation). |
| `get_abap_outline` | Classes/methods/visibility/interfaces/FORMs of a source — navigate big objects without reading them whole. Optional Mermaid classDiagram output for instant structure visuals. |

## Honesty box — what this is *not*

- **Not ATC.** The objective readiness *score* is still language-level: statements ABAP Cloud
  removed. Released-API coverage is now **partial and offline**: `check_released_api` and the
  `releasedApiFindings` in readiness reflect SAP's published Cloudification list *as of the
  bundled snapshot date* — they cover tables and function modules referenced in your source, not
  every API, and are only as current as the snapshot. A target system's own released-API list
  (ATC check `API_RELEASE_STATE_CHECK` / `SAP_CP_READINESS`) remains authoritative; treat an
  "absent from the list" result as "not released as of the snapshot", not as proof.
- **Scaffold validation is tiered.** Generated classes and CDS views are round-tripped through
  abaplint at Cloud level before they're returned (the generator and the linter share one
  parser). Behavior/service definitions are outside abaplint's checked surface — they are
  golden-tested canonical templates, and ADT activation is the final arbiter. Each generated
  file is labeled `validated: "abaplint" | "template"`.
- **Text-in only, by design.** The analysis engine does no user-filesystem walking or outbound
  network access; it parses strings you explicitly pass. With stdio those strings are handled by
  the local child process. With Streamable HTTP they travel to the endpoint operator, so use HTTPS,
  authentication, and the [documented privacy controls](PRIVACY.md). For whole directories, use
  the CLI below, [abaplint](https://abaplint.org) in CI, or the
  [mcp-kit `wrap-abaplint` recipe](https://github.com/palimkarakshay/mcp-kit).

## Develop

```bash
npm install
npm run check     # typecheck + tests + build + routing eval — the CI gate
node dist/cli.js  # stdio MCP server
npm run start:http # guarded Streamable HTTP on http://127.0.0.1:3000/mcp
npx @modelcontextprotocol/inspector --cli node dist/cli.js --method tools/list
```

Tool and prompt descriptions are CI-graded (a rubric test enforces verb-first names, when-to-use,
non-goals, described params, worked examples — the
[mcp-kit](https://github.com/palimkarakshay/mcp-kit) discipline).

## Design

The decision log — why offline, why abaplint, why a dual-parse readiness diff, why the
scaffolder validates its own output, what was deliberately left out — lives in
[`docs/DESIGN.md`](docs/DESIGN.md).

## Related projects

- [abap-kit](https://github.com/furkancosgun/abap-kit) by Furkan Coşgun (MIT) — a CLI that
  scaffolds complete offline ABAP projects (abapGit layout, abaplint + transpiler config, the
  [open-abap](https://github.com/open-abap) runtime) and can **execute** ABAP Unit tests locally
  via the abaplint transpiler. Complementary by design: abap-kit builds and runs the project
  harness; abap-mcp gives your AI agent the analysis, planning and scaffolding tools inside it —
  `abap-kit create` + `abap-mcp setup` is a complete offline ABAP+AI workspace. Its
  transpile-and-run pipeline is also the natural foundation for a future `run_abap_unit` tool here.

## Credits

- [abaplint](https://github.com/abaplint/abaplint) by Lars Hvam — the parser and rule engine
  underneath every tool here (MIT).
- [SAP/abap-atc-cr-cv-s4hc](https://github.com/SAP/abap-atc-cr-cv-s4hc) — SAP's official ABAP
  Cloudification Repository (object release list), **Apache-2.0**. The bundled released-API
  snapshot (`src/data/released-apis.json`, refreshed with each weekly release — tool output
  carries its `snapshotDate`) is a compact transform of
  that data, redistributed under Apache-2.0 with attribution; see
  [docs/DESIGN.md](docs/DESIGN.md) and `scripts/build-released-api-index.mjs` for the pipeline.
- [mcp-kit](https://github.com/palimkarakshay/mcp-kit) — the production-MCP patterns this server
  follows (typed tool specs, transport discipline, description lint).

MIT © Akshay Palimkar. Not affiliated with or endorsed by SAP SE. "SAP", "ABAP" and "RAP" are
trademarks of SAP SE; this is an independent open-source tool for developers working with them.
