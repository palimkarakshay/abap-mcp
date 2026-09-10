/**
 * CDS service-definition (`.srvd.srvdsrv`) parser + the SRVD rule block —
 * spec §2.4 / §3.4. A separate, much smaller recursive-descent parser than
 * `parser.ts`'s BDEF parser, over the same token stream (`lexer.ts`'s
 * `tokenize()`), because the grammars barely overlap: a service definition is
 * a run of `@annotation`s, one `define|extend service NAME [provider
 * contracts ...] { expose ...; }` statement, and nothing else.
 *
 * Parses into `ast.ts`'s own `ServiceDefinition`/`Annotation`/
 * `ExposeStatement` (already declared there — "parsed by srvd.ts, a later
 * phase") and produces `context.ts`'s `ParsedSrvd`/`RapFinding` shapes, so
 * `rules.ts`'s `RapRuleRunOptions.srvds` and a future `index.ts` can consume
 * this module's output directly, with no adapter layer.
 *
 * Annotations. Both forms observed in 22 of 23 corpus fixtures are handled —
 * dotted (`@ObjectModel.leadingEntity.name: 'X'`) and nested-block
 * (`@ObjectModel: { leadingEntity: { name: 'X' } }`) — normalised to the same
 * `Annotation { path: string[]; rawValue: string }` shape so a rule reads one
 * shape regardless of which form the author used. `rawValue` is the
 * *unquoted* value (string-literal quoting already stripped via `lexer.ts`'s
 * `stringValue()`), not the raw token text, because every v1 consumer
 * (SRVD007) wants the value, never the syntax around it.
 *
 * Array (`[ 'a', 'b' ]`, `[ #ENUM ]`, `[ { a: 'x' } ]`) and enum (`#ENUM`)
 * values are part of the same one CDS annotation grammar and parse here too:
 * an array records every element as a leaf under the same dotted path, an
 * enum records `#NAME` as its `rawValue`. They are not decoration — the
 * corpus's own `@AbapCatalog.extensibility: { extensible: true, dataSources:
 * [ '_Extension' ] }` uses both nesting and an array, and rejecting either
 * used to cost a RAP-PARSE error *plus* a cascaded SRVD001 "exposes nothing"
 * about a file whose EXPOSE was right there.
 *
 * `expose method class_name=>method_name as alias;` needs a `>` token, and an
 * enum value a `#`, neither of which `lexer.ts`'s punctuation set originally
 * had (BDL needs neither) — added there (single additive characters,
 * confirmed safe against the BDEF corpus: see that file's comments) so these
 * real SDL constructs parse rather than lex-erroring.
 *
 * Two tiers, same as `parser.ts` (spec §1.3): punctuation breakage is a
 * `ParseError` (RAP-PARSE, error); a `;`-terminated statement whose leading
 * keyword is outside the SDL vocabulary is an `UnknownStatement` (RAP000,
 * info) and never an error. §3.7's suppression contract is honoured by
 * `checkServiceDefinitionRules()` — see `bodyMayBeHidden()`.
 */
import type { Annotation, ExposeStatement, Ident, ParseError, Range, ServiceDefinition, UnknownStatement } from "./ast.js";
import type { CdsEntityInfo, ParsedSrvd, RapConfidence, RapFinding, RapSeverity } from "./context.js";
import { excerptOf, normalizeRapSource, stringValue, tokenize, unbalancedDelimiter, type Token } from "./lexer.js";

/* ------------------------------------------------------------------ parser */

const MAX_UNKNOWN_TEXT = 200;
const MAX_RECOVERY_EVENTS = 200;
/**
 * How deep a CDS annotation value may nest (`[ [ [ … ] ] ]` / `{ a: { b: …`)
 * before the parser calls the file broken instead of recursing. Real CDS
 * annotations nest three or four levels; 64 is far past anything SAP
 * documents, and without a ceiling a hostile 10,000-bracket value took
 * `parseAnnotationValue()` past V8's stack limit and threw a `RangeError`
 * out of `checkRapBehavior()` — a crash where the contract promises findings.
 */
const MAX_ANNOTATION_DEPTH = 64;
const RECOVER = Symbol("srvd-parse-recover");

const VALID_PROVIDER_CONTRACTS = new Set([
  "INA",
  "ODATA_V2_UI",
  "ODATA_V4_UI",
  "ODATA_V2_WEBAPI",
  "ODATA_V4_WEBAPI",
  "SQL",
]);

