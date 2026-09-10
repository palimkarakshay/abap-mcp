/**
 * Golden rule tests — spec `docs/specs/rap-checker-design.md` §6.2.
 *
 * Four bars, and each one exists because a rule set can pass the other three
 * while being useless:
 *
 *  1. **Every registered rule has an `ok`/`bad` pair, and they behave.** `bad`
 *     fires the rule, `ok` does not. A rule cannot ship untested.
 *  2. **`bad` fires that rule and nothing else that matters.** Every extra
 *     error/warning a `bad` fixture provokes has to be written down in
 *     `ALSO_EXPECTED` — collateral is allowed, but only on purpose.
 *  3. **The severity policy holds.** `confirmed` ⇒ the catalog severity;
 *     anything softer is capped at `warning` and its message ends in the
 *     bracketed provenance clause (spec §2.5).
 *  4. **Anti-noise.** The whole 79-file Apache-2.0 corpus runs through the
 *     whole rule set and the result is pinned in
 *     `evals/rap/corpus-expectations.json`. Real SAP samples are not all
 *     strict-clean, so this fixes the *identity and count* of the legitimate
 *     findings; a rule that starts firing 40 more times on SAP's own code is a
 *     false-positive regression, and the build says so.
 *     Regenerate deliberately with `RAP_WRITE_EXPECTATIONS=1 npx vitest run
 *     src/__tests__/rap-rules.test.ts` and read the diff before committing it.
 *
 * `.ddls.asddls` companions are read by a deliberately small extractor in this
 * file rather than by `src/abap/rap/ddls.ts` (abaplint's real CDS parser),
 * which is being built alongside this rule set. What the cross-file rules
 * consume is `CdsEntityInfo`; these tests supply that shape directly, so they
 * test the rules and not the adapter. Point `buildCdsMap()` at `ddls.ts` once
 * it lands.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import type { CdsEntityInfo, CdsShape, ParsedBdef, RapFinding } from "../abap/rap/context.js";
import { parseBehaviorDefinition } from "../abap/rap/parser.js";
import { RAP_RULES, runBdefRules } from "../abap/rap/rules.js";

const RULES_DIR = new URL("../../evals/rap/rules/", import.meta.url).pathname;
const FIXTURES_DIR = new URL("../../evals/rap/fixtures/", import.meta.url).pathname;
const EXPECTATIONS = new URL("../../evals/rap/corpus-expectations.json", import.meta.url).pathname;

/**
 * Error/warning findings a `bad` fixture legitimately provokes besides its own
 * rule. Every entry is a real consequence of the defect under test, not a
 * blind spot: making the fixture smaller would stop it demonstrating the rule.
 */
const ALSO_EXPECTED: Record<string, string[]> = {
  // Empty on purpose: every v1 `bad` fixture was written down to the single
  // defect under test, so none of them provokes a second error or warning.
  // An entry here is how a future fixture declares collateral it cannot avoid.
};

/* --------------------------------------------------------- fixture loading */

function readDir(dir: string): string[] {
  return readdirSync(dir).filter((entry) => statSync(join(dir, entry)).isFile());
}

/**
 * `ok*`/`bad*` are variant-specific; every other file (a `.ddls` companion, a
 * base BDEF) is shared. The prefix match is deliberately loose so a rule can
 * carry MORE THAN ONE fixture per variant — `ok-managed-by-bopf.bdef.asbdef`
 * next to `ok.bdef.asbdef`, for a second legal shape the rule must stay quiet
 * on. Every `ok*` file is loaded into the ok run and none into the bad run.
 */
function filesFor(dir: string, variant: "ok" | "bad"): string[] {
  const other = variant === "ok" ? "bad" : "ok";
  return readDir(dir).filter((name) => !name.startsWith(other));
}

const SHAPES: [RegExp, CdsShape][] = [
  [/define\s+root\s+view\s+entity/i, "root-view-entity"],
  [/define\s+(?:transient\s+)?view\s+entity/i, "view-entity"],
  [/define\s+abstract\s+entity/i, "abstract-entity"],
  [/define\s+custom\s+entity/i, "custom-entity"],
  [/define\s+transactional\s+interface/i, "transactional-interface"],
  [/define\s+view\s+/i, "classic-view"],
];

