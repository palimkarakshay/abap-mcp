#!/usr/bin/env node
/**
 * Build-time data pipeline (DEV ONLY — this script makes network calls; the
 * MCP server and CLI never do).
 *
 * Fetches SAP's official, Apache-2.0 "ABAP Cloudification Repository" data —
 * the released-API state list for all three editions plus the classic-API
 * classification list — and transforms each into a compact lookup index that
 * ships inside the package at src/data/.
 *
 * Source: SAP/abap-atc-cr-cv-s4hc (Apache-2.0)
 *   https://github.com/SAP/abap-atc-cr-cv-s4hc
 *
 * Run:  node scripts/build-released-api-index.mjs
 *
 * Upstream shape (verified against the live files, not guessed): each record
 * has tadirObject, tadirObjName, objectType, objectKey, softwareComponent,
 * applicationComponent, state, and optionally successorClassification
 * ("oneObject" | "multipleObjects" | "concept"), successorConceptName (only
 * on "concept" records), and successors[] — an array of
 * { tadirObject, tadirObjName, objectType, objectKey } (same 4-field shape
 * for both objectReleaseInfo*.json and objectClassifications_SAP.json).
 *
 * We keep, per record: objectType, state, applicationComponent, and — when
 * present — the successor objects' [objectType, objectKey] pairs. objectKey
 * is the lookup key (a few hundred names collide across object types, hence
 * the array-of-entries-per-key shape); tadirObject/tadirObjName/
 * softwareComponent/successorConceptName are dropped (not needed for a
 * name/type -> state/successor lookup). Successor names are deduplicated
 * into a per-file string table (successorNames) and referenced by index from
 * each entry's optional 4th tuple slot, to keep the shipped files small.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE = "https://github.com/SAP/abap-atc-cr-cv-s4hc";
const RAW_BASE = "https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src";

const EDITIONS = [
  { edition: "s4hc", file: "objectReleaseInfoLatest.json", out: "released-apis.s4hc.json" },
  { edition: "btp", file: "objectReleaseInfo_BTPLatest.json", out: "released-apis.btp.json" },
  { edition: "pce", file: "objectReleaseInfo_PCELatest.json", out: "released-apis.pce.json" },
];
const CLASSIFICATIONS = {
  file: "objectClassifications_SAP.json",
  out: "api-classifications.json",
};

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "src", "data");

async function fetchJson(file) {
  const url = `${RAW_BASE}/${file}`;
  process.stderr.write(`Fetching ${url} …\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed for ${url}: HTTP ${res.status} ${res.statusText}`);
  return { url, json: await res.json() };
}

/**
 * Build a compact index from an array of SAP records sharing the
 * { objectType, objectKey, state, applicationComponent, successors? } shape.
 * A shared successorNames string table + successorGroups array keeps
 * repeated successor object names from being spelled out per-record.
 */
function buildIndex(records) {
  const successorNames = [];
  const nameIndex = new Map(); // name -> index into successorNames
  const successorGroups = []; // each: [objectType, nameIdx][]
  const groupKey = new Map(); // stable group signature -> group index, dedupes identical successor sets

  const nameIdxOf = (name) => {
    let i = nameIndex.get(name);
    if (i === undefined) {
      i = successorNames.length;
      successorNames.push(name);
      nameIndex.set(name, i);
    }
    return i;
  };

  const objects = {};
  let kept = 0;
  for (const r of records) {
    const key = String(r.objectKey).toUpperCase();
    const entry = [r.objectType, r.state, r.applicationComponent];
    const succ = Array.isArray(r.successors) ? r.successors : undefined;
    if (succ !== undefined && succ.length > 0) {
      const group = succ.map((s) => [s.objectType, nameIdxOf(String(s.objectKey).toUpperCase())]);
      const sig = JSON.stringify(group);
      let gi = groupKey.get(sig);
      if (gi === undefined) {
        gi = successorGroups.length;
        successorGroups.push(group);
        groupKey.set(sig, gi);
      }
      entry.push(gi);
    }
    (objects[key] ??= []).push(entry);
    kept += 1;
  }
  return { objects, successorNames, successorGroups, kept, uniqueKeys: Object.keys(objects).length };
}

async function main() {
  const snapshotDate = new Date().toISOString().slice(0, 10);
  let totalRaw = 0;

  for (const { edition, file, out } of EDITIONS) {
    const { url, json } = await fetchJson(file);
    const records = json.objectReleaseInfo;
    if (!Array.isArray(records)) {
      throw new Error(`Unexpected upstream shape for ${file}: objectReleaseInfo is not an array.`);
    }
    const { objects, successorNames, successorGroups, kept, uniqueKeys } = buildIndex(records);
    const outObj = {
      snapshotDate,
      source: SOURCE,
      sourceFile: url,
      license: "Apache-2.0",
      formatVersion: json.formatVersion ?? null,
      edition,
      recordCount: kept,
      entryShape: ["objectType", "state", "applicationComponent", "successorsIndex?"],
      successorNames,
      successorGroups,
      objects,
    };
    const outPath = join(dataDir, out);
    const text = JSON.stringify(outObj) + "\n";
    writeFileSync(outPath, text, "utf8");
    totalRaw += Buffer.byteLength(text, "utf8");
    process.stderr.write(
      `Wrote ${outPath}\n` +
        `  edition: ${edition}\n` +
        `  records: ${kept}  unique keys: ${uniqueKeys}  successor names: ${successorNames.length}  successor groups: ${successorGroups.length}\n` +
        `  bytes: ${text.length}\n`,
    );
  }

  // objectClassifications_SAP.json uses the same per-record shape (state is
  // classicAPI | noAPI | internalAPI instead of released | deprecated |
  // notToBeReleased) and the same optional successors[] — reuse buildIndex.
  {
    const { url, json } = await fetchJson(CLASSIFICATIONS.file);
    const records = json.objectClassifications;
    if (!Array.isArray(records)) {
      throw new Error(`Unexpected upstream shape for ${CLASSIFICATIONS.file}: objectClassifications is not an array.`);
    }
    const { objects, successorNames, successorGroups, kept, uniqueKeys } = buildIndex(records);
    const outObj = {
      snapshotDate,
      source: SOURCE,
      sourceFile: url,
      license: "Apache-2.0",
      formatVersion: json.formatVersion ?? null,
      recordCount: kept,
      entryShape: ["objectType", "state", "applicationComponent", "successorsIndex?"],
      successorNames,
      successorGroups,
      objects,
    };
    const outPath = join(dataDir, CLASSIFICATIONS.out);
    const text = JSON.stringify(outObj) + "\n";
    writeFileSync(outPath, text, "utf8");
    totalRaw += Buffer.byteLength(text, "utf8");
    process.stderr.write(
      `Wrote ${outPath}\n` +
        `  records: ${kept}  unique keys: ${uniqueKeys}  successor names: ${successorNames.length}  successor groups: ${successorGroups.length}\n` +
        `  bytes: ${text.length}\n`,
    );
  }

  process.stderr.write(`\nTotal bundled bytes written this run: ${totalRaw} (${(totalRaw / 1_000_000).toFixed(2)} MB)\n`);
}

main().catch((err) => {
  process.stderr.write(`build-released-api-index failed: ${err.message}\n`);
  process.exit(1);
});
