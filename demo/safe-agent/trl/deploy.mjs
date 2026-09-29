#!/usr/bin/env node
/* Deploy the NWB safe-agent demo objects into ZLV_NWBDEMO on the SAP BTP ABAP trial via abapGit (headless).
   Reuses the lumivara-fifa sap/tools connection seam (conn.mjs/adt.mjs, bearer from ~/.abapd-token.json)
   and the abapd-trainer guardrails (owned namespaces, <=25 objects/run, >=60 s polling).
   Usage: node deploy.mjs <step> [tag]
     package   registerPackage + create ZLV_NWBDEMO (ZLOCAL super/software component) via create-package.mjs
     link      gitCreateRepo(ZLV_NWBDEMO, github.com/palimkarakshay/nwb-safe-agent-demo)
     pull      gitPullRepo + poll (60 s) until the repo is idle, then save the deserialize log to raw/pull-<tag>-log.*
     activate  activate any inactive ZLV_NWB* objects
     status    print repo entry + which objects exist (read-only) */
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = "ZLV_NWBDEMO";
const REPO = "https://github.com/palimkarakshay/nwb-safe-agent-demo.git";
const BRANCH = "refs/heads/main";
const OBJECTS = ["ZLV_NWB_DISCOUNT", "ZLV_NWB_DISCOUNT_B", "ZLV_NWB_RATING", "ZLV_NWB_RATING_B", "ZLV_NWB_STOCK_REPORT"];
const TOOLS = "/home/akshay/projects/lumivara-fifa/sap/tools";
const GUARD = "/home/akshay/projects/abapd-trainer/bridge/guardrails.mjs";
const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, "raw");
mkdirSync(RAW, { recursive: true });
process.env.SAP_APP_PACKAGE = PKG;

const guard = await import(GUARD);
const [step = "status", tag = "1"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (OBJECTS.length > guard.LIMITS.maxObjectsPerRun) throw new Error("GUARDRAIL: too many objects");
OBJECTS.forEach(guard.assertOwnedObject);

if (step === "package") {
  guard.registerPackage(PKG);
  guard.assertCanWrite(PKG);
  console.log(guard.banner());
  const out = execFileSync("node", [join(TOOLS, "create-package.mjs")], {
    env: { ...process.env, SAP_APP_PACKAGE: PKG, SAP_APP_PACKAGE_DESC: "Northwind Bikes safe-agent demo (synthetic)" }, encoding: "utf8",
  });
  console.log(out);
  process.exit(0);
}

const { connect, adtRest } = await import(join(TOOLS, "adt.mjs"));   // connect() asserts assertCanWrite(PKG)
const c = await connect();
const repoEntry = async () => (await c.gitRepos()).find((r) => r.sapPackage === PKG);
async function present() {
  const found = [];
  for (const n of OBJECTS) {
    const r = await c.searchObject(n, undefined, 5).catch(() => []);
    const hit = (r || []).find((o) => (o["adtcore:name"] || "").toUpperCase() === n);
    if (hit) found.push(`${n} (${hit["adtcore:type"]})`);
  }
  return found;
}
const brief = (r) => r && JSON.stringify({ key: r.key, status: r.status, status_text: r.status_text, branch: r.branch_name, created_by: r.created_by, deserialized_at: r.deserialized_at, deserialized_by: r.deserialized_by });

if (step === "link") {
  guard.assertCanWrite(PKG);
  const existing = await repoEntry();
  if (existing) { console.log("already linked:", brief(existing)); process.exit(0); }
  try { await c.gitCreateRepo(PKG, REPO, BRANCH, "", "", ""); console.log("✓ gitCreateRepo"); }
  catch (e) { console.log("gitCreateRepo:", String(e.message || e).slice(0, 400)); }
  console.log("repo:", brief(await repoEntry()));
} else if (step === "pull") {
  guard.assertCanWrite(PKG);
  const r0 = await repoEntry();
  if (!r0) throw new Error("repo not linked - run `link` first");
  console.log("before:", brief(r0));
  try { await c.gitPullRepo(r0.key, BRANCH, "", "", ""); console.log("✓ pull triggered", new Date().toISOString()); }
  catch (e) { console.log("pull returned:", String(e.message || e).slice(0, 400)); }
  let r = r0;
  for (let i = 1; i <= 6; i++) {
    await sleep(guard.LIMITS.minPollSeconds * 1000);          // fair use: >= 60 s between polls
    r = await repoEntry();
    const found = await present();
    console.log(`[${i * 60}s] ${brief(r)} | present: ${found.join(", ") || "(none)"}`);
    if (r.status !== "R" && String(r.deserialized_at) !== String(r0.deserialized_at)) break;
  }
  writeFileSync(join(RAW, `pull-${tag}-repo.json`), JSON.stringify(r, null, 2));
  const log = (r.links || []).find((l) => l.type === "log_link" || /log/.test(l.rel || ""));
  if (log) {
    const res = await adtRest("GET", log.href, undefined, "application/*", "application/*");
    writeFileSync(join(RAW, `pull-${tag}-log.xml`), res.text);
    console.log(`log ${log.href} -> ${res.status}`);
    const rows = [...res.text.matchAll(/<abapObject>([\s\S]*?)<\/abapObject>|<abapgitobject:abapObject[^>]*>([\s\S]*?)<\/abapgitobject:abapObject>/g)];
    console.log(res.text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3000), rows.length);
  } else console.log("no log_link on repo entry; links:", JSON.stringify(r.links));
} else if (step === "activate") {
  const recs = (await c.inactiveObjects()) || [];
  const objs = recs.map((x) => x.object).filter(Boolean).filter((o) => /^ZLV_NWB/i.test(o["adtcore:name"] || ""));
  objs.forEach((o) => guard.assertOwnedObject(o["adtcore:name"]));
  if (!objs.length) { console.log("nothing inactive for ZLV_NWB*"); process.exit(0); }
  const a = await c.activate(objs);
  console.log("activate", objs.map((o) => o["adtcore:name"]).join(", "), "success=", a.success);
  for (const m of a.messages || []) console.log(" ", m.type, m.objDescr, "::", m.shortText);
} else {
  console.log("repo:", brief(await repoEntry()));
  console.log("present:", (await present()).join(", ") || "(none)");
}
