#!/usr/bin/env node
/**
 * Build-time data pipeline (DEV ONLY — this script makes a network call; the
 * MCP server and CLI never do).
 *
 * Fetches SAP's official, Apache-2.0 "ABAP Cloudification Repository" object
 * release list and transforms it into the compact lookup index that ships
 * inside the package at src/data/released-apis.json.
 *
 * Source: SAP/abap-atc-cr-cv-s4hc (Apache-2.0)
 *   https://github.com/SAP/abap-atc-cr-cv-s4hc
 *
 * Run:  node scripts/build-released-api-index.mjs
 *
 * The full upstream file is ~9 MB / ~34k records with many fields we don't
 * need for a name→state lookup. We keep only:
 *   - objectKey   (UPPERCASED — the lookup key)
 *   - objectType  (TABL, CDS_STOB, FUNC, CLAS, INTF, BDEF, …)
 *   - state       (released | deprecated | notToBeReleased)
 *   - applicationComponent (so a finding can point at the owning area)
 * and drop tadirObject/tadirObjName/softwareComponent/successors. (The curated
 * src/data/table-successors.json carries the hand-checked successor hints.)
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SOURCE_URL =
  "https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/objectReleaseInfoLatest.json";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "src", "data", "released-apis.json");

async function main() {
  process.stderr.write(`Fetching ${SOURCE_URL} …\n`);
  const res = await fetch(SOURCE_URL);
  if (!res.ok) {
    throw new Error(`Download failed: HTTP ${res.status} ${res.statusText}`);
  }
  const raw = await res.json();
  const records = raw.objectReleaseInfo;
  if (!Array.isArray(records)) {
    throw new Error("Unexpected upstream shape: objectReleaseInfo is not an array.");
  }

  // KEY (uppercased objectKey) -> array of compact entries. An array because a
  // few hundred names collide across object types (e.g. a BDEF and a CDS_STOB
  // share a name); the lookup resolves by objectType when the caller gives one.
  // The objectKey is the map key, so it is NOT repeated inside each entry; each
  // entry is [objectType, state, applicationComponent] to keep the file small.
  const index = {};
  let kept = 0;
  for (const r of records) {
    const key = String(r.objectKey).toUpperCase();
    (index[key] ??= []).push([r.objectType, r.state, r.applicationComponent]);
    kept += 1;
  }

  const out = {
    snapshotDate: new Date().toISOString().slice(0, 10),
    source: "https://github.com/SAP/abap-atc-cr-cv-s4hc",
    sourceFile: SOURCE_URL,
    license: "Apache-2.0",
    formatVersion: raw.formatVersion ?? null,
    recordCount: kept,
    // Each value is an array of [objectType, state, applicationComponent]
    // tuples; the uppercased objectKey is the map key.
    entryShape: ["objectType", "state", "applicationComponent"],
    objects: index,
  };

  writeFileSync(outFile, JSON.stringify(out) + "\n", "utf8");
  process.stderr.write(
    `Wrote ${outFile}\n` +
      `  records: ${kept}\n` +
      `  unique keys: ${Object.keys(index).length}\n` +
      `  snapshotDate: ${out.snapshotDate}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`build-released-api-index failed: ${err.message}\n`);
  process.exit(1);
});
