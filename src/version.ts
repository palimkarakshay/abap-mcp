import { createRequire } from "node:module";

/**
 * The package version, read from package.json at load time so the banner, the
 * MCP handshake and `--version` can never drift from what was published.
 * `../package.json` resolves from both src/ (tests) and dist/ (installed).
 */
export const PACKAGE_VERSION: string = (
  createRequire(import.meta.url)("../package.json") as { version: string }
).version;
