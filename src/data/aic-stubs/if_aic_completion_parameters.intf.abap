"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified against SAP Help "Calling The Completion API": SET_TEMPERATURE takes a
"! string between 0 and 1; SET_ANY_PARAMETER is a generic name/value passthrough.
INTERFACE if_aic_completion_parameters PUBLIC.

  METHODS set_temperature
    IMPORTING value TYPE string.

  METHODS set_maximum_tokens
    IMPORTING value TYPE i.

  METHODS set_any_parameter
    IMPORTING name  TYPE string
              value TYPE any.

ENDINTERFACE.
