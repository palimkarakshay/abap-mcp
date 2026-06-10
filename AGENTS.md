# abap-mcp

MCP server for SAP ABAP: **offline** static analysis (abaplint), ABAP Cloud / Clean Core
readiness checks, and RAP managed-BO scaffolding. No SAP system, no credentials, no network,
no filesystem — text in, structured JSON out. Lumivara product line: **SAP**.
**Public MIT** repo (`github.com/palimkarakshay/abap-mcp`); npm package `abap-mcp` (bin + library).

## Package manager: npm — Node >= 20

## Commands (authoritative)
- `npm install`
- `npm run check`     — typecheck + vitest (90 tests) + build, in order = **the CI gate**
- `npm run typecheck` / `npm test` / `npm run build` — the individual steps
- `node dist/cli.js`  — run the stdio MCP server
- Inspect: `npx @modelcontextprotocol/inspector --cli node dist/cli.js --method tools/list`
- Description lint (optional, cross-repo): from `~/projects/mcp-kit`:
  `pnpm --filter @mcp-kit/lint run lint -- --root ~/projects/abap-mcp --threshold 90`
  (all 7 tools score 100/100; keep it that way)

## Layout
- `src/abap.tools.ts` — the 7 ToolSpecs (lint_abap, check_cloud_readiness, scaffold_rap_bo,
  list_abap_rules, explain_abap_rule, format_abap, get_abap_outline). The registry export
  `tools` is what @mcp-kit/lint discovers.
- `src/abap/` — engine.ts (Registry wrapper, filename inference, caps) · readiness.ts
  (dual-parse diff) · scaffold.ts (RAP templates + self-validation) · rules.ts · formatter.ts ·
  outline.ts
- `src/tool.ts`, `src/errors.ts` — vendored mcp-kit patterns (attributed; keep in sync by hand)
- `src/server.ts` + `src/cli.ts` (entry: subcommand → CLI, bare → stdio server) +
  `src/cli-commands.ts` (lint/readiness/scaffold/outline/explain/rules; the CLI may touch fs,
  the MCP server never does) + `src/index.ts` (library exports)
- `docs/DESIGN.md` — decision log · `docs/COOKBOOK.md` — user recipes ·
  `examples/claude-code/` — subagents (reviewer, migrator), .mcp.json, CI workflow

## Deploy: none hosted — ships as an npm package (`npm publish`, owner-run; needs npm login)

## Gotchas / invariants
- stdout is the JSON-RPC channel — anything human-facing goes to **stderr**.
- abaplint does NOT deep-parse BDEF/SRVD (probe-verified) — never claim abaplint validation
  for those; `validated: "abaplint" | "template"` labels are load-bearing honesty.
- Readiness = diff(Cloud, baseline); both runs use preset `syntax-only`. Don't add style rules
  to it — blocker counts must stay objective.
- The scaffold round-trip test (`validationIssues = []`) is the repo's keystone test; if a
  template change breaks it, fix the template, never relax the test.
- Tool descriptions are rubric-tested in `server.test.ts` — verb-first name, "Use this when",
  non-goals, described params, ≥1 example, readOnlyHint on everything.
