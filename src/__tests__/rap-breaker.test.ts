/**
 * Adversarial probes for the RAP checker — the false-positive side of the
 * house (spec `docs/specs/rap-checker-design.md` §1.3: *"A parser built to
 * reject everything it does not recognise would report legal RAP as broken"*).
 *
 * Three kinds of test live here, and the split matters:
 *
 *  1. **Legal-RAP regressions (`it`).** Tricky-but-legal BDL/SDL assembled
 *     from `bdl-grammar-notes.md` §1/§5 and the six constructs
 *     `corpus-inventory.md` §5 records as absent from the 102-file corpus
 *     (`functions`, `precheck`, `requires`, a standalone `features { instance
 *     { … } }`, `extend service`, `strict ( 1 )`). Each asserts **zero
 *     error/warning findings**. They pass today; they exist so a future
 *     grammar change cannot start rejecting them.
 *  2. **Mutation regressions (`it`).** Fifteen deliberate defects injected
 *     into real Apache-2.0 corpus fixtures, each asserting that the intended
 *     rule actually fires. A rule that stops firing is a false negative.
 *  3. **Ex-bug probes (`it`).** Each was written as an `it.fails` asserting
 *     the behaviour the spec requires while the checker did the wrong thing.
 *     All of them — P1-1…P1-7, P2-1, P2-2, P3-1 — are fixed and now run as
 *     plain `it`; none is allowed to go back to `it.fails`, because a probe
 *     that is expected to fail is a bug nobody is fixing.
 *
 * Plus a fuzz pass: 1 200 random truncations / brace and punctuation
 * deletions / junk injections over the corpus, and 15 pathological inputs,
 * must never throw out of the lexer, either parser, or `checkRapBehavior()`.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";

import { buildCdsMap } from "../abap/rap/ddls.js";
import { checkRapBehavior } from "../abap/rap/index.js";
import type { RapCheckReport } from "../abap/rap/index.js";
import { tokenize } from "../abap/rap/lexer.js";
import { parseBehaviorDefinition } from "../abap/rap/parser.js";
import { parseServiceDefinition } from "../abap/rap/srvd.js";
import { buildServer } from "../server.js";

const FIXTURES = new URL("../../evals/rap/fixtures/", import.meta.url).pathname;
const fixture = (relative: string): string => readFileSync(join(FIXTURES, relative), "utf8");

interface File {
  filename: string;
  source: string;
}

const check = (files: File[], opts?: Parameters<typeof checkRapBehavior>[1]): RapCheckReport =>
  checkRapBehavior(files, opts ?? {});

/** Findings that are a claim about the user's file — infos are coverage notes, not defects. */
const claims = (report: RapCheckReport): string[] =>
  report.findings
    .filter((f) => f.severity !== "info")
    .map((f) => `${f.severity} ${f.rule} ${f.file}:${f.line} ${f.message}`);

const rules = (report: RapCheckReport): string[] => report.findings.map((f) => f.rule);

/* ------------------------------------------------------------------------ */
/* Shared cross-file corpus for the projection / CDS / service probes        */
/* ------------------------------------------------------------------------ */

const BASE_BDEF = `managed implementation in class zbp_r_travel unique;
strict ( 2 );
with draft;

define behavior for ZR_Travel alias Travel
persistent table ztravel
draft table ztravel_d
etag master LocalLastChangedAt
lock master total etag LastChangedAt
authorization master ( global )
{
  create;
  update;
  delete;
  association _Booking { create; with draft; }
  action acceptTravel result [1] $self;
  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft action Resume;
  draft determine action Prepare;
}

define behavior for ZR_Booking alias Booking
persistent table zbooking
draft table zbooking_d
etag dependent by _Travel
lock dependent by _Travel
authorization dependent by _Travel
{
  update;
  delete;
  association _Travel;
  draft action Edit;
  draft action Activate;
  draft action Discard;
  draft action Resume;
}
`;

const PROJECTION_BDEF = `projection;
strict ( 2 );
use draft;

define behavior for ZC_Travel alias Travel
use etag
{
  use create;
  use update;
  use delete;
  use action acceptTravel;
  use action Edit;
  use action Activate;
  use action Discard;
  use action Resume;
  use action Prepare;
  use association _Booking { create; with draft; }
}

define behavior for ZC_Booking alias Booking
use etag
{
  use update;
  use delete;
  use association _Travel;
}
`;

const DDLS_BASE = `define root view entity ZR_Travel
  as select from ztravel as Travel
  composition [0..*] of ZR_Booking as _Booking
{
  key travel_uuid as TravelUuid,
  travel_id as TravelId,
  overall_status as OverallStatus,
  local_last_changed_at as LocalLastChangedAt,
  last_changed_at as LastChangedAt,
  _Booking
}
`;

const DDLS_BOOKING = `define view entity ZR_Booking
  as select from zbooking as Booking
  association to parent ZR_Travel as _Travel on $projection.TravelUuid = _Travel.TravelUuid
{
  key booking_uuid as BookingUuid,
  travel_uuid as TravelUuid,
  _Travel
}
`;

const DDLS_PROJECTION = `define root view entity ZC_Travel
  provider contract transactional_query
  as projection on ZR_Travel
{
  key TravelUuid,
  TravelId,
  OverallStatus
}
`;

const DDLS_PROJECTION_BOOKING = `define view entity ZC_Booking
  as projection on ZR_Booking
{
  key BookingUuid
}
`;

