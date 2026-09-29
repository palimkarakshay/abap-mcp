# 01 - RAP order BO
**Prompt:** Create a managed RAP behavior definition for the root view entity `ZNWB_R_Order` (table `znwb_order`, package ZNWB) with create, update and delete. Target ABAP Cloud, strict mode 2.

**Done:** the BDEF declares lock master, an ETag and an authorization master, and has no RAP errors.
**Gates:** `rapcheck` (RAP028 lock master, RAP029 authorization master, RAP032 etag).
