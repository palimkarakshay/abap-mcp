"! STUB — abap-mcp's own declaration of this type's public signature, NOT SAP source.
"! See if_aic_completion_api.intf.abap header for the licence/attribution note.
"! Verified against SAP Help "Media Input For Large Language Model Requests": ADD_MEDIA
"! must precede the SET_* calls, which act on the most recently added item; media data
"! must be base64-encoded.
INTERFACE if_aic_media_message PUBLIC.

  METHODS add_media
    RETURNING VALUE(result) TYPE REF TO if_aic_media_message.

  METHODS add_text
    IMPORTING text          TYPE string
    RETURNING VALUE(result) TYPE REF TO if_aic_media_message.

  METHODS set_media_data
    IMPORTING base64_data   TYPE string
    RETURNING VALUE(result) TYPE REF TO if_aic_media_message.

  METHODS set_any_media_parameter
    IMPORTING name          TYPE string
              value         TYPE any
    RETURNING VALUE(result) TYPE REF TO if_aic_media_message.

ENDINTERFACE.
