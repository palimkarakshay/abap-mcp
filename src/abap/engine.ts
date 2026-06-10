/**
 * The abaplint engine wrapper.
 *
 * Design rules:
 *  - A fresh in-memory Registry per call — no shared state, safe under
 *    concurrent tool calls (pattern proven in RAP Dojo's /api/lint-abap).
 *  - abaplint PARSES the input, it never executes it. Inputs are still
 *    bounded (file count / chars) to keep each call cheap.
 *  - Filenames drive abaplint's object typing (zcl_x.clas.abap = a class).
 *    Callers may omit them; we infer from the source's leading statement.
 */
import * as abaplint from "@abaplint/core";

export interface AbapSource {
  filename?: string | undefined;
  source: string;
}

export interface Finding {
  rule: string;
  message: string;
  severity: string;
  file: string;
  line: number;
  column: number;
  /** First ~100 chars of the offending line, for fix-it-without-reopening flows. */
  excerpt: string;
  docsUrl: string;
}

export const MAX_FILES = 32;
export const MAX_FILE_CHARS = 100_000;
export const MAX_FINDINGS = 500;

/** ABAP language versions a caller may target. */
export const ABAP_VERSIONS = [
  "Cloud",
  "v750",
  "v751",
  "v752",
  "v753",
  "v754",
  "v755",
  "v756",
  "v757",
  "v758",
] as const;
export type AbapVersion = (typeof ABAP_VERSIONS)[number];

const FILENAME_RE =
  /^[a-zA-Z0-9_#-]+\.(clas\.abap|clas\.locals_imp\.abap|clas\.locals_def\.abap|clas\.testclasses\.abap|prog\.abap|intf\.abap|fugr\.abap|ddls\.asddls|bdef\.asbdef|srvd\.srvdsrv|ddlx\.asddlx)$/;

/**
 * Infer an abapGit-conventional filename from the source's first meaningful
 * statement, so agents can lint snippets without knowing the convention.
 */
export function inferFilename(source: string, given?: string): string {
  if (given !== undefined) {
    if (!FILENAME_RE.test(given)) {
      throw new Error(
        `Filename "${given}" is not an abapGit-style name (e.g. zcl_foo.clas.abap, zfoo.prog.abap, zr_foo.ddls.asddls).`,
      );
    }
    return given.toLowerCase();
  }
  const head = source
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("*") && !l.startsWith('"'))
    .slice(0, 5)
    .join("\n");
  const classMatch = /^\s*CLASS\s+(\w+)\s+DEFINITION/im.exec(head);
  if (classMatch?.[1] !== undefined) return `${classMatch[1].toLowerCase()}.clas.abap`;
  const intfMatch = /^\s*INTERFACE\s+(\w+)/im.exec(head);
  if (intfMatch?.[1] !== undefined) return `${intfMatch[1].toLowerCase()}.intf.abap`;
  if (/^\s*(@\w|define\s+(root\s+)?view)/im.test(head)) return "zsnippet.ddls.asddls";
  if (/^\s*(managed|unmanaged|abstract|projection|interface;)/im.test(head))
    return "zsnippet.bdef.asbdef";
  const progMatch = /^\s*(REPORT|PROGRAM)\s+(\w+)/im.exec(head);
  if (progMatch?.[2] !== undefined) return `${progMatch[2].toLowerCase()}.prog.abap`;
  return "zsnippet.prog.abap";
}

function boundFiles(files: AbapSource[]): { filename: string; source: string }[] {
  if (files.length === 0) throw new Error("Provide at least one source file.");
  if (files.length > MAX_FILES) throw new Error(`At most ${MAX_FILES} files per call.`);
  return files.map((f) => {
    if (f.source.length > MAX_FILE_CHARS) {
      throw new Error(
        `File ${f.filename ?? "(unnamed)"} exceeds ${MAX_FILE_CHARS} characters; split it or lint the relevant part.`,
      );
    }
    return { filename: inferFilename(f.source, f.filename), source: f.source };
  });
}

export interface RunOptions {
  version: AbapVersion;
  /** abaplint rule config; merged over the preset. */
  rules?: Record<string, unknown> | undefined;
  /**
   * "style"       — abaplint's default ruleset minus whole-program semantic
   *                 checks, so isolated snippets don't drown in noise about
   *                 objects that simply weren't provided.
   * "full"        — abaplint's default ruleset as-is (expects you to provide
   *                 every referenced dev object).
   * "syntax-only" — parser + CDS parser errors only.
   */
  preset: "style" | "full" | "syntax-only";
}

function buildConfig(opts: RunOptions): abaplint.Config {
  let raw: Record<string, unknown>;
  if (opts.preset === "syntax-only") {
    raw = {
      global: { files: "/**/*" },
      syntax: { version: opts.version, errorNamespace: "^(Z|Y)" },
      rules: { parser_error: true, cds_parser_error: true },
    };
  } else {
    const def = abaplint.Config.getDefault().get() as unknown as {
      syntax: { version: string };
      rules: Record<string, unknown>;
    };
    def.syntax.version = opts.version;
    if (opts.preset === "style") {
      // Semantic whole-program checks false-positive on isolated snippets.
      def.rules["check_syntax"] = false;
    }
    raw = def as unknown as Record<string, unknown>;
  }
  if (opts.rules !== undefined) {
    const rules = raw["rules"] as Record<string, unknown>;
    for (const [k, v] of Object.entries(opts.rules)) rules[k] = v;
  }
  return new abaplint.Config(JSON.stringify(raw));
}

export interface RunResult {
  findings: Finding[];
  truncated: boolean;
  fileCount: number;
}

export function runAbaplint(files: AbapSource[], opts: RunOptions): RunResult {
  const bounded = boundFiles(files);
  const registry = new abaplint.Registry(buildConfig(opts));
  const lines = new Map<string, string[]>();
  for (const f of bounded) {
    registry.addFile(new abaplint.MemoryFile(f.filename, f.source));
    lines.set(f.filename, f.source.split("\n"));
  }
  registry.parse();
  const issues = registry.findIssues();
  const findings = issues.slice(0, MAX_FINDINGS).map((issue) => {
    const start = issue.getStart();
    const fileLines = lines.get(issue.getFilename());
    const excerpt = (fileLines?.[start.getRow() - 1] ?? "").trim().slice(0, 100);
    return {
      rule: issue.getKey(),
      message: issue.getMessage(),
      severity: String(issue.getSeverity()),
      file: issue.getFilename(),
      line: start.getRow(),
      column: start.getCol(),
      excerpt,
      docsUrl: `https://rules.abaplint.org/${issue.getKey()}/`,
    };
  });
  return { findings, truncated: issues.length > MAX_FINDINGS, fileCount: bounded.length };
}
