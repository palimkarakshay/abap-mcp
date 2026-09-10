/**
 * Shared type surface for the RAP checker's rule layer — spec
 * `docs/specs/rap-checker-design.md` §2.5 (`RapRuleContext` / `RapRule`) and
 * §2.6 (`CdsEntityInfo`).
 *
 * **Types only**: like `ast.ts`, this file carries no runtime code, so every
 * file in `src/abap/rap/` can import it without pulling in a dependency
 * graph. It exists as its own module because four files need the same shapes
 * and none of them may own it:
 *
 *  - `rules.ts`    — implements `RapRule` and consumes `RapRuleContext`.
 *  - `srvd.ts`     — parses `.srvd.srvdsrv` into `ParsedSrvd` and adds the
 *                    SRVD rule block (spec §3.4).
 *  - `ddls.ts`     — produces `CdsEntityInfo` from abaplint's real CDS parser
 *                    (spec §2.6; the only file here that imports abaplint).
 *  - `index.ts`    — assembles the context and runs the registry (spec §2.7).
 *
 * Nothing here imports from `src/tools/` or `src/server.ts` (spec §2).
 */
import type {
  BehaviorDefinition,
  EntityBehavior,
  ParseError,
  Range,
  ServiceDefinition,
  UnknownStatement,
} from "./ast.js";
import type { KnowledgeRelease } from "../knowledge.js";

/* ------------------------------------------------------------ diagnostics */

export type RapSeverity = "error" | "warning" | "info";
export type RapConfidence = "confirmed" | "inferred" | "community-reported" | "conflicting";

/** One entry of `RapCheckReport.findings` (spec §4.1). */
export interface RapFinding {
  /** `"RAP026"` | `"SRVD003"` | `"RAP900"` | `"RAP000"` | `"RAP-PARSE"` | `"cds_parser_error"`. */
  rule: string;
  severity: RapSeverity;
  message: string;
  file: string;
  line: number;
  column: number;
  excerpt: string;
  hint: string;
  confidence: RapConfidence;
  entity?: string | undefined;
  minRelease?: string | undefined;
  /** Anchor into `docs/RAP-RULES.md`. */
  docsUrl?: string | undefined;
  /** The SAP page the rule was derived from. */
  sourceUrl?: string | undefined;
}

/* --------------------------------------------------------- parsed inputs */

/** A `.bdef.asbdef` after `parseBehaviorDefinition()`, plus its identity. */
export interface ParsedBdef {
  filename: string;
  /** The source exactly as passed in — the excerpt source for findings. */
  source: string;
  ast: BehaviorDefinition;
  /** Punctuation-level breakage → `RAP-PARSE`, severity error (spec §1.3). */
  errors: ParseError[];
  /** Well-formed statements outside our grammar → `RAP000`, info (spec §1.3). */
  unknown: UnknownStatement[];
  truncated: boolean;
}

/** A `.srvd.srvdsrv` after `srvd.ts`'s parser. */
export interface ParsedSrvd {
  filename: string;
  source: string;
  ast: ServiceDefinition;
  errors: ParseError[];
  unknown: UnknownStatement[];
  truncated: boolean;
}

/* -------------------------------------------------------------- CDS side */

/**
 * Spec §2.6. We write no CDS parser: `ddls.ts` adapts abaplint's real one and
 * adds one text-level shape classifier. `shape: "unknown"` means the
 * classifier could not tell — rules must treat it as "no evidence", never as
 * a defect.
 */
export type CdsShape =
  | "root-view-entity"
  | "view-entity"
  | "projection-view"
  | "abstract-entity"
  | "transactional-interface"
  | "table-entity"
  | "custom-entity"
  | "classic-view"
  | "unknown";

export interface CdsEntityInfo {
  name: string;
  /** Upper-cased `name` — the key `RapRuleContext.cds` is indexed by. */
  key: string;
  shape: CdsShape;
  /**
   * `as projection on X` target, whenever the header states one — including
   * on a `define root view entity … as projection on …`, whose `shape` stays
   * `root-view-entity` (RAP001 asks about root-ness, `resolveBase()` asks
   * about the target; the two facts are independent and both are kept).
   */
  projectionOn?: string | undefined;
  fields: { name: string; key: boolean }[];
  associations: string[];
  filename: string;
}

