#!/usr/bin/env node
/**
 * Runs from the npm "version" lifecycle script, i.e. on every `npm version …`
 * (including the weekly auto-upgrade's `--no-git-tag-version` bump): copies the
 * new package.json version into the manifests npm does not know about.
 *
 * server.json is deliberately NOT touched here — the MCP registry rejects a
 * version npm has not published yet, so it is synced after the publish lands.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

for (const rel of ["plugins/abap-mcp/.codex-plugin/plugin.json"]) {
  const file = join(root, rel);
  const before = readFileSync(file, "utf8");
  // Textual replace of the first "version" field keeps the file's formatting byte-for-byte.
  const after = before.replace(/("version":\s*")[^"]*(")/, `$1${version}$2`);
  if (after === before) continue;
  writeFileSync(file, after);
  console.log(`synced ${rel} -> ${version}`);
}
