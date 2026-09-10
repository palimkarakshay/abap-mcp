/**
 * Released-API lookup against SAP's published ABAP Cloudification lists.
 *
 * The data shipped at src/data/released-apis.{s4hc,btp,pce}.json is a
 * compact transform of SAP's official, Apache-2.0 object release lists
 * (SAP/abap-atc-cr-cv-s4hc — one file per SAP edition: SAP Cloud ERP Public
 * Edition, SAP BTP ABAP environment, SAP Cloud ERP Private Edition /
 * on-premise), built offline by scripts/build-released-api-index.mjs.
 * src/data/api-classifications.json is the companion classic-API
 * classification list (classicAPI / noAPI / internalAPI), same source repo.
 * These are PACKAGE-BUNDLED assets (like abaplint's own bundled rule
 * metadata): importing them touches no network and no user filesystem at
 * runtime, so it does not violate the server's "text in, JSON out, offline"
 * contract.
 *
 * SAP's release-state lists use these states (varies slightly per edition):
 *   - "released"              — a released API, safe to consume in ABAP Cloud.
 *   - "deprecated"             — was released, now on the way out; move to a successor.
 *   - "notToBeReleased"        — will not be released as a public API (classic
 *                                DDIC tables, internal objects); direct use is
 *                                a cloud blocker.
 *   - "notToBeReleasedStable"  — Private Edition only: as above, but SAP
 *                                commits the object won't change further.
 * All non-released, non-deprecated states surface here as "not-released"
 * (and a name absent from the edition's list entirely is also "not-released",
 * distinguished by `recorded: false`).
 *
 * Each record may carry SAP's own successors[] (state "sap") — when absent,
 * the curated src/data/table-successors.json supplies a fallback for common
 * classic tables (state "curated"); otherwise "none".
 */
import btpData from "../data/released-apis.btp.json" with { type: "json" };
import pceData from "../data/released-apis.pce.json" with { type: "json" };
import s4hcData from "../data/released-apis.s4hc.json" with { type: "json" };
import classificationData from "../data/api-classifications.json" with { type: "json" };
import successorData from "../data/table-successors.json" with { type: "json" };

/**
 * Raw entry tuple in a bundled index: [objectType, state, applicationComponent]
 * or, when the record carries SAP successors, a 4th element indexing into
 * that file's `successorGroups`.
 */
type RawEntry = [string, string, string] | [string, string, string, number];

/** One successor object as decoded from a file's successorNames string table. */
interface SuccessorGroupEntry {
  objectType: string;
  name: string;
}

interface EditionIndex {
  snapshotDate: string;
  source: string;
  sourceFile: string;
  formatVersion: string | null;
  edition: string;
  recordCount: number;
  /** Deduplicated successor object names referenced by successorGroups. */
  successorNames: string[];
  /** Each group is the decoded-shape [objectType, nameIndex][] for one record's successors[]. */
  successorGroups: [string, number][][];
  objects: Record<string, RawEntry[]>;
}

interface ClassificationIndex {
  snapshotDate: string;
  source: string;
  sourceFile: string;
  formatVersion: string | null;
  recordCount: number;
  successorNames: string[];
  successorGroups: [string, number][][];
  objects: Record<string, RawEntry[]>;
}

interface SuccessorData {
  snapshotDate: string;
  source: string;
  successors: Record<string, string>;
}

/** The three SAP editions the bundled Cloudification data covers. */
export type ReleasedEdition = "s4hc" | "btp" | "pce";
export const RELEASED_EDITIONS: readonly ReleasedEdition[] = ["s4hc", "btp", "pce"];
export const DEFAULT_EDITION: ReleasedEdition = "s4hc";

const EDITION_DATA: Record<ReleasedEdition, EditionIndex> = {
  s4hc: s4hcData as unknown as EditionIndex,
  btp: btpData as unknown as EditionIndex,
  pce: pceData as unknown as EditionIndex,
};
const classifications = classificationData as unknown as ClassificationIndex;
const tableSuccessors = successorData as unknown as SuccessorData;

function indexFor(edition: ReleasedEdition): EditionIndex {
  return EDITION_DATA[edition];
}

