# 04 - Cancel an order
**Prompt:** Write `zcl_nwb_order_admin=>cancel( )` that sets an order to status X. Only authorised users may do it.

**Done:** the update is guarded by `AUTHORITY-CHECK OBJECT 'ZNWB_ORD'` (activity 02), with no user names in the code.
**Gates:** policy rules `POL-HARDCODED-USER` (forbidden) and `POL-AUTH-REQUIRED` (required for any `UPDATE ... SET`).
