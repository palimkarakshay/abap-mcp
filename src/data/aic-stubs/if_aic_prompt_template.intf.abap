"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! GET_PROMPT shape verified against SAP Help "Prompt Library API" and
"! SAP-samples/abap-cheat-sheets 30_Generative_AI.md.
INTERFACE if_aic_prompt_template PUBLIC.

  TYPES: BEGIN OF ty_parameter,
           name  TYPE string,
           value TYPE string,
         END OF ty_parameter,
         tt_parameter TYPE STANDARD TABLE OF ty_parameter WITH EMPTY KEY.

  METHODS get_prompt
    IMPORTING parameters    TYPE tt_parameter OPTIONAL
    RETURNING VALUE(result) TYPE string.

ENDINTERFACE.
