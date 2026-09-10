@EndUserText.label: 'Kernseife: ATC Run State'
@AccessControl.authorizationCheck: #CHECK
@Metadata.ignorePropagatedAnnotations: true
define view entity ZKNSF_I_RUN_STATE
  as select from sycma_project as project
{

  key project.project_id                         as projectId,

      atc_run_series                             as runSeries,

      project_status                             as projectStatus,

      @ObjectModel.readOnly: true
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( '0' as sycm_aps_atc_state )          as runState,

      @ObjectModel.readOnly: true
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( '' as abap.char( 64 ) )              as runStateText,

      @ObjectModel.readOnly: true
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( 0 as sycm_aps_atc_started_on )       as startedOn,

      @ObjectModel.readOnly: true
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( '' as vdm_createdbyuserdescription ) as startedBy,

      @ObjectModel.readOnly: true
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( 0 as abap.int4  )                    as total,

      @ObjectModel.readOnly: true
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( 0 as sycm_aps_atc_failures )         as failed,

      @ObjectModel.readOnly: true
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( 0 as abap.int4  )                    as processed,

      @ObjectModel.readOnly: true
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      0                                          as criticalIndicator
}
