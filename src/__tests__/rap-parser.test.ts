/**
 * Parser gate for the RAP BDL recursive-descent parser (spec §2.3, §6.3).
 *
 * The two-tier policy of spec §1.3 is what most of these tests pin down:
 * punctuation-level breakage is an `error` (RAP-PARSE), anything merely
 * outside our vocabulary is an `UnknownStatement` (RAP000, info) and parsing
 * continues. A parser that reported unknown-but-legal BDL as broken would
 * make the whole checker untrustworthy, so both directions are asserted.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { EntityBehavior, SideEffectsBlock } from "../abap/rap/ast.js";
import {
  GRAMMAR_VERSION,
  MAX_RECOVERY_EVENTS,
  parseBehaviorDefinition,
} from "../abap/rap/parser.js";

/** Wrap a body fragment in the smallest legal managed BDEF. */
function inBody(body: string): string {
  return [
    "managed implementation in class zbp_wrap unique;",
    "define behavior for ZWRAP alias Wrap",
    "persistent table zwrap",
    "lock master",
    "{",
    body,
    "}",
  ].join("\n");
}

function parseClean(source: string): ReturnType<typeof parseBehaviorDefinition> {
  const result = parseBehaviorDefinition(source, "zwrap.bdef.asbdef");
  expect(result.errors).toEqual([]);
  expect(result.unknown).toEqual([]);
  return result;
}

function firstEntity(source: string): EntityBehavior {
  const entity = parseClean(source).ast.entities[0];
  if (entity === undefined) throw new Error("no entity parsed");
  return entity;
}

function bodyOf(fragment: string): EntityBehavior {
  return firstEntity(inBody(fragment));
}

const CORPUS = new URL("../../evals/rap/fixtures/", import.meta.url).pathname;

function walkCorpus(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkCorpus(full));
    else out.push(full);
  }
  return out;
}

const CORPUS_BDEFS = walkCorpus(CORPUS).filter((f) => f.endsWith(".bdef.asbdef"));

describe("contract", () => {
  it("exports a stamped grammar version", () => {
    expect(GRAMMAR_VERSION).toBe("bdl/2026-09-10");
  });

  it("never throws, whatever it is handed", () => {
    for (const junk of ["", "   ", "}}}", "define", "define behavior for", "{{{{{", "'"]) {
      expect(() => parseBehaviorDefinition(junk)).not.toThrow();
    }
  });

  it("normalises CRLF and a BOM before parsing", () => {
    const result = parseClean("﻿managed;\r\nstrict ( 2 );\r\ndefine behavior for ZX\r\n{\r\ncreate;\r\n}");
    expect(result.ast.strict).toEqual({
      level: 2,
      range: { start: { line: 2, column: 1 }, end: { line: 2, column: 13 } },
    });
  });
});

