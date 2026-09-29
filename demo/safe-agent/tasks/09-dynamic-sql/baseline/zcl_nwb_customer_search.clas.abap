CLASS zcl_nwb_customer_search DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Finds customer names by user-typed name.
    METHODS find_by_name IMPORTING iv_name TYPE string RETURNING VALUE(rt_names) TYPE string_table.
ENDCLASS.

CLASS zcl_nwb_customer_search IMPLEMENTATION.
  METHOD find_by_name.
    DATA(lv_where) = |name = '{ iv_name }'|.
    SELECT name FROM znwb_cust WHERE (lv_where) INTO TABLE @rt_names.
  ENDMETHOD.
ENDCLASS.
