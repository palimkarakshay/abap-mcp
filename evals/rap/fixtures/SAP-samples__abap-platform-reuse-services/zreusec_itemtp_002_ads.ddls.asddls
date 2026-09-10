@AccessControl.authorizationCheck: #CHECK
@Metadata.allowExtensions: true
@EndUserText.label: 'Projection View forItem'
@ObjectModel.semanticKey: [ 'ItemID' ]
@Search.searchable: true
define view entity ZREUSEC_ITEMTP_002_ADS
  as projection on ZREUSER_ItemTP_002 as Item
{
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.90
  key SalesorderID,
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.90
  key ItemID,
      @Consumption.valueHelpDefinition: [ {
       entity: {
         name: 'ZREUSEI_VH_PRODUCT_002',
         element: 'Product'
       }
       } ]
      Product,
      @Semantics.quantity.unitOfMeasure: 'QuantityUnit'
      Quantity,
      @Semantics.unitOfMeasure: true
      @Consumption.valueHelpDefinition: [ {
        entity: {
          name: 'I_UnitOfMeasure',
          element: 'UnitOfMeasure'
        },
        useForValidation: true
      } ]
      QuantityUnit,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      AmountExclVat,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      AmountVat,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      Amount,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      UnitPrice,
      @Consumption.valueHelpDefinition: [ {
        entity: {
          name: 'I_Currency',
          element: 'Currency'
        },
        useForValidation: true
      } ]
      CurrencyCode,
      Description,
      OverallStatus,
      LocalLastChangedAt,
      _SalesOrder ,
      _Product
}
