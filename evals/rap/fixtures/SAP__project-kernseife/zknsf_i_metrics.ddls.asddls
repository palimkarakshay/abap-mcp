@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Kernseife: Development Objects'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
  serviceQuality: #X,
  sizeCategory: #S,
  dataClass: #MIXED
}
@AbapCatalog.viewEnhancementCategory: [#NONE]
define view entity ZKNSF_I_METRICS
  as select from sycma_halstead as halstead
{

  key halstead.project_id               as projectId,
  key halstead.object                   as objectType,
  key halstead.obj_name                 as objectName,
      sum(halstead.halstead_difficulty) as difficulty,
      sum(halstead.number_of_changes)   as numberOfChanges
}
group by
  halstead.project_id,
  halstead.object,
  halstead.obj_name;
