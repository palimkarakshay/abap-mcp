# abap-mcp host-routing eval report

**Mode:** offline metadata · **Result:** PASS · **Cases:** 22/22 · **Surface:** 10 tools + 3 prompts

This deterministic smoke test ranks the exact descriptions exposed by MCP. It makes no model or network calls.

| Case | Expected | Selected | Result | Reason |
|---|---|---|---|---|
| lint-edited-source | tool:lint_abap | tool:lint_abap | PASS | top metadata score 18.14; margin 7.592 |
| cloud-readiness-verdict | tool:check_cloud_readiness | tool:check_cloud_readiness | PASS | top metadata score 20.224; margin 7.88 |
| rap-bo-scaffold | tool:scaffold_rap_bo | tool:scaffold_rap_bo | PASS | top metadata score 25.092; margin 18.472 |
| discover-rule-catalog | tool:list_abap_rules | tool:list_abap_rules | PASS | top metadata score 15.52; margin 5.62 |
| explain-one-rule | tool:explain_abap_rule | tool:explain_abap_rule | PASS | top metadata score 20.54; margin 5.648 |
| format-pasted-abap | tool:format_abap | tool:format_abap | PASS | top metadata score 17.724; margin 5.624 |
| outline-large-class | tool:get_abap_outline | tool:get_abap_outline | PASS | top metadata score 15.9; margin 4.7 |
| released-api-lookup | tool:check_released_api | tool:check_released_api | PASS | top metadata score 19.348; margin 5.804 |
| compare-refactor | tool:compare_abap | tool:compare_abap | PASS | top metadata score 22.02; margin 6.3 |
| machine-migration-backlog | tool:plan_cloud_migration | tool:plan_cloud_migration | PASS | top metadata score 26.524; margin 6.2 |
| guided-review-workflow | prompt:abap-review | prompt:abap-review | PASS | top metadata score 29.7; margin 13.48 |
| ongoing-mentor-mode | prompt:abap-mentor | prompt:abap-mentor | PASS | top metadata score 27.22; margin 17.22 |
| client-ready-migration-engagement | prompt:abap-migration-plan | prompt:abap-migration-plan | PASS | top metadata score 34.9; margin 16.8 |
| live-atc-run | none | none | PASS | live SAP connection |
| runtime-debugging | none | none | PASS | runtime debugging |
| activate-rap-artifacts | none | none | PASS | activate or publish in SAP |
| read-production-table | none | none | PASS | read live SAP data |
| prove-functional-equivalence | none | none | PASS | execute ABAP in SAP |
| refresh-api-from-network | none | none | PASS | network refresh |
| non-abap-review | none | none | PASS | outside ABAP/SAP domain |
| offline-wording-not-blocked | tool:check_cloud_readiness | tool:check_cloud_readiness | PASS | top metadata score 15.3; margin 4.5 |
| rule-catalog-not-analysis | tool:list_abap_rules | tool:list_abap_rules | PASS | top metadata score 13.288; margin 0.184 |

## Coverage checks

- Uncovered exposed capabilities: none
- Fixture targets missing from MCP: none
- Unsupported-request abstentions: 7/7
