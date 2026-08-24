# Host-routing eval

This is a deterministic, CI-safe metadata regression gate for ChatGPT/Codex-style capability selection. It connects to the built server in memory, reads the exact MCP `tools/list` and `prompts/list` metadata, and checks realistic user intents without calling a model, network, or SAP system.

## Run

```bash
npm run eval:routing
```

The command exits nonzero when:

- an intent selects the wrong tool or prompt;
- an unsupported live-system request fails to abstain;
- an exposed tool or prompt has no positive fixture; or
- a fixture targets a capability no longer exposed over MCP.

`cases.json` is the machine-readable fixture set. It covers all 10 tools and all 3 prompts, plus ambiguous boundaries and requests for ATC, runtime debugging, activation, production data, functional execution, or network-fresh release state that this offline server must not claim.

The ordinary gate is read-only. Refresh the committed reports explicitly with
`npm run eval:routing:report`:

- `report.json` contains the MCP inventory, summary, per-case result, top-five ranking, and matched metadata terms.
- `report.md` is the concise human report.

The router is a lightweight semantic/lexical smoke test, not an imitation of a proprietary host model. It scores capability names, titles, and positive description clauses; discounts non-goal clauses; applies small natural-language vocabulary bridges; and distinguishes direct actions from persistent guided workflows. Fixtures assert semantic destinations rather than exact description prose, so sensible metadata rewrites remain possible while overlap and honesty regressions still fail visibly.

When adding an MCP capability, add at least one positive case. Add hard ambiguity and abstention cases whenever two descriptions overlap or a non-goal could tempt a host into an invalid call.
