/**
 * check_rap_behavior — the MCP surface of abap-mcp's own BDL/SDL checker
 * (spec `docs/specs/rap-checker-design.md` §4.1).
 *
 * Mirrors the aisdk / knowledge tool files: a ToolSpec whose handler
 * delegates to a pure engine in `src/abap/` and whose output carries the same
 * honesty tiering — `scopeNote`, `grammarVersion` and `rulesVersion` travel
 * with every report so a consumer can date the claim, and `validated:
 * "rap-checker"` is explicit that abaplint did NOT parse these files (it
 * cannot) and that ADT activation remains the only authority.
 */
import { z } from "zod";

import { KNOWLEDGE_RELEASES } from "../abap/knowledge.js";
import type { KnowledgeRelease } from "../abap/knowledge.js";
import { MAX_FILES } from "../abap/engine.js";
import { checkRapBehavior, classifyRapSource } from "../abap/rap/index.js";
import { toolError } from "../errors.js";
import { defineTool } from "../tool.js";

/**
 * A call with nothing this tool can check must fail, not succeed emptily.
 * Without this guard a set of `.clas.abap` files (or only CDS views) returned
 * `0 error(s), 0 warning(s) … across 0 RAP file(s)` with `validated:
 * "rap-checker"` on it — a clean bill of health for a check that never ran,
 * which is the one thing `docs/DESIGN.md` §4 forbids. `abap-mcp rapcheck`
 * has always refused the same call with exit 2; the tool now matches it.
 */
function assertCheckableFiles(files: readonly { filename?: string | undefined; source: string }[]): void {
  const kinds = files.map((file) => classifyRapSource(file.source, file.filename));
  if (kinds.some((kind) => kind === "bdef" || kind === "srvd")) return;
  const names = files
    .map((file, index) => file.filename ?? `(unnamed source ${index + 1})`)
    .join(", ");
  const onlyCds = kinds.every((kind) => kind === "ddls");
  throw toolError(
    "invalid_input",
    onlyCds
      ? `Only CDS view definitions were passed (${names}); this tool checks a behavior or service definition, ` +
          "and a .ddls file on its own has no behavior to check."
      : `None of the files passed is a RAP behavior definition or CDS service definition (${names}), so there ` +
          "was nothing to check.",
    {
      hint: "pass at least one .bdef.asbdef or .srvd.srvdsrv (plus the .ddls files they reference)",
      nextTools: ["lint_abap", "check_cloud_readiness"],
    },
  );
}

const RELEASE_ENUM = z.enum(KNOWLEDGE_RELEASES);

const rapFilesField = z
  .array(
    z.object({
      filename: z
        .string()
        .optional()
        .describe(
          'abapGit-style name — "zr_travel.bdef.asbdef", "zui_travel_v4.srvd.srvdsrv", "zr_travel.ddls.asddls". ' +
            "Omit it and the kind is inferred from the source; pass it whenever you have it, because cross-file " +
            "checks (projection → base, expose → CDS entity) key off names.",
        ),
      source: z.string().describe("The complete behavior-definition, service-definition or CDS source text."),
    }),
  )
  .min(1)
  .max(MAX_FILES)
  .describe(
    "The BDEF/SRVD files to check, plus any .ddls.asddls or base .bdef.asbdef you want cross-checked in the " +
      "same call. Up to 32 files, 100k chars each — passing the base BDEF and the CDS views is what turns on " +
      "the cross-file half of the rule set.",
  );

const parserErrorShape = z.object({
  message: z.string().describe("What the parser could not reduce, in plain words."),
  line: z.number().describe("1-based line."),
  column: z.number().describe("1-based column."),
  excerpt: z.string().describe("The offending line, trimmed."),
  kind: z
    .enum(["syntax", "unknown-construct"])
    .describe('"syntax" = punctuation-level breakage (an error); "unknown-construct" = outside our grammar (info).'),
});

const rapFindingShape = z.object({
  rule: z
    .string()
    .describe('Rule id: "RAP026", "SRVD003", "RAP900", "RAP000", "RAP-PARSE", or abaplint\'s own "cds_parser_error".'),
  severity: z.enum(["error", "warning", "info"]).describe("error = confirmed defect; warning = advisory or release-gated; info = a checker-coverage note."),
  message: z.string().describe("What is wrong, naming the entity/field involved."),
  file: z.string().describe("Filename the finding is in."),
  line: z.number().describe("1-based line."),
  column: z.number().describe("1-based column."),
  excerpt: z.string().describe("The offending line, trimmed."),
  hint: z.string().describe("The concrete fix, as BDL you can paste."),
  confidence: z
    .enum(["confirmed", "inferred", "community-reported", "conflicting"])
    .describe("Provenance of the rule itself — only 'confirmed' rules are ever severity error."),
  entity: z.string().optional().describe("The behavior entity or service the finding is scoped to, when it has one."),
  minRelease: z.string().optional().describe("ABAP Cloud release the construct needs, on release-gated findings."),
  docsUrl: z.string().optional().describe("This rule's section in docs/RAP-RULES.md."),
  sourceUrl: z.string().optional().describe("The SAP page the rule was derived from."),
});