/** A minimal stand-in for `ddls.ts` — see the file header. */
function parseDdlsFixture(source: string, filename: string): CdsEntityInfo | undefined {
  const text = source.replace(/\/\/[^\n]*/g, "");
  const named = /define\s+(?:root\s+)?(?:transient\s+)?(?:abstract\s+entity|view\s+entity|custom\s+entity|transactional\s+interface|view)\s+([A-Za-z0-9_/]+)/i.exec(
    text,
  );
  if (named === null) return undefined;
  const name = named[1] as string;
  const shape = SHAPES.find(([re]) => re.test(text))?.[1] ?? "unknown";
  const projection = /as\s+projection\s+on\s+([A-Za-z0-9_/]+)/i.exec(text);

  const open = text.indexOf("{", named.index);
  const fields: { name: string; key: boolean }[] = [];
  if (open !== -1) {
    let depth = 0;
    let close = open;
    for (let i = open; i < text.length; i += 1) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    for (const raw of text.slice(open + 1, close).split(",")) {
      const part = raw.replace(/@\S+\s*:\s*\S+/g, "").trim();
      if (part === "") continue;
      const key = /^key\s/i.test(part);
      const tokens = part.replace(/^key\s+/i, "").match(/[A-Za-z_][A-Za-z0-9_]*/g);
      const last = tokens?.[tokens.length - 1];
      if (last !== undefined) fields.push({ name: last, key });
    }
  }

  return {
    name,
    key: name.toUpperCase(),
    shape,
    ...(projection !== null ? { projectionOn: projection[1] as string } : {}),
    fields,
    associations: [],
    filename,
  };
}

function parseBdefFixture(filename: string, source: string): ParsedBdef {
  const parsed = parseBehaviorDefinition(source, filename);
  return {
    filename,
    source,
    ast: parsed.ast,
    errors: parsed.errors,
    unknown: parsed.unknown,
    truncated: parsed.truncated,
  };
}

interface VariantRun {
  findings: RapFinding[];
  suppressedByUnknown: number;
  ruleErrors: number;
}

/** Runs the FULL registry over one fixture variant — never a single rule. */
function runVariant(rule: string, variant: "ok" | "bad"): VariantRun {
  const dir = join(RULES_DIR, rule);
  const bdefs: ParsedBdef[] = [];
  const cds = new Map<string, CdsEntityInfo>();
  // The file under test first, so `resolveBase()` never resolves to itself.
  for (const name of filesFor(dir, variant).sort((a, b) => Number(b.startsWith(variant)) - Number(a.startsWith(variant)))) {
    const source = readFileSync(join(dir, name), "utf8");
    if (name.endsWith(".bdef.asbdef")) bdefs.push(parseBdefFixture(name, source));
    else if (name.endsWith(".ddls.asddls")) {
      const info = parseDdlsFixture(source, name);
      if (info !== undefined) cds.set(info.key, info);
    }
  }
  const result = runBdefRules({ bdefs, cds, maxFindings: 10_000 });
  return {
    findings: result.findings,
    suppressedByUnknown: result.suppressedByUnknown,
    ruleErrors: result.ruleErrors,
  };
}

/* -------------------------------------------------------------- the tests */

describe("rule registry integrity", () => {
  it("registers unique ids and complete metadata", () => {
    const ids = RAP_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const rule of RAP_RULES) {
      expect(rule.title.length).toBeGreaterThan(0);
      expect(rule.hint.length).toBeGreaterThan(0);
      expect(rule.sourceUrl.startsWith("https://")).toBe(true);
      expect(rule.docsAnchor).toBe(rule.id.toLowerCase());
    }
  });

  it("gives every registered rule an ok and a bad fixture", () => {
    const missing = RAP_RULES.filter(
      (rule) =>
        !existsSync(join(RULES_DIR, rule.id, "ok.bdef.asbdef")) ||
        !existsSync(join(RULES_DIR, rule.id, "bad.bdef.asbdef")),
    ).map((rule) => rule.id);
    expect(missing).toEqual([]);
  });

  it("has no RAP fixture directory without a rule", () => {
    // Scoped to the `RAP…` ids this registry owns. `SRVD…` directories under
    // the same root belong to srvd.ts and are policed by rap-srvd.test.ts.
    const known = new Set(RAP_RULES.map((rule) => rule.id));
    const orphans = readdirSync(RULES_DIR).filter((entry) => entry.startsWith("RAP") && !known.has(entry));
    expect(orphans).toEqual([]);
  });

  it("caps non-confirmed rules at warning (spec §2.5)", () => {
    const violations = RAP_RULES.filter(
      (rule) => rule.confidence !== "confirmed" && rule.severity === "error",
    ).map((rule) => rule.id);
    expect(violations).toEqual([]);
  });
});

