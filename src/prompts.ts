/**
 * MCP prompts — the packaged "consultant" workflows.
 *
 * Tools give an agent ABAP senses; these prompts give it the consultant's
 * playbook for using them, one click from any prompt-capable client (in
 * Claude Code they surface as /mcp__abap-mcp__… slash commands). Same
 * single-source-of-truth discipline as ToolSpec: one PromptSpec object is
 * both the registration and the testable artifact.
 *
 * Prompts steer; they never claim abilities the tools don't have — every
 * instruction grounds in a real tool and repeats the honesty boundaries
 * (static analysis, no system, snapshot-dated released-API data).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface PromptSpec {
  /** Prompt name — shown as the slash-command / prompt id in clients. */
  name: string;
  title: string;
  description: string;
  /** MCP prompt arguments are strings; every one optional and described. */
  args: Record<string, z.ZodOptional<z.ZodString>>;
  /** Build the user-role message text from the (string) arguments. */
  build: (args: Record<string, string | undefined>) => string;
}

export const abapReview: PromptSpec = {
  name: "abap-review",
  title: "Review ABAP code like a senior consultant",
  description:
    "Run a full code review over ABAP the user provides or names: lint, triage, explain each finding's why, " +
    "propose minimal fixes, and prove the rework with compare_abap. Optionally focused (Performance / Security / Styleguide).",
  args: {
    focus: z
      .string()
      .optional()
      .describe('Optional themed lens for the review: "Performance", "Security" or "Styleguide".'),
    target: z
      .string()
      .optional()
      .describe("Optional hint at what to review: pasted code, file names, or a directory in the workspace."),
  },
  build: (a) => {
    const focusLine =
      a["focus"] !== undefined
        ? ` Run the pass with focus "${a["focus"]}" so the review stays on that theme.`
        : "";
    const targetLine =
      a["target"] !== undefined
        ? `\nThe code under review: ${a["target"]}.`
        : "\nIf it is unclear which code to review, ask before assuming.";
    return (
      "Act as a senior SAP ABAP code reviewer. The abap-mcp tools are connected — ground every claim in them; never guess what a linter would say." +
      targetLine +
      "\n\nReview procedure:\n" +
      `1. Run lint_abap over the complete sources.${focusLine}\n` +
      "2. Triage: group findings by severity and lead with what would break or bite in production, not with style nits.\n" +
      "3. For each finding worth acting on, show the offending line, explain WHY the rule exists (use explain_abap_rule when the rationale matters), and propose a minimal concrete fix.\n" +
      "4. Prove the rework: after applying fixes, re-run lint_abap, and run compare_abap before-vs-after to show nothing was introduced and the readiness grade did not regress.\n" +
      "5. When the code targets ABAP Cloud, also run check_cloud_readiness and report the verdict.\n" +
      "6. Close with a clear verdict: ready to commit, or the shortlist of fixes that gate it.\n\n" +
      "Calibrate depth to the reader — concise for experienced ABAP developers, more teaching when the user seems new. " +
      "Be honest about limits: this is static analysis on the provided text; no SAP system, no ATC."
    );
  },
};

export const abapMentor: PromptSpec = {
  name: "abap-mentor",
  title: "Over-the-shoulder ABAP/RAP mentor",
  description:
    "Turn the session into a patient senior-consultant mentoring mode: every snippet the user shares is quietly " +
    "linted and readiness-checked, findings become plain-language guidance, new objects start from validated scaffolds.",
  args: {
    goal: z
      .string()
      .optional()
      .describe('Optional learning goal to steer toward, e.g. "build my first RAP BO" or "pass C_ABAPD".'),
  },
  build: (a) => {
    const goalLine =
      a["goal"] !== undefined
        ? `\nThe user's current goal: ${a["goal"]}. Steer examples and next steps toward it.`
        : "";
    return (
      "Act as a patient senior SAP ABAP & RAP consultant sitting next to the user — an over-the-shoulder mentor, not a lecturer. " +
      "The abap-mcp tools are connected; ground everything you teach in them." +
      goalLine +
      "\n\nStanding behavior for the rest of this session:\n" +
      "- Whenever the user shares ABAP code, quietly run lint_abap (default style preset) and, when relevant, check_cloud_readiness before answering; weave the important findings into your reply as guidance, never as a raw finding dump.\n" +
      "- Explain one concept at a time in plain language with the smallest possible ABAP example. When a rule fires, use explain_abap_rule and translate the rationale into beginner terms — why SAP wants it that way, not just what to change.\n" +
      "- When the user starts something new, offer scaffold_rap_bo and walk through the generated files one by one, in activation order, saying what each artifact is for.\n" +
      '- For "what does this code do" questions on big objects, run get_abap_outline first and explain the structure top-down before any line-level detail.\n' +
      "- Correct misconceptions gently, name what is already clean, and end every answer with the single most useful next step.\n\n" +
      "Never invent system behavior: these tools are static and offline — no SAP system, no ATC — and say so when it matters."
    );
  },
};

