"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified against SAP Help "Prompt Library API": CREATE_INSTANCE needs islm_scenario +
"! template_id; only ISLM-defined prompt templates are currently supported.
INTERFACE if_aic_islm_prompt_tpl_factory PUBLIC.

  METHODS create_instance
    IMPORTING islm_scenario TYPE string
              template_id   TYPE string
    RETURNING VALUE(result) TYPE REF TO if_aic_prompt_template
    RAISING   cx_aic_prompt_template.

ENDINTERFACE.