/* ------------------------------------------------------------- the rules */

/**
 * What a rule hands to `ctx.report()`. Spec §2.5 writes this as
 * `Omit<RapFinding, "rule" | "severity" | "confidence" | "docsUrl" | "sourceUrl">`;
 * three deviations, all narrowing the room for a rule to get it wrong:
 *
 *  - the anchor is normally a `Range` (every AST node carries one) and the
 *    runner derives `line`/`column`/`excerpt` from it, so a rule cannot
 *    report a position that does not exist in the file it is scoped to;
 *  - explicit `line`/`column`/`excerpt` stay available for the structural
 *    pseudo-rules, which report from `ParseError`s rather than nodes;
 *  - `hint` is optional and defaults to the rule's own `hint`.
 */
export interface RapReportInput {
  message: string;
  /** Preferred anchor — the most specific node range available. */
  range?: Range | undefined;
  line?: number | undefined;
  column?: number | undefined;
  excerpt?: string | undefined;
  hint?: string | undefined;
  entity?: string | undefined;
  minRelease?: string | undefined;
  /** Overrides `ctx.file.filename`; only the structural pseudo-rules need it. */
  file?: string | undefined;
}

export interface RapRuleContext {
  /** Every BDEF passed in this call, keyed by lower-cased filename. */
  bdefs: Map<string, ParsedBdef>;
  /** Every SRVD passed in this call. */
  srvds: Map<string, ParsedSrvd>;
  /** CDS entities in scope, keyed by upper-cased entity name (see `ddls.ts`). */
  cds: Map<string, CdsEntityInfo>;
  /** The BDEF this rule invocation is scoped to. */
  file: ParsedBdef;
  /** True when `strict`/`strict(2)` is declared OR `opts.strict` forced it on. */
  strict: boolean;
  strictLevel: 1 | 2 | undefined;
  abapRelease?: KnowledgeRelease | undefined;
  /** Resolves a projection entity to its base BDEF entity, when one was passed. */
  resolveBase(entity: EntityBehavior): { file: ParsedBdef; entity: EntityBehavior } | undefined;
  /**
   * The spec §3.7 suppression contract. Returns true when `entity` (or the
   * file header) holds an `UnknownStatement` that could plausibly be the
   * declaration the rule is about to call missing — its leading keyword is in
   * `leadingKeys`, or it is outside our vocabulary entirely. A rule of the
   * form "X must be declared" MUST consult this before reporting; a `true`
   * answer both silences the rule and increments
   * `summary.suppressedByUnknown`, so the coverage gap stays measurable.
   */
  mayBeHiddenBy(entity: EntityBehavior | undefined, leadingKeys: readonly string[]): boolean;
  /**
   * `mayBeHiddenBy` against a BDEF other than the one the rule is scoped to —
   * the suppression contract applies to the file the *evidence* would have to
   * be in, which for a cross-file rule (RAP008's `strict` on the base) is not
   * `ctx.file`. Counts in the same `summary.suppressedByUnknown` column.
   */
  mayBeHiddenIn(
    file: ParsedBdef,
    entity: EntityBehavior | undefined,
    leadingKeys: readonly string[],
  ): boolean;
  report(finding: RapReportInput): void;
}

export interface RapRule {
  /** `"RAP026"` | `"SRVD003"` | `"RAP000"` | `"RAP900"`. */
  id: string;
  title: string;
  severity: RapSeverity;
  confidence: RapConfidence;
  /** Only run when the BDEF (or `opts.strict`) put the BO in strict mode. */
  strictOnly?: boolean | undefined;
  /** Only run when at least one file of this kind was supplied. */
  requires?: ("base-bdef" | "ddls" | "srvd")[] | undefined;
  /** Release gate, ABAP-Cloud train id, e.g. `"2508"`. */
  minRelease?: KnowledgeRelease | undefined;
  /** SAP page the rule was derived from; echoed on every finding as `sourceUrl`. */
  sourceUrl: string;
  /** Anchor into `docs/RAP-RULES.md`; echoed as `docsUrl`. */
  docsAnchor: string;
  hint: string;
  check(ctx: RapRuleContext): void;
}
