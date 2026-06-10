/**
 * Released-API lookup against SAP's published ABAP Cloudification list.
 *
 * The data shipped at src/data/released-apis.json is a compact transform of
 * SAP's official, Apache-2.0 object release list (SAP/abap-atc-cr-cv-s4hc),
 * built offline by scripts/build-released-api-index.mjs. It is a PACKAGE-BUNDLED
 * asset (like abaplint's own bundled rule metadata): importing it touches no
 * network and no user filesystem at runtime, so it does not violate the
 * server's "text in, JSON out, offline" contract.
 *
 * SAP's list uses three states:
 *   - "released"        — a released API, safe to consume in ABAP Cloud.
 *   - "deprecated"      — was released, now on the way out; move to a successor.
 *   - "notToBeReleased" — will not be released as a public API (classic DDIC
 *                         tables, internal objects); direct use is a cloud
 *                         blocker. We surface these (and names absent from the
 *                         list entirely) as state "not-released".
 */
import index from "../data/released-apis.json" with { type: "json" };
import successorData from "../data/table-successors.json" with { type: "json" };

/** Raw entry tuple in the bundled index: [objectType, state, applicationComponent]. */
type RawEntry = [string, string, string];

interface ReleasedIndex {
  snapshotDate: string;
  source: string;
  sourceFile: string;
  formatVersion: string | null;
  recordCount: number;
  objects: Record<string, RawEntry[]>;
}

interface SuccessorData {
  snapshotDate: string;
  source: string;
  successors: Record<string, string>;
}

const data = index as unknown as ReleasedIndex;
const successors = successorData as unknown as SuccessorData;

/** Snapshot metadata for the bundled released-API list. */
export const RELEASED_API_SNAPSHOT = {
  snapshotDate: data.snapshotDate,
  source: data.source,
  formatVersion: data.formatVersion,
  recordCount: data.recordCount,
} as const;

export type ReleasedState = "released" | "deprecated" | "not-released";

export interface ReleasedLookup {
  name: string;
  /** The object type recorded by SAP (TABL, CDS_STOB, FUNC, CLAS, …), or the queried type when no record matched. */
  objectType: string | undefined;
  state: ReleasedState;
  applicationComponent?: string | undefined;
  /**
   * true when the name was found in SAP's snapshot (under the requested type,
   * if one was given). false means absent — "not released as of the snapshot"
   * by omission, which is weaker evidence than an explicit notToBeReleased
   * record and must not be reported as a violation on its own.
   */
  recorded: boolean;
}

/** Map SAP's raw state to our three-value state. */
function toState(rawState: string): ReleasedState {
  if (rawState === "released") return "released";
  if (rawState === "deprecated") return "deprecated";
  // "notToBeReleased" — present in the list but never a public API.
  return "not-released";
}

/**
 * Look up an object in the bundled released-API list. Case-insensitive.
 *
 * `not-released` means "not a released API as of the snapshot": either the name
 * is absent from SAP's list, or it is present with state `notToBeReleased`
 * (typical for classic DDIC tables). A `released`/`deprecated` result is taken
 * verbatim from SAP's published data.
 *
 * When `objectType` is given the lookup is strict: only a record of exactly
 * that type answers the query — a same-named record under a different type is
 * a miss (`recorded: false`), never a substitute (a released class must not
 * make a non-released table look released). Untyped lookups use the first
 * recorded entry, preferring a `released` or `deprecated` record over a
 * `notToBeReleased` one so a genuinely released API is never masked by a
 * same-named internal object.
 */
export function lookupReleased(objectName: string, objectType?: string): ReleasedLookup {
  const key = objectName.trim().toUpperCase();
  const entries = data.objects[key];
  const wantedType = objectType?.trim().toUpperCase();
  if (entries === undefined || entries.length === 0) {
    return { name: objectName, objectType: wantedType, state: "not-released", recorded: false };
  }

  let chosen: RawEntry | undefined;
  if (wantedType !== undefined) {
    chosen = entries.find((e) => e[0].toUpperCase() === wantedType);
    if (chosen === undefined) {
      // Typed query, no record of that type: a miss, not a cross-type answer.
      return { name: objectName, objectType: wantedType, state: "not-released", recorded: false };
    }
  } else {
    // Prefer a released/deprecated record over notToBeReleased when ambiguous.
    chosen =
      entries.find((e) => e[1] === "released" || e[1] === "deprecated") ?? entries[0];
  }
  if (chosen === undefined) {
    return { name: objectName, objectType: wantedType, state: "not-released", recorded: false };
  }

  return {
    name: objectName,
    objectType: chosen[0],
    state: toState(chosen[1]),
    applicationComponent: chosen[2],
    recorded: true,
  };
}

/**
 * Suggest the canonical released CDS view-entity successor for a classic DB
 * table, from the curated table-successors map. Case-insensitive. Returns
 * undefined when no curated successor is known (the caller should fall back to
 * the target system's released-API list).
 */
export function suggestSuccessor(tableName: string): string | undefined {
  return successors.successors[tableName.trim().toUpperCase()];
}
