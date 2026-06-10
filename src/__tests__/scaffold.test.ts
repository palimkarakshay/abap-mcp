import { describe, expect, it } from "vitest";

import { scaffoldRapBo, snakeToCamel } from "../abap/scaffold.js";

const TRAVEL = {
  entityName: "Travel",
  sqlTable: "ztravel",
  keyField: "travel_id",
  managedUuidKey: true,
  fields: [
    { name: "agency_id", type: "abap.char(6)" },
    { name: "total_price", type: "abap.curr(16,2)" },
  ],
  draft: true,
  prefix: "Z" as const,
};

describe("snakeToCamel", () => {
  it("converts snake_case to UpperCamelCase", () => {
    expect(snakeToCamel("travel_id")).toBe("TravelId");
    expect(snakeToCamel("local_last_changed_at")).toBe("LocalLastChangedAt");
  });
});

describe("scaffoldRapBo", () => {
  it("generates the full 8-artifact stack", () => {
    const r = scaffoldRapBo(TRAVEL);
    expect(r.files.map((f) => f.filename)).toEqual([
      "zr_travel.ddls.asddls",
      "zr_travel.bdef.asbdef",
      "zbp_travel.clas.abap",
      "zbp_travel.clas.locals_imp.abap",
      "zc_travel.ddls.asddls",
      "zc_travel.bdef.asbdef",
      "zc_travel.ddlx.asddlx",
      "zui_travel_v4.srvd.srvdsrv",
    ]);
  });

  it("ROUND-TRIP: every machine-checkable artifact passes abaplint at Cloud level", () => {
    const r = scaffoldRapBo(TRAVEL);
    expect(r.validationIssues).toEqual([]);
  });

  it("round-trips the non-draft, provided-key variant too", () => {
    const r = scaffoldRapBo({ ...TRAVEL, draft: false, managedUuidKey: false });
    expect(r.validationIssues).toEqual([]);
  });

  it("draft variant carries the draft contract", () => {
    const bdef = scaffoldRapBo(TRAVEL).files.find((f) => f.filename === "zr_travel.bdef.asbdef")!;
    expect(bdef.content).toContain("with draft;");
    expect(bdef.content).toContain("draft table ztravel_d");
    expect(bdef.content).toContain("total etag LastChangedAt");
    expect(bdef.content).toContain("draft action Activate optimized;");
    expect(bdef.content).toContain("draft determine action Prepare;");
    const projBdef = scaffoldRapBo(TRAVEL).files.find((f) => f.filename === "zc_travel.bdef.asbdef")!;
    expect(projBdef.content).toContain("use draft;");
  });

  it("non-draft variant omits every draft artifact", () => {
    const r = scaffoldRapBo({ ...TRAVEL, draft: false });
    const bdef = r.files.find((f) => f.filename === "zr_travel.bdef.asbdef")!;
    expect(bdef.content).not.toContain("draft");
    expect(bdef.content).not.toContain("total etag");
    const projBdef = r.files.find((f) => f.filename === "zc_travel.bdef.asbdef")!;
    expect(projBdef.content).not.toContain("use draft");
    expect(r.activationOrder.join("\n")).not.toContain("Draft table");
  });

  it("maps every CDS alias back to its table field", () => {
    const bdef = scaffoldRapBo(TRAVEL).files.find((f) => f.filename === "zr_travel.bdef.asbdef")!;
    expect(bdef.content).toContain("TravelId = travel_id;");
    expect(bdef.content).toContain("AgencyId = agency_id;");
    expect(bdef.content).toContain("TotalPrice = total_price;");
    expect(bdef.content).toContain("LocalLastChangedAt = local_last_changed_at;");
  });

  it("uuid key gets managed numbering; provided key is readonly:update", () => {
    const uuid = scaffoldRapBo(TRAVEL).files.find((f) => f.filename === "zr_travel.bdef.asbdef")!;
    expect(uuid.content).toContain("field ( numbering : managed, readonly ) TravelId;");
    const provided = scaffoldRapBo({ ...TRAVEL, managedUuidKey: false }).files.find(
      (f) => f.filename === "zr_travel.bdef.asbdef",
    )!;
    expect(provided.content).toContain("field ( readonly : update ) TravelId;");
  });

  it("strict(2) and etag discipline are always present", () => {
    for (const draft of [true, false]) {
      const bdef = scaffoldRapBo({ ...TRAVEL, draft }).files.find(
        (f) => f.filename === "zr_travel.bdef.asbdef",
      )!;
      expect(bdef.content).toContain("strict ( 2 );");
      expect(bdef.content).toContain("etag master LocalLastChangedAt");
      expect(bdef.content).toContain("lock master");
      expect(bdef.content).toContain("authorization master ( instance )");
    }
  });

  it("suggested table DDL includes the admin fields with ABP semantic types", () => {
    const r = scaffoldRapBo(TRAVEL);
    expect(r.suggestedTableDdl).toContain("abp_creation_user");
    expect(r.suggestedTableDdl).toContain("abp_locinst_lastchange_tstmpl");
    expect(r.suggestedTableDdl).toContain("sysuuid_x16");
  });

  it("rejects colliding and invalid inputs", () => {
    expect(() => scaffoldRapBo({ ...TRAVEL, fields: [{ name: "created_by" }] })).toThrow(/admin field/);
    expect(() => scaffoldRapBo({ ...TRAVEL, entityName: "bad name" })).toThrow(/UpperCamelCase/);
    expect(() => scaffoldRapBo({ ...TRAVEL, sqlTable: "atravel" })).toThrow(/namespace/);
    expect(() =>
      scaffoldRapBo({ ...TRAVEL, fields: [{ name: "agency_id" }, { name: "agency_id" }] }),
    ).toThrow(/Duplicate/);
  });

  it("service definition exposes the projection, not the root", () => {
    const srvd = scaffoldRapBo(TRAVEL).files.find((f) => f.filename === "zui_travel_v4.srvd.srvdsrv")!;
    expect(srvd.content).toContain("expose ZC_Travel as Travel;");
  });
});
