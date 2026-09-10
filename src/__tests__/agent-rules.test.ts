import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import { AGENT_RULES_TOOLS, buildAgentRules } from "../tools/agent-rules.tools.js";

describe("get_abap_agent_rules", () => {
  it("prescribes the offline loop and the online hand-off when paired", () => {
    const md = buildAgentRules({ target: "Cloud", pairedWith: ["sap-adt-mcp"], runEnabled: true, packagePrefix: "Z", edition: "btp" });
    expect(md).toContain("run_abap_unit");
    expect(md).toContain("abap_activate_objects");
    expect(md).toContain("ABAP_CLEAN_CORE_DEVELOPMENT");
    expect(md).toContain("edition `btp`");
    expect(md).not.toContain("API_RELEASE_STATE_CHECK");
  });
  it("falls back to the system hand-off when nothing is paired", () => {
    const md = buildAgentRules({ target: "classic", pairedWith: ["none"], runEnabled: false, packagePrefix: "Y", edition: "s4hc" });
    expect(md).toContain("no SAP connection");
    expect(md).toContain("`Y`");
    expect(md).not.toContain("Readiness gate");
  });
  for (const tool of AGENT_RULES_TOOLS) {
    describe(`${tool.name} rubric`, () => {
      it("is verb-first, says when to use it and what it does not do", () => {
        expect(tool.name).toMatch(/^get_/);
        expect(tool.description).toMatch(/Use this when/);
        expect(tool.description).toMatch(/(does not|not a|cannot)/);
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.examples?.length ?? 0).toBeGreaterThanOrEqual(1);
      });
      it("describes every parameter", () => {
        for (const [field, schema] of Object.entries(tool.inputSchema)) {
          const d = (schema as ZodType).description;
          expect(d, `${tool.name}.${field}`).toBeTruthy();
          expect(d!.length).toBeGreaterThanOrEqual(12);
        }
      });
    });
  }
});
