# abap-mcp v0.13.0 — the offline companion to SAP's official ADT MCP server

A repositioning and knowledge-refresh release after SAP TechEd 2026. No new tools, no new network
paths, no behaviour change in any analysis tool. If you only ever run abap-mcp on files, nothing
changes for you; if you pair it with SAP's ADT MCP server, the generated agent rules now describe
the real loop with the real tool names.

## What changed and why

SAP's official ADT MCP server (inside ADT for Eclipse and VS Code) gained 16 tools in October 2026
(language server 1.3 / ADT for VS Code 1.2): it now reads and edits object files itself, runs the
syntax check, requests ATC exemptions and reads short-dump feeds, and SAP demoed it from Claude Code.
That settles the division of labour. SAP's server is the system half. abap-mcp is the offline half:
the deterministic gate an agent runs on the text before every write, and the dated SAP knowledge it
asks instead of guessing. The README, the cookbook recipe and `get_abap_agent_rules` now say exactly
that.

## Changed

- **`get_abap_agent_rules`** with `pairedWith: ["sap-adt-mcp"]` now emits the composed loop (read
  with `abap_read_file` → `fix_abap` / `lint_abap` / `check_rap_behavior` / `check_cloud_readiness`
  → `abap_object_edit_file` → `abap_object_check` → `abap_object_activate` → `abap_unit_run_tests`
  / `abap_atc_run_start` → `compare_abap`) and the allow-list level it needs (level 3, restricted
  editing; stop after the offline checks at level 2; never level 4). The "honesty" rule now says
  BDEF/SRVD are checked by abap-mcp's own RAP grammar rather than "template-validated".
- **Knowledge card `official-adt-mcp-server`** rewritten from SAP's TechEd 2026 AD100 slides and the
  1.2 release blog: all 36 tools with the names SAP ships (the names abap-mcp documented before —
  `abap_lists_destinations`, `abap_activate_objects`, `abap_run_unit_tests`, `abap_run_atc` — were
  never the shipped ones), which 16 are new, the four allow-list safety levels, SAP's stated AI
  strategy (agent first, open tool access, MCP + ACP), the extension roadmap to July 2027 and the
  MCP roadmap for Q1 2027.
- **Knowledge card `custom-code-migration-agent`**: records the three "first concrete agents" SAP
  named at TechEd 2026 (Custom Code Migration — available; Clean Core Adaptation and Application
  Modernization — announced, no GA date).
- **Knowledge card `joule-for-developers`**: an open question on per-user versus AI-unit pricing
  (two SAP-side sources disagree as of 2026-11-02).
- **Clean Core knowledge**: three new rows — SAP's API policy is not "clean core level E", the new
  clean core integration white paper (TM108), and the product rename of SAP BTP ABAP environment to
  SAP Business AI Platform, ABAP environment (BAIP). `search_sap_knowledge("business ai platform")`
  now finds the BTP rows; the `btp` edition key is unchanged.
- **Release deltas**: the file records that 2611 lands 2026-11-13/15 and which themes SAP announced;
  rows for 2611 are added once SAP publishes the release notes. Knowledge curated date: 2026-11-02.
- **README / COOKBOOK / ROADMAP**: "Why this exists" rewritten around the companion role; the pairing
  recipe uses the shipped tool names and the allow-list levels; the September roadmap carries a
  dated correction instead of a rewrite.

## Added

- A test that the AFF / abapGit file names SAP's server hands back (`zcl_x.clas.abap`,
  `zr_x.bdef.asbdef`, `zi_x.ddls.asddls`, …) are accepted by abap-mcp as-is, which is what the
  composed loop relies on.

## Sources

SAP TechEd 2026 session slides AD100, ST124 and TM108 (summarised, not bundled), the SAP Community
posts "ABAP Development Tools MCP server: major update available" and "ABAP sessions at SAP TechEd
2026", and SAP's security and roadmap pages. Every knowledge row remains an original summary over a
cited source.
