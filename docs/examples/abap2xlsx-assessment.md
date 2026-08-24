# Sample assessment: abap2xlsx (100 files, real code)

What abap-mcp produces on a well-known open-source abapGit project —
[abap2xlsx](https://github.com/abap2xlsx/abap2xlsx) (MIT), assessed 2026-08-24 with
abap-mcp 0.7.0, entirely offline. Three commands, no SAP system:

```bash
npx abap-mcp readiness src/          # scored + graded readiness
npx abap-mcp plan src/               # phased migration backlog
npx abap-mcp deps src/zcl_excel*.clas.abap --mermaid   # dependency graph
```

> abap2xlsx is a healthy, actively-maintained project that already runs a cloud
> variant — it even keeps its intentionally-classic objects in a `not_cloud/`
> folder. That's what makes it a good demo: the parser-level diff independently
> rediscovers the project's own boundary, with line-level receipts.

## Readiness — one command, the whole repo

```
ABAP Cloud readiness: significant-rework (score 0, grade C)
56 cloud blocker(s) across 100 file(s)
  other                28  Other statements ABAP Cloud does not allow
  list-output          14  Classic list output (WRITE…) — no UI in ABAP Cloud; expose data via RAP/OData instead
  report-events        12  Report / selection-screen events — wrap the logic in a class; use RAP or an application job
  transaction-glue      1  Transaction / SPA-GPA / classic auth glue — re-model on released APIs
  report-program        1  Executable program statements — ABAP Cloud has classes only; SUBMIT has no released equivalent
6 released-API note(s) (snapshot 2026-08-24; informational, not scored):
  zcl_excel_ole.clas.abap:836  [not-released] TCURX
  zcl_excel_ole.clas.abap:1407 [not-released] TCURX
  zcl_excel_ole.clas.abap:1450 [not-released] TCURX
  zcl_excel_ole.clas.abap:1475 [not-released] T006
  zcl_excel_writer_csv.clas.abap:126 [not-released] DD07T
  zcl_excel_writer_csv.clas.abap:278 [not-released] CONVERT_DATE_TO_EXTERNAL
```

Reading it like a consultant: the *blocker mass sits in a handful of objects* —
the OLE integration (`zcl_excel_ole`, desktop-only by nature and already parked
in `not_cloud/`) and one demo report. The library core is largely clean, which
is exactly what the density-banded **grade C** (not D) says: 56 blockers over
100 files, concentrated, not systemic.

## The plan — blockers rearranged into a work breakdown

```
ABAP Cloud migration plan — score 0, grade C, 56 blocker(s) → 14 work item(s) in 4 phase(s)

Phase 1 — Quick wins — mechanical modernization          [1 item,  effort M]
  zcl_excel_converter  transaction-glue×1 — replace CALL TRANSACTION glue with released equivalents
Phase 2 — Core rework — replace removed statements       [6 items, effort L]
  zcl_excel_ole        other×18 [L]     zexcel_template_get_types  report-events×12 [L]
  zcl_excel_converter  other×8  [M]     … + 3 smaller items
Phase 3 — Architectural — UI and output redesign         [3 items, effort M]
  zcl_excel_ole        list-output×10   zcl_excel_common  list-output×3   zcl_excel_writer_csv  list-output×1
Phase 4 — Released-API remediation (snapshot-dated, informational) [4 items]
  TCURX ×3 usages, T006, DD07T, CONVERT_DATE_TO_EXTERNAL — ATC is authoritative here
```

Each item carries a remediation recipe and a curated before/after example; each
phase ends with objective exit criteria ("check_cloud_readiness reports 0
blockers in: list-output"), so progress is re-checkable, not vibes.

## Dependencies — sequencing with released-API flags

```
ZCL_EXCEL_WRITER_CSV  --db-access-->        DD07T        ⚠ not-released
ZCL_EXCEL_WRITER_CSV  --call-function-->    SCMS_STRING_TO_XSTRING
ZCL_EXCEL_WRITER_CSV  --implements-->       ZIF_EXCEL_WRITER
ZCL_EXCEL_WRITER_CSV  --references-textual-> ZCL_EXCEL
ZCL_EXCEL_OLE         --db-access-->        TCURX        ⚠ not-released → CDS view
```

`--mermaid` renders the same graph as a flowchart. Edges are labeled by how
they were derived (parser-level vs. textual), and only objects SAP's snapshot
explicitly records get a released-state flag — absence from the list is never
treated as evidence.

## Honest edges

- Three files exceeded the 100k-char per-file cap and were skipped with a
  warning (the giant `zcl_excel_reader_2007` among them) — the counts above
  cover the other 100 files.
- This is static, parser-level analysis: no ATC, no system, and the
  released-API tier reflects the bundled snapshot date. A target system's ATC
  (`API_RELEASE_STATE_CHECK`) remains authoritative.
- None of this is a judgment of abap2xlsx — it's a demonstration of what the
  tooling reports on real, living code. The project's own `not_cloud/` split
  shows its maintainers already know exactly where the classic seams are.