describe.each(RAP_RULES.map((rule) => [rule.id, rule] as const))("%s", (id, rule) => {
  const bad = runVariant(id, "bad");
  const ok = runVariant(id, "ok");

  it("fires on the bad fixture", () => {
    const hits = bad.findings.filter((finding) => finding.rule === id);
    expect(hits.length, `expected ${id}; got ${JSON.stringify(bad.findings.map((f) => f.rule))}`)
      .toBeGreaterThanOrEqual(1);
    for (const hit of hits) {
      expect(hit.severity).toBe(rule.severity);
      expect(hit.confidence).toBe(rule.confidence);
      expect(hit.hint.length).toBeGreaterThan(0);
      expect(hit.line).toBeGreaterThanOrEqual(1);
      expect(hit.column).toBeGreaterThanOrEqual(1);
      expect(hit.docsUrl).toContain(`#${id.toLowerCase()}`);
      expect(hit.sourceUrl).toBe(rule.sourceUrl);
      if (rule.confidence !== "confirmed") expect(hit.message).toMatch(/\[[^\]]*treat as advisory\]$/);
    }
  });

  it("stays silent on the ok fixture", () => {
    expect(ok.findings.filter((finding) => finding.rule === id)).toEqual([]);
  });

  it("provokes only the collateral it is allowed to", () => {
    const allowed = new Set([id, ...(ALSO_EXPECTED[id] ?? [])]);
    const collateral = [
      ...new Set(
        bad.findings
          .filter((finding) => finding.severity !== "info" && !allowed.has(finding.rule))
          .map((finding) => finding.rule),
      ),
    ].sort();
    expect(collateral).toEqual([]);
  });

  it("keeps both fixtures parseable and no rule throws", () => {
    for (const [variant, run] of [
      ["ok", ok],
      ["bad", bad],
    ] as const) {
      expect(run.ruleErrors).toBe(0);
      const structural = run.findings.filter((f) => f.rule === "RAP-PARSE" || f.rule === "RAP000");
      const expected = variant === "bad" && (id === "RAP-PARSE" || id === "RAP000") ? id : undefined;
      expect(structural.every((f) => f.rule === expected)).toBe(true);
    }
  });
});

describe("suppression contract (spec §3.7)", () => {
  it("does not claim a missing draft table when a statement was skipped", () => {
    const source =
      "managed implementation in class zbp_r_demo unique;\n" +
      "with draft;\n\n" +
      "define behavior for ZR_Demo alias Demo\n" +
      "persistent table zdemo\n" +
      "draft tabel zdemo_d\n" +
      "lock master total etag LastChangedAt\n" +
      "authorization master ( global )\n" +
      "etag master LocalLastChangedAt\n" +
      "{\n  create;\n}\n";
    const result = runBdefRules({ bdefs: [parseBdefFixture("suppressed.bdef.asbdef", source)] });
    expect(result.findings.filter((f) => f.rule === "RAP026")).toEqual([]);
    expect(result.suppressedByUnknown).toBeGreaterThanOrEqual(1);
  });
});

describe("cross-file resolution is evidence-led (review finding: rules.ts §resolveBase)", () => {
  const projection = [
    "projection;",
    "",
    "define behavior for ZC_X alias X",
    "{",
    "  use create;",
    "  use update;",
    "}",
    "",
  ].join("\n");
  const unrelatedBase = [
    "managed implementation in class zbp_b unique;",
    "",
    "define behavior for ZR_B alias B",
    "persistent table zb",
    "lock master",
    "authorization master ( instance )",
    "{",
    "  update;",
    "}",
    "",
  ].join("\n");

  function withProjectionOn(target: string): ReturnType<typeof runBdefRules> {
    const cds = new Map<string, CdsEntityInfo>([
      [
        "ZC_X",
        {
          name: "ZC_X",
          key: "ZC_X",
          shape: "root-view-entity",
          projectionOn: target,
          fields: [],
          associations: [],
          filename: "zc_x.ddls.asddls",
        },
      ],
    ]);
    return runBdefRules({
      bdefs: [parseBdefFixture("zc_x.bdef.asbdef", projection), parseBdefFixture("zr_b.bdef.asbdef", unrelatedBase)],
      cds,
      maxFindings: 10_000,
    });
  }

  it("stays unresolved — and silent — when the stated base is not among the supplied BDEFs", () => {
    const result = withProjectionOn("ZR_A");
    // Falling through to the alias / single-candidate heuristics matched the
    // unrelated ZR_B by its coincident alias and reported confirmed RAP060
    // errors about a base this projection demonstrably does not use.
    expect(result.findings.filter((f) => f.rule === "RAP060")).toEqual([]);
    expect(result.baseUnresolved).toBeGreaterThanOrEqual(1);
  });

  it("still resolves — and still reports — when the stated base IS supplied", () => {
    const result = withProjectionOn("ZR_B");
    expect(result.findings.some((f) => f.rule === "RAP060")).toBe(true);
    expect(result.baseUnresolved).toBe(0);
  });
});

