"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified against SAP Help "Streaming Of LLM Responses". SAP's docs name this
"! interface and its stream methods but do not publish the exact factory call for
"! obtaining an instance — scaffold_abap_ai_sdk's streaming variant casts an
"! IF_AIC_COMPLETION_API instance to this interface as a documented assumption
"! (see the generated class's header comment and constraints[]).
INTERFACE if_aic_adt_completion_api PUBLIC.

  METHODS stream_for_messages
    IMPORTING messages      TYPE REF TO if_aic_message_container
    RETURNING VALUE(result) TYPE REF TO if_aic_completion_stream
    RAISING   cx_aic_completion_api.

ENDINTERFACE.
