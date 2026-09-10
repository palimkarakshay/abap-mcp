/**
 * scaffold_abap_ai_sdk — validated ABAP class calling the Generative AI Hub
 * through the ABAP AI SDK powered by ISLM.
 *
 * Mirrors the scaffold_rap_bo / scaffold_abap_unit shape in src/abap.tools.ts:
 * a ToolSpec whose handler delegates to a pure generator in src/abap/, and
 * whose output carries the same honesty-tiering discipline (a `validated`
 * label the model must not over-read as "matches the real SAP API exactly").
 */
import { z } from "zod";

import { scaffoldAbapAiSdk } from "../abap/aisdk.js";
import { defineTool } from "../tool.js";

const AISDK_INTERACTIONS = [
  "string",
  "messages",
  "prompt-template",
  "function-calling",
  "structured-output",
  "streaming",
  "orchestration",
] as const;

const functionParamSchema = z.object({
  name: z.string().describe('Parameter name as the model will supply it, e.g. "material_id".'),
  description: z.string().describe("What the parameter means — shown to the model so it can fill it in correctly."),
  type: z
    .string()
    .optional()
    .describe('Optional DDIC type name resolved via cl_abap_typedescr=>describe_by_name( ), e.g. "MATNR". Omit to skip the type hint.'),
  required: z
    .boolean()
    .optional()
    .describe("True marks the parameter mandatory in the function definition; omit to leave it unmarked (SAP's own samples do this for optional parameters)."),
});

const functionSchema = z.object({
  name: z.string().describe('Function/tool name the model calls, e.g. "get_current_stock_level".'),
  description: z.string().describe("What the function does — shown to the model so it knows when to call it."),
  params: z
    .array(functionParamSchema)
    .max(10)
    .describe("The function's parameters, in declaration order; an empty array is a no-argument function."),
});

