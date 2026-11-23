import { describe, expect, it } from "vitest";

import { runAbaplint, type AbapSource } from "../abap/engine.js";
import { FAE_RULE } from "../abap/fae.js";

// ZDEMO_T: key ID CHAR 10 (abapGit table XML, as abapGit serializes it).
const TABL_XML = `﻿<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_TABL" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DD02V><TABNAME>ZDEMO_T</TABNAME><DDLANGUAGE>E</DDLANGUAGE><TABCLASS>TRANSP</TABCLASS><DDTEXT>demo</DDTEXT><CONTFLAG>A</CONTFLAG><EXCLASS>1</EXCLASS></DD02V>
   <DD09L><TABNAME>ZDEMO_T</TABNAME><AS4LOCAL>A</AS4LOCAL><TABKAT>0</TABKAT><TABART>APPL0</TABART><BUFALLOW>N</BUFALLOW></DD09L>
   <DD03P_TABLE>
    <DD03P><FIELDNAME>ID</FIELDNAME><KEYFLAG>X</KEYFLAG><ADMINFIELD>0</ADMINFIELD><INTTYPE>C</INTTYPE><INTLEN>000020</INTLEN><NOTNULL>X</NOTNULL><DATATYPE>CHAR</DATATYPE><LENG>000010</LENG><MASK>  CHAR</MASK></DD03P>
    <DD03P><FIELDNAME>REF</FIELDNAME><ADMINFIELD>0</ADMINFIELD><INTTYPE>C</INTTYPE><INTLEN>000024</INTLEN><DATATYPE>CHAR</DATATYPE><LENG>000012</LENG><MASK>  CHAR</MASK></DD03P>
   </DD03P_TABLE>
  </asx:values>
 </asx:abap>
</abapGit>
`;

const plainClass = (rowDecl: string): AbapSource[] => [
  { filename: "zdemo_t.tabl.xml", source: TABL_XML },
  {
    filename: "zcl_fae_demo.clas.abap",
    source: `CLASS zcl_fae_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.

CLASS zcl_fae_demo IMPLEMENTATION.
  METHOD run.
    TYPES: BEGIN OF ty_row,
             key ${rowDecl},
           END OF ty_row.
    DATA lt_keys TYPE STANDARD TABLE OF ty_row WITH EMPTY KEY.
    IF lt_keys IS INITIAL.
      RETURN.
    ENDIF.
    SELECT id FROM zdemo_t FOR ALL ENTRIES IN @lt_keys
      WHERE id = @lt_keys-key INTO TABLE @DATA(lt_hit).
  ENDMETHOD.
ENDCLASS.
`,
  },
];

// RAP: a validation reads a root view whose RefId comes from REF (CHAR 12) and looks it up against ID (CHAR 10).
const rapPool = (column: "id" | "ref"): AbapSource[] => [
  { filename: "zdemo_t.tabl.xml", source: TABL_XML },
  {
    filename: "zr_demo.ddls.asddls",
    source: "define root view entity ZR_DEMO as select from zdemo_t {\n  key id as Id,\n  ref as RefId\n}\n",
  },
  {
    filename: "zr_demo.bdef.asbdef",
    source:
      "managed implementation in class zbp_r_demo unique;\n\ndefine behavior for ZR_DEMO alias Demo\n" +
      "persistent table zdemo_t\nlock master\n{\n  create;\n  validation checkRef on save { create; }\n}\n",
  },
  {
    filename: "zbp_r_demo.clas.abap",
    source:
      "CLASS zbp_r_demo DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF zr_demo.\nENDCLASS.\n\n" +
      "CLASS zbp_r_demo IMPLEMENTATION.\nENDCLASS.\n",
  },
  {
    filename: "zbp_r_demo.clas.locals_imp.abap",
    source: `CLASS lhc_demo DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS checkref FOR VALIDATE ON SAVE
      IMPORTING keys FOR Demo~checkRef.
ENDCLASS.

CLASS lhc_demo IMPLEMENTATION.
  METHOD checkref.
    READ ENTITIES OF zr_demo IN LOCAL MODE ENTITY Demo ALL FIELDS WITH CORRESPONDING #( keys ) RESULT DATA(lt_d).
    IF lt_d IS INITIAL.
      RETURN.
    ENDIF.
    SELECT ${column} FROM zdemo_t FOR ALL ENTRIES IN @lt_d
      WHERE ${column} = @lt_d-RefId INTO TABLE @DATA(lt_hit).
  ENDMETHOD.
ENDCLASS.
`,
  },
];

const fae = (files: AbapSource[]) =>
  runAbaplint(files, { version: "Cloud", preset: "full" }).findings.filter((f) => f.rule === FAE_RULE);

describe("FOR ALL ENTRIES type check (sql/FAE001)", () => {
  it("flags a CHAR 12 component compared with a CHAR 10 column (typed local itab)", () => {
    const hits = fae(plainClass("TYPE c LENGTH 12"));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("id is CHAR 10 but lt_keys-key is CHAR 12");
    expect(hits[0]!.severity).toBe("Error");
    expect(hits[0]!.file).toBe("zcl_fae_demo.clas.abap");
  });

  it("is silent when the types match", () => {
    expect(fae(plainClass("TYPE c LENGTH 10"))).toEqual([]);
    expect(fae(plainClass("TYPE zdemo_t-id"))).toEqual([]);
  });

  it("types a RAP READ ENTITIES result through the CDS view (abaplint gives RAP handlers no scope)", () => {
    const hits = fae(rapPool("id"));
    expect(hits).toHaveLength(1);
    expect(hits[0]!.message).toContain("id is CHAR 10 but lt_d-RefId is CHAR 12");
    expect(hits[0]!.file).toBe("zbp_r_demo.clas.locals_imp.abap");
  });

  it("is silent on the RAP path when the column matches", () => {
    expect(fae(rapPool("ref"))).toEqual([]);
  });

  it("never guesses: an unknown table or itab gives no finding", () => {
    const noTable = plainClass("TYPE c LENGTH 12").filter((f) => !f.filename.endsWith(".tabl.xml"));
    expect(fae(noTable)).toEqual([]);
    const noBdef = rapPool("id").filter((f) => !f.filename.endsWith(".asbdef") && !f.filename.endsWith(".asddls"));
    expect(fae(noBdef)).toEqual([]);
  });

  it("can be switched off like any rule", () => {
    const files = plainClass("TYPE c LENGTH 12");
    const off = runAbaplint(files, { version: "Cloud", preset: "full", rules: { [FAE_RULE]: false } });
    expect(off.findings.filter((f) => f.rule === FAE_RULE)).toEqual([]);
  });
});

describe("sql/FAE001 in the rule catalog", () => {
  it("is explained and listed like an abaplint rule", async () => {
    const { explainRule, listRules } = await import("../abap/rules.js");
    const d = explainRule("sql/fae001");
    expect(d.key).toBe(FAE_RULE);
    expect(d.docsUrl).toContain("help.sap.com");
    expect(listRules("for all entries").map((r) => r.key)).toContain(FAE_RULE);
  });
});
