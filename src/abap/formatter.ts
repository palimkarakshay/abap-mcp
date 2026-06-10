/**
 * Pretty-print ABAP via abaplint's PrettyPrinter (keyword casing + indent).
 * Only meaningful for ABAP sources — CDS/BDEF artifacts are not reformatted.
 */
import * as abaplint from "@abaplint/core";

import { invalidInput } from "../errors.js";
import { inferFilename, MAX_FILE_CHARS } from "./engine.js";

export function formatAbap(source: string, filename?: string): string {
  if (source.length > MAX_FILE_CHARS) {
    throw invalidInput(`Source exceeds ${MAX_FILE_CHARS} characters.`);
  }
  const name = inferFilename(source, filename);
  if (!name.endsWith(".abap")) {
    throw invalidInput(
      `format_abap handles ABAP sources only (got "${name}"). CDS and behavior definitions are not reformatted.`,
    );
  }
  const config = abaplint.Config.getDefault();
  const registry = new abaplint.Registry(config);
  registry.addFile(new abaplint.MemoryFile(name, source));
  registry.parse();
  const obj = registry.getFirstObject();
  if (!(obj instanceof abaplint.ABAPObject)) {
    throw invalidInput("Could not parse the source as an ABAP object.");
  }
  const file = obj.getABAPFiles()[0];
  if (file === undefined) {
    throw invalidInput("Could not parse the source as an ABAP object.");
  }
  // "Fails cleanly on source it cannot parse" is the tool contract — returning
  // broken code as "formatted" would launder syntax errors. Gate on the
  // parse/structure issues only (style findings are not format blockers).
  const SYNTAX_KEYS = new Set(["parser_error", "structure", "cds_parser_error"]);
  const syntaxIssues = registry.findIssues().filter((i) => SYNTAX_KEYS.has(i.getKey()));
  const firstIssue = syntaxIssues[0];
  if (firstIssue !== undefined) {
    throw invalidInput(
      `Source does not parse cleanly (${syntaxIssues.length} syntax/structure issue(s)); fix before formatting. First: line ${firstIssue.getStart().getRow()}: ${firstIssue.getMessage()}`,
    );
  }
  return new abaplint.PrettyPrinter(file, config).run();
}
