# 07 - Modernise a price helper
**Prompt:** `zcl_nwb_price=>total( )` was written in 2004 style. Make it compile in ABAP Cloud without changing the result.

**Done:** no `MOVE`, `ADD`, `MULTIPLY`; `abap-mcp fix` finds nothing left to change.
**Gates:** `lint --abap-version Cloud` (obsolete_statement, parser_error) and `fix` (the deterministic auto-fixer resolves the baseline with zero model tokens).
