import * as abaplint from "@abaplint/core";

/**
 * FOR ALL ENTRIES type check (abap-mcp's own rule, key `sql/FAE001`).
 *
 * ABAP rejects `SELECT … FOR ALL ENTRIES IN @itab WHERE col = @itab-comp` at activation unless
 * `col` and `itab-comp` have the same type AND the same length. abaplint does not check this, so
 * the error only surfaced on the SAP system (wtc-rap 2026-11-23: ref_id CHAR 12 against match_id
 * CHAR 10 in a RAP validation).
 *
 * Resolution, conservative by design (a finding only when BOTH sides resolve to a concrete type):
 *  - the column: the FROM table (TABL) or CDS view (DDLS) in the registry, via alias when joined;
 *  - the itab row: abaplint's scope for the statement; when that is unavailable (abaplint does not
 *    model RAP handler methods such as `FOR VALIDATE ON SAVE`, so their bodies get no scope), a
 *    `READ ENTITIES OF <view> … ENTITY <alias> … RESULT DATA(itab)` earlier in the same file,
 *    typed through the CDS view the alias names (BDEF `define behavior for <view> alias <alias>`).
 */

export const FAE_RULE = "sql/FAE001";
export const FAE_DOCS =
  "https://help.sap.com/doc/abapdocu_latest_index_htm/latest/en-US/abenwhere_logexp_itab.htm";

export interface FaeFinding {
  file: string;
  line: number;
  column: number;
  message: string;
}

type T = abaplint.AbstractType;

/** A comparable signature for elementary types; undefined = not concrete enough to judge. */
function signature(t: T | undefined): string | undefined {
  if (t === undefined) return undefined;
  const len = (x: T): number | undefined => (x as unknown as { getLength?: () => number }).getLength?.();
  if (t instanceof abaplint.BasicTypes.CharacterType) return `CHAR ${len(t)}`;
  if (t instanceof abaplint.BasicTypes.NumericType) return `NUMC ${len(t)}`;
  if (t instanceof abaplint.BasicTypes.HexType) return `RAW ${len(t)}`;
  if (t instanceof abaplint.BasicTypes.PackedType) return `DEC ${t.getLength()},${t.getDecimals()}`;
  if (t instanceof abaplint.BasicTypes.IntegerType) return "INT4";
  if (t instanceof abaplint.BasicTypes.Integer8Type) return "INT8";
  if (t instanceof abaplint.BasicTypes.DateType) return "DATS";
  if (t instanceof abaplint.BasicTypes.TimeType) return "TIMS";
  if (t instanceof abaplint.BasicTypes.StringType) return "STRING";
  if (t instanceof abaplint.BasicTypes.XStringType) return "RAWSTRING";
  if (t instanceof abaplint.BasicTypes.FloatType) return "FLTP";
  return undefined;
}

function component(t: T | undefined, name: string): T | undefined {
  if (t === undefined) return undefined;
  if (name.toLowerCase() === "table_line") return t;
  if (t instanceof abaplint.BasicTypes.StructureType) return t.getComponentByName(name);
  return undefined;
}

function rowOf(t: T | undefined): T | undefined {
  return t instanceof abaplint.BasicTypes.TableType ? t.getRowType() : undefined;
}

