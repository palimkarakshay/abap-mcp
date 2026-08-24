/** Library surface — embed the tools or the server in your own process. */
export { buildServer, SERVER_INSTRUCTIONS, SERVER_NAME, SERVER_VERSION } from "./server.js";
export { ALL_TOOLS } from "./abap.tools.js";
export { runAbaplint, inferFilename, ABAP_VERSIONS, FOCUS_TAGS } from "./abap/engine.js";
export type { AbapSource, AbapVersion, Finding, FocusTag } from "./abap/engine.js";
export { checkCloudReadiness, gradeReadiness } from "./abap/readiness.js";
export type { ReadinessReport, ReadinessGrade, ReleasedApiFinding } from "./abap/readiness.js";
export { planCloudMigration } from "./abap/plan.js";
export type { MigrationPlan, PlanPhase, PlanWorkItem, PlanEffort } from "./abap/plan.js";
export { fixAbap } from "./abap/fix.js";
export type { FixResult, FixedEntry } from "./abap/fix.js";
export { scaffoldAbapUnit } from "./abap/unittest.js";
export type { UnitTestResult, UnitTestFile } from "./abap/unittest.js";
export { getObjectDependencies } from "./abap/deps.js";
export type { DependencyGraph, DependencyNode, DependencyEdge } from "./abap/deps.js";
export { rewriteRecipeFor } from "./abap/readiness.js";
export type { RewriteRecipe } from "./abap/readiness.js";
export { ALL_PROMPTS, registerPrompts } from "./prompts.js";
export type { PromptSpec } from "./prompts.js";
export { compareAbap } from "./abap/compare.js";
export type { CompareReport, CompareOptions, CompareSide, OutlineChanges } from "./abap/compare.js";
export { lookupReleased, suggestSuccessor, RELEASED_API_SNAPSHOT } from "./abap/released.js";
export type { ReleasedLookup, ReleasedState } from "./abap/released.js";
export { scaffoldRapBo, snakeToCamel } from "./abap/scaffold.js";
export type { ScaffoldOptions, ScaffoldResult } from "./abap/scaffold.js";
export { listRules, explainRule } from "./abap/rules.js";
export { formatAbap } from "./abap/formatter.js";
export { outlineAbap, outlineToMermaid } from "./abap/outline.js";
export type { FileOutline, ClassOutline, MethodOutline } from "./abap/outline.js";
export { defineTool, registerTool, registerTools } from "./tool.js";
export type { ToolSpec, AnyToolSpec, ToolExample } from "./tool.js";
export { McpToolError, invalidInput, notFound } from "./errors.js";
export {
  createHttpServer,
  httpServerOptionsFromEnv,
  startHttpServer,
  DEFAULT_HTTP_HOST,
  DEFAULT_HTTP_PORT,
} from "./http.js";
export type {
  HttpRateLimitOptions,
  HttpServerOptions,
  RunningHttpServer,
} from "./http.js";
