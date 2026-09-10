"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! IF_AIC_TOOL_CALL is an invented name for the row type of GET_TOOL_CALLS( ) — SAP's
"! "Function Calling" page documents GET_TOOL_TYPE / GET_FUNCTION_CALL / SET_CALL_RESULT
"! on each "tool_call" but never names the object's interface; declared here only so the
"! function-calling DO-loop can be typed for abaplint.
INTERFACE if_aic_tool_call PUBLIC.

  TYPES: BEGIN OF ty_function_call,
           function_name TYPE string,
           parameters    TYPE string,
         END OF ty_function_call.

  "! Currently always returns 'function' per SAP's own comment in the sample DO-loop.
  METHODS get_tool_type
    RETURNING VALUE(result) TYPE string.

  METHODS get_function_call
    RETURNING VALUE(result) TYPE ty_function_call.

  "! Function results must be a string — JSON-encode complex results.
  METHODS set_call_result
    IMPORTING value TYPE string.

ENDINTERFACE.
