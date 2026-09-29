# Safe-agent report

> Regenerate: `node demo/safe-agent/run.mjs --json`. All code is synthetic (Northwind Bikes, package ZNWB).

**10 tasks · 12 gates: baseline caught 12/12 · solution passes 16/16 · 30.4s**

| task | gate | baseline (unassisted) | solution (gated) | what changed |
|---|---|---|---|---|
| 01-rap-lock-etag | rapcheck | FAIL 3 errors | PASS 0 errors | resolved RAP028, RAP029, RAP032 |
| 02-released-cds | readiness | FAIL A/100 VBAK not released | PASS A/100 | resolved released:VBAK |
| 03-classic-report | readiness | FAIL D/70 6 blockers | PASS A/100 | resolved other, list-output, report-program, native-sql |
| 04-authority-check | policy | FAIL 2 violation(s) | PASS 2 rules clean | resolved POL-HARDCODED-USER, POL-AUTH-REQUIRED |
| 05-discount-boundary | unittest | FAIL 2/3 pass | PASS 3/3 pass | resolved ZCL_NWB_DISCOUNT>AT_THRESHOLD |
| 05-discount-boundary | lint | PASS (blind) clean | PASS clean | no signal - static tools cannot see this bug |
| 05-discount-boundary | readiness | PASS (blind) A/100 | PASS A/100 | no signal - static tools cannot see this bug |
| 06-refactor-regression | unittest | FAIL 1/2 pass | PASS 2/2 pass | resolved ZCL_NWB_RATING>AVERAGES_VALID_ONLY |
| 06-refactor-regression | lint | PASS (blind) clean | PASS clean | no signal - static tools cannot see this bug |
| 06-refactor-regression | readiness | PASS (blind) A/100 | PASS A/100 | no signal - static tools cannot see this bug |
| 07-obsolete-statements | lint | FAIL 4 blocking | PASS clean | resolved obsolete_statement, parser_error |
| 07-obsolete-statements | fix | FAIL 4 auto-fixable | PASS nothing to fix | resolved obsolete_statement |
| 08-eml-factory-action | rapcheck | FAIL 1 errors | PASS 0 errors | resolved RAP048 |
| 08-eml-factory-action | policy | FAIL 2 violation(s) | PASS 2 rules clean | resolved POL-EML-CONTROL, POL-EML-DUP-CID |
| 09-dynamic-sql | lint | FAIL 1 blocking | PASS clean | resolved dangerous_statement |
| 10-unsafe-cleanup | policy | FAIL 2 violation(s) | PASS 4 rules clean | resolved POL-DELETE-NO-WHERE, POL-COMMIT-IN-HANDLER |

## Compare (baseline vs solution)

| task | compare: resolved | introduced | blockers | grade |
|---|---|---|---|---|
| 01-rap-lock-etag | 0 | 0 | 0 -> 0 | A -> A |
| 02-released-cds | 3 | 5 | 0 -> 0 | A -> A |
| 03-classic-report | 11 | 6 | 6 -> 0 | D -> A |
| 04-authority-check | 0 | 0 | 0 -> 0 | A -> A |
| 05-discount-boundary | 0 | 0 | 0 -> 0 | A -> A |
| 06-refactor-regression | 0 | 0 | 0 -> 0 | A -> A |
| 07-obsolete-statements | 4 | 0 | 1 -> 0 | C -> A |
| 08-eml-factory-action | 0 | 0 | 0 -> 0 | A -> A |
| 09-dynamic-sql | 4 | 2 | 0 -> 0 | A -> A |
| 10-unsafe-cleanup | 1 | 5 | 0 -> 0 | A -> A |

## Why each bug matters

- **01-rap-lock-etag** - No lock master / etag / authorization master: concurrent edits overwrite each other and nothing checks who may change the order.
- **02-released-cds** - Classic VBAK is not a released API; it works today and breaks the Clean Core contract at the next upgrade. (Snapshot records VBAK only for s4hc, not btp; readiness does not scan .ddls, so the gated consumer is the ABAP SQL class.)
- **03-classic-report** - WRITE lists, a REPORT program, EXEC SQL and TABLES do not exist in ABAP Cloud - graded D until rewritten as a class over a released view.
- **04-authority-check** - Two user names hard-coded instead of AUTHORITY-CHECK: anyone renamed or added is a silent security hole. abaplint has no rule for this, so the gate is the policy grep.
- **05-discount-boundary** - '>' instead of '>=' at the 10-unit boundary: lint and readiness are clean, only the executed ABAP Unit test sees the wrong price.
- **06-refactor-regression** - A tidy-up dropped the 1..5 range filter: lint and readiness stay clean and the code still runs, but invalid ratings now skew the average.
- **07-obsolete-statements** - MOVE/ADD/MULTIPLY are illegal in ABAP Cloud; abap-mcp fix rewrites them deterministically, so no model tokens are needed.
- **08-eml-factory-action** - Factory action returns its key via a result clause (must be MAPPED), and the EML call omits %control and reuses a %cid: rows are ignored or collide.
- **09-dynamic-sql** - User text concatenated into a dynamic WHERE is an SQL-injection vector; a host variable makes it data, not code.
- **10-unsafe-cleanup** - 'Clean up old orders' became DELETE with no WHERE plus COMMIT WORK in a RAP handler: it compiles, lints clean, and empties the table.

**Result: OK** - every baseline fails its gate, every solution passes.
