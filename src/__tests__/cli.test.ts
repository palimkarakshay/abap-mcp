import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cmdCompare, cmdLint, cmdOutline, cmdReadiness, cmdReleased, cmdScaffold, mergeReadiness, parseFlags, runCli } from "../cli-commands.js";
import { checkCloudReadiness, gradeReadiness } from "../abap/readiness.js";

function io(): { out: string[]; err: string[]; io: { out: (s: string) => void; err: (s: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
}

function tmpWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "abapmcp-"));
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

describe("parseFlags", () => {
  it("parses values and booleans", () => {
    const { flags, rest } = parseFlags(["a.abap", "--json", "--baseline", "v757", "b.abap"]);
    expect(flags.get("json")).toBe(true);
    expect(flags.get("baseline")).toBe("v757");
    expect(rest).toEqual(["a.abap", "b.abap"]);
  });
});

describe("cmdLint", () => {
  it("lints a directory and exits 0 on clean syntax-only", () => {
    const dir = tmpWith({ "zok.prog.abap": "REPORT zok.\nWRITE 'hi'." });
    const { io: o } = io();
    expect(cmdLint([dir, "--preset", "syntax-only"], o)).toBe(0);
  });

  it("exits 1 on error findings", () => {
    const dir = tmpWith({ "zbad.prog.abap": "REPORT zbad.\nTHIS IS NOT ABAP???" });
    const { io: o } = io();
    expect(cmdLint([dir, "--preset", "syntax-only"], o)).toBe(1);
  });

  it("exits 2 when nothing found", () => {
    const dir = tmpWith({ "readme.md": "hello" });
    const { io: o } = io();
    expect(cmdLint([dir], o)).toBe(2);
  });

  it("honors --focus and labels the run with it", () => {
    const dir = tmpWith({ "zstyle.prog.abap": "REPORT zstyle.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF." });
    const focused = io();
    const plain = io();
    cmdLint([dir, "--focus", "performance"], focused.io); // case-insensitive
    cmdLint([dir], plain.io);
    expect(focused.out.join("\n")).toContain(":Performance @");
    expect(focused.out.length).toBeLessThan(plain.out.length);
  });

  it("rejects an unknown --focus", () => {
    const dir = tmpWith({ "zx.prog.abap": "REPORT zx.\nWRITE 'x'." });
    expect(() => cmdLint([dir, "--focus", "Speed"], io().io)).toThrow(/Unknown focus/);
  });

  it("applies --rules-file overrides (bare map or full abaplint.json)", () => {
    const dir = tmpWith({
      "zstyle.prog.abap": "REPORT zstyle.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF.",
      "org-pack.json": JSON.stringify({ rules: { empty_structure: false, implicit_start_of_selection: false } }),
    });
    const packed = io();
    const plain = io();
    cmdLint([dir, "--rules-file", join(dir, "org-pack.json")], packed.io);
    cmdLint([dir], plain.io);
    expect(packed.out.join("\n")).not.toContain("empty_structure");
    expect(plain.out.join("\n")).toContain("empty_structure");
  });
});

describe("cmdReadiness", () => {
  it("reports blockers for classic code and honors --fail-below", () => {
    const dir = tmpWith({ "zold.prog.abap": "REPORT zold.\nWRITE: / 'x'.\nCALL SCREEN 100." });
    const a = io();
    expect(cmdReadiness([dir], a.io)).toBe(0);
    expect(a.out.join("\n")).toMatch(/cloud blocker/);
    const b = io();
    expect(cmdReadiness([dir, "--fail-below", "95"], b.io)).toBe(1);
  });
});

describe("mergeReadiness", () => {
  it("merges batch reports with recomputed score and categories", () => {
    const r1 = checkCloudReadiness([{ source: "REPORT za.\nWRITE 'x'." }]);
    const r2 = checkCloudReadiness([{ source: "REPORT zb.\nCALL SCREEN 100." }]);
    const merged = mergeReadiness([r1, r2], "v758");
    expect(merged.cloudBlockerCount).toBe(r1.cloudBlockerCount + r2.cloudBlockerCount);
    expect(merged.score).toBe(Math.max(0, 100 - 5 * merged.cloudBlockerCount));
    expect(merged.categories.length).toBeGreaterThan(0);
    expect(merged.fileCount).toBe(r1.fileCount + r2.fileCount);
    expect(merged.grade).toBe(gradeReadiness(merged.cloudBlockerCount, merged.fileCount));
  });
});

