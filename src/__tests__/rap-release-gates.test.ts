/**
 * `release-gates.ts`'s acceptance gate (spec §3.5, task deliverable):
 * RAP900 fires at `--release 2502` for `with collaborative draft` and not
 * at `2508`, and every `knowledgeId` cross-link in `bdl-release-gates.json`
 * resolves in `abap-release-deltas.json`.
 */
import { describe, expect, it } from "vitest";

import type { ParsedBdef } from "../abap/rap/context.js";
import { releaseDeltas } from "../abap/knowledge.js";
import { parseBehaviorDefinition } from "../abap/rap/parser.js";
import {
  checkReleaseGates,
  detectGatedConstructs,
  gateExceeds,
  RAP_RELEASE_GATES_CURATED_DATE,
  releaseGateRow,
  RELEASE_GATE_ROWS,
  type ReleaseGateRow,
} from "../abap/rap/release-gates.js";

function bdef(source: string, filename = "z.bdef.asbdef"): ParsedBdef {
  const result = parseBehaviorDefinition(source, filename);
  return { filename, source, ast: result.ast, errors: result.errors, unknown: result.unknown, truncated: result.truncated };
}

const COLLABORATIVE_DRAFT_SOURCE = `managed implementation in class zbp_r_demo unique;
strict ( 2 );
with collaborative draft;

define behavior for ZR_Demo alias Demo
persistent table zdemo
draft table zdemo_d
lock master
total etag LastChangedAt
authorization master ( global )
etag master LocalLastChangedAt
{
  create;
  update;
  delete;
}
`;

describe("bdl-release-gates.json — the transcribed feature table", () => {
  it("holds at least 130 rows, each with a construct/label/minRelease/sourceUrl", () => {
    expect(RELEASE_GATE_ROWS.length).toBeGreaterThanOrEqual(130);
    for (const row of RELEASE_GATE_ROWS) {
      expect(row.construct.length).toBeGreaterThan(0);
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.minRelease).toMatch(/^\d{4}$/);
      expect(row.sourceUrl).toBe("https://help.sap.com/docs/abap-cloud/abap-keyword/rap-bdl-feature-tables");
    }
  });

  it("has unique construct keys", () => {
    const keys = RELEASE_GATE_ROWS.map((r) => r.construct);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries the with-collaborative-draft row at 2508, matching the spec §3.5 worked example", () => {
    const row = releaseGateRow("with-collaborative-draft");
    expect(row).toBeDefined();
    expect(row?.minRelease).toBe("2508");
    expect(row?.knowledgeId).toBe("rap-collaborative-draft-2508");
  });

  it("every knowledgeId cross-link resolves to a real row in abap-release-deltas.json", () => {
    const deltaIds = new Set(releaseDeltas().map((d) => d.id));
    const linked = RELEASE_GATE_ROWS.filter((r): r is ReleaseGateRow & { knowledgeId: string } => r.knowledgeId !== undefined);
    expect(linked.length).toBeGreaterThan(0);
    for (const row of linked) {
      expect(deltaIds.has(row.knowledgeId), `${row.construct} -> ${row.knowledgeId}`).toBe(true);
    }
  });
});

describe("releaseRank ordering (gateExceeds)", () => {
  it("a construct requiring 2508 exceeds a 2502 target but not a 2508 or later target", () => {
    const row = releaseGateRow("with-collaborative-draft")!;
    expect(gateExceeds(row, "2502")).toBe(true);
    expect(gateExceeds(row, "2508")).toBe(false);
    expect(gateExceeds(row, "2511")).toBe(false);
    expect(gateExceeds(row, "2608")).toBe(false);
  });

  it("platform-2025 sorts between 2508 and 2511", () => {
    const row2508: ReleaseGateRow = { ...releaseGateRow("with-collaborative-draft")!, minRelease: "2508" };
    const row2511: ReleaseGateRow = { ...releaseGateRow("with-collaborative-draft")!, minRelease: "2511" };
    expect(gateExceeds(row2508, "platform-2025")).toBe(false);
    expect(gateExceeds(row2511, "platform-2025")).toBe(true);
  });

  it("pre-2502 target does not gate every early-RAP construct (managed, with draft, ...)", () => {
    const managedRow = releaseGateRow("managed")!;
    const draftRow = releaseGateRow("with-draft")!;
    expect(gateExceeds(managedRow, "pre-2502")).toBe(false);
    expect(gateExceeds(draftRow, "pre-2502")).toBe(false);
    // but a genuinely 2502+ construct still gates at pre-2502
    const collabRow = releaseGateRow("with-collaborative-draft")!;
    expect(gateExceeds(collabRow, "pre-2502")).toBe(true);
  });
});

