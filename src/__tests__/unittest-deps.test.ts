/**
 * scaffoldAbapUnit + getObjectDependencies engine invariants, plus the
 * rewrite-recipe surfacing added to readiness/plan output.
 */
import { describe, expect, it } from "vitest";

import { getObjectDependencies } from "../abap/deps.js";
import { planCloudMigration } from "../abap/plan.js";
import { checkCloudReadiness, rewriteRecipeFor } from "../abap/readiness.js";
import { scaffoldAbapUnit } from "../abap/unittest.js";

const TRAVEL_CLASS = {
  filename: "zcl_travel.clas.abap",
  source:
    "CLASS zcl_travel DEFINITION PUBLIC FINAL CREATE PUBLIC.\n" +
    " PUBLIC SECTION.\n" +
    " METHODS get_total RETURNING VALUE(rv) TYPE i.\n" +
    " METHODS set_total IMPORTING iv TYPE i.\n" +
    " PRIVATE SECTION.\n" +
    " METHODS internal.\n" +
    "ENDCLASS.\n" +
    "CLASS zcl_travel IMPLEMENTATION.\n" +
    " METHOD get_total.\n rv = 1.\n ENDMETHOD.\n" +
    " METHOD set_total.\n ENDMETHOD.\n" +
    " METHOD internal.\n ENDMETHOD.\n" +
    "ENDCLASS.",
};

describe("scaffoldAbapUnit", () => {
  it("generates one skeleton test method per public method, round-trip clean", () => {
    const result = scaffoldAbapUnit([TRAVEL_CLASS]);
    expect(result.files.length).toBe(1);
    const content = result.files[0]!.content;
    expect(result.files[0]!.filename).toBe("zcl_travel.clas.testclasses.abap");
    expect(content).toContain("METHODS get_total FOR TESTING.");
    expect(content).toContain("METHODS set_total FOR TESTING.");
    expect(content).not.toContain("METHODS internal FOR TESTING."); // private stays untested
    expect(content).toContain("RISK LEVEL HARMLESS DURATION SHORT");
    expect(content).toContain("cut = NEW #( ).");
    // Failing-by-default: a generated-but-unfilled test can never pass.
    expect((content.match(/cl_abap_unit_assert=>fail/g) ?? []).length).toBe(2);
    expect(result.validationIssues).toEqual([]);
  });

  it("skips interfaces and programs with honest reasons", () => {
    const result = scaffoldAbapUnit([
      TRAVEL_CLASS,
      { filename: "zif_x.intf.abap", source: "INTERFACE zif_x PUBLIC.\nENDINTERFACE." },
      { filename: "zold.prog.abap", source: "REPORT zold.\nWRITE 'x'." },
    ]);
    expect(result.files.length).toBe(1);
    expect(result.skipped.length).toBe(2);
    for (const s of result.skipped) expect(s.reason.length).toBeGreaterThan(10);
  });

  it("throws a structured error when nothing is scaffoldable", () => {
    expect(() =>
      scaffoldAbapUnit([{ filename: "zold.prog.abap", source: "REPORT zold." }]),
    ).toThrowError(/No global class/);
  });
});

describe("getObjectDependencies", () => {
  const CALLER = {
    filename: "zcl_caller.clas.abap",
    source:
      "CLASS zcl_caller DEFINITION PUBLIC FINAL CREATE PUBLIC.\n" +
      " PUBLIC SECTION.\n METHODS run.\nENDCLASS.\n" +
      "CLASS zcl_caller IMPLEMENTATION.\n METHOD run.\n" +
      " DATA(lo) = NEW zcl_travel( ).\n" +
      " SELECT SINGLE matnr FROM mara INTO @DATA(lv).\n" +
      " ENDMETHOD.\nENDCLASS.",
  };

  it("builds tiered edges: db-access with released state + textual class reference", () => {
    const g = getObjectDependencies([CALLER, TRAVEL_CLASS]);
    expect(g.edges).toContainEqual({ from: "ZCL_CALLER", to: "MARA", kind: "db-access" });
    expect(g.edges).toContainEqual({ from: "ZCL_CALLER", to: "ZCL_TRAVEL", kind: "references-textual" });
    const mara = g.nodes.find((n) => n.name === "MARA");
    expect(mara?.provided).toBe(false);
    expect(mara?.releasedState).toBe("not-released");
    expect(mara?.successor).toBe("I_Product");
    const travel = g.nodes.find((n) => n.name === "ZCL_TRAVEL");
    expect(travel?.provided).toBe(true);
    expect(g.scopeNote).toContain("not proof of independence");
  });

  it("is deterministic and self-edge-free", () => {
    const a = getObjectDependencies([CALLER, TRAVEL_CLASS]);
    const b = getObjectDependencies([CALLER, TRAVEL_CLASS]);
    expect(a).toEqual(b);
    expect(a.edges.every((e) => e.from !== e.to)).toBe(true);
  });
});

describe("rewrite recipes", () => {
  it("surfaces a curated before/after on readiness categories and plan items", () => {
    const report = checkCloudReadiness([
      { filename: "zold.prog.abap", source: "REPORT zold.\nWRITE: / 'hi'." },
    ]);
    const listOutput = report.categories.find((c) => c.category === "list-output");
    expect(listOutput?.rewrite?.before).toContain("WRITE");
    expect(listOutput?.rewrite?.after.length).toBeGreaterThan(0);

    const plan = planCloudMigration(report);
    const item = plan.phases.flatMap((p) => p.items).find((i) => i.category === "list-output");
    expect(item?.example?.before).toContain("WRITE");
  });

  it("has a recipe for every playbook category except the generic fallback example", () => {
    for (const cat of ["list-output", "dynpro", "report-events", "report-program", "native-sql", "rfc", "subroutines", "transaction-glue"]) {
      const r = rewriteRecipeFor(cat);
      expect(r, `missing recipe for ${cat}`).toBeDefined();
      expect(r!.before.length, `${cat} needs a before example`).toBeGreaterThan(0);
      expect(r!.notes.length).toBeGreaterThan(20);
    }
    expect(rewriteRecipeFor("other")?.notes).toContain("docsUrl");
  });
});
