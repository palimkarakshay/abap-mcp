@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Kernseife: Project'
@Metadata.ignorePropagatedAnnotations: true
define root view entity ZKNSF_I_PROJECTS
  as select from    sycm_aps_c_project           as projects
    left outer join sycm_aps_i_atc_result_latest as latest on latest.project_id = projects.project_id
    left outer join tadir                        as SY     on  SY.pgmid  = 'HEAD'
                                                           and SY.object = 'SYST'

  association [0..1] to ZKNSF_I_OBJECT_COUNT        as _objectCount        on _objectCount.projectId = $projection.projectId
  association [0..1] to ZKNSF_I_FINDING_COUNT       as _findingCount       on _findingCount.projectId = $projection.projectId
  association [0..*] to ZKNSF_I_DEVELOPMENT_OBJECTS as _developmentObjects on _developmentObjects.projectId = $projection.projectId
{
  key projects.project_id                as projectId,
      projects.description,

      latest.display_id                  as runId,

      SY.srcsystem                       as systemId,

      projects.project_status            as status,
      projects._project_status_text.text as statusDescription,
      projects.project_status_crit       as statusCriticality,


      projects.atc_run_series            as runSeries,
      projects.atc_run_series_refs       as runSeriesReferences,
      

      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( '0' as sycm_aps_atc_state )          as runState,


      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( '' as abap.char( 64 ) )              as runStateText,


      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( 0 as sycm_aps_atc_started_on )       as startedOn,


      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( '' as vdm_createdbyuserdescription ) as startedBy,


      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( 0 as abap.int4  )                    as total,

      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( 0 as sycm_aps_atc_failures )         as failed,

      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      cast( 0 as abap.int4  )                    as processed,

 
      @ObjectModel.virtualElement
      @ObjectModel.virtualElementCalculatedBy: 'ABAP:ZKNSF_CL_ATC_RUN_SADL'
      0                                          as criticalIndicator,
      
      _objectCount.objectCount           as totalObjectCount,
      _findingCount.findingCount         as findingCount,
      _developmentObjects


}
where
      projects.project_type  = 'CHECKV'
  and projects.check_variant = 'ZKNSF_SCORING';
