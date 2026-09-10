@Metadata.allowExtensions: true
@Metadata.ignorePropagatedAnnotations: true
@EndUserText: {
  label: '###GENERATED Core Data Service Entity'
}
@ObjectModel: {
  sapObjectNodeType.name: 'ZShippingRequest', 
  semanticKey: [ 'ShippingRequestID' ]
}
@AccessControl.authorizationCheck: #MANDATORY
define root view entity ZC_SHIPPINGREQUEST
  provider contract transactional_query
  as projection on ZR_SHIPPINGREQUEST
  association [1..1] to ZR_SHIPPINGREQUEST as _BaseEntity on $projection.UUID = _BaseEntity.UUID
  
  association [1..1] to ZC_ORDER000 as _Order on $projection.OrderReference = _Order.UUID
  
{
  key UUID,
  ShippingRequestID,
  OrderReference,
  EstimatedDeliveryDate,
  ShippingStatus,
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
  _BaseEntity,
  
  _Order
}
