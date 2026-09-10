@AccessControl.authorizationCheck: #CHECK
@Metadata.allowExtensions: true
@EndUserText.label: 'CDS View forItem'
define view entity ZREUSER_ItemTP_002
  as select from ZREUSEI_Item_002 as Item
  association        to parent ZREUSER_SalesOrderTP_002 as _SalesOrder on $projection.SalesorderID = _SalesOrder.SalesorderID
  association [1..1] to ZREUSEI_VH_PRODUCT_002          as _Product    on $projection.Product = _Product.Product

{
  key SalesorderID,
  key ItemID,
      Product,
      @Semantics.quantity.unitOfMeasure: 'QuantityUnit'
      Quantity,
      QuantityUnit,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      AmountExclVat,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      AmountVat,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      Amount,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      UnitPrice,
      CurrencyCode,
      Description,
      OverallStatus,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      LocalLastChangedAt,
      _SalesOrder,
      _Product

}
