/**
 * `checkRapBehavior()` — the RAP checker's entry point (spec
 * `docs/specs/rap-checker-design.md` §2.7).
 *
 * Assembles the parts the rest of `src/abap/rap/` provides into one report:
 *
 *   classify + bound  →  parse every BDEF (`parser.ts`) and SRVD (`srvd.ts`)
 *   →  build the CDS map from abaplint's real parser (`ddls.ts`)
 *   →  run the BDEF registry (`rules.ts`)  →  run SRVD001–007 (`srvd.ts`)
 *   →  run the release gate RAP900 (`release-gates.ts`)
 *   →  sort, cap, summarise.
 *
 * Stateless, single-pass, no caching (`docs/DESIGN.md` §8) and no I/O: the
 * caller passes text, exactly like every other engine in `src/abap/`. Nothing
 * here imports from `src/tools/` or `src/server.ts` (spec §2) — the tool
 * layer imports this file, never the other way round.
 *
 * The two honesty stamps travel with every report: `grammarVersion` (whose
 * grammar read the file) and `rulesVersion` (which rule set judged it), plus
 * `scopeNote` verbatim — the same dating discipline `KNOWLEDGE_SCOPE_NOTE`
 * applies to the bundled knowledge base.
 */
import type { AbapSource, Finding } from "../engine.js";
import { MAX_FILE_CHARS, MAX_FINDINGS } from "../engine.js";
import type { KnowledgeRelease } from "../knowledge.js";
import type {
  BehaviorDefinition,
  ParseError,
  Range,
  ServiceDefinition,
  UnknownStatement,
} from "./ast.js";
import type { ParsedBdef, ParsedSrvd, RapConfidence, RapFinding, RapSeverity } from "./context.js";
import { buildCdsMap } from "./ddls.js";
import { excerptOf, normalizeRapSource } from "./lexer.js";
import { GRAMMAR_VERSION, parseBehaviorDefinition } from "./parser.js";
import { RAP_RELEASE_GATES_CURATED_DATE, checkReleaseGates } from "./release-gates.js";
import {
  MAX_PARSE_FINDINGS_PER_FILE,
  MAX_UNKNOWN_FINDINGS_PER_FILE,
  RAP_RULES,
  RAP_RULES_DOC_BASE,
  RAP_RULES_VERSION,
  countSeverity,
  runBdefRules,
} from "./rules.js";
import type { RapSeverityCounts } from "./rules.js";
import { SRVD_RULES, checkServiceDefinitionRules, parseServiceDefinition } from "./srvd.js";

export { RAP_RULES, RAP_RULES_VERSION } from "./rules.js";
export type { CdsEntityInfo, CdsShape, RapConfidence, RapFinding, RapSeverity } from "./context.js";

/** Bump on any grammar change — `parser.ts` owns the value, this is its public name. */
export const RAP_GRAMMAR_VERSION = GRAMMAR_VERSION;

/**
 * Library cap. Higher than `engine.ts`'s `MAX_FILES` (32) on purpose: the MCP
 * tool keeps the 32-file contract every other tool advertises, while the CLI
 * and the scaffold integration hand whole directories to this function.
 */
export const MAX_RAP_FILES = 64;

/** Spec §1.5, verbatim — echoed on every report. */
export const RAP_SCOPE_NOTE =
  "Checked offline by abap-mcp's own RAP behavior/service-definition parser — not by abaplint (which stores " +
  "BDEF/SRVD without deep-parsing them) and not by SAP. The grammar is derived from SAP's published RAP BDL " +
  "feature tables and keyword documentation plus a 102-file corpus of Apache-2.0 SAP sample BDEF/SRVD sources; " +
  "it is an approximation, and constructs it does not recognise are reported as info, never as errors. " +
  "Cross-entity, CDS and DDIC facts are checked only for the files passed in the same call. ADT activation in " +
  "the target system remains the only authority on whether these objects are valid.";

/* ------------------------------------------------------------ the report */

export type RapFileKind = "bdef" | "srvd" | "ddls" | "unsupported";

export interface RapParserErrorReport {
  message: string;
  line: number;
  column: number;
  excerpt: string;
  kind: "syntax" | "unknown-construct";
}

