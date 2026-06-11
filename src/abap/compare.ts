/**
 * Before/after comparison of ABAP sources — the deterministic half of a
 * rework review.
 *
 * Findings are matched by CONTENT (rule + message + offending line text),
 * never by line number, so code that merely moved does not show up as
 * regressed or fixed. Blocker count / score / grade movement comes from the
 * same objective dual-parse diff check_cloud_readiness uses; this module
 * adds no judgment of its own.
 */
import type { AbapSource, AbapVersion, Finding, FocusTag } from "./engine.js";
import { runAbaplint } from "./engine.js";
import { outlineAbap } from "./outline.js";
import type { ReadinessGrade, ReadinessReport } from "./readiness.js";
import { checkCloudReadiness } from "./readiness.js";

export interface CompareSide {
  findingCount: number;
  cloudBlockerCount: number;
  score: number;
  grade: ReadinessGrade;
}

export interface OutlineChanges {
  classesAdded: string[];
  classesRemoved: string[];
  /** "class.method", lower-cased. */
  methodsAdded: string[];
  methodsRemoved: string[];
  formsAdded: string[];
  formsRemoved: string[];
}

export interface CompareOptions {
  version: AbapVersion;
  preset: "style" | "full" | "syntax-only";
  rules?: Record<string, unknown> | undefined;
  focus?: FocusTag | undefined;
  /** Baseline for the readiness halves; defaults to v758. */
  baselineVersion?: AbapVersion | undefined;
}

export interface CompareReport {
  /** Findings present before but gone after — improvements. */
  resolved: Finding[];
  /** Findings present only after — regressions. */
  introduced: Finding[];
  /** Findings present on both sides (content-matched). */
  unchangedCount: number;
  before: CompareSide;
  after: CompareSide;
  outlineChanges: OutlineChanges;
  matchNote: string;
}

export const MATCH_NOTE =
  "Findings are matched by rule + message + offending line text, not line numbers — moved-but-unchanged code does " +
  "not count as resolved or introduced. Lint numbers use the requested preset; blocker count, score and grade come " +
  "from the same objective dual-parse diff as check_cloud_readiness. Lint-clean does not mean functionally " +
  "equivalent — behavior can change while every number here improves.";

const findingKey = (f: Finding): string => [f.rule, f.message, f.excerpt].join("\u0000");

function diffFindings(
  before: Finding[],
  after: Finding[],
): { resolved: Finding[]; introduced: Finding[]; unchangedCount: number } {
  // Multiset match: two identical findings on the before side need two
  // matches on the after side to count as unchanged.
  const pool = new Map<string, Finding[]>();
  for (const f of before) {
    const arr = pool.get(findingKey(f)) ?? [];
    arr.push(f);
    pool.set(findingKey(f), arr);
  }
  const introduced: Finding[] = [];
  let unchangedCount = 0;
  for (const f of after) {
    const arr = pool.get(findingKey(f));
    if (arr !== undefined && arr.length > 0) {
      arr.pop();
      unchangedCount += 1;
    } else {
      introduced.push(f);
    }
  }
  return { resolved: [...pool.values()].flat(), introduced, unchangedCount };
}

function outlineNames(files: AbapSource[]): { classes: Set<string>; methods: Set<string>; forms: Set<string> } {
  const classes = new Set<string>();
  const methods = new Set<string>();
  const forms = new Set<string>();
  for (const o of outlineAbap(files)) {
    for (const c of o.classes) {
      classes.add(c.name.toLowerCase());
      for (const m of c.methods) methods.add(`${c.name}.${m.name}`.toLowerCase());
    }
    for (const f of o.forms) forms.add(f.toLowerCase());
  }
  return { classes, methods, forms };
}

const addedFrom = (a: Set<string>, b: Set<string>): string[] => [...b].filter((x) => !a.has(x)).sort();

const side = (findingCount: number, readiness: ReadinessReport): CompareSide => ({
  findingCount,
  cloudBlockerCount: readiness.cloudBlockerCount,
  score: readiness.score,
  grade: readiness.grade,
});

export function compareAbap(before: AbapSource[], after: AbapSource[], opts: CompareOptions): CompareReport {
  const lintOpts = { version: opts.version, preset: opts.preset, rules: opts.rules, focus: opts.focus };
  const beforeLint = runAbaplint(before, lintOpts);
  const afterLint = runAbaplint(after, lintOpts);
  const { resolved, introduced, unchangedCount } = diffFindings(beforeLint.findings, afterLint.findings);

  const baseline = opts.baselineVersion ?? "v758";
  const beforeReadiness = checkCloudReadiness(before, baseline);
  const afterReadiness = checkCloudReadiness(after, baseline);

  const b = outlineNames(before);
  const a = outlineNames(after);

  return {
    resolved,
    introduced,
    unchangedCount,
    before: side(beforeLint.findings.length, beforeReadiness),
    after: side(afterLint.findings.length, afterReadiness),
    outlineChanges: {
      classesAdded: addedFrom(b.classes, a.classes),
      classesRemoved: addedFrom(a.classes, b.classes),
      methodsAdded: addedFrom(b.methods, a.methods),
      methodsRemoved: addedFrom(a.methods, b.methods),
      formsAdded: addedFrom(b.forms, a.forms),
      formsRemoved: addedFrom(a.forms, b.forms),
    },
    matchNote: MATCH_NOTE,
  };
}
