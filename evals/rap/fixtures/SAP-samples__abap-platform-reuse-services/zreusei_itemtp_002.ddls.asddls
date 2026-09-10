@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Projection View forItem'
define view entity ZREUSEI_ItemTP_002
  as projection on ZREUSER_ItemTP_002 as Item
{
  key SalesorderID,
  key ItemID,
  Product,
  Quantity,
  QuantityUnit,
  AmountExclVat,
  AmountVat,
  Amount,
  UnitPrice,
  CurrencyCode,
  Description,
  OverallStatus,
  LocalLastChangedAt,
  _SalesOrder : redirected to parent ZREUSEI_SalesOrderTP_002
  
}