export const scaffoldAbapAiSdkTool = defineTool({
  name: "scaffold_abap_ai_sdk",
  title: "Scaffold an ABAP AI SDK (ISLM) class",
  description:
    "Generate one validated global ABAP class that calls the SAP Generative AI Hub through the ABAP AI SDK powered " +
    "by Intelligent Scenario Lifecycle Management (ISLM) — SAP's own client library, not a third-party SDK with a " +
    'similar name. Seven interaction shapes: "string" (single prompt via EXECUTE_FOR_STRING), "messages" ' +
    "(system/user/assistant turns plus token-count/finish-reason retrieval), \"prompt-template\" " +
    "(CL_AIC_ISLM_PROMPT_TPL_FACTORY, never the non-existent CL_AIC_PROMPT_TEMPLATE), \"function-calling\" (the " +
    "tool-call DO-loop, with the upstream SAP sample's undeclared-tool_calls bug fixed — the table is declared and " +
    'populated before ADD_TOOL_RESULTS), "structured-output" (DEFINE_RESPONSE_FORMAT->JSON_SCHEMA->FROM_STRING), ' +
    '"streaming" (IF_AIC_ADT_COMPLETION_API delta loop), and "orchestration" (the separate Orchestration API, which ' +
    "does not yet support structured output, function calling or media input). Every generated class carries an " +
    "injectable constructor seam (an OPTIONAL api parameter) so it can be unit-tested with cl_abap_testdouble " +
    "instead of a live ISLM scenario; pass withUnitTest for a FOR TESTING skeleton using that seam. Generated files " +
    "are round-tripped through abaplint (version Cloud, preset syntax-only) together with abap-mcp's own bundled " +
    'stub declarations of the referenced IF_AIC_*/CL_AIC_*/CX_AIC_* types, labelled validated:"abaplint-syntax" — ' +
    "this proves the ABAP parses, not that it matches SAP's real API surface exactly. " +
    "Use this when you are adding a Generative-AI-Hub call to ABAP Cloud code and want correct, cited API shapes " +
    "instead of guessing class/method names from memory (a common LLM hallucination surface — e.g. inventing " +
    "CL_AIC_PROMPT_TEMPLATE, or copying SAP's own buggy function-calling sample verbatim). " +
    "It does NOT call any LLM, does NOT deploy or activate anything, and does NOT create the SAP_COM_0A69 " +
    "communication arrangement or the Intelligent Scenario (INTS/INTM) itself — those are manual ISLM/BTP-cockpit " +
    "steps returned in setupSteps that this tool has no way to perform (no SAP system, no credentials, no network). " +
    'Example: scaffold_abap_ai_sdk({ "scenarioName": "ZDEMO_AI_SCENARIO", "interaction": "string" }).',
  inputSchema: {
    scenarioName: z
      .string()
      .describe(
        'ISLM intelligent-scenario name the generated class calls via CREATE_INSTANCE( ), e.g. "ZDEMO_AI_SCENARIO". ' +
          "Must start with the chosen prefix; the scenario itself must already exist, be published, deployed and " +
          "activated in the target system (see setupSteps) — this tool never creates it.",
      ),
    interaction: z
      .enum(AISDK_INTERACTIONS)
      .describe(
        'Which SAP AI SDK interaction shape to generate: "string", "messages", "prompt-template", ' +
          '"function-calling", "structured-output", "streaming", or "orchestration" — see the tool description for ' +
          "what each one calls.",
      ),
    className: z
      .string()
      .optional()
      .describe(
        'Generated global class name, e.g. "ZCL_AI_TRAVEL_SUMMARY". Defaults to "<prefix>CL_AI_<INTERACTION>" when omitted; must start with the chosen prefix.',
      ),
    prefix: z.enum(["Z", "Y"]).default("Z").describe("Customer namespace prefix for both scenarioName and className."),
    functions: z
      .array(functionSchema)
      .max(20)
      .default([])
      .describe(
        'Tool/function definitions for interaction "function-calling"; ignored for every other interaction. A ' +
          "single illustrative demo function is generated when this is left empty.",
      ),
    withUnitTest: z
      .boolean()
      .default(false)
      .describe(
        "Also generate a FOR TESTING skeleton class reusing the injectable seam with cl_abap_testdouble; the " +
          "skeleton asserts a TODO fail( ) until you replace it with real given/when/then logic.",
      ),
  },
  outputSchema: {
    files: z
      .array(
        z.object({
          filename: z.string().describe("abapGit-conventional filename."),
          content: z.string().describe("Complete source, ready to paste into ADT or commit via abapGit."),
          validated: z
            .literal("abaplint-syntax")
            .describe(
              "Round-tripped through abaplint at Cloud/syntax-only against abap-mcp's OWN bundled AIC stubs — " +
                "proves the ABAP parses, not that it matches SAP's real API surface exactly.",
            ),
        }),
      )
      .describe("The generated class file, plus a testclasses file when withUnitTest is true."),
    setupSteps: z
      .array(z.string())
      .describe(
        "The manual AI Core / ISLM configuration this code depends on at runtime (extended service plan, " +
          "SAP_COM_0A69, INTS/INTM, F4469/F4470 deploy+activate) — this tool performs none of it.",
      ),
    constraints: z
      .array(z.string())
      .describe(
        "Documented limits: temperature range, per-instance parameter persistence, catchable error codes via " +
          "IF_AIC_API_ERROR, ABAP Cross Trace debugging, and — for interaction \"orchestration\" only — the three " +
          "completion-API features it does not yet support.",
      ),
    nextSteps: z.array(z.string()).describe("What to fill in or verify next, specific to the chosen interaction."),
    validationIssues: z.array(z.unknown()).describe("abaplint findings on the generated sources — empty on a clean round-trip."),
    validated: z
      .literal("abaplint-syntax")
      .describe("Top-level echo of the file-level label: syntax-checked against bundled stubs only, not SAP's real API surface."),
    scopeNote: z.string().describe("Exactly what this tool does and does not do — no LLM calls, no scenario creation, no deployment, no network access."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false, idempotentHint: true },
  examples: [
    {
      description: "Simple single-prompt completion class against an already-activated scenario.",
      arguments: { scenarioName: "ZDEMO_AI_SCENARIO", interaction: "string" },
    },
    {
      description: "Function-calling class with two custom tools and a generated test skeleton.",
      arguments: {
        scenarioName: "ZDEMO_AI_TOOLS",
        interaction: "function-calling",
        className: "ZCL_AI_STOCK_AGENT",
        withUnitTest: true,
        functions: [
          {
            name: "get_current_stock_level",
            description: "Look up the current stock level for a material.",
            params: [{ name: "material_id", description: "Material number to look up.", type: "MATNR", required: true }],
          },
          {
            name: "get_material_description",
            description: "Look up the description text for a material.",
            params: [{ name: "material_id", description: "Material number to look up.", required: true }],
          },
        ],
      },
    },
    {
      description: "Orchestration-API variant on the Y namespace, for content filtering / data masking via a configured execution flow.",
      arguments: { scenarioName: "YDEMO_AI_ORCH", interaction: "orchestration", prefix: "Y" },
    },
  ],
  handler: (args) => {
    const result = scaffoldAbapAiSdk({
      scenarioName: args.scenarioName,
      interaction: args.interaction,
      className: args.className,
      prefix: args.prefix,
      functions: args.functions,
      withUnitTest: args.withUnitTest,
    });
    const text =
      `Generated ${result.files.length} file(s) for interaction "${args.interaction}" ` +
      `(${result.files.map((f) => f.filename).join(", ")}). ` +
      (result.validationIssues.length === 0
        ? 'All sources passed abaplint at Cloud/syntax-only against bundled AIC stubs (validated:"abaplint-syntax").'
        : `WARNING: ${result.validationIssues.length} abaplint finding(s) on generated code.`);
    return {
      content: [{ type: "text", text }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
});

export const AISDK_TOOLS = [scaffoldAbapAiSdkTool] as const;
