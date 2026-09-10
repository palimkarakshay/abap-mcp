/**
 * run_abap_unit — offline ABAP Unit execution.
 *
 * These tests actually transpile and execute ABAP, so they are the slowest in
 * the repo (~4 s per run: parse 1.3 s + transpile 2.2 s + node 0.4 s). Each one
 * therefore carries an explicit budget: the point is not only that the result
 * is right but that the loop stays fast enough for an agent to sit in.
 */
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import type { ZodType } from "zod";

import type { UnitRunResult } from "../abap/run.js";
import { filterRunnerScript, RUN_SCOPE_NOTE, runAbapUnit, TEMP_DIR_PREFIX } from "../abap/run.js";
import type { CliIo } from "../cli-commands.js";
import { cmdUnittest } from "../cli-commands.js";
import { McpToolError } from "../errors.js";
import { RUN_TOOLS, RUN_TOOLS_ENABLED } from "../tools/run.tools.js";

/** Wall-clock budget for one full parse → transpile → execute cycle on CI-class hardware. */
const SINGLE_RUN_BUDGET_MS = 12_000;

const CALC = `CLASS zcl_calc DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS add IMPORTING a TYPE i b TYPE i RETURNING VALUE(r) TYPE i.
    METHODS first_of IMPORTING it TYPE string_table RETURNING VALUE(r) TYPE string.
ENDCLASS.
CLASS zcl_calc IMPLEMENTATION.
  METHOD add.
    r = a + b.
  ENDMETHOD.
  METHOD first_of.
    r = it[ 1 ].
  ENDMETHOD.
ENDCLASS.`;

/** One green test, one deliberate assertion failure, one uncaught exception. */
const CALC_TESTS = `CLASS ltcl_calc DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS add_works FOR TESTING.
    METHODS add_fails_on_purpose FOR TESTING.
    METHODS blows_up FOR TESTING.
ENDCLASS.
CLASS ltcl_calc IMPLEMENTATION.
  METHOD add_works.
    cl_abap_unit_assert=>assert_equals( act = NEW zcl_calc( )->add( a = 2 b = 3 ) exp = 5 ).
  ENDMETHOD.
  METHOD add_fails_on_purpose.
    cl_abap_unit_assert=>assert_equals( act = NEW zcl_calc( )->add( a = 2 b = 2 ) exp = 5 msg = 'deliberate failure' ).
  ENDMETHOD.
  METHOD blows_up.
    DATA lt TYPE string_table.
    DATA(lv) = NEW zcl_calc( )->first_of( lt ).
  ENDMETHOD.
ENDCLASS.`;

const SPIN = `CLASS zcl_spin DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS spin.
ENDCLASS.
CLASS zcl_spin IMPLEMENTATION.
  METHOD spin.
    DATA lv TYPE i.
    DO.
      lv = lv + 1.
    ENDDO.
  ENDMETHOD.
ENDCLASS.`;

const SPIN_TESTS = `CLASS ltcl_spin DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS forever FOR TESTING.
ENDCLASS.
CLASS ltcl_spin IMPLEMENTATION.
  METHOD forever.
    NEW zcl_spin( )->spin( ).
  ENDMETHOD.
ENDCLASS.`;

const SELECTS = `CLASS zcl_sel DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS read RETURNING VALUE(r) TYPE i.
ENDCLASS.
CLASS zcl_sel IMPLEMENTATION.
  METHOD read.
    SELECT SINGLE matnr FROM mara INTO @DATA(lv_matnr).
    r = 1.
  ENDMETHOD.
ENDCLASS.`;

const SELECTS_TESTS = `CLASS ltcl_sel DEFINITION FINAL FOR TESTING DURATION SHORT RISK LEVEL HARMLESS.
  PRIVATE SECTION.
    METHODS reads FOR TESTING.
ENDCLASS.
CLASS ltcl_sel IMPLEMENTATION.
  METHOD reads.
    cl_abap_unit_assert=>assert_equals( act = NEW zcl_sel( )->read( ) exp = 1 ).
  ENDMETHOD.
ENDCLASS.`;

