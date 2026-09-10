"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! CONFIGURE_TEMPLATING / EXECUTE shape verified against the ADDITIONAL FACTS
"! "ORCHESTRATION TUTORIAL CODE" entry in VERIFIED.md (curatedDate 2026-09-10).
"! LIMITATION (verified, paraphrased — not SAP prose): the Orchestration API does not
"! yet support structured output, function calling, or media input; use the Completion
"! API for those.
INTERFACE if_aic_orchestration_api PUBLIC.

  METHODS configure_templating
    RETURNING VALUE(result) TYPE REF TO if_aic_orchestration_setup.

  METHODS execute
    RETURNING VALUE(result) TYPE REF TO if_aic_orchestration_response
    RAISING   cx_aic_completion_api.

ENDINTERFACE.
