/* util.js - shared helpers for the Frame3DD viewer (no external libraries).
   Exposes a single global namespace object `App` consumed by all other scripts. */
"use strict";

var App = {};

/* ---- DOM helpers -------------------------------------------------- */
App.$ = function (sel, root) { return (root || document).querySelector(sel); };
App.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

App.num = function (id, def) {
  var e = document.getElementById(id);
  if (!e) return def;
  var v = parseFloat(String(e.value).replace(",", "."));
  return isFinite(v) ? v : def;
};

App.h = function (tag, attrs, text) {
  var e = document.createElement(tag);
  if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
};

App.clear = function (el) { if (el) el.innerHTML = ""; };

/* ---- number field with shared behaviour --------------------------- */
/* Positive-only numeric input: mouse wheel multiplies/divides by 1.1 and
   the value is shown with at most two decimal places (very small values
   keep two significant digits). Pass `el` to wire an existing <input> or
   omit it to create one. `onChange(value)` is called with the clean value. */
App.numberField = function (opts) {
  opts = opts || {};
  var inp = opts.el || document.createElement("input");
  var allowZero = !!opts.allowZero;
  inp.type = "number";
  if (opts.id) inp.id = opts.id;
  inp.min = String(opts.min != null ? opts.min : (allowZero ? 0 : 0.000001));
  inp.step = String(opts.step != null ? opts.step : 0.01);
  inp.title = opts.title || ("Non-negative" + (allowZero ? "" : " and positive") + "; mouse wheel = \u00d7/1.1; at most 2 decimals.");
  var factor = opts.factor > 0 ? opts.factor : 1.1;
  function clean(v) {
    v = Number(String(v).replace(",", "."));
    if (!isFinite(v)) return null;
    if (v < 0) return null;
    if (v === 0) return allowZero ? 0 : null;
    if (v < 1e-6) v = 1e-6;
    if (v > 1e9) v = 1e9;
    return (v >= 0.01) ? Math.round(v * 100) / 100 : Number(v.toPrecision(2));
  }
  var start = clean(opts.value != null ? opts.value : inp.value);
  var last = (start == null) ? (allowZero ? 0 : 1) : start;
  if (inp.value === "" || inp.value == null) inp.value = String(last);
  function apply(v, write) {
    var c = clean(v);
    if (c == null) return false;
    last = c;
    if (write) inp.value = String(c);
    if (opts.onChange) opts.onChange(c);
    return true;
  }
  inp.addEventListener("input", function () {
    var c = clean(inp.value);
    if (c != null) { last = c; if (opts.onChange) opts.onChange(c); }
  });
  inp.addEventListener("change", function () { if (!apply(inp.value, true)) inp.value = String(last); });
  inp.addEventListener("wheel", function (ev) {
    if (ev.preventDefault) ev.preventDefault();
    var cur = clean(inp.value); if (cur == null) cur = last;
    apply((ev.deltaY || 0) < 0 ? cur * factor : cur / factor, true);
  });
  return inp;
};

/* ---- number / text formatting ------------------------------------- */
App.fmt = function (v, d) {
  if (v === null || v === undefined || !isFinite(v)) return "-";
  d = (d === undefined) ? 2 : d;
  var a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a > 1e7)) return v.toExponential(3);
  return v.toFixed(d);
};

/* Compact table cell formatter: up to 6 significant digits, exponential
   for very small/large magnitudes, no locale grouping. */
App.cell = function (v) {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") {
    if (!isFinite(v)) return "-";
    if (v === 0) return "0";
    var r = Number(v.toPrecision(6));
    return String(r);
  }
  return String(v);
};

/* ---- numeric sanitizer -------------------------------------------- */
/* Accepts signed decimals, scientific notation with E/e or D/d exponents,
   comma decimal separators and the trailing 't'/'c' tension/compression
   flag that Frame3DD appends to the axial force Nx. Returns NaN if the
   token is not a number. */
App.sanitizeNum = function (s) {
  if (s === null || s === undefined) return NaN;
  s = String(s).trim();
  if (!s) return NaN;
  s = s.replace(/[\u2212]/g, "-");                 /* unicode minus */
  s = s.replace(/[tTcC]$/, "");                    /* tension/compression flag */
  if (s.indexOf(",") >= 0 && s.indexOf(".") < 0) s = s.replace(",", ".");
  s = s.replace(/([0-9.])[dD]([+-]?[0-9]+)\s*$/, "$1e$2");  /* Fortran D exponent */
  var v = parseFloat(s);
  return isFinite(v) ? v : NaN;
};

/* true when a plain numeric token (used by the .3dd input tokenizer) */
App.isNumToken = function (s) {
  if (s === null || s === undefined) return false;
  s = String(s).trim();
  if (!s) return false;
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eEdD][+-]?\d+)?$/.test(s);
};

/* ---- color map (blue -> red) -------------------------------------- */
App.colormap = function (t) {
  if (!isFinite(t)) t = 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  var hue = (1 - t) * 240;                 /* 240 = blue, 0 = red */
  return "hsl(" + hue.toFixed(1) + ",80%,48%)";
};

