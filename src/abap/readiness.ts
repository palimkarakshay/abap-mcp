/**
 * ABAP Cloud / Clean Core readiness — the dual-run diff.
 *
 * One abaplint pass at `version: Cloud` and one at a classic baseline
 * (default v758). A finding present at Cloud but absent at the baseline is a
 * *cloud blocker* (the statement is fine classic ABAP that ABAP Cloud no
 * longer allows). A finding present at the baseline is just *broken code* —
 * reporting it as a migration item would overstate the migration.
 *
 * Honest scope: this is the static, parser-level slice of readiness. The
 * other half — "does this call only RELEASED SAP APIs?" — requires the
 * system's released-API list (ATC check SAP_CP_READINESS) and is out of
 * scope for an offline tool. The report says so.
 */
import type { AbapSource, AbapVersion, Finding } from "./engine.js";
import { runAbaplint } from "./engine.js";

export interface ReadinessCategory {
  category: string;
  label: string;
  count: number;
  findings: Finding[];
}

export interface ReadinessReport {
  verdict: "ready" | "minor-rework" | "moderate-rework" | "significant-rework";
  score: number;
  cloudBlockerCount: number;
  categories: ReadinessCategory[];
  /** Findings that fail even at the classic baseline — fix these first; they are not migration items. */
  brokenAtBaseline: Finding[];
  baselineVersion: AbapVersion;
  scopeNote: string;
}

export const SCOPE_NOTE =
  "Static parser-level analysis (abaplint). It detects statements and syntax that ABAP Cloud removes, " +
  "but NOT usage of unreleased SAP APIs — that requires a system's released-API list (ATC / SAP_CP_READINESS). " +
  "Treat 'ready' as 'no language-level blockers', not as a full Clean Core certification.";

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
    const entry = byCategory.get(category) ?? { category, label, count: 0, findings: [] };
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
    cloudBlockerCount: n,
    categories: [...byCategory.values()].sort((a, b) => b.count - a.count),
    brokenAtBaseline: baseline.findings,
    baselineVersion,
    scopeNote: SCOPE_NOTE,
  };
}
