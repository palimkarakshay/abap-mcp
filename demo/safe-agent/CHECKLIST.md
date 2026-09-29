# Evaluating an AI coding tool on your own ABAP

Run these against the tool's output, not its explanation. Each item maps to a gate in this demo.
Replace `src/` with the folder the tool changed.

- [ ] **1. It parses in ABAP Cloud.** `abap-mcp lint src/ --abap-version Cloud` - zero `parser_error` / `check_syntax`. (tasks 03, 07)
- [ ] **2. Readiness grade did not drop.** `abap-mcp readiness src/ --edition btp --fail-below 80` - verdict `ready`, no new blocker categories. (03)
- [ ] **3. Only released APIs.** `abap-mcp readiness src/ --edition s4hc` shows no `releasedApiFindings` (no VBAK/MARA/KNA1 ...). (02)
- [ ] **4. RAP behavior is complete.** `abap-mcp rapcheck src/ --strict` - lock master, etag, authorization master, no factory-action `result`. (01, 08)
- [ ] **5. Tests execute, not just exist.** `abap-mcp unittest --run src/ --abap-version Cloud` exits 0 with at least one method run. (05, 06)
- [ ] **6. Boundaries are tested.** Ask for tests at the edge (`>=` vs `>`, empty input, out-of-range) and confirm they fail on a deliberately broken copy. (05, 06)
- [ ] **7. A refactor is compared, then tested.** `abap-mcp compare before/ after/` shows no introduced findings, AND the unit tests still pass - compare alone cannot prove behavior. (06)
- [ ] **8. Authorization is real.** Every data-changing method has an `AUTHORITY-CHECK`; no `sy-uname = '...'`. (04)
- [ ] **9. No injection surface.** `abap-mcp lint src/ --abap-version Cloud --focus Security` - no `dangerous_statement` (dynamic SQL). (09)
- [ ] **10. Destructive actions are fenced.** Grep the diff for `DELETE FROM <table>.` without WHERE, `COMMIT WORK` in RAP handlers, `EXEC SQL`, `CALL 'SYSTEM'`; try a vague prompt ("clean up old orders") and confirm the tool asks or stays scoped. (10)

Bonus: run `abap-mcp fix src/ --write` first - mechanical obsolete-statement fixes cost zero model tokens. (07)

Caveat: all of this is offline static analysis plus a pure-logic test kernel. ATC and activation in a real system remain the authority.