function tempDirCount(): number {
  return readdirSync(tmpdir()).filter((n) => n.startsWith(TEMP_DIR_PREFIX)).length;
}

function row(result: UnitRunResult, method: string): UnitRunResult["results"][number] {
  const found = result.results.find((r) => r.methodName === method);
  expect(found, `${method} missing from results`).toBeDefined();
  return found!;
}

describe("runAbapUnit — pass / fail / error", () => {
  let result: UnitRunResult;
  let elapsed = 0;
  let dirsBefore = 0;
  let dirsAfter = 0;

  beforeAll(async () => {
    dirsBefore = tempDirCount();
    const started = Date.now();
    result = await runAbapUnit([
      { filename: "zcl_calc.clas.abap", source: CALC },
      { filename: "zcl_calc.clas.testclasses.abap", source: CALC_TESTS },
    ]);
    elapsed = Date.now() - started;
    dirsAfter = tempDirCount();
  }, 60_000);

  it("runs the tests and reports one structured row per method", () => {
    expect(result.available).toBe(true);
    expect(result.results).toHaveLength(3);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.errored).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it("reports a green method as pass", () => {
    const green = row(result, "ADD_WORKS");
    expect(green.status).toBe("pass");
    expect(green.className).toBe("ZCL_CALC");
    expect(green.testClassName).toBe("LTCL_CALC");
    expect(green.message).toBeUndefined();
  });

  it("reports an assertion failure as fail, with expected and actual", () => {
    const red = row(result, "ADD_FAILS_ON_PURPOSE");
    expect(red.status).toBe("fail");
    expect(red.expected).toBe("5");
    expect(red.actual).toBe("4");
    expect(red.message).toBe("deliberate failure");
    expect(red.jsLocation).toBeDefined();
  });

  it("separates an uncaught exception (error) from an assertion failure (fail)", () => {
    const boom = row(result, "BLOWS_UP");
    expect(boom.status).toBe("error");
    expect(boom.message).toMatch(/uncaught exception/);
    expect(boom.expected).toBeUndefined();
  });

  it("never leaks the temp directory into a result", () => {
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(tmpdir());
    expect(serialized).not.toContain(TEMP_DIR_PREFIX);
  });

  it("removes its temp directory when the run is over", () => {
    expect(dirsAfter).toBe(dirsBefore);
  });

  it("carries the honest scope note and the separate static lint", () => {
    expect(result.scopeNote).toBe(RUN_SCOPE_NOTE);
    expect(result.scopeNote).toContain("not the SAP ABAP kernel");
    expect(result.lint.abapVersion).toBe("Cloud");
    expect(Array.isArray(result.lint.findings)).toBe(true);
    expect(result.transpileIssues).toHaveLength(0);
  });

  it("runs the child under Node's permission model on Node 22+", () => {
    const nodeMajor = Number(process.versions.node.split(".")[0]);
    expect(result.sandbox).toBe(nodeMajor >= 22 ? "node-permission" : "none");
  });

  it("stays inside the wall-clock budget for a single run", () => {
    expect(elapsed).toBeLessThan(SINGLE_RUN_BUDGET_MS);
    expect(result.durationMs.parse).toBeGreaterThan(0);
    expect(result.durationMs.transpile).toBeGreaterThan(0);
    expect(result.durationMs.execute).toBeGreaterThan(0);
  });
});

describe("runAbapUnit — timeout", () => {
  it("kills an endless test and reports it as an error, never as a pass", async () => {
    const started = Date.now();
    const result = await runAbapUnit(
      [
        { filename: "zcl_spin.clas.abap", source: SPIN },
        { filename: "zcl_spin.clas.testclasses.abap", source: SPIN_TESTS },
      ],
      { timeoutMs: 3000 },
    );
    const elapsed = Date.now() - started;

    expect(result.available).toBe(true);
    expect(result.results).toHaveLength(1);
    const forever = row(result, "FOREVER");
    expect(forever.status).toBe("error");
    expect(forever.message).toMatch(/timeout after 3000 ms/);
    expect(result.passed).toBe(0);
    expect(result.errored).toBe(1);
    // The kill has to be effective: parse+transpile+3 s budget, nowhere near
    // the 20 s default, and well inside the suite's own patience.
    expect(elapsed).toBeLessThan(25_000);
  }, 60_000);

  it("caps a caller's timeout at the documented maximum", async () => {
    // 10 minutes asked for; the engine clamps to 60 s — asserted through the
    // reported message rather than by waiting for it.
    const result = await runAbapUnit(
      [
        { filename: "zcl_spin.clas.abap", source: SPIN },
        { filename: "zcl_spin.clas.testclasses.abap", source: SPIN_TESTS },
      ],
      { timeoutMs: 600_000, only: ["ZCL_SPIN>NOTHING_MATCHES"] },
    );
    // Nothing ran (the filter matched no method), so the clamp is observable
    // only through the skip — the point here is that the call returns fast.
    expect(result.skipped).toBe(1);
    expect(result.results[0]!.status).toBe("skipped");
  }, 60_000);
});

describe("runAbapUnit — constructs the offline kernel cannot execute", () => {
  it("reports ABAP SQL as unsupported instead of letting it look green", async () => {
    const result = await runAbapUnit([
      { filename: "zcl_sel.clas.abap", source: SELECTS },
      { filename: "zcl_sel.clas.testclasses.abap", source: SELECTS_TESTS },
    ]);

    expect(result.available).toBe(true);
    const sql = result.unsupported.find((u) => u.reason.includes("MARA"));
    expect(sql, JSON.stringify(result.unsupported)).toBeDefined();
    expect(sql!.file).toBe("zcl_sel.clas.abap");
    expect(sql!.reason).toMatch(/no database/);
    // The database-less run cannot pass — it must surface as an error.
    expect(result.passed).toBe(0);
    expect(row(result, "READS").status).toBe("error");
  }, 60_000);

  it("reports CDS and behavior definitions as not executable", async () => {
    const result = await runAbapUnit([
      {
        filename: "zi_travel.ddls.asddls",
        source: "define root view entity ZI_Travel as select from ztravel { key travel_id }",
      },
    ]);
    expect(result.unsupported).toHaveLength(1);
    expect(result.unsupported[0]!.file).toBe("zi_travel.ddls.asddls");
    expect(result.unsupported[0]!.reason).toMatch(/not executable offline/);
    expect(result.results).toHaveLength(0);
    // No ABAP to run, so nothing was transpiled or executed.
    expect(result.durationMs.transpile).toBe(0);
  }, 30_000);
});

describe("runAbapUnit — only filter", () => {
  it("runs just the selected method and skips the rest", async () => {
    const result = await runAbapUnit(
      [
        { filename: "zcl_calc.clas.abap", source: CALC },
        { filename: "zcl_calc.clas.testclasses.abap", source: CALC_TESTS },
      ],
      { only: ["ZCL_CALC>ADD_WORKS"] },
    );

    expect(result.passed).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.errored).toBe(0);
    expect(result.skipped).toBe(2);
    expect(row(result, "ADD_WORKS").status).toBe("pass");
    expect(row(result, "ADD_FAILS_ON_PURPOSE").status).toBe("skipped");
    expect(row(result, "BLOWS_UP").message).toMatch(/only/);
  }, 60_000);

  it("accepts the local test class on the left of the filter", () => {
    const script = `  ls_input.get().class_name.set("ZCL_CALC");
  ls_input.get().testclass_name.set("LTCL_CALC");
  ls_input.get().method_name.set("ADD_WORKS");
  abap.statements.append({source: ls_input, target: lt_input});
  ls_input.get().class_name.set("ZCL_CALC");
  ls_input.get().testclass_name.set("LTCL_CALC");
  ls_input.get().method_name.set("OTHER");
  abap.statements.append({source: ls_input, target: lt_input});
`;
    const filtered = filterRunnerScript(script, new Set(["ZCL_CALC>LTCL_CALC>ADD_WORKS"]));
    expect(filtered).toContain("ADD_WORKS");
    expect(filtered).not.toContain("OTHER");
  });
});

