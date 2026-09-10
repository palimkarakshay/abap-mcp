"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified name (CX_AIC_COMPLETION_API) and the API_ERROR attribute shape — see
"! VERIFIED.md "EXCEPTION DETAIL" additional fact (curatedDate 2026-09-10).
CLASS cx_aic_completion_api DEFINITION PUBLIC INHERITING FROM cx_static_check CREATE PUBLIC.
  PUBLIC SECTION.
    DATA api_error TYPE REF TO if_aic_api_error READ-ONLY.
ENDCLASS.

CLASS cx_aic_completion_api IMPLEMENTATION.
ENDCLASS.
