/**
 * Rule registry and the v1 BDEF rule set — spec
 * `docs/specs/rap-checker-design.md` §2.5 (registry), §3.1 (confirmed →
 * error), §3.2 (inferred → warning), §3.3 (structural pseudo-rules) and §3.7
 * (the suppression contract).
 *
 * Three constraints shape every rule below, and none of them is negotiable:
 *
 *  1. **A guessed error is worse than no tool** (`docs/DESIGN.md` §4). Rules
 *     fire only on evidence the BDEF itself carries, or on a companion file
 *     the caller passed in the same call. Everything that needs DDIC, a
 *     behavior-pool class or a CDS field's ABAP type is out (spec §3.6).
 *  2. **Confirmed ⇒ error, everything else ⇒ warning at most** (spec §2.5).
 *     A non-`confirmed` rule's message ends in a bracketed provenance clause,
 *     appended by the runner so no rule can forget it. A unit test enforces
 *     both halves.
 *  3. **Never fire on evidence that is absent because a statement was
 *     skipped** (spec §1.3/§3.7). Every "X must be declared" rule calls
 *     `ctx.mayBeHiddenBy()` first; a suppression is counted, not hidden.
 *
 * Deviations from the spec's rule table, all deliberate, all tested:
 *
 *  - **RAP003 covers the ETag and lock dependent clauses only.** The spec
 *    lists the authorization clause under RAP003 *and* gives RAP031 the same
 *    condition; running both would report one defect twice on one line.
 *    RAP031 owns `authorization dependent by`.
 *  - **RAP001 stays silent on `shape: "unknown"`, `"projection-view"` and
 *    `"transactional-interface"`.** A projection BDEF's CDS source is a
 *    projection view by construction, so the spec's literal
 *    `shape !== "root-view-entity"` would fire on every correct projection.
 *  - **Rules that read an entity body read through `group { … }` blocks.**
 *    The parser keeps group members in `GroupStatement.body` and does not
 *    bucket them onto the entity, so a rule using `entity.actions` directly
 *    would miss them.
 */
import type {
  ActionStatement,
  AssociationStatement,
  BodyStatement,
  DeterminationStatement,
  DetermineActionStatement,
  DraftActionStatement,
  EntityBehavior,
  EntityCharacteristic,
  EventStatement,
  Facet,
  FieldStatement,
  FunctionStatement,
  Ident,
  OperationStatement,
  Range,
  SideEffectsBlock,
  UseStatement,
  ValidationStatement,
} from "./ast.js";
import type {
  CdsEntityInfo,
  ParsedBdef,
  ParsedSrvd,
  RapConfidence,
  RapFinding,
  RapRule,
  RapRuleContext,
  RapSeverity,
} from "./context.js";
import type { KnowledgeRelease } from "../knowledge.js";
import { MAX_FINDINGS } from "../engine.js";
import { excerptOf, normalizeRapSource } from "./lexer.js";
import { GRAMMAR_VERSION } from "./parser.js";

/** Bump on any change to the rule set — stamped onto every report. */
export const RAP_RULES_VERSION = "rap-rules/1.0.0";

/** Where a finding's `docsUrl` points. */
export const RAP_RULES_DOC_BASE =
  "https://github.com/palimkarakshay/abap-mcp/blob/main/docs/RAP-RULES.md";

/** Spec §9 item 1: RAP000 is honest but chatty — cap it per file. */
export const MAX_UNKNOWN_FINDINGS_PER_FILE = 50;

/** Spec §3.3: one RAP-PARSE finding per recovery point, max 200. */
export const MAX_PARSE_FINDINGS_PER_FILE = 200;

/**
 * Appended to every finding of a rule whose confidence is not `confirmed`
 * (spec §2.5), unless the rule already ended its message with its own
 * bracketed clause.
 */
const PROVENANCE_CLAUSE: Record<Exclude<RapConfidence, "confirmed">, string> = {
  inferred: " [inferred from SAP documentation, not stated directly — treat as advisory]",
  "community-reported":
    " [reported by the SAP community, not stated in SAP documentation — treat as advisory]",
  conflicting: " [SAP sources conflict on this point — treat as advisory]",
};

/* --------------------------------------------------------------- sources */

const URL_STRICT =
  "https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp";
const URL_CHEAT_SHEET =
  "https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md";
const URL_DRAFT_BO = "https://help.sap.com/docs/abap-cloud/abap-rap/draft-business-object?version=sap_btp";
const URL_DRAFT_TABLE = "https://help.sap.com/docs/abap-cloud/abap-rap/draft-database-table?version=sap_btp";
const URL_DRAFT_ACTIONS = "https://help.sap.com/docs/abap-cloud/abap-rap/draft-actions?version=sap_btp";
const URL_AUTHORIZATION =
  "https://help.sap.com/docs/abap-cloud/abap-rap/authorization-definition?version=sap_btp";
const URL_TOTAL_ETAG = "https://help.sap.com/docs/abap-cloud/abap-rap/total-etag?version=sap_btp";
const URL_ELEMENTARY_BEHAVIOR =
  "https://help.sap.com/docs/abap-cloud/abap-rap/defining-elementary-behavior-for-ready-to-run-business-object";
const URL_EARLY_NUMBERING =
  "https://help.sap.com/docs/abap-cloud/abap-rap/internal-early-numbering?version=sap_btp";
const URL_ACTION_DEFINITION =
  "https://help.sap.com/docs/abap-cloud/abap-rap/action-definition?version=sap_btp";
const URL_FEATURE_CONTROL = "https://help.sap.com/docs/abap-cloud/abap-rap/feature-control?version=sap_btp";
const URL_VALIDATION = "https://help.sap.com/docs/abap-cloud/abap-rap/validation-definition?version=sap_btp";
const URL_PROJECTION_BEHAVIOR =
  "https://help.sap.com/docs/abap-cloud/abap-rap/providing-behavior-for-projections?version=sap_btp";
const URL_INTERFACE_BDEF = "https://help.sap.com/docs/abap-cloud/abap-keyword/rap-interface-behavior-definition";
const URL_FEATURE_TABLES = "https://help.sap.com/docs/abap-cloud/abap-keyword/rap-bdl-feature-tables";
const URL_BDL_INDEX = "https://help.sap.com/docs/abap-cloud/abap-keyword/rap-bdl-behavior-definition-language";

/* --------------------------------------------------------------- helpers */

/**
 * Every leading keyword our grammar dispatches on. An `UnknownStatement`
 * whose leading key is outside this set is a construct we know nothing about,
 * so it could plausibly be *any* declaration — spec §3.7's "or is
 * unrecognised entirely".
 */
const KNOWN_LEADING_KEYS = new Set([
  "MANAGED", "UNMANAGED", "PROJECTION", "ABSTRACT", "INTERFACE", "IMPLEMENTATION", "EXTENSION",
  "STRICT", "EXTENSIBLE", "AUXILIARY", "SAVE", "USE", "WITH", "DEFINE", "EXTEND",
  "PERSISTENT", "DRAFT", "QUERY", "ETAG", "TOTAL", "LOCK", "AUTHORIZATION", "EARLY", "LATE",
  "CHANGEDOCUMENTS", "CREATE", "UPDATE", "DELETE", "INTERNAL", "FIELD", "ASSOCIATION",
  "ACTION", "FUNCTION", "STATIC", "REPEATABLE", "FACTORY", "DEFAULT", "KEY",
  "DETERMINATION", "VALIDATION", "DETERMINE", "SIDE", "MAPPING", "EVENT", "GROUP", "PRECHECK",
]);

/** The four draft actions a strict draft BO / its projection must declare, as written. */
const DRAFT_ACTION_NAMES = ["Edit", "Activate", "Discard", "Resume"] as const;
/** Every legal `draft action` name (spec §3.1, RAP081). */
const LEGAL_DRAFT_ACTIONS = new Set(["EDIT", "ACTIVATE", "DISCARD", "RESUME", "ADDITIONALSAVE", "SHARE"]);

const flatBodyCache = new WeakMap<EntityBehavior, BodyStatement[]>();

/**
 * The entity's body flattened through `group { … }` blocks. The parser keeps
 * group members off the entity's typed buckets, so every rule reads this.
 */
function flatBody(entity: EntityBehavior): BodyStatement[] {
  const cached = flatBodyCache.get(entity);
  if (cached !== undefined) return cached;
  const out: BodyStatement[] = [];
  const visit = (statements: BodyStatement[]): void => {
    for (const statement of statements) {
      out.push(statement);
      if (statement.kind === "group") visit(statement.body);
    }
  };
  visit(entity.body);
  flatBodyCache.set(entity, out);
  return out;
}

