CLASS ltc_discount DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS below_threshold FOR TESTING.
    METHODS at_threshold FOR TESTING.
    METHODS rounds_to_cents FOR TESTING.
ENDCLASS.

CLASS ltc_discount IMPLEMENTATION.
  METHOD below_threshold.
    cl_abap_unit_assert=>assert_equals( act = zcl_nwb_discount=>net_amount( iv_qty = 9 iv_unit_price = '10.00' ) exp = '90.00' ).
  ENDMETHOD.
  METHOD at_threshold.
    cl_abap_unit_assert=>assert_equals( act = zcl_nwb_discount=>net_amount( iv_qty = 10 iv_unit_price = '10.00' ) exp = '90.00' ).
  ENDMETHOD.
  METHOD rounds_to_cents.
    cl_abap_unit_assert=>assert_equals( act = zcl_nwb_discount=>net_amount( iv_qty = 11 iv_unit_price = '9.99' ) exp = '98.90' ).
  ENDMETHOD.
ENDCLASS.