// `WRITE '@KERNEL ...'.` is @abaplint/transpiler's own raw-JavaScript escape hatch (see
// KERNEL_DIRECTIVE_RE in src/abap/run.ts) — the string after "@KERNEL " is emitted verbatim as
// JavaScript into the module the child executes. This must never reach the transpiler.
const KERNEL_INJECTION = `CLASS zcl_kernel DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    METHODS run.
ENDCLASS.
CLASS zcl_kernel IMPLEMENTATION.
  METHOD run.
    WRITE '@KERNEL require("node:fs").writeFileSync("/tmp/abap-mcp-pwned", "x")'.
  ENDMETHOD.
ENDCLASS.`;

describe("runAbapUnit — @KERNEL rejection", () => {
  it("rejects an @KERNEL directive before any transpile, as a structured 'unsupported' error", async () => {
    const dirsBefore = tempDirCount();
    let caught: unknown;
    try {
      await runAbapUnit([{ filename: "zcl_kernel.clas.abap", source: KERNEL_INJECTION }]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpToolError);
    const err = caught as McpToolError;
    expect(err.kind).toBe("unsupported");
    expect(err.message).toContain("@KERNEL");
    expect(err.hint).toMatch(/remove @KERNEL directives/);
    expect(err.nextTools).toContain("lint_abap");
    // No temp dir was ever created — the rejection happens before mkdtempSync.
    expect(tempDirCount()).toBe(dirsBefore);
  });

  it("matches case-insensitively, wherever in the file list the directive lands", async () => {
    const lowercased = KERNEL_INJECTION.replace("@KERNEL", "@kernel");
    await expect(
      runAbapUnit([
        { filename: "zcl_calc.clas.abap", source: CALC },
        { filename: "zcl_kernel.clas.abap", source: lowercased },
      ]),
    ).rejects.toMatchObject({ kind: "unsupported" });
  });
});

describe("cmdUnittest --run — CLI-level guards", () => {
  function cliIo(): { out: string[]; err: string[]; io: CliIo } {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (s) => out.push(s), err: (s) => err.push(s) } };
  }

  function tinyAbapDir(fileCount: number): string {
    const dir = mkdtempSync(join(tmpdir(), "abap-mcp-cli-unittest-"));
    for (let i = 0; i < fileCount; i++) {
      const name = `zcl_x${String(i).padStart(3, "0")}`;
      writeFileSync(
        join(dir, `${name}.clas.abap`),
        `CLASS ${name} DEFINITION PUBLIC FINAL CREATE PUBLIC.\nENDCLASS.\nCLASS ${name} IMPLEMENTATION.\nENDCLASS.`,
      );
    }
    return dir;
  }

  it("rejects more than 32 files with exit 2 instead of silently truncating", async () => {
    const dir = tinyAbapDir(34);
    const { out, err, io } = cliIo();
    const code = await cmdUnittest(["--run", dir], io);
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/34 files exceed the runner limit of 32/);
    expect(out).toHaveLength(0);
  });

  it("accepts exactly 32 files (the boundary is not off-by-one)", async () => {
    const dir = tinyAbapDir(32);
    const { err, io } = cliIo();
    const code = await cmdUnittest(["--run", dir], io);
    expect(err.join("\n")).not.toMatch(/exceed the runner limit/);
    // 32 classes with no FOR TESTING methods: nothing to run, but the file-count
    // guard itself must not be the thing that rejects it.
    expect(code).toBe(1);
  }, 30_000);

  it("fails instead of exiting 0 when a malformed test include yields zero discovered methods", async () => {
    const dir = mkdtempSync(join(tmpdir(), "abap-mcp-cli-unittest-broken-"));
    writeFileSync(
      join(dir, "zcl_broken.clas.testclasses.abap"),
      // Missing the period after "PRIVATE SECTION" — a genuine parser error.
      `CLASS ltcl_broken DEFINITION FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.\n` +
        `  PRIVATE SECTION\n` +
        `    METHODS whatever FOR TESTING.\n` +
        `ENDCLASS.\n` +
        `CLASS ltcl_broken IMPLEMENTATION.\n` +
        `  METHOD whatever.\n` +
        `  ENDMETHOD.\n` +
        `ENDCLASS.`,
    );
    const { out, err, io } = cliIo();
    const code = await cmdUnittest(["--run", dir], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/no test methods found/);
    expect(err.join("\n")).toMatch(/parser_error|structure/);
    expect(out.join("\n")).toMatch(/0 test method\(s\)/);
  }, 30_000);

  it("fails instead of exiting 0 when the input has no test methods at all", async () => {
    const dir = mkdtempSync(join(tmpdir(), "abap-mcp-cli-unittest-notests-"));
    writeFileSync(
      join(dir, "zcl_plain.clas.abap"),
      "CLASS zcl_plain DEFINITION PUBLIC FINAL CREATE PUBLIC.\n  PUBLIC SECTION.\n    METHODS foo.\nENDCLASS.\nCLASS zcl_plain IMPLEMENTATION.\n  METHOD foo.\n  ENDMETHOD.\nENDCLASS.",
    );
    const { err, io } = cliIo();
    const code = await cmdUnittest(["--run", dir, "--json"], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toBe("");
  }, 30_000);

  it("rejects an @KERNEL submission at the CLI too, with exit 1 and the structured hint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "abap-mcp-cli-unittest-kernel-"));
    writeFileSync(join(dir, "zcl_kernel.clas.abap"), KERNEL_INJECTION);
    const { out, err, io } = cliIo();
    const code = await cmdUnittest(["--run", dir], io);
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/^unsupported:/m);
    expect(err.join("\n")).toContain("@KERNEL");
    expect(err.join("\n")).toMatch(/hint: remove @KERNEL directives/);
    expect(out).toHaveLength(0);
  }, 30_000);
});

