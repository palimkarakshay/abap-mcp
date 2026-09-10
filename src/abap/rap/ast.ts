/**
 * AST for RAP BDL behavior definitions — spec §2.2. **Types only**: this file
 * must contain no runtime code, so importing it costs nothing at serve time.
 *
 * Every node carries a `Range`, because findings anchor on the most specific
 * range available (a rule about `total etag` anchors on the `total` keyword,
 * not on the entity that contains it).
 *
 * Deviations from the spec's listing, all additive and all noted here:
 *  - `ParseError` (the task's name) is the parser's error record; the spec's
 *    `RapParserError` is kept as an alias so §2.3's name resolves.
 *  - `FunctionStatement.keyName` carries the `key <AltKey> function …` form
 *    (bdl-grammar-notes §5 snippet 10).
 *  - optional properties are written `?: T | undefined` because the repo
 *    compiles with `exactOptionalPropertyTypes`.
 */

export interface Pos {
  line: number;
  column: number;
}
export interface Range {
  start: Pos;
  end: Pos;
}
export interface Node {
  range: Range;
}

/** An identifier as written, plus its upper-cased comparison key. */
export interface Ident extends Node {
  name: string;
  key: string;
  namespaced: boolean;
}
/** `Alias~name` (cross-entity reference inside a determine-action block). */
export interface QualifiedName extends Node {
  qualifier?: Ident | undefined;
  name: Ident;
  key: string;
}
export interface StringLit extends Node {
  value: string;
}
export interface Cardinality extends Node {
  min: number;
  max: number | "*";
  raw: string;
}

/** Any statement the grammar did not recognise. NEVER an error — see spec §1.3. */
export interface UnknownStatement extends Node {
  kind: "unknown";
  leadingKey: string;
  text: string;
}

/** A punctuation-level breakage. Surfaces as rule `RAP-PARSE`, severity error. */
export interface ParseError {
  message: string;
  line: number;
  column: number;
  excerpt: string;
  kind: "syntax" | "unknown-construct";
  file?: string | undefined;
}
/** Spec §2.3's name for {@link ParseError}. */
export type RapParserError = ParseError;

export type ImplementationType =
  | "managed"
  | "unmanaged"
  | "abstract"
  | "projection"
  | "interface"
  | "extension"
  | "unspecified";

export interface SaveOption extends Node {
  form: "additional" | "unmanaged";
  fullData: boolean;
  andCleanup: boolean;
}

export interface BehaviorDefinition extends Node {
  kind: "behavior-definition";
  implementationType: ImplementationType;
  implementationClass?: Ident | undefined;
  /** Only for implementationType "extension". */
  extensionForm?: "for-projection" | "for-abstract" | "using-interface" | "implementation" | undefined;
  extensionInterface?: Ident | undefined;
  strict?: { level: 1 | 2; range: Range } | undefined;
  /** Header-level draft declaration. `collaborative` = `with collaborative draft;`. */
  withDraft?: { collaborative: boolean; range: Range } | undefined;
  /** Every header-level draft declaration in source order — RAP025 reads this. */
  draftDeclarations: { collaborative: boolean; range: Range }[];
  withHierarchy?: Range | undefined;
  managedByBopf?: Range | undefined;
  extensible?: { options: string[]; range: Range } | undefined;
  auxiliaryClasses: Ident[];
  privilegedMode?: { form: "enabled" | "disabling" | "disabling-base-context"; range: Range } | undefined;
  managedInstanceFilter?: Range | undefined;
  saveAfter?: Ident | undefined;
  /** Header-level save clause fused onto the impl-type statement. */
  save?: SaveOption | undefined;
  /** `use draft;` etc. appearing above the first `define behavior for`. */
  headerUses: UseStatement[];
  entities: EntityBehavior[];
  unknownHeader: UnknownStatement[];
}

export type AuthScope = "none" | "global" | "instance";

export type EntityCharacteristic =
  | { kind: "persistent-table"; table: Ident; range: Range }
  | { kind: "draft-table"; table: Ident; range: Range }
  | { kind: "query"; view: Ident; range: Range }
  | { kind: "etag-master"; field: Ident; range: Range }
  | { kind: "etag-dependent"; assoc: Ident; range: Range }
  | { kind: "total-etag"; field: Ident; range: Range }
  | { kind: "lock-master"; unmanaged: boolean; range: Range }
  | { kind: "lock-dependent"; assoc: Ident; range: Range }
  | { kind: "authorization-master"; scopes: AuthScope[]; range: Range }
  | { kind: "authorization-dependent"; assoc: Ident; range: Range }
  | { kind: "numbering"; when: "early" | "late"; range: Range }
  | { kind: "save"; save: SaveOption; range: Range }
  /** `extensible` (bare) or `extensible { with additional save; … }` — both positions, both forms (spec §2.3). */
  | { kind: "extensible"; options: string[]; range: Range }
  /** Illegal at entity level; parsed anyway so RAP024 can report it. */
  | { kind: "with-draft"; collaborative: boolean; range: Range }
  | { kind: "with-hierarchy"; range: Range }
  | { kind: "changedocuments"; form: "master" | "dependent"; assoc?: Ident | undefined; range: Range }
  /** `use etag` (no `;`) before the body. */
  | { kind: "use"; use: UseStatement; range: Range }
  | { kind: "unknown"; statement: UnknownStatement; range: Range };

