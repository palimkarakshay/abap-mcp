#!/usr/bin/env node
/**
 * DEV-ONLY link checker for the bundled SAP knowledge base.
 *
 * The server itself never fetches a URL — that is a hard invariant. This script
 * is the release-time exception (like build-released-api-index.mjs): it walks
 * every sourceUrl in src/data/knowledge/*.json plus every source in
 * MANIFEST.json, sends a HEAD (falling back to a ranged GET when HEAD is refused
 * or unsupported), and reports links that no longer resolve.
 *
 * It is NEVER part of `npm test` or `npm run check`: several SAP hosts sit
 * behind Cloudflare and answer 403 to anything that is not a browser, so a red
 * result here is a prompt to look, not an automatic build failure.
 *
 * Usage:
 *   node scripts/check-knowledge-links.mjs
 *   node scripts/check-knowledge-links.mjs --json          # machine-readable report
 *   node scripts/check-knowledge-links.mjs --concurrency 4 # default 6
 *   node scripts/check-knowledge-links.mjs --timeout 20000 # ms per request, default 15000
 *
 * Exit code is 0 unless --strict is passed, in which case any hard failure
 * (DNS error, timeout, 404, 410) exits 1. Soft failures (401/403/429 — bot
 * walls and rate limits) never fail the run.
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const knowledgeDir = join(here, "..", "src", "data", "knowledge");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const value = args[i + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
};
const asJson = args.includes("--json");
const strict = args.includes("--strict");
const concurrency = Math.max(1, Number(flag("concurrency", "6")));
const timeoutMs = Math.max(1000, Number(flag("timeout", "15000")));

/** Bot walls, not dead links. */
const SOFT_STATUSES = new Set([401, 403, 405, 406, 429, 999]);

function collectUrls() {
  /** @type {Map<string, Set<string>>} url -> set of "file#id" citations */
  const urls = new Map();
  const cite = (url, where) => {
    if (typeof url !== "string" || !url.startsWith("http")) return;
    if (!urls.has(url)) urls.set(url, new Set());
    urls.get(url).add(where);
  };

  for (const name of readdirSync(knowledgeDir)) {
    if (!name.endsWith(".json")) continue;
    const data = JSON.parse(readFileSync(join(knowledgeDir, name), "utf8"));

    if (name === "MANIFEST.json") {
      for (const [file, entry] of Object.entries(data.files ?? {})) {
        for (const source of entry.sources ?? []) cite(source.url, `MANIFEST.json -> ${file}`);
      }
      continue;
    }

    for (const key of ["deltas", "entries", "cards"]) {
      for (const record of data[key] ?? []) {
        const where = `${name}#${record.id}`;
        cite(record.sourceUrl, where);
        for (const source of record.sources ?? []) cite(source, where);
      }
    }
  }
  return urls;
}

async function probe(url) {
  const attempt = async (method, headers) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: {
          // Some SAP hosts 403 an empty UA outright; identify honestly.
          "user-agent": "abap-mcp-link-checker/1.0 (+https://github.com/palimkarakshay/abap-mcp)",
          accept: "*/*",
          ...headers,
        },
      });
      return { status: response.status, finalUrl: response.url };
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    let result = await attempt("HEAD", {});
    if (result.status >= 400 && result.status !== 404 && result.status !== 410) {
      // HEAD is frequently unsupported or bot-walled; retry as a ranged GET.
      try {
        result = await attempt("GET", { range: "bytes=0-2047" });
      } catch {
        /* keep the HEAD result */
      }
    }
    return result;
  } catch (err) {
    return { status: 0, error: err instanceof Error ? err.message : String(err) };
  }
}

async function main() {
  const urls = collectUrls();
  const entries = [...urls.entries()].sort(([a], [b]) => a.localeCompare(b));
  const results = [];

  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= entries.length) return;
      const [url, citations] = entries[index];
      const probeResult = await probe(url);
      const status = probeResult.status;
      const verdict =
        status >= 200 && status < 400
          ? "ok"
          : SOFT_STATUSES.has(status)
            ? "blocked"
            : "dead";
      results.push({ url, status, verdict, citedBy: [...citations], error: probeResult.error });
      if (!asJson) {
        const label = verdict === "ok" ? "ok  " : verdict === "blocked" ? "wall" : "DEAD";
        process.stdout.write(`${label} ${String(status).padStart(3)} ${url}\n`);
      }
    }
  });
  await Promise.all(workers);

  results.sort((a, b) => a.url.localeCompare(b.url));
  const dead = results.filter((r) => r.verdict === "dead");
  const blocked = results.filter((r) => r.verdict === "blocked");

  if (asJson) {
    process.stdout.write(`${JSON.stringify({ checkedAt: new Date().toISOString(), total: results.length, dead, blocked, results }, null, 2)}\n`);
  } else {
    process.stdout.write(
      `\n${results.length} link(s) checked: ${results.length - dead.length - blocked.length} ok, ` +
        `${blocked.length} bot-walled, ${dead.length} dead.\n`,
    );
    for (const item of dead) {
      process.stdout.write(`  DEAD ${item.status || item.error} ${item.url}\n`);
      for (const citation of item.citedBy) process.stdout.write(`       cited by ${citation}\n`);
    }
    if (blocked.length > 0) {
      process.stdout.write(
        "\nBot-walled links are not failures — SAP's CDN refuses non-browser clients. Spot-check them by hand.\n",
      );
    }
  }

  process.exit(strict && dead.length > 0 ? 1 : 0);
}

main().catch((err) => {
  process.stderr.write(`check-knowledge-links: ${err instanceof Error ? err.stack : String(err)}\n`);
  process.exit(2);
});