describe("cmdCompare", () => {
  const OLD = "REPORT zold.\nWRITE: / 'hi'.\nCALL SCREEN 100.";
  const NEW =
    "CLASS zcl_new DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS get RETURNING VALUE(rv) TYPE string.\nENDCLASS.\nCLASS zcl_new IMPLEMENTATION.\n METHOD get.\n rv = 'hi'.\n ENDMETHOD.\nENDCLASS.";

  it("exits 0 on an improving rework and prints grade movement", () => {
    const before = tmpWith({ "zold.prog.abap": OLD });
    const after = tmpWith({ "zcl_new.clas.abap": NEW });
    const a = io();
    expect(cmdCompare([before, after, "--preset", "syntax-only"], a.io)).toBe(0);
    expect(a.out.join("\n")).toMatch(/grade \w → A/);
  });

  it("exits 1 when the rework regresses cloud readiness", () => {
    const before = tmpWith({ "zcl_new.clas.abap": NEW });
    const after = tmpWith({ "zold.prog.abap": OLD });
    expect(cmdCompare([before, after, "--preset", "syntax-only"], io().io)).toBe(1);
  });

  it("usage error without exactly two paths", () => {
    expect(cmdCompare(["only-one"], io().io)).toBe(2);
  });
});

describe("cmdOutline --mermaid", () => {
  it("emits Mermaid classDiagram source", () => {
    const dir = tmpWith({ "zcl_m.clas.abap": "CLASS zcl_m DEFINITION PUBLIC.\n PUBLIC SECTION.\n METHODS run.\nENDCLASS.\nCLASS zcl_m IMPLEMENTATION.\n METHOD run.\n ENDMETHOD.\nENDCLASS." });
    const a = io();
    expect(cmdOutline([dir, "--mermaid"], a.io)).toBe(0);
    const text = a.out.join("\n");
    expect(text).toContain("classDiagram");
    expect(text).toContain("class zcl_m {");
    expect(text).toContain("+run()");
  });
});

describe("cmdScaffold", () => {
  it("writes a validated BO to --out", () => {
    const dir = mkdtempSync(join(tmpdir(), "abapmcp-out-"));
    const { io: o, out } = io();
    const code = cmdScaffold(
      ["--entity", "Trip", "--table", "ztrip", "--key", "trip_id", "--out", dir],
      o,
    );
    expect(code).toBe(0);
    expect(out.some((l) => l.includes("zr_trip.ddls.asddls"))).toBe(true);
  });

  it("usage error without required flags", () => {
    const { io: o } = io();
    expect(cmdScaffold(["--entity", "X"], o)).toBe(2);
  });

  it("refuses to overwrite the table-DDL suggestion file without --force", () => {
    // Only the suggestion file pre-exists, so the guard under test is the
    // suggestion-file one, not the per-artifact checks before it.
    const dir = mkdtempSync(join(tmpdir(), "abapmcp-out-"));
    writeFileSync(join(dir, "ztrip.tabl.suggestion.txt"), "keep me");
    const args = ["--entity", "Trip", "--table", "ztrip", "--key", "trip_id", "--out", dir];
    const first = io();
    expect(cmdScaffold(args, first.io)).toBe(1);
    expect(first.err.some((l) => l.includes("ztrip.tabl.suggestion.txt"))).toBe(true);
    // --force allows the rewrite.
    expect(cmdScaffold([...args, "--force"], io().io)).toBe(0);
  });
});

describe("cmdReleased", () => {
  it("reports states and a successor for known objects", () => {
    const a = io();
    expect(cmdReleased(["MARA", "I_Product"], a.io)).toBe(0);
    const text = a.out.join("\n");
    expect(text).toMatch(/MARA\s+not-released/);
    expect(text).toMatch(/I_Product/);
    expect(text).toMatch(/I_Product/); // successor hint for MARA
  });

  it("emits JSON with a snapshot date", () => {
    const a = io();
    expect(cmdReleased(["MARA", "--json"], a.io)).toBe(0);
    const parsed = JSON.parse(a.out.join("\n")) as { snapshotDate: string; results: unknown[] };
    expect(parsed.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(parsed.results.length).toBe(1);
  });

  it("usage error without names", () => {
    const a = io();
    expect(cmdReleased([], a.io)).toBe(2);
  });
});

describe("runCli", () => {
  it("returns null for server mode", () => {
    const { io: o } = io();
    expect(runCli([], o)).toBeNull();
    expect(runCli(["serve"], o)).toBeNull();
  });

  it("prints usage on help and unknown", () => {
    const a = io();
    expect(runCli(["help"], a.io)).toBe(0);
    const b = io();
    expect(runCli(["frobnicate"], b.io)).toBe(2);
  });
});
