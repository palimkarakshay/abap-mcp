#!/usr/bin/env node
/**
 * Build-time data pipeline (DEV ONLY — this script makes a network call; the
 * MCP server and CLI never do).
 *
 * Vendors the ABAP standard-library sources of open-abap-core (MIT) into the
 * compact JSON bundle that ships inside the package at
 * `src/data/open-abap-core.json`. `run_abap_unit` needs those sources at run
 * time: the transpiler resolves `cl_abap_unit_assert`, `kernel_unit_runner`,
 * the exception classes and the RTTI/DDIC scaffolding from them, added to the
 * registry as *dependencies* (never as user code).
 *
 * Source: open-abap/open-abap-core (MIT)
 *   https://github.com/open-abap/open-abap-core
 *
 * Run:  node scripts/build-open-abap-lib.mjs
 *
 * Shape (one flat list — abaplint keys objects off the abapGit-style basename,
 * and the upstream tree has no basename collisions, verified below):
 *   { source, license, licenseText, commit, retrievedAt, fileCount,
 *     files: [{ name, content }] }
 *
 * ~1.4 MB raw / ~180 KB gzipped for all 706 files. If upstream ever grows past
 * MAX_RAW_BYTES the script fails loudly rather than silently bloating the npm
 * package — drop `*.testclasses.abap` first (they are the library's own tests,
 * never needed to run a caller's tests).
 */
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "https://github.com/open-abap/open-abap-core";
const MAX_RAW_BYTES = 6_000_000;

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "src", "data", "open-abap-core.json");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function main() {
  const work = mkdtempSync(join(tmpdir(), "abap-mcp-openabap-"));
  const checkout = join(work, "open-abap-core");
  try {
    process.stderr.write(`Cloning ${REPO} (depth 1) …\n`);
    execFileSync("git", ["clone", "--depth", "1", REPO, checkout], { stdio: ["ignore", "ignore", "inherit"] });
    const commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const licenseText = readFileSync(join(checkout, "LICENSE"), "utf8");
    if (!licenseText.includes("MIT License")) {
      throw new Error("Upstream LICENSE is no longer MIT — stop and re-check the licensing boundary.");
    }

    const files = [];
    const seen = new Set();
    for (const p of walk(join(checkout, "src"))) {
      const name = p.slice(p.lastIndexOf("/") + 1);
      if (seen.has(name)) {
        // abaplint keys a MemoryFile by its (flat) filename; two files sharing
        // a basename would silently overwrite each other in the registry.
        throw new Error(`Duplicate basename in upstream src/: ${name}`);
      }
      seen.add(name);
      files.push({ name, content: readFileSync(p, "utf8") });
    }
    files.sort((a, b) => (a.name < b.name ? -1 : 1)); // deterministic output

    const bundle = {
      source: REPO,
      license: "MIT",
      licenseText,
      commit,
      retrievedAt: new Date().toISOString().slice(0, 10),
      fileCount: files.length,
      files,
    };
    const json = JSON.stringify(bundle);
    if (json.length > MAX_RAW_BYTES) {
      throw new Error(
        `Bundle is ${json.length} bytes, over the ${MAX_RAW_BYTES}-byte budget — exclude *.testclasses.abap and re-run.`,
      );
    }
    writeFileSync(outFile, json);
    process.stderr.write(
      `Wrote ${outFile}: ${files.length} files, ${(json.length / 1024).toFixed(0)} KB raw, ` +
        `${(gzipSync(json).length / 1024).toFixed(0)} KB gzipped, commit ${commit.slice(0, 12)}\n`,
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

main();
