CLASS ltc_rating DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    METHODS averages_valid_only FOR TESTING.
    METHODS empty_is_zero FOR TESTING.
ENDCLASS.

CLASS ltc_rating IMPLEMENTATION.
  METHOD averages_valid_only.
    DATA(lt_in) = VALUE zcl_nwb_rating=>tt_rating( ( 4 ) ( 5 ) ( 0 ) ( 9 ) ( 1 ) ).
    cl_abap_unit_assert=>assert_equals( act = zcl_nwb_rating=>average( lt_in ) exp = '3.33' ).
  ENDMETHOD.
  METHOD empty_is_zero.
    DATA lt_none TYPE zcl_nwb_rating=>tt_rating.
    cl_abap_unit_assert=>assert_equals( act = zcl_nwb_rating=>average( lt_none ) exp = '0.00' ).
  ENDMETHOD.
ENDCLASS.
