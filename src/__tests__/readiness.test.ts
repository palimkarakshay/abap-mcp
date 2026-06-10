import { describe, expect, it } from "vitest";

import { checkCloudReadiness } from "../abap/readiness.js";

const CLASSIC_REPORT = `REPORT zclassic.
DATA gv_matnr TYPE c LENGTH 18.
SELECT-OPTIONS s_matnr FOR gv_matnr.
START-OF-SELECTION.
  WRITE: / 'hello'.
  CALL SCREEN 100.
`;

const CLOUD_CLASS = `CLASS zcl_cloud_ok DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS calc IMPORTING iv_a TYPE i RETURNING VALUE(rv_b) TYPE i.
ENDCLASS.
CLASS zcl_cloud_ok IMPLEMENTATION.
  METHOD calc.
    rv_b = iv_a + 1.
  ENDMETHOD.
ENDCLASS.
`;

describe("checkCloudReadiness", () => {
  it("flags classic report statements as cloud blockers with categories", () => {
    const report = checkCloudReadiness([{ source: CLASSIC_REPORT }]);
    expect(report.cloudBlockerCount).toBeGreaterThan(0);
    expect(report.verdict).not.toBe("ready");
    expect(report.score).toBeLessThan(100);
    const categories = report.categories.map((c) => c.category);
    expect(categories).toContain("list-output");
    expect(categories).toContain("dynpro");
    // valid v758 code: nothing is broken at the baseline
    expect(report.brokenAtBaseline).toEqual([]);
  });

  it("declares a clean cloud-ready class ready with score 100", () => {
    const report = checkCloudReadiness([{ source: CLOUD_CLASS }]);
    expect(report.cloudBlockerCount).toBe(0);
    expect(report.verdict).toBe("ready");
    expect(report.score).toBe(100);
  });

  it("separates code broken at the baseline from migration work", () => {
    const broken = "REPORT zbroken.\nTHIS IS NOT ABAP AT ALL???\n";
    const report = checkCloudReadiness([{ source: broken }]);
    expect(report.brokenAtBaseline.length).toBeGreaterThan(0);
  });

  it("always carries the honest scope note", () => {
    const report = checkCloudReadiness([{ source: CLOUD_CLASS }]);
    expect(report.scopeNote).toMatch(/released-API/i);
    expect(report.scopeNote).toMatch(/not.*certification/i);
  });

  // A class wrapper so the SELECT is the only thing under test (no REPORT
  // statement, which is itself a cloud blocker).
  const classWithSelect = (table: string): string =>
    `CLASS zcl_sel DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_sel IMPLEMENTATION.
  METHOD run.
    SELECT * FROM ${table} INTO TABLE @DATA(lt).
  ENDMETHOD.
ENDCLASS.
`;

  it("flags direct non-released table access in releasedApiFindings with a successor", () => {
    const report = checkCloudReadiness([{ source: classWithSelect("mara") }]);
    const mara = report.releasedApiFindings.find((f) => f.object === "MARA");
    expect(mara).toBeDefined();
    expect(mara!.state).toBe("not-released");
    expect(mara!.objectType).toBe("TABL");
    expect(mara!.successor).toBe("I_Product");
    expect(report.releasedApiSnapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("keeps releasedApiFindings separate from the parser-level score", () => {
    // Selecting from a non-released table is NOT a parser-level cloud blocker
    // (the SELECT parses fine at Cloud), so the blocker count stays 0 even
    // though the released-API cross-check raises a finding.
    const report = checkCloudReadiness([{ source: classWithSelect("mara") }]);
    expect(report.cloudBlockerCount).toBe(0);
    expect(report.score).toBe(100);
    expect(report.releasedApiFindings.length).toBeGreaterThan(0);
  });

  it("does not flag access to a released CDS view", () => {
    const report = checkCloudReadiness([{ source: classWithSelect("i_product") }]);
    expect(report.releasedApiFindings.find((f) => f.object === "I_PRODUCT")).toBeUndefined();
  });
});
