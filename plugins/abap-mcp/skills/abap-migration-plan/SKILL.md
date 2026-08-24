---
name: abap-migration-plan
description: Turn supplied ABAP sources into an evidence-based ABAP Cloud migration backlog with abap-mcp. Use for Clean Core assessments, migration scope, phased remediation, or readiness-grade planning; do not present static results as certification or delivery estimates.
---

# ABAP Migration Plan

Produce a client-readable plan grounded in `plan_cloud_migration`, while preserving the distinction between parser evidence, released-API hints, and system-authoritative checks.

## Workflow

1. Establish the source scope and classic baseline. Read user-named workspace files and pass their text to the MCP server; it cannot read paths. Default `baselineVersion` to `v758` unless the user provides the version. Batch more than 32 files or files over 100,000 characters.
2. Run `plan_cloud_migration` for each batch. When batching, consolidate phases by stable title without inventing new findings, counts, or effort judgments.
3. Lead with the current state: file count, score, grade, cloud-language blocker count, broken-at-baseline findings, and what each metric means.
4. Present each returned phase as a numbered backlog: goal, affected object, category, S/M/L effort band, remediation recipe, dependencies, and exit criteria. Treat effort bands as relative complexity, not person-days.
5. Keep released-API work in its own section with the reported snapshot date. Use `check_released_api` for named objects that need a focused lookup. Do not fold those observations into the language-blocker count or score; target-system ATC is authoritative.
6. If the user asks to execute the plan, take one authorized work item at a time, preserve the before text, make the smallest fix, run `compare_abap`, and rerun readiness so movement is visible.

## Honesty boundaries

This is offline, parser-level analysis of supplied text. No SAP system is contacted, no ATC is run, dependencies outside the supplied sources may be invisible, and a `ready` verdict is not certification. Keep assumptions, batching, and omitted source explicit.
