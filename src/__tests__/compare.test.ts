import { describe, expect, it } from "vitest";

import { compareAbap } from "../abap/compare.js";

const OPTS = { version: "v758", preset: "style" } as const;

const OLD_REPORT = `REPORT zcmp.
DATA foo TYPE i.
IF foo = 1.
ENDIF.
WRITE: / 'hi'.
`;

const NEW_CLASS = `CLASS zcl_cmp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS get RETURNING VALUE(rv) TYPE string.
ENDCLASS.
CLASS zcl_cmp IMPLEMENTATION.
  METHOD get.
    rv = 'hi'.
  ENDMETHOD.
ENDCLASS.
`;

describe("compareAbap", () => {
  it("reports improvement when a WRITE report becomes a clean class", () => {
    const report = compareAbap([{ source: OLD_REPORT }], [{ source: NEW_CLASS }], OPTS);
    expect(report.before.cloudBlockerCount).toBeGreaterThan(0);
    expect(report.after.cloudBlockerCount).toBe(0);
    expect(report.after.score).toBe(100);
    expect(report.after.grade).toBe("A");
    expect(report.resolved.length).toBeGreaterThan(0);
    expect(report.outlineChanges.classesAdded).toContain("zcl_cmp");
  });

  it("is a fixed point on identical sides", () => {
    const report = compareAbap([{ source: OLD_REPORT }], [{ source: OLD_REPORT }], OPTS);
    expect(report.resolved).toEqual([]);
    expect(report.introduced).toEqual([]);
    expect(report.unchangedCount).toBe(report.before.findingCount);
    expect(report.before).toEqual(report.after);
  });

  it("matches findings by content, not line numbers — moved code is not noise", () => {
    // Same statements, shifted two lines down by comments: every finding
    // moves, none may count as resolved or introduced.
    const shifted = `* moved\n* down\n${OLD_REPORT}`;
    const report = compareAbap([{ source: OLD_REPORT }], [{ source: shifted }], OPTS);
    expect(report.resolved).toEqual([]);
    expect(report.introduced).toEqual([]);
    expect(report.unchangedCount).toBeGreaterThan(0);
  });

  it("flags regressions as introduced findings and rising blockers", () => {
    const worse = OLD_REPORT + "CALL SCREEN 100.\n";
    const report = compareAbap([{ source: OLD_REPORT }], [{ source: worse }], {
      ...OPTS,
      preset: "syntax-only",
      version: "Cloud",
    });
    expect(report.introduced.length).toBeGreaterThan(0);
    expect(report.after.cloudBlockerCount).toBeGreaterThan(report.before.cloudBlockerCount);
  });

  it("reports structural method changes as class.method", () => {
    const after = `CLASS zcl_cmp DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS get RETURNING VALUE(rv) TYPE string.
    METHODS put IMPORTING iv TYPE string.
ENDCLASS.
CLASS zcl_cmp IMPLEMENTATION.
  METHOD get.
    rv = 'hi'.
  ENDMETHOD.
  METHOD put.
  ENDMETHOD.
ENDCLASS.
`;
    const report = compareAbap([{ source: NEW_CLASS }], [{ source: after }], OPTS);
    expect(report.outlineChanges.methodsAdded).toContain("zcl_cmp.put");
    expect(report.outlineChanges.methodsRemoved).toEqual([]);
  });

  it("carries the honest match note", () => {
    const report = compareAbap([{ source: NEW_CLASS }], [{ source: NEW_CLASS }], OPTS);
    expect(report.matchNote).toMatch(/not line numbers/i);
    expect(report.matchNote).toMatch(/functionally\s+equivalent/i);
  });
});
