/* test/harness.js - shared headless DOM stub and script loader for the
   Frame3DD viewer tests. Loads the six application scripts exactly as the
   browser would (classic <script> globals) inside a `new Function` scope,
   and returns the resulting `App` namespace plus small DOM helpers. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const examples = path.join(base, "frame3dd", "examples");

function makeEl(tag) {
  const el = {
    tagName: (tag || "div").toUpperCase(),
    children: [], _h: {}, style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } },
    attributes: {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k]; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    contains(c) { return this.children.indexOf(c) >= 0; },
    addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); },
    dispatch(t, ev) { (this._h[t] || []).forEach(f => f.call(this, ev || {})); },
    closest() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getContext() { return ctxStub(); },
    getBoundingClientRect() { return { left: 10, top: 8, right: 110, bottom: 30, width: 100, height: 22 }; },
    clientWidth: 800, clientHeight: 500, width: 800, height: 500,
    value: "", checked: false, disabled: false, textContent: "", _html: "", parentNode: null
  };
  Object.defineProperty(el, "innerHTML", {
    get() { return this._html; },
    set(v) { this._html = v; this.children = []; }
  });
  return el;
}
function ctxStub() {
  const noop = () => {};
  return {
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, fill: noop, stroke: noop,
    arc: noop, save: noop, restore: noop, measureText: () => ({ width: 12 }), fillText: noop,
    lineJoin: "", font: "", fillStyle: "", strokeStyle: "", lineWidth: 1
  };
}

/* load the application scripts into a fresh stub world */
function loadApp() {
  const registry = {};
  const classIndex = {};
  function getEl(id) { return registry[id] || (registry[id] = makeEl("div")); }
  function registerClass(el, cls) { (classIndex[cls] = classIndex[cls] || []).push(el); }
  const document = {
    readyState: "complete",
    _h: {},
    addEventListener(t, f) { (this._h[t] = this._h[t] || []).push(f); },
    dispatch(t, ev) { (this._h[t] || []).forEach(f => f(ev || {})); },
    getElementById: getEl,
    querySelector() { return null; },
    querySelectorAll(sel) {
      sel = String(sel == null ? "" : sel).trim();
      if (sel.indexOf(".") === 0 && sel.indexOf(" ") < 0) return classIndex[sel.slice(1)] || [];
      return [];
    },
    createElement(tag) { return makeEl(tag); }
  };
  /* the two Preprocessing/Postprocessing mode buttons (index.html static DOM) */
  ["pre", "post"].forEach(function (m) {
    var b = makeEl("button");
    b.setAttribute("data-mode", m);
    b.classList.add("modebtn");
    registry["mode-" + m] = b;
    registerClass(b, "modebtn");
  });
  document.body = makeEl("body");
  const windowListeners = {};
  const windowStub = {
    addEventListener: function (t, f) { (windowListeners[t] = windowListeners[t] || []).push(f); },
    removeEventListener: function (t, f) { var a = windowListeners[t] || []; var i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
    dispatch: function (t, ev) { (windowListeners[t] || []).forEach(function (f) { f(ev || {}); }); },
    innerWidth: 1200, innerHeight: 800
  };
  const requestAnimationFrame = () => {};
  function FileReader() {}
  FileReader.prototype.readAsText = function (file) {
    this.result = file._text;
    if (this.onload) this.onload();
  };

  const files = ["js/util.js", "js/theme.js", "js/engine3d.js", "js/parser3dd.js", "js/parserout.js", "js/viewer.js", "js/app.js"];
  const g = globalThis;
  /* keep the stubs as globals: the app binds handlers that use document /
     FileReader at run time, and V8 coverage needs the real filenames */
  g.document = document; g.window = windowStub;
  g.requestAnimationFrame = requestAnimationFrame; g.FileReader = FileReader;
  files.forEach(function (f) {
    const code = fs.readFileSync(path.join(base, f), "utf8");
    vm.runInThisContext(code, { filename: path.join(base, f) });
  });
  return { App: g.App, document, window: windowStub, getEl, makeEl, textOf };
}

function textOf(el) { let s = el.textContent || ""; (el.children || []).forEach(c => { s += textOf(c); }); return s; }

function readExample(name) { return fs.readFileSync(path.join(examples, name), "utf8"); }

function makeReporter() {
  let fails = 0;
  function ok(cond, msg) { if (!cond) { fails++; console.log("FAIL: " + msg); } else console.log("ok  : " + msg); }
  function done() { console.log("\n" + (fails ? fails + " FAILURES" : "ALL PASS")); return fails; }
  function getFails() { return fails; }
  return { ok, done, getFails };
}

module.exports = { loadApp, makeEl, ctxStub, textOf, readExample, examples, base, makeReporter };
