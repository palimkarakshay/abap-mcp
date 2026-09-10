/**
 * ABAP Cloud / Clean Core readiness — the dual-run diff.
 *
 * One abaplint pass at `version: Cloud` and one at a classic baseline
 * (default v758). A finding present at Cloud but absent at the baseline is a
 * *cloud blocker* (the statement is fine classic ABAP that ABAP Cloud no
 * longer allows). A finding present at the baseline is just *broken code* —
 * reporting it as a migration item would overstate the migration.
 *
 * Released-API check: separately from the parser-level diff, the source is
 * walked for object references (DB tables, function modules) which are looked
 * up against the bundled SAP Cloudification snapshot. These land in their own
 * `releasedApiFindings` field — they are NOT folded into cloudBlockerCount or
 * score, because those are objective, parser-level numbers and the snapshot is
 * only as current as its date.
 */
import atcVocabularyData from "../data/atc-vocabulary.json" with { type: "json" };
import recipeData from "../data/rewrite-recipes.json" with { type: "json" };

import type { AbapSource, AbapVersion, Finding } from "./engine.js";
import { extractObjectReferences, runAbaplint } from "./engine.js";
import type { ReleasedEdition, SuccessorSource } from "./released.js";
import { DEFAULT_EDITION, lookupReleased, RELEASED_API_SNAPSHOTS, suggestSuccessor } from "./released.js";

/** One ATC check or check-variant fact, as curated in src/data/atc-vocabulary.json. */
interface AtcCheck {
  name: string;
  edition: string;
  note: string;
}
interface AtcVariant {
  name: string;
  scope: string;
  status: "current" | "deprecated";
  successor?: string;
}
interface AtcVocabulary {
  curatedDate: string;
  sources: string[];
  checks: AtcCheck[];
  variants: AtcVariant[];
  cleanCoreLevels: { A: string; B: string; C: string; D: string };
  releaseContracts: { C0: string; C1: string; C2: string; C3: string };
}

const ATC_VOCAB = atcVocabularyData as unknown as AtcVocabulary;

/** The real ATC checks/variants for released-API governance, exposed on readiness reports (see F04). */
export interface CleanCoreVocabulary {
  checks: AtcCheck[];
  variants: AtcVariant[];
}

const CLEAN_CORE_VOCABULARY: CleanCoreVocabulary = { checks: ATC_VOCAB.checks, variants: ATC_VOCAB.variants };

/** Curated canonical rewrite for one blocker category — illustrative, not drop-in. */
export interface RewriteRecipe {
  pattern: string;
  before: string;
  after: string;
  notes: string;
}

const RECIPES = (
  recipeData as unknown as { recipes: Record<string, RewriteRecipe> }
).recipes;

/** The curated rewrite recipe for a readiness category, if one exists. */
export function rewriteRecipeFor(category: string): RewriteRecipe | undefined {
  return RECIPES[category];
}

export interface ReadinessCategory {
  category: string;
  label: string;
  count: number;
  findings: Finding[];
  /** Curated canonical Cloud rewrite for this category (bundled, hand-curated). */
  rewrite?: RewriteRecipe;
}

/**
 * A released-API observation about a referenced object. Kept SEPARATE from the
 * parser-level blocker counts/score: it reflects the bundled SAP snapshot
 * (dated), not abaplint's objective parse, and a system's ATC is authoritative.
 */
export interface ReleasedApiFinding {
  /** Referenced object name (upper-cased). */
  object: string;
  /** SAP object type: "TABL" (DB table) or "FUNC" (function module). */
  objectType: string;
  /** Released-API state from the bundled snapshot. */
  state: "deprecated" | "not-released";
  /** Curated released CDS successor for a classic table, when known. */
  successor?: string;
  /** Where the successor (if any) came from: SAP's own snapshot, the curated fallback map, or none available. */
  successorSource: SuccessorSource;
  /** SAP edition this finding's released-API state was looked up against. */
  edition: ReleasedEdition;
  file: string;
  line: number;
  /** Human-facing explanation of why this was flagged. */
  note: string;
}

