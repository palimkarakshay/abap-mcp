import { describe, expect, it } from "vitest";

import { inferFilename } from "../abap/engine.js";

/**
 * SAP's official ADT MCP server hands agents object files under the ABAP file
 * format (AFF) names, which coincide with abapGit's for every source-bearing
 * object type abap-mcp checks. The composed loop in get_abap_agent_rules
 * (read with SAP's server → check with abap-mcp → edit with SAP's server)
 * depends on those names being accepted verbatim.
 */
describe("AFF / abapGit file names from SAP's ADT MCP server are accepted as-is", () => {
  const names = [
    "zcl_travel_helper.clas.abap",
    "zcl_travel_helper.clas.locals_imp.abap",
    "zcl_travel_helper.clas.locals_def.abap",
    "zcl_travel_helper.clas.testclasses.abap",
    "zif_travel.intf.abap",
    "zr_travel.prog.abap",
    "zi_travel.ddls.asddls",
    "zr_travel.bdef.asbdef",
    "zui_travel_v4.srvd.srvdsrv",
    "zc_travel.ddlx.asddlx",
  ];
  for (const name of names) {
    it(`keeps ${name}`, () => {
      expect(inferFilename("CLASS zcl_x DEFINITION PUBLIC. ENDCLASS.", name)).toBe(name);
    });
  }
  it("rejects a name that is not an object file", () => {
    expect(() => inferFilename("REPORT z.", "zcl_travel_helper.clas.json")).toThrow(/abapGit-style/);
  });
});
