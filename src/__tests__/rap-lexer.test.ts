/**
 * Lexer gate for the RAP BDL/SDL tokenizer (spec §2.1, §7 step 1).
 *
 * Every case below is a real line (or a real shape) from the 102-file
 * Apache-2.0 corpus under `evals/rap/fixtures/`, plus the normalisation and
 * cap behaviour the parser above it depends on.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MAX_FILE_CHARS } from "../abap/engine.js";
import {
  excerptOf,
  MAX_RAP_LEX_ERRORS,
  MAX_RAP_TOKENS,
  normalizeRapSource,
  stringValue,
  tokenize,
  type Token,
} from "../abap/rap/lexer.js";

const FIXTURES = new URL("../../evals/rap/fixtures/", import.meta.url).pathname;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Token stream without the trailing `eof`, as `kind:text` pairs. */
function shape(source: string): string[] {
  return tokenize(source)
    .tokens.filter((t) => t.kind !== "eof")
    .map((t) => `${t.kind}:${t.text}`);
}

function keys(source: string): string[] {
  return tokenize(source)
    .tokens.filter((t) => t.kind !== "eof")
    .map((t) => t.key);
}

describe("normalisation", () => {
  it("strips a UTF-8 BOM and normalises CRLF and lone CR to LF", () => {
    expect(normalizeRapSource("﻿managed;\r\nstrict ( 2 );\rwith draft;\n")).toBe(
      "managed;\nstrict ( 2 );\nwith draft;\n",
    );
  });

  it("numbers lines on the normalised text, so a CRLF file reports the same positions", () => {
    const lf = tokenize("managed;\nstrict ( 2 );\nwith draft;\n");
    const crlf = tokenize("﻿managed;\r\nstrict ( 2 );\r\nwith draft;\r\n");
    const positions = (result: { tokens: Token[] }): string[] =>
      result.tokens.map((t) => `${t.text}@${t.line}:${t.column}-${t.endLine}:${t.endColumn}`);
    expect(positions(crlf)).toEqual(positions(lf));
    expect(crlf.tokens[2]).toMatchObject({ text: "strict", line: 2, column: 1, endColumn: 7 });
    expect(crlf.tokens.at(-1)).toMatchObject({ kind: "eof", line: 4, column: 1 });
  });

  it("both line and column are 1-based, matching Finding in engine.ts", () => {
    const first = tokenize("  managed;").tokens[0];
    expect(first).toMatchObject({ line: 1, column: 3 });
  });
});

describe("tokens", () => {
  it("lexes `strict(2);` unspaced exactly like `strict ( 2 );`", () => {
    expect(shape("strict(2);")).toEqual(["ident:strict", "punct:(", "number:2", "punct:)", "punct:;"]);
    expect(keys("strict(2);")).toEqual(keys("strict ( 2 );"));
  });

  it("lexes a namespaced name as ONE identifier", () => {
    expect(shape("/DMO/I_Agency_StdVH")).toEqual(["ident:/DMO/I_Agency_StdVH"]);
    expect(shape("define behavior for /CC4A/TEST_RAP_UNAMANAGED")).toEqual([
      "ident:define",
      "ident:behavior",
      "ident:for",
      "ident:/CC4A/TEST_RAP_UNAMANAGED",
    ]);
  });

  it("lexes `result [1] $self`", () => {
    expect(shape("result [1] $self")).toEqual([
      "ident:result",
      "punct:[",
      "number:1",
      "punct:]",
      "ident:$self",
    ]);
    expect(keys("result [1] $SELF")).toContain("$SELF");
  });

  it("lexes `[0..*]` with `..` as a single token", () => {
    expect(shape("[0..*]")).toEqual(["punct:[", "number:0", "punct:..", "punct:*", "punct:]"]);
  });

  it("lexes `Booking~validateBookingStatus` as name ~ name", () => {
    expect(shape("validation Booking~validateBookingStatus;")).toEqual([
      "ident:validation",
      "ident:Booking",
      "punct:~",
      "ident:validateBookingStatus",
      "punct:;",
    ]);
  });

  it("lexes `hierarchy-index` as three tokens the parser folds back together", () => {
    expect(shape("field ( hierarchy-index ) Node;")).toEqual([
      "ident:field",
      "punct:(",
      "ident:hierarchy",
      "punct:-",
      "ident:index",
      "punct:)",
      "ident:Node",
      "punct:;",
    ]);
  });

  it("has no reserved words — `Description`, `Quantity` and `Notes` stay plain identifiers", () => {
    const result = tokenize("field ( readonly ) Description, Notes, Quantity;");
    expect(result.tokens.every((t) => t.kind === "ident" || t.kind === "punct" || t.kind === "eof")).toBe(true);
    expect(result.tokens.filter((t) => t.kind === "ident").map((t) => t.key)).toEqual([
      "FIELD",
      "READONLY",
      "DESCRIPTION",
      "NOTES",
      "QUANTITY",
    ]);
  });

  it("upper-cases `key` for case-insensitive comparison but keeps `text` verbatim", () => {
    const [token] = tokenize("ZRAP630C_ShopTP_SOL").tokens;
    expect(token).toMatchObject({ text: "ZRAP630C_ShopTP_SOL", key: "ZRAP630C_SHOPTP_SOL" });
  });
});

