@ObjectModel.query.implementedBy: 'ABAP:ZREUSECL_VH_PRODUCT_002'
@EndUserText.label: 'Value help for products'
define custom entity ZREUSEI_VH_PRODUCT_002
{
  key Product : abap.char( 40 );
  ProductText : abap.char( 40 );
  ProductGroup : abap.char( 40 );
  @Semantics.amount.currencyCode: 'Currency'
  Price : abap.curr( 15, 2 );
  Currency : abap.cuky( 5 );
  BaseUnit : abap.unit( 3 );
  
}
