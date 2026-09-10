"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! CAUTION: SAP's "Function Calling" page shows register_function( )->add_parameter(
"! )->...->set_description( ) as a fluent chain but never publishes an interface name
"! for the intermediate builder object. IF_AIC_FUNCTION_DEFINITION is an invented name,
"! declared here only so the chain can be typed for abaplint — do not treat it as a
"! verified SAP identifier.
INTERFACE if_aic_function_definition PUBLIC.

  METHODS add_parameter
    IMPORTING name          TYPE string
              description   TYPE string
              type          TYPE REF TO cl_abap_typedescr OPTIONAL
              required      TYPE abap_bool OPTIONAL
    RETURNING VALUE(result) TYPE REF TO if_aic_function_definition.

  METHODS set_description
    IMPORTING description TYPE string.

ENDINTERFACE.
