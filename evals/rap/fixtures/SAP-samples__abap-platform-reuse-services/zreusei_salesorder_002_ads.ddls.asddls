@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Basic Interface View forSalesOrder'
define view entity ZREUSEI_SALESORDER_002_ADS
  as select from zreuse_head_002 as SalesOrder
  association [0..*] to ZREUSEI_ITEM_002_ADS    as _Item     on $projection.SalesorderID = _Item.SalesorderID
  association [1..1] to ZREUSEI_VH_CUSTOMER_002 as _Customer on $projection.CustomerID = _Customer.CustomerID
{
  key salesorder_id as SalesorderID,
      customer_id   as CustomerID,
      @Semantics.amount.currencyCode: 'CurrencyCode'
      total_amount  as TotalAmount,
      currency_code as CurrencyCode,
      _Customer,
      _Item

}