function posOf(t: Token): { line: number; column: number } {
  return { line: t.line, column: t.column };
}
function endOf(t: Token): { line: number; column: number } {
  return { line: t.endLine, column: t.endColumn };
}
function spanOf(from: Token, to: Token): Range {
  return { start: posOf(from), end: endOf(to) };
}
function identOf(token: Token): Ident {
  return { name: token.text, key: token.key, namespaced: token.text.startsWith("/"), range: spanOf(token, token) };
}

class SrvdParser {
  private pos = 0;
  private depth = 0;
  private recoveries = 0;
  private stopped = false;
  private readonly errors: ParseError[] = [];
  private readonly unknown: UnknownStatement[] = [];

  constructor(
    private readonly tokens: Token[],
    private readonly lines: string[],
    private readonly filename: string,
  ) {}

  private peek(offset = 0): Token {
    const index = this.pos + offset;
    const last = this.tokens.length - 1;
    return this.tokens[index > last ? last : index] as Token;
  }
  private atEof(): boolean {
    return this.peek().kind === "eof";
  }
  private atKey(key: string, offset = 0): boolean {
    const token = this.peek(offset);
    return (token.kind === "ident" || token.kind === "punct") && token.key === key;
  }
  private next(): Token {
    const token = this.peek();
    if (token.kind === "eof") return token;
    this.pos += 1;
    if (token.kind === "punct") {
      if (token.key === "{") this.depth += 1;
      else if (token.key === "}" && this.depth > 0) this.depth -= 1;
    }
    return token;
  }
  private eatKey(key: string): Token | undefined {
    return this.atKey(key) ? this.next() : undefined;
  }
  private expectKey(key: string): Token {
    if (!this.atKey(key)) this.failHere(`Expected \`${key.toLowerCase()}\`.`);
    return this.next();
  }
  private expectPunct(punct: string): Token {
    if (!this.atKey(punct)) this.failHere(`Expected \`${punct}\`.`);
    return this.next();
  }
  private expectIdent(what: string): Ident {
    return identOf(this.expectNameToken(what));
  }
  private expectNameToken(what: string): Token {
    if (this.peek().kind !== "ident") this.failHere(`Expected ${what}.`);
    return this.next();
  }
  /** Record a `RAP-PARSE` error at `token` without unwinding the parser. */
  private recordError(message: string, token: Token): void {
    const at = token.kind === "eof" ? `${message} Reached the end of the file first.` : message;
    this.errors.push({
      message: at,
      line: token.line,
      column: token.column,
      excerpt: excerptOf(this.lines, token.line),
      kind: "syntax",
      file: this.filename,
    });
  }

  private failHere(message: string): never {
    this.recordError(message, this.peek());
    throw RECOVER;
  }

  /** Same contract as `parser.ts`'s `synchronize()` — spec §2.3. */
  private synchronize(): void {
    let relative = 0;
    let consumed = 0;
    while (!this.atEof()) {
      const token = this.peek();
      if (token.kind === "punct") {
        if (token.key === "{") {
          relative += 1;
          this.next();
          consumed += 1;
          continue;
        }
        if (token.key === "}") {
          if (relative === 0) break;
          relative -= 1;
          this.next();
          consumed += 1;
          // The `}` that closes a block the skipped statement itself opened
          // ends that statement (`parser.ts` carries the same rule): without
          // this, recovery runs on to the next `;` and swallows whatever
          // follows the block.
          if (relative === 0) {
            this.eatKey(";");
            break;
          }
          continue;
        }
        if (token.key === ";" && relative === 0) {
          this.next();
          consumed += 1;
          break;
        }
      }
      this.next();
      consumed += 1;
    }
    if (consumed === 0 && !this.atEof()) this.next();
  }

