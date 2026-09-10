/**
 * Regression coverage for two `codex review` findings fixed in cli-extra.ts:
 *
 *  1. The local flag parser used to treat every `--flag` as value-taking, so
 *     a boolean flag (`--json`, `--test`, `--run`, `--force`) directly
 *     followed by a positional swallowed it as the flag's own value
 *     (`knowledge --json "clean core level C"` → usage error;
 *     `release --json rap` → topic silently dropped).
 *  2. `cmdAisdk --out` overwrote existing files unconditionally, unlike
 *     cmdScaffold/cmdUnittest in cli-commands.ts which guard with an
 *     existence check + `--force`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ExtraCliIo } from "../cli-extra.js";
import { cmdAisdk, cmdKnowledge, cmdRelease } from "../cli-extra.js";

function io(): { out: string[]; err: string[]; io: ExtraCliIo } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
}

/** Real-filesystem ExtraCliIo, mirroring the dispatcher's `case "aisdk"` wiring in cli-commands.ts. */
function fsIo(): { out: string[]; err: string[]; io: ExtraCliIo } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      out: (s) => out.push(s),
      err: (s) => err.push(s),
      writeFile: (path, content) => {
        mkdirSync(join(path, ".."), { recursive: true });
        writeFileSync(path, content, "utf8");
      },
      exists: existsSync,
    },
  };
}

describe("cli-extra boolean flag parsing", () => {
  it('knowledge --json "clean core level C" returns JSON with hits, not a usage error', () => {
    const { out, io: o } = io();
    const code = cmdKnowledge(["--json", "clean core level C"], o);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("")) as { query: string; matchCount: number };
    // If --json had swallowed the question as its value, rest would be empty
    // and cmdKnowledge would have printed the usage error (exit 2) instead.
    expect(parsed.query).toBe("clean core level C");
    expect(parsed.matchCount).toBeGreaterThan(0);
  });

  it("release --json rap keeps the topic instead of swallowing it as --json's value", () => {
    const { out, io: o } = io();
    const code = cmdRelease(["--json", "rap"], o);
    expect(code).toBe(0);
    // If --json had consumed "rap", output would be human-readable text
    // (flags.has("json") false), not parseable JSON.
    const parsed = JSON.parse(out.join("")) as { matchCount: number; deltas: unknown[]; scopeNote: string };
    expect(parsed).toHaveProperty("matchCount");
    expect(parsed).toHaveProperty("scopeNote");
  });

  it("boolean and value flags parse correctly regardless of order", () => {
    const beforeTopic = io();
    expect(cmdKnowledge(["--json", "clean core level C"], beforeTopic.io)).toBe(0);
    const afterTopic = io();
    expect(cmdKnowledge(["clean core level C", "--json"], afterTopic.io)).toBe(0);
    const a = JSON.parse(beforeTopic.out.join("")) as { query: string; matchCount: number };
    const b = JSON.parse(afterTopic.out.join("")) as { query: string; matchCount: number };
    expect(a.query).toBe("clean core level C");
    expect(b.query).toBe("clean core level C");
    expect(b.matchCount).toBe(a.matchCount);
  });

  it("a value flag between two positionals still only consumes its own value", () => {
    const { out, io: o } = io();
    // "release" also accepts free topic words; --kind is a value flag and
    // must not eat "rap" from the topic, nor should --json eat anything.
    const code = cmdRelease(["what's new in", "--kind", "rap", "--json", "the 2605 wave"], o);
    expect(code).toBe(0);
    const parsed = JSON.parse(out.join("")) as { query?: { topic?: string; kind?: string } } & Record<string, unknown>;
    expect(parsed).toHaveProperty("matchCount");
  });
});

describe("cmdAisdk --out overwrite guard", () => {
  it("writes generated files to a fresh --out directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "abapmcp-aisdk-"));
    const { out, io: o } = fsIo();
    const code = cmdAisdk(["--scenario", "ZDEMO_AI_SCENARIO", "--interaction", "string", "--out", dir], o);
    expect(code).toBe(0);
    expect(out.some((l) => l.includes(`wrote 1 file(s) to ${dir}`))).toBe(true);
    expect(readdirSync(dir).length).toBe(1);
  });

  it("refuses to overwrite an existing generated file without --force and exits 1, leaving it untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "abapmcp-aisdk-"));
    const first = fsIo();
    expect(cmdAisdk(["--scenario", "ZDEMO_AI_SCENARIO", "--interaction", "string", "--out", dir], first.io)).toBe(0);
    const filename = readdirSync(dir)[0]!;
    const target = join(dir, filename);

    // Mutate the file on disk so an unconditional overwrite would be observable.
    writeFileSync(target, "MUTATED-BY-TEST", "utf8");

    const second = fsIo();
    const code = cmdAisdk(["--scenario", "ZDEMO_AI_SCENARIO", "--interaction", "string", "--out", dir], second.io);
    expect(code).toBe(1);
    expect(second.err.some((l) => l.includes("refusing to overwrite") && l.includes(filename))).toBe(true);
    expect(readFileSync(target, "utf8")).toBe("MUTATED-BY-TEST");
  });

  it("--force allows the rewrite", () => {
    const dir = mkdtempSync(join(tmpdir(), "abapmcp-aisdk-"));
    const first = fsIo();
    expect(cmdAisdk(["--scenario", "ZDEMO_AI_SCENARIO", "--interaction", "string", "--out", dir], first.io)).toBe(0);
    const filename = readdirSync(dir)[0]!;
    const target = join(dir, filename);
    const original = readFileSync(target, "utf8");
    writeFileSync(target, "MUTATED-BY-TEST", "utf8");

    const third = fsIo();
    const code = cmdAisdk(
      ["--scenario", "ZDEMO_AI_SCENARIO", "--interaction", "string", "--out", dir, "--force"],
      third.io,
    );
    expect(code).toBe(0);
    expect(readFileSync(target, "utf8")).toBe(original);
  });
});
