/**
 * MCP resources over the bundled SAP knowledge base.
 *
 * Tools answer questions; resources let a host attach the underlying cards to a
 * conversation directly. Both whole files and individual cards are addressable:
 *
 *   abap-mcp://knowledge/manifest              — provenance for every bundled file
 *   abap-mcp://knowledge/release-deltas        — the whole release-delta file
 *   abap-mcp://knowledge/clean-core            — the whole Clean Core file
 *   abap-mcp://knowledge/sap-ai                — the whole SAP-AI decision-card file
 *   abap-mcp://knowledge/release/{id}          — one release-delta row
 *   abap-mcp://knowledge/clean-core/{id}       — one Clean Core entry
 *   abap-mcp://knowledge/sap-ai/{id}           — one SAP-AI decision card
 *
 * Every read returns the record twice: once as application/json for machines
 * and once as text/markdown for a human pane. Reads are pure in-memory lookups
 * over package-bundled assets — no network, no user filesystem.
 *
 * NOTE: not wired into buildServer() here; the integrator does that.
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";

import type { KnowledgeArea } from "./abap/knowledge.js";
import {
  cleanCoreEntries,
  KNOWLEDGE_CURATED_DATE,
  KNOWLEDGE_SCOPE_NOTE,
  knowledgeManifest,
  releaseDeltas,
  renderKnowledgeMarkdown,
  sapAiCards,
} from "./abap/knowledge.js";

/** URI scheme + root every knowledge resource lives under. */
export const KNOWLEDGE_URI_ROOT = "abap-mcp://knowledge";

interface AreaSpec {
  area: KnowledgeArea;
  /** Path segment used by the per-card template, e.g. "release" in .../knowledge/release/{id}. */
  segment: string;
  /** URI of the whole-file resource. */
  fileUri: string;
  fileName: string;
  fileTitle: string;
  fileDescription: string;
  records: () => readonly Record<string, unknown>[];
}

const AREAS: readonly AreaSpec[] = [
  {
    area: "release",
    segment: "release",
    fileUri: `${KNOWLEDGE_URI_ROOT}/release-deltas`,
    fileName: "abap-release-deltas",
    fileTitle: "ABAP Cloud / RAP release deltas",
    fileDescription:
      "Every verified release-delta row for the 2502 to 2608 trains plus ABAP Platform 2025, each with an original summary, the cited SAP source URL and a confidence flag.",
    records: () => releaseDeltas() as unknown as readonly Record<string, unknown>[],
  },
  {
    area: "clean-core",
    segment: "clean-core",
    fileUri: `${KNOWLEDGE_URI_ROOT}/clean-core`,
    fileName: "clean-core",
    fileTitle: "Clean Core levels, release contracts and ATC vocabulary",
    fileDescription:
      "SAP's Clean Core Level A-D model, the retired 3-tier framing, release contracts C0 to C4, the real ATC check and variant names, and the Cloudification Repository file and schema inventory.",
    records: () => cleanCoreEntries() as unknown as readonly Record<string, unknown>[],
  },
  {
    area: "sap-ai",
    segment: "sap-ai",
    fileUri: `${KNOWLEDGE_URI_ROOT}/sap-ai`,
    fileName: "sap-ai-options",
    fileTitle: "SAP AI option decision cards",
    fileDescription:
      "Decision cards for SAP-ABAP-1, the Generative AI Hub orchestration API, the ABAP AI SDK powered by ISLM, Joule for Developers, SAP's official ADT MCP server, the custom code migration agent and the community MCP ecosystem.",
    records: () => sapAiCards() as unknown as readonly Record<string, unknown>[],
  },
];

function idOf(record: Record<string, unknown>): string {
  const id = record["id"];
  return typeof id === "string" ? id : "";
}

function titleOf(record: Record<string, unknown>): string {
  const title = record["title"];
  return typeof title === "string" ? title : idOf(record);
}

function summaryOf(record: Record<string, unknown>): string {
  const summary = record["summary"];
  return typeof summary === "string" ? summary : "";
}

