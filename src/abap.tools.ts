/**
 * The abap-mcp tool registry.
 *
 * Descriptions follow the mcp-kit rubric: verb-first snake_case name, what
 * the tool operates on, an explicit "Use this when …", explicit non-goals,
 * every parameter described, at least one worked example. The model's only
 * documentation is this file — treat it as the public API surface.
 */
import { z } from "zod";

import { compareAbap } from "./abap/compare.js";
import { ABAP_VERSIONS, FOCUS_TAGS, runAbaplint } from "./abap/engine.js";
import { formatAbap } from "./abap/formatter.js";
import { outlineAbap, outlineToMermaid } from "./abap/outline.js";
import { planCloudMigration } from "./abap/plan.js";
import { checkCloudReadiness } from "./abap/readiness.js";
import {
  lookupReleased,
  RELEASED_API_SNAPSHOT,
  suggestSuccessor,
} from "./abap/released.js";
import { explainRule, listRules } from "./abap/rules.js";
import { scaffoldRapBo } from "./abap/scaffold.js";
import { invalidInput } from "./errors.js";
import type { AnyToolSpec } from "./tool.js";
import { defineTool } from "./tool.js";

const VERSION_ENUM = z.enum(ABAP_VERSIONS);

const filesField = z
  .array(
    z.object({
      filename: z
        .string()
        .optional()
        .describe(
          'abapGit-style name, e.g. "zcl_invoice.clas.abap", "ztrip.prog.abap", "zr_trip.ddls.asddls". Omit it and the type is inferred from the source (CLASS → class, REPORT → program, define view → CDS).',
        ),
      source: z.string().describe("The complete ABAP / CDS / behavior-definition source text."),
    }),
  )
  .min(1)
  .max(32)
  .describe("Source files to analyze, up to 32 per call, 100k chars each.");

const sevenSampleAbap =
  'lint_abap({ "files": [ { "source": "REPORT ztest.\\nDATA foo TYPE i.\\nIF foo = 1.\\nENDIF." } ] })';

const focusField = z
  .enum(FOCUS_TAGS)
  .optional()
  .describe(
    'Curated rule-pack lens: report only rules carrying this abaplint tag — "Performance" for a tuning pass, ' +
      '"Security" for a security sweep, "Styleguide" for Clean ABAP adherence. Parser errors always surface. ' +
      'Ignored with preset "syntax-only". Combine with rules to re-tune individual rules in the pack.',
  );

const findingShape = z.object({
  rule: z.string().describe("abaplint rule key."),
  message: z.string().describe("Human-readable finding."),
  severity: z.string().describe("Error, Warning or Info."),
  file: z.string().describe("Filename the finding is in."),
  line: z.number().describe("1-based line."),
  column: z.number().describe("1-based column."),
  excerpt: z.string().describe("The offending line, trimmed."),
  docsUrl: z.string().describe("Rule documentation at rules.abaplint.org."),
});

