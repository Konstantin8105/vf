/* test/cover.js - line-coverage report for the js/*.js sources.
   Runs every *.test.js in a child process with NODE_V8_COVERAGE, then maps
   the V8 coverage ranges (which the harness attributes to the real source
   files) onto source lines. Usage: node test/cover.js */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const dir = __dirname;
const base = path.join(dir, "..");
const jsDir = path.join(base, "js");
const suites = fs.readdirSync(dir).filter(f => /\.test\.js$/.test(f)).sort();

const covDir = fs.mkdtempSync(path.join(os.tmpdir(), "f3dd-cov-"));
for (const f of suites) {
  spawnSync(process.execPath, [path.join(dir, f)], {
    stdio: "ignore",
    env: Object.assign({}, process.env, { NODE_V8_COVERAGE: covDir })
  });
}

/* aggregate ranges per source file */
const rangesByFile = {};
for (const jf of fs.readdirSync(covDir)) {
  if (!/\.json$/.test(jf)) continue;
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(covDir, jf), "utf8")); } catch (e) { continue; }
  for (const res of (data.result || [])) {
    const m = /\/js\/([A-Za-z0-9_.-]+\.js)$/.exec(String(res.url || ""));
    if (!m) continue;
    const key = m[1];
    const list = rangesByFile[key] || (rangesByFile[key] = []);
    for (const fn of (res.functions || [])) {
      for (const rg of (fn.ranges || [])) {
        if (typeof rg.startOffset === "number" && typeof rg.endOffset === "number") {
          list.push({ s: rg.startOffset, e: rg.endOffset, c: rg.count });
        }
      }
    }
  }
}

function lineStartsOf(src) {
  const ls = [0];
  for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) ls.push(i + 1);
  return ls;
}
function lineOf(ls, off) {
  let lo = 0, hi = ls.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ls[mid] <= off) lo = mid; else hi = mid - 1; }
  return lo;
}

function coverageOf(src, ranges) {
  const ls = lineStartsOf(src);
  const n = ls.length;
  let exec = 0, covered = 0;
  const uncovLines = [];
  for (let l = 0; l < n; l++) {
    const off = ls[l];
    let inner = null;
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      if (off >= r.s && off < r.e && (!inner || (r.e - r.s) < (inner.e - inner.s))) inner = r;
    }
    if (!inner) continue;               /* not executable (blank / comment) */
    exec++;
    if (inner.c > 0) covered++; else uncovLines.push(l + 1);
  }
  return { exec, covered, uncovLines };
}

let tExec = 0, tCov = 0;
const rows = [];
for (const name of fs.readdirSync(jsDir).filter(f => /\.js$/.test(f)).sort()) {
  const src = fs.readFileSync(path.join(jsDir, name), "utf8");
  const ranges = rangesByFile[name] || [];
  const c = coverageOf(src, ranges);
  tExec += c.exec; tCov += c.covered;
  rows.push({ name, exec: c.exec, covered: c.covered, pct: c.exec ? (100 * c.covered / c.exec) : 0 });
}

console.log("Line coverage (js/*.js):");
for (const r of rows) {
  console.log("  " + r.name.padEnd(16) + String(Math.round(r.pct * 10) / 10).padStart(6) + "%   (" + r.covered + "/" + r.exec + ")");
}
console.log("  " + "TOTAL".padEnd(16) + String(Math.round(1000 * tCov / (tExec || 1)) / 10).padStart(6) + "%   (" + tCov + "/" + tExec + ")");
fs.rmSync(covDir, { recursive: true, force: true });
