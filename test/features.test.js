/* test/features.test.js - T2 visibility, T4 groupings, T5 loads, T6 supports,
   T7 combined animation, T8 diagram presence. */
"use strict";
const H = require("./harness");
const { App, window, makeEl } = H.loadApp();
const { ok, done } = H.makeReporter();
const ex = (n) => H.readExample(n);

/* GUI colours come from one theme module */
ok(App.colors && App.colors.measure === "#d81b60" && App.colors.support.x === "#d9534f" && App.colors.load === "#e07b00",
  "theme colours exposed through App.colors");
ok(App.colors.uniformLoad === "#29a3d1" && App.colors.trapezoidLoad === "#7e57c2" &&
  App.colors.pointLoad === "#c2185b" && App.colors.gravityLoad === "#5a6b7a",
  "load categories have distinct colours");
ok(Array.isArray(App.colors.palette) && App.colors.palette.length >= 8, "categorical palette present in theme");
ok(App.colors.axis.x === App.colors.localAxis.x && App.colors.axis.y === App.colors.localAxis.y && App.colors.axis.z === App.colors.localAxis.z,
  "global and local axes share the same X/Y/Z colours");
ok(/^#d9/i.test(App.colors.axis.x) && /^#3f/i.test(App.colors.axis.y) && /^#3a/i.test(App.colors.axis.z),
  "axes are X red, Y green, Z blue");

/* shared number-field behaviour: positive only, wheel x/1.1, <=2 decimals */
(function () {
  let got = null;
  const inp = App.numberField({ el: makeEl("input"), value: 1, onChange: v => { got = v; } });
  inp.dispatch("wheel", { deltaY: -100, preventDefault() {} });
  ok(Math.abs(got - 1.1) < 1e-9 && inp.value === "1.1", "numberField wheel up multiplies by 1.1");
  inp.dispatch("wheel", { deltaY: 100, preventDefault() {} });
  ok(Math.abs(got - 1) < 1e-9, "numberField wheel down divides by 1.1");
  inp.value = "-2"; inp.dispatch("change");
  ok(parseFloat(inp.value) > 0, "numberField rejects negative values");
  inp.value = "3.14159"; inp.dispatch("change");
  ok(inp.value === "3.14", "numberField keeps at most 2 decimals (" + inp.value + ")");
  /* allowZero: weights may be zero but never negative */
  let g2 = null;
  const wz = App.numberField({ el: makeEl("input"), allowZero: true, min: 0, value: 0, onChange: v => { g2 = v; } });
  ok(wz.value === "0", "numberField allows zero when requested");
  wz.value = "2"; wz.dispatch("wheel", { deltaY: -100, preventDefault() {} });
  ok(Math.abs(parseFloat(wz.value) - 2.2) < 1e-9, "weight field wheel multiplies by 1.1");
  wz.value = "-1"; wz.dispatch("change");
  ok(parseFloat(wz.value) >= 0, "weight field rejects negative values");
})();

/* global axes size setting */
(function () {
  const eng = new App.Engine3D(makeEl("canvas"), { getScene: function () { return { points: [], lines: [], show: {} }; } });
  eng.setAxesScale(2.5);
  ok(eng.axesScale === 2.5, "Engine3D.setAxesScale sets the global-axes size");
  eng.setAxesScale(-1);
  ok(eng.axesScale === 1, "setAxesScale rejects non-positive values");
})();

/* diverging value scale: min blue, zero green, max red */
(function () {
  ok(App.colorScale(0, -1, 1) === "rgb(46,155,63)", "value scale: zero is green");
  ok(App.colorScale(1, -1, 1) === "rgb(208,52,44)", "value scale: max positive is red");
  ok(App.colorScale(-1, -1, 1) === "rgb(31,111,178)", "value scale: min negative is blue");
  ok(App.colorScale(0, 0, 10) === "rgb(46,155,63)" && App.colorScale(10, 0, 10) === "rgb(208,52,44)",
    "non-negative range stays green -> red");
})();

function load(name) {
  return {
    model: App.parse3dd(ex(name + ".3dd")).model,
    results: App.parseOut(ex(name + ".out")).results
  };
}

/* ---- T4 groupings ---- */
const A = load("exA");
let s = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1, colorBy: "matgroup" } });
ok(s.legend && /1 material\/section group/.test(s.legend.label), "exA -> 1 material group (" + (s.legend && s.legend.label) + ")");
ok(new Set(s.lines.filter(l => l.pick).map(l => l.color)).size === 1, "exA all elements one group colour");

s = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1, colorBy: "support" } });
ok(s.legend && s.legend.entries && s.legend.entries.length >= 2, "support types legend");
/* support legend labels list the restrained DOFs (Rx/Ry/Rz/Rxx/Ryy/Rzz),
   with no "custom (...)" text and no binary mask */
const supLabels = s.legend.entries.map(e => e.text).join("|");
ok(supLabels.indexOf("custom") < 0 && supLabels.indexOf("[1") < 0,
  "support legend has no custom prefix and no binary mask");
ok(supLabels.indexOf("Rx,Rz,Rxx,Ryy") >= 0, "support legend lists the restrained DOFs (e.g. Rx,Rz,Rxx,Ryy)");
/* T6: support colouring colours the support nodes, never the elements */
ok(s.points.some(p => p.color === "#d9534f" || p.color === "#3f8f3a" || p.color === "#e6a700"),
  "support colouring colours the support nodes");
ok(s.lines.filter(l => l.pick).every(l => l.color === "#2f6fb8"),
  "support colouring leaves every element line at the default deformed colour");

const B = load("exB");
s = App.buildScene({ model: B.model, results: B.results, opts: { caseIndex: 2, colorBy: "temperature" } });
ok(s.legend && /temperature/i.test(s.legend.label) && s.legend.max > 0, "exB temperature colouring legend");

/* exE uses trapezoidal (triangular) loads: they must be distributed along
   the loaded span, not just a single arrow at one end */
(function () {
  const E2 = load("exE");
  const se = App.buildScene({ model: E2.model, results: E2.results, opts: { caseIndex: 1, showLoads: true } });
  const arrows = se.lines.filter(l => l.color === App.colors.trapezoidLoad).length;
  ok(arrows > 30, "exE trapezoidal loads draw a distributed fan of arrows (" + arrows + " lines)");
})();

/* ---- T5 loads ---- */
s = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1, showPrescribed: true } });
ok(s.lines.some(l => l.color === "#1f7a7a"), "prescribed-displacement markers present (exA case 1)");

/* T4: "All loads" off hides prescribed displacements too */
s = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1, showLoads: false, showPrescribed: true } });
ok(!s.lines.some(l => l.color === "#1f7a7a"), "All loads off hides prescribed-displacement markers");

const synth = {
  nodes: [{ id: 1, x: 0, y: 0, z: 0, r: 0 }, { id: 2, x: 100, y: 0, z: 0, r: 0 }],
  reactions: [{ node: 1, Rx: 1, Ry: 1, Rz: 1, Rxx: 1, Ryy: 1, Rzz: 1 }],
  elements: [{ id: 1, n1: 1, n2: 2, Ax: 1, Asy: 1, Asz: 1, Jxx: 1, Iyy: 1, Izz: 1, E: 29000, G: 11500, roll: 0, density: 0 }],
  flags: { shear: 0, geom: 0 }, loadCases: [{ index: 1, gravity: [0, 0, 0], nodal: [{ node: 2, Fx: 0, Fy: 0, Fz: 0, Mxx: 0, Myy: 0, Mzz: 12 }], uniform: [], trapezoid: [], point: [], temperature: [], prescribed: [] }],
  modal: null, counts: { nodes: 2, restraints: 1, elements: 1, loadCases: 1 }
};
s = App.buildScene({ model: synth, results: null, opts: { caseIndex: 1, showMomentLoads: true } });
ok(s.lines.some(l => l.color === "#9c5b00"), "nodal moment semicircle drawn");

/* ---- T6 supports ---- */
ok(s.lines.filter(l => l.color === "#4a5a6a").length >= 12, "fully fixed node draws a hatched block (" + s.lines.filter(l => l.color === "#4a5a6a").length + " lines)");
ok(s.quads.length === 0 && s.show.faces === false, "no solid quads (hatched line block instead)");

const G = load("exG");
s = App.buildScene({ model: G.model, results: G.results, opts: { caseIndex: 1 } });
ok(s.lines.filter(l => l.color === "#4a5a6a").length === 18 * 3, "exG 3 fully fixed nodes -> 54 hatched-block lines (" + s.lines.filter(l => l.color === "#4a5a6a").length + ")");

