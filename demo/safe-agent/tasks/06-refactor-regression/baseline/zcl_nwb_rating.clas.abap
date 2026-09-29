CLASS zcl_nwb_rating DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES ty_avg TYPE p LENGTH 5 DECIMALS 2.
    TYPES tt_rating TYPE STANDARD TABLE OF i WITH EMPTY KEY.
    "! Average of the ratings 1..5; other values are ignored; 0 when none are valid.
    CLASS-METHODS average IMPORTING it_ratings TYPE tt_rating RETURNING VALUE(rv_avg) TYPE ty_avg.
ENDCLASS.

CLASS zcl_nwb_rating IMPLEMENTATION.
  METHOD average.
    DATA lv_sum TYPE i.
    DATA lv_count TYPE i.
    LOOP AT it_ratings INTO DATA(lv_rating).
      lv_sum = lv_sum + lv_rating.
      lv_count = lv_count + 1.
    ENDLOOP.
    IF lv_count = 0.
      RETURN.
    ENDIF.
    rv_avg = lv_sum / lv_count.
  ENDMETHOD.
ENDCLASS.