  /**
   * Skip one statement. `reported` says a `RAP-PARSE` error was already filed
   * for this span (spec §9.1 item 3 — the two tiers are exclusive); when it
   * was not, the span still only earns the RAP000 info tier if its brackets
   * balance. `parser.ts`'s `makeUnknown()` carries the identical contract, so
   * the same defect reads the same in a SRVD and in a BDEF.
   */
  private recoverFrom(startPos: number, reported: boolean): UnknownStatement {
    if (this.pos === startPos && !this.atEof()) this.next();
    this.synchronize();
    const span = this.tokens.slice(startPos, Math.max(this.pos, startPos + 1));
    const first = span[0] ?? this.peek();
    const last = span[span.length - 1] ?? first;
    this.recoveries += 1;
    if (this.recoveries >= MAX_RECOVERY_EVENTS) this.stopped = true;
    const statement: UnknownStatement = {
      kind: "unknown",
      leadingKey: first.key,
      text: span
        .map((t) => t.text)
        .join(" ")
        .slice(0, MAX_UNKNOWN_TEXT),
      range: spanOf(first, last),
    };
    if (!reported) {
      const offender = unbalancedDelimiter(span);
      if (offender === undefined) this.unknown.push(statement);
      else {
        this.recordError(
          `Unbalanced \`${offender.text}\` — this statement does not close every \`(\`, \`[\` or \`{\` it ` +
            "opens before it ends.",
          offender,
        );
      }
    }
    return statement;
  }

  /* ---------------------------------------------------------- annotations */

  private parseAnnotations(): Annotation[] {
    const out: Annotation[] = [];
    while (this.atKey("@") && !this.stopped) {
      const startPos = this.pos;
      try {
        this.next(); // '@'
        const path = [this.expectIdent("an annotation name segment").name];
        while (this.eatKey(".")) path.push(this.expectIdent("an annotation name segment").name);
        this.expectPunct(":");
        this.parseAnnotationValue(path, out);
      } catch (e) {
        if (e !== RECOVER) throw e;
        this.recoverFrom(startPos, true);
      }
    }
    return out;
  }

  private parseAnnotationValue(prefix: string[], out: Annotation[], depth = 0): void {
    if (depth >= MAX_ANNOTATION_DEPTH && (this.atKey("{") || this.atKey("["))) {
      // Punctuation-level breakage by our own definition: the value does not
      // reduce under this grammar. Reported once, then `recoverFrom()` in
      // `parseAnnotations()` skips the whole annotation — controlled
      // recovery, never a thrown RangeError (spec §1.3's error tier).
      this.failHere(`Annotation value nests deeper than ${MAX_ANNOTATION_DEPTH} levels.`);
    }
    if (this.atKey("{")) {
      this.next();
      while (!this.atKey("}") && !this.atEof()) {
        const key = this.expectIdent("an annotation member name");
        this.expectPunct(":");
        this.parseAnnotationValue([...prefix, key.name], out, depth + 1);
        this.eatKey(",");
      }
      this.expectPunct("}");
      // A block with no members contributes no leaf — nothing to record.
      return;
    }
    // `[ v, v, … ]` — a CDS annotation array. Every element is recorded as a
    // leaf under the SAME dotted path (a multi-valued annotation), because
    // that is what a rule asks about: `@Foo.bar` had these values. An empty
    // array contributes no leaf, exactly like an empty record.
    if (this.atKey("[")) {
      this.next();
      while (!this.atKey("]") && !this.atEof()) {
        this.parseAnnotationValue(prefix, out, depth + 1);
        this.eatKey(",");
      }
      this.expectPunct("]");
      return;
    }
    // `#ENUM` — one value, two tokens (`lexer.ts` keeps `#` a plain punct).
    if (this.atKey("#")) {
      const hash = this.next();
      const name = this.expectNameToken("an annotation enum value after `#`");
      out.push({ path: prefix, rawValue: `#${name.text}`, range: spanOf(hash, name) });
      return;
    }
    if (this.atEof()) this.failHere("Expected an annotation value.");
    const token = this.next();
    out.push({ path: prefix, rawValue: stringValue(token), range: spanOf(token, token) });
  }

  /* --------------------------------------------------------------- expose */

  private parseExpose(): ExposeStatement {
    const start = this.expectKey("EXPOSE");
    if (this.atKey("METHOD")) {
      this.next();
      const className = this.expectIdent("a class name");
      // `class=>method`: skip whatever punctuation tokens sit between the
      // two identifiers (works for the real `=` `>` pair without needing a
      // dedicated compound token — see the file header).
      while (!this.atKey("AS") && !this.atKey(";") && this.peek().kind !== "ident" && !this.atEof()) this.next();
      const methodName = this.expectIdent("a method name");
      const alias = this.parseAliasIfPresent();
      const end = this.expectPunct(";");
      return { kind: "expose", isMethod: true, classMethod: { className, methodName }, alias, range: spanOf(start, end) };
    }
    const entity = this.expectIdent("the exposed CDS entity name");
    const alias = this.parseAliasIfPresent();
    const end = this.expectPunct(";");
    return { kind: "expose", isMethod: false, entity, alias, range: spanOf(start, end) };
  }

