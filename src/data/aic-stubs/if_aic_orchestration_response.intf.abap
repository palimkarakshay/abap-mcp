"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
INTERFACE if_aic_orchestration_response PUBLIC.

  METHODS orchestration_result
    RETURNING VALUE(result) TYPE REF TO if_aic_orchestration_result.

ENDINTERFACE.
