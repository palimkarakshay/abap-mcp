@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Projection View forSalesOrder'
define root view entity ZREUSEI_SalesOrderTP_002
  provider contract transactional_interface
  as projection on ZREUSER_SalesOrderTP_002 as SalesOrder
{
  key SalesorderID,
      CustomerID,
      PaymentMethod,
      AmountExclVat,
      AmountVat,
      TotalAmount,
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
      _Item : redirected to composition child ZREUSEI_ItemTP_002

}
