/**
 * `srvd.ts`'s acceptance gate (spec §2.4 / §3.4, task deliverable):
 * every corpus `.srvd.srvdsrv` fixture parses clean, and SRVD001–SRVD007
 * each have a passing `ok` fixture and a failing `bad` fixture under
 * `evals/rap/rules/SRVDxxx/`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCdsMap } from "../abap/rap/ddls.js";
import {
  checkServiceDefinitionRules,
  parseServiceDefinition,
  SRVD_RULES,
  type CheckSrvdOptions,
} from "../abap/rap/srvd.js";

const FIXTURES = new URL("../../evals/rap/fixtures/", import.meta.url).pathname;
const RULE_FIXTURES = new URL("../../evals/rap/rules/", import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const SRVD_FILES = walk(FIXTURES)
  .filter((f) => f.endsWith(".srvd.srvdsrv"))
  .sort();

describe("SRVD corpus — the parser's acceptance gate", () => {
  it("holds at least 23 SRVD fixtures", () => {
    expect(SRVD_FILES.length).toBeGreaterThanOrEqual(23);
  });

  it("parses all corpus service definitions with zero errors and zero unknown statements", () => {
    const failures: string[] = [];
    let exposeCount = 0;

    for (const file of SRVD_FILES) {
      const name = file.replace(FIXTURES, "");
      const result = parseServiceDefinition(readFileSync(file, "utf8"), name.split("/").pop());
      for (const error of result.errors) {
        failures.push(`${name}:${error.line}:${error.column} ${error.message} | ${error.excerpt}`);
      }
      for (const unknown of result.unknown) {
        failures.push(`${name}:${unknown.range.start.line}:${unknown.range.start.column} unknown [${unknown.leadingKey}] ${unknown.text}`);
      }
      if (result.truncated) failures.push(`${name}: truncated`);
      expect(result.ast.name.name.length, name).toBeGreaterThan(0);
      exposeCount += result.ast.exposes.length;
    }

    expect(failures).toEqual([]);
    expect(exposeCount).toBeGreaterThanOrEqual(23);
  });

  it("running SRVD001-007 over the whole clean corpus produces zero findings (the fixtures are all legal service definitions)", () => {
    for (const file of SRVD_FILES) {
      const name = file.replace(FIXTURES, "").split("/").pop();
      const srvd = parseServiceDefinition(readFileSync(file, "utf8"), name);
      const findings = checkServiceDefinitionRules(srvd);
      expect(findings, `${name}: ${JSON.stringify(findings)}`).toEqual([]);
    }
  });
});

describe("bdl-grammar-notes.md §5/§6 snippets 12/13 and 9/10 (srvd kind)", () => {
  it("#12 — namespaced service name, dotted annotations, five namespaced/plain exposes", () => {
    const source = `@EndUserText.label: 'Service for managing travels'
@ObjectModel.leadingEntity.name: '/DMO/I_TRAVEL'
define service /DMO/TRAVEL
{
  expose /DMO/I_TRAVEL       as Travel;
  expose /DMO/I_AGENCY       as TravelAgency;
  expose /DMO/I_CUSTOMER     as Passenger;
  expose I_Currency          as Currency;
  expose I_Country           as Country;
}`;
    const result = parseServiceDefinition(source, "snippet.srvd.srvdsrv");
    expect(result.errors).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.ast.exposes).toHaveLength(5);
    expect(result.ast.name.name).toBe("/DMO/TRAVEL");
    // The leading entity is namespaced (/DMO/I_TRAVEL) — SRVD006 must not
    // fire on SAP-namespace exposes even when no .ddls is supplied.
    expect(checkServiceDefinitionRules(result)).toEqual([]);
  });

  it("#13 — provider contracts list plus extensibility annotation", () => {
    const source = `@AbapCatalog.extensibility.extensible: true
define service Z_TRAVEL_UI provider contracts odata_v4_ui, odata_v4_webapi
{
  expose ZC_TRAVEL_U as Travel;
}`;
    const result = parseServiceDefinition(source, "snippet.srvd.srvdsrv");
    expect(result.errors).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.ast.providerContracts.map((c) => c.key)).toEqual(["ODATA_V4_UI", "ODATA_V4_WEBAPI"]);
    // This snippet is also invalid-snippet #10 (bdl-grammar-notes §6) — the
    // parser must accept it syntactically; SRVD003 is the rule that catches it.
    const findings = checkServiceDefinitionRules(result);
    expect(findings.map((f) => f.rule)).toEqual(["SRVD003"]);
  });

  it("#9 (invalid) — a service definition exposing nothing parses clean, SRVD001 catches it", () => {
    const source = `define service Z_EMPTY_SRV
{
}`;
    const result = parseServiceDefinition(source, "snippet.srvd.srvdsrv");
    expect(result.errors).toEqual([]);
    expect(result.unknown).toEqual([]);
    const findings = checkServiceDefinitionRules(result);
    expect(findings.map((f) => f.rule)).toEqual(["SRVD001"]);
  });
});

/* ------------------------------------- annotation grammar and the two tiers
 * Every case below used to be a RAP-PARSE *error* plus, in most of them, a
 * cascaded SRVD001 "exposes nothing" about a file whose EXPOSE was right
 * there — the false positive spec §1.3 budgets against.
 */

