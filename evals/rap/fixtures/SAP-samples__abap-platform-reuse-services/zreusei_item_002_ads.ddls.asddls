@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Basic Interface View forItem'
define view entity ZREUSEI_ITEM_002_ADS
  as select from zreuse_item_002 as Item
   association [1..1] to ZREUSEI_VH_PRODUCT_002          as _Product    on $projection.Product = _Product.Product
  
{
  key salesorder_id as SalesorderID,
  key item_id as ItemID,
  product as Product,
  @Semantics.quantity.unitOfMeasure: 'QuantityUnit'
  quantity as Quantity,
  quantity_unit as QuantityUnit,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  amount as Amount,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  unit_price as UnitPrice,
  currency_code as CurrencyCode,
  _Product
  
}
