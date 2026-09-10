"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! SET_SYSTEM_ROLE / ADD_USER_MESSAGE parameter names verified against the official
"! tutorial "Implement a Simple Custom ABAP AI Scenario" (container->set_system_role(
"! system_role = system_role ), container->add_user_message( message = user_message )).
"! ADD_USER_MEDIA_MESSAGE verified against SAP Help "Media Input For Large Language
"! Model Requests".
INTERFACE if_aic_message_container PUBLIC.

  METHODS set_system_role
    IMPORTING system_role TYPE string.

  METHODS add_user_message
    IMPORTING message TYPE string.

  METHODS add_assistant_message
    IMPORTING message TYPE string.

  METHODS add_tool_results
    IMPORTING tool_calls TYPE STANDARD TABLE OF REF TO if_aic_tool_call WITH EMPTY KEY.

  METHODS get_messages
    RETURNING VALUE(result) TYPE STANDARD TABLE OF string WITH EMPTY KEY.

  METHODS add_user_media_message
    RETURNING VALUE(result) TYPE REF TO if_aic_media_message.

ENDINTERFACE.
