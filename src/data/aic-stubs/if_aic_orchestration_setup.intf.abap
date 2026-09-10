"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Real interface follows a documented method-naming convention (RESET/SET_xxx/
"! CONFIGURE_xxx/ADD_xxx/FINISHED, all chainable) that is much larger than this stub;
"! only the two methods scaffold_abap_ai_sdk's orchestration variant calls are declared.
INTERFACE if_aic_orchestration_setup PUBLIC.

  METHODS add_user_message
    IMPORTING user_message  TYPE string
    RETURNING VALUE(result) TYPE REF TO if_aic_orchestration_setup.

  METHODS add_prompt_template
    IMPORTING template_id   TYPE string
    RETURNING VALUE(result) TYPE REF TO if_aic_orchestration_setup.

ENDINTERFACE.
