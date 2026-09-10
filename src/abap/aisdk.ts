/**
 * ABAP AI SDK (powered by ISLM) scaffolder.
 *
 * Generates ONE validated global class per "interaction" shape documented for
 * SAP's Generative AI Hub client library — the ABAP AI SDK powered by
 * Intelligent Scenario Lifecycle Management (ISLM): a simple string prompt, a
 * multi-turn message prompt, an ISLM prompt-template lookup, the function
 * (tool) calling DO-loop, structured JSON output, streaming, and the separate
 * Orchestration API. Every generated class carries an injectable factory seam
 * (an OPTIONAL constructor parameter) so it can be unit-tested with
 * cl_abap_testdouble instead of hitting a live ISLM scenario.
 *
 * Same honesty tiering as scaffold.ts / unittest.ts: generated code is
 * round-tripped through abaplint (preset syntax-only, version Cloud) together
 * with abap-mcp's OWN bundled stub declarations of the IF_AIC_*, CL_AIC_*,
 * CX_AIC_* types it references (src/data/aic-stubs/*.abap — our own minimal
 * signatures, not SAP source). That proves the generated ABAP PARSES; it does
 * NOT prove it matches SAP's real API surface exactly, and unlike
 * scaffold_rap_bo's "abaplint" label (checked against the real language) this
 * is checked only against our own stand-in types — hence the distinct label
 * `validated: "abaplint-syntax"`. This tool never calls any LLM, never
 * creates/publishes/deploys/activates an Intelligent Scenario, and has no
 * network access — see `scopeNote` and `setupSteps` on the result.
 *
 * Facts, class/method shapes and the SAP_COM_0A69 / INTS / INTM / F4469 / F4470
 * setup sequence are curated in src/data/abap-ai-sdk.json from a fact-checked
 * research corpus (curatedDate below); every non-obvious claim traces there.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import DATA from "../data/abap-ai-sdk.json" with { type: "json" };
import { invalidInput } from "../errors.js";
import type { Finding } from "./engine.js";
import { runAbaplint } from "./engine.js";

export type AisdkInteraction =
  | "string"
  | "messages"
  | "prompt-template"
  | "function-calling"
  | "structured-output"
  | "streaming"
  | "orchestration";

export interface AisdkFunctionParam {
  name: string;
  description: string;
  /** DDIC type name passed to cl_abap_typedescr=>describe_by_name( ), e.g. "MATNR". */
  type?: string | undefined;
  required?: boolean | undefined;
}

export interface AisdkFunction {
  name: string;
  description: string;
  params: AisdkFunctionParam[];
}

export interface AisdkOptions {
  /** ISLM intelligent-scenario name the generated class calls, e.g. "ZDEMO_AI_SCENARIO". */
  scenarioName: string;
  interaction: AisdkInteraction;
  /** Generated global class name. Defaults to "<prefix>CL_AI_<INTERACTION>". */
  className?: string | undefined;
  prefix?: "Z" | "Y" | undefined;
  /** Tool/function definitions for interaction "function-calling"; a demo function is used when omitted. */
  functions?: AisdkFunction[] | undefined;
  /** Also generate a FOR TESTING skeleton using the injectable seam + cl_abap_testdouble. */
  withUnitTest?: boolean | undefined;
}

export interface AisdkFile {
  filename: string;
  content: string;
  /** Round-tripped through abaplint at Cloud/syntax-only against our OWN bundled AIC stubs — not the real SDK. */
  validated: "abaplint-syntax";
}

export interface AisdkResult {
  files: AisdkFile[];
  setupSteps: string[];
  constraints: string[];
  nextSteps: string[];
  /** abaplint findings on the generated sources — empty on a clean round-trip. */
  validationIssues: Finding[];
  validated: "abaplint-syntax";
  scopeNote: string;
}

const KNOWLEDGE = DATA as {
  curatedDate: string;
  setupSteps: string[];
  constraints: string[];
  orchestrationLimitations: string[];
};

const IDENT_RE = /^[A-Za-z][A-Za-z0-9_]{0,29}$/;

const INTERACTION_SUFFIX: Record<AisdkInteraction, string> = {
  string: "STRING",
  messages: "MESSAGES",
  "prompt-template": "PROMPT_TPL",
  "function-calling": "FUNC_CALL",
  "structured-output": "STRUCT_OUT",
  streaming: "STREAM",
  orchestration: "ORCH",
};

