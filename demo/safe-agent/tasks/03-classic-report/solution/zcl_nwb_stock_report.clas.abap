CLASS zcl_nwb_stock_report DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    TYPES: BEGIN OF ty_material,
             product      TYPE string,
             product_type TYPE string,
           END OF ty_material,
           tt_material TYPE STANDARD TABLE OF ty_material WITH EMPTY KEY.
    "! Returns up to 50 materials from the released product view.
    METHODS get_materials RETURNING VALUE(rt_material) TYPE tt_material.
ENDCLASS.

CLASS zcl_nwb_stock_report IMPLEMENTATION.
  METHOD get_materials.
    SELECT Product AS product, ProductType AS product_type
      FROM I_Product
      ORDER BY Product
      INTO CORRESPONDING FIELDS OF TABLE @rt_material
      UP TO 50 ROWS.
  ENDMETHOD.
ENDCLASS.
