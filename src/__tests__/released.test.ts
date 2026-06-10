import { describe, expect, it } from "vitest";

import {
  lookupReleased,
  RELEASED_API_SNAPSHOT,
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
  });

  it("disambiguates by objectType when given", () => {
    // A name existing under multiple types resolves to the requested one.
    const cds = lookupReleased("MARA", "TABL");
    expect(cds.objectType).toBe("TABL");
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
