@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Kernseife: Development Objects'
@Metadata.ignorePropagatedAnnotations: true
@ObjectModel.usageType:{
  serviceQuality: #X,
  sizeCategory: #S,
  dataClass: #MIXED
}
@AbapCatalog.viewEnhancementCategory: [#NONE]
define view entity ZKNSF_I_DEVELOPMENT_OBJECTS
  as select from ZKNSF_I_ATC_FINDINGS         as fnd
    inner join   sycm_aps_i_atc_result_latest as project on project.display_id = fnd.displayId
  association [0..*] to ZKNSF_I_FINDINGS as _findings on  $projection.objectType = _findings.objectType
                                                      and $projection.objectName = _findings.objectName

  association [0..*] to sycm_aps_i_usage as _usages   on  $projection.projectId  = _usages.project_id
                                                      and $projection.objectType = _usages.obj_type
                                                      and $projection.objectName = _usages.obj_name
  association [0..1] to ZKNSF_I_METRICS  as _metrics  on  $projection.projectId  = _metrics.projectId
                                                      and $projection.objectType = _metrics.objectType
                                                      and $projection.objectName = _metrics.objectName

{
  key   project.project_id    as projectId,
  key   fnd.displayId         as runId,
  key   fnd.objectType        as objectType,
  key   fnd.objectName        as objectName,
        fnd.subType           as subType,
        fnd.devClass          as devClass,
        fnd.softwareComponent as softwareComponent,
        fnd.messageId         as languageVersion,
        fnd.contactPerson     as contactPerson,
        _findings,
        _usages,
        _metrics


}
where
     fnd.messageId = '5'
  or fnd.messageId = '2'
  or fnd.messageId = 'X';
