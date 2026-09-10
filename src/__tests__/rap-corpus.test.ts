/**
 * The parser's acceptance gate (spec §6.1, §7 step 3).
 *
 * Two corpora, one bar:
 *
 *  1. **The real corpus** — every `.bdef.asbdef` under `evals/rap/fixtures/`
 *     (79 files, 17 Apache-2.0 SAP repositories) must parse with **zero**
 *     RAP-PARSE errors and **zero** RAP000 unknown statements. Fixture counts
 *     are asserted too, so a fixture deleted by accident fails CI instead of
 *     silently weakening the gate.
 *  2. **The documented corpus** — the 20 valid and 10 invalid snippets in
 *     `bdl-grammar-notes.md` §5–6. The valid ones must parse clean. The invalid
 *     ones are the honesty half: most are *semantically* wrong, not
 *     syntactically, so the parser must accept them and leave the defect to the
 *     rules phase — reporting them here would be exactly the false-positive
 *     failure mode spec §1.3 exists to prevent.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseBehaviorDefinition } from "../abap/rap/parser.js";

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

const ALL_FILES = walk(FIXTURES);
const BDEFS = ALL_FILES.filter((f) => f.endsWith(".bdef.asbdef")).sort();
const SRVDS = ALL_FILES.filter((f) => f.endsWith(".srvd.srvdsrv"));
const DDLS = ALL_FILES.filter((f) => f.endsWith(".ddls.asddls"));
const REPO_DIRS = readdirSync(FIXTURES).filter((entry) => statSync(join(FIXTURES, entry)).isDirectory());

describe("corpus integrity", () => {
  it("still holds the whole fixture set", () => {
    expect(BDEFS.length).toBeGreaterThanOrEqual(79);
    expect(SRVDS.length).toBeGreaterThanOrEqual(23);
    expect(DDLS.length).toBeGreaterThanOrEqual(141);
    expect(REPO_DIRS.length).toBeGreaterThanOrEqual(17);
  });

  it("documents every fixture directory in PROVENANCE.md", () => {
    const provenancePath = join(FIXTURES, "PROVENANCE.md");
    expect(existsSync(provenancePath)).toBe(true);
    const provenance = readFileSync(provenancePath, "utf8");
    const undocumented = REPO_DIRS.filter((dir) => !provenance.includes(dir.replace("__", "/")));
    expect(undocumented).toEqual([]);
  });
});

describe("BDEF corpus — the parser's acceptance gate", () => {
  it("parses all 79 behavior definitions with zero RAP-PARSE errors and zero RAP000 unknowns", () => {
    const failures: string[] = [];
    let entities = 0;
    let statements = 0;

    for (const file of BDEFS) {
      const name = file.replace(FIXTURES, "");
      const result = parseBehaviorDefinition(readFileSync(file, "utf8"), name.split("/").pop());
      for (const error of result.errors) {
        failures.push(`${name}:${error.line}:${error.column} RAP-PARSE ${error.message} | ${error.excerpt}`);
      }
      for (const unknown of result.unknown) {
        failures.push(
          `${name}:${unknown.range.start.line}:${unknown.range.start.column} RAP000 [${unknown.leadingKey}] ${unknown.text}`,
        );
      }
      if (result.truncated) failures.push(`${name}: truncated`);
      entities += result.ast.entities.length;
      for (const entity of result.ast.entities) {
        statements += entity.characteristics.length + entity.body.length;
      }
    }

    // Named aggregate: a grammar regression shows WHICH file broke, not just a
    // count. The floors below are what the corpus yields today — a parser that
    // starts skipping statements drops beneath them, while adding fixtures is
    // still allowed.
    expect(failures).toEqual([]);
    expect(BDEFS.length).toBeGreaterThanOrEqual(79);
    expect(entities).toBeGreaterThanOrEqual(90);
    expect(statements).toBeGreaterThanOrEqual(784);
  });

  it("classifies every corpus file as a known implementation type", () => {
    const types = new Map<string, number>();
    for (const file of BDEFS) {
      const result = parseBehaviorDefinition(readFileSync(file, "utf8"));
      types.set(result.ast.implementationType, (types.get(result.ast.implementationType) ?? 0) + 1);
      expect(result.ast.entities.length, file).toBeGreaterThanOrEqual(1);
    }
    expect(types.get("unspecified") ?? 0).toBe(0);
    expect([...types.keys()].sort()).toEqual([
      "abstract",
      "extension",
      "interface",
      "managed",
      "projection",
      "unmanaged",
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* bdl-grammar-notes.md §5–6                                                 */
/* ------------------------------------------------------------------------ */

