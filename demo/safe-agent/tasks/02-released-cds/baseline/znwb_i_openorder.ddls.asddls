@AccessControl.authorizationCheck: #CHECK
@EndUserText.label: 'Open sales orders (reads classic VBAK)'
define view entity ZNWB_I_OpenOrder
  as select from vbak
{
  key vbeln as SalesOrder,
      kunnr as Customer,
      netwr as NetAmount
}
