/**
 * `checkRapBehavior()` — the report contract (spec §2.7 / §4.1), the
 * classification and cap behaviour around it, the `lint_abap` merge adapter
 * (§5.2), and the hallucination seeds from §6.4's last row: one deterministic
 * case per RAP defect a model is known to invent.
 *
 * The rule bodies themselves are covered by `rap-rules.test.ts`'s golden
 * fixtures; what is tested here is the assembly — which file went to which
 * parser, what the summary counts, and what the report promises.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { MAX_FINDINGS } from "../abap/engine.js";
import { RAP_RULES } from "../abap/rap/rules.js";
import { SRVD_RULES, parseServiceDefinition } from "../abap/rap/srvd.js";
import {
  MAX_RAP_FILES,
  RAP_GRAMMAR_VERSION,
  RAP_RULES_VERSION,
  RAP_SCOPE_NOTE,
  checkRapBehavior,
  classifyRapSource,
  containsRapFiles,
  rapFindingsToLintFindings,
} from "../abap/rap/index.js";

const ROOT_BDEF = `managed implementation in class zbp_travel unique;
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

const ROOT_DDLS = `@AccessControl.authorizationCheck: #NOT_REQUIRED
define root view entity ZR_Travel
  as select from ztravel
{
  key travel_id as TravelId,
      local_last_changed_at as LocalLastChangedAt
}
`;

const SERVICE = `@EndUserText.label: 'Travel service'
define service ZUI_TRAVEL_V4 {
  expose ZC_Travel as Travel;
}
`;

describe("classification", () => {
  it("keys off the filename when one is given", () => {
    expect(classifyRapSource("anything", "zr_travel.bdef.asbdef")).toBe("bdef");
    expect(classifyRapSource("anything", "zui_travel_v4.srvd.srvdsrv")).toBe("srvd");
    expect(classifyRapSource("anything", "zr_travel.ddls.asddls")).toBe("ddls");
    expect(classifyRapSource("anything", "zcl_travel.clas.abap")).toBe("unsupported");
  });

  it("sniffs the source when no filename is given", () => {
    expect(classifyRapSource(ROOT_BDEF)).toBe("bdef");
    expect(classifyRapSource(SERVICE)).toBe("srvd");
    expect(classifyRapSource(ROOT_DDLS)).toBe("ddls");
    expect(classifyRapSource("projection;\n\ndefine behavior for ZC_X alias X\n{\n}\n")).toBe("bdef");
    expect(classifyRapSource("define behavior for ZR_X alias X\n{\n}\n")).toBe("bdef");
    expect(classifyRapSource("CLASS zcl_x DEFINITION.\nENDCLASS.")).toBe("unsupported");
  });

  it("names an unnamed source after the object it defines", () => {
    const report = checkRapBehavior([{ source: ROOT_BDEF }, { source: SERVICE }]);
    expect(report.files.map((f) => f.filename)).toEqual(["zr_travel.bdef.asbdef", "zui_travel_v4.srvd.srvdsrv"]);
  });

  it("reports an unsupported file instead of guessing at it", () => {
    const report = checkRapBehavior([
      { filename: "zr_travel.bdef.asbdef", source: ROOT_BDEF },
      { filename: "zcl_travel.clas.abap", source: "CLASS zcl_travel DEFINITION.\nENDCLASS." },
    ]);
    const unsupported = report.files.find((f) => f.kind === "unsupported")!;
    expect(unsupported.filename).toBe("zcl_travel.clas.abap");
    expect(unsupported.parsed).toBe(false);
    expect(report.summary.filesChecked).toBe(1);
    expect(report.findings.every((f) => f.file !== "zcl_travel.clas.abap")).toBe(true);
  });

  it("containsRapFiles is what lint_abap routes on", () => {
    expect(containsRapFiles([{ filename: "zr_travel.bdef.asbdef", source: ROOT_BDEF }])).toBe(true);
    expect(containsRapFiles([{ filename: "zui_travel_v4.srvd.srvdsrv", source: SERVICE }])).toBe(true);
    expect(containsRapFiles([{ filename: "zr_travel.ddls.asddls", source: ROOT_DDLS }])).toBe(false);
    expect(containsRapFiles([{ filename: "zcl_x.clas.abap", source: "CLASS zcl_x DEFINITION.\nENDCLASS." }])).toBe(false);
  });
});

describe("the report contract", () => {
  it("stamps grammar, rules and the scope note verbatim on every report", () => {
    const report = checkRapBehavior([{ filename: "zr_travel.bdef.asbdef", source: ROOT_BDEF }]);
    expect(report.scopeNote).toBe(RAP_SCOPE_NOTE);
    expect(report.grammarVersion).toBe(RAP_GRAMMAR_VERSION);
    expect(report.rulesVersion).toBe(RAP_RULES_VERSION);
    expect(report.validated).toBe("rap-checker");
    expect(report.releaseGate).toBeUndefined();
  });

  it("counts a clean BDEF + CDS + service as clean", () => {
    const report = checkRapBehavior([
      { filename: "zr_travel.bdef.asbdef", source: ROOT_BDEF },
      { filename: "zr_travel.ddls.asddls", source: ROOT_DDLS },
    ]);
    expect(report.findings).toEqual([]);
    expect(report.summary).toMatchObject({ errors: 0, warnings: 0, infos: 0, filesChecked: 2, truncated: false });
    expect(report.files.find((f) => f.kind === "ddls")!.parsed).toBe(true);
    expect(report.files.find((f) => f.kind === "bdef")!.entityCount).toBe(1);
  });

  it("sorts findings by file, line, column, rule", () => {
    const report = checkRapBehavior([
      { filename: "zb.bdef.asbdef", source: "managed implementation in class zbp_b unique;\nstrict ( 2 );\nwith draft;\n\ndefine behavior for ZR_B alias B\npersistent table zb\nlock master\n{\n  create;\n}\n" },
      { filename: "za.bdef.asbdef", source: "managed implementation in class zbp_a unique;\nstrict ( 2 );\nwith draft;\n\ndefine behavior for ZR_A alias A\npersistent table za\nlock master\n{\n  create;\n}\n" },
    ]);
    const keys = report.findings.map((f) => [f.file, f.line, f.column, f.rule] as const);
    const sorted = [...keys].sort(
      (a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2] - b[2] || a[3].localeCompare(b[3]),
    );
    expect(keys).toEqual(sorted);
    expect(report.findings[0]!.file).toBe("za.bdef.asbdef");
  });

  it("resolves every docsUrl to one shape — the published RAP-RULES.md", () => {
    const report = checkRapBehavior([
      {
        filename: "zr_broken.bdef.asbdef",
        source: "managed implementation in class zbp_b unique;\nstrict ( 2 );\nwith draft;\n\ndefine behavior for ZR_B alias B\npersistent table zb\netag master LocalLastChangedAt\nlock master\nauthorization master ( instance )\n{\n  create;\n}\n",
      },
      { filename: "zui_x.srvd.srvdsrv", source: "define service ZUI_X {\n  expose ZC_X as X;\n}\n" },
    ]);
    expect(report.findings.length).toBeGreaterThan(0);
    for (const finding of report.findings) {
      expect(finding.docsUrl).toMatch(/^https:\/\/github\.com\/.+\/docs\/RAP-RULES\.md#/);
      expect(finding.sourceUrl).toMatch(/^https?:\/\//);
    }
  });

  it("runs the SRVD rule block and reports the service's own defects", () => {
    const report = checkRapBehavior([
      {
        filename: "zui_bad.srvd.srvdsrv",
        source: "define service ZUI_BAD\n  provider contracts odata_v4_web_api\n{\n  expose ZC_X as X;\n}\n",
      },
    ]);
    expect(report.findings.map((f) => f.rule)).toContain("SRVD002");
    expect(report.files[0]).toMatchObject({ kind: "srvd", parsed: true, exposeCount: 1 });
    expect(report.summary.rulesRun).toBeGreaterThanOrEqual(7);
  });

  /**
   * §1.3's two tiers are exclusive, and the SDL side now says so too. This
   * test used to pin the opposite — a punctuation error in a SRVD produced
   * BOTH a `RAP-PARSE` error and a `RAP000` info for the same span, while the
   * identical defect in a BDEF produced only the error. Amended with the
   * verification fix pass (spec §9, "Amendments after verification"): one
   * defect, one finding, and RAP000's message ("a limit of the checker, not
   * necessarily an error in your file") is never attached to text that failed
   * to reduce. §3.7's suppression is unaffected — it reads `errors` as well as
   * `unknown`, which the SRVD001 assertion below proves.
   */
  it("reports a broken service definition as RAP-PARSE only — the same tiering as a BDEF", () => {
    const report = checkRapBehavior([
      // Unterminated EXPOSE: punctuation-level breakage, the error tier of §1.3.
      { filename: "zui_broken.srvd.srvdsrv", source: "define service ZUI_BROKEN {\n  expose ZC_X as X\n}\n" },
    ]);
    const parse = report.findings.filter((f) => f.rule === "RAP-PARSE");
    expect(parse.length).toBeGreaterThan(0);
    expect(parse[0]!.severity).toBe("error");
    expect(parse[0]!.file).toBe("zui_broken.srvd.srvdsrv");
    expect(report.files[0]!.parsed).toBe(false);
    expect(report.files[0]!.parserErrors.length).toBeGreaterThan(0);
    // No second, contradictory finding for the same span.
    expect(report.findings.filter((f) => f.rule === "RAP000")).toEqual([]);
    expect(report.summary.unknownConstructs).toBe(0);
    // …and the file whose EXPOSE we failed to read is still not accused of
    // exposing nothing: the suppression counted it instead (§3.7).
    expect(report.findings.filter((f) => f.rule === "SRVD001")).toEqual([]);
    expect(report.summary.suppressedByUnknown).toBeGreaterThan(0);

    // The BDEF half of the same contract, asserted side by side so the two
    // parsers cannot drift apart again.
    const bdef = checkRapBehavior([
      { filename: "zr_broken2.bdef.asbdef", source: "managed implementation in class zbp_b unique;\n\ndefine behavior for ZR_B alias B\npersistent table zb\nlock master\n{\n  create\n}\n" },
    ]);
    expect(bdef.findings.some((f) => f.rule === "RAP-PARSE")).toBe(true);
    expect(bdef.findings.filter((f) => f.rule === "RAP000")).toEqual([]);
  });

  it("still reports an unknown-but-well-formed SDL statement as RAP000 info", () => {
    const report = checkRapBehavior([
      { filename: "zui_pub.srvd.srvdsrv", source: "define service ZUI_PUB {\n  expose ZC_X as X;\n  publish ZC_Y as Y;\n}\n" },
    ]);
    const unknown = report.findings.filter((f) => f.rule === "RAP000");
    expect(unknown.length).toBe(1);
    expect(unknown[0]!.severity).toBe("info");
    expect(unknown[0]!.message).toContain("limit of the checker");
    expect(report.summary.unknownConstructs).toBe(1);
    expect(report.findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("passes abaplint's own cds_parser_error through for a broken CDS view", () => {
    const report = checkRapBehavior([
      { filename: "zr_travel.bdef.asbdef", source: ROOT_BDEF },
      { filename: "zbad.ddls.asddls", source: "define view entity ZBad as select from\n" },
    ]);
    const cds = report.findings.find((f) => f.rule === "cds_parser_error");
    expect(cds).toBeDefined();
    expect(cds!.confidence).toBe("confirmed");
    expect(report.files.find((f) => f.filename === "zbad.ddls.asddls")!.parsed).toBe(false);
  });

  it("adds the release gate block only when a target release is passed", () => {
    const collaborative =
      "managed implementation in class zbp_c unique;\nstrict ( 2 );\nwith collaborative draft;\n\n" +
      "define behavior for ZR_C alias C\npersistent table zc\ndraft table zc_d\netag master LocalLastChangedAt\n" +
      "lock master total etag LastChangedAt\nauthorization master ( instance )\n{\n  create;\n  update;\n  delete;\n\n" +
      "  draft action Edit;\n  draft action Resume;\n  draft action Activate optimized;\n  draft action Discard;\n" +
      "  draft determine action Prepare;\n}\n";
    const gated = checkRapBehavior([{ filename: "zr_c.bdef.asbdef", source: collaborative }], { abapRelease: "2502" });
    expect(gated.releaseGate).toMatchObject({ abapRelease: "2502" });
    expect(gated.releaseGate!.gatedConstructs).toBeGreaterThan(0);
    const gate = gated.findings.find((f) => f.rule === "RAP900")!;
    expect(gate.severity).toBe("warning");
    expect(gate.minRelease).toBe("2508");

    const current = checkRapBehavior([{ filename: "zr_c.bdef.asbdef", source: collaborative }], { abapRelease: "2508" });
    expect(current.findings.some((f) => f.rule === "RAP900")).toBe(false);
    expect(current.releaseGate!.gatedConstructs).toBe(0);
  });

  it("runs the strict rules on demand for a BDEF that does not declare strict", () => {
    const lax =
      "managed implementation in class zbp_l unique;\n\ndefine behavior for ZR_L alias L\npersistent table zl\n" +
      "etag master LocalLastChangedAt\nlock master\n{\n  create;\n  update;\n  delete;\n}\n";
    const off = checkRapBehavior([{ filename: "zr_l.bdef.asbdef", source: lax }]);
    // Only the info that strict is missing — no strict rule fires uninvited.
    expect(off.findings.map((f) => f.rule)).toContain("RAP-STRICT-MISSING");
    expect(off.summary.errors).toBe(0);

    const forced = checkRapBehavior([{ filename: "zr_l.bdef.asbdef", source: lax }], { strict: true });
    // RAP029: strict mode requires exactly one authorization master.
    expect(forced.findings.map((f) => f.rule)).toContain("RAP029");
    expect(forced.summary.rulesRun).toBeGreaterThan(off.summary.rulesRun);
  });

  it("honours maxFindings and reports the truncation", () => {
    const report = checkRapBehavior([{ filename: "zr_broken.bdef.asbdef", source: "managed implementation in class zbp_b unique;\nstrict ( 2 );\nwith draft;\n\ndefine behavior for ZR_B alias B\npersistent table zb\nlock master\n{\n  create;\n}\n" }], { maxFindings: 1 });
    expect(report.findings.length).toBe(1);
    expect(report.summary.truncated).toBe(true);
  });

  it("counts severities over the UNCAPPED finding set and says how many were dropped", () => {
    const broken =
      "managed implementation in class zbp_b unique;\nstrict ( 2 );\nwith draft;\n\ndefine behavior for ZR_B alias B\npersistent table zb\nlock master\n{\n  create;\n}\n";
    const full = checkRapBehavior([{ filename: "zr_broken.bdef.asbdef", source: broken }]);
    expect(full.summary.errors).toBeGreaterThan(0);
    expect(full.summary.omitted).toBe(0);

    // maxFindings: 0 keeps nothing at all — the counts must still describe
    // the file, or every gate keyed to `summary.errors` reads a capped run as
    // a clean one.
    const capped = checkRapBehavior([{ filename: "zr_broken.bdef.asbdef", source: broken }], { maxFindings: 0 });
    expect(capped.findings).toEqual([]);
    expect(capped.summary.errors).toBe(full.summary.errors);
    expect(capped.summary.warnings).toBe(full.summary.warnings);
    expect(capped.summary.infos).toBe(full.summary.infos);
    expect(capped.summary.omitted).toBe(full.findings.length);
    expect(capped.summary.truncated).toBe(true);
  });

  it("ORs truncation from the SDL parser, not only from the BDEF rule run", () => {
    const body = Array.from({ length: 400 }, () => "  frobnicate zzz;").join("\n");
    const source = `define service Z_TRUNC {\n${body}\n}\n`;
    // The SDL parser stops at its 200-recovery cap; the report used to say
    // `truncated: false` because only the BDEF half of the OR was read.
    expect(parseServiceDefinition(source, "z.srvd.srvdsrv").truncated).toBe(true);
    expect(checkRapBehavior([{ filename: "z.srvd.srvdsrv", source }]).summary.truncated).toBe(true);
  });

  it("counts an unresolved projection base instead of guessing one", () => {
    const report = checkRapBehavior([
      { filename: "zc_x.bdef.asbdef", source: "projection;\n\ndefine behavior for ZC_X alias X\n{\n  use create;\n}\n" },
      {
        filename: "zr_b.bdef.asbdef",
        source:
          "managed implementation in class zbp_b unique;\n\ndefine behavior for ZR_B alias B\npersistent table zb\nlock master\nauthorization master ( instance )\n{\n  update;\n}\n",
      },
      { filename: "zc_x.ddls.asddls", source: "define root view entity ZC_X as projection on ZR_A\n{\n  key Id\n}\n" },
    ]);
    expect(report.findings.filter((f) => f.rule === "RAP060")).toEqual([]);
    expect(report.summary.baseUnresolved).toBeGreaterThanOrEqual(1);
  });

  it("never throws on hostile input — a parser blow-up becomes a finding on that file", () => {
    const hostile = `@Foo: ${"[".repeat(10_000)}\ndefine service Z { expose ZC_X; }\n`;
    const report = checkRapBehavior([
      { filename: "zhostile.srvd.srvdsrv", source: hostile },
      { filename: "zr_travel.bdef.asbdef", source: ROOT_BDEF },
    ]);
    expect(report.findings.some((f) => f.rule === "RAP-PARSE" && f.file === "zhostile.srvd.srvdsrv")).toBe(true);
    expect(report.summary.errors).toBeGreaterThanOrEqual(1);
    // The other file in the same call is still checked.
    expect(report.files.find((f) => f.filename === "zr_travel.bdef.asbdef")!.parsed).toBe(true);
  });

  it("enforces the library's own input bounds", () => {
    expect(() => checkRapBehavior([])).toThrow(/at least one source/i);
    const many = Array.from({ length: MAX_RAP_FILES + 1 }, () => ({ source: ROOT_BDEF }));
    expect(() => checkRapBehavior(many)).toThrow(new RegExp(`At most ${MAX_RAP_FILES} files`));
    expect(() => checkRapBehavior([{ source: "x".repeat(100_001) }])).toThrow(/exceeds 100000 characters/);
  });
});

describe("lint_abap merge adapter (spec §5.2)", () => {
  it("namespaces the rule key, maps the severity casing and keeps the hint", () => {
    const report = checkRapBehavior([
      {
        filename: "zr_broken.bdef.asbdef",
        source: "managed implementation in class zbp_b unique;\nstrict ( 2 );\nwith draft;\n\ndefine behavior for ZR_B alias B\npersistent table zb\netag master LocalLastChangedAt\nlock master\nauthorization master ( instance )\n{\n  create;\n}\n",
      },
    ]);
    const lint = rapFindingsToLintFindings(report.findings);
    expect(lint.length).toBe(report.findings.length);
    for (const [i, finding] of lint.entries()) {
      const source = report.findings[i]!;
      expect(finding.rule).toBe(`rap/${source.rule}`);
      expect(finding.severity).toBe(
        source.severity === "error" ? "Error" : source.severity === "warning" ? "Warning" : "Info",
      );
      expect(finding.message).toContain(source.hint);
      expect(finding.docsUrl.length).toBeGreaterThan(0);
    }
  });

  it("drops cds_parser_error — the same lint call already ran abaplint over that file", () => {
    const report = checkRapBehavior([
      { filename: "zr_travel.bdef.asbdef", source: ROOT_BDEF },
      { filename: "zbad.ddls.asddls", source: "define view entity ZBad as select from\n" },
    ]);
    expect(report.findings.some((f) => f.rule === "cds_parser_error")).toBe(true);
    expect(rapFindingsToLintFindings(report.findings).some((f) => f.rule.endsWith("cds_parser_error"))).toBe(false);
  });

  it("stays inside the shared finding cap", () => {
    const report = checkRapBehavior([{ filename: "zr_travel.bdef.asbdef", source: ROOT_BDEF }]);
    expect(rapFindingsToLintFindings(report.findings).length).toBeLessThanOrEqual(MAX_FINDINGS);
  });
});

/**
 * Spec §6.4's hallucination seeds (F14). Each source is a RAP defect a model
 * has actually been observed to invent; each must be caught by exactly the
 * rule the catalog assigns, at error severity.
 */
describe("hallucination seeds", () => {
  const header = "managed implementation in class zbp_h unique;\nstrict ( 2 );\n\n";
  const characteristics =
    "persistent table zh\netag master LocalLastChangedAt\nlock master\nauthorization master ( instance )\n";

  const cases: { name: string; rule: string; files: { filename: string; source: string }[] }[] = [
    {
      name: "an invented draft action name (draft action Reject) → RAP081",
      rule: "RAP081",
      files: [
        {
          filename: "zr_h.bdef.asbdef",
          source: `${header}define behavior for ZR_H alias H\n${characteristics}{\n  create;\n  draft action Reject;\n}\n`,
        },
      ],
    },
    {
      name: "a factory action with a result clause → RAP048",
      rule: "RAP048",
      files: [
        {
          filename: "zr_h.bdef.asbdef",
          source: `${header}define behavior for ZR_H alias H\n${characteristics}{\n  create;\n  factory action copy [1] result [1] $self;\n}\n`,
        },
      ],
    },
    {
      name: "with draft declared on the entity instead of the header → RAP024",
      rule: "RAP024",
      files: [
        {
          filename: "zr_h.bdef.asbdef",
          source: `${header}define behavior for ZR_H alias H\n${characteristics}with draft\n{\n  create;\n}\n`,
        },
      ],
    },
    {
      name: "a misspelled provider contract (odata_v4_web_api) → SRVD002",
      rule: "SRVD002",
      files: [
        {
          filename: "zui_h.srvd.srvdsrv",
          source: "define service ZUI_H\n  provider contracts odata_v4_web_api\n{\n  expose ZC_H as H;\n}\n",
        },
      ],
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const report = checkRapBehavior(testCase.files);
      const hit = report.findings.find((f) => f.rule === testCase.rule);
      expect(hit, `expected ${testCase.rule}; got ${report.findings.map((f) => f.rule).join(", ") || "nothing"}`).toBeDefined();
      expect(hit!.severity).toBe("error");
      expect(hit!.confidence).toBe("confirmed");
      // The seed must be caught by a rule, never by the parser bailing out.
      expect(report.findings.some((f) => f.rule === "RAP-PARSE")).toBe(false);
    });
  }
});

