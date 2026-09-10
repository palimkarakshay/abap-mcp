"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Method shapes verified against SAP Help "Calling The Completion API" (token/finish-
"! reason getters), "Function Calling" (GET_TOOL_CALLS) and "Format Specification Of
"! Completion API Response" (GET_RESPONSE_FORMAT_REFUSAL).
INTERFACE if_aic_completion_api_result PUBLIC.

  METHODS get_completion
    RETURNING VALUE(result) TYPE string.

  METHODS get_runtime_ms
    RETURNING VALUE(result) TYPE i.

  METHODS get_prompt_token_count
    RETURNING VALUE(result) TYPE i.

  METHODS get_completion_token_count
    RETURNING VALUE(result) TYPE i.

  METHODS get_total_token_count
    RETURNING VALUE(result) TYPE i.

  METHODS get_finish_reason
    RETURNING VALUE(result) TYPE string.

  METHODS get_original_finish_reason
    RETURNING VALUE(result) TYPE string.

  METHODS get_tool_calls
    RETURNING VALUE(result) TYPE STANDARD TABLE OF REF TO if_aic_tool_call WITH EMPTY KEY.

  METHODS get_response_format_refusal
    RETURNING VALUE(result) TYPE abap_bool.

ENDINTERFACE.