function operationsOf(e: EntityBehavior): OperationStatement[] {
  return flatBody(e).filter((s): s is OperationStatement => s.kind === "operation");
}
function fieldsOf(e: EntityBehavior): FieldStatement[] {
  return flatBody(e).filter((s): s is FieldStatement => s.kind === "field");
}
function associationsOf(e: EntityBehavior): AssociationStatement[] {
  return flatBody(e).filter((s): s is AssociationStatement => s.kind === "association");
}
function actionsOf(e: EntityBehavior): ActionStatement[] {
  return flatBody(e).filter((s): s is ActionStatement => s.kind === "action");
}
function functionsOf(e: EntityBehavior): FunctionStatement[] {
  return flatBody(e).filter((s): s is FunctionStatement => s.kind === "function");
}
function validationsOf(e: EntityBehavior): ValidationStatement[] {
  return flatBody(e).filter((s): s is ValidationStatement => s.kind === "validation");
}
function determinationsOf(e: EntityBehavior): DeterminationStatement[] {
  return flatBody(e).filter((s): s is DeterminationStatement => s.kind === "determination");
}
function determineActionsOf(e: EntityBehavior): DetermineActionStatement[] {
  return flatBody(e).filter((s): s is DetermineActionStatement => s.kind === "determine-action");
}
function draftActionsOf(e: EntityBehavior): DraftActionStatement[] {
  return flatBody(e).filter((s): s is DraftActionStatement => s.kind === "draft-action");
}
function sideEffectsOf(e: EntityBehavior): SideEffectsBlock[] {
  return flatBody(e).filter((s): s is SideEffectsBlock => s.kind === "side-effects");
}
function eventsOf(e: EntityBehavior): EventStatement[] {
  return flatBody(e).filter((s): s is EventStatement => s.kind === "event");
}
function usesOf(e: EntityBehavior): UseStatement[] {
  const out = flatBody(e).filter((s): s is UseStatement => s.kind === "use");
  for (const characteristic of e.characteristics) {
    if (characteristic.kind === "use") out.push(characteristic.use);
  }
  return out;
}

function defineEntities(file: ParsedBdef): EntityBehavior[] {
  return file.ast.entities.filter((e) => e.form === "define");
}
function rootOf(file: ParsedBdef): EntityBehavior | undefined {
  return file.ast.entities.find((e) => e.isRoot);
}

/**
 * Decide which entity of a BDEF is the BO root, and stamp `isRoot` onto the
 * parsed entities before any rule reads it (breaker probe P2-2).
 *
 * **Is root-first required by BDL?** Researched 2026-09-10 against SAP's own
 * documentation. The ABAP Keyword Documentation page *RAP -
 * EntityBehaviorDefinition* (`abenbdl_define_beh.htm`, reachable today only
 * as an archived snapshot) notates a whole behavior definition as ONE
 * construct anchored on the root —
 * `define behavior for RootEntity … [define behavior for ChildEntity1] [, …]`
 * — and says: *"An entity behavior definition for the RAP BO root entity
 * RootEntity is mandatory, whereas entity behavior definitions for child
 * entities are optional."* SAP's cheat sheet and every one of the 79 corpus
 * BDEFs write the root first. What **no** primary source states is that the
 * order is *enforced*: neither the BDL pages nor any documented ADT syntax
 * check says a child-first file is rejected, and root-ness is really carried
 * by the CDS composition tree, not by file position. The requirement is
 * therefore **unconfirmed**, and §2.5 caps an unconfirmed rule at `warning` —
 * so this checker does not invent an error out of statement order. It reads
 * either order and derives the root from evidence:
 *
 *  1. **The CDS shape, when the `.ddls` are in the call** — exactly one
 *     `define`-form entity whose CDS view is a `define root view entity`.
 *     The only evidence-based answer available to us.
 *  2. **Otherwise the first `define behavior for`** — SAP's own notation and
 *     the whole corpus. A convention used as a fallback, never as a claim.
 *
 * The third candidate signal, *"the entity no other entity's composition
 * targets"*, needs composition-tree resolution (association → target entity),
 * which spec §3.6 defers to v1.1: BDL names associations, not their targets,
 * and abaplint's CDS `associations` are names too.
 *
 * Before this, `isRoot` was purely positional, and a legal child-first BDEF
 * drew three false errors (RAP028/RAP029/RAP013) plus a false RAP001.
 */
function deriveRootEntity(file: ParsedBdef, cds: Map<string, CdsEntityInfo>): void {
  const entities = defineEntities(file);
  if (entities.length === 0) return;
  const rootViews = entities.filter((e) => cds.get(e.entity.key)?.shape === "root-view-entity");
  const root = rootViews.length === 1 ? rootViews[0] : entities[0];
  for (const e of file.ast.entities) e.isRoot = e === root;
}
/** managed / unmanaged / unspecified — the forms that own persistence and locks. */
function isTransactionalBase(file: ParsedBdef): boolean {
  const type = file.ast.implementationType;
  return type === "managed" || type === "unmanaged" || type === "unspecified";
}
function isDraftEnabled(file: ParsedBdef): boolean {
  return file.ast.withDraft !== undefined;
}
function entityLabel(e: EntityBehavior): string {
  return e.alias?.name ?? e.entity.name;
}
/** `association _X;` in a base BDEF, `use association _X;` in a projection. */
function declaresAssociation(e: EntityBehavior, key: string): boolean {
  if (associationsOf(e).some((a) => a.name.key === key)) return true;
  return usesOf(e).some((u) => u.what === "association" && u.name?.key === key);
}
function hasFeatureScope(facets: Facet[], scope: "instance" | "global"): boolean {
  return facets.some((f) => f.kind === "features" && f.scope === scope);
}
function list(values: readonly string[]): string {
  return values.join(", ");
}
function namesOf(idents: readonly Ident[]): string {
  return idents.map((i) => i.name).join(", ");
}

/* ----------------------------------------------------------- the catalog */

