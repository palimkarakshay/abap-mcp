@EndUserText.label: 'Change documents'
@ObjectModel.query.implementedBy: 'ABAP:ZREUSECL_GET_CHANGE_DOCS_002'
define custom entity ZREUSEI_CDREDADD_002

{

      //      //  key key_element_name : key_element_type;
      //      @EndUserText.label : 'Object Class'
      //      @UI                : {
      //                lineItem :       [ { position: 10, importance: #HIGH } ],
      //                identification: [ { position: 10 } ],
      //                selectionField: [ { position: 10 } ]
      //           }
      //  key objectclas         : abap.char(15);
      //      @EndUserText.label : 'Object value'
      //      @UI                : {
      //          lineItem       : [ { position: 10, importance: #HIGH } ],
      //          identification : [ { position: 10 } ],
      //          selectionField : [{ position: 10 }]
      //      }
      @UI.hidden         : true
  key objectid           : abap.char(90);
      //      @EndUserText.label  : 'Object value'
      //      objectid_db         : abap.char(90);
      @EndUserText.label : 'Change Number of Document'
      //      @UI                : {
      //               lineItem  :       [ { position: 20, importance: #HIGH } ],
      //               identification: [ { position: 20 } ]
      //
      //          }
      @UI.hidden         : true
  key changenr           : abap.char(10);

      @EndUserText.label : 'Change document creation: Table name  '
      //      @UI                : {
      //           lineItem      :       [ { position: 30, importance: #HIGH } ],
      //           identification: [ { position: 30 } ]
      //
      //      }
      @UI.hidden         : true
  key tabname            : abap.char(30);

      //tabname
      //tabkey
      @EndUserText.label : 'Key of Modified Table Row '
      //      @UI                : {
      //        lineItem         :       [ { position: 40, importance: #HIGH } ],
      //        identification   : [ { position: 40 } ]
      //        ,
      //                selectionField: [ { position: 40 } ]
      //      }
      @UI.hidden         : true
  key tabkey             : abap.char(70);

      //set importance to #LOW to hide the field in the default view.
      //Cannot be hidden completly using @ui.hidden

      @UI                : {
               lineItem  :       [ { position: 50, importance: #LOW } ],
               identification: [ { position: 50 , importance: #LOW } ]

          }

      @EndUserText.label : 'Field Name '
  key fname              : abap.char(30);

      @EndUserText.label : 'Object Description'
      objecttxt          : abap.char(350);
      @EndUserText.label : 'Changed By'
      @UI                : {
      lineItem           :       [ { position: 160, importance: #HIGH } ],
      identification     : [ { position: 160 } ]

      }
      username           : abap.char(12);
      @EndUserText.label : 'User name of the person resp. in chg doc'
      username_db        : abap.char(12);
      utimestamp         : timestamp;
      @EndUserText.label : 'Creation date of the change document'
      udate              : abap.dats(8);
      @EndUserText.label : 'Creation date of the change document '
      udate_db           : abap.dats(8);
      @EndUserText.label : ' Time changed'
      utime              : abap.tims(6);
      @EndUserText.label : 'Time changed'
      utime_db           : abap.tims(6);
      @EndUserText.label : 'Transaction in which a change was made'
      tcode              : abap.char(20);
      @EndUserText.label : 'Application Object '
      applname           : abap.char(40);
      @EndUserText.label : 'Application Type'
      appltype           : abap.char(2);
      @EndUserText.label : 'Change document creation: Table name db '
      tabname_db         : abap.char(30);
      @EndUserText.label : 'Key of Modified Table Row '
      tabkey_db          : abap.char(70);
      @EndUserText.label : 'Table key length'
      keylen             : abap.numc(4);
      @EndUserText.label : 'Type of Change'
      chngind            : abap.char(1);
      //      @EndUserText.label : 'Field Name '
      //      fname              : abap.char(30);
      @EndUserText.label : 'Field Name '
      @UI.hidden         : true
      fname_db           : abap.char(30);
      //We use the explanatory text as field name
      //as it is done in the V2 reuse component
      @EndUserText.label : 'Field Name'
      @UI                : {
         lineItem        :       [ { position: 50, importance: #HIGH } ],
         identification  : [ { position: 50 } ]

      }
      ftext              : abap.char(60);
      @EndUserText.label : 'Create change document: Text type'
      textart            : abap.char(4);
      @EndUserText.label : 'Language Key'
      sprache            : spras;
      @EndUserText.label : 'Text change flag "X"'
      text_case          : abap.char(1);
      @EndUserText.label : 'Output length of the old and new value'
      outlen             : abap.numc(4);
      @EndUserText.label : 'Old value'
      @UI                : {
              lineItem   :       [ { position: 150, importance: #HIGH } ],
              identification: [ { position: 150 } ]
         }
      f_old              : abap.char(254);
      @EndUserText.label : 'Old contents of changed field '
      f_old_db           : abap.char(254);
      @EndUserText.label : 'New Value'

      @UI                : {
              lineItem   :       [ { position: 140, importance: #HIGH } ],
              identification: [ { position: 140 } ]
         }
      f_new              : abap.char(254);
      @EndUserText.label : 'New Field Content of Changed Field'
      f_new_db           : abap.char(254);
      //      @EndUserText.label  : 'string  Old Extended Value (Long)'
      //      value_old           : abap.string;
      //      @EndUserText.label  : 'Old Extended Value (Long) '
      //      value_old_db        : abap.string;
      //      @EndUserText.label  : 'New Extended Value (Long) '
      //      value_new           : abap.string;
      //      @EndUserText.label  : 'New Extended Value (Long'
      //      value_new_db        : abap.string;
      //      @EndUserText.label  : 'Old Chg Doc Value for RAWSTRING Var'
      //      value_rawstr_old    : abap.rawstring;
      //      @EndUserText.label  : 'Old Chg Doc Value for RAWSTRING Var'
      //      value_rawstr_old_db : abap.rawstring;
      //      @EndUserText.label  : 'New Chg Doc Value for RAWSTRING Var'
      //      value_rawstr_new    : abap.rawstring;
      //      @EndUserText.label  : 'New Chg Doc Value for RAWSTRING Var'
      //      value_rawstr_new_db : abap.rawstring;
      @EndUserText.label : 'Old Extended Value (Short)'
      value_shstr_old    : abap.sstring(255);
      @EndUserText.label : 'Old Extended Value (Short)'
      value_shstr_old_db : abap.sstring(255);
      @EndUserText.label : 'New Extended Value (Short)'
      value_shstr_new    : abap.sstring(255);
      @EndUserText.label : 'New Extended Value (Short)'
      value_shstr_new_db : abap.sstring(255);
      @EndUserText.label : 'KEYGUID for Connection to CDPOS_UID'
      keyguid            : abap.char(32);
      @EndUserText.label : 'Key of Modified Table Row'
      tabkey254          : abap.char(254);
      @EndUserText.label : ''
      tabkey254_db       : abap.char(254);
      @EndUserText.label : 'Table key length'
      ext_keylen         : abap.numc(4);
      @EndUserText.label : 'KEYGUID for Link to CDPOS_STR'
      keyguid_str        : abap.char(32);
      @EndUserText.label : '3-Byte field'
      version            : char3;


}
