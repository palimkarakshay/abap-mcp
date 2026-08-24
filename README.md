# abap-mcp

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
- *"How far is this classic report from ABAP Cloud? Grade it."* → `check_cloud_readiness` (A–D)
- *"Plan the migration — what do we tackle first?"* → `plan_cloud_migration` (phased backlog)
- *"Did this rework make the code better or worse?"* → `compare_abap`
- *"Is MARA a released API? What do I use instead?"* → `check_released_api`
- *"Start me a correct RAP business object."* → `scaffold_rap_bo`
- *"What's in this 4,000-line class? Draw it."* → `get_abap_outline` (+ Mermaid)

## Install — 60 seconds

The only requirement is [Node.js 20+](https://nodejs.org). No SAP system, no credentials, no
API keys — pick your client:

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

**Cursor · Windsurf · VS Code (Copilot agent mode) · any MCP client** — add this to its
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

Connected? Ask your agent *"list your ABAP tools"* — you should see all ten, `lint_abap`
through `get_abap_outline`.

### First things to ask

- *"Lint this class against ABAP Cloud and explain the worst finding like I'm new to ABAP."*
- *"How cloud-ready is this repo? Grade it and plan the migration in phases."*
- *"Is MARA a released API? What do I use instead?"*
- *"Scaffold a RAP BO for entity Booking on table zbooking, draft enabled."*
- *"I reworked zcl_pricing — compare old vs new: did it actually get better?"*

### Guided workflows built in (MCP prompts)

The consultant's playbook ships both as three MCP prompts and as three Codex plugin skills. In
Claude Code the prompts appear as slash commands (`/mcp__abap-mcp__…`); prompt-capable clients
list them natively, while the Codex plugin discovers the corresponding skills:

| Prompt | What it sets up |
| --- | --- |
| `abap-review` | A full senior-consultant code review: lint → triage → explain each finding's *why* → minimal fixes → prove the rework with `compare_abap`. Optional `focus` (Performance / Security / Styleguide). |
| `abap-mentor` | Over-the-shoulder mentoring mode for the rest of the session: every snippet is quietly linted and readiness-checked, findings become plain-language guidance, new objects start from validated scaffolds. |
| `abap-migration-plan` | A client-ready phased migration plan driven by `plan_cloud_migration` — current state, phases with S/M/L efforts and exit criteria, released-API work separated — then offers to execute phase 1. |

## CLI — same engine, no AI required

Every tool is also a subcommand, so it works in terminals and CI where no MCP client exists:

```bash
npx abap-mcp lint src/                          # lint files or whole directories
npx abap-mcp lint src/ --focus Performance      # themed pass: Performance | Security | Styleguide
npx abap-mcp lint src/ --rules-file org.json    # your org's abaplint rule pack, same engine
npx abap-mcp readiness src/ --fail-below 80     # repo-level ABAP Cloud readiness, scored + graded A–D
npx abap-mcp plan src/                          # phased migration backlog: work items, S/M/L efforts, exit criteria
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
| `plan_cloud_migration` | The task-manager layer over readiness: arranges every blocker into a phased, consulting-ordered backlog — repair-the-baseline first, then mechanical quick wins, core rework, UI re-architecture, and a separate snapshot-dated released-API phase. Each work item carries an S/M/L effort band, a remediation recipe and sample locations; each phase carries objective, re-checkable exit criteria. Deterministic: same readiness numbers, rearranged — no new judgments. |
| `compare_abap` | Before/after verdict on a rework: lint findings resolved vs introduced (matched by content, so moved code isn't noise), blocker/score/grade movement, and classes/methods/FORMs added or removed. The objective referee for refactors and AI rewrites. |
| `check_released_api` | Looks up objects (tables, CDS views, function modules, classes, …) in SAP's bundled Cloudification snapshot → `released` / `deprecated` / `not-released` per object, plus a curated CDS successor for common classic tables. The released-API half of readiness, offline. |
| `scaffold_rap_bo` | Generates the canonical RAP managed-BO stack (root view, behavior definition `strict(2)` + optional draft, behavior class + handler locals, projection, metadata extension, OData V4 service definition) plus suggested table DDL, activation order and next steps. |
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

## Credits

- [abaplint](https://github.com/abaplint/abaplint) by Lars Hvam — the parser and rule engine
  underneath every tool here (MIT).
- [SAP/abap-atc-cr-cv-s4hc](https://github.com/SAP/abap-atc-cr-cv-s4hc) — SAP's official ABAP
  Cloudification Repository (object release list), **Apache-2.0**. The bundled released-API
  snapshot (`src/data/released-apis.json`, snapshot **2026-06-10**) is a compact transform of
  that data, redistributed under Apache-2.0 with attribution; see
  [docs/DESIGN.md](docs/DESIGN.md) and `scripts/build-released-api-index.mjs` for the pipeline.
- [mcp-kit](https://github.com/palimkarakshay/mcp-kit) — the production-MCP patterns this server
  follows (typed tool specs, transport discipline, description lint).

MIT © Akshay Palimkar. Not affiliated with or endorsed by SAP SE. "SAP", "ABAP" and "RAP" are
trademarks of SAP SE; this is an independent open-source tool for developers working with them.
