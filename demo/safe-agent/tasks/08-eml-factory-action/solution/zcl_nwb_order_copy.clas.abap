CLASS zcl_nwb_order_copy DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Creates two draft orders for one customer through EML.
    METHODS create_pair IMPORTING iv_customer TYPE string.
ENDCLASS.

CLASS zcl_nwb_order_copy IMPLEMENTATION.
  METHOD create_pair.
    MODIFY ENTITIES OF znwb_r_order
      ENTITY Order
        CREATE FIELDS ( CustomerId Status )
        WITH VALUE #( ( %cid = 'ORDER1' CustomerId = iv_customer Status = 'N'
                        %control = VALUE #( CustomerId = if_abap_behv=>mk-on Status = if_abap_behv=>mk-on ) )
                      ( %cid = 'ORDER2' CustomerId = iv_customer Status = 'N'
                        %control = VALUE #( CustomerId = if_abap_behv=>mk-on Status = if_abap_behv=>mk-on ) ) )
      MAPPED DATA(ls_mapped)
      FAILED DATA(ls_failed)
      REPORTED DATA(ls_reported).
  ENDMETHOD.
ENDCLASS.
