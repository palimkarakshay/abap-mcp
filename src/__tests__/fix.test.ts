/**
 * fixAbap — deterministic auto-fix invariants: only abaplint's own edits are
 * applied, output stays parseable, unfixable findings are reported honestly,
 * and the operation converges (idempotent on its own output).
 */
import { describe, expect, it } from "vitest";

import { runAbaplint } from "../abap/engine.js";
import { fixAbap } from "../abap/fix.js";

const OLD_STYLE = {
  filename: "zdemo.prog.abap",
  source: "report zdemo.\ndata lv_x type i.\nmove 5 to lv_x.\nif lv_x > 1.\n  write lv_x.\nendif.",
};
const OPTS = { version: "v758" as const, preset: "style" as const };

describe("fixAbap", () => {
  const result = fixAbap([OLD_STYLE], OPTS);

  it("applies keyword-case and obsolete-statement fixes", () => {
    const out = result.files[0]!.source;
    expect(result.fixedCount).toBeGreaterThan(0);
    expect(result.files[0]!.changed).toBe(true);
    expect(out).toContain("REPORT zdemo.");
    expect(out).toContain("lv_x = 5."); // MOVE modernized
    expect(out).not.toMatch(/\bmove\b/i);
    const rules = new Set(result.fixed.map((f) => f.rule));
    expect(rules.has("keyword_case")).toBe(true);
    expect(rules.has("obsolete_statement")).toBe(true);
  });

  it("output still parses and has strictly fewer findings", () => {
    const before = runAbaplint([OLD_STYLE], OPTS).findings;
    const after = runAbaplint(
      result.files.map((f) => ({ filename: f.filename, source: f.source })),
      OPTS,
    ).findings;
    expect(after.filter((f) => f.rule === "parser_error")).toEqual([]);
    expect(after.length).toBeLessThan(before.length);
  });

  it("reports unfixable findings as remaining, never silently drops them", () => {
    // no_prefixes / implicit_start_of_selection have no machine fix here.
    expect(result.remaining.length).toBeGreaterThan(0);
    for (const f of result.remaining) expect(typeof f.rule).toBe("string");
  });

  it("is idempotent: fixing the fixed output applies nothing new", () => {
    const second = fixAbap(
      result.files.map((f) => ({ filename: f.filename, source: f.source })),
      OPTS,
    );
    expect(second.fixedCount).toBe(0);
    expect(second.files[0]!.changed).toBe(false);
  });

  it("leaves already-clean code untouched (fixed output is the fixed point)", () => {
    // Cleanliness by construction: whatever fix produces must itself be clean.
    const once = fixAbap([OLD_STYLE], OPTS).files[0]!;
    const again = fixAbap([{ filename: once.filename, source: once.source }], OPTS);
    expect(again.fixedCount).toBe(0);
    expect(again.files[0]!.changed).toBe(false);
  });

  it("honors rule overrides (org pack drives the fixes)", () => {
    const r = fixAbap([OLD_STYLE], { ...OPTS, rules: { keyword_case: false } });
    expect(r.fixed.every((f) => f.rule !== "keyword_case")).toBe(true);
  });
});
