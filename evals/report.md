# abap-mcp eval report

**Mode:** `stub` · **Cases:** 5 · Oracle = abap-mcp deterministic readiness · Agent + Judge = LLM.

> Regenerate: `node evals/run.mjs` (set `EVAL_MODE=live` + EVAL_* env to run against a real model).

## Headline metrics

| Metric | Value | Reads as |
|---|---|---|
| Cloud-ready accuracy | 100% | LLM's ready/not-ready vs oracle |
| Grade accuracy (A–D) | 80% | exact-grade match vs oracle |
| Category recall | 86% | real Cloud blockers the LLM caught |
| Category precision | 100% | named blockers that were real (no hallucination) |
| Agent objective-correct | 80% | perfect cases (right verdict + every category, none invented) |
| **Judge↔oracle Cohen's κ** | **0** | agreement beyond chance — **the number that matters** |
| Judge raw agreement | 80% | raw % (misleading on its own — see κ) |

## Failure taxonomy

- `wrong-grade` × 1
- `missed-category` × 1
- `judge-false-accept` × 1

## Per-case

| Case | Pattern | Oracle (grade/verdict) | Agent grade | Caught | Judge | Tags |
|---|---|---|---|---|---|---|
| clean | clean OO class (arithmetic only) | A / ready | A | 0/0 | PASS | — |
| native-sql | EXEC SQL native SQL | C / minor-rework | C | 1/1 | PASS | — |
| list-output | classic WRITE list output | D / minor-rework | C | 1/1 | PASS | wrong-grade |
| dynpro | executable report + dynpro UI | D / moderate-rework | D | 3/3 | PASS | — |
| mixed | native SQL + WRITE + legacy CALL FUNCTION | D / minor-rework | D | 1/2 | PASS | missed-category, judge-false-accept |

## Where the LLM-judge is unreliable (the point of this harness)

- **mixed — FALSE-ACCEPT:** judge said `PASS` but the agent was `wrong` vs the oracle (missed 1 real Cloud blocker(s) — e.g. an unmigrated statement the judge let through). _Judge reason:_ "Native SQL is correctly flagged and the suggested ABAP SQL fix is correct."

**Takeaway:** raw judge agreement (80%) hides the risk — Cohen's κ = **0** shows the LLM-judge adds little signal beyond "always pass" and even green-lit code that still contains a real Cloud blocker. **Gate on the deterministic abap-mcp oracle; use the LLM only to explain, never as the sole arbiter.** (N=5 is illustrative — the method, not the absolute number, is the deliverable.)
