"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified against SAP Help "Completion API": GET( ) returns this interface, whose
"! CREATE_INSTANCE( islm_scenario ) needs only the scenario name.
INTERFACE if_aic_islm_compl_api_factory PUBLIC.

  METHODS create_instance
    IMPORTING islm_scenario TYPE string
    RETURNING VALUE(result) TYPE REF TO if_aic_completion_api
    RAISING   cx_aic_api_factory.

ENDINTERFACE.