/** The type the generated class's injectable constructor seam is typed against. */
const SEAM_TYPE: Record<AisdkInteraction, string> = {
  string: "if_aic_completion_api",
  messages: "if_aic_completion_api",
  "prompt-template": "if_aic_completion_api",
  "function-calling": "if_aic_completion_api",
  "structured-output": "if_aic_completion_api",
  streaming: "if_aic_adt_completion_api",
  orchestration: "if_aic_orchestration_api",
};

const DEFAULT_FUNCTIONS: AisdkFunction[] = [
  {
    name: "get_current_stock_level",
    description: "Look up the current stock level for a material.",
    params: [
      { name: "material_id", description: "Material number to look up.", type: "MATNR", required: true },
    ],
  },
];

/** Double any embedded `'` so a value is safe inside a single-quoted ABAP literal. */
function abapString(s: string): string {
  return s.replace(/'/g, "''");
}

function validateInput(o: AisdkOptions): { prefix: "Z" | "Y"; scenarioName: string; classNameLower: string } {
  const prefix = o.prefix ?? "Z";
  if (!IDENT_RE.test(o.scenarioName)) {
    throw invalidInput(
      `scenarioName "${o.scenarioName}" must start with a letter and contain only letters, digits and underscores (≤30 chars).`,
    );
  }
  if (!new RegExp(`^${prefix.toLowerCase()}`).test(o.scenarioName.toLowerCase())) {
    throw invalidInput(`scenarioName "${o.scenarioName}" must start with the ${prefix} namespace prefix.`);
  }
  const className = o.className ?? `${prefix}CL_AI_${INTERACTION_SUFFIX[o.interaction]}`;
  if (!IDENT_RE.test(className)) {
    throw invalidInput(`className "${className}" must be a valid ABAP class name (≤30 chars).`);
  }
  if (!new RegExp(`^${prefix.toLowerCase()}`).test(className.toLowerCase())) {
    throw invalidInput(`className "${className}" must start with the ${prefix} namespace prefix.`);
  }
  return { prefix, scenarioName: o.scenarioName, classNameLower: className.toLowerCase() };
}

function buildHeader(interaction: AisdkInteraction, scenario: string): string {
  const lines = [
    `"! Generated by abap-mcp scaffold_abap_ai_sdk (interaction: ${interaction}).`,
    `"! Calls the SAP Generative AI Hub through the ABAP AI SDK powered by ISLM.`,
    `"! Requires an activated Intelligent Scenario named '${abapString(scenario)}' — see the tool's setupSteps.`,
    `"! Round-tripped through abaplint at Cloud level, preset syntax-only, against abap-mcp's own`,
    `"! bundled IF_AIC_*/CL_AIC_*/CX_AIC_* stubs only: validated:"abaplint-syntax" means the ABAP`,
    `"! parses, NOT that it matches the real SAP AI SDK surface exactly — verify in ADT.`,
  ];
  if (interaction === "orchestration") {
    lines.push(
      '"! LIMITATION: the Orchestration API does not yet support structured output, function',
      '"! calling, or media input — use the other interaction variants (Completion API) for those.',
    );
  }
  if (interaction === "streaming") {
    lines.push(
      '"! ASSUMPTION: casts the completion-API instance to IF_AIC_ADT_COMPLETION_API. SAP documents',
      '"! the streaming interface and its methods but not the exact factory call for obtaining one —',
      '"! this cast is abap-mcp\'s own documented assumption; verify it resolves in ADT.',
    );
  }
  return lines.join("\n");
}

function renderFunctionRegistration(fn: AisdkFunction): string {
  // Each segment's closing paren is deferred to the NEXT segment's leading ")->" (SAP's own
  // chaining style — see VERIFIED.md's function-calling sample): only the final call
  // (set_description) closes itself, right before the statement-terminating ".".
  const paramSegments = fn.params.map((p) => {
    const args = [`name = '${abapString(p.name)}'`, `description = '${abapString(p.description)}'`];
    if (p.type !== undefined) args.push(`type = cl_abap_typedescr=>describe_by_name( '${abapString(p.type.toUpperCase())}' )`);
    if (p.required !== undefined) args.push(`required = ${p.required ? "abap_true" : "abap_false"}`);
    return `       )->add_parameter( ${args.join("\n                         ")}`;
  });
  const chain = [
    `    me->api->register_function( '${abapString(fn.name)}'`,
    ...paramSegments,
    `       )->set_description( '${abapString(fn.description)}' ).`,
  ];
  return chain.join("\n");
}

function buildClassSource(interaction: AisdkInteraction, classNameLower: string, scenario: string, functions: AisdkFunction[]): string {
  const header = buildHeader(interaction, scenario);
  const escapedScenario = abapString(scenario);

  switch (interaction) {
    case "string":
      return `${header}
CLASS ${classNameLower} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Injectable factory seam: pass a test double in unit tests; omit it to use the
    "! real ISLM completion API.
    METHODS constructor
      IMPORTING api TYPE REF TO if_aic_completion_api OPTIONAL
      RAISING   cx_aic_api_factory.

    METHODS run
      IMPORTING user_prompt   TYPE string
                temperature   TYPE string DEFAULT '0.5'
      RETURNING VALUE(result) TYPE string
      RAISING   cx_aic_completion_api.
  PRIVATE SECTION.
    DATA api TYPE REF TO if_aic_completion_api.
    CONSTANTS scenario TYPE string VALUE '${escapedScenario}'.
ENDCLASS.

CLASS ${classNameLower} IMPLEMENTATION.

  METHOD constructor.
    IF api IS BOUND.
      me->api = api.
    ELSE.
      me->api = cl_aic_islm_compl_api_factory=>get( )->create_instance( scenario ).
    ENDIF.
  ENDMETHOD.

  METHOD run.
    me->api->get_parameter_setter( )->set_temperature( temperature ).
    result = me->api->execute_for_string( user_prompt )->get_completion( ).
  ENDMETHOD.

ENDCLASS.
`;

    case "messages":
      return `${header}
CLASS ${classNameLower} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Injectable factory seam: pass a test double in unit tests; omit it to use the
    "! real ISLM completion API.
    METHODS constructor
      IMPORTING api TYPE REF TO if_aic_completion_api OPTIONAL
      RAISING   cx_aic_api_factory.

    METHODS run
      IMPORTING system_role   TYPE string
                user_message  TYPE string
      RETURNING VALUE(result) TYPE string
      RAISING   cx_aic_completion_api.

    "! Same call, plus token counts and finish reason for logging/observability.
    METHODS run_with_metadata
      IMPORTING system_role       TYPE string
                user_message      TYPE string
      EXPORTING completion        TYPE string
                total_token_count TYPE i
                finish_reason     TYPE string
      RAISING   cx_aic_completion_api.
  PRIVATE SECTION.
    DATA api TYPE REF TO if_aic_completion_api.
    CONSTANTS scenario TYPE string VALUE '${escapedScenario}'.
ENDCLASS.

CLASS ${classNameLower} IMPLEMENTATION.

  METHOD constructor.
    IF api IS BOUND.
      me->api = api.
    ELSE.
      me->api = cl_aic_islm_compl_api_factory=>get( )->create_instance( scenario ).
    ENDIF.
  ENDMETHOD.

  METHOD run.
    DATA(messages) = me->api->create_message_container( ).
    messages->set_system_role( system_role = system_role ).
    messages->add_user_message( message = user_message ).
    result = me->api->execute_for_messages( messages = messages )->get_completion( ).
  ENDMETHOD.

  METHOD run_with_metadata.
    DATA(messages) = me->api->create_message_container( ).
    messages->set_system_role( system_role = system_role ).
    messages->add_user_message( message = user_message ).
    DATA(exec_result) = me->api->execute_for_messages( messages = messages ).
    completion = exec_result->get_completion( ).
    total_token_count = exec_result->get_total_token_count( ).
    finish_reason = exec_result->get_finish_reason( ).
  ENDMETHOD.

ENDCLASS.
`;

    case "prompt-template":
      return `${header}
CLASS ${classNameLower} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Injectable factory seam: pass a test double in unit tests; omit it to use the
    "! real ISLM completion API.
    METHODS constructor
      IMPORTING api TYPE REF TO if_aic_completion_api OPTIONAL
      RAISING   cx_aic_api_factory.

    "! template_id must name an ISLM prompt template already attached to the scenario;
    "! template_param fills its first {ISLM_<name>} placeholder.
    METHODS run
      IMPORTING template_id    TYPE string
                template_param TYPE string
                user_message   TYPE string
      RETURNING VALUE(result)  TYPE string
      RAISING   cx_aic_completion_api
                cx_aic_prompt_template.
  PRIVATE SECTION.
    DATA api TYPE REF TO if_aic_completion_api.
    CONSTANTS scenario TYPE string VALUE '${escapedScenario}'.
ENDCLASS.

CLASS ${classNameLower} IMPLEMENTATION.

  METHOD constructor.
    IF api IS BOUND.
      me->api = api.
    ELSE.
      me->api = cl_aic_islm_compl_api_factory=>get( )->create_instance( scenario ).
    ENDIF.
  ENDMETHOD.

  METHOD run.
    " CL_AIC_ISLM_PROMPT_TPL_FACTORY is the one verified SAP prompt-library factory class.
    DATA(prompt_template_instance) = cl_aic_islm_prompt_tpl_factory=>get( )->create_instance(
        islm_scenario = scenario
        template_id   = template_id ).
    DATA(prompt) = prompt_template_instance->get_prompt(
        parameters = VALUE #( ( name = 'ISLM_DynamicParameter' value = template_param ) ) ).

    DATA(messages) = me->api->create_message_container( ).
    messages->set_system_role( system_role = prompt ).
    messages->add_user_message( message = user_message ).
    result = me->api->execute_for_messages( messages = messages )->get_completion( ).
  ENDMETHOD.

ENDCLASS.
`;

    case "function-calling": {
      const fns = functions.length > 0 ? functions : DEFAULT_FUNCTIONS;
      const registrations = fns.map(renderFunctionRegistration).join("\n");
      return `${header}
CLASS ${classNameLower} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Injectable factory seam: pass a test double in unit tests; omit it to use the
    "! real ISLM completion API.
    METHODS constructor
      IMPORTING api TYPE REF TO if_aic_completion_api OPTIONAL
      RAISING   cx_aic_api_factory.

    METHODS run
      IMPORTING user_message  TYPE string
      RETURNING VALUE(result) TYPE string
      RAISING   cx_aic_completion_api.
  PRIVATE SECTION.
    DATA api TYPE REF TO if_aic_completion_api.
    CONSTANTS scenario TYPE string VALUE '${escapedScenario}'.

    METHODS register_functions.
    "! TODO: route on tool_call->get_function_call( )-function_name and call the real ABAP
    "! implementation; this stub always returns a placeholder result string.
    METHODS dispatch_tool_call
      IMPORTING tool_call TYPE REF TO if_aic_tool_call.
ENDCLASS.

CLASS ${classNameLower} IMPLEMENTATION.

  METHOD constructor.
    IF api IS BOUND.
      me->api = api.
    ELSE.
      me->api = cl_aic_islm_compl_api_factory=>get( )->create_instance( scenario ).
    ENDIF.
    me->register_functions( ).
  ENDMETHOD.

  METHOD register_functions.
${registrations}
  ENDMETHOD.

  METHOD dispatch_tool_call.
    tool_call->set_call_result( |TODO: real result for { tool_call->get_function_call( )-function_name }| ).
  ENDMETHOD.

  METHOD run.
    DATA(messages) = me->api->create_message_container( ).
    messages->add_user_message( message = user_message ).

    DO.
      DATA(exec_result) = me->api->execute_for_messages( messages = messages ).
      DATA(tool_calls) = exec_result->get_tool_calls( ).
      IF tool_calls IS INITIAL.
        result = exec_result->get_completion( ).
        EXIT.
      ENDIF.

      LOOP AT tool_calls INTO DATA(tool_call).
        me->dispatch_tool_call( tool_call ).
      ENDLOOP.

      " Regression guard for the upstream SAP sample's bug (see abap-mcp F07 research): the
      " tool_calls table is DECLARED above (from get_tool_calls( )) and POPULATED by the LOOP's
      " set_call_result( ) calls before it is passed here — never an undeclared bare identifier.
      messages->add_tool_results( tool_calls = tool_calls ).
    ENDDO.
  ENDMETHOD.

ENDCLASS.
`;
    }

    case "structured-output":
      return `${header}
CLASS ${classNameLower} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Injectable factory seam: pass a test double in unit tests; omit it to use the
    "! real ISLM completion API.
    METHODS constructor
      IMPORTING api TYPE REF TO if_aic_completion_api OPTIONAL
      RAISING   cx_aic_api_factory.

    "! json_schema is a JSON Schema string (SAP names OpenAI GPT-4o / GPT-4o mini as the
    "! models currently offering this parameter). refused is initial when the schema was
    "! accepted — check it before treating completion as parseable JSON.
    METHODS run
      IMPORTING user_prompt  TYPE string
                json_schema  TYPE string
      EXPORTING completion   TYPE string
                refused      TYPE abap_bool
      RAISING   cx_aic_completion_api.
  PRIVATE SECTION.
    DATA api TYPE REF TO if_aic_completion_api.
    CONSTANTS scenario TYPE string VALUE '${escapedScenario}'.
ENDCLASS.

CLASS ${classNameLower} IMPLEMENTATION.

  METHOD constructor.
    IF api IS BOUND.
      me->api = api.
    ELSE.
      me->api = cl_aic_islm_compl_api_factory=>get( )->create_instance( scenario ).
    ENDIF.
  ENDMETHOD.

  METHOD run.
    me->api->define_response_format( )->json_schema( )->from_string( json_schema ).
    DATA(exec_result) = me->api->execute_for_string( user_prompt ).
    completion = exec_result->get_completion( ).
    refused = exec_result->get_response_format_refusal( ).
  ENDMETHOD.

ENDCLASS.
`;

    case "streaming":
      return `${header}
CLASS ${classNameLower} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Injectable factory seam: pass a test double in unit tests; omit it to use the
    "! real ISLM completion API cast to the streaming interface (see the ASSUMPTION note
    "! above the class).
    METHODS constructor
      IMPORTING api TYPE REF TO if_aic_adt_completion_api OPTIONAL
      RAISING   cx_aic_api_factory.

    "! Accumulates every delta into the returned string; replace the TODO with a real
    "! push (e.g. to a WebSocket) of each delta as it arrives.
    METHODS run
      IMPORTING user_message  TYPE string
      RETURNING VALUE(result) TYPE string
      RAISING   cx_aic_completion_api.
  PRIVATE SECTION.
    DATA api TYPE REF TO if_aic_adt_completion_api.
    CONSTANTS scenario TYPE string VALUE '${escapedScenario}'.
ENDCLASS.

CLASS ${classNameLower} IMPLEMENTATION.

  METHOD constructor.
    IF api IS BOUND.
      me->api = api.
    ELSE.
      me->api = CAST if_aic_adt_completion_api(
          cl_aic_islm_compl_api_factory=>get( )->create_instance( scenario ) ).
    ENDIF.
  ENDMETHOD.

  METHOD run.
    DATA(completion_api) = CAST if_aic_completion_api( me->api ).
    DATA(messages) = completion_api->create_message_container( ).
    messages->add_user_message( message = user_message ).

    DATA(stream) = me->api->stream_for_messages( messages = messages ).
    WHILE stream->has_next( ).
      DATA(part) = stream->get_next( ).
      result = result && part->get_completion_delta( ).
      " TODO: push part->get_completion_delta( ) to the caller (e.g. a WebSocket) here.
    ENDWHILE.
  ENDMETHOD.

ENDCLASS.
`;

    case "orchestration":
      return `${header}
CLASS ${classNameLower} DEFINITION PUBLIC FINAL CREATE PUBLIC.
  PUBLIC SECTION.
    "! Injectable factory seam: pass a test double in unit tests; omit it to use the
    "! real ISLM orchestration API.
    METHODS constructor
      IMPORTING api TYPE REF TO if_aic_orchestration_api OPTIONAL
      RAISING   cx_aic_api_factory.

    "! LIMITATION: the Orchestration API does not (yet) support structured output,
    "! function calling, or media input — use the other interaction variants for those.
    METHODS run
      IMPORTING user_message  TYPE string
                template_id   TYPE string DEFAULT 'ISLM_USERINPUT'
      RETURNING VALUE(result) TYPE string
      RAISING   cx_aic_completion_api.
  PRIVATE SECTION.
    DATA api TYPE REF TO if_aic_orchestration_api.
    CONSTANTS scenario TYPE string VALUE '${escapedScenario}'.
ENDCLASS.

CLASS ${classNameLower} IMPLEMENTATION.

  METHOD constructor.
    IF api IS BOUND.
      me->api = api.
    ELSE.
      me->api = cl_aic_islm_orch_api_factory=>get( )->create_instance( scenario ).
    ENDIF.
  ENDMETHOD.

  METHOD run.
    me->api->configure_templating( )->add_user_message( user_message = user_message ).
    me->api->configure_templating( )->add_prompt_template( template_id = template_id ).
    result = me->api->execute( )->orchestration_result( )->completion( ).
  ENDMETHOD.

ENDCLASS.
`;
  }
}

function testClassName(classNameLower: string): string {
  const stem = classNameLower.replace(/^[zy]cl_/, "");
  return `ltc_${stem}`.slice(0, 30);
}

function buildTestClassSource(interaction: AisdkInteraction, classNameLower: string): string {
  const seamType = SEAM_TYPE[interaction];
  const ltc = testClassName(classNameLower);
  return `"! Generated by abap-mcp scaffold_abap_ai_sdk — skeleton only.
"! Replace the fail( ) marker with real given/when/then logic once you decide how to
"! stub ${seamType.toUpperCase()}'s methods for this scenario.
CLASS ${ltc} DEFINITION FINAL FOR TESTING RISK LEVEL HARMLESS DURATION SHORT.
  PRIVATE SECTION.
    DATA cut      TYPE REF TO ${classNameLower}.
    DATA mock_api TYPE REF TO ${seamType}.
    METHODS setup RAISING cx_static_check.
    METHODS run FOR TESTING.
ENDCLASS.

CLASS ${ltc} IMPLEMENTATION.

  METHOD setup.
    mock_api = CAST ${seamType}( cl_abap_testdouble=>create( '${seamType.toUpperCase()}' ) ).
    cut = NEW #( api = mock_api ).
  ENDMETHOD.

  METHOD run.
    " given … when … then — configure mock_api's expected calls via
    " cl_abap_testdouble=>configure_call( mock_api ) before calling cut->run( ).
    cl_abap_unit_assert=>fail( msg = 'TODO: exercise ${classNameLower}->run with a stubbed ${seamType}' ).
  ENDMETHOD.

ENDCLASS.
`;
}

let cachedStubs: { filename: string; source: string }[] | undefined;

/**
 * Load abap-mcp's own IF_AIC_*, CL_AIC_*, CX_AIC_* stub declarations
 * (src/data/aic-stubs/*.abap) so the generated class round-trips through
 * abaplint without "unknown type" noise. These are OUR declarations of the
 * public signature surface, not SAP source (see each stub's header comment).
 */
function loadStubs(): { filename: string; source: string }[] {
  if (cachedStubs === undefined) {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "data", "aic-stubs");
    cachedStubs = readdirSync(dir)
      .filter((f) => f.endsWith(".abap"))
      .sort()
      .map((f) => ({ filename: f, source: readFileSync(join(dir, f), "utf8") }));
  }
  return cachedStubs;
}

