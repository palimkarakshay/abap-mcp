CLASS zcl_nwb_discount DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ty_amount TYPE p LENGTH 8 DECIMALS 2.
    "! Net price for a line: 10 or more units earn 10 percent off.
    CLASS-METHODS net_amount
      IMPORTING iv_qty        TYPE i
                iv_unit_price TYPE ty_amount
      RETURNING VALUE(rv_net) TYPE ty_amount.
ENDCLASS.

CLASS zcl_nwb_discount IMPLEMENTATION.
  METHOD net_amount.
    rv_net = iv_qty * iv_unit_price.
    IF iv_qty > 10.
      rv_net = rv_net * '0.9'.
    ENDIF.
  ENDMETHOD.
ENDCLASS.