export interface RapFileReport {
  filename: string;
  kind: RapFileKind;
  parsed: boolean;
  parserErrors: RapParserErrorReport[];
  /** BDEF only — `define`/`extend behavior for` blocks found. */
  entityCount?: number | undefined;
  /** SRVD only — EXPOSE statements found. */
  exposeCount?: number | undefined;
}

export interface RapCheckSummary {
  errors: number;
  warnings: number;
  infos: number;
  filesChecked: number;
  rulesRun: number;
  /** Spec §3.7 — how often a rule stayed silent because a statement was skipped. */
  suppressedByUnknown: number;
  /** Spec §9 item 1 — RAP000 candidates across all files, before the per-file cap. */
  unknownConstructs: number;
  /**
   * How often a cross-file rule stayed silent because the projection's CDS
   * view names a base entity no BDEF in this call defines. The cross-file
   * half of the rule set is only as complete as the file set it was given,
   * and this is the number that says so.
   */
  baseUnresolved: number;
  /**
   * Findings the report cap dropped. `errors`/`warnings`/`infos` above are
   * counted BEFORE the cap, so they stay true of the file even when the list
   * is short — `omitted` says how much of the list is missing.
   */
  omitted: number;
  truncated: boolean;
}

export interface RapCheckReport {
  files: RapFileReport[];
  findings: RapFinding[];
  summary: RapCheckSummary;
  /** `RAP_SCOPE_NOTE`, verbatim. */
  scopeNote: string;
  grammarVersion: string;
  rulesVersion: string;
  releaseGate?: { abapRelease: string; curatedDate: string; gatedConstructs: number } | undefined;
  validated: "rap-checker";
}

export interface RapCheckOptions {
  /** Enables release gating (RAP900). One of `KNOWLEDGE_RELEASES`. */
  abapRelease?: KnowledgeRelease | undefined;
  /** Force the strict-mode rules on even where the BDEF omits `strict`. Default false. */
  strict?: boolean | undefined;
  /** Default `MAX_FINDINGS` (500), shared with `engine.ts`. */
  maxFindings?: number | undefined;
}

/* --------------------------------------------------------- classification */

const BDEF_EXT = ".bdef.asbdef";
const SRVD_EXT = ".srvd.srvdsrv";
const DDLS_EXT = ".ddls.asddls";

/**
 * What kind of file this is. A given filename decides it outright (that is
 * why the tool asks for one); without a filename we sniff the source, which
 * `engine.ts`'s `inferFilename()` cannot do for us — it has no SRVD branch,
 * and its BDEF branch misses the `define behavior for`-first form.
 */
export function classifyRapSource(source: string, filename?: string): RapFileKind {
  if (filename !== undefined) {
    const lower = filename.toLowerCase();
    if (lower.endsWith(BDEF_EXT)) return "bdef";
    if (lower.endsWith(SRVD_EXT)) return "srvd";
    if (lower.endsWith(DDLS_EXT)) return "ddls";
    return "unsupported";
  }
  // Strip comments and annotations so the first real statement leads.
  const head = source
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .filter((line) => line.length > 0 && !line.startsWith("@") && !line.startsWith("*"))
    .slice(0, 12)
    .join("\n");
  if (/^\s*(?:define|extend)\s+service\b/im.test(head)) return "srvd";
  if (/^\s*(?:managed|unmanaged|abstract|projection|interface)\b/im.test(head)) return "bdef";
  if (/^\s*(?:extension|extend)\s+behavior\b/im.test(head)) return "bdef";
  if (/^\s*define\s+behavior\s+for\b/im.test(head)) return "bdef";
  if (/^\s*(?:define|extend|annotate)\b/im.test(head)) return "ddls";
  return "unsupported";
}

/** True when a file set contains at least one BDEF or SRVD — `lint_abap`'s routing test (spec §5.2). */
export function containsRapFiles(files: AbapSource[]): boolean {
  return files.some((f) => {
    const kind = classifyRapSource(f.source, f.filename);
    return kind === "bdef" || kind === "srvd";
  });
}

const NAME_PATTERNS: Record<Exclude<RapFileKind, "unsupported">, RegExp> = {
  bdef: /\bdefine\s+behavior\s+for\s+([\w/]+)/i,
  srvd: /\bdefine\s+service\s+([\w/]+)/i,
  ddls: /\bdefine\s+(?:root\s+)?(?:view\s+entity|abstract\s+entity|custom\s+entity|table\s+entity|view)\s+([\w/]+)/i,
};