describe("annotation values beyond a scalar (arrays, enums, nested records)", () => {
  const parseOk = (source: string): ReturnType<typeof parseServiceDefinition> => {
    const result = parseServiceDefinition(source, "z.srvd.srvdsrv");
    expect(result.errors, JSON.stringify(result.errors)).toEqual([]);
    expect(result.unknown).toEqual([]);
    return result;
  };

  it("parses an array of string literals as one leaf per element", () => {
    const result = parseOk("@Foo.bar: [ 'a', 'b' ]\ndefine service Z_S\n{\n  expose ZC_X as X;\n}\n");
    expect(result.ast.annotations.map((a) => [a.path.join("."), a.rawValue])).toEqual([
      ["Foo.bar", "a"],
      ["Foo.bar", "b"],
    ]);
    expect(result.ast.exposes).toHaveLength(1);
  });

  it("parses an empty array, which contributes no leaf", () => {
    const result = parseOk("@Foo.bar: [ ]\ndefine service Z_S\n{\n  expose ZC_X as X;\n}\n");
    expect(result.ast.annotations).toEqual([]);
    expect(result.ast.exposes).toHaveLength(1);
  });

  it("parses a `#ENUM` value, scalar and inside an array", () => {
    const result = parseOk(
      "@ObjectModel.supportedCapabilities: [ #ANALYTICAL_QUERY ]\n@Scope: #TABLE\n" +
        "define service Z_S\n{\n  expose ZC_X as X;\n}\n",
    );
    expect(result.ast.annotations.map((a) => [a.path.join("."), a.rawValue])).toEqual([
      ["ObjectModel.supportedCapabilities", "#ANALYTICAL_QUERY"],
      ["Scope", "#TABLE"],
    ]);
  });

  it("parses the corpus's own @AbapCatalog.extensibility record with an array member", () => {
    const result = parseOk(
      "@AbapCatalog.extensibility: { extensible: true, dataSources: [ '_Extension' ] }\n" +
        "define service Z_S provider contracts odata_v4_ui\n{\n  expose ZC_X as X;\n}\n",
    );
    expect(result.ast.annotations.map((a) => [a.path.join("."), a.rawValue])).toEqual([
      ["AbapCatalog.extensibility.extensible", "true"],
      ["AbapCatalog.extensibility.dataSources", "_Extension"],
    ]);
    expect(checkServiceDefinitionRules(result)).toEqual([]);
  });

  it("parses an array of records", () => {
    const result = parseOk("@Foo.bar: [ { a: 'x' } ]\ndefine service Z_S\n{\n  expose ZC_X as X;\n}\n");
    expect(result.ast.annotations.map((a) => [a.path.join("."), a.rawValue])).toEqual([["Foo.bar.a", "x"]]);
  });
});

describe("`extend service X with { … }` (spec §2.2 ServiceDefinition.form)", () => {
  it("parses the extend form and its exposes", () => {
    const result = parseServiceDefinition(
      "extend service ZUI_TRAVEL with\n{\n  expose ZC_Extra as Extra;\n}\n",
      "z.srvd.srvdsrv",
    );
    expect(result.errors).toEqual([]);
    expect(result.unknown).toEqual([]);
    expect(result.ast.form).toBe("extend");
    expect(result.ast.name.name).toBe("ZUI_TRAVEL");
    expect(result.ast.exposes.map((e) => e.entity?.name)).toEqual(["ZC_Extra"]);
    expect(checkServiceDefinitionRules(result)).toEqual([]);
  });
});

