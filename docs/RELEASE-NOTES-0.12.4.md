# abap-mcp v0.12.4 — fixes for two tools that failed in real clients

A fix release. If you installed 0.12.0, update: two default tools and the offline unit runner did
not work for most users. Versions 0.12.1–0.12.3 were dependency bumps that were never published.

## Fixed

- **`check_cloud_readiness` and `get_object_dependencies` failed with `MCP error -32602`** in any
  client that lists tools before calling them (which is every real client). Their results carried
  two keys the declared output schemas did not allow: `rewrite` on readiness categories and
  `successorSource` on dependency nodes. Both are now declared. The CLI commands `readiness` and
  `deps` were never affected.
- **The offline ABAP Unit runner failed on every fresh install** (`transpile_error … cl_json`).
  The `@abaplint/core` range floated to a release the pinned transpiler could not work with.
  `@abaplint/core`, `@abaplint/transpiler` and `@abaplint/runtime` are now pinned exactly, as a
  matched set (2.120.68 / 2.13.99 / 2.13.99).
- **`abap-mcp setup --help` registered the server with your editor** instead of printing help.
  `setup` now prints usage for `--help` and refuses any other flag.
- **The server announced itself as 0.12.0** regardless of the installed version. The version now
  comes from `package.json`.
- `abap-mcp fix` crashed on a symlink cycle, and `fix --write` could write through a symlinked
  file to a target outside the folder being fixed. It now skips symlinked files.
- A `null` rule override (`rules: { "some_rule": null }`) surfaced an internal error. It is now
  rejected as invalid input.

## Added

- `abap-mcp --version`.
- `THIRD-PARTY-NOTICES.md` ships in the package: the Apache-2.0 licence text and attribution for
  the bundled SAP Cloudification Repository data, and the MIT notice for open-abap-core.
- `abap-mcp-genai` refuses to send credentials to a URL that is not https (loopback excepted).

## Changed

- The released-API snapshot is refreshed from SAP's repository (2026-10-05).
- Knowledge base: the Joule for Developers card reflects the end of the free promotional period
  (2026-09-30) and the commercial model from 2026-10-01.
- `run_abap_unit` no longer claims "no network". Node's permission model confines file access and
  blocks child processes, but it does not block network access. The bundled runtime makes no
  network calls; do not treat the sandbox as a network boundary, and do not enable the runner on
  a network-reachable HTTP listener you share.
- `@modelcontextprotocol/sdk` ^1.32.1.
- `docs/INSTALL.md` said Node 20; the floor is Node 22.

## Why the tests missed the two main defects, and what changed

- The test client called tools without listing them first, which skips output-schema validation.
  A new contract test lists tools first and then runs every tool's worked examples, plus inputs
  that fill the optional branches, against the advertised schemas.
- CI installed from the lockfile, which no `npx` user gets. A second CI job now runs the full gate
  on freshly resolved dependencies, on every push and weekly.