const EXTENSIONS: Record<RapFileKind, string> = {
  bdef: BDEF_EXT,
  srvd: SRVD_EXT,
  ddls: DDLS_EXT,
  unsupported: "",
};

/** Best-effort abapGit-style name for an unnamed source, so findings anchor somewhere readable. */
function nameFor(kind: RapFileKind, source: string, index: number, used: Set<string>): string {
  let base = `zsnippet${index + 1}`;
  if (kind !== "unsupported") {
    const match = NAME_PATTERNS[kind].exec(source);
    const raw = match?.[1];
    if (raw !== undefined) base = raw.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  }
  let name = kind === "unsupported" ? `${base}.unknown` : `${base}${EXTENSIONS[kind]}`;
  let n = 2;
  while (used.has(name)) {
    name = kind === "unsupported" ? `${base}${n}.unknown` : `${base}${n}${EXTENSIONS[kind]}`;
    n += 1;
  }
  used.add(name);
  return name;
}

interface ClassifiedFile {
  filename: string;
  source: string;
  kind: RapFileKind;
}

function classifyAll(files: AbapSource[]): ClassifiedFile[] {
  if (files.length === 0) throw new Error("Provide at least one source file.");
  if (files.length > MAX_RAP_FILES) throw new Error(`At most ${MAX_RAP_FILES} files per call.`);
  const used = new Set<string>();
  return files.map((file, index) => {
    if (file.source.length > MAX_FILE_CHARS) {
      throw new Error(
        `File ${file.filename ?? "(unnamed)"} exceeds ${MAX_FILE_CHARS} characters; split it or check the relevant part.`,
      );
    }
    const kind = classifyRapSource(file.source, file.filename);
    const filename =
      file.filename !== undefined ? file.filename.toLowerCase() : nameFor(kind, file.source, index, used);
    used.add(filename);
    return { filename, source: file.source, kind };
  });
}

/* ------------------------------------------ structural findings for SRVDs
 * `rules.ts`'s RAP-PARSE / RAP000 pseudo-rules run inside `runBdefRules()`
 * and are BDEF-scoped by construction (they read `RapRuleContext.file`).
 * Service definitions get the same two tiers here, from the same registry
 * entries — one definition of severity/hint/docsAnchor, two call sites.
 */

interface StructuralMeta {
  severity: RapSeverity;
  confidence: RapConfidence;
  hint: string;
  sourceUrl: string;
  docsAnchor: string;
}

function structuralMeta(id: string): StructuralMeta {
  const rule = RAP_RULES.find((r) => r.id === id);
  if (rule === undefined) throw new Error(`Structural rule ${id} is missing from RAP_RULES.`);
  return {
    severity: rule.severity,
    confidence: rule.confidence,
    hint: rule.hint,
    sourceUrl: rule.sourceUrl,
    docsAnchor: rule.docsAnchor,
  };
}

function structuralFindings(srvd: ParsedSrvd): RapFinding[] {
  const lines = normalizeRapSource(srvd.source).split("\n");
  const findings: RapFinding[] = [];

  const parseMeta = structuralMeta("RAP-PARSE");
  for (const error of srvd.errors.slice(0, MAX_PARSE_FINDINGS_PER_FILE)) {
    findings.push({
      rule: "RAP-PARSE",
      severity: parseMeta.severity,
      message: error.message,
      file: srvd.filename,
      line: error.line,
      column: error.column,
      excerpt: error.excerpt,
      hint: parseMeta.hint,
      confidence: parseMeta.confidence,
      docsUrl: `${RAP_RULES_DOC_BASE}#${parseMeta.docsAnchor}`,
      sourceUrl: parseMeta.sourceUrl,
    });
  }

  const unknownMeta = structuralMeta("RAP000");
  for (const unknown of srvd.unknown.slice(0, MAX_UNKNOWN_FINDINGS_PER_FILE)) {
    findings.push({
      rule: "RAP000",
      severity: unknownMeta.severity,
      message:
        `abap-mcp's SDL grammar (${GRAMMAR_VERSION}) does not recognise this statement ("${unknown.text}"); ` +
        "it was skipped, and no rule was applied to it. This is a limit of the checker, not necessarily an " +
        "error in your file.",
      file: srvd.filename,
      line: unknown.range.start.line,
      column: unknown.range.start.column,
      excerpt: excerptOf(lines, unknown.range.start.line),
      hint: unknownMeta.hint,
      confidence: unknownMeta.confidence,
      docsUrl: `${RAP_RULES_DOC_BASE}#${unknownMeta.docsAnchor}`,
      sourceUrl: unknownMeta.sourceUrl,
    });
  }
  return findings;
}

