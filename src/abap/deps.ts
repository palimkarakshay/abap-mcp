/**
 * Dependency graph over the provided sources — migration sequencing input.
 *
 * Three honest edge tiers, each labeled with how it was derived:
 *   - AST object references (DB tables / function modules) from the engine's
 *     extractor, annotated with the released-API state of the target.
 *   - Structural inheritance/implementation edges from the outline
 *     (superclass, interfaces).
 *   - Textual name references between the provided objects (word-boundary
 *     token match) — deliberately labeled "textual" because without the full
 *     dependency closure abaplint cannot resolve them semantically.
 *
 * Only ever sees the text passed in: an edge to an object you didn't provide
 * is marked provided:false, and absence of an edge is not proof of
 * independence — the scopeNote says so.
 */
import type { AbapSource, AbapVersion } from "./engine.js";
import { extractObjectReferences, inferFilename } from "./engine.js";
import { outlineAbap } from "./outline.js";
import { lookupReleased, RELEASED_API_SNAPSHOT, suggestSuccessor } from "./released.js";

export interface DependencyNode {
  /** Object name, upper-cased (class, interface, program, table, function module). */
  name: string;
  /** "class" | "interface" | "program" | "table" | "function-module" | "unknown". */
  type: string;
  /** True when the object's source was part of this call's input. */
  provided: boolean;
  /** Released-API state for non-provided DDIC/API targets, from the bundled snapshot. */
  releasedState?: "released" | "deprecated" | "not-released";
  /** Curated released CDS successor, when known for a classic table. */
  successor?: string;
}

export interface DependencyEdge {
  from: string;
  to: string;
  /** "db-access" | "call-function" | "inherits" | "implements" | "references-textual". */
  kind: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  /** Mermaid flowchart of the graph (when requested). */
  mermaid?: string;
  releasedApiSnapshotDate: string;
  scopeNote: string;
}

const SCOPE_NOTE =
  "Graph over the provided sources only. AST tiers (db-access, call-function, inherits, implements) come from the " +
  "parser; references-textual edges are word-boundary name matches between provided objects and may over- or " +
  "under-report (dynamic calls are invisible). An absent edge is not proof of independence, and released states " +
  "reflect the bundled SAP snapshot — a system's ATC and where-used remain authoritative.";

/** Main object name for a filename like "zcl_travel.clas.abap" → ZCL_TRAVEL. */
function objectNameOf(filename: string): string {
  return filename.split(".")[0]!.toUpperCase();
}

function objectTypeOf(filename: string, isInterface: boolean): string {
  if (isInterface || filename.includes(".intf.")) return "interface";
  if (filename.includes(".clas.")) return "class";
  if (filename.includes(".prog.")) return "program";
  return "unknown";
}

export function getObjectDependencies(
  files: AbapSource[],
  abapVersion: AbapVersion = "v758",
  mermaid = false,
): DependencyGraph {
  const named = files.map((f) => ({ ...f, filename: inferFilename(f.source, f.filename) }));
  const outlines = outlineAbap(named);

  const nodes = new Map<string, DependencyNode>();
  const edges: DependencyEdge[] = [];
  const edgeKeys = new Set<string>();
  const addEdge = (from: string, to: string, kind: string): void => {
    if (from === to) return;
    const key = `${from}→${to}:${kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ from, to, kind });
  };
  const ensureNode = (n: DependencyNode): void => {
    const existing = nodes.get(n.name);
    if (existing === undefined) nodes.set(n.name, n);
    else if (n.provided && !existing.provided) nodes.set(n.name, { ...existing, ...n });
  };

  // Provided objects become nodes.
  const providedNames = new Set<string>();
  for (const o of outlines) {
    const name = objectNameOf(o.file);
    providedNames.add(name);
    const isInterface = o.interfaces.length > 0 && o.classes.length === 0;
    ensureNode({ name, type: objectTypeOf(o.file, isInterface), provided: true });
  }

  // Structural edges from the outline.
  for (const o of outlines) {
    const from = objectNameOf(o.file);
    for (const c of o.classes) {
      if (!c.isGlobal) continue;
      if (c.superClass !== null) {
        const target = c.superClass.toUpperCase();
        ensureNode({ name: target, type: "class", provided: providedNames.has(target) });
        addEdge(from, target, "inherits");
      }
      for (const i of c.interfaces) {
        const target = i.toUpperCase();
        ensureNode({ name: target, type: "interface", provided: providedNames.has(target) });
        addEdge(from, target, "implements");
      }
    }
  }

  // AST-extracted DDIC / function-module references, with released-API states.
  for (const ref of extractObjectReferences(named, abapVersion)) {
    const from = objectNameOf(ref.file);
    const target = ref.name.toUpperCase();
    if (!nodes.has(target)) {
      let hit = lookupReleased(target, ref.objectType);
      if (!hit.recorded && ref.objectType === "TABL") hit = lookupReleased(target, "CDS_STOB");
      const successor = ref.objectType === "TABL" ? suggestSuccessor(target) : undefined;
      ensureNode({
        name: target,
        type: ref.objectType === "FUNC" ? "function-module" : "table",
        provided: providedNames.has(target),
        // Only annotate names SAP's snapshot explicitly records — absence from
        // the list (every Z/Y object, locals the extractor misreads) is NOT
        // evidence of a problem, same discipline as readiness.
        ...(hit.recorded ? { releasedState: hit.state } : {}),
        ...(successor !== undefined ? { successor } : {}),
      });
    }
    addEdge(from, target, ref.objectType === "FUNC" ? "call-function" : "db-access");
  }

  // Textual cross-references between provided objects (word-boundary match).
  for (const f of named) {
    const from = objectNameOf(f.filename);
    const upper = f.source.toUpperCase();
    for (const target of providedNames) {
      if (target === from) continue;
      if (new RegExp(`(?<![A-Z0-9_/])${target}(?![A-Z0-9_])`).test(upper)) {
        addEdge(from, target, "references-textual");
      }
    }
  }

  const graph: DependencyGraph = {
    nodes: [...nodes.values()].sort((a, b) => a.name.localeCompare(b.name)),
    edges: edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    releasedApiSnapshotDate: RELEASED_API_SNAPSHOT.snapshotDate,
    scopeNote: SCOPE_NOTE,
  };
  if (mermaid) graph.mermaid = toMermaid(graph);
  return graph;
}

const EDGE_ARROWS: Record<string, string> = {
  inherits: "-- inherits -->",
  implements: "-. implements .->",
  "db-access": "-- reads -->",
  "call-function": "-- calls -->",
  "references-textual": "-.->",
};

function toMermaid(graph: DependencyGraph): string {
  const id = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, "_");
  const lines = ["graph LR"];
  for (const n of graph.nodes) {
    const flag = n.releasedState !== undefined && n.releasedState !== "released" ? ` ⚠${n.releasedState}` : "";
    const shape = n.provided ? `${id(n.name)}["${n.name}"]` : `${id(n.name)}(["${n.name}${flag}"])`;
    lines.push(`  ${shape}`);
  }
  for (const e of graph.edges) {
    lines.push(`  ${id(e.from)} ${EDGE_ARROWS[e.kind] ?? "-->"} ${id(e.to)}`);
  }
  return lines.join("\n");
}