/* ---- T7 combined multi-mode ---- */
const E = load("exE");
const modes = E.results.modes;
ok(modes.length >= 3 && modes[0].shapes.length, "exE modes with shapes");
const w = {}; modes.forEach(m => w[m.index] = 0); w[modes[0].index] = 1; w[modes[1].index] = 0.5;
const t = 0.3;
const sComb = App.buildScene({ model: E.model, results: E.results, opts: { combined: true, modeWeights: w, time: t, scale: 1 } });
const nid = modes[0].shapes[0].node;
const shapeVal = (mode, node, k) => { const sh = mode.shapes.find(x => x.node === node); return sh ? sh[k] : 0; };
const expUx = shapeVal(modes[0], nid, "ux") * Math.sin(2 * Math.PI * modes[0].freq * t)
  + shapeVal(modes[1], nid, "ux") * 0.5 * Math.sin(2 * Math.PI * modes[1].freq * t);
const idx = E.model.nodes.findIndex(n => n.id === nid);
const base0 = App.buildScene({ model: E.model, results: E.results, opts: { combined: true, modeWeights: w, time: 0, scale: 1 } });
ok(Math.abs((sComb.points[idx].x - base0.points[idx].x) - expUx) < 1e-6,
  "combined ux matches weighted sum (" + (sComb.points[idx].x - base0.points[idx].x).toExponential(3) + " vs " + expUx.toExponential(3) + ")");
/* a switched-off mode is excluded from the sum */
const en = {}; en[modes[0].index] = false;
const sOff = App.buildScene({ model: E.model, results: E.results, opts: { combined: true, modeWeights: w, modeEnabled: en, time: t, scale: 1 } });
const expOff = shapeVal(modes[1], nid, "ux") * 0.5 * Math.sin(2 * Math.PI * modes[1].freq * t);
ok(Math.abs((sOff.points[idx].x - base0.points[idx].x) - expOff) < 1e-6,
  "a switched-off mode does not contribute to the combined shape");
const sUndeformed = App.buildScene({ model: E.model, results: E.results, opts: { combined: false, caseIndex: 1, scale: 0 } });
ok(Math.abs(base0.points[idx].x - sUndeformed.points[idx].x) < 1e-9, "combined at t=0 equals undeformed base");

/* T9: a playing static case "breathes" through 0.5+0.5*sin(phase) */
(function () {
  const A3 = load("exA");
  const still = App.buildScene({ model: A3.model, results: A3.results, opts: { caseIndex: 1, modeIndex: 0, scale: 1 } });
  const breath0 = App.buildScene({ model: A3.model, results: A3.results, playing: true, opts: { caseIndex: 1, modeIndex: 0, scale: 1, phase: 0 } });
  const breathMin = App.buildScene({ model: A3.model, results: A3.results, playing: true, opts: { caseIndex: 1, modeIndex: 0, scale: 1, phase: 3 * Math.PI / 2 } });
  const undeformed = App.buildScene({ model: A3.model, results: A3.results, opts: { caseIndex: 1, modeIndex: 0, scale: 0 } });
  let differ = false, back = true;
  for (let i = 0; i < still.points.length; i++) {
    if (Math.abs(breath0.points[i].x - still.points[i].x) > 1e-6 ||
        Math.abs(breath0.points[i].y - still.points[i].y) > 1e-6 ||
        Math.abs(breath0.points[i].z - still.points[i].z) > 1e-6) differ = true;
    if (Math.abs(breathMin.points[i].x - undeformed.points[i].x) > 1e-9 ||
        Math.abs(breathMin.points[i].y - undeformed.points[i].y) > 1e-9 ||
        Math.abs(breathMin.points[i].z - undeformed.points[i].z) > 1e-9) back = false;
  }
  ok(differ, "a playing static case breathes (phase 0 halves the amplitude)");
  ok(back, "at phase 3*pi/2 the static shape returns toward undeformed");
})();

/* result colouring is suppressed in a mode view */
const sMS = App.buildScene({ model: E.model, results: E.results, opts: { modeIndex: 1, colorBy: "Nx" } });
ok(sMS.legend === null, "load-case colouring is suppressed in a mode view");