/** Spec §3.1 — confirmed in primary SAP documentation, therefore `error`. */
const CONFIRMED_RULES: RapRule[] = [
  {
    id: "RAP001",
    title: "BO root must be a root view entity",
    severity: "error",
    confidence: "confirmed",
    requires: ["ddls"],
    sourceUrl: URL_ELEMENTARY_BEHAVIOR,
    docsAnchor: "rap001",
    hint: "Point the BO's root \"define behavior for\" at a root view entity, or add \"root\" to the CDS view definition.",
    check(ctx) {
      const root = rootOf(ctx.file);
      if (root === undefined) return;
      const info = ctx.cds.get(root.entity.key);
      if (info === undefined) return;
      // "unknown" is no evidence; a projection view is what a projection BDEF
      // is built on by construction; a transactional interface is its own form.
      const decidable = ["view-entity", "abstract-entity", "classic-view", "table-entity", "custom-entity"];
      if (!decidable.includes(info.shape)) return;
      if (!isTransactionalBase(ctx.file)) return;
      ctx.report({
        range: root.entity.range,
        entity: root.entity.name,
        message:
          `The root behavior definition in this file is for ${root.entity.name}, which is declared as a ` +
          `${info.shape} — a BO root must be a "define root view entity".`,
      });
    },
  },
  {
    /**
     * **Warning, not error, and deliberately so.** The evidence is the file
     * set the caller happened to pass: `requires: ["ddls"]` is satisfied by
     * ONE `.ddls`, after which every other entity in every other BDEF would
     * be "missing". Passing a base BDEF, its projection and only the
     * projection's CDS view — the normal partial set an agent assembles — is
     * legal RAP, and reporting three errors on it is exactly the false
     * positive spec §1.3 budgets against. Absence here means "not supplied",
     * not "does not exist", which is the reasoning §3.4 already writes down
     * for SRVD006 — the identical epistemic footing, and already a warning.
     */
    id: "RAP002",
    title: "Referenced CDS entity was not among the supplied sources",
    severity: "warning",
    confidence: "confirmed",
    requires: ["ddls"],
    sourceUrl: URL_CHEAT_SHEET,
    docsAnchor: "rap002",
    hint: "Pass the entity's .ddls.asddls in the same call, or correct the spelling — BDL matches CDS names exactly (case-insensitively).",
    check(ctx) {
      for (const e of defineEntities(ctx.file)) {
        if (ctx.cds.has(e.entity.key)) continue;
        ctx.report({
          range: e.entity.range,
          entity: e.entity.name,
          message:
            `"define behavior for ${e.entity.name}" references a CDS entity that was not found among the ` +
            ".ddls sources passed in this call — it may simply not have been passed.",
        });
      }
    },
  },
  {
    id: "RAP003",
    title: "Dependent ETag/lock clause must name a declared association",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_STRICT,
    docsAnchor: "rap003",
    hint: 'Add "association <_Assoc>;" to the entity body — dependent clauses may only name associations the BDEF declares.',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const characteristic of e.characteristics) {
          if (characteristic.kind !== "etag-dependent" && characteristic.kind !== "lock-dependent") continue;
          const clause = characteristic.kind === "etag-dependent" ? "etag dependent" : "lock dependent";
          const assoc = characteristic.assoc;
          if (declaresAssociation(e, assoc.key)) continue;
          if (ctx.mayBeHiddenBy(e, ["ASSOCIATION", "USE"])) continue;
          ctx.report({
            range: characteristic.range,
            entity: entityLabel(e),
            message:
              `Entity ${entityLabel(e)} is "${clause} by ${assoc.name}" but ${assoc.name} is not ` +
              "declared in its behavior body.",
            hint: `Add "association ${assoc.name};" to the entity body — dependent clauses may only name associations the BDEF declares.`,
          });
        }
      }
    },
  },
  {
    id: "RAP011",
    title: "managed/unmanaged BDEF needs an implementation class",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_STRICT,
    docsAnchor: "rap011",
    hint: 'Add "<managed|unmanaged> implementation in class zbp_<entity> unique;" as the first statement.',
    check(ctx) {
      const type = ctx.file.ast.implementationType;
      if (type !== "managed" && type !== "unmanaged") return;
      // `managed by bopf;` is the BOPF-bridge form: the behavior is
      // implemented by the bridged BOPF business object, so the statement
      // takes no `implementation in class` clause at all (grammar notes
      // §1.1). Demanding one there is a defect claim about legal BDL.
      if (ctx.file.ast.managedByBopf !== undefined) return;
      if (ctx.file.ast.implementationClass !== undefined) return;
      if (ctx.file.ast.entities.some((e) => e.implementationClass !== undefined)) return;
      if (ctx.mayBeHiddenBy(undefined, ["MANAGED", "UNMANAGED", "IMPLEMENTATION"])) return;
      ctx.report({
        line: 1,
        column: 1,
        message:
          `A ${type} behavior definition needs an implementation class: none is declared in the ` +
          "header or on any entity.",
        hint: `Add "${type} implementation in class zbp_<entity> unique;" as the first statement.`,
      });
    },
  },
  {
    id: "RAP008",
    title: "A strict projection needs a strict base",
    severity: "error",
    confidence: "confirmed",
    requires: ["base-bdef"],
    sourceUrl: URL_STRICT,
    docsAnchor: "rap008",
    hint: 'Add "strict ( 2 );" to the base BDEF — a projection may only be strict if its base is.',
    check(ctx) {
      if (ctx.file.ast.implementationType !== "projection") return;
      const strict = ctx.file.ast.strict;
      if (strict === undefined) return;
      const root = rootOf(ctx.file);
      if (root === undefined) return;
      const base = ctx.resolveBase(root);
      if (base === undefined) return;
      if (base.file.ast.strict !== undefined) return;
      // Spec §3.7 applies to the file the missing declaration would be IN:
      // `strict` is a header statement of the BASE, so an unreadable header
      // statement there could be the very `strict ( 2 );` this rule is about
      // to call absent. Consulting only `ctx.file` (the projection) checked
      // the wrong file's coverage.
      if (ctx.mayBeHiddenIn(base.file, undefined, ["STRICT"])) return;
      ctx.report({
        range: strict.range,
        entity: entityLabel(root),
        message:
          `This projection declares strict(${strict.level}) but its base behavior definition ` +
          `${base.file.filename} does not declare strict.`,
      });
    },
  },
  {
    id: "RAP009",
    title: "A projection cannot be built on an abstract BDEF",
    severity: "error",
    confidence: "confirmed",
    requires: ["base-bdef"],
    sourceUrl: URL_STRICT,
    docsAnchor: "rap009",
    hint: "Project onto a managed or unmanaged BDEF; abstract BDEFs are typing constructs only.",
    check(ctx) {
      if (ctx.file.ast.implementationType !== "projection") return;
      const root = rootOf(ctx.file);
      if (root === undefined) return;
      const base = ctx.resolveBase(root);
      if (base === undefined || base.file.ast.implementationType !== "abstract") return;
      ctx.report({
        range: root.entity.range,
        entity: entityLabel(root),
        message: `A projection behavior definition cannot be built on an abstract behavior definition (${base.file.filename}).`,
      });
    },
  },
  {
    id: "RAP012",
    title: "Feature control must not combine with readonly",
    severity: "error",
    confidence: "confirmed",
    strictOnly: true,
    sourceUrl: URL_STRICT,
    docsAnchor: "rap012",
    hint: "Drop \"readonly\" and let the FOR INSTANCE FEATURES handler return the read-only state, or drop the feature control.",
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const field of fieldsOf(e)) {
          const hasFeatures = field.characteristics.some((c) => c.name === "features");
          const hasReadonly = field.characteristics.some((c) => c.name === "readonly");
          if (!hasFeatures || !hasReadonly) continue;
          ctx.report({
            range: field.range,
            entity: entityLabel(e),
            message:
              `Field(s) ${namesOf(field.fields)} combine feature control with readonly on ` +
              `${entityLabel(e)} — the two are mutually exclusive under strict mode.`,
          });
        }
      }
    },
  },
  {
    id: "RAP013",
    title: "No direct create on a subnode under strict mode",
    severity: "error",
    confidence: "confirmed",
    strictOnly: true,
    sourceUrl: URL_STRICT,
    docsAnchor: "rap013",
    hint: 'Remove "create;" here and add "association _<Child> { create; }" on the parent entity.',
    check(ctx) {
      for (const e of defineEntities(ctx.file)) {
        if (e.isRoot) continue;
        for (const op of operationsOf(e)) {
          if (op.verb !== "create" || op.internal) continue;
          ctx.report({
            range: op.range,
            entity: entityLabel(e),
            message:
              `Non-root entity ${entityLabel(e)} declares a direct "create;" — under strict mode ` +
              "subnodes are created by association only.",
            hint: `Remove "create;" here and add "association _${entityLabel(e)} { create; }" on the parent entity.`,
          });
        }
      }
    },
  },
  {
    id: "RAP018",
    title: "A strict projection on a draft BO must expose the draft actions",
    severity: "error",
    confidence: "confirmed",
    strictOnly: true,
    requires: ["base-bdef"],
    sourceUrl: URL_STRICT,
    docsAnchor: "rap018",
    hint: 'Add "use action Edit; use action Activate; use action Discard; use action Resume; use action Prepare;" to the projection entity body.',
    check(ctx) {
      if (ctx.file.ast.implementationType !== "projection") return;
      const root = rootOf(ctx.file);
      if (root === undefined) return;
      const base = ctx.resolveBase(root);
      if (base === undefined || !isDraftEnabled(base.file)) return;
      if (ctx.mayBeHiddenBy(root, ["USE"])) return;
      const exposed = new Set(
        usesOf(root)
          .filter((u) => u.what === "action" && u.name !== undefined)
          .map((u) => (u.name as { key: string }).key),
      );
      const missing = [...DRAFT_ACTION_NAMES, "Prepare"].filter(
        (name) => !exposed.has(name.toUpperCase()),
      );
      if (missing.length === 0) return;
      ctx.report({
        range: root.entity.range,
        entity: entityLabel(root),
        message:
          "Strict projection on a draft-enabled BO must expose the draft actions explicitly; missing: " +
          `${list(missing)}.`,
      });
    },
  },
  {
    id: "RAP019",
    title: "A strict draft BO must declare its draft actions",
    severity: "error",
    confidence: "confirmed",
    strictOnly: true,
    sourceUrl: URL_STRICT,
    docsAnchor: "rap019",
    hint: 'Add "draft action Edit; draft action Activate optimized; draft action Discard; draft action Resume; draft determine action Prepare;".',
    check(ctx) {
      if (!isDraftEnabled(ctx.file)) return;
      const root = rootOf(ctx.file);
      if (root === undefined) return;
      if (ctx.mayBeHiddenBy(root, ["DRAFT"])) return;
      const declared = new Set(draftActionsOf(root).map((d) => d.name.key));
      const missing: string[] = DRAFT_ACTION_NAMES.filter(
        (name) => !declared.has(name.toUpperCase()),
      );
      const hasPrepare = determineActionsOf(root).some((d) => d.draft && d.name.key === "PREPARE");
      if (!hasPrepare) missing.push("Prepare");
      if (missing.length === 0) return;
      ctx.report({
        range: root.entity.range,
        entity: entityLabel(root),
        message:
          "Strict draft-enabled BO must declare its draft actions explicitly; missing on " +
          `${entityLabel(root)}: ${list(missing)}.`,
      });
    },
  },
  {
    id: "RAP020",
    title: "draft determine action Prepare takes no authorization control",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_STRICT,
    docsAnchor: "rap020",
    hint: 'Remove the "( authorization : … )" facet — Prepare is not authorization-controlled.',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const da of determineActionsOf(e)) {
          if (!da.draft || da.name.key !== "PREPARE") continue;
          if (!da.facets.some((f) => f.kind === "authorization")) continue;
          ctx.report({
            range: da.range,
            entity: entityLabel(e),
            message: '"draft determine action Prepare" must not carry an authorization addition.',
          });
        }
      }
    },
  },
  {
    id: "RAP024",
    title: "with draft belongs in the header, not on an entity",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_DRAFT_BO,
    docsAnchor: "rap024",
    hint: 'Move "with draft;" above the first "define behavior for".',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        if (e.withDraft === undefined) continue;
        const word = e.withDraft.collaborative ? "collaborative draft" : "draft";
        ctx.report({
          range: e.withDraft.range,
          entity: entityLabel(e),
          message:
            `"with ${word}" is declared on entity ${entityLabel(e)}; draft is a property of the whole ` +
            "BO and belongs in the BDEF header.",
        });
      }
    },
  },
  {
    id: "RAP026",
    title: "A draft-enabled BO needs a draft table on its root",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_DRAFT_TABLE,
    docsAnchor: "rap026",
    hint: 'Add "draft table z<table>_d" to the root\'s characteristics (ADT\'s quick-fix on the BDEF generates the table).',
    check(ctx) {
      if (!isDraftEnabled(ctx.file) || !isTransactionalBase(ctx.file)) return;
      const root = rootOf(ctx.file);
      if (root === undefined || root.draftTable !== undefined) return;
      if (ctx.mayBeHiddenBy(root, ["DRAFT"])) return;
      ctx.report({
        range: root.entity.range,
        entity: entityLabel(root),
        message: `The BO is draft-enabled but its root entity ${entityLabel(root)} declares no "draft table".`,
      });
    },
  },
  {
    id: "RAP028",
    title: "Exactly one lock master, on the root",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_STRICT,
    docsAnchor: "rap028",
    hint: 'Declare "lock master" on the root and "lock dependent by _ParentAssoc" on every child.',
    check(ctx) {
      if (!isTransactionalBase(ctx.file)) return;
      const entities = defineEntities(ctx.file);
      if (entities.length === 0) return;
      const masters = entities.filter((e) => e.lockMaster !== undefined);
      if (masters.length !== 1) {
        if (!ctx.mayBeHiddenBy(undefined, ["LOCK"]) && !entities.some((e) => ctx.mayBeHiddenBy(e, ["LOCK"]))) {
          const first = masters[0] ?? entities[0];
          ctx.report({
            range: first?.lockMaster?.range ?? first?.entity.range,
            ...(first !== undefined ? { entity: entityLabel(first) } : {}),
            message:
              `Exactly one entity — the root — must declare "lock master"; found ${masters.length} ` +
              `(${masters.length === 0 ? "none" : list(masters.map(entityLabel))}).`,
          });
        }
      } else {
        const master = masters[0] as EntityBehavior;
        if (!master.isRoot) {
          ctx.report({
            range: master.lockMaster?.range ?? master.entity.range,
            entity: entityLabel(master),
            message:
              `"lock master" is declared on ${entityLabel(master)}, which is not the BO root; ` +
              "exactly one entity — the root — must declare it.",
          });
        }
      }
      for (const e of entities) {
        if (e.isRoot || e.lockMaster !== undefined || e.lockDependentBy !== undefined) continue;
        if (ctx.mayBeHiddenBy(e, ["LOCK"])) continue;
        ctx.report({
          range: e.entity.range,
          entity: entityLabel(e),
          message:
            `Child entity ${entityLabel(e)} declares neither "lock master" nor ` +
            '"lock dependent by <_Assoc>".',
        });
      }
    },
  },
  {
    id: "RAP029",
    title: "Exactly one authorization master, on the root",
    severity: "error",
    confidence: "confirmed",
    strictOnly: true,
    sourceUrl: URL_STRICT,
    docsAnchor: "rap029",
    hint: 'Declare "authorization master ( global )" (or "( instance )") on the root and "authorization dependent by _ParentAssoc" on children.',
    check(ctx) {
      if (!isTransactionalBase(ctx.file)) return;
      const entities = defineEntities(ctx.file);
      if (entities.length === 0) return;
      const masters = entities.filter((e) => e.authorization?.form === "master");
      if (masters.length === 1 && (masters[0] as EntityBehavior).isRoot) return;
      if (ctx.mayBeHiddenBy(undefined, ["AUTHORIZATION"])) return;
      if (entities.some((e) => ctx.mayBeHiddenBy(e, ["AUTHORIZATION"]))) return;
      const anchor = masters[0] ?? entities[0];
      ctx.report({
        range: anchor?.authorization?.range ?? anchor?.entity.range,
        ...(anchor !== undefined ? { entity: entityLabel(anchor) } : {}),
        message:
          masters.length === 1
            ? `"authorization master" is declared on ${entityLabel(masters[0] as EntityBehavior)}, which is not the BO root.`
            : `Exactly one entity — the root — must declare "authorization master"; found ${masters.length}.`,
      });
    },
  },
  {
    id: "RAP030",
    title: "authorization master must name a scope",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_AUTHORIZATION,
    docsAnchor: "rap030",
    hint: 'Write "authorization master ( global )", "( instance )", "( global, instance )" or the explicit opt-out "( none )".',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        const auth = e.authorization;
        if (auth === undefined || auth.form !== "master" || auth.scopes.length > 0) continue;
        ctx.report({
          range: auth.range,
          entity: entityLabel(e),
          message: `"authorization master ( )" on ${entityLabel(e)} names no scope.`,
        });
      }
    },
  },
  {
    id: "RAP031",
    title: "authorization dependent must name a declared association",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_AUTHORIZATION,
    docsAnchor: "rap031",
    hint: 'Declare "association <_Assoc>;" in the entity, pointing at the authorization master.',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        const auth = e.authorization;
        if (auth === undefined || auth.form !== "dependent" || auth.assoc === undefined) continue;
        if (declaresAssociation(e, auth.assoc.key)) continue;
        if (ctx.mayBeHiddenBy(e, ["ASSOCIATION", "USE"])) continue;
        ctx.report({
          range: auth.range,
          entity: entityLabel(e),
          message:
            `"authorization dependent by ${auth.assoc.name}" on ${entityLabel(e)} names an ` +
            "association that is not declared in this entity's behavior body.",
          hint: `Declare "association ${auth.assoc.name};" in ${entityLabel(e)}, pointing at the authorization master.`,
        });
      }
    },
  },
  {
    id: "RAP032",
    title: "Every entity needs an ETag master or dependent clause",
    severity: "error",
    confidence: "confirmed",
    strictOnly: true,
    sourceUrl: URL_STRICT,
    docsAnchor: "rap032",
    hint: 'Add "etag master LocalLastChangedAt" on the root and "etag dependent by _Parent" on children.',
    check(ctx) {
      if (!isTransactionalBase(ctx.file)) return;
      for (const e of defineEntities(ctx.file)) {
        if (e.etagMaster !== undefined || e.etagDependentBy !== undefined) continue;
        if (usesOf(e).some((u) => u.what === "etag")) continue;
        if (ctx.mayBeHiddenBy(e, ["ETAG", "USE"])) continue;
        ctx.report({
          range: e.entity.range,
          entity: entityLabel(e),
          message:
            `Entity ${entityLabel(e)} declares neither "etag master <Field>" nor ` +
            '"etag dependent by <_Assoc>".',
        });
      }
    },
  },
  {
    id: "RAP034",
    title: "total etag must follow lock master on the lock-master entity",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_TOTAL_ETAG,
    docsAnchor: "rap034",
    hint: 'Write the two as one clause: "lock master total etag <Field>".',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        const lockIndex = e.characteristics.findIndex((c) => c.kind === "lock-master");
        const totalIndex = e.characteristics.findIndex((c) => c.kind === "total-etag");
        if (totalIndex === -1) continue;
        if (lockIndex !== -1 && totalIndex === lockIndex + 1) continue;
        const total = e.characteristics[totalIndex];
        const field = total !== undefined && total.kind === "total-etag" ? total.field.name : "<field>";
        ctx.report({
          range: total?.range,
          entity: entityLabel(e),
          message:
            `"total etag ${field}" on ${entityLabel(e)} must come immediately after "lock master", ` +
            "on the lock-master entity only.",
          hint: `Write the two as one clause: "lock master total etag ${field}".`,
        });
      }
    },
  },
  {
    id: "RAP035",
    title: "A draft-enabled BO needs a total etag on its lock master",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_TOTAL_ETAG,
    docsAnchor: "rap035",
    hint: 'Change the root\'s lock clause to "lock master total etag LastChangedAt".',
    check(ctx) {
      if (!isDraftEnabled(ctx.file) || !isTransactionalBase(ctx.file)) return;
      const root = rootOf(ctx.file);
      if (root === undefined || root.totalEtag !== undefined) return;
      if (ctx.mayBeHiddenBy(root, ["LOCK", "TOTAL"])) return;
      ctx.report({
        range: root.lockMaster?.range ?? root.entity.range,
        entity: entityLabel(root),
        message: 'A draft-enabled BO must declare a "total etag" field on its lock-master (root) entity.',
      });
    },
  },
  {
    id: "RAP040",
    title: "numbering : managed needs a managed BO",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_EARLY_NUMBERING,
    docsAnchor: "rap040",
    hint: "Use early or late numbering with a FOR NUMBERING handler, or make the BO managed.",
    check(ctx) {
      const type = ctx.file.ast.implementationType;
      if (type === "managed") return;
      for (const e of ctx.file.ast.entities) {
        for (const field of fieldsOf(e)) {
          for (const characteristic of field.characteristics) {
            if (characteristic.name !== "numbering" || characteristic.qualifier !== "managed") continue;
            ctx.report({
              range: characteristic.range,
              entity: entityLabel(e),
              message: `"field ( numbering : managed )" is only valid on a managed BO; this BDEF is ${type}.`,
            });
          }
        }
      }
    },
  },
  {
    id: "RAP046",
    title: "persistent table conflicts with unmanaged save",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_CHEAT_SHEET,
    docsAnchor: "rap046",
    hint: 'Remove "persistent table", or drop "with unmanaged save" / switch the BO to managed.',
    check(ctx) {
      const headerUnmanagedSave = ctx.file.ast.save?.form === "unmanaged";
      const unmanagedBo = ctx.file.ast.implementationType === "unmanaged";
      for (const e of ctx.file.ast.entities) {
        if (e.persistentTable === undefined) continue;
        const entityUnmanagedSave = e.save?.form === "unmanaged";
        const reason =
          headerUnmanagedSave || entityUnmanagedSave
            ? '"with unmanaged save"'
            : unmanagedBo
              ? "an unmanaged implementation type"
              : undefined;
        if (reason === undefined) continue;
        ctx.report({
          range: e.persistentTable.range,
          entity: entityLabel(e),
          message:
            `"persistent table ${e.persistentTable.name}" on ${entityLabel(e)} conflicts with ` +
            `${reason} — RAP does not own persistence there.`,
        });
      }
    },
  },
  {
    id: "RAP038",
    title: "draft action Activate/Discard take no facet",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_DRAFT_ACTIONS,
    docsAnchor: "rap038",
    hint: 'Remove the "( … )" facet — the framework does not evaluate it for Activate/Discard.',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const da of draftActionsOf(e)) {
          if (da.name.key !== "ACTIVATE" && da.name.key !== "DISCARD") continue;
          if (da.facets.length === 0) continue;
          ctx.report({
            range: da.range,
            entity: entityLabel(e),
            message: `"draft action ${da.name.name}" must not carry feature or authorization control.`,
          });
        }
      }
    },
  },
  {
    id: "RAP048",
    title: "A factory action has no result clause",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_ACTION_DEFINITION,
    docsAnchor: "rap048",
    hint: 'Delete the "result …" clause; keep the cardinality, e.g. "factory action <Name> [1];".',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const action of actionsOf(e)) {
          if (!action.factory || action.result === undefined) continue;
          ctx.report({
            range: action.result.range,
            entity: entityLabel(e),
            message:
              `Factory action ${action.name.name} declares a result clause; factory actions return ` +
              'the new key through the "mapped" response, not a result.',
            hint: `Delete the "result …" clause; keep the cardinality, e.g. "factory action ${action.name.name} [1];".`,
          });
        }
      }
    },
  },
  {
    id: "RAP056",
    title: "features : instance and features : global are exclusive",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_FEATURE_CONTROL,
    docsAnchor: "rap056",
    hint: "Instance feature control needs FOR INSTANCE FEATURES; global needs FOR GLOBAL FEATURES. Declare one.",
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        const elements: { label: string; facets: Facet[]; range: Range }[] = [
          ...operationsOf(e).map((o) => ({ label: o.verb, facets: o.facets, range: o.range })),
          ...actionsOf(e).map((a) => ({ label: `action ${a.name.name}`, facets: a.facets, range: a.range })),
          ...functionsOf(e).map((f) => ({ label: `function ${f.name.name}`, facets: f.facets, range: f.range })),
        ];
        for (const element of elements) {
          if (!hasFeatureScope(element.facets, "instance") || !hasFeatureScope(element.facets, "global")) continue;
          ctx.report({
            range: element.range,
            entity: entityLabel(e),
            message: `${element.label} combines "features : instance" and "features : global" — pick one.`,
          });
        }
      }
    },
  },
  {
    id: "RAP057",
    title: "authorization : update is documented for delete only",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_CHEAT_SHEET,
    docsAnchor: "rap057",
    hint: 'Remove the addition, or move it to "delete".',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const op of operationsOf(e)) {
          if (op.verb === "delete") continue;
          if (!op.facets.some((f) => f.kind === "authorization" && f.value === "update")) continue;
          ctx.report({
            range: op.range,
            entity: entityLabel(e),
            message:
              '"( authorization : update )" delegates to the update check and is documented only for ' +
              `"delete"; it is declared on "${op.verb}".`,
            hint: `Remove the addition from "${op.verb}", or move it to "delete".`,
          });
        }
      }
    },
  },
  {
    id: "RAP081",
    title: "draft action names are a closed set",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_DRAFT_ACTIONS,
    docsAnchor: "rap081",
    hint: 'Rename it, or declare it as a plain "action <Name>;" if it is your own action.',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const da of draftActionsOf(e)) {
          if (LEGAL_DRAFT_ACTIONS.has(da.name.key)) continue;
          ctx.report({
            range: da.name.range,
            entity: entityLabel(e),
            message:
              `"draft action ${da.name.name}" is not a RAP draft action; legal names are Edit, ` +
              "Activate, Discard, Resume, AdditionalSave and Share.",
            hint: `Rename it, or declare it as a plain "action ${da.name.name};" if it is your own action.`,
          });
        }
      }
    },
  },
  {
    id: "RAP037",
    title: "A determine action may only assign on-save items",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_CHEAT_SHEET,
    docsAnchor: "rap037",
    hint: 'Change the item to "on save", or drop it from the determine action.',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const da of determineActionsOf(e)) {
          for (const item of da.items) {
            if (item.isDeclaration) continue;
            const owner =
              item.name.qualifier === undefined
                ? e
                : ctx.file.ast.entities.find(
                    (other) => (other.alias?.key ?? other.entity.key) === item.name.qualifier?.key,
                  );
            if (owner === undefined) continue;
            const declaration =
              item.kind === "determination"
                ? determinationsOf(owner).find((d) => d.isDeclaration && d.name.key === item.name.key)
                : validationsOf(owner).find((v) => v.isDeclaration && v.name.key === item.name.key);
            if (declaration === undefined || declaration.on !== "modify") continue;
            ctx.report({
              range: item.range,
              entity: entityLabel(e),
              message:
                `"${da.name.name}" assigns ${item.name.name.name}, which is declared "on modify"; ` +
                'determine actions may only assign "on save" items.',
              hint: `Change ${item.name.name.name} to "on save", or drop it from ${da.name.name}.`,
            });
          }
        }
      }
    },
  },
  {
    id: "RAP058",
    title: "An update trigger only works combined with create",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_VALIDATION,
    docsAnchor: "rap058",
    hint: 'Write "validation <Name> on save { create; update; … }".',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const validation of validationsOf(e)) {
          if (!validation.isDeclaration) continue;
          const hasUpdate = validation.triggers.some((t) => t.op === "update");
          const hasCreate = validation.triggers.some((t) => t.op === "create");
          if (!hasUpdate || hasCreate) continue;
          ctx.report({
            range: validation.range,
            entity: entityLabel(e),
            message:
              `Validation ${validation.name.name.name} triggers on "update" alone; the update ` +
              "trigger is only supported combined with \"create\".",
            hint: `Write "validation ${validation.name.name.name} on save { create; update; … }".`,
          });
        }
      }
    },
  },
  {
    id: "RAP059",
    title: "A trigger field must belong to the entity",
    severity: "error",
    confidence: "confirmed",
    requires: ["ddls"],
    sourceUrl: URL_VALIDATION,
    docsAnchor: "rap059",
    hint: "Use an element of the entity the check is defined for; a trigger field must belong to it.",
    check(ctx) {
      for (const e of defineEntities(ctx.file)) {
        const info = ctx.cds.get(e.entity.key);
        if (info === undefined || info.fields.length === 0) continue;
        const elements = new Set(info.fields.map((f) => f.name.toUpperCase()));
        const checks: { kindLabel: string; name: string; triggers: ValidationStatement["triggers"] }[] = [
          ...validationsOf(e)
            .filter((v) => v.isDeclaration)
            .map((v) => ({ kindLabel: "Validation", name: v.name.name.name, triggers: v.triggers })),
          ...determinationsOf(e)
            .filter((d) => d.isDeclaration)
            .map((d) => ({ kindLabel: "Determination", name: d.name.name.name, triggers: d.triggers })),
        ];
        for (const check of checks) {
          for (const trigger of check.triggers) {
            for (const field of trigger.fields ?? []) {
              if (elements.has(field.key)) continue;
              ctx.report({
                range: field.range,
                entity: entityLabel(e),
                message:
                  `${check.kindLabel} ${check.name} on ${entityLabel(e)} triggers on field ` +
                  `${field.name}, which is not an element of ${e.entity.name}.`,
                hint: `Use an element of ${e.entity.name}; a trigger field must belong to the entity the check is defined for.`,
              });
            }
          }
        }
      }
    },
  },
  {
    id: "RAP067",
    title: "$self side effects must target an associated entity",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_CHEAT_SHEET,
    docsAnchor: "rap067",
    hint: 'Write "field <source> affects field <target>;" for same-entity dependencies, or target "entity _Assoc".',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        for (const block of sideEffectsOf(e)) {
          for (const entry of block.entries) {
            if (entry.source.kind !== "self") continue;
            for (const target of entry.targets) {
              if (target.kind !== "field" || target.wildcard || target.path.length !== 1) continue;
              const field = target.path[0] as Ident;
              ctx.report({
                range: entry.range,
                entity: entityLabel(e),
                message:
                  `"$self affects field ${field.name}" targets a field of the same entity; $self side ` +
                  "effects must target an associated entity.",
              });
            }
          }
        }
      }
    },
  },
  {
    id: "RAP068",
    title: "A side-effect event must be declared for side effects",
    severity: "error",
    confidence: "confirmed",
    minRelease: "2502",
    sourceUrl: URL_CHEAT_SHEET,
    docsAnchor: "rap068",
    hint: 'Change the declaration to "event <Name> for side effects;".',
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        const events = eventsOf(e);
        for (const block of sideEffectsOf(e)) {
          for (const entry of block.entries) {
            const source = entry.source;
            if (source.kind !== "event") continue;
            const named = events.find((ev) => ev.name.key === source.name.key);
            // Not declared here at all ⇒ no evidence, so no claim (spec §1.2).
            if (named === undefined || named.forSideEffects) continue;
            ctx.report({
              range: entry.range,
              entity: entityLabel(e),
              message:
                `Side effect triggered by event ${named.name.name}, but ${named.name.name} is not ` +
                'declared "for side effects".',
              hint: `Change the declaration to "event ${named.name.name} for side effects;".`,
            });
          }
        }
      }
    },
  },
  {
    id: "RAP060",
    title: "A projection may only use behavior the base enables",
    severity: "error",
    confidence: "confirmed",
    requires: ["base-bdef"],
    sourceUrl: URL_PROJECTION_BEHAVIOR,
    docsAnchor: "rap060",
    hint: "Declare it in the base BDEF first — a projection can only re-expose behavior the base enables.",
    check(ctx) {
      if (ctx.file.ast.implementationType !== "projection") return;
      for (const e of defineEntities(ctx.file)) {
        const base = ctx.resolveBase(e);
        if (base === undefined) continue;
        const target = base.entity;
        for (const use of usesOf(e)) {
          const label = describeUse(use);
          if (label === undefined) continue;
          if (ctx.mayBeHiddenBy(target, [label.suppressKey])) continue;
          if (label.enabled(target)) continue;
          ctx.report({
            range: use.range,
            entity: entityLabel(e),
            message:
              `"use ${label.text}" is not enabled in the base behavior definition ` +
              `${base.file.filename} for ${entityLabel(target)}.`,
          });
        }
      }
    },
  },
  {
    id: "RAP076",
    title: "A projection on a draft BO must expose draft handling",
    severity: "error",
    confidence: "confirmed",
    requires: ["base-bdef"],
    sourceUrl: URL_FEATURE_TABLES,
    docsAnchor: "rap076",
    hint: 'Add "use draft;" (or "use draft as dependent;" for a non-root entity in a cross-BO draft scope).',
    check(ctx) {
      if (ctx.file.ast.implementationType !== "projection") return;
      const root = rootOf(ctx.file);
      if (root === undefined) return;
      const base = ctx.resolveBase(root);
      if (base === undefined || !isDraftEnabled(base.file)) return;
      const uses = [...usesOf(root), ...ctx.file.ast.headerUses];
      if (uses.some((u) => u.what === "draft" || u.what === "draft-as-dependent")) return;
      if (ctx.mayBeHiddenBy(root, ["USE"])) return;
      ctx.report({
        range: root.entity.range,
        entity: entityLabel(root),
        message: "The base BO is draft-enabled but this projection does not expose draft handling.",
      });
    },
  },
  {
    id: "RAP064",
    title: "An interface BDEF declares no implementation class",
    severity: "error",
    confidence: "confirmed",
    // The interface BDEF itself is a 2205 (on-premise train) construct; the
    // bundled release vocabulary starts at "pre-2502", so no gate is stamped
    // here — release gating is release-gates.ts's job, not a rule's.
    sourceUrl: URL_INTERFACE_BDEF,
    docsAnchor: "rap064",
    hint: 'Remove the "implementation in class …" clause; behavior is inherited from the base BO.',
    check(ctx) {
      if (ctx.file.ast.implementationType !== "interface") return;
      const onEntity = ctx.file.ast.entities.find((e) => e.implementationClass !== undefined);
      if (ctx.file.ast.implementationClass === undefined && onEntity === undefined) return;
      ctx.report({
        range: onEntity?.implementationClass?.range,
        line: 1,
        column: 1,
        ...(onEntity !== undefined ? { entity: entityLabel(onEntity) } : {}),
        message:
          "An interface behavior definition must not declare an implementation class — it has no " +
          "runtime handler.",
      });
    },
  },
  {
    /**
     * One BDL characteristic, one statement per entity. The grammar notes'
     * §1.2 production lists each of these as a single *property* of the
     * entity — `persistent table`, `draft table`, one `etag-clause`, one
     * `lock-clause`, one `authorization-clause`, one `numbering-clause`, one
     * `query`, one `changedocuments` clause — and SAP's cheat sheet
     * (Table Specifications / ETag / Locking / Authorization sections)
     * documents each as *the* setting of the entity, not a repeatable list.
     * The 79-BDEF corpus never repeats one.
     *
     * The parser's `normaliseEntity()` keeps the FIRST of a repeated pair
     * (`??=`), so before this rule a second `authorization master ( global )`
     * — or a second `persistent table` naming a different table — was read,
     * dropped, and never mentioned: the checker silently analysed a file that
     * is not the file the caller wrote.
     */
    id: "RAP-DUP",
    title: "An entity characteristic is declared twice on one entity",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_CHEAT_SHEET,
    docsAnchor: "rap-dup",
    hint: "Delete the duplicate line — a BDL entity declares each characteristic once; the checker reads the first one and ignores the rest.",
    check(ctx) {
      for (const e of ctx.file.ast.entities) {
        const seen = new Map<string, EntityCharacteristic>();
        for (const characteristic of e.characteristics) {
          const family = CHARACTERISTIC_FAMILY[characteristic.kind];
          if (family === undefined) continue;
          const first = seen.get(family.id);
          if (first === undefined) {
            seen.set(family.id, characteristic);
            continue;
          }
          ctx.report({
            range: characteristic.range,
            entity: entityLabel(e),
            message:
              `Entity ${entityLabel(e)} declares ${family.label} more than once (first at line ` +
              `${first.range.start.line}); a BDL entity may declare it only once. Only the first ` +
              "declaration was used by the rules below.",
          });
        }
      }
    },
  },
];

