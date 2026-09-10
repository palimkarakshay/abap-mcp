/**
 * CDS adapter over abaplint's REAL CDS parser — spec §2.6.
 *
 * `.ddls.asddls` files are NOT parsed by anything in `src/abap/rap/` — unlike
 * BDEF/SRVD, abaplint's `data_definition.js` already runs a real `CDSParser`
 * and exposes `getParsedData()` (`definitionName`, `fields`, `sources`,
 * `associations`). This file is therefore a *thin* adapter: it builds a
 * one-off abaplint registry (reusing `buildConfig` from `../engine.js`, so
 * one config path serves the whole server), reads that parsed data back into
 * `CdsEntityInfo`, and adds exactly one thing abaplint does not give us — a
 * text-level classification of the entity's DEFINE statement into a
 * `CdsShape` (root vs. non-root, projection vs. base, abstract/custom/table
 * entity, the old `define view` dialect) — because `RAP001` needs to know
 * whether a BDEF's root points at a *root* view entity, and nothing in
 * abaplint's own parsed data says so.
 *
 * `CdsEntityInfo`/`CdsShape` are `context.ts`'s (spec §2.6's shared-type
 * rendezvous file for the rule layer — see that file's own header) —
 * imported here, not redefined, and re-exported so existing callers of this
 * module need no second import.
 *
 * abaplint's own `cds_parser_error` findings for those files are passed
 * through as `RapFinding`s (rule `"cds_parser_error"`, abaplint's own
 * `docsUrl`, `confidence: "confirmed"`) — a broken CDS view is reported by
 * the real parser, not ours.
 */
import * as abaplint from "@abaplint/core";

import type { CdsEntityInfo, CdsShape, RapFinding, RapSeverity } from "./context.js";
import { type AbapSource, buildConfig, inferFilename } from "../engine.js";

export type { CdsEntityInfo, CdsShape } from "./context.js";

export interface BuildCdsMapResult {
  /** Keyed by upper-cased entity name — what `RapRuleContext.cds` expects. */
  entities: Map<string, CdsEntityInfo>;
  /** abaplint's own `cds_parser_error` issues, adapted to `RapFinding`. */
  findings: RapFinding[];
  /**
   * Every `.ddls` filename abaplint's CDS parser actually read — including
   * the ones that contribute no entity of their own (`extend view entity` /
   * `annotate view`, which carry the BASE entity's name). `parsed` in the
   * report is a statement about the file, not about whether it owns a row in
   * `entities`, so it is derived from this set.
   */
  parsedFiles: Set<string>;
}

/**
 * The DEFINE statement's leading keyword sequence. Matched against a MASKED
 * copy of the source (see `maskCdsNoise()`): CDS annotations never contain a
 * bare `define` token, but a comment or a string literal certainly can — a
 * `// define view entity ZR_X` note above the real
 * `define root view entity ZR_X` used to be the first match, classifying a
 * root view as a plain view entity and costing a false RAP001.
 */
const DEFINE_RE =
  /\bdefine\s+(?:root\s+)?(?:view\s+entity|abstract\s+entity|custom\s+entity|table\s+entity|table\s+function|view)\b/i;

/**
 * Blank out everything that is not CDS code — `//` line comments, `/* … *\/`
 * block comments and `'…'` string literals — while preserving every
 * character position and every newline, so an offset into the mask is an
 * offset into the source. Classification (and the extension/annotation
 * sniff) reads the mask; nothing else does.
 *
 * A doubled quote (`'it''s'`) closes and immediately reopens a literal,
 * which is exactly the CDS escape rule, so no special case is needed.
 */
