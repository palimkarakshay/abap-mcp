CLASS zcl_nwb_price DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Sums the prices, adds one unit of tax, doubles the result.
    CLASS-METHODS total IMPORTING it_prices TYPE int4_table RETURNING VALUE(rv_total) TYPE i.
ENDCLASS.

CLASS zcl_nwb_price IMPLEMENTATION.
  METHOD total.
    DATA lv_sum TYPE i.
    LOOP AT it_prices INTO DATA(lv_price).
      lv_sum = lv_sum + lv_price.
    ENDLOOP.
    lv_sum = lv_sum + 1.
    lv_sum = lv_sum * 2.
    rv_total = lv_sum.
  ENDMETHOD.
ENDCLASS.
