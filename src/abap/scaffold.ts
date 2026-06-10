/**
 * RAP managed-BO scaffolder.
 *
 * Generates the canonical ABAP-Cloud stack for one root entity — the same
 * shape as SAP's /DMO reference apps and the ADT wizards:
 *
 *   root view entity (ZR_)  →  behavior definition (managed, strict(2))
 *   projection view  (ZC_)  →  projection behavior definition
 *   behavior implementation class (ZBP_) + handler locals
 *   metadata extension (UI annotations)  +  service definition (ZUI_…_V4)
 *
 * Everything the generator emits that abaplint can parse is round-tripped
 * through abaplint at version Cloud before it is returned: the generator and
 * the linter share one parser, so the scaffold can never drift into syntax
 * the lint would reject. BDEF/SRVD artifacts are outside abaplint's checked
 * surface (verified empirically) — those are covered by golden tests and
 * marked validated:"template".
 */
import type { Finding } from "./engine.js";
import { runAbaplint } from "./engine.js";

export interface ScaffoldField {
  /** snake_case table field name, e.g. "agency_id". */
  name: string;
  /** Suggested DDL type for the table source, e.g. "abap.char(6)". */
  type?: string | undefined;
}

export interface ScaffoldOptions {
  /** Entity in UpperCamelCase, e.g. "Travel". Drives all artifact names. */
  entityName: string;
  /** Persistent SQL table, e.g. "ztravel". */
  sqlTable: string;
  /** snake_case key field name, e.g. "travel_id". */
  keyField: string;
  /** True (default): UUID key, managed numbering. False: caller supplies the key on create. */
  managedUuidKey: boolean;
  fields: ScaffoldField[];
  draft: boolean;
  /** Dev namespace prefix, "Z" or "Y". */
  prefix: "Z" | "Y";
}

export interface ScaffoldFile {
  filename: string;
  content: string;
  /** "abaplint" = machine-validated through the parser; "template" = golden-tested template. */
  validated: "abaplint" | "template";
}

export interface ScaffoldResult {
  files: ScaffoldFile[];
  activationOrder: string[];
  nextSteps: string[];
  suggestedTableDdl: string;
  /** Non-empty only if the generated sources failed abaplint — should never happen. */
  validationIssues: Finding[];
}

const ADMIN_FIELDS: { name: string; cds: string; semantics: string; ddlType: string }[] = [
  { name: "created_by", cds: "CreatedBy", semantics: "@Semantics.user.createdBy: true", ddlType: "abp_creation_user" },
  { name: "created_at", cds: "CreatedAt", semantics: "@Semantics.systemDateTime.createdAt: true", ddlType: "abp_creation_tstmpl" },
  { name: "last_changed_by", cds: "LastChangedBy", semantics: "@Semantics.user.lastChangedBy: true", ddlType: "abp_lastchange_user" },
  { name: "last_changed_at", cds: "LastChangedAt", semantics: "@Semantics.systemDateTime.lastChangedAt: true", ddlType: "abp_lastchange_tstmpl" },
  { name: "local_last_changed_at", cds: "LocalLastChangedAt", semantics: "@Semantics.systemDateTime.localInstanceLastChangedAt: true", ddlType: "abp_locinst_lastchange_tstmpl" },
];

export function snakeToCamel(snake: string): string {
  return snake
    .toLowerCase()
    .split("_")
    .filter((p) => p.length > 0)
    .map((p) => (p[0] ?? "").toUpperCase() + p.slice(1))
    .join("");
}

function validateInput(opts: ScaffoldOptions): void {
  if (!/^[A-Za-z][A-Za-z0-9]{0,25}$/.test(opts.entityName))
    throw new Error(`entityName "${opts.entityName}" must be alphanumeric UpperCamelCase, ≤26 chars.`);
  if (!/^[a-z][a-z0-9_]{0,15}$/.test(opts.sqlTable.toLowerCase()))
    throw new Error(`sqlTable "${opts.sqlTable}" must be a valid table name (≤16 chars).`);
  if (!new RegExp(`^${opts.prefix.toLowerCase()}`).test(opts.sqlTable.toLowerCase()))
    throw new Error(`sqlTable "${opts.sqlTable}" must start with the ${opts.prefix} namespace prefix.`);
  const fieldRe = /^[a-z][a-z0-9_]{0,29}$/;
  if (!fieldRe.test(opts.keyField.toLowerCase()))
    throw new Error(`keyField "${opts.keyField}" is not a valid field name.`);
  const seen = new Set<string>([opts.keyField.toLowerCase()]);
  const reserved = new Set(ADMIN_FIELDS.map((a) => a.name));
  if (reserved.has(opts.keyField.toLowerCase()))
    throw new Error(`keyField "${opts.keyField}" collides with a generated admin field.`);
  for (const f of opts.fields) {
    const n = f.name.toLowerCase();
    if (!fieldRe.test(n)) throw new Error(`Field "${f.name}" is not a valid field name.`);
    if (seen.has(n)) throw new Error(`Duplicate field "${f.name}".`);
    if (reserved.has(n))
      throw new Error(
        `Field "${f.name}" collides with a generated admin field (${[...reserved].join(", ")} are added automatically).`,
      );
    seen.add(n);
  }
}

