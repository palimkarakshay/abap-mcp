@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Kernseife: Object Count'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
  serviceQuality: #X,
  sizeCategory: #S,
  dataClass: #MIXED
}
@AbapCatalog.viewEnhancementCategory: [#NONE]
define view entity ZKNSF_I_FINDING_COUNT as select from ZKNSF_I_FINDINGS
{
  key projectId,
   count(*)              as findingCount
  
} group by projectId;
