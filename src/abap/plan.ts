/**
 * Migration planning — the task-manager layer over readiness.
 *
 * A deterministic re-arrangement of a ReadinessReport into a phased,
 * consulting-ordered backlog: repair broken code first, then mechanical quick
 * wins, then core rework, then UI re-architecture, with released-API work kept
 * in its own snapshot-dated phase (it is informational, exactly as in the
 * readiness report — never mixed into the objective blocker phases).
 *
 * Nothing here is a new judgment: every number is the readiness report's own,
 * regrouped per object and category with an effort band and a remediation
 * recipe. The agent narrates and executes; this module only arranges.
 */
import type { Finding } from "./engine.js";
import type { ReadinessReport } from "./readiness.js";

export type PlanEffort = "S" | "M" | "L";

const EFFORT_RANK: Record<PlanEffort, number> = { S: 1, M: 2, L: 3 };
const RANK_EFFORT: PlanEffort[] = ["S", "M", "L"];

/** Findings per work item above which the effort band is bumped one level. */
const BUMP_THRESHOLD = 10;
/** Sample locations kept per work item (full counts always reported). */
const MAX_LOCATIONS = 5;

interface CategoryPlay {
  /** Consulting order: 1 quick wins · 2 core rework · 3 re-architecture. */
  stage: 1 | 2 | 3;
  effort: PlanEffort;
  recipe: string;
}

/** How each readiness category is worked, and in which stage. */
const CATEGORY_PLAYBOOK: Record<string, CategoryPlay> = {
  subroutines: {
    stage: 1,
    effort: "S",
    recipe:
      "Move each FORM into a (local) class method and turn PERFORM call sites into method calls — mechanical, behavior-preserving.",
  },
  "transaction-glue": {
    stage: 1,
    effort: "M",
    recipe:
      "Replace CALL TRANSACTION / SET-GET parameter / classic authority glue with released equivalents (CDS access control, released APIs).",
  },
  "native-sql": {
    stage: 2,
    effort: "M",
    recipe:
      "Rewrite EXEC SQL as ABAP SQL; keep genuinely database-specific logic in a released AMDP.",
  },
  rfc: {
    stage: 2,
    effort: "M",
    recipe:
      "Replace direct RFC / STARTING NEW TASK patterns with released connectivity: bgPF for async work, HTTP/OData across systems.",
  },
  "report-events": {
    stage: 2,
    effort: "M",
    recipe:
      "Extract the logic behind selection-screen/report events into a class; run it via RAP or an application job.",
  },
  "report-program": {
    stage: 2,
    effort: "M",
    recipe:
      "Convert executable programs to classes (if_oo_adt_classrun for utilities); SUBMIT chains need re-orchestration as application jobs / bgPF.",
  },
  other: {
    stage: 2,
    effort: "M",
    recipe:
      "Statement-by-statement: follow each finding's docs link and substitute the released equivalent.",
  },
  "list-output": {
    stage: 3,
    effort: "M",
    recipe:
      "Replace WRITE-based output: expose the data via a RAP BO / OData service (application log for diagnostics); the UI moves to Fiori.",
  },
  dynpro: {
    stage: 3,
    effort: "L",
    recipe:
      "Redesign the screen as a Fiori app on a RAP service — scaffold_rap_bo generates the starting stack. Plan as re-architecture, not a fix.",
  },
};

const STAGE_META: Record<1 | 2 | 3, { title: string; goal: string }> = {
  1: {
    title: "Quick wins — mechanical modernization",
    goal: "Shrink the blocker count with low-risk, behavior-preserving rewrites and build migration momentum.",
  },
  2: {
    title: "Core rework — replace removed statements",
    goal: "Rework logic ABAP Cloud removed; behavior-preserving, but test object by object.",
  },
  3: {
    title: "Architectural — UI and output redesign",
    goal: "Rebuild dynpro and list output as Fiori-on-RAP; treat each as a small project, not a fix.",
  },
};

export interface PlanLocation {
  line: number;
  excerpt: string;
}

export interface PlanWorkItem {
  /** File (abapGit-style) the work happens in. */
  object: string;
  /** Readiness category (or "broken-at-baseline" / "released-api"). */
  category: string;
  effort: PlanEffort;
  /** Total findings behind this item (locations is a sample). */
  findingCount: number;
  recipe: string;
  /** Up to five sample locations; findingCount carries the full total. */
  locations: PlanLocation[];
}

export interface PlanPhase {
  /** 1-based position in execution order. */
  phase: number;
  kind: "baseline" | "migration" | "released-api";
  title: string;
  goal: string;
  /** Highest effort band among the phase's items. */
  effort: PlanEffort;
  itemCount: number;
  findingCount: number;
  items: PlanWorkItem[];
  /** Objective, re-checkable condition for calling the phase done. */
  exitCriteria: string;
}

export interface MigrationPlan {
  summary: {
    verdict: ReadinessReport["verdict"];
    score: number;
    grade: ReadinessReport["grade"];
    cloudBlockerCount: number;
    fileCount: number;
    phaseCount: number;
    workItemCount: number;
    /** Effort-band tally across all work items, e.g. "3×S, 2×M, 1×L". */
    estimatedEffort: string;
  };
  phases: PlanPhase[];
  /** How to execute an item and prove it: the fix → compare → re-check loop. */
  suggestedLoop: string;
  releasedApiSnapshotDate: string;
  scopeNote: string;
}

function bump(effort: PlanEffort, findingCount: number): PlanEffort {
  if (findingCount <= BUMP_THRESHOLD) return effort;
  return RANK_EFFORT[Math.min(EFFORT_RANK[effort], 2)]!;
}