const SRVD_TRAVEL = `@EndUserText.label: 'Travel'
@ObjectModel.leadingEntity.name: 'ZC_Travel'
define service ZUI_TRAVEL_V4 provider contracts odata_v4_ui
{
  expose ZC_Travel as Travel;
  expose ZC_Booking as Booking;
}
`;

/* ------------------------------------------------------------------------ */
/* 1. Legal RAP must produce no error and no warning                         */
/* ------------------------------------------------------------------------ */

const HEADER = "managed implementation in class zbp_probe unique;\nstrict ( 2 );\n\n";

/** A complete, rule-clean managed BO whose body is the thing under test. */
const withBody = (body: string): string =>
  `${HEADER}define behavior for ZR_Probe alias Probe\npersistent table zprobe\netag master LocalLastChangedAt\n` +
  `lock master\nauthorization master ( global )\n{\n${body}\n}\n`;

/** name → [whole-file source that ADT would accept, optional filename] */
const LEGAL: [string, string, string?][] = [
  [
    "verbatim SAP cheat-sheet draft BO (grammar notes §5 snippet 1)",
    `managed implementation in class ZBP_R_DEMO_ABAP unique;
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
      ID         = ID;
      CalcResult = calc_result;
    }
}
`,
  ],
  [
    "verbatim SAP abstract BDEF with hierarchy + deep mapping (§5 snippet 2)",
    `abstract;
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
}
`,
  ],
  [
    "multi-addition field characteristics (§1.3)",
    withBody("  field ( mandatory : create, readonly : update ) ProductID;\n  create;\n  update;\n  delete;"),
  ],
  [
    "CUD additions including precheck (§1.4)",
    withBody(
      "  create ( features : global, precheck, authorization : none );\n" +
        "  update ( features : instance );\n  delete ( authorization : update );",
    ),
  ],
  [
    "association with nested create + with draft (§1.5)",
    withBody("  create;\n  association _Item\n    {\n      create ( precheck );\n      with draft;\n    }"),
  ],
  [
    "action: additions + deep table parameter + selective result (§1.6)",
    withBody(
      "  create;\n  action ( features : instance, authorization : update ) act15\n" +
        "    deep table parameter SOME_ENTITY\n    result selective [1] $self;",
    ),
  ],
  ["static default factory action (§1.6)", withBody("  create;\n  static default factory action createFromTemplate [1];")],
  ["save-phase action (§1.6)", withBody("  create;\n  save ( finalize, adjustnumbers ) action recalcTotals;")],
  [
    "functions — the corpus contains none at all (corpus-inventory §5)",
    withBody(
      "  create;\n  function getTotals result [1] $self;\n" +
        "  internal function getInternal result [1] $self;\n  static function calc result [0..*] ZR_Probe;",
    ),
  ],
  ["key … function, alternative-key form (§5 snippet 10)", withBody("  create;\n  key SOME_ALTERNATE_KEY function getByAltKey result [1] $self;")],
  [
    "determine action with ( always ) (§1.8)",
    withBody(`  create;
  determination det_totals on save { create; }
  determination det_status on save { create; }
  validation val_consistency on save { create; }
  determine action recalcAndCheck
    {
      determination ( always ) det_totals;
      determination det_status;
      validation val_consistency;
    }`),
  ],
  [
    "side effects: every source form in one block (§1.10)",
    withBody(`  create;
  action acceptTravel;
  action rejectTravel;
  event travelBooked for side effects;
  determination recalcTotals on save { create; }
  determine action recalcTotalsDA { determination recalcTotals; }
  association _Booking;
  association _Item;
  side effects
    {
      field TravelStatus affects field TotalPrice;
      $self affects field _Booking.Status;
      action acceptTravel affects field *,
                           permissions(action rejectTravel),
                           messages;
      determine action recalcTotalsDA
        executed on field Quantity, field _Item.Price
        affects field GrandTotal;
      event travelBooked affects entity _Booking;
    }`),
  ],
  [
    "managed derived event + event for side effects (§1.10)",
    withBody(
      "  create;\n  managed event TravelAccepted on TravelChanged parameter I_TravelEventParameter;\n" +
        "  event TravelRejected for side effects;",
    ),
  ],
  ["event with deep parameter (§1.10)", withBody("  create;\n  event Booked deep parameter ZA_EventParam;")],
  [
    "mapping with control + corresponding + except (§1.11)",
    withBody("  create;\n  mapping for zprobe control zprobe_c corresponding except ( Dummy1, Dummy2 )\n  {\n    ID = id;\n  }"),
  ],
  [
    "strict ( 1 ) — the corpus only ever writes strict ( 2 ) (corpus-inventory §5)",
    "managed implementation in class zbp_probe unique;\nstrict ( 1 );\n\ndefine behavior for ZR_Probe alias Probe\n" +
      "persistent table zprobe\netag master LocalLastChangedAt\nlock master\nauthorization master ( global )\n" +
      "{\n  create;\n  update;\n  delete;\n}\n",
  ],
  [
    "changedocuments master (§1.2)",
    `${HEADER}define behavior for ZR_Probe alias Probe\npersistent table zprobe\netag master LocalLastChangedAt\n` +
      "lock master\nauthorization master ( global )\nchangedocuments master\n{\n  create;\n}\n",
  ],
  [
    "changedocuments( create:data, update:data, delete:key ) (grammar notes §4 item 5)",
    `${HEADER}define behavior for ZR_Probe alias Probe\npersistent table zprobe\netag master LocalLastChangedAt\n` +
      "lock master\nauthorization master ( global )\nchangedocuments( create:data, update:data, delete:key )\n{\n  create;\n}\n",
  ],
  [
    "collaborative draft + draft action Share (§1.9, 2508)",
    `managed implementation in class zbp_probe unique;
strict ( 2 );
with collaborative draft;

define behavior for ZR_Probe alias Probe
persistent table zprobe
draft table zprobe_d
etag master LocalLastChangedAt
lock master total etag LastChangedAt
authorization master ( global )
{
  create;
  draft action Edit;
  draft action Activate optimized;
  draft action Discard;
  draft action Resume;
  draft action Share;
  draft determine action Prepare;
}
`,
  ],
  [
    "interface BDEF: use statements + a field characteristic (§1.14 / §5 snippet 18)",
    "interface;\ndefine behavior for I_TravelTP alias Travel external 'Travel'\n{\n  use create;\n  use update;\n" +
      "  use association _Booking { create; }\n  field ( readonly ) TravelID;\n}\n",
  ],
  [
    "projection with `use etag` before the body (§5 snippet 19)",
    "projection;\nstrict ( 2 );\ndefine behavior for ZC_TRAVEL_U alias Travel\nuse etag\n{\n  use draft;\n" +
      "  use create;\n  use update;\n  use delete;\n  use action acceptTravel;\n  field ( suppress ) InternalNotes;\n}\n",
  ],
  [
    "projection with `use draft as dependent` (§1.12, 2508)",
    "projection;\nstrict ( 2 );\ndefine behavior for ZC_Item alias Item\n{\n  use draft as dependent;\n  use update;\n}\n",
  ],
  [
    "projection with use side effects / use event / use mapping (§1.12)",
    "projection;\nstrict ( 2 );\ndefine behavior for ZC_Probe alias Probe\n{\n  use side effects;\n  use event Booked;\n" +
      "  use mapping for zprobe { ID = id; }\n  use create;\n}\n",
  ],
  [
    "projection with `with managed instance filter` (§1.1)",
    "projection;\nstrict ( 2 );\nwith managed instance filter;\ndefine behavior for ZC_Probe alias Probe\n{\n  use create;\n}\n",
  ],
  [
    "deep parameter + deep result against a sibling abstract BDEF (§5 snippet 20)",
    `managed implementation in class bp_demo_cds_deep_parameter unique;
strict(2);
define behavior for DEMO_CDS_DEEP_PARAMETER
persistent table demo_bo_deep
etag master LocalLastChangedAt
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
}
`,
  ],
  [
    "privileged mode disabling base context + auxiliary class + save after (§1.1)",
    `managed implementation in class zbp_probe unique;
strict ( 2 );
with privileged mode disabling base context;
auxiliary class zcl_aux_a, zcl_aux_b;
save after ZR_Other;

define behavior for ZR_Probe alias Probe
persistent table zprobe
etag master LocalLastChangedAt
lock master
authorization master ( global )
{
  create;
}
`,
  ],
  [
    "`with additional save with full data` on the impl-type statement (§1.1, corpus order)",
    `managed with additional save with full data implementation in class zbp_probe unique;
strict ( 2 );
define behavior for ZR_Probe alias Probe
persistent table zprobe
etag master LocalLastChangedAt
lock master
authorization master ( global )
{ create; }
`,
  ],
  [
    "unmanaged BO with `lock master unmanaged` (§1.2)",
    "unmanaged implementation in class zbp_probe unique;\nstrict ( 2 );\ndefine behavior for ZR_Probe alias Probe\n" +
      "etag master LocalLastChangedAt\nlock master unmanaged\nauthorization master ( global )\n" +
      "{\n  create;\n  update;\n  delete;\n}\n",
  ],
  [
    "namespaced /DMO/ entities + Alias~name validation reference (§3 lexical rules)",
    `managed implementation in class /DMO/BP_Travel unique;
strict ( 2 );
define behavior for /DMO/I_Travel alias Travel
persistent table /dmo/travel
etag master LastChangedAt
lock master
authorization master ( global )
{
  create;
  validation validateStatus on save { create; }
  association _Booking { create; }
}
define behavior for /DMO/I_Booking alias Booking
persistent table /dmo/booking
etag dependent by _Travel
lock dependent by _Travel
authorization dependent by _Travel
{
  update;
  association _Travel;
  validation Booking~validateBookingStatus on save { create; }
}
`,
  ],
  ["group block, nested (§1.2)", withBody("  group G1 { create; group G2 { update; } }")],
  ["draft action AdditionalSave / Share (§1.9)", withBody("  create;\n  draft action AdditionalSave;\n  draft action Share;")],
  [
    "CRLF line endings (§2.1 — 19 of the 102 corpus files are CRLF)",
    "managed implementation in class zbp_probe unique;\r\nstrict ( 2 );\r\n\r\ndefine behavior for ZR_Probe alias Probe\r\n" +
      "persistent table zprobe\r\netag master LocalLastChangedAt\r\nlock master\r\nauthorization master ( global )\r\n" +
      "{\r\n  create;\r\n}\r\n",
  ],
  [
    "block + line comments (§2.1, accepted defensively)",
    "managed implementation in class zbp_probe unique; /* hi */\nstrict ( 2 );\ndefine behavior for ZR_Probe alias Probe\n" +
      "persistent table zprobe\netag master LocalLastChangedAt\nlock master\nauthorization master ( global )\n" +
      "{ create; // trailing\n}\n",
  ],
  [
    "extension for projection (rarest corpus construct)",
    "extension for projection;\ndefine behavior for ZC_Probe alias Probe\n{\n  use action extraAction;\n}\n",
    "zc_probe.bdef.asbdef",
  ],
  [
    "bare `extend behavior for` (BDEF extension, parsed permissively per §1.2)",
    "extend behavior for ZR_Probe\n{\n  field ( readonly ) Extra;\n}\n",
  ],
  [
    "SRVD: dotted + nested-block annotations, provider contract, namespaced exposes (§7)",
    `@EndUserText.label: 'Service for managing travels'
@ObjectModel: { leadingEntity: { name: '/DMO/I_TRAVEL' } }
define service /DMO/TRAVEL provider contracts odata_v4_ui
{
  expose /DMO/I_TRAVEL       as Travel;
  expose /DMO/I_AGENCY       as TravelAgency;
  expose I_Currency          as Currency;
}
`,
    "dmo_travel.srvd.srvdsrv",
  ],
  [
    "SRVD: expose method with provider contract sql (§7)",
    "define service ZSQL_S provider contracts sql\n{\n  expose method zcl_amdp=>get_data as GetData;\n}\n",
    "zsql_s.srvd.srvdsrv",
  ],
  [
    "SRVD: exposes without aliases (§7 — `AS alias` is optional)",
    "define service Z_S\n{\n  expose I_Currency;\n  expose I_Country;\n}\n",
    "z_s.srvd.srvdsrv",
  ],
];

