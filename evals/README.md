# abap-mcp — evaluation harness

A small, dependency-free harness that measures **how reliably an LLM assesses ABAP Cloud readiness**, and — more importantly — **how reliable an LLM-as-judge is at grading that assessment**, by anchoring everything to abap-mcp's **deterministic** readiness oracle.

The thesis: in a regulated/enterprise domain you cannot trust an LLM's self-report *or* an LLM judge as the source of truth. You need a deterministic anchor. abap-mcp (built on `@abaplint/core`) *is* that anchor — so this harness quantifies exactly how far the LLM layer drifts from it.

## Pipeline
```
ABAP source ──► [oracle]  abap-mcp readiness --json     deterministic ground truth  (verdict · grade A–D · blocker categories)
            ├─► [agent]   LLM assesses readiness from source ALONE   system under test
            └─► [judge]   LLM-as-judge grades the agent's answer      WITHOUT seeing the oracle
```

## What it measures
- **Cloud-ready accuracy** — agent's ready/not-ready vs oracle.
- **Grade accuracy** — exact A–D match vs oracle.
- **Category precision / recall** — of the real Cloud-blocker categories (`native-sql`, `list-output`, `dynpro`, `report-program`, `report-events`, `non-released-api`), how many the agent caught (recall) and how many it named that were real (precision = no hallucination).
- **Judge↔oracle Cohen's κ** — agreement *beyond chance* between the LLM-judge's PASS/fail and whether the agent was actually correct. **This is the headline number.** Raw agreement % flatters a lenient judge; κ exposes it.
- **Failure taxonomy** — every error tagged: `wrong-grade`, `missed-category`, `hallucinated-category`, `wrong-cloud-ready`, `judge-false-accept`, `judge-false-reject`.

## The judge rubric
The LLM-judge sees only the source + the agent's answer (never the oracle) and must PASS only if:
1. the cloud-ready verdict is defensible,
2. every issue the agent named is actually present, and
3. **no** real Cloud-incompatible statement was missed.

## Headline finding (current run, see `report.md`)
On 5 deliberately-varied cases: cloud-ready accuracy **100%**, blocker recall **86%**, precision **100%**, grade accuracy **80%** — but **Judge κ = 0**. The lenient judge passed *everything*, including an answer that **missed an unmigrated `WRITE` (list-output) blocker** in the `mixed` case (a `judge-false-accept`). Raw judge agreement was 80%, which hides the danger entirely.

**Takeaway → gate on the deterministic abap-mcp oracle; use the LLM only to *explain* a finding, never as the sole arbiter.** Where the judge is unreliable is reported explicitly each run.

> Where the LLM-judge is unreliable is the deliverable — not a high score. A harness that only ever produces green checks isn't an eval.

## Run
```bash
npm run build           # once, so dist/cli.js (the oracle) exists
node evals/run.mjs      # stub mode (default): offline, deterministic, CI-safe — replays fixtures/
```
Live mode (grade a real model end-to-end):
```bash
EVAL_MODE=live \
EVAL_BASE_URL=https://api.groq.com/openai/v1 \   # any OpenAI-compatible endpoint (Groq/Mistral/OpenAI/local)
EVAL_API_KEY=sk-... EVAL_MODEL=llama-3.3-70b-versatile \
node evals/run.mjs
```
Outputs: `evals/report.md` (human) + `evals/report.json` (machine).

## Layout
- `cases/` — golden ABAP cases (abapGit-named) + `manifest.json`. The oracle label is computed live; nothing is hand-labelled.
- `fixtures/agent.stub.json`, `fixtures/judge.stub.json` — recorded model outputs for deterministic stub runs.
- `run.mjs` — the harness (oracle via the CLI, agent + judge stub/live, metrics, taxonomy, report).

## Extend
Drop a new `*.clas.abap` / `*.prog.abap` into `cases/`, add a `manifest.json` row, and (for stub mode) an `agent.stub.json` + `judge.stub.json` entry. Live mode needs no fixtures.
