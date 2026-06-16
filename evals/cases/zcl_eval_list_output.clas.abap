CLASS zcl_eval_list_output DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS show.
ENDCLASS.

CLASS zcl_eval_list_output IMPLEMENTATION.
  METHOD show.
    WRITE: / 'Flight report'.
    WRITE: / sy-datum.
    ULINE.
  ENDMETHOD.
ENDCLASS.
