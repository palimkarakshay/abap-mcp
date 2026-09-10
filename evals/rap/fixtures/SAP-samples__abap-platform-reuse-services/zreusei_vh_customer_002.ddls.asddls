@ObjectModel.query.implementedBy: 'ABAP:ZREUSECL_VH_CUSTOMER_002'
@EndUserText.label: 'Value help for customer'
define custom entity ZREUSEI_VH_CUSTOMER_002
{
  key CustomerID  : abap.numc( 6 );
      FirstName   : abap.char( 40 );
      LastName    : abap.char( 40 );
      Title       : abap.char( 10 );
      Street      : abap.char( 60 );
      PostalCode  : abap.char( 10 );
      City        : abap.char( 40 );
      CountryCode : land1;
      PhoneNumber : abap.char( 30 );
      eMail       : abap.char( 125 );
}
