# F01 — `check_rap_behavior`: native RAP BDEF/SRVD semantic checker

**Status:** build spec (approved for implementation) · **Wave:** 2 / v0.12.0 · **Roadmap row:** 10 (`docs/ROADMAP-2026-09.md`)
**Date:** 2026-09-10 · **Owner:** principal architect
**Supersedes for BDEF/SRVD only:** `docs/DESIGN.md` §5's `validated:"template"` label (see §1.4 and the DESIGN §22 entry this spec requires).

**Research inputs (all read; cited per-rule below):**

| Input | Path |
|---|---|
| Corpus census (79 BDEF / 23 SRVD / 141 DDLS, 17 Apache-2.0 repos) | `evals/rap/fixtures/PROVENANCE.md` + `~/docs/reports/abap-mcp-sap-ai-upgrade-2026-09-09/wave2-rap-checker/corpus-inventory.md` |
| Grammar + SAP feature tables (~95 release rows) | `…/wave2-rap-checker/bdl-grammar-notes.md` |
| Rule catalog RAP001–RAP082 | `…/wave2-rap-checker/rap-rule-catalog.md` |
| Bundled release deltas (31 RAP rows, `minRelease`) | `src/abap/knowledge.ts` + `src/data/knowledge/abap-release-deltas.json` |

**The gap this closes, verified in the dependency tree, not assumed:**
`node_modules/@abaplint/core/build/src/objects/behavior_definition.js` parses a BDEF with exactly one regex
(`/\bdefine\s+(?:\w+\s+)*?behavior\s+for\s+([\w/]+)(?:\s+alias\s+(\w+))?/gi`) and exposes only `listEntities()` /
`findEntityNameByAlias()`. `service_definition.js` is a naming stub with no parse at all. Both are therefore
**ours to write**. `data_definition.js`, by contrast, runs a real `CDSParser` and exposes
`getParsedData(): {definitionName, fields[{key,name,nameInSource,prefix,annotations}], sources[], associations[], relations[], tree}` —
so **we write no CDS parser** (§2.6).

---

## 1. Scope and honesty contract

### 1.1 What the checker proves

1. **Lexical + syntactic well-formedness against our own BDL/SDL grammar** — the file tokenizes and reduces to an
   AST under the grammar in §2, which is derived from (a) SAP's `RAP BDL - Feature Tables` page, (b) the ABAP
   Keyword Documentation pages listed in `bdl-grammar-notes.md`, and (c) an empirical census of 102 real
   Apache-2.0 BDEF/SRVD files. Balanced braces, terminated statements, well-formed cardinalities, legal facet
   names, legal draft-action names.
2. **Structural consistency rules decidable from the behavior/service text alone** — the draft ⇄ `draft table` ⇄
   `total etag` ⇄ `lock master` ⇄ `authorization master` ⇄ numbering set, the strict-mode obligations, action /
   operation / validation / determination / side-effect / event coherence (§3).
