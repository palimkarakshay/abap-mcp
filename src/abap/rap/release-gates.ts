/**
 * Construct → minimum-ABAP-Cloud-release gate — spec §3.5, rule `RAP900`.
 *
 * Data: `src/data/rap/bdl-release-gates.json`, transcribed from
 * `bdl-grammar-notes.md` §2 (itself transcribed directly from SAP's
 * `RAP BDL - Feature Tables` help page — 139 rows, release numbers and one
 * shared `sourceUrl` only, no SAP prose, matching the §2/DESIGN §17
 * licensing line). `minRelease`/`btp` are the SAP BTP ABAP environment
 * column value; `s4hcPublic` is the S/4HANA Cloud Public Edition column
 * value (the two columns `bdl-grammar-notes.md` §2's closing note names as
 * "what the release-gate checker should key off in practice" — the
 * quarterly-cloud and on-premise columns are not bundled). A handful of
 * table cells describe more than one variant in one row (e.g. "unmanaged
 * 1808 / managed 1908"); this transcription keeps the FIRST number in the
 * cell, which is the more conservative (earlier) reading for those rows —
 * documented here rather than silently picking one.
 *
 * `RAP_RELEASE_GATES_CURATED_DATE` is the day `bdl-grammar-notes.md` was
 * researched — echoed in every RAP900 finding's hint, exactly like
 * `KNOWLEDGE_SCOPE_NOTE` dates the knowledge base elsewhere in this repo.
 *
 * **Detection.** Spec §2.7 describes the eventual design as "AST-driven — a
 * visitor emits construct keys during parse; no re-scanning of text" —
 * that full visitor is wired into the BDEF parse pipeline by `index.ts`
 * (spec §7 step 8, a later build step this task does not include).
 * `detectGatedConstructs()` here is a smaller, self-contained version of
 * that visitor: it reads fields `parser.ts` already exposes on
 * `BehaviorDefinition`/`EntityBehavior` (no re-parsing, no text scanning)
 * for the subset of `bdl-release-gates.json` rows that are unambiguously
 * decidable from those fields today. Constructs whose gate row exists in
 * the JSON but has no matching AST field yet (most of the extension-body
 * family, `side effects executed on global`, `ascending`/`descending
 * association`, the interface/abstract sub-dialects beyond the handful
 * below, …) are simply never detected — RAP900 stays silent on them rather
 * than guessing. See the task's final report for the exact list; extending
 * coverage needs no change here, only a new case in `detectGatedConstructs`.
 */
import type { BehaviorDefinition, EntityBehavior, Range } from "./ast.js";
import type { ParsedBdef, RapFinding } from "./context.js";
import { excerptOf, normalizeRapSource } from "./lexer.js";
import type { KnowledgeRelease } from "../knowledge.js";
import gateData from "../../data/rap/bdl-release-gates.json" with { type: "json" };

export interface ReleaseGateRow {
  /** Kebab-case key, e.g. `"with-collaborative-draft"` — what `detectGatedConstructs` emits. */
  construct: string;
  /** The table's own label for the construct, e.g. `"with collaborative draft"`. */
  label: string;
  /** The BTP ABAP environment release number — the checker's primary gate value. */
  minRelease: string;
  btp: string;
  s4hcPublic: string | null;
  sourceUrl: string;
  /** Cross-links to `src/data/knowledge/abap-release-deltas.json`, where a matching row exists. */
  knowledgeId?: string;
}

export const RELEASE_GATE_ROWS: readonly ReleaseGateRow[] = gateData as readonly ReleaseGateRow[];

const ROW_BY_CONSTRUCT = new Map(RELEASE_GATE_ROWS.map((r) => [r.construct, r]));

export function releaseGateRow(construct: string): ReleaseGateRow | undefined {
  return ROW_BY_CONSTRUCT.get(construct);
}

/** The day `bdl-grammar-notes.md` (this data's source) was researched. */
export const RAP_RELEASE_GATES_CURATED_DATE = "2026-09-10";

