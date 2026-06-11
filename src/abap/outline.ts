/**
 * Structural outline of ABAP sources — lets an agent navigate a large class
 * or legacy include without reading every line into context.
 */
import * as abaplint from "@abaplint/core";

import type { AbapSource } from "./engine.js";
import { inferFilename, MAX_FILE_CHARS, MAX_FILES } from "./engine.js";
import { invalidInput } from "../errors.js";

export interface MethodOutline {
  name: string;
  visibility: "public" | "protected" | "private";
}

export interface ClassOutline {
  name: string;
  isGlobal: boolean;
  isFinal: boolean;
  isAbstract: boolean;
  isForTesting: boolean;
  superClass: string | null;
  interfaces: string[];
  methods: MethodOutline[];
  attributes: string[];
  constants: string[];
}

export interface FileOutline {
  file: string;
  classes: ClassOutline[];
  interfaces: string[];
  forms: string[];
  parseable: boolean;
}

const VISIBILITY: Record<number, MethodOutline["visibility"]> = {
  1: "private",
  2: "protected",
  3: "public",
};

export function outlineAbap(files: AbapSource[]): FileOutline[] {
  if (files.length === 0) throw invalidInput("Provide at least one source file.");
  if (files.length > MAX_FILES) throw invalidInput(`At most ${MAX_FILES} files per call.`);

  const config = abaplint.Config.getDefault();
  const registry = new abaplint.Registry(config);
  const names: string[] = [];
  for (const f of files) {
    if (f.source.length > MAX_FILE_CHARS) {
      throw invalidInput(`File ${f.filename ?? "(unnamed)"} exceeds ${MAX_FILE_CHARS} characters.`);
    }
    const name = inferFilename(f.source, f.filename);
    names.push(name);
    registry.addFile(new abaplint.MemoryFile(name, f.source));
  }
  registry.parse();

  const out: FileOutline[] = [];
  for (const name of names) {
    let found = false;
    for (const obj of registry.getObjects()) {
      if (!(obj instanceof abaplint.ABAPObject)) continue;
      for (const file of obj.getABAPFiles()) {
        if (file.getFilename() !== name) continue;
        found = true;
        const info = file.getInfo();
        out.push({
          file: name,
          parseable: true,
          classes: info.listClassDefinitions().map((c) => ({
            name: c.name,
            isGlobal: c.isGlobal,
            isFinal: c.isFinal,
            isAbstract: c.isAbstract,
            isForTesting: c.isForTesting,
            superClass: c.superClassName?.toLowerCase() ?? null,
            interfaces: c.interfaces.map((i) => i.name.toLowerCase()),
            methods: c.methods.map((m) => ({
              name: m.name,
              visibility: VISIBILITY[m.visibility as number] ?? "private",
            })),
            attributes: c.attributes.map((a) => a.name),
            constants: c.constants.map((k) => k.name),
          })),
          interfaces: info.listInterfaceDefinitions().map((i) => i.name),
          forms: info.listFormDefinitions().map((f) => f.name),
        });
      }
    }
    if (!found) {
      // Non-ABAP artifacts (CDS, BDEF) or unparseable sources get an empty outline.
      out.push({ file: name, parseable: false, classes: [], interfaces: [], forms: [] });
    }
  }
  return out;
}

const VIS_PREFIX: Record<MethodOutline["visibility"], string> = {
  public: "+",
  protected: "#",
  private: "-",
};

/** Mermaid identifiers cannot carry ABAP's ~ / namespace slashes / dots. */
function mermaidName(name: string): string {
  return name.replace(/[^A-Za-z0-9_]/g, "_");
}

/**
 * Render outlines as a Mermaid classDiagram: classes with method visibility
 * (+/#/-) and attributes, inheritance (<|--), interface realization (<|..),
 * and legacy FORMs as one pseudo-class per file. Deterministic text out —
 * paste into any Mermaid renderer (GitHub, docs sites, diagram tools) for
 * the visual; nothing here draws pixels.
 */
export function outlineToMermaid(outlines: FileOutline[]): string {
  const lines: string[] = ["classDiagram"];
  const declaredInterfaces = new Set<string>();
  const declareInterface = (name: string): void => {
    const id = mermaidName(name);
    if (declaredInterfaces.has(id)) return;
    declaredInterfaces.add(id);
    lines.push(`  class ${id} {`, "    <<interface>>", "  }");
  };
  for (const o of outlines) {
    for (const i of o.interfaces) declareInterface(i);
    for (const c of o.classes) {
      const id = mermaidName(c.name);
      lines.push(`  class ${id} {`);
      if (c.isAbstract) lines.push("    <<abstract>>");
      for (const m of c.methods) lines.push(`    ${VIS_PREFIX[m.visibility]}${mermaidName(m.name)}()`);
      for (const a of c.attributes) lines.push(`    ${mermaidName(a)}`);
      lines.push("  }");
      if (c.superClass !== null) lines.push(`  ${mermaidName(c.superClass)} <|-- ${id}`);
      for (const i of c.interfaces) {
        declareInterface(i);
        lines.push(`  ${mermaidName(i)} <|.. ${id}`);
      }
    }
    if (o.forms.length > 0) {
      const id = `${mermaidName(o.file.replace(/\..*$/, ""))}_forms`;
      lines.push(`  class ${id} {`);
      for (const f of o.forms) lines.push(`    +${mermaidName(f)}()`);
      lines.push("  }");
    }
  }
  return lines.join("\n");
}