export function scaffoldRapBo(opts: ScaffoldOptions): ScaffoldResult {
  validateInput(opts);
  const p = opts.prefix.toUpperCase();
  const entity = opts.entityName.charAt(0).toUpperCase() + opts.entityName.slice(1);
  const table = opts.sqlTable.toLowerCase();
  const draftTable = `${table}_d`;
  const rootView = `${p}R_${entity}`;
  const projView = `${p}C_${entity}`;
  const behaviorClass = `${p}BP_${entity}`.toLowerCase();
  const serviceDef = `${p}UI_${entity.toUpperCase()}_V4`;
  const alias = entity;

  const keyCds = snakeToCamel(opts.keyField);
  const userFields = opts.fields.map((f) => ({
    name: f.name.toLowerCase(),
    cds: snakeToCamel(f.name),
    ddlType: f.type ?? "abap.char(30)",
  }));

  // ---- root view entity --------------------------------------------------
  const rootFieldLines: string[] = [];
  rootFieldLines.push(`  key ${opts.keyField.toLowerCase()} as ${keyCds},`);
  for (const f of userFields) rootFieldLines.push(`      ${f.name} as ${f.cds},`);
  for (const a of ADMIN_FIELDS) {
    rootFieldLines.push(`      ${a.semantics}`);
    rootFieldLines.push(`      ${a.name} as ${a.cds},`);
  }
  const last = rootFieldLines.pop();
  if (last !== undefined) rootFieldLines.push(last.replace(/,$/, ""));

  const rootDdls = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${entity} - root view'
define root view entity ${rootView}
  as select from ${table}
{
${rootFieldLines.join("\n")}
}
`;

  // ---- root behavior definition -----------------------------------------
  const allCds = [keyCds, ...userFields.map((f) => f.cds), ...ADMIN_FIELDS.map((a) => a.cds)];
  const mappingLines = [
    `    ${keyCds} = ${opts.keyField.toLowerCase()};`,
    ...userFields.map((f) => `    ${f.cds} = ${f.name};`),
    ...ADMIN_FIELDS.map((a) => `    ${a.cds} = ${a.name};`),
  ];
  const keyFieldLine = opts.managedUuidKey
    ? `  field ( numbering : managed, readonly ) ${keyCds};`
    : `  field ( readonly : update ) ${keyCds};`;
  const readonlyAdmins = `  field ( readonly ) ${ADMIN_FIELDS.map((a) => a.cds).join(", ")};`;

  const rootBdef = `managed implementation in class ${behaviorClass} unique;
strict ( 2 );${opts.draft ? "\nwith draft;" : ""}

define behavior for ${rootView} alias ${alias}
persistent table ${table}${opts.draft ? `\ndraft table ${draftTable}` : ""}
etag master LocalLastChangedAt
lock master${opts.draft ? " total etag LastChangedAt" : ""}
authorization master ( instance )
{
  create;
  update;
  delete;

${keyFieldLine}
${readonlyAdmins}
${
  opts.draft
    ? `
  draft action Edit;
  draft action Resume;
  draft action Activate optimized;
  draft action Discard;
  draft determine action Prepare;
`
    : ""
}
  mapping for ${table}
  {
${mappingLines.join("\n")}
  }
}
`;

  // ---- behavior implementation class ------------------------------------
  const clasMain = `CLASS ${behaviorClass} DEFINITION PUBLIC ABSTRACT FINAL FOR BEHAVIOR OF ${rootView.toLowerCase()}.
ENDCLASS.

CLASS ${behaviorClass} IMPLEMENTATION.
ENDCLASS.
`;
  const clasLocals = `CLASS lhc_${entity.toLowerCase()} DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.
    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR ${alias} RESULT result.
ENDCLASS.

CLASS lhc_${entity.toLowerCase()} IMPLEMENTATION.

  METHOD get_instance_authorizations.
    " Grant everything until real authorization objects exist.
  ENDMETHOD.

ENDCLASS.
`;

  // ---- projection --------------------------------------------------------
  const projFieldLines = [
    `  key ${keyCds},`,
    ...userFields.map((f) => `      ${f.cds},`),
    ...ADMIN_FIELDS.map((a) => `      ${a.cds},`),
  ];
  const lastProj = projFieldLines.pop();
  if (lastProj !== undefined) projFieldLines.push(lastProj.replace(/,$/, ""));

  const projDdls = `@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: '${entity} - projection'
@Metadata.allowExtensions: true
define root view entity ${projView}
  provider contract transactional_query
  as projection on ${rootView}
{
${projFieldLines.join("\n")}
}
`;

  const projBdef = `projection;
strict ( 2 );${opts.draft ? "\nuse draft;" : ""}

define behavior for ${projView} alias ${alias}
{
  use create;
  use update;
  use delete;
}
`;

  // ---- metadata extension -------------------------------------------------
  const uiFields = [keyCds, ...userFields.map((f) => f.cds)];
  const ddlxFieldBlocks = uiFields
    .map(
      (f, i) =>
        `  @UI: { lineItem: [ { position: ${(i + 1) * 10} } ], identification: [ { position: ${(i + 1) * 10} } ] }\n  ${f};`,
    )
    .join("\n");
  const ddlx = `@Metadata.layer: #CORE
annotate view ${projView} with
{
  @UI.facet: [ {
    id: 'id${entity}',
    type: #IDENTIFICATION_REFERENCE,
    label: '${entity}',
    position: 10
  } ]
${ddlxFieldBlocks}
}
`;

  // ---- service definition -------------------------------------------------
  const srvd = `@EndUserText.label: 'Service definition for ${entity}'
define service ${serviceDef} {
  expose ${projView} as ${alias};
}
`;

  // ---- suggested table DDL (guidance, dev adjusts types) -------------------
  const keyDdlType = opts.managedUuidKey ? "sysuuid_x16" : "abap.char(20)";
  const tableLines = [
    `define table ${table} {`,
    `  key client            : abap.clnt not null;`,
    `  key ${opts.keyField.toLowerCase().padEnd(17)} : ${keyDdlType} not null;`,
    ...userFields.map((f) => `  ${f.name.padEnd(21)} : ${f.ddlType};`),
    ...ADMIN_FIELDS.map((a) => `  ${a.name.padEnd(21)} : ${a.ddlType};`),
    `}`,
  ];
  const suggestedTableDdl = tableLines.join("\n");

  const files: ScaffoldFile[] = [
    { filename: `${rootView.toLowerCase()}.ddls.asddls`, content: rootDdls, validated: "abaplint" },
    { filename: `${rootView.toLowerCase()}.bdef.asbdef`, content: rootBdef, validated: "template" },
    { filename: `${behaviorClass}.clas.abap`, content: clasMain, validated: "abaplint" },
    { filename: `${behaviorClass}.clas.locals_imp.abap`, content: clasLocals, validated: "abaplint" },
    { filename: `${projView.toLowerCase()}.ddls.asddls`, content: projDdls, validated: "abaplint" },
    { filename: `${projView.toLowerCase()}.bdef.asbdef`, content: projBdef, validated: "template" },
    { filename: `${projView.toLowerCase()}.ddlx.asddlx`, content: ddlx, validated: "template" },
    { filename: `${serviceDef.toLowerCase()}.srvd.srvdsrv`, content: srvd, validated: "template" },
  ];

  // Round-trip the machine-checkable artifacts through abaplint at Cloud.
  const checkable = files.filter((f) => f.validated === "abaplint");
  const { findings } = runAbaplint(
    checkable.map((f) => ({ filename: f.filename, source: f.content })),
    { version: "Cloud", preset: "syntax-only" },
  );

  const activationOrder = [
    `Table ${table} (see suggestedTableDdl; adjust field types)`,
    ...(opts.draft ? [`Draft table ${draftTable} (ADT quick-fix on the behavior definition generates it)`] : []),
    `${rootView} (root view entity)`,
    `${rootView} behavior definition`,
    `${behaviorClass.toUpperCase()} (behavior implementation)`,
    `${projView} (projection view)`,
    `${projView} behavior definition`,
    `${projView} metadata extension`,
    `${serviceDef} (service definition)`,
    `Service binding (create in ADT: OData V4 - UI, then Publish)`,
  ];

  const nextSteps = [
    "Create the persistent table first — the CDS view selects from it (suggestedTableDdl is a starting point; adjust types and lengths).",
    opts.draft
      ? "After activating the behavior definition, use the ADT quick-fix to generate the draft table, or create it as a copy of the table with draft admin include."
      : "Draft is disabled; re-run with draft:true if you want Fiori draft handling.",
    opts.managedUuidKey
      ? "The key uses managed UUID numbering — no number ranges needed; the framework fills it on create."
      : "The key is caller-provided on create (readonly:update). Add a validation if you need format checks.",
    "The service binding cannot be generated as source — create it in ADT (New > Service Binding, OData V4 - UI) on the service definition, then Publish.",
    "Generated classes and CDS views were machine-validated through abaplint at ABAP-Cloud level; behavior/service definitions are canonical templates — ADT activation is the final arbiter.",
  ];

  return { files, activationOrder, nextSteps, suggestedTableDdl, validationIssues: findings };
}