  private parseAliasIfPresent(): Ident | undefined {
    return this.eatKey("AS") !== undefined ? this.expectIdent("an alias") : undefined;
  }

  /* ---------------------------------------------------------------- entry */

  parse(): { ast: ServiceDefinition; errors: ParseError[]; unknown: UnknownStatement[]; truncated: boolean } {
    const first = this.peek();
    const annotations = this.parseAnnotations();

    let form: "define" | "extend" = "define";
    try {
      if (this.atKey("EXTEND")) {
        this.next();
        form = "extend";
      } else {
        this.expectKey("DEFINE");
      }
      this.expectKey("SERVICE");
    } catch (e) {
      if (e !== RECOVER) throw e;
      // No recoverable "service" statement at all — return an empty, honest AST.
      const empty: ServiceDefinition = {
        kind: "service-definition",
        form,
        annotations,
        name: { name: "", key: "", namespaced: false, range: spanOf(first, first) },
        providerContracts: [],
        exposes: [],
        unknown: [],
        range: spanOf(first, this.peek()),
      };
      return { ast: empty, errors: this.errors, unknown: this.unknown, truncated: this.stopped };
    }

    let name: Ident;
    try {
      name = this.expectIdent("the service name");
      // `EXTEND SERVICE service WITH { … }` — the `WITH` is part of the
      // extend form's syntax and has to be consumed before the body brace.
      // Eaten rather than demanded: a missing `WITH` is the target system's
      // call, and spec §1.3's false-positive budget says an approximate
      // grammar never invents an error it cannot be sure of.
      if (form === "extend") this.eatKey("WITH");
    } catch (e) {
      if (e !== RECOVER) throw e;
      name = { name: "", key: "", namespaced: false, range: spanOf(first, first) };
    }

    const providerContracts: Ident[] = [];
    if (this.atKey("PROVIDER")) {
      try {
        this.next();
        if (!this.eatKey("CONTRACTS")) this.expectKey("CONTRACT");
        providerContracts.push(this.expectIdent("a provider contract"));
        while (this.eatKey(",")) providerContracts.push(this.expectIdent("a provider contract"));
      } catch (e) {
        if (e !== RECOVER) throw e;
        // Leave whatever contracts were already collected; recovery below
        // will resynchronise to the opening brace.
      }
    }

    const exposes: ExposeStatement[] = [];
    let sawOpenBrace = true;
    try {
      this.expectPunct("{");
    } catch (e) {
      if (e !== RECOVER) throw e;
      sawOpenBrace = false;
    }

    if (sawOpenBrace) {
      while (!this.atKey("}") && !this.atEof() && !this.stopped) {
        const startPos = this.pos;
        try {
          // Spec §1.3: RAP-PARSE is punctuation-level breakage ONLY. A
          // `;`-terminated statement inside balanced braces whose leading
          // keyword is outside our SDL vocabulary is a gap in the checker,
          // so it is recovered as an `UnknownStatement` (RAP000 info) with
          // no parser error — exactly what `parser.ts` does for BDL.
          if (this.atKey("EXPOSE")) exposes.push(this.parseExpose());
          else this.recoverFrom(startPos, false);
        } catch (e) {
          if (e !== RECOVER) throw e;
          // Punctuation breakage is the ERROR tier and nothing else: the
          // `RAP-PARSE` finding was already recorded by `failHere()`, so the
          // skipped span is NOT also filed as a RAP000 coverage note. Two
          // findings for one defect made a broken SRVD read as worse than the
          // identical BDEF (`parser.ts`'s `makeUnknown(pos, reported: true)`
          // has always suppressed the second tier), and the RAP000 message —
          // "a limit of the checker, not necessarily an error in your file" —
          // is simply untrue about text that failed to reduce. §3.7's
          // suppression still holds: `bodyMayBeHidden()` reads
          // `srvd.errors.length` as well as `srvd.unknown.length`.
          this.recoverFrom(startPos, true);
        }
      }
      if (this.atKey("}")) this.next();
      else if (!this.stopped) {
        // The body brace is not optional: `define service Z { expose ZC_X;`
        // used to parse clean (`parsed: true`, no findings) because the
        // closing `}` was merely *eaten if present*. An unterminated service
        // body is punctuation-level breakage — spec §1.3's error tier — and
        // silence on it was the checker's single largest false negative.
        this.recordError("Expected `}` to close the service definition body.", this.peek());
      }
    }

    // Anything after the service body is not part of it. A stray `}` or a
    // second statement used to be read by nobody: `parse()` returned at the
    // closing brace and the remaining tokens were dropped on the floor.
    if (!this.stopped && !this.atEof()) {
      this.recordError("Unexpected input after the end of the service definition.", this.peek());
    }

    const ast: ServiceDefinition = {
      kind: "service-definition",
      form,
      annotations,
      name,
      providerContracts,
      exposes,
      unknown: this.unknown,
      range: spanOf(first, this.peek()),
    };
    return { ast, errors: this.errors, unknown: this.unknown, truncated: this.stopped };
  }
}

