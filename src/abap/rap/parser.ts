/**
 * Recursive-descent parser for RAP behavior definitions (`.bdef.asbdef`) —
 * spec `docs/specs/rap-checker-design.md` §2.3.
 *
 * The whole design turns on one constraint (spec §1.3): **the corpus is a
 * sample of BDL, not the language**, so a parser that rejects everything it
 * does not recognise would report legal RAP as broken. Hence two tiers:
 *
 *  | Situation                                                   | Emitted as |
 *  |-------------------------------------------------------------|------------|
 *  | Punctuation-level breakage — unbalanced `{}`/`()`/`[]`, a     | `errors[]` |
 *  | statement that hits EOF without `;`, a stray `}`              | (RAP-PARSE, severity error) |
 *  | A punctuation-well-formed statement whose leading keyword is  | `unknown[]` |
 *  | outside our vocabulary                                        | (RAP000, severity info) |
 *
 * `parse()` never throws: a caller always gets a (possibly partial) AST.
 *
 * A statement that failed with a syntax error is *also* retained as an
 * `UnknownStatement` inside its enclosing node — that is what makes the
 * suppression contract of spec §3.7 work ("a rule must never fire on evidence
 * that is absent because a statement was skipped") — but it is deliberately
 * NOT added to the returned `unknown[]`, so one broken statement produces one
 * RAP-PARSE finding and not a duplicate RAP000 alongside it.
 *
 * Escape hatches so a pathological file cannot hang: at most
 * `MAX_RECOVERY_EVENTS` recovery points per file (then `truncated` is set and
 * parsing stops), and `synchronize()` always consumes at least one token.
 */
import type {
  ActionStatement,
  AssociationStatement,
  AuthScope,
  BehaviorDefinition,
  BodyStatement,
  Cardinality,
  DeterminationStatement,
  DetermineActionStatement,
  DraftActionStatement,
  EntityBehavior,
  EventStatement,
  Facet,
  FieldChar,
  FieldStatement,
  FunctionStatement,
  GroupStatement,
  Ident,
  MappingItem,
  MappingStatement,
  OperationStatement,
  ParameterClause,
  ParseError,
  Pos,
  QualifiedName,
  Range,
  ResultClause,
  ResultTarget,
  SaveOption,
  SideEffectEntry,
  SideEffectsBlock,
  SideEffectSource,
  SideEffectTarget,
  SideEffectTrigger,
  StringLit,
  TriggerItem,
  UnknownStatement,
  UseStatement,
  ValidationStatement,
} from "./ast.js";
import { excerptOf, stringValue, tokenize, unbalancedDelimiter, type Token } from "./lexer.js";

/** Bump on any grammar change — stamped onto every report. */
export const GRAMMAR_VERSION = "bdl/2026-09-10";

/** Spec §2.3: a pathological file stops here instead of looping. */
export const MAX_RECOVERY_EVENTS = 200;

/** Longest text kept on an `UnknownStatement`. */
const MAX_UNKNOWN_TEXT = 200;

/** Sentinel thrown by `expect*` and caught by every statement loop. */
const RECOVER = Symbol("rap-parse-recover");

export interface ParseBehaviorResult {
  ast: BehaviorDefinition;
  /** Punctuation-level breakage → rule `RAP-PARSE`, severity error. */
  errors: ParseError[];
  /** Punctuation-well-formed statements outside our grammar → `RAP000`, info. */
  unknown: UnknownStatement[];
  /** True when the recovery cap or a lexer cap cut the parse short. */
  truncated: boolean;
}

/** Keys that may begin an entity characteristic (used to bound recovery). */
const CHARACTERISTIC_KEYS = new Set([
  "PERSISTENT",
  "DRAFT",
  "QUERY",
  "ETAG",
  "TOTAL",
  "LOCK",
  "AUTHORIZATION",
  "EARLY",
  "LATE",
  "WITH",
  "EXTENSIBLE",
  "CHANGEDOCUMENTS",
  "USE",
  "IMPLEMENTATION",
]);

const FIELD_CHAR_NAMES: Record<string, FieldChar["name"]> = {
  READONLY: "readonly",
  MANDATORY: "mandatory",
  SUPPRESS: "suppress",
  NUMBERING: "numbering",
  FEATURES: "features",
  NOTRIGGER: "notrigger",
  MODIFY: "modify",
};

const FIELD_CHAR_QUALIFIERS: Record<string, NonNullable<FieldChar["qualifier"]>> = {
  CREATE: "create",
  UPDATE: "update",
  MANAGED: "managed",
  INSTANCE: "instance",
  WARN: "warn",
  EXECUTE: "execute",
};

function posOf(token: Token): Pos {
  return { line: token.line, column: token.column };
}
function endOf(token: Token): Pos {
  return { line: token.endLine, column: token.endColumn };
}
function spanOf(from: Token, to: Token): Range {
  return { start: posOf(from), end: endOf(to) };
}

class BdefParser {
  private pos = 0;
  /** Brace depth of the token stream, maintained by `next()`. */
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

  /* ------------------------------------------------------------ primitives */

  private peek(offset = 0): Token {
    const index = this.pos + offset;
    const last = this.tokens.length - 1;
    return this.tokens[index > last ? last : index] as Token;
  }

  private prev(): Token {
    return this.tokens[this.pos > 0 ? this.pos - 1 : 0] as Token;
  }

  private atEof(): boolean {
    return this.peek().kind === "eof";
  }

  private atKey(key: string, offset = 0): boolean {
    const token = this.peek(offset);
    return (token.kind === "ident" || token.kind === "punct") && token.key === key;
  }