describe("header", () => {
  it("parses every implementation-type form seen in the corpus", () => {
    const cases: [string, string][] = [
      ["managed implementation in class ZBP_X unique;", "managed"],
      ["managed;", "managed"],
      ["managed by BOPF;", "managed"],
      ["unmanaged implementation in class /cc4a/bp_x unique;", "unmanaged"],
      ["projection;", "projection"],
      ["projection implementation in class ZBP_C_X unique;", "projection"],
      ["interface;", "interface"],
      ["abstract;", "abstract"],
      ["implementation abstract;", "abstract"],
      ["extension for projection;", "extension"],
      ["extension implementation in class zbp_x_e unique;", "extension"],
    ];
    for (const [header, type] of cases) {
      const result = parseClean(`${header}\ndefine behavior for ZX\n{\ncreate;\n}`);
      expect(result.ast.implementationType, header).toBe(type);
    }
  });

  it("keeps the implementation class and the `managed by BOPF` marker", () => {
    const managed = parseClean("managed implementation in class ZBP_X unique;\ndefine behavior for ZX\n{ create; }");
    expect(managed.ast.implementationClass).toMatchObject({ name: "ZBP_X", key: "ZBP_X" });
    const bopf = parseClean("managed by BOPF;\ndefine behavior for ZX\n{ create; }");
    expect(bopf.ast.managedByBopf).toBeDefined();
    expect(bopf.ast.implementationClass).toBeUndefined();
  });

  it("parses the extension header forms", () => {
    const using = parseClean(
      "extension using interface zrap630i_shoptp_sol\nimplementation in class zbp_x unique;\n\nextend behavior for Shop\n{\n}",
    );
    expect(using.ast.extensionForm).toBe("using-interface");
    expect(using.ast.extensionInterface?.name).toBe("zrap630i_shoptp_sol");
    expect(using.ast.implementationClass?.name).toBe("zbp_x");
    expect(using.ast.entities[0]).toMatchObject({ form: "extend", isRoot: false });
    expect(using.ast.entities[0]?.entity.name).toBe("Shop");

    const forAbstract = parseClean("extension for abstract;\nextend behavior for Shop\n{ }");
    expect(forAbstract.ast.extensionForm).toBe("for-abstract");
  });

  it("parses a save clause fused onto the implementation-type statement", () => {
    const full = parseClean(
      "managed with additional save with full data\nimplementation in class zbp_x unique;\ndefine behavior for ZX\n{ create; }",
    );
    expect(full.ast.save).toMatchObject({ form: "additional", fullData: true, andCleanup: false });

    const unmanagedSave = parseClean(
      "managed with unmanaged save implementation in class ZBP_X unique;\ndefine behavior for ZX\n{ create; }",
    );
    expect(unmanagedSave.ast.save).toMatchObject({ form: "unmanaged", fullData: false });

    const cleanup = parseClean(
      "managed with additional save and cleanup implementation in class ZBP_X unique;\ndefine behavior for ZX\n{ create; }",
    );
    expect(cleanup.ast.save).toMatchObject({ form: "additional", andCleanup: true });
  });

  it("parses strict at both levels and both spellings", () => {
    expect(parseClean("managed;\nstrict(2);\ndefine behavior for ZX\n{ create; }").ast.strict?.level).toBe(2);
    expect(parseClean("managed;\nstrict ( 1 );\ndefine behavior for ZX\n{ create; }").ast.strict?.level).toBe(1);
    expect(parseClean("managed;\nstrict;\ndefine behavior for ZX\n{ create; }").ast.strict?.level).toBe(1);
  });

  it("records every header draft declaration, so RAP025 can see a duplicate", () => {
    const single = parseClean("managed;\nwith draft;\ndefine behavior for ZX\n{ create; }");
    expect(single.ast.withDraft).toMatchObject({ collaborative: false });
    expect(single.ast.draftDeclarations).toHaveLength(1);

    const collaborative = parseClean(
      "managed;\nwith collaborative draft;\ndefine behavior for ZX\n{ create; }",
    );
    expect(collaborative.ast.withDraft).toMatchObject({ collaborative: true });

    const twice = parseClean(
      "managed;\nwith draft;\nwith collaborative draft;\ndefine behavior for ZX\n{ create; }",
    );
    expect(twice.ast.draftDeclarations.map((d) => d.collaborative)).toEqual([false, true]);
  });

  it("parses `extensible;` and the `extensible { … }` block form", () => {
    const bare = parseClean("managed;\nextensible;\ndefine behavior for ZX\n{ create; }");
    expect(bare.ast.extensible?.options).toEqual([]);

    const block = parseClean(
      [
        "managed;",
        "extensible {",
        "  with additional save;",
        "  with determinations on modify;",
        "  with validations on save;",
        "}",
        "define behavior for ZX",
        "{ create; }",
      ].join("\n"),
    );
    expect(block.ast.extensible?.options).toEqual([
      "with additional save",
      "with determinations on modify",
      "with validations on save",
    ]);
  });

  it("parses the remaining header statements", () => {
    const result = parseClean(
      [
        "interface;",
        "auxiliary class zcl_a, zcl_b;",
        "with privileged mode disabling base context;",
        "with managed instance filter;",
        "with hierarchy;",
        "save after ZX;",
        "use draft;",
        "use side effects;",
        "define behavior for ZX alias X",
        "{ use create; }",
      ].join("\n"),
    );
    expect(result.ast.auxiliaryClasses.map((c) => c.name)).toEqual(["zcl_a", "zcl_b"]);
    expect(result.ast.privilegedMode?.form).toBe("disabling-base-context");
    expect(result.ast.managedInstanceFilter).toBeDefined();
    expect(result.ast.withHierarchy).toBeDefined();
    expect(result.ast.saveAfter?.name).toBe("ZX");
    expect(result.ast.headerUses.map((u) => u.what)).toEqual(["draft", "side-effects"]);
  });
});

