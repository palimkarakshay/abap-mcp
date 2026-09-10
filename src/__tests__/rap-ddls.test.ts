/**
 * `ddls.ts`'s acceptance gate (spec §2.6 / task deliverable).
 *
 * Two things are asserted over the real corpus: (1) abaplint's own CDS
 * parser, read back through `buildCdsMap()`, produces a `CdsEntityInfo` for
 * every `.ddls.asddls` fixture that defines a real entity — the corpus test
 * this mirrors is `rap-corpus.test.ts`'s BDEF gate, scoped to CDS instead;
 * (2) a deliberately broken CDS view passes through as abaplint's own
 * `cds_parser_error` finding rather than being silently dropped.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildCdsMap, type CdsShape } from "../abap/rap/ddls.js";

const FIXTURES = new URL("../../evals/rap/fixtures/", import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const DDLS_FILES = walk(FIXTURES)
  .filter((f) => f.endsWith(".ddls.asddls"))
  .sort();

describe("buildCdsMap over the real corpus", () => {
  it("holds at least 141 .ddls fixtures", () => {
    expect(DDLS_FILES.length).toBeGreaterThanOrEqual(141);
  });

  it("produces a CdsEntityInfo for every fixture with a classified shape, no cds_parser_error findings", () => {
    const files = DDLS_FILES.map((f) => ({
      filename: f.replace(FIXTURES, "").replace(/\//g, "__"),
      source: readFileSync(f, "utf8"),
    }));

    const { entities, findings } = buildCdsMap(files);

    // None of the 141 real, unmodified corpus files should trip abaplint's
    // own CDS parser.
    expect(findings).toEqual([]);

    // At least one entity per fixture (a handful of corpus files may share
    // an entity name across different sample repos and legitimately
    // collapse to one map entry, so this is a floor, not an exact count).
    expect(entities.size).toBeGreaterThanOrEqual(130);

    const shapeCounts = new Map<CdsShape, number>();
    for (const info of entities.values()) {
      shapeCounts.set(info.shape, (shapeCounts.get(info.shape) ?? 0) + 1);
      // Every entity is keyed consistently and carries a non-empty name.
      expect(info.key).toBe(info.name.toUpperCase());
      expect(info.name.length).toBeGreaterThan(0);
      expect(Array.isArray(info.fields)).toBe(true);
      expect(Array.isArray(info.associations)).toBe(true);
    }

    // The corpus is dominated by real (non-classic, non-custom) view
    // entities. Exactly one fixture is a `define table function` — a real
    // CDS artifact kind `CdsShape` has no slot for (spec §2.6) — so it is
    // the only legitimate "unknown"; anything more would mean the DEFINE
    // classifier stopped recognising a real construct.
    expect(shapeCounts.get("unknown") ?? 0).toBe(1);
    expect((shapeCounts.get("root-view-entity") ?? 0) + (shapeCounts.get("transactional-interface") ?? 0)).toBeGreaterThan(0);
    expect((shapeCounts.get("view-entity") ?? 0) + (shapeCounts.get("projection-view") ?? 0)).toBeGreaterThan(0);
    expect(shapeCounts.get("custom-entity") ?? 0).toBeGreaterThan(0);
    expect(shapeCounts.get("abstract-entity") ?? 0).toBeGreaterThan(0);
    expect(shapeCounts.get("classic-view") ?? 0).toBeGreaterThan(0);
  });

  it("classifies a root view entity built as a projection as root-view-entity, not projection-view (RAP001's precondition)", () => {
    const source = readFileSync(
      join(FIXTURES, "SAP-samples__abap-platform-reuse-services/zreusei_salesordertp_002.ddls.asddls"),
      "utf8",
    );
    const { entities } = buildCdsMap([{ filename: "zreusei_salesordertp_002.ddls.asddls", source }]);
    const info = entities.get("ZREUSEI_SALESORDERTP_002");
    expect(info).toBeDefined();
    expect(info?.shape).toBe("transactional-interface");
  });

  it("classifies a plain projection-view (non-root) and captures its projectionOn target", () => {
    const source = `define view entity ZC_FOO as projection on ZI_FOO
{
  key ID,
  Description
}`;
    const { entities } = buildCdsMap([{ filename: "zc_foo.ddls.asddls", source }]);
    const info = entities.get("ZC_FOO");
    expect(info?.shape).toBe("projection-view");
    expect(info?.projectionOn).toBe("ZI_FOO");
  });

  it("classifies a root view entity as root-view-entity", () => {
    const source = `define root view entity ZC_ROOT as select from zfoo
{
  key ID,
  Description
}`;
    const { entities } = buildCdsMap([{ filename: "zc_root.ddls.asddls", source }]);
    expect(entities.get("ZC_ROOT")?.shape).toBe("root-view-entity");
  });
});

/**
 * abaplint reports an `extend view entity ZR_X with { … }` under the BASE
 * entity's `definitionName`, so a bare `Map.set` let the extension EVICT the
 * real definition (shape "unknown", zero fields) — silencing RAP001/RAP059,
 * breaking `resolveBase()`'s projection path, and reporting the base view
 * (which parsed perfectly) as `parsed: false`. Five corpus `.ddls` files are
 * `extend view entity`, so a directory sweep hits it.
 */