3. **Cross-file checks, and only when the caller supplies the other file in the same call** —
   projection BDEF → base BDEF, BDEF → `.ddls` entity + element names (via abaplint's real CDS parser),
   SRVD `expose` → the CDS entities in scope.
4. **Release gating** — when `abapRelease` is passed, every construct whose SAP-documented minimum ABAP-Cloud
   release is newer than the target is reported (§3.5). Dated, bundled, and explicitly non-authoritative.

### 1.2 What it cannot prove — stated in `scopeNote` on every report, verbatim

- **ADT activation.** The target system's syntax check and activation remain the only arbiter. Our grammar is a
  documented-plus-sampled approximation, not SAP's compiler.
- **CDS metadata semantics.** Even with `.ddls` supplied we compare *names and text-level shapes*. We do not know
  a field's ABAP type, a key's cardinality, whether an association is a composition, whether a view is buffered,
  or whether an annotation is legal. Rules that need a type (RAP040's `raw(16)` half, RAP027's draft-table mirror,
  RAP042's key-field detection) are implemented only in their decidable half, or not at all — each is named in §3.6.
- **DDIC.** Persistent/draft table existence, field names, the `%admin` include, client fields: invisible to us.
- **Implementation classes.** Whether `ZBP_R_TRAVEL` exists, whether it implements `FOR NUMBERING`,
  `ADJUST_NUMBERS`, `FOR INSTANCE FEATURES`, or a save handler. RAP015/RAP043/RAP055 are therefore **not** in v1
  even though the catalog carries them — a BDEF-only checker can only guess, and a guessed error is worse than
  no tool (`DESIGN.md` §4).
- **ATC, released-API state, or a customer's own release list.** Unchanged from every other tool here.
- **BDEF extensions beyond a shallow parse.** `bdl-grammar-notes.md` §4 item 9 records that the entire extension
  body grammar is unconfirmed at the syntax-diagram level. v1 parses `extension …` / `extend behavior for …`
  headers and bodies permissively and runs **no** extension-specific rules (RAP078–RAP080 deferred).

### 1.3 The false-positive budget — the single most important design constraint

The corpus is a *sample* of BDL, not the language. `corpus-inventory.md` §5 names six legal constructs that never
appear in it (`functions`, `precheck`, `requires`, a standalone `features { instance { … } }` block,
`extend service`, `strict ( 1 )`), and `bdl-grammar-notes.md` §4 lists twelve constructs whose exact syntax was
never confirmed from a primary source. A parser built to reject everything it does not recognise would report
legal RAP as broken.

**Therefore the parser is two-tier and this is non-negotiable:**

| Situation | Emitted as |
|---|---|
| Punctuation-level breakage — unbalanced `{}`/`()`/`[]`, a statement that hits EOF without `;`, a stray `}` | `RAP-PARSE`, **severity `error`** |
| A statement that is punctuation-well-formed but whose leading keyword (or shape) is outside our vocabulary | `RAP000` *unknown-construct*, **severity `info`**, parse continues, node retained as `UnknownStatement` |

`RAP000` is a coverage signal for us, not a defect claim about the user's file: its message is
*"abap-mcp's BDL grammar (version X) does not recognise this statement; it was skipped, and no rule was applied to
it. This is a limit of the checker, not necessarily an error in your file."* Rules must **never** fire on evidence
that is absent because a statement was skipped — every rule that asserts *"X must be declared"* is required to
suppress itself when the enclosing entity contains an `UnknownStatement` that could plausibly be that X (§3.7).

### 1.4 Label semantics — the fourth `validated` value

`ScaffoldFile.validated` becomes four-valued (`AGENTS.md` invariant updated in the same PR):

| Label | Means |
|---|---|
| `"abaplint"` | Round-tripped through abaplint's real ABAP/CDS parser at Cloud level. |
| `"abaplint-syntax"` | Parses against abap-mcp's **own** `IF_AIC_*` stubs, not SAP's real API surface (DESIGN §19). |
| `"template"` | Golden-tested template only — nothing machine-checked it. |
| **`"rap-checker"`** | **New.** Parsed by abap-mcp's own BDL/SDL parser (grammar version stamped) **and** checked against the rule set at that `rulesVersion` with **zero findings at severity `error` or `warning`**. |

`"rap-checker"` explicitly does **not** claim: abaplint parsed it (abaplint cannot), SAP's parser would accept it,
or the object would activate. The `RapCheckReport` carries `grammarVersion`, `rulesVersion` and `scopeNote` so a
consumer can date the claim, exactly as `KNOWLEDGE_SCOPE_NOTE` dates the knowledge base.

**Downgrade rule:** a `"rap-checker"` label is only applied when the checker ran and returned zero error/warning
findings. If it returns findings, the file keeps `"template"` and the findings surface — the label must never be
the optimistic default.

### 1.5 `scopeNote` (exact constant, `RAP_SCOPE_NOTE`)

> Checked offline by abap-mcp's own RAP behavior/service-definition parser — not by abaplint (which stores BDEF/SRVD
> without deep-parsing them) and not by SAP. The grammar is derived from SAP's published RAP BDL feature tables and
> keyword documentation plus a 102-file corpus of Apache-2.0 SAP sample BDEF/SRVD sources; it is an approximation,
> and constructs it does not recognise are reported as info, never as errors. Cross-entity, CDS and DDIC facts are
> checked only for the files passed in the same call. ADT activation in the target system remains the only
> authority on whether these objects are valid.

---

## 2. Architecture

```
src/abap/rap/
  lexer.ts          tokenizer + source normalisation                     ~220 lines
  ast.ts            AST type declarations only (no runtime code)         ~340 lines
  parser.ts         recursive-descent BDEF parser + error recovery       ~900 lines
  srvd.ts           service-definition parser + the SRVD rule block      ~260 lines
  ddls.ts           thin adapter over abaplint's real CDS parser         ~130 lines
  rules.ts          rule registry + the 36 BDEF rules                    ~950 lines
  release-gates.ts  construct → minimum-release gate (RAP900)            ~180 lines
  index.ts          checkRapBehavior(files, opts) → RapCheckReport       ~220 lines
src/data/rap/
  bdl-release-gates.json   our transcription of SAP's feature table      ~110 rows
```

`src/abap/rap/` never imports from `src/tools/` or `src/server.ts`; the tool layer (`src/tools/rap.tools.ts`)
imports `index.ts` only. `ddls.ts` is the only file in the directory that imports `@abaplint/core`.

### 2.1 Lexer (`lexer.ts`)

**Normalisation, before scanning:** strip a UTF-8 BOM; `\r\n` and lone `\r` → `\n` (**19 of 102 corpus files are
CRLF** — measured, not assumed). Line/column numbering is computed on the normalised text and is 1-based for both,
matching `Finding` in `src/abap/engine.ts`.

**Token kinds:**

```ts
export type TokenKind = "ident" | "number" | "string" | "punct" | "eof";

export interface Token {
  kind: TokenKind;
  /** Source text exactly as written. */
  text: string;
  /** Upper-cased `text` for case-insensitive comparison (idents/puncts only). */
  key: string;
  line: number;      // 1-based
  column: number;    // 1-based
  endLine: number;
  endColumn: number; // exclusive
}
```

**Rules:**

- **Identifiers** — `[A-Za-z_][A-Za-z0-9_]*`, plus two extensions:
  - *namespaced*: a leading `/NS/` segment, `/[A-Za-z0-9_]+/[A-Za-z0-9_][A-Za-z0-9_]*` (real: `/DMO/I_Travel`,
    `/cca/bp_test_rap_unamanaged`). A `/` is only ever consumed as part of this leading form.
  - *`$self`*: `$` is legal only as the first character of `$self` (case-insensitive). Any other `$…` is a
    lexical error (`RAP-PARSE`).
- **No reserved words.** BDL keywords are matched *contextually* by the parser against `Token.key`, never by the
  lexer. This is required: CDS element names in the corpus include `Description`, `Notes`, `Quantity`, and a
  `field ( readonly ) OverallStatus, Salesorder;` list may legally contain a word that is a keyword elsewhere.
- **Numbers** — unsigned integer runs. Used only in cardinalities and `strict(1|2)`.
- **Strings** — `'…'` with `''` as the escaped quote (SRVD annotations; BDEF `external '…'`).
- **Punctuation** — `;` `{` `}` `(` `)` `,` `:` `=` `~` `[` `]` `*` `@` `.` and the two-character `..`
  (cardinality range; lexed as one token so `[0..*]` never looks like `0 . . *`).
  `~` is its own token; the parser folds `Alias ~ name` into a `QualifiedName` where a name is expected
  (real, 3 occurrences: `validation Booking~validateBookingStatus;`).
- **Comments** — `//` to end of line. `/* … */` is also consumed and discarded **defensively**
  (`bdl-grammar-notes.md` §3 records that block comments are unconfirmed for BDL; accepting one that turns out to
  be illegal costs nothing, rejecting one that turns out to be legal costs a false error). Comments are collected
  into a side channel `comments: Token[]`, never in the main stream.
- **Caps** — reuses `MAX_FILE_CHARS` (100 000) from `engine.ts`; additionally hard-stops at 200 000 tokens.

**Lexer unit tests (all from real corpus lines):** CRLF file; `strict(2);` unspaced vs `strict ( 2 );`;
`/DMO/I_Agency_StdVH`; `result [1] $self`; `[0..*]`; `Booking~validateBookingStatus`; `//**` trailing comment;
a field list wrapped over 6 lines whose `;` sits alone on its own line; `@EndUserText.label: 'x''y'`.

### 2.2 AST (`ast.ts`)

Every node carries a `Range`. Findings anchor on the **most specific** range available (a rule about
`total etag` anchors on the `total` keyword, not on the entity).

```ts
export interface Pos { line: number; column: number }
export interface Range { start: Pos; end: Pos }
export interface Node { range: Range }

/** An identifier as written, plus its upper-cased comparison key. */
export interface Ident extends Node { name: string; key: string; namespaced: boolean }
/** `Alias~name` (cross-entity reference inside a determine-action block). */
export interface QualifiedName extends Node { qualifier?: Ident; name: Ident; key: string }
export interface StringLit extends Node { value: string }
export interface Cardinality extends Node { min: number; max: number | "*"; raw: string }

/** Any statement the grammar did not recognise. NEVER an error — see §1.3. */
export interface UnknownStatement extends Node { kind: "unknown"; leadingKey: string; text: string }

export type ImplementationType =
  | "managed" | "unmanaged" | "abstract" | "projection" | "interface" | "extension" | "unspecified";

export interface SaveOption extends Node {
  form: "additional" | "unmanaged";
  fullData: boolean;
  andCleanup: boolean;
}

export interface BehaviorDefinition extends Node {
  kind: "behavior-definition";
  implementationType: ImplementationType;
  implementationClass?: Ident;
  /** Only for implementationType "extension". */
  extensionForm?: "for-projection" | "for-abstract" | "using-interface" | "implementation";
  extensionInterface?: Ident;
  strict?: { level: 1 | 2; range: Range };
  /** Header-level draft declaration. `collaborative` = `with collaborative draft;`. */
  withDraft?: { collaborative: boolean; range: Range };
  withHierarchy?: Range;
  managedByBopf?: Range;
  extensible?: { options: string[]; range: Range };   // `extensible;` → options []
  auxiliaryClasses: Ident[];
  privilegedMode?: { form: "enabled" | "disabling" | "disabling-base-context"; range: Range };
  managedInstanceFilter?: Range;
  saveAfter?: Ident;
  /** Header-level save clause fused onto the impl-type statement. */
  save?: SaveOption;
  /** `use draft;` etc. appearing above the first `define behavior for` (interface BDEFs). */
  headerUses: UseStatement[];
  entities: EntityBehavior[];
  unknownHeader: UnknownStatement[];
}

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
  | { kind: "extensible"; range: Range }
  | { kind: "with-draft"; collaborative: boolean; range: Range }   // illegal here; parsed so RAP024 can report it
  | { kind: "with-hierarchy"; range: Range }
  | { kind: "changedocuments"; form: "master" | "dependent"; assoc?: Ident; range: Range }
  | { kind: "use"; use: UseStatement; range: Range }               // `use etag` (no `;`) before the body
  | { kind: "unknown"; statement: UnknownStatement; range: Range };

export type AuthScope = "none" | "global" | "instance";

export interface EntityBehavior extends Node {
  kind: "entity-behavior";
  form: "define" | "extend";
  /** CDS entity for `define behavior for`; the base alias for `extend behavior for`. */
  entity: Ident;
  alias?: Ident;
  external?: StringLit;
  /** True for the FIRST `define` block in the file — the BO root by BDL convention. */
  isRoot: boolean;
  implementationClass?: Ident;      // per-entity override of the header class

  /** Source-ordered characteristics — the only ordering-sensitive rule (RAP034) reads this. */
  characteristics: EntityCharacteristic[];

  /* Normalised convenience projections of `characteristics`, filled by normalise(). */
  persistentTable?: Ident;
  draftTable?: Ident;
  etagMaster?: Ident;
  etagDependentBy?: Ident;
  totalEtag?: Ident;
  lockMaster?: { unmanaged: boolean; range: Range };
  lockDependentBy?: Ident;
  authorization?: { form: "master" | "dependent"; scopes: AuthScope[]; assoc?: Ident; range: Range };
  numbering?: { when: "early" | "late"; range: Range };
  save?: SaveOption;
  withDraft?: { collaborative: boolean; range: Range };   // entity-level → RAP024

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
  | OperationStatement | FieldStatement | AssociationStatement | ActionStatement | FunctionStatement
  | DeterminationStatement | ValidationStatement | DetermineActionStatement | DraftActionStatement
  | SideEffectsBlock | MappingStatement | EventStatement | UseStatement | GroupStatement | UnknownStatement;

/* ---- facets shared by operations, actions and functions ---- */
export type Facet =
  | { kind: "features"; scope: "instance" | "global"; range: Range }
  | { kind: "authorization"; value: "none" | "update" | "global" | "instance"; range: Range }
  | { kind: "precheck"; range: Range }
  | { kind: "lock-none"; range: Range }
  | { kind: "unknown"; text: string; range: Range };

export interface OperationStatement extends Node {
  kind: "operation"; verb: "create" | "update" | "delete";
  internal: boolean; facets: Facet[]; defaultFunction?: Ident;
}

export interface FieldChar extends Node {
  name: "readonly" | "mandatory" | "suppress" | "numbering" | "features" | "notrigger" | "modify"
      | "hierarchy-index" | "unknown";
  qualifier?: "create" | "update" | "managed" | "instance" | "warn" | "execute";
  raw: string;
}
export interface FieldStatement extends Node { kind: "field"; characteristics: FieldChar[]; fields: Ident[] }

export interface AssociationStatement extends Node {
  kind: "association"; name: Ident;
  create?: { facets: Facet[]; range: Range };
  withDraft?: Range; withDependentDraft?: Range; withHierarchy?: Range;
  linkAction?: Ident; unlinkAction?: Ident; inverseFunction?: Ident;
  unknown: UnknownStatement[];
}

export interface ParameterClause extends Node { deep: boolean; table: boolean; isSelf: boolean; type?: Ident }
export type ResultTarget =
  | { kind: "self" } | { kind: "entity"; entity: Ident } | { kind: "type"; type: Ident };
export interface ResultClause extends Node {
  selective: boolean; deep: boolean; cardinality?: Cardinality; target: ResultTarget;
}

export interface ActionStatement extends Node {
  kind: "action"; name: Ident;
  internal: boolean; isStatic: boolean; repeatable: boolean;
  factory: boolean; defaultFactory: boolean;
  savePhases?: ("finalize" | "adjustnumbers")[];
  facets: Facet[]; external?: StringLit;
  parameter?: ParameterClause;
  /** Cardinality written directly after a factory action's parameter, e.g. `… [1];`. */
  cardinality?: Cardinality;
  result?: ResultClause;
  defaultFunction?: Ident;
}
export interface FunctionStatement extends Node {
  kind: "function"; name: Ident;
  internal: boolean; isStatic: boolean; repeatable: boolean;
  facets: Facet[]; external?: StringLit;
  parameter?: ParameterClause; result?: ResultClause;
}

export interface TriggerItem extends Node { op?: "create" | "update" | "delete"; fields?: Ident[] }
export interface ValidationStatement extends Node {
  kind: "validation"; name: QualifiedName;
  /** false ⇒ a bare reference inside a determine-action block. */
  isDeclaration: boolean;
  on?: "save"; triggers: TriggerItem[];
}
export interface DeterminationStatement extends Node {
  kind: "determination"; name: QualifiedName; isDeclaration: boolean;
  on?: "save" | "modify"; always: boolean; triggers: TriggerItem[];
}
export interface DetermineActionStatement extends Node {
  kind: "determine-action"; name: Ident;
  draft: boolean;        // `draft determine action Prepare`
  extend: boolean;       // `extend draft determine action Prepare`
  extensible: boolean;   // `draft determine action Prepare extensible;`
  facets: Facet[];
  items: (ValidationStatement | DeterminationStatement)[];
}
export interface DraftActionStatement extends Node {
  kind: "draft-action"; name: Ident;
  optimized: boolean; withAdditionalImplementation: boolean; facets: Facet[];
}

export interface EventStatement extends Node {
  kind: "event"; name: Ident; managed: boolean; on?: Ident;
  parameter?: ParameterClause; forSideEffects: boolean;
}

export type SideEffectSource =
  | { kind: "field"; fields: Ident[] } | { kind: "self" }
  | { kind: "action"; name: Ident } | { kind: "event"; name: Ident }
  | { kind: "determine-action"; name: Ident };
export type SideEffectTrigger =
  | { kind: "field"; path: Ident[] } | { kind: "global" };
export type SideEffectTarget =
  | { kind: "field"; wildcard: boolean; path: Ident[] }
  | { kind: "entity"; assocs: Ident[][] }
  | { kind: "permissions"; target: string }
  | { kind: "messages" } | { kind: "self" };
export interface SideEffectEntry extends Node {
  source: SideEffectSource; executedOn?: SideEffectTrigger[]; targets: SideEffectTarget[];
}
export interface SideEffectsBlock extends Node { kind: "side-effects"; entries: SideEffectEntry[] }

export interface MappingItem extends Node { cdsField?: Ident; sub?: Ident; dbField: Ident }
export interface MappingStatement extends Node {
  kind: "mapping"; deep: boolean; target: Ident; control?: Ident;
  corresponding: boolean; extensible: boolean; except: Ident[]; items: MappingItem[];
}

export type UseKind =
  | "create" | "update" | "delete" | "draft" | "draft-as-dependent" | "collaborative-draft"
  | "etag" | "side-effects" | "action" | "function" | "event" | "association" | "mapping" | "unknown";
export interface UseStatement extends Node {
  kind: "use"; what: UseKind; name?: QualifiedName; alias?: Ident;
  assoc?: { create?: Range; withDraft?: Range; withDependentDraft?: Range };
  mappingItems?: MappingItem[];
}

export interface GroupStatement extends Node { kind: "group"; name?: Ident; body: BodyStatement[] }

/* ---- service definition ---- */
export interface Annotation extends Node { path: string[]; rawValue: string }
export interface ExposeStatement extends Node {
  kind: "expose"; isMethod: boolean;
  entity?: Ident; classMethod?: { className: Ident; methodName: Ident }; alias?: Ident;
}
export interface ServiceDefinition extends Node {
  kind: "service-definition"; form: "define" | "extend";
  annotations: Annotation[]; name: Ident;
  providerContracts: Ident[]; exposes: ExposeStatement[]; unknown: UnknownStatement[];
}
```

### 2.3 Parser (`parser.ts`)

**Shape.** One `class BdefParser { constructor(tokens: Token[], filename: string) }` with a cursor,
`peek()/next()/atKey(k)/eatKey(k)/expectKey(k)/expectPunct(p)`, and `parse(): { ast: BehaviorDefinition; errors: RapParserError[] }`.
It never throws out of `parse()`; a caller always gets a (possibly partial) AST.

**Dispatch.** Header statements are parsed until the first `define`/`extend` at depth 0; then entity blocks. Inside
an entity body, dispatch is on the leading `Token.key` against the table below (derived from the corpus first-token
census: `use` 218, `field` 113, `create` 107, `draft` 94, `define` 87, `update` 62, `delete` 51, `with` 46,
`validation` 44, `strict` 32, `lock` 28, `determination` 27, `extensible` 26, `authorization` 26, `persistent` 21,
`etag` 20, `mapping` 19, `managed` 19, `action` 16, `association` 13, `event` 10, `side` 9, `static` 6, `late` 5,
`internal` 4 …). Multi-word leaders (`draft action` vs `draft determine action` vs `draft table`,
`determine action` vs `determination`, `side effects`, `total etag`, `early|late numbering`,
`static default factory action`) are disambiguated with bounded lookahead — never more than 4 tokens.

**Error recovery — the contract, tested.** On an unexpected token:

1. Emit **exactly one** `RapParserError { message, line, column, excerpt, kind: "syntax" | "unknown-construct" }`.
2. `synchronize()`: remember the brace depth `d` at the point of failure; consume tokens until *either*
   a `;` at depth `d`, *or* a `}` that would take depth below `d` (which is **not** consumed — the enclosing
   block's parser handles it), *or* EOF. The skipped span becomes an `UnknownStatement` in the enclosing node.
3. Parsing continues. **One bad statement yields one finding**; the remaining statements and every subsequent
   entity are still parsed and still rule-checked.

Escape hatches so a pathological file cannot hang: max 200 recovery events per file (then stop and set
`truncated`), and `synchronize()` always consumes at least one token.

**`extensible` is both a header statement and an entity characteristic.** Confirmed in the corpus
(`abap-platform-basic-trial/zr_ac000000uxx.bdef.asbdef` puts a bare `extensible` between `persistent table` and
`draft table`; `abap-platform-rap630/zrap630r_shoptp_sol.bdef.asbdef` uses the block form
`extensible { with additional save; with determinations on modify; }`). Both positions and both forms parse.

**Characteristics have no `;`.** `persistent table zfoo` / `lock master total etag LastChangedAt` /
`use etag` run un-terminated up to the entity body's `{`. The characteristic loop therefore terminates on `{`,
and every characteristic parser is written to stop at a token that begins another characteristic.

**Acceptance gate:** `parse()` must return `errors.length === 0` **and** produce zero `UnknownStatement`s for all
102 BDEF/SRVD fixtures. This is a CI test (§6.1), not a goal.

### 2.4 Service definitions (`srvd.ts`)

A separate, much smaller recursive-descent parser plus the SRVD rule block (§3.4). Handles both annotation forms
observed in 22 of 23 corpus files — dotted (`@ObjectModel.leadingEntity.name: 'X'`) and nested-block
(`@ObjectModel: { leadingEntity: { name: 'X' } }`) — normalising both to a dotted `path: string[]`, so a rule
reads one shape. `provider contracts a, b` is a comma list of idents, upper-cased into `key`.

### 2.5 Rule registry (`rules.ts`)

```ts
export type RapSeverity = "error" | "warning" | "info";
export type RapConfidence = "confirmed" | "inferred" | "community-reported" | "conflicting";

export interface RapRuleContext {
  /** Every BDEF passed in this call, keyed by lower-cased filename. */
  bdefs: Map<string, ParsedBdef>;
  /** Every SRVD passed in this call. */
  srvds: Map<string, ParsedSrvd>;
  /** CDS entities in scope, from abaplint's CDS parser (see ddls.ts). */
  cds: Map<string /* upper-cased entity name */, CdsEntityInfo>;
  /** The BDEF this rule invocation is scoped to. */
  file: ParsedBdef;
  /** True when `strict`/`strict(2)` is declared OR opts.strict forced it on. */
  strict: boolean;
  strictLevel: 1 | 2 | undefined;
  abapRelease?: KnowledgeRelease;
  /** Resolves `use`/projection targets: base BDEF for a projection, by entity/alias name. */
  resolveBase(entity: EntityBehavior): { file: ParsedBdef; entity: EntityBehavior } | undefined;
  report(f: Omit<RapFinding, "rule" | "severity" | "confidence" | "docsUrl" | "sourceUrl">): void;
}

export interface RapRule {
  id: string;                    // "RAP026" | "SRVD003" | "RAP000" | "RAP900"
  title: string;
  severity: RapSeverity;
  confidence: RapConfidence;
  /** Only run when the BDEF (or opts) put the BO in strict mode. */
  strictOnly?: boolean;
  /** Only run when at least one file of this kind was supplied. */
  requires?: ("base-bdef" | "ddls" | "srvd")[];
  /** Release gate, ABAP-Cloud train id, e.g. "2508" — checked against opts.abapRelease. */
  minRelease?: KnowledgeRelease;
  /** SAP page the rule was derived from; echoed on every finding as sourceUrl. */
  sourceUrl: string;
  /** Anchor into docs/RAP-RULES.md; echoed as docsUrl. */
  docsAnchor: string;
  hint: string;
  check(ctx: RapRuleContext): void;
}

export const RAP_RULES: readonly RapRule[] = [ /* … */ ];
```

**Severity policy, enforced by a test.** `confidence: "confirmed"` keeps the catalog severity.
`"inferred"` / `"community-reported"` / `"conflicting"` is **capped at `warning`** (naming conventions at `info`),
and its `message` ends with a bracketed provenance clause — e.g.
`" [inferred from SAP documentation, not stated directly — treat as advisory]"`. A unit test asserts no rule with
non-`confirmed` confidence carries `severity: "error"`.

### 2.6 CDS adapter (`ddls.ts`) — we write no CDS parser

`.ddls.asddls` files go into a fresh `abaplint.Registry` at `{version:"Cloud", preset:"syntax-only"}` (reusing
`buildConfig` from `engine.ts`, so one config path serves the whole server). For each
`abaplint.Objects.DataDefinition` we take `getParsedData()` — `definitionName`, `fields[{key,name,nameInSource,prefix,annotations}]`,
`sources[]`, `associations[]` — and add one text-level classifier over the first non-annotation statement:

```ts
export type CdsShape =
  | "root-view-entity" | "view-entity" | "projection-view" | "abstract-entity"
  | "transactional-interface" | "table-entity" | "custom-entity" | "classic-view" | "unknown";
export interface CdsEntityInfo {
  name: string; key: string; shape: CdsShape;
  /** `as projection on X` target, when shape is projection-view. */
  projectionOn?: string;
  fields: { name: string; key: boolean }[];
  associations: string[];
  filename: string;
}
```

abaplint's own `cds_parser_error` findings for those files are **passed through into `findings[]`** with
`rule: "cds_parser_error"` and abaplint's `docsUrl` — a broken CDS view is reported by the real parser, not ours.
`shape: "classic-view"` (a `define view` without `entity`) is what makes RAP021 decidable; it is **not** in v1's
rule set but the field exists for v1.1.

### 2.7 Entry point (`index.ts`)

```ts
export const RAP_GRAMMAR_VERSION = "bdl/2026-09-10";   // bump on any grammar change
export const RAP_RULES_VERSION   = "rap-rules/1.0.0";
export const MAX_RAP_FILES = 64;                        // library cap; the MCP tool keeps engine.ts's 32

export interface RapCheckOptions {
  /** Enables release gating (RAP900). One of KNOWLEDGE_RELEASES. */
  abapRelease?: KnowledgeRelease;
  /** Force strict-mode rules on even when the BDEF omits `strict`. Default false. */
  strict?: boolean;
  maxFindings?: number;   // default MAX_FINDINGS (500), shared with engine.ts
}

export function checkRapBehavior(files: AbapSource[], opts?: RapCheckOptions): RapCheckReport;
```

Pipeline: bound + classify by extension → lex+parse every BDEF and SRVD → build the CDS map via `ddls.ts` →
build one `RapRuleContext` per BDEF → run every applicable rule → run SRVD rules → run RAP900 release gates →
sort findings by `(file, line, column, rule)` → cap → summarise. Fully stateless, one pass, no caching
(`DESIGN.md` §8).

---

## 3. Rule catalog — v1

36 BDEF rules drawn from `rap-rule-catalog.md`, plus 7 service-definition rules from `bdl-grammar-notes.md` §7,
plus the two structural pseudo-rules and the release gate. Every `sourceUrl` is the one the catalog cites; every
rule gets an anchor in `docs/RAP-RULES.md`.

Notation in the pseudo-code: `bo` = the parsed `BehaviorDefinition`; `e` = an `EntityBehavior`;
`root` = `bo.entities.find(x => x.isRoot)`; `ctx` as in §2.5.

### 3.1 Confirmed → `error`

| ID | Severity | Condition (pseudo-code) | Message template | Fix hint | Gate |
|---|---|---|---|---|---|
| **RAP001** | error | `requires ddls` · `root && ctx.cds.has(root.entity.key) && ctx.cds.get(root.entity.key).shape !== "root-view-entity"` | `The first behavior definition in this file is for {entity}, which is declared as a {shape} — a BO root must be a "define root view entity".` | `Point the first "define behavior for" at the root view entity, or add "root" to the CDS view definition.` | — |
| **RAP002** | **warning** (amended, see §9.1) | `requires ddls` · for each `e` with `form==="define"`: `!ctx.cds.has(e.entity.key)` **and** at least one supplied `.ddls` exists | `"define behavior for {entity}" references a CDS entity that was not found among the .ddls sources passed in this call — it may simply not have been passed.` | `Pass the entity's .ddls.asddls in the same call, or correct the spelling — BDL matches CDS names exactly (case-insensitively).` | — |
| **RAP003** | error | for each characteristic naming an association (`etag-dependent`, `lock-dependent`, `authorization-dependent`): `!e.associations.some(a => a.name.key === assoc.key)` | `Entity {entity} is "{clause} by {assoc}" but {assoc} is not declared in its behavior body.` | `Add "association {assoc};" to the entity body — dependent clauses may only name associations the BDEF declares.` | — |
| **RAP011** | error | `bo.implementationType in {managed, unmanaged}` && `!bo.implementationClass` && `bo.entities.every(e => !e.implementationClass)` | `A {implType} behavior definition needs an implementation class: none is declared in the header or on any entity.` | `Add "{implType} implementation in class zbp_<entity> unique;" as the first statement.` | — |
| **RAP008** | error | `requires base-bdef` · `bo.implementationType==="projection" && bo.strict && base && !base.ast.strict` | `This projection declares strict({level}) but its base behavior definition {baseFile} does not declare strict.` | `Add "strict ( 2 );" to the base BDEF — a projection may only be strict if its base is.` | — |
| **RAP009** | error | `requires base-bdef` · `bo.implementationType==="projection" && base.ast.implementationType==="abstract"` | `A projection behavior definition cannot be built on an abstract behavior definition ({baseFile}).` | `Project onto a managed or unmanaged BDEF; abstract BDEFs are typing constructs only.` | — |
| **RAP012** | error | for each `f` in `e.fields`: `f.characteristics` contains `features` **and** any of `readonly`/`readonly:create`/`readonly:update` | `Field(s) {fields} combine feature control with readonly on {entity} — the two are mutually exclusive under strict mode.` | `Drop "readonly" and let the FOR INSTANCE FEATURES handler return the read-only state, or drop the feature control.` | strict |
| **RAP013** | error | `!e.isRoot && e.operations.some(o => o.verb==="create" && !o.internal)` | `Non-root entity {entity} declares a direct "create;" — under strict mode subnodes are created by association only.` | `Remove "create;" here and add "association _{entity} { create; }" on the parent entity.` | strict |
| **RAP018** | error | `requires base-bdef` · `bo.implementationType==="projection" && base is draft-enabled` and the projection's root entity is missing any of `use action Edit/Activate/Discard/Resume/Prepare` | `Strict projection on a draft-enabled BO must expose the draft actions explicitly; missing: {missing}.` | `Add "use action Edit; use action Activate; use action Discard; use action Resume; use action Prepare;" to the projection entity body.` | strict |
| **RAP019** | error | `bo.withDraft && root` and `root.draftActions` is missing any of `Edit/Activate/Discard/Resume`, or no `DetermineActionStatement` with `draft && name.key==="PREPARE"` | `Strict draft-enabled BO must declare its draft actions explicitly; missing on {entity}: {missing}.` | `Add "draft action Edit; draft action Activate optimized; draft action Discard; draft action Resume; draft determine action Prepare { … }".` | strict |
| **RAP020** | error | `da.draft && da.name.key==="PREPARE" && da.facets.some(f => f.kind==="authorization")` | `"draft determine action Prepare" must not carry an authorization addition.` | `Remove the "( authorization : … )" facet — Prepare is not authorization-controlled.` | — |
| **RAP024** | error | any `e.withDraft` (entity-level `with draft`) | `"with {collaborative? 'collaborative ':''}draft" is declared on entity {entity}; draft is a property of the whole BO and belongs in the BDEF header.` | `Move "with draft;" above the first "define behavior for".` | — |
| **RAP026** | error | `bo.withDraft && root && !root.draftTable` | `The BO is draft-enabled but its root entity {entity} declares no "draft table".` | `Add "draft table z<table>_d" to the root's characteristics (ADT's quick-fix on the BDEF generates the table).` | — |
| **RAP028** | error | `count(e => e.lockMaster) !== 1` **or** the entity with `lockMaster` is not `isRoot` **or** any non-root `e` has neither `lockMaster` nor `lockDependentBy` | `Exactly one entity — the root — must declare "lock master"; found {n} ({entities}).` | `Declare "lock master" on the root and "lock dependent by _ParentAssoc" on every child.` | — |
| **RAP029** | error | `count(e => e.authorization?.form==="master") !== 1` **or** it is not on `isRoot` | `Exactly one entity — the root — must declare "authorization master"; found {n}.` | `Declare "authorization master ( global )" (or "( instance )") on the root and "authorization dependent by _ParentAssoc" on children.` | strict |
| **RAP030** | error | `e.authorization?.form==="master" && e.authorization.scopes.length===0` | `"authorization master ( )" on {entity} names no scope.` | `Write "authorization master ( global )", "( instance )", "( global, instance )" or the explicit opt-out "( none )".` | — |
| **RAP031** | error | `e.authorization?.form==="dependent"` and the named assoc is not declared in `e.associations` *(the "must reach the master" half needs CDS composition data and is **not** implemented — §3.6)* | `"authorization dependent by {assoc}" on {entity} names an association that is not declared in this entity's behavior body.` | `Declare "association {assoc};" in {entity}, pointing at the authorization master.` | — |
| **RAP032** | error | `bo.implementationType !== "abstract"` and for each `e`: `!e.etagMaster && !e.etagDependentBy` | `Entity {entity} declares neither "etag master <Field>" nor "etag dependent by <_Assoc>".` | `Add "etag master LocalLastChangedAt" on the root, "etag dependent by _Parent" on children.` | strict |
| **RAP034** | error | for `e.characteristics`: index of `total-etag` is not `index(lock-master) + 1`, **or** the entity has `total-etag` without `lock-master` | `"total etag {field}" on {entity} must come immediately after "lock master", on the lock-master entity only.` | `Write the two as one clause: "lock master total etag {field}".` | — |
| **RAP035** | error | `bo.withDraft && root && !root.totalEtag` | `A draft-enabled BO must declare a "total etag" field on its lock-master (root) entity.` | `Change the root's lock clause to "lock master total etag LastChangedAt".` | — |
| **RAP040** | error | `bo.implementationType !== "managed"` and any field carries `numbering:managed` | `"field ( numbering : managed )" is only valid on a managed BO; this BDEF is {implType}.` | `Use early or late numbering with a FOR NUMBERING handler, or make the BO managed.` | — |
| **RAP046** | error | `e.persistentTable && (bo.implementationType==="unmanaged" \|\| save?.form==="unmanaged" on bo or e)` | `"persistent table {table}" on {entity} conflicts with {reason} — RAP does not own persistence there.` | `Remove "persistent table", or drop "with unmanaged save" / switch the BO to managed.` | — |
| **RAP038** | error | `da.name.key in {ACTIVATE, DISCARD} && da.facets.length > 0` | `"draft action {name}" must not carry feature or authorization control.` | `Remove the "( … )" facet — the framework does not evaluate it for Activate/Discard.` | — |
| **RAP048** | error | `a.factory && a.result !== undefined` | `Factory action {name} declares a result clause; factory actions return the new key through the "mapped" response, not a result.` | `Delete the "result …" clause; keep the cardinality, e.g. "factory action {name} [1];".` | — |
| **RAP056** | error | one element's `facets` contain both `features:instance` and `features:global` | `{element} combines "features : instance" and "features : global" — pick one.` | `Instance feature control needs FOR INSTANCE FEATURES; global needs FOR GLOBAL FEATURES. Declare one.` | — |
| **RAP057** | error | `op.verb !== "delete"` and `op.facets` contain `authorization: update` | `"( authorization : update )" delegates to the update check and is documented only for "delete"; it is declared on "{verb}".` | `Remove the addition from {verb}, or move it to "delete".` | — |
| **RAP081** | error | `da.name.key ∉ {EDIT, ACTIVATE, DISCARD, RESUME, ADDITIONALSAVE, SHARE}` | `"draft action {name}" is not a RAP draft action; legal names are Edit, Activate, Discard, Resume, AdditionalSave and Share.` | `Rename it, or declare it as a plain "action {name};" if it is your own action.` | AdditionalSave→2308, Share→2508 |
| **RAP037** | error | for `da.items`: the referenced validation/determination resolves in the same BDEF to a declaration whose `on` is `"modify"` | `"{daName}" assigns {itemName}, which is declared "on modify"; determine actions may only assign "on save" items.` | `Change {itemName} to "on save", or drop it from {daName}.` | — |
| **RAP058** | error | `v.isDeclaration && triggers has update && !triggers has create` | `Validation {name} triggers on "update" alone; the update trigger is only supported combined with "create".` | `Write "validation {name} on save { create; update; … }".` | — |
| **RAP059** | error | `requires ddls` · a validation/determination trigger `field F` where `F` is not an element of the entity's CDS view | `Validation {name} on {entity} triggers on field {field}, which is not an element of {entity}.` | `Use an element of {entity}; a trigger field must belong to the entity the check is defined for.` | — |
| **RAP067** | error | a `SideEffectEntry` whose `source.kind==="self"` and a target `{kind:"field", path.length===1}` | `"$self affects field {field}" targets a field of the same entity; $self side effects must target an associated entity.` | `Write "field <source> affects field {field};" for same-entity dependencies, or target "entity _Assoc".` | — |
| **RAP068** | error | a side-effect source `{kind:"event"}` whose event is declared in `e.events` **without** `forSideEffects` | `Side effect triggered by event {name}, but {name} is not declared "for side effects".` | `Change the declaration to "event {name} for side effects;".` | 2502 |
| **RAP060** | error | `requires base-bdef` · a `UseStatement` whose target is not enabled on the corresponding base entity (op / action / function / association / etag) | `"use {what} {name}" is not enabled in the base behavior definition {baseFile} for {entity}.` | `Declare it in the base BDEF first — a projection can only re-expose behavior the base enables.` | — |
| **RAP076** | error | `requires base-bdef` · `bo.implementationType==="projection" && base is draft-enabled && no use of kind "draft"/"draft-as-dependent" in the projection root` | `The base BO is draft-enabled but this projection does not expose draft handling.` | `Add "use draft;" (or "use draft as dependent;" for a non-root entity in a cross-BO draft scope).` | as-dependent→2508 |
| **RAP064** | error | `bo.implementationType==="interface" && (bo.implementationClass \|\| any e.implementationClass)` | `An interface behavior definition must not declare an implementation class — it has no runtime handler.` | `Remove the "implementation in class …" clause; behavior is inherited from the base BO.` | 2205 |

### 3.2 Reported / inferred → `warning` (+ provenance clause on the message)

| ID | Severity | Confidence | Condition | Message suffix |
|---|---|---|---|---|
| **RAP025** | warning | inferred | `bo.withDraft` set twice, or one `with draft;` and one `with collaborative draft;` in the same header | `[inferred from SAP's draft documentation, not stated directly — treat as advisory]` |

*(v1 keeps exactly one inferred rule. RAP006, RAP036, RAP041, RAP047, RAP052, RAP061, RAP075, RAP082 and the six
naming rules RAP069–RAP074 are specified, fixtured and **deferred to v1.1** — see §3.6. Keeping the inferred set at
one in v1 makes the "confirmed ⇒ error, everything else ⇒ warning" policy test trivially auditable before the
policy has to carry weight.)*

### 3.3 Structural pseudo-rules

| ID | Severity | Fires when |
|---|---|---|
| **RAP-PARSE** | error | Punctuation-level syntax breakage (§1.3). One finding per recovery point, max 200. |
| **RAP000** | info | A punctuation-well-formed statement outside our grammar. Message states this is a checker limit. |

### 3.4 Service-definition rules (`srvd.ts`)

Source: `bdl-grammar-notes.md` §7 (`CDS SDL - DEFINE SERVICE`, `CDS SDL - PROVIDER CONTRACTS`, both primary), and
§6 invalid snippets 9–10.

| ID | Severity | Confidence | Condition | Message | Hint |
|---|---|---|---|---|---|
| **SRVD001** | error | confirmed | `srvd.exposes.length === 0` | `Service definition {name} exposes nothing; at least one EXPOSE is required.` | `Add "expose ZC_<Entity> as <Alias>;".` |
| **SRVD002** | error | confirmed | a contract key ∉ `{INA, ODATA_V2_UI, ODATA_V4_UI, ODATA_V2_WEBAPI, ODATA_V4_WEBAPI, SQL}` | `"{token}" is not a CDS provider contract.` | `Use one of INA, ODATA_V2_UI, ODATA_V4_UI, ODATA_V2_WEBAPI, ODATA_V4_WEBAPI, SQL. (Note: the token is ODATA_V4_WEBAPI, not odata_v4_web_api.)` |
| **SRVD003** | error | confirmed | contracts contain both a `*_UI` and a `*_WEBAPI` OData contract | `OData provider contracts of type UI and WEBAPI cannot be combined.` | `Publish two service definitions, one per contract type.` |
| **SRVD004** | error | confirmed | any `expose method …` while contracts do not include `SQL` | `"expose method" requires provider contract SQL.` | `Add "provider contracts sql", and declare the AMDP procedure FOR SQL SERVICE.` |
| **SRVD005** | warning | inferred | two exposes resolve to the same alias key | `Alias {alias} is exposed twice in {name}.` | `Give each exposed entity a distinct alias.` |
| **SRVD006** | **warning** | confirmed | `requires ddls` · an exposed entity is not among the supplied CDS entities **and** its name is in the caller namespace (`Z`/`Y`/`/NS/`) | `Exposed entity {entity} was not found among the .ddls sources passed in this call.` | `Pass its .ddls.asddls, or check the name.` |
| **SRVD007** | warning | confirmed | `@ObjectModel.leadingEntity.name` names an entity not in `exposes` | `The leading entity {entity} is not exposed by this service.` | `Expose it, or point the annotation at an exposed entity.` |

**SRVD006 is deliberately a warning, not an error.** The corpus exposes SAP-standard views (`I_Currency`,
`I_UnitOfMeasure`, `/DMO/I_Agency_StdVH`) the caller will never pass; only caller-namespace names are checked at
all, and even then absence means "not supplied", not "does not exist".

### 3.5 Release gates (`release-gates.ts`, rule **RAP900**)

Table-driven, `severity: "warning"` (never `error` — the table is dated and the target system is authoritative,
exactly as `KNOWLEDGE_SCOPE_NOTE` says). Data: `src/data/rap/bdl-release-gates.json`, our own transcription of the
ABAP-Cloud columns of SAP's `RAP BDL - Feature Tables` page (~110 rows from `bdl-grammar-notes.md` §2 — release
numbers, not prose, so the §2/DESIGN §17 licensing line is respected; `sourceUrl` cited per row).

```jsonc
{ "construct": "with-collaborative-draft", "label": "with collaborative draft",
  "minRelease": "2508", "btp": "2508", "s4hcPublic": "2508",
  "sourceUrl": "https://help.sap.com/docs/abap-cloud/abap-keyword/rap-bdl-feature-tables",
  "knowledgeId": "rap-collaborative-draft-2508" }
```

`knowledgeId` cross-links to `src/data/knowledge/abap-release-deltas.json` (31 RAP rows already carry
`minRelease`). When present, the finding's `nextTools`-style hint names `explain_abap_release` with that id, so an
agent can read the delta card without another lookup. `KNOWLEDGE_RELEASES` from `src/abap/knowledge.ts` supplies
the ordering — no second release ordering is introduced.

Detection is AST-driven (a visitor emits `construct` keys during parse; no re-scanning of text). Finding:

> `"{label}" requires ABAP Cloud {minRelease} or higher; the target release you passed is {abapRelease}.`
> hint: `Remove the construct, or raise --release. Bundled release data curated {curatedDate}; the target system's release notes are authoritative.`

### 3.6 Deliberately **not** implemented in v1, and why

| Catalog rule | Why not |
|---|---|
| RAP015, RAP043, RAP055, RAP080 | Need the behavior-pool class (`ADJUST_NUMBERS`, `FOR NUMBERING`, `FOR INSTANCE FEATURES`). A BDEF-only checker would guess. |
| RAP027 | Needs the DDIC draft table's fields and the `%admin` include. |
| RAP040's `raw(16)` half, RAP042, RAP044 | Need field ABAP types / key detection beyond names. |
| RAP004, RAP005, RAP021, RAP031's reachability half, RAP033, RAP062, RAP063, RAP075 | Need composition-tree resolution (association → target entity, to-parent/to-child kinds). abaplint's `parsedData.associations` gives names, not verified composition semantics. Scheduled for v1.1 once §2.6's `CdsEntityInfo` is extended and proven against the corpus. |
| RAP039, RAP045, RAP054, RAP023 | `info`-only observations with no decidable trigger, or out of BDEF scope. |
| RAP049, RAP050, RAP051 | Largely enforced by the grammar itself (RAP049) or need projection↔base result-entity mapping (RAP050/051). |
| RAP078–RAP080 | The BDEF-extension body grammar is unconfirmed (`bdl-grammar-notes.md` §4 item 9). Parsed permissively, never rule-checked. |
| RAP069–RAP074 (naming) | `info`-level conventions from a community blog. Fixtured, registry-ready, shipped in v1.1 behind a `conventions: true` option so a default run never nags. |

### 3.7 The suppression contract (§1.3, restated as an implementation obligation)

Every rule of the form *"X must be declared"* (RAP011, RAP019, RAP026, RAP028, RAP029, RAP032, RAP035, RAP018,
RAP076, SRVD001, **SRVD007**) must call `ctx.mayBeHiddenBy(entity, ["draft-table", "lock", …])` before reporting; the helper
returns true when the entity (or header) holds an `UnknownStatement` whose leading key is in the given set or is
unrecognised entirely. When it returns true the rule stays silent and increments
`summary.suppressedByUnknown` — visible in the report, so coverage gaps are measurable instead of invisible.

---

## 4. Tool and CLI contract

### 4.1 MCP tool `check_rap_behavior` (`src/tools/rap.tools.ts`)

**Input schema** (zod, every field `.describe()`d — rubric requirement):

```ts
{
  files: z.array(z.object({
    filename: z.string().optional().describe(
      'abapGit-style name — "zr_travel.bdef.asbdef", "zui_travel_v4.srvd.srvdsrv", "zr_travel.ddls.asddls". ' +
      'Omit it and the kind is inferred from the source; pass it whenever you have it, because cross-file ' +
      'checks (projection → base, expose → CDS entity) key off names.'),
    source: z.string().describe("The complete behavior-definition, service-definition or CDS source text."),
  })).min(1).max(32).describe(
    "The BDEF/SRVD files to check, plus any .ddls.asddls or base .bdef.asbdef you want cross-checked in the " +
    "same call. Up to 32 files, 100k chars each — passing the base BDEF and the CDS views is what turns on " +
    "the cross-file half of the rule set."),
  abapRelease: z.enum(KNOWLEDGE_RELEASES).optional().describe(
    'Target ABAP Cloud release, e.g. "2508". When set, constructs whose SAP-documented minimum release is ' +
    "newer are reported as warnings (rule RAP900) from the bundled, dated feature table. Omit to skip release gating."),
  strict: z.boolean().default(false).describe(
    "Run the strict-mode rules even when the BDEF does not declare strict/strict(2) — use it to see what a BO " +
    "would have to fix before it can be released under the C0/C1 contract. Default false: strict rules run only " +
    "on BDEFs that declare strict."),
}
```

**Output schema** — `RapCheckReport`:

```ts
interface RapCheckReport {
  files: {
    filename: string;
    kind: "bdef" | "srvd" | "ddls" | "unsupported";
    parsed: boolean;
    parserErrors: { message: string; line: number; column: number; excerpt: string; kind: "syntax" | "unknown-construct" }[];
    entityCount?: number;      // bdef
    exposeCount?: number;      // srvd
  }[];
  findings: {
    rule: string;              // "RAP026" | "SRVD003" | "RAP900" | "RAP000" | "RAP-PARSE" | "cds_parser_error"
    severity: "error" | "warning" | "info";
    message: string;
    file: string; line: number; column: number;
    excerpt: string;
    hint: string;
    confidence: "confirmed" | "inferred" | "community-reported" | "conflicting";
    entity?: string;
    minRelease?: string;
    docsUrl?: string;          // anchor in docs/RAP-RULES.md
    sourceUrl?: string;        // the SAP page the rule derives from
  }[];
  summary: { errors: number; warnings: number; infos: number; filesChecked: number; rulesRun: number;
             suppressedByUnknown: number; unknownConstructs: number; baseUnresolved: number;
             omitted: number; truncated: boolean };
  // errors/warnings/infos are counted over the UNCAPPED finding set; `omitted`
  // says how many findings the cap dropped (§9.1 item 9). `baseUnresolved` is
  // §9.1 item 10's counter.
  scopeNote: string;           // RAP_SCOPE_NOTE, verbatim
  grammarVersion: string;      // RAP_GRAMMAR_VERSION
  rulesVersion: string;        // RAP_RULES_VERSION
  releaseGate?: { abapRelease: string; curatedDate: string; gatedConstructs: number };
  validated: "rap-checker";
}
```

`annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true }` — same as every other tool.

**Description** (rubric-compliant: verb-first name, what it operates on, "Use this when", explicit non-goals,
≥1 example — mirroring `scaffold_abap_ai_sdk`'s shape):

> Check RAP behavior definitions (`.bdef.asbdef`) and CDS service definitions (`.srvd.srvdsrv`) for syntax and
> structural-consistency defects, offline, using abap-mcp's own BDL/SDL parser — abaplint does **not** deep-parse
> either file type (it stores a BDEF behind a single regex and a SRVD not at all), so this is the only static
> feedback these files get without a system. Reports the draft/etag/lock/authorization/numbering consistency set,
> strict-mode obligations, action/operation/validation/determination/side-effect coherence, projection `use`
> statements against the base BDEF, and service `expose` sets against the CDS entities you pass in the same call;
> with `abapRelease` set, it also flags constructs newer than that release from a bundled, dated copy of SAP's RAP
> BDL feature table.
> Use this when you have written or generated a BDEF/SRVD (by hand, from `scaffold_rap_bo`, or from a model that
> may have invented RAP syntax) and want it checked before it reaches ADT — and pass the base BDEF and the
> `.ddls.asddls` views alongside it, because the cross-file rules only run on files present in the call.
> It does **not** connect to SAP, does not activate anything, does not run ATC, cannot see DDIC tables,
> behavior-pool classes or CDS field types, and cannot certify that ADT would accept the file — the grammar is
> derived from SAP's published feature tables plus a 102-file corpus of Apache-2.0 SAP sample sources, so
> constructs it does not recognise are reported as info, never as errors. For ABAP classes use `lint_abap`; for a
> new BO use `scaffold_rap_bo`; for what a release added use `explain_abap_release`.
> Example: `check_rap_behavior({ "files": [ { "filename": "zr_travel.bdef.asbdef", "source": "managed implementation in class zbp_travel unique;\nstrict ( 2 );\nwith draft;\n\ndefine behavior for ZR_Travel alias Travel\npersistent table ztravel\nlock master\n{ create; }\n" } ], "abapRelease": "2508" })`.

**Examples array (3):** (1) a single draft BDEF, catching the missing `draft table` / `total etag`;
(2) a projection BDEF + its base BDEF + both `.ddls`, showing the cross-file `use` check; (3) a service
definition + its projection `.ddls`, with `abapRelease: "2502"` to demonstrate a release gate.

**Server wiring:** `RAP_TOOLS` exported from `src/tools/rap.tools.ts`, appended to `ALL_TOOLS` in
`src/abap.tools.ts`. Tool count 17 → **18** (`server.test.ts`'s `CORE_TOOLS` list and its
"lists the seventeen offline tools" title both updated). `SERVER_INSTRUCTIONS` gains one clause:
*"for a RAP behavior or service definition use check_rap_behavior — abaplint does not parse those file types."*

### 4.2 CLI `abap-mcp rapcheck`

```
abap-mcp rapcheck [paths…]   check RAP behavior/service definitions (BDEF/SRVD) — syntax + consistency rules
                             [--release 2508] [--strict] [--json]
```

- Collects `.bdef.asbdef`, `.srvd.srvdsrv` and `.ddls.asddls` from the given files/dirs (default `.`) with the
  existing `collectFiles()`; a directory sweep automatically brings the CDS views along, which is what makes the
  cross-checks work in the common case.
- Human output: one line per finding, `severity file:line:col rule message`, then a summary and the scope note on
  stderr; **stdout stays the JSON-RPC channel discipline** — for `rapcheck` (a plain CLI subcommand) the report
  goes to stdout only under `--json`, findings to stdout as text otherwise, and the scope note to stderr.
- `--json` prints the exact `RapCheckReport`.
- **Exit codes:** `1` if `summary.errors > 0` — counted over the UNCAPPED finding set (§9.1 item 9), so an
  error whose finding the report cap dropped still fails the run — `0` otherwise (warnings and infos do not fail — the release gate
  and the inferred rules must never break a build), `2` on usage error / no analyzable files found.
- Implemented as `cmdRapcheck(argv, io)` in `src/cli-extra.ts`, dispatched from `src/cli-commands.ts`, listed in
  `EXTRA_USAGE`.

---

## 5. Integration

### 5.1 `scaffold_rap_bo` — the label, and the template fixes it forces

After generation, `scaffoldRapBo()` runs `checkRapBehavior()` over **all eight artifacts' checkable subset** —
both `.ddls`, both `.bdef`, the `.srvd` — in one call, so the cross-file rules (RAP001/RAP002/RAP008/RAP009/
RAP018/RAP060/RAP076/SRVD006/SRVD007) actually run on our own output.

```ts
export interface ScaffoldFile {
  filename: string; content: string;
  validated: "abaplint" | "template" | "rap-checker";
}
export interface ScaffoldResult {
  …
  validationIssues: Finding[];   // unchanged: abaplint
  rapFindings: RapFinding[];     // NEW: the RAP checker over the generated BDEF/SRVD
}
```

- `*.bdef.asbdef` and `*.srvd.srvdsrv` are labelled **`"rap-checker"`** when
  `rapFindings.filter(f => f.severity !== "info").length === 0`; otherwise they stay `"template"`.
- `*.ddlx.asddlx` **stays `"template"`** — nothing checks metadata extensions, and inventing a claim there would
  repeat exactly the mistake DESIGN §5 was written to avoid.
- `nextSteps`' last line changes from *"behavior/service definitions are canonical templates"* to
  *"behavior and service definitions were checked by abap-mcp's own RAP parser and rule set (grammar
  {grammarVersion}); ADT activation is still the final arbiter."*

**Two template changes are required, and the keystone discipline says fix the template, not the test:**

1. **Draft projection BDEF must declare the draft actions** (RAP018). Today it emits only
   `use create; use update; use delete;` under `use draft;`. Add, in the draft variant:
   `use action Edit; use action Activate; use action Discard; use action Resume; use action Prepare;`
2. **Root BDEF's `draft determine action Prepare;`** stays as-is (a body-less Prepare is legal —
   `bdl-grammar-notes.md` §1.9) and satisfies RAP019.