/**
 * Characteristic kinds that are one *property* of an entity, grouped by the
 * property they set — two `etag` clauses conflict whether or not they are the
 * same variant. `save`, `extensible`, `use` and `with-draft` are deliberately
 * absent: the first two carry options that a second statement may legitimately
 * add to, `use etag` is a projection form with its own rules, and an
 * entity-level `with draft` is already RAP024's finding.
 */
const CHARACTERISTIC_FAMILY: Partial<Record<EntityCharacteristic["kind"], { id: string; label: string }>> = {
  "persistent-table": { id: "persistent-table", label: '"persistent table"' },
  "draft-table": { id: "draft-table", label: '"draft table"' },
  query: { id: "query", label: '"query"' },
  "etag-master": { id: "etag", label: "an ETag clause" },
  "etag-dependent": { id: "etag", label: "an ETag clause" },
  "total-etag": { id: "total-etag", label: '"total etag"' },
  "lock-master": { id: "lock", label: "a lock clause" },
  "lock-dependent": { id: "lock", label: "a lock clause" },
  "authorization-master": { id: "authorization", label: "an authorization clause" },
  "authorization-dependent": { id: "authorization", label: "an authorization clause" },
  numbering: { id: "numbering", label: "a numbering clause" },
  changedocuments: { id: "changedocuments", label: '"changedocuments"' },
};