export const abapMigrationPlan: PromptSpec = {
  name: "abap-migration-plan",
  title: "Produce a phased ABAP Cloud migration plan",
  description:
    "Drive plan_cloud_migration over the sources in scope and present a client-ready phased backlog — current state, " +
    "phases with effort bands and exit criteria, released-API work separated — then offer to execute phase 1.",
  args: {
    scope: z
      .string()
      .optional()
      .describe("Optional scope hint: a directory, an abapGit package path, or a description of the objects in scope."),
    baseline: z
      .string()
      .optional()
      .describe('Optional classic baseline version the code runs on today (default "v758").'),
  },
  build: (a) => {
    const scopeLine =
      a["scope"] !== undefined
        ? ` The scope: ${a["scope"]}.`
        : " If the workspace has an abapGit checkout use those sources; otherwise ask the user what is in scope.";
    const baselineLine =
      a["baseline"] !== undefined ? ` Use baselineVersion "${a["baseline"]}".` : "";
    return (
      "Act as the lead consultant producing an ABAP Cloud migration plan. The abap-mcp tools are connected.\n\n" +
      `1. Collect the ABAP sources in scope.${scopeLine}\n` +
      `2. Run plan_cloud_migration over them.${baselineLine} For a large repo, batch the files and consolidate the phases by title.\n` +
      "3. Present a client-ready plan: current state first (score, grade, blocker count and what they mean), then each phase as a numbered backlog — goal, work items (object, category, effort S/M/L), remediation recipe, and its exit criteria as the definition of done.\n" +
      "4. Keep released-API work in its own phase, labeled with the bundled snapshot date, and say plainly that the target system's ATC is authoritative for API release state.\n" +
      "5. Be honest about scope: this is static, parser-level analysis — no SAP system was contacted, effort bands are not person-days, and a 'ready' verdict is not a certification.\n" +
      "6. Offer to start executing: take the first item of the first phase, fix it, prove the rework with compare_abap, and re-run the readiness check so the user sees the score move."
    );
  },
};

export const abapFromSpec: PromptSpec = {
  name: "abap-from-spec",
  title: "Build ABAP/RAP from a functional or technical spec",
  description:
    "Turn a written spec into working, validated modern ABAP/RAP — no blank page: restate the spec as a build plan, " +
    "scaffold the validated RAP foundation, implement behaviors, gate every file through fix_abap + lint_abap until " +
    "clean, generate and fill unit tests, and deliver in activation order with an assumptions register.",
  args: {
    spec: z
      .string()
      .optional()
      .describe("The functional/technical spec: paste it, name a file in the workspace, or describe the requirement in plain language."),
    baseline: z
      .string()
      .optional()
      .describe('Target ABAP level: "Cloud" (default — modern RAP for ABAP Cloud) or a classic version like "v758".'),
  },
  build: (a) => {
    const specLine =
      a["spec"] !== undefined
        ? `\nThe spec: ${a["spec"]}`
        : "\nAsk the user for the spec — pasted text, a workspace file, or a plain-language description all work.";
    const baseline = a["baseline"] ?? "Cloud";
    return (
      "Act as a senior SAP ABAP & RAP consultant who turns a written spec into working, validated code. " +
      "The abap-mcp tools are connected — nothing you deliver may bypass their gates." +
      specLine +
      `\nTarget ABAP level: ${baseline}.` +
      "\n\nBuild procedure:\n" +
      "1. INTAKE — restate the spec as a build plan: entities and their relationships, key fields, behaviors (draft handling, actions, validations, determinations), services and consumers, constraints. List open questions, but ask only those that block the data model — propose sensible defaults for everything else and mark each one ASSUMPTION so the consultant can veto it.\n" +
      "2. FOUNDATION, deterministic first — for each root entity run scaffold_rap_bo (draft enabled unless the spec says otherwise) and use its suggested table DDL. Never hand-write an artifact the validated generator can produce.\n" +
      "3. BEHAVIOR — implement the spec's logic in the scaffolded behavior-implementation classes (validations, determinations, actions). Modern ABAP only: constructor expressions, ABAP SQL, no obsolete statements.\n" +
      "4. GATE EVERY FILE — run fix_abap first so mechanical issues never reach review, then lint_abap at the target level on every artifact you write; a file is not done until findings are zero or consciously waived with a stated reason. Across the whole package, check_cloud_readiness must come back grade A when the target is Cloud.\n" +
      "5. TESTS — run scaffold_abap_unit on every class, then replace the failing skeletons with the spec's acceptance criteria as given/when/then. A test that passes trivially is not done.\n" +
      "6. DELIVER — present the file set in activation order, the assumptions register, what remains manual (service binding, authorizations, transport), and the honest limits: behavior/service definitions are template-validated and ADT activation is the final arbiter.\n\n" +
      "Never deliver code you have not linted. If the spec is too thin to derive a data model, say exactly what is missing instead of guessing."
    );
  },
};

export const ALL_PROMPTS: readonly PromptSpec[] = [abapReview, abapMentor, abapMigrationPlan, abapFromSpec];

export function registerPrompts(server: McpServer, specs: readonly PromptSpec[]): void {
  for (const spec of specs) {
    server.registerPrompt(
      spec.name,
      { title: spec.title, description: spec.description, argsSchema: spec.args },
      (args: Record<string, string | undefined>) => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: spec.build(args ?? {}) },
          },
        ],
      }),
    );
  }
}
