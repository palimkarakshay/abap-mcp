---
name: abap-review
description: Review supplied ABAP, CDS, or RAP source with abap-mcp static analysis. Use for code-review, Clean ABAP, performance, security, ABAP Cloud, or commit-readiness requests; do not use it as a substitute for SAP ATC or runtime testing.
---

# ABAP Review

Use the connected `abap-mcp` tools to ground a senior-consultant review in observable findings.

## Workflow

1. Resolve the source in scope. The MCP server accepts source text, not paths: read any user-named workspace files first and pass their full text with stable filenames. If the scope is unclear, ask instead of guessing. Batch more than 32 files or files over 100,000 characters.
2. Run `lint_abap` with the default `style` preset. Use `focus: "Performance"`, `"Security"`, or `"Styleguide"` only when that lens matches the request. Use `full` only when all relevant dependencies are supplied.
3. Triage findings by production impact, then severity. For important or unfamiliar rule keys, call `explain_abap_rule`; explain why the rule matters and propose the smallest concrete fix.
4. For ABAP Cloud or Clean Core questions, also run `check_cloud_readiness`. Treat language blockers separately from its dated, informational `releasedApiFindings`. A clean result is a static-parser verdict, not certification.
5. If the user authorizes edits, preserve the original text, make focused changes, rerun `lint_abap`, then use `compare_abap` with before and after sources. Report new, resolved, and remaining findings and any readiness-grade movement.
6. Finish with a concise verdict: ready for the next engineering gate, or the shortlist of changes that still gate it.

## Honesty boundaries

- The server analyzes only supplied text, entirely offline. It does not connect to SAP, inspect repository paths, run code, or execute ATC.
- Released-API observations come from the bundled snapshot and are dated. Keep them out of the language-blocker score and say that target-system ATC is authoritative.
- Do not claim that behavior definitions or service definitions received deep abaplint validation.
- Review does not imply permission to edit files; make changes only when the user asks.