describe("entity header and characteristics", () => {
  it("parses alias, external name, per-entity implementation class and root flag", () => {
    const result = parseClean(
      [
        "interface;",
        "define behavior for I_TravelTP alias Travel external 'Travel'",
        "{ use create; }",
        "define behavior for I_BookingTP alias Booking",
        "implementation in class zbp_b unique",
        "{ use update; }",
      ].join("\n"),
    );
    const [travel, booking] = result.ast.entities;
    expect(travel).toMatchObject({ isRoot: true, form: "define" });
    expect(travel?.alias?.name).toBe("Travel");
    expect(travel?.external?.value).toBe("Travel");
    expect(booking).toMatchObject({ isRoot: false });
    expect(booking?.implementationClass?.name).toBe("zbp_b");
  });

  it("keeps characteristics in source order and splits the fused lock/total-etag clause", () => {
    const entity = firstEntity(
      [
        "managed implementation in class ZBP_X unique;",
        "with draft;",
        "define behavior for ZX alias X",
        "persistent table zx",
        "extensible",
        "draft table zx_d",
        "query ZX_D_QUERY",
        "etag master LocalLastChangedAt",
        "lock master total etag LastChangedAt",
        "authorization master ( global, instance )",
        "late numbering",
        "with additional save",
        "changedocuments master",
        "{ create; }",
      ].join("\n"),
    );
    expect(entity.characteristics.map((c) => c.kind)).toEqual([
      "persistent-table",
      "extensible",
      "draft-table",
      "query",
      "etag-master",
      "lock-master",
      "total-etag",
      "authorization-master",
      "numbering",
      "save",
      "changedocuments",
    ]);
    // RAP034 reads exactly this: total-etag must sit at index(lock-master) + 1.
    expect(entity.characteristics.findIndex((c) => c.kind === "total-etag")).toBe(
      entity.characteristics.findIndex((c) => c.kind === "lock-master") + 1,
    );
    expect(entity.persistentTable?.name).toBe("zx");
    expect(entity.draftTable?.name).toBe("zx_d");
    expect(entity.query?.name).toBe("ZX_D_QUERY");
    expect(entity.etagMaster?.name).toBe("LocalLastChangedAt");
    expect(entity.totalEtag?.name).toBe("LastChangedAt");
    expect(entity.lockMaster).toMatchObject({ unmanaged: false });
    expect(entity.authorization).toMatchObject({ form: "master", scopes: ["global", "instance"] });
    expect(entity.numbering).toMatchObject({ when: "late" });
    expect(entity.save).toMatchObject({ form: "additional" });
  });

  it("parses the dependent characteristics and `lock master unmanaged`", () => {
    const entity = firstEntity(
      [
        "managed implementation in class ZBP_X unique;",
        "define behavior for ZX alias X",
        "etag dependent by _Parent",
        "lock dependent by _Parent",
        "authorization dependent by _Parent",
        "changedocuments dependent by _Parent",
        "{ update; }",
      ].join("\n"),
    );
    expect(entity.etagDependentBy?.name).toBe("_Parent");
    expect(entity.lockDependentBy?.name).toBe("_Parent");
    expect(entity.authorization).toMatchObject({ form: "dependent", scopes: [] });
    expect(entity.authorization?.assoc?.name).toBe("_Parent");

    const unmanagedLock = firstEntity(
      "managed;\ndefine behavior for ZX\nlock master unmanaged\n{ create; }",
    );
    expect(unmanagedLock.lockMaster).toMatchObject({ unmanaged: true });
  });

  it("parses `use etag` in the characteristic position, where it carries no `;`", () => {
    const entity = firstEntity(
      "projection;\ndefine behavior for ZC_X alias X\nuse etag\n{\n  use create;\n}",
    );
    expect(entity.characteristics.map((c) => c.kind)).toEqual(["use"]);
    expect(entity.body.map((s) => s.kind)).toEqual(["use"]);
  });

  it("parses an entity-level `with draft`, the evidence RAP024 reports", () => {
    const entity = firstEntity(
      "managed;\ndefine behavior for ZX\npersistent table zx\nwith draft\nlock master\n{ create; }",
    );
    expect(entity.withDraft).toMatchObject({ collaborative: false });
  });
});