/**
 * `srvd.ts` and `release-gates.ts` were written against the spec's relative
 * `docs/RAP-RULES.md#anchor` form and their unit tests pin it; `rules.ts`
 * emits the resolvable GitHub URL. One report must not carry two shapes, so
 * the relative form is lifted here, at the only place that sees all three
 * sources — leaving both sets of unit tests intact.
 */
function normalizeDocsUrl(finding: RapFinding): RapFinding {
  const url = finding.docsUrl;
  if (url === undefined || !url.startsWith("docs/RAP-RULES.md#")) return finding;
  return { ...finding, docsUrl: `${RAP_RULES_DOC_BASE}#${url.slice("docs/RAP-RULES.md#".length)}` };
}

/* ------------------------------------------------- defensive parse wrapper
 * `checkRapBehavior()`'s contract is "never throws for anything the caller
 * could have written in the sources themselves". Both parsers are written to
 * honour it, but a parser is exactly the kind of code where a hostile input
 * finds an engine limit the author did not model (V8's call stack, first).
 * One `try` per file turns any such surprise into the finding the contract
 * promises, on the file that caused it, with the other files still checked.
 */

interface SafeParsed<TAst> {
  ast: TAst;
  errors: ParseError[];
  unknown: UnknownStatement[];
  truncated: boolean;
}

const ZERO_RANGE: Range = { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } };

function emptyBehaviorDefinition(): BehaviorDefinition {
  return {
    kind: "behavior-definition",
    implementationType: "unspecified",
    draftDeclarations: [],
    auxiliaryClasses: [],
    headerUses: [],
    entities: [],
    unknownHeader: [],
    range: ZERO_RANGE,
  };
}

function emptyServiceDefinition(): ServiceDefinition {
  return {
    kind: "service-definition",
    form: "define",
    annotations: [],
    name: { name: "", key: "", namespaced: false, range: ZERO_RANGE },
    providerContracts: [],
    exposes: [],
    unknown: [],
    range: ZERO_RANGE,
  };
}

function safeParse<TAst>(
  source: string,
  filename: string,
  parse: (source: string, filename?: string) => SafeParsed<TAst>,
  empty: () => TAst,
): SafeParsed<TAst> {
  try {
    return parse(source, filename);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ast: empty(),
      errors: [
        {
          message: `Internal parser error while reading this file: ${detail}. It was not checked.`,
          line: 1,
          column: 1,
          excerpt: (normalizeRapSource(source).split("\n")[0] ?? "").trim().slice(0, 100),
          kind: "syntax",
          file: filename,
        },
      ],
      unknown: [],
      truncated: true,
    };
  }
}

/* --------------------------------------------------------- the entry point */

/**
 * Check RAP behavior definitions and CDS service definitions offline.
 *
 * Never throws for anything the caller could have written in the sources
 * themselves — a file that does not parse produces findings, not an
 * exception. It does throw on contract violations (no files, too many files,
 * an oversized file), exactly like `boundFiles()` in `engine.ts`.
 */
