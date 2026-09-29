# 02 - Open orders on a released API
**Prompt:** Add a CDS view `ZNWB_I_OpenOrder` and a class method that counts one customer's sales orders. The code must be Clean Core (S/4HANA Cloud public edition).

**Done:** nothing reads a classic table such as VBAK; the released CDS view `I_SalesDocument` is used.
**Gates:** `readiness --edition s4hc` (released-API cross-check). The btp snapshot does not record VBAK, so s4hc is used. The `.ddls` files are shown for realism; readiness scans the ABAP SQL consumer.
