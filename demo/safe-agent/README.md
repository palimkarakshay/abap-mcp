# safe-agent - "Can an AI agent safely change ABAP?"

A 12-minute live demo plus an offline harness. Ten small ABAP tasks each ship a **baseline** (what an
unassisted LLM plausibly writes, with one planted subtle bug) and a **solution** (Clean Core / ABAP Cloud
correct). `run.mjs` runs the abap-mcp gates on both and prints a scorecard: every baseline must FAIL,
every solution must PASS.

**Everything here is synthetic.** The company "Northwind Bikes", package `ZNWB` and all code are invented;
no client or employer code is included.

## Layout
- `tasks/<nn>-<slug>/` - `TASK.md` (prompt, definition of done, gates), `baseline/`, `solution/` (abapGit names), `expect.json`
- `policy.json` - grep guardrails (DELETE without WHERE, COMMIT WORK in a handler, CALL 'SYSTEM', EXEC SQL, hard-coded user, missing %control ...)
- `run.mjs` - the runner (dependency-free ESM, offline, about 30 s, well under a minute)
- `DEMO.md` - run-of-show; `CHECKLIST.md` - evaluating an AI coding tool on your own ABAP
- `report.json` / `report.md` - written by `--json`

## Run
```bash
npm run build                          # once, so dist/cli.js exists
node demo/safe-agent/run.mjs           # scorecard for all 10 tasks
node demo/safe-agent/run.mjs --task 05 # one task
node demo/safe-agent/run.mjs --scan DIR  # policy-only check of any folder (live demo)
node demo/safe-agent/run.mjs --json    # also write report.json + report.md
```
Exit code 1 if a solution fails, a baseline unexpectedly passes, or an expected blocker is not reported.

## Honest limits
- Gates are abap-mcp's offline static checks plus the offline ABAP Unit kernel (pure logic only: no DB, CDS or EML) and a regex policy. They are not ATC and not an SAP system.
- Tasks 05/06 are *invisible* to lint and readiness by design - only the executed test sees the bug.
- Task 02 uses `--edition s4hc`: the bundled btp snapshot does not record classic tables like VBAK, and readiness does not scan `.ddls` sources.
- Tasks 04 and 08 (auth, `%cid`/`%control`) have no abaplint or RAP rule, so the gate is the policy grep in `policy.json`.
- Solutions are lint-clean only for the rules named in each `expect.json` (`lintFail`); style rules such as `no_prefixes` still fire.