type SnippetKind = "bdef-file" | "bdef-body" | "bdef-characteristics" | "srvd";

interface Snippet {
  n: number;
  title: string;
  kind: SnippetKind;
  source: string;
  /** Invalid snippets only: what the checker is supposed to do with it. */
  expect?: "unknown-construct" | "semantic";
  /** Invalid snippets only: the rule that owns the defect, per the notes/catalog. */
  rule?: string;
}

/** The smallest legal managed BDEF, used to host a body-only fragment. */
const WRAPPER_HEAD = [
  "managed implementation in class zbp_wrap unique;",
  "define behavior for ZWRAP alias Wrap",
  "persistent table zwrap",
  "lock master",
].join("\n");

function materialise(snippet: Snippet): string {
  switch (snippet.kind) {
    case "bdef-file":
      return snippet.source;
    case "bdef-body":
      return `${WRAPPER_HEAD}\n{\n${snippet.source}\n}\n`;
    case "bdef-characteristics":
      return `${WRAPPER_HEAD}\n${snippet.source}\n`;
    default:
      return snippet.source;
  }
}

const VALID_SNIPPETS: Snippet[] = [
  {
    n: 1,
    title: "verbatim SAP cheat-sheet managed draft BO",
    kind: "bdef-file",
    source: `managed implementation in class ZBP_R_DEMO_ABAP unique;
strict ( 2 );
with draft;

define behavior for ZR_DEMO_ABAP alias demo_abap
persistent table zdemoabap
draft table zdemoabap_d
etag master LocalLastChangedAt
lock master
total etag LastChangedAt
authorization master ( none )
late numbering
{
  field ( readonly ) ID, CalcResult, LocalCreatedBy, LocalCreatedAt, LocalLastChangedBy,
                     LocalLastChangedAt, LastChangedAt;
  field ( mandatory ) Number1, Number2, Operator;
  create;
  update;
  delete;
  validation validate on save { create; field Number1, Number2, Operator; }
  determination det_modify on modify { field Number1, Number2, Operator; }
  internal action calculation;
  draft action Resume;
  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft determine action Prepare
  {
    validation validate;
  }
  mapping for zdemoabap corresponding
    {
      ID                 = ID;
      Number1            = Number1;
      Number2            = Number2;
      Operator           = Operator;
      CalcResult         = calc_result;
      LocalCreatedBy     = LOCAL_CREATED_BY;
      LocalCreatedAt     = LOCAL_CREATED_AT;
      LocalLastChangedBy = LOCAL_LAST_CHANGED_BY;
      LocalLastChangedAt = LOCAL_LAST_CHANGED_AT;
      LastChangedAt      = LAST_CHANGED_AT;
    }
}`,
  },
  {
    n: 2,
    title: "verbatim SAP abstract BDEF with deep mapping and hierarchy",
    kind: "bdef-file",
    source: `abstract;
strict(2);
with hierarchy;
define behavior for DEMO_CDS_ABSTRACT_ROOT alias Root
{
  field ( suppress ) Dummy;
  deep mapping for DEMO_CDS_ABSTRACT_STRUC
  {
    char10 = char_10;
    Integer4 = integer_4;
    sub _itemStructure = struktur;
    sub _itemTable = tabelle;
  }
  association _itemTable;
  association _itemStructure;
}`,
  },
  {
    n: 3,
    title: "multiple additions inside one field() group",
    kind: "bdef-body",
    source: "field ( mandatory : create, readonly : update ) ProductID;",
  },
  {
    n: 4,
    title: "multi-addition CUD ops",
    kind: "bdef-body",
    source: `create ( features : global, precheck, authorization : none );
update ( features : instance );
delete ( authorization : update );`,
  },
  {
    n: 5,
    title: "association with a nested create carrying its own addition list",
    kind: "bdef-body",
    source: `association _Item
  {
    create ( precheck );
    with draft;
  }`,
  },
  {
    n: 6,
    title: "action with combined kind-prefix, additions, deep parameter and result",
    kind: "bdef-body",
    source: `action ( features : instance, authorization : update ) act15
  deep table parameter SOME_ENTITY
  result selective [1] $self;`,
  },
  {
    n: 7,
    title: "static default factory action, no result",
    kind: "bdef-body",
    source: "static default factory action createFromTemplate [1];",
  },
  {
    n: 8,
    title: "save-phase action",
    kind: "bdef-body",
    source: "save ( finalize, adjustnumbers ) action recalcTotals;",
  },
  {
    n: 9,
    title: "static function with a mandatory result",
    kind: "bdef-body",
    source: "static function getCurrentRate result [1] I_ExchangeRate;",
  },
  {
    n: 10,
    title: "key function form",
    kind: "bdef-body",
    source: "key SOME_ALTERNATE_KEY function getByAltKey result [1] $self;",
  },
  {
    n: 11,
    title: "determine action mixing `always` determinations and a validation",
    kind: "bdef-body",
    source: `determine action recalcAndCheck
  {
    determination ( always ) det_totals;
    determination det_status;
    validation val_consistency;
  }`,
  },
  {
    n: 12,
    title: "service definition with a leading-entity annotation and namespaced exposes",
    kind: "srvd",
    source: `@EndUserText.label: 'Service for managing travels'
@ObjectModel.leadingEntity.name: '/DMO/I_TRAVEL'
define service /DMO/TRAVEL
{
  expose /DMO/I_TRAVEL       as Travel;
  expose /DMO/I_AGENCY       as TravelAgency;
  expose /DMO/I_CUSTOMER     as Passenger;
  expose I_Currency          as Currency;
  expose I_Country           as Country;
}`,
  },
  {
    n: 13,
    title: "provider contract list plus extensibility annotation",
    kind: "srvd",
    source: `@AbapCatalog.extensibility.extensible: true
define service Z_TRAVEL_UI provider contracts odata_v4_ui, odata_v4_webapi
{
  expose ZC_TRAVEL_U as Travel;
}`,
  },
  {
    n: 14,
    title: "side effects: field, $self, action, determine-action and event sources",
    kind: "bdef-body",
    source: `side effects
  {
    field TravelStatus affects field TotalPrice;
    $self affects field _Booking.Status;
    action acceptTravel affects field *,
                         permissions(action rejectTravel),
                         messages;
    determine action recalcTotals
      executed on field Quantity, field _Item.Price
      affects field GrandTotal;
    event travelBooked affects entity _Booking;
  }`,
  },
  {
    n: 15,
    title: "managed derived event with a parameter, plus a side-effect event",
    kind: "bdef-body",
    source: `managed event TravelAccepted on TravelChanged parameter I_TravelEventParameter;
event TravelRejected for side effects;`,
  },
  {
    n: 16,
    title: "entity-level authorization scopes with per-operation overrides",
    kind: "bdef-characteristics",
    source: `authorization master ( global, instance )
{
  create ( authorization : none );
  update;
  delete ( authorization : update );
  action ( authorization : global ) forceApprove;
}`,
  },
  {
    n: 17,
    title: "numbering and readonly interplay for internal managed numbering",
    kind: "bdef-body",
    source: `field ( readonly, numbering : managed ) TravelUUID;
early numbering;`,
  },
  {
    n: 18,
    title: "interface BDEF body dominated by `use`, with a field characteristic",
    kind: "bdef-file",
    source: `interface;
define behavior for I_TravelTP alias Travel external 'Travel'
{
  use create;
  use update;
  use association _Booking { create; }
  field ( readonly ) TravelID;
}`,
  },
  {
    n: 19,
    title: "projection BDEF reusing draft, etag and an action",
    kind: "bdef-file",
    source: `projection;
strict ( 2 );
define behavior for ZC_TRAVEL_U alias Travel
use etag
{
  use draft;
  use create;
  use update;
  use delete;
  use action acceptTravel;
  field ( suppress ) InternalNotes;
}`,
  },
  {
    n: 20,
    title: "abstract BDEF used as a deep parameter type, plus the managed BDEF that uses it",
    kind: "bdef-file",
    source: `abstract;
define behavior for DEMO_CDS_ABSTRACT_ROOT alias Root
{
  association _itemTable;
}
managed implementation in class bp_demo_cds_deep_parameter unique;
strict(2);
define behavior for DEMO_CDS_DEEP_PARAMETER
persistent table demo_bo_deep
lock master
authorization master ( none )
{
  create;
  update;
  delete;
  mapping for demo_bo_deep { RootBO = root; }
  field (readonly:update) RootBO;
  action a2_from_deep deep parameter DEMO_CDS_ABSTRACT_ROOT;
  action a2_deep_result deep result selective [1] DEMO_CDS_ABSTRACT_ROOT;
}`,
  },
];

