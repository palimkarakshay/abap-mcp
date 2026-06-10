import { describe, expect, it } from "vitest";

import { explainRule, listRules } from "../abap/rules.js";

describe("listRules", () => {
  it("returns the full abaplint catalog", () => {
    const rules = listRules();
    expect(rules.length).toBeGreaterThan(150);
    const first = rules[0]!;
    expect(first.key).toBeTruthy();
    expect(first.docsUrl).toContain("rules.abaplint.org");
  });

  it("filters by query", () => {
    const rules = listRules("obsolete");
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.length).toBeLessThan(50);
  });

  it("filters by tag", () => {
    const rules = listRules(undefined, "Security");
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r.tags.map((t) => t.toLowerCase())).toContain("security");
  });
});

describe("explainRule", () => {
  it("explains a known rule", () => {
    const detail = explainRule("exit_or_check");
    expect(detail.title).toMatch(/EXIT or CHECK/i);
    expect(detail.docsUrl).toBe("https://rules.abaplint.org/exit_or_check/");
  });

  it("throws not_found on an unknown rule", () => {
    expect(() => explainRule("no_such_rule_xyz")).toThrow(/list_abap_rules/);
  });
});