export const checkRapBehaviorTool = defineTool({
  name: "check_rap_behavior",
  title: "Check a RAP behavior/service definition",
  description:
    "Check RAP behavior definitions (.bdef.asbdef) and CDS service definitions (.srvd.srvdsrv) for syntax and " +
    "structural-consistency defects, offline, using abap-mcp's own BDL/SDL parser — abaplint does not deep-parse " +
    "either file type (it stores a BDEF behind a single regex and a SRVD not at all), so this is the only static " +
    "feedback these files get without a system. Reports the draft/etag/lock/authorization/numbering consistency " +
    "set, strict-mode obligations, action/operation/validation/determination/side-effect coherence, projection " +
    "'use' statements against the base BDEF, and service 'expose' sets against the CDS entities you pass in the " +
    "same call; with abapRelease set, it also flags constructs newer than that release from a bundled, dated copy " +
    "of SAP's RAP BDL feature table. " +
    "Use this when you have written or generated a BDEF/SRVD (by hand, from scaffold_rap_bo, or from a model that " +
    "may have invented RAP syntax) and want it checked before it reaches ADT — and pass the base BDEF and the " +
    ".ddls.asddls views alongside it, because the cross-file rules only run on files present in the call. " +
    "It does NOT connect to SAP, does not activate anything, does not run ATC, cannot see DDIC tables, " +
    "behavior-pool classes or CDS field types, and cannot certify that ADT would accept the file — the grammar is " +
    "derived from SAP's published feature tables plus a 102-file corpus of Apache-2.0 SAP sample sources, so " +
    "constructs it does not recognise are reported as info, never as errors. For ABAP classes use lint_abap; for " +
    "a new BO use scaffold_rap_bo; for what a release added use explain_abap_release. " +
    'Example: check_rap_behavior({ "files": [ { "filename": "zr_travel.bdef.asbdef", "source": "managed ' +
    'implementation in class zbp_travel unique;\\nstrict ( 2 );\\nwith draft;\\n\\ndefine behavior for ZR_Travel ' +
    'alias Travel\\npersistent table ztravel\\nlock master\\n{ create; }\\n" } ], "abapRelease": "2508" }).',
  inputSchema: {
    files: rapFilesField,
    abapRelease: RELEASE_ENUM.optional().describe(
      'Target ABAP Cloud release, e.g. "2508". When set, constructs whose SAP-documented minimum release is ' +
        "newer are reported as warnings (rule RAP900) from the bundled, dated feature table. Omit to skip release gating.",
    ),
    strict: z
      .boolean()
      .default(false)
      .describe(
        "Run the strict-mode rules even when the BDEF does not declare strict/strict(2) — use it to see what a BO " +
          "would have to fix before it can be released under the C0/C1 contract. Default false: strict rules run " +
          "only on BDEFs that declare strict.",
      ),
  },
  outputSchema: {
    files: z
      .array(
        z.object({
          filename: z.string().describe("The name as passed in, or one inferred from the source."),
          kind: z
            .enum(["bdef", "srvd", "ddls", "unsupported"])
            .describe('What the file was treated as. "unsupported" = neither BDEF, SRVD nor CDS; nothing was checked.'),
          parsed: z.boolean().describe("True when the file reduced to an AST with no punctuation-level errors."),
          parserErrors: z.array(parserErrorShape).describe("Parse diagnostics for this file — the RAP-PARSE findings, per file."),
          entityCount: z.number().optional().describe('BDEF only: "define"/"extend behavior for" blocks found.'),
          exposeCount: z.number().optional().describe("SRVD only: EXPOSE statements found."),
        }),
      )
      .describe("One row per supplied file: what it was taken to be, and whether it parsed."),
    findings: z.array(rapFindingShape).describe("Every rule finding, sorted by file, line, column, rule id."),
    summary: z
      .object({
        errors: z.number().describe("Findings at severity error — confirmed defects."),
        warnings: z.number().describe("Findings at severity warning — advisory rules and release gates."),
        infos: z.number().describe("Findings at severity info — coverage notes, never defect claims."),
        filesChecked: z.number().describe("Files that were BDEF, SRVD or CDS (unsupported ones excluded)."),
        rulesRun: z.number().describe("Distinct rules that were not gated out by strict/requires."),
        suppressedByUnknown: z
          .number()
          .describe('How often a "X must be declared" rule stayed silent because a statement it could not read might have been that X.'),
        unknownConstructs: z.number().describe("Statements outside our grammar (RAP000 candidates), before the 50-per-file report cap."),
        baseUnresolved: z
          .number()
          .describe(
            "How often a cross-file rule stayed silent because the projection's CDS view names a base entity no BDEF in this call defines — pass that BDEF to turn those rules on.",
          ),
        omitted: z
          .number()
          .describe(
            "Findings the report cap dropped. The error/warning/info counts above are taken BEFORE the cap, so they stay true of the files even when this is non-zero.",
          ),
        truncated: z.boolean().describe("True when the finding cap or a parser cap cut the report short."),
      })
      .describe("Counts, including the two honesty counters that make coverage gaps measurable."),
    scopeNote: z.string().describe("Exactly what this checker proves and does not prove — abaplint did not parse these files, and ADT remains the authority."),
    grammarVersion: z.string().describe('Which BDL/SDL grammar read the files, e.g. "bdl/2026-09-10".'),
    rulesVersion: z.string().describe('Which rule set judged them, e.g. "rap-rules/1.0.0".'),
    releaseGate: z
      .object({
        abapRelease: z.string().describe("The target release you passed."),
        curatedDate: z.string().describe("When the bundled feature-table transcription was curated."),
        gatedConstructs: z.number().describe("How many constructs needed a newer release than the target."),
      })
      .optional()
      .describe("Present only when abapRelease was passed."),
    validated: z
      .literal("rap-checker")
      .describe(
        'Checked by abap-mcp\'s own RAP parser + rule set at the stamped grammar/rules version. It does NOT claim ' +
          "abaplint parsed it, that SAP's parser would accept it, or that the object would activate.",
      ),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "A draft-enabled BDEF on its own — catches the missing draft table and total etag.",
      arguments: {
        files: [
          {
            filename: "zr_travel.bdef.asbdef",
            source:
              "managed implementation in class zbp_travel unique;\nstrict ( 2 );\nwith draft;\n\n" +
              "define behavior for ZR_Travel alias Travel\npersistent table ztravel\netag master LocalLastChangedAt\n" +
              "lock master\nauthorization master ( instance )\n{\n  create;\n  update;\n  delete;\n}\n",
          },
        ],
      },
    },
    {
      description: "A projection BDEF plus its base BDEF and both CDS views — turns on the cross-file 'use' check.",
      arguments: {
        files: [
          {
            filename: "zr_travel.bdef.asbdef",
            source:
              "managed implementation in class zbp_travel unique;\nstrict ( 2 );\n\n" +
              "define behavior for ZR_Travel alias Travel\npersistent table ztravel\netag master LocalLastChangedAt\n" +
              "lock master\nauthorization master ( instance )\n{\n  update;\n  delete;\n}\n",
          },
          {
            filename: "zc_travel.bdef.asbdef",
            source: "projection;\nstrict ( 2 );\n\ndefine behavior for ZC_Travel alias Travel\n{\n  use create;\n  use update;\n}\n",
          },
          {
            filename: "zr_travel.ddls.asddls",
            source: "define root view entity ZR_Travel\n  as select from ztravel\n{\n  key travel_id as TravelId\n}\n",
          },
          {
            filename: "zc_travel.ddls.asddls",
            source:
              "define root view entity ZC_Travel\n  provider contract transactional_query\n  as projection on ZR_Travel\n{\n  key TravelId\n}\n",
          },
        ],
      },
    },
    {
      description: "A service definition with its projection view, gated against ABAP Cloud 2502.",
      arguments: {
        files: [
          {
            filename: "zui_travel_v4.srvd.srvdsrv",
            source: "@EndUserText.label: 'Travel service'\ndefine service ZUI_TRAVEL_V4 {\n  expose ZC_Travel as Travel;\n}\n",
          },
          {
            filename: "zc_travel.ddls.asddls",
            source:
              "define root view entity ZC_Travel\n  provider contract transactional_query\n  as projection on ZR_Travel\n{\n  key TravelId\n}\n",
          },
        ],
        abapRelease: "2502",
      },
    },
  ],
  handler: (args) => {
    assertCheckableFiles(args.files);
    const report = checkRapBehavior(args.files, {
      ...(args.abapRelease !== undefined ? { abapRelease: args.abapRelease as KnowledgeRelease } : {}),
      strict: args.strict,
    });
    const { errors, warnings, infos, filesChecked } = report.summary;
    const head =
      `${errors} error(s), ${warnings} warning(s), ${infos} info(s) across ${filesChecked} RAP file(s) ` +
      `[grammar ${report.grammarVersion}, rules ${report.rulesVersion}].`;
    const lines = report.findings.map(
      (f) => `${f.file}:${f.line}:${f.column} [${f.severity}] ${f.rule}: ${f.message}`,
    );
    return {
      content: [{ type: "text", text: [head, ...lines].join("\n") }],
      structuredContent: report as unknown as Record<string, unknown>,
    };
  },
});

export const RAP_TOOLS = [checkRapBehaviorTool] as const;
