@Metadata.allowExtensions: true
@Metadata.ignorePropagatedAnnotations: true
@Endusertext: {
  Label: '###GENERATED Core Data Service Entity'
}
@Objectmodel: {
  Semantickey: [ 'Orderitemid' ]
}
@AccessControl.authorizationCheck: #MANDATORY
define view entity ZC_ORDERITEM
  as projection on ZR_ORDERITEM
  association [1..1] to ZR_ORDERITEM as _BaseEntity on $projection.UUID = _BaseEntity.UUID
{
  key UUID,
  ParentUUID,
  OrderItemID,
  ProductName,
  @Semantics: {
    Quantity.Unitofmeasure: 'QuantityUOM'
  }
  Quantity,
  @Semantics: {
    Amount.Currencycode: 'CurrencyCode'
  }
  UnitPrice,
  @Consumption: {
    Valuehelpdefinition: [ {
      Entity.Element: 'UnitOfMeasure', 
      Entity.Name: 'I_UnitOfMeasureStdVH', 
      Useforvalidation: true
    } ]
  }
  QuantityUOM,
  @Consumption: {
    Valuehelpdefinition: [ {
      Entity.Element: 'Currency', 
      Entity.Name: 'I_CurrencyStdVH', 
      Useforvalidation: true
    } ]
  }
  CurrencyCode,
  _Order000 : redirected to parent ZC_ORDER000,
  _BaseEntity
}
