/**
 * F04 regression guard: the server used to invent an ATC identifier
 * (`API_RELEASE_STATE_CHECK`, never a real SAP name) and misuse
 * `SAP_CP_READINESS` (a real but unrelated legacy Cloud-Readiness variant,
 * not the released-API check) as if it were authoritative. src/data/atc-
 * vocabulary.json now carries the real, sourced vocabulary, and every
 * honesty-facing string is built from it.
 *
 * This walks the shipped surfaces the task promised to keep honest:
 *   - src/**\/*.ts (first-party source — excluding src/__tests__/**, same
 *     boundary tsconfig.json itself draws for "source", and necessary because
 *     tests legitimately need to spell out the forbidden string to assert its
 *     absence, e.g. agent-rules.test.ts's own `.not.toContain(...)` check);
 *   - src/data/*.json (the bundled data assets — NOT the recursive
 *     src/data/knowledge/ tree, which is a separate knowledge base outside
 *     this glob);
 *   - docs/**\/*.md and README.md — EXCLUDING docs/ROADMAP-2026-09.md, which
 *     is the planning record of this very fix and legitimately quotes the
 *     wrong identifiers to describe what was broken.
 * Bundled raw SAP snapshot files (released-apis.*.json) are excluded from
 * the "SAP_CP_READINESS appears only in atc-vocabulary.json" assertion only:
 * SAP_CP_READINESS is a real, if deprecated, ATC check-variant object
 * (CHKV) in SAP's own published data, so it legitimately appears there as a
 * data key — that is SAP's data, not our prose.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkCloudReadiness } from "../abap/readiness.js";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..", ".."); // src/__tests__ -> repo root

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "coverage"]);

/** Recursively list files under `dir` whose basename matches `matcher`. */
function walk(dir: string, matcher: (name: string) => boolean): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, matcher));
    else if (matcher(entry)) out.push(full);
  }
  return out;
}

const TESTS_DIR = join(ROOT, "src", "__tests__") + "/";
const TS_FILES = walk(join(ROOT, "src"), (n) => n.endsWith(".ts")).filter((f) => !f.startsWith(TESTS_DIR));

// Shallow on purpose — mirrors the task's literal "src/data/*.json" (NOT the
// recursive src/data/knowledge/ tree, a separate knowledge base).
const DATA_JSON_FILES = readdirSync(join(ROOT, "src", "data"))
  .filter((n) => n.endsWith(".json"))
  .map((n) => join(ROOT, "src", "data", n));

const ATC_VOCAB_FILE = join(ROOT, "src", "data", "atc-vocabulary.json");
const RAW_SNAPSHOT_FILES = new Set(
  ["released-apis.s4hc.json", "released-apis.btp.json", "released-apis.pce.json", "api-classifications.json"].map(
    (n) => join(ROOT, "src", "data", n),
  ),
);

const ROADMAP_FILE = join(ROOT, "docs", "ROADMAP-2026-09.md");
const DOC_FILES = [...walk(join(ROOT, "docs"), (n) => n.endsWith(".md")), join(ROOT, "README.md")].filter(
  (f) => f !== ROADMAP_FILE,
);