const INVALID_SNIPPETS: Snippet[] = [
  {
    n: 1,
    title: "`persistent table` on an unmanaged BO",
    kind: "bdef-file",
    expect: "semantic",
    rule: "RAP046",
    source: `unmanaged implementation in class zbp_foo unique;
define behavior for ZR_FOO
persistent table zfoo
{
  create;
}`,
  },
  {
    n: 2,
    title: "`read;` — there is no such statement in BDL",
    kind: "bdef-body",
    expect: "unknown-construct",
    rule: "RAP000",
    source: "read;",
  },
  {
    n: 3,
    title: "`total etag` written before `lock master`",
    kind: "bdef-file",
    expect: "semantic",
    rule: "RAP034",
    source: `managed implementation in class zbp_foo unique;
define behavior for ZR_FOO
persistent table zfoo
total etag LastChangedAt
lock master
{
  create;
}`,
  },
  {
    n: 4,
    title: "factory action carrying a `result` clause",
    kind: "bdef-body",
    expect: "semantic",
    rule: "RAP048",
    source: "factory action createOne [1] result [1] $self;",
  },
  {
    n: 5,
    title: "function with no result clause",
    kind: "bdef-body",
    expect: "semantic",
    rule: "RAP082",
    source: "function getTotals;",
  },
  {
    n: 6,
    title: "`with unmanaged save` combined with a persistent table",
    kind: "bdef-file",
    expect: "semantic",
    rule: "RAP046",
    source: `managed implementation in class zbp_foo unique;
define behavior for ZR_FOO
persistent table zfoo
with unmanaged save
{
  create;
}`,
  },
  {
    n: 7,
    title: "draft action with an illegal name",
    kind: "bdef-body",
    expect: "semantic",
    rule: "RAP081",
    source: "draft action Reject;",
  },
  {
    n: 8,
    title: "static action with a `$self` result under strict mode",
    kind: "bdef-body",
    expect: "semantic",
    rule: "strict-mode",
    source: "static action recalcAll result [1] $self;",
  },
  {
    n: 9,
    title: "service definition exposing nothing",
    kind: "srvd",
    expect: "semantic",
    rule: "SRVD001",
    source: `define service Z_EMPTY_SRV
{
}`,
  },
  {
    n: 10,
    title: "provider contracts combining UI and WEBAPI",
    kind: "srvd",
    expect: "semantic",
    rule: "SRVD003",
    source: `define service Z_BAD_SRV provider contracts odata_v4_ui, odata_v4_webapi
{
  expose ZC_FOO as Foo;
}`,
  },
];

