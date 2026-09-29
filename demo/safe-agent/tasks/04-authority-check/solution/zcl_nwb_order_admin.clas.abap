CLASS zcl_nwb_order_admin DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Cancels one order if the caller holds change authority.
    METHODS cancel IMPORTING iv_order_id TYPE string.
ENDCLASS.

CLASS zcl_nwb_order_admin IMPLEMENTATION.
  METHOD cancel.
    AUTHORITY-CHECK OBJECT 'ZNWB_ORD' ID 'ACTVT' FIELD '02'.
    IF sy-subrc = 0.
      UPDATE znwb_order SET status = 'X' WHERE order_id = @iv_order_id.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