describe("SDL two-tier and §3.7 suppression", () => {
  it("treats a `;`-terminated statement outside the vocabulary as unknown, not as a parse error", () => {
    const result = parseServiceDefinition(
      "define service Z_S\n{\n  expose ZC_X as X;\n  publish ZC_Y as Y;\n}\n",
      "z.srvd.srvdsrv",
    );
    expect(result.errors).toEqual([]);
    expect(result.unknown.map((u) => u.leadingKey)).toEqual(["PUBLISH"]);
    // Recovery is per statement: the EXPOSE before it survives.
    expect(result.ast.exposes.map((e) => e.entity?.name)).toEqual(["ZC_X"]);
  });

  it("keeps SRVD001 silent — and counts the suppression — when the only body statement was skipped", () => {
    const result = parseServiceDefinition("define service Z_S\n{\n  publish ZC_Travel as Travel;\n}\n", "z.srvd.srvdsrv");
    const suppressed: string[] = [];
    const findings = checkServiceDefinitionRules(result, { onSuppressed: (id) => suppressed.push(id) });
    expect(findings).toEqual([]);
    expect(suppressed).toEqual(["SRVD001"]);
  });

  it("keeps SRVD007 silent when the expose it would name may have been skipped", () => {
    const result = parseServiceDefinition(
      "@ObjectModel.leadingEntity.name: 'ZC_Travel'\ndefine service Z_S\n{\n  publish ZC_Travel as Travel;\n}\n",
      "z.srvd.srvdsrv",
    );
    const suppressed: string[] = [];
    const findings = checkServiceDefinitionRules(result, { onSuppressed: (id) => suppressed.push(id) });
    expect(findings).toEqual([]);
    expect(suppressed.sort()).toEqual(["SRVD001", "SRVD007"]);
  });

  it("still reports SRVD001 on a service whose body is empty and fully readable", () => {
    const result = parseServiceDefinition("define service Z_EMPTY\n{\n}\n", "z.srvd.srvdsrv");
    const suppressed: string[] = [];
    const findings = checkServiceDefinitionRules(result, { onSuppressed: (id) => suppressed.push(id) });
    expect(findings.map((f) => f.rule)).toEqual(["SRVD001"]);
    expect(suppressed).toEqual([]);
  });
});

describe("the service body must actually close (review finding: srvd.ts §parse)", () => {
  it("reports an unterminated service body as RAP-PARSE instead of parsing it clean", () => {
    const result = parseServiceDefinition("define service Z { expose ZC_X;", "z.srvd.srvdsrv");
    // Used to return zero errors, zero unknowns and `parsed: true`: the
    // closing brace was merely eaten if present.
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.kind).toBe("syntax");
    expect(result.errors[0]!.message).toContain("`}`");
    // The EXPOSE it did read is still there — recovery, not abandonment.
    expect(result.ast.exposes.map((e) => e.entity?.name)).toEqual(["ZC_X"]);
  });

  it("reports a stray `}` after the service body as RAP-PARSE", () => {
    const result = parseServiceDefinition("define service Z { expose ZC_X; }\n}\n", "z.srvd.srvdsrv");
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.message).toContain("after the end of the service definition");
    expect(result.errors[0]!.line).toBe(2);
  });

  it("reports a statement after the service body as RAP-PARSE", () => {
    const result = parseServiceDefinition(
      "define service Z { expose ZC_X; }\ndefine service Z2 { expose ZC_Y; }\n",
      "z.srvd.srvdsrv",
    );
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]!.message).toContain("after the end of the service definition");
  });

  it("leaves a well-formed service definition (trailing comments and blank lines included) clean", () => {
    const result = parseServiceDefinition(
      "define service Z { expose ZC_X; }\n// a trailing comment\n\n",
      "z.srvd.srvdsrv",
    );
    expect(result.errors).toEqual([]);
    expect(result.unknown).toEqual([]);
  });
});

