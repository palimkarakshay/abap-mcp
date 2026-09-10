"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified against SAP Help "Catchable Exceptions": GET_CODE / GET_ORIGINAL_CODE /
"! GET_ORIGINAL_MESSAGE plus the three documented error codes.
INTERFACE if_aic_api_error PUBLIC.

  CONSTANTS:
    BEGIN OF error_codes,
      context_length_exceeded TYPE string VALUE 'CONTEXT_LENGTH_EXCEEDED',
      invalid_prompt          TYPE string VALUE 'INVALID_PROMPT',
      content_filter          TYPE string VALUE 'CONTENT_FILTER',
    END OF error_codes.

  METHODS get_code
    RETURNING VALUE(result) TYPE string.

  METHODS get_original_code
    RETURNING VALUE(result) TYPE string.

  METHODS get_original_message
    RETURNING VALUE(result) TYPE string.

ENDINTERFACE.
