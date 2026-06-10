# abap-mcp

**MCP server for SAP ABAP — offline static analysis, ABAP Cloud readiness, and RAP scaffolding.**
No SAP system. No credentials. Works on ABAP source wherever your AI agent works: a git checkout,
an abapGit export, a code review, CI.

Built on [abaplint](https://abaplint.org) (the open-source ABAP parser/linter) and the
[Model Context Protocol](https://modelcontextprotocol.io). TypeScript, 100% local — the server
makes **zero network calls** and touches **no filesystem**: sources go in as text, findings come
back as structured JSON.

## Why this exists

Every other ABAP MCP server is either a **bridge to a live SAP system** (ADT/RFC — needs
credentials, a system, and trust) or a **documentation search**. But AI coding agents spend most
of their time where the *files* are — editing abapGit repos, reviewing diffs, generating code —
long before anything reaches a system. This server gives agents the missing feedback loop at that
layer:

- *"Does this ABAP parse? Is it clean?"* → `lint_abap`
- *"How far is this classic report from ABAP Cloud?"* → `check_cloud_readiness`
- *"Start me a correct RAP business object."* → `scaffold_rap_bo`
- *"What's in this 4,000-line class?"* → `get_abap_outline`

## Quickstart

```bash
# Claude Code
claude mcp add abap-mcp -- npx -y abap-mcp

# or any MCP client (.mcp.json / mcp.json):
{
  "mcpServers": {
    "abap-mcp": { "command": "npx", "args": ["-y", "abap-mcp"] }
  }
}
```

From a clone instead:

```bash
npm install && npm run build
claude mcp add abap-mcp -- node /path/to/abap-mcp/dist/cli.js
```

Then ask your agent things like *"lint this class against ABAP Cloud"*, *"is zold_report
cloud-ready?"*, or *"scaffold a RAP BO for entity Booking on table zbooking, draft enabled"*.

## CLI — same engine, no AI required

Every tool is also a subcommand, so it works in terminals and CI where no MCP client exists:

```bash
npx abap-mcp lint src/                          # lint files or whole directories
npx abap-mcp readiness src/ --fail-below 80     # repo-level ABAP Cloud readiness, CI-gateable
npx abap-mcp scaffold --entity Travel --table ztravel --key travel_id --out ./out
npx abap-mcp outline src/zcl_monster.clas.abap  # navigate big objects
npx abap-mcp explain exit_or_check              # rule rationale
```

Directories are walked recursively (abapGit naming), batched automatically, and `readiness`
merges batches into one scored, categorized repo report. Exit codes are CI-friendly
(`1` on error findings / failed threshold).

## Recipes, agents & CI

**[docs/COOKBOOK.md](docs/COOKBOOK.md)** — practical recipes: the fix-until-clean loop,
PR review without a transport, whole-repo migration triage, CI gates, per-persona use cases.
**[examples/claude-code/](examples/claude-code/)** — drop-in agentic workflows: an
`abap-code-reviewer` subagent, an `abap-cloud-migrator` sweep loop (readiness score as the
loop condition), per-repo `.mcp.json`, and a GitHub Actions quality gate for abapGit repos.

## Tools

| Tool | What it does |
| --- | --- |
| `lint_abap` | abaplint static analysis over ABAP/CDS/BDEF sources → structured findings with rule docs links. Presets: `style` (default, snippet-friendly), `full`, `syntax-only`; per-rule overrides. |
| `check_cloud_readiness` | Dual-parse diff (classic baseline vs `Cloud`): statements that are valid today but illegal in ABAP Cloud become categorized blockers (dynpro, list output, native SQL, …) with a transparent score; code broken at the baseline is reported separately, not counted as migration work. |
| `scaffold_rap_bo` | Generates the canonical RAP managed-BO stack (root view, behavior definition `strict(2)` + optional draft, behavior class + handler locals, projection, metadata extension, OData V4 service definition) plus suggested table DDL, activation order and next steps. |
| `list_abap_rules` | Browse abaplint's ~180 rules (filter by text or tag). |
| `explain_abap_rule` | One rule in depth — rationale (often Clean ABAP), examples, docs URL. |
| `format_abap` | Offline pretty-printer (keyword case + indentation). |
| `get_abap_outline` | Classes/methods/visibility/interfaces/FORMs of a source — navigate big objects without reading them whole. |

## Honesty box — what this is *not*

- **Not ATC.** Readiness here is *language-level*: statements ABAP Cloud removed. Whether your
  code calls **released APIs only** requires a system's released-API list (ATC check
  `SAP_CP_READINESS`) — out of scope for an offline tool, and the readiness report says so on
  every call.
- **Scaffold validation is tiered.** Generated classes and CDS views are round-tripped through
  abaplint at Cloud level before they're returned (the generator and the linter share one
  parser). Behavior/service definitions are outside abaplint's checked surface — they are
  golden-tested canonical templates, and ADT activation is the final arbiter. Each generated
  file is labeled `validated: "abaplint" | "template"`.
- **Text-in only, by design.** No filesystem walking, no network — the entire attack surface is
  a parser over strings you explicitly pass. For linting whole directories, use the
  [abaplint CLI](https://abaplint.org) in CI, or the
  [mcp-kit `wrap-abaplint` recipe](https://github.com/palimkarakshay/mcp-kit) this server grew out of.

## Develop

```bash
npm install
npm run check     # typecheck + 80 tests + build — the CI gate
node dist/cli.js  # stdio MCP server
npx @modelcontextprotocol/inspector --cli node dist/cli.js --method tools/list
```

Tool descriptions are CI-graded (a rubric test enforces verb-first names, when-to-use,
non-goals, described params, worked examples — the
[mcp-kit](https://github.com/palimkarakshay/mcp-kit) discipline; the full mcp-kit lint scores all
seven tools 100/100).

## Design

The decision log — why offline, why abaplint, why a dual-parse readiness diff, why the
scaffolder validates its own output, what was deliberately left out — lives in
[`docs/DESIGN.md`](docs/DESIGN.md).

## Credits

- [abaplint](https://github.com/abaplint/abaplint) by Lars Hvam — the parser and rule engine
  underneath every tool here (MIT).
- [mcp-kit](https://github.com/palimkarakshay/mcp-kit) — the production-MCP patterns this server
  follows (typed tool specs, transport discipline, description lint).

MIT © Akshay Palimkar. Not affiliated with or endorsed by SAP SE. "SAP", "ABAP" and "RAP" are
trademarks of SAP SE; this is an independent open-source tool for developers working with them.
