CLASS zcl_eval_native_sql DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS read_count
      RETURNING VALUE(rv_count) TYPE i.
ENDCLASS.

CLASS zcl_eval_native_sql IMPLEMENTATION.
  METHOD read_count.
    EXEC SQL.
      SELECT COUNT(*) INTO :rv_count FROM sflight
    ENDEXEC.
  ENDMETHOD.
ENDCLASS.
