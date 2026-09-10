@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Basic Interface View forItem'
define view entity ZREUSEI_Item_002
  as select from zreuse_item_002 as Item
{
  key salesorder_id as SalesorderID,
  key item_id as ItemID,
  product as Product,
  @Semantics.quantity.unitOfMeasure: 'QuantityUnit'
  quantity as Quantity,
  quantity_unit as QuantityUnit,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  amount_excl_vat as AmountExclVat,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  amount_vat as AmountVat,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  amount as Amount,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  unit_price as UnitPrice,
  currency_code as CurrencyCode,
  description as Description,
  overall_status as OverallStatus,
  @Semantics.systemDateTime.localInstanceLastChangedAt: true
  local_last_changed_at as LocalLastChangedAt
  
}
