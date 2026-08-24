#!/usr/bin/env node
/**
 * Post-build step: copy the bundled JSON data assets to dist/.
 *
 * tsc compiles .ts only and does not emit imported .json files, so the
 * `import index from "../data/released-apis.json"` in dist/abap/released.js
 * would resolve to a missing file without this copy. Keeping the data in
 * dist/data/ (and dist/ in package.json "files") is what makes the released-API
 * lookup work at runtime with NO network and NO user-filesystem access — the
 * data is a package-bundled asset, like abaplint's own bundled rule metadata.
 */
import { chmodSync, mkdirSync, readdirSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "..", "src", "data");
const distDir = join(here, "..", "dist");
const destDir = join(distDir, "data");

mkdirSync(destDir, { recursive: true });
let copied = 0;
for (const name of readdirSync(srcDir)) {
  if (!name.endsWith(".json")) continue;
  copyFileSync(join(srcDir, name), join(destDir, name));
  copied += 1;
}
for (const bin of ["cli.js", "http.js"]) chmodSync(join(distDir, bin), 0o755);
process.stderr.write(
  `copy-data: copied ${copied} JSON file(s) to dist/data/; marked 2 bin file(s) executable\n`,
);