describe("extensions and annotations never evict the entity they extend", () => {
  const BASE = "SAP-samples__abap-platform-rap630/zrap630r_shoptp_sol.ddls.asddls";
  const EXT = "SAP-samples__abap-platform-rap630-ext/zrap630r_ext_shop_sol.ddls.asddls";

  it("keeps the real definition when a corpus extension of it is passed too, in either order", () => {
    const base = { filename: "zrap630r_shoptp_sol.ddls.asddls", source: readFileSync(join(FIXTURES, BASE), "utf8") };
    const ext = { filename: "zrap630r_ext_shop_sol.ddls.asddls", source: readFileSync(join(FIXTURES, EXT), "utf8") };

    for (const files of [[base, ext], [ext, base]]) {
      const { entities, parsedFiles } = buildCdsMap(files);
      const info = entities.get("ZRAP630R_SHOPTP_SOL");
      expect(info?.shape).toBe("root-view-entity");
      expect(info?.fields.length).toBeGreaterThan(0);
      expect(info?.filename).toBe(base.filename);
      // The extension file still parsed — it just owns no entity of its own.
      expect([...parsedFiles].sort()).toEqual([base.filename, ext.filename].sort());
    }
  });

  it("treats `annotate view` the same way", () => {
    const { entities, parsedFiles } = buildCdsMap([
      { filename: "zr_x.ddls.asddls", source: "define root view entity ZR_X as select from zx\n{ key uuid as Uuid }\n" },
      { filename: "zr_x_a.ddls.asddls", source: "@Metadata.layer: #CORE\nannotate view ZR_X with\n{\n  @UI.hidden: true\n  Uuid;\n}\n" },
    ]);
    expect(entities.get("ZR_X")?.shape).toBe("root-view-entity");
    expect(entities.get("ZR_X")?.filename).toBe("zr_x.ddls.asddls");
    expect(parsedFiles.has("zr_x_a.ddls.asddls")).toBe(true);
  });

  it("emits no entity at all for an extension passed on its own — absence is honest, a wrong shape is not", () => {
    const { entities, parsedFiles } = buildCdsMap([
      { filename: "zr_x_e.ddls.asddls", source: "extend view entity ZR_X with\n{\n  extfield as ExtField\n}\n" },
    ]);
    expect(entities.size).toBe(0);
    expect(parsedFiles.has("zr_x_e.ddls.asddls")).toBe(true);
  });
});

