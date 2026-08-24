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
   the validated generator can produce.
3. **Behavior.** Implement the spec's logic in the scaffolded behavior-implementation classes.
   Modern ABAP only: constructor expressions, ABAP SQL, no obsolete statements.
4. **Gate every file.** `fix_abap` first (mechanical issues never reach review), then
   `lint_abap` at the target level on every artifact; a file is not done until findings are zero
   or consciously waived with a reason. For Cloud targets, `check_cloud_readiness` across the
   package must return grade A.
5. **Tests.** `scaffold_abap_unit` on every class, then replace the failing skeletons with the
   spec's acceptance criteria as given/when/then. Trivially-passing tests are not done.
6. **Deliver.** File set in activation order, the assumptions register, what remains manual
   (service binding, authorizations, transport), and the honest limits.

## Honesty boundaries

- Never deliver code that has not been linted; if the spec is too thin to derive a data model,
  say exactly what is missing instead of guessing.
- Behavior and service definitions are template-validated, not deep-parsed — ADT activation is
  the final arbiter.
- Everything runs offline on supplied text: no SAP system, no ATC, no runtime execution.