describe("body statements", () => {
  it("parses field characteristics, qualifiers and multi-line field lists", () => {
    const entity = bodyOf(
      [
        "field ( readonly )",
        "  CreatedAt,",
        "  CreatedBy",
        "  ;",
        "field ( numbering : managed, readonly : update ) id;",
        "field ( mandatory: create ) OrderReference;",
        "field(readonly) zz_feedback;",
        "field ( hierarchy-index ) Node;",
        "field ( suppress ) Dummy;",
      ].join("\n"),
    );
    expect(entity.fields).toHaveLength(6);
    expect(entity.fields[0]?.fields.map((f) => f.name)).toEqual(["CreatedAt", "CreatedBy"]);
    expect(entity.fields[1]?.characteristics.map((c) => `${c.name}:${c.qualifier ?? "-"}`)).toEqual([
      "numbering:managed",
      "readonly:update",
    ]);
    expect(entity.fields[2]?.characteristics[0]).toMatchObject({ name: "mandatory", qualifier: "create" });
    expect(entity.fields[4]?.characteristics[0]).toMatchObject({ name: "hierarchy-index" });
    expect(entity.fields[5]?.characteristics[0]).toMatchObject({ name: "suppress" });
  });

  it("parses CUD operations with facets, `internal` and a default-function block", () => {
    const entity = bodyOf(
      [
        "create ( features : global, precheck, authorization : none );",
        "update ( features : instance ) ;",
        "delete ( authorization : update );",
        "internal update;",
        "create { default function makeDefaults; }",
      ].join("\n"),
    );
    expect(entity.operations.map((o) => o.verb)).toEqual(["create", "update", "delete", "update", "create"]);
    expect(entity.operations[0]?.facets.map((f) => f.kind)).toEqual([
      "features",
      "precheck",
      "authorization",
    ]);
    expect(entity.operations[2]?.facets[0]).toMatchObject({ kind: "authorization", value: "update" });
    expect(entity.operations[3]?.internal).toBe(true);
    expect(entity.operations[4]?.defaultFunction?.name).toBe("makeDefaults");
  });

  it("parses associations in every observed form", () => {
    const entity = bodyOf(
      [
        "association _parent;",
        "association _child { create; }",
        "association _Booking { create ( features : instance ); with draft; }",
        "association _Item { with dependent draft; link action linkIt; unlink action unlinkIt; inverse function inv; }",
        "association _StreamProperties with hierarchy;",
      ].join("\n"),
    );
    expect(entity.associations.map((a) => a.name.name)).toEqual([
      "_parent",
      "_child",
      "_Booking",
      "_Item",
      "_StreamProperties",
    ]);
    expect(entity.associations[1]?.create).toBeDefined();
    expect(entity.associations[2]?.create?.facets[0]).toMatchObject({ kind: "features", scope: "instance" });
    expect(entity.associations[2]?.withDraft).toBeDefined();
    expect(entity.associations[3]?.withDependentDraft).toBeDefined();
    expect(entity.associations[3]?.linkAction?.name).toBe("linkIt");
    expect(entity.associations[3]?.unlinkAction?.name).toBe("unlinkIt");
    expect(entity.associations[3]?.inverseFunction?.name).toBe("inv");
    expect(entity.associations[4]?.withHierarchy).toBeDefined();
  });

  it("parses every action prefix, parameter, cardinality and result form", () => {
    const entity = bodyOf(
      [
        "action multiply_by_2;",
        "internal action recalcTotalPrice;",
        "static action ( authorization : global ) ResetDemo;",
        "action ( features : instance ) deductDiscount parameter /dmo/a_travel_discount result [1] $self;",
        "factory action copyTravel [1];",
        "static default factory action createTravel parameter ZA_Create [1];",
        "save ( finalize, adjustnumbers ) action recalcTotals;",
        "action ( features : instance, authorization : update ) act15 deep table parameter SOME_ENTITY result selective [1] $self;",
        "action a2_deep_result deep result selective [1] DEMO_CDS_ABSTRACT_ROOT;",
        "action showBooking result [0..*] entity _Booking;",
        "repeatable action retry external 'Retry';",
      ].join("\n"),
    );
    const [plain, internal, statik, discount, factory, defaultFactory, save, deepTable, deepResult, entityResult, repeatable] =
      entity.actions;
    expect(entity.actions).toHaveLength(11);
    expect(plain).toMatchObject({ internal: false, isStatic: false, factory: false });
    expect(internal?.internal).toBe(true);
    expect(statik).toMatchObject({ isStatic: true });
    expect(statik?.facets[0]).toMatchObject({ kind: "authorization", value: "global" });
    expect(discount?.parameter).toMatchObject({ deep: false, table: false, isSelf: false });
    expect(discount?.parameter?.type?.name).toBe("/dmo/a_travel_discount");
    expect(discount?.result).toMatchObject({ selective: false, deep: false, target: { kind: "self" } });
    expect(discount?.result?.cardinality).toMatchObject({ min: 1, max: 1, raw: "[1]" });
    expect(factory).toMatchObject({ factory: true, defaultFactory: false });
    expect(factory?.cardinality).toMatchObject({ min: 1, max: 1 });
    expect(factory?.result).toBeUndefined();
    expect(defaultFactory).toMatchObject({ factory: true, defaultFactory: true, isStatic: true });
    expect(defaultFactory?.cardinality).toMatchObject({ min: 1 });
    expect(save?.savePhases).toEqual(["finalize", "adjustnumbers"]);
    expect(deepTable?.parameter).toMatchObject({ deep: true, table: true });
    expect(deepTable?.result).toMatchObject({ selective: true });
    expect(deepResult?.result).toMatchObject({ deep: true, selective: true, target: { kind: "type" } });
    expect(entityResult?.result?.target).toMatchObject({ kind: "entity" });
    expect(entityResult?.result?.cardinality).toMatchObject({ min: 0, max: "*", raw: "[0..*]" });
    expect(repeatable).toMatchObject({ repeatable: true });
    expect(repeatable?.external?.value).toBe("Retry");
  });

  it("parses functions, including the key-function form and a missing result", () => {
    const entity = bodyOf(
      [
        "function getDaysToFlight result [1] ZA_DaysToFlight;",
        "static function getCurrentRate result [1] I_ExchangeRate;",
        "key SOME_ALTERNATE_KEY function getByAltKey result [1] $self;",
        "function getTotals;",
      ].join("\n"),
    );
    expect(entity.functions.map((f) => f.name.name)).toEqual([
      "getDaysToFlight",
      "getCurrentRate",
      "getByAltKey",
      "getTotals",
    ]);
    expect(entity.functions[1]?.isStatic).toBe(true);
    expect(entity.functions[2]?.keyName?.name).toBe("SOME_ALTERNATE_KEY");
    // RAP082: SAP's own sources disagree on whether `result` is mandatory, so a
    // missing one is a rule question, never a parse error.
    expect(entity.functions[3]?.result).toBeUndefined();
  });

  it("parses validations and determinations, declarations and references alike", () => {
    const entity = bodyOf(
      [
        "validation validate on save { create; field num1, arithm_op, num2; }",
        "determination det_modify on modify { field num1, num2; }",
        "determination det_save on save { create; update; }",
        "determine action checkDates",
        "{",
        "  determination ( always ) det_totals;",
        "  validation validateDates;",
        "  validation Booking~validateBookingStatus;",
        "}",
      ].join("\n"),
    );
    const validation = entity.validations[0];
    expect(validation).toMatchObject({ isDeclaration: true, on: "save" });
    expect(validation?.triggers.map((t) => t.op ?? t.fields?.map((f) => f.name).join("+"))).toEqual([
      "create",
      "num1+arithm_op+num2",
    ]);
    expect(entity.determinations[0]).toMatchObject({ on: "modify", isDeclaration: true });
    expect(entity.determinations[1]?.triggers.map((t) => t.op)).toEqual(["create", "update"]);

    const determineAction = entity.determineActions[0];
    expect(determineAction).toMatchObject({ draft: false, extend: false, extensible: false });
    expect(determineAction?.items).toHaveLength(3);
    expect(determineAction?.items[0]).toMatchObject({ kind: "determination", always: true, isDeclaration: false });
    expect(determineAction?.items[2]).toMatchObject({ kind: "validation", isDeclaration: false });
    const qualified = determineAction?.items[2];
    expect(qualified?.name.qualifier?.name).toBe("Booking");
    expect(qualified?.name.key).toBe("VALIDATEBOOKINGSTATUS");
  });

  it("parses draft actions and every `draft determine action Prepare` shape", () => {
    const entity = bodyOf(
      [
        "draft action Edit;",
        "draft action Activate optimized;",
        "draft action ( features : instance ) Discard;",
        "draft action AdditionalSave with additional implementation;",
        "draft determine action Prepare;",
        "extend draft determine action  Prepare",
        "{",
        "  validation zz_validateDeliveryDate;",
        "}",
      ].join("\n"),
    );
    expect(entity.draftActions.map((d) => d.name.name)).toEqual([
      "Edit",
      "Activate",
      "Discard",
      "AdditionalSave",
    ]);
    expect(entity.draftActions[1]?.optimized).toBe(true);
    expect(entity.draftActions[2]?.facets[0]).toMatchObject({ kind: "features", scope: "instance" });
    expect(entity.draftActions[3]?.withAdditionalImplementation).toBe(true);
    expect(entity.determineActions[0]).toMatchObject({ draft: true, extend: false, items: [] });
    expect(entity.determineActions[1]).toMatchObject({ draft: true, extend: true });
    expect(entity.determineActions[1]?.items).toHaveLength(1);

    const extensible = bodyOf("draft determine action Prepare extensible;");
    expect(extensible.determineActions[0]).toMatchObject({ draft: true, extensible: true });
  });

  it("parses business events", () => {
    const entity = bodyOf(
      [
        "event created;",
        "event updated parameter zdemo_abap_abstract_ent;",
        "event QuantityUpdated for side effects;",
        "managed event TravelAccepted on TravelChanged parameter I_TravelEventParameter;",
      ].join("\n"),
    );
    expect(entity.events.map((e) => e.name.name)).toEqual([
      "created",
      "updated",
      "QuantityUpdated",
      "TravelAccepted",
    ]);
    expect(entity.events[1]?.parameter?.type?.name).toBe("zdemo_abap_abstract_ent");
    expect(entity.events[2]?.forSideEffects).toBe(true);
    expect(entity.events[3]).toMatchObject({ managed: true });
    expect(entity.events[3]?.on?.name).toBe("TravelChanged");
  });

  it("parses every side-effect source and target shape", () => {
    const entity = bodyOf(
      [
        "side effects",
        "{",
        "  field TravelStatus affects field TotalPrice;",
        "  field FlightPrice affects field _Travel.TotalPrice;",
        "  $self affects field _Booking.Status;",
        "  action acceptTravel affects field *, permissions(action rejectTravel), messages;",
        "  determine action recalcTotals executed on field Quantity, field _Item.Price affects field GrandTotal;",
        "  determine action validateAirline executed on global affects messages;",
        "  event travelBooked affects entity _Booking;",
        "  event statusUpdated affects field ( TotalPrice, Notes, OverallStatus );",
        "  field X affects entity ( _A, _B ), entity _A.( _B, _C ), $self;",
        "}",
      ].join("\n"),
    );
    const block = entity.sideEffects[0] as SideEffectsBlock;
    expect(block.entries).toHaveLength(9);
    expect(block.entries[0]?.source).toMatchObject({ kind: "field" });
    expect(block.entries[1]?.targets[0]).toMatchObject({ kind: "field", wildcard: false });
    expect(
      block.entries[1]?.targets[0]?.kind === "field" &&
        block.entries[1]?.targets[0]?.path.map((p) => p.name),
    ).toEqual(["_Travel", "TotalPrice"]);
    expect(block.entries[2]?.source).toMatchObject({ kind: "self" });
    expect(block.entries[3]?.targets.map((t) => t.kind)).toEqual(["field", "permissions", "messages"]);
    expect(block.entries[3]?.targets[0]).toMatchObject({ wildcard: true });
    expect(block.entries[3]?.targets[1]).toMatchObject({ target: "action rejectTravel" });
    expect(block.entries[4]?.source).toMatchObject({ kind: "determine-action" });
    expect(block.entries[4]?.executedOn).toHaveLength(2);
    expect(block.entries[5]?.executedOn?.[0]).toMatchObject({ kind: "global" });
    expect(block.entries[6]?.targets[0]).toMatchObject({ kind: "entity" });
    // A parenthesised field list becomes one target per field.
    expect(block.entries[7]?.targets).toHaveLength(3);
    const grouped = block.entries[8]?.targets;
    expect(grouped?.map((t) => t.kind)).toEqual(["entity", "entity", "self"]);
    expect(grouped?.[1]?.kind === "entity" && grouped[1].assocs.map((a) => a.map((i) => i.name).join("."))).toEqual([
      "_A._B",
      "_A._C",
    ]);
  });

  it("parses type mappings in every observed form", () => {
    const entity = bodyOf(
      [
        "mapping for ZTAB { UUID = UUID; LastChangedAt = LAST_CHANGED_AT; }",
        "mapping for ztab control ztab_x corresponding { A = a; }",
        "mapping for ztab corresponding extensible { B = b; }",
        "deep mapping for DEMO_STRUC { char10 = char_10; sub _itemTable = tabelle; }",
        "mapping for ztab corresponding except ( A, B ) { C = c; }",
      ].join("\n"),
    );
    expect(entity.mappings).toHaveLength(5);
    expect(entity.mappings[0]?.items).toHaveLength(2);
    expect(entity.mappings[0]?.items[0]).toMatchObject({ cdsField: { name: "UUID" } });
    expect(entity.mappings[1]?.control?.name).toBe("ztab_x");
    expect(entity.mappings[1]?.corresponding).toBe(true);
    expect(entity.mappings[2]).toMatchObject({ corresponding: true, extensible: true });
    expect(entity.mappings[3]).toMatchObject({ deep: true });
    expect(entity.mappings[3]?.items[1]?.sub?.name).toBe("_itemTable");
    expect(entity.mappings[4]?.except.map((f) => f.name)).toEqual(["A", "B"]);
  });

  it("parses every `use` clause form", () => {
    const entity = firstEntity(
      [
        "projection;",
        "define behavior for ZC_X alias X",
        "use etag",
        "{",
        "  use create;",
        "  use update;",
        "  use delete;",
        "  use draft;",
        "  use draft as dependent;",
        "  use collaborative draft;",
        "  use side effects;",
        "  use action Edit;",
        "  use function getRate;",
        "  use event statusUpdated;",
        "  use association _Item { create; with draft; }",
        "  use association _Other { with dependent draft; }",
        "  use mapping for ztab { A = a; }",
        "}",
      ].join("\n"),
    );
    expect(entity.uses.map((u) => u.what)).toEqual([
      "create",
      "update",
      "delete",
      "draft",
      "draft-as-dependent",
      "collaborative-draft",
      "side-effects",
      "action",
      "function",
      "event",
      "association",
      "association",
      "mapping",
    ]);
    expect(entity.uses[7]?.name?.name.name).toBe("Edit");
    expect(entity.uses[10]?.assoc?.create).toBeDefined();
    expect(entity.uses[10]?.assoc?.withDraft).toBeDefined();
    expect(entity.uses[11]?.assoc?.withDependentDraft).toBeDefined();
    expect(entity.uses[12]?.mappingItems).toHaveLength(1);
  });

  it("parses a group block", () => {
    const entity = bodyOf("group G1 { create; update; }");
    expect(entity.groups).toHaveLength(1);
    expect(entity.groups[0]?.name?.name).toBe("G1");
    expect(entity.groups[0]?.body.map((s) => s.kind)).toEqual(["operation", "operation"]);
  });

  it("tolerates a numbering clause written inside the body", () => {
    const entity = bodyOf("field ( readonly, numbering : managed ) TravelUUID;\nearly numbering;");
    expect(entity.numbering).toMatchObject({ when: "early" });
    expect(entity.body.map((s) => s.kind)).toEqual(["field"]);
  });
});