describe("RAP breaker — legal RAP must not be flagged", () => {
  for (const [name, source, filename] of LEGAL) {
    it(`no error/warning on: ${name}`, () => {
      expect(claims(check([{ filename: filename ?? "zr_probe.bdef.asbdef", source }]))).toEqual([]);
    });
  }

  it("a rule-clean BO stays clean when its own .ddls, a projection and a service are supplied too", () => {
    const report = check([
      { filename: "zr_travel.bdef.asbdef", source: BASE_BDEF },
      { filename: "zc_travel.bdef.asbdef", source: PROJECTION_BDEF },
      { filename: "zr_travel.ddls.asddls", source: DDLS_BASE },
      { filename: "zr_booking.ddls.asddls", source: DDLS_BOOKING },
      { filename: "zc_travel.ddls.asddls", source: DDLS_PROJECTION },
      { filename: "zc_booking.ddls.asddls", source: DDLS_PROJECTION_BOOKING },
      { filename: "zui_travel_v4.srvd.srvdsrv", source: SRVD_TRAVEL },
    ]);
    expect(claims(report)).toEqual([]);
    expect(report.summary.unknownConstructs).toBe(0);
  });
});

/* ------------------------------------------------------------------------ */
/* 2. Mutation battery — the intended rule must fire                         */
/* ------------------------------------------------------------------------ */

