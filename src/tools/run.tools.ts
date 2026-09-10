/**
 * run_abap_unit — the executable half of the agent feedback loop.
 *
 * Opt-in on the MCP surface: this is the only tool in the package that starts a
 * process, so it ships behind ABAP_MCP_ENABLE_RUN=1 (RUN_TOOLS_ENABLED) and the
 * server registers it only when the operator asked for it. The CLI
 * (`abap-mcp unittest --run`) always has it — a developer running our binary
 * already chose to execute code on their machine.
 *
 * The engine is src/abap/run.ts; this file is the model-facing contract.
 */
import { z } from "zod";

import { ABAP_VERSIONS } from "../abap/engine.js";
import type { UnitRunResult } from "../abap/run.js";
import { RUN_DEFAULT_TIMEOUT_MS, RUN_MAX_TIMEOUT_MS, runAbapUnit } from "../abap/run.js";
import type { AnyToolSpec } from "../tool.js";
import { defineTool } from "../tool.js";

/**
 * Executing transpiled code is a different trust decision from parsing text,
 * so the MCP surface stays opt-in: the operator sets ABAP_MCP_ENABLE_RUN=1.
 */
export const RUN_TOOLS_ENABLED = process.env["ABAP_MCP_ENABLE_RUN"] === "1";

const filesField = z
  .array(
    z.object({
      filename: z
        .string()
        .optional()
        .describe(
          'abapGit-style name, e.g. "zcl_calc.clas.abap" for the class under test and "zcl_calc.clas.testclasses.abap" for its local test class. Omit it and the type is inferred from the source (CLASS → class, INTERFACE → interface).',
        ),
      source: z.string().describe("The complete ABAP source text of this file."),
    }),
  )
  .min(1)
  .max(32)
  .describe(
    "The classes under test AND their .clas.testclasses.abap test includes, up to 32 files per call, 100k chars each. Everything a test touches must be in the call — there is no system to resolve it from.",
  );

