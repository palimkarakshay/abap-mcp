CLASS zcl_nwb_open_orders DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Counts the sales orders of one customer.
    METHODS count_for IMPORTING iv_customer TYPE string RETURNING VALUE(rv_count) TYPE i.
ENDCLASS.

CLASS zcl_nwb_open_orders IMPLEMENTATION.
  METHOD count_for.
    SELECT vbeln FROM vbak WHERE kunnr = @iv_customer INTO TABLE @DATA(lt_orders).
    rv_count = lines( lt_orders ).
  ENDMETHOD.
ENDCLASS.
