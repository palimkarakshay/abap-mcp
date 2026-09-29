#!/usr/bin/env node
/* Run ABAP Unit ON THE TRIAL for the four ZLV_NWB* classes (read-only: a test run changes nothing).
   Raw POST to /sap/bc/adt/abapunit/testruns with the same run configuration abap-adt-api's unitTestRun() sends;
   the XML response is saved verbatim to raw/aunit-<class>.xml and a parsed summary to raw/aunit-summary.json.
   Usage: node run-unit.mjs [CLASS ...] */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
process.env.SAP_APP_PACKAGE = "ZLV_NWBDEMO";
const { adtRest } = await import("/home/akshay/projects/lumivara-fifa/sap/tools/adt.mjs");
const RAW = join(dirname(fileURLToPath(import.meta.url)), "raw");
mkdirSync(RAW, { recursive: true });

const CLASSES = process.argv.slice(2).length ? process.argv.slice(2) : ["ZLV_NWB_DISCOUNT", "ZLV_NWB_DISCOUNT_B", "ZLV_NWB_RATING", "ZLV_NWB_RATING_B"];
const runConfig = (uri) => `<?xml version="1.0" encoding="UTF-8"?>
<aunit:runConfiguration xmlns:aunit="http://www.sap.com/adt/aunit">
  <external><coverage active="false"/></external>
  <options>
    <uriType value="semantic"/>
    <testDeterminationStrategy sameProgram="true" assignedTests="false"/>
    <testRiskLevels harmless="true" dangerous="true" critical="true"/>
    <testDurations short="true" medium="true" long="true"/>
    <withNavigationUri enabled="true"/>
  </options>
  <adtcore:objectSets xmlns:adtcore="http://www.sap.com/adt/core">
    <objectSet kind="inclusive">
      <adtcore:objectReferences><adtcore:objectReference adtcore:uri="${uri}"/></adtcore:objectReferences>
    </objectSet>
  </adtcore:objectSets>
</aunit:runConfiguration>`;
const attr = (s, a) => (s.match(new RegExp(`${a}="([^"]*)"`)) || [])[1];
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const summary = { runAt: new Date().toISOString(), classes: [] };
for (const cls of CLASSES) {
  const uri = `/sap/bc/adt/oo/classes/${cls.toLowerCase()}`;
  const r = await adtRest("POST", "/sap/bc/adt/abapunit/testruns", runConfig(uri), "application/*", "application/*");
  writeFileSync(join(RAW, `aunit-${cls.toLowerCase()}.xml`), r.text);
  const methods = [];
  for (const m of r.text.matchAll(/<testMethod\b([^>]*)>([\s\S]*?)<\/testMethod>|<testMethod\b([^>]*)\/>/g)) {
    const head = m[1] || m[3], body = m[2] || "";
    const alerts = [...body.matchAll(/<alert\b([^>]*)>([\s\S]*?)<\/alert>/g)].map((a) => ({
      kind: attr(a[1], "kind"), severity: attr(a[1], "severity"),
      title: unesc((a[2].match(/<title>([\s\S]*?)<\/title>/) || [])[1] || ""),
      details: [...a[2].matchAll(/<detail text="([^"]*)"/g)].map((d) => unesc(d[1])),
    }));
    methods.push({ method: attr(head, "adtcore:name"), executionTime: attr(head, "executionTime"), result: alerts.some((a) => /failedAssertion|exception|error/i.test(a.kind + a.severity)) ? "FAIL" : "PASS", alerts });
  }
  const pass = methods.filter((m) => m.result === "PASS").length;
  summary.classes.push({ class: cls, uri, httpStatus: r.status, passed: pass, total: methods.length, methods });
  console.log(`${cls}: HTTP ${r.status} ${pass}/${methods.length}`);
  for (const m of methods) console.log(`  ${m.result} ${m.method}${m.alerts.length ? "  " + m.alerts.map((a) => `[${a.kind}/${a.severity}] ${a.title} | ${a.details.join(" | ")}`).join(" ; ") : ""}`);
}
writeFileSync(join(RAW, "aunit-summary.json"), JSON.stringify(summary, null, 2));