/* displacement-component colour modes (dispX / dispY / dispZ) */
(function () {
  const sX = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1, colorBy: "dispX" } });
  ok(sX.legend && sX.legend.label === "dispX" && isFinite(sX.legend.max), "dispX colour mode has a legend");
  ok(sX.points.some(p => typeof p.color === "string" && p.color.indexOf("rgb(") === 0), "dispX colours the nodes");
  ok(!sX.lines.filter(l => l.pick).some(l => typeof l.color === "string" && l.color.indexOf("rgb(") === 0),
    "dispX leaves the element lines at their default colour");
  const sY = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1, colorBy: "dispY" } });
  ok(sY.legend && sY.legend.label === "dispY" && (sY.legend.max - sY.legend.min) !== 0, "dispY colour mode has a legend with a range");
  const sZ = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1, colorBy: "dispZ" } });
  ok(sZ.legend && sZ.legend.label === "dispZ", "dispZ colour mode available (zero in a 2D model)");
  const sDisp = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1, colorBy: "disp" } });
  ok(sDisp.legend && sDisp.legend.label === "Nodal displacement magnitude" && sDisp.legend.max > 0,
    "disp magnitude mode colours the nodes with a legend");
  const sMod = App.buildScene({ model: E.model, results: E.results, opts: { modeIndex: 1, colorBy: "dispX" } });
  ok(sMod.legend === null, "dispX colouring is suppressed in a mode view");
})();

/* ---- T2 visibility ---- */
const el1 = G.model.elements[0];
const isoVis = {
  hiddenElems: (function () { const h = {}; G.model.elements.forEach(e => { if (e.id !== 1) h[e.id] = 1; }); return h; })(),
  hiddenNodes: (function () { const h = {}; G.model.nodes.forEach(n => { if (n.id !== el1.n1 && n.id !== el1.n2) h[n.id] = 1; }); return h; })()
};
const sIso = App.buildScene({ model: G.model, results: G.results, vis: isoVis, opts: { caseIndex: 1 } });
ok(sIso.points.length === 2 && sIso.points.map(p => p.label).sort((a, b) => a - b).join(",") === [el1.n1, el1.n2].sort((a, b) => a - b).join(","),
  "isolate element 1 keeps exactly its two end nodes");
const sHN = App.buildScene({ model: G.model, results: G.results, vis: { hiddenNodes: { 1: 1 }, hiddenElems: {} }, opts: { caseIndex: 1 } });
ok(sHN.points.some(p => p.label === el1.n1), "node hidden but endpoint of a visible element stays visible");
const sGhost = App.buildScene({ model: G.model, results: G.results, vis: { hiddenNodes: { 1: 1 }, hiddenElems: { 1: 1 } }, opts: { caseIndex: 1, ghostHidden: true } });
ok(sGhost.points.some(p => p.label === 1 && p.color === "#c3ccd6"), "ghost hidden node drawn faded");

/* ---- T8 diagram presence ---- */
s = App.buildScene({ model: G.model, results: G.results, opts: { caseIndex: 1, showDiagrams: true, diagramKind: "Mzz" } });
ok(s.lines.some(l => l.color === "#d9534f" || l.color === "#3a6fb0"), "force diagram lines drawn");
ok(/Txx/.test(App.diagramKinds.map(k => k[0]).join(",")), "diagram kinds include torsion (Txx)");
const sT = App.buildScene({ model: G.model, results: G.results, opts: { caseIndex: 1, showDiagrams: true, diagramKind: "Txx" } });
ok(sT.lines.some(l => l.color === "#d9534f" || l.color === "#3a6fb0"), "Txx diagram kind draws lines");

/* ---- T1 box selection: window (fully enclosed) vs crossing (touch) ---- */
(function () {
  const rect = { x0: 0, y0: 0, x1: 10, y1: 10 };
  const pts = [{ x: 5, y: 5 }, { x: 20, y: 5 }, { x: -5, y: 5 }];
  const segs = [
    { x1: 1, y1: 1, x2: 5, y2: 5, pick: { elem: 1 } },   /* fully inside */
    { x1: 5, y1: 5, x2: 20, y2: 5, pick: { elem: 2 } },  /* starts inside, ends out */
    { x1: -5, y1: 5, x2: 20, y2: 5, pick: { elem: 3 } }, /* crosses through */
    { x1: 30, y1: 30, x2: 40, y2: 40, pick: { elem: 4 } }/* far away */
  ];
  const win = App.hitRect(rect, true, pts, segs);
  ok(win.nodes.join(",") === "0", "window selects only points inside the box (" + win.nodes.join(",") + ")");
  ok(win.elems.map(e => e.elem).join(",") === "1", "window requires elements fully enclosed (" + win.elems.map(e => e.elem).join(",") + ")");
  const cross = App.hitRect(rect, false, pts, segs);
  ok(cross.nodes.join(",") === "0", "crossing selects inside points");
  ok(cross.elems.map(e => e.elem).join(",") === "1,2,3", "crossing includes any touching element (" + cross.elems.map(e => e.elem).join(",") + ")");
})();

