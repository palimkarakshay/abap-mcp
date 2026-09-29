CLASS zcl_nwb_order_admin DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Cancels one order.
    METHODS cancel IMPORTING iv_order_id TYPE string.
ENDCLASS.

CLASS zcl_nwb_order_admin IMPLEMENTATION.
  METHOD cancel.
    IF sy-uname = 'ADMIN' OR sy-uname = 'JSMITH'.
      UPDATE znwb_order SET status = 'X' WHERE order_id = @iv_order_id.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
