@EndUserText.label: 'File Stream Attachement'
define root abstract entity ZKNSF_I_FILE_STREAM
{
  @Semantics.largeObject.mimeType: 'mimeType'
  @Semantics.largeObject.fileName: 'fileName'
  @Semantics.largeObject.contentDispositionPreference: #INLINE
  @EndUserText.label: 'Select file'
  streamProperty : abap.rawstring(0);

  mimeType       : abap.char(128);

  fileName       : abap.char(128);
}