/** Letter grade for tech-debt assessments — a banding of blocker density. */
export type ReadinessGrade = "A" | "B" | "C" | "D";

/**
 * Band the objective blocker count into an A–D Clean Core tech-debt grade,
 * normalized by file count so a single object and a whole package grade on
 * the same scale: A = no blockers, B = ≤ 0.5 blockers/file, C = ≤ 2
 * blockers/file, D = worse. Same number as the score, different lens —
 * nothing subjective is mixed in.
 */
export function gradeReadiness(cloudBlockerCount: number, fileCount: number): ReadinessGrade {
  if (cloudBlockerCount === 0) return "A";
  const perFile = cloudBlockerCount / Math.max(1, fileCount);
  if (perFile <= 0.5) return "B";
  if (perFile <= 2) return "C";
  return "D";
}

export interface ReadinessReport {
  verdict: "ready" | "minor-rework" | "moderate-rework" | "significant-rework";
  score: number;
  /** A–D banding of blocker density (blockers / files) — see gradeReadiness. */
  grade: ReadinessGrade;
  /**
   * What `grade` means, spelled out so it is never confused with SAP's own
   * Clean Core Level A–D (see cleanCoreVocabulary.cleanCoreLevels): always
   * "blocker-density" — a banding of blockers per file, nothing else.
   */
  gradeMeaning: "blocker-density";
  cloudBlockerCount: number;
  /** Files analyzed — the denominator of the grade's density banding. */
  fileCount: number;
  categories: ReadinessCategory[];
  /** Findings that fail even at the classic baseline — fix these first; they are not migration items. */
  brokenAtBaseline: Finding[];
  /**
   * Released-API observations from the bundled SAP Cloudification snapshot —
   * deprecated API usage and direct access to non-released (classic) tables,
   * with successor hints. Separate from cloudBlockerCount/score by design.
   */
  releasedApiFindings: ReleasedApiFinding[];
  /** Date of the bundled released-API snapshot the releasedApiFindings reflect. */
  releasedApiSnapshotDate: string;
  /** SAP edition the released-API findings were checked against. */
  edition: ReleasedEdition;
  baselineVersion: AbapVersion;
  scopeNote: string;
  /** The real ATC checks/variants that govern released-API state — see F04 / atc-vocabulary.json. */
  cleanCoreVocabulary: CleanCoreVocabulary;
}

function scopeNoteFor(edition: ReleasedEdition): string {
  const publicCheck = ATC_VOCAB.checks.find((c) => c.edition.includes("Public"));
  const privateCheck = ATC_VOCAB.checks.find((c) => c.edition.includes("Private"));
  const currentVariants = ATC_VOCAB.variants
    .filter((v) => v.status === "current" && v.name.startsWith("ABAP_CLEAN_CORE"))
    .map((v) => v.name)
    .join(" / ");
  return (
    "Static parser-level analysis (abaplint) PLUS a released-API cross-check against SAP's bundled Cloudification " +
    `snapshot for edition "${edition}" (dated ${RELEASED_API_SNAPSHOTS[edition].snapshotDate}). It detects statements ` +
    "ABAP Cloud removes (the objective cloud-blocker count and score) and, separately, flags deprecated-API usage " +
    "and direct access to non-released classic tables (releasedApiFindings — informational, NOT counted in the " +
    "score). The bundled list is only as current as its snapshot date, and covers tables and function modules " +
    "referenced here, not every API; a target system's own released-API ATC check " +
    `("${publicCheck?.name}" for ${publicCheck?.edition} / "${privateCheck?.name}" for ${privateCheck?.edition}, via ` +
    `variants such as ${currentVariants}) remains authoritative. ` +
    "Treat 'ready' as 'no language-level blockers', not as a full Clean Core certification. " +
    "The A–D grade above is blocker density (gradeMeaning), NOT SAP's own Clean Core Level A–D."
  );
}

/** Scope note for the default edition (s4hc) — kept for callers that predate multi-edition support. */
export const SCOPE_NOTE = scopeNoteFor(DEFAULT_EDITION);

