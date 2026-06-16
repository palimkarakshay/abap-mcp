CLASS zcl_eval_clean DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS add
      IMPORTING iv_a          TYPE i
                iv_b          TYPE i
      RETURNING VALUE(rv_sum) TYPE i.
ENDCLASS.

CLASS zcl_eval_clean IMPLEMENTATION.
  METHOD add.
    rv_sum = iv_a + iv_b.
  ENDMETHOD.
ENDCLASS.