function bothRepresentations(
  uri: string,
  area: KnowledgeArea,
  record: Record<string, unknown>,
): ReadResourceResult {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(record, null, 2),
      },
      {
        uri,
        mimeType: "text/markdown",
        text: renderKnowledgeMarkdown(area, record),
      },
    ],
  };
}

function firstVariable(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

/**
 * Register the bundled knowledge base as MCP resources on `server`.
 *
 * Three whole-file resources, one manifest resource, and three URI templates
 * that address individual cards and enumerate them in resources/list.
 */
export function registerKnowledgeResources(server: McpServer): void {
  server.registerResource(
    "knowledge-manifest",
    `${KNOWLEDGE_URI_ROOT}/manifest`,
    {
      title: "Bundled knowledge provenance manifest",
      description: `Curation date, licence posture and the full source list for every bundled knowledge file. ${KNOWLEDGE_SCOPE_NOTE}.`,
      mimeType: "application/json",
    },
    (uri) => {
      const manifest = knowledgeManifest() as unknown as Record<string, unknown>;
      return {
        contents: [
          { uri: uri.href, mimeType: "application/json", text: JSON.stringify(manifest, null, 2) },
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: renderKnowledgeMarkdown("release", {
              id: "manifest",
              title: "Bundled knowledge provenance manifest",
              summary: `abap-mcp original summaries (MIT) over cited sources, curated ${KNOWLEDGE_CURATED_DATE}.`,
              ...manifest,
            }),
          },
        ],
      };
    },
  );

  for (const spec of AREAS) {
    server.registerResource(
      `knowledge-${spec.fileName}`,
      spec.fileUri,
      {
        title: spec.fileTitle,
        description: `${spec.fileDescription} ${KNOWLEDGE_SCOPE_NOTE}.`,
        mimeType: "application/json",
      },
      (uri) => {
        const records = spec.records();
        const payload = {
          area: spec.area,
          curatedDate: KNOWLEDGE_CURATED_DATE,
          scopeNote: KNOWLEDGE_SCOPE_NOTE,
          recordCount: records.length,
          records,
        };
        const markdown = [
          `# ${spec.fileTitle}`,
          "",
          spec.fileDescription,
          "",
          ...records.map((r) => `- **${titleOf(r)}** (\`${idOf(r)}\`) — ${summaryOf(r)}`),
          "",
          `_${KNOWLEDGE_SCOPE_NOTE}._`,
        ].join("\n");
        return {
          contents: [
            { uri: uri.href, mimeType: "application/json", text: JSON.stringify(payload, null, 2) },
            { uri: uri.href, mimeType: "text/markdown", text: markdown },
          ],
        };
      },
    );

    server.registerResource(
      `knowledge-${spec.fileName}-card`,
      new ResourceTemplate(`${KNOWLEDGE_URI_ROOT}/${spec.segment}/{id}`, {
        list: () => ({
          resources: spec.records().map((record) => ({
            uri: `${KNOWLEDGE_URI_ROOT}/${spec.segment}/${idOf(record)}`,
            name: idOf(record),
            title: titleOf(record),
            description: summaryOf(record),
            mimeType: "application/json",
          })),
        }),
        complete: {
          id: (value: string) =>
            spec
              .records()
              .map(idOf)
              .filter((id) => id.startsWith(value)),
        },
      }),
      {
        title: `${spec.fileTitle} — single card`,
        description: `One card from ${spec.fileName}.json, addressed by its stable id. ${KNOWLEDGE_SCOPE_NOTE}.`,
        mimeType: "application/json",
      },
      (uri, variables) => {
        const id = firstVariable(variables["id"] as string | string[] | undefined);
        const record = spec.records().find((r) => idOf(r) === id);
        if (record === undefined) {
          throw new Error(
            `Unknown ${spec.area} knowledge id "${id}". List ${spec.fileUri} for the available ids.`,
          );
        }
        return bothRepresentations(uri.href, spec.area, record);
      },
    );
  }
}

/** Every static (non-template) knowledge resource URI, for tests and docs. */
export const KNOWLEDGE_FILE_URIS: readonly string[] = [
  `${KNOWLEDGE_URI_ROOT}/manifest`,
  ...AREAS.map((a) => a.fileUri),
];