/* ---- measure tool: distance between 2 points, angle between 3 points ---- */
ok(Math.abs(App.pointDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }) - 5) < 1e-9, "pointDistance 3-4-5 = 5");
ok(Math.abs(App.pointAngle({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }) - 90) < 1e-9, "pointAngle = 90 deg");
const sDist = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1 }, measure: { active: true, mode: "distance", points: ["1", "2"] } });
ok(sDist.lines.some(l => l.color === "#d81b60" && typeof l.label === "string" && l.label.indexOf("d =") === 0),
  "distance measurement drawn with a label (" + (sDist.lines.find(l => l.color === "#d81b60" && l.label) || {}).label + ")");
const sAng = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1 }, measure: { active: true, mode: "angle", points: ["1", "2", "3"] } });
ok(sAng.lines.some(l => l.color === "#d81b60" && typeof l.label === "string" && l.label.indexOf("\u2220") === 0),
  "angle measurement drawn with a label (" + (sAng.lines.find(l => l.color === "#d81b60" && l.label) || {}).label + ")");
ok(sAng.lines.filter(l => l.color === "#d81b60" && !l.label).length > 0, "angle measurement draws segments and an arc");

/* accumulated measurements: every completed entry is drawn (T1) */
(function () {
  const sMulti = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1 },
    measure: { active: true, mode: "distance", done: [{ mode: "distance", points: ["1", "2"] }, { mode: "distance", points: ["2", "3"] }], points: [] } });
  const labels = sMulti.lines.filter(l => l.color === "#d81b60" && typeof l.label === "string" && l.label.indexOf("d =") === 0);
  ok(labels.length === 2, "accumulated measurements draw two distinct distance labels (" + labels.length + ")");
  /* an in-progress measurement draws on top of the completed ones */
  const sMixed = App.buildScene({ model: A.model, results: A.results, opts: { caseIndex: 1 },
    measure: { active: true, mode: "distance", done: [{ mode: "distance", points: ["1", "2"] }], points: ["3", "4"] } });
  ok(sMixed.lines.filter(l => l.color === "#d81b60" && typeof l.label === "string" && l.label.indexOf("d =") === 0).length === 2,
    "in-progress picks draw alongside completed measurements");
})();

/* ---- rotate: free 360 deg with no clamp stop and no jump ---- */
(function () {
  function camDir(v) { return { x: -Math.sin(v.yaw) * Math.cos(v.pitch), y: Math.sin(v.pitch), z: Math.cos(v.yaw) * Math.cos(v.pitch) }; }
  function angBetween(a, b) {
    var d = a.x * b.x + a.y * b.y + a.z * b.z;
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }
  var st = { yaw: 0.3, pitch: 1.5 }, prev = camDir(st), maxJump = 0;
  for (var i = 0; i < 400; i++) {
    st = App.turntable(st.yaw, st.pitch, 0, 3);
    var d = camDir(st);
    maxJump = Math.max(maxJump, angBetween(prev, d));
    prev = d;
  }
  ok(maxJump < 0.05, "vertical rotation is continuous (max step " + maxJump.toFixed(4) + " rad)");
  /* horizontal direction is never reversed */
  var a = App.turntable(0, 0, 10, 0), b = App.turntable(0, 0, -10, 0);
  ok(a.yaw > 0 && b.yaw < 0, "horizontal drag direction is consistent (no reversal)");
  /* a full vertical turn returns to the starting orientation */
  var full = { yaw: 0, pitch: 0 };
  for (i = 0; i < 786; i++) full = App.turntable(full.yaw, full.pitch, 0, 1);
  ok(angBetween(camDir({ yaw: 0, pitch: 0 }), camDir(full)) < 0.05, "a full 360 deg vertical turn returns to the start view");
})();

/* ---- box select: Ctrl adds to the selection (additive flag threaded) ---- */
(function () {
  const cv = makeEl("canvas");
  const scene = {
    points: [{ x: 0, y: 0, z: 0, label: 1 }, { x: 100, y: 0, z: 0, label: 2 }],
    lines: [{ a: { x: 0, y: 0, z: 0 }, b: { x: 100, y: 0, z: 0 }, pick: { elem: 1 } }],
    show: { points: true, lines: true }
  };
  const eng = new App.Engine3D(cv, { getScene: function () { return scene; } });
  eng.render();
  let got = null;
  eng.onBoxSelect = function (r) { got = r; };
  function drag(ctrlPress, ctrlRelease) {
    got = null;
    cv.dispatch("mousedown", { button: 0, clientX: 60, clientY: 19, ctrlKey: !!ctrlPress, preventDefault() {} });
    window.dispatch("mousemove", { clientX: 200, clientY: 120 });
    window.dispatch("mouseup", { button: 0, clientX: 200, clientY: 120, ctrlKey: ctrlRelease === undefined ? !!ctrlPress : !!ctrlRelease, preventDefault() {} });
  }
  drag(false);
  ok(got && got.additive === false, "plain box select is not additive");
  drag(true);
  ok(got && got.additive === true, "Ctrl + box select is additive");
  drag(true, false);
  ok(got && got.additive === true, "Ctrl held at press still adds even if released before the mouse");
})();

