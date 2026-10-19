/* app.js - application state, file loading, tables and controls. */
(function () {
  "use strict";

  var State = {
    model: null,
    results: null,
    warnings: [],
    inputText: null,
    outputText: null,
    inputName: "",
    outputName: "",
    playing: false,
    mode: "pre",
    loadSeq: 0,
    modelSig: null,
    sel: { nodes: {}, elems: {} },
    vis: { hiddenNodes: {}, hiddenElems: {} },
    measure: { active: false, mode: "distance", points: [], done: [] },
    lastTab: { pre: "tab-nodes", post: "tab-disp" },
    opts: {
      caseIndex: 0,
      modeIndex: 0,
      combined: false,
      modeWeights: {},
      modeEnabled: {},
      time: 0,
      speed: 0.1,
      orientation: "auto",
      projection: "persp",
      scale: 1,
      showUndeformed: true,
      showDeformed: true,
      showNodes: true,
      showNodeLabels: false,
      showElements: true,
      showElemLabels: false,
      showLoads: true,
      showNodalLoads: true,
      showUniformLoads: true,
      showTrapezoidLoads: true,
      showPointLoads: true,
      showMomentLoads: true,
      showPrescribed: true,
      modalInput: false,
      showNodeInertia: true,
      showElemMass: true,
      showCondensation: true,
      showGravity: true,
      showStiffness: true,
      showRestraints: true,
      showLocalAxes: false,
      showPrincipalAxis: false,
      showHinges: true,
      showDiagrams: false,
      diagramKind: "Mzz",
      diagramLabels: false,
      ghostHidden: false,
      selectedNodes: [],
      selectedElems: [],
      sizes: { force: 0.45, moment: 0.95, support: 0.7, diagram: 0.3, axes: 0.5 },
      showGrid: true,
      showAxes: true,
      colorBy: "temperature",
      phase: 0
    }
  };

  var engine = null;
  var dom = {};

  /* ---- helpers ------------------------------------------------------- */
  function id(x) { return document.getElementById(x); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function caseOf(list, idx) {
    if (!list) return null;
    for (var i = 0; i < list.length; i++) if (list[i].index === idx) return list[i];
    return list.length ? list[0] : null;
  }
  function number(v, d) { return App.fmt(v, d === undefined ? 3 : d); }

  function showMessage(msg, warn) {
    var e = dom.errbar;
    if (!msg) { e.className = "errbar"; e.textContent = ""; return; }
    e.className = "errbar show" + (warn ? " warn" : "");
    e.textContent = msg;
  }

  /* ---- engine -------------------------------------------------------- */
  function getScene() { return App.buildScene(State); }

  function sizeCanvas() {
    if (!engine) return;
    var wrap = dom.canvasWrap;
    var w = wrap.clientWidth || 640;
    var h = wrap.clientHeight || Math.max(320, Math.round(w * 0.62));
    engine.resize(w, h);
  }

  /* ---- selection state (driven from the menus) ---------------------- */
  function availableCases() {
    if (State.model && State.model.loadCases.length) return State.model.loadCases;
    if (State.results && State.results.loadCases.length) return State.results.loadCases;
    return [];
  }
  function populateCases() {
    var cases = availableCases();
    if (!cases.length) { State.opts.caseIndex = 0; return; }
    var found = false;
    for (var i = 0; i < cases.length; i++) if (cases[i].index === State.opts.caseIndex) found = true;
    if (!found) State.opts.caseIndex = cases[0].index;
  }

  function modesHaveShapes() {
    return !!(State.results && State.results.modes && State.results.modes.length &&
      State.results.modes[0].shapes && State.results.modes[0].shapes.length);
  }
  /* grey out and disable every UI element that needs loaded results */
  function updateAvailability() {
    var have = !!State.results;
    App.$$("#tabs .tabbtn").forEach(function (b) {
      var off = b.getAttribute("data-needs") === "results" && !have;
      b.disabled = !!off;
      if (off) b.classList.add("disabled"); else b.classList.remove("disabled");
    });
    /* Postprocessing mode itself needs results */
    App.$$(".modebtn").forEach(function (b) {
      var off = b.getAttribute("data-mode") === "post" && !have;
      b.disabled = !!off;
      if (off) b.classList.add("disabled"); else b.classList.remove("disabled");
    });
    if (!have && State.mode === "post") setMode("pre");
    populateCaseModeSelect();
    var active = App.$$("#tabs .tabbtn").filter(function (b) { return b.classList.contains("active") && b.style.display !== "none"; })[0];
    if (active && active.disabled) {
      var alt = App.$$("#tabs .tabbtn").filter(function (b) { return b.style.display !== "none" && !b.disabled; })[0];
      if (alt) switchTab(alt.getAttribute("data-tab"));
    }
  }
  function availableModeCount() {
    if (State.results && State.results.modes.length) return State.results.modes.length;
    if (State.model && State.model.modal) return State.model.modal.nM;
    return 0;
  }
  function populateModes() {
    var n = availableModeCount();
    if (State.opts.modeIndex < 0 || State.opts.modeIndex > n) State.opts.modeIndex = 0;
    if (!modesHaveShapes()) { State.playing = false; State.opts.combined = false; }
    /* drop weights for modes that no longer exist, default new ones to 1 */
    var modes = (State.results && State.results.modes) || [];
    var known = {};
    for (var i = 0; i < modes.length; i++) known[modes[i].index] = 1;
    for (var k in State.opts.modeWeights) if (!known[k]) delete State.opts.modeWeights[k];
    for (var k2 in State.opts.modeEnabled) if (!known[k2]) delete State.opts.modeEnabled[k2];
    if (modesHaveShapes() && !Object.keys(State.opts.modeWeights).length) {
      for (i = 0; i < modes.length; i++) State.opts.modeWeights[modes[i].index] = 1;
    }
  }

  /* ---- load case / vibration mode combobox --------------------------- */
  function modalInputAvailable() {
    return !!(State.model && State.model.modal && State.model.modal.nM > 0);
  }
  function caseModeOptions() {
    var items = [], i;
    var cases = availableCases();
    for (i = 0; i < cases.length; i++) {
      items.push({ value: "c:" + cases[i].index, label: "Static Case " + cases[i].index });
    }
    if (State.mode === "pre") {
      if (modalInputAvailable()) {
        items.push({ value: "modal", label: "Modal analysis (" + State.model.modal.nM + " modes)" });
      }
    } else {
      var modes = (State.results && State.results.modes) || [];
      for (i = 0; i < modes.length; i++) {
        items.push({ value: "m:" + modes[i].index,
          label: "Mode " + modes[i].index + " (" + number(modes[i].freq, 4) + " Hz)" });
      }
      if (modesHaveShapes()) items.push({ value: "combined", label: "Combined (multi-mode)" });
    }
    return items;
  }
  function caseModeValue() {
    if (State.opts.modalInput) return "modal";
    if (State.opts.combined) return "combined";
    if (State.opts.modeIndex > 0) return "m:" + State.opts.modeIndex;
    return "c:" + State.opts.caseIndex;
  }
  function populateCaseModeSelect() {
    var sel = dom.caseMode;
    if (!sel) return;
    var items = caseModeOptions();
    App.clear(sel);
    if (!items.length) {
      sel.appendChild(App.h("option", { value: "" }, "(no load cases)"));
      sel.value = "";
      sel.disabled = true;
      return;
    }
    items.forEach(function (it) { sel.appendChild(App.h("option", { value: it.value }, it.label)); });
    sel.disabled = false;
    function has(v) {
      for (var i = 0; i < items.length; i++) if (items[i].value === v) return true;
      return false;
    }
    var want = caseModeValue();
    if (!has(want) && State.opts.modalInput) {
      State.opts.modalInput = false;
      want = caseModeValue();
    }
    if (!has(want)) want = items[0].value;
    sel.value = want;
  }

  function modeNotice() {
    if (State.opts.combined) {
      if (dom.status) dom.status.textContent = "Combined multi-mode animation. Static loads are hidden in mode view.";
      return;
    }
    if (State.opts.modeIndex === 0) { if (dom.status) dom.status.textContent = ""; return; }
    if (modesHaveShapes()) {
      if (dom.status) dom.status.textContent = "Animating mode " + State.opts.modeIndex + ". Static loads are hidden in mode view.";
      return;
    }
    if (dom.status) dom.status.textContent =
      "Mode " + State.opts.modeIndex + " selected, but this output has no mode-shape data.";
  }

  /* ---- tables -------------------------------------------------------- */
  function materialGroupCount(els) {
    if (!els || !els.length) return 0;
    var seen = {};
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      seen[[e.Ax, e.Asy, e.Asz, e.Jxx, e.Iyy, e.Izz, e.E, e.G, e.roll, e.density].join("|")] = 1;
    }
    return Object.keys(seen).length;
  }
  function supportTypeCount(reactions) {
    if (!reactions || !reactions.length) return 0;
    var seen = {};
    for (var i = 0; i < reactions.length; i++) {
      var r = reactions[i];
      if (!(r.Rx || r.Ry || r.Rz || r.Rxx || r.Ryy || r.Rzz)) continue;
      seen[App.supportKey(r)] = 1;
    }
    return Object.keys(seen).length;
  }

  function renderOverview() {
    var rows = [];
    if (State.model) {
      rows.push("Input model");
      rows.push(["File", State.inputName || "(none)"]);
      rows.push(["Title", State.model.title || "(untitled)"]);
      rows.push(["Nodes", State.model.counts.nodes]);
      rows.push(["Restraints", State.model.counts.restraints]);
      rows.push(["Elements", State.model.counts.elements]);
      rows.push(["Load cases", State.model.counts.loadCases]);
      if (State.model.modal) rows.push(["Modes requested", State.model.modal.nM]);
      var mg = materialGroupCount(State.model.elements);
      var st = supportTypeCount(State.model.reactions);
      if (mg) rows.push(["Material / section groups", mg]);
      if (st) rows.push(["Support types", st]);
      rows.push(["Flags", "shear=" + State.model.flags.shear + ", geom=" + State.model.flags.geom +
        ", exaggStatic=" + number(State.model.flags.exaggStatic) +
        ", scale=" + number(State.model.flags.scale) + ", dx=" + number(State.model.flags.dx)]);
      if (State.model.modal) {
        rows.push(["Modal method", (State.model.modal.method === 2 ? "Stodola" : "Subspace-Jacobi") +
          ", " + (State.model.modal.lump ? "lumped" : "consistent") + " mass"]);
      }
      if (State.model.modal && State.model.modal.condensation) {
        rows.push(["Condensation", "method " + State.model.modal.condensation.cmethod +
          ", " + State.model.modal.condensation.nodes.length + " node(s)"]);
      }
    } else {
      rows.push("Input model");
      rows.push(["File", "(none loaded)"]);
      rows.push(["Nodes", State.results && State.results.geometryFromOut ? State.results.geometryFromOut.nodes.length : "-",
        "geometry recovered from output echo"]);
    }
    App.clear(dom.ovInput);
    App.kv(dom.ovInput, rows);

    var orows = [];
    if (State.results) {
      orows.push("Output results");
      orows.push(["File", State.outputName || "(none)"]);
      orows.push(["Load cases with results", State.results.loadCases.length]);
      orows.push(["Mode shapes in output", State.results.modes.length
        ? (State.results.modes.length + " mode(s)")
        : (State.model && State.model.modal
          ? "absent in this output"
          : "none")]);
      var rms = [];
      for (var i = 0; i < State.results.loadCases.length; i++) {
        var lc = State.results.loadCases[i];
        if (lc.rms !== null && lc.rms !== undefined) rms.push("case " + lc.index + ": " + number(lc.rms, 3));
      }
      orows.push(["RMS equilibrium error", rms.length ? rms.join("; ") : "-"]);
      orows.push(["Geometry echo", State.results.geometryFromOut ? "present" : "absent (results only)",
        State.results.geometryFromOut ? "" : "load an input file to draw the model"]);
    } else {
      orows.push("Output results");
      orows.push(["File", "(none loaded)"]);
    }
    App.clear(dom.ovOutput);
    App.kv(dom.ovOutput, orows);

    App.clear(dom.ovWarnings);
    if (State.warnings.length) {
      var wrows = ["Parsing notes"];
      for (var w = 0; w < State.warnings.length; w++) wrows.push(["-", State.warnings[w]]);
      App.kv(dom.ovWarnings, wrows);
    }
    var units = "Units are conventional and taken from the file header/comments; values are shown as-is.";
    dom.ovWarnings.appendChild(App.h("div", { "class": "note" }, units));
  }

  function geoNodeList() {
    if (State.model && State.model.nodes.length) return State.model.nodes;
    if (State.results && State.results.geometryFromOut) return State.results.geometryFromOut.nodes;
    return [];
  }
  function geoElemList() {
    if (State.model && State.model.elements.length) return State.model.elements;
    if (State.results && State.results.geometryFromOut) return State.results.geometryFromOut.elements;
    return [];
  }

  function renderNodes() {
    var ns = geoNodeList(), rows = [];
    for (var i = 0; i < ns.length; i++) {
      var n = ns[i];
      rows.push([n.id, n.x, n.y, n.z, n.r === undefined ? null : n.r]);
    }
    App.table(dom.tbNodes, ["Node", "X", "Y", "Z", "radius"], rows, selOpts("node"));
  }

  function supportText(r) {
    var t = [];
    if (r.Rx) t.push("Fx");
    if (r.Ry) t.push("Fy");
    if (r.Rz) t.push("Fz");
    if (r.Rxx) t.push("Mx");
    if (r.Ryy) t.push("My");
    if (r.Rzz) t.push("Mz");
    if (!t.length) return "free";
    if (t.length === 6) return "fixed";
    if (r.Rx && r.Ry && r.Rz && !r.Rxx && !r.Ryy && !r.Rzz) return "pinned";
    return t.join(" ");
  }

  function renderRestraints() {
    var rec = [];
    if (State.model && State.model.reactions.length) {
      rec = State.model.reactions;
    } else if (State.results && State.results.geometryFromOut) {
      State.results.geometryFromOut.nodes.forEach(function (t) {
        if (t.Rx || t.Ry || t.Rz || t.Rxx || t.Ryy || t.Rzz) {
          rec.push({ node: t.id, Rx: t.Rx, Ry: t.Ry, Rz: t.Rz, Rxx: t.Rxx, Ryy: t.Ryy, Rzz: t.Rzz });
        }
      });
    }
    /* group nodes that share the same restraint-flag pattern */
    var groups = {}, order = [];
    rec.forEach(function (r) {
      var k = App.supportKey(r);
      if (!groups[k]) { groups[k] = { r: r, ids: [] }; order.push(k); }
      groups[k].ids.push(r.node);
    });
    var rows = order.map(function (k) {
      var g = groups[k], r = g.r;
      return [idsCell(g.ids), g.ids.length, r.Rx, r.Ry, r.Rz, r.Rxx, r.Ryy, r.Rzz, supportText(r), g.ids];
    });
    groupTable(dom.tbRestraints,
      ["Nodes", "count", "Rx", "Ry", "Rz", "Rxx", "Ryy", "Rzz", "Support"], rows,
      "No restraint data (load an input file, or a .out file that contains the geometry echo).", 9, "node",
      "1 = restrained degree of freedom, 0 = free. Nodes with identical flags are grouped into one row; click a row to select the whole group.");
  }

  /* compact element-id list for a grouped row */
  function idsCell(ids) {
    if (ids.length <= 12) return ids.join(", ");
    return ids.slice(0, 12).join(", ") + " \u2026 (" + ids.length + ")";
  }
  function selectIds(kind, ids) {
    var set = {};
    (ids || []).forEach(function (id) { set[String(id)] = 1; });
    if (kind === "node") State.sel.nodes = set; else State.sel.elems = set;
    syncSelOpts();
    renderAll();
    if (dom.status) dom.status.textContent = (ids ? ids.length : 0) + " " + (kind === "node" ? "node(s)" : "element(s)") + " selected.";
  }
  /* table where a row selects a whole group of nodes/elements (ids stored in
     an extra, non-rendered trailing cell) */
  function groupTable(host, columns, rows, empty, idsIndex, kind, note) {
    kind = kind || "elem";
    App.table(host, columns, rows, {
      empty: empty, note: note,
      rowKey: function (r) { return r[0]; },
      selected: function (r) {
        var ids = r[idsIndex], sel = kind === "node" ? State.sel.nodes : State.sel.elems;
        return !!ids && ids.length && ids.every(function (id) { return !!sel[String(id)]; });
      },
      onSelect: function (r) { selectIds(kind, r[idsIndex]); }
    });
  }

  function renderElements() {
    var es = geoElemList(), groups = {}, order = [];
    for (var i = 0; i < es.length; i++) {
      var e = es[i];
      var key = [e.Ax, e.Asy, e.Asz, e.Jxx, e.Iyy, e.Izz, e.E, e.G, e.roll, e.density].join("|");
      if (!groups[key]) {
        groups[key] = { vals: [e.Ax, e.Asy, e.Asz, e.Jxx, e.Iyy, e.Izz, e.E, e.G, e.roll, e.density], ids: [] };
        order.push(key);
      }
      groups[key].ids.push(e.id);
    }
    var rows = order.map(function (k) {
      var g = groups[k];
      return [idsCell(g.ids), g.ids.length].concat(g.vals, [g.ids]);
    });
    App.table(dom.tbElements,
      ["Elements", "count", "Ax", "Asy", "Asz", "Jxx", "Iyy", "Izz", "E", "G", "roll", "density"],
      rows, {
        note: "Elements sharing identical Ax, Asy, Asz, Jxx, Iyy, Izz, E, G, roll and density are grouped into one row. " +
          "Click a row to select the whole group. Izz is reported as 0.0 in the .out element echo even when the input is non-zero.",
        empty: "No elements.",
        rowKey: function (r) { return r[0]; },
        selected: function (r) {
          var ids = r[12];
          return !!ids && ids.length && ids.every(function (id) { return !!State.sel.elems[String(id)]; });
        },
        onSelect: function (r) { selectIds("elem", r[12]); }
      });
  }

  function renderLoads() {
    App.clear(dom.tbLoads);
    if (!State.model) { dom.tbLoads.appendChild(App.h("div", { "class": "empty" }, "Load cases are only available from an input file.")); return; }

    function block(title, cols, rows, empty, selKind) {
      var sec = App.h("div", { "class": "loadblock" });
      sec.appendChild(App.h("h3", null, title));
      var host = App.h("div");
      sec.appendChild(host);
      dom.tbLoads.appendChild(sec);
      var o = { empty: empty };
      if (selKind) o = Object.assign(o, selOpts(selKind));
      App.table(host, cols, rows, o);
    }
    function groupBlock(title, cols, rows, empty, idsIndex, kind) {
      var sec = App.h("div", { "class": "loadblock" });
      sec.appendChild(App.h("h3", null, title));
      var host = App.h("div");
      sec.appendChild(host);
      dom.tbLoads.appendChild(sec);
      groupTable(host, cols, rows, empty, idsIndex, kind || "elem");
    }

    if (State.opts.modalInput && State.model.modal) {
      renderModalInput(block, groupBlock);
      return;
    }

    var lc = caseOf(State.model.loadCases, State.opts.caseIndex);
    if (!lc) { dom.tbLoads.appendChild(App.h("div", { "class": "empty" }, "No load case selected.")); return; }

    dom.tbLoads.appendChild(App.h("div", { "class": "note" },
      "Case " + lc.index + " \u00b7 gravity gX=" + number(lc.gravity[0]) + ", gY=" + number(lc.gravity[1]) + ", gZ=" + number(lc.gravity[2])));

    /* nodal loads grouped by the identical force/moment tuple */
    var ng = {}, no = [];
    lc.nodal.forEach(function (n) {
      var k = [n.Fx, n.Fy, n.Fz, n.Mxx, n.Myy, n.Mzz].join("|");
      if (!ng[k]) { ng[k] = { n: n, ids: [] }; no.push(k); }
      ng[k].ids.push(n.node);
    });
    r = no.map(function (k) {
      var g = ng[k], n = g.n;
      return [idsCell(g.ids), g.ids.length, n.Fx, n.Fy, n.Fz, n.Mxx, n.Myy, n.Mzz, g.ids];
    });
    groupBlock("Nodal loads (grouped by value)",
      ["Nodes", "count", "Fx", "Fy", "Fz", "Mxx", "Myy", "Mzz"], r, "none", 8, "node");

    /* uniform loads grouped by identical (Ux, Uy, Uz) with their elements */
    var r;
    var ug = {}, uo = [];
    lc.uniform.forEach(function (u) {
      var k = [u.Ux, u.Uy, u.Uz].join("|");
      if (!ug[k]) { ug[k] = { u: u, ids: [] }; uo.push(k); }
      ug[k].ids.push(u.elm);
    });
    r = uo.map(function (k) { var g = ug[k]; return [idsCell(g.ids), g.ids.length, g.u.Ux, g.u.Uy, g.u.Uz, g.ids]; });
    groupBlock("Uniform element loads (local) \u2014 grouped by value", ["Elements", "count", "Ux", "Uy", "Uz"], r, "none", 5);

    /* trapezoidal loads grouped by the full 12-value tuple */
    var wg = {}, wo = [];
    lc.trapezoid.forEach(function (w) {
      var k = [w.xx1, w.xx2, w.wx1, w.wx2, w.xy1, w.xy2, w.wy1, w.wy2, w.xz1, w.xz2, w.wz1, w.wz2].join("|");
      if (!wg[k]) { wg[k] = { w: w, ids: [] }; wo.push(k); }
      wg[k].ids.push(w.elm);
    });
    r = wo.map(function (k) {
      var g = wg[k], w = g.w;
      return [idsCell(g.ids), g.ids.length, w.xx1, w.xx2, w.wx1, w.wx2, w.xy1, w.xy2, w.wy1, w.wy2, w.xz1, w.xz2, w.wz1, w.wz2, g.ids];
    });
    groupBlock("Trapezoidal loads (local; grouped by value)",
      ["Elements", "count", "x1", "x2", "wx1", "wx2", "y1", "y2", "wy1", "wy2", "z1", "z2", "wz1", "wz2"], r, "none", 14);

    /* interior point loads grouped by identical (Px, Py, Pz, x) */
    var pg = {}, po = [];
    lc.point.forEach(function (p) {
      var k = [p.Px, p.Py, p.Pz, p.x].join("|");
      if (!pg[k]) { pg[k] = { p: p, ids: [] }; po.push(k); }
      pg[k].ids.push(p.elm);
    });
    r = po.map(function (k) { var g = pg[k]; return [idsCell(g.ids), g.ids.length, g.p.Px, g.p.Py, g.p.Pz, g.p.x, g.ids]; });
    groupBlock("Interior point loads (local; grouped by value)", ["Elements", "count", "Px", "Py", "Pz", "x"], r, "none", 6);

    /* temperature loads grouped by the full 7-value tuple */
    var tg = {}, to = [];
    lc.temperature.forEach(function (t) {
      var k = [t.alpha, t.hy, t.hz, t.Typ, t.Tym, t.Tzp, t.Tzm].join("|");
      if (!tg[k]) { tg[k] = { t: t, ids: [] }; to.push(k); }
      tg[k].ids.push(t.elm);
    });
    r = to.map(function (k) {
      var g = tg[k], t = g.t;
      return [idsCell(g.ids), g.ids.length, t.alpha, t.hy, t.hz, t.Typ, t.Tym, t.Tzp, t.Tzm, g.ids];
    });
    groupBlock("Temperature loads (local; grouped by value)",
      ["Elements", "count", "coef", "hy", "hz", "Ty+", "Ty-", "Tz+", "Tz-"], r, "none", 9);

    /* prescribed displacements grouped by the identical 6-value tuple */
    var dg = {}, dobj = [];
    lc.prescribed.forEach(function (d) {
      var k = [d.Dx, d.Dy, d.Dz, d.Dxx, d.Dyy, d.Dzz].join("|");
      if (!dg[k]) { dg[k] = { d: d, ids: [] }; dobj.push(k); }
      dg[k].ids.push(d.node);
    });
    r = dobj.map(function (k) {
      var g = dg[k], d = g.d;
      return [idsCell(g.ids), g.ids.length, d.Dx, d.Dy, d.Dz, d.Dxx, d.Dyy, d.Dzz, g.ids];
    });
    groupBlock("Prescribed displacements (grouped by value)",
      ["Nodes", "count", "Dx", "Dy", "Dz", "Dxx", "Dyy", "Dzz"], r, "none", 8, "node");
  }

  /* modal input data from the .3dd file (Preprocessing modal view) */
  function renderModalInput(block, groupBlock) {
    var md = State.model.modal;
    function kvBlock(title, rows) {
      var sec = App.h("div", { "class": "loadblock" });
      sec.appendChild(App.h("h3", null, title));
      var host = App.h("div");
      sec.appendChild(host);
      dom.tbLoads.appendChild(sec);
      App.kv(host, rows);
    }

    dom.tbLoads.appendChild(App.h("div", { "class": "note" },
      "Modal analysis \u00b7 " + md.nM + " requested mode(s) \u00b7 static loads are hidden"));

    kvBlock("Modal analysis parameters", [
      ["Requested modes", md.nM],
      ["Method", md.method === 2 ? "Stodola" : "Subspace-Jacobi"],
      ["Mass matrix", md.lump ? "lumped" : "consistent"],
      ["Tolerance", md.tol],
      ["Shift", md.shift],
      ["Exaggeration", md.exagg],
      ["Animated modes", (md.animModes || []).length],
      ["Pan rate", md.pan]
    ]);

    /* node masses/inertia are grouped by their value tuple */
    var ng = {}, no = [];
    (md.inertia || []).forEach(function (x) {
      var key = [x.mass, x.Ixx, x.Iyy, x.Izz].join("|");
      if (!ng[key]) { ng[key] = { x: x, ids: [] }; no.push(key); }
      ng[key].ids.push(x.node);
    });
    groupBlock("Node masses and inertia (grouped by value)",
      ["Nodes", "count", "mass", "Ixx", "Iyy", "Izz"],
      no.map(function (k) {
        var g = ng[k], x = g.x;
        return [idsCell(g.ids), g.ids.length, x.mass, x.Ixx, x.Iyy, x.Izz, g.ids];
      }), "none", 6, "node");

    /* extra masses are grouped by their value, like the distributed loads */
    var eg = {}, eo = [];
    (md.elemMass || []).forEach(function (x) {
      var key = String(x.m);
      if (!eg[key]) { eg[key] = { m: x.m, ids: [] }; eo.push(key); }
      eg[key].ids.push(x.elm);
    });
    groupBlock("Element extra mass (grouped by value)", ["Elements", "count", "mass"],
      eo.map(function (k) {
        var g = eg[k];
        return [idsCell(g.ids), g.ids.length, g.m, g.ids];
      }), "none", 3);

    if (md.condensation) {
      var cd = md.condensation;
      kvBlock("Condensation", [["Method", cd.cmethod]]);
      /* condensed nodes are grouped by their full stiffness tuple */
      var cg = {}, co = [];
      cd.nodes.forEach(function (x) {
        var key = [x.cx, x.cy, x.cz, x.cxx, x.cyy, x.czz].join("|");
        if (!cg[key]) { cg[key] = { x: x, ids: [] }; co.push(key); }
        cg[key].ids.push(x.node);
      });
      groupBlock("Condensation nodes (grouped by value)",
        ["Nodes", "count", "cx", "cy", "cz", "cxx", "cyy", "czz"],
        co.map(function (k) {
          var g = cg[k], x = g.x;
          return [idsCell(g.ids), g.ids.length, x.cx, x.cy, x.cz, x.cxx, x.cyy, x.czz, g.ids];
        }), "none", 8, "node");
      block("Modes to match", ["Mode"], (cd.modes || []).map(function (m) { return [m]; }), "none");
    }
  }

  function resultCase(list) { return State.results ? caseOf(list, State.opts.caseIndex) : null; }

  /* end nodes of the currently selected elements (so a selected member also
     lights up its node rows in the result tables) */
  function selectedEndNodes() {
    var out = {};
    var els = (State.model && State.model.elements && State.model.elements.length) ? State.model.elements
      : (State.results && State.results.geometryFromOut ? State.results.geometryFromOut.elements : []);
    for (var i = 0; i < els.length; i++) {
      if (State.sel.elems[String(els[i].id)]) { out[String(els[i].n1)] = 1; out[String(els[i].n2)] = 1; }
    }
    return out;
  }
  /* row selected if its node OR its element is selected */
  function nodeRowSelected(r, endNodes) {
    var id = String(r[0]);
    return !!State.sel.nodes[id] || !!(endNodes && endNodes[id]);
  }

  function renderDisp() {
    if (!State.results) { App.table(dom.tbDisp, [], [], { empty: "No results loaded." }); return; }
    var lc = caseOf(State.results.loadCases, State.opts.caseIndex);
    var rows = [];
    if (lc) for (var i = 0; i < lc.displacements.length; i++) {
      var d = lc.displacements[i];
      rows.push([d.node, d.ux, d.uy, d.uz, d.rx, d.ry, d.rz]);
    }
    var endNodes = selectedEndNodes();
    App.table(dom.tbDisp, ["Node", "X-dsp", "Y-dsp", "Z-dsp", "X-rot", "Y-rot", "Z-rot"], rows, {
      empty: "No displacements for this case.",
      rowKey: function (r) { return r[0]; },
      selected: function (r) { return nodeRowSelected(r, endNodes); },
      onSelect: function (r, ev) { applySelection("node", r[0], ev); }
    });
  }

  function renderEndForces() {
    if (!State.results) { App.table(dom.tbEf, [], [], { empty: "No results loaded." }); return; }
    var lc = caseOf(State.results.loadCases, State.opts.caseIndex);
    var rows = [];
    if (lc) for (var i = 0; i < lc.endForces.length; i++) {
      var f = lc.endForces[i];
      rows.push([f.elm, f.node, f.nx, f.vy, f.vz, f.txx, f.myy, f.mzz]);
    }
    App.table(dom.tbEf, ["Elmnt", "Node", "Nx", "Vy", "Vz", "Txx", "Myy", "Mzz"], rows, {
      empty: "No end forces for this case.",
      rowKey: function (r) { return r[1]; },
      selected: function (r) {
        return !!State.sel.elems[String(r[0])] || !!State.sel.nodes[String(r[1])];
      },
      onSelect: function (r, ev) { applySelection("elem", r[0], ev); }
    });
  }

  function renderReactions() {
    if (!State.results) { App.table(dom.tbReac, [], [], { empty: "No results loaded." }); return; }
    var lc = caseOf(State.results.loadCases, State.opts.caseIndex);
    var rows = [];
    if (lc) for (var i = 0; i < lc.reactions.length; i++) {
      var r = lc.reactions[i];
      rows.push([r.node, r.Fx, r.Fy, r.Fz, r.Mxx, r.Myy, r.Mzz]);
    }
    var endNodes = selectedEndNodes();
    App.table(dom.tbReac, ["Node", "Fx", "Fy", "Fz", "Mxx", "Myy", "Mzz"], rows, {
      empty: "No reactions for this case.",
      rowKey: function (r) { return r[0]; },
      selected: function (r) { return nodeRowSelected(r, endNodes); },
      onSelect: function (r, ev) { applySelection("node", r[0], ev); }
    });
  }

  function renderPeak() {
    if (!State.results) { App.table(dom.tbPeak, [], [], { empty: "No results loaded." }); return; }
    var lc = caseOf(State.results.loadCases, State.opts.caseIndex);
    var rows = [];
    if (lc) for (var i = 0; i < lc.peakForces.length; i++) {
      var p = lc.peakForces[i];
      rows.push([p.elm, p.which, p.nx, p.vy, p.vz, p.txx, p.myy, p.mzz]);
    }
    App.table(dom.tbPeak, ["Elmnt", "End", "Nx", "Vy", "Vz", "Txx", "Myy", "Mzz"], rows, Object.assign(
      { empty: "No peak internal forces (dx = -1 in the input skips them)." }, selOpts("elem")));
  }

  function renderModes() {
    if (!State.results || !State.results.modes.length) {
      App.table(dom.tbModes, [], [], {
        empty: State.model && State.model.modal
          ? ("The input requests " + State.model.modal.nM + " mode(s), but the loaded .out file has no " +
             "mode-shape data.")
          : "No modal results loaded."
      });
      if (dom.multiMode) App.clear(dom.multiMode);
      App.clear(dom.tbShapes);
      return;
    }
    var rows = [];
    for (var i = 0; i < State.results.modes.length; i++) {
      var m = State.results.modes[i];
      rows.push([m.index, m.freq, m.period, m.partX, m.partY, m.partZ]);
    }
    App.table(dom.tbModes, ["Mode", "f (Hz)", "T (s)", "X-partic.", "Y-partic.", "Z-partic."], rows, {
      rowKey: function (r) { return r[0]; },
      selected: State.opts.combined ? undefined : State.opts.modeIndex,
      onSelect: function (r) { setModeIndex(r[0]); }
    });

    buildMultiMode(dom.multiMode);

    var sel = null;
    for (var mi = 0; mi < State.results.modes.length; mi++) {
      if (State.results.modes[mi].index === State.opts.modeIndex) sel = State.results.modes[mi];
    }
    App.clear(dom.tbShapes);
    if (!sel) { dom.tbShapes.appendChild(App.h("div", { "class": "empty" }, "Select a mode to see its shape.")); return; }
    dom.tbShapes.appendChild(App.h("h3", null, "Mode " + sel.index + " shape (f = " + number(sel.freq, 6) + " Hz)"));
    var srows = [];
    for (var k = 0; k < sel.shapes.length; k++) {
      var s = sel.shapes[k];
      srows.push([s.node, s.ux, s.uy, s.uz, s.rx, s.ry, s.rz]);
    }
    var shapeHost = App.h("div");
    dom.tbShapes.appendChild(shapeHost);
    App.table(shapeHost, ["Node", "X-dsp", "Y-dsp", "Z-dsp", "X-rot", "Y-rot", "Z-rot"], srows, selOpts("node"));
  }

  /* multi-mode combined-animation controls (T7) */
  function buildMultiMode(host) {
    if (!host) return;
    App.clear(host);
    if (!modesHaveShapes()) {
      host.appendChild(App.h("div", { "class": "note" },
        "Combined animation needs mode-shape data, but this .out file has none."));
      return;
    }
    host.appendChild(App.h("h3", null, "Combined multi-mode animation"));
    host.appendChild(App.h("div", { "class": "note" }, "u(t) = \u03a3 w\u1d62 \u03c6\u1d62 sin(\u03c9\u1d62 t), \u03c9\u1d62 = 2\u03c0 f\u1d62"));
    var list = App.h("div", { "class": "modelist" });
    for (var i = 0; i < State.results.modes.length; i++) {
      (function (m) {
        var row = App.h("label", { "class": "moderow" });
        var w0 = State.opts.modeWeights[m.index] === undefined ? 1 : State.opts.modeWeights[m.index];
        var on = State.opts.modeEnabled[m.index] !== false;
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = on;
        row.appendChild(cb);
        row.appendChild(App.h("span", { "class": "mlabel" }, "Mode " + m.index + " (" + number(m.freq, 3) + " Hz)"));
        /* per-mode weight: non-negative, wheel x/1.1, at most 2 decimals */
        var wt = App.numberField({
          id: "weight-" + m.index, allowZero: true, min: 0, step: 0.05, value: w0,
          title: "Mode weight (non-negative). Mouse wheel = \u00d7/1.1; at most 2 decimals.",
          onChange: function (v) { setWeight(m.index, v); if (!State.opts.combined) setCombined(true); else drawLegend(); }
        });
        wt.disabled = !on;   /* a disabled mode keeps its value but is not editable */
        cb.addEventListener("change", function () {
          if (this.checked) {
            delete State.opts.modeEnabled[m.index];
            if (!(parseFloat(wt.value) > 0)) { wt.value = "1"; State.opts.modeWeights[m.index] = 1; }
          } else {
            State.opts.modeEnabled[m.index] = false;   /* keep the value */
          }
          wt.disabled = !this.checked;
          if (!State.opts.combined) setCombined(true); else drawLegend();
        });
        row.appendChild(wt);
        list.appendChild(row);
      })(State.results.modes[i]);
    }
    host.appendChild(list);

    var bar = App.h("div", { "class": "modebar2" });
    var bAll = App.h("button", null, "Select all");
    bAll.addEventListener("click", function () {
      State.results.modes.forEach(function (m) { State.opts.modeEnabled[m.index] = true; if (!(State.opts.modeWeights[m.index] > 0)) State.opts.modeWeights[m.index] = 1; });
      setCombined(true); renderModes();
    });
    var bNone = App.h("button", null, "Select none");
    bNone.addEventListener("click", function () {
      State.results.modes.forEach(function (m) { State.opts.modeEnabled[m.index] = false; });
      setCombined(true); renderModes();
    });
    bar.appendChild(bAll); bar.appendChild(bNone);
    host.appendChild(bar);
    host.appendChild(App.h("div", { "class": "note" }, "Amplitude and Speed are in the toolbar next to Deformation scale. Use the toolbar Play/Stop button to animate or freeze the combined view."));
  }

  function renderRaw() {
    dom.rawInput.textContent = State.inputText === null ? "(none)" : State.inputText;
    dom.rawOutput.textContent = State.outputText === null ? "(none)" : State.outputText;
  }

  function renderAll() {
    renderOverview();
    renderNodes();
    renderRestraints();
    renderElements();
    renderLoads();
    renderDisp();
    renderEndForces();
    renderReactions();
    renderPeak();
    renderModes();
    renderRaw();
    drawLegend();
    updatePlayCtl();
  }

  /* ---- legend -------------------------------------------------------- */
  function drawLegend() {
    var host = dom.legend;
    App.clear(host);
    var scene = getScene();
    if (scene.legend) {
      var lg = scene.legend;
      var wrap = App.h("div", { "class": "legend" });
      wrap.appendChild(App.h("span", null, lg.label + ":"));
      if (lg.entries) {
        for (var i = 0; i < lg.entries.length; i++) {
          var item = App.h("span", { "class": "legitem" });
          item.appendChild(App.h("span", { "class": "swatch", style: "background:" + lg.entries[i].color }));
          item.appendChild(App.h("span", null, lg.entries[i].text));
          wrap.appendChild(item);
        }
      } else {
        wrap.appendChild(App.h("span", { "class": "bar", style: "background:" + App.scaleGradient(lg.min, lg.max) }));
        wrap.appendChild(App.h("span", { "class": "lab" }, number(lg.min, 3) + " \u2192 " + number(lg.max, 3)));
      }
      host.appendChild(wrap);
    }
    drawLoadLegend(host);
  }

  /* group the active case's loads by category with counts and maxima */
  function drawLoadLegend(host) {
    if (State.opts.modalInput) {
      var md = State.model && State.model.modal;
      if (!md) return;
      var wrap0 = App.h("div", { "class": "legend loads" });
      wrap0.appendChild(App.h("span", { "class": "legtitle" }, "Modal analysis:"));
      wrap0.appendChild(App.h("span", { "class": "legitem" },
        md.nM + " mode(s) \u00b7 " + (md.inertia || []).length + " node mass(es) \u00b7 " +
        (md.elemMass || []).length + " element mass(es) \u00b7 condensation: " +
        (md.condensation ? "method " + md.condensation.cmethod : "none")));
      host.appendChild(wrap0);
      return;
    }
    if (State.opts.modeIndex > 0 || State.opts.combined) return;
    if (State.opts.showLoads === false || !State.model) return;
    var lc = caseOf(State.model.loadCases, State.opts.caseIndex);
    if (!lc) return;
    var rows = [];
    var LC = (App.colors || {});
    function cat(label, arr, mag, color) {
      if (!arr || !arr.length) return;
      var mx = 0;
      for (var i = 0; i < arr.length; i++) { var m = mag(arr[i]); if (m > mx) mx = m; }
      rows.push({ text: label + ": " + arr.length + " (max " + number(mx, 3) + ")", color: color });
    }
    cat("nodal", lc.nodal, function (n) { return Math.sqrt(n.Fx * n.Fx + n.Fy * n.Fy + n.Fz * n.Fz); }, LC.load);
    cat("uniform", lc.uniform, function (u) { return Math.sqrt(u.Ux * u.Ux + u.Uy * u.Uy + u.Uz * u.Uz); }, LC.uniformLoad);
    cat("trapezoid", lc.trapezoid, function (w) { return Math.max(Math.abs(w.wx1), Math.abs(w.wx2), Math.abs(w.wy1), Math.abs(w.wy2), Math.abs(w.wz1), Math.abs(w.wz2)); }, LC.trapezoidLoad);
    cat("point", lc.point, function (p) { return Math.sqrt(p.Px * p.Px + p.Py * p.Py + p.Pz * p.Pz); }, LC.pointLoad);
    cat("temperature", lc.temperature, function (t) { return Math.max(Math.abs(t.Typ), Math.abs(t.Tym), Math.abs(t.Tzp), Math.abs(t.Tzm)); });
    if (lc.gravity && (lc.gravity[0] || lc.gravity[1] || lc.gravity[2])) {
      rows.push({ text: "gravity: (" + number(lc.gravity[0], 3) + ", " + number(lc.gravity[1], 3) + ", " + number(lc.gravity[2], 3) + ")", color: LC.gravityLoad });
    }
    cat("prescribed", lc.prescribed, function (d) { return Math.max(Math.abs(d.Dx), Math.abs(d.Dy), Math.abs(d.Dz), Math.abs(d.Dxx), Math.abs(d.Dyy), Math.abs(d.Dzz)); }, LC.prescribed);
    if (!rows.length) return;
    var wrap = App.h("div", { "class": "legend loads" });
    wrap.appendChild(App.h("span", { "class": "legtitle" }, "Loads \u2013 case " + lc.index + ":"));
    rows.forEach(function (r) {
      var item = App.h("span", { "class": "legitem" });
      if (r.color) item.appendChild(App.h("span", { "class": "swatch", style: "background:" + r.color }));
      item.appendChild(App.h("span", null, r.text));
      wrap.appendChild(item);
    });
    host.appendChild(wrap);
  }

  /* ---- scale --------------------------------------------------------- */
  function applyAutoScale() {
    var md;
    if (State.opts.combined && modesHaveShapes()) {
      /* combined u(t) is zero at t=0; size the scale from the modal maxima */
      md = 0;
      var w = State.opts.modeWeights || {}, en = State.opts.modeEnabled || {};
      for (var i = 0; i < State.results.modes.length; i++) {
        var m = State.results.modes[i];
        if (en[m.index] === false) continue;
        var wt = (w[m.index] === undefined) ? 1 : Math.abs(w[m.index]);
        if (wt > 0) md += wt * App.maxDisp(State, { modeIndex: m.index, scale: 1 });
      }
    } else {
      md = App.maxDisp(State, { caseIndex: State.opts.caseIndex, modeIndex: State.opts.modeIndex });
    }
    var size = App.modelSize(State.model, State.results);
    var s = md > 0 ? (0.1 * size) / md : 1;
    setScale(s);
  }
  function setScale(s) {
    s = Number(s);
    if (!isFinite(s) || s <= 0) return;
    s = Math.min(s, 1e9);
    if (s < 1e-6) s = 1e-6;
    /* keep at most two decimal places (small values keep 2 significant digits) */
    s = (s >= 0.01) ? Math.round(s * 100) / 100 : Number(s.toPrecision(2));
    State.opts.scale = s;
    if (dom.numScale) dom.numScale.value = String(s);
  }

  /* ---- refresh ------------------------------------------------------- */
  function refreshView() {
    if (!engine) return;
    engine.fit(getScene());
    drawLegend();
  }

  /* pick a sensible starting view: 2D models look best front-on */
  function applyViewForGeometry() {
    if (!engine) return;
    engine.setView(App.is2DGeometry(State.model, State.results) ? "front" : "iso");
  }

  function rebuild(fitView, keepView) {
    showMessage(State.warnings.length ? State.warnings.join("\n") : "", true);
    if (dom.status) dom.status.textContent = "";
    populateCases();
    populateModes();
    populateCaseModeSelect();
    renderAll();
    updateAvailability();
    if (!keepView) { applyAutoScale(); applyViewForGeometry(); }
    modeNotice();
    if (fitView !== false && !keepView) refreshView();
  }

  /* a structural fingerprint of the model: counts + node/element ids + coords */
  function modelSignature(model) {
    if (!model) return null;
    var parts = [model.counts.nodes, model.counts.elements];
    for (var i = 0; i < model.nodes.length; i++) {
      var n = model.nodes[i];
      parts.push(n.id, n.x, n.y, n.z);
    }
    for (var e = 0; e < model.elements.length; e++) parts.push(model.elements[e].id, model.elements[e].n1, model.elements[e].n2);
    return parts.join(",");
  }
  function pruneSelection() {
    var nIds = {}, eIds = {};
    visibleNodeIds().forEach(function (id) { nIds[String(id)] = 1; });
    visibleElemIds().forEach(function (id) { eIds[String(id)] = 1; });
    Object.keys(State.sel.nodes).forEach(function (id) { if (!nIds[id]) delete State.sel.nodes[id]; });
    Object.keys(State.sel.elems).forEach(function (id) { if (!eIds[id]) delete State.sel.elems[id]; });
    syncSelOpts();
  }

  /* ---- file loading -------------------------------------------------- */
  function isCsvFile(name) { return /\.csv$/i.test(String(name || "")); }
  function detectKind(text, name) {
    name = (name || "").toLowerCase();
    if (/\.out$/.test(name)) return "output";
    if (/\.3dd$/.test(name)) return "input";
    if (/Frame3DD version/i.test(text)) return "output";
    if (/N\s*O\s*D\s*E\s*D\s*I\s*S\s*P\s*L\s*A\s*C\s*E\s*M\s*E\s*N\s*T\s*S/.test(text)) return "output";
    if (/NATURALFREQUENCIES|N\s*A\s*T\s*U\s*R\s*A\s*L/.test(text)) return "output";
    if (/FRAMEELEMENTENDFORCES|F\s*R\s*A\s*M\s*E\s*E\s*L\s*E\s*M\s*E\s*N\s*T\s*E\s*N\s*D/.test(text)) return "output";
    return "input";
  }

  function loadInputText(text, name, noRebuild) {
    State.inputText = text;
    State.inputName = name || "";
    var r = App.parse3dd(text);
    State.model = r.model;
    State.modelSig = modelSignature(r.model);
    /* a freshly loaded model always starts in its static case with every load
       category visible: keeping the previous model's toggles (or the modal
       input view) made loads look missing until the user re-enabled them */
    State.opts.modalInput = false;
    State.opts.showLoads = true;
    State.opts.showNodalLoads = true;
    State.opts.showMomentLoads = true;
    State.opts.showUniformLoads = true;
    State.opts.showTrapezoidLoads = true;
    State.opts.showPointLoads = true;
    State.opts.showGravity = true;
    State.opts.showPrescribed = true;
    State.opts.showNodeInertia = true;
    State.opts.showElemMass = true;
    State.opts.showCondensation = true;
    r.warnings.forEach(function (w) { State.warnings.push(w); });
    if (!noRebuild) rebuild();
  }
  function loadOutputText(text, name, noRebuild) {
    State.outputText = text;
    State.outputName = name || "";
    var r = App.parseOut(text);
    State.results = r.results;
    r.warnings.forEach(function (w) { State.warnings.push(w); });
    if (!noRebuild) rebuild();
  }

  /* small chooser reusing the menu styling (used when a folder holds several
     models: pick one and its results attach automatically) */
  function showChoiceMenu(title, items) {
    closeMenus();
    var box = buildDropdown([{ label: title, disabled: CTX_END }, "-"].concat(items || []), "dropdown");
    box.style.position = "fixed";
    box.style.left = "12px";
    box.style.top = (dom.menubar && dom.menubar.getBoundingClientRect
      ? Math.round(dom.menubar.getBoundingClientRect().bottom + 2) : 30) + "px";
    document.body.appendChild(box);
    openMenuEl = box; openMenuBtn = null;
  }

  function baseName(n) {
    return String(n || "").replace(/\.[^.]+$/, "").replace(/_out$/i, "").toLowerCase();
  }

  /* every text file the user has made available, keyed by lowercase name;
     lets a model auto-attach its output once the folder has been opened. */
  var fileCache = {};
  function cacheFile(name, text) { if (name) fileCache[String(name).toLowerCase()] = { name: name, text: text }; }

  /* look for the conventional output names of a model file in the cache */
  function findCachedOutput(modelName) {
    if (!modelName) return null;
    var dot = modelName.lastIndexOf(".");
    var stem = dot > 0 ? modelName.slice(0, dot) : modelName;
    var cands = [stem + ".out", stem + ".OUT"];
    for (var i = 0; i < cands.length; i++) {
      var hit = fileCache[cands[i].toLowerCase()];
      if (hit) return hit;
    }
    return null;
  }

  /* pick the output that matches a model base name */
  function pickOutputFor(outputs, base) {
    for (var i = 0; i < outputs.length; i++) if (outputs[i].base === base) return outputs[i];
    return null;
  }

  /* ---- results / model consistency check ---------------------------- */
  function sortedIds(a) {
    return a.map(String).sort();
  }
  function idsEqual(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    var A = sortedIds(a), B = sortedIds(b);
    for (var i = 0; i < A.length; i++) if (A[i] !== B[i]) return false;
    return true;
  }
  /* node ids reported by the results: the geometry echo is exact; the
     reactions block lists every node. Displacements may omit zero rows, so
     they are only a last resort. */
  function resultNodeIds(results) {
    var geo = results.geometryFromOut;
    if (geo && geo.nodes && geo.nodes.length) return geo.nodes.map(function (n) { return n.id; });
    var ids = {}, out = [];
    for (var i = 0; i < results.loadCases.length; i++) {
      var re = results.loadCases[i].reactions;
      for (var j = 0; j < re.length; j++) if (!(re[j].node in ids)) { ids[re[j].node] = 1; out.push(re[j].node); }
    }
    if (out.length) return out;
    return null;
  }
  /* element ids reported by the results: geometry echo, else the element ids
     present in end forces / peak forces (every element has end forces). */
  function resultElemIds(results) {
    var geo = results.geometryFromOut;
    if (geo && geo.elements && geo.elements.length) return geo.elements.map(function (e) { return e.id; });
    var ids = {}, out = [];
    for (var i = 0; i < results.loadCases.length; i++) {
      var ef = results.loadCases[i].endForces, pf = results.loadCases[i].peakForces, j;
      for (j = 0; j < ef.length; j++) if (!(ef[j].elm in ids)) { ids[ef[j].elm] = 1; out.push(ef[j].elm); }
      for (j = 0; j < pf.length; j++) if (!(pf[j].elm in ids)) { ids[pf[j].elm] = 1; out.push(pf[j].elm); }
    }
    return out.length ? out : null;
  }
  function countN(list) { return list ? list.length : null; }

  /* Compare the loaded model with a parsed results object.
     Returns { ok, detail }. Only reliable sources reject; unknown ones skip. */
  function validateResults(model, results) {
    if (!model || !results) return { ok: true, detail: "" };
    var msgs = [];
    var mn = model.nodes.map(function (n) { return n.id; });
    var me = model.elements.map(function (e) { return e.id; });
    var rn = resultNodeIds(results), re = resultElemIds(results);
    if (rn && rn.length !== mn.length) {
      msgs.push("nodes: model " + mn.length + " vs results " + rn.length);
    } else if (rn && !idsEqual(rn, mn)) {
      msgs.push("node numbers differ (model " + countN(mn) + ", results " + countN(rn) + ")");
    }
    if (re && re.length !== me.length) {
      msgs.push("elements: model " + me.length + " vs results " + re.length);
    } else if (re && !idsEqual(re, me)) {
      msgs.push("element numbers differ (model " + countN(me) + ", results " + countN(re) + ")");
    }
    return { ok: msgs.length === 0, detail: msgs.join("; ") };
  }

  /* Parse and attach a results file. When a model is loaded the node/element
     counts must match, otherwise the results are rejected. */
  function attachResults(text, name, noRebuild) {
    if (!State.model) {
      showMessage("No input model loaded - load the model (.3dd) before attaching results.");
      return false;
    }
    var r = App.parseOut(text);
    var v = validateResults(State.model, r.results);
    if (!v.ok) {
      State.warnings.push("Results \"" + name + "\" rejected - it does not match the loaded model (" + v.detail + ").");
      if (!noRebuild) rebuild();
      return false;
    }
    State.outputText = text;
    State.outputName = name || "";
    State.results = r.results;
    r.warnings.forEach(function (w) { State.warnings.push(w); });
    if (!noRebuild) rebuild();
    return true;
  }
  function clearResults() {
    State.results = null; State.outputText = null; State.outputName = "";
    State.opts.caseIndex = 0; State.opts.modeIndex = 0;
  }

  /* try each candidate output for a model, keeping the first one that passes
     the node/element consistency check. When `skipCache` is set (the input
     changed on reload) the in-session cache is not consulted. */
  function attachBestOutput(candidates, modelName, skipCache) {
    var list = candidates || [];
    for (var i = 0; i < list.length; i++) {
      if (attachResults(list[i].text, list[i].name, true)) return list[i];
    }
    if (!skipCache) {
      var cached = findCachedOutput(modelName);
      if (cached && attachResults(cached.text, cached.name, true)) return cached;
    }
    return null;
  }

  /* Auto-discover a results file for a model by name, relative to the page.
     Handy for the bundled examples (frame3dd/examples/exA.out ...) when the
     app is served over http(s)/localhost; on plain file:// the browser blocks
     it and we simply fall through to the cache/hint. */
  function fetchCandidates(modelName) {
    var stem = String(modelName || "").replace(/\.[^.]+$/, "");
    if (!stem) return [];
    var dirs = ["frame3dd/examples/", "examples/", ""];
    var files = [stem + ".out"];
    var out = [];
    for (var d = 0; d < dirs.length; d++) {
      for (var f = 0; f < files.length; f++) out.push(dirs[d] + files[f]);
    }
    return out;
  }
  function discoverByFetch(modelName, done) {
    if (typeof fetch !== "function") { done(null); return; }
    var urls = fetchCandidates(modelName), i = 0;
    (function next() {
      if (i >= urls.length) { done(null); return; }
      var url = urls[i++];
      var name = url.split("/").pop();
      Promise.resolve().then(function () { return fetch(url); }).then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.text();
      }).then(function (text) {
        if (!/Frame3DD|Load Case|N O D E|NODE/i.test(text)) { next(); return; }
        var parsed = App.parseOut(text);
        if (validateResults(State.model, parsed.results).ok) done({ name: name, text: text, url: url });
        else next();
      }).catch(next);
    })();
  }

  /* load the model, then attach results from the selection, the cache, and
     finally by fetching the conventional names relative to the page.
     With `noAutoAttach` the model is loaded alone and any previous results
     stay unloaded (used by File > Load model). */
  function finishModelLoad(m, candidates, noAutoAttach) {
    var first = !State.model;
    var oldName = State.inputName;
    var hadResults = !!State.results;
    var oldSig = State.modelSig;
    loadInputText(m.text, m.name, true);
    var changed = !first && oldSig !== State.modelSig;
    var reloadModified = changed && oldName && oldName === m.name;
    if (changed && hadResults) {
      clearResults();
      State.warnings.push("Input changed - previously loaded results were unloaded.");
    }
    if (changed && !reloadModified) {
      /* a different model: drop the previous model's visibility filters */
      State.vis = { hiddenNodes: {}, hiddenElems: {} };
    }
    pruneSelection();
    pruneMeasurement();
    var seq = ++State.loadSeq;
    var attached = noAutoAttach ? null : attachBestOutput(candidates, m.name, reloadModified);
    rebuild(true, !first && !changed);   /* keep the camera/visibility only on a same-model reload */
    updateFileInfo();
    if (attached) {
      if (dom.status) dom.status.textContent = "Loaded " + m.name + " with results " + attached.name + ".";
      return;
    }
    if (noAutoAttach) {
      if (dom.status) dom.status.textContent =
        "Loaded " + m.name + " without results. Use File > Load results\u2026 to attach an output file.";
      return;
    }
    if (reloadModified && hadResults) {
      if (dom.status) dom.status.textContent = "Input changed - results unloaded. Use File > Load results\u2026 to attach new output.";
      return;
    }
    discoverByFetch(m.name, function (hit) {
      if (seq !== State.loadSeq) return;      /* a newer model was loaded meanwhile */
      if (hit) {
        cacheFile(hit.name, hit.text);
        attachResults(hit.text, hit.name, true);
        rebuild(true, true);
        updateFileInfo();
        if (dom.status) dom.status.textContent = "Loaded " + m.name + " with results " + hit.name + " (auto-attached).";
      } else if (dom.status) {
        dom.status.textContent = "Model " + m.name +
          " loaded without matching results. Use File > Load results\u2026 to attach them.";
      }
    });
  }

  /* Read one or more files, classify each as model / results and load them
     together, matching an output file to the model with the same base name.
     `opts.clearResults` makes this an explicit "Load model" action: any
     previously attached output is dropped and no output is auto-attached. */
  function loadFiles(files, opts) {
    opts = opts || {};
    var list = Array.prototype.slice.call(files || []);
    var skipped = 0;
    list = list.filter(function (f) {
      if (isCsvFile(f && f.name)) { skipped++; return false; }
      return true;
    });
    if (skipped) showMessage("CSV files are not supported - load a .3dd model and a .out results file.", true);
    if (!list.length) return;
    if (opts.clearResults) {
      clearResults();
      clearSel();
      if (engine && engine.setSelection) engine.setSelection([]);
      State.opts.modalInput = false;
    }
    var pending = list.length;
    var models = [], outputs = [];

    function done() {
      if (models.length) {
        var m = models[models.length - 1];
        if (opts.clearResults) { finishModelLoad(m, [], true); return; }
        var cands = [];
        var preferred = pickOutputFor(outputs, m.base);
        if (preferred) cands.push(preferred);
        for (var i = 0; i < outputs.length; i++) if (outputs[i] !== preferred) cands.push(outputs[i]);
        finishModelLoad(m, cands);
      } else if (outputs.length) {
        /* results need the input model first */
        if (!State.model) { showMessage("No input model loaded - load the model (.3dd) before results."); return; }
        attachResults(outputs[outputs.length - 1].text, outputs[outputs.length - 1].name, true);
        rebuild();
        updateFileInfo();
      }
    }

    list.forEach(function (file) {
      var fr = new FileReader();
      fr.onload = function () {
        var text = String(fr.result || "");
        cacheFile(file.name, text);
        var item = { name: file.name, text: text, base: baseName(file.name) };
        if (detectKind(text, file.name) === "output") outputs.push(item); else models.push(item);
        if (--pending === 0) done();
      };
      fr.onerror = function () { if (--pending === 0) done(); };
      fr.readAsText(file);
    });
  }

  /* ---- folder scanning: auto-detect model + output by file name ------ */
  var FILE_RE = /\.(3dd|out|txt)$/i;

  /* load a chosen model and attach the first output that passes validation */
  function loadModelWithOutput(m, outputs) {
    var cands = [];
    var preferred = pickOutputFor(outputs, m.base);
    if (preferred) cands.push(preferred);
    for (var i = 0; i < outputs.length; i++) if (outputs[i] !== preferred) cands.push(outputs[i]);
    finishModelLoad(m, cands);
  }

  /* Entries from a folder (or a set of dropped files): classify, then load the
     model with its output by name. Several models -> ask which one. */
  function onFolderEntries(entries) {
    entries.forEach(function (e) { cacheFile(e.name, e.text); });
    var models = [], outputs = [];
    entries.forEach(function (e) {
      if (!FILE_RE.test(e.name)) return;
      var item = { name: e.name, text: e.text, base: baseName(e.name) };
      if (detectKind(e.text, e.name) === "output") outputs.push(item); else models.push(item);
    });
    if (!models.length) {
      if (outputs.length) { attachResults(outputs[0].text, outputs[0].name, true); rebuild(); updateFileInfo(); }
      else showMessage("No Frame3DD files found in the selected folder.", true);
      return;
    }
    if (models.length === 1) { loadModelWithOutput(models[0], outputs); return; }
    models.sort(function (a, b) { return a.name.localeCompare(b.name); });
    /* let the user pick which model to open; the matching output is automatic */
    showChoiceMenu("Select the model to open", models.map(function (m) {
      var o = pickOutputFor(outputs, m.base);
      return { label: m.name + (o ? "   \u2192  " + o.name : "   (no output found)"),
        run: function () { loadModelWithOutput(m, outputs); } };
    }));
  }

  /* Walk dropped directory entries (Chromium) and collect text files. */
  function readEntryTree(entry, out, done) {
    if (entry.isFile) {
      entry.file(function (f) {
        if (!FILE_RE.test(f.name)) { done(); return; }
        var fr = new FileReader();
        fr.onload = function () { out.push({ name: f.name, text: String(fr.result || "") }); done(); };
        fr.onerror = done;
        fr.readAsText(f);
      }, done);
      return;
    }
    if (entry.isDirectory) {
      var reader = entry.createReader(), all = [];
      (function readBatch() {
        reader.readEntries(function (batch) {
          if (!batch.length) { finish(); return; }
          for (var i = 0; i < batch.length; i++) all.push(batch[i]);
          readBatch();
        }, finish);
      })();
      function finish() {
        if (!all.length) { done(); return; }
        var pending = all.length;
        all.forEach(function (ch) { readEntryTree(ch, out, function () { if (--pending === 0) done(); }); });
      }
      return;
    }
    done();
  }

  function readEntries(entries, cb) {
    var out = [], pending = entries.length;
    if (!pending) { cb(out); return; }
    entries.forEach(function (en) { readEntryTree(en, out, function () { if (--pending === 0) cb(out); }); });
  }

  /* explicit single-kind load (menu "Load resultsâ€¦") */
  function readFile(file, kind) {
    if (!file) return;
    if (isCsvFile(file.name)) {
      showMessage("CSV files are not supported - load a .3dd model and a .out results file.", true);
      return;
    }
    if (!kind) { loadFiles([file]); return; }
    var fr = new FileReader();
    fr.onload = function () {
      var text = String(fr.result || "");
      try {
        if (kind === "output") { cacheFile(file.name, text); attachResults(text, file.name); }
        else loadInputText(text, file.name);
        updateFileInfo();
      } catch (err) {
        showMessage("Failed to parse " + file.name + ": " + (err && err.message ? err.message : err));
      }
    };
    fr.onerror = function () { showMessage("Could not read " + file.name + "."); };
    fr.readAsText(file);
  }

  function updateFileInfo() {
    var parts = [];
    parts.push(State.inputName ? "in: " + State.inputName : "in: \u2014");
    parts.push(State.outputName ? "out: " + State.outputName : "out: \u2014");
    if (State.model) parts.push(State.model.counts.nodes + " nodes / " + State.model.counts.elements + " elements");
    dom.fileinfo.textContent = parts.join("  \u00b7  ");
  }

  /* ---- state setters (toolbar controls and menus stay in sync) ------- */
  function setCaseIndex(v) {
    State.opts.caseIndex = v || 0;
    renderLoads(); renderDisp(); renderEndForces(); renderReactions(); renderPeak();
    if (State.opts.modeIndex === 0) applyAutoScale();
    updatePlayCtl();
    populateCaseModeSelect();
    drawLegend();
  }
  function setModeIndex(v) {
    State.opts.modeIndex = v || 0;
    State.opts.combined = false;
    if (State.opts.modeIndex > 0) clearResultColor();
    renderModes(); applyAutoScale();
    State.playing = State.opts.modeIndex > 0 && modesHaveShapes();
    modeNotice();
    updateSpeedCtl();
    updatePlayCtl();
    populateCaseModeSelect();
    drawLegend();
  }
  /* show the modal data of the input file instead of a static load case */
  function setModalInput(on) {
    var want = !!on && modalInputAvailable() && State.mode === "pre";
    State.opts.modalInput = want;
    if (want) {
      State.opts.modeIndex = 0;
      State.opts.combined = false;
      State.playing = false;
      clearResultColor();
    }
    renderAll();
    populateCaseModeSelect();
    drawLegend();
    if (dom.status) dom.status.textContent = want
      ? "Modal analysis: " + State.model.modal.nM + " mode(s) requested. Static loads are hidden."
      : "";
  }
  function setCombined(on) {
    State.opts.combined = !!on;
    if (State.opts.combined) {
      State.opts.modeIndex = 0;
      clearResultColor();
      if (!Object.keys(State.opts.modeWeights).length) {
        var modes = (State.results && State.results.modes) || [];
        for (var i = 0; i < modes.length; i++) State.opts.modeWeights[modes[i].index] = 1;
      }
      State.playing = modesHaveShapes();
    } else {
      /* "stop" only pauses the animation; stay in the combined view (frozen)
         until the user explicitly picks another mode / Static */
      State.playing = false;
    }
    renderModes();
    applyAutoScale();
    if (dom.status) dom.status.textContent = State.opts.combined
      ? (State.playing ? "Combined multi-mode animation." : "Combined modes stopped (frozen). Pick another mode or Static to leave.")
      : "";
    updateSpeedCtl();
    updatePlayCtl();
    populateCaseModeSelect();
    drawLegend();
  }
  function togglePlay() {
    if (!canAnimate()) return;
    State.playing = !State.playing;
    if (dom.status) dom.status.textContent = State.playing
      ? (State.opts.combined ? "Animating combined modes."
        : (State.opts.modeIndex > 0 ? "Animating mode " + State.opts.modeIndex + "." : "Animating static deformation."))
      : (State.opts.combined ? "Combined modes stopped (frozen)."
        : (State.opts.modeIndex > 0 ? "Mode " + State.opts.modeIndex + " shown at the deformation scale."
          : "Static deformation shown at the deformation scale."));
    updatePlayCtl();
    drawLegend();
  }
  /* whether the current view can animate: a mode (or combined) needs mode
     shapes; a static case needs at least one non-zero displacement */
  function canAnimate() {
    if (!State.results) return false;
    if (State.opts.modeIndex > 0 || State.opts.combined) return modesHaveShapes();
    return App.maxDisp(State, { caseIndex: State.opts.caseIndex, modeIndex: 0 }) > 0;
  }
  function updatePlayCtl() {
    if (!dom.playBtn) return;
    dom.playBtn.style.display = (State.mode === "post") ? "" : "none";
    dom.playBtn.disabled = !canAnimate();
    dom.playBtn.textContent = State.playing ? "\u23F9" : "\u25B6";
    if (State.playing) dom.playBtn.classList.add("active"); else dom.playBtn.classList.remove("active");
  }
  function setWeight(modeIndex, w) { State.opts.modeWeights[modeIndex] = w; }
  function setSpeed(v) {
    v = Number(v);
    if (isFinite(v) && v > 0) State.opts.speed = v;
  }
  /* the Speed control sits next to Deformation scale and is shown in every
     Postprocessing view (it drives modes and the static "breathing") */
  function updateSpeedCtl() {
    if (!dom.speedCtl) return;
    dom.speedCtl.style.display = (State.mode === "post") ? "" : "none";
  }
  function setColorBy(v) {
    State.opts.colorBy = v;
    /* colouring and force diagrams are mutually exclusive in the Static view */
    if (v && v !== "none") State.opts.showDiagrams = false;
    renderAll();
  }
  function setShowDiagrams(on) {
    State.opts.showDiagrams = !!on;
    if (on) State.opts.colorBy = "none";
    renderAll();
  }
  /* the "Show force diagrams" toggle (kept in sync with Color by) */
  function diagramToggleItem() {
    return { label: "Show force diagrams", check: function () { return !!State.opts.showDiagrams; },
      run: function () { setShowDiagrams(!State.opts.showDiagrams); } };
  }
  /* result (load-case) colour modes apply to the Static case only; the
     mode-shape colouring is kept when a mode is active */
  var RESULT_COLOR = { Nx: 1, absVy: 1, absVz: 1, absTxx: 1, absMyy: 1, absMzz: 1, disp: 1, dispX: 1, dispY: 1, dispZ: 1 };
  function clearResultColor() {
    if (State.opts.colorBy && RESULT_COLOR[State.opts.colorBy]) State.opts.colorBy = "none";
  }
  function setDiagramKind(v) {
    State.opts.diagramKind = v;
    State.opts.showDiagrams = true;
    if (State.opts.colorBy && State.opts.colorBy !== "none") State.opts.colorBy = "none";
    renderAll();
  }
  function setProjection(v) { State.opts.projection = v; engine.setProjection(v); refreshView(); }
  function setToggle(key, val) { State.opts[key] = val; drawLegend(); }

  /* ---- display-size settings (arrow/symbol sizes) -------------------- */
  function saveSizes() {
    try { if (typeof localStorage !== "undefined") localStorage.setItem("f3dd.sizes.v2", JSON.stringify(State.opts.sizes)); } catch (e) { }
  }
  var DEFAULT_SIZES = { force: 0.45, moment: 0.95, support: 0.7, diagram: 0.3, axes: 0.5 };
  function loadSizes() {
    try {
      if (typeof localStorage === "undefined") return;
      var s = JSON.parse(localStorage.getItem("f3dd.sizes.v2") || "null");
      if (s && typeof s === "object") {
        State.opts.sizes = {
          force: isFinite(s.force) && s.force > 0 ? s.force : DEFAULT_SIZES.force,
          moment: isFinite(s.moment) && s.moment > 0 ? s.moment : DEFAULT_SIZES.moment,
          support: isFinite(s.support) && s.support > 0 ? s.support : DEFAULT_SIZES.support,
          diagram: isFinite(s.diagram) && s.diagram > 0 ? s.diagram : DEFAULT_SIZES.diagram,
          axes: isFinite(s.axes) && s.axes > 0 ? s.axes : DEFAULT_SIZES.axes
        };
      }
    } catch (e) { }
  }
  function setSize(key, v) {
    v = Number(v);
    if (!isFinite(v) || v <= 0) return;
    State.opts.sizes = State.opts.sizes || { force: DEFAULT_SIZES.force, moment: DEFAULT_SIZES.moment, support: DEFAULT_SIZES.support, diagram: DEFAULT_SIZES.diagram, axes: DEFAULT_SIZES.axes };
    State.opts.sizes[key] = Math.min(20, Math.max(0.05, v));
    if (key === "axes" && engine && engine.setAxesScale) engine.setAxesScale(State.opts.sizes.axes);
    saveSizes();
    drawLegend();
  }
  function resetSizes() {
    State.opts.sizes = { force: DEFAULT_SIZES.force, moment: DEFAULT_SIZES.moment, support: DEFAULT_SIZES.support, diagram: DEFAULT_SIZES.diagram, axes: DEFAULT_SIZES.axes };
    if (engine && engine.setAxesScale) engine.setAxesScale(DEFAULT_SIZES.axes);
    saveSizes();
    syncSettingsInputs();
    drawLegend();
  }
  function syncSettingsInputs() {
    if (!dom.settingsModal) return;
    var s = State.opts.sizes;
    if (dom.setForce) dom.setForce.value = String(s.force);
    if (dom.setMoment) dom.setMoment.value = String(s.moment);
    if (dom.setSupport) dom.setSupport.value = String(s.support);
    if (dom.setDiagram) dom.setDiagram.value = String(s.diagram === undefined ? 1 : s.diagram);
    if (dom.setAxes) dom.setAxes.value = String(s.axes === undefined ? 1 : s.axes);
  }
  function buildSettings() {
    var back = App.h("div", { "class": "modal-backdrop" });
    var box = App.h("div", { "class": "modal" });
    box.appendChild(App.h("h3", null, "Display settings"));
    box.appendChild(App.h("div", { "class": "note" }, "Multipliers for the drawn glyph sizes (shipped defaults shown)."));
    function row(label, id, key) {
      var l = App.h("label", { "class": "setrow" });
      l.appendChild(App.h("span", null, label));
      var inp = document.createElement("input");
      inp.type = "number"; inp.min = "0.05"; inp.max = "20"; inp.step = "0.05"; inp.id = id;
      inp.addEventListener("input", function () {
        var v = parseFloat(String(this.value).replace(",", "."));
        if (isFinite(v)) setSize(key, v);
      });
      l.appendChild(inp);
      box.appendChild(l);
      return inp;
    }
    dom.setForce = row("Force / load arrow length", "set-force", "force");
    dom.setMoment = row("Moment arrow size", "set-moment", "moment");
    dom.setSupport = row("Support symbol size", "set-support", "support");
    dom.setDiagram = row("Force-diagram amplitude", "set-diagram", "diagram");
    dom.setAxes = row("Global axes size", "set-axes", "axes");
    var bar = App.h("div", { "class": "modalbar" });
    var bReset = App.h("button", null, "Reset defaults");
    bReset.addEventListener("click", resetSizes);
    var bClose = App.h("button", null, "Close");
    bClose.addEventListener("click", closeSettings);
    bar.appendChild(bReset); bar.appendChild(bClose);
    box.appendChild(bar);
    back.appendChild(box);
    back.addEventListener("click", function (ev) { if (ev.target === back) closeSettings(); });
    return back;
  }
  function openSettings() {
    closeMenus();
    if (!dom.settingsModal) {
      dom.settingsModal = buildSettings();
      document.body.appendChild(dom.settingsModal);
    }
    dom.settingsModal.style.display = "flex";
    syncSettingsInputs();
  }
  function closeSettings() {
    if (dom.settingsModal) dom.settingsModal.style.display = "none";
  }

  /* ---- table row -> 3D selection ------------------------------------ */
  function selSet(kind) { return kind === "node" ? State.sel.nodes : State.sel.elems; }
  function selCount() { return Object.keys(State.sel.nodes).length + Object.keys(State.sel.elems).length; }
  function syncSelOpts() {
    State.opts.selectedNodes = Object.keys(State.sel.nodes);
    State.opts.selectedElems = Object.keys(State.sel.elems);
    /* the engine also keeps its own rubber-band highlight set; the scene
       colours now carry the selection, so drop the engine-side one */
    if (engine && engine.setSelection) engine.setSelection([]);
  }
  function clearSel() { State.sel.nodes = {}; State.sel.elems = {}; syncSelOpts(); }
  function selectionStatus() {
    var ns = Object.keys(State.sel.nodes), es = Object.keys(State.sel.elems);
    if (ns.length === 1 && es.length === 0) return "Node " + ns[0] + " selected.";
    if (es.length === 1 && ns.length === 0) return "Element " + es[0] + " selected.";
    if (ns.length + es.length) return ns.length + " node(s), " + es.length + " element(s) selected.";
    return "";
  }
  function applySelection(kind, id, ev) {
    if (id === undefined || id === null || id === "") return;
    var extend = !!(ev && (ev.ctrlKey || ev.metaKey || ev.shiftKey));
    var key = String(id);
    if (extend) {
      var set = selSet(kind);
      if (set[key]) delete set[key]; else set[key] = 1;
    } else {
      var only = Object.keys(selSet(kind));
      if (only.length === 1 && only[0] === key) State.sel[kind === "node" ? "nodes" : "elems"] = {};
      else State.sel[kind === "node" ? "nodes" : "elems"] = (function () { var o = {}; o[key] = 1; return o; })();
    }
    syncSelOpts();
    renderAll();
    if (dom.status) dom.status.textContent = selectionStatus();
  }
  function selOpts(kind, keyIndex) {
    return {
      rowKey: function (r) { return r[keyIndex || 0]; },
      selected: function (r) { return !!selSet(kind)[String(r[keyIndex || 0])]; },
      onSelect: function (r, ev) { applySelection(kind, r[keyIndex || 0], ev); }
    };
  }

  /* ---- visibility (T2) ---------------------------------------------- */
  function visibleNodeIds() {
    var out = [];
    if (State.model && State.model.nodes.length) State.model.nodes.forEach(function (n) { out.push(n.id); });
    else if (State.results && State.results.geometryFromOut) State.results.geometryFromOut.nodes.forEach(function (n) { out.push(n.id); });
    return out;
  }
  function visibleElemIds() {
    var out = [];
    if (State.model && State.model.elements.length) State.model.elements.forEach(function (e) { out.push(e.id); });
    else if (State.results && State.results.geometryFromOut) State.results.geometryFromOut.elements.forEach(function (e) { out.push(e.id); });
    return out;
  }
  function showOnlySelected() {
    if (!selCount()) { if (dom.status) dom.status.textContent = "Nothing selected - isolate does nothing."; return; }
    var hn = {}, he = {};
    visibleNodeIds().forEach(function (id) { if (!State.sel.nodes[String(id)]) hn[String(id)] = 1; });
    visibleElemIds().forEach(function (id) { if (!State.sel.elems[String(id)]) he[String(id)] = 1; });
    State.vis.hiddenNodes = hn; State.vis.hiddenElems = he;
    renderAll();
    if (dom.status) dom.status.textContent = "Showing only the selection.";
  }
  function hideSelected() {
    if (!selCount()) { if (dom.status) dom.status.textContent = "Nothing selected - hide does nothing."; return; }
    Object.keys(State.sel.nodes).forEach(function (id) { State.vis.hiddenNodes[id] = 1; });
    Object.keys(State.sel.elems).forEach(function (id) { State.vis.hiddenElems[id] = 1; });
    renderAll();
    if (dom.status) dom.status.textContent = "Selection hidden.";
  }
  function showAllVisibility() {
    State.vis.hiddenNodes = {}; State.vis.hiddenElems = {};
    renderAll();
    if (dom.status) dom.status.textContent = "All nodes and elements shown.";
  }
  function hiddenCount() { return Object.keys(State.vis.hiddenNodes).length + Object.keys(State.vis.hiddenElems).length; }

  /* ---- measure tool (distance / angle) ------------------------------ */
  function measureNeedFor(mode) { return mode === "angle" ? 3 : 2; }
  function measureNeed() { return measureNeedFor(State.measure.mode); }
  function nodeCoord(id) {
    var idn = Number(id), i;
    if (State.model) for (i = 0; i < State.model.nodes.length; i++) if (State.model.nodes[i].id === idn) return State.model.nodes[i];
    if (State.results && State.results.geometryFromOut) {
      var gn = State.results.geometryFromOut.nodes;
      for (i = 0; i < gn.length; i++) if (gn[i].id === idn) return gn[i];
    }
    return null;
  }
  /* result text for a completed (or in-progress) measurement object */
  function measureResultText(m) {
    if (m.points.length < measureNeedFor(m.mode)) return "";
    if (m.mode === "distance") {
      var a = nodeCoord(m.points[0]), b = nodeCoord(m.points[1]);
      if (!a || !b) return "";
      return "Distance " + m.points[0] + "\u2013" + m.points[1] + " = " + number(App.pointDistance(a, b), 6);
    }
    var p0 = nodeCoord(m.points[0]), p1 = nodeCoord(m.points[1]), p2 = nodeCoord(m.points[2]);
    if (!p0 || !p1 || !p2) return "";
    return "Angle " + m.points[0] + "\u2013" + m.points[1] + "\u2013" + m.points[2] + " = " + number(App.pointAngle(p0, p1, p2), 5) + "\u00b0";
  }
  function setMeasureMode(mode) {
    State.measure = { active: true, mode: mode, points: [], done: State.measure && State.measure.done ? State.measure.done.slice() : [] };
    renderAll();
    if (dom.status) dom.status.textContent = mode === "angle"
      ? "Measure angle: pick 3 nodes (vertex is the middle pick). Esc clears."
      : "Measure distance: pick 2 nodes. Esc clears.";
  }
  function clearMeasure() {
    State.measure = { active: false, mode: State.measure.mode || "distance", points: [], done: [] };
    renderAll();
    if (dom.status) dom.status.textContent = "";
  }
  function addMeasurePoint(id) {
    var m = State.measure, need = measureNeed();
    if (m.points.length >= need) m.points = [];
    m.points.push(String(id));
    if (m.points.length >= need) {
      var done = { mode: m.mode, points: m.points.slice() };
      (m.done = m.done || []).push(done);
      m.points = [];
      if (dom.status) dom.status.textContent = "Dimension #" + m.done.length + ": " + measureResultText(done) +
        "   (Esc to clear; pick again to start a new measurement)";
    } else if (dom.status) {
      dom.status.textContent = "Pick " + (need - m.points.length) + " more node(s)\u2026";
    }
    renderAll();
  }
  function pruneMeasurement() {
    var m = State.measure;
    if (!m) return;
    if (m.points && m.points.length) m.points = m.points.filter(function (id) { return !!nodeCoord(id); });
    if (m.done && m.done.length) {
      m.done = m.done.map(function (d) {
        return { mode: d.mode, points: d.points.filter(function (id) { return !!nodeCoord(id); }) };
      }).filter(function (d) { return d.points.length >= measureNeedFor(d.mode); });
    }
  }
  function switchTab(paneId) {
    var all = App.$$("#tabs .tabbtn");
    var wanted = all.filter(function (x) { return x.getAttribute("data-tab") === paneId; })[0];
    if (wanted && wanted.disabled) {
      var alt = all.filter(function (x) { return x.style.display !== "none" && !x.disabled; })[0];
      if (alt) paneId = alt.getAttribute("data-tab");
    }
    all.forEach(function (x) {
      if (x.getAttribute("data-tab") === paneId) x.classList.add("active"); else x.classList.remove("active");
    });
    App.$$(".pane").forEach(function (x) {
      if (x.id === paneId) x.classList.add("active"); else x.classList.remove("active");
    });
    var btn = all.filter(function (x) { return x.getAttribute("data-tab") === paneId; })[0];
    if (btn) {
      var m = btn.getAttribute("data-mode") || "both";
      if (m !== "both" && m.split(" ").indexOf(State.mode) < 0) State.mode = m.split(" ")[0];
      State.lastTab[State.mode] = paneId;
    }
    if (paneId === "tab-raw") renderRaw();
  }

  /* top-level Preprocessing / Postprocessing switch: shows the matching
     sub-tabs and keeps the last table used in each mode. */
  function setMode(mode) {
    State.mode = mode;
    App.$$(".modebtn").forEach(function (b) {
      if (b.getAttribute("data-mode") === mode) b.classList.add("active"); else b.classList.remove("active");
    });
    /* the deformation scale only applies to results (Postprocessing) */
    if (dom.scaleCtl) dom.scaleCtl.style.display = (mode === "post") ? "" : "none";
    updateSpeedCtl();
    updatePlayCtl();
    var visible = [];
    App.$$("#tabs .tabbtn").forEach(function (b) {
      var m = b.getAttribute("data-mode") || "both";
      var show = (m === "both" || m.split(" ").indexOf(mode) >= 0);
      b.style.display = show ? "" : "none";
      if (show && !b.disabled) visible.push(b);
    });
    App.$$("#tabs .grp").forEach(function (g) {
      var m = g.getAttribute("data-mode") || "both";
      g.style.display = (m === "both" || m.split(" ").indexOf(mode) >= 0) ? "" : "none";
    });
    var active = App.$$("#tabs .tabbtn").filter(function (b) { return b.classList.contains("active"); })[0];
    var target = null;
    if (active && active.style.display !== "none" && !active.disabled) target = active.getAttribute("data-tab");
    else {
      var remembered = State.lastTab[mode];
      for (var i = 0; i < visible.length; i++) if (visible[i].getAttribute("data-tab") === remembered) target = remembered;
      if (!target && visible.length) target = visible[0].getAttribute("data-tab");
    }
    if (target) switchTab(target);
    if (mode !== "post") State.playing = false;   /* no mode animation in Preprocessing */
    if (mode !== "pre") State.opts.modalInput = false;
    populateCaseModeSelect();
    buildMenuBar();   /* menu contents depend on the active mode */
    drawLegend();     /* refresh the scene/legend for the new mode */
  }
  function clearAll() {
    State.model = State.results = null; State.warnings = [];
    State.inputText = State.outputText = null;
    State.inputName = State.outputName = "";
    State.opts.caseIndex = 0; State.opts.modeIndex = 0;
    State.opts.combined = false; State.opts.modeWeights = {}; State.opts.modeEnabled = {};
    State.opts.modalInput = false;
    State.modelSig = null;
    State.playing = false;
    State.vis = { hiddenNodes: {}, hiddenElems: {} };
    State.measure = { active: false, mode: "distance", points: [], done: [] };
    clearSel();
    if (engine) engine.setSelection([]);
    rebuild(); updateFileInfo(); showMessage("");
  }
  /* ---- help dialog --------------------------------------------------- */
  var HELP = {
    overview: { title: "Getting started", body: [
      "File \u203a Load model\u2026 picks a .3dd model, unloads any previously attached results and clears the selection (safer - use Load results\u2026 afterwards).",
      "Drop a model together with its .out file (or a whole folder) to attach results by matching name.",
      "The list in the top bar (next to Preprocessing / Postprocessing) selects the load case, the vibration mode or the modal analysis view.",
      "Preprocessing shows the model only. Switch to Postprocessing to see displacements, end forces, reactions, peak values and modes.",
      "Switching back to Preprocessing hides all result views again."
    ] },
    file: { title: "File", body: [
      "Load model\u2026 - choose the input model (.3dd). Previously attached results are unloaded and the selection is cleared.",
      "Load results\u2026 - attach an output file (.out) to the loaded model. A model must be loaded first, otherwise an error dialog appears.",
      "CSV files are not supported.",
      "Clear all - unload everything and reset the view."
    ] },
    view: { title: "View", body: [
      "View +X / -X / +Y / -Y / +Z / -Z look along the scene axes; Isometric is a 3/4 view.",
      "Projection - perspective or orthographic.",
      "Fit frames the model; Reset view returns to the default view.",
      "Selection & visibility - Show only selected, Hide selected, Show all, ghost hidden, clear selection. Available in both Preprocessing and Postprocessing."
    ] },
    display: { title: "Display", body: [
      "Undeformed / Deformed shape, Nodes, Node numbers, Elements, Element numbers.",
      "Member local axes (x/y/z triad) and Principal inertia axis (gold Iyy/Izz arrow).",
      "Hinges (moment-free member ends), Supports, Grid, Axes.",
      "Loads submenu - per-category toggles (nodal forces/moments, uniform, trapezoidal, point, gravity, prescribed). Nodal forces are orange, uniformly distributed loads light blue, trapezoidal loads violet, interior point loads magenta and self-weight grey.",
      "All loads is the master switch: turning it off unchecks and hides every load category and the \u0394T colouring. Switching an individual category (or \u0394T) back on also re-enables All loads.",
      "In a file with modal data the Loads submenu also lists the modal markers: node masses/inertia, element extra mass and condensation nodes (all on by default). They are drawn in the Preprocessing modal view and in Postprocessing only while a vibration mode (or the combined animation) is shown, not in the Static case.",
      "Stiffness options badge - top-level toggle (on by default) showing the geometric-stiffness, shear-deformation and mass-matrix settings.",
      "Color by (model) - Material/section groups or Support type. Temperature colouring is the separate \"Colour members by \u0394T\" toggle in the Loads submenu (on by default); it colours the members whenever the active case has temperature loads.",
      "The top-bar list chooses the load case (Preprocessing) or the static case / vibration mode (Postprocessing).",
      "Force diagrams are controlled from the Results menu (Postprocessing only).",
      "Settings\u2026 adjusts the drawn sizes: load arrow length, moment arrow size, support symbol size and force-diagram amplitude."
    ] },
    results: { title: "Results (Postprocessing)", body: [
      "The top-bar list - a Static Case per load case, a vibration mode, or Combined (multi-mode) when the output has mode shapes.",
      "Color by - Nx, |Vy|, |Vz|, |Txx|, |Myy|, |Mzz|, |disp|, dispX, dispY, dispZ. Available for the Static case only (greyed out while a mode is selected).",
      "Diagrams - analytical force diagrams (Nx, Vy, Vz, Myy, Mzz). Available for the Static case only.",
      "Colour by and force diagrams are mutually exclusive: choosing one switches the other off.",
      "Play/Stop (toolbar, next to Speed) - animates the current view: a selected mode, the combined animation, or the static deformation (the shape breathes through the deformation scale). While paused, a mode shows its own shape at the deformation scale.",
      "Speed (toolbar, next to Deformation scale) - shown in Postprocessing; controls how fast the mode / static animation plays.",
      "Auto deformation scale."
    ] },
    measure: { title: "Measure", body: [
      "Distance (2 points) - pick two nodes; the distance is drawn on the canvas and shown in the status line.",
      "Angle (3 points) - pick three nodes, the vertex is the middle pick; the angle is drawn with an arc.",
      "Dimensions accumulate while the measure mode is active: pick again to start the next one; Clear measurement or Esc removes them all."
    ] },
    data: { title: "Data", body: [
      "Overview, Raw files and navigation to every preprocessing / postprocessing tab."
    ] },
    mouse: { title: "Mouse & keyboard", body: [
      "Left-click: select a node/element (replaces the selection).",
      "Ctrl/Shift-click: add or toggle a single item.",
      "Left-drag: box-select. Left\u2192right = window (only fully enclosed), right\u2192left = crossing (touching counts).",
      "Hold Ctrl while dragging the box to add its result to the current selection.",
      "Shift-drag or middle-drag: pan. Right-drag: rotate (full 360\u00b0). Right-click: context menu. Wheel: zoom.",
      "Esc: clear the selection, cancel measuring, close menus and dialogs."
    ] },
    about: { title: "About", body: [
      "Frame3DD viewer - plain HTML/CSS/JS, no external libraries.",
      "Frame3DD project: http://frame3dd.sf.net/"
    ] }
  };
  function buildHelp() {
    var back = App.h("div", { "class": "modal-backdrop" });
    var box = App.h("div", { "class": "modal help" });
    box.appendChild(App.h("h3", null, "Help"));
    var main = App.h("div", { "class": "helpmain" });
    var nav = App.h("div", { "class": "helpnav" });
    dom.helpNav = nav;
    Object.keys(HELP).forEach(function (k) {
      var b = App.h("button", { "class": "helpnavbtn" }, HELP[k].title);
      b.setAttribute("data-topic", k);
      b.addEventListener("click", function () { showHelpTopic(k); });
      nav.appendChild(b);
    });
    var wrap = App.h("div", { "class": "helpbody" });
    dom.helpTitle = App.h("h4", null, HELP.overview.title);
    dom.helpBody = App.h("div");
    wrap.appendChild(dom.helpTitle);
    wrap.appendChild(dom.helpBody);
    main.appendChild(nav); main.appendChild(wrap);
    box.appendChild(main);
    var bar = App.h("div", { "class": "modalbar" });
    var bClose = App.h("button", null, "Close");
    bClose.addEventListener("click", closeHelp);
    bar.appendChild(bClose);
    box.appendChild(bar);
    back.appendChild(box);
    back.addEventListener("click", function (ev) { if (ev.target === back) closeHelp(); });
    return back;
  }
  function showHelpTopic(key) {
    var book = HELP[key] || HELP.overview;
    dom.helpTitle.textContent = book.title;
    App.clear(dom.helpBody);
    book.body.forEach(function (p) { dom.helpBody.appendChild(App.h("p", null, p)); });
    if (dom.helpNav) App.$$(".helpnavbtn", dom.helpNav).forEach(function (b) {
      if (b.getAttribute("data-topic") === (HELP[key] ? key : "overview")) b.classList.add("active");
      else b.classList.remove("active");
    });
  }
  function openHelp(key) {
    closeMenus();
    if (!dom.helpModal) { dom.helpModal = buildHelp(); document.body.appendChild(dom.helpModal); }
    dom.helpModal.style.display = "flex";
    showHelpTopic(key || "overview");
  }
  function closeHelp() { if (dom.helpModal) dom.helpModal.style.display = "none"; }

  /* ---- command + menu system (Windows style) ------------------------- */
  var CTX_END = function () { return true; };

  function radioCmd(label, group, value, getter) {
    return { label: label, radio: true, check: function () { return getter() === value; },
      run: function () { group(value); } };
  }
  function checkCmd(label, key, needsResults) {
    return { label: label, disabled: needsResults ? function () { return !State.results; } : undefined,
      check: function () { return !!State.opts[key]; },
      run: function () { setToggle(key, !State.opts[key]); } };
  }
  /* a load-category toggle: it reads as unchecked when the master "All loads"
     switch is off, and switching a category back on enables that master. */
  function loadCatCmd(label, key) {
    return {
      label: label,
      check: function () { return !!State.opts.showLoads && !!State.opts[key]; },
      run: function () {
        var on = !!State.opts.showLoads && !!State.opts[key];
        State.opts[key] = !on;
        if (!on) State.opts.showLoads = true;
        drawLegend();
      }
    };
  }

  function colorItems() {
    var opts = [["none", "none"], ["Nx", "Nx (axial)"], ["absVy", "|Vy| shear"], ["absVz", "|Vz| shear"],
      ["absTxx", "|Txx| torsion"], ["absMyy", "|Myy| bending"], ["absMzz", "|Mzz| bending"], ["disp", "|disp| magnitude"],
      ["dispX", "dispX"], ["dispY", "dispY"], ["dispZ", "dispZ"]];
    var get = function () { return State.opts.colorBy; };
    var items = opts.map(function (o) { return radioCmd(o[1], setColorBy, o[0], get); });
    return items;
  }
  /* colour modes that need only the model (no analysis results) */
  function modelColorItems() {
    var get = function () { return State.opts.colorBy; };
    return [
      radioCmd("none", setColorBy, "none", get),
      radioCmd("Material / section groups", setColorBy, "matgroup", get),
      radioCmd("Support type", setColorBy, "support", get)
    ];
  }
  function diagramKindItems() {
    var kinds = [["Nx", "Nx (axial)"], ["Vy", "|Vy| shear"], ["Vz", "|Vz| shear"],
      ["Txx", "|Txx| torsion"], ["Myy", "|Myy| bending"], ["Mzz", "|Mzz| bending"], ["all", "all of the above"]];
    return kinds.map(function (kd) {
      return radioCmd(kd[1], setDiagramKind, kd[0], function () { return State.opts.diagramKind; });
    });
  }
  function selectionItems() {
    return [
      { label: "Show only selected", disabled: function () { return selCount() === 0; }, run: showOnlySelected },
      { label: "Hide selected", disabled: function () { return selCount() === 0; }, run: hideSelected },
      { label: "Show all", run: showAllVisibility },
      "-",
      checkCmd("Ghost hidden (faded)", "ghostHidden"),
      { label: "Clear selection", run: function () { clearSel(); renderAll(); } }
    ];
  }
  function measureItems() {
    return [
      { label: "Distance (2 points)", radio: true,
        check: function () { return State.measure.active && State.measure.mode === "distance"; },
        run: function () { setMeasureMode("distance"); } },
      { label: "Angle (3 points, vertex middle)", radio: true,
        check: function () { return State.measure.active && State.measure.mode === "angle"; },
        run: function () { setMeasureMode("angle"); } },
      "-",
      { label: "Clear measurement", disabled: function () {
          return !State.measure.active && !State.measure.points.length && !((State.measure.done || []).length); },
        run: clearMeasure }
    ];
  }
  function loadToggleItems() {
    var items = [
      checkCmd("All loads", "showLoads"),
      "-",
      loadCatCmd("Nodal forces", "showNodalLoads"),
      loadCatCmd("Nodal moments", "showMomentLoads"),
      loadCatCmd("Uniform (distributed)", "showUniformLoads"),
      loadCatCmd("Trapezoidal (distributed)", "showTrapezoidLoads"),
      loadCatCmd("Interior point loads", "showPointLoads"),
      loadCatCmd("Self-weight (gravity)", "showGravity"),
      "-",
      loadCatCmd("Prescribed displacements", "showPrescribed")
    ];
    if (modalInputAvailable()) {
      items.push("-");
      items.push(loadCatCmd("Node masses / inertia", "showNodeInertia"));
      items.push(loadCatCmd("Element extra mass", "showElemMass"));
      items.push(loadCatCmd("Condensation nodes", "showCondensation"));
    }
    items.push({
      label: "Colour members by \u0394T",
      check: function () { return !!State.opts.showLoads && State.opts.colorBy === "temperature"; },
      run: function () {
        var on = !!State.opts.showLoads && State.opts.colorBy === "temperature";
        if (on) {
          setColorBy("none");
        } else {
          State.opts.showLoads = true;
          setColorBy("temperature");
        }
      }
    });
    return items;
  }
  function projItems() {
    return [
      radioCmd("Perspective", setProjection, "persp", function () { return State.opts.projection; }),
      radioCmd("Orthographic", setProjection, "ortho", function () { return State.opts.projection; })
    ];
  }
  function viewItems() {
    return [
      { label: "View +X", run: function () { engine.setView("view+x"); refreshView(); } },
      { label: "View -X", run: function () { engine.setView("view-x"); refreshView(); } },
      { label: "View +Y", run: function () { engine.setView("view+y"); refreshView(); } },
      { label: "View -Y", run: function () { engine.setView("view-y"); refreshView(); } },
      { label: "View +Z", run: function () { engine.setView("view+z"); refreshView(); } },
      { label: "View -Z", run: function () { engine.setView("view-z"); refreshView(); } },
      "-",
      { label: "Isometric", run: function () { engine.setView("iso"); refreshView(); } },
      "-",
      { label: "Fit", run: function () { engine.fit(getScene()); } },
      { label: "Reset view", run: function () { applyViewForGeometry(); refreshView(); } }
    ];
  }
  function displayItems() {
    var items = [
      checkCmd("Undeformed shape", "showUndeformed"),
      checkCmd("Deformed shape", "showDeformed", true),
      "-",
      checkCmd("Nodes", "showNodes"),
      checkCmd("Node numbers", "showNodeLabels"),
      checkCmd("Elements", "showElements"),
      checkCmd("Element numbers", "showElemLabels"),
      checkCmd("Member local axes (x/y/z)", "showLocalAxes"),
      checkCmd("Principal inertia axis (Iyy/Izz)", "showPrincipalAxis"),
      checkCmd("Hinges (moment-free member ends)", "showHinges"),
      "-",
      { label: "Loads", items: loadToggleItems },
      checkCmd("Supports", "showRestraints"),
      checkCmd("Stiffness options badge", "showStiffness"),
      "-",
      { label: "Color by (model)", items: modelColorItems },
      "-",
      checkCmd("Grid", "showGrid"),
      checkCmd("Axes", "showAxes"),
      "-",
      { label: "Settings\u2026", run: openSettings }
    ];
    /* results-only entries are hidden while in Preprocessing */
    items.forEach(function (it) {
      if (!it || !it.label) return;
      if (it.label === "Deformed shape") it.mode = "post";
    });
    return items;
  }
  function tabCmd(label, paneId, mode, needsResults) {
    return {
      label: label,
      disabled: needsResults ? function () { return !State.results; } : undefined,
      run: function () { if (mode) setMode(mode); switchTab(paneId); }
    };
  }
  function dataItems() {
    return [
      tabCmd("Overview", "tab-overview"),
      "-",
      { label: "Preprocessing", items: function () {
          return [
            tabCmd("Overview", "tab-overview", "pre"),
            "-",
            tabCmd("Nodes", "tab-nodes", "pre"),
            tabCmd("Supports (restraints)", "tab-restraints", "pre"),
            tabCmd("Elements / sections", "tab-elements", "pre"),
            tabCmd("Load cases", "tab-loads", "pre"),
            "-",
            tabCmd("Raw files", "tab-raw", "pre")
          ];
        } },
      { label: "Postprocessing", mode: "post", items: function () {
          return [
            tabCmd("Overview", "tab-overview", "post"),
            "-",
            tabCmd("Displacements", "tab-disp", "post", true),
            tabCmd("End Forces", "tab-ef", "post", true),
            tabCmd("Reactions", "tab-reac", "post", true),
            tabCmd("Peak Internal Forces", "tab-peak", "post", true),
            tabCmd("Modes", "tab-modes", "post", true),
            "-",
            tabCmd("Raw files", "tab-raw", "post")
          ];
        } },
      "-",
      tabCmd("Raw files", "tab-raw")
    ];
  }
  function menuItems() {
    return [
      { label: "Load model\u2026", run: function () { dom.fileInput.click(); } },
      { label: "Load results\u2026", run: function () { dom.fileOutput.click(); } },
      "-",
      { label: "Clear all", run: clearAll }
    ];
  }
  function resultsItems() {
    var noRes = function () { return !State.results; };
    var modeOn = function () { return State.opts.modeIndex > 0 || !!State.opts.combined; };
    return [
      { label: "Color by", items: colorItems, disabled: function () { return !State.results || modeOn(); } },
      { label: "Diagrams", items: function () {
          return [
            diagramToggleItem(),
            "-",
            { label: "Kind", items: diagramKindItems },
            checkCmd("Value labels", "diagramLabels")
          ];
        }, disabled: function () { return !State.results || modeOn(); } },
      "-",
      { label: "Auto deformation scale", disabled: noRes, run: applyAutoScale }
    ];
  }
  var MENUBAR = [
    { title: "File", items: menuItems },
    { title: "View", items: function () {
        return viewItems().concat(["-",
          { label: "Projection", items: projItems },
          "-",
          { label: "Selection & visibility", items: selectionItems }]);
      } },
    { title: "Display", items: displayItems },
    { title: "Results", items: resultsItems, mode: "post" },
    { title: "Measure", items: measureItems },
    { title: "Data", items: dataItems },
    { title: "Help", run: function () { openHelp("overview"); } }
  ];

  var openMenuEl = null, openMenuBtn = null;

  function closeMenus() {
    if (openMenuEl && openMenuEl.parentNode) openMenuEl.parentNode.removeChild(openMenuEl);
    if (openMenuBtn) openMenuBtn.classList.remove("open");
    openMenuEl = null; openMenuBtn = null;
  }

  function buildDropdown(items, extraClass) {
    var box = App.h("div", { "class": extraClass || "dropdown" });
    fillMenu(box, items);
    return box;
  }

  function fillMenu(host, items) {
    (items || []).forEach(function (it) {
      if (it === "-") { host.appendChild(App.h("div", { "class": "msep" })); return; }
      if (!it || !it.label) return;
      if (it.mode && it.mode !== State.mode) return;   /* post-only entries hidden in Preprocessing */
      var hasSub = it.items && (typeof it.items === "function" ? true : it.items.length);
      var el = App.h("div", { "class": "mitem" + (hasSub ? " has-sub" : "") });
      var mark = "";
      if (it.radio) mark = (it.check && it.check()) ? "\u25CF" : "";
      else if (it.check) mark = it.check() ? "\u2713" : "";
      if (!hasSub) el.appendChild(App.h("span", { "class": "mark" }, mark));
      el.appendChild(App.h("span", null, it.label));
      if (hasSub) {
        if (it.disabled && it.disabled()) { el.classList.add("disabled"); }
        else {
          el.appendChild(App.h("span", { "class": "arrow" }, "\u25B6"));
          var sub = App.h("div", { "class": "msub" });
          var subItems = (typeof it.items === "function") ? it.items() : it.items;
          fillMenu(sub, subItems);
          el.appendChild(sub);
        }
      } else {
        if (it.disabled && it.disabled()) el.classList.add("disabled");
        else el.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (it.run) it.run();
          closeMenus();
        });
      }
      host.appendChild(el);
    });
  }

  function openTopMenu(entry, btn) {
    closeMenus();
    var box = buildDropdown((typeof entry.items === "function") ? entry.items() : entry.items, "dropdown");
    var r = btn.getBoundingClientRect();
    box.style.left = Math.round(r.left) + "px";
    box.style.top = Math.round(r.bottom) + "px";
    document.body.appendChild(box);
    btn.classList.add("open");
    openMenuEl = box; openMenuBtn = btn;
  }

  function openContextMenu(x, y) {
    closeMenus();
    var citems = [
      { label: "Fit", run: function () { engine.fit(getScene()); } },
      { label: "Reset view", run: function () { applyViewForGeometry(); refreshView(); } },
      "-",
      { label: "Show only selected", disabled: function () { return selCount() === 0; }, run: showOnlySelected },
      { label: "Hide selected", disabled: function () { return selCount() === 0; }, run: hideSelected },
      { label: "Show all", run: showAllVisibility },
      "-",
      { label: "View", items: viewItems },
      { label: "Projection", items: projItems },
      "-",
      { label: "Color by", mode: "post", items: colorItems, disabled: function () { return !State.results || State.opts.modeIndex > 0 || !!State.opts.combined; } },
      { label: "Loads", items: loadToggleItems },
      { label: "Color by (model)", items: modelColorItems },
      { label: "Measure", items: measureItems },
      { label: "Diagrams", mode: "post", items: function () {
          return [diagramToggleItem(), "-",
            { label: "Kind", items: diagramKindItems }, checkCmd("Value labels", "diagramLabels")];
        }, disabled: function () { return !State.results; } },
      "-",
      { label: "Node numbers", check: function () { return !!State.opts.showNodeLabels; },
        run: function () { setToggle("showNodeLabels", !State.opts.showNodeLabels); } },
      { label: "Element numbers", check: function () { return !!State.opts.showElemLabels; },
        run: function () { setToggle("showElemLabels", !State.opts.showElemLabels); } },
      "-",
      { label: "Settings\u2026", run: openSettings },
      { label: "Auto deformation scale", mode: "post", run: applyAutoScale }
    ];
    var box = buildDropdown(citems.filter(function (it) {
      return it === "-" || !it.mode || it.mode === State.mode;
    }), "ctxtop");
    box.style.left = x + "px";
    box.style.top = y + "px";
    document.body.appendChild(box);
    /* keep inside the viewport */
    var r = box.getBoundingClientRect();
    if (r.right > window.innerWidth) box.style.left = Math.max(2, x - r.width) + "px";
    if (r.bottom > window.innerHeight) box.style.top = Math.max(2, y - r.height) + "px";
    openMenuEl = box; openMenuBtn = null;
  }

  function buildMenuBar() {
    App.clear(dom.menubar);
    dom.menubar.appendChild(App.h("span", { "class": "menubrand" }, "Frame3DD Viewer"));
    MENUBAR.forEach(function (entry) {
      if (entry.mode && entry.mode !== State.mode) return;   /* post-only menu hidden in Preprocessing */
      var b = App.h("button", { "class": "menubtn" }, entry.title);
      if (typeof entry.run === "function") {
        /* direct action (no dropdown), e.g. Help opens its dialog */
        b.addEventListener("click", function (ev) { ev.stopPropagation(); entry.run(); });
        b.addEventListener("mouseenter", function () { closeMenus(); });
        dom.menubar.appendChild(b);
        return;
      }
      b.addEventListener("click", function (ev) {
        ev.stopPropagation();
        if (openMenuBtn === b) closeMenus(); else openTopMenu(entry, b);
      });
      b.addEventListener("mouseenter", function () { if (openMenuEl) openTopMenu(entry, b); });
      dom.menubar.appendChild(b);
    });
    if (dom.menubar) dom.menubar.appendChild(App.h("div", { "class": "mspacer", style: "flex:1" }));
  }

  /* ---- events -------------------------------------------------------- */
  function onEscape() {
    closeMenus();
    closeSettings();
    closeHelp();
    var did = false;
    if (State.measure.active || State.measure.points.length) { clearMeasure(); did = true; }
    if (selCount()) { clearSel(); renderAll(); did = true; }
    if (did && dom.status) dom.status.textContent = "";
  }
  function bind() {
    document.addEventListener("keydown", function (ev) {
      var k = ev.key || "";
      if (k === "Escape" || k === "Esc" || ev.keyCode === 27) onEscape();
    });
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("keydown", function (ev) {
        var k = ev.key || "";
        if (k === "Escape" || k === "Esc" || ev.keyCode === 27) onEscape();
      });
    }
    dom.fileInput.addEventListener("change", function () {
      loadFiles(this.files, { clearResults: true });
      this.value = "";
    });
    dom.fileOutput.addEventListener("change", function () {
      var fs = this.files, arr = Array.prototype.slice.call(fs || []);
      for (var i = 0; i < arr.length; i++) readFile(arr[i], "output");
      this.value = "";
    });

    /* the only toolbar control that is not duplicated in the menu */
    if (dom.numScale) {
      App.numberField({
        el: dom.numScale, value: State.opts.scale, onChange: setScale,
        min: 0.000001, step: 0.1,
        title: "Deformation exaggeration. Positive only; mouse wheel = \u00d7/1.1; at most 2 decimals."
      });
    }
    if (dom.numSpeed) {
      App.numberField({
        el: dom.numSpeed, value: State.opts.speed, onChange: setSpeed,
        min: 0.001, step: 0.005,
        title: "Mode animation speed. Positive only; mouse wheel = \u00d7/1.1; at most 2 decimals."
      });
    }

    dom.errbar.addEventListener("click", function () { this.className = "errbar"; this.textContent = ""; });
    if (dom.playBtn) dom.playBtn.addEventListener("click", togglePlay);
    if (dom.caseMode) dom.caseMode.addEventListener("change", function () {
      var v = String(this.value || "");
      if (v === "modal") { setModalInput(true); return; }
      if (v === "combined") { setModalInput(false); setCombined(true); return; }
      if (v.indexOf("m:") === 0) { setModalInput(false); setModeIndex(Number(v.slice(2))); return; }
      if (v.indexOf("c:") === 0) {
        setModalInput(false);
        setModeIndex(0);
        setCaseIndex(Number(v.slice(2)));
      }
    });

    App.$$("#tabs .tabbtn").forEach(function (b) {
      b.addEventListener("click", function () { if (b.disabled) return; switchTab(b.getAttribute("data-tab")); });
    });
    App.$$(".modebtn").forEach(function (b) {
      b.addEventListener("click", function () { if (b.disabled) return; setMode(b.getAttribute("data-mode")); });
    });

    buildMenuBar();

    /* a mousedown outside any menu closes it; Esc closes too */
    document.addEventListener("mousedown", function (e) {
      if (!openMenuEl) return;
      if (openMenuEl.contains && openMenuEl.contains(e.target)) return;
      if (e.target && e.target.className && String(e.target.className).indexOf("menubtn") >= 0) return;
      closeMenus();
    }, true);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMenus(); });
    window.addEventListener("blur", closeMenus);
    /* Suppress the browser's own context menu over the viewer and app chrome,
       so it cannot overlap the custom Windows-style menus. Editing/selectable
       text (inputs, the Raw <pre>) keeps its native menu. */
    document.addEventListener("contextmenu", function (e) {
      var t = e.target;
      var tag = (t && t.tagName ? t.tagName : "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (t && t.closest && t.closest("pre")) return;
      e.preventDefault();
    });

    /* drag & drop: files, or a whole folder (walked, then paired by name) */
    document.addEventListener("dragover", function (e) { e.preventDefault(); });
    document.addEventListener("drop", function (e) {
      e.preventDefault();
      var dt = e.dataTransfer;
      if (!dt) return;
      var dirs = [];
      if (dt.items && dt.items.length) {
        for (var i = 0; i < dt.items.length; i++) {
          var en = dt.items[i].webkitGetAsEntry && dt.items[i].webkitGetAsEntry();
          if (en && en.isDirectory) dirs.push(en);
        }
      }
      if (dirs.length) {
        readEntries(dirs, function (list) {
          if (list.length) onFolderEntries(list);
          else if (dt.files && dt.files.length) loadFiles(dt.files);
        });
        return;
      }
      if (dt.files && dt.files.length) loadFiles(dt.files);
    });

    window.addEventListener("resize", function () { closeMenus(); sizeCanvas(); });
  }

  /* ---- animation ----------------------------------------------------- */
  function tick() {
    if (State.playing) {
      var spd = State.opts.speed > 0 ? State.opts.speed : 0.1;
      if (State.opts.combined) {
        State.opts.time = (State.opts.time || 0) + 0.016 * spd;
      } else {
        State.opts.phase += 0.45 * spd;                 /* Speed drives any mode or the static "breathing" */
        if (State.opts.phase > Math.PI * 2) State.opts.phase -= Math.PI * 2;
      }
    }
    requestAnimationFrame(tick);
  }

  /* ---- start --------------------------------------------------------- */
  function start() {
    dom.errbar = id("errbar");
    dom.ovInput = id("ov-input");
    dom.ovOutput = id("ov-output");
    dom.ovWarnings = id("ov-warnings");
    dom.tbNodes = id("tb-nodes");
    dom.tbRestraints = id("tb-restraints");
    dom.tbElements = id("tb-elements");
    dom.tbLoads = id("tb-loads");
    dom.tbDisp = id("tb-disp");
    dom.tbEf = id("tb-ef");
    dom.tbReac = id("tb-reac");
    dom.tbPeak = id("tb-peak");
    dom.tbModes = id("tb-modes");
    dom.tbShapes = id("tb-shapes");
    dom.multiMode = id("multi-mode");
    dom.rawInput = id("raw-input");
    dom.rawOutput = id("raw-output");
    dom.canvasWrap = id("canvas-wrap");
    dom.legend = id("legend");
    dom.status = id("status");
    dom.numScale = id("num-scale");
    dom.numSpeed = id("num-speed");
    dom.speedCtl = id("speed-ctl");
    dom.scaleCtl = id("scale-ctl");
    dom.fileInput = id("file-input");
    dom.fileOutput = id("file-output");
    dom.fileinfo = id("fileinfo");
    dom.menubar = id("menubar");
    dom.playBtn = id("play-btn");
    dom.caseMode = id("case-mode");

    engine = new App.Engine3D(id("cv"), { getScene: getScene });
    engine.setProjection(State.opts.projection);
    engine.onPickPoint = function (idx) {
      var scene = getScene();
      var p = scene.points[idx];
      if (!p) return;
      if (State.measure.active) { addMeasurePoint(p.label); return; }
      applySelection("node", p.label);
    };
    engine.onPickElement = function (pick) {
      if (pick && pick.elem !== undefined) applySelection("elem", pick.elem);
    };
    engine.onBoxSelect = function (res) {
      var scene = getScene();
      /* Ctrl/Cmd + box adds to the current selection instead of replacing it */
      if (!res.additive) { State.sel.nodes = {}; State.sel.elems = {}; }
      (res.nodes || []).forEach(function (idx) {
        var p = scene.points[idx];
        if (p && p.label !== undefined && p.label !== null) State.sel.nodes[String(p.label)] = 1;
      });
      (res.elems || []).forEach(function (pk) {
        if (pk && pk.elem !== undefined) State.sel.elems[String(pk.elem)] = 1;
      });
      syncSelOpts();
      renderAll();
      if (dom.status) dom.status.textContent = selectionStatus() || "Selection cleared.";
    };
    engine.onEmptyClick = function () {
      clearSel();
      renderAll();
      if (dom.status) dom.status.textContent = "";
    };
    engine.onContextMenu = function (e) { openContextMenu(e.clientX, e.clientY); };
    engine.start();
    bind();
    setMode(State.mode);
    sizeCanvas();
    loadSizes();
    if (engine.setAxesScale) engine.setAxesScale(State.opts.sizes.axes || 1);
    rebuild(false);
    updateFileInfo();
    setScale(1);
    tick();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();


