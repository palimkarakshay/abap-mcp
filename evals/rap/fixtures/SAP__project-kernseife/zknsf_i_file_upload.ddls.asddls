@EndUserText.label: 'Action Parameter for Uploading File'
define root abstract entity ZKNSF_I_FILE_UPLOAD
{
  // Dummy is a dummy field
  @UI.hidden        : true
  dummy             : abap_boolean;
  _StreamProperties : association [1] to ZKNSF_I_FILE_STREAM on 1 = 1;

}
