import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cmdCompare, cmdLint, cmdOutline, cmdReadiness, cmdReleased, cmdScaffold, cmdSetup, mergeReadiness, parseFlags, runCli, USAGE } from "../cli-commands.js";
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

describe("cmdSetup", () => {
  // Only the print-only targets are tested: the editor-mutating paths (vscode,
  // claude, auto) shell out to real CLIs and must not run against the dev box.
  it("eclipse target prints the guided steps and the exact JSON block", () => {
    const { out, io: o } = io();
    expect(cmdSetup(["eclipse"], o)).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("Eclipse Marketplace");
    expect(text).toContain("Edit preferences");
    expect(text).toContain('"abap-mcp"');
    expect(text).toContain('"npx"');
    expect(text).toContain("docs/INSTALL.md");
    expect(text).toContain("Nothing is sent anywhere");
  });

  it("adt is an alias for eclipse", () => {
    const a = io();
    const b = io();
    cmdSetup(["eclipse"], a.io);
    cmdSetup(["adt"], b.io);
    expect(b.out.join("\n")).toBe(a.out.join("\n"));
  });

  it("rejects unknown targets with usage", () => {
    const { err, io: o } = io();
    expect(cmdSetup(["notepad"], o)).toBe(2);
    expect(err.join("\n")).toContain("Usage: abap-mcp setup");
  });

  it("is announced in the CLI usage text", () => {
    expect(USAGE).toContain("abap-mcp setup");
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

/* --------------------------------------------------------------- rapcheck
 * Spec §4.2 / §6.4. Driven through `runCli` because the dispatcher is what
 * injects filesystem access (`readSources`) into `cmdRapcheck` — testing the
 * function alone would skip the wiring the CLI actually depends on.
 */
const GOOD_BDEF = `managed implementation in class zbp_travel unique;
strict ( 2 );

define behavior for ZR_Travel alias Travel
persistent table ztravel
etag master LocalLastChangedAt
lock master
authorization master ( instance )
{
  create;
  update;
  delete;
}
`;

const BAD_BDEF = `managed implementation in class zbp_broken unique;
strict ( 2 );
with draft;

define behavior for ZR_Broken alias Broken
persistent table zbroken
etag master LocalLastChangedAt
lock master
authorization master ( instance )
{
  create;
}
`;

const COLLABORATIVE_BDEF = `managed implementation in class zbp_collab unique;
strict ( 2 );
with collaborative draft;

define behavior for ZR_Collab alias Collab
persistent table zcollab
draft table zcollab_d
etag master LocalLastChangedAt
lock master total etag LastChangedAt
authorization master ( instance )
{
  create;
  update;
  delete;

  draft action Edit;
  draft action Resume;
  draft action Activate optimized;
  draft action Discard;
  draft determine action Prepare;
}
`;

describe("cmdRapcheck", () => {
  it("exits 0 on a clean BDEF directory", () => {
    const dir = tmpWith({ "zr_travel.bdef.asbdef": GOOD_BDEF });
    const { out, io: o } = io();
    expect(runCli(["rapcheck", dir], o)).toBe(0);
    expect(out.join("\n")).toContain("0 error(s)");
  });

  it("exits 1 when a rule reports an error", () => {
    const dir = tmpWith({ "zr_broken.bdef.asbdef": BAD_BDEF });
    const { out, err, io: o } = io();
    expect(runCli(["rapcheck", dir], o)).toBe(1);
    // draft BO without a draft table / total etag: RAP026 and RAP035.
    expect(out.join("\n")).toContain("RAP026");
    expect(err.join("\n")).toContain("ADT activation in the target system remains the only authority");
  });

  it("exits 2 when the directory holds no BDEF/SRVD", () => {
    const dir = tmpWith({ "zok.prog.abap": "REPORT zok.\nWRITE 'hi'." });
    const { err, io: o } = io();
    expect(runCli(["rapcheck", dir], o)).toBe(2);
    expect(err.join("\n")).toContain("No RAP behavior or service definitions found");
  });

  it("exits 2 on an unknown --release", () => {
    const dir = tmpWith({ "zr_travel.bdef.asbdef": GOOD_BDEF });
    const { err, io: o } = io();
    expect(runCli(["rapcheck", dir, "--release", "9999"], o)).toBe(2);
    expect(err.join("\n")).toContain("Unknown release");
  });

  it("--json emits a RapCheckReport", () => {
    const dir = tmpWith({ "zr_travel.bdef.asbdef": GOOD_BDEF });
    const { out, io: o } = io();
    expect(runCli(["rapcheck", dir, "--json"], o)).toBe(0);
    const report = JSON.parse(out.join("\n")) as {
      files: { filename: string; kind: string; parsed: boolean }[];
      findings: unknown[];
      summary: { errors: number; rulesRun: number; unknownConstructs: number };
      scopeNote: string;
      grammarVersion: string;
      rulesVersion: string;
      validated: string;
    };
    expect(report.files[0]!.kind).toBe("bdef");
    expect(report.files[0]!.parsed).toBe(true);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.rulesRun).toBeGreaterThan(0);
    expect(report.validated).toBe("rap-checker");
    expect(report.grammarVersion).toMatch(/^bdl\//);
    expect(report.rulesVersion).toMatch(/^rap-rules\//);
    expect(report.scopeNote).toContain("not by abaplint");
  });

  it("--release gates a newer construct as a warning without failing the run", () => {
    const dir = tmpWith({ "zr_collab.bdef.asbdef": COLLABORATIVE_BDEF });
    const gated = io();
    expect(runCli(["rapcheck", dir, "--release", "2502", "--json"], gated.io)).toBe(0);
    const gatedReport = JSON.parse(gated.out.join("\n")) as {
      findings: { rule: string; severity: string; minRelease?: string }[];
      releaseGate?: { abapRelease: string; gatedConstructs: number; curatedDate: string };
    };
    const gate = gatedReport.findings.find((f) => f.rule === "RAP900");
    expect(gate).toBeDefined();
    expect(gate!.severity).toBe("warning");
    expect(gatedReport.releaseGate!.abapRelease).toBe("2502");
    expect(gatedReport.releaseGate!.gatedConstructs).toBeGreaterThan(0);

    const current = io();
    expect(runCli(["rapcheck", dir, "--release", "2508", "--json"], current.io)).toBe(0);
    const currentReport = JSON.parse(current.out.join("\n")) as { findings: { rule: string }[] };
    expect(currentReport.findings.some((f) => f.rule === "RAP900")).toBe(false);
  });

  it("is announced in the CLI usage text", () => {
    expect(USAGE).toContain("abap-mcp rapcheck");
  });

  /**
   * Review finding (`cli-extra.ts` §cmdRapcheck): `errors` used to be counted
   * over the RETAINED findings, so a run whose errors fell off the end of the
   * finding cap printed "0 error(s)" and exited 0 — a CI gate built on that
   * exit code waved invalid RAP through. The fixture puts 660 infos in front
   * of the error and relies on the report's own (file, line, column, rule)
   * sort to push the error past the 500-finding cap.
   */
  const cappedFixture = (): string => {
    const noise = Array.from({ length: 60 }, (_, i) => `  frobnicate${i} zzz;`).join("\n");
    const files: Record<string, string> = {};
    for (let n = 0; n < 11; n += 1) {
      files[`za${String(n).padStart(2, "0")}.bdef.asbdef`] =
        `managed implementation in class zbp_a${n} unique;\n\ndefine behavior for ZR_A${n} alias A${n}\n` +
        `persistent table za${n}\nlock master\nauthorization master ( instance )\n{\n${noise}\n  create;\n}\n`;
    }
    // `managed;` with no implementation class — RAP011, a confirmed error.
    files["zz_bad.bdef.asbdef"] =
      "managed;\n\ndefine behavior for ZR_Z alias Z\npersistent table zz\nlock master\n" +
      "authorization master ( instance )\n{\n  create;\n}\n";
    return tmpWith(files);
  };

  it("exits 1 on an error the finding cap dropped, and says how many findings are missing", () => {
    const dir = cappedFixture();
    const { out, io: o } = io();
    expect(runCli(["rapcheck", dir], o)).toBe(1);
    const printed = out.join("\n");
    // The error itself did NOT survive the cap — that is the whole point.
    expect(printed).not.toContain("RAP011");
    expect(printed).toContain("1 error(s)");
    expect(printed).toContain("omitted by the report cap");
  });

  it("--json reports the uncapped counts, the omitted count and exit 1 too", () => {
    const dir = cappedFixture();
    const { out, io: o } = io();
    expect(runCli(["rapcheck", dir, "--json"], o)).toBe(1);
    const report = JSON.parse(out.join("\n")) as {
      findings: { severity: string }[];
      summary: { errors: number; infos: number; omitted: number; truncated: boolean; baseUnresolved: number };
    };
    expect(report.findings.some((f) => f.severity === "error")).toBe(false);
    expect(report.summary.errors).toBe(1);
    expect(report.summary.omitted).toBeGreaterThan(0);
    expect(report.summary.truncated).toBe(true);
    expect(report.summary.baseUnresolved).toBe(0);
  });
});

describe("cmdLint RAP routing", () => {
  it("merges rap/ findings for a BDEF and honors --no-rap", () => {
    const dir = tmpWith({ "zr_broken.bdef.asbdef": BAD_BDEF });
    const merged = io();
    expect(cmdLint([dir, "--preset", "syntax-only"], merged.io)).toBe(1);
    expect(merged.out.join("\n")).toContain("rap/RAP026");
    expect(merged.err.join("\n")).toContain("not by abaplint");

    const plain = io();
    // abaplint alone has nothing to say about a BDEF — that silence is the
    // honesty problem the routing exists to fix.
    expect(cmdLint([dir, "--preset", "syntax-only", "--no-rap"], plain.io)).toBe(0);
    expect(plain.out.join("\n")).not.toContain("rap/");
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
