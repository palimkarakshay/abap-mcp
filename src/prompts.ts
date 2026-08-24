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

export const ALL_PROMPTS: readonly PromptSpec[] = [abapReview, abapMentor, abapMigrationPlan];

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