export const lintAbap = defineTool({
  name: "lint_abap",
  title: "Lint ABAP source",
  description:
    "Run abaplint static analysis over ABAP, CDS or behavior-definition sources and return structured findings " +
    "(rule key, message, severity, file/line/column, the offending line, and a docs URL per finding). " +
    "Use this when you have written or modified ABAP code and want style and correctness feedback before it goes " +
    "anywhere near a system — it runs entirely offline on the provided text. " +
    "It does not connect to any SAP system, does not run ATC, and cannot judge whether referenced objects exist " +
    "unless you provide them in the same call (preset \"style\", the default, skips whole-program checks for that reason; " +
    "preset \"full\" enables them when you provide every dependency). A focus tag turns a pass into a themed review " +
    "(performance / security / Clean ABAP style) without hand-picking rules; rule overrides layer a team's own pack " +
    "on top. For an ABAP-Cloud migration verdict use check_cloud_readiness instead. " +
    `Example: ${sevenSampleAbap}.`,
  inputSchema: {
    files: filesField,
    abapVersion: VERSION_ENUM.default("v758").describe(
      'ABAP language version to parse against. "v758" (default) is current on-prem; "Cloud" is ABAP Cloud / Steampunk.',
    ),
    preset: z
      .enum(["style", "full", "syntax-only"])
      .default("style")
      .describe(
        '"style" (default): abaplint default rules minus whole-program semantic checks — right for isolated snippets. "full": every default rule, expects all referenced objects provided. "syntax-only": parser errors only.',
      ),
    rules: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'abaplint rule overrides merged onto the preset (and onto a focus filter), e.g. { "line_length": { "length": 120 }, "7bit_ascii": false } — encode an org\'s best-practice pack here.',
      ),
    focus: focusField,
  },
  outputSchema: {
    findings: z.array(findingShape),
    truncated: z.boolean().describe("True if more than 500 findings existed and the list was cut."),
    fileCount: z.number().describe("Number of files analyzed."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Lint a small report with the default style preset.",
      arguments: {
        files: [{ source: "REPORT ztest.\nDATA foo TYPE i.\nIF foo = 1.\nENDIF." }],
      },
    },
    {
      description: "Lint a class against ABAP Cloud with a relaxed line length.",
      arguments: {
        files: [{ filename: "zcl_demo.clas.abap", source: "CLASS zcl_demo DEFINITION PUBLIC.\nENDCLASS.\nCLASS zcl_demo IMPLEMENTATION.\nENDCLASS." }],
        abapVersion: "Cloud",
        rules: { line_length: { length: 120 } },
      },
    },
    {
      description: "Performance-focused pass over a report.",
      arguments: {
        files: [{ source: "REPORT zperf.\nSELECT * FROM mara INTO TABLE @DATA(lt_mara)." }],
        focus: "Performance",
      },
    },
  ],
  handler: (args) => {
    const result = runAbaplint(args.files, {
      version: args.abapVersion,
      preset: args.preset,
      rules: args.rules,
      focus: args.focus,
    });
    const text =
      result.findings.length === 0
        ? `No findings in ${result.fileCount} file(s).`
        : result.findings
            .map((f) => `${f.file}:${f.line} [${f.severity}] ${f.rule}: ${f.message}`)
            .join("\n");
    return {
      content: [{ type: "text", text }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
});

export const checkCloudReadinessTool = defineTool({
  name: "check_cloud_readiness",
  title: "Check ABAP Cloud readiness",
  description:
    "Assess how far ABAP source is from ABAP Cloud (Clean Core tier 1) by parsing it twice — once at a classic " +
    "baseline (default v758) and once at version Cloud — and diffing: findings that appear only at Cloud are genuine " +
    "cloud blockers (statements ABAP Cloud removed), reported in categories (dynpro, list output, native SQL, report " +
    "events, …) with a transparent score, an A–D tech-debt grade and a verdict; findings already present at the " +
    "baseline are reported separately as broken code, not migration work. " +
    "Use this when someone asks 'is this code cloud-ready / Clean Core compliant / S/4HANA-cloud safe', before " +
    "porting classic ABAP into an ABAP Cloud environment, or for a graded tech-debt assessment of an abapGit export. " +
    "It is static and parser-level: it does not check released-API usage (that needs a system's ATC), does not " +
    "connect to any SAP system, and a 'ready' verdict means no language-level blockers — not a certification. " +
    'Example: check_cloud_readiness({ "files": [ { "source": "REPORT zold.\\nWRITE: / \'hi\'." } ] }).',
  inputSchema: {
    files: filesField,
    baselineVersion: VERSION_ENUM.default("v758").describe(
      "Classic ABAP version the code is assumed to run on today; used to separate broken-anyway code from cloud blockers.",
    ),
  },
  outputSchema: {
    verdict: z
      .enum(["ready", "minor-rework", "moderate-rework", "significant-rework"])
      .describe("Banded verdict from the blocker count (0 / ≤5 / ≤20 / >20)."),
    score: z.number().describe("100 − 5×blockers, floored at 0. Transparent, not an oracle."),
    grade: z
      .enum(["A", "B", "C", "D"])
      .describe(
        "Clean Core tech-debt grade banded on blocker density: A = no blockers, B = ≤ 0.5 blockers/file, C = ≤ 2 blockers/file, D = more. The same objective count as the score, sized for assessment reports.",
      ),
    cloudBlockerCount: z.number().describe("Statements valid at the baseline but not in ABAP Cloud."),
    fileCount: z.number().describe("Files analyzed — the denominator of the grade's density banding."),
    categories: z.array(
      z.object({
        category: z.string().describe("Stable category id, e.g. dynpro, list-output, native-sql."),
        label: z.string().describe("What this category means and the usual remediation."),
        count: z.number().describe("Blockers in this category."),
        findings: z.array(z.unknown()).describe("The individual findings (same shape as lint_abap)."),
      }),
    ),
    brokenAtBaseline: z
      .array(z.unknown())
      .describe("Findings that fail even at the baseline version — fix first, they are not migration items."),
    releasedApiFindings: z
      .array(z.unknown())
      .describe(
        "Released-API observations from the bundled SAP Cloudification snapshot (deprecated-API usage, direct non-released table access with successor hints). Informational — NOT counted in cloudBlockerCount or score.",
      ),
    releasedApiSnapshotDate: z
      .string()
      .describe("Date of the bundled released-API snapshot the releasedApiFindings reflect."),
    baselineVersion: z.string().describe("The baseline used."),
    scopeNote: z.string().describe("Exactly what this check does and does not cover."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Check a classic report for cloud blockers.",
      arguments: {
        files: [{ source: "REPORT zold.\nWRITE: / 'hi'.\nCALL SCREEN 100." }],
      },
    },
  ],
  handler: (args) => {
    const report = checkCloudReadiness(args.files, args.baselineVersion);
    const catLine = report.categories.map((c) => `${c.category}=${c.count}`).join(", ");
    const text =
      `${report.verdict} (score ${report.score}, grade ${report.grade}): ${report.cloudBlockerCount} cloud blocker(s)` +
      (catLine.length > 0 ? ` [${catLine}]` : "") +
      (report.brokenAtBaseline.length > 0
        ? `; ${report.brokenAtBaseline.length} finding(s) broken at ${report.baselineVersion} regardless`
        : "") +
      (report.releasedApiFindings.length > 0
        ? `; ${report.releasedApiFindings.length} released-API note(s) (snapshot ${report.releasedApiSnapshotDate})`
        : "");
    return {
      content: [{ type: "text", text }],
      structuredContent: report as unknown as Record<string, unknown>,
    };
  },
});

export const scaffoldRapBoTool = defineTool({
  name: "scaffold_rap_bo",
  title: "Scaffold a RAP business object",
  description:
    "Generate the complete, canonical RAP managed business-object stack for one root entity: root CDS view entity, " +
    "behavior definition (managed, strict(2), optional draft), behavior implementation class with handler locals, " +
    "projection view with transactional_query, projection behavior definition, UI metadata extension, and an OData V4 " +
    "service definition — plus a suggested table DDL, the activation order, and next steps. " +
    "Use this when starting a new RAP business object in ABAP Cloud or S/4HANA and you want correct boilerplate that " +
    "follows the SAP /DMO reference shape instead of writing it by hand. " +
    "Generated classes and CDS views are round-trip validated through abaplint at ABAP-Cloud level before being " +
    "returned; behavior and service definitions are canonical templates (abaplint does not parse those deeply) and " +
    "ADT activation is the final check. It does not create the table or the service binding (binding is not a source " +
    "artifact — create it in ADT), and it generates single-entity BOs: model compositions (parent-child) yourself for now. " +
    'Example: scaffold_rap_bo({ "entityName": "Travel", "sqlTable": "ztravel", "keyField": "travel_id", ' +
    '"fields": [ { "name": "agency_id", "type": "abap.char(6)" } ], "draft": true }).',
  inputSchema: {
    entityName: z
      .string()
      .describe('Entity name in UpperCamelCase, e.g. "Travel" — drives ZR_/ZC_/ZBP_/ZUI_ artifact names.'),
    sqlTable: z
      .string()
      .describe('Persistent table the BO is backed by, e.g. "ztravel". Must start with the namespace prefix.'),
    keyField: z.string().describe('snake_case key field of that table, e.g. "travel_id".'),
    managedUuidKey: z
      .boolean()
      .default(true)
      .describe(
        "true (default): UUID key filled by managed numbering — modern RAP default. false: the caller provides the key on create.",
      ),
    fields: z
      .array(
        z.object({
          name: z.string().describe('snake_case table field, e.g. "agency_id".'),
          type: z
            .string()
            .optional()
            .describe('Suggested DDL type for the table proposal, e.g. "abap.char(6)". Defaults to abap.char(30).'),
        }),
      )
      .max(60)
      .default([])
      .describe("Non-key business fields. Admin fields (created_by/created_at/…) are added automatically."),
    draft: z.boolean().default(true).describe("Generate draft handling (draft table reference, draft actions, use draft)."),
    prefix: z.enum(["Z", "Y"]).default("Z").describe("Customer namespace prefix for all generated names."),
  },
  outputSchema: {
    files: z.array(
      z.object({
        filename: z.string().describe("abapGit-conventional filename."),
        content: z.string().describe("Complete source, ready to paste into ADT or commit via abapGit."),
        validated: z
          .enum(["abaplint", "template"])
          .describe('"abaplint" = machine-parsed at Cloud level; "template" = golden-tested canonical template.'),
      }),
    ),
    activationOrder: z.array(z.string()).describe("The order to create/activate artifacts in ADT."),
    nextSteps: z.array(z.string()).describe("What the generator cannot do for you (table, binding, draft table)."),
    suggestedTableDdl: z.string().describe("Starting-point DDL for the persistent table; adjust types."),
    validationIssues: z
      .array(z.unknown())
      .describe("abaplint findings on the generated sources — empty in normal operation."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Draft-enabled Travel BO with one business field.",
      arguments: {
        entityName: "Travel",
        sqlTable: "ztravel",
        keyField: "travel_id",
        fields: [{ name: "agency_id", type: "abap.char(6)" }],
        draft: true,
      },
    },
    {
      description: "Minimal no-draft BO with a caller-provided key.",
      arguments: {
        entityName: "CostCenter",
        sqlTable: "zcostcenter",
        keyField: "cost_center_id",
        managedUuidKey: false,
        draft: false,
      },
    },
  ],
  handler: (args) => {
    const result = scaffoldRapBo({
      entityName: args.entityName,
      sqlTable: args.sqlTable,
      keyField: args.keyField,
      managedUuidKey: args.managedUuidKey,
      fields: args.fields,
      draft: args.draft,
      prefix: args.prefix,
    });
    const text =
      `Generated ${result.files.length} artifacts for ${args.entityName} ` +
      `(${result.files.map((f) => f.filename).join(", ")}). ` +
      (result.validationIssues.length === 0
        ? "All machine-checkable sources passed abaplint at Cloud level."
        : `WARNING: ${result.validationIssues.length} abaplint finding(s) on generated code.`);
    return {
      content: [{ type: "text", text }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
});

export const listAbapRules = defineTool({
  name: "list_abap_rules",
  title: "List abaplint rules",
  description:
    "List the abaplint rules this server can check, optionally filtered by a free-text query or a tag, returning " +
    "key, title, one-line description, tags and a documentation URL per rule. " +
    "Use this when deciding which rules to enable or override in lint_abap, or to discover what a Clean-ABAP-style " +
    "check exists for. It does not run any analysis and does not change configuration — it is a read-only catalog. " +
    'Example: list_abap_rules({ "query": "obsolete" }).',
  inputSchema: {
    query: z
      .string()
      .optional()
      .describe('Case-insensitive substring matched against rule key, title and description, e.g. "select" or "obsolete".'),
    tag: z
      .string()
      .optional()
      .describe('Filter by abaplint tag, e.g. "Styleguide", "Security", "Performance", "Quickfix", "SingleFile".'),
  },
  outputSchema: {
    count: z.number().describe("Number of rules returned."),
    rules: z.array(
      z.object({
        key: z.string().describe("Rule key, usable in lint_abap rules overrides."),
        title: z.string().describe("Short rule title."),
        shortDescription: z.string().describe("One-line description."),
        tags: z.array(z.string()).describe("abaplint tags."),
        docsUrl: z.string().describe("Documentation at rules.abaplint.org."),
      }),
    ),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    { description: "All rules about SELECT statements.", arguments: { query: "select" } },
    { description: "Everything tagged Security.", arguments: { tag: "Security" } },
  ],
  handler: (args) => {
    const rules = listRules(args.query, args.tag);
    const text =
      rules.length === 0
        ? "No rules matched."
        : rules
            .slice(0, 50)
            .map((r) => `${r.key} — ${r.title}`)
            .join("\n") + (rules.length > 50 ? `\n… and ${rules.length - 50} more.` : "");
    return { content: [{ type: "text", text }], structuredContent: { count: rules.length, rules } };
  },
});

export const explainAbapRule = defineTool({
  name: "explain_abap_rule",
  title: "Explain an abaplint rule",
  description:
    "Explain one abaplint rule in depth: title, description, extended rationale (often citing the Clean ABAP style " +
    "guide), tags, documentation URL, and good/bad code examples where the rule defines them. " +
    "Use this when a lint_abap or check_cloud_readiness finding needs justification — to explain to a developer why " +
    "the finding matters and how to fix it. It does not run analysis and only knows abaplint rules; SAP ATC check " +
    "documentation is out of scope. " +
    'Example: explain_abap_rule({ "rule": "exit_or_check" }).',
  inputSchema: {
    rule: z.string().describe('The abaplint rule key from a finding, e.g. "exit_or_check" or "obsolete_statement".'),
  },
  outputSchema: {
    key: z.string().describe("Rule key."),
    title: z.string().describe("Rule title."),
    shortDescription: z.string().describe("One-line description."),
    extendedInformation: z.string().describe("Extended rationale; may cite Clean ABAP."),
    tags: z.array(z.string()).describe("abaplint tags."),
    docsUrl: z.string().describe("Documentation URL."),
    badExample: z.string().optional().describe("Code the rule flags, if the rule ships an example."),
    goodExample: z.string().optional().describe("The compliant version, if the rule ships one."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [{ description: "Why EXIT outside a loop is flagged.", arguments: { rule: "exit_or_check" } }],
  handler: (args) => {
    const detail = explainRule(args.rule);
    return {
      content: [{ type: "text", text: `${detail.key}: ${detail.title}\n${detail.shortDescription}\n${detail.docsUrl}` }],
      structuredContent: detail as unknown as Record<string, unknown>,
    };
  },
});

export const formatAbapTool = defineTool({
  name: "format_abap",
  title: "Format ABAP source",
  description:
    "Pretty-print one ABAP source: normalize keyword casing and indentation using abaplint's formatter — the offline " +
    "equivalent of Pretty Printer in ADT/SE80. " +
    "Use this when generated or hand-written ABAP has inconsistent casing/indentation and you want it normalized " +
    "before review or commit. It does not reformat CDS views or behavior definitions, does not change any logic, " +
    "and fails cleanly on source it cannot parse. " +
    'Example: format_abap({ "source": "report ztest.\\nwrite \'hi\'." }).',
  inputSchema: {
    source: z.string().describe("The complete ABAP source to format."),
    filename: z
      .string()
      .optional()
      .describe('abapGit-style name if known, e.g. "zcl_x.clas.abap"; inferred from the source when omitted.'),
  },
  outputSchema: {
    formatted: z.string().describe("The pretty-printed source."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    { description: "Uppercase keywords in a lowercase report.", arguments: { source: "report ztest.\nwrite 'hi'." } },
  ],
  handler: (args) => {
    const formatted = formatAbap(args.source, args.filename);
    return { content: [{ type: "text", text: formatted }], structuredContent: { formatted } };
  },
});

export const getAbapOutline = defineTool({
  name: "get_abap_outline",
  title: "Get ABAP source outline",
  description:
    "Return the structural outline of ABAP sources — classes (with methods, visibility, attributes, interfaces, " +
    "inheritance), interfaces, and FORM routines — without you having to read the whole file. " +
    "Use this when navigating a large class or legacy program to decide which part to read or edit next; it is the " +
    "cheap first call before pulling thousands of lines into context. Set mermaid: true to also get the structure as " +
    "a Mermaid classDiagram (inheritance, interface realization, method visibility) for documentation visuals. " +
    "It does not return method bodies or analyze " +
    "code quality (use lint_abap for that), and CDS/behavior-definition files yield an empty outline. " +
    'Example: get_abap_outline({ "files": [ { "filename": "zcl_big.clas.abap", "source": "CLASS zcl_big DEFINITION…" } ] }).',
  inputSchema: {
    files: filesField,
    mermaid: z
      .boolean()
      .default(false)
      .describe(
        "Also return the outline as Mermaid classDiagram source — render it anywhere Mermaid renders (GitHub, docs sites) for an instant structure diagram.",
      ),
  },
  outputSchema: {
    mermaid: z
      .string()
      .optional()
      .describe("Mermaid classDiagram source for all files; present only when requested."),
    outlines: z.array(
      z.object({
        file: z.string().describe("Filename."),
        parseable: z.boolean().describe("False when the file is not an ABAP object (or unparseable)."),
        classes: z.array(z.unknown()).describe("Class definitions with methods/visibility/attributes."),
        interfaces: z.array(z.string()).describe("Interface names defined in the file."),
        forms: z.array(z.string()).describe("Legacy FORM routine names."),
      }),
    ),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Outline a class to find its methods before editing.",
      arguments: {
        files: [
          {
            filename: "zcl_demo.clas.abap",
            source:
              "CLASS zcl_demo DEFINITION PUBLIC.\n PUBLIC SECTION.\n METHODS run.\nENDCLASS.\nCLASS zcl_demo IMPLEMENTATION.\n METHOD run.\n ENDMETHOD.\nENDCLASS.",
          },
        ],
      },
    },
  ],
  handler: (args) => {
    const outlines = outlineAbap(args.files);
    const text = outlines
      .map((o) => {
        if (!o.parseable) return `${o.file}: (no ABAP outline)`;
        const parts = [
          ...o.classes.map(
            (c) => `class ${c.name} (${c.methods.length} methods: ${c.methods.map((m) => m.name).join(", ")})`,
          ),
          ...o.interfaces.map((i) => `interface ${i}`),
          ...o.forms.map((f) => `form ${f}`),
        ];
        return `${o.file}: ${parts.join("; ") || "(empty)"}`;
      })
      .join("\n");
    const mermaid = args.mermaid ? outlineToMermaid(outlines) : undefined;
    return {
      content: [{ type: "text", text: mermaid !== undefined ? `${text}\n\n\`\`\`mermaid\n${mermaid}\n\`\`\`` : text }],
      structuredContent: {
        outlines: outlines as unknown as Record<string, unknown>[],
        ...(mermaid !== undefined ? { mermaid } : {}),
      },
    };
  },
});

/** Accept either a bare name string or a { name, type? } reference. */
const objectRefField = z
  .array(
    z.union([
      z.string().describe('A bare object name, e.g. "MARA" or "I_Product".'),
      z.object({
        name: z.string().describe('Object name, e.g. "MARA", "I_Product", "BAPI_MATERIAL_GET_DETAIL".'),
        type: z
          .string()
          .optional()
          .describe(
            'Optional SAP object type to disambiguate same-named objects: "TABL" (table), "CDS_STOB" (CDS view entity), "FUNC" (function module), "CLAS", "INTF", "BDEF". Omit if unsure.',
          ),
      }),
    ]),
  )
  .min(1)
  .max(200)
  .describe(
    'Objects to check, 1–200 per call. Each is a bare name string or a { name, type? } object, e.g. ["MARA", { "name": "I_Product", "type": "CDS_STOB" }].',
  );

export const checkReleasedApiTool = defineTool({
  name: "check_released_api",
  title: "Check ABAP released-API status",
  description:
    "Look up ABAP repository objects (DB tables, CDS view entities, function modules, classes, interfaces, …) in " +
    "SAP's published ABAP Cloudification list and report, per object, whether it is a 'released' API (safe to use in " +
    "ABAP Cloud / Clean Core), 'deprecated' (released but being retired), or 'not-released' (a classic/internal object " +
    "that is not a public API — e.g. most classic DDIC tables) — with a curated CDS successor hint for common tables. " +
    `This reflects SAP's official Cloudification list as bundled in this package (snapshot ${RELEASED_API_SNAPSHOT.snapshotDate}); ` +
    "it ships offline with the server. " +
    "Use this when you need to know if your code may reference a given object in ABAP Cloud, or which released CDS view " +
    "to use instead of a classic table — the released-API half of readiness that check_cloud_readiness deliberately " +
    "leaves to a system's ATC. " +
    "It does not connect to any SAP system, does not run ATC, and is only as current as the bundled snapshot — a " +
    `system's own released-API list (ATC check API_RELEASE_STATE_CHECK / SAP_CP_READINESS) remains authoritative; treat ` +
    "an 'absent from the list' result as 'not-released as of the snapshot', not as proof. " +
    'Example: check_released_api({ "objects": ["MARA", "I_Product", "BAPI_MATERIAL_GET_DETAIL"] }).',
  inputSchema: {
    objects: objectRefField,
  },
  outputSchema: {
    snapshotDate: z.string().describe("Date of the bundled SAP Cloudification snapshot these results reflect."),
    source: z.string().describe("URL of the SAP Apache-2.0 source the snapshot was built from."),
    results: z.array(
      z.object({
        name: z.string().describe("The object name as queried."),
        objectType: z
          .string()
          .optional()
          .describe("SAP object type of the matched record (TABL, CDS_STOB, FUNC, …), if found."),
        state: z
          .enum(["released", "deprecated", "not-released"])
          .describe("'released' = safe public API; 'deprecated' = retiring; 'not-released' = not a public API."),
        recorded: z
          .boolean()
          .describe(
            "true = explicitly present in SAP's snapshot (under the requested type, if one was given); false = absent — 'not released as of the snapshot' by omission only.",
          ),
        applicationComponent: z
          .string()
          .optional()
          .describe("Owning application component of the matched record, if found."),
        successor: z
          .string()
          .optional()
          .describe("Curated released CDS view-entity successor for a classic table, when one is known."),
      }),
    ),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Check a classic table, a released CDS view, and a BAPI in one call.",
      arguments: { objects: ["MARA", "I_Product", "BAPI_MATERIAL_GET_DETAIL"] },
    },
    {
      description: "Disambiguate a name that exists under more than one object type.",
      arguments: { objects: [{ name: "I_ProcurementProjectTP", type: "CDS_STOB" }] },
    },
  ],
  handler: (args) => {
    const results = args.objects.map((ref) => {
      const name = typeof ref === "string" ? ref : ref.name;
      const type = typeof ref === "string" ? undefined : ref.type;
      const hit = lookupReleased(name, type);
      const successor = suggestSuccessor(name);
      return {
        name: hit.name,
        objectType: hit.objectType,
        state: hit.state,
        recorded: hit.recorded,
        applicationComponent: hit.applicationComponent,
        ...(successor !== undefined ? { successor } : {}),
      };
    });
    const text = results
      .map((r) => {
        const tail = r.successor !== undefined ? ` → use ${r.successor}` : "";
        const provenance = r.recorded ? "" : " (not in snapshot)";
        return `${r.name}: ${r.state}${r.objectType !== undefined ? ` (${r.objectType})` : ""}${provenance}${tail}`;
      })
      .join("\n");
    return {
      content: [{ type: "text", text: `Snapshot ${RELEASED_API_SNAPSHOT.snapshotDate}\n${text}` }],
      structuredContent: {
        snapshotDate: RELEASED_API_SNAPSHOT.snapshotDate,
        source: RELEASED_API_SNAPSHOT.source,
        results,
      },
    };
  },
});

const compareSideShape = z.object({
  findingCount: z.number().describe("Total lint findings on this side."),
  cloudBlockerCount: z.number().describe("ABAP Cloud blockers on this side (objective dual-parse diff)."),
  score: z.number().describe("Readiness score on this side (100 − 5×blockers, floored at 0)."),
  grade: z.enum(["A", "B", "C", "D"]).describe("Density-banded Clean Core grade on this side."),
});

export const compareAbapTool = defineTool({
  name: "compare_abap",
  title: "Compare two ABAP versions",
  description:
    "Compare a BEFORE and an AFTER version of ABAP source and report what a rework actually changed: lint findings " +
    "resolved and introduced (matched by content, so moved-but-unchanged code is not noise), cloud-blocker / score / " +
    "A–D grade movement from the same dual-parse diff as check_cloud_readiness, and structural changes — classes, " +
    "methods and FORMs added or removed. " +
    "Use this when reviewing a refactor, a modernization step or an AI-generated rewrite of an existing object and " +
    "you need an objective better-or-worse verdict instead of eyeballing a diff. " +
    "It is not a textual diff tool (use git diff to see the edits) and it cannot judge functional equivalence — " +
    "behavior can change while every number improves; it does not connect to any SAP system. " +
    'Example: compare_abap({ "before": [ { "source": "REPORT zr.\\nWRITE 1." } ], "after": [ { "source": "REPORT zr.\\nWRITE 2." } ] }).',
  inputSchema: {
    before: filesField.describe("The BEFORE sources — the current/old version of the object(s). Up to 32 files, 100k chars each."),
    after: filesField.describe("The AFTER sources — the reworked version being judged. Up to 32 files, 100k chars each."),
    abapVersion: VERSION_ENUM.default("v758").describe(
      'ABAP language version both sides are linted against. "v758" (default) is current on-prem; "Cloud" is ABAP Cloud.',
    ),
    preset: z
      .enum(["style", "full", "syntax-only"])
      .default("style")
      .describe(
        'Lint preset applied identically to both sides: "style" (default) for isolated snippets, "full" when every referenced object is provided, "syntax-only" for parser errors only.',
      ),
    rules: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('abaplint rule overrides applied to both sides, e.g. { "line_length": { "length": 120 } }.'),
    focus: focusField,
  },
  outputSchema: {
    resolved: z.array(findingShape).describe("Findings present before but gone after — improvements."),
    introduced: z.array(findingShape).describe("Findings present only after — regressions to fix."),
    unchangedCount: z.number().describe("Findings present on both sides (content-matched)."),
    before: compareSideShape.describe("Lint and readiness numbers for the BEFORE side."),
    after: compareSideShape.describe("Lint and readiness numbers for the AFTER side."),
    outlineChanges: z.object({
      classesAdded: z.array(z.string()).describe("Class names present only after."),
      classesRemoved: z.array(z.string()).describe("Class names present only before."),
      methodsAdded: z.array(z.string()).describe('Methods present only after, as "class.method".'),
      methodsRemoved: z.array(z.string()).describe('Methods present only before, as "class.method".'),
      formsAdded: z.array(z.string()).describe("FORM routines present only after."),
      formsRemoved: z.array(z.string()).describe("FORM routines present only before (removing FORMs is usually progress)."),
    }),
    matchNote: z.string().describe("How findings were matched and what the numbers do and do not mean."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Judge a WRITE-report rewritten as a class.",
      arguments: {
        before: [{ source: "REPORT zold.\nWRITE: / 'hi'." }],
        after: [
          {
            source:
              "CLASS zcl_new DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS get RETURNING VALUE(rv) TYPE string.\nENDCLASS.\nCLASS zcl_new IMPLEMENTATION.\n METHOD get.\n rv = 'hi'.\n ENDMETHOD.\nENDCLASS.",
          },
        ],
      },
    },
    {
      description: "Performance-focused before/after check of a tuning change.",
      arguments: {
        before: [{ source: "REPORT zperf.\nSELECT * FROM mara INTO TABLE @DATA(lt)." }],
        after: [{ source: "REPORT zperf.\nSELECT matnr FROM mara INTO TABLE @DATA(lt)." }],
        focus: "Performance",
      },
    },
  ],
  handler: (args) => {
    const report = compareAbap(args.before, args.after, {
      version: args.abapVersion,
      preset: args.preset,
      rules: args.rules,
      focus: args.focus,
    });
    const oc = report.outlineChanges;
    const structural =
      oc.classesAdded.length + oc.classesRemoved.length + oc.methodsAdded.length + oc.methodsRemoved.length + oc.formsAdded.length + oc.formsRemoved.length;
    const text =
      `${report.introduced.length} introduced, ${report.resolved.length} resolved, ${report.unchangedCount} unchanged finding(s); ` +
      `blockers ${report.before.cloudBlockerCount}→${report.after.cloudBlockerCount}, ` +
      `score ${report.before.score}→${report.after.score}, grade ${report.before.grade}→${report.after.grade}` +
      (structural > 0 ? `; ${structural} structural change(s)` : "");
    return {
      content: [{ type: "text", text }],
      structuredContent: report as unknown as Record<string, unknown>,
    };
  },
});

export const planCloudMigrationTool = defineTool({
  name: "plan_cloud_migration",
  title: "Plan an ABAP Cloud migration",
  description:
    "Turn ABAP sources into an ordered, phased ABAP Cloud migration backlog: runs the same dual-parse analysis as " +
    "check_cloud_readiness, then arranges every blocker into per-object work items across consulting-ordered phases — " +
    "repair-the-baseline first (broken code is not migration work), then mechanical quick wins, core rework of removed " +
    "statements, UI/output re-architecture, and a separate snapshot-dated released-API remediation phase. Each work item " +
    "carries an S/M/L effort band, a remediation recipe and sample locations; each phase carries a goal and objective, " +
    "re-checkable exit criteria. " +
    "Use this when someone asks 'plan the migration', 'what do we tackle first', or wants a work breakdown / task " +
    "backlog instead of raw findings — the natural next call after check_cloud_readiness says rework is needed. " +
    "It is a deterministic re-arrangement of the readiness analysis: it does not estimate person-days, does not modify " +
    "any code, and inherits every readiness limitation (static, parser-level, snapshot-dated released-API data — a " +
    "system's ATC stays authoritative). " +
    'Example: plan_cloud_migration({ "files": [ { "source": "REPORT zold.\\nWRITE: / \'hi\'.\\nCALL SCREEN 100." } ] }).',
  inputSchema: {
    files: filesField,
    baselineVersion: VERSION_ENUM.default("v758").describe(
      "Classic ABAP version the code runs on today; used to separate broken-anyway code (phase: repair the baseline) from real migration work.",
    ),
  },
  outputSchema: {
    summary: z
      .object({
        verdict: z.string().describe("Readiness verdict the plan is built from."),
        score: z.number().describe("Readiness score (100 − 5×blockers, floored at 0)."),
        grade: z.enum(["A", "B", "C", "D"]).describe("Clean Core tech-debt grade (blocker density banding)."),
        cloudBlockerCount: z.number().describe("Total statements ABAP Cloud removed — equals the migration phases' finding total."),
        fileCount: z.number().describe("Files analyzed."),
        phaseCount: z.number().describe("Phases in the plan."),
        workItemCount: z.number().describe("Work items across all phases."),
        estimatedEffort: z.string().describe('Effort-band tally across items, e.g. "3×S, 2×M, 1×L". Bands, not person-days.'),
      })
      .describe("Roll-up of the plan and the readiness numbers it rearranges."),
    phases: z.array(
      z.object({
        phase: z.number().describe("1-based execution order."),
        kind: z
          .enum(["baseline", "migration", "released-api"])
          .describe("baseline = broken-code repair; migration = objective blocker work; released-api = informational, snapshot-dated."),
        title: z.string().describe("Phase name."),
        goal: z.string().describe("What the phase achieves and why it is ordered here."),
        effort: z.enum(["S", "M", "L"]).describe("Highest effort band among the phase's items."),
        itemCount: z.number().describe("Work items in the phase."),
        findingCount: z.number().describe("Findings behind those items."),
        items: z.array(z.unknown()).describe("Work items: object, category, effort, findingCount, recipe, sample locations."),
        exitCriteria: z.string().describe("Objective condition to call the phase done, phrased as a re-runnable check."),
      }),
    ),
    suggestedLoop: z.string().describe("How to execute and prove each item: the fix → compare_abap → re-check loop."),
    releasedApiSnapshotDate: z.string().describe("Date of the bundled released-API snapshot behind the released-api phase."),
    scopeNote: z.string().describe("Exactly what the underlying analysis does and does not cover."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Phase a classic report with UI, list output and subroutines into a migration backlog.",
      arguments: {
        files: [
          {
            filename: "zold_report.prog.abap",
            source: "REPORT zold_report.\nWRITE: / 'hi'.\nCALL SCREEN 100.\nFORM f1.\nENDFORM.",
          },
        ],
      },
    },
  ],
  handler: (args) => {
    const plan = planCloudMigration(checkCloudReadiness(args.files, args.baselineVersion));
    const s = plan.summary;
    const lines = [
      `${s.cloudBlockerCount} blocker(s) (score ${s.score}, grade ${s.grade}) → ${s.workItemCount} work item(s) in ${s.phaseCount} phase(s); effort ${s.estimatedEffort}`,
      ...plan.phases.map(
        (p) => `  ${p.phase}. ${p.title} — ${p.itemCount} item(s), ${p.findingCount} finding(s), effort ${p.effort}`,
      ),
    ];
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      structuredContent: plan as unknown as Record<string, unknown>,
    };
  },
});

/** Every tool this server exposes. (`tools` alias = the registry-export shape @mcp-kit/lint discovers.) */
export const ALL_TOOLS: readonly AnyToolSpec[] = [
  lintAbap,
  checkCloudReadinessTool,
  planCloudMigrationTool,
  compareAbapTool,
  scaffoldRapBoTool,
  checkReleasedApiTool,
  listAbapRules,
  explainAbapRule,
  formatAbapTool,
  getAbapOutline,
];

export const tools = ALL_TOOLS;

// Guard against accidental duplicate registration as tools get added.
const names = new Set(ALL_TOOLS.map((t) => t.name));
if (names.size !== ALL_TOOLS.length) {
  throw invalidInput("Duplicate tool names in ALL_TOOLS.");
}