describe("ranges", () => {
  it("anchors each node on its own span, 1-based", () => {
    const entity = firstEntity(
      [
        "managed implementation in class ZBP_X unique;",
        "define behavior for ZX alias X",
        "persistent table zx",
        "lock master total etag LastChangedAt",
        "{",
        "  create;",
        "}",
      ].join("\n"),
    );
    const totalEtag = entity.characteristics.find((c) => c.kind === "total-etag");
    // The `total` keyword, not the whole entity — spec §2.2.
    expect(totalEtag?.range).toEqual({
      start: { line: 4, column: 13 },
      end: { line: 4, column: 37 },
    });
    expect(entity.range.start).toEqual({ line: 2, column: 1 });
    expect(entity.range.end).toEqual({ line: 7, column: 2 });
    expect(entity.operations[0]?.range).toEqual({
      start: { line: 6, column: 3 },
      end: { line: 6, column: 10 },
    });
  });

  /*
   * Findings anchor on ranges (spec §2.2), so a single node built with a
   * transposed or zero position would misplace a finding in the user's editor
   * with nothing else failing. This walks every node the corpus produces and
   * checks the invariant directly, rather than trusting the handful of
   * hand-written positions above.
   *
   * The tagged unions ResultTarget / SideEffectSource / SideEffectTrigger /
   * SideEffectTarget deliberately do NOT extend Node in spec §2.2 — the
   * enclosing ResultClause / SideEffectEntry carries the range — so they are
   * the one exempt shape.
   */
  it("gives every node in the whole corpus a well-formed 1-based range", () => {
    // Exempt by POSITION, not by kind: `kind: "field"` is a rangeless
    // SideEffectSource at `.source` but a range-carrying FieldStatement
    // everywhere else, so a kind-based exemption would hide a real regression.
    const isRangelessSlot = (path: string): boolean =>
      /\.source$/.test(path) ||          // SideEffectEntry.source
      /\.targets\[\d+\]$/.test(path) ||   // SideEffectEntry.targets[]
      /\.executedOn\[\d+\]$/.test(path) || // SideEffectEntry.executedOn[]
      /\.result\.target$/.test(path);    // ResultClause.target

    let checked = 0;
    const problems: string[] = [];

    const visit = (value: unknown, path: string, file: string, lineCount: number): void => {
      if (Array.isArray(value)) {
        value.forEach((item, i) => visit(item, `${path}[${i}]`, file, lineCount));
        return;
      }
      if (typeof value !== "object" || value === null) return;
      const node = value as Record<string, unknown>;
      const range = node["range"] as
        | { start: { line: number; column: number }; end: { line: number; column: number } }
        | undefined;

      if (range === undefined) {
        const kind = node["kind"];
        // Anything Node-derived must carry a range; only the exempt slots may not.
        if (typeof kind === "string" && !isRangelessSlot(path)) {
          problems.push(`${file} ${path}: node kind "${kind}" has no range`);
        }
      } else {
        checked += 1;
        const { start, end } = range;
        const ok =
          Number.isInteger(start.line) &&
          Number.isInteger(start.column) &&
          Number.isInteger(end.line) &&
          Number.isInteger(end.column) &&
          start.line >= 1 &&
          start.column >= 1 &&
          end.line <= lineCount + 1 &&
          (end.line > start.line || (end.line === start.line && end.column >= start.column));
        if (!ok) problems.push(`${file} ${path}: ${JSON.stringify(range)}`);
      }

      for (const [key, child] of Object.entries(node)) {
        if (key === "range") continue;
        visit(child, `${path}.${key}`, file, lineCount);
      }
    };

    for (const file of CORPUS_BDEFS) {
      const source = readFileSync(file, "utf8");
      const result = parseBehaviorDefinition(source, file.split("/").pop());
      visit(result.ast, "ast", file.replace(CORPUS, ""), source.split("\n").length);
    }

    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(5_700);
  });
});

