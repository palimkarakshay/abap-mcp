# abap-mcp

MCP server for SAP ABAP: **offline** static analysis (abaplint), ABAP Cloud / Clean Core
readiness checks, released-API lookup against SAP's bundled Cloudification snapshot, and RAP
managed-BO scaffolding. No SAP system, no credentials, no network, no user-filesystem — text in,
structured JSON out (package-bundled data assets excepted; see invariants). Lumivara product line: **SAP**.
**Public MIT** repo (`github.com/palimkarakshay/abap-mcp`); npm package `abap-mcp` (bin + library).

## Package manager: npm — Node >= 20

## Commands (authoritative)
- `npm install`
- `npm run check`     — typecheck + vitest (149 tests) + build, in order = **the CI gate**
- `npm run typecheck` / `npm test` / `npm run build` — the individual steps
- `npm run build`     — `tsc && node scripts/copy-data.mjs` (tsc does NOT copy the bundled `.json`)
- `node scripts/build-released-api-index.mjs` — **dev-only**, refreshes the SAP released-API
  snapshot (the only script that hits the network; never runs at serve time)
- `node dist/cli.js`  — run the stdio MCP server
- Inspect: `npx @modelcontextprotocol/inspector --cli node dist/cli.js --method tools/list`
- Description lint (optional, cross-repo): from `~/projects/mcp-kit`:
  `pnpm --filter @mcp-kit/lint run lint -- --root ~/projects/abap-mcp --threshold 90`
  (all 9 tools score 100/100; keep it that way)

## Layout
- `src/abap.tools.ts` — the 9 ToolSpecs (lint_abap [+focus rule packs], check_cloud_readiness
  [+A–D grade], compare_abap, scaffold_rap_bo, check_released_api, list_abap_rules,
  explain_abap_rule, format_abap, get_abap_outline [+mermaid]). The registry export `tools`
  is what @mcp-kit/lint discovers.
- `src/abap/` — engine.ts (Registry wrapper, filename inference, caps, focus tag filter, AST
  object-reference extraction) · readiness.ts (dual-parse diff + released-API cross-check +
  density-banded A–D grade) · compare.ts (before/after: content-matched finding diff +
  grade movement + structure changes) · released.ts (released-API lookup over the bundled
  snapshot) · scaffold.ts (RAP templates + self-validation) · rules.ts · formatter.ts ·
  outline.ts (+ outlineToMermaid)
- `src/data/` — bundled data assets: `released-apis.json` (compact SAP Cloudification snapshot,
  Apache-2.0) + `table-successors.json` (curated classic-table → CDS successor map)
- `scripts/` — `build-released-api-index.mjs` (dev: fetch+transform SAP data) ·
  `copy-data.mjs` (build: copy `src/data/*.json` → `dist/data/`)
- `src/tool.ts`, `src/errors.ts` — vendored mcp-kit patterns (attributed; keep in sync by hand)
- `src/server.ts` + `src/cli.ts` (entry: subcommand → CLI, bare → stdio server) +
  `src/cli-commands.ts` (lint/readiness/compare/scaffold/outline/explain/rules; the CLI may
  touch fs, the MCP server never does) + `src/index.ts` (library exports)
- `docs/DESIGN.md` — decision log · `docs/COOKBOOK.md` — user recipes ·
  `examples/claude-code/` — subagents (reviewer, migrator), .mcp.json, CI workflow

## Deploy: none hosted — ships as an npm package (`npm publish`, owner-run; needs npm login)

## Gotchas / invariants
- stdout is the JSON-RPC channel — anything human-facing goes to **stderr**.
- "No network / no user-filesystem at runtime" = the server (and CLI engine) never fetch URLs
  and never read user-supplied paths. **Package-bundled assets are fine and expected** — abaplint's
  own rule data, and `src/data/*.json` (the SAP released-API snapshot) `import`ed and shipped in
  `dist/data/`. Only the dev script `build-released-api-index.mjs` touches the network. Keep `dist`
  in package.json `files`; `build` must run `copy-data.mjs` (tsc won't copy the `.json`).
- abaplint does NOT deep-parse BDEF/SRVD (probe-verified) — never claim abaplint validation
  for those; `validated: "abaplint" | "template"` labels are load-bearing honesty.
- Readiness = diff(Cloud, baseline); both runs use preset `syntax-only`. Don't add style rules
  to it — blocker counts must stay objective. The released-API cross-check (`releasedApiFindings`)
  is a SEPARATE, dated, informational field — never fold it into `cloudBlockerCount`/`score`.
- The scaffold round-trip test (`validationIssues = []`) is the repo's keystone test; if a
  template change breaks it, fix the template, never relax the test.
- Tool descriptions are rubric-tested in `server.test.ts` — verb-first name, "Use this when",
  non-goals, described params, ≥1 example, readOnlyHint on everything.