describe("comments", () => {
  it("keeps `//` comments out of the main stream and in the side channel", () => {
    const result = tokenize(
      "determination calculateTotalPrice on modify { create; }  //**\ncreate;",
    );
    expect(result.comments.map((c) => c.text)).toEqual(["//**"]);
    expect(result.tokens.some((t) => t.text.includes("//"))).toBe(false);
    expect(result.tokens.at(-2)).toMatchObject({ key: ";", line: 2 });
  });

  it("accepts a `/* … */` block comment defensively (unconfirmed for BDL, never rejected)", () => {
    const result = tokenize("create; /* disabled\n   for now */ update;");
    expect(result.errors).toEqual([]);
    expect(result.comments).toHaveLength(1);
    expect(keys("create; /* x */ update;")).toEqual(["CREATE", ";", "UPDATE", ";"]);
  });

  it("reports an unterminated block comment", () => {
    const result = tokenize("create; /* never closed");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message).toMatch(/Unterminated block comment/);
  });

  it("a comment inside a wrapped field list does not break the statement", () => {
    const source = [
      "field ( readonly )",
      "  Quantity,",
      "//  BgpfStatus,",
      "//  BgpgProcessName,",
      "",
      "  ApplLogHandle",
      "  ;",
    ].join("\n");
    expect(keys(source)).toEqual([
      "FIELD",
      "(",
      "READONLY",
      ")",
      "QUANTITY",
      ",",
      "APPLLOGHANDLE",
      ";",
    ]);
    const semicolon = tokenize(source).tokens.at(-2);
    expect(semicolon).toMatchObject({ key: ";", line: 7, column: 3 });
  });
});

describe("strings", () => {
  it("lexes `@EndUserText.label: 'x''y'` with `''` as the escaped quote", () => {
    const result = tokenize("@EndUserText.label: 'x''y'");
    expect(result.tokens.filter((t) => t.kind !== "eof").map((t) => t.kind)).toEqual([
      "punct",
      "ident",
      "punct",
      "ident",
      "punct",
      "string",
    ]);
    const literal = result.tokens.find((t) => t.kind === "string");
    expect(literal?.text).toBe("'x''y'");
    expect(literal !== undefined && stringValue(literal)).toBe("x'y");
  });

  it("reports an unterminated string literal", () => {
    const result = tokenize("expose ZC_Foo as 'Foo;");
    expect(result.errors[0]?.message).toMatch(/Unterminated string/);
  });
});