/** Spec §3.2 — one inferred rule in v1, so the severity policy stays auditable. */
const INFERRED_RULES: RapRule[] = [
  {
    id: "RAP025",
    title: "Draft is declared more than once in the header",
    severity: "warning",
    confidence: "inferred",
    sourceUrl: URL_DRAFT_BO,
    docsAnchor: "rap025",
    hint: "Keep exactly one draft declaration in the header — either \"with draft;\" or \"with collaborative draft;\".",
    check(ctx) {
      const declarations = ctx.file.ast.draftDeclarations;
      if (declarations.length < 2) return;
      for (const declaration of declarations.slice(1)) {
        const word = declaration.collaborative ? "with collaborative draft" : "with draft";
        ctx.report({
          range: declaration.range,
          message:
            `The BDEF header declares draft more than once ("${word}" repeats an earlier draft ` +
            "declaration); a BO has exactly one draft mode. " +
            "[inferred from SAP's draft documentation, not stated directly — treat as advisory]",
        });
      }
    },
  },
];

/**
 * Spec §3.3 plus §9 item 5. These are not rules about the user's RAP so much
 * as rules about what the checker itself could and could not see, which is
 * why they carry the parser's own diagnostics into `findings[]` under stable
 * ids instead of hiding them in a side channel.
 */