describe("suppression applies to the file the evidence would be in (review finding: rules.ts §RAP008)", () => {
  const strictProjection = [
    "projection;",
    "strict ( 2 );",
    "",
    "define behavior for ZC_X alias X",
    "{",
    "  use create;",
    "}",
    "",
  ].join("\n");

  function baseWithHeader(extra: string): string {
    return [
      "managed implementation in class zbp_x unique;",
      extra,
      "",
      "define behavior for ZR_X alias X",
      "persistent table zx",
      "lock master",
      "authorization master ( instance )",
      "{",
      "  create;",
      "}",
      "",
    ].join("\n");
  }

  it("keeps RAP008 silent when the BASE holds an unreadable header statement that could be `strict`", () => {
    const result = runBdefRules({
      bdefs: [
        parseBdefFixture("zc_x.bdef.asbdef", strictProjection),
        parseBdefFixture("zr_x.bdef.asbdef", baseWithHeader("frobnicate wibble;")),
      ],
      maxFindings: 10_000,
    });
    expect(result.findings.filter((f) => f.rule === "RAP008")).toEqual([]);
    expect(result.suppressedByUnknown).toBeGreaterThanOrEqual(1);
  });

  it("still reports RAP008 when the base header is fully readable and simply is not strict", () => {
    const result = runBdefRules({
      bdefs: [
        parseBdefFixture("zc_x.bdef.asbdef", strictProjection),
        parseBdefFixture("zr_x.bdef.asbdef", baseWithHeader("with draft;")),
      ],
      maxFindings: 10_000,
    });
    expect(result.findings.some((f) => f.rule === "RAP008")).toBe(true);
  });
});

/* --------------------------------------------------------- anti-noise gate */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

interface CorpusExpectations {
  note: string;
  byRule: Record<string, number>;
  files: Record<string, Record<string, number>>;
}

/**
 * One rule pass per source repository, because that is the unit a caller
 * actually has: the BDEFs of one BO family in one call. Mixing 17 unrelated
 * repositories into one context would make `resolveBase()` guess across
 * projects and prove nothing.
 */
function runCorpus(): { report: CorpusExpectations; ruleErrors: number } {
  const repos = readdirSync(FIXTURES_DIR).filter((entry) =>
    statSync(join(FIXTURES_DIR, entry)).isDirectory(),
  );
  const byRule: Record<string, number> = {};
  const files: Record<string, Record<string, number>> = {};
  let ruleErrors = 0;

  for (const repo of repos.sort()) {
    const bdefs = walk(join(FIXTURES_DIR, repo))
      .filter((file) => file.endsWith(".bdef.asbdef"))
      .sort()
      .map((file) => parseBdefFixture(file.split("/").pop() as string, readFileSync(file, "utf8")));
    if (bdefs.length === 0) continue;
    const result = runBdefRules({ bdefs, maxFindings: 10_000 });
    ruleErrors += result.ruleErrors;
    for (const finding of result.findings) {
      byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1;
      const key = `${repo}/${finding.file}`;
      const bucket = (files[key] ??= {});
      bucket[finding.rule] = (bucket[finding.rule] ?? 0) + 1;
    }
  }

  const sorted = (record: Record<string, number>): Record<string, number> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));

  return {
    ruleErrors,
    report: {
      note:
        "Findings the v1 RAP rule set produces on the Apache-2.0 SAP sample corpus in " +
        "evals/rap/fixtures. Pinned so a false-positive regression fails CI. Regenerate with " +
        "RAP_WRITE_EXPECTATIONS=1 npx vitest run src/__tests__/rap-rules.test.ts",
      byRule: sorted(byRule),
      files: Object.fromEntries(
        Object.entries(files)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([file, rules]) => [file, sorted(rules)]),
      ),
    },
  };
}

describe("anti-noise gate over the 79-file corpus", () => {
  const { report, ruleErrors } = runCorpus();

  if (process.env.RAP_WRITE_EXPECTATIONS === "1") {
    mkdirSync(dirname(EXPECTATIONS), { recursive: true });
    writeFileSync(EXPECTATIONS, `${JSON.stringify(report, null, 2)}\n`);
  }

  it("never reports the corpus as syntactically broken or unrecognised", () => {
    expect(report.byRule["RAP-PARSE"] ?? 0).toBe(0);
    expect(report.byRule["RAP000"] ?? 0).toBe(0);
    expect(ruleErrors).toBe(0);
  });

  it("matches the pinned expectation file", () => {
    expect(existsSync(EXPECTATIONS)).toBe(true);
    const pinned = JSON.parse(readFileSync(EXPECTATIONS, "utf8")) as CorpusExpectations;
    expect(report.byRule).toEqual(pinned.byRule);
    expect(report.files).toEqual(pinned.files);
  });
});
