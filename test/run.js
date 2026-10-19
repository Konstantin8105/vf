/* test/run.js - run every headless Frame3DD viewer test suite in-process
   isolation (each file is a standalone script that exits non-zero on
   failure). Usage: node test/run.js */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const suites = fs.readdirSync(dir)
  .filter(f => /\.test\.js$/.test(f))
  .sort();

let failed = 0;
for (const f of suites) {
  console.log("\n=== " + f + " ===");
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: "inherit" });
  if (r.status !== 0) failed++;
}
console.log("\n" + (failed ? failed + " SUITE(S) FAILED" : "ALL SUITES PASS"));
process.exit(failed ? 1 : 0);