export function checkRapBehavior(files: AbapSource[], opts: RapCheckOptions = {}): RapCheckReport {
  const classified = classifyAll(files);
  const maxFindings = opts.maxFindings ?? MAX_FINDINGS;

  const bdefs: ParsedBdef[] = [];
  const srvds: ParsedSrvd[] = [];
  const ddls: AbapSource[] = [];
  const fileReports: RapFileReport[] = [];

  for (const file of classified) {
    switch (file.kind) {
      case "bdef": {
        // A parser is a pure function over text and must never take the whole
        // call down — hostile input (deep nesting, a pathological token run)
        // that reaches an engine limit is a finding about that file, not an
        // exception out of `checkRapBehavior()`. Nothing here can be a real
        // recovery, so the file is reported unparsed with one RAP-PARSE.
        const parsed = safeParse(file.source, file.filename, parseBehaviorDefinition, emptyBehaviorDefinition);
        bdefs.push({
          filename: file.filename,
          source: file.source,
          ast: parsed.ast,
          errors: parsed.errors,
          unknown: parsed.unknown,
          truncated: parsed.truncated,
        });
        break;
      }
      case "srvd": {
        const parsed = safeParse(file.source, file.filename, parseServiceDefinition, emptyServiceDefinition);
        srvds.push({
          filename: file.filename,
          source: file.source,
          ast: parsed.ast,
          errors: parsed.errors,
          unknown: parsed.unknown,
          truncated: parsed.truncated,
        });
        break;
      }
      case "ddls":
        ddls.push({ filename: file.filename, source: file.source });
        break;
      default:
        fileReports.push({ filename: file.filename, kind: "unsupported", parsed: false, parserErrors: [] });
        break;
    }
  }

  const cds = buildCdsMap(ddls);

  const bdefRun = runBdefRules({
    bdefs,
    srvds,
    cds: cds.entities,
    ...(opts.abapRelease !== undefined ? { abapRelease: opts.abapRelease } : {}),
    ...(opts.strict !== undefined ? { strict: opts.strict } : {}),
    maxFindings,
  });

  const findings: RapFinding[] = [...bdefRun.findings, ...cds.findings];

  // Spec §3.7 is one contract across both parsers: a suppression on the SDL
  // side counts in the same honesty column as one on the BDL side.
  let srvdSuppressed = 0;
  for (const srvd of srvds) {
    findings.push(...structuralFindings(srvd));
    findings.push(
      ...checkServiceDefinitionRules(srvd, {
        cds: cds.entities,
        onSuppressed: () => {
          srvdSuppressed += 1;
        },
      }),
    );
  }

  let gatedConstructs = 0;
  if (opts.abapRelease !== undefined) {
    for (const bdef of bdefs) {
      const gateFindings = checkReleaseGates(bdef, { abapRelease: opts.abapRelease });
      gatedConstructs += gateFindings.length;
      findings.push(...gateFindings);
    }
  }

  /* ---- file reports (in the caller's order, unsupported ones already in) */
  const bdefByName = new Map(bdefs.map((b) => [b.filename, b]));
  const srvdByName = new Map(srvds.map((s) => [s.filename, s]));
  const cdsFilesWithErrors = new Set(cds.findings.map((f) => f.file));
  // Every file abaplint's CDS parser read — NOT only the ones that own an
  // entity row: an `extend view entity` / `annotate view` file parses
  // perfectly and contributes none (see `ddls.ts`'s `isCdsExtensionSource`).
  const cdsFilesParsed = cds.parsedFiles;
  const reports: RapFileReport[] = [];
  for (const file of classified) {
    if (file.kind === "bdef") {
      const parsed = bdefByName.get(file.filename)!;
      reports.push({
        filename: file.filename,
        kind: "bdef",
        parsed: parsed.errors.length === 0,
        parserErrors: parsed.errors.map((e) => ({
          message: e.message,
          line: e.line,
          column: e.column,
          excerpt: e.excerpt,
          kind: e.kind,
        })),
        entityCount: parsed.ast.entities.length,
      });
    } else if (file.kind === "srvd") {
      const parsed = srvdByName.get(file.filename)!;
      reports.push({
        filename: file.filename,
        kind: "srvd",
        parsed: parsed.errors.length === 0,
        parserErrors: parsed.errors.map((e) => ({
          message: e.message,
          line: e.line,
          column: e.column,
          excerpt: e.excerpt,
          kind: e.kind,
        })),
        exposeCount: parsed.ast.exposes.length,
      });
    } else if (file.kind === "ddls") {
      reports.push({
        filename: file.filename,
        kind: "ddls",
        // abaplint's own parser is the authority here (spec §2.6): parsed
        // means it produced an entity and raised no cds_parser_error.
        parsed: cdsFilesParsed.has(file.filename) && !cdsFilesWithErrors.has(file.filename),
        parserErrors: [],
      });
    } else {
      reports.push(
        fileReports.find((r) => r.filename === file.filename) ?? {
          filename: file.filename,
          kind: "unsupported",
          parsed: false,
          parserErrors: [],
        },
      );
    }
  }

  /* ---- one sort, one cap (spec §2.7) */
  const merged = findings
    .map(normalizeDocsUrl)
    .sort(
      (a, b) =>
        a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule),
    );

  // The severity counts are taken over the UNCAPPED set: `merged` before this
  // cap, plus whatever `runBdefRules()`'s own cap already dropped. A summary
  // that counted only survivors reported `errors: 0` for a file full of
  // errors as soon as the list overflowed, and every gate keyed to that
  // number (the CLI's exit code first) then passed invalid RAP.
  const counts: RapSeverityCounts = { ...bdefRun.omittedCounts };
  for (const finding of merged) countSeverity(counts, finding.severity);

  // Truncation has four independent sources — the BDEF rule run, the BDL
  // parser, the SDL parser and the lexer behind both. ORing only the first
  // told a caller whose SRVD stopped at the recovery cap that the report was
  // complete.
  let truncated =
    bdefRun.truncated || bdefs.some((b) => b.truncated) || srvds.some((srvd) => srvd.truncated);
  let omitted = bdefRun.omitted;
  if (merged.length > maxFindings) {
    omitted += merged.length - maxFindings;
    merged.length = maxFindings;
    truncated = true;
  }

  const rulesRun =
    bdefRun.rulesRun + (srvds.length > 0 ? SRVD_RULES.length : 0) + (opts.abapRelease !== undefined ? 1 : 0);

  const summary: RapCheckSummary = {
    errors: counts.errors,
    warnings: counts.warnings,
    infos: counts.infos,
    filesChecked: classified.filter((f) => f.kind !== "unsupported").length,
    rulesRun,
    suppressedByUnknown: bdefRun.suppressedByUnknown + srvdSuppressed,
    unknownConstructs: bdefRun.unknownConstructs + srvds.reduce((n, s) => n + s.unknown.length, 0),
    baseUnresolved: bdefRun.baseUnresolved,
    omitted,
    truncated,
  };

  return {
    files: reports,
    findings: merged,
    summary,
    scopeNote: RAP_SCOPE_NOTE,
    grammarVersion: RAP_GRAMMAR_VERSION,
    rulesVersion: RAP_RULES_VERSION,
    ...(opts.abapRelease !== undefined
      ? {
          releaseGate: {
            abapRelease: opts.abapRelease,
            curatedDate: RAP_RELEASE_GATES_CURATED_DATE,
            gatedConstructs,
          },
        }
      : {}),
    validated: "rap-checker",
  };
}