describe("ATC vocabulary honesty (F04)", () => {
  it("has at least a handful of files in every scanned surface (the walker itself works)", () => {
    expect(TS_FILES.length).toBeGreaterThan(10);
    expect(DATA_JSON_FILES.length).toBeGreaterThan(3);
    expect(DOC_FILES.length).toBeGreaterThan(3);
  });

  it("never invents the ATC identifier API_RELEASE_STATE_CHECK anywhere shipped", () => {
    for (const file of [...TS_FILES, ...DATA_JSON_FILES, ...DOC_FILES]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/API_RELEASE_STATE_CHECK/);
    }
  });

  it("names SAP_CP_READINESS only inside the curated vocabulary (or SAP's own raw snapshot data)", () => {
    for (const file of [...TS_FILES, ...DOC_FILES]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/SAP_CP_READINESS/);
    }
    for (const file of DATA_JSON_FILES) {
      const text = readFileSync(file, "utf8");
      if (file === ATC_VOCAB_FILE || RAW_SNAPSHOT_FILES.has(file)) continue;
      expect(text, file).not.toMatch(/SAP_CP_READINESS/);
    }
    expect(readFileSync(ATC_VOCAB_FILE, "utf8")).toMatch(/SAP_CP_READINESS/);
  });

  it("curates the real check names, sourced from SAP's own Cloudification Repository README", () => {
    const vocab = JSON.parse(readFileSync(ATC_VOCAB_FILE, "utf8")) as {
      curatedDate: string;
      sources: string[];
      checks: { name: string; edition: string; note: string }[];
      variants: { name: string; scope: string; status: "current" | "deprecated"; successor?: string }[];
    };
    expect(vocab.curatedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(vocab.sources.length).toBeGreaterThan(0);
    for (const s of vocab.sources) expect(s).toMatch(/^https:\/\//);

    const checkNames = vocab.checks.map((c) => c.name);
    expect(checkNames).toContain("Usage of Released APIs (Cloudification Repository)");
    expect(checkNames).toContain("Usage of APIs (Cloudification Repository)");
  });

  it("curates the real check-variant list, current and deprecated-with-successor", () => {
    const vocab = JSON.parse(readFileSync(ATC_VOCAB_FILE, "utf8")) as {
      variants: { name: string; scope: string; status: "current" | "deprecated"; successor?: string }[];
    };
    const byName = Object.fromEntries(vocab.variants.map((v) => [v.name, v]));

    expect(byName["ABAP_CLEAN_CORE_DEVELOPMENT"]?.status).toBe("current");
    expect(byName["ABAP_CLEAN_CORE_DEVELOPMENT"]?.scope).toMatch(/BTP|S\/4HANA/);

    expect(byName["ABAP_CLEAN_CORE_READINESS"]?.status).toBe("current");
    expect(byName["ABAP_CLEAN_CORE_READINESS"]?.scope).toMatch(/ECC|2023/);

    expect(byName["ABAP_CLOUD_DEVELOPMENT_3TIER"]?.status).toBe("deprecated");
    expect(byName["ABAP_CLOUD_DEVELOPMENT_3TIER"]?.successor).toBe("ABAP_CLEAN_CORE_DEVELOPMENT");

    // Legacy Cloud-Readiness variants — real ATC objects, but NOT the
    // released-API check (that distinction is the whole point of F04).
    expect(byName["ABAP_CLOUD_READINESS"]).toBeDefined();
    expect(byName["SAP_CP_READINESS"]?.status).toBe("deprecated");
    expect(byName["SAP_CP_READINESS"]?.successor).toBe("ABAP_CLOUD_READINESS");
    for (const name of ["ABAP_CLOUD_READINESS", "SAP_CP_READINESS"]) {
      expect(byName[name]?.scope.toLowerCase()).toMatch(/not the released-api check/);
    }
  });

  it("carries Clean Core Level A–D and release-contract meanings distinct from our own grade", () => {
    const vocab = JSON.parse(readFileSync(ATC_VOCAB_FILE, "utf8")) as {
      cleanCoreLevels: { A: string; B: string; C: string; D: string };
      releaseContracts: { C0: string; C1: string; C2: string; C3: string };
    };
    for (const level of ["A", "B", "C", "D"] as const) {
      expect(vocab.cleanCoreLevels[level].length).toBeGreaterThan(10);
    }
    for (const contract of ["C0", "C1", "C2", "C3"] as const) {
      expect(vocab.releaseContracts[contract].length).toBeGreaterThan(10);
    }
  });

  it("readiness reports carry gradeMeaning and cleanCoreVocabulary, never confusing our grade with SAP's", () => {
    const report = checkCloudReadiness([{ source: "REPORT ztest.\nWRITE: / 'hi'." }]);
    expect(report.gradeMeaning).toBe("blocker-density");
    expect(report.cleanCoreVocabulary.checks.length).toBeGreaterThan(0);
    expect(report.cleanCoreVocabulary.variants.length).toBeGreaterThan(0);
    expect(report.scopeNote).not.toMatch(/API_RELEASE_STATE_CHECK/);
    expect(report.scopeNote).not.toMatch(/SAP_CP_READINESS/);
    expect(report.scopeNote.toLowerCase()).toMatch(/blocker density/);
  });
});