/**
 * Spec §6.2's docs meta-test: a finding's `docsUrl` is `docs/RAP-RULES.md`
 * plus the lower-cased rule id, so every shipped rule needs a heading there.
 * Without this the anchors rot silently the first time a rule is added.
 */
describe("docs/RAP-RULES.md", () => {
  const doc = readFileSync(new URL("../../docs/RAP-RULES.md", import.meta.url), "utf8");
  const ids = [...RAP_RULES.map((r) => r.id), ...SRVD_RULES.map((r) => r.id), "RAP900"];

  for (const id of ids) {
    it(`documents ${id} under an anchor its docsUrl resolves to`, () => {
      // A GitHub heading anchor is the slugified heading text; a heading that
      // is exactly the id slugifies to exactly the lower-cased id.
      expect(doc).toContain(`### ${id}\n`);
      expect(doc).toContain(`(#${id.toLowerCase()})`);
    });
  }

  it("states the grammar and rules versions the registry ships", () => {
    expect(doc).toContain(RAP_GRAMMAR_VERSION);
    expect(doc).toContain(RAP_RULES_VERSION);
  });

  it("names the rules deliberately not implemented, so the gaps are documented", () => {
    for (const deferred of ["RAP015", "RAP027", "RAP042", "RAP069", "RAP078"]) {
      expect(doc).toContain(deferred);
    }
  });
});
