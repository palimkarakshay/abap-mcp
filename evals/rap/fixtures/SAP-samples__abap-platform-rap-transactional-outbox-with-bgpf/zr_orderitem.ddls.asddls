@AccessControl.authorizationCheck: #MANDATORY
@Metadata.allowExtensions: true
@EndUserText.label: '###GENERATED Core Data Service Entity'
@ObjectModel.semanticKey: [ 'Orderitemid' ]
define view entity ZR_ORDERITEM
  as select from ZORDERITEM as OrderItem
  association to parent ZR_ORDER000 as _Order000 on $projection.ParentUuid = _Order000.Uuid
{
  key uuid as UUID,
  parent_uuid as ParentUUID,
  order_item_id as OrderItemID,
  product_name as ProductName,
  @Semantics.quantity.unitOfMeasure: 'QuantityUOM'
  quantity as Quantity,
  @Semantics.amount.currencyCode: 'CurrencyCode'
  unit_price as UnitPrice,
  @Consumption.valueHelpDefinition: [ {
    entity.name: 'I_UnitOfMeasureStdVH', 
    entity.element: 'UnitOfMeasure', 
    useForValidation: true
  } ]
  quantity_uom as QuantityUOM,
  @Consumption.valueHelpDefinition: [ {
    entity.name: 'I_CurrencyStdVH', 
    entity.element: 'Currency', 
    useForValidation: true
  } ]
  currency_code as CurrencyCode,
  _Order000
}