export function maskCdsNoise(source: string): string {
  const out = source.split("");
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to && k < out.length; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== "'" && source[j] !== "\n") j += 1;
      blank(i, Math.min(j + 1, source.length));
      i = j + 1;
      continue;
    }
    if (ch === "/" && next === "/") {
      let j = i;
      while (j < source.length && source[j] !== "\n") j += 1;
      blank(i, j);
      i = j;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/**
 * `root` is observed both before `abstract entity` (real corpus:
 * `define root abstract entity ZA_ADDRESSEMAILADDRESS { … }`, 38 files in
 * `btp-abap-cna`) and before the classic, entity-less `view` keyword (real
 * corpus: `define root view ZI_BONUS_CALC_SA`, no `{ … }` header before the
 * body) — `root` there does not change the shape, only `root view entity`
 * (§2.6's actual axis: is the BDEF's root pointed at this?) does.
 */
function classify(source: string): { shape: CdsShape; projectionOn?: string | undefined } {
  const masked = maskCdsNoise(source);
  const match = DEFINE_RE.exec(masked);
  if (match === null) return { shape: "unknown" };
  const braceIndex = masked.indexOf("{", match.index);
  const header = masked.slice(match.index, braceIndex === -1 ? undefined : braceIndex);
  const headerUpper = header.toUpperCase();

  // The projection target is a fact about the header, not about the shape:
  // `define root view entity ZC_X as projection on ZR_A` is BOTH a root view
  // (RAP001's question) and a projection onto ZR_A (`resolveBase()`'s
  // question). Reading it only on the `projection-view` branch threw the
  // target away for every root projection view — the ordinary shape of a
  // RAP consumption view — leaving `resolveBase()` to guess by alias.
  const projMatch = /\bAS\s+PROJECTION\s+ON\s+([\w/]+)/i.exec(header);
  const projectionOn = projMatch?.[1];
  const withTarget = (shape: CdsShape): { shape: CdsShape; projectionOn?: string | undefined } =>
    projectionOn !== undefined ? { shape, projectionOn } : { shape };

  const isViewEntity = /^DEFINE\s+(?:ROOT\s+)?VIEW\s+ENTITY\b/.test(headerUpper);
  if (isViewEntity && /\bTRANSACTIONAL_INTERFACE\b/.test(headerUpper)) {
    return withTarget("transactional-interface");
  }
  if (/^DEFINE\s+ROOT\s+VIEW\s+ENTITY\b/.test(headerUpper)) return withTarget("root-view-entity");
  if (/^DEFINE\s+(?:ROOT\s+)?ABSTRACT\s+ENTITY\b/.test(headerUpper)) return withTarget("abstract-entity");
  if (/^DEFINE\s+CUSTOM\s+ENTITY\b/.test(headerUpper)) return withTarget("custom-entity");
  if (/^DEFINE\s+TABLE\s+ENTITY\b/.test(headerUpper)) return withTarget("table-entity");
  if (isViewEntity) return withTarget(projectionOn !== undefined ? "projection-view" : "view-entity");
  if (/^DEFINE\s+(?:ROOT\s+)?VIEW\b/.test(headerUpper)) return withTarget("classic-view");
  // `define table function` has no slot in `CdsShape` (spec §2.6's enum
  // does not model table functions — a real, distinct CDS artifact kind);
  // left honestly "unknown" rather than folded into an inaccurate shape.
  return { shape: "unknown" };
}

/**
 * Name every file (best-effort — duplicates get a numeric suffix rather than
 * throwing, since this adapter may be called with a corpus-sized batch that
 * `boundFiles()`'s 32-file cap was never meant to gate).
 */
function nameFiles(files: AbapSource[]): { filename: string; source: string }[] {
  const used = new Set<string>();
  return files.map((f, i) => {
    let filename: string;
    try {
      filename = inferFilename(f.source, f.filename);
    } catch {
      filename = `zsnippet${i}.ddls.asddls`;
    }
    if (used.has(filename)) {
      const base = filename.replace(/\.ddls\.asddls$/i, "");
      let n = 2;
      while (used.has(`${base}${n}.ddls.asddls`)) n += 1;
      filename = `${base}${n}.ddls.asddls`;
    }
    used.add(filename);
    return { filename, source: f.source };
  });
}

const CDS_PARSER_ERROR_DOCS_URL = "https://rules.abaplint.org/cds_parser_error/";

/**
 * True for a CDS source that EXTENDS or ANNOTATES an entity instead of
 * defining one (`extend view entity ZR_X with { … }`, `annotate view ZR_X
 * with { … }`). abaplint reports such a file under the BASE entity's
 * `definitionName`, so writing it into the map would evict the real
 * definition — silencing RAP001/RAP059, breaking `resolveBase()`'s
 * projection path, and reporting the base view (which parsed perfectly) as
 * `parsed: false`. Five corpus `.ddls` files are `extend view entity`, so any
 * directory sweep hits this. Comment and annotation lines are stripped first
 * so the first REAL statement is what decides.
 */
export function isCdsExtensionSource(source: string): boolean {
  const firstStatement = maskCdsNoise(source)
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("@") && !line.startsWith("*"));
  return firstStatement !== undefined && /^(?:extend|annotate)\b/i.test(firstStatement);
}

