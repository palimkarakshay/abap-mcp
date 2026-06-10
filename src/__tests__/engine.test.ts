import { describe, expect, it } from "vitest";

import { inferFilename, MAX_FILE_CHARS, runAbaplint } from "../abap/engine.js";

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
