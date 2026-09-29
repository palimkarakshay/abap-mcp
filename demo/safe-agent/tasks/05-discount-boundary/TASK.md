# 05 - Volume discount (live demo task)
**Prompt:** Implement `zcl_nwb_discount=>net_amount( iv_qty iv_unit_price )`: 10 or more units earn 10 percent off; result has 2 decimals. Tests are in the bundled `.testclasses.abap`.

**Done:** all three ABAP Unit methods pass when executed offline.
**Gates:** `unittest --run --abap-version Cloud`. `lint` and `readiness` are also run to show they are blind to this bug.