/**
 * Build the CDS entity map for a set of `.ddls.asddls` sources, using
 * abaplint's real CDS parser. Never throws: a file abaplint cannot parse at
 * all contributes no entity plus a `cds_parser_error` finding, and a file
 * that makes abaplint's own parser fail outright (hostile nesting deep enough
 * to exhaust the call stack) is isolated — every other file in the batch is
 * still read, and the offending one gets a `RAP-PARSE` finding of its own.
 */
export function buildCdsMap(files: AbapSource[]): BuildCdsMapResult {
  if (files.length === 0) return { entities: new Map(), findings: [], parsedFiles: new Set() };
  const bounded = nameFiles(files);
  try {
    return buildBatch(bounded);
  } catch {
    return buildIsolated(bounded);
  }
}

/** One file at a time, so one hostile source costs only itself. */
function buildIsolated(bounded: { filename: string; source: string }[]): BuildCdsMapResult {
  const entities = new Map<string, CdsEntityInfo>();
  const findings: RapFinding[] = [];
  const parsedFiles = new Set<string>();
  for (const file of bounded) {
    try {
      const one = buildBatch([file]);
      for (const [key, info] of one.entities) entities.set(key, info);
      findings.push(...one.findings);
      for (const name of one.parsedFiles) parsedFiles.add(name);
    } catch (error) {
      findings.push({
        rule: "RAP-PARSE",
        severity: "error",
        message: `Internal parser error while reading this CDS source: ${
          error instanceof Error ? error.message : String(error)
        }. It was not checked.`,
        file: file.filename,
        line: 1,
        column: 1,
        excerpt: (file.source.split("\n")[0] ?? "").trim().slice(0, 100),
        hint: "Simplify the file (deeply nested annotations are the usual cause) and re-run; nothing in it was checked.",
        confidence: "confirmed",
        docsUrl: "docs/RAP-RULES.md#rap-parse",
      });
    }
  }
  return { entities, findings, parsedFiles };
}

function buildBatch(bounded: { filename: string; source: string }[]): BuildCdsMapResult {
  const entities = new Map<string, CdsEntityInfo>();
  const parsedFiles = new Set<string>();
  const sourceByFilename = new Map(bounded.map((f) => [f.filename, f.source]));

  const registry = new abaplint.Registry(buildConfig({ version: "Cloud", preset: "syntax-only" }));
  const lines = new Map<string, string[]>();
  for (const f of bounded) {
    registry.addFile(new abaplint.MemoryFile(f.filename, f.source));
    lines.set(f.filename, f.source.split("\n"));
  }
  registry.parse();

  for (const obj of registry.getObjectsByType("DDLS")) {
    if (!(obj instanceof abaplint.Objects.DataDefinition)) continue;
    const parsed = obj.getParsedData();
    const definitionName = parsed?.definitionName;
    if (definitionName === undefined) continue;
    const filename = obj.findSourceFile()?.getFilename() ?? obj.getName();
    const source = sourceByFilename.get(filename) ?? "";
    // abaplint read it; whether it owns an entity row is a separate question.
    parsedFiles.add(filename);
    // An extension/annotation carries the BASE entity's definitionName — see
    // `isCdsExtensionSource()`. It contributes no entity of its own and must
    // never overwrite the definition it extends.
    if (isCdsExtensionSource(source)) continue;
    const { shape, projectionOn } = classify(source);
    entities.set(definitionName.toUpperCase(), {
      name: definitionName,
      key: definitionName.toUpperCase(),
      shape,
      projectionOn,
      fields: (parsed?.fields ?? []).map((field) => ({ name: field.name, key: field.key })),
      associations: (parsed?.associations ?? []).map((assoc) => assoc.name),
      filename,
    });
  }

  const findings: RapFinding[] = registry
    .findIssues()
    .filter((issue) => issue.getKey() === "cds_parser_error")
    .map((issue) => {
      const start = issue.getStart();
      const fileLines = lines.get(issue.getFilename());
      const excerpt = (fileLines?.[start.getRow() - 1] ?? "").trim().slice(0, 100);
      const severity = String(issue.getSeverity()).toLowerCase() as RapSeverity;
      return {
        rule: issue.getKey(),
        severity,
        message: issue.getMessage(),
        file: issue.getFilename(),
        line: start.getRow(),
        column: start.getCol(),
        excerpt,
        hint: "Fix the CDS syntax abaplint's own parser rejected, then re-run the RAP checker — this entity contributes no CdsEntityInfo until it does.",
        confidence: "confirmed",
        docsUrl: CDS_PARSER_ERROR_DOCS_URL,
      };
    });

  return { entities, findings, parsedFiles };
}