Everything else in the current template already passes the v1 set (verified by hand against the emitted text:
header `managed implementation in class … unique;` → RAP011 ✓; `strict ( 2 );` → strict rules on;
`lock master total etag LastChangedAt` → RAP034/RAP035 ✓; `etag master LocalLastChangedAt` → RAP032 ✓;
`authorization master ( instance )` → RAP029/RAP030 ✓; `draft table ztravel_d` → RAP026 ✓;
`persistent table ztravel` on a managed BO → RAP046 ✓; single root entity → RAP013/RAP028 ✓;
`expose ZC_Travel as Travel` with `zc_travel.ddls.asddls` in the same call → SRVD006 ✓).

**Keystone test extended** (`src/__tests__/scaffold.test.ts`): alongside `validationIssues === []`, assert
`rapFindings.filter(f => f.severity !== "info") === []` **and** `rapFindings === []` (zero infos too — our own
generator must not emit a construct our own grammar cannot read) for both the draft and non-draft variants, and
assert the three files carry `validated === "rap-checker"`.

### 5.2 `lint_abap` routing — decided: route and merge, namespaced

**Decision.** When any file in a `lint_abap` call is a `.bdef.asbdef` or `.srvd.srvdsrv`, the whole file set is
*additionally* passed to `checkRapBehavior()` and its findings are merged into the returned `findings[]`.
Rationale: today those files produce **zero** findings from abaplint and the caller cannot tell "clean" from
"not parsed" — that silence is the honesty problem F01 exists to fix, and an agent that lints a whole abapGit
directory should not have to know to call a second tool.