const RO_M = "SAP-samples__abap-cheat-sheets/zdemo_abap_rap_ro_m.bdef.asbdef";
const SHOP = "SAP-samples__abap-platform-rap630/zrap630r_shoptp_sol.bdef.asbdef";

const MUTATIONS: [string, string, (s: string) => string, string][] = [
  ["remove `lock master`", RO_M, (s) => s.replace(/^lock master.*$/m, ""), "RAP028"],
  ["`lock dependent by` an undeclared association", RO_M, (s) => s.replace(/^lock master.*$/m, "lock dependent by _NoSuchAssoc"), "RAP003"],
  ["drop the implementation class", RO_M, (s) => s.replace(/ implementation in class \w+ unique/i, ""), "RAP011"],
  ["empty `authorization master ( )`", RO_M, (s) => s.replace(/authorization master\s*\([^)]*\)/, "authorization master ( )"), "RAP030"],
  ["put `with draft` on an entity instead of the header", RO_M, (s) => s.replace(/^lock master.*$/m, "$&\nwith draft"), "RAP024"],
  ["give a factory action a result clause", RO_M, (s) => s.replace(/\n\}\s*$/, "\n  factory action fx [1] result [1] $self;\n}\n"), "RAP048"],
  ["add `$self affects field <same-entity field>`", RO_M, (s) => s.replace(/\n\}\s*$/, "\n  side effects { $self affects field SomeField; }\n}\n"), "RAP067"],
  ["drop the draft table from a draft BO", SHOP, (s) => s.replace(/^draft table .*$/m, ""), "RAP026"],
  ["invent a draft action name", SHOP, (s) => s.replace("draft action Edit;", "draft action Edit;\n  draft action Reject;"), "RAP081"],
  ["move `total etag` before `lock master`", SHOP, (s) => s.replace("lock master total etag LastChangedAt", "total etag LastChangedAt\nlock master"), "RAP034"],
  ["combine feature control with readonly", SHOP, (s) => s.replace("field ( readonly )", "field ( readonly, features : instance )"), "RAP012"],
  ["put `( authorization : update )` on create", SHOP, (s) => s.replace(/^ {2}create;$/m, "  create ( authorization : update );"), "RAP057"],
  ["put a facet on `draft action Activate`", SHOP, (s) => s.replace("draft action Activate;", "draft action ( features : instance ) Activate;"), "RAP038"],
  ["turn the BO unmanaged while it keeps `numbering : managed`", SHOP, (s) => s.replace(/^managed;$/m, "unmanaged implementation in class zbp_x unique;"), "RAP040"],
  ["add a validation that triggers on update alone", SHOP, (s) => s.replace(/\n\}\s*$/, "\n  validation vUpd on save { update; }\n}\n"), "RAP058"],
];

