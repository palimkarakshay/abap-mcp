import { describe, expect, it } from "vitest";

import {
  DEFAULT_EDITION,
  lookupReleased,
  RELEASED_API_SNAPSHOT,
  RELEASED_API_SNAPSHOTS,
  RELEASED_EDITIONS,
  suggestSuccessor,
} from "../abap/released.js";

describe("lookupReleased", () => {
  it("reports a released CDS view entity as released", () => {
    const r = lookupReleased("I_Product");
    expect(r.state).toBe("released");
    expect(r.objectType).toBe("CDS_STOB");
    expect(r.applicationComponent).toBeTruthy();
  });

  it("is case-insensitive", () => {
    expect(lookupReleased("i_product").state).toBe("released");
    expect(lookupReleased("  I_PRODUCT  ").state).toBe("released");
  });

  it("reports a deprecated object as deprecated", () => {
    // C_BILLGDOCITMPRCGELMNTBSCDEX is deprecated in SAP's published list.
    const r = lookupReleased("C_BILLGDOCITMPRCGELMNTBSCDEX");
    expect(r.state).toBe("deprecated");
  });

  it("reports a classic table (notToBeReleased) as not-released", () => {
    const r = lookupReleased("MARA");
    expect(r.state).toBe("not-released");
    expect(r.objectType).toBe("TABL");
  });

  it("reports an unknown name as not-released with no type", () => {
    const r = lookupReleased("ZZ_NO_SUCH_OBJECT_123");
    expect(r.state).toBe("not-released");
    expect(r.objectType).toBeUndefined();
    expect(r.recorded).toBe(false);
  });

  it("disambiguates by objectType when given", () => {
    // A name existing under multiple types resolves to the requested one.
    const cds = lookupReleased("MARA", "TABL");
    expect(cds.objectType).toBe("TABL");
    expect(cds.recorded).toBe(true);
  });

  it("marks recorded entries, typed or untyped", () => {
    expect(lookupReleased("MARA").recorded).toBe(true);
    expect(lookupReleased("I_Product", "CDS_STOB").recorded).toBe(true);
  });

  it("does not let a record under another type answer a typed query", () => {
    // I_Product exists only as CDS_STOB; asking for the TABL of that name is
    // a miss — a released CDS view must not make a same-named table look released.
    const r = lookupReleased("I_Product", "TABL");
    expect(r.state).toBe("not-released");
    expect(r.recorded).toBe(false);
    expect(r.objectType).toBe("TABL");
  });

  it("exposes a snapshot date and source", () => {
    expect(RELEASED_API_SNAPSHOT.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(RELEASED_API_SNAPSHOT.source).toMatch(/abap-atc-cr-cv-s4hc/);
    expect(RELEASED_API_SNAPSHOT.recordCount).toBeGreaterThan(1000);
  });
});

describe("suggestSuccessor", () => {
  it("returns a curated CDS successor for a common classic table", () => {
    expect(suggestSuccessor("MARA")).toBe("I_Product");
    expect(suggestSuccessor("kna1")).toBe("I_Customer");
    expect(suggestSuccessor("VBAK")).toBe("I_SalesDocument");
  });

  it("returns undefined for tables without a curated successor", () => {
    expect(suggestSuccessor("ZZ_CUSTOM_TABLE")).toBeUndefined();
  });
});

// F03 — edition-correct data: three SAP editions (Public Edition "s4hc",
// SAP BTP ABAP environment "btp", Private Edition / on-prem "pce"), SAP's
// own successors[], and objectClassifications_SAP.json classifications.
describe("multi-edition lookupReleased (F03)", () => {
  it("exposes exactly the three bundled editions, defaulting to s4hc", () => {
    expect(RELEASED_EDITIONS).toEqual(["s4hc", "btp", "pce"]);
    expect(DEFAULT_EDITION).toBe("s4hc");
    for (const edition of RELEASED_EDITIONS) {
      const snap = RELEASED_API_SNAPSHOTS[edition];
      expect(snap.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(snap.source).toMatch(/abap-atc-cr-cv-s4hc/);
      expect(snap.recordCount).toBeGreaterThan(1000);
      expect(snap.edition).toBe(edition);
    }
  });

  it("reports MARA as not-released in every edition", () => {
    for (const edition of RELEASED_EDITIONS) {
      const r = lookupReleased("MARA", undefined, edition);
      expect(r.state, `MARA in ${edition}`).toBe("not-released");
      expect(r.edition).toBe(edition);
      expect(r.snapshotDate).toBe(RELEASED_API_SNAPSHOTS[edition].snapshotDate);
    }
  });

  it("keeps the existing MARA -> I_Product wire behavior, and says which source answered it", () => {
    // MARA carries SAP's OWN successors[] too (several CDS views, all-caps
    // objectKeys like I_PRODUCT) — but the curated table-successors.json
    // entry ("I_Product", nicely cased, hand-checked) wins for the single
    // `successor` hint callers see, exactly as before F03. successorSource
    // says so explicitly, and the full SAP list is still available via
    // `successors` for anyone who wants every alternative.
    const r = lookupReleased("MARA");
    expect(suggestSuccessor("MARA")).toBe("I_Product");
    expect(r.successorSource).toBe("curated");
    expect(r.successors?.some((s) => s.name === "I_PRODUCT")).toBe(true);
  });

  it("finds an object whose released-API state genuinely differs by edition", () => {
    // I_UNITOFMEASURETECHNICALNAME: deprecated on Public Edition and BTP,
    // but released on Private Edition (verified against the live upstream
    // data on 2026-09-10) — real edition drift, not a fabricated example.
    const name = "I_UNITOFMEASURETECHNICALNAME";
    const s4hc = lookupReleased(name, "CDS_STOB", "s4hc");
    const btp = lookupReleased(name, "CDS_STOB", "btp");
    const pce = lookupReleased(name, "CDS_STOB", "pce");
    expect(s4hc.state).toBe("deprecated");
    expect(btp.state).toBe("deprecated");
    expect(pce.state).toBe("released");
    expect(pce.state).not.toBe(s4hc.state);
  });

  it("every successorSource 'sap' result carries a non-empty successors array", () => {
    // Objects with no curated fallback, so SAP's own successors[] answers.
    const cases: [string, string | undefined, "s4hc" | "btp" | "pce"][] = [
      ["I_UNITOFMEASURETECHNICALNAME", "CDS_STOB", "s4hc"],
      ["ABAP_CLOUD_DEVELOPMENT_3TIER", "CHKV", "s4hc"],
      ["SAP_CP_READINESS", "CHKV", "s4hc"],
    ];
    for (const [name, type, edition] of cases) {
      const r = lookupReleased(name, type, edition);
      expect(r.successorSource, name).toBe("sap");
      expect(r.successors?.length ?? 0, name).toBeGreaterThan(0);
    }
    expect(lookupReleased("ABAP_CLOUD_DEVELOPMENT_3TIER", "CHKV").successors?.[0]?.name).toBe(
      "ABAP_CLEAN_CORE_DEVELOPMENT",
    );
    expect(lookupReleased("SAP_CP_READINESS", "CHKV").successors?.[0]?.name).toBe("ABAP_CLOUD_READINESS");
  });

  it("derives successorClassification from the decoded SAP successors, matching SAP's own cardinality", () => {
    // MARA is SAP's own "multipleObjects" example (five CDS successors).
    const mara = lookupReleased("MARA", "TABL");
    expect(mara.successorClassification).toBe("multipleObjects");
    expect((mara.successors?.length ?? 0)).toBeGreaterThan(1);

    // ABAP_CLOUD_DEVELOPMENT_3TIER is SAP's "oneObject" example.
    const tier3 = lookupReleased("ABAP_CLOUD_DEVELOPMENT_3TIER", "CHKV");
    expect(tier3.successorClassification).toBe("oneObject");
  });

  it("looks up a classicAPI/noAPI/internalAPI classification from objectClassifications_SAP.json", () => {
    // CL_HTTP_UTILITY is classicAPI in SAP's published classification list.
    const hit = lookupReleased("CL_HTTP_UTILITY", "CLAS");
    expect(hit.classification).toBe("classicAPI");
  });

  it("reports an unrecorded name with no classification, not a false classicAPI/noAPI guess", () => {
    const r = lookupReleased("ZZ_NO_SUCH_OBJECT_123");
    expect(r.classification).toBeUndefined();
  });
});
