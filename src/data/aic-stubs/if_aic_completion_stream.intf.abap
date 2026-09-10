"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified against SAP Help "Streaming Of LLM Responses": HAS_NEXT / GET_NEXT / CANCEL /
"! GET_FINAL_RESULTS driving a WHILE loop.
INTERFACE if_aic_completion_stream PUBLIC.

  METHODS has_next
    RETURNING VALUE(result) TYPE abap_bool.

  METHODS get_next
    RETURNING VALUE(result) TYPE REF TO if_aic_completion_stream_part.

  METHODS cancel.

  METHODS get_final_results
    RETURNING VALUE(result) TYPE REF TO if_aic_completion_api_result.

ENDINTERFACE.
