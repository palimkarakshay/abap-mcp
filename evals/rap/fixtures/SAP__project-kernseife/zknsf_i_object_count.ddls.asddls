@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Kernseife: Object Count'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
  serviceQuality: #X,
  sizeCategory: #S,
  dataClass: #MIXED
}
@AbapCatalog.viewEnhancementCategory: [#NONE]
define view entity ZKNSF_I_OBJECT_COUNT as select from ZKNSF_I_DEVELOPMENT_OBJECTS
{
  key projectId,
   count(*)              as objectCount
  
} group by projectId;
