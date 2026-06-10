/**
 * The abap-mcp tool registry.
 *
 * Descriptions follow the mcp-kit rubric: verb-first snake_case name, what
 * the tool operates on, an explicit "Use this when …", explicit non-goals,
 * every parameter described, at least one worked example. The model's only
 * documentation is this file — treat it as the public API surface.
 */
import { z } from "zod";

import { ABAP_VERSIONS, runAbaplint } from "./abap/engine.js";
import { formatAbap } from "./abap/formatter.js";
import { outlineAbap } from "./abap/outline.js";
import { checkCloudReadiness } from "./abap/readiness.js";
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
    "preset \"full\" enables them when you provide every dependency). For an ABAP-Cloud migration verdict use " +
    "check_cloud_readiness instead. " +
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
        'abaplint rule overrides merged onto the preset, e.g. { "line_length": { "length": 120 }, "7bit_ascii": false }.',
      ),
  },
  outputSchema: {
    findings: z.array(
      z.object({
        rule: z.string().describe("abaplint rule key."),
        message: z.string().describe("Human-readable finding."),
        severity: z.string().describe("Error, Warning or Info."),
        file: z.string().describe("Filename the finding is in."),
        line: z.number().describe("1-based line."),
        column: z.number().describe("1-based column."),
        excerpt: z.string().describe("The offending line, trimmed."),
        docsUrl: z.string().describe("Rule documentation at rules.abaplint.org."),
      }),
    ),
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
  ],
  handler: (args) => {
    const result = runAbaplint(args.files, {
      version: args.abapVersion,
      preset: args.preset,
      rules: args.rules,
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
    "events, …) with a transparent score and verdict; findings already present at the baseline are reported separately " +
    "as broken code, not migration work. " +
    "Use this when someone asks 'is this code cloud-ready / Clean Core compliant / S/4HANA-cloud safe' or before " +
    "porting classic ABAP into an ABAP Cloud environment. " +
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
    cloudBlockerCount: z.number().describe("Statements valid at the baseline but not in ABAP Cloud."),
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
      `${report.verdict} (score ${report.score}): ${report.cloudBlockerCount} cloud blocker(s)` +
      (catLine.length > 0 ? ` [${catLine}]` : "") +
      (report.brokenAtBaseline.length > 0
        ? `; ${report.brokenAtBaseline.length} finding(s) broken at ${report.baselineVersion} regardless`
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
    "cheap first call before pulling thousands of lines into context. It does not return method bodies or analyze " +
    "code quality (use lint_abap for that), and CDS/behavior-definition files yield an empty outline. " +
    'Example: get_abap_outline({ "files": [ { "filename": "zcl_big.clas.abap", "source": "CLASS zcl_big DEFINITION…" } ] }).',
  inputSchema: {
    files: filesField,
  },
  outputSchema: {
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
    return {
      content: [{ type: "text", text }],
      structuredContent: { outlines: outlines as unknown as Record<string, unknown>[] },
    };
  },
});

/** Every tool this server exposes. (`tools` alias = the registry-export shape @mcp-kit/lint discovers.) */
export const ALL_TOOLS: readonly AnyToolSpec[] = [
  lintAbap,
  checkCloudReadinessTool,
  scaffoldRapBoTool,
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
