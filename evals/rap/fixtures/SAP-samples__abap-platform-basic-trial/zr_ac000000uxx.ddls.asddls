@AccessControl.authorizationCheck: #MANDATORY
@Metadata.allowExtensions: true
@ObjectModel.sapObjectNodeType.name: 'ZAC000000UXX'
@EndUserText.label: 'Shopping Cart'
define root view entity ZR_AC000000UXX
  as select from zac000000uxx as ShoppingCart
{
  key order_uuid as OrderUUID,
  order_id as OrderID,
  ordered_item as OrderedItem,
  order_quantity as OrderQuantity,
  requested_delivery_date as RequestedDeliveryDate,
  @Semantics.amount.currencyCode: 'Currency'
  total_price as TotalPrice,
  @Consumption.valueHelpDefinition: [ {
    entity.name: 'I_CurrencyStdVH', 
    entity.element: 'Currency', 
    useForValidation: true
  } ]
  currency as Currency,
  overall_status as OverallStatus,
  sales_order_status as SalesOrderStatus,
  salesorder as Salesorder,
  bgpf_status as BgpfStatus,
  bgpg_process_name as BgpgProcessName,
  manage_sales_order_url as ManageSalesOrderUrl,
  notes as Notes,
  @Semantics.user.createdBy: true
  created_by as CreatedBy,
  @Semantics.systemDateTime.createdAt: true
  created_at as CreatedAt,
  @Semantics.user.lastChangedBy: true
  last_changed_by as LastChangedBy,
  @Semantics.systemDateTime.lastChangedAt: true
  last_changed_at as LastChangedAt,
  @Semantics.systemDateTime.localInstanceLastChangedAt: true
  local_last_changed_at as LocalLastChangedAt
}