function buildNextSteps(interaction: AisdkInteraction, withUnitTest: boolean, functionsProvided: boolean): string[] {
  const steps: string[] = [
    "Complete setupSteps first — CREATE_INSTANCE only resolves once the Intelligent Scenario is published, deployed and activated (up to ~5 minutes to sync).",
    "The scenario constant defaults to the scenarioName you passed in; point it at your real, activated ISLM intelligent-scenario name.",
  ];
  switch (interaction) {
    case "string":
      steps.push(
        "Tune SET_TEMPERATURE, or add SET_MAXIMUM_TOKENS / SET_ANY_PARAMETER via GET_PARAMETER_SETTER, once you know the target model's supported parameters.",
      );
      break;
    case "messages":
      steps.push("run_with_metadata exposes token counts and finish reason — wire those into logging/observability before relying on this in production.");
      break;
    case "prompt-template":
      steps.push("Create the ISLM prompt template named by template_id, with its {ISLM_<name>} placeholders, before calling run( ) — GET_PROMPT fails otherwise.");
      break;
    case "function-calling":
      steps.push("Fill in dispatch_tool_call( ) with real routing to your ABAP method(s); it currently returns a placeholder string via set_call_result( ).");
      if (!functionsProvided) {
        steps.push(
          "No functions were supplied — a placeholder 'get_current_stock_level' demo function was generated in register_functions( ); replace it with your real tool definitions.",
        );
      }
      break;
    case "structured-output":
      steps.push("Replace the placeholder JSON Schema you pass to run( ) with your real schema, and branch on `refused` before trusting `completion` as parseable JSON.");
      break;
    case "streaming":
      steps.push(
        "The IF_AIC_ADT_COMPLETION_API cast is this scaffold's own assumption (SAP documents the interface but not the factory call) — verify it resolves in ADT, and replace the TODO with a real push (e.g. WebSocket) of each delta.",
      );
      break;
    case "orchestration":
      steps.push(
        "Configure the execution-flow template the Orchestration API requires in the ISLM model, and remember it does not (yet) support structured output, function calling, or media input.",
      );
      break;
  }
  if (withUnitTest) {
    steps.push(
      "The generated test class only asserts a TODO fail( ) — configure the injected test double with cl_abap_testdouble=>configure_call( ) and write a real given/when/then before trusting it as coverage.",
    );
  }
  steps.push(
    'Generated code is validated only against abap-mcp\'s own bundled stub declarations (validated:"abaplint-syntax") — ADT activation against the real SDK in your system is the final check.',
  );
  return steps;
}