/** Snapshot metadata for one edition's bundled released-API list. */
export interface ReleasedApiSnapshot {
  snapshotDate: string;
  source: string;
  formatVersion: string | null;
  recordCount: number;
  edition: ReleasedEdition;
}

/** Snapshot metadata for all three bundled editions. */
export const RELEASED_API_SNAPSHOTS: Record<ReleasedEdition, ReleasedApiSnapshot> = {
  s4hc: {
    snapshotDate: EDITION_DATA.s4hc.snapshotDate,
    source: EDITION_DATA.s4hc.source,
    formatVersion: EDITION_DATA.s4hc.formatVersion,
    recordCount: EDITION_DATA.s4hc.recordCount,
    edition: "s4hc",
  },
  btp: {
    snapshotDate: EDITION_DATA.btp.snapshotDate,
    source: EDITION_DATA.btp.source,
    formatVersion: EDITION_DATA.btp.formatVersion,
    recordCount: EDITION_DATA.btp.recordCount,
    edition: "btp",
  },
  pce: {
    snapshotDate: EDITION_DATA.pce.snapshotDate,
    source: EDITION_DATA.pce.source,
    formatVersion: EDITION_DATA.pce.formatVersion,
    recordCount: EDITION_DATA.pce.recordCount,
    edition: "pce",
  },
};

/**
 * Snapshot metadata for the default edition (s4hc / SAP Cloud ERP Public
 * Edition) — kept for callers that predate multi-edition support.
 */
export const RELEASED_API_SNAPSHOT = RELEASED_API_SNAPSHOTS[DEFAULT_EDITION];

export type ReleasedState = "released" | "deprecated" | "not-released";

/** Where a successor hint for a lookup came from. */
export type SuccessorSource = "sap" | "curated" | "none";

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
  /** SAP's own successor object(s) for this record, when the snapshot carries any. */
  successors?: SuccessorGroupEntry[];
  /**
   * Cardinality of `successors`, mirroring SAP's own successorClassification
   * field: "oneObject" when there is exactly one, "multipleObjects" when
   * there are several. Absent when there are none (including SAP's own
   * "concept" classification, which names a migration concept instead of a
   * concrete successor object and isn't captured here).
   */
  successorClassification?: "oneObject" | "multipleObjects";
  /** Where a successor hint (if any) came from: SAP's own data, the curated fallback map, or none available. */
  successorSource: SuccessorSource;
  /** classicAPI / noAPI / internalAPI classification from SAP's objectClassifications_SAP.json, when recorded there. */
  classification?: "classicAPI" | "noAPI" | "internalAPI";
  /** Which SAP edition this lookup queried. */
  edition: ReleasedEdition;
  /** Snapshot date of the queried edition's bundled data. */
  snapshotDate: string;
}

/** Map SAP's raw state to our three-value state. */
function toState(rawState: string): ReleasedState {
  if (rawState === "released") return "released";
  if (rawState === "deprecated") return "deprecated";
  // "notToBeReleased" / "notToBeReleasedStable" (PCE only) — present in the
  // list but never a public API.
  return "not-released";
}

/** Decode a raw entry's optional successor-group index into SuccessorGroupEntry[]. */
function decodeSuccessors(
  entry: RawEntry,
  file: { successorNames: string[]; successorGroups: [string, number][][] },
): SuccessorGroupEntry[] | undefined {
  const idx = entry[3];
  if (idx === undefined) return undefined;
  const group = file.successorGroups[idx];
  if (group === undefined) return undefined;
  return group.map(([objectType, nameIdx]) => ({ objectType, name: file.successorNames[nameIdx]! }));
}

function classifySuccessors(successors: SuccessorGroupEntry[] | undefined): "oneObject" | "multipleObjects" | undefined {
  if (successors === undefined || successors.length === 0) return undefined;
  return successors.length === 1 ? "oneObject" : "multipleObjects";
}

/** Look up an object's classicAPI/noAPI/internalAPI classification, same disambiguation rules as lookupReleased. */
function lookupClassification(objectName: string, objectType?: string): "classicAPI" | "noAPI" | "internalAPI" | undefined {
  const key = objectName.trim().toUpperCase();
  const entries = classifications.objects[key];
  if (entries === undefined || entries.length === 0) return undefined;
  const wantedType = objectType?.trim().toUpperCase();
  const chosen = wantedType !== undefined ? entries.find((e) => e[0].toUpperCase() === wantedType) : entries[0];
  return chosen?.[1] as "classicAPI" | "noAPI" | "internalAPI" | undefined;
}

