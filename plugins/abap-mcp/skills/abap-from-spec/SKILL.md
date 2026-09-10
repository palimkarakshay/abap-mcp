---
name: abap-from-spec
description: Turn a functional or technical spec into working, validated modern ABAP/RAP using abap-mcp — scaffold the foundation deterministically, implement behaviors, gate every file through fix/lint, generate tests, deliver in activation order. Use when the user has a requirement or spec and wants code started for them; do not use for reviewing existing code (abap-review) or migration planning (abap-migration-plan).
---

# ABAP from Spec

Turn a written spec into working, validated code with the connected `abap-mcp` tools. Nothing
delivered may bypass their gates.

## Workflow

1. **Intake.** Restate the spec as a build plan: entities and relationships, key fields,
   behaviors (draft, actions, validations, determinations), services, constraints. Ask only the
   questions that block the data model; propose defaults for the rest and mark each one
   `ASSUMPTION` so the consultant can veto it.
2. **Foundation, deterministic first.** For each root entity run `scaffold_rap_bo` (draft on
   unless the spec says otherwise) and use its suggested table DDL. Never hand-write an artifact
   the validated generator can produce. For any 2025+ feature the spec needs (CDS table entities,
   side effects, business events, collaborative draft, RAP recommendations) confirm syntax and the
   minimum release with `explain_abap_release` first; for a Generative AI Hub call use
   `scaffold_abap_ai_sdk`.
3. **Behavior.** Implement the spec's logic in the scaffolded behavior-implementation classes.
   Modern ABAP only: constructor expressions, ABAP SQL, no obsolete statements.
4. **Gate every file.** `fix_abap` first (mechanical issues never reach review), then
   `lint_abap` at the target level on every artifact; a file is not done until findings are zero
   or consciously waived with a reason. For Cloud targets, `check_cloud_readiness` across the
   package must return grade A.
5. **Tests.** `scaffold_abap_unit` on every class, then replace the failing skeletons with the
   spec's acceptance criteria as given/when/then. Trivially-passing tests are not done. When
   `run_abap_unit` is available, execute the tests offline and iterate until green — it exercises
   pure logic only (no database, CDS, EML or authorizations), so say which tests still need a
   real system.
6. **Deliver.** File set in activation order, the assumptions register, what remains manual
   (service binding, authorizations, transport), and the honest limits. If an online ADT MCP
   server is connected (SAP's official one or `abap-adt-mcp`), hand it the activation-ordered
   files, then read back its ABAP Unit and ATC results and fix before declaring done.

## Honesty boundaries

- Never deliver code that has not been linted; if the spec is too thin to derive a data model,
  say exactly what is missing instead of guessing.
- Behavior and service definitions are checked by abap-mcp's own RAP parser and rule set
  (`check_rap_behavior`; pass the CDS views in the same call so the cross-file rules run), not by
  abaplint and not by SAP — ADT activation is the final arbiter.
- Everything runs offline on supplied text: no SAP system, no ATC. `run_abap_unit` (opt-in)
  executes transpiled JavaScript against the open-abap kernel, not SAP's — evidence for pure
  logic only.