**Merge contract:**

- Rule keys are namespaced `rap/RAP026`, `rap/SRVD003`, `rap/RAP900`, `rap/RAP-PARSE`, `rap/RAP000` — the `rap/`
  prefix guarantees no collision with an abaplint rule key, and makes the source of every finding obvious.
- Severity maps to abaplint's casing: `error → "Error"`, `warning → "Warning"`, `info → "Info"`.
- `docsUrl` = the rule's `docs/RAP-RULES.md` anchor (always present, so the `Finding` shape stays satisfied).
- `hint` and `confidence` are dropped in the merge (the `Finding` shape is fixed); the hint is appended to
  `message` as ` — {hint}` so nothing is lost.
- Ordering: abaplint findings first, then RAP findings; the joint list is capped by the existing `MAX_FINDINGS`.
- **No new input flag.** It runs on every preset including `syntax-only` (parser errors are syntax), and a
  `focus` tag does not suppress it — same policy as `parser_error`/`cds_parser_error` in `buildConfig()`.
- The `lint_abap` result gains two fields: `rapChecked: boolean` and, when true, `rapScopeNote: string`
  (= `RAP_SCOPE_NOTE`). Its description gains one sentence naming the behaviour and pointing at
  `check_rap_behavior` for the full structured report.
- `abap-mcp lint` inherits this automatically (it calls the same engine path).

