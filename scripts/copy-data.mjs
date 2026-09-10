#!/usr/bin/env node
/**
 * Post-build step: copy the bundled data assets to dist/.
 *
 * tsc compiles .ts only and does not emit imported .json files, so the
 * `import index from "../data/released-apis.json"` in dist/abap/released.js
 * would resolve to a missing file without this copy. Keeping the data in
 * dist/data/ (and dist/ in package.json "files") is what makes the released-API
 * lookup work at runtime with NO network and NO user-filesystem access — the
 * data is a package-bundled asset, like abaplint's own bundled rule metadata.
 *
 * The copy is RECURSIVE over src/data: alongside the flat *.json snapshots
 * there are now subdirectories (the knowledge base, the ABAP AI SDK stubs,
 * the vendored open-abap-core library), and every one of them has to reach
 * dist/data/ intact or the tool that imports it fails at serve time.
 */
import { chmodSync, mkdirSync, readdirSync, copyFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

/** Extensions we ship as data. Anything else in src/data is a mistake, not an asset. */
const DATA_EXTENSIONS = [".json", ".abap", ".md", ".txt"];

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src", "data");
const distDir = join(here, "..", "dist");
const destDir = join(distDir, "data");

let copied = 0;
let bytes = 0;
let skipped = 0;

function copyTree(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of readdirSync(from)) {
    const src = join(from, name);
    const dest = join(to, name);
    if (statSync(src).isDirectory()) {
      copyTree(src, dest);
      continue;
    }
    if (!DATA_EXTENSIONS.some((ext) => name.endsWith(ext))) {
      process.stderr.write(`copy-data: skipping ${relative(srcDir, src)} (not a data asset)\n`);
      skipped += 1;
      continue;
    }
    copyFileSync(src, dest);
    copied += 1;
    bytes += statSync(src).size;
  }
}

copyTree(srcDir, destDir);
for (const bin of ["cli.js", "http.js"]) chmodSync(join(distDir, bin), 0o755);
process.stderr.write(
  `copy-data: copied ${copied} data file(s) (${(bytes / 1024 / 1024).toFixed(1)} MB) to dist/data/` +
    `${skipped > 0 ? `, skipped ${skipped}` : ""}; marked 2 bin file(s) executable\n`,
);
