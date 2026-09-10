Title: RAP - Abstract Behavior Definitions

URL Source: https://help.sap.com/docs/abap-cloud/abap-keyword/rap-abstract-behavior-definitions

Markdown Content:
ProductsExplore SAP
HomeABAP CloudABAP Keyword Documentation…RAP - BDL for Behavior DefinitionsRAP - Abstract Behavior Definitions
ABAP Keyword DocumentationEnglish
Provide feedback on our search

AI Answer
Search Scope
More



PDF
Favorite
Share

Table of Contents
	
ABAP - Keyword Documentation


	
ABAP Cloud Documentation Landscape
	
ABAP Dictionary (DDIC)
	
ABAP Core Data Services (ABAP CDS)
	
ABAP Programming Language
	
ABAP RAP Business Objects


	
RAP - Business Services (BS)
	
RAP - Behavior Definitions


	
RAP BDL - Syntax
	
RAP - BDL for Behavior Definitions


	
RAP - Managed and Unmanaged Behavior Definitions
	
RAP - Interface Behavior Definition
	
RAP - Projection Behavior Definitions
	
RAP - Abstract Behavior Definitions


	
RAP - Behavior Definition Header, Abstract BDEF
	
RAP - Entity Behavior Definition, Abstract BDEF
	
RAP - BDEF Extension
	
ABAP for RAP Business Objects
	
RAP Glossary
	
ABAP APIs
	
ABAP Release News
	
ABAP Glossary
	
ABAP Syntax Conventions
RAP - Abstract Behavior Definitions

RAP abstract behavior definitions are created using the behavior definition language RAP BDL in BDL source code.

A RAP abstract behavior definition mainly serves as typing mechanism for deep action or function parameters. Only a limited range of syntax elements is available, such as associations and type mapping. It is not possible to define any transactional behavior in an abstract behavior definition.

Related Information

How to use an abstract BDEF as input parameter for a RAP action or a RAP function in a managed or unmanaged RAP BO is described in topic RAP BDL - InputParameter.

How to use an abstract BDEF as output parameter for a RAP action or a RAP function in a managed or unmanaged RAP BO is described in topic RAP BDL - OutputParameter.

Abstract behavior definitions can be classified with the C0 contract for extensibility.

Example
Caution

The programs and program extracts presented in the ABAP Keyword Documentation are only syntax examples and are not intended for direct use in a production system environment. The source texts of the examples are primarily intended to provide a better explanation and visualization of the syntax and semantics of ABAP statements and not to solve concrete programming tasks. For production application programs, a dedicated solution should therefore always be worked out for each individual case. The example can use demo artifacts that are not released as APIs for use in ABAP for Cloud Development.

The following example shows an abstract BDEF with three nodes that is constructed as hierarchy.



abstract;
strict(2);
with hierarchy;
define behavior for DEMO_CDS_ABSTRACT_ROOT alias Root
{
  field ( suppress ) Dummy;
  deep mapping for DEMO_CDS_ABSTRACT_STRUC
  {
    char10 = char_10;
    Integer4 = integer_4;
    sub _itemStructure = struktur;
    sub _itemTable = tabelle;
  }
  association _itemTable;
  association _itemStructure;
}
define behavior for DEMO_CDS_ABSTRACT_ITEMSTRUCT alias ItemStructure
{
  field ( suppress ) Dummy, ToRoot;
  deep mapping for DEMO_ABSTRACT_ITEMSTRUCT
  {
    Char10 = char_10;
    Integer4 = integer_4;
  }
  association _parent;
}
define behavior for DEMO_CDS_ABSTRACT_ITEMTABLE alias ItemTable
{
  field ( suppress ) Dummy, ToRoot;
  deep mapping for DEMO_ABSTRACT_ITEMTABLE corresponding
  {
    Char10 = char_10;
    Integer4 = integer_4;
  }
  association _parent;
}


The managed BDEF DEMO_CDS_DEEP_PARAMETER uses the abstract BDEF as action parameter in three actions.



managed implementation in class bp_demo_cds_deep_parameter unique;
strict(2);
define behavior for DEMO_CDS_DEEP_PARAMETER
persistent table DEMO_BO_DEEP
lock master
authorization master ( none )
{
  create;
  update;
  delete;
    mapping for demo_bo_deep
    {
    RootBO = root;
    }
  field (readonly:update) RootBO;
// mapping: none
  action a2_from_flat              parameter DEMO_CDS_ABSTRACT_ROOT;
// mapping: structure
  action a2_from_deep       deep  parameter DEMO_CDS_ABSTRACT_ROOT;
 // mapping: table
  action a2_from_deep_table deep table
                                  parameter DEMO_CDS_ABSTRACT_ROOT;
//deep selective output parameter
  action a2_deep_result deep result selective [1]
    DEMO_CDS_ABSTRACT_ROOT;
}


The abstract BDEF is used as flat parameter, as structure, or as table, depending on the keywords used.

Usage as flat parameter in action a2_from_flat

Usage as structure in action a2_from_deep

Usage as table in action a2_from_deep_table

Was this page helpful?
Yes
No
Copyright
Disclaimer
Privacy Statement
Legal Disclosure
Trademark
Terms of Use
Cookie Preferences
Accessibility & Sustainability
Ask a Question about the SAP Help Portal
Find us on
Share

