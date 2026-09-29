#!/usr/bin/env node
/* Generate the abapGit-format repo for the TRL proof of the safe-agent demo.
   Follows ~/projects/abapd-trainer/bridge/build-abapgit-repo.mjs conventions (DECISION.md gotchas):
   .abapgit.xml root <asx:abap>; UTF-8 BOM on .xml only; XML-escaped descriptions; source lines <= 255.
   Objects are the task 05/06 baseline + solution classes renamed into the owner-authorized ZLV_ namespace.
   Usage: node build-abapgit-repo.mjs [OUT_DIR] [--with-prog]
     --with-prog  also emit task 03's classic report as ZLV_NWB_STOCK_REPORT (PROG; expected to be
                  rejected by ABAP Cloud) - pushed as a SEPARATE second commit so it cannot block the classes. */
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS = join(HERE, "..", "tasks");
const args = process.argv.slice(2);
const WITH_PROG = args.includes("--with-prog");
const ROOT = args.find((a) => !a.startsWith("--")) || join(homedir(), "projects/nwb-safe-agent-demo");
const SRC = join(ROOT, "src");
rmSync(SRC, { recursive: true, force: true });   // clean only src/, preserve .git/
mkdirSync(SRC, { recursive: true });
const BOM = "﻿";
const writeXml = (p, s) => writeFileSync(p, BOM + s);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const checkLines = (name, s) => s.split("\n").forEach((l, i) => { if (l.length > 255) throw new Error(`${name}:${i + 1} exceeds 255 chars`); });

export const CLASSES = [
  { name: "ZLV_NWB_DISCOUNT", from: "zcl_nwb_discount", task: "05-discount-boundary", variant: "solution", descr: "NWB demo t05 discount - solution (>= 10)" },
  { name: "ZLV_NWB_DISCOUNT_B", from: "zcl_nwb_discount", task: "05-discount-boundary", variant: "baseline", descr: "NWB demo t05 discount - baseline (> 10 bug)" },
  { name: "ZLV_NWB_RATING", from: "zcl_nwb_rating", task: "06-refactor-regression", variant: "solution", descr: "NWB demo t06 rating - solution (1..5 only)" },
  { name: "ZLV_NWB_RATING_B", from: "zcl_nwb_rating", task: "06-refactor-regression", variant: "baseline", descr: "NWB demo t06 rating - baseline (no filter)" },
];
export const PROG = { name: "ZLV_NWB_STOCK_REPORT", from: "znwb_stock_report", task: "03-classic-report", variant: "baseline", descr: "NWB demo t03 classic report - baseline" };

const rename = (src, from, to) => src.replace(new RegExp(`\\b${from}\\b`, "gi"), to.toLowerCase());

const clasXml = (name, descr) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_CLAS" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <VSEOCLASS>
    <CLSNAME>${name}</CLSNAME>
    <LANGU>E</LANGU>
    <DESCRIPT>${esc(descr)}</DESCRIPT>
    <STATE>1</STATE>
    <CLSCCINCL>X</CLSCCINCL>
    <FIXPT>X</FIXPT>
    <UNICODE>X</UNICODE>
    <WITH_UNIT_TESTS>X</WITH_UNIT_TESTS>
   </VSEOCLASS>
  </asx:values>
 </asx:abap>
</abapGit>`;

const progXml = (name, descr) => `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_PROG" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <PROGDIR>
    <NAME>${name}</NAME>
    <SUBC>1</SUBC>
    <RLOAD>E</RLOAD>
    <FIXPT>X</FIXPT>
    <UCCHECK>X</UCCHECK>
   </PROGDIR>
   <TPOOL>
    <item>
     <ID>R</ID>
     <ENTRY>${esc(descr)}</ENTRY>
     <LENGTH>${descr.length}</LENGTH>
    </item>
   </TPOOL>
  </asx:values>
 </asx:abap>