describe("SDL recovery checks every delimiter kind (review finding: srvd.ts §recoverFrom)", () => {
  it("reports an unbalanced `(` inside the service body as RAP-PARSE, not as a RAP000 info", () => {
    const result = parseServiceDefinition("define service Z {\n  future ( ;\n}\n", "z.srvd.srvdsrv");
    expect(result.unknown).toEqual([]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]!.message).toContain("Unbalanced");
  });

  it("still gives a balanced, unrecognised statement the info tier", () => {
    const result = parseServiceDefinition("define service Z {\n  publish ZC_X ( a, b ) as X;\n}\n", "z.srvd.srvdsrv");
    expect(result.errors).toEqual([]);
    expect(result.unknown.map((u) => u.leadingKey)).toEqual(["PUBLISH"]);
  });
});

describe("annotation nesting is bounded (review finding: srvd.ts §parseAnnotationValue)", () => {
  it("reports a 10,000-deep annotation array as RAP-PARSE instead of blowing the call stack", () => {
    const hostile = `@Foo: ${"[".repeat(10_000)}\ndefine service Z { expose ZC_X; }\n`;
    const result = parseServiceDefinition(hostile, "z.srvd.srvdsrv");
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors.some((e) => e.message.includes("nests deeper than"))).toBe(true);
  });

  it("still parses annotation nesting at ordinary depths", () => {
    const result = parseServiceDefinition(
      "@AbapCatalog.extensibility: { extensible: true, dataSources: [ '_Extension' ] }\n" +
        "define service Z { expose ZC_X; }\n",
      "z.srvd.srvdsrv",
    );
    expect(result.errors).toEqual([]);
    expect(result.ast.annotations.map((a) => a.path.join("."))).toEqual([
      "AbapCatalog.extensibility.extensible",
      "AbapCatalog.extensibility.dataSources",
    ]);
  });
});

/* --------------------------------------------------------- golden rules */

describe("SRVD001-007 golden rule fixtures", () => {
  it("has an ok/bad fixture pair for every SRVD rule (meta-test — a rule cannot ship untested)", () => {
    for (const rule of SRVD_RULES) {
      const dir = join(RULE_FIXTURES, rule.id);
      expect(readdirSync(dir).sort(), rule.id).toContain("ok.srvd.srvdsrv");
      expect(readdirSync(dir).sort().some((f) => f.startsWith("bad")), rule.id).toBe(true);
    }
  });

  for (const rule of SRVD_RULES) {
    it(`${rule.id}: ok.srvd.srvdsrv produces zero ${rule.id} findings`, () => {
      const dir = join(RULE_FIXTURES, rule.id);
      const source = readFileSync(join(dir, "ok.srvd.srvdsrv"), "utf8");
      const srvd = parseServiceDefinition(source, "ok.srvd.srvdsrv");
      expect(srvd.errors, rule.id).toEqual([]);
      const opts = rule.id === "SRVD006" ? withEntityCds(dir) : {};
      const findings = checkServiceDefinitionRules(srvd, opts).filter((f) => f.rule === rule.id);
      expect(findings, rule.id).toEqual([]);
    });

    const badFiles = (() => {
      try {
        return readdirSync(join(RULE_FIXTURES, rule.id)).filter((f) => f.startsWith("bad") && f.endsWith(".srvdsrv"));
      } catch {
        return [];
      }
    })();

    for (const badFile of badFiles) {
      it(`${rule.id}: ${badFile} produces at least one ${rule.id} finding`, () => {
        const dir = join(RULE_FIXTURES, rule.id);
        const source = readFileSync(join(dir, badFile), "utf8");
        const srvd = parseServiceDefinition(source, badFile);
        const opts = rule.id === "SRVD006" ? withEntityCds(dir) : {};
        const findings = checkServiceDefinitionRules(srvd, opts);
        expect(findings.some((f) => f.rule === rule.id), JSON.stringify(findings)).toBe(true);
      });
    }
  }

  it("policy: no rule with confidence !== 'confirmed' has severity 'error'", () => {
    for (const rule of SRVD_RULES) {
      if (rule.confidence !== "confirmed") expect(rule.severity, rule.id).not.toBe("error");
    }
  });
});

function withEntityCds(dir: string): CheckSrvdOptions {
  const entityPath = join(dir, "entity.ddls.asddls");
  const source = readFileSync(entityPath, "utf8");
  const { entities } = buildCdsMap([{ filename: "entity.ddls.asddls", source }]);
  return { cds: entities };
}