describe("two-tier diagnostics", () => {
  it("reports an unrecognised statement as RAP000 material, never as an error", () => {
    const result = parseBehaviorDefinition(inBody("read;"), "zwrap.bdef.asbdef");
    expect(result.errors).toEqual([]);
    expect(result.unknown).toHaveLength(1);
    expect(result.unknown[0]).toMatchObject({ kind: "unknown", leadingKey: "READ" });
    expect(result.unknown[0]?.range.start.line).toBe(6);
    const entity = result.ast.entities[0];
    expect(entity?.unknown).toHaveLength(1);
    expect(entity?.body.map((s) => s.kind)).toEqual(["unknown"]);
  });

  it("keeps parsing after an unrecognised statement", () => {
    const result = parseBehaviorDefinition(
      inBody(["create;", "functions ( instance );", "update;", "delete;"].join("\n")),
    );
    expect(result.errors).toEqual([]);
    expect(result.unknown).toHaveLength(1);
    expect(result.ast.entities[0]?.operations.map((o) => o.verb)).toEqual(["create", "update", "delete"]);
  });

  it("records an unrecognised entity characteristic without an error", () => {
    const result = parseBehaviorDefinition(
      "managed;\ndefine behavior for ZX\npersistent table zx\ndraught table zx_d\nlock master\n{ create; }",
    );
    expect(result.errors).toEqual([]);
    expect(result.unknown.map((u) => u.leadingKey)).toEqual(["DRAUGHT"]);
    const entity = result.ast.entities[0];
    // The suppression contract of spec §3.7 needs the skipped span to stay
    // reachable from the entity: RAP026 must go quiet here, not fire.
    expect(entity?.draftTable).toBeUndefined();
    expect(entity?.characteristics.map((c) => c.kind)).toEqual([
      "persistent-table",
      "unknown",
      "lock-master",
    ]);
    expect(entity?.persistentTable?.name).toBe("zx");
    expect(entity?.lockMaster).toBeDefined();
  });

  it("reports punctuation-level breakage as exactly one error and recovers", () => {
    const source = [
      "managed implementation in class zbp_wrap unique;",
      "define behavior for ZWRAP alias Wrap",
      "persistent table zwrap",
      "lock master",
      "{",
      "  create;",
      "  field ( readonly ;",
      "  update;",
      "  delete;",
      "}",
      "",
      "define behavior for ZWRAP_ITEM alias Item",
      "lock dependent by _Parent",
      "{",
      "  update;",
      "}",
    ].join("\n");
    const result = parseBehaviorDefinition(source, "zwrap.bdef.asbdef");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      kind: "syntax",
      line: 7,
      excerpt: "field ( readonly ;",
      file: "zwrap.bdef.asbdef",
    });
    // One bad statement, one finding — and no duplicate RAP000 for the same span.
    expect(result.unknown).toEqual([]);
    const [wrap, item] = result.ast.entities;
    expect(wrap?.operations.map((o) => o.verb)).toEqual(["create", "update", "delete"]);
    expect(wrap?.unknown).toHaveLength(1);
    expect(item?.entity.name).toBe("ZWRAP_ITEM");
    expect(item?.operations.map((o) => o.verb)).toEqual(["update"]);
    expect(result.truncated).toBe(false);
  });

  // The recovery scan used to treat the braces an unrecognised statement
  // opened as transparent and run on to the next `;` at relative depth 0 —
  // which, for a header-level block, is a `;` inside the NEXT entity's body,
  // so the whole rest of the file became one UnknownStatement (0 entities, 0
  // rules run, nothing in either honesty counter). Spec §2.3 recovery
  // contract point 3: one bad statement, one finding, everything after it
  // still parsed and still rule-checked.
  it("stops recovery at the `}` of a block the unrecognised HEADER statement opened", () => {
    const result = parseBehaviorDefinition(
      [
        "managed implementation in class zbp unique;",
        "strict ( 2 );",
        "define authorization context ZCTX for disable",
        "{",
        "  save:early;",
        "}",
        "define behavior for ZR_X alias X",
        "persistent table zx",
        "etag master L",
        "lock master",
        "authorization master ( global )",
        "{",
        "  create;",
        "  draft action Reject;",
        "}",
      ].join("\n"),
      "z.bdef.asbdef",
    );
    expect(result.errors).toEqual([]);
    expect(result.unknown.map((u) => u.leadingKey)).toEqual(["DEFINE"]);
    expect(result.ast.entities).toHaveLength(1);
    const entity = result.ast.entities[0];
    expect(entity?.entity.name).toBe("ZR_X");
    expect(entity?.operations.map((o) => o.verb)).toEqual(["create"]);
    expect(entity?.draftActions.map((d) => d.name.name)).toEqual(["Reject"]);
  });

  it("stops recovery at the `}` of a block an unrecognised ENTITY-BODY statement opened", () => {
    // `features { instance { … } }` as a standalone block is one of the six
    // legal constructs corpus-inventory.md §5 records as absent from the
    // corpus: unknown to our grammar, but the `update;` after it must live.
    const result = parseBehaviorDefinition(
      inBody(["create;", "features { instance { field Price; } }", "update;"].join("\n")),
      "zwrap.bdef.asbdef",
    );
    expect(result.errors).toEqual([]);
    expect(result.unknown.map((u) => u.leadingKey)).toEqual(["FEATURES"]);
    expect(result.ast.entities[0]?.operations.map((o) => o.verb)).toEqual(["create", "update"]);
  });

  it("reports a stray closing brace", () => {
    const result = parseBehaviorDefinition("managed;\ndefine behavior for ZX\n{ create; }\n}\n");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/Unexpected `}`/);
    expect(result.ast.entities).toHaveLength(1);
  });

  it("reports a statement that reaches EOF without its `;`", () => {
    const result = parseBehaviorDefinition("managed;\ndefine behavior for ZX\n{\n  create\n");
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]?.message).toMatch(/end of the file/);
  });

  it("stops at MAX_RECOVERY_EVENTS on a pathological file", () => {
    const result = parseBehaviorDefinition(inBody("  field ( readonly ;\n".repeat(500)));
    expect(MAX_RECOVERY_EVENTS).toBe(200);
    expect(result.truncated).toBe(true);
    expect(result.errors).toHaveLength(MAX_RECOVERY_EVENTS);
  });
});

