@Metadata.allowExtensions: true
@Metadata.ignorePropagatedAnnotations: true
@EndUserText: {
  label: '###GENERATED Core Data Service Entity'
}
@ObjectModel: {
  sapObjectNodeType.name: 'ZOrder', 
  semanticKey: [ 'Orderid' ]
}
@AccessControl.authorizationCheck: #MANDATORY
define root view entity ZC_ORDER000
  provider contract transactional_query
  as projection on ZR_ORDER000
  association [1..1] to ZR_ORDER000 as _BaseEntity on $projection.UUID = _BaseEntity.UUID
{
  key UUID,
  OrderID,
  OrderDate,
  CustomerName,
  @Semantics: {
    user.createdBy: true
  }
  LocalCreatedBy,
  @Semantics: {
    systemDateTime.createdAt: true
  }
  LocalCreatedAt,
  @Semantics: {
    user.localInstanceLastChangedBy: true
  }
  LocalLastChangedBy,
  @Semantics: {
    systemDateTime.localInstanceLastChangedAt: true
  }
  LocalLastChangedAt,
  @Semantics: {
    systemDateTime.lastChangedAt: true
  }
  LastChangedAt,
  
  Status,
  
  _OrderItem : redirected to composition child ZC_ORDERITEM,
  _BaseEntity
}