export interface EntityBehavior extends Node {
  kind: "entity-behavior";
  form: "define" | "extend";
  /** CDS entity for `define behavior for`; the base alias for `extend behavior for`. */
  entity: Ident;
  alias?: Ident | undefined;
  external?: StringLit | undefined;
  /** True for the FIRST `define` block in the file — the BO root by BDL convention. */
  isRoot: boolean;
  /** Per-entity override of the header implementation class. */
  implementationClass?: Ident | undefined;

  /** Source-ordered characteristics — the only ordering-sensitive rule (RAP034) reads this. */
  characteristics: EntityCharacteristic[];

  /* Normalised convenience projections of `characteristics`. */
  persistentTable?: Ident | undefined;
  draftTable?: Ident | undefined;
  query?: Ident | undefined;
  etagMaster?: Ident | undefined;
  etagDependentBy?: Ident | undefined;
  totalEtag?: Ident | undefined;
  lockMaster?: { unmanaged: boolean; range: Range } | undefined;
  lockDependentBy?: Ident | undefined;
  authorization?:
    | { form: "master" | "dependent"; scopes: AuthScope[]; assoc?: Ident | undefined; range: Range }
    | undefined;
  numbering?: { when: "early" | "late"; range: Range } | undefined;
  save?: SaveOption | undefined;
  /** Entity-level `with draft` → RAP024. */
  withDraft?: { collaborative: boolean; range: Range } | undefined;

  /** Every body statement in source order (superset of the typed buckets below). */
  body: BodyStatement[];

  operations: OperationStatement[];
  fields: FieldStatement[];
  associations: AssociationStatement[];
  actions: ActionStatement[];
  functions: FunctionStatement[];
  determinations: DeterminationStatement[];
  validations: ValidationStatement[];
  determineActions: DetermineActionStatement[];
  draftActions: DraftActionStatement[];
  sideEffects: SideEffectsBlock[];
  mappings: MappingStatement[];
  events: EventStatement[];
  uses: UseStatement[];
  groups: GroupStatement[];
  unknown: UnknownStatement[];
}

export type BodyStatement =
  | OperationStatement
  | FieldStatement
  | AssociationStatement
  | ActionStatement
  | FunctionStatement
  | DeterminationStatement
  | ValidationStatement
  | DetermineActionStatement
  | DraftActionStatement
  | SideEffectsBlock
  | MappingStatement
  | EventStatement
  | UseStatement
  | GroupStatement
  | UnknownStatement;

/* ---- facets shared by operations, actions and functions ---- */
export type Facet =
  | { kind: "features"; scope: "instance" | "global"; range: Range }
  | { kind: "authorization"; value: "none" | "update" | "global" | "instance"; range: Range }
  | { kind: "precheck"; range: Range }
  | { kind: "lock-none"; range: Range }
  | { kind: "unknown"; text: string; range: Range };

export interface OperationStatement extends Node {
  kind: "operation";
  verb: "create" | "update" | "delete";
  internal: boolean;
  facets: Facet[];
  defaultFunction?: Ident | undefined;
}

export interface FieldChar extends Node {
  name:
    | "readonly"
    | "mandatory"
    | "suppress"
    | "numbering"
    | "features"
    | "notrigger"
    | "modify"
    | "hierarchy-index"
    | "unknown";
  qualifier?: "create" | "update" | "managed" | "instance" | "warn" | "execute" | undefined;
  raw: string;
}
export interface FieldStatement extends Node {
  kind: "field";
  characteristics: FieldChar[];
  fields: Ident[];
}

export interface AssociationStatement extends Node {
  kind: "association";
  name: Ident;
  create?: { facets: Facet[]; range: Range } | undefined;
  withDraft?: Range | undefined;
  withDependentDraft?: Range | undefined;
  withHierarchy?: Range | undefined;
  linkAction?: Ident | undefined;
  unlinkAction?: Ident | undefined;
  inverseFunction?: Ident | undefined;
  unknown: UnknownStatement[];
}

export interface ParameterClause extends Node {
  deep: boolean;
  table: boolean;
  isSelf: boolean;
  type?: Ident | undefined;
}
export type ResultTarget =
  | { kind: "self" }
  | { kind: "entity"; entity: Ident }
  | { kind: "type"; type: Ident };
export interface ResultClause extends Node {
  selective: boolean;
  deep: boolean;
  cardinality?: Cardinality | undefined;
  target: ResultTarget;
}

