@AccessControl.authorizationCheck: #MANDATORY
@Metadata.allowExtensions: true
@ObjectModel.sapObjectNodeType.name: 'ZShippingRequest'
@EndUserText.label: '###GENERATED Core Data Service Entity'
@ObjectModel.semanticKey: [ 'ShippingRequestID' ]
define root view entity ZR_SHIPPINGREQUEST
  as select from ZSHIPPINGREQUEST as ShippingRequest
{
  key uuid as UUID,
  shipping_request_id as ShippingRequestID,
  order_reference as OrderReference,
  estimated_delivery_date as EstimatedDeliveryDate,
  shipping_status as ShippingStatus,
  @Semantics.user.createdBy: true
  local_created_by as LocalCreatedBy,
  @Semantics.systemDateTime.createdAt: true
  local_created_at as LocalCreatedAt,
  @Semantics.user.localInstanceLastChangedBy: true
  local_last_changed_by as LocalLastChangedBy,
  @Semantics.systemDateTime.localInstanceLastChangedAt: true
  local_last_changed_at as LocalLastChangedAt,
  @Semantics.systemDateTime.lastChangedAt: true
  last_changed_at as LastChangedAt
}
