@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'Northwind order'
define root view entity ZNWB_R_Order
  as select from znwb_order
{
  key order_id        as OrderId,
      customer_id     as CustomerId,
      status          as Status,
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at as LastChangedAt
}
