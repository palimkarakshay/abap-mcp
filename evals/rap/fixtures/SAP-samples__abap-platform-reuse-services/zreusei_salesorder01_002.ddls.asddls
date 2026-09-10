@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Basic Interface View forSalesOrder'
define view entity ZREUSEI_SalesOrder01_002
  as select from zreuse_head_002 as SalesOrder
{
  key salesorder_id as SalesorderID,
  customer_id as CustomerID,
  payment_method as PaymentMethod,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  amount_excl_vat as AmountExclVat,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  amount_vat as AmountVat,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  total_amount as TotalAmount,
  currency_code as CurrencyCode,
  description as Description,
  overall_status as OverallStatus,
  @Semantics.systemDateTime.createdAt: true
  created_at as CreatedAt,
  @Semantics.user.createdBy: true
  created_by as CreatedBy,
  @Semantics.user.lastChangedBy: true
  last_changed_by as LastChangedBy,
  @Semantics.systemDateTime.lastChangedAt: true
  last_changed_at as LastChangedAt,
  @Semantics.systemDateTime.localInstanceLastChangedAt: true
  local_last_changed_at as LocalLastChangedAt,
  attachment as Attachment,
  file_name as FileName,
  mime_type as MimeType
  
  
}
