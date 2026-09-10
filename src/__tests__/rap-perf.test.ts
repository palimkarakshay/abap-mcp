/**
 * The performance budget — spec `docs/specs/rap-checker-design.md` §6.5.
 *
 * `checkRapBehavior()` is what an agent calls between writing a BDEF and
 * pasting it into ADT, and what `lint_abap` and `abap-mcp rapcheck` call for
 * every file of a repo sweep. It is a single pass over ≤100 k characters with
 * no I/O and no caching (spec §2.7), so it has no business being slow — but a
 * quadratic rule (one that walks every entity of every file for every file)
 * would not show up in any correctness test. This one fails when it lands.
 *
 * **What is measured.** One `checkRapBehavior()` call per fixture repository,
 * batched at `MAX_RAP_FILES`, over the whole corpus: the BDEFs, the service
 * definitions AND the CDS views, because the `.ddls` half runs abaplint's own
 * parser and is part of what a caller waits for. Wall time comes from
 * `performance.now()` around the calls only — walking and reading the fixture
 * files is excluded, that cost is the test's, not the checker's.
 *
 * **Two bars, on purpose.** The spec's budget is a mean under **50 ms per
 * file**; the assertion fires only above **100 ms per file**, because this
 * runs on shared CI and on a 4-OCPU ARM box where a neighbour's build can
 * double a wall-clock number without anything having regressed. The measured
 * mean is printed either way, and crossing 50 ms logs a warning — a slow trend
 * stays visible long before the build turns red.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_FINDINGS } from "../abap/engine.js";
import type { AbapSource } from "../abap/engine.js";
import { MAX_RAP_FILES, checkRapBehavior } from "../abap/rap/index.js";

const FIXTURES = new URL("../../evals/rap/fixtures/", import.meta.url).pathname;

/** Spec §6.5's budget. */
const BUDGET_MS_PER_FILE = 50;
/** The bar that actually fails the build — generous headroom for shared CI. */
const CI_LIMIT_MS_PER_FILE = 100;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const RAP_EXT = /\.(?:bdef\.asbdef|srvd\.srvdsrv|ddls\.asddls)$/i;

/**
 * One batch per repository — the unit a caller actually has (`rap-rules.test.ts`
 * makes the same argument for the anti-noise gate), capped at the library's own
 * `MAX_RAP_FILES` so the measurement never exceeds a call the tool would accept.
 */
function corpusBatches(): AbapSource[][] {
  const batches: AbapSource[][] = [];
  const repos = readdirSync(FIXTURES)
    .filter((entry) => statSync(join(FIXTURES, entry)).isDirectory())
    .sort();
  for (const repo of repos) {
    const files = walk(join(FIXTURES, repo))
      .filter((file) => RAP_EXT.test(file))
      .sort()
      .map((file) => ({ filename: file.split("/").pop() as string, source: readFileSync(file, "utf8") }));
    for (let i = 0; i < files.length; i += MAX_RAP_FILES) {
      batches.push(files.slice(i, i + MAX_RAP_FILES));
    }
  }
  return batches;
}

describe("performance budget (spec §6.5)", () => {
  const batches = corpusBatches();
  const fileCount = batches.reduce((n, batch) => n + batch.length, 0);

  it("holds the corpus this budget is measured over", () => {
    expect(batches.length).toBeGreaterThanOrEqual(17);
    expect(fileCount).toBeGreaterThanOrEqual(240);
  });

  it("checks the whole corpus well inside the per-file budget", () => {
    // One untimed pass so the measurement is of steady-state work, not of the
    // first-call JIT and abaplint registry warm-up.
    for (const batch of batches) checkRapBehavior(batch);

    let peakFindings = 0;
    const started = performance.now();
    for (const batch of batches) {
      const report = checkRapBehavior(batch);
      peakFindings = Math.max(peakFindings, report.findings.length);
    }
    const elapsed = performance.now() - started;
    const meanMs = elapsed / fileCount;

    // eslint-disable-next-line no-console -- the measurement is the point.
    console.log(
      `rap-perf: ${fileCount} files in ${batches.length} calls — ${elapsed.toFixed(0)} ms total, ` +
        `mean ${meanMs.toFixed(2)} ms/file (budget ${BUDGET_MS_PER_FILE}, CI limit ${CI_LIMIT_MS_PER_FILE}).`,
    );
    if (meanMs > BUDGET_MS_PER_FILE) {
      // eslint-disable-next-line no-console -- a trend worth seeing before it is a failure.
      console.warn(`rap-perf: over the §6.5 budget of ${BUDGET_MS_PER_FILE} ms/file — investigate before it doubles.`);
    }

    expect(meanMs).toBeLessThan(CI_LIMIT_MS_PER_FILE);
    // Spec §6.5's second half: the report cap is never exceeded.
    expect(peakFindings).toBeLessThanOrEqual(MAX_FINDINGS);
  });
});