const STRUCTURAL_RULES: RapRule[] = [
  {
    id: "RAP-PARSE",
    title: "Punctuation-level syntax breakage",
    severity: "error",
    confidence: "confirmed",
    sourceUrl: URL_BDL_INDEX,
    docsAnchor: "rap-parse",
    hint: "Fix the punctuation — a BDL statement ends in `;` and every `{`, `(` and `[` needs its partner.",
    check(ctx) {
      const errors = ctx.file.errors;
      const shown = Math.min(errors.length, MAX_PARSE_FINDINGS_PER_FILE);
      for (let i = 0; i < shown; i += 1) {
        const error = errors[i] as (typeof errors)[number];
        ctx.report({
          line: error.line,
          column: error.column,
          excerpt: error.excerpt,
          message: error.message,
        });
      }
    },
  },
  {
    id: "RAP000",
    title: "Statement outside abap-mcp's BDL grammar",
    severity: "info",
    confidence: "confirmed",
    sourceUrl: URL_BDL_INDEX,
    docsAnchor: "rap000",
    hint: "Nothing to fix unless the statement really is wrong — check it in ADT. Reporting it here is how the checker admits a coverage gap.",
    check(ctx) {
      const unknowns = ctx.file.unknown;
      const shown = Math.min(unknowns.length, MAX_UNKNOWN_FINDINGS_PER_FILE);
      for (let i = 0; i < shown; i += 1) {
        const unknown = unknowns[i] as (typeof unknowns)[number];
        ctx.report({
          range: unknown.range,
          message:
            `abap-mcp's BDL grammar (${GRAMMAR_VERSION}) does not recognise this statement ` +
            `("${unknown.text}"); it was skipped, and no rule was applied to it. This is a limit of ` +
            "the checker, not necessarily an error in your file.",
        });
      }
    },
  },
  {
    id: "RAP-STRICT-MISSING",
    title: "Transactional BDEF does not declare strict",
    severity: "info",
    confidence: "confirmed",
    sourceUrl: URL_STRICT,
    docsAnchor: "rap-strict-missing",
    hint: 'Add "strict ( 2 );" under the implementation-type statement if this BO is meant for ABAP Cloud; the strict rules then run.',
    check(ctx) {
      const type = ctx.file.ast.implementationType;
      if (type !== "managed" && type !== "unmanaged") return;
      if (ctx.file.ast.strict !== undefined) return;
      if (ctx.mayBeHiddenBy(undefined, ["STRICT"])) return;
      ctx.report({
        line: 1,
        column: 1,
        message:
          `This ${type} behavior definition does not declare "strict"; the ABAP Cloud release ` +
          "contracts expect strict(2), and abap-mcp's strict-mode rules stayed switched off for this file.",
      });
    },
  },
];