function maxEffort(items: PlanWorkItem[]): PlanEffort {
  let rank = 1;
  for (const i of items) rank = Math.max(rank, EFFORT_RANK[i.effort]);
  return RANK_EFFORT[rank - 1]!;
}

function sortItems(items: PlanWorkItem[]): PlanWorkItem[] {
  return items.sort((a, b) => b.findingCount - a.findingCount || a.object.localeCompare(b.object));
}

/** Group findings into per-(file, category) work items. */
function itemsFromFindings(
  findings: { file: string; line: number; excerpt: string }[],
  category: string,
  effort: PlanEffort,
  recipe: string,
): PlanWorkItem[] {
  const byFile = new Map<string, PlanLocation[]>();
  for (const f of findings) {
    const list = byFile.get(f.file) ?? [];
    list.push({ line: f.line, excerpt: f.excerpt });
    byFile.set(f.file, list);
  }
  return [...byFile.entries()].map(([object, locations]) => ({
    object,
    category,
    effort: bump(effort, locations.length),
    findingCount: locations.length,
    recipe,
    locations: locations.slice(0, MAX_LOCATIONS),
  }));
}

/**
 * Arrange a readiness report into the phased migration backlog. Deterministic:
 * the same report always yields the same plan; every findingCount sums back to
 * the report's own numbers (migration phases ↔ cloudBlockerCount).
 */
export function planCloudMigration(report: ReadinessReport): MigrationPlan {
  const phases: PlanPhase[] = [];

  // Phase 0 — broken code blocks everything and is not migration work.
  if (report.brokenAtBaseline.length > 0) {
    const items = sortItems(
      itemsFromFindings(
        report.brokenAtBaseline as Finding[],
        "broken-at-baseline",
        "S",
        `Fails even at ${report.baselineVersion} — repair before counting any migration work.`,
      ),
    );
    phases.push({
      phase: 0,
      kind: "baseline",
      title: "Repair the baseline",
      goal: `Fix code that is broken at ${report.baselineVersion} today, so migration counts measure migration — not pre-existing damage.`,
      effort: maxEffort(items),
      itemCount: items.length,
      findingCount: report.brokenAtBaseline.length,
      items,
      exitCriteria: `lint_abap (preset syntax-only, abapVersion ${report.baselineVersion}) reports 0 findings on these objects.`,
    });
  }

  // Migration stages 1–3 from the categorized blockers.
  for (const stage of [1, 2, 3] as const) {
    const items: PlanWorkItem[] = [];
    const categoriesInStage: string[] = [];
    for (const c of report.categories) {
      const play = CATEGORY_PLAYBOOK[c.category] ?? CATEGORY_PLAYBOOK["other"]!;
      if (play.stage !== stage) continue;
      categoriesInStage.push(c.category);
      items.push(...itemsFromFindings(c.findings, c.category, play.effort, play.recipe));
    }
    if (items.length === 0) continue;
    sortItems(items);
    phases.push({
      phase: 0,
      kind: "migration",
      title: STAGE_META[stage].title,
      goal: STAGE_META[stage].goal,
      effort: maxEffort(items),
      itemCount: items.length,
      findingCount: items.reduce((n, i) => n + i.findingCount, 0),
      items,
      exitCriteria: `check_cloud_readiness reports 0 blockers in: ${categoriesInStage.join(", ")}.`,
    });
  }

  // Released-API work stays separate and snapshot-dated, mirroring readiness.
  if (report.releasedApiFindings.length > 0) {
    const items = sortItems(
      report.releasedApiFindings.map((f) => ({
        object: f.file,
        category: "released-api",
        effort: "M" as PlanEffort,
        findingCount: 1,
        recipe:
          f.successor !== undefined
            ? `Replace ${f.object} with released CDS view ${f.successor}.`
            : f.note,
        locations: [{ line: f.line, excerpt: f.object }],
      })),
    );
    phases.push({
      phase: 0,
      kind: "released-api",
      title: "Released-API remediation",
      goal:
        `Replace deprecated and non-released API usage flagged by the bundled SAP snapshot (${report.releasedApiSnapshotDate}). ` +
        "Informational tier: the target system's ATC is authoritative here.",
      effort: maxEffort(items),
      itemCount: items.length,
      findingCount: items.length,
      items,
      exitCriteria:
        "check_released_api on the listed objects shows only released successors in use; confirm with the target system's ATC (API_RELEASE_STATE_CHECK).",
    });
  }

  for (let i = 0; i < phases.length; i++) phases[i]!.phase = i + 1;

  const allItems = phases.flatMap((p) => p.items);
  const tally = (["S", "M", "L"] as const)
    .map((e) => [e, allItems.filter((i) => i.effort === e).length] as const)
    .filter(([, n]) => n > 0)
    .map(([e, n]) => `${n}×${e}`)
    .join(", ");

  return {
    summary: {
      verdict: report.verdict,
      score: report.score,
      grade: report.grade,
      cloudBlockerCount: report.cloudBlockerCount,
      fileCount: report.fileCount,
      phaseCount: phases.length,
      workItemCount: allItems.length,
      estimatedEffort: tally.length > 0 ? tally : "none — nothing to do",
    },
    phases,
    suggestedLoop:
      "Work one item at a time: fix the object, prove the rework with compare_abap (nothing introduced, blockers down), " +
      "then re-run check_cloud_readiness and watch the phase's category counts fall. In CI, `abap-mcp readiness --fail-below <score>` holds the line.",
    releasedApiSnapshotDate: report.releasedApiSnapshotDate,
    scopeNote: report.scopeNote,
  };
}