/**
 * Parse a CDS service definition. Never throws: a caller always gets a
 * (possibly partial) AST plus the two tiers of diagnostics, mirroring
 * `parser.ts`'s `parseBehaviorDefinition()`. Matches `context.ts`'s
 * `ParsedSrvd` exactly — `source` is the ORIGINAL text as passed in (not
 * normalised), the same contract `rules.ts` relies on for `ParsedBdef`.
 */
export function parseServiceDefinition(source: string, filename?: string): ParsedSrvd {
  const lexed = tokenize(source);
  const name = filename ?? "";
  const parser = new SrvdParser(lexed.tokens, lexed.lines, name);
  const result = parser.parse();
  const errors: ParseError[] = [
    ...lexed.errors.map((e) => ({
      message: e.message,
      line: e.line,
      column: e.column,
      excerpt: e.excerpt,
      kind: "syntax" as const,
      file: name,
    })),
    ...result.errors,
  ];
  return {
    filename: name,
    source,
    ast: result.ast,
    errors,
    unknown: result.unknown,
    truncated: result.truncated || lexed.truncated,
  };
}

/* -------------------------------------------------------------- SRVD rules
 * Spec §3.4, source: bdl-grammar-notes.md §7 (`CDS SDL - DEFINE SERVICE`,
 * `CDS SDL - PROVIDER CONTRACTS`, both primary) + §6 invalid snippets 9-10.
 */

const DEFINE_SERVICE_URL = "https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-define-service";
const PROVIDER_CONTRACTS_URL = "https://help.sap.com/docs/abap-cloud/abap-keyword/cds-sdl-provider-contracts";

interface SrvdRuleMeta {
  id: string;
  severity: RapSeverity;
  confidence: RapConfidence;
  sourceUrl: string;
  docsAnchor: string;
}

/** Exported so a future `index.ts` can list SRVD rules alongside the BDEF set (`rules.ts`'s `RAP_RULES`) without re-deriving metadata. */
export const SRVD_RULES: readonly SrvdRuleMeta[] = [
  { id: "SRVD001", severity: "error", confidence: "confirmed", sourceUrl: DEFINE_SERVICE_URL, docsAnchor: "srvd001" },
  { id: "SRVD002", severity: "error", confidence: "confirmed", sourceUrl: PROVIDER_CONTRACTS_URL, docsAnchor: "srvd002" },
  { id: "SRVD003", severity: "error", confidence: "confirmed", sourceUrl: PROVIDER_CONTRACTS_URL, docsAnchor: "srvd003" },
  { id: "SRVD004", severity: "error", confidence: "confirmed", sourceUrl: DEFINE_SERVICE_URL, docsAnchor: "srvd004" },
  { id: "SRVD005", severity: "warning", confidence: "inferred", sourceUrl: DEFINE_SERVICE_URL, docsAnchor: "srvd005" },
  { id: "SRVD006", severity: "warning", confidence: "confirmed", sourceUrl: DEFINE_SERVICE_URL, docsAnchor: "srvd006" },
  { id: "SRVD007", severity: "warning", confidence: "confirmed", sourceUrl: DEFINE_SERVICE_URL, docsAnchor: "srvd007" },
] as const;