/** The v1 registry — structural pseudo-rules first, then §3.1, then §3.2. */
export const RAP_RULES: readonly RapRule[] = [...STRUCTURAL_RULES, ...CONFIRMED_RULES, ...INFERRED_RULES];

/** Rule ids that report on the checker itself rather than on the user's RAP. */
export const STRUCTURAL_RULE_IDS: readonly string[] = STRUCTURAL_RULES.map((r) => r.id);

/* --------------------------------------------------- projection `use` map */

interface UseDescriptor {
  text: string;
  /** Leading keyword the base statement would start with, for §3.7 suppression. */
  suppressKey: string;
  enabled(base: EntityBehavior): boolean;
}

/**
 * What a projection `use` claims from its base, and how to tell whether the
 * base grants it. `use draft` is deliberately absent — RAP076 owns it — and
 * so are the clauses (`use side effects`, `use mapping`, `use event`) whose
 * base-side counterpart we cannot resolve without more than names.
 */
function describeUse(use: UseStatement): UseDescriptor | undefined {
  switch (use.what) {
    case "create":
    case "update":
    case "delete":
      return {
        text: use.what,
        suppressKey: use.what.toUpperCase(),
        enabled: (base) => operationsOf(base).some((o) => o.verb === use.what),
      };
    case "action": {
      const name = use.name;
      if (name === undefined) return undefined;
      return {
        text: `action ${name.name.name}`,
        suppressKey: "ACTION",
        enabled: (base) =>
          actionsOf(base).some((a) => a.name.key === name.key) ||
          draftActionsOf(base).some((d) => d.name.key === name.key) ||
          determineActionsOf(base).some((d) => d.name.key === name.key),
      };
    }
    case "function": {
      const name = use.name;
      if (name === undefined) return undefined;
      return {
        text: `function ${name.name.name}`,
        suppressKey: "FUNCTION",
        enabled: (base) => functionsOf(base).some((f) => f.name.key === name.key),
      };
    }
    case "association": {
      const name = use.name;
      if (name === undefined) return undefined;
      return {
        text: `association ${name.name.name}`,
        suppressKey: "ASSOCIATION",
        enabled: (base) => associationsOf(base).some((a) => a.name.key === name.key),
      };
    }
    case "etag":
      return {
        text: "etag",
        suppressKey: "ETAG",
        enabled: (base) => base.etagMaster !== undefined || base.etagDependentBy !== undefined,
      };
    default:
      return undefined;
  }
}

/* ---------------------------------------------------------- the runner */

export interface RapRuleRunOptions {
  /** Every parsed `.bdef.asbdef` in this call, in the caller's order. */
  bdefs: ParsedBdef[];
  srvds?: ParsedSrvd[] | undefined;
  /** CDS entities in scope, keyed by upper-cased name (see `ddls.ts`). */
  cds?: Map<string, CdsEntityInfo> | undefined;
  abapRelease?: KnowledgeRelease | undefined;
  /** Force the strict-mode rules on even where the BDEF omits `strict`. */
  strict?: boolean | undefined;
  /** Defaults to `RAP_RULES`; the tests use it to run one rule in isolation. */
  rules?: readonly RapRule[] | undefined;
  maxFindings?: number | undefined;
}

/** Severity tally — taken over the UNCAPPED finding set (see `runBdefRules`). */
export interface RapSeverityCounts {
  errors: number;
  warnings: number;
  infos: number;
}

export function countSeverity(counts: RapSeverityCounts, severity: RapSeverity): void {
  if (severity === "error") counts.errors += 1;
  else if (severity === "warning") counts.warnings += 1;
  else counts.infos += 1;
}

export interface RapRuleRunResult {
  /** Sorted by (file, line, column, rule) and capped at `maxFindings`. */
  findings: RapFinding[];
  /** Distinct rules that were not gated out — spec §4.1's `summary.rulesRun`. */
  rulesRun: number;
  /** Spec §3.7: how often a rule stayed silent because a statement was skipped. */
  suppressedByUnknown: number;
  /** Total `RAP000` candidates across all files, before the per-file cap. */
  unknownConstructs: number;
  /**
   * How often a cross-file rule stayed silent because the projection's CDS
   * view names a base entity that no BDEF in the call defines (spec §9.1
   * item 9). Silence, not a guess at a different base.
   */
  baseUnresolved: number;
  /** True when the finding cap cut the list short, or a parse was truncated. */
  truncated: boolean;
  /** How many findings the cap dropped — `summary.omitted`'s BDEF half. */
  omitted: number;
  /** Severities of the dropped findings, so the summary can stay uncapped. */
  omittedCounts: RapSeverityCounts;
  /**
   * Rules that threw. Always 0 in a healthy build — a rule is a pure function
   * over an AST — but a checker that crashes a whole MCP call because one rule
   * hit an unexpected shape would be worse than one that reports a little less.
   */
  ruleErrors: number;
}

function requirementsMet(
  rule: RapRule,
  bdefs: Map<string, ParsedBdef>,
  srvds: Map<string, ParsedSrvd>,
  cds: Map<string, CdsEntityInfo>,
): boolean {
  for (const requirement of rule.requires ?? []) {
    if (requirement === "ddls" && cds.size === 0) return false;
    if (requirement === "base-bdef" && bdefs.size < 2) return false;
    if (requirement === "srvd" && srvds.size === 0) return false;
  }
  return true;
}

/** The base forms a projection may sit on (`abstract` included, so RAP009 can object). */
function isBaseCandidate(file: ParsedBdef): boolean {
  const type = file.ast.implementationType;
  return type === "managed" || type === "unmanaged" || type === "abstract" || type === "unspecified";
}

/**
 * The call-level input note (`RAP-INPUT`). It is not a claim about anyone's
 * RAP — it is the checker saying the *call* was ambiguous — so it lives here
 * as its own metadata record rather than in `RAP_RULES`: it has no `check()`
 * over an AST and no `ok`/`bad` fixture pair could express it (a fixture
 * directory cannot hold two files with one name).
 */
export const RAP_INPUT_RULE = {
  id: "RAP-INPUT",
  title: "Two files in one call share a filename",
  severity: "warning" as const,
  confidence: "confirmed" as const,
  docsAnchor: "rap-input",
  sourceUrl: RAP_RULES_DOC_BASE,
  hint:
    "Give every file its own abapGit-style name (zr_travel.bdef.asbdef, zc_travel.bdef.asbdef) — the cross-file " +
    "rules key off the filename, so two files under one name cannot both be addressed.",
};

/**
 * Index the files of one call by lower-cased filename, **without losing one
 * to a name collision**. A plain `Map.set()` per file used to drop the first
 * of two same-named BDEFs, and dropping it silently switched off every
 * `requires: ["base-bdef"]` rule (`bdefs.size < 2`) plus `resolveBase()` —
 * a projection checked against a base that was no longer there reported
 * nothing at all, which is the worst failure mode a checker has (breaker
 * probe P3-1). Identical text under one name is one file passed twice and
 * collapses; different text is kept under an index-suffixed key so both are
 * addressable, and `RAP-INPUT` tells the caller either way.
 */