describe("lexical errors", () => {
  it("rejects `$` outside `$self`", () => {
    const result = tokenize("result [1] $draft");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ line: 1, column: 12 });
    expect(result.errors[0]?.message).toMatch(/\$self/);
  });

  it("rejects a `/` that is not a namespace prefix", () => {
    const result = tokenize("create / update;");
    expect(result.errors[0]?.message).toMatch(/namespace prefix/);
  });

  it("reports an unexpected character with its excerpt", () => {
    const result = tokenize("create;\nupdate ? ;");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ line: 2, column: 8, excerpt: "update ? ;" });
  });

  // One bad thing is one finding (spec §1.3, §3.3). A RUN of illegal characters
  // is one lexical problem; emitting one error per character turned a line of
  // junk into a wall of duplicate RAP-PARSE findings.
  it("folds a run of illegal characters into a single error", () => {
    const result = tokenize("!!!");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ line: 1, column: 1 });
    expect(result.errors[0]?.message).toMatch(/3 characters/);
  });

  it("splits runs that are separated by something lexable", () => {
    // `#` is punctuation (a CDS annotation enum value, see PUNCT_CHARS), so
    // the third run here is `%%%`, not `###`.
    expect(tokenize("!!! ??? %%%").errors).toHaveLength(3);
    expect(tokenize("!!!create???").errors).toHaveLength(2);
  });

  // `#ENUM` is legal CDS annotation syntax (`@ObjectModel.
  // supportedCapabilities: [ #ANALYTICAL_QUERY ]`); it used to be a hard
  // lexical error that cascaded into SRVD001 "exposes nothing".
  it("lexes `#` as punctuation, not as an illegal character", () => {
    const result = tokenize("@Scope: #TABLE");
    expect(result.errors).toEqual([]);
    expect(result.tokens.map((t) => t.key).slice(0, 4)).toEqual(["@", "SCOPE", ":", "#"]);
    expect(result.tokens[4]).toMatchObject({ kind: "ident", key: "TABLE" });
  });

  it("bounds the run quoted back in the message", () => {
    const result = tokenize("!".repeat(5_000));
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.message.length).toBeLessThan(100);
    expect(result.errors[0]?.message).toMatch(/5000 characters/);
  });
});

describe("caps", () => {
  it("stops at MAX_FILE_CHARS and says so", () => {
    const result = tokenize("create;\n".repeat(Math.ceil(MAX_FILE_CHARS / 8) + 10));
    expect(result.truncated).toBe(true);
    expect(result.errors[0]?.message).toMatch(new RegExp(String(MAX_FILE_CHARS)));
  });

  it("stops at MAX_RAP_TOKENS", () => {
    expect(MAX_RAP_TOKENS).toBe(200_000);
    const result = tokenize("a ".repeat(MAX_RAP_TOKENS + 50));
    expect(result.truncated).toBe(true);
    expect(result.tokens.length).toBeLessThanOrEqual(MAX_RAP_TOKENS + 1);
  });

  // Mirrors the parser's MAX_RECOVERY_EVENTS: without this cap a file of 90 000
  // illegal characters produced 90 000 LexErrors (~16 MB of excerpts), and
  // `truncated` still claimed the scan was complete.
  it("stops recording after MAX_RAP_LEX_ERRORS and admits it via truncated", () => {
    expect(MAX_RAP_LEX_ERRORS).toBe(200);
    const result = tokenize("! ".repeat(MAX_RAP_LEX_ERRORS + 500));
    expect(result.errors).toHaveLength(MAX_RAP_LEX_ERRORS);
    expect(result.truncated).toBe(true);
  });

  it("keeps a lexically hostile file cheap to report", () => {
    const result = tokenize("!".repeat(90_000));
    expect(result.errors).toHaveLength(1);
    expect(JSON.stringify(result.errors).length).toBeLessThan(1_000);
  });
});

describe("excerptOf", () => {
  it("trims and caps a line at 100 characters", () => {
    const lines = ["   lock master total etag LastChangedAt   ", "x".repeat(200)];
    expect(excerptOf(lines, 1)).toBe("lock master total etag LastChangedAt");
    expect(excerptOf(lines, 2)).toHaveLength(100);
    expect(excerptOf(lines, 99)).toBe("");
  });
});

describe("the whole corpus", () => {
  it("tokenizes every BDEF and SRVD fixture without a lexical error", () => {
    const files = walk(FIXTURES).filter(
      (f) => f.endsWith(".bdef.asbdef") || f.endsWith(".srvd.srvdsrv"),
    );
    expect(files.length).toBeGreaterThanOrEqual(102);
    const broken: string[] = [];
    for (const file of files) {
      const result = tokenize(readFileSync(file, "utf8"));
      if (result.errors.length > 0 || result.truncated) {
        broken.push(`${file.replace(FIXTURES, "")}: ${result.errors[0]?.message ?? "truncated"}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