const RULE_BY_ID = new Map(SRVD_RULES.map((r) => [r.id, r]));

function reportOf(
  ruleId: string,
  srvd: ParsedSrvd,
  lines: string[],
  range: Range,
  message: string,
  hint: string,
  entity?: string,
): RapFinding {
  const meta = RULE_BY_ID.get(ruleId);
  if (meta === undefined) throw new Error(`Unknown SRVD rule id: ${ruleId}`);
  const finding: RapFinding = {
    rule: ruleId,
    severity: meta.severity,
    message,
    file: srvd.filename,
    line: range.start.line,
    column: range.start.column,
    excerpt: excerptOf(lines, range.start.line),
    hint,
    confidence: meta.confidence,
    docsUrl: `docs/RAP-RULES.md#${meta.docsAnchor}`,
    sourceUrl: meta.sourceUrl,
  };
  if (entity !== undefined) finding.entity = entity;
  return finding;
}

/** The effective alias an EXPOSE resolves to for SRVD005's duplicate check. */
function resolvedAliasKey(expose: ExposeStatement): string | undefined {
  if (expose.alias !== undefined) return expose.alias.key;
  if (expose.isMethod) return expose.classMethod?.methodName.key;
  return expose.entity?.key;
}

/** Caller-namespace check for SRVD006 — Z/Y customer namespace only; SAP/partner `/xxx/` namespaces are always skipped (spec §3.4 note). */
function isCallerNamespaceEntity(entity: Ident): boolean {
  return !entity.namespaced && /^[ZY]/i.test(entity.name);
}

export interface CheckSrvdOptions {
  /** CDS entities in scope, keyed by upper-cased entity name (`ddls.ts`'s `buildCdsMap().entities`). Omit or leave empty to skip the `requires: ddls` rules (SRVD006). */
  cds?: Map<string, CdsEntityInfo> | undefined;
  /**
   * Called once per rule that stayed silent under the §3.7 suppression
   * contract, so `checkRapBehavior()` can add it to
   * `summary.suppressedByUnknown` — a coverage gap that is counted is
   * measurable; one that is hidden is not.
   */
  onSuppressed?: ((ruleId: string) => void) | undefined;
}

/**
 * Spec §3.7, the SDL half: a rule of the form *"X must be declared"* must not
 * fire when a statement that could have been X was skipped. For a service
 * definition that is any `UnknownStatement` in the body (a construct outside
 * our SDL vocabulary — it could be an EXPOSE in a form we do not read) and
 * any parser error (the file did not reduce, so its EXPOSE set is unknown
 * rather than empty). Claiming "exposes nothing" about text we failed to read
 * is exactly the false positive §1.3's budget forbids.
 */
function bodyMayBeHidden(srvd: ParsedSrvd): boolean {
  return srvd.unknown.length > 0 || srvd.errors.length > 0;
}

/**
 * Run SRVD001–SRVD007 over one parsed service definition. Findings are
 * sorted `(line, column, rule)` for deterministic output.
 */