function indexByFilename<T extends { filename: string; source: string }>(
  files: readonly T[],
): Map<string, T> {
  const byName = new Map<string, T>();
  files.forEach((file, index) => {
    const name = file.filename.toLowerCase();
    const seen = byName.get(name);
    if (seen === undefined) {
      byName.set(name, file);
      return;
    }
    if (seen.source === file.source) return;
    byName.set(`${name}#${index}`, file);
  });
  return byName;
}

/** Lower-cased filenames that arrived more than once in one call. */
function duplicateFilenames(files: readonly { filename: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const file of files) {
    const name = file.filename.toLowerCase();
    if (seen.has(name)) duplicates.add(name);
    else seen.add(name);
  }
  return [...duplicates];
}

/** One `RAP-INPUT` finding per call, naming every duplicated filename. */
function inputFinding(
  files: readonly { filename: string; source: string }[],
  duplicates: readonly string[],
): RapFinding {
  const anchor = files.find((file) => duplicates.includes(file.filename.toLowerCase()));
  const file = anchor?.filename ?? (duplicates[0] as string);
  const names = duplicates.join(", ");
  return {
    rule: RAP_INPUT_RULE.id,
    severity: RAP_INPUT_RULE.severity,
    message:
      `More than one file in this call is named ${names}. They were told apart by content so the cross-file ` +
      "rules still run, but every finding on either file is reported under the same name — and two files with " +
      "identical text under one name were treated as one file passed twice.",
    file,
    line: 1,
    column: 1,
    excerpt: anchor === undefined ? "" : (normalizeRapSource(anchor.source).split("\n")[0] ?? "").trim(),
    hint: RAP_INPUT_RULE.hint,
    confidence: RAP_INPUT_RULE.confidence,
    docsUrl: `${RAP_RULES_DOC_BASE}#${RAP_INPUT_RULE.docsAnchor}`,
    sourceUrl: RAP_INPUT_RULE.sourceUrl,
  };
}

/**
 * Run the registry over every supplied BDEF. Stateless and single-pass: one
 * `RapRuleContext` per file, every applicable rule, then one sort and one cap
 * (spec §2.7). `index.ts` layers the report shape on top of this; the golden
 * rule tests call it directly.
 */
export function runBdefRules(options: RapRuleRunOptions): RapRuleRunResult {
  const rules = options.rules ?? RAP_RULES;
  const bdefs = indexByFilename(options.bdefs);
  const srvds = indexByFilename(options.srvds ?? []);
  const cds = options.cds ?? new Map<string, CdsEntityInfo>();
  const duplicateNames = [
    ...new Set([
      ...duplicateFilenames(options.bdefs),
      ...duplicateFilenames(options.srvds ?? []),
    ]),
  ].sort();

  const lineCache = new WeakMap<ParsedBdef, string[]>();
  const linesOf = (file: ParsedBdef): string[] => {
    const cached = lineCache.get(file);
    if (cached !== undefined) return cached;
    const lines = normalizeRapSource(file.source).split("\n");
    lineCache.set(file, lines);
    return lines;
  };

  const findings: RapFinding[] = [];
  const rulesRun = new Set<string>();
  let suppressedByUnknown = 0;
  let unknownConstructs = 0;
  let baseUnresolved = 0;
  let ruleErrors = 0;
  let truncated = false;

  if (duplicateNames.length > 0) {
    findings.push(inputFinding([...options.bdefs, ...(options.srvds ?? [])], duplicateNames));
  }

  for (const file of options.bdefs) {
    unknownConstructs += file.unknown.length;
    if (file.truncated) truncated = true;
    // Root-ness is evidence, not statement order — see `deriveRootEntity()`.
    deriveRootEntity(file, cds);

    const strict = options.strict === true || file.ast.strict !== undefined;
    let active: RapRule | undefined;

    const ctx: RapRuleContext = {
      bdefs,
      srvds,
      cds,
      file,
      strict,
      strictLevel: file.ast.strict?.level,
      ...(options.abapRelease !== undefined ? { abapRelease: options.abapRelease } : {}),

      resolveBase(entity) {
        const candidates = [...bdefs.values()].filter((b) => b !== file && isBaseCandidate(b));
        if (candidates.length === 0) return undefined;
        const projectionOn = cds.get(entity.entity.key)?.projectionOn?.toUpperCase();
        if (projectionOn !== undefined) {
          for (const candidate of candidates) {
            const match = candidate.ast.entities.find((e) => e.entity.key === projectionOn);
            if (match !== undefined) return { file: candidate, entity: match };
          }
          // The CDS view states which entity this projects onto, and no BDEF
          // in the call defines it. That is *evidence of absence for this
          // call*, not licence to fall through to the alias/single-candidate
          // heuristics below: matching an unrelated base by a coincident
          // alias produced confirmed errors (RAP060) about a base the file
          // demonstrably does not use. Unresolved is the honest answer — the
          // cross-file rules stay silent, and the call counts the silence.
          baseUnresolved += 1;
          return undefined;
        }
        const aliasKey = entity.alias?.key;
        if (aliasKey !== undefined) {
          for (const candidate of candidates) {
            const match = candidate.ast.entities.find((e) => (e.alias?.key ?? e.entity.key) === aliasKey);
            if (match !== undefined) return { file: candidate, entity: match };
          }
        }
        // Last resort: one base in the call, match root to root. Anything less
        // certain than this stays unresolved, and the cross-file rules stay quiet.
        if (candidates.length === 1) {
          const only = candidates[0] as ParsedBdef;
          const match =
            only.ast.entities.find((e) => e.form === "define" && e.isRoot === entity.isRoot) ??
            only.ast.entities.find((e) => e.form === "define");
          if (match !== undefined) return { file: only, entity: match };
        }
        return undefined;
      },

      mayBeHiddenBy(entity, leadingKeys) {
        return ctx.mayBeHiddenIn(file, entity, leadingKeys);
      },

      mayBeHiddenIn(target, entity, leadingKeys) {
        const keys = new Set(leadingKeys.map((key) => key.toUpperCase()));
        const candidates = [...target.ast.unknownHeader];
        if (entity !== undefined) {
          candidates.push(...entity.unknown);
          for (const characteristic of entity.characteristics) {
            if (characteristic.kind === "unknown") candidates.push(characteristic.statement);
          }
          for (const statement of flatBody(entity)) {
            if (statement.kind === "unknown") candidates.push(statement);
          }
        }
        const hidden = candidates.some(
          (unknown) => keys.has(unknown.leadingKey) || !KNOWN_LEADING_KEYS.has(unknown.leadingKey),
        );
        if (hidden) suppressedByUnknown += 1;
        return hidden;
      },

      report(input) {
        const rule = active;
        if (rule === undefined) return;
        const line = input.range?.start.line ?? input.line ?? 1;
        const column = input.range?.start.column ?? input.column ?? 1;
        let message = input.message;
        if (rule.confidence !== "confirmed" && !message.trimEnd().endsWith("]")) {
          message += PROVENANCE_CLAUSE[rule.confidence];
        }
        const minRelease = input.minRelease ?? rule.minRelease;
        findings.push({
          rule: rule.id,
          severity: rule.severity,
          message,
          file: input.file ?? file.filename,
          line,
          column,
          excerpt: input.excerpt ?? excerptOf(linesOf(file), line),
          hint: input.hint ?? rule.hint,
          confidence: rule.confidence,
          ...(input.entity !== undefined ? { entity: input.entity } : {}),
          ...(minRelease !== undefined ? { minRelease } : {}),
          docsUrl: `${RAP_RULES_DOC_BASE}#${rule.docsAnchor}`,
          sourceUrl: rule.sourceUrl,
        });
      },
    };

    for (const rule of rules) {
      if (rule.strictOnly === true && !strict) continue;
      if (!requirementsMet(rule, bdefs, srvds, cds)) continue;
      rulesRun.add(rule.id);
      active = rule;
      try {
        rule.check(ctx);
      } catch {
        ruleErrors += 1;
      }
      active = undefined;
    }
  }

  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule),
  );
  // The cap bounds the *report*, never the counts: `summary.errors` is a
  // statement about the file, so it has to be taken before anything is
  // dropped. Counting only what survived let a run whose errors fell off the
  // end report `errors: 0` — and every consumer that gates on that number
  // (`abap-mcp rapcheck`'s exit code first among them) passed invalid RAP.
  const cap = options.maxFindings ?? MAX_FINDINGS;
  const omittedCounts: RapSeverityCounts = { errors: 0, warnings: 0, infos: 0 };
  let omitted = 0;
  if (findings.length > cap) {
    for (const dropped of findings.slice(cap)) countSeverity(omittedCounts, dropped.severity);
    omitted = findings.length - cap;
    findings.length = cap;
    truncated = true;
  }

  return {
    findings,
    rulesRun: rulesRun.size,
    suppressedByUnknown,
    unknownConstructs,
    baseUnresolved,
    truncated,
    ruleErrors,
    omitted,
    omittedCounts,
  };
}