</abapGit>`;

writeXml(join(ROOT, ".abapgit.xml"), `<?xml version="1.0" encoding="utf-8"?>
<asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
 <asx:values>
  <DATA>
   <MASTER_LANGUAGE>E</MASTER_LANGUAGE>
   <STARTING_FOLDER>/src/</STARTING_FOLDER>
   <FOLDER_LOGIC>PREFIX</FOLDER_LOGIC>
   <IGNORE>
    <item>/.gitignore</item>
    <item>/LICENSE</item>
    <item>/README.md</item>
   </IGNORE>
  </DATA>
 </asx:values>
</asx:abap>`);

writeXml(join(SRC, "package.devc.xml"), `<?xml version="1.0" encoding="utf-8"?>
<abapGit version="v1.0.0" serializer="LCL_OBJECT_DEVC" serializer_version="v1.0.0">
 <asx:abap xmlns:asx="http://www.sap.com/abapxml" version="1.0">
  <asx:values>
   <DEVC>
    <CTEXT>${esc("Northwind Bikes safe-agent demo (synthetic)")}</CTEXT>
   </DEVC>
  </asx:values>
 </asx:abap>
</abapGit>`);

for (const c of CLASSES) {
  const base = join(TASKS, c.task, c.variant, c.from);
  const main = rename(readFileSync(base + ".clas.abap", "utf8"), c.from, c.name);
  const tests = rename(readFileSync(base + ".clas.testclasses.abap", "utf8"), c.from, c.name);
  checkLines(c.name, main); checkLines(c.name + " tests", tests);
  const f = c.name.toLowerCase();
  writeFileSync(join(SRC, f + ".clas.abap"), main);
  writeFileSync(join(SRC, f + ".clas.testclasses.abap"), tests);
  writeXml(join(SRC, f + ".clas.xml"), clasXml(c.name, c.descr));
}
if (WITH_PROG) {
  const src = rename(readFileSync(join(TASKS, PROG.task, PROG.variant, PROG.from + ".prog.abap"), "utf8"), PROG.from, PROG.name);
  checkLines(PROG.name, src);
  const f = PROG.name.toLowerCase();
  writeFileSync(join(SRC, f + ".prog.abap"), src);
  writeXml(join(SRC, f + ".prog.xml"), progXml(PROG.name, PROG.descr));
}

writeFileSync(join(ROOT, "README.md"), `# nwb-safe-agent-demo

**Synthetic demo code.** "Northwind Bikes" and every line here are invented for the
[abap-mcp](https://github.com/palimkarakshay/abap-mcp) "Can an AI agent safely change ABAP?" demo
(\`demo/safe-agent\`). No client or employer code.

abapGit repo pulled into a personal SAP BTP ABAP *trial* package (\`ZLV_NWBDEMO\`) to run the demo's
ABAP Unit tests on a real ABAP Cloud system:

| Object | Source | Expected ABAP Unit |
|---|---|---|
| \`ZLV_NWB_DISCOUNT\` | task 05 solution | 3/3 pass |
| \`ZLV_NWB_DISCOUNT_B\` | task 05 baseline (planted \`> 10\` boundary bug) | 2/3 (AT_THRESHOLD fails) |
| \`ZLV_NWB_RATING\` | task 06 solution | 2/2 pass |
| \`ZLV_NWB_RATING_B\` | task 06 baseline (lost the 1..5 filter) | 1/2 (AVERAGES_VALID_ONLY fails) |
${WITH_PROG ? "| `ZLV_NWB_STOCK_REPORT` | task 03 baseline classic report (PROG) | expected: rejected by ABAP Cloud |\n" : ""}
Generated by \`demo/safe-agent/trl/build-abapgit-repo.mjs\` in abap-mcp. MIT licensed.
`);
writeFileSync(join(ROOT, "LICENSE"), `MIT License

Copyright (c) 2026 Akshay Palimkar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`);
console.log(`Generated abapGit repo at ${ROOT}: ${CLASSES.length} classes${WITH_PROG ? " + 1 PROG" : ""} + package`);
