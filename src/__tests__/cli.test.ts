import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { cmdLint, cmdReadiness, cmdScaffold, mergeReadiness, parseFlags, runCli } from "../cli-commands.js";
import { checkCloudReadiness } from "../abap/readiness.js";

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
