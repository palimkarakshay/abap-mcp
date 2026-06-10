import { describe, expect, it } from "vitest";

import { formatAbap } from "../abap/formatter.js";
import { outlineAbap } from "../abap/outline.js";

describe("formatAbap", () => {
  it("uppercases keywords and indents", () => {
    const formatted = formatAbap("report ztest.\ndata foo type i.\nif foo = 1.\nwrite 'x'.\nendif.");
    expect(formatted).toContain("REPORT ztest.");
    expect(formatted).toContain("DATA foo TYPE i.");
    expect(formatted).toContain("  WRITE 'x'.");
  });

  it("refuses CDS sources", () => {
    expect(() => formatAbap("define root view entity ZR_X as select from zx { key a as A }")).toThrow(
      /ABAP sources only/,
    );
  });

  // Codex review P2: unparseable code must fail, not come back as "formatted".
  it("refuses source with structure errors instead of laundering them", () => {
    expect(() => formatAbap("REPORT zbad.\nDATA foo TYPE i.\nIF foo = 1.\nWRITE 'x'.")).toThrow(
      /does not parse cleanly/,
    );
  });
});

describe("outlineAbap", () => {
  const CLASS_SRC = `CLASS zcl_demo DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    INTERFACES if_oo_adt_classrun.
    METHODS calc IMPORTING iv_a TYPE i RETURNING VALUE(rv_b) TYPE i.
  PROTECTED SECTION.
    METHODS helper.
  PRIVATE SECTION.
    METHODS hidden.
    DATA mv_count TYPE i.
ENDCLASS.
CLASS zcl_demo IMPLEMENTATION.
  METHOD if_oo_adt_classrun~main. ENDMETHOD.
  METHOD calc. rv_b = iv_a + 1. ENDMETHOD.
  METHOD helper. ENDMETHOD.
  METHOD hidden. ENDMETHOD.
ENDCLASS.`;

  it("outlines a class with methods, visibility, interfaces and attributes", () => {
    const [outline] = outlineAbap([{ source: CLASS_SRC }]);
    expect(outline!.parseable).toBe(true);
    const cls = outline!.classes[0]!;
    expect(cls.name).toBe("zcl_demo");
    expect(cls.isFinal).toBe(true);
    expect(cls.interfaces).toContain("if_oo_adt_classrun");
    const byName = Object.fromEntries(cls.methods.map((m) => [m.name, m.visibility]));
    expect(byName["calc"]).toBe("public");
    expect(byName["helper"]).toBe("protected");
    expect(byName["hidden"]).toBe("private");
    expect(cls.attributes).toContain("mv_count");
  });

  it("reports legacy FORMs", () => {
    const [outline] = outlineAbap([
      { source: "REPORT zlegacy.\nPERFORM main.\nFORM main.\n  WRITE 'x'.\nENDFORM." },
    ]);
    expect(outline!.forms).toContain("main");
  });

  it("yields an empty outline for CDS artifacts", () => {
    const [outline] = outlineAbap([
      { source: "define root view entity ZR_X as select from zx { key a as A }" },
    ]);
    expect(outline!.classes).toEqual([]);
  });
});