/* ---- diverging value -> colour scale ------------------------------- */
/* Standard mapping: minimum (negative) = red, zero = blue, maximum
   (positive) = green. For an all-non-negative range zero stays blue and
   the maximum is green; for an all-non-positive range it is red -> blue. */
function hex2rgb(h) {
  h = String(h).replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}
function lerpHex(a, b, t) {
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  var A = hex2rgb(a), B = hex2rgb(b);
  return "rgb(" + Math.round(A[0] + (B[0] - A[0]) * t) + "," +
    Math.round(A[1] + (B[1] - A[1]) * t) + "," + Math.round(A[2] + (B[2] - A[2]) * t) + ")";
}
App.scaleColors = function () {
  var s = (App.colors && App.colors.scale) || {};
  return { min: s.min || "#d9534f", mid: s.mid || "#2f6fb8", max: s.max || "#3f8f3a" };
};
App.colorScale = function (v, min, max) {
  var sc = App.scaleColors();
  if (!isFinite(v)) return sc.mid;
  if (!isFinite(min)) min = v;
  if (!isFinite(max)) max = v;
  if (min > max) { var t = min; min = max; max = t; }
  if (min >= 0) return lerpHex(sc.mid, sc.max, (max > min) ? (v - min) / (max - min) : 0);
  if (max <= 0) return lerpHex(sc.min, sc.mid, (max > min) ? (v - min) / (max - min) : 0);
  if (v < 0) return lerpHex(sc.min, sc.mid, (v - min) / (0 - min));
  return lerpHex(sc.mid, sc.max, max > 0 ? v / max : 0);
};
/* a CSS gradient that matches colorScale over [min,max] */
App.scaleGradient = function (min, max, n) {
  n = n || 9;
  var stops = [];
  for (var i = 0; i <= n; i++) stops.push(App.colorScale(min + (max - min) * i / n, min, max));
  return "linear-gradient(90deg," + stops.join(",") + ")";
};

/* ---- tables -------------------------------------------------------- */
/* columns: array of header strings.
   rows:    array of arrays (cells already stringified via App.cell).
   The table is wrapped in a scrollable container. */
App.table = function (host, columns, rows, opts) {
  var e = (typeof host === "string") ? document.getElementById(host) : host;
  if (!e) return;
  App.clear(e);
  opts = opts || {};
  if (!rows || !rows.length) {
    e.appendChild(App.h("div", { "class": "empty" }, opts.empty || "No data."));
    return;
  }
  var wrap = App.h("div", { "class": "tblwrap" });
  var t = App.h("table", { "class": "data" });
  var thead = App.h("thead");
  var trh = App.h("tr");
  for (var c = 0; c < columns.length; c++) trh.appendChild(App.h("th", null, columns[c]));
  thead.appendChild(trh);
  t.appendChild(thead);
  var tb = App.h("tbody");
  var clickable = typeof opts.onSelect === "function";
  var selFn = (typeof opts.selected === "function") ? opts.selected : null;
  var selVal = opts.selected;
  for (var r = 0; r < rows.length; r++) {
    var tr = App.h("tr");
    var row = rows[r];
    if (clickable) {
      tr.className = "selectable";
      if (opts.rowKey && selVal !== undefined) {
        var isSel = selFn ? !!selFn(row) : (opts.rowKey(row) === selVal);
        if (isSel) tr.className += " sel";
      }
    }
    for (var k = 0; k < columns.length; k++) {
      var td = App.h("td", { "class": (k === 0 ? "idc" : "numc") }, App.cell(row[k]));
      tr.appendChild(td);
    }
    if (clickable) (function (rw) {
      tr.addEventListener("click", function (ev) { opts.onSelect(rw, ev || {}); });
    })(row);
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  wrap.appendChild(t);
  e.appendChild(wrap);
  if (opts.note) e.appendChild(App.h("div", { "class": "note" }, opts.note));
};

/* ---- key/value blocks (Overview) ---------------------------------- */
/* rows = [[label, value, note]] with null spacer or string section header */
App.kv = function (host, rows) {
  var e = (typeof host === "string") ? document.getElementById(host) : host;
  if (!e) return;
  var t = App.h("table", { "class": "kv" });
  var tb = App.h("tbody");
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r === null) { tb.appendChild(App.h("tr", { "class": "sp" })); continue; }
    if (typeof r === "string") { tb.appendChild(App.h("tr", { "class": "secr" }, r)); continue; }
    var tr = App.h("tr");
    tr.appendChild(App.h("td", { "class": "kr" }, r[0]));
    tr.appendChild(App.h("td", { "class": "kv2" }, r[1] === null || r[1] === undefined ? "-" : String(r[1])));
    tr.appendChild(App.h("td", { "class": "kn" }, r[2] || ""));
    tb.appendChild(tr);
  }
  t.appendChild(tb);
  e.appendChild(t);
};
