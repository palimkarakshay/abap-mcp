# 08 - Copy an order through EML
**Prompt:** Add a factory action `CopyOrder` to `ZNWB_R_Order` and a class that creates two orders with one EML `MODIFY ENTITIES` call.

**Done:** the factory action returns its key through MAPPED (no `result`); each created row has its own `%cid` and sets `%control`.
**Gates:** `rapcheck` (RAP048) and policy `POL-EML-CONTROL`, `POL-EML-DUP-CID`.