function dictType(reg: abaplint.IRegistry, name: string): T | undefined {
  for (const kind of ["TABL", "DDLS", "VIEW"]) {
    const obj = reg.getObject(kind, name.toUpperCase()) as unknown as
      | { parseType?: (r: abaplint.IRegistry) => T }
      | undefined;
    if (obj?.parseType === undefined) continue;
    try {
      return obj.parseType(reg);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** BDEF alias → entity (CDS view) name, from every `define behavior for X alias Y` in the input. */
function bdefAliases(files: readonly { filename: string; source: string }[]): Map<string, string> {
  const out = new Map<string, string>();
  const re = /define\s+behavior\s+for\s+(\w+)(?:\s+alias\s+(\w+))?/gi;
  for (const f of files) {
    if (!/\.bdef\.asbdef$/i.test(f.filename)) continue;
    for (const m of f.source.matchAll(re)) {
      out.set((m[2] ?? m[1]!).toLowerCase(), m[1]!.toLowerCase());
      out.set(m[1]!.toLowerCase(), m[1]!.toLowerCase());
    }
  }
  return out;
}

const READ_ENTITIES =
  /^READ\s+ENTITIES\s+OF\s+(\w+)\b.*?\bENTITY\s+(\w+)\b.*?\bRESULT\s+(?:DATA\(\s*(\w+)\s*\)|(\w+))/i;
const COMPARE = /^(?:(\w+)~)?(\w+)\s*(=|EQ|<>|NE|<|LT|>|GT|<=|LE|>=|GE)\s*@?(\w+)-(\w+)$/i;

export function checkForAllEntriesTypes(
  reg: abaplint.IRegistry,
  files: readonly { filename: string; source: string }[],
): FaeFinding[] {
  if (!files.some((f) => /FOR\s+ALL\s+ENTRIES/i.test(f.source))) return [];
  const aliases = bdefAliases(files);
  const findings: FaeFinding[] = [];
  for (const obj of reg.getObjects()) {
    if (!(obj instanceof abaplint.ABAPObject)) continue;
    const abapFiles = obj.getABAPFiles();
    if (!abapFiles.some((f) => /FOR\s+ALL\s+ENTRIES/i.test(f.getRaw()))) continue;
    let spaghetti: abaplint.ISpaghettiScope | undefined;
    try {
      spaghetti = new abaplint.SyntaxLogic(reg, obj).run().spaghetti;
    } catch {
      spaghetti = undefined;
    }
    for (const file of abapFiles) {
      const rapRows = new Map<string, T>(); // itab → row type, from READ ENTITIES … RESULT
      for (const st of file.getStatements()) {
        const text = st.concatTokens();
        const re = READ_ENTITIES.exec(text);
        if (re) {
          const entity = aliases.get(re[2]!.toLowerCase()) ?? (re[2]!.toLowerCase() === re[1]!.toLowerCase() ? re[1]! : undefined);
          const row = entity === undefined ? undefined : dictType(reg, entity);
          if (row !== undefined) rapRows.set((re[3] ?? re[4]!).toLowerCase(), row);
          continue;
        }
        const fae = st.findFirstExpression(abaplint.Expressions.SQLForAllEntries);
        if (fae === undefined) continue;
        const itab = (fae.findFirstExpression(abaplint.Expressions.SQLSource)?.concatTokens() ?? "")
          .replace(/^@/, "")
          .toLowerCase();
        if (!/^\w+$/.test(itab)) continue;

        // FROM sources: alias → dictionary type; a lone source also answers to "".
        const sources = new Map<string, T | undefined>();
        const tables = st.findAllExpressions(abaplint.Expressions.SQLFromSource);
        for (const src of tables) {
          const name = src.findFirstExpression(abaplint.Expressions.DatabaseTable)?.concatTokens();
          if (name === undefined) continue;
          const as = src.findFirstExpression(abaplint.Expressions.SQLAsName)?.concatTokens();
          const t = dictType(reg, name);
          sources.set(name.toLowerCase(), t);
          if (as !== undefined) sources.set(as.toLowerCase(), t);
          if (tables.length === 1) sources.set("", t);
        }

        let row: T | undefined;
        try {
          const scope = spaghetti?.lookupPosition(st.getStart(), file.getFilename());
          row = rowOf(scope?.findVariable(itab)?.getType());
        } catch {
          row = undefined;
        }
        row ??= rapRows.get(itab);
        if (row === undefined) continue;

        for (const cmp of st.findAllExpressions(abaplint.Expressions.SQLCompare)) {
          const m = COMPARE.exec(cmp.concatTokens().replace(/\s*~\s*/g, "~").replace(/\s*-\s*/g, "-"));
          if (!m || m[4]!.toLowerCase() !== itab) continue;
          const colType = component(sources.get((m[1] ?? "").toLowerCase()), m[2]!);
          const compType = component(row, m[5]!);
          const a = signature(colType);
          const b = signature(compType);
          if (a === undefined || b === undefined || a === b) continue;
          const start = cmp.getFirstToken().getStart();
          findings.push({
            file: file.getFilename(),
            line: start.getRow(),
            column: start.getCol(),
            message:
              `FOR ALL ENTRIES: column ${m[2]} is ${a} but ${itab}-${m[5]} is ${b}; ABAP requires the same ` +
              "type and length, so activation fails. Compare via a range table or a correctly typed helper table.",
          });
        }
      }
    }
  }
  return findings;
}