export interface ActionStatement extends Node {
  kind: "action";
  name: Ident;
  internal: boolean;
  isStatic: boolean;
  repeatable: boolean;
  factory: boolean;
  defaultFactory: boolean;
  savePhases?: ("finalize" | "adjustnumbers")[] | undefined;
  facets: Facet[];
  external?: StringLit | undefined;
  parameter?: ParameterClause | undefined;
  /** Cardinality written directly after a factory action's name or parameter. */
  cardinality?: Cardinality | undefined;
  result?: ResultClause | undefined;
  defaultFunction?: Ident | undefined;
}
export interface FunctionStatement extends Node {
  kind: "function";
  name: Ident;
  internal: boolean;
  isStatic: boolean;
  repeatable: boolean;
  /** `key <AltKey> function …` — the RAP key-function form. */
  keyName?: Ident | undefined;
  facets: Facet[];
  external?: StringLit | undefined;
  parameter?: ParameterClause | undefined;
  result?: ResultClause | undefined;
}

export interface TriggerItem extends Node {
  op?: "create" | "update" | "delete" | undefined;
  fields?: Ident[] | undefined;
}
export interface ValidationStatement extends Node {
  kind: "validation";
  name: QualifiedName;
  /** false ⇒ a bare reference inside a determine-action block. */
  isDeclaration: boolean;
  on?: "save" | undefined;
  triggers: TriggerItem[];
}
export interface DeterminationStatement extends Node {
  kind: "determination";
  name: QualifiedName;
  isDeclaration: boolean;
  on?: "save" | "modify" | undefined;
  always: boolean;
  triggers: TriggerItem[];
}
export interface DetermineActionStatement extends Node {
  kind: "determine-action";
  name: Ident;
  /** `draft determine action Prepare` */
  draft: boolean;
  /** `extend [draft] determine action …` */
  extend: boolean;
  /** `draft determine action Prepare extensible;` */
  extensible: boolean;
  facets: Facet[];
  items: (ValidationStatement | DeterminationStatement)[];
}
export interface DraftActionStatement extends Node {
  kind: "draft-action";
  name: Ident;
  optimized: boolean;
  withAdditionalImplementation: boolean;
  facets: Facet[];
}

export interface EventStatement extends Node {
  kind: "event";
  name: Ident;
  managed: boolean;
  on?: Ident | undefined;
  parameter?: ParameterClause | undefined;
  forSideEffects: boolean;
}

export type SideEffectSource =
  | { kind: "field"; fields: Ident[] }
  | { kind: "self" }
  | { kind: "action"; name: Ident }
  | { kind: "event"; name: Ident }
  | { kind: "determine-action"; name: Ident };
export type SideEffectTrigger = { kind: "field"; path: Ident[] } | { kind: "global" };
export type SideEffectTarget =
  | { kind: "field"; wildcard: boolean; path: Ident[] }
  | { kind: "entity"; assocs: Ident[][] }
  | { kind: "permissions"; target: string }
  | { kind: "messages" }
  | { kind: "self" };
export interface SideEffectEntry extends Node {
  source: SideEffectSource;
  executedOn?: SideEffectTrigger[] | undefined;
  targets: SideEffectTarget[];
}
export interface SideEffectsBlock extends Node {
  kind: "side-effects";
  entries: SideEffectEntry[];
}

export interface MappingItem extends Node {
  cdsField?: Ident | undefined;
  sub?: Ident | undefined;
  dbField: Ident;
}
export interface MappingStatement extends Node {
  kind: "mapping";
  deep: boolean;
  target: Ident;
  control?: Ident | undefined;
  corresponding: boolean;
  extensible: boolean;
  except: Ident[];
  items: MappingItem[];
}

export type UseKind =
  | "create"
  | "update"
  | "delete"
  | "draft"
  | "draft-as-dependent"
  | "collaborative-draft"
  | "etag"
  | "side-effects"
  | "action"
  | "function"
  | "event"
  | "association"
  | "mapping"
  | "unknown";
export interface UseStatement extends Node {
  kind: "use";
  what: UseKind;
  name?: QualifiedName | undefined;
  alias?: Ident | undefined;
  assoc?: { create?: Range | undefined; withDraft?: Range | undefined; withDependentDraft?: Range | undefined } | undefined;
  mappingItems?: MappingItem[] | undefined;
}

export interface GroupStatement extends Node {
  kind: "group";
  name?: Ident | undefined;
  body: BodyStatement[];
}

/* ---- service definition (parsed by srvd.ts, a later phase) ---- */
export interface Annotation extends Node {
  path: string[];
  rawValue: string;
}
export interface ExposeStatement extends Node {
  kind: "expose";
  isMethod: boolean;
  entity?: Ident | undefined;
  classMethod?: { className: Ident; methodName: Ident } | undefined;
  alias?: Ident | undefined;
}
export interface ServiceDefinition extends Node {
  kind: "service-definition";
  form: "define" | "extend";
  annotations: Annotation[];
  name: Ident;
  providerContracts: Ident[];
  exposes: ExposeStatement[];
  unknown: UnknownStatement[];
}
