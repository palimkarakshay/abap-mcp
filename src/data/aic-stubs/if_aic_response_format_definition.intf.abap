"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! CAUTION: builder-chain type, invented name — see if_aic_function_definition.intf.abap
"! for why. SAP's "Format Specification Of Completion API Response" page shows only the
"! call shape define_response_format( )->json_schema( )->from_string( <schema> ).
INTERFACE if_aic_response_format_definition PUBLIC.

  METHODS json_schema
    RETURNING VALUE(result) TYPE REF TO if_aic_json_schema_format.

ENDINTERFACE.
