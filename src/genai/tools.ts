/**
 * ToolSpecs for the abap-mcp-genai online, opt-in module (F09). Registered ONLY by
 * src/genai.ts — never by the default stdio server (src/server.ts / src/cli.ts).
 *
 * Both tools carry `openWorldHint: true` (unlike every tool in src/abap.tools.ts) because both
 * make an outbound call to the caller's own SAP AI Core tenant; both stay `readOnlyHint: true`
 * because neither mutates any system state. Descriptions follow the same mcp-kit rubric as
 * src/abap.tools.ts (verb-first name, "Use this when", explicit non-goals, every parameter
 * described, ≥1 worked example) plus one addition specific to this online module: each
 * description states plainly, in a PRIVACY paragraph, what leaves the machine.
 */
import { z } from "zod";

import { invalidInput } from "../errors.js";
import { defineTool, type AnyToolSpec } from "../tool.js";
import { getSharedGenAiClient } from "./client.js";

const EXPLAIN_SCOPE_NOTE =
  "sap-abap-1 explains ABAP; it does not generate, fix, or lint code (SAP itself labels code " +
  "generation 'experimental, not recommended for productive use'), and it never receives a system " +
  "prompt — SAP's server manages that and fails the call if one is sent. Use abap-mcp's own " +
  "lint_abap / check_cloud_readiness / scaffold_abap_unit for anything that must stay offline and " +
  "verifiable; treat this explanation as a second opinion, not ground truth.";

/**
 * These three prompt shapes mirror the STRUCTURE (section count and headers) of SAP's own
 * "Prompting Templates" for SAP-ABAP-1 (explain a class / a method / a snippet) — reworded in
 * our own language, not quoted verbatim. Source (CC-BY-4.0, SAP-docs/sap-artificial-intelligence):
 * https://help.sap.com/docs/sap-ai-core/generative-ai/prompting-templates
 */
function buildExplainPrompt(
  mode: "class" | "method" | "snippet",
  primary: string,
  context: string | undefined,
  methodName: string | undefined,
): string {
  const inputBlock = `## Input code\n\`\`\`abap\n${primary}\n\`\`\`\n`;
  const contextBlock = context !== undefined ? `## Class context (truncated is fine)\n\`\`\`abap\n${context}\n\`\`\`\n` : "";

  if (mode === "class") {
    return (
      "Explain the ABAP class in the input code below. Structure the answer in four parts: " +
      "(1) a one-paragraph summary of what the class is for; (2) a summary of its data declarations; " +
      "(3) a summary of each public method (skip a section entirely if it does not apply, e.g. no " +
      "interfaces); (4) a short closing note on how the class is meant to be used. Call out any " +
      "notable dependencies or side effects as you go.\n\n" +
      inputBlock
    );
  }
  if (mode === "method") {
    const label = methodName !== undefined && methodName.length > 0 ? ` \`${methodName}\`` : "";
    return (
      `Explain the ABAP method${label} in the input code below. Structure the answer in three parts: ` +
      "(1) a one-paragraph summary; (2) a step-by-step technical walkthrough of what each block does; " +
      "(3) a short closing note on its return value and any exceptions it raises. If class context is " +
      "supplied below, use it only to understand the method — do not summarize the whole class.\n\n" +
      inputBlock +
      contextBlock
    );
  }
  return (
    "Explain the ABAP code snippet below. Structure the answer in two parts: (1) a one-paragraph " +
    "summary of what the snippet does; (2) a step-by-step technical walkthrough of each block. If " +
    "class context is supplied below, use it only to understand the snippet — do not summarize the " +
    "whole class.\n\n" +
    inputBlock +
    contextBlock
  );
}

const codeEntryField = z.object({
  filename: z
    .string()
    .optional()
    .describe('Cosmetic abapGit-style name, e.g. "zcl_invoice.clas.abap" — used only to label the prompt, never validated.'),
  source: z.string().min(1).describe("ABAP source text: either the code to explain, or (as a second entry) its surrounding class context."),
});

function resolveEntries(args: {
  source?: string | undefined;
  files?: { filename?: string | undefined; source: string }[] | undefined;
}): { primary: string; context?: string } {
  const hasSource = args.source !== undefined && args.source.trim().length > 0;
  const hasFiles = args.files !== undefined && args.files.length > 0;
  if (hasSource === hasFiles) {
    throw invalidInput(
      'Provide exactly one of "source" (a single ABAP string) or "files" (1-2 entries: the code to explain, ' +
        "and optionally its surrounding class context).",
    );
  }
  if (hasSource) return { primary: args.source as string };
  const files = args.files as { filename?: string; source: string }[];
  const primary = files[0]!.source;
  const contextSource = files[1]?.source;
  return contextSource !== undefined ? { primary, context: contextSource } : { primary };
}

