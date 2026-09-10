/**
 * Tokenizer for RAP BDL (behavior definitions) and CDS SDL (service
 * definitions) — spec `docs/specs/rap-checker-design.md` §2.1.
 *
 * abaplint stores `.bdef.asbdef` behind a single regex and `.srvd.srvdsrv`
 * not at all, so this scanner (and the parser above it) is the only thing
 * that ever looks inside those files. Two rules shape it:
 *
 *  - **No reserved words.** BDL keywords are matched *contextually* by the
 *    parser against `Token.key`; the lexer never classifies an identifier as
 *    a keyword. CDS element names in the corpus really are `Description`,
 *    `Quantity`, `Notes` — words that are keywords elsewhere in the grammar.
 *  - **Normalisation happens here, once.** A UTF-8 BOM is stripped and every
 *    `\r\n` / lone `\r` becomes `\n` before scanning (19 of the 102 corpus
 *    files are CRLF), so every line/column a finding reports is computed on
 *    one canonical text. Both coordinates are 1-based, matching `Finding` in
 *    `src/abap/engine.ts`.
 */
import { MAX_FILE_CHARS } from "../engine.js";

export type TokenKind = "ident" | "number" | "string" | "punct" | "comment" | "eof";

export interface Token {
  kind: TokenKind;
  /** Source text exactly as written. */
  text: string;
  /** Upper-cased `text` for case-insensitive comparison (idents/puncts only). */
  key: string;
  line: number;
  column: number;
  endLine: number;
  /** Exclusive. */
  endColumn: number;
}

export interface LexError {
  message: string;
  line: number;
  column: number;
  excerpt: string;
}

export interface LexResult {
  /** The scanning stream; always ends with exactly one `eof` token. */
  tokens: Token[];
  /** Side channel — comments are never in `tokens`. */
  comments: Token[];
  errors: LexError[];
  /** True when the token or character cap cut the scan short. */
  truncated: boolean;
  /** The normalised source, split on "\n" — the excerpt source for findings. */
  lines: string[];
}

/** Hard stop so a pathological file cannot exhaust memory (spec §2.1). */
export const MAX_RAP_TOKENS = 200_000;

/**
 * Hard stop on lexical errors, mirroring the parser's `MAX_RECOVERY_EVENTS`.
 *
 * Without it a file of 90 000 illegal characters yields 90 000 `LexError`s
 * (~16 MB of excerpts) and every one becomes a separate RAP-PARSE finding —
 * the opposite of spec §3.3's "one finding per recovery point, max 200".
 * When the cap bites the scan keeps tokenizing (so the parser still sees the
 * rest of the file) but stops recording, and `truncated` says so.
 */
export const MAX_RAP_LEX_ERRORS = 200;

/** Longest run of illegal characters quoted back in an error message. */
const MAX_RUN_IN_MESSAGE = 20;

/** Single-character punctuation. `..` is handled separately, as one token. */
const PUNCT_CHARS = new Set([
  ";",
  "{",
  "}",
  "(",
  ")",
  ",",
  ":",
  "=",
  "~",
  "[",
  "]",
  "*",
  "@",
  ".",
  "-",
  /**
   * Only needed for `EXPOSE METHOD class=>method` in a service definition
   * (`srvd.ts`, spec §2.4/§7) — BDL itself never uses `>`. Added as a plain
   * single-character punct (no dedicated `=>` compound token, unlike `..`):
   * `srvd.ts`'s expose parser already skips any run of punctuation between
   * the two identifiers, so `=` and `>` tokenizing separately is enough.
   * Confirmed safe for the BDEF corpus: the only `>` characters in any of
   * the 102 real fixtures sit inside `//` comments, which are consumed as
   * whole tokens before per-character classification ever runs.
   */
  ">",
  /**
   * Only needed for a CDS **annotation enum value** (`@ObjectModel.
   * supportedCapabilities: [ #ANALYTICAL_QUERY ]`, `@Scope: #TABLE`) in a
   * service definition — BDL itself never uses `#`. The lexer keeps it a
   * plain punct and `srvd.ts`'s annotation-value parser folds `#` + the
   * following identifier into one value, so nothing else in the grammar has
   * to know about enums. Before this, a legal `#…` annotation was a hard
   * lexical error (RAP-PARSE) that also emptied `exposes` and cascaded into
   * SRVD001; 84 of the 141 corpus `.ddls` files carry `: #…` values, so the
   * form is mainstream CDS, not exotic.
   */
  "#",
]);

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/y;
/** `/DMO/I_Travel`, `/cca/bp_test_rap_unamanaged` — a leading namespace segment. */
const NAMESPACE_RE = /\/[A-Za-z0-9_]+\/[A-Za-z0-9_]+/y;
const NUMBER_RE = /[0-9]+/y;
const SELF_RE = /\$self/iy;