  private atSeq(...keys: string[]): boolean {
    return keys.every((key, index) => this.atKey(key, index));
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

  private expectNameToken(what: string): Token {
    if (this.peek().kind !== "ident") this.failHere(`Expected ${what}.`);
    return this.next();
  }

  private expectIdent(what: string): Ident {
    return identOf(this.expectNameToken(what));
  }

  private expectNumber(): number {
    if (this.peek().kind !== "number") this.failHere("Expected a number.");
    return Number.parseInt(this.next().text, 10);
  }

  private failHere(message: string): never {
    const token = this.peek();
    const at = token.kind === "eof" ? `${message} Reached the end of the file first.` : message;
    this.errors.push({
      message: at,
      line: token.line,
      column: token.column,
      excerpt: excerptOf(this.lines, token.line),
      kind: "syntax",
      file: this.filename,
    });
    throw RECOVER;
  }

  /* ------------------------------------------------------------- recovery */

  /**
   * Consume tokens until a `;` at the failure point's brace depth, a `}` that
   * would take the depth below it (left for the enclosing block's parser), or
   * EOF. Always consumes at least one token.
   */
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
          // A statement that opened its own block ENDS at that block's `}`
          // (`define authorization context … { … }`, a standalone `features
          // { instance { … } }`, an entity-level `extensible { … }`). Without
          // this the scan runs on looking for a `;` at relative depth 0 and
          // swallows every following statement — and, when the next statement
          // is `define behavior for …`, its body re-raises `relative` so the
          // scan eats the whole rest of the file: one unknown header would
          // silently cost every entity in it (spec §2.3 recovery contract
          // point 3).
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

  /** Turn the span starting at `startPos` into an `UnknownStatement`. */
  private makeUnknown(startPos: number, reported: boolean): UnknownStatement {
    this.synchronize();
    const span = this.tokens.slice(startPos, Math.max(this.pos, startPos + 1));
    const first = span[0] ?? this.peek();
    const last = span[span.length - 1] ?? first;
    const statement: UnknownStatement = {
      kind: "unknown",
      leadingKey: first.key,
      text: span
        .map((token) => token.text)
        .join(" ")
        .slice(0, MAX_UNKNOWN_TEXT),
      range: spanOf(first, last),
    };
    if (!reported) {
      // Spec §1.3's two tiers are decided by PUNCTUATION, and `synchronize()`
      // only ever tracked `{}`. A skipped span that leaves a `(` or `[` open
      // — `future ( ;` — is punctuation-level breakage, not "a construct our
      // grammar has not learned yet", and reporting it as a RAP000 info told
      // the caller their broken file was merely unrecognised. All three
      // delimiter kinds are checked over the span; only a balanced one earns
      // the info tier.
      const offender = unbalancedDelimiter(span);
      if (offender === undefined) this.unknown.push(statement);
      else this.reportImbalance(offender);
    }
    this.countRecovery();
    return statement;
  }

  /** Record a RAP-PARSE error without unwinding — the span is already skipped. */
  private reportImbalance(token: Token): void {
    this.errors.push({
      message:
        `Unbalanced \`${token.text}\` — this statement does not close every \`(\`, \`[\` or \`{\` it opens ` +
        "before it ends.",
      line: token.line,
      column: token.column,
      excerpt: excerptOf(this.lines, token.line),
      kind: "syntax",
      file: this.filename,
    });
  }

  private countRecovery(): void {
    this.recoveries += 1;
    if (this.recoveries >= MAX_RECOVERY_EVENTS) this.stopped = true;
  }

  private recoverFrom(startPos: number, baseDepth?: number): UnknownStatement {
    if (this.pos === startPos && !this.atEof()) this.next();
    const statement = this.makeUnknown(startPos, true);
    // `synchronize()` stops before a `}` that would drop below the FAILURE
    // point's depth. When the failed statement had opened blocks of its own,
    // close them here so the enclosing loop resumes at its own level and
    // "one bad statement yields one finding" holds for block statements too.
    if (baseDepth !== undefined) {
      while (this.depth > baseDepth && this.atKey("}")) this.next();
    }
    return statement;
  }

  /* --------------------------------------------------------------- entry */

  parse(): ParseBehaviorResult {
    const first = this.peek();
    const bo: BehaviorDefinition = {
      kind: "behavior-definition",
      implementationType: "unspecified",
      draftDeclarations: [],
      auxiliaryClasses: [],
      headerUses: [],
      entities: [],
      unknownHeader: [],
      range: spanOf(first, first),
    };

    let sawDefine = false;
    while (!this.atEof() && !this.stopped) {
      const startPos = this.pos;
      const baseDepth = this.depth;
      try {
        if (this.atSeq("DEFINE", "BEHAVIOR")) {
          const entity = this.parseEntity("define", !sawDefine);
          sawDefine = true;
          bo.entities.push(entity);
        } else if (this.atSeq("EXTEND", "BEHAVIOR")) {
          bo.entities.push(this.parseEntity("extend", false));
        } else if (this.atKey("}")) {
          this.failHere("Unexpected `}` — no block is open here.");
        } else {
          this.parseHeaderStatement(bo);
        }
      } catch (error) {
        if (error !== RECOVER) throw error;
        bo.unknownHeader.push(this.recoverFrom(startPos, baseDepth));
      }
      if (this.pos === startPos && !this.atEof()) this.next();
    }

    bo.range = spanOf(first, this.prev());
    return { ast: bo, errors: this.errors, unknown: this.unknown, truncated: this.stopped };
  }

  /* -------------------------------------------------------------- header */

  private parseHeaderStatement(bo: BehaviorDefinition): void {
    const start = this.peek();
    const startPos = this.pos;
    switch (start.key) {
      case "MANAGED":
      case "UNMANAGED":
      case "PROJECTION": {
        this.next();
        bo.implementationType =
          start.key === "MANAGED" ? "managed" : start.key === "UNMANAGED" ? "unmanaged" : "projection";
        if (start.key === "MANAGED" && this.atKey("BY")) {
          this.next();
          this.expectNameToken("`BOPF`");
          bo.managedByBopf = spanOf(start, this.prev());
          this.finishStatement(false);
          return;
        }
        const save = this.tryParseSaveOption();
        if (save !== undefined) bo.save = save;
        const cls = this.tryParseImplClause();
        if (cls !== undefined) bo.implementationClass = cls;
        this.finishStatement(false);
        return;
      }
      case "INTERFACE":
      case "ABSTRACT": {
        this.next();
        bo.implementationType = start.key === "INTERFACE" ? "interface" : "abstract";
        this.finishStatement(false);
        return;
      }
      case "IMPLEMENTATION": {
        // Two header forms: `implementation abstract;` (35 corpus files) and a
        // bare `implementation in class … unique;`.
        if (this.atKey("ABSTRACT", 1)) {
          this.next();
          this.next();
          bo.implementationType = "abstract";
          this.finishStatement(false);
          return;
        }
        const cls = this.tryParseImplClause();
        if (cls === undefined) break;
        bo.implementationClass = cls;
        this.finishStatement(false);
        return;
      }
      case "EXTENSION": {
        this.next();
        bo.implementationType = "extension";
        if (this.eatKey("FOR") !== undefined) {
          if (this.eatKey("PROJECTION") !== undefined) bo.extensionForm = "for-projection";
          else if (this.eatKey("ABSTRACT") !== undefined) bo.extensionForm = "for-abstract";
          else this.failHere("Expected `projection` or `abstract` after `extension for`.");
        } else if (this.atSeq("USING", "INTERFACE")) {
          this.next();
          this.next();
          bo.extensionForm = "using-interface";
          bo.extensionInterface = this.expectIdent("an interface behavior-definition name");
        } else {
          bo.extensionForm = "implementation";
        }
        const cls = this.tryParseImplClause();
        if (cls !== undefined) bo.implementationClass = cls;
        this.finishStatement(false);
        return;
      }
      case "STRICT": {
        this.next();
        let level: 1 | 2 = 1;
        if (this.eatKey("(") !== undefined) {
          const value = this.expectNumber();
          level = value === 2 ? 2 : 1;
          this.expectPunct(")");
        }
        bo.strict = { level, range: spanOf(start, this.prev()) };
        this.finishStatement(false);
        return;
      }
      case "EXTENSIBLE": {
        this.next();
        const options = this.parseExtensibleOptions();
        bo.extensible = { options, range: spanOf(start, this.prev()) };
        return;
      }
      case "AUXILIARY": {
        this.next();
        this.expectKey("CLASS");
        for (;;) {
          bo.auxiliaryClasses.push(this.expectIdent("an auxiliary class name"));
          if (this.eatKey(",") === undefined) break;
        }
        this.finishStatement(false);
        return;
      }
      case "SAVE": {
        if (!this.atKey("AFTER", 1)) break;
        this.next();
        this.next();
        bo.saveAfter = this.expectIdent("an entity name");
        this.finishStatement(false);
        return;
      }
      case "USE": {
        bo.headerUses.push(this.parseUse());
        return;
      }
      case "WITH": {
        const save = this.tryParseSaveOption();
        if (save !== undefined) {
          bo.save = save;
          this.finishStatement(false);
          return;
        }
        this.next();
        if (this.atKey("DRAFT") || this.atSeq("COLLABORATIVE", "DRAFT")) {
          const collaborative = this.eatKey("COLLABORATIVE") !== undefined;
          this.expectKey("DRAFT");
          const declaration = { collaborative, range: spanOf(start, this.prev()) };
          bo.draftDeclarations.push(declaration);
          bo.withDraft ??= declaration;
          this.finishStatement(false);
          return;
        }
        if (this.eatKey("HIERARCHY") !== undefined) {
          if (this.atSeq("LIKE", "ENTITY")) {
            this.next();
            this.next();
          }
          bo.withHierarchy = spanOf(start, this.prev());
          this.finishStatement(false);
          return;
        }
        if (this.atSeq("PRIVILEGED", "MODE")) {
          this.next();
          this.next();
          let form: "enabled" | "disabling" | "disabling-base-context" = "enabled";
          if (this.eatKey("DISABLING") !== undefined) {
            form = "disabling";
            if (this.atSeq("BASE", "CONTEXT")) {
              this.next();
              this.next();
              form = "disabling-base-context";
            }
            if (this.eatKey("AND") !== undefined && this.atKey("{")) this.skipBalancedBlock();
          }
          bo.privilegedMode = { form, range: spanOf(start, this.prev()) };
          this.finishStatement(false);
          return;
        }
        if (this.atSeq("MANAGED", "INSTANCE", "FILTER")) {
          this.next();
          this.next();
          this.next();
          bo.managedInstanceFilter = spanOf(start, this.prev());
          this.finishStatement(false);
          return;
        }
        break;
      }
      default:
        break;
    }
    bo.unknownHeader.push(this.makeUnknown(startPos, false));
  }

  /** `extensible;` → []; `extensible { with additional save; … }` → option keys. */
  private parseExtensibleOptions(): string[] {
    if (this.eatKey(";") !== undefined) return [];
    if (!this.atKey("{")) {
      this.finishStatement(false);
      return [];
    }
    this.next();
    const options: string[] = [];
    while (!this.atKey("}") && !this.atEof() && !this.stopped) {
      const words: string[] = [];
      while (!this.atKey(";") && !this.atKey("}") && !this.atEof()) words.push(this.next().text.toLowerCase());
      this.eatKey(";");
      if (words.length > 0) options.push(words.join(" "));
    }
    this.expectPunct("}");
    this.eatKey(";");
    return options;
  }

  private tryParseSaveOption(): SaveOption | undefined {
    if (!this.atKey("WITH")) return undefined;
    if (!(this.atKey("ADDITIONAL", 1) || this.atKey("UNMANAGED", 1)) || !this.atKey("SAVE", 2)) return undefined;
    const start = this.next();
    const form = this.next().key === "ADDITIONAL" ? "additional" : "unmanaged";
    this.next();
    let fullData = false;
    let andCleanup = false;
    for (;;) {
      if (this.atSeq("WITH", "FULL", "DATA")) {
        this.next();
        this.next();
        this.next();
        fullData = true;
        continue;
      }
      if (this.atSeq("AND", "CLEANUP")) {
        this.next();
        this.next();
        andCleanup = true;
        continue;
      }
      break;
    }
    return { form, fullData, andCleanup, range: spanOf(start, this.prev()) };
  }

  private tryParseImplClause(): Ident | undefined {
    if (!this.atSeq("IMPLEMENTATION", "IN", "CLASS")) return undefined;
    this.next();
    this.next();
    this.next();
    const cls = this.expectIdent("an implementation class name");
    this.eatKey("UNIQUE");
    return cls;
  }

  private skipBalancedBlock(): void {
    if (!this.atKey("{")) return;
    let depth = 0;
    do {
      const token = this.next();
      if (token.kind === "punct" && token.key === "{") depth += 1;
      else if (token.kind === "punct" && token.key === "}") depth -= 1;
    } while (depth > 0 && !this.atEof());
  }

  /* -------------------------------------------------------------- entity */

  private parseEntity(form: "define" | "extend", isRoot: boolean): EntityBehavior {
    const start = this.next(); // define | extend
    this.expectKey("BEHAVIOR");
    this.expectKey("FOR");
    const entity = this.expectIdent("a CDS entity name");

    const node: EntityBehavior = {
      kind: "entity-behavior",
      form,
      entity,
      isRoot: form === "define" && isRoot,
      characteristics: [],
      body: [],
      operations: [],
      fields: [],
      associations: [],
      actions: [],
      functions: [],
      determinations: [],
      validations: [],
      determineActions: [],
      draftActions: [],
      sideEffects: [],
      mappings: [],
      events: [],
      uses: [],
      groups: [],
      unknown: [],
      range: spanOf(start, this.prev()),
    };

    if (this.eatKey("ALIAS") !== undefined) node.alias = this.expectIdent("an alias name");
    if (this.atKey("EXTERNAL") && this.peek(1).kind === "string") {
      this.next();
      node.external = stringLitOf(this.next());
    }

    this.parseCharacteristics(node);
    if (this.stopped && !this.atKey("{")) {
      node.range = spanOf(start, this.prev());
      normaliseEntity(node);
      return node;
    }
    this.expectPunct("{");

    while (!this.atKey("}") && !this.atEof() && !this.stopped) {
      const startPos = this.pos;
      const baseDepth = this.depth;
      try {
        const statement = this.parseBodyStatement(node);
        if (statement !== undefined) {
          node.body.push(statement);
          bucketStatement(node, statement);
        }
      } catch (error) {
        if (error !== RECOVER) throw error;
        const recovered = this.recoverFrom(startPos, baseDepth);
        node.body.push(recovered);
        node.unknown.push(recovered);
      }
      if (this.pos === startPos && !this.atEof()) this.next();
    }
    if (this.atKey("}")) this.next();
    else if (!this.stopped) this.expectPunct("}");
    this.eatKey(";");

    node.range = spanOf(start, this.prev());
    normaliseEntity(node);
    return node;
  }

  private parseCharacteristics(node: EntityBehavior): void {
    while (!this.atKey("{") && !this.atEof() && !this.stopped) {
      if (this.atSeq("DEFINE", "BEHAVIOR") || this.atSeq("EXTEND", "BEHAVIOR")) break;
      const startPos = this.pos;
      let handled: boolean;
      try {
        handled = this.tryParseCharacteristic(node);
      } catch (error) {
        if (error !== RECOVER) throw error;
        const statement = this.skipUnknownCharacteristic(startPos, true);
        node.characteristics.push({ kind: "unknown", statement, range: statement.range });
        handled = true;
      }
      if (!handled) {
        const statement = this.skipUnknownCharacteristic(startPos);
        node.characteristics.push({ kind: "unknown", statement, range: statement.range });
      }
      if (this.pos === startPos && !this.atEof()) this.next();
    }
  }

  /** Bounded skip: stop at `{`, `;`, the next characteristic keyword or EOF. */
  private skipUnknownCharacteristic(startPos: number, reported = false): UnknownStatement {
    let consumed = 0;
    while (!this.atEof() && consumed < 60) {
      if (this.atKey("{")) break;
      if (consumed > 0 && CHARACTERISTIC_KEYS.has(this.peek().key)) break;
      if (this.atSeq("DEFINE", "BEHAVIOR") || this.atSeq("EXTEND", "BEHAVIOR")) break;
      const token = this.next();
      consumed += 1;
      if (token.kind === "punct" && token.key === ";") break;
    }
    if (this.pos === startPos && !this.atEof()) this.next();
    const span = this.tokens.slice(startPos, Math.max(this.pos, startPos + 1));
    const first = span[0] ?? this.peek();
    const last = span[span.length - 1] ?? first;
    const statement: UnknownStatement = {
      kind: "unknown",
      leadingKey: first.key,
      text: span
        .map((token) => token.text)
        .join(" ")
        .slice(0, MAX_UNKNOWN_TEXT),
      range: spanOf(first, last),
    };
    if (!reported) this.unknown.push(statement);
    this.countRecovery();
    return statement;
  }

  private tryParseCharacteristic(node: EntityBehavior): boolean {
    const start = this.peek();
    switch (start.key) {
      case "PERSISTENT": {
        if (!this.atKey("TABLE", 1)) return false;
        this.next();
        this.next();
        const table = this.expectIdent("a database table name");
        node.characteristics.push({ kind: "persistent-table", table, range: spanOf(start, this.prev()) });
        return true;
      }
      case "DRAFT": {
        if (!this.atKey("TABLE", 1)) return false;
        this.next();
        this.next();
        const table = this.expectIdent("a draft table name");
        node.characteristics.push({ kind: "draft-table", table, range: spanOf(start, this.prev()) });
        return true;
      }
      case "QUERY": {
        this.next();
        const view = this.expectIdent("a draft query view name");
        node.characteristics.push({ kind: "query", view, range: spanOf(start, this.prev()) });
        return true;
      }
      case "ETAG": {
        this.next();
        if (this.eatKey("MASTER") !== undefined) {
          const field = this.expectIdent("an ETag field name");
          node.characteristics.push({ kind: "etag-master", field, range: spanOf(start, this.prev()) });
          return true;
        }
        this.expectKey("DEPENDENT");
        this.expectKey("BY");
        const assoc = this.expectIdent("an association name");
        node.characteristics.push({ kind: "etag-dependent", assoc, range: spanOf(start, this.prev()) });
        return true;
      }
      case "TOTAL": {
        if (!this.atKey("ETAG", 1)) return false;
        this.next();
        this.next();
        const field = this.expectIdent("a total-ETag field name");
        node.characteristics.push({ kind: "total-etag", field, range: spanOf(start, this.prev()) });
        return true;
      }
      case "LOCK": {
        this.next();
        if (this.eatKey("MASTER") !== undefined) {
          const unmanaged = this.eatKey("UNMANAGED") !== undefined;
          node.characteristics.push({ kind: "lock-master", unmanaged, range: spanOf(start, this.prev()) });
          if (this.atSeq("TOTAL", "ETAG")) {
            const totalStart = this.next();
            this.next();
            const field = this.expectIdent("a total-ETag field name");
            node.characteristics.push({
              kind: "total-etag",
              field,
              range: spanOf(totalStart, this.prev()),
            });
          }
          return true;
        }
        this.expectKey("DEPENDENT");
        this.expectKey("BY");
        const assoc = this.expectIdent("an association name");
        node.characteristics.push({ kind: "lock-dependent", assoc, range: spanOf(start, this.prev()) });
        return true;
      }
      case "AUTHORIZATION": {
        this.next();
        if (this.eatKey("MASTER") !== undefined) {
          const scopes: AuthScope[] = [];
          if (this.eatKey("(") !== undefined) {
            while (!this.atKey(")") && !this.atEof()) {
              const scope = this.expectNameToken("an authorization scope");
              if (scope.key === "NONE" || scope.key === "GLOBAL" || scope.key === "INSTANCE") {
                scopes.push(scope.key.toLowerCase() as AuthScope);
              }
              if (this.eatKey(",") === undefined) break;
            }
            this.expectPunct(")");
          }
          node.characteristics.push({
            kind: "authorization-master",
            scopes,
            range: spanOf(start, this.prev()),
          });
          return true;
        }
        this.expectKey("DEPENDENT");
        this.expectKey("BY");
        const assoc = this.expectIdent("an association name");
        node.characteristics.push({
          kind: "authorization-dependent",
          assoc,
          range: spanOf(start, this.prev()),
        });
        return true;
      }
      case "EARLY":
      case "LATE": {
        if (!this.atKey("NUMBERING", 1)) return false;
        this.next();
        this.next();
        this.eatKey(";");
        node.characteristics.push({
          kind: "numbering",
          when: start.key === "EARLY" ? "early" : "late",
          range: spanOf(start, this.prev()),
        });
        return true;
      }
      case "CHANGEDOCUMENTS": {
        this.next();
        if (this.atKey("(")) {
          this.skipBalancedParens();
          node.characteristics.push({
            kind: "changedocuments",
            form: "master",
            range: spanOf(start, this.prev()),
          });
          return true;
        }
        if (this.eatKey("MASTER") !== undefined) {
          node.characteristics.push({
            kind: "changedocuments",
            form: "master",
            range: spanOf(start, this.prev()),
          });
          return true;
        }
        this.expectKey("DEPENDENT");
        this.expectKey("BY");
        const assoc = this.expectIdent("an association name");
        node.characteristics.push({
          kind: "changedocuments",
          form: "dependent",
          assoc,
          range: spanOf(start, this.prev()),
        });
        return true;
      }
      case "EXTENSIBLE": {
        // Spec §2.3: `extensible` is both a header statement and an entity
        // characteristic, and BOTH forms occur in BOTH positions — bare
        // (`abap-platform-basic-trial/zr_ac000000uxx.bdef.asbdef` puts one
        // between `persistent table` and `draft table`) and the block form
        // `extensible { with additional save; … }`. Reading only the bare form
        // here left the block to be mistaken for the entity body: the real
        // body then parsed as an unknown statement, costing two RAP000s on a
        // legal file (breaker probe P2-1).
        this.next();
        let options: string[] = [];
        if (this.atKey("{")) options = this.parseExtensibleOptions();
        else this.eatKey(";");
        node.characteristics.push({ kind: "extensible", options, range: spanOf(start, this.prev()) });
        return true;
      }
      case "IMPLEMENTATION": {
        const cls = this.tryParseImplClause();
        if (cls === undefined) return false;
        node.implementationClass = cls;
        this.eatKey(";");
        return true;
      }
      case "USE": {
        if (!this.atKey("ETAG", 1)) return false;
        const use = this.parseUse();
        node.characteristics.push({ kind: "use", use, range: use.range });
        return true;
      }
      case "WITH": {
        const save = this.tryParseSaveOption();
        if (save !== undefined) {
          node.characteristics.push({ kind: "save", save, range: save.range });
          return true;
        }
        if (this.atKey("DRAFT", 1) || (this.atKey("COLLABORATIVE", 1) && this.atKey("DRAFT", 2))) {
          this.next();
          const collaborative = this.eatKey("COLLABORATIVE") !== undefined;
          this.next();
          this.eatKey(";");
          node.characteristics.push({
            kind: "with-draft",
            collaborative,
            range: spanOf(start, this.prev()),
          });
          return true;
        }
        if (this.atKey("HIERARCHY", 1)) {
          this.next();
          this.next();
          this.eatKey(";");
          node.characteristics.push({ kind: "with-hierarchy", range: spanOf(start, this.prev()) });
          return true;
        }
        return false;
      }
      default:
        return false;
    }
  }

  private skipBalancedParens(): void {
    if (!this.atKey("(")) return;
    let depth = 0;
    do {
      const token = this.next();
      if (token.kind === "punct" && token.key === "(") depth += 1;
      else if (token.kind === "punct" && token.key === ")") depth -= 1;
    } while (depth > 0 && !this.atEof());
  }

  /* ---------------------------------------------------------------- body */

  private parseBodyStatement(entity: EntityBehavior): BodyStatement | undefined {
    const start = this.peek();
    switch (start.key) {
      case "FIELD":
        return this.parseField();
      case "CREATE":
      case "UPDATE":
      case "DELETE":
        return this.parseOperation();
      case "INTERNAL":
        if (this.atKey("FUNCTION", 1)) return this.parseFunction();
        if (this.atKey("ACTION", 1) || this.atKey("STATIC", 1) || this.atKey("FACTORY", 1)) {
          return this.parseAction();
        }
        return this.parseOperation();
      case "STATIC":
      case "REPEATABLE":
      case "DEFAULT":
      case "FACTORY":
        return this.lookaheadHasKey("FUNCTION", 5) && !this.lookaheadHasKey("ACTION", 5)
          ? this.parseFunction()
          : this.parseAction();
      case "SAVE":
        if (this.atKey("(", 1)) return this.parseAction();
        break;
      case "ACTION":
        return this.parseAction();
      case "FUNCTION":
        return this.parseFunction();
      case "KEY":
        if (this.atKey("FUNCTION", 2)) return this.parseFunction();
        break;
      case "ASSOCIATION":
        return this.parseAssociation();
      case "VALIDATION":
        return this.parseValidation();
      case "DETERMINATION":
        return this.parseDetermination();
      case "DETERMINE":
        if (this.atKey("ACTION", 1)) return this.parseDetermineAction(false, false);
        break;
      case "DRAFT":
        if (this.atSeq("DRAFT", "DETERMINE", "ACTION")) return this.parseDetermineAction(true, false);
        if (this.atSeq("DRAFT", "ACTION")) return this.parseDraftAction();
        break;
      case "EXTEND":
        if (this.atSeq("EXTEND", "DRAFT", "DETERMINE", "ACTION")) return this.parseDetermineAction(true, true);
        if (this.atSeq("EXTEND", "DETERMINE", "ACTION")) return this.parseDetermineAction(false, true);
        break;
      case "MANAGED":
        if (this.atKey("EVENT", 1)) return this.parseEvent();
        break;
      case "EVENT":
        return this.parseEvent();
      case "SIDE":
        if (this.atKey("EFFECTS", 1)) return this.parseSideEffects();
        break;
      case "MAPPING":
        return this.parseMapping();
      case "DEEP":
        if (this.atKey("MAPPING", 1)) return this.parseMapping();
        break;
      case "USE":
        return this.parseUse();
      case "GROUP":
        return this.parseGroup(entity);
      case "EARLY":
      case "LATE":
        // Tolerated out of position (bdl-grammar-notes §5 snippet 17 writes
        // `early numbering;` next to a field characteristic). Recorded as a
        // characteristic, never as a body statement.
        if (this.atKey("NUMBERING", 1) && this.tryParseCharacteristic(entity)) return undefined;
        break;
      default:
        break;
    }
    return this.makeUnknown(this.pos, false);
  }

  private lookaheadHasKey(key: string, limit: number): boolean {
    for (let offset = 0; offset < limit; offset += 1) {
      const token = this.peek(offset);
      if (token.kind === "eof") return false;
      if (token.key === key) return true;
      if (token.kind === "punct" && (token.key === ";" || token.key === "{")) return false;
    }
    return false;
  }

  private finishStatement(hadBlock: boolean): void {
    if (this.eatKey(";") !== undefined) return;
    if (hadBlock) return;
    this.failHere("Expected `;` to terminate the statement.");
  }

  private parseField(): FieldStatement {
    const start = this.next();
    this.expectPunct("(");
    const characteristics: FieldChar[] = [];
    for (;;) {
      if (this.atKey(")")) break;
      const charStart = this.peek();
      if (this.atSeq("HIERARCHY", "-", "INDEX")) {
        this.next();
        this.next();
        this.next();
        characteristics.push({
          name: "hierarchy-index",
          raw: "hierarchy-index",
          range: spanOf(charStart, this.prev()),
        });
      } else {
        const nameToken = this.expectNameToken("a field characteristic");
        let raw = nameToken.text;
        let qualifier: FieldChar["qualifier"];
        if (this.eatKey(":") !== undefined) {
          const qualifierToken = this.expectNameToken("a field-characteristic qualifier");
          qualifier = FIELD_CHAR_QUALIFIERS[qualifierToken.key];
          raw = `${raw}:${qualifierToken.text}`;
        }
        characteristics.push({
          name: FIELD_CHAR_NAMES[nameToken.key] ?? "unknown",
          ...(qualifier !== undefined ? { qualifier } : {}),
          raw,
          range: spanOf(charStart, this.prev()),
        });
      }
      if (this.eatKey(",") === undefined) break;
    }
    this.expectPunct(")");

    const fields: Ident[] = [];
    for (;;) {
      fields.push(this.expectIdent("a field name"));
      if (this.eatKey(",") === undefined) break;
      if (this.atKey(";")) break;
    }
    this.finishStatement(false);
    return { kind: "field", characteristics, fields, range: spanOf(start, this.prev()) };
  }

  private parseFacets(): Facet[] {
    if (!this.atKey("(")) return [];
    this.next();
    const facets: Facet[] = [];
    while (!this.atKey(")") && !this.atEof()) {
      const start = this.peek();
      if (this.atSeq("FEATURES", ":")) {
        this.next();
        this.next();
        const scope = this.expectNameToken("`instance` or `global`");
        facets.push({
          kind: "features",
          scope: scope.key === "GLOBAL" ? "global" : "instance",
          range: spanOf(start, this.prev()),
        });
      } else if (this.atSeq("AUTHORIZATION", ":")) {
        this.next();
        this.next();
        const value = this.expectNameToken("an authorization kind");
        const known = ["NONE", "UPDATE", "GLOBAL", "INSTANCE"].includes(value.key);
        if (known) {
          facets.push({
            kind: "authorization",
            value: value.key.toLowerCase() as "none" | "update" | "global" | "instance",
            range: spanOf(start, this.prev()),
          });
        } else {
          facets.push({ kind: "unknown", text: value.text, range: spanOf(start, this.prev()) });
        }
      } else if (this.atKey("PRECHECK")) {
        this.next();
        facets.push({ kind: "precheck", range: spanOf(start, this.prev()) });
      } else if (this.atSeq("LOCK", ":")) {
        this.next();
        this.next();
        this.expectNameToken("`none`");
        facets.push({ kind: "lock-none", range: spanOf(start, this.prev()) });
      } else {
        const words: string[] = [];
        while (!this.atKey(",") && !this.atKey(")") && !this.atEof()) words.push(this.next().text);
        facets.push({ kind: "unknown", text: words.join(" "), range: spanOf(start, this.prev()) });
      }
      if (this.eatKey(",") === undefined) break;
    }
    this.expectPunct(")");
    return facets;
  }

  private parseOperation(): OperationStatement {
    const start = this.peek();
    const internal = this.eatKey("INTERNAL") !== undefined;
    const verbToken = this.next();
    const verb =
      verbToken.key === "CREATE" ? "create" : verbToken.key === "UPDATE" ? "update" : "delete";
    const facets = this.parseFacets();
    let defaultFunction: Ident | undefined;
    let hadBlock = false;
    if (this.atKey("{")) {
      hadBlock = true;
      this.next();
      while (!this.atKey("}") && !this.atEof()) {
        if (this.atSeq("DEFAULT", "FUNCTION")) {
          this.next();
          this.next();
          defaultFunction = this.expectIdent("a function name");
          this.finishStatement(false);
        } else {
          this.makeUnknown(this.pos, false);
        }
      }
      this.expectPunct("}");
    }
    this.finishStatement(hadBlock);
    return {
      kind: "operation",
      verb,
      internal,
      facets,
      ...(defaultFunction !== undefined ? { defaultFunction } : {}),
      range: spanOf(start, this.prev()),
    };
  }

  private parseAssociation(): AssociationStatement {
    const start = this.next();
    const name = this.expectIdent("an association name");
    const node: AssociationStatement = {
      kind: "association",
      name,
      unknown: [],
      range: spanOf(start, this.prev()),
    };
    if (this.atSeq("WITH", "HIERARCHY")) {
      const hierarchyStart = this.next();
      this.next();
      node.withHierarchy = spanOf(hierarchyStart, this.prev());
    }
    let hadBlock = false;
    if (this.atKey("{")) {
      hadBlock = true;
      this.next();
      while (!this.atKey("}") && !this.atEof() && !this.stopped) {
        const itemStart = this.peek();
        const itemPos = this.pos;
        if (this.atKey("CREATE")) {
          this.next();
          const facets = this.parseFacets();
          this.finishStatement(false);
          node.create = { facets, range: spanOf(itemStart, this.prev()) };
        } else if (this.atSeq("WITH", "DRAFT")) {
          this.next();
          this.next();
          this.finishStatement(false);
          node.withDraft = spanOf(itemStart, this.prev());
        } else if (this.atSeq("WITH", "DEPENDENT", "DRAFT")) {
          this.next();
          this.next();
          this.next();
          this.finishStatement(false);
          node.withDependentDraft = spanOf(itemStart, this.prev());
        } else if (this.atSeq("WITH", "HIERARCHY")) {
          this.next();
          this.next();
          this.finishStatement(false);
          node.withHierarchy = spanOf(itemStart, this.prev());
        } else if (this.atSeq("LINK", "ACTION")) {
          this.next();
          this.next();
          node.linkAction = this.expectIdent("an action name");
          this.finishStatement(false);
        } else if (this.atSeq("UNLINK", "ACTION")) {
          this.next();
          this.next();
          node.unlinkAction = this.expectIdent("an action name");
          this.finishStatement(false);
        } else if (this.atSeq("INVERSE", "FUNCTION")) {
          this.next();
          this.next();
          node.inverseFunction = this.expectIdent("a function name");
          this.finishStatement(false);
        } else {
          node.unknown.push(this.makeUnknown(itemPos, false));
        }
        if (this.pos === itemPos && !this.atEof()) this.next();
      }
      this.expectPunct("}");
    }
    this.finishStatement(hadBlock);
    node.range = spanOf(start, this.prev());
    return node;
  }

  private parseCardinality(): Cardinality {
    const startPos = this.pos;
    const start = this.expectPunct("[");
    let min = 0;
    let max: number | "*";
    if (this.eatKey("*") !== undefined) {
      max = "*";
    } else {
      min = this.expectNumber();
      if (this.eatKey("..") !== undefined) {
        max = this.eatKey("*") !== undefined ? "*" : this.expectNumber();
      } else {
        max = min;
      }
    }
    const end = this.expectPunct("]");
    const raw = this.tokens
      .slice(startPos, this.pos)
      .map((token) => token.text)
      .join("");
    return { min, max, raw, range: spanOf(start, end) };
  }

  private tryParseParameter(): ParameterClause | undefined {
    let deep = false;
    let table = false;
    if (this.atKey("DEEP")) {
      if (this.atKey("PARAMETER", 1)) deep = true;
      else if (this.atSeq("DEEP", "TABLE", "PARAMETER")) {
        deep = true;
        table = true;
      } else return undefined;
    } else if (!this.atKey("PARAMETER")) {
      return undefined;
    }
    const start = this.peek();
    if (deep) this.next();
    if (table) this.next();
    this.next(); // parameter
    let isSelf = false;
    let type: Ident | undefined;
    if (this.peek().kind === "ident") {
      const token = this.next();
      if (token.key === "$SELF") isSelf = true;
      else type = identOf(token);
    }
    return {
      deep,
      table,
      isSelf,
      ...(type !== undefined ? { type } : {}),
      range: spanOf(start, this.prev()),
    };
  }

  private tryParseResult(): ResultClause | undefined {
    const deep = this.atSeq("DEEP", "RESULT");
    if (!deep && !this.atKey("RESULT")) return undefined;
    const start = this.peek();
    if (deep) this.next();
    this.next(); // result
    const selective = this.eatKey("SELECTIVE") !== undefined;
    const cardinality = this.atKey("[") ? this.parseCardinality() : undefined;
    let target: ResultTarget;
    if (this.eatKey("ENTITY") !== undefined) {
      target = { kind: "entity", entity: this.expectIdent("a CDS entity name") };
    } else {
      const token = this.expectNameToken("`$self`, `entity <name>` or a type name");
      target = token.key === "$SELF" ? { kind: "self" } : { kind: "type", type: identOf(token) };
    }
    return {
      selective,
      deep,
      ...(cardinality !== undefined ? { cardinality } : {}),
      target,
      range: spanOf(start, this.prev()),
    };
  }

  private parseAction(): ActionStatement {
    const start = this.peek();
    let internal = false;
    let isStatic = false;
    let repeatable = false;
    let factory = false;
    let defaultFactory = false;
    let savePhases: ("finalize" | "adjustnumbers")[] | undefined;
    for (;;) {
      if (this.atKey("INTERNAL")) {
        this.next();
        internal = true;
        continue;
      }
      if (this.atKey("STATIC")) {
        this.next();
        isStatic = true;
        continue;
      }
      if (this.atKey("REPEATABLE")) {
        this.next();
        repeatable = true;
        continue;
      }
      if (this.atSeq("DEFAULT", "FACTORY")) {
        this.next();
        defaultFactory = true;
        continue;
      }
      if (this.atKey("FACTORY")) {
        this.next();
        factory = true;
        continue;
      }
      if (this.atSeq("SAVE", "(")) {
        this.next();
        this.next();
        savePhases = [];
        while (!this.atKey(")") && !this.atEof()) {
          const phase = this.expectNameToken("`finalize` or `adjustnumbers`");
          if (phase.key === "FINALIZE") savePhases.push("finalize");
          else if (phase.key === "ADJUSTNUMBERS") savePhases.push("adjustnumbers");
          if (this.eatKey(",") === undefined) break;
        }
        this.expectPunct(")");
        continue;
      }
      break;
    }
    this.expectKey("ACTION");
    const facets = this.parseFacets();
    const name = this.expectIdent("an action name");

    const node: ActionStatement = {
      kind: "action",
      name,
      internal,
      isStatic,
      repeatable,
      factory: factory || defaultFactory,
      defaultFactory,
      ...(savePhases !== undefined ? { savePhases } : {}),
      facets,
      range: spanOf(start, this.prev()),
    };

    if (this.atKey("EXTERNAL") && this.peek(1).kind === "string") {
      this.next();
      node.external = stringLitOf(this.next());
    }
    if (this.atKey("[")) node.cardinality = this.parseCardinality();
    const parameter = this.tryParseParameter();
    if (parameter !== undefined) node.parameter = parameter;
    if (node.cardinality === undefined && this.atKey("[")) node.cardinality = this.parseCardinality();
    const result = this.tryParseResult();
    if (result !== undefined) node.result = result;

    let hadBlock = false;
    if (this.atKey("{")) {
      hadBlock = true;
      this.next();
      while (!this.atKey("}") && !this.atEof()) {
        if (this.atSeq("DEFAULT", "FUNCTION")) {
          this.next();
          this.next();
          node.defaultFunction = this.expectIdent("a function name");
          this.finishStatement(false);
        } else {
          this.makeUnknown(this.pos, false);
        }
      }
      this.expectPunct("}");
    }
    this.finishStatement(hadBlock);
    node.range = spanOf(start, this.prev());
    return node;
  }

  private parseFunction(): FunctionStatement {
    const start = this.peek();
    let keyName: Ident | undefined;
    if (this.atKey("KEY")) {
      this.next();
      keyName = this.expectIdent("an alternative-key name");
    }
    let internal = false;
    let isStatic = false;
    let repeatable = false;
    for (;;) {
      if (this.atKey("INTERNAL")) {
        this.next();
        internal = true;
        continue;
      }
      if (this.atKey("STATIC")) {
        this.next();
        isStatic = true;
        continue;
      }
      if (this.atKey("REPEATABLE")) {
        this.next();
        repeatable = true;
        continue;
      }
      break;
    }
    this.expectKey("FUNCTION");
    const facets = this.parseFacets();
    const name = this.expectIdent("a function name");
    const node: FunctionStatement = {
      kind: "function",
      name,
      internal,
      isStatic,
      repeatable,
      ...(keyName !== undefined ? { keyName } : {}),
      facets,
      range: spanOf(start, this.prev()),
    };
    if (this.atKey("EXTERNAL") && this.peek(1).kind === "string") {
      this.next();
      node.external = stringLitOf(this.next());
    }
    const parameter = this.tryParseParameter();
    if (parameter !== undefined) node.parameter = parameter;
    // A missing `result` is NOT a parse error: SAP's own sources disagree on
    // whether it is mandatory (rap-rule-catalog RAP082, "conflicting").
    const result = this.tryParseResult();
    if (result !== undefined) node.result = result;
    this.finishStatement(false);
    node.range = spanOf(start, this.prev());
    return node;
  }

  private parseQualifiedName(): QualifiedName {
    const first = this.expectIdent("a name");
    if (this.eatKey("~") !== undefined) {
      const second = this.expectIdent("a name");
      return {
        qualifier: first,
        name: second,
        key: second.key,
        range: { start: first.range.start, end: second.range.end },
      };
    }
    return { name: first, key: first.key, range: first.range };
  }

  private parseTriggerBlock(): TriggerItem[] {
    const triggers: TriggerItem[] = [];
    this.expectPunct("{");
    while (!this.atKey("}") && !this.atEof() && !this.stopped) {
      const itemStart = this.peek();
      const itemPos = this.pos;
      if (this.atKey("FIELD")) {
        this.next();
        const fields: Ident[] = [];
        for (;;) {
          fields.push(this.expectIdent("a field name"));
          if (this.eatKey(",") === undefined) break;
          if (this.atKey(";")) break;
        }
        this.finishStatement(false);
        triggers.push({ fields, range: spanOf(itemStart, this.prev()) });
      } else if (this.atKey("CREATE") || this.atKey("UPDATE") || this.atKey("DELETE")) {
        const verb = this.next();
        this.finishStatement(false);
        triggers.push({
          op: verb.key.toLowerCase() as "create" | "update" | "delete",
          range: spanOf(itemStart, this.prev()),
        });
      } else {
        this.makeUnknown(itemPos, false);
      }
      if (this.pos === itemPos && !this.atEof()) this.next();
    }
    this.expectPunct("}");
    return triggers;
  }

  private parseValidation(): ValidationStatement {
    const start = this.next();
    const name = this.parseQualifiedName();
    if (this.eatKey("ON") !== undefined) {
      this.expectKey("SAVE");
      const triggers = this.parseTriggerBlock();
      this.finishStatement(true);
      return {
        kind: "validation",
        name,
        isDeclaration: true,
        on: "save",
        triggers,
        range: spanOf(start, this.prev()),
      };
    }
    this.finishStatement(false);
    return {
      kind: "validation",
      name,
      isDeclaration: false,
      triggers: [],
      range: spanOf(start, this.prev()),
    };
  }

  private parseDetermination(): DeterminationStatement {
    const start = this.next();
    let always = false;
    if (this.atKey("(")) {
      const facets = this.parseFacets();
      always = facets.some((facet) => facet.kind === "unknown" && facet.text.toUpperCase() === "ALWAYS");
    }
    const name = this.parseQualifiedName();
    if (this.eatKey("ON") !== undefined) {
      const when = this.expectNameToken("`save` or `modify`");
      const triggers = this.parseTriggerBlock();
      this.finishStatement(true);
      return {
        kind: "determination",
        name,
        isDeclaration: true,
        on: when.key === "MODIFY" ? "modify" : "save",
        always,
        triggers,
        range: spanOf(start, this.prev()),
      };
    }
    this.finishStatement(false);
    return {
      kind: "determination",
      name,
      isDeclaration: false,
      always,
      triggers: [],
      range: spanOf(start, this.prev()),
    };
  }

  private parseDetermineAction(draft: boolean, extend: boolean): DetermineActionStatement {
    const start = this.peek();
    if (extend) this.next();
    if (draft) this.next();
    this.expectKey("DETERMINE");
    this.expectKey("ACTION");
    const name = this.expectIdent("a determine-action name");
    const facets = this.parseFacets();
    const extensible = this.eatKey("EXTENSIBLE") !== undefined;
    const items: (ValidationStatement | DeterminationStatement)[] = [];
    let hadBlock = false;
    if (this.atKey("{")) {
      hadBlock = true;
      this.next();
      while (!this.atKey("}") && !this.atEof() && !this.stopped) {
        const itemPos = this.pos;
        if (this.atKey("VALIDATION")) items.push(this.parseValidation());
        else if (this.atKey("DETERMINATION")) items.push(this.parseDetermination());
        else this.makeUnknown(itemPos, false);
        if (this.pos === itemPos && !this.atEof()) this.next();
      }
      this.expectPunct("}");
    }
    this.finishStatement(hadBlock);
    return {
      kind: "determine-action",
      name,
      draft,
      extend,
      extensible,
      facets,
      items,
      range: spanOf(start, this.prev()),
    };
  }

  private parseDraftAction(): DraftActionStatement {
    const start = this.next(); // draft
    this.expectKey("ACTION");
    const facets = this.parseFacets();
    const name = this.expectIdent("a draft-action name");
    const optimized = this.eatKey("OPTIMIZED") !== undefined;
    let withAdditionalImplementation = false;
    if (this.atSeq("WITH", "ADDITIONAL", "IMPLEMENTATION")) {
      this.next();
      this.next();
      this.next();
      withAdditionalImplementation = true;
    }
    this.finishStatement(false);
    return {
      kind: "draft-action",
      name,
      optimized,
      withAdditionalImplementation,
      facets,
      range: spanOf(start, this.prev()),
    };
  }

  private parseEvent(): EventStatement {
    const start = this.peek();
    const managed = this.eatKey("MANAGED") !== undefined;
    this.expectKey("EVENT");
    const name = this.expectIdent("an event name");
    const node: EventStatement = {
      kind: "event",
      name,
      managed,
      forSideEffects: false,
      range: spanOf(start, this.prev()),
    };
    if (this.eatKey("ON") !== undefined) node.on = this.expectIdent("an event name");
    const parameter = this.tryParseParameter();
    if (parameter !== undefined) node.parameter = parameter;
    if (this.atSeq("FOR", "SIDE", "EFFECTS")) {
      this.next();
      this.next();
      this.next();
      node.forSideEffects = true;
    }
    this.finishStatement(false);
    node.range = spanOf(start, this.prev());
    return node;
  }

  private parseDottedPath(): Ident[] {
    const path: Ident[] = [this.expectIdent("a field or association name")];
    while (this.atKey(".") && this.peek(1).kind === "ident") {
      this.next();
      path.push(this.expectIdent("a field name"));
    }
    return path;
  }

  private parseSideEffects(): SideEffectsBlock {
    const start = this.next(); // side
    this.expectKey("EFFECTS");
    this.expectPunct("{");
    const entries: SideEffectEntry[] = [];
    while (!this.atKey("}") && !this.atEof() && !this.stopped) {
      const entryPos = this.pos;
      try {
        entries.push(this.parseSideEffectEntry());
      } catch (error) {
        if (error !== RECOVER) throw error;
        this.recoverFrom(entryPos);
      }
      if (this.pos === entryPos && !this.atEof()) this.next();
    }
    this.expectPunct("}");
    this.finishStatement(true);
    return { kind: "side-effects", entries, range: spanOf(start, this.prev()) };
  }

  private parseSideEffectEntry(): SideEffectEntry {
    const start = this.peek();
    let source: SideEffectSource;
    if (this.atKey("FIELD")) {
      this.next();
      const fields: Ident[] = [];
      for (;;) {
        const path = this.parseDottedPath();
        fields.push(path[path.length - 1] as Ident);
        if (this.eatKey(",") === undefined) break;
      }
      source = { kind: "field", fields };
    } else if (this.atKey("$SELF")) {
      this.next();
      source = { kind: "self" };
    } else if (this.atKey("ACTION")) {
      this.next();
      source = { kind: "action", name: this.expectIdent("an action name") };
    } else if (this.atKey("EVENT")) {
      this.next();
      source = { kind: "event", name: this.expectIdent("an event name") };
    } else if (this.atSeq("DETERMINE", "ACTION")) {
      this.next();
      this.next();
      source = { kind: "determine-action", name: this.expectIdent("a determine-action name") };
    } else {
      this.failHere("Expected a side-effect source (`field`, `$self`, `action`, `event` or `determine action`).");
    }

    let executedOn: SideEffectTrigger[] | undefined;
    if (this.atSeq("EXECUTED", "ON")) {
      this.next();
      this.next();
      executedOn = [];
      for (;;) {
        if (this.eatKey("GLOBAL") !== undefined) executedOn.push({ kind: "global" });
        else {
          this.expectKey("FIELD");
          executedOn.push({ kind: "field", path: this.parseDottedPath() });
        }
        if (this.eatKey(",") === undefined) break;
      }
    }

    this.expectKey("AFFECTS");
    const targets: SideEffectTarget[] = [];
    for (;;) {
      targets.push(...this.parseSideEffectTargets());
      if (this.eatKey(",") === undefined) break;
      if (this.atKey(";")) break;
    }
    this.finishStatement(false);
    return {
      source,
      ...(executedOn !== undefined ? { executedOn } : {}),
      targets,
      range: spanOf(start, this.prev()),
    };
  }

  private parseSideEffectTargets(): SideEffectTarget[] {
    if (this.atKey("FIELD")) {
      this.next();
      if (this.eatKey("*") !== undefined) return [{ kind: "field", wildcard: true, path: [] }];
      if (this.eatKey("(") !== undefined) {
        const out: SideEffectTarget[] = [];
        while (!this.atKey(")") && !this.atEof()) {
          out.push({ kind: "field", wildcard: false, path: this.parseDottedPath() });
          if (this.eatKey(",") === undefined) break;
        }
        this.expectPunct(")");
        return out;
      }
      return [{ kind: "field", wildcard: false, path: this.parseDottedPath() }];
    }
    if (this.atKey("ENTITY")) {
      this.next();
      return [this.parseEntitySideEffectTarget()];
    }
    if (this.atKey("PERMISSIONS")) {
      this.next();
      this.expectPunct("(");
      const words: string[] = [];
      while (!this.atKey(")") && !this.atEof()) words.push(this.next().text);
      this.expectPunct(")");
      return [{ kind: "permissions", target: words.join(" ") }];
    }
    if (this.eatKey("MESSAGES") !== undefined) return [{ kind: "messages" }];
    if (this.eatKey("$SELF") !== undefined) return [{ kind: "self" }];
    this.failHere("Expected a side-effect target (`field`, `entity`, `permissions`, `messages` or `$self`).");
  }

  private parseEntitySideEffectTarget(): SideEffectTarget {
    if (this.eatKey("(") !== undefined) {
      const assocs: Ident[][] = [];
      while (!this.atKey(")") && !this.atEof()) {
        assocs.push(this.parseDottedPath());
        if (this.eatKey(",") === undefined) break;
      }
      this.expectPunct(")");
      return { kind: "entity", assocs };
    }
    const prefix: Ident[] = [this.expectIdent("an association name")];
    while (this.atKey(".")) {
      if (this.atKey("(", 1)) {
        this.next();
        this.next();
        const assocs: Ident[][] = [];
        while (!this.atKey(")") && !this.atEof()) {
          assocs.push([...prefix, ...this.parseDottedPath()]);
          if (this.eatKey(",") === undefined) break;
        }
        this.expectPunct(")");
        return { kind: "entity", assocs };
      }
      this.next();
      prefix.push(this.expectIdent("an association name"));
    }
    return { kind: "entity", assocs: [prefix] };
  }

  private parseMappingItems(): MappingItem[] {
    const items: MappingItem[] = [];
    this.expectPunct("{");
    while (!this.atKey("}") && !this.atEof() && !this.stopped) {
      const itemStart = this.peek();
      const itemPos = this.pos;
      try {
        const sub = this.eatKey("SUB") !== undefined;
        const left = this.expectIdent("a CDS field name");
        this.expectPunct("=");
        const dbField = this.expectIdent("a database field name");
        this.finishStatement(false);
        items.push({
          ...(sub ? { sub: left } : { cdsField: left }),
          dbField,
          range: spanOf(itemStart, this.prev()),
        });
      } catch (error) {
        if (error !== RECOVER) throw error;
        this.recoverFrom(itemPos);
      }
      if (this.pos === itemPos && !this.atEof()) this.next();
    }
    this.expectPunct("}");
    return items;
  }

  private parseMapping(): MappingStatement {
    const start = this.peek();
    const deep = this.eatKey("DEEP") !== undefined;
    this.expectKey("MAPPING");
    this.expectKey("FOR");
    const target = this.expectIdent("a DDIC structure or table name");
    let control: Ident | undefined;
    if (this.eatKey("CONTROL") !== undefined) control = this.expectIdent("a control structure name");
    const corresponding = this.eatKey("CORRESPONDING") !== undefined;
    const extensible = this.eatKey("EXTENSIBLE") !== undefined;
    const except: Ident[] = [];
    if (this.atSeq("EXCEPT", "(")) {
      this.next();
      this.next();
      while (!this.atKey(")") && !this.atEof()) {
        except.push(this.expectIdent("a field name"));
        if (this.eatKey(",") === undefined) break;
      }
      this.expectPunct(")");
    }
    const hadBlock = this.atKey("{");
    const items = hadBlock ? this.parseMappingItems() : [];
    this.finishStatement(hadBlock);
    return {
      kind: "mapping",
      deep,
      target,
      ...(control !== undefined ? { control } : {}),
      corresponding,
      extensible,
      except,
      items,
      range: spanOf(start, this.prev()),
    };
  }

  private parseUse(): UseStatement {
    const start = this.next(); // use
    if (this.atKey("CREATE") || this.atKey("UPDATE") || this.atKey("DELETE")) {
      const verb = this.next();
      this.finishStatement(false);
      return {
        kind: "use",
        what: verb.key.toLowerCase() as "create" | "update" | "delete",
        range: spanOf(start, this.prev()),
      };
    }
    if (this.atKey("DRAFT")) {
      this.next();
      let what: UseStatement["what"] = "draft";
      if (this.atSeq("AS", "DEPENDENT")) {
        this.next();
        this.next();
        what = "draft-as-dependent";
      }
      this.finishStatement(false);
      return { kind: "use", what, range: spanOf(start, this.prev()) };
    }
    if (this.atSeq("COLLABORATIVE", "DRAFT")) {
      this.next();
      this.next();
      this.finishStatement(false);
      return { kind: "use", what: "collaborative-draft", range: spanOf(start, this.prev()) };
    }
    if (this.atKey("ETAG")) {
      this.next();
      // `use etag` sits in the characteristic position with no `;` (22 corpus files).
      this.eatKey(";");
      return { kind: "use", what: "etag", range: spanOf(start, this.prev()) };
    }
    if (this.atSeq("SIDE", "EFFECTS")) {
      this.next();
      this.next();
      this.finishStatement(false);
      return { kind: "use", what: "side-effects", range: spanOf(start, this.prev()) };
    }
    if (this.atKey("ACTION") || this.atKey("FUNCTION") || this.atKey("EVENT")) {
      const kindToken = this.next();
      const name = this.parseQualifiedName();
      let alias: Ident | undefined;
      if (this.eatKey("AS") !== undefined) alias = this.expectIdent("an alias name");
      this.finishStatement(false);
      return {
        kind: "use",
        what: kindToken.key.toLowerCase() as "action" | "function" | "event",
        name,
        ...(alias !== undefined ? { alias } : {}),
        range: spanOf(start, this.prev()),
      };
    }
    if (this.atKey("ASSOCIATION")) {
      this.next();
      const name = this.parseQualifiedName();
      const assoc: NonNullable<UseStatement["assoc"]> = {};
      let hadBlock = false;
      if (this.atKey("{")) {
        hadBlock = true;
        this.next();
        while (!this.atKey("}") && !this.atEof() && !this.stopped) {
          const itemStart = this.peek();
          const itemPos = this.pos;
          if (this.atKey("CREATE")) {
            this.next();
            this.parseFacets();
            this.finishStatement(false);
            assoc.create = spanOf(itemStart, this.prev());
          } else if (this.atSeq("WITH", "DEPENDENT", "DRAFT")) {
            this.next();
            this.next();
            this.next();
            this.finishStatement(false);
            assoc.withDependentDraft = spanOf(itemStart, this.prev());
          } else if (this.atSeq("WITH", "DRAFT")) {
            this.next();
            this.next();
            this.finishStatement(false);
            assoc.withDraft = spanOf(itemStart, this.prev());
          } else {
            this.makeUnknown(itemPos, false);
          }
          if (this.pos === itemPos && !this.atEof()) this.next();
        }
        this.expectPunct("}");
      }
      this.finishStatement(hadBlock);
      return {
        kind: "use",
        what: "association",
        name,
        assoc,
        range: spanOf(start, this.prev()),
      };
    }
    if (this.atSeq("MAPPING", "FOR")) {
      this.next();
      this.next();
      const target = this.expectIdent("a DDIC structure or table name");
      this.eatKey("CORRESPONDING");
      const hadBlock = this.atKey("{");
      const mappingItems = hadBlock ? this.parseMappingItems() : [];
      this.finishStatement(hadBlock);
      return {
        kind: "use",
        what: "mapping",
        name: { name: target, key: target.key, range: target.range },
        mappingItems,
        range: spanOf(start, this.prev()),
      };
    }
    this.failHere("Unrecognised `use` clause.");
  }

  private parseGroup(entity: EntityBehavior): GroupStatement {
    const start = this.next(); // group
    let name: Ident | undefined;
    if (this.peek().kind === "ident") name = this.expectIdent("a group name");
    const body: BodyStatement[] = [];
    this.expectPunct("{");
    while (!this.atKey("}") && !this.atEof() && !this.stopped) {
      const startPos = this.pos;
      const baseDepth = this.depth;
      try {
        const statement = this.parseBodyStatement(entity);
        if (statement !== undefined) body.push(statement);
      } catch (error) {
        if (error !== RECOVER) throw error;
        body.push(this.recoverFrom(startPos, baseDepth));
      }
      if (this.pos === startPos && !this.atEof()) this.next();
    }
    this.expectPunct("}");
    this.finishStatement(true);
    return {
      kind: "group",
      ...(name !== undefined ? { name } : {}),
      body,
      range: spanOf(start, this.prev()),
    };
  }
}

/* ------------------------------------------------------------- helpers */

function identOf(token: Token): Ident {
  return {
    name: token.text,
    key: token.key,
    namespaced: token.text.startsWith("/"),
    range: spanOf(token, token),
  };
}

function stringLitOf(token: Token): StringLit {
  return { value: stringValue(token), range: spanOf(token, token) };
}

function bucketStatement(entity: EntityBehavior, statement: BodyStatement): void {
  switch (statement.kind) {
    case "operation":
      entity.operations.push(statement);
      return;
    case "field":
      entity.fields.push(statement);
      return;
    case "association":
      entity.associations.push(statement);
      return;
    case "action":
      entity.actions.push(statement);
      return;
    case "function":
      entity.functions.push(statement);
      return;
    case "determination":
      entity.determinations.push(statement);
      return;
    case "validation":
      entity.validations.push(statement);
      return;
    case "determine-action":
      entity.determineActions.push(statement);
      return;
    case "draft-action":
      entity.draftActions.push(statement);
      return;
    case "side-effects":
      entity.sideEffects.push(statement);
      return;
    case "mapping":
      entity.mappings.push(statement);
      return;
    case "event":
      entity.events.push(statement);
      return;
    case "use":
      entity.uses.push(statement);
      return;
    case "group":
      entity.groups.push(statement);
      return;
    case "unknown":
      entity.unknown.push(statement);
      return;
    default:
      return;
  }
}

/** Fill the convenience projections the rules read (spec §2.2). */
function normaliseEntity(entity: EntityBehavior): void {
  for (const characteristic of entity.characteristics) {
    switch (characteristic.kind) {
      case "persistent-table":
        entity.persistentTable ??= characteristic.table;
        break;
      case "draft-table":
        entity.draftTable ??= characteristic.table;
        break;
      case "query":
        entity.query ??= characteristic.view;
        break;
      case "etag-master":
        entity.etagMaster ??= characteristic.field;
        break;
      case "etag-dependent":
        entity.etagDependentBy ??= characteristic.assoc;
        break;
      case "total-etag":
        entity.totalEtag ??= characteristic.field;
        break;
      case "lock-master":
        entity.lockMaster ??= { unmanaged: characteristic.unmanaged, range: characteristic.range };
        break;
      case "lock-dependent":
        entity.lockDependentBy ??= characteristic.assoc;
        break;
      case "authorization-master":
        entity.authorization ??= {
          form: "master",
          scopes: characteristic.scopes,
          range: characteristic.range,
        };
        break;
      case "authorization-dependent":
        entity.authorization ??= {
          form: "dependent",
          scopes: [],
          assoc: characteristic.assoc,
          range: characteristic.range,
        };
        break;
      case "numbering":
        entity.numbering ??= { when: characteristic.when, range: characteristic.range };
        break;
      case "save":
        entity.save ??= characteristic.save;
        break;
      case "with-draft":
        entity.withDraft ??= {
          collaborative: characteristic.collaborative,
          range: characteristic.range,
        };
        break;
      default:
        break;
    }
  }
}

/**
 * Parse a RAP behavior definition. Never throws: a caller always gets a
 * (possibly partial) AST plus the two tiers of diagnostics.
 */
export function parseBehaviorDefinition(source: string, filename?: string): ParseBehaviorResult {
  const lexed = tokenize(source);
  const parser = new BdefParser(lexed.tokens, lexed.lines, filename ?? "");
  const result = parser.parse();
  const errors: ParseError[] = [
    ...lexed.errors.map((error) => ({
      message: error.message,
      line: error.line,
      column: error.column,
      excerpt: error.excerpt,
      kind: "syntax" as const,
      file: filename,
    })),
    ...result.errors,
  ];
  return {
    ast: result.ast,
    errors,
    unknown: result.unknown,
    truncated: result.truncated || lexed.truncated,
  };
}
