/**
 * Deterministic auto-fix — abaplint's own machine-applicable corrections.
 *
 * Many abaplint rules ship a concrete edit with each finding (keyword case,
 * obsolete statements with defined modern replacements, …). This module
 * applies those — and ONLY those. No model, no heuristics: every change is
 * the parser's own fix, so there is nothing to hallucinate.
 *
 * Applied in batches with a safety valve: after every batch the result is
 * re-parsed, and a batch that introduces new parser errors (overlapping
 * edits gone wrong) is discarded — the previous state wins and the run stops
 * early with a note. Findings without a machine fix are returned as
 * `remaining`; rewriting those is judgment work for a human or an agent
 * (verified with compare_abap), never for this module.
 */
import * as abaplint from "@abaplint/core";

import type { AbapSource, Finding, RunOptions } from "./engine.js";
import { boundFiles, buildConfig, runAbaplint } from "./engine.js";

export interface FixedEntry {
  rule: string;
  message: string;
  file: string;
  line: number;
}

export interface FixResult {
  files: { filename: string; source: string; changed: boolean }[];
  /** Total machine fixes applied across all batches. */
  fixedCount: number;
  /** What was fixed (capped at 200 entries; fixedCount carries the total). */
  fixed: FixedEntry[];
  /** Findings still present after fixing — no machine fix exists for these. */
  remaining: Finding[];
  /** Fix batches applied (each batch re-parses before the next). */
  iterations: number;
  /** Set when a batch was discarded by the safety valve or the batch cap hit. */
  stoppedEarly?: string;
}

const MAX_ITERATIONS = 10;
const MAX_FIXED_LISTED = 200;

function parserErrorCount(issues: readonly abaplint.Issue[]): number {
  return issues.filter((i) => i.getKey() === "parser_error" || i.getKey() === "cds_parser_error").length;
}

function buildRegistry(config: abaplint.Config, sources: Map<string, string>): abaplint.Registry {
  const registry = new abaplint.Registry(config);
  for (const [filename, source] of sources) {
    registry.addFile(new abaplint.MemoryFile(filename, source));
  }
  registry.parse();
  return registry;
}

export function fixAbap(files: AbapSource[], opts: RunOptions): FixResult {
  const bounded = boundFiles(files);
  const config = buildConfig(opts);
  const original = new Map(bounded.map((f) => [f.filename, f.source]));
  let current = new Map(original);

  const fixed: FixedEntry[] = [];
  let fixedCount = 0;
  let iterations = 0;
  let stoppedEarly: string | undefined;

  while (iterations < MAX_ITERATIONS) {
    const registry = buildRegistry(config, current);
    const issues = registry.findIssues();
    const parserErrorsBefore = parserErrorCount(issues);
    const fixable = issues.filter((i) => i.getDefaultFix() !== undefined);
    if (fixable.length === 0) break;

    abaplint.Edits.applyEditList(
      registry,
      fixable.map((i) => i.getDefaultFix()!),
    );
    const next = new Map<string, string>();
    for (const filename of current.keys()) {
      next.set(filename, registry.getFileByName(filename)?.getRaw() ?? current.get(filename)!);
    }

    // Safety valve: a batch that breaks the parse (overlapping edits) loses.
    const verify = buildRegistry(config, next);
    if (parserErrorCount(verify.findIssues()) > parserErrorsBefore) {
      stoppedEarly =
        "A fix batch introduced parse errors (overlapping edits) and was discarded; earlier batches are kept.";
      break;
    }

    iterations++;
    fixedCount += fixable.length;
    for (const i of fixable.slice(0, Math.max(0, MAX_FIXED_LISTED - fixed.length))) {
      fixed.push({
        rule: i.getKey(),
        message: i.getMessage(),
        file: i.getFilename(),
        line: i.getStart().getRow(),
      });
    }
    current = next;
  }
  if (iterations === MAX_ITERATIONS && stoppedEarly === undefined) {
    stoppedEarly = `Stopped after ${MAX_ITERATIONS} fix batches; re-run on the output to continue.`;
  }

  const remaining = runAbaplint(
    [...current.entries()].map(([filename, source]) => ({ filename, source })),
    opts,
  ).findings;

  return {
    files: [...current.entries()].map(([filename, source]) => ({
      filename,
      source,
      changed: source !== original.get(filename),
    })),
    fixedCount,
    fixed,
    remaining,
    iterations,
    ...(stoppedEarly !== undefined ? { stoppedEarly } : {}),
  };
}
