@AccessControl.authorizationCheck: #CHECK
@Metadata.allowExtensions: true
@EndUserText.label: 'Projection View forSalesOrder'
@ObjectModel.semanticKey: [ 'SalesorderID' ]
@Search.searchable: true
define root view entity ZREUSEC_SalesOrderTP_002
  provider contract transactional_query
  as projection on ZREUSER_SalesOrderTP_002 as SalesOrder
  association [0..*] to ZREUSEI_CDREDADD_002 as _ChangeDocs on 
  $projection.SalesorderID = _ChangeDocs.objectid
  
{
      @Search.defaultSearchElement: true
      @Search.fuzzinessThreshold: 0.90
  key SalesorderID,
      Tabkey,
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
      Attachment,
      MimeType,
      FileName,
      CreatedAt,
      CreatedBy,
      LastChangedBy,
      LastChangedAt,
      LocalLastChangedAt,
      _Item : redirected to composition child ZREUSEC_ItemTP_002,
      _Customer
      ,
      _ChangeDocs
      

}