/* ------------------------------------------------------------- ordering
 * `abapRelease` is always one of `KnowledgeRelease` (spec §2.7's
 * `RapCheckOptions.abapRelease`) — a coarse train id, `"pre-2502"` through
 * `"2608"`. Gate rows are fine-grained BTP release numbers spanning 1805
 * through 2408. `"pre-2502"` cannot be ranked as "earliest possible" (rank
 * 0) without every pre-2502 construct — `managed`, `with draft`, nearly the
 * whole language — spuriously gating on every `--release pre-2502` call;
 * it is ranked just under 2502 instead, so RAP900 only ever fires for the
 * 2502+ constructs the release gate actually exists to catch. `KNOWLEDGE_
 * RELEASES`' own comment places `platform-2025` between the 2508 and 2511
 * cloud trains.
 */
function releaseRank(release: string): number {
  if (release === "pre-2502") return 2501;
  if (release === "platform-2025") return 2508.5;
  const n = Number.parseInt(release, 10);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}

/** True when `row` requires a release newer than `target`. */
export function gateExceeds(row: ReleaseGateRow, target: KnowledgeRelease): boolean {
  return releaseRank(row.minRelease) > releaseRank(target);
}

/* ------------------------------------------------------------ detection */

export interface DetectedConstruct {
  construct: string;
  range: Range;
}

function pushIf(out: DetectedConstruct[], construct: string, present: boolean, range: Range | undefined): void {
  if (present && range !== undefined) out.push({ construct, range });
}

/** See the file header — a decidable subset, not the full construct catalog. */
export function detectGatedConstructs(bo: BehaviorDefinition): DetectedConstruct[] {
  const out: DetectedConstruct[] = [];

  for (const decl of bo.draftDeclarations) {
    pushIf(out, decl.collaborative ? "with-collaborative-draft" : "with-draft", true, decl.range);
  }
  pushIf(out, "with-managed-instance-filter", bo.managedInstanceFilter !== undefined, bo.managedInstanceFilter);
  pushIf(out, "save-after", bo.saveAfter !== undefined, bo.saveAfter?.range);
  pushIf(out, "auxiliary-class", bo.auxiliaryClasses.length > 0, bo.auxiliaryClasses[0]?.range);
  pushIf(out, "extensible-header", bo.extensible !== undefined, bo.extensible?.range);
  pushIf(out, "strict-2", bo.strict?.level === 2, bo.strict?.range);
  pushIf(out, "strict", bo.strict !== undefined && bo.strict.level !== 2, bo.strict?.range);
  if (bo.privilegedMode !== undefined) {
    const construct =
      bo.privilegedMode.form === "disabling-base-context"
        ? "with-privileged-mode-disabling-base-context-and"
        : bo.privilegedMode.form === "disabling"
          ? "with-privileged-mode-disabling"
          : "with-privileged-mode";
    out.push({ construct, range: bo.privilegedMode.range });
  }
  if (bo.implementationType === "interface") out.push({ construct: "interface-bdef-interface", range: bo.range });
  if (bo.implementationType === "abstract") out.push({ construct: "abstract-bdef-abstract", range: bo.range });
  if (bo.implementationType === "extension") out.push({ construct: "bdef-extensions-extension", range: bo.range });

  for (const use of bo.headerUses) detectUseConstruct(use, out);

  for (const entity of bo.entities) detectEntityConstructs(entity, out);

  return out;
}

function detectUseConstruct(use: { what: string; range: Range }, out: DetectedConstruct[]): void {
  switch (use.what) {
    case "draft-as-dependent":
      out.push({ construct: "use-draft-as-dependent", range: use.range });
      return;
    case "collaborative-draft":
      out.push({ construct: "interface-bdef-interface-use-collaborative-draft", range: use.range });
      return;
    case "side-effects":
      out.push({ construct: "use-side-effects", range: use.range });
      return;
    case "etag":
      out.push({ construct: "use-etag", range: use.range });
      return;
    default:
      return;
  }
}