/** Map an offending line to a human category by its leading keyword(s). */
function categorize(excerpt: string): { category: string; label: string } {
  const head = excerpt.toUpperCase();
  if (/^(WRITE|ULINE|SKIP|FORMAT|NEW-PAGE|TOP-OF-PAGE|END-OF-PAGE|PRINT-CONTROL)\b/.test(head))
    return { category: "list-output", label: "Classic list output (WRITE…) — no UI in ABAP Cloud; expose data via RAP/OData instead" };
  if (/^(CALL SCREEN|SET SCREEN|LEAVE SCREEN|MODULE|LOOP AT SCREEN|SET PF-STATUS|SET TITLEBAR|CALL DIALOG|SUPPRESS DIALOG)\b/.test(head))
    return { category: "dynpro", label: "Dynpro / classic UI — rebuild the UI as a Fiori app on a RAP service" };
  if (/^(SELECT-OPTIONS|PARAMETERS|SELECTION-SCREEN|AT SELECTION-SCREEN|INITIALIZATION|START-OF-SELECTION|END-OF-SELECTION|AT LINE-SELECTION|AT USER-COMMAND)\b/.test(head))
    return { category: "report-events", label: "Report / selection-screen events — wrap the logic in a class; use RAP or an application job" };
  if (/^(REPORT|PROGRAM|SUBMIT)\b/.test(head))
    return { category: "report-program", label: "Executable program statements — ABAP Cloud has classes only; SUBMIT has no released equivalent" };
  if (/^(EXEC SQL|ENDEXEC)\b/.test(head))
    return { category: "native-sql", label: "Native SQL — use ABAP SQL (or AMDP where released)" };
  if (/^(CALL FUNCTION .*DESTINATION|CALL FUNCTION .*STARTING NEW TASK|RECEIVE RESULTS)\b/.test(head))
    return { category: "rfc", label: "Direct RFC patterns — use released connectivity (bgPF, HTTP, released RFC wrappers)" };
  if (/^(FORM|PERFORM|ENDFORM)\b/.test(head))
    return { category: "subroutines", label: "FORM subroutines — obsolete; move logic into class methods" };
  if (/^(CALL TRANSACTION|LEAVE TO TRANSACTION|SET PARAMETER|GET PARAMETER|AUTHORITY-CHECK)\b/.test(head))
    return { category: "transaction-glue", label: "Transaction / SPA-GPA / classic auth glue — re-model on released APIs" };
  return { category: "other", label: "Other statements ABAP Cloud does not allow" };
}

export function checkCloudReadiness(
  files: AbapSource[],
  baselineVersion: AbapVersion = "v758",
  edition: ReleasedEdition = DEFAULT_EDITION,
): ReadinessReport {
  const cloud = runAbaplint(files, { version: "Cloud", preset: "syntax-only" });
  const baseline = runAbaplint(files, { version: baselineVersion, preset: "syntax-only" });

  const baselineKeys = new Set(baseline.findings.map((f) => `${f.file}:${f.line}:${f.rule}`));
  const blockers: Finding[] = [];
  for (const f of cloud.findings) {
    if (!baselineKeys.has(`${f.file}:${f.line}:${f.rule}`)) blockers.push(f);
  }

  const byCategory = new Map<string, ReadinessCategory>();
  for (const f of blockers) {
    const { category, label } = categorize(f.excerpt);
    const recipe = rewriteRecipeFor(category);
    const entry =
      byCategory.get(category) ??
      ({ category, label, count: 0, findings: [], ...(recipe !== undefined ? { rewrite: recipe } : {}) } as ReadinessCategory);
    entry.count += 1;
    entry.findings.push(f);
    byCategory.set(category, entry);
  }

  const n = blockers.length;
  // Transparent, documented formula — a conversation starter, not an oracle.
  const score = Math.max(0, 100 - 5 * n);
  const verdict =
    n === 0 ? "ready" : n <= 5 ? "minor-rework" : n <= 20 ? "moderate-rework" : "significant-rework";

  return {
    verdict,
    score,
    grade: gradeReadiness(n, files.length),
    gradeMeaning: "blocker-density",
    cloudBlockerCount: n,
    fileCount: files.length,
    categories: [...byCategory.values()].sort((a, b) => b.count - a.count),
    brokenAtBaseline: baseline.findings,
    releasedApiFindings: computeReleasedApiFindings(files, baselineVersion, edition),
    releasedApiSnapshotDate: RELEASED_API_SNAPSHOTS[edition].snapshotDate,
    edition,
    baselineVersion,
    scopeNote: scopeNoteFor(edition),
    cleanCoreVocabulary: CLEAN_CORE_VOCABULARY,
  };
}

