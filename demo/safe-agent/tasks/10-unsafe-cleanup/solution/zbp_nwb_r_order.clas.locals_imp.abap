CLASS lhc_order DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS cleanupold FOR MODIFY IMPORTING keys FOR ACTION order~cleanupold.
ENDCLASS.

CLASS lhc_order IMPLEMENTATION.
  METHOD cleanupold.
    DATA(lv_cutoff) = utclong_add( val = utclong_current( ) days = -365 ).
    SELECT order_id FROM znwb_order
      WHERE status = 'X' AND last_changed_at < @lv_cutoff
      INTO TABLE @DATA(lt_old).
    MODIFY ENTITIES OF znwb_r_order IN LOCAL MODE
      ENTITY Order DELETE FROM VALUE #( FOR ls_old IN lt_old ( OrderId = ls_old-order_id ) ).
  ENDMETHOD.
ENDCLASS.