export const explainWithSapAbap1 = defineTool({
  name: "explain_with_sap_abap_1",
  title: "Explain ABAP with SAP-ABAP-1 (online, opt-in)",
  description:
    "Send ABAP source text to SAP's own sap-abap-1 foundation model, through the caller's SAP AI Core " +
    "Generative AI Hub Orchestration service (Orchestration V2 POST .../v2/completion), and return its " +
    "English explanation of a class, method, or code snippet. " +
    "PRIVACY: this call leaves the machine — the supplied source text is sent to the caller's own SAP AI " +
    "Core tenant (reached via the AICORE_SERVICE_KEY / AICORE_SERVICE_KEY_FILE credentials this process was " +
    "started with) for processing; it is never sent to abap-mcp's authors or any third party, and this tool " +
    "is registered only in the separate, opt-in abap-mcp-genai server — never in the offline abap-mcp server. " +
    "Use this when a developer wants SAP's own ABAP/CDS-tuned model's read on unfamiliar or legacy code — a " +
    "second opinion alongside get_abap_outline/explain_abap_rule from the offline server, especially before " +
    "modernizing something nobody currently understands. It does not generate, fix, or lint ABAP (SAP labels " +
    "sap-abap-1's code generation 'experimental, not recommended for productive use', and this tool does not " +
    "expose it), is not a substitute for abap-mcp's offline lint_abap/check_cloud_readiness, cannot see or " +
    "read any SAP system itself, and requires the caller's own SAP AI Core service key on the extended plan " +
    "— it fails clearly with a not_configured error when that is unset. " +
    'Example: explain_with_sap_abap_1({ "source": "CLASS zcl_add_test DEFINITION ... ENDCLASS.", "mode": "class" }).',
  inputSchema: {
    source: z
      .string()
      .optional()
      .describe('The complete ABAP source to explain, as one string — shorthand for "files" with a single entry and no class context.'),
    files: z
      .array(codeEntryField)
      .min(1)
      .max(2)
      .optional()
      .describe(
        '1-2 entries, alternative to "source": the first is the code to explain (class/method/snippet); an ' +
          'optional second entry supplies the surrounding class as extra context for mode "method" or "snippet" ' +
          "— mirrors SAP's own prompt templates, which take the same two inputs.",
      ),
    mode: z
      .enum(["class", "method", "snippet"])
      .default("class")
      .describe(
        'What kind of unit the source is: "class" explains a whole class in one pass, "method" explains one ' +
          'method (pair it with class context as a second files[] entry for best results), "snippet" explains ' +
          "an arbitrary code fragment.",
      ),
    methodName: z
      .string()
      .optional()
      .describe('Method name to mention in the prompt when mode is "method" — cosmetic labeling only; the method source itself still comes from source/files.'),
    temperature: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Sampling temperature forwarded to sap-abap-1, 0-1. Omitted calls use SAP's own documented default of 0.1."),
    maxTokens: z
      .number()
      .int()
      .positive()
      .max(4000)
      .optional()
      .describe("Maximum completion tokens forwarded to sap-abap-1. Omitted calls use SAP's own documented default of 2000."),
  },
  outputSchema: {
    explanation: z.string().describe("sap-abap-1's English explanation of the supplied code."),
    model: z.string().describe('The model that answered — always "sap-abap-1".'),
    version: z.string().describe('The model version requested, e.g. "latest".'),
    usage: z
      .object({
        promptTokens: z.number().describe("Prompt tokens SAP AI Core billed for this call."),
        completionTokens: z.number().describe("Completion tokens SAP AI Core billed for this call."),
        totalTokens: z.number().describe("Total tokens SAP AI Core billed for this call."),
      })
      .describe("Token usage SAP AI Core reported, for the caller's own billing awareness."),
    requestId: z.string().describe("SAP AI Core's request_id for this call — useful when filing a support ticket."),
    scopeNote: z.string().describe("Fixed reminder of what this tool does and does not do."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  examples: [
    {
      description: "Explain a small class with SAP's own model.",
      arguments: {
        source:
          "CLASS zcl_add_test DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS add IMPORTING p1 TYPE i p2 TYPE i RETURNING VALUE(result) TYPE i.\nENDCLASS.\nCLASS zcl_add_test IMPLEMENTATION.\n METHOD add.\n result = p1 + p2.\n ENDMETHOD.\nENDCLASS.",
        mode: "class",
      },
    },
    {
      description: "Explain one method, giving the surrounding class as extra context.",
      arguments: {
        files: [
          { source: "METHOD add.\n result = p1 + p2.\n ENDMETHOD." },
          { source: "CLASS zcl_add_test DEFINITION PUBLIC FINAL CREATE PUBLIC.\n PUBLIC SECTION.\n METHODS add IMPORTING p1 TYPE i p2 TYPE i RETURNING VALUE(result) TYPE i.\nENDCLASS." },
        ],
        mode: "method",
        methodName: "add",
      },
    },
  ],
  handler: async (args) => {
    const { primary, context } = resolveEntries(args);
    const content = buildExplainPrompt(args.mode, primary, context, args.methodName);
    const client = getSharedGenAiClient();
    const result = await client.completion({
      template: [{ role: "user", content }],
      model: {
        name: "sap-abap-1",
        version: "latest",
        temperature: args.temperature ?? 0.1,
        maxTokens: args.maxTokens ?? 2000,
      },
    });
    const structured = {
      explanation: result.content,
      model: result.model,
      version: result.version,
      usage: result.usage,
      requestId: result.requestId,
      scopeNote: EXPLAIN_SCOPE_NOTE,
    };
    return {
      content: [{ type: "text" as const, text: result.content }],
      structuredContent: structured,
    };
  },
});

export const listGenaiHubModels = defineTool({
  name: "list_genai_hub_models",
  title: "List Generative AI Hub models (online, opt-in)",
  description:
    "Query the caller's own SAP AI Core Generative AI Hub tenant for the foundation models available to it — " +
    "provider, model id, context length, deprecation/retirement status, and which scenarios (orchestration " +
    "vs. direct foundation-models deployment) each version supports (GET .../v2/lm/scenarios/foundation-models/models). " +
    "PRIVACY: this call leaves the machine and contacts the caller's own SAP AI Core tenant (reached via the " +
    "AICORE_SERVICE_KEY / AICORE_SERVICE_KEY_FILE credentials this process was started with); no ABAP source " +
    "is sent — this is a metadata-only lookup, and this tool is registered only in the separate, opt-in " +
    "abap-mcp-genai server, never in the offline abap-mcp server. " +
    "Use this when you need to confirm sap-abap-1 (or any other model proxied through the same tenant) is " +
    "actually deployed and current before calling explain_with_sap_abap_1, or to check a model's deprecation " +
    "or retirement date. It does not call any model itself, cannot report exact per-token pricing (SAP defers " +
    "that to a paywalled SAP Note), and reflects a live snapshot of the caller's tenant — not a bundled or " +
    "offline dataset, unlike check_released_api. " +
    'Example: list_genai_hub_models({ "filter": "sap-abap" }).',
  inputSchema: {
    filter: z
      .string()
      .optional()
      .describe('Case-insensitive substring matched against model id or provider, e.g. "sap-abap" or "anthropic" — omit to list every model visible to this AI Resource Group.'),
  },
  outputSchema: {
    resourceGroup: z.string().describe("AI Resource Group the listing was queried in."),
    count: z.number().describe("Number of models returned after filtering."),
    models: z
      .array(
        z.object({
          model: z.string().describe('SAP AI Core model id, e.g. "sap-abap-1".'),
          provider: z.string().describe('Model provider, e.g. "SAP", "OpenAI", "anthropic".'),
          executableId: z.string().describe('Executable backing this model, e.g. "azure-openai".'),
          allowedScenarios: z.array(z.string()).describe('Scenario ids this model can be used from, e.g. "orchestration", "foundation-models".'),
          versions: z
            .array(
              z.object({
                name: z.string().describe("Version identifier."),
                isLatest: z.boolean().describe('True if this is the version "latest" currently resolves to.'),
                contextLength: z.number().optional().describe("Maximum context length in tokens, when SAP publishes it."),
                deprecated: z.boolean().optional().describe("True if SAP has marked this version deprecated."),
                retirementDate: z.string().optional().describe("Retirement date, when SAP has published one for this version."),
              }),
            )
            .describe("Every published version of the model."),
        }),
      )
      .describe("Matching models, most-relevant filtering applied client-side over the tenant's full catalog."),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  examples: [
    { description: "List only SAP's own ABAP-specific model.", arguments: { filter: "sap-abap" } },
    { description: "List every model visible to this tenant's default resource group.", arguments: {} },
  ],
  handler: async (args) => {
    const client = getSharedGenAiClient();
    const result = await client.listModels(args.filter);
    return {
      content: [
        { type: "text" as const, text: `${result.count} model(s) visible in AI Resource Group "${result.resourceGroup}".` },
      ],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
});

export const GENAI_TOOLS: readonly AnyToolSpec[] = [explainWithSapAbap1, listGenaiHubModels];