### 5.3 `check_cloud_readiness` — explicitly out of scope

Readiness is `diff(parse@Cloud, parse@baseline)` (`DESIGN.md` §4). BDL has no classic-vs-Cloud dialect to diff, so
a RAP finding has no meaningful place in `cloudBlockerCount` or the score, and folding one in would repeat the
`releasedApiFindings` mistake the invariant already forbids. `readiness.ts` is untouched; `docs/COOKBOOK.md` gets a
recipe pairing the two tools instead.

---

## 6. Test plan

All tests live in `src/__tests__/`; fixtures in `evals/rap/`. `npm run check` remains the gate.

### 6.1 Corpus test — `rap-corpus.test.ts` (the parser's acceptance gate)

- Walks `evals/rap/fixtures/**` and parses every `.bdef.asbdef` and `.srvd.srvdsrv`.
- Asserts, per file: `parserErrors.length === 0` **and** zero `RAP000` unknown-construct findings.
- Asserts counts as a corpus-integrity guard: `bdefCount >= 79`, `srvdCount >= 23`, `ddlsCount >= 141`,
  `repoCount >= 17` — so a fixture deleted by accident fails CI rather than silently weakening the gate.
- Asserts `PROVENANCE.md` exists and lists every fixture directory (licence hygiene, mirroring
  `check-knowledge-links.mjs`'s intent).
- Reports the aggregate as a named snapshot line so a grammar regression shows *which* file broke.

### 6.2 Golden rule tests — `rap-rules.test.ts`

- Fixtures at `evals/rap/rules/<RULE_ID>/{ok,bad}.<ext>` (plus optional `base.bdef.asbdef` / `entity.ddls.asddls`
  for cross-file rules), **written by us**, minimal, one construct under test each.
- Table-driven loop: for every registered rule, `bad` must produce **≥1 finding with that exact id** and `ok`
  must produce **zero**.
- **Meta-test:** every rule in `RAP_RULES` has both fixtures — a rule cannot ship untested.
- **Meta-test:** every rule id appears as a heading anchor in `docs/RAP-RULES.md` — `docsUrl` cannot rot.
- **Policy test:** no rule with `confidence !== "confirmed"` has `severity: "error"`; every non-confirmed rule's
  message ends with the bracketed provenance clause.
- **Anti-noise test:** running the full rule set over the entire 102-file corpus produces **zero `RAP-PARSE`
  findings and zero `RAP000` findings**, and the error-severity findings it does produce are reviewed and pinned
  in a checked-in expectation file (`evals/rap/corpus-expectations.json`). Real SAP samples are not all
  strict-clean, so this pins the *number and identity* of legitimate findings; a rule that suddenly fires 40 more
  times on SAP's own code is a false-positive regression and fails the build.

### 6.3 Lexer / parser unit tests — `rap-lexer.test.ts`, `rap-parser.test.ts`

- Lexer cases from §2.1.
- **Recovery test:** a BDEF with one malformed statement in the middle of an entity body yields exactly one
  `RAP-PARSE` finding, and the AST still contains every other statement of that entity plus the following entity.
- **Suppression test:** an entity containing an `UnknownStatement` where `draft table` would be does not produce
  RAP026, and `summary.suppressedByUnknown === 1`.
- **Cap test:** a file with 500 broken statements stops at 200 recovery events with `truncated: true`.

### 6.4 Integration tests

| Test | Assertion |
|---|---|
| `scaffold.test.ts` (keystone, extended) | `rapFindings === []` for draft and non-draft; the 3 files carry `validated: "rap-checker"`; `validationIssues === []` unchanged. |
| `server.test.ts` | Tool list is the 18 offline tools; `check_rap_behavior` round-trips over the wire with `structuredContent`; the existing rubric block covers it automatically (verb-first, "Use this when", non-goals, described params, ≥1 example, `readOnlyHint`). |
| `engine`/`lint` routing test | A call to `lint_abap` with one `.bdef.asbdef` returns ≥1 `rap/RAP…` finding and `rapChecked: true`; a call with only `.clas.abap` returns `rapChecked: false` and no `rap/` findings. |
| `cli.test.ts` | `rapcheck` on a temp dir of good files exits 0; on a dir with one error fixture exits 1; `--json` output parses and matches the `RapCheckReport` shape; `--release 2502` on a `with collaborative draft` fixture yields a `RAP900` warning and still exits 0. |
| `evals/routing/cases.json` | +2 cases (33 → 35): *"Check this RAP behavior definition for draft/etag/lock consistency before I activate it"* → `check_rap_behavior`; *"Does this service definition expose the right entities and is the provider contract valid?"* → `check_rap_behavior`. |
| Hallucination eval (F14 seed) | One deterministic case per model-invented RAP defect: `draft action Reject;` (RAP081), `factory action x [1] result [1] $self;` (RAP048), `with draft;` on an entity (RAP024), `provider contracts odata_v4_web_api` (SRVD002). |

### 6.5 Performance budget — `rap-perf.test.ts`

- Parse + full rule run over the 102-file corpus. Assert **mean < 50 ms per file** and total wall time < 6 s on
  the ARM64 target (generous headroom; the parser is a single pass over ≤100 k chars with no I/O).
- Assert peak `findings.length` stays within `MAX_FINDINGS`.

---

## 7. Build plan — file by file, in implementation order

| # | Step | Files | Est. lines | Done when |
|---|---|---|---|---|
| 1 | **Lexer** | `src/abap/rap/lexer.ts` + `rap-lexer.test.ts` | 220 + 120 | Every §2.1 case green; tokenizing all 102 fixtures throws nothing. |
| 2 | **AST types** | `src/abap/rap/ast.ts` | 340 | `npm run typecheck` clean; types only, zero runtime code. |
| 3 | **Parser** | `src/abap/rap/parser.ts` + `rap-parser.test.ts` | 900 + 180 | **§6.1 corpus test green: 0 parser errors, 0 `RAP000` over all 102 fixtures.** Iterate here until it is — this step is the project's real risk and gets the time. |
| 4 | **CDS adapter** | `src/abap/rap/ddls.ts` | 130 | `CdsEntityInfo` produced for all 141 corpus `.ddls`; `cds_parser_error` passthrough proven on a deliberately broken view. |
| 5 | **SRVD parser + rules** | `src/abap/rap/srvd.ts` | 260 | All 23 SRVD fixtures parse; SRVD001–007 fixtured and green. |
| 6 | **Rule registry + 36 rules** | `src/abap/rap/rules.ts` + `evals/rap/rules/**` + `rap-rules.test.ts` | 950 + 86 fixtures + 220 | Every rule has ok/bad fixtures; meta-tests + policy test + §6.2 anti-noise expectation file green. |
| 7 | **Release gates** | `src/abap/rap/release-gates.ts` + `src/data/rap/bdl-release-gates.json` | 180 + ~110 rows | RAP900 fires on a `with collaborative draft` fixture at `--release 2502` and not at `2508`; every row's `knowledgeId` resolves in `abap-release-deltas.json` (test). |
| 8 | **Entry point** | `src/abap/rap/index.ts` | 220 | `checkRapBehavior()` returns a well-formed `RapCheckReport`; perf test green. |
| 9 | **MCP tool** | `src/tools/rap.tools.ts`, `src/abap.tools.ts` (append `RAP_TOOLS`), `src/server.ts` (instructions) | 220 + 15 | `server.test.ts` 18-tool list + wire test + rubric green; 2 routing cases green. |
| 10 | **CLI** | `src/cli-extra.ts` (`cmdRapcheck`, `EXTRA_USAGE`), `src/cli-commands.ts` (dispatch, `USAGE`) | 90 + 10 | `cli.test.ts` cases green; exit codes correct. |
| 11 | **Scaffold integration** | `src/abap/scaffold.ts` (template fixes + `rapFindings` + label), `src/__tests__/scaffold.test.ts` | 40 + 30 | **Keystone green with `rapFindings === []`.** |
| 12 | **lint_abap routing** | `src/abap.tools.ts` (merge), `src/cli-commands.ts` (inherits) | 45 | Routing test green; namespaced keys verified. |
| 13 | **Docs** | `docs/RAP-RULES.md` (new), `docs/DESIGN.md` §22 (new), `AGENTS.md`/`CLAUDE.md` (4-valued `validated`, tool count, `rapcheck`), `README.md`, `docs/COOKBOOK.md` recipe, `docs/ROADMAP-2026-09.md` row 10 → shipped | 300 + 40 + edits | Every rule id anchored (test); `npm run check` green end to end. |

**Total new production code ≈ 3 400 lines**, plus ~750 lines of tests and 86 small fixtures.

**Why this order:** the parser is the only genuinely uncertain component (a grammar assembled from a sampled
corpus plus documentation with twelve confirmed gaps), so it is proven against 100 % of the corpus *before* a
single rule is written. Rules built on an AST that already reads every real SAP sample cannot be undermined by a
parser change later. Tool/CLI come before the scaffold integration so the keystone test is the last gate flipped,
not the first thing broken.

---

## 8. Open questions for the owner

1. **`RAP000` in the default output.** Info-level unknown-construct findings are honest but chatty on a large,
   exotic BDEF. Ship them always (current spec), or behind a `verbose` flag with the count always in `summary`?
2. **`lint_abap` merge opt-out.** §5.2 deliberately ships with no flag. If a consumer wants abaplint-only output
   (e.g. an existing CI comparing finding counts across versions), that is a breaking change for them. Add
   `rapCheck?: boolean = true` now, or wait for a report?
3. **Naming-convention rules (RAP069–RAP074).** v1.1 behind a `conventions` option, per §3.6 — or never, since
   `Z`-namespace shops legitimately differ and the source is a community blog?
4. **Corpus expectations file** (`evals/rap/corpus-expectations.json`). It pins the findings our rules produce on
   SAP's own samples. Some of those are genuine SAP sample defects; do we want to report the interesting ones
   upstream (good OSS citizenship, and evidence the checker works) or keep it internal?
5. **`strict` default.** v1 runs strict rules only when the BDEF declares `strict`. Given that C0/C1 release
   contracts require `strict(2)` and ABAP Cloud new development effectively always is, should the default flip to
   strict-on with an opt-out?

---

## 9. Decisions on the open questions (owner review, 2026-09-10)

1. **`RAP000` in the default output — ship always.** Honesty over tidiness: the count goes in `summary.unknownConstructs` and the individual infos stay in `findings[]` (cap the RAP000 entries at 50 per file, note the cap in the summary).
2. **`lint_abap` merge — add `rapCheck?: boolean` (default `true`).** Described param, so an existing CI comparing abaplint-only counts can opt out; the CLI gets `--no-rap`.
3. **Naming-convention rules RAP069–RAP074 — v1.1, behind `conventions: true`.** Not in this build.
4. **Corpus expectations file — internal for now.** Pin the findings on SAP's own samples in `evals/rap/corpus-expectations.json`; any upstream report is the owner's call later.
5. **`strict` default — unchanged (rules keyed to the BDEF's own `strict` declaration).** The checker reports what the file declares; it does not assume a policy the file does not state. A `RAP-STRICT-MISSING` **info** on a managed/unmanaged BDEF without `strict` is fine (ABAP Cloud release contracts expect strict(2)), but no strict rule fires without the declaration.

Build constraints restated for the implementers: no commits; `npm run check` is the gate; the scaffold keystone (`validationIssues === []` **and** `rapFindings === []`) is never relaxed — fix the template; every new tool passes the rubric in `src/__tests__/server.test.ts` (the pinned tool list grows to 18 offline tools + the opt-in runner); version target 0.12.0; `docs/RAP-RULES.md` documents every shipped rule with its source.


### 9.1 Amendments after verification (2026-09-10)

The build's own verification pass changed three things the sections above still described the old way. They are
recorded here rather than silently rewritten, because each one is a decision, not a typo.

1. **RAP002 is `severity: "warning"`, not `error`** (§3.1's row amended in place). The gate is satisfied by
   *one* supplied `.ddls`, after which every entity of every other BDEF in the call is "missing". A base BDEF +
   its projection + the projection's CDS view — the ordinary partial set an agent assembles — is legal RAP, and
   three errors on it is exactly the false positive §1.3 budgets against. An absent `.ddls` means *"not
   supplied"*, not *"does not exist"* — the identical epistemic footing §3.4 already writes down for SRVD006,
   and already a warning there.

2. **SRVD007 is a suppressed rule** (§3.7's list amended in place). `@ObjectModel.leadingEntity.name` naming an
   entity that is not in `exposes` is only a defect if we actually read every EXPOSE; an EXPOSE we skipped may
   be the very one the annotation names. It now consults the same `bodyMayBeHidden()` gate as SRVD001 and
   counts its silence in `summary.suppressedByUnknown`.

3. **A punctuation error in a SRVD emits `RAP-PARSE` only — never `RAP-PARSE` *and* `RAP000`.** §1.3's two tiers
   are exclusive, and the BDL parser has always treated them that way (`makeUnknown(pos, reported: true)` does
   not file a second finding). The SDL parser filed both for one span, so the identical defect read as worse in a
   service definition than in a behavior definition, and RAP000's message — *"a limit of the checker, not
   necessarily an error in your file"* — was attached to text that demonstrably failed to reduce. §3.7 is
   unaffected: `bodyMayBeHidden()` reads `errors` as well as `unknown`, so SRVD001/SRVD007 stay silent on a file
   that did not parse. `rap-index.test.ts`'s assertion that pinned the double report was updated to pin the new
   contract, with the BDEF half asserted beside it so the two parsers cannot drift apart again.

4. **Root-ness is derived, not read off statement order** (§2.3 / §3.1). SAP's syntax notation for
   *RAP - EntityBehaviorDefinition* anchors a behavior definition on its root and says the root's entity
   behavior definition is mandatory while children's are optional, and all 79 corpus BDEFs write the root
   first — but no primary source states that the order is *enforced*, and no documented ADT check rejects a
   child-first file (researched 2026-09-10; the canonical page survives only as an archived snapshot). §2.5
   caps an unconfirmed requirement at `warning`, so no new error was invented. Instead the checker derives the
   root from evidence: the one `define`-form entity whose CDS view is a `define root view entity` when the
   `.ddls` are in the call, else the first `define behavior for` (the documented convention, as a fallback).
   A legal child-first BDEF used to draw four false errors (RAP001/RAP013/RAP028/RAP029) and now draws none.
   The "entity no other composition targets" signal stays deferred with §3.6's composition rules.

5. **Two new checker-level ids: `RAP-DUP` (error) and `RAP-INPUT` (warning).**
   `RAP-DUP` reports an entity characteristic declared twice on one entity (`persistent table`, `draft table`,
   `query`, one ETag clause, one lock clause, one authorization clause, `total etag`, numbering,
   `changedocuments`). The parser keeps the *first* of a repeated pair, so a second declaration used to be read,
   dropped and never mentioned — every rule then judged a file the caller did not write. Confirmed from the
   entity-characteristic production in `bdl-grammar-notes.md` §1.2 and SAP's cheat-sheet sections, which
   document each clause as one property of the entity; no corpus file repeats one.
   `RAP-INPUT` reports two files passed in one call under the same filename. The cross-file rules key off names,
   so the collision used to collapse both into one map entry and silently switch off every `requires:
   ["base-bdef"]` rule — a checker returning nothing at all. Files are now told apart by content (identical text
   under one name is one file passed twice; different text is kept as two) and the call is flagged. It carries no
   `check()` over an AST and no `ok`/`bad` fixture pair can express it (a fixture directory cannot hold two files
   with one name), so it lives beside `RAP_RULES` as its own metadata record rather than in it.

6. **`check_rap_behavior` refuses a call it cannot check.** A file set with no `.bdef.asbdef` and no
   `.srvd.srvdsrv` used to return `0 error(s), 0 warning(s) … across 0 RAP file(s)` stamped
   `validated: "rap-checker"` — a clean bill of health for a check that never ran, the one thing `DESIGN.md` §4
   forbids. It now throws `invalid_input` (via `src/errors.ts`) with the hint *"pass at least one .bdef.asbdef or
   .srvd.srvdsrv (plus the .ddls files they reference)"*, matching what `abap-mcp rapcheck` has always done
   (exit 2). The library entry point is unchanged — `lint_abap` and `scaffold_rap_bo` call it with whatever they
   have and read `filesChecked` themselves.

7. **Entity-level `extensible { … }` parses** (§2.3 already required both forms in both positions; only the
   header position implemented the block form). The block used to be mistaken for the entity body, which cost
   two `RAP000` infos on a legal file.

8. **`rap-perf.test.ts` exists** (§6.5). Mean `checkRapBehavior()` time over the whole 243-file corpus (BDEF +
   SRVD + DDLS, one call per repository), measured with `performance.now()`: the assertion fails only above
   100 ms/file so shared CI cannot flake it, the §6.5 budget of 50 ms/file logs a warning, and the measured mean
   is printed. Measured on the ARM64 target at implementation time: **0.7 ms/file**.

9. **`summary` counts are uncapped, and two new counters** (§4.1's `RapCheckReport.summary`).
   `errors`/`warnings`/`infos` are taken over the finding set **before** the report cap, and the new
   `summary.omitted` says how many findings the cap dropped. They used to be counted over the retained
   list, so a run whose errors fell past `MAX_FINDINGS` reported `errors: 0` with `truncated: true` — and
   `abap-mcp rapcheck` exited **0** on a file its own rules had just called invalid, which is precisely the
   CI gate the subcommand exists to be. The exit code (both the text and the `--json` path) now follows the
   uncapped count. Two further honesty counters join `suppressedByUnknown`: `summary.baseUnresolved`
   (item 10) and, on the `lint_abap` merge, the RAP report's `truncated` is ORed into the merged flag
   instead of being discarded.

10. **An explicit `as projection on` target that is absent from the call resolves to nothing** (§2.5's
   `resolveBase`). `ddls.ts` now extracts `projectionOn` independently of `CdsShape`, so a
   `define root view entity … as projection on ZR_A` keeps **both** facts (it used to return at the
   root-view branch and throw the target away, which is the ordinary shape of a RAP consumption view).
   With the target known, naming a base no supplied BDEF defines is evidence of absence *for this call*:
   `resolveBase()` returns undefined, the cross-file rules stay silent, and `summary.baseUnresolved`
   counts the silence. Falling through to the alias / single-candidate heuristics had been reporting
   confirmed `RAP060` errors against an unrelated base the projection demonstrably does not use.

11. **§3.7's suppression is scoped to the file the evidence would be in.** `RapRuleContext` gains
   `mayBeHiddenIn(file, entity, keys)`; `mayBeHiddenBy` is the `ctx.file` case of it. RAP008 asks about
   `strict` on the **base**, so it consults the base — checking the projection's own unknowns answered a
   question nobody asked. Both count in the same `summary.suppressedByUnknown` column.

12. **The two tiers are decided over all three delimiter kinds, and a service body must close.**
   `synchronize()` tracks brace depth because that is what decides where a skipped statement *ends*;
   whether the skipped span was *well-formed* is the separate question §1.3 keys its tiers on, and it now
   checks `{}`, `()` and `[]` (`lexer.ts`'s `unbalancedDelimiter()`, one definition, both parsers). An
   unbalanced span is `RAP-PARSE`, never `RAP000` — `future ( ; }` inside an entity used to report as a
   coverage note over text that demonstrably failed to reduce, with the file reported `parsed: true`.
   On the SDL side the closing `}` was merely *eaten if present*, so `define service Z { expose ZC_X;`
   parsed clean and anything after the body was dropped on the floor; both are `RAP-PARSE` now.

13. **Nothing in the checker may throw at the caller.** CDS annotation values are depth-limited (64 —
   far past anything SAP documents; 10,000 nested `[` used to exhaust V8's stack and abort the whole
   run with a `RangeError`), and each file's parse is wrapped so an unforeseen engine limit becomes a
   `RAP-PARSE` *"internal parser error"* finding on that file, with every other file in the call still
   checked. The same holds on the CDS side, where the parser is abaplint's own: `buildCdsMap()` retries
   file-by-file when the batch throws, so one hostile `.ddls` costs itself and nothing else. §2.7's "never throws for anything the caller could have written" is now enforced, not just
   intended.
