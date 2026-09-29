@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Open sales orders (reads released I_SalesDocument)'
define view entity ZNWB_I_OpenOrder
  as select from I_SalesDocument
{
  key SalesDocument as SalesOrder,
      SoldToParty   as Customer,
      TotalNetAmount as NetAmount
}
