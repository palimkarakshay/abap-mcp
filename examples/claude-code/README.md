# Agentic workflows for ABAP, powered by abap-mcp

Drop-in pieces for Claude Code (adaptable to any MCP client):

- **`.mcp.json`** — per-repo server registration (`npx -y abap-mcp`).
- **`abap-code-reviewer.md`** → copy to `.claude/agents/` — a review subagent that outlines,
  lints, readiness-checks and explains, with hard verdict rules.
- **`abap-cloud-migrator.md`** → copy to `.claude/agents/` — an iterative migration loop where
  the readiness score is the loop condition and every edit must re-parse.
- **`abap-quality.yml`** → copy to `.github/workflows/` — CI parse gate + readiness ratchet
  for abapGit repos, no SAP connectivity needed.

Add to the repo's `CLAUDE.md` so every session uses the gate unprompted:

> Before claiming any ABAP change is done, run it through abap-mcp `lint_abap`.
> For anything headed to ABAP Cloud, run `check_cloud_readiness` too.

Full recipes and the use-case matrix: [`docs/COOKBOOK.md`](../../docs/COOKBOOK.md).
