import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

import type { AisdkInteraction } from "../abap/aisdk.js";
import { scaffoldAbapAiSdk } from "../abap/aisdk.js";
import { AISDK_TOOLS } from "../tools/aisdk.tools.js";

const INTERACTIONS: AisdkInteraction[] = [
  "string",
  "messages",
  "prompt-template",
  "function-calling",
  "structured-output",
  "streaming",
  "orchestration",
];

describe("scaffoldAbapAiSdk", () => {
  for (const interaction of INTERACTIONS) {
    it(`ROUND-TRIP: "${interaction}" generates a clean abaplint syntax-only pass`, () => {
      const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction });
      expect(r.validationIssues).toEqual([]);
      expect(r.validated).toBe("abaplint-syntax");
      expect(r.files.length).toBeGreaterThanOrEqual(1);
      for (const f of r.files) expect(f.validated).toBe("abaplint-syntax");
    });
  }

  it("keystone: withUnitTest adds a clean-round-tripping testclasses file per interaction", () => {
    for (const interaction of INTERACTIONS) {
      const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction, withUnitTest: true });
      expect(r.validationIssues).toEqual([]);
      expect(r.files.length).toBe(2);
      expect(r.files[1]!.filename).toMatch(/\.clas\.testclasses\.abap$/);
      expect(r.files[1]!.content).toContain("FOR TESTING");
      expect(r.files[1]!.content).toContain("cl_abap_unit_assert=>fail");
      expect(r.files[1]!.content).toContain("cl_abap_testdouble=>create");
    }
  });

  it("function-calling: declares and fills the tool_calls table before ADD_TOOL_RESULTS (regression guard for the upstream SAP sample's bug)", () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_TOOLS", interaction: "function-calling" });
    const src = r.files[0]!.content;
    expect(src).toContain("DATA(tool_calls) = exec_result->get_tool_calls( ).");
    expect(src).toContain("LOOP AT tool_calls INTO DATA(tool_call).");
    expect(src).toContain("messages->add_tool_results( tool_calls = tool_calls ).");
    // The declaration must precede the call that consumes it.
    expect(src.indexOf("DATA(tool_calls) = exec_result->get_tool_calls( ).")).toBeLessThan(
      src.indexOf("messages->add_tool_results( tool_calls = tool_calls )."),
    );
  });

  it("function-calling: without custom functions, emits a demo function definition and says so in nextSteps", () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_TOOLS", interaction: "function-calling" });
    expect(r.files[0]!.content).toContain("register_function( 'get_current_stock_level'");
    expect(r.nextSteps.some((s) => s.includes("demo function"))).toBe(true);
  });

  it("function-calling: with custom functions, registers every one of them and every parameter", () => {
    const r = scaffoldAbapAiSdk({
      scenarioName: "ZDEMO_AI_TOOLS",
      interaction: "function-calling",
      functions: [
        {
          name: "get_superclass",
          description: "Get the superclass of a given class",
          params: [{ name: "class_name", description: "Name of the class", type: "CLASSNAME", required: true }],
        },
        {
          name: "get_method_arguments",
          description: "Get the arguments of a given method in a given class",
          params: [
            { name: "class_name", description: "Name of the class", required: true },
            { name: "method_name", description: "Name of the method" },
          ],
        },
      ],
    });
    const src = r.files[0]!.content;
    expect(src).toContain("register_function( 'get_superclass'");
    expect(src).toContain("register_function( 'get_method_arguments'");
    expect(src).toContain("cl_abap_typedescr=>describe_by_name( 'CLASSNAME' )");
    expect(src).toContain("required = abap_true");
    expect(r.validationIssues).toEqual([]);
  });

  it('prompt-template: uses CL_AIC_ISLM_PROMPT_TPL_FACTORY and never the non-existent CL_AIC_PROMPT_TEMPLATE', () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction: "prompt-template" });
    const src = r.files[0]!.content;
    expect(src).toContain("CL_AIC_ISLM_PROMPT_TPL_FACTORY".toLowerCase());
    expect(src).not.toContain("cl_aic_prompt_template");
    expect(src.toUpperCase()).not.toContain("CL_AIC_PROMPT_TEMPLATE");
  });

  it('orchestration: constraints name all three completion-API features it does not yet support', () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_ORCH", interaction: "orchestration" });
    const joined = r.constraints.join(" ").toLowerCase();
    expect(joined).toContain("structured output");
    expect(joined).toContain("function calling");
    expect(joined).toContain("media input");
    expect(r.files[0]!.content.toLowerCase()).toContain("cl_aic_islm_orch_api_factory");
    expect(r.files[0]!.content.toLowerCase()).toContain("if_aic_orchestration_api");
  });

  it("other interactions' constraints do not carry the orchestration-only limitation note", () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction: "string" });
    const joined = r.constraints.join(" ").toLowerCase();
    expect(joined).not.toContain("does not yet support");
  });

  it("streaming: references IF_AIC_ADT_COMPLETION_API and documents the cast assumption", () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction: "streaming" });
    const src = r.files[0]!.content;
    expect(src.toLowerCase()).toContain("if_aic_adt_completion_api");
    expect(src).toContain("ASSUMPTION");
    expect(r.nextSteps.some((s) => s.includes("IF_AIC_ADT_COMPLETION_API"))).toBe(true);
  });

  it("structured-output: uses DEFINE_RESPONSE_FORMAT->JSON_SCHEMA->FROM_STRING", () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction: "structured-output" });
    const src = r.files[0]!.content.toLowerCase();
    expect(src).toContain("define_response_format( )->json_schema( )->from_string( json_schema )");
  });

  it("generated class names honour the prefix (default and explicit)", () => {
    const z = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction: "string" });
    expect(z.files[0]!.filename).toBe("zcl_ai_string.clas.abap");

    const y = scaffoldAbapAiSdk({ scenarioName: "YDEMO_AI_SCENARIO", interaction: "string", prefix: "Y" });
    expect(y.files[0]!.filename).toBe("ycl_ai_string.clas.abap");

    const custom = scaffoldAbapAiSdk({
      scenarioName: "ZDEMO_AI_SCENARIO",
      interaction: "messages",
      className: "ZCL_MY_AI_HELPER",
    });
    expect(custom.files[0]!.filename).toBe("zcl_my_ai_helper.clas.abap");
    expect(custom.files[0]!.content).toContain("CLASS zcl_my_ai_helper DEFINITION");
  });

  it("rejects a className that does not honour the chosen prefix", () => {
    expect(() =>
      scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction: "string", className: "YCL_WRONG_PREFIX", prefix: "Z" }),
    ).toThrow(/prefix/);
  });

  it("rejects a scenarioName that does not honour the chosen prefix", () => {
    expect(() => scaffoldAbapAiSdk({ scenarioName: "YDEMO_AI_SCENARIO", interaction: "string", prefix: "Z" })).toThrow(/prefix/);
  });

  it("rejects a malformed scenarioName", () => {
    expect(() => scaffoldAbapAiSdk({ scenarioName: "1NOT-VALID", interaction: "string" })).toThrow();
  });

  it("setupSteps mention the SAP_COM_0A69 communication scenario and the F4469/F4470 transactions", () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction: "string" });
    const joined = r.setupSteps.join(" ");
    expect(joined).toContain("SAP_COM_0A69");
    expect(joined).toContain("F4469");
    expect(joined).toContain("F4470");
  });

  it("scopeNote is explicit that this tool never calls an LLM or deploys anything", () => {
    const r = scaffoldAbapAiSdk({ scenarioName: "ZDEMO_AI_SCENARIO", interaction: "string" });
    expect(r.scopeNote).toContain("never calls any LLM");
    expect(r.scopeNote.toLowerCase()).toContain("abaplint-syntax");
  });
});

describe("AISDK_TOOLS rubric (mcp-kit discipline, mirrors server.test.ts)", () => {
  for (const tool of AISDK_TOOLS) {
    describe(tool.name, () => {
      it("is verb-first snake_case and named scaffold_abap_ai_sdk", () => {
        expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(tool.name).toBe("scaffold_abap_ai_sdk");
      });

      it("says when to use it and what it does not do", () => {
        expect(tool.description).toMatch(/Use this when/);
        expect(tool.description).toMatch(/(does not|not a|cannot|does NOT)/);
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

      it("is annotated read-only", () => {
        expect(tool.annotations?.readOnlyHint).toBe(true);
      });
    });
  }

  it("is not registered anywhere yet (F07 ships the tool spec only)", () => {
    expect(AISDK_TOOLS.length).toBe(1);
  });
});
