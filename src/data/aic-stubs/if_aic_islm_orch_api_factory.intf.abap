"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified against SAP Help "Utilization Of The Orchestration Service Of The
"! Generative AI Hub" and the codex deep-research report §3.4.
INTERFACE if_aic_islm_orch_api_factory PUBLIC.

  METHODS create_instance
    IMPORTING islm_scenario TYPE string
    RETURNING VALUE(result) TYPE REF TO if_aic_orchestration_api
    RAISING   cx_aic_api_factory.

ENDINTERFACE.
