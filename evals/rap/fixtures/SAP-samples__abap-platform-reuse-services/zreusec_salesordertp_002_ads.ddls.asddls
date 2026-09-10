@AccessControl.authorizationCheck: #CHECK
@Metadata.allowExtensions: true
@EndUserText.label: 'Projection View forSalesOrder'
@ObjectModel.semanticKey: [ 'SalesorderID' ]
@Search.searchable: true
define root view entity ZREUSEC_SALESORDERTP_002_ADS  
  as projection on ZREUSER_SalesOrderTP_002 as SalesOrder
{
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.90
  key SalesorderID,
      @Consumption.valueHelpDefinition: [ {
      entity: {
        name: 'ZREUSEI_VH_CUSTOMER_002',
        element: 'CustomerID'
      }
      } ]
      CustomerID,
      PaymentMethod,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      AmountExclVat,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      AmountVat,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      TotalAmount,
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
      CreatedAt,
      CreatedBy,
      LastChangedBy,
      LastChangedAt,
      LocalLastChangedAt,
      _Item ,
      _Customer

}
