# abap-mcp host-routing eval report

**Mode:** offline metadata · **Result:** PASS · **Cases:** 35/35 · **Surface:** 19 tools + 4 prompts

This deterministic smoke test ranks the exact descriptions exposed by MCP. It makes no model or network calls.

| Case | Expected | Selected | Result | Reason |
|---|---|---|---|---|
| lint-edited-source | tool:lint_abap | tool:lint_abap | PASS | top metadata score 15.964; margin 1.364 |
| cloud-readiness-verdict | tool:check_cloud_readiness | tool:check_cloud_readiness | PASS | top metadata score 19.424; margin 7.08 |
| rap-bo-scaffold | tool:scaffold_rap_bo | tool:scaffold_rap_bo | PASS | top metadata score 25.092; margin 2.672 |
| discover-rule-catalog | tool:list_abap_rules | tool:list_abap_rules | PASS | top metadata score 15.52; margin 5.12 |
| explain-one-rule | tool:explain_abap_rule | tool:explain_abap_rule | PASS | top metadata score 20.54; margin 5.648 |
| format-pasted-abap | tool:format_abap | tool:format_abap | PASS | top metadata score 17.724; margin 8.524 |
| outline-large-class | tool:get_abap_outline | tool:get_abap_outline | PASS | top metadata score 15.9; margin 4.7 |
| released-api-lookup | tool:check_released_api | tool:check_released_api | PASS | top metadata score 19.348; margin 2.128 |
| compare-refactor | tool:compare_abap | tool:compare_abap | PASS | top metadata score 22.02; margin 6.3 |
| machine-migration-backlog | tool:plan_cloud_migration | tool:plan_cloud_migration | PASS | top metadata score 26.524; margin 6.2 |
| guided-review-workflow | prompt:abap-review | prompt:abap-review | PASS | top metadata score 29.7; margin 13.48 |
| ongoing-mentor-mode | prompt:abap-mentor | prompt:abap-mentor | PASS | top metadata score 27.22; margin 12.42 |
| client-ready-migration-engagement | prompt:abap-migration-plan | prompt:abap-migration-plan | PASS | top metadata score 34.9; margin 16.8 |
| live-atc-run | none | none | PASS | live SAP connection |
| runtime-debugging | none | none | PASS | runtime debugging |
| activate-rap-artifacts | none | none | PASS | activate or publish in SAP |
| read-production-table | none | none | PASS | read live SAP data |
| prove-functional-equivalence | none | none | PASS | execute ABAP in SAP |
| refresh-api-from-network | none | none | PASS | network refresh |
| non-abap-review | none | none | PASS | outside ABAP/SAP domain |
| offline-wording-not-blocked | tool:check_cloud_readiness | tool:check_cloud_readiness | PASS | top metadata score 17.6; margin 4.7 |
| rule-catalog-not-analysis | tool:list_abap_rules | tool:list_abap_rules | PASS | top metadata score 13.288; margin 2.36 |
| unit-test-harness | tool:scaffold_abap_unit | tool:scaffold_abap_unit | PASS | top metadata score 40.6; margin 22.8 |
| dependency-sequencing | tool:get_object_dependencies | tool:get_object_dependencies | PASS | top metadata score 26.4; margin 14.5 |
| autofix-selection | tool:fix_abap | tool:fix_abap | PASS | top metadata score 12.1; margin 4.1 |
| build-from-spec | prompt:abap-from-spec | prompt:abap-from-spec | PASS | top metadata score 18.9; margin 10.5 |
| release-delta-lookup | tool:explain_abap_release | tool:explain_abap_release | PASS | top metadata score 18.2; margin 8.9 |
| rap-whats-new-2508 | tool:explain_abap_release | tool:explain_abap_release | PASS | top metadata score 18.2; margin 5.2 |
| sap-abap-1-facts | tool:search_sap_knowledge | tool:search_sap_knowledge | PASS | top metadata score 20.8; margin 10.1 |
| clean-core-levels | tool:search_sap_knowledge | tool:search_sap_knowledge | PASS | top metadata score 22.3; margin 7.2 |
| abap-ai-sdk-scaffold | tool:scaffold_abap_ai_sdk | tool:scaffold_abap_ai_sdk | PASS | top metadata score 22.6; margin 11.8 |
| agents-md-rules | tool:get_abap_agent_rules | tool:get_abap_agent_rules | PASS | top metadata score 32.9; margin 12.88 |
| run-unit-tests-offline | tool:run_abap_unit | tool:run_abap_unit | PASS | top metadata score 22.7; margin 9.3 |
| rap-behavior-consistency | tool:check_rap_behavior | tool:check_rap_behavior | PASS | top metadata score 26.9; margin 19.3 |
| srvd-expose-and-contract | tool:check_rap_behavior | tool:check_rap_behavior | PASS | top metadata score 8.5; margin 5.9 |

## Coverage checks

- Uncovered exposed capabilities: none
- Fixture targets missing from MCP: none
- Unsupported-request abstentions: 7/7