describe("detectGatedConstructs", () => {
  it("finds with-collaborative-draft on a BDEF that declares it", () => {
    const { ast } = parseBehaviorDefinition(COLLABORATIVE_DRAFT_SOURCE, "z.bdef.asbdef");
    const detected = detectGatedConstructs(ast);
    expect(detected.some((d) => d.construct === "with-collaborative-draft")).toBe(true);
  });

  it("does not find with-collaborative-draft on a plain with-draft BDEF", () => {
    const source = COLLABORATIVE_DRAFT_SOURCE.replace("with collaborative draft;", "with draft;");
    const { ast } = parseBehaviorDefinition(source, "z.bdef.asbdef");
    const detected = detectGatedConstructs(ast);
    expect(detected.some((d) => d.construct === "with-collaborative-draft")).toBe(false);
    expect(detected.some((d) => d.construct === "with-draft")).toBe(true);
  });
});

describe("checkReleaseGates — RAP900", () => {
  it("fires for 'with collaborative draft' at --release 2502", () => {
    const findings = checkReleaseGates(bdef(COLLABORATIVE_DRAFT_SOURCE), { abapRelease: "2502" });
    const rap900 = findings.filter((f) => f.rule === "RAP900" && f.message.includes("with collaborative draft"));
    expect(rap900).toHaveLength(1);
    expect(rap900[0]?.severity).toBe("warning");
    expect(rap900[0]?.confidence).toBe("confirmed");
    expect(rap900[0]?.minRelease).toBe("2508");
    expect(rap900[0]?.message).toBe(
      '"with collaborative draft" requires ABAP Cloud 2508 or higher; the target release you passed is 2502.',
    );
    expect(rap900[0]?.hint).toContain(RAP_RELEASE_GATES_CURATED_DATE);
  });

  it("does not fire for 'with collaborative draft' at --release 2508", () => {
    const findings = checkReleaseGates(bdef(COLLABORATIVE_DRAFT_SOURCE), { abapRelease: "2508" });
    expect(findings.filter((f) => f.message.includes("with collaborative draft"))).toEqual([]);
  });

  it("does not fire at all, for any construct, when abapRelease is omitted (release gating is opt-in)", () => {
    expect(checkReleaseGates(bdef(COLLABORATIVE_DRAFT_SOURCE), {})).toEqual([]);
  });

  it("every finding carries the RAP900 rule id, a docsUrl and a sourceUrl", () => {
    const findings = checkReleaseGates(bdef(COLLABORATIVE_DRAFT_SOURCE), { abapRelease: "pre-2502" });
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.rule).toBe("RAP900");
      expect(f.docsUrl).toBe("docs/RAP-RULES.md#rap900");
      expect(f.sourceUrl?.startsWith("https://help.sap.com/")).toBe(true);
      expect(f.file).toBe("z.bdef.asbdef");
    }
  });

  it("findings are sorted by (line, column)", () => {
    const findings = checkReleaseGates(bdef(COLLABORATIVE_DRAFT_SOURCE), { abapRelease: "pre-2502" });
    for (let i = 1; i < findings.length; i++) {
      const prev = findings[i - 1]!;
      const cur = findings[i]!;
      expect(prev.line < cur.line || (prev.line === cur.line && prev.column <= cur.column)).toBe(true);
    }
  });
});