/** Strip a UTF-8 BOM and normalise CRLF / lone CR to LF. */
export function normalizeRapSource(source: string): string {
  const noBom = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  return noBom.includes("\r") ? noBom.replace(/\r\n?/g, "\n") : noBom;
}

/** First ~100 characters of a 1-based line, for a finding's `excerpt`. */
export function excerptOf(lines: string[], line: number): string {
  return (lines[line - 1] ?? "").trim().slice(0, 100);
}

/**
 * True when the character at `i` can begin no token at all — used to fold a
 * run of illegal characters into a single error.
 */
function cannotStartToken(text: string, i: number): boolean {
  const ch = text[i] as string;
  if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") return false;
  if (ch === "'" || ch === "$" || ch === "/") return false;
  if (ch >= "0" && ch <= "9") return false;
  if (PUNCT_CHARS.has(ch)) return false;
  IDENT_RE.lastIndex = i;
  return IDENT_RE.exec(text) === null;
}

export function tokenize(source: string): LexResult {
  const normalized = normalizeRapSource(source);
  const overLength = normalized.length > MAX_FILE_CHARS;
  const text = overLength ? normalized.slice(0, MAX_FILE_CHARS) : normalized;
  const lines = text.split("\n");

  const tokens: Token[] = [];
  const comments: Token[] = [];
  const errors: LexError[] = [];
  let truncated = overLength;

  if (overLength) {
    errors.push({
      message: `Source exceeds ${MAX_FILE_CHARS} characters; only the first ${MAX_FILE_CHARS} were scanned.`,
      line: 1,
      column: 1,
      excerpt: excerptOf(lines, 1),
    });
  }

  const n = text.length;
  let i = 0;
  let line = 1;
  let column = 1;

  const advance = (count: number): void => {
    for (let k = 0; k < count; k++) {
      if (text[i] === "\n") {
        line += 1;
        column = 1;
      } else {
        column += 1;
      }
      i += 1;
    }
  };

  const push = (kind: TokenKind, start: number, startLine: number, startColumn: number): void => {
    const raw = text.slice(start, i);
    const token: Token = {
      kind,
      text: raw,
      key: kind === "ident" || kind === "punct" ? raw.toUpperCase() : raw,
      line: startLine,
      column: startColumn,
      endLine: line,
      endColumn: column,
    };
    if (kind === "comment") comments.push(token);
    else tokens.push(token);
  };

  const fail = (message: string, startLine: number, startColumn: number): void => {
    if (errors.length >= MAX_RAP_LEX_ERRORS) {
      truncated = true;
      return;
    }
    errors.push({ message, line: startLine, column: startColumn, excerpt: excerptOf(lines, startLine) });
  };

  while (i < n) {
    if (tokens.length >= MAX_RAP_TOKENS) {
      truncated = true;
      break;
    }
    const ch = text[i] as string;

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\f" || ch === "\v") {
      advance(1);
      continue;
    }

    const startIdx = i;
    const startLine = line;
    const startColumn = column;

    // `//` line comment — the only comment style observed in the BDEF corpus.
    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") advance(1);
      push("comment", startIdx, startLine, startColumn);
      continue;
    }

    // `/* … */` — accepted defensively. bdl-grammar-notes.md §3 records that
    // block comments are UNCONFIRMED for BDL: accepting one that turns out to
    // be illegal costs nothing, rejecting a legal one costs a false error.
    if (ch === "/" && text[i + 1] === "*") {
      advance(2);
      let closed = false;
      while (i < n) {
        if (text[i] === "*" && text[i + 1] === "/") {
          advance(2);
          closed = true;
          break;
        }
        advance(1);
      }
      if (!closed) fail("Unterminated block comment (`/*` with no closing `*/`).", startLine, startColumn);
      push("comment", startIdx, startLine, startColumn);
      continue;
    }

    if (ch === "/") {
      NAMESPACE_RE.lastIndex = i;
      const ns = NAMESPACE_RE.exec(text);
      if (ns !== null) {
        advance(ns[0].length);
        push("ident", startIdx, startLine, startColumn);
        continue;
      }
      advance(1);
      fail(
        "`/` is only legal as the namespace prefix of a name such as /DMO/I_Travel.",
        startLine,
        startColumn,
      );
      continue;
    }

    if (ch === "$") {
      SELF_RE.lastIndex = i;
      const self = SELF_RE.exec(text);
      if (self !== null) {
        advance(self[0].length);
        push("ident", startIdx, startLine, startColumn);
        continue;
      }
      advance(1);
      fail("`$` is only legal as the first character of the pseudo-identifier `$self`.", startLine, startColumn);
      continue;
    }

    if (ch === "'") {
      advance(1);
      let closed = false;
      while (i < n) {
        if (text[i] === "\n") break;
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            advance(2);
            continue;
          }
          advance(1);
          closed = true;
          break;
        }
        advance(1);
      }
      if (!closed) fail("Unterminated string literal.", startLine, startColumn);
      push("string", startIdx, startLine, startColumn);
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      NUMBER_RE.lastIndex = i;
      const num = NUMBER_RE.exec(text);
      advance(num === null ? 1 : num[0].length);
      push("number", startIdx, startLine, startColumn);
      continue;
    }

    IDENT_RE.lastIndex = i;
    const ident = IDENT_RE.exec(text);
    if (ident !== null) {
      advance(ident[0].length);
      push("ident", startIdx, startLine, startColumn);
      continue;
    }

    // `..` is one token so `[0..*]` never looks like `0 . . *`.
    if (ch === "." && text[i + 1] === ".") {
      advance(2);
      push("punct", startIdx, startLine, startColumn);
      continue;
    }

    if (PUNCT_CHARS.has(ch)) {
      advance(1);
      push("punct", startIdx, startLine, startColumn);
      continue;
    }

    // A RUN of illegal characters is one lexical problem, not one per
    // character: `!!! ??? ###` is a single "this is not BDL" finding. Consume
    // every following character that also cannot start a token.
    advance(1);
    while (i < n && cannotStartToken(text, i)) advance(1);
    const run = text.slice(startIdx, i);
    const shown = run.length > MAX_RUN_IN_MESSAGE ? `${run.slice(0, MAX_RUN_IN_MESSAGE)}…` : run;
    fail(
      run.length === 1
        ? `Unexpected character ${JSON.stringify(run)}.`
        : `Unexpected characters ${JSON.stringify(shown)} (${run.length} characters).`,
      startLine,
      startColumn,
    );
  }

  tokens.push({
    kind: "eof",
    text: "",
    key: "",
    line,
    column,
    endLine: line,
    endColumn: column,
  });

  return { tokens, comments, errors, truncated, lines };
}