function buildConstraints(interaction: AisdkInteraction): string[] {
  const constraints = [...KNOWLEDGE.constraints];
  if (interaction === "orchestration") {
    constraints.push(
      `The Orchestration API does not yet support: ${KNOWLEDGE.orchestrationLimitations.join(", ")} — use the completion-API interaction variants (string, messages, prompt-template, function-calling, structured-output) for those.`,
    );
  }
  return constraints;
}

const SCOPE_NOTE =
  "scaffold_abap_ai_sdk generates ABAP source text only: it never calls any LLM, never creates or " +
  "publishes an Intelligent Scenario/Model, never deploys or activates anything, and makes no network " +
  `call of its own. Every file's validated field reads "abaplint-syntax": generated files are ` +
  `round-tripped through abaplint (version Cloud, preset syntax-only) together with abap-mcp's own ` +
  `bundled IF_AIC_*/CL_AIC_*/CX_AIC_* stub declarations — this proves the ABAP PARSES, not that it ` +
  `matches SAP's real AI SDK surface exactly. Knowledge curated ${KNOWLEDGE.curatedDate} ` +
  `(src/data/abap-ai-sdk.json); see setupSteps for the manual ISLM configuration this code depends on ` +
  "at runtime, and constraints for documented error codes/limits.";

export function scaffoldAbapAiSdk(o: AisdkOptions): AisdkResult {
  const { scenarioName, classNameLower } = validateInput(o);
  const withUnitTest = o.withUnitTest ?? false;
  const functions = o.functions ?? [];

  const files: AisdkFile[] = [
    { filename: `${classNameLower}.clas.abap`, content: buildClassSource(o.interaction, classNameLower, scenarioName, functions), validated: "abaplint-syntax" },
  ];
  if (withUnitTest) {
    files.push({
      filename: `${classNameLower}.clas.testclasses.abap`,
      content: buildTestClassSource(o.interaction, classNameLower),
      validated: "abaplint-syntax",
    });
  }

  const stubs = loadStubs();
  const generatedNames = new Set(files.map((f) => f.filename));
  const validationInput = [
    ...stubs.map((s) => ({ filename: s.filename, source: s.source })),
    ...files.map((f) => ({ filename: f.filename, source: f.content })),
  ];
  const { findings } = runAbaplint(validationInput, { version: "Cloud", preset: "syntax-only" });
  const validationIssues = findings.filter((f) => generatedNames.has(f.file));

  return {
    files,
    setupSteps: [
      ...KNOWLEDGE.setupSteps,
      `Publish and activate the Intelligent Scenario named '${scenarioName}' (or edit the generated class's scenario constant to match whatever you actually create).`,
    ],
    constraints: buildConstraints(o.interaction),
    nextSteps: buildNextSteps(o.interaction, withUnitTest, functions.length > 0),
    validationIssues,
    validated: "abaplint-syntax",
    scopeNote: SCOPE_NOTE,
  };
}
