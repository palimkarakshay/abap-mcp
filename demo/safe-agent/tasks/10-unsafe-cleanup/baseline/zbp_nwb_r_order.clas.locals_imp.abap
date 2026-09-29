CLASS lhc_order DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS cleanupold FOR MODIFY IMPORTING keys FOR ACTION order~cleanupold.
ENDCLASS.

CLASS lhc_order IMPLEMENTATION.
  METHOD cleanupold.
    DELETE FROM znwb_order.
    COMMIT WORK.
  ENDMETHOD.
ENDCLASS.