/** Convenience for tests and callers that only want the string value of a literal. */
/**
 * The first delimiter token that a span leaves unmatched — an opener nothing
 * closes, or a closer that opens nothing — across all three CDS/BDL bracket
 * kinds (`{}`, `()`, `[]`). `undefined` when the span is balanced.
 *
 * Both parsers' `synchronize()` tracks brace depth ONLY, because that is what
 * decides where a skipped statement ends. Whether the skipped text was
 * *well-formed* is the separate question spec §1.3 keys its two tiers on, and
 * it needs all three kinds: `future ( ;` is punctuation breakage
 * (`RAP-PARSE`, error), not an unrecognised construct (`RAP000`, info).
 */
export function unbalancedDelimiter(span: readonly Token[]): Token | undefined {
  const closers: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
  const openers = new Set(Object.keys(closers));
  const stack: Token[] = [];
  for (const token of span) {
    if (token.kind !== "punct") continue;
    if (openers.has(token.key)) {
      stack.push(token);
      continue;
    }
    if (token.key !== "}" && token.key !== ")" && token.key !== "]") continue;
    const open = stack.pop();
    // A closer with nothing open, or one that closes a different kind, is
    // itself the offending token.
    if (open === undefined || closers[open.key] !== token.key) return open ?? token;
  }
  return stack[0];
}

export function stringValue(token: Token): string {
  if (token.kind !== "string") return token.text;
  const inner = token.text.startsWith("'") ? token.text.slice(1, token.text.endsWith("'") ? -1 : undefined) : token.text;
  return inner.replace(/''/g, "'");
}