describe("broken CDS view passthrough", () => {
  it("passes a deliberately broken .ddls through as abaplint's own cds_parser_error, no entity emitted", () => {
    const broken = "define view entity ZBROKEN as projection on {{{ not cds at all !!!";
    const { entities, findings } = buildCdsMap([{ filename: "zbroken.ddls.asddls", source: broken }]);

    expect(entities.has("ZBROKEN")).toBe(false);
    expect(findings.length).toBeGreaterThanOrEqual(1);
    const finding = findings[0]!;
    expect(finding.rule).toBe("cds_parser_error");
    expect(finding.file).toBe("zbroken.ddls.asddls");
    expect(finding.docsUrl).toBe("https://rules.abaplint.org/cds_parser_error/");
    expect(finding.line).toBeGreaterThanOrEqual(1);
  });

  it("isolates a CDS source that makes abaplint's own parser fail — the batch survives it", () => {
    const hostile = `@Foo: ${"[".repeat(10_000)}\ndefine view entity ZHOSTILE as select from zx { key id }\n`;
    const { entities, findings } = buildCdsMap([
      { filename: "zhostile.ddls.asddls", source: hostile },
      { filename: "zr_ok.ddls.asddls", source: "define root view entity ZR_OK as select from zok\n{\n  key id\n}\n" },
    ]);
    // The good file is still read (the failure used to throw a RangeError out
    // of checkRapBehavior and take the whole call with it) …
    expect(entities.get("ZR_OK")!.shape).toBe("root-view-entity");
    // … and the hostile one is reported rather than silently skipped.
    expect(findings.some((f) => f.file === "zhostile.ddls.asddls" && f.severity === "error")).toBe(true);
  });

  it("returns empty results for an empty file list without throwing", () => {
    const result = buildCdsMap([]);
    expect(result.entities.size).toBe(0);
    expect(result.findings).toEqual([]);
    expect(result.parsedFiles.size).toBe(0);
  });
});

describe("shape and projection target are independent facts (review finding: ddls.ts §classify)", () => {
  it("keeps `as projection on` on a root projection view instead of discarding it with the shape", () => {
    const { entities } = buildCdsMap([
      {
        filename: "zc_x.ddls.asddls",
        source: "define root view entity ZC_X\n  provider contract transactional_query\n  as projection on ZR_A\n{\n  key Id\n}\n",
      },
    ]);
    const info = entities.get("ZC_X")!;
    // Root-ness is what RAP001 asks about; the target is what resolveBase()
    // asks about. The early return for `root view entity` used to answer the
    // first question and throw the second answer away.
    expect(info.shape).toBe("root-view-entity");
    expect(info.projectionOn).toBe("ZR_A");
  });

  it("still classifies a non-root projection view as projection-view with its target", () => {
    const { entities } = buildCdsMap([
      { filename: "zc_y.ddls.asddls", source: "define view entity ZC_Y as projection on ZR_B\n{\n  key Id\n}\n" },
    ]);
    expect(entities.get("ZC_Y")).toMatchObject({ shape: "projection-view", projectionOn: "ZR_B" });
  });

  it("leaves projectionOn undefined on a plain select view", () => {
    const { entities } = buildCdsMap([
      { filename: "zr_c.ddls.asddls", source: "define root view entity ZR_C as select from zc\n{\n  key id\n}\n" },
    ]);
    expect(entities.get("ZR_C")!.projectionOn).toBeUndefined();
  });
});

describe("comments and string literals are not code (review finding: ddls.ts §DEFINE_RE)", () => {
  it("ignores a `// define view entity` line comment above the real root view", () => {
    const { entities } = buildCdsMap([
      {
        filename: "zr_x.ddls.asddls",
        source: "// define view entity ZR_X — the old, non-root shape\ndefine root view entity ZR_X as select from zx\n{\n  key id\n}\n",
      },
    ]);
    // Classifying the comment cost a false RAP001 ("root points at a
    // non-root view") on a perfectly ordinary file.
    expect(entities.get("ZR_X")!.shape).toBe("root-view-entity");
  });

  it("ignores a block comment and a string literal that both contain a define statement", () => {
    const { entities } = buildCdsMap([
      {
        filename: "zr_y.ddls.asddls",
        source:
          "/* define view entity ZR_Y\n   was the old shape */\n@EndUserText.label: 'define view entity ZR_Y'\n" +
          "define root view entity ZR_Y as select from zy\n{\n  key id\n}\n",
      },
    ]);
    expect(entities.get("ZR_Y")!.shape).toBe("root-view-entity");
  });

  it("does not mistake a commented-out `extend view entity` for an extension", () => {
    const { entities } = buildCdsMap([
      {
        filename: "zr_z.ddls.asddls",
        source: "// extend view entity ZR_Z with { … }\ndefine root view entity ZR_Z as select from zz\n{\n  key id\n}\n",
      },
    ]);
    expect(entities.get("ZR_Z")).toMatchObject({ shape: "root-view-entity" });
  });
});