/**
 * Cross-check statically-extracted object references against the bundled SAP
 * Cloudification snapshot. Flags two cases:
 *   - `deprecated` — the referenced object is a deprecated released API.
 *   - `not-released` — the reference is explicitly recorded as notToBeReleased
 *     in SAP's list: direct access to a classic/internal table (the typical
 *     "SELECT … FROM mara" case, with a curated CDS successor hint when one is
 *     known) or a CALL FUNCTION to an internal-only function module.
 * Released objects and references the snapshot does not recognise are silent —
 * absence from the list (every customer Z/Y-object, for a start) is "not known
 * to be a problem", not proof either way.
 */
function computeReleasedApiFindings(
  files: AbapSource[],
  baselineVersion: AbapVersion,
  edition: ReleasedEdition,
): ReleasedApiFinding[] {
  const out: ReleasedApiFinding[] = [];
  for (const ref of extractObjectReferences(files, baselineVersion)) {
    let hit = lookupReleased(ref.name, ref.objectType, edition);
    // An ABAP-SQL FROM clause names either a DDIC table or a CDS entity, but
    // the extractor labels both TABL — fall back to the CDS record so a
    // deprecated CDS view in a SELECT is still caught.
    if (!hit.recorded && ref.objectType === "TABL") {
      hit = lookupReleased(ref.name, "CDS_STOB", edition);
    }
    if (hit.state === "released") continue;

    // Curated table-successors.json wins when it has an entry (nicely-cased,
    // hand-checked); SAP's own successors[] is the fallback — hit.successorSource
    // says which one answered (mirrors lookupReleased's own priority).
    const successor = hit.successorSource === "curated" ? suggestSuccessor(ref.name) : hit.successors?.[0]?.name;

    if (hit.state === "deprecated") {
      out.push({
        object: ref.name,
        objectType: ref.objectType,
        state: "deprecated",
        ...(successor !== undefined ? { successor } : {}),
        successorSource: hit.successorSource,
        edition,
        file: ref.file,
        line: ref.line,
        note:
          ref.kind === "db-access"
            ? `${ref.name} is a deprecated released object as of the snapshot — migrate to its current successor before going to ABAP Cloud.`
            : `Function module ${ref.name} is deprecated as of the snapshot — replace it with the released successor API.`,
      });
      continue;
    }

    // not-released. Only flag names SAP's snapshot explicitly records as
    // notToBeReleased — a name merely absent from the list (every customer
    // Z/Y-object, for a start) is silent: absence is "not known to be a
    // problem", not evidence of one.
    if (!hit.recorded) continue;

    if (ref.objectType === "FUNC") {
      out.push({
        object: ref.name,
        objectType: ref.objectType,
        state: "not-released",
        ...(successor !== undefined ? { successor } : {}),
        successorSource: hit.successorSource,
        edition,
        file: ref.file,
        line: ref.line,
        note: `Function module ${ref.name} is recorded as not-to-be-released in SAP's Cloudification list — it will not become a public API in ABAP Cloud; use a released successor API instead.`,
      });
      continue;
    }

    if (ref.objectType === "TABL" && hit.objectType === "TABL") {
      out.push({
        object: ref.name,
        objectType: ref.objectType,
        state: "not-released",
        ...(successor !== undefined ? { successor } : {}),
        successorSource: hit.successorSource,
        edition,
        file: ref.file,
        line: ref.line,
        note:
          `${ref.name} is not a released API — direct access to this classic table is not allowed in ABAP Cloud.` +
          (successor !== undefined ? ` Use the released CDS view ${successor} instead.` : " Use a released CDS view instead."),
      });
    }
  }
  return out;
}
