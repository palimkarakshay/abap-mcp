# RAP rule reference

Every rule `check_rap_behavior`, `abap-mcp rapcheck` and the `rap/…` half of `lint_abap` can report,
with the SAP page it was derived from. Rule ids are stable: a finding's `docsUrl` is this file plus
`#<lowercased id>`, and a test asserts every registered rule has a section here.

**Grammar version:** `bdl/2026-09-10` · **Rules version:** `rap-rules/1.0.0` · **Release-gate data curated:** 2026-09-10

## How to read a finding

| Column | Meaning |
|---|---|
| **severity** | `error` = a confirmed defect. `warning` = advisory, an inferred rule or a release gate — never fails a build. `info` = a note about the *checker*, not about your file. |
| **confidence** | `confirmed` = stated in SAP documentation. `inferred` / `community-reported` / `conflicting` = weaker provenance; such rules are **capped at `warning`** and their message ends with a bracketed provenance clause. A test enforces both halves. |
| **gate** | What has to be true for the rule to run at all. Rules needing a second file stay silent when you do not pass it — they never guess. |
| **hint** | The concrete fix, as BDL you can paste. |

Two rules describe the checker rather than your code: [RAP-PARSE](#rap-parse) (the only place the parser
calls a file wrong) and [RAP000](#rap000) (a statement our grammar does not know, reported as `info`).
A rule of the form *"X must be declared"* suppresses itself when an unreadable statement could have been
that X, and the report counts those in `summary.suppressedByUnknown` — a coverage gap is visible, never
silent. The suppression is applied to the file the missing declaration would have to be *in*: for a
cross-file rule such as [RAP008](#rap008), an unreadable header statement in the **base** BDEF silences it.

### Reading `summary`

| Field | Meaning |
|---|---|
| `errors` / `warnings` / `infos` | Counted over the **uncapped** finding set — they describe the files, not the length of `findings[]`. A run whose findings overflow the report cap still reports every error it found, so `abap-mcp rapcheck` exits 1 on an error whose finding was dropped. |
| `omitted` | How many findings the report cap dropped. `findings[]` is short by exactly this many; the counts above are not. |
| `truncated` | The report is short: the finding cap, a parser's recovery cap or the lexer's token cap cut it. All sources are ORed — a truncated SRVD parse sets it just as a truncated BDEF run does. |
| `suppressedByUnknown` | How often a *"X must be declared"* rule stayed silent because a statement it could not read might have been that X. |
| `unknownConstructs` | [RAP000](#rap000) candidates across all files, before the 50-per-file report cap. |
| `baseUnresolved` | How often a cross-file rule stayed silent because a projection's CDS view names a base entity (`as projection on ZR_A`) that **no BDEF in the call defines**. The checker will not fall back to matching an unrelated base by alias — pass the base BDEF to switch those rules on. |

## What this checker does not prove

ADT activation in the target system remains the only authority. We do not see DDIC tables, behavior-pool
classes, or CDS field types, so rules that need them are not implemented at all rather than guessed:
RAP015/RAP043/RAP055 (behavior-pool methods), RAP027 (draft-table fields), RAP042/RAP044 and RAP040's
`raw(16)` half (ABAP types), RAP004/RAP005/RAP021/RAP033/RAP062/RAP063/RAP075 and RAP031's reachability
half (composition-tree resolution), RAP069–RAP074 (naming conventions), RAP078–RAP080 (BDEF extensions,
whose body grammar is unconfirmed). See `docs/specs/rap-checker-design.md` §3.6.

## Summary

| Rule | Severity | Confidence | Gate | What it checks |
|---|---|---|---|---|
| [RAP-PARSE](#rap-parse) | error | confirmed | always | Punctuation-level breakage: an unbalanced `{}`/`()`/`[]` (in a skipped statement too), a statement that reaches end-of-file without its `;`, a stray closing brace, an unclosed service body or input after it, annotation nesting past 64 levels, or a lexical error. |
| [RAP000](#rap000) | info | confirmed | always | A statement that is punctuation-well-formed but whose leading keyword or shape is outside abap-mcp's BDL/SDL grammar. |
| [RAP-STRICT-MISSING](#rap-strict-missing) | info | confirmed | always | A `managed` or `unmanaged` BDEF that declares no `strict`. |
| [RAP-INPUT](#rap-input) | warning | confirmed | two files in one call share a name | Two files passed in one call under the same filename — the cross-file rules key off names, so the call was ambiguous. |
| [RAP001](#rap001) | error | confirmed | a `.ddls.asddls` in the same call | The BO root — [derived, not assumed from statement order](#how-the-bo-root-is-decided) — must point at a CDS entity declared `define root view entity`. |
| [RAP002](#rap002) | warning | confirmed | a `.ddls.asddls` in the same call | Every `define behavior for <Entity>` should resolve to one of the CDS entities passed in the same call — a *warning*, because absence means "not supplied", not "does not exist". |
| [RAP003](#rap003) | error | confirmed | always | `etag dependent by`, `lock dependent by` and `authorization dependent by` may only name an association the same entity declares in its behavior body. |
| [RAP011](#rap011) | error | confirmed | always | A `managed` or `unmanaged` BDEF needs an implementation class — in the header statement or on an entity. |
| [RAP008](#rap008) | error | confirmed | the base BDEF in the same call | A `projection` that declares `strict` may only sit on a base BDEF that also declares `strict`. Suppressed when the **base**'s header holds a statement the grammar could not read. |
| [RAP009](#rap009) | error | confirmed | the base BDEF in the same call | A projection cannot be built on an `abstract` behavior definition — abstract BDEFs are typing constructs with no runtime. |
| [RAP012](#rap012) | error | confirmed | `strict` declared (or `strict:true` passed) | Under strict mode a field may carry feature control or `readonly`, never both — the two would contend for the same runtime decision. |
| [RAP013](#rap013) | error | confirmed | `strict` declared (or `strict:true` passed) | Under strict mode a non-root entity must not declare a direct, non-internal `create;` — subnodes are created through the parent's association. |
| [RAP018](#rap018) | error | confirmed | `strict` declared (or `strict:true` passed); the base BDEF in the same call | Under strict mode a projection on a draft-enabled base must re-expose the draft actions explicitly: `use action Edit/Activate/Discard/Resume/Prepare`. |
| [RAP019](#rap019) | error | confirmed | `strict` declared (or `strict:true` passed) | Under strict mode a draft-enabled BO must declare its draft actions on the root: `draft action Edit/Activate/Discard/Resume` plus `draft determine action Prepare`. |
| [RAP020](#rap020) | error | confirmed | always | `draft determine action Prepare` must not carry an authorization facet — the framework does not evaluate one for Prepare. |
| [RAP024](#rap024) | error | confirmed | always | Draft is a property of the whole business object: `with draft` / `with collaborative draft` belongs above the first `define behavior for`, never on an entity. |
| [RAP026](#rap026) | error | confirmed | always | A draft-enabled BO must declare a `draft table` on its root entity. |
| [RAP028](#rap028) | error | confirmed | always | Exactly one entity — the root — declares `lock master`; every other entity declares `lock dependent by <_Assoc>`. |
| [RAP029](#rap029) | error | confirmed | `strict` declared (or `strict:true` passed) | Under strict mode exactly one entity — the root — declares `authorization master`. |
| [RAP030](#rap030) | error | confirmed | always | `authorization master ( )` must name a scope: `global`, `instance`, both, or the explicit opt-out `none`. |
| [RAP031](#rap031) | error | confirmed | always | `authorization dependent by <_Assoc>` may only name an association the entity declares. |
| [RAP032](#rap032) | error | confirmed | `strict` declared (or `strict:true` passed) | Under strict mode every entity of a non-abstract BDEF declares either `etag master <Field>` or `etag dependent by <_Assoc>`. |
| [RAP034](#rap034) | error | confirmed | always | `total etag <Field>` is part of the lock clause: it must sit immediately after `lock master`, on the lock-master entity. |
| [RAP035](#rap035) | error | confirmed | always | A draft-enabled BO must declare a `total etag` field on its lock-master (root) entity — the draft framework compares it on activation. |
| [RAP040](#rap040) | error | confirmed | always | `field ( numbering : managed )` is only valid on a `managed` BO; anything else needs early/late numbering with a handler. |
| [RAP046](#rap046) | error | confirmed | always | `persistent table` conflicts with unmanaged persistence — an `unmanaged` BDEF or a `with unmanaged save` clause means RAP does not own the write. |
| [RAP038](#rap038) | error | confirmed | always | `draft action Activate` and `draft action Discard` must not carry feature or authorization facets — the framework does not evaluate them. |
| [RAP048](#rap048) | error | confirmed | always | A factory action returns the new key through the `mapped` response, not through a `result` clause. |
| [RAP056](#rap056) | error | confirmed | always | An element may declare instance feature control or global feature control, never both — they need different handler methods. |
| [RAP057](#rap057) | error | confirmed | always | `( authorization : update )` delegates to the update check and is documented for `delete` only. |
| [RAP081](#rap081) | error | confirmed | always | `draft action` names are a closed set: `Edit`, `Activate`, `Discard`, `Resume`, `AdditionalSave` (2308+) and `Share` (2508+). |
| [RAP037](#rap037) | error | confirmed | always | A determine action may only assign validations and determinations declared `on save`; an `on modify` item cannot be triggered by one. |
| [RAP058](#rap058) | error | confirmed | always | A validation's `update` trigger is only supported combined with `create`; `update` alone is not. |
| [RAP059](#rap059) | error | confirmed | a `.ddls.asddls` in the same call | A validation's or determination's trigger field must be an element of the entity the check is defined for. |
| [RAP067](#rap067) | error | confirmed | always | A `$self` side effect must target an associated entity; a same-entity field dependency is written `field <source> affects field <target>`. |
| [RAP068](#rap068) | error | confirmed | ABAP Cloud 2502+ construct | A side effect triggered by an event requires that event to be declared `for side effects`. |
| [RAP060](#rap060) | error | confirmed | the base BDEF in the same call | A projection may only `use` behavior its base BDEF enables — operations, actions, functions, associations and the ETag. |
| [RAP076](#rap076) | error | confirmed | the base BDEF in the same call | A projection on a draft-enabled base must expose draft handling with `use draft;` (or `use draft as dependent;`, 2508+). |
| [RAP-DUP](#rap-dup) | error | confirmed | always | An entity characteristic declared twice on one entity — `persistent table`, `draft table`, `query`, an ETag clause, a lock clause, an authorization clause, `total etag`, a numbering clause or `changedocuments`. |
| [RAP064](#rap064) | error | confirmed | always | An `interface` behavior definition has no runtime handler and must not declare an implementation class. |
| [RAP025](#rap025) | warning | inferred | always | Draft declared twice in the header, or `with draft;` and `with collaborative draft;` together. |
| [SRVD001](#srvd001) | error | confirmed | always | A service definition must expose at least one entity. |
| [SRVD002](#srvd002) | error | confirmed | always | Every provider contract token must be one of `INA`, `ODATA_V2_UI`, `ODATA_V4_UI`, `ODATA_V2_WEBAPI`, `ODATA_V4_WEBAPI`, `SQL`. |
| [SRVD003](#srvd003) | error | confirmed | always | A UI OData contract and a WEBAPI OData contract cannot be combined in one service definition. |
| [SRVD004](#srvd004) | error | confirmed | always | `expose method` requires provider contract `SQL`. |
| [SRVD005](#srvd005) | warning | inferred | always | Two EXPOSE statements resolving to the same alias. |
| [SRVD006](#srvd006) | warning | confirmed | a `.ddls.asddls` in the same call | An exposed entity in the caller namespace (`Z`/`Y`) that is not among the CDS entities passed in the same call. |
| [SRVD007](#srvd007) | warning | confirmed | always | `@ObjectModel.leadingEntity.name` must name an entity the service actually exposes. |
| [RAP900](#rap900) | warning | confirmed | `abapRelease` passed | A construct whose SAP-documented minimum ABAP Cloud release is newer than the target you passed. |

## How the BO root is decided

Several rules (RAP001, RAP013, RAP019, RAP026, RAP028, RAP029, RAP035, RAP076) turn on *which* entity of a
behavior definition is the BO root. abap-mcp does not decide that from statement order:

1. **The CDS shape, when you pass the `.ddls.asddls` in the same call.** Exactly one `define behavior for`
   whose CDS view is a `define root view entity` is the root. This is the only evidence-based answer.
2. **Otherwise the first `define behavior for` in the file.** SAP's own syntax notation for
   *RAP - EntityBehaviorDefinition* writes a behavior definition as one construct anchored on the root
   (`define behavior for RootEntity … [define behavior for ChildEntity1] [, …]`) and states that the root's
   entity behavior definition is mandatory while the children's are optional; every SAP sample in our corpus
   writes the root first. So this is the documented convention — used as a fallback, never as a claim.

What no SAP source states is that root-first is *enforced*, and no documented ADT check rejects a child-first
file (researched 2026-09-10; the canonical `abenbdl_define_beh.htm` page is reachable only as an archived
snapshot). An unconfirmed requirement may not become an `error` here, so a legal BDEF that declares a child
before the root is read in either order and produces no findings of its own. The third possible signal —
*the entity no other entity's composition targets* — needs composition-tree resolution and is deferred with
the other composition rules (`docs/specs/rap-checker-design.md` §3.6).

## Structural pseudo-rules

### RAP-PARSE

**Punctuation-level syntax breakage**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** Punctuation-level breakage: an unbalanced `{}`/`()`/`[]` — including inside a statement the grammar had to skip, which is what keeps a broken statement out of [RAP000](#rap000)'s info tier — a statement that reaches end-of-file without its `;`, a stray closing brace, a service-definition body that never closes or carries input after its `}`, a CDS annotation nested deeper than 64 levels, or a lexical error (`$` outside `$self`, an unterminated string). It is also what an internal parser failure is reported as — in a BDEF, a SRVD or a CDS source — on the file that caused it, so one hostile file never takes the call down. This is the only tier at which the parser calls a file wrong.
- **Message:** The parser's own message, e.g. ``Expected `;`.``
- **Hint:** Fix the punctuation — a BDL statement ends in `;` and every `{`, `(` and `[` needs its partner.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/rap-bdl-behavior-definition-language>

### RAP000

**Statement outside abap-mcp's BDL grammar**

- **Severity:** `info` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A statement that is punctuation-well-formed but whose leading keyword or shape is outside abap-mcp's BDL/SDL grammar. The statement is skipped, no rule is applied to it, and the count appears as `summary.unknownConstructs`. Capped at 50 findings per file.
- **Message:** abap-mcp's BDL grammar (…) does not recognise this statement ("…"); it was skipped, and no rule was applied to it. This is a limit of the checker, not necessarily an error in your file.
- **Hint:** Nothing to fix unless the statement really is wrong — check it in ADT. Reporting it here is how the checker admits a coverage gap.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/rap-bdl-behavior-definition-language>

### RAP-STRICT-MISSING

**Transactional BDEF does not declare strict**

- **Severity:** `info` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A `managed` or `unmanaged` BDEF that declares no `strict`. Informational only: the ABAP Cloud release contracts expect `strict(2)`, and without the declaration every strict-gated rule below stayed switched off for that file.
- **Message:** This managed behavior definition does not declare "strict"; the ABAP Cloud release contracts expect strict(2), and abap-mcp's strict-mode rules stayed switched off for this file.
- **Hint:** Add "strict ( 2 );" under the implementation-type statement if this BO is meant for ABAP Cloud; the strict rules then run.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP-INPUT

**Two files in one call share a filename**

- **Severity:** `warning` · **Confidence:** `confirmed` · **Gate:** two files in one call carry the same name
- **Checks:** The cross-file rules (projection → base BDEF, BDEF → CDS entity, service → CDS entity) key off filenames. Two files passed under one name used to collapse into a single entry, which silently switched off every cross-file rule for that call — a checker reporting nothing at all. They are now told apart by content (identical text under one name is treated as one file passed twice; different text is kept as two), and this warning says the call was ambiguous.
- **Message:** More than one file in this call is named {names}. They were told apart by content so the cross-file rules still run, but every finding on either file is reported under the same name — and two files with identical text under one name were treated as one file passed twice.
- **Hint:** Give every file its own abapGit-style name (zr_travel.bdef.asbdef, zc_travel.bdef.asbdef) — the cross-file rules key off the filename, so two files under one name cannot both be addressed.
- **Source:** this document — it is a note about the call, not about your RAP.

## Behavior-definition rules

### RAP001

**BO root must be a root view entity**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** a `.ddls.asddls` in the same call
- **Checks:** The BO root — see [How the BO root is decided](#how-the-bo-root-is-decided) — must point at a CDS entity declared `define root view entity`. Needs the `.ddls.asddls` in the same call. Silent when the CDS shape is `unknown`, a projection view or a transactional interface: no evidence, no claim.
- **Message:** The root behavior definition in this file is for {entity}, which is declared as a {shape} — a BO root must be a "define root view entity".
- **Hint:** Point the BO's root "define behavior for" at a root view entity, or add "root" to the CDS view definition.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/defining-elementary-behavior-for-ready-to-run-business-object>

### RAP002

**Referenced CDS entity was not among the supplied sources**

- **Severity:** `warning` · **Confidence:** `confirmed` · **Gate:** a `.ddls.asddls` in the same call
- **Checks:** Every `define behavior for <Entity>` should resolve to one of the CDS entities passed in the same call. Runs only when at least one `.ddls.asddls` was supplied, so a BDEF-only call never fires it.
- **Why a warning, not an error:** the gate is satisfied by *one* `.ddls`, and the evidence is only ever the file set you happened to pass. A base BDEF + its projection + the projection's CDS view — the normal partial set — is legal RAP, and three errors on it would be a false positive. Absence here means "not supplied", not "does not exist"; [SRVD006](#srvd006) is a warning for exactly the same reason.
- **Message:** "define behavior for {entity}" references a CDS entity that was not found among the .ddls sources passed in this call — it may simply not have been passed.
- **Hint:** Pass the entity's .ddls.asddls in the same call, or correct the spelling — BDL matches CDS names exactly (case-insensitively).
- **Source:** <https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md>

### RAP003

**Dependent ETag/lock clause must name a declared association**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `etag dependent by`, `lock dependent by` and `authorization dependent by` may only name an association the same entity declares in its behavior body.
- **Message:** Entity {entity} is "{clause} by {assoc}" but {assoc} is not declared in its behavior body.
- **Hint:** Add "association <_Assoc>;" to the entity body — dependent clauses may only name associations the BDEF declares.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP011

**managed/unmanaged BDEF needs an implementation class**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A `managed` or `unmanaged` BDEF needs an implementation class — in the header statement or on an entity. Suppressed when an unreadable statement could have been that declaration, and never reported for `managed by bopf;`: the BOPF-bridge form takes no implementation class at all.
- **Message:** A {implType} behavior definition needs an implementation class: none is declared in the header or on any entity.
- **Hint:** Add "<managed|unmanaged> implementation in class zbp_<entity> unique;" as the first statement.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP008

**A strict projection needs a strict base**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** the base BDEF in the same call
- **Checks:** A `projection` that declares `strict` may only sit on a base BDEF that also declares `strict`. Needs the base BDEF in the same call. Suppressed (and counted in `summary.suppressedByUnknown`) when the *base*'s header holds a statement our grammar skipped — that statement could be the `strict ( 2 );` this rule is about to call absent. The base is resolved from the projection view's `as projection on` target when the `.ddls` is in the call; if that target names an entity no supplied BDEF defines, the rule stays silent and the call counts it in `summary.baseUnresolved` rather than matching a different base by alias.
- **Message:** This projection declares strict({level}) but its base behavior definition {baseFile} does not declare strict.
- **Hint:** Add "strict ( 2 );" to the base BDEF — a projection may only be strict if its base is.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP009

**A projection cannot be built on an abstract BDEF**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** the base BDEF in the same call
- **Checks:** A projection cannot be built on an `abstract` behavior definition — abstract BDEFs are typing constructs with no runtime. Needs the base BDEF in the same call.
- **Message:** A projection behavior definition cannot be built on an abstract behavior definition ({baseFile}).
- **Hint:** Project onto a managed or unmanaged BDEF; abstract BDEFs are typing constructs only.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP012

**Feature control must not combine with readonly**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** `strict` declared (or `strict:true` passed)
- **Checks:** Under strict mode a field may carry feature control or `readonly`, never both — the two would contend for the same runtime decision.
- **Message:** Field(s) {fields} combine feature control with readonly on {entity} — the two are mutually exclusive under strict mode.
- **Hint:** Drop "readonly" and let the FOR INSTANCE FEATURES handler return the read-only state, or drop the feature control.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP013

**No direct create on a subnode under strict mode**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** `strict` declared (or `strict:true` passed)
- **Checks:** Under strict mode a non-root entity must not declare a direct, non-internal `create;` — subnodes are created through the parent's association.
- **Message:** Non-root entity {entity} declares a direct "create;" — under strict mode subnodes are created by association only.
- **Hint:** Remove "create;" here and add "association _<Child> { create; }" on the parent entity.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP018

**A strict projection on a draft BO must expose the draft actions**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** `strict` declared (or `strict:true` passed); the base BDEF in the same call
- **Checks:** Under strict mode a projection on a draft-enabled base must re-expose the draft actions explicitly: `use action Edit/Activate/Discard/Resume/Prepare`. Needs the base BDEF in the same call.
- **Message:** Strict projection on a draft-enabled BO must expose the draft actions explicitly; missing: {missing}.
- **Hint:** Add "use action Edit; use action Activate; use action Discard; use action Resume; use action Prepare;" to the projection entity body.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP019

**A strict draft BO must declare its draft actions**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** `strict` declared (or `strict:true` passed)
- **Checks:** Under strict mode a draft-enabled BO must declare its draft actions on the root: `draft action Edit/Activate/Discard/Resume` plus `draft determine action Prepare`.
- **Message:** Strict draft-enabled BO must declare its draft actions explicitly; missing on {entity}: {missing}.
- **Hint:** Add "draft action Edit; draft action Activate optimized; draft action Discard; draft action Resume; draft determine action Prepare;".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP020

**draft determine action Prepare takes no authorization control**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `draft determine action Prepare` must not carry an authorization facet — the framework does not evaluate one for Prepare.
- **Message:** "draft determine action Prepare" must not carry an authorization addition.
- **Hint:** Remove the "( authorization : … )" facet — Prepare is not authorization-controlled.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP024

**with draft belongs in the header, not on an entity**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** Draft is a property of the whole business object: `with draft` / `with collaborative draft` belongs above the first `define behavior for`, never on an entity.
- **Message:** "with draft" is declared on entity {entity}; draft is a property of the whole BO and belongs in the BDEF header.
- **Hint:** Move "with draft;" above the first "define behavior for".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/draft-business-object?version=sap_btp>

### RAP026

**A draft-enabled BO needs a draft table on its root**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A draft-enabled BO must declare a `draft table` on its root entity. Suppressed when an unreadable statement could have been that declaration.
- **Message:** The BO is draft-enabled but its root entity {entity} declares no "draft table".
- **Hint:** Add "draft table z<table>_d" to the root's characteristics (ADT's quick-fix on the BDEF generates the table).
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/draft-database-table?version=sap_btp>

### RAP028

**Exactly one lock master, on the root**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** Exactly one entity — the root — declares `lock master`; every other entity declares `lock dependent by <_Assoc>`.
- **Message:** Exactly one entity — the root — must declare "lock master"; found {n} ({entities}).
- **Hint:** Declare "lock master" on the root and "lock dependent by _ParentAssoc" on every child.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP029

**Exactly one authorization master, on the root**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** `strict` declared (or `strict:true` passed)
- **Checks:** Under strict mode exactly one entity — the root — declares `authorization master`.
- **Message:** Exactly one entity — the root — must declare "authorization master"; found {n}.
- **Hint:** Declare "authorization master ( global )" (or "( instance )") on the root and "authorization dependent by _ParentAssoc" on children.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP030

**authorization master must name a scope**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `authorization master ( )` must name a scope: `global`, `instance`, both, or the explicit opt-out `none`.
- **Message:** "authorization master ( )" on {entity} names no scope.
- **Hint:** Write "authorization master ( global )", "( instance )", "( global, instance )" or the explicit opt-out "( none )".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/authorization-definition?version=sap_btp>

### RAP031

**authorization dependent must name a declared association**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `authorization dependent by <_Assoc>` may only name an association the entity declares. (The "must reach the master" half needs CDS composition data and is deliberately not implemented — see the scope section.)
- **Message:** "authorization dependent by {assoc}" on {entity} names an association that is not declared in this entity's behavior body.
- **Hint:** Declare "association <_Assoc>;" in the entity, pointing at the authorization master.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/authorization-definition?version=sap_btp>

### RAP032

**Every entity needs an ETag master or dependent clause**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** `strict` declared (or `strict:true` passed)
- **Checks:** Under strict mode every entity of a non-abstract BDEF declares either `etag master <Field>` or `etag dependent by <_Assoc>`.
- **Message:** Entity {entity} declares neither "etag master <Field>" nor "etag dependent by <_Assoc>".
- **Hint:** Add "etag master LocalLastChangedAt" on the root and "etag dependent by _Parent" on children.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/strict-mode-implementation-requirements?version=sap_btp>

### RAP034

**total etag must follow lock master on the lock-master entity**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `total etag <Field>` is part of the lock clause: it must sit immediately after `lock master`, on the lock-master entity.
- **Message:** "total etag {field}" on {entity} must come immediately after "lock master", on the lock-master entity only.
- **Hint:** Write the two as one clause: "lock master total etag <Field>".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/total-etag?version=sap_btp>

### RAP035

**A draft-enabled BO needs a total etag on its lock master**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A draft-enabled BO must declare a `total etag` field on its lock-master (root) entity — the draft framework compares it on activation.
- **Message:** A draft-enabled BO must declare a "total etag" field on its lock-master (root) entity.
- **Hint:** Change the root's lock clause to "lock master total etag LastChangedAt".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/total-etag?version=sap_btp>

### RAP040

**numbering : managed needs a managed BO**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `field ( numbering : managed )` is only valid on a `managed` BO; anything else needs early/late numbering with a handler. (The `raw(16)` type half of the catalog rule needs CDS field types and is not implemented.)
- **Message:** "field ( numbering : managed )" is only valid on a managed BO; this BDEF is {implType}.
- **Hint:** Use early or late numbering with a FOR NUMBERING handler, or make the BO managed.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/internal-early-numbering?version=sap_btp>

### RAP046

**persistent table conflicts with unmanaged save**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `persistent table` conflicts with unmanaged persistence — an `unmanaged` BDEF or a `with unmanaged save` clause means RAP does not own the write.
- **Message:** "persistent table {table}" on {entity} conflicts with {reason} — RAP does not own persistence there.
- **Hint:** Remove "persistent table", or drop "with unmanaged save" / switch the BO to managed.
- **Source:** <https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md>

### RAP038

**draft action Activate/Discard take no facet**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `draft action Activate` and `draft action Discard` must not carry feature or authorization facets — the framework does not evaluate them.
- **Message:** "draft action {name}" must not carry feature or authorization control.
- **Hint:** Remove the "( … )" facet — the framework does not evaluate it for Activate/Discard.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/draft-actions?version=sap_btp>

### RAP048

**A factory action has no result clause**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A factory action returns the new key through the `mapped` response, not through a `result` clause.
- **Message:** Factory action {name} declares a result clause; factory actions return the new key through the "mapped" response, not a result.
- **Hint:** Delete the "result …" clause; keep the cardinality, e.g. "factory action <Name> [1];".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/action-definition?version=sap_btp>

### RAP056

**features : instance and features : global are exclusive**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** An element may declare instance feature control or global feature control, never both — they need different handler methods.
- **Message:** {element} combines "features : instance" and "features : global" — pick one.
- **Hint:** Instance feature control needs FOR INSTANCE FEATURES; global needs FOR GLOBAL FEATURES. Declare one.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/feature-control?version=sap_btp>

### RAP057

**authorization : update is documented for delete only**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `( authorization : update )` delegates to the update check and is documented for `delete` only.
- **Message:** "( authorization : update )" delegates to the update check and is documented only for "delete"; it is declared on "{verb}".
- **Hint:** Remove the addition, or move it to "delete".
- **Source:** <https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md>

### RAP081

**draft action names are a closed set**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `draft action` names are a closed set: `Edit`, `Activate`, `Discard`, `Resume`, `AdditionalSave` (2308+) and `Share` (2508+). Anything else is your own action and needs `action <Name>;`.
- **Message:** "draft action {name}" is not a RAP draft action; legal names are Edit, Activate, Discard, Resume, AdditionalSave and Share.
- **Hint:** Rename it, or declare it as a plain "action <Name>;" if it is your own action.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/draft-actions?version=sap_btp>

### RAP037

**A determine action may only assign on-save items**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A determine action may only assign validations and determinations declared `on save`; an `on modify` item cannot be triggered by one.
- **Message:** "{daName}" assigns {itemName}, which is declared "on modify"; determine actions may only assign "on save" items.
- **Hint:** Change the item to "on save", or drop it from the determine action.
- **Source:** <https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md>

### RAP058

**An update trigger only works combined with create**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A validation's `update` trigger is only supported combined with `create`; `update` alone is not.
- **Message:** Validation {name} triggers on "update" alone; the update trigger is only supported combined with "create".
- **Hint:** Write "validation <Name> on save { create; update; … }".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/validation-definition?version=sap_btp>

### RAP059

**A trigger field must belong to the entity**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** a `.ddls.asddls` in the same call
- **Checks:** A validation's or determination's trigger field must be an element of the entity the check is defined for. Needs the entity's `.ddls.asddls` in the same call.
- **Message:** Validation {name} on {entity} triggers on field {field}, which is not an element of {entity}.
- **Hint:** Use an element of the entity the check is defined for; a trigger field must belong to it.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/validation-definition?version=sap_btp>

### RAP067

**$self side effects must target an associated entity**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A `$self` side effect must target an associated entity; a same-entity field dependency is written `field <source> affects field <target>`.
- **Message:** "$self affects field {field}" targets a field of the same entity; $self side effects must target an associated entity.
- **Hint:** Write "field <source> affects field <target>;" for same-entity dependencies, or target "entity _Assoc".
- **Source:** <https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md>

### RAP068

**A side-effect event must be declared for side effects**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** ABAP Cloud 2502+ construct
- **Checks:** A side effect triggered by an event requires that event to be declared `for side effects`.
- **Message:** Side effect triggered by event {name}, but {name} is not declared "for side effects".
- **Hint:** Change the declaration to "event <Name> for side effects;".
- **Source:** <https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md>

### RAP060

**A projection may only use behavior the base enables**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** the base BDEF in the same call
- **Checks:** A projection may only `use` behavior its base BDEF enables — operations, actions, functions, associations and the ETag. Needs the base BDEF in the same call; clauses whose base-side counterpart cannot be resolved by name alone (`use side effects`, `use mapping`, `use event`) are deliberately not checked.
- **Message:** "use {what} {name}" is not enabled in the base behavior definition {baseFile} for {entity}.
- **Hint:** Declare it in the base BDEF first — a projection can only re-expose behavior the base enables.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/providing-behavior-for-projections?version=sap_btp>

### RAP076

**A projection on a draft BO must expose draft handling**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** the base BDEF in the same call
- **Checks:** A projection on a draft-enabled base must expose draft handling with `use draft;` (or `use draft as dependent;`, 2508+). Needs the base BDEF in the same call.
- **Message:** The base BO is draft-enabled but this projection does not expose draft handling.
- **Hint:** Add "use draft;" (or "use draft as dependent;" for a non-root entity in a cross-BO draft scope).
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/rap-bdl-feature-tables>

### RAP064

**An interface BDEF declares no implementation class**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** An `interface` behavior definition has no runtime handler and must not declare an implementation class.
- **Message:** An interface behavior definition must not declare an implementation class — it has no runtime handler.
- **Hint:** Remove the "implementation in class …" clause; behavior is inherited from the base BO.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/rap-interface-behavior-definition>

### RAP-DUP

**An entity characteristic is declared twice on one entity**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A BDL entity declares each characteristic once: `persistent table`, `draft table`, `query`, one ETag clause (`etag master` / `etag dependent by`), one lock clause, one authorization clause, `total etag`, one numbering clause, `changedocuments`. A repeat is reported on the second (and any further) occurrence, naming the line of the first. `with additional save` / `with unmanaged save`, `extensible` and `use etag` are excluded — they carry options rather than setting one property — and an entity-level `with draft` is [RAP024](#rap024)'s finding, not this one.
- **Why it matters:** the parser keeps the **first** of a repeated pair, so before this rule a second `authorization master ( global )` — or a second `persistent table` naming a *different* table — was read, dropped and never mentioned: every rule below then judged a file that is not the one you wrote.
- **Message:** Entity {entity} declares {clause} more than once (first at line {n}); a BDL entity may declare it only once. Only the first declaration was used by the rules below.
- **Hint:** Delete the duplicate line — a BDL entity declares each characteristic once; the checker reads the first one and ignores the rest.
- **Source:** <https://github.com/SAP-samples/abap-cheat-sheets/blob/main/36_RAP_Behavior_Definition_Language.md> (Table Specifications / ETag / Locking / Authorization each document one clause per entity; the entity-characteristic production in our grammar notes lists each as a single property, and no file in the 79-BDEF corpus repeats one)

## Advisory rules (non-`confirmed` provenance)

### RAP025

**Draft is declared more than once in the header**

- **Severity:** `warning` · **Confidence:** `inferred` · **Gate:** always
- **Checks:** Draft declared twice in the header, or `with draft;` and `with collaborative draft;` together. Inferred from SAP's draft documentation rather than stated there, so it is capped at `warning` and its message carries the provenance clause.
- **Message:** The behavior definition declares draft more than once in its header. [inferred from SAP documentation, not stated directly — treat as advisory]
- **Hint:** Keep exactly one draft declaration in the header — either "with draft;" or "with collaborative draft;".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-rap/draft-business-object?version=sap_btp>

## Service-definition rules

### SRVD001

**A service must expose something**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A service definition must expose at least one entity. Suppressed (and counted in `summary.suppressedByUnknown`) when the file holds a statement our SDL grammar skipped or a parser error — "exposes nothing" must never be a claim about text the checker failed to read. [SRVD007](#srvd007) suppresses on the same evidence.
- **Message:** Service definition {name} exposes nothing; at least one EXPOSE is required.
- **Hint:** Add "expose ZC_<Entity> as <Alias>;".
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-define-service>

### SRVD002

**Provider contract tokens are a closed set**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** Every provider contract token must be one of `INA`, `ODATA_V2_UI`, `ODATA_V4_UI`, `ODATA_V2_WEBAPI`, `ODATA_V4_WEBAPI`, `SQL`.
- **Message:** "{token}" is not a CDS provider contract.
- **Hint:** Use one of INA, ODATA_V2_UI, ODATA_V4_UI, ODATA_V2_WEBAPI, ODATA_V4_WEBAPI, SQL. (Note: the token is ODATA_V4_WEBAPI, not odata_v4_web_api.)
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-provider-contracts>

### SRVD003

**UI and WEBAPI contracts cannot be combined**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** A UI OData contract and a WEBAPI OData contract cannot be combined in one service definition.
- **Message:** OData provider contracts of type UI and WEBAPI cannot be combined.
- **Hint:** Publish two service definitions, one per contract type.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-provider-contracts>

### SRVD004

**expose method requires the SQL contract**

- **Severity:** `error` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `expose method` requires provider contract `SQL`.
- **Message:** "expose method" requires provider contract SQL.
- **Hint:** Add "provider contracts sql", and declare the AMDP procedure FOR SQL SERVICE.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-define-service>

### SRVD005

**Aliases must be unique**

- **Severity:** `warning` · **Confidence:** `inferred` · **Gate:** always
- **Checks:** Two EXPOSE statements resolving to the same alias. Inferred, hence a warning with the provenance clause.
- **Message:** Alias {alias} is exposed twice in {name}.
- **Hint:** Give each exposed entity a distinct alias.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-define-service>

### SRVD006

**An exposed caller-namespace entity should be supplied**

- **Severity:** `warning` · **Confidence:** `confirmed` · **Gate:** a `.ddls.asddls` in the same call
- **Checks:** An exposed entity in the caller namespace (`Z`/`Y`) that is not among the CDS entities passed in the same call. **Deliberately a warning:** absence means "not supplied", not "does not exist", and SAP-standard views the caller will never pass are skipped entirely.
- **Message:** Exposed entity {entity} was not found among the .ddls sources passed in this call.
- **Hint:** Pass its .ddls.asddls, or check the name.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-define-service>

### SRVD007

**The leading entity must be exposed**

- **Severity:** `warning` · **Confidence:** `confirmed` · **Gate:** always
- **Checks:** `@ObjectModel.leadingEntity.name` must name an entity the service actually exposes.
- **Message:** The leading entity {entity} is not exposed by this service.
- **Hint:** Expose it, or point the annotation at an exposed entity.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-define-service>

## Release gate

### RAP900

**A construct newer than the target release**

- **Severity:** `warning` (never `error` — the table is dated and the target system is authoritative) · **Confidence:** `confirmed` · **Gate:** `abapRelease` passed
- **Checks:** Table-driven. A visitor over the parsed BDEF emits construct keys (`with-collaborative-draft`, `draft-action-share`, `event-for-side-effects`, …); each is looked up in `src/data/rap/bdl-release-gates.json` — abap-mcp's own transcription of the ABAP-Cloud columns of SAP's RAP BDL feature tables — and reported when its `minRelease` is newer than the release you passed.
- **Message:** "{label}" requires ABAP Cloud {minRelease} or higher; the target release you passed is {abapRelease}.
- **Hint:** Remove the construct, or raise `--release`. Bundled release data curated 2026-09-10; the target system's release notes are authoritative.
- **Source:** <https://help.sap.com/docs/abap-cloud/abap-keyword/rap-bdl-feature-tables>

Rows carrying a `knowledgeId` cross-link to the bundled release-delta cards, so `explain_abap_release`
can tell you what the release actually added.