describe("RAP breaker — injected defects in real corpus fixtures must be caught", () => {
  for (const [name, file, mutate, expected] of MUTATIONS) {
    it(`${expected} fires when we ${name}`, () => {
      const source = mutate(fixture(file));
      const report = check([{ filename: file.split("/").pop() as string, source }]);
      expect(rules(report)).toContain(expected);
    });
  }

  it("the unmutated fixtures raise no RAP-PARSE and no RAP000", () => {
    for (const file of [RO_M, SHOP]) {
      const report = check([{ filename: file.split("/").pop() as string, source: fixture(file) }]);
      expect(report.findings.filter((f) => f.rule === "RAP-PARSE")).toEqual([]);
      expect(report.findings.filter((f) => f.rule === "RAP000")).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------------ */
/* 3. Fuzz — nothing here may ever throw                                     */
/* ------------------------------------------------------------------------ */

function corpusFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(bdef\.asbdef|srvd\.srvdsrv)$/.test(entry)) out.push(full);
    }
  };
  walk(FIXTURES);
  return out.sort();
}

/** Deterministic PRNG, so a fuzz failure is reproducible from the seed alone. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JUNK = ["ÿ", "$%^&*<>?!#", "'unterminated", "/* unclosed"].join("");

describe("RAP breaker — fuzz", () => {
  it("1200 mutants of the corpus never throw out of the lexer, parsers or checkRapBehavior", () => {
    const files = corpusFiles();
    expect(files.length).toBeGreaterThanOrEqual(102);
    const random = mulberry32(20260910);
    const failures: string[] = [];

    for (let i = 0; i < 1200; i += 1) {
      const path = files[Math.floor(random() * files.length)] as string;
      const source = readFileSync(path, "utf8");
      const name = path.split("/").pop() as string;
      let mutant = source;
      const mode = i % 4;
      if (mode === 0) {
        mutant = source.slice(0, Math.max(1, Math.floor(random() * source.length)));
      } else if (mode === 1 || mode === 2) {
        const wanted = mode === 1 ? "{}" : ";()[]";
        const indices: number[] = [];
        for (let k = 0; k < source.length; k += 1) if (wanted.includes(source[k] as string)) indices.push(k);
        if (indices.length > 0) {
          const cut = indices[Math.floor(random() * indices.length)] as number;
          mutant = source.slice(0, cut) + source.slice(cut + 1);
        }
      } else {
        const at = Math.floor(random() * source.length);
        mutant = `${source.slice(0, at)} ${JUNK}${source.slice(at)}`;
      }
      if (i % 7 === 0) {
        for (let d = 0; d < 5; d += 1) {
          const at = Math.floor(random() * mutant.length);
          mutant = mutant.slice(0, at) + mutant.slice(at + 1);
        }
      }
      const attempt = (label: string, run: () => unknown): void => {
        try {
          run();
        } catch (error) {
          failures.push(`${label} threw on mutant ${i} (mode ${mode}) of ${name}: ${(error as Error).message}`);
        }
      };
      attempt("tokenize", () => tokenize(mutant));
      attempt("parse", () =>
        name.endsWith(".asbdef") ? parseBehaviorDefinition(mutant, name) : parseServiceDefinition(mutant, name),
      );
      attempt("checkRapBehavior", () => check([{ filename: name, source: mutant }]));
    }
    expect(failures).toEqual([]);
  });

  it("pathological inputs never throw", () => {
    const cases: [string, string][] = [
      ["1000 nested groups", `managed;\ndefine behavior for X\n{${"\n  group G {".repeat(1000)}\n${"}".repeat(1001)}\n`],
      ["2000 nested parens", `managed;\ndefine behavior for X\n{ create ${"(".repeat(2000)}${")".repeat(2000)}; }`],
      ["50k open braces", "{".repeat(50000)],
      ["50k semicolons", ";".repeat(50000)],
      ["BOM plus lone CR", "﻿managed;\rdefine behavior for X\r{ create; }\r"],
      ["unterminated string literal", "managed;\ndefine behavior for X alias 'oops\n{ create; }"],
      ["unterminated block comment", "managed;\n/* never closed\ndefine behavior for X { create; }"],
      ["bare $ token", "managed;\ndefine behavior for X\n{ $ affects field a; }"],
      ["60k-character identifier", `managed;\ndefine behavior for ${"A".repeat(60000)}\n{ create; }`],
      ["empty source", ""],
      ["whitespace only", "   \n\t  \n"],
      ["embedded NUL", "managed; define behavior for X { create; }"],
      ["truncated namespace", "managed;\ndefine behavior for /DMO/ alias X { create; }"],
      ["nonsense cardinalities", "managed;\ndefine behavior for X { action a result [999..*] $self; action b result [..] $self; }"],
      ["500 nested groups, no whitespace", `managed;\ndefine behavior for X\n{${"group G{".repeat(500)}${"}".repeat(500)}}`],
      // Recursive-descent over an annotation value is the one place in the
      // checker that recursed without a ceiling: 10 000 brackets exhausted
      // V8's call stack and threw a RangeError out of checkRapBehavior().
      ["10000 nested annotation arrays", `@Foo: ${"[".repeat(10_000)}\ndefine service Z { expose ZC_X; }\n`],
      [
        "10000 nested annotation records",
        `@Foo: ${"{ a: ".repeat(10_000)}'x'${"}".repeat(10_000)}\ndefine service Z { expose ZC_X; }\n`,
      ],
    ];
    const failures: string[] = [];
    for (const [name, source] of cases) {
      const probes: [string, () => unknown][] = [
        ["tokenize", () => tokenize(source)],
        ["parseBehaviorDefinition", () => parseBehaviorDefinition(source, "p.bdef.asbdef")],
        ["parseServiceDefinition", () => parseServiceDefinition(source, "p.srvd.srvdsrv")],
        ["check bdef", () => check([{ filename: "p.bdef.asbdef", source }])],
        ["check srvd", () => check([{ filename: "p.srvd.srvdsrv", source }])],
        ["check ddls", () => check([{ filename: "p.ddls.asddls", source }])],
      ];
      for (const [label, run] of probes) {
        try {
          run();
        } catch (error) {
          failures.push(`${label} threw on "${name}": ${(error as Error).message}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

/* ------------------------------------------------------------------------ */
/* 4. §1.3 two-tier and §3.7 suppression contracts                           */
/* ------------------------------------------------------------------------ */

describe("RAP breaker — §1.3 two-tier and §3.7 suppression contracts", () => {
  it("an unreadable entity characteristic suppresses RAP026 and counts the suppression", () => {
    const report = check([
      {
        filename: "z.bdef.asbdef",
        source:
          "managed implementation in class zbp unique;\nstrict ( 2 );\nwith draft;\n" +
          "define behavior for ZR_X alias X\npersistent table zx\netag master L\nlock master total etag T\n" +
          "authorization master ( global )\nfrobnicate ztable_d\n{\n  create;\n  draft action Edit;\n" +
          "  draft action Activate;\n  draft action Discard;\n  draft action Resume;\n  draft determine action Prepare;\n}\n",
      },
    ]);
    expect(rules(report)).not.toContain("RAP026");
    expect(report.summary.suppressedByUnknown).toBeGreaterThan(0);
  });

  it("a punctuation-well-formed but unknown BDEF statement is RAP000 info only, never an error", () => {
    const report = check([
      {
        filename: "z.bdef.asbdef",
        source:
          "managed implementation in class zbp unique;\nstrict ( 2 );\n" +
          "define behavior for ZR_X alias X\npersistent table zx\netag master L\nlock master\n" +
          "authorization master ( global )\n{\n  create;\n  frobnicate wibble;\n}\n",
      },
    ]);
    expect(rules(report)).toContain("RAP000");
    expect(claims(report)).toEqual([]);
  });

  it("BUG P1-3a: an unknown but well-formed SRVD statement must be RAP000 info, not a RAP-PARSE error", () => {
    // Spec §1.3: RAP-PARSE is punctuation-level breakage only. `publish … ;`
    // is `;`-terminated inside balanced braces — it is a vocabulary gap, and
    // the BDEF parser handles the same shape correctly (test above).
    const report = check([
      { filename: "z.srvd.srvdsrv", source: "define service Z_S\n{\n  expose ZC_X as X;\n  publish ZC_Y as Y;\n}\n" },
    ]);
    expect(rules(report)).toContain("RAP000");
    expect(claims(report)).toEqual([]);
  });

  it("BUG P1-3b: SRVD001 must consult the §3.7 suppression contract before claiming a service exposes nothing", () => {
    const report = check([
      { filename: "z.srvd.srvdsrv", source: "define service Z_S\n{\n  publish ZC_Travel as Travel;\n}\n" },
    ]);
    expect(rules(report)).not.toContain("SRVD001");
    expect(report.summary.suppressedByUnknown).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------ */
/* 5. Ex-bugs — each asserts the spec's behaviour on a file that is legal RAP */
/*    but used to be reported as broken. The P1 set landed with the fixes in  */
/*    src/abap/rap/{lexer,srvd,parser,rules,ddls,index}.ts; P2-1, P2-2 and    */
/*    P3-1 landed with the verification fix pass (spec §9.1). All are plain   */
/*    `it` regression guards now — nothing here is expected to fail.          */
/* ------------------------------------------------------------------------ */

describe("RAP breaker — false positives that are fixed, kept as regression guards", () => {
  it("BUG P1-1a: an array-valued SRVD annotation is legal CDS and must not raise errors", () => {
    const report = check([
      {
        filename: "z.srvd.srvdsrv",
        source:
          "@AbapCatalog.extensibility: { extensible: true, dataSources: [ '_Extension' ] }\n" +
          "define service Z_S provider contracts odata_v4_ui\n{\n  expose ZC_X as X;\n}\n",
      },
    ]);
    expect(claims(report)).toEqual([]);
  });

  it("BUG P1-1b: a `#ENUM` SRVD annotation value is legal CDS and must not raise a lexical error", () => {
    const report = check([
      {
        filename: "z.srvd.srvdsrv",
        source: "@ObjectModel.supportedCapabilities: [ #ANALYTICAL_QUERY ]\ndefine service Z_S\n{\n  expose ZC_X as X;\n}\n",
      },
    ]);
    expect(claims(report)).toEqual([]);
  });

  it("BUG P1-1c: SRVD001 must not claim 'exposes nothing' about a file whose EXPOSE is right there", () => {
    const report = check([
      { filename: "z.srvd.srvdsrv", source: "@Foo.bar: [ 'a', 'b' ]\ndefine service Z_S\n{\n  expose ZC_X as X;\n}\n" },
    ]);
    expect(rules(report)).not.toContain("SRVD001");
  });

  it("BUG P1-2: `extend service X with { … }` is legal CDS SDL (ServiceDefinition.form = 'extend')", () => {
    const report = check([
      { filename: "z.srvd.srvdsrv", source: "extend service ZUI_TRAVEL with\n{\n  expose ZC_Extra as Extra;\n}\n" },
    ]);
    expect(claims(report)).toEqual([]);
  });

  it("BUG P1-4: RAP002 must not be an error for a .ddls the caller simply did not pass (cf. SRVD006's warning)", () => {
    const report = check([
      { filename: "zr_travel.bdef.asbdef", source: BASE_BDEF },
      { filename: "zc_travel.bdef.asbdef", source: PROJECTION_BDEF },
      { filename: "zc_travel.ddls.asddls", source: DDLS_PROJECTION },
    ]);
    expect(report.findings.filter((f) => f.rule === "RAP002" && f.severity === "error")).toEqual([]);
  });

  it("BUG P1-5: `managed by bopf;` needs no implementation class (grammar notes §1.1)", () => {
    const report = check([
      {
        filename: "z.bdef.asbdef",
        source: "managed by bopf;\ndefine behavior for ZR_X alias X\npersistent table zx\nlock master\n{ create; }\n",
      },
    ]);
    expect(rules(report)).not.toContain("RAP011");
  });

  it("BUG P1-6: an unrecognised header block must not swallow every following entity (§2.3 recovery contract)", () => {
    const report = check([
      {
        filename: "z.bdef.asbdef",
        source:
          "managed implementation in class zbp unique;\nstrict ( 2 );\n" +
          "define authorization context ZCTX for disable\n{\n  save:early;\n}\n" +
          "define behavior for ZR_X alias X\npersistent table zx\netag master L\nlock master\n" +
          "authorization master ( global )\n{\n  create;\n  draft action Reject;\n}\n",
      },
    ]);
    // The entity after the unreadable header block must still parse and still be rule-checked.
    expect(report.files[0]?.entityCount).toBe(1);
    expect(rules(report)).toContain("RAP081");
  });

  it("BUG P1-7a: an `extend view entity` must not evict the base CDS entity from the map", () => {
    const map = buildCdsMap([
      {
        filename: "zrap630r_shoptp_sol.ddls.asddls",
        source: fixture("SAP-samples__abap-platform-rap630/zrap630r_shoptp_sol.ddls.asddls"),
      },
      {
        filename: "zrap630r_ext_shop_sol.ddls.asddls",
        source: fixture("SAP-samples__abap-platform-rap630-ext/zrap630r_ext_shop_sol.ddls.asddls"),
      },
    ]);
    const entity = map.entities.get("ZRAP630R_SHOPTP_SOL");
    expect(entity?.shape).toBe("root-view-entity");
    expect(entity?.fields.length).toBeGreaterThan(0);
  });

  it("BUG P1-7b: the evicted base .ddls must not then be reported as parsed:false", () => {
    const report = check([
      {
        filename: "z.bdef.asbdef",
        source:
          "managed implementation in class zbp unique;\ndefine behavior for ZR_X alias X\npersistent table zx\n" +
          "lock master\n{ create; }\n",
      },
      { filename: "zr_x.ddls.asddls", source: "define root view entity ZR_X as select from zx\n{ key uuid as Uuid }\n" },
      { filename: "zr_x_e.ddls.asddls", source: "extend view entity ZR_X with\n{\n  extfield as ExtField\n}\n" },
    ]);
    expect(report.files.find((f) => f.filename === "zr_x.ddls.asddls")?.parsed).toBe(true);
  });

  it("BUG P2-1: entity-level `extensible { … }` parses in both positions and both forms (§2.3)", () => {
    const report = check([
      {
        filename: "z.bdef.asbdef",
        source:
          "managed implementation in class zbp unique;\nstrict ( 2 );\n" +
          "define behavior for ZR_X alias X\npersistent table zx\netag master L\nlock master\n" +
          "authorization master ( global )\nextensible { with additional save; }\n{\n  create;\n}\n",
      },
    ]);
    expect(report.summary.unknownConstructs).toBe(0);
    expect(claims(report)).toEqual([]);
  });

  it("BUG P2-2: a BDEF that declares the child before the root must not be reported as broken", () => {
    const report = check([
      {
        filename: "z.bdef.asbdef",
        source:
          "managed implementation in class zbp unique;\nstrict(2);\n" +
          "define behavior for ZR_Item alias Item\npersistent table zi\netag dependent by _Head\n" +
          "lock dependent by _Head\nauthorization dependent by _Head\n{\n  update;\n  association _Head;\n}\n" +
          "define behavior for ZR_Head alias Head\npersistent table zh\netag master L\nlock master\n" +
          "authorization master ( global )\n{\n  create;\n  association _Item { create; }\n}\n",
      },
      { filename: "zr_head.ddls.asddls", source: "define root view entity ZR_Head as select from zh\n{ key uuid as Uuid }\n" },
      { filename: "zr_item.ddls.asddls", source: "define view entity ZR_Item as select from zi\n{ key uuid as Uuid }\n" },
    ]);
    expect(claims(report)).toEqual([]);
  });

  it("BUG P3-1: duplicate filenames must not silently gate off every cross-file rule", () => {
    const report = check([
      { filename: "same.bdef.asbdef", source: BASE_BDEF },
      {
        filename: "same.bdef.asbdef",
        source: "projection;\nstrict ( 2 );\ndefine behavior for ZC_Travel alias Travel\n{\n  use action neverDeclaredAnywhere;\n}\n",
      },
    ]);
    expect(rules(report)).toContain("RAP060");
  });
});

/* ------------------------------------------------------------------------ */
/* 6. MCP tool contract over the wire                                        */
/* ------------------------------------------------------------------------ */

async function connectedClient(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer();
  await server.connect(serverTransport);
  const client = new Client({ name: "rap-breaker", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("RAP breaker — check_rap_behavior over the MCP wire", () => {
  it("a complete projection + base + CDS + service set round-trips clean and stamps its provenance", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "check_rap_behavior",
      arguments: {
        files: [
          { filename: "zr_travel.bdef.asbdef", source: BASE_BDEF },
          { filename: "zc_travel.bdef.asbdef", source: PROJECTION_BDEF },
          { filename: "zr_travel.ddls.asddls", source: DDLS_BASE },
          { filename: "zr_booking.ddls.asddls", source: DDLS_BOOKING },
          { filename: "zc_travel.ddls.asddls", source: DDLS_PROJECTION },
          { filename: "zc_booking.ddls.asddls", source: DDLS_PROJECTION_BOOKING },
          { filename: "zui_travel_v4.srvd.srvdsrv", source: SRVD_TRAVEL },
        ],
        abapRelease: "2508",
      },
    })) as { isError?: boolean; structuredContent?: RapCheckReport };
    expect(result.isError).toBeFalsy();
    const report = result.structuredContent as RapCheckReport;
    expect(report.validated).toBe("rap-checker");
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
    expect(report.releaseGate?.abapRelease).toBe("2508");
    expect(report.files.map((f) => f.kind)).toEqual(["bdef", "bdef", "ddls", "ddls", "ddls", "ddls", "srvd"]);
  });

  it("release gating fires on 2508-only constructs at 2502, always as a warning, never at 2508", async () => {
    const client = await connectedClient();
    const collaborative =
      "managed implementation in class zbp unique;\nstrict(2);\nwith collaborative draft;\n" +
      "define behavior for ZR_X alias X\npersistent table zx\ndraft table zx_d\netag master L\n" +
      "lock master total etag T\nauthorization master ( global )\n{\n  create;\n  draft action Edit;\n" +
      "  draft action Activate;\n  draft action Discard;\n  draft action Resume;\n  draft action Share;\n" +
      "  draft determine action Prepare;\n}\n";
    const gated = (await client.callTool({
      name: "check_rap_behavior",
      arguments: { files: [{ filename: "z.bdef.asbdef", source: collaborative }], abapRelease: "2502" },
    })) as { structuredContent?: RapCheckReport };
    const report = gated.structuredContent as RapCheckReport;
    expect(report.summary.errors).toBe(0);
    const gates = report.findings.filter((f) => f.rule === "RAP900");
    expect(gates.length).toBeGreaterThanOrEqual(2);
    expect(gates.every((f) => f.severity === "warning")).toBe(true);

    const ungated = (await client.callTool({
      name: "check_rap_behavior",
      arguments: { files: [{ filename: "z.bdef.asbdef", source: collaborative }], abapRelease: "2508" },
    })) as { structuredContent?: RapCheckReport };
    expect((ungated.structuredContent as RapCheckReport).findings.filter((f) => f.rule === "RAP900")).toEqual([]);
  });

  /**
   * A call with nothing to check is a caller error, not a passing check. This
   * used to return `0 error(s) … across 0 RAP file(s)` with `validated:
   * "rap-checker"` on it — a clean bill of health for a check that never ran.
   */
  it("a call with no BDEF/SRVD is a structured invalid_input error, not an empty clean report", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "check_rap_behavior",
      arguments: { files: [{ filename: "zcl_x.clas.abap", source: "CLASS zcl_x DEFINITION.\nENDCLASS." }] },
    })) as { isError?: boolean; structuredContent?: RapCheckReport; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("invalid_input:");
    expect(text).toContain("zcl_x.clas.abap");
    expect(text).toContain(
      "hint: pass at least one .bdef.asbdef or .srvd.srvdsrv (plus the .ddls files they reference)",
    );
    expect(text).toContain("next: lint_abap, check_cloud_readiness");
  });

  it("a CDS view on its own is the same error — there is no behavior in a .ddls", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "check_rap_behavior",
      arguments: { files: [{ filename: "zr_travel.ddls.asddls", source: DDLS_BASE }] },
    })) as { isError?: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("invalid_input:");
    expect(result.content[0]?.text).toContain("Only CDS view definitions were passed");
  });

  it("one BDEF among unsupported files is still checked — the guard only refuses an empty set", async () => {
    const client = await connectedClient();
    const result = (await client.callTool({
      name: "check_rap_behavior",
      arguments: {
        files: [
          { filename: "zcl_x.clas.abap", source: "CLASS zcl_x DEFINITION.\nENDCLASS." },
          { filename: "zr_travel.bdef.asbdef", source: BASE_BDEF },
        ],
      },
    })) as { isError?: boolean; structuredContent?: RapCheckReport };
    expect(result.isError).toBeFalsy();
    const report = result.structuredContent as RapCheckReport;
    expect(report.summary.filesChecked).toBe(1);
    expect(report.files.find((f) => f.kind === "unsupported")?.filename).toBe("zcl_x.clas.abap");
  });
});