describe("bdl-grammar-notes.md §5 — 20 valid snippets the parser must accept", () => {
  it("covers all twenty", () => {
    expect(VALID_SNIPPETS).toHaveLength(20);
    expect(VALID_SNIPPETS.map((s) => s.n)).toEqual([...Array(20).keys()].map((i) => i + 1));
  });

  for (const snippet of VALID_SNIPPETS) {
    // Service definitions are srvd.ts's job (spec §2.4), a later build step.
    const test = snippet.kind === "srvd" ? it.skip : it;
    test(`#${snippet.n} ${snippet.title}`, () => {
      const result = parseBehaviorDefinition(materialise(snippet), "snippet.bdef.asbdef");
      expect(result.errors).toEqual([]);
      expect(result.unknown).toEqual([]);
      expect(result.truncated).toBe(false);
      expect(result.ast.entities.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("bdl-grammar-notes.md §6 — 10 invalid snippets", () => {
  it("covers all ten", () => {
    expect(INVALID_SNIPPETS).toHaveLength(10);
    expect(INVALID_SNIPPETS.every((s) => s.expect !== undefined && s.rule !== undefined)).toBe(true);
  });

  for (const snippet of INVALID_SNIPPETS) {
    const test = snippet.kind === "srvd" ? it.skip : it;
    test(`#${snippet.n} ${snippet.title} → ${snippet.rule}`, () => {
      const result = parseBehaviorDefinition(materialise(snippet), "snippet.bdef.asbdef");
      if (snippet.expect === "unknown-construct") {
        // Punctuation-well-formed but outside our vocabulary: RAP000, info.
        expect(result.errors).toEqual([]);
        expect(result.unknown.length).toBeGreaterThanOrEqual(1);
        return;
      }
      // Semantically wrong, syntactically fine: the parser must stay silent and
      // leave the defect to the rule that owns it (spec §1.3).
      expect(result.errors).toEqual([]);
      expect(result.unknown).toEqual([]);
      expect(result.ast.entities.length).toBeGreaterThanOrEqual(1);
    });
  }

  it("keeps the evidence each semantic rule needs", () => {
    const parse = (snippet: Snippet) => parseBehaviorDefinition(materialise(snippet)).ast;

    const rap046 = parse(INVALID_SNIPPETS[0] as Snippet);
    expect(rap046.implementationType).toBe("unmanaged");
    expect(rap046.entities[0]?.persistentTable?.name).toBe("zfoo");

    const rap034 = parse(INVALID_SNIPPETS[2] as Snippet).entities[0];
    const totalAt = rap034?.characteristics.findIndex((c) => c.kind === "total-etag") ?? -1;
    const lockAt = rap034?.characteristics.findIndex((c) => c.kind === "lock-master") ?? -1;
    expect(totalAt).toBeGreaterThanOrEqual(0);
    expect(totalAt).not.toBe(lockAt + 1);

    const rap048 = parse(INVALID_SNIPPETS[3] as Snippet).entities[0]?.actions[0];
    expect(rap048).toMatchObject({ factory: true });
    expect(rap048?.result).toBeDefined();

    const rap082 = parse(INVALID_SNIPPETS[4] as Snippet).entities[0]?.functions[0];
    expect(rap082?.result).toBeUndefined();

    const rap046b = parse(INVALID_SNIPPETS[5] as Snippet).entities[0];
    expect(rap046b?.save).toMatchObject({ form: "unmanaged" });
    expect(rap046b?.persistentTable?.name).toBe("zfoo");

    const rap081 = parse(INVALID_SNIPPETS[6] as Snippet).entities[0]?.draftActions[0];
    expect(rap081?.name.key).toBe("REJECT");

    const strictMode = parse(INVALID_SNIPPETS[7] as Snippet).entities[0]?.actions[0];
    expect(strictMode).toMatchObject({ isStatic: true });
    expect(strictMode?.result?.target).toMatchObject({ kind: "self" });
  });
});