/**
 * Look up an object in one edition's bundled released-API list.
 * Case-insensitive; defaults to the "s4hc" (SAP Cloud ERP Public Edition) list.
 *
 * `not-released` means "not a released API as of the snapshot": either the name
 * is absent from SAP's list for that edition, or it is present with a
 * not-to-be-released state (typical for classic DDIC tables). A
 * `released`/`deprecated` result is taken verbatim from SAP's published data.
 *
 * When `objectType` is given the lookup is strict: only a record of exactly
 * that type answers the query — a same-named record under a different type is
 * a miss (`recorded: false`), never a substitute (a released class must not
 * make a non-released table look released). Untyped lookups use the first
 * recorded entry, preferring a `released` or `deprecated` record over a
 * `notToBeReleased`/`notToBeReleasedStable` one so a genuinely released API is
 * never masked by a same-named internal object.
 *
 * The result also carries SAP's own successors (when the snapshot has any),
 * a classicAPI/noAPI/internalAPI classification (when SAP's classification
 * list has one), and the edition/snapshot date the answer reflects.
 */
export function lookupReleased(
  objectName: string,
  objectType?: string,
  edition: ReleasedEdition = DEFAULT_EDITION,
): ReleasedLookup {
  const file = indexFor(edition);
  const snapshot = RELEASED_API_SNAPSHOTS[edition];
  const key = objectName.trim().toUpperCase();
  const entries = file.objects[key];
  const wantedType = objectType?.trim().toUpperCase();
  const classification = lookupClassification(objectName, objectType);
  const miss = (): ReleasedLookup => {
    const curated = suggestSuccessor(objectName);
    return {
      name: objectName,
      objectType: wantedType,
      state: "not-released",
      recorded: false,
      successorSource: curated !== undefined ? "curated" : "none",
      ...(classification !== undefined ? { classification } : {}),
      edition,
      snapshotDate: snapshot.snapshotDate,
    };
  };

  if (entries === undefined || entries.length === 0) return miss();

  let chosen: RawEntry | undefined;
  if (wantedType !== undefined) {
    chosen = entries.find((e) => e[0].toUpperCase() === wantedType);
    if (chosen === undefined) return miss(); // typed query, no record of that type: a miss, not a cross-type answer.
  } else {
    // Prefer a released/deprecated record over notToBeReleased(Stable) when ambiguous.
    chosen = entries.find((e) => e[1] === "released" || e[1] === "deprecated") ?? entries[0];
  }
  if (chosen === undefined) return miss();

  const successors = decodeSuccessors(chosen, file);
  const successorClassification = classifySuccessors(successors);
  const curated = suggestSuccessor(objectName);
  // The curated map (33 hand-checked, nicely-cased common tables) wins when
  // it has an entry — SAP's own objectKey casing is all-caps ("I_PRODUCT"),
  // so curated stays the display-friendly default; SAP's data (still exposed
  // in full via `successors`) is the fallback for everything curated doesn't
  // cover.
  const successorSource: SuccessorSource =
    curated !== undefined ? "curated" : successors !== undefined && successors.length > 0 ? "sap" : "none";

  return {
    name: objectName,
    objectType: chosen[0],
    state: toState(chosen[1]),
    applicationComponent: chosen[2],
    recorded: true,
    ...(successors !== undefined ? { successors } : {}),
    ...(successorClassification !== undefined ? { successorClassification } : {}),
    successorSource,
    ...(classification !== undefined ? { classification } : {}),
    edition,
    snapshotDate: snapshot.snapshotDate,
  };
}

/**
 * Suggest the canonical released CDS view-entity successor for a classic DB
 * table, from the curated table-successors map. Case-insensitive. Returns
 * undefined when no curated successor is known (the caller should fall back to
 * the target system's released-API list).
 */
export function suggestSuccessor(tableName: string): string | undefined {
  return tableSuccessors.successors[tableName.trim().toUpperCase()];
}