export function checkServiceDefinitionRules(srvd: ParsedSrvd, opts: CheckSrvdOptions = {}): RapFinding[] {
  const { ast } = srvd;
  const lines = normalizeRapSource(srvd.source).split("\n");
  const findings: RapFinding[] = [];
  const serviceName = ast.name.name || srvd.filename;

  const mayBeHidden = bodyMayBeHidden(srvd);

  // SRVD001 — at least one EXPOSE (§3.7: silent when one may have been skipped).
  if (ast.exposes.length === 0) {
    if (mayBeHidden) opts.onSuppressed?.("SRVD001");
    else findings.push(
      reportOf(
        "SRVD001",
        srvd,
        lines,
        ast.range,
        `Service definition ${serviceName} exposes nothing; at least one EXPOSE is required.`,
        'Add "expose ZC_<Entity> as <Alias>;".',
        serviceName,
      ),
    );
  }

  // SRVD002 — every provider contract token is a real one.
  for (const contract of ast.providerContracts) {
    if (!VALID_PROVIDER_CONTRACTS.has(contract.key)) {
      findings.push(
        reportOf(
          "SRVD002",
          srvd,
          lines,
          contract.range,
          `"${contract.name}" is not a CDS provider contract.`,
          "Use one of INA, ODATA_V2_UI, ODATA_V4_UI, ODATA_V2_WEBAPI, ODATA_V4_WEBAPI, SQL. (Note: the token is ODATA_V4_WEBAPI, not odata_v4_web_api.)",
        ),
      );
    }
  }

  // SRVD003 — UI and WEBAPI OData contracts cannot be combined.
  const uiContract = ast.providerContracts.find((c) => /^ODATA_V[24]_UI$/.test(c.key));
  const webapiContract = ast.providerContracts.find((c) => /^ODATA_V[24]_WEBAPI$/.test(c.key));
  if (uiContract !== undefined && webapiContract !== undefined) {
    findings.push(
      reportOf(
        "SRVD003",
        srvd,
        lines,
        uiContract.range,
        "OData provider contracts of type UI and WEBAPI cannot be combined.",
        "Publish two service definitions, one per contract type.",
      ),
    );
  }

  const hasSqlContract = ast.providerContracts.some((c) => c.key === "SQL");
  const aliasSeen = new Map<string, ExposeStatement>();

  for (const expose of ast.exposes) {
    // SRVD004 — `expose method` requires provider contract SQL.
    if (expose.isMethod && !hasSqlContract) {
      const label =
        expose.classMethod !== undefined ? `${expose.classMethod.className.name}=>${expose.classMethod.methodName.name}` : "?";
      findings.push(
        reportOf(
          "SRVD004",
          srvd,
          lines,
          expose.range,
          '"expose method" requires provider contract SQL.',
          'Add "provider contracts sql", and declare the AMDP procedure FOR SQL SERVICE.',
          label,
        ),
      );
    }

    // SRVD005 — duplicate alias.
    const aliasKey = resolvedAliasKey(expose);
    if (aliasKey !== undefined && aliasKey !== "") {
      const seen = aliasSeen.get(aliasKey);
      if (seen !== undefined) {
        findings.push(
          reportOf(
            "SRVD005",
            srvd,
            lines,
            (expose.alias ?? expose.entity ?? expose.classMethod?.methodName ?? expose).range,
            `Alias ${expose.alias?.name ?? aliasKey} is exposed twice in ${serviceName}. ` +
              "[inferred — SAP's DEFINE SERVICE syntax page does not state uniqueness directly, but OData requires distinct entity-set names; treat as advisory]",
            "Give each exposed entity a distinct alias.",
            serviceName,
          ),
        );
      } else {
        aliasSeen.set(aliasKey, expose);
      }
    }

    // SRVD006 — exposed entity (caller namespace only) not among supplied .ddls.
    if (!expose.isMethod && expose.entity !== undefined && opts.cds !== undefined && opts.cds.size > 0) {
      if (isCallerNamespaceEntity(expose.entity) && !opts.cds.has(expose.entity.key)) {
        findings.push(
          reportOf(
            "SRVD006",
            srvd,
            lines,
            expose.entity.range,
            `Exposed entity ${expose.entity.name} was not found among the .ddls sources passed in this call.`,
            "Pass its .ddls.asddls, or check the name.",
            expose.entity.name,
          ),
        );
      }
    }
  }

  // SRVD007 — @ObjectModel.leadingEntity.name must be an exposed entity.
  const leadingEntityAnn = ast.annotations.find(
    (a) => a.path.map((p) => p.toUpperCase()).join(".") === "OBJECTMODEL.LEADINGENTITY.NAME",
  );
  if (leadingEntityAnn !== undefined) {
    const leadingKey = leadingEntityAnn.rawValue.toUpperCase();
    const exposedKeys = new Set(ast.exposes.map((e) => e.entity?.key).filter((k): k is string => k !== undefined));
    if (!exposedKeys.has(leadingKey)) {
      // Same §3.7 reasoning as SRVD001: an EXPOSE we could not read may be
      // the very one this annotation names.
      if (mayBeHidden) opts.onSuppressed?.("SRVD007");
      else findings.push(
        reportOf(
          "SRVD007",
          srvd,
          lines,
          leadingEntityAnn.range,
          `The leading entity ${leadingEntityAnn.rawValue} is not exposed by this service.`,
          "Expose it, or point the annotation at an exposed entity.",
          leadingEntityAnn.rawValue,
        ),
      );
    }
  }

  return findings.sort((a, b) => a.line - b.line || a.column - b.column || a.rule.localeCompare(b.rule));
}