/* ---- display-size settings scale arrows/symbols ---- */
(function () {
  const G2 = load("exG");
  function maxLen(sc, color) {
    let m = 0;
    sc.lines.filter(l => l.color === color).forEach(l => {
      const d = Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y, l.b.z - l.a.z);
      if (d > m) m = d;
    });
    return m;
  }
  const baseF = App.buildScene({ model: G2.model, results: G2.results, opts: { caseIndex: 1 } });
  const bigF = App.buildScene({ model: G2.model, results: G2.results, opts: { caseIndex: 1, sizes: { force: 2, moment: 1, support: 1 } } });
  ok(maxLen(bigF, "#e07b00") > maxLen(baseF, "#e07b00") * 1.5, "force size setting lengthens load arrows");
  const baseS = App.buildScene({ model: G2.model, results: G2.results, opts: { caseIndex: 1 } });
  const bigS = App.buildScene({ model: G2.model, results: G2.results, opts: { caseIndex: 1, sizes: { force: 1, moment: 1, support: 2 } } });
  ok(maxLen(bigS, "#4a5a6a") > maxLen(baseS, "#4a5a6a") * 1.5, "support size setting scales the fixed-support block");
  /* diagram amplitude */
  const d1 = App.buildScene({ model: G2.model, results: G2.results, opts: { caseIndex: 1, showDiagrams: true, diagramKind: "Mzz" } });
  const d2 = App.buildScene({ model: G2.model, results: G2.results, opts: { caseIndex: 1, showDiagrams: true, diagramKind: "Mzz", sizes: { diagram: 2 } } });
  ok(maxLen(d2, "#d9534f") > maxLen(d1, "#d9534f") * 1.5, "diagram amplitude setting scales the force diagram");
  /* moments */
  const synth2 = {
    nodes: [{ id: 1, x: 0, y: 0, z: 0, r: 0 }, { id: 2, x: 100, y: 0, z: 0, r: 0 }],
    reactions: [], elements: [{ id: 1, n1: 1, n2: 2, Ax: 1, Asy: 1, Asz: 1, Jxx: 1, Iyy: 1, Izz: 1, E: 29000, G: 11500, roll: 0, density: 0 }],
    loadCases: [{ index: 1, gravity: [0, 0, 0], nodal: [{ node: 2, Fx: 0, Fy: 0, Fz: 0, Mxx: 0, Myy: 0, Mzz: 10 }], uniform: [], trapezoid: [], point: [], temperature: [], prescribed: [] }],
    counts: { nodes: 2, elements: 1, loadCases: 1 }
  };
  const mBase = App.buildScene({ model: synth2, opts: { caseIndex: 1 } });
  const mBig = App.buildScene({ model: synth2, opts: { caseIndex: 1, sizes: { force: 1, moment: 2, support: 1 } } });
  ok(maxLen(mBig, "#9c5b00") > maxLen(mBase, "#9c5b00") * 1.5, "moment size setting scales the moment arc");
})();

/* ---- model-only colour modes survive Preprocessing ---- */
(function () {
  const A2 = load("exA");
  const preMat = App.buildScene({ model: A2.model, results: null, mode: "pre", opts: { caseIndex: 1, colorBy: "matgroup" } });
  ok(preMat.legend && /material\/section group/.test(preMat.legend.label), "Preprocessing keeps material colouring (model only)");
  const preSup = App.buildScene({ model: A2.model, results: null, mode: "pre", opts: { caseIndex: 1, colorBy: "support" } });
  ok(preSup.legend && /support/i.test(preSup.legend.label), "Preprocessing keeps support colouring");
  const preRes = App.buildScene({ model: A2.model, results: null, mode: "pre", opts: { caseIndex: 1, colorBy: "Nx" } });
  ok(preRes.legend === null, "Preprocessing suppresses result-based colouring (Nx)");
})();

process.exit(done() ? 1 : 0);