export const runAbapUnitTool = defineTool({
  name: "run_abap_unit",
  title: "Run ABAP Unit tests offline",
  description:
    "Execute the ABAP Unit tests in the provided sources offline: the code is transpiled to JavaScript by " +
    "@abaplint/transpiler against the bundled open-abap kernel library, and this tool then runs the transpiled " +
    "JavaScript in a local subprocess (server-owned temp directory, hard timeout, scrubbed environment, no shell, " +
    "no network) and returns one structured row per test method — pass / fail / error / skipped with the assertion's " +
    "expected and actual values, the message, the runtime and the JavaScript location. The honest static lint at your " +
    "target ABAP version comes back in the same result, independent of the run. " +
    "Use this when you have just written or changed ABAP logic and want real execution feedback before it goes near a " +
    "system — the red-green loop for algorithms, calculations, parsing, string/table handling and refactorings, and the " +
    "verification step after fix_abap or a model rewrite. " +
    "It is NOT the SAP ABAP kernel: there is no database (any ABAP SQL aborts the method), no CDS, no EML/RAP runtime, " +
    "no AMDP, no authority checks and no locks; it does not connect to a system, does not activate anything, does not " +
    "run ATC, and cannot prove the code behaves the same on SAP's kernel — a green run is evidence about pure logic, " +
    "and ABAP Unit on a real system remains authoritative. Constructs it cannot execute come back in `unsupported` " +
    "rather than as a false pass. Takes ~4 s per call (parse + transpile dominate). " +
    'Example: run_abap_unit({ "files": [ { "filename": "zcl_calc.clas.abap", "source": "CLASS zcl_calc DEFINITION PUBLIC FINAL CREATE PUBLIC.\\n…" }, { "filename": "zcl_calc.clas.testclasses.abap", "source": "CLASS ltcl_calc DEFINITION FINAL FOR TESTING…" } ] }).',
  inputSchema: {
    files: filesField,
    abapVersion: z
      .enum(ABAP_VERSIONS)
      .default("Cloud")
      .describe(
        'ABAP language version for the separate, honest static lint returned in `lint` ("Cloud" for ABAP Cloud). It does not change how the code is executed — the transpiler always runs at the open-abap level.',
      ),
    only: z
      .array(z.string())
      .optional()
      .describe(
        'Run only these test methods, each as "CLASS>METHOD" (e.g. "ZCL_CALC>ADD_WORKS"; the local test class name works too: "LTCL_CALC>ADD_WORKS"). Everything else comes back with status "skipped". Use it to iterate on one red test.',
      ),
    timeoutMs: z
      .number()
      .int()
      .optional()
      .describe(
        `Wall-clock budget for the test subprocess in milliseconds; default ${RUN_DEFAULT_TIMEOUT_MS}, capped at ${RUN_MAX_TIMEOUT_MS}. On a timeout the process is killed and every method that had not reported yet comes back as "error", never as a pass.`,
      ),
  },
  outputSchema: {
    available: z
      .boolean()
      .describe("False when the run could not be attempted at all (see `unavailable`); the lint is still valid."),
    unavailable: z
      .object({
        kind: z.string().describe("library-bundle-missing | transpiler-not-resolvable | runtime-not-resolvable."),
        message: z.string().describe("What went wrong."),
        hint: z.string().describe("How to fix it."),
      })
      .optional()
      .describe("Present only when available is false."),
    results: z
      .array(
        z.object({
          className: z.string().describe("Global class the test class belongs to."),
          testClassName: z.string().describe("Local FOR TESTING class."),
          methodName: z.string().describe("Test method."),
          status: z
            .enum(["pass", "fail", "error", "skipped"])
            .describe("pass = green; fail = an assertion said no; error = it blew up or never reported; skipped = filtered out."),
          expected: z.string().optional().describe("Expected value from cl_abap_unit_assert."),
          actual: z.string().optional().describe("Actual value from cl_abap_unit_assert."),
          message: z.string().optional().describe("Assertion message, or why the method did not report."),
          runtimeMs: z.number().describe("Runtime the open-abap runner measured for this method."),
          jsLocation: z.string().optional().describe("Location in the transpiled JavaScript."),
          console: z.string().optional().describe("What the method wrote to the console."),
        }),
      )
      .describe("One row per test method — the whole point of the tool."),
    passed: z.number().describe("Count of green methods."),
    failed: z.number().describe("Count of methods an assertion failed."),
    errored: z.number().describe("Count of methods that blew up, timed out or never reported."),
    skipped: z.number().describe("Count of methods not selected by `only`."),
    unsupported: z
      .array(
        z.object({
          file: z.string().describe("The file the construct is in."),
          reason: z.string().describe("Which construct, on which line, and why it cannot run offline."),
        }),
      )
      .describe("Constructs the offline kernel cannot execute (ABAP SQL, CALL FUNCTION, EML, AUTHORITY-CHECK, AMDP, CDS/BDEF inputs) — read this before trusting a green run."),
    lint: z
      .object({
        findings: z.array(z.unknown()).describe("abaplint syntax-only findings at abapVersion."),
        abapVersion: z.string().describe("The version the lint ran at."),
      })
      .describe("The honest static lint, run separately from the execution."),
    transpileIssues: z
      .array(z.unknown())
      .describe("Parser / syntax problems at open-abap level that stopped or endangered the transpile."),
    durationMs: z
      .object({
        parse: z.number().describe("Registry parse, including the bundled library."),
        transpile: z.number().describe("ABAP → JavaScript."),
        execute: z.number().describe("The subprocess."),
      })
      .describe("Where the time went."),
    sandbox: z
      .enum(["node-permission", "none"])
      .describe('"node-permission" when the subprocess ran under Node\'s permission model (Node ≥ 22: read-only access to the run\'s temp dir and the runtime package only); "none" on older Node.'),
    scopeNote: z.string().describe("The standing honesty label: open-abap kernel, not SAP's."),
  },
  annotations: {
    readOnlyHint: true,
    openWorldHint: false,
    idempotentHint: true,
    destructiveHint: false,
  },
  examples: [
    {
      description: "Red-green loop: run a calculator class together with its local test class.",
      arguments: {
        files: [
          {
            filename: "zcl_calc.clas.abap",
            source:
              "CLASS zcl_calc DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS add IMPORTING a TYPE i b TYPE i RETURNING VALUE(r) TYPE i.\nENDCLASS.\nCLASS zcl_calc IMPLEMENTATION.\n  METHOD add.\n    r = a + b.\n  ENDMETHOD.\nENDCLASS.",
          },
          {
            filename: "zcl_calc.clas.testclasses.abap",
            source:
              "CLASS ltcl_calc DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.\n  PRIVATE SECTION.\n    METHODS add_works FOR TESTING.\nENDCLASS.\nCLASS ltcl_calc IMPLEMENTATION.\n  METHOD add_works.\n    cl_abap_unit_assert=>assert_equals( act = NEW zcl_calc( )->add( a = 2 b = 3 ) exp = 5 ).\n  ENDMETHOD.\nENDCLASS.",
          },
        ],
      },
    },
    {
      description:
        "Iterate on the one method that is red, with a shorter budget and the lint pinned to the classic baseline.",
      arguments: {
        files: [
          { filename: "zcl_calc.clas.abap", source: "CLASS zcl_calc DEFINITION PUBLIC FINAL CREATE PUBLIC.\n…" },
          { filename: "zcl_calc.clas.testclasses.abap", source: "CLASS ltcl_calc DEFINITION FINAL FOR TESTING…" },
        ],
        only: ["ZCL_CALC>ADD_WORKS"],
        timeoutMs: 10000,
        abapVersion: "v758",
      },
    },
  ],
  handler: async (args) => {
    const options: Parameters<typeof runAbapUnit>[1] = { abapVersion: args.abapVersion };
    if (args.only !== undefined) options.only = args.only;
    if (args.timeoutMs !== undefined) options.timeoutMs = args.timeoutMs;
    const result: UnitRunResult = await runAbapUnit(args.files, options);

    const text = result.available
      ? `${result.passed} passed, ${result.failed} failed, ${result.errored} errored, ${result.skipped} skipped ` +
        `in ${result.durationMs.parse + result.durationMs.transpile + result.durationMs.execute} ms` +
        (result.unsupported.length > 0 ? `; ${result.unsupported.length} construct(s) cannot run offline` : "") +
        (result.transpileIssues.length > 0 ? `; ${result.transpileIssues.length} transpile issue(s)` : "") +
        `. ${result.scopeNote}`
      : `Offline execution unavailable (${result.unavailable?.kind ?? "unknown"}): ${result.unavailable?.message ?? ""} ${result.unavailable?.hint ?? ""}`;

    return {
      content: [{ type: "text" as const, text }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
});

export const RUN_TOOLS: readonly AnyToolSpec[] = [runAbapUnitTool];