function detectEntityConstructs(entity: EntityBehavior, out: DetectedConstruct[]): void {
  pushIf(out, "persistent-table", entity.persistentTable !== undefined, entity.persistentTable?.range);
  pushIf(out, "draft-table", entity.draftTable !== undefined, entity.draftTable?.range);
  pushIf(
    out,
    "lock-master-unmanaged-exit",
    entity.lockMaster?.unmanaged === true,
    entity.lockMaster?.range,
  );
  if (entity.authorization?.form === "master") {
    if (entity.authorization.scopes.includes("global")) {
      out.push({ construct: "authorization-master-global", range: entity.authorization.range });
    }
    if (entity.authorization.scopes.includes("instance")) {
      out.push({ construct: "authorization-master-instance", range: entity.authorization.range });
    }
  }
  for (const characteristic of entity.characteristics) {
    if (characteristic.kind === "changedocuments") {
      const construct = characteristic.form === "master" ? "changedocuments-master" : "changedocuments-dependent";
      out.push({ construct, range: characteristic.range });
    }
    if (characteristic.kind === "use" && characteristic.use.what === "etag") {
      out.push({ construct: "use-etag", range: characteristic.range });
    }
  }
  for (const draftAction of entity.draftActions) {
    if (draftAction.name.key === "ADDITIONALSAVE") {
      out.push({ construct: "draft-action-additionalsave", range: draftAction.range });
    } else if (draftAction.name.key === "SHARE") {
      out.push({ construct: "draft-action-share", range: draftAction.range });
    } else if (draftAction.optimized && draftAction.name.key === "ACTIVATE") {
      out.push({ construct: "optimized-on-activate", range: draftAction.range });
    }
  }
  for (const action of entity.actions) {
    if (action.repeatable) out.push({ construct: "repeatable-action-function", range: action.range });
    if (action.factory) out.push({ construct: "factory-action", range: action.range });
  }
  for (const fn of entity.functions) {
    if (fn.repeatable) out.push({ construct: "repeatable-action-function", range: fn.range });
  }
  pushIf(out, "determine-action", entity.determineActions.length > 0, entity.determineActions[0]?.range);
  for (const sideEffects of entity.sideEffects) {
    out.push({ construct: "side-effects-executed-on-affects", range: sideEffects.range });
  }
}

/* ------------------------------------------------------------- reporting */

export interface CheckReleaseGatesOptions {
  abapRelease?: KnowledgeRelease | undefined;
}

/**
 * Run the release gate over one parsed BDEF. Returns `[]` unless
 * `opts.abapRelease` is set — release gating is opt-in (spec §1.1 item 4).
 * Takes a `ParsedBdef` (not raw `filename`/`lines`) to match `rules.ts`'s own
 * `runBdefRules()` calling convention — `bdef.source` is the original text,
 * lines are derived the same way `rules.ts`'s `linesOf()` does.
 */
export function checkReleaseGates(bdef: ParsedBdef, opts: CheckReleaseGatesOptions): RapFinding[] {
  const target = opts.abapRelease;
  if (target === undefined) return [];

  const bo: BehaviorDefinition = bdef.ast;
  const lines = normalizeRapSource(bdef.source).split("\n");
  const findings: RapFinding[] = [];
  for (const detected of detectGatedConstructs(bo)) {
    const row = releaseGateRow(detected.construct);
    if (row === undefined || !gateExceeds(row, target)) continue;
    findings.push({
      rule: "RAP900",
      severity: "warning",
      message: `"${row.label}" requires ABAP Cloud ${row.minRelease} or higher; the target release you passed is ${target}.`,
      file: bdef.filename,
      line: detected.range.start.line,
      column: detected.range.start.column,
      excerpt: excerptOf(lines, detected.range.start.line),
      hint: `Remove the construct, or raise --release. Bundled release data curated ${RAP_RELEASE_GATES_CURATED_DATE}; the target system's release notes are authoritative.`,
      confidence: "confirmed",
      minRelease: row.minRelease,
      docsUrl: "docs/RAP-RULES.md#rap900",
      sourceUrl: row.sourceUrl,
    });
  }
  return findings.sort((a, b) => a.line - b.line || a.column - b.column);
}