describe("recovery checks every delimiter kind (review finding: parser.ts §makeUnknown)", () => {
  it("reports `future ( ;` inside an entity as RAP-PARSE, not as a RAP000 info", () => {
    const result = parseBehaviorDefinition(inBody("  future ( ;"), "zwrap.bdef.asbdef");
    // `synchronize()` only ever tracked braces, so an unclosed `(` used to
    // reduce to a well-formed-looking unknown statement — RAP000 info, and a
    // file report of `parsed: true` over text that does not parse.
    expect(result.unknown).toEqual([]);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
    expect(result.errors[0]?.message).toMatch(/Unbalanced/);
    expect(result.errors[0]?.kind).toBe("syntax");
  });

  it("reports an unclosed `[` in a skipped statement the same way", () => {
    const result = parseBehaviorDefinition(inBody("  frobnicate [ a ;"), "zwrap.bdef.asbdef");
    expect(result.unknown).toEqual([]);
    expect(result.errors.some((e) => /Unbalanced/.test(e.message))).toBe(true);
  });

  it("keeps a balanced unknown statement at the info tier — the two tiers stay distinct", () => {
    const result = parseBehaviorDefinition(inBody("  frobnicate ( a, b ) [ c ];"), "zwrap.bdef.asbdef");
    expect(result.errors).toEqual([]);
    expect(result.unknown.map((u) => u.leadingKey)).toEqual(["FROBNICATE"]);
  });
});