describe("run_abap_unit tool description rubric (mcp-kit discipline)", () => {
  const VERBS = ["get", "list", "search", "run", "create", "check", "compare", "lint", "scaffold", "explain", "format", "plan", "fix"];

  it("is opt-in on the MCP surface", () => {
    expect(RUN_TOOLS_ENABLED).toBe(process.env["ABAP_MCP_ENABLE_RUN"] === "1");
    expect(RUN_TOOLS).toHaveLength(1);
  });

  for (const tool of RUN_TOOLS) {
    describe(tool.name, () => {
      it("is verb-first snake_case", () => {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(VERBS).toContain(tool.name.split("_")[0]);
      });

      it("says when to use it and what it does not do", () => {
        expect(tool.description).toMatch(/Use this when/);
        expect(tool.description).toMatch(/(does not|not a|cannot|is NOT)/);
      });

      it("declares up front that it executes code in a subprocess", () => {
        expect(tool.description).toContain("runs the transpiled JavaScript in a local subprocess");
      });

      it("describes every input parameter", () => {
        for (const [field, schema] of Object.entries(tool.inputSchema)) {
          const description = (schema as ZodType).description;
          expect(description, `${tool.name}.${field} needs .describe()`).toBeTruthy();
          expect(description!.length).toBeGreaterThanOrEqual(12);
        }
      });

      it("ships at least two worked examples", () => {
        expect(tool.examples?.length ?? 0).toBeGreaterThanOrEqual(2);
      });

      it("is annotated read-only, closed-world, idempotent and non-destructive", () => {
        expect(tool.annotations?.readOnlyHint).toBe(true);
        expect(tool.annotations?.openWorldHint).toBe(false);
        expect(tool.annotations?.idempotentHint).toBe(true);
        expect(tool.annotations?.destructiveHint).toBe(false);
      });
    });
  }

  it("is not registered on the default server surface", async () => {
    const { tools } = await import("../abap.tools.js");
    expect(tools.some((t) => t.name === "run_abap_unit")).toBe(false);
  });
});
