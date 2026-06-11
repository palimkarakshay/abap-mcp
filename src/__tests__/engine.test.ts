import { describe, expect, it } from "vitest";

import { extractObjectReferences, inferFilename, MAX_FILE_CHARS, runAbaplint } from "../abap/engine.js";
import { listRules } from "../abap/rules.js";

describe("inferFilename", () => {
  it("infers a class filename from CLASS … DEFINITION", () => {
    expect(inferFilename("CLASS zcl_foo DEFINITION PUBLIC.\nENDCLASS.")).toBe("zcl_foo.clas.abap");
  });

  it("infers an interface filename", () => {
    expect(inferFilename("INTERFACE zif_foo PUBLIC.\nENDINTERFACE.")).toBe("zif_foo.intf.abap");
  });

  it("infers a program filename from REPORT", () => {
    expect(inferFilename("REPORT zfoo.\nWRITE 'x'.")).toBe("zfoo.prog.abap");
  });

  it("infers CDS from define view", () => {
    expect(inferFilename("define root view entity ZR_X as select from zx { key a as A }")).toBe(
      "zsnippet.ddls.asddls",
    );
  });

  it("falls back to a program for bare statements", () => {
    expect(inferFilename("DATA foo TYPE i.")).toBe("zsnippet.prog.abap");
  });

  it("accepts a valid explicit filename and lowercases it", () => {
    expect(inferFilename("whatever", "ZCL_X.clas.abap")).toBe("zcl_x.clas.abap");
  });

  it("rejects a non-abapGit filename", () => {
    expect(() => inferFilename("x", "../etc/passwd")).toThrow(/abapGit-style/);
  });
});

describe("runAbaplint", () => {
  it("finds style issues with the default preset", () => {
    const { findings } = runAbaplint(
      [{ source: "REPORT ztest.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF." }],
      { version: "v758", preset: "style" },
    );
    expect(findings.length).toBeGreaterThan(0);
    const f = findings[0]!;
    expect(f.rule).toBeTruthy();
    expect(f.line).toBeGreaterThan(0);
    expect(f.docsUrl).toContain("rules.abaplint.org");
    expect(f.excerpt.length).toBeGreaterThan(0);
  });

  it("syntax-only preset is quiet on valid classic code", () => {
    const { findings } = runAbaplint(
      [{ source: "REPORT ztest.\nWRITE 'hello'." }],
      { version: "v758", preset: "syntax-only" },
    );
    expect(findings).toEqual([]);
  });

  it("respects rule overrides", () => {
    const clean = runAbaplint(
      [{ source: "REPORT ztest.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF." }],
      { version: "v758", preset: "style", rules: { empty_structure: false, implicit_start_of_selection: false } },
    );
    const dirty = runAbaplint(
      [{ source: "REPORT ztest.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF." }],
      { version: "v758", preset: "style" },
    );
    expect(clean.findings.length).toBeLessThan(dirty.findings.length);
  });

  it("focus reduces findings to exactly the tag-member subset", () => {
    const SRC = "REPORT ztest.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF.";
    const all = runAbaplint([{ source: SRC }], { version: "v758", preset: "style" });
    const focused = runAbaplint([{ source: SRC }], { version: "v758", preset: "style", focus: "Performance" });
    const perfKeys = new Set(listRules(undefined, "Performance").map((r) => r.key));
    // Same code, same preset: the focused run must surface exactly the
    // Performance-tagged findings of the unfocused run, nothing else.
    expect(focused.findings.map((f) => f.rule).sort()).toEqual(
      all.findings.filter((f) => perfKeys.has(f.rule)).map((f) => f.rule).sort(),
    );
    expect(focused.findings.length).toBeLessThan(all.findings.length);
  });

  it("focus keeps parser errors visible — focused findings on broken code would be garbage", () => {
    const broken = runAbaplint([{ source: "REPORT zb.\nNOT ABAP???" }], {
      version: "v758",
      preset: "style",
      focus: "Performance",
    });
    expect(broken.findings.some((f) => f.rule === "parser_error")).toBe(true);
  });

  it("explicit rule overrides win over a focus filter", () => {
    const SRC = "REPORT ztest.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF.";
    const reEnabled = runAbaplint([{ source: SRC }], {
      version: "v758",
      preset: "style",
      focus: "Performance",
      rules: { empty_structure: true },
    });
    expect(reEnabled.findings.some((f) => f.rule === "empty_structure")).toBe(true);
  });

  it("rejects oversized files", () => {
    expect(() =>
      runAbaplint([{ source: "x".repeat(MAX_FILE_CHARS + 1) }], { version: "v758", preset: "style" }),
    ).toThrow(/exceeds/);
  });

  it("rejects an empty file list", () => {
    expect(() => runAbaplint([], { version: "v758", preset: "style" })).toThrow(/at least one/i);
  });

  // Codex review P2: identical inferred names silently overwrote each other.
  it("keeps multiple unnamed snippets distinct instead of dropping them", () => {
    const result = runAbaplint(
      [{ source: "DATA a TYPE i." }, { source: "DATA b TYPE x." }],
      { version: "v758", preset: "syntax-only" },
    );
    expect(result.fileCount).toBe(2);
    // both files must actually be in the registry: break the second one and
    // its finding must surface
    const broken = runAbaplint(
      [{ source: "DATA a TYPE i." }, { source: "NOT ABAP ???" }],
      { version: "v758", preset: "syntax-only" },
    );
    expect(broken.findings.some((f) => f.file.startsWith("zsnippet2."))).toBe(true);
  });

  it("rejects two files that declare the same object", () => {
    const clas = "CLASS zcl_dup DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_dup IMPLEMENTATION.\nENDCLASS.";
    expect(() =>
      runAbaplint([{ source: clas }, { source: clas }], { version: "v758", preset: "syntax-only" }),
    ).toThrow(/Duplicate filename/);
  });
});

describe("extractObjectReferences", () => {
  const SRC = `REPORT zrefs.
SELECT * FROM mara INTO TABLE @DATA(lt).
SELECT SINGLE * FROM kna1 AS k INNER JOIN makt AS m ON k~kunnr = m~matnr INTO @DATA(ls).
INSERT vbak FROM @ls_vbak.
UPDATE lfa1 SET name1 = 'x'.
DELETE FROM t001 WHERE bukrs = '1000'.
MODIFY likp FROM @ls.
CALL FUNCTION 'BAPI_MATERIAL_GET_DETAIL'.
`;

  it("extracts DB tables from every SQL statement kind and FROM/join clauses", () => {
    const refs = extractObjectReferences([{ source: SRC }]);
    const tables = refs.filter((r) => r.objectType === "TABL").map((r) => r.name).sort();
    expect(tables).toEqual(["KNA1", "LFA1", "LIKP", "MAKT", "MARA", "T001", "VBAK"]);
  });

  it("extracts function-module names from CALL FUNCTION", () => {
    const refs = extractObjectReferences([{ source: SRC }]);
    const fms = refs.filter((r) => r.objectType === "FUNC").map((r) => r.name);
    expect(fms).toContain("BAPI_MATERIAL_GET_DETAIL");
  });

  it("returns no references for code without DB access or function calls", () => {
    const refs = extractObjectReferences([
      { source: "CLASS zcl_x DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_x IMPLEMENTATION.\nENDCLASS." },
    ]);
    expect(refs).toEqual([]);
  });

  it("carries a source location for each reference", () => {
    const refs = extractObjectReferences([{ source: SRC }]);
    const mara = refs.find((r) => r.name === "MARA");
    expect(mara!.line).toBe(2);
    expect(mara!.kind).toBe("db-access");
  });
});
