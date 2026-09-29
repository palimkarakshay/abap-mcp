CLASS zcl_nwb_price DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Sums the prices, adds one unit of tax, doubles the result.
    CLASS-METHODS total IMPORTING it_prices TYPE int4_table RETURNING VALUE(rv_total) TYPE i.
ENDCLASS.

CLASS zcl_nwb_price IMPLEMENTATION.
  METHOD total.
    DATA lv_sum TYPE i.
    LOOP AT it_prices INTO DATA(lv_price).
      ADD lv_price TO lv_sum.
    ENDLOOP.
    ADD 1 TO lv_sum.
    MULTIPLY lv_sum BY 2.
    MOVE lv_sum TO rv_total.
  ENDMETHOD.
ENDCLASS.
