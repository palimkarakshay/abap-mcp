/**
 * planCloudMigration — the arrangement invariants: consulting order holds,
 * nothing is dropped or double-counted, and the released-API tier stays
 * separate, exactly as in the readiness report it rearranges.
 */
import { describe, expect, it } from "vitest";

import { planCloudMigration } from "../abap/plan.js";
import { checkCloudReadiness } from "../abap/readiness.js";

const CLASSIC_REPORT = {
  filename: "zold_report.prog.abap",
  source: [
    "REPORT zold_report.",
    "DATA gv_text TYPE string.",
    "SELECT SINGLE matnr FROM mara INTO @DATA(lv_matnr).",
    "WRITE: / 'hi'.",
    "CALL SCREEN 100.",
    "PERFORM f1.",
    "FORM f1.",
    "  gv_text = 'x'.",
    "ENDFORM.",
  ].join("\n"),
};

describe("planCloudMigration", () => {
  const report = checkCloudReadiness([CLASSIC_REPORT]);
  const plan = planCloudMigration(report);

  it("accounts for every blocker in the migration phases — no drops, no double counts", () => {
    const migrationFindings = plan.phases
      .filter((p) => p.kind === "migration")
      .reduce((n, p) => n + p.findingCount, 0);
    expect(migrationFindings).toBe(report.cloudBlockerCount);
    expect(plan.summary.cloudBlockerCount).toBe(report.cloudBlockerCount);
    for (const p of plan.phases) {
      expect(p.findingCount).toBe(p.items.reduce((n, i) => n + i.findingCount, 0));
      expect(p.itemCount).toBe(p.items.length);
    }
  });

  it("orders core rework before re-architecture (report-program before dynpro)", () => {
    const phaseOf = (category: string): number => {
      const phase = plan.phases.find((p) => p.items.some((i) => i.category === category));
      expect(phase, `no phase contains category ${category}`).toBeDefined();
      return phase!.phase;
    };
    // The readiness diff is syntax-level: this source yields report-program
    // (stage 2 — core rework) and dynpro + list-output (stage 3 — UI redesign).
    expect(phaseOf("report-program")).toBeLessThan(phaseOf("dynpro"));
    expect(phaseOf("dynpro")).toBe(phaseOf("list-output"));
  });

  it("numbers phases sequentially from 1 with objective exit criteria", () => {
    plan.phases.forEach((p, idx) => {
      expect(p.phase).toBe(idx + 1);
      expect(p.exitCriteria).toMatch(/lint_abap|check_cloud_readiness|check_released_api/);
    });
  });

  it("keeps released-API work in its own snapshot-dated phase, never mixed into migration", () => {
    const releasedPhases = plan.phases.filter((p) => p.kind === "released-api");
    expect(report.releasedApiFindings.length).toBeGreaterThan(0); // MARA access above
    expect(releasedPhases.length).toBe(1);
    expect(releasedPhases[0]!.goal).toContain(report.releasedApiSnapshotDate);
    for (const p of plan.phases.filter((x) => x.kind !== "released-api")) {
      expect(p.items.every((i) => i.category !== "released-api")).toBe(true);
    }
  });

  it("caps sample locations but reports full counts", () => {
    for (const p of plan.phases) {
      for (const i of p.items) {
        expect(i.locations.length).toBeLessThanOrEqual(5);
        expect(i.findingCount).toBeGreaterThanOrEqual(i.locations.length === 5 ? 5 : i.locations.length);
      }
    }
  });

  it("returns an empty-but-honest plan for clean cloud code", () => {
    const clean = checkCloudReadiness([
      {
        filename: "zcl_clean.clas.abap",
        source:
          "CLASS zcl_clean DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS get RETURNING VALUE(rv) TYPE string.\nENDCLASS.\nCLASS zcl_clean IMPLEMENTATION.\n METHOD get.\n rv = 'hi'.\n ENDMETHOD.\nENDCLASS.",
      },
    ]);
    const emptyPlan = planCloudMigration(clean);
    expect(emptyPlan.summary.cloudBlockerCount).toBe(0);
    expect(emptyPlan.phases.filter((p) => p.kind === "migration")).toEqual([]);
    expect(emptyPlan.summary.estimatedEffort).toBe("none — nothing to do");
  });
});
