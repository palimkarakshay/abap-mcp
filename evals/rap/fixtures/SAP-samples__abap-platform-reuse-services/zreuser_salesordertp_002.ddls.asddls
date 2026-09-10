@AccessControl.authorizationCheck: #CHECK
@Metadata.allowExtensions: true
@EndUserText.label: 'CDS View forSalesOrder'
define root view entity ZREUSER_SalesOrderTP_002
  as select from ZREUSEI_SalesOrder01_002 as SalesOrder
  composition [0..*] of ZREUSER_ItemTP_002      as _Item
  association [1..1] to ZREUSEI_VH_CUSTOMER_002 as _Customer on $projection.CustomerID = _Customer.CustomerID
{
  key SalesorderID,
      concat ( '100' , SalesorderID) as Tabkey,
      CustomerID,
      PaymentMethod,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      AmountExclVat,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      AmountVat,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      TotalAmount,
      CurrencyCode,
      Description,
      OverallStatus,
      @Semantics.largeObject: { mimeType: 'MimeType',   //case-sensitive
                          fileName: 'FileName',   //case-sensitive
                          acceptableMimeTypes: ['image/png', 'image/jpeg', 'application/pdf' ],
                          contentDispositionPreference: #ATTACHMENT }

      Attachment,
      FileName,
      @Semantics.mimeType: true
      MimeType,
      @Semantics.systemDateTime.createdAt: true
      CreatedAt,
      @Semantics.user.createdBy: true
      CreatedBy,
      @Semantics.user.lastChangedBy: true
      LastChangedBy,
      @Semantics.systemDateTime.lastChangedAt: true
      LastChangedAt,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      LocalLastChangedAt,
      _Item,
      _Customer

}