/* ------------------------------------------------- lint_abap integration */

/** Namespace every RAP rule key carries inside a `lint_abap` result (spec §5.2). */
export const RAP_LINT_PREFIX = "rap/";

const LINT_SEVERITY: Record<RapSeverity, string> = {
  error: "Error",
  warning: "Warning",
  info: "Info",
};

/**
 * Adapt RAP findings to abaplint's `Finding` shape so `lint_abap` can return
 * one merged list (spec §5.2). The contract, verbatim from the spec:
 *
 *  - rule keys are namespaced `rap/RAP026`, so no abaplint key can collide
 *    and the source of every finding is obvious;
 *  - severity takes abaplint's casing (`Error`/`Warning`/`Info`);
 *  - `hint` and `confidence` have no slot in `Finding`, so the hint is
 *    appended to the message and nothing is lost;
 *  - `cds_parser_error` findings are dropped: they come from abaplint's own
 *    CDS parser, which the same `lint_abap` call already ran over the same
 *    files — re-reporting them under `rap/` would double-count.
 */
export function rapFindingsToLintFindings(findings: readonly RapFinding[]): Finding[] {
  const out: Finding[] = [];
  for (const finding of findings) {
    if (finding.rule === "cds_parser_error") continue;
    out.push({
      rule: `${RAP_LINT_PREFIX}${finding.rule}`,
      message: finding.hint.length > 0 ? `${finding.message} — ${finding.hint}` : finding.message,
      severity: LINT_SEVERITY[finding.severity],
      file: finding.file,
      line: finding.line,
      column: finding.column,
      excerpt: finding.excerpt,
      docsUrl: finding.docsUrl ?? RAP_RULES_DOC_BASE,
    });
  }
  return out;
}
