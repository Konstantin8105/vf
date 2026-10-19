/* test/scene.test.js - App.buildScene geometry, colours, supports, hinges,
   local axes, deformations and modal behaviour. */
"use strict";
const H = require("./harness");
const { App } = H.loadApp();
const { ok, done } = H.makeReporter();
const ex = (n) => H.readExample(n);

/* exA: 2D model + results */
const model = App.parse3dd(ex("exA.3dd")).model;
const results = App.parseOut(ex("exA.out")).results;
const state = { model, results, opts: { caseIndex: 1, modeIndex: 0, orientation: "auto", scale: 1, colorBy: "Nx", phase: 0 } };
const scene = App.buildScene(state);
ok(scene.points.length === 12, "exA scene points=12 (got " + scene.points.length + ")");
ok(scene.tris.length === 0 && scene.quads.length === 0, "no triangles/quads in scene (exA truss: no fixed node)");
ok(scene.show.faces === false, "faces disabled");
ok(scene.legend && scene.legend.max > 0, "legend present for Nx color");
ok(scene.lines.length > 21, "scene has undeformed + deformed + supports + loads");

const countColor = (sc, c) => sc.lines.filter(l => l.color === c).length;
ok(countColor(scene, "#3a6fb0") > 0, "Z-translation/rotation support marks present (blue)");
ok(scene.lines.every(l => !(l.color === "#c0392b")), "no legacy triangle support colour");
ok(scene.lines.filter(l => l.color === "#3a6fb0" && l.width === 1.8).length > 0, "blue translation bar+hatch marks present");

const p = scene.points[0];
ok(Math.abs(p.z) < 1e-9, "exA points have z=0 (Y-up identity)");

/* exB: 3D model + results, Z-up mapping */
const modelB = App.parse3dd(ex("exB.3dd")).model;
const resultsB = App.parseOut(ex("exB.out")).results;
const stateB = { model: modelB, results: resultsB, playing: true, opts: { caseIndex: 1, modeIndex: 1, orientation: "auto", scale: 10, colorBy: "none", phase: Math.PI / 2 } };
const sceneB = App.buildScene(stateB);
ok(sceneB.points.length === 5, "exB scene points=5");
ok(Math.abs(sceneB.points[0].y - 1000) < 0.001, "exB apex maps world Z to scene Y");
ok(App.is2DGeometry(model, results) === true, "exA detected as 2D");
ok(App.is2DGeometry(modelB, resultsB) === false, "exB detected as 3D");

/* the global axes gizmo follows the model orientation: for a Z-up model the
   model +Z points up (scene +Y) and model +Y points into the screen (scene -Z) */
const axB = sceneB.axes;
ok(Math.abs(axB.x.x - 1) < 1e-9 && Math.abs(axB.x.y) < 1e-9 && Math.abs(axB.x.z) < 1e-9,
  "exB axes: model X is scene X");
ok(Math.abs(axB.y.z + 1) < 1e-9, "exB axes: model +Y is scene -Z");
ok(Math.abs(axB.z.y - 1) < 1e-9, "exB axes: model +Z is scene +Y (up)");

/* exB case 3, node 1: ux>0, uy<0, uz<0 (see exB.out) - the drawn point must
   follow the reported global displacements under the Z-up mapping */
(function () {
  const lc3 = resultsB.loadCases.filter(c => c.index === 3)[0];
  const d1 = lc3.displacements.filter(d => d.node === 1)[0];
  const s0 = App.buildScene({ model: modelB, results: resultsB, opts: { caseIndex: 3, scale: 0 } });
  const s1 = App.buildScene({ model: modelB, results: resultsB, opts: { caseIndex: 3, scale: 1 } });
  const dx = s1.points[0].x - s0.points[0].x;
  const dy = s1.points[0].y - s0.points[0].y;
  const dz = s1.points[0].z - s0.points[0].z;
  ok(d1.ux > 0 && Math.abs(dx - d1.ux) < 1e-9, "case 3 node 1 moves in +X as reported");
  ok(d1.uz < 0 && Math.abs(dy - d1.uz) < 1e-9, "case 3 node 1 moves down in Z as reported");
  ok(d1.uy < 0 && Math.abs(dz + d1.uy) < 1e-9, "case 3 node 1 moves in -Y as reported");
})();

const stateB0 = JSON.parse(JSON.stringify(stateB)); stateB0.opts.phase = 0;
const sceneB0 = App.buildScene(stateB0);
ok(sceneB0.points[0].x !== sceneB.points[0].x || sceneB0.points[0].y !== sceneB.points[0].y,
  "mode animation changes node position with phase");

ok(App.maxDisp(state, { caseIndex: 1 }) > 0, "maxDisp>0 for static case");
ok(App.modelSize(model, results) > 0, "modelSize>0");

/* local axes + principal inertia */
const sizeB = App.modelSize(modelB, resultsB);
const sLA = App.buildScene({ model: modelB, results: resultsB, opts: { caseIndex: 1, modeIndex: 0, scale: 1, showLocalAxes: true } });
const tri = sLA.lines.filter(l => l.label === "x" || l.label === "y" || l.label === "z");
ok(tri.length >= 3 * modelB.elements.length, "local x/y/z triads drawn (" + tri.length + ")");
ok(sLA.show.lineLabels === true, "labels enabled with local axes");
const armX = tri.filter(l => l.label === "x")[0];
const armLen = Math.hypot(armX.b.x - armX.a.x, armX.b.y - armX.a.y, armX.b.z - armX.a.z);
ok(Math.abs(armLen - sizeB * 0.07) < 1e-6, "axis arm length = 0.07*size");
const sPA = App.buildScene({ model: modelB, results: resultsB, opts: { caseIndex: 1, modeIndex: 0, scale: 1, showPrincipalAxis: true } });
const gold = sPA.lines.filter(l => l.color === "#e6a700");
ok(gold.length > 0, "principal inertia arrows drawn");
ok(gold.filter(l => l.label).length === modelB.elements.length && gold.every(l => l.label !== "Izz"),
  "equal inertias -> Iyy marked");

/* hinges */
const sHinge = App.buildScene({ model, results, opts: { caseIndex: 1, modeIndex: 0, scale: 1, showHinges: true } });
ok(sHinge.lines.filter(l => l.color === "#7d3c98").length > 0, "truss hinge rings drawn");
const sNoHinge = App.buildScene({ model, results, opts: { caseIndex: 1, modeIndex: 0, scale: 1, showHinges: false } });
ok(sNoHinge.lines.filter(l => l.color === "#7d3c98").length === 0, "hinges can be turned off");
const axisRingColors = ["#d9534f", "#3f8f3a", "#3a6fb0"];
ok(axisRingColors.some(c => sNoHinge.lines.filter(l => l.color === c).length >= 12), "rotation ring drawn in an axis colour");

/* exG loads */
const modelG = App.parse3dd(ex("exG.3dd")).model;
const resultsG = App.parseOut(ex("exG.out")).results;
const sG = App.buildScene({ model: modelG, results: resultsG, opts: { caseIndex: 1, modeIndex: 0, scale: 1, showLoads: true } });
ok(sG.lines.some(l => l.color === "#e07b00"), "exG draws orange nodal force arrows");
ok(sG.lines.filter(l => l.color === "#29a3d1").length > 24, "exG draws light-blue uniform load arrows");
ok(sG.lines.some(l => l.color === "#5a6b7a" && l.label === "g"), "gravity arrow is grey and labelled g");

/* exC: uniform element loads must be drawn and painted above the model */
(function () {
  const modelC = App.parse3dd(ex("exC.3dd")).model;
  const resultsC = App.parseOut(ex("exC.out")).results;
  const sC = App.buildScene({ model: modelC, results: resultsC, opts: { caseIndex: 1 } });
  const uC = sC.lines.filter(l => l.color === App.colors.uniformLoad);
  ok(uC.length > 0, "exC draws uniform element-load arrows (" + uC.length + " lines)");
  ok(uC.every(l => l.overlay === true), "load arrows are overlay annotations (drawn on top of the model)");
  const sCoff = App.buildScene({ model: modelC, results: resultsC, opts: { caseIndex: 1, showUniformLoads: false } });
  ok(!sCoff.lines.some(l => l.color === App.colors.uniformLoad), "uniform loads can be switched off");
})();

/* selection highlight */
const sSel = App.buildScene({ model: modelB, results: resultsB, opts: { caseIndex: 1, modeIndex: 0, scale: 1, selectedNodes: [1], selectedElems: [2] } });
ok(sSel.points.some(p => p.color === "#d9822b" && p.size > 6), "selected node highlighted");
ok(sSel.lines.some(l => l.color === "#d9822b" && l.width > 3), "selected element highlighted");

/* output-only */
ok(App.buildScene({ model: null, results, opts: {} }).points.length === 12, "out-only build recovers geometry from echo");
ok(typeof App.Engine3D === "function", "App.Engine3D exposed");

/* modal handling */
const modelE = App.parse3dd(ex("exE.3dd")).model;
const resultsE = App.parseOut(ex("exE.out")).results;
ok(resultsE.modes.length === 4, "exE.out modes=4");
const sE1 = App.buildScene({ model: modelE, results: resultsE, playing: true, opts: { modeIndex: 1, scale: 100, phase: Math.PI / 2 } });
const sE3 = App.buildScene({ model: modelE, results: resultsE, playing: true, opts: { modeIndex: 3, scale: 100, phase: Math.PI / 2 } });
let diff = false;
for (let i = 0; i < sE1.points.length; i++) {
  if (Math.abs(sE1.points[i].x - sE3.points[i].x) > 1e-9 || Math.abs(sE1.points[i].y - sE3.points[i].y) > 1e-9 ||
      Math.abs(sE1.points[i].z - sE3.points[i].z) > 1e-9) diff = true;
}
ok(diff, "mode 1 and mode 3 produce different deformed shapes");

/* an active mode always shows the deformed shape, even with the Display
   "Deformed shape" toggle switched off */
(function () {
  const sUndeformed = App.buildScene({ model: modelE, results: resultsE, opts: { modeIndex: 0, scale: 0 } });
  const sAnim = App.buildScene({ model: modelE, results: resultsE, opts: { modeIndex: 1, scale: 100, phase: Math.PI / 2, showDeformed: false } });
  let moved = false;
  for (let i = 0; i < sUndeformed.points.length; i++) {
    if (Math.abs(sUndeformed.points[i].x - sAnim.points[i].x) > 1e-6 ||
        Math.abs(sUndeformed.points[i].y - sAnim.points[i].y) > 1e-6 ||
        Math.abs(sUndeformed.points[i].z - sAnim.points[i].z) > 1e-6) moved = true;
  }
  ok(moved, "an active mode shows the deformed shape despite showDeformed=false");
})();

/* paused mode shows the mode's own shape at the deformation scale; when
   playing, the sin(phase) factor applies (phase 0 => undeformed) */
(function () {
  const sU0 = App.buildScene({ model: modelE, results: resultsE, opts: { modeIndex: 0, scale: 0 } });
  const sPaused = App.buildScene({ model: modelE, results: resultsE, opts: { modeIndex: 1, scale: 100, phase: 0 } });
  const sPlay0 = App.buildScene({ model: modelE, results: resultsE, playing: true, opts: { modeIndex: 1, scale: 100, phase: 0 } });
  const differs = (a, b) => {
    for (let i = 0; i < a.points.length; i++) {
      if (Math.abs(a.points[i].x - b.points[i].x) > 1e-6 || Math.abs(a.points[i].y - b.points[i].y) > 1e-6) return true;
    }
    return false;
  };
  ok(differs(sPaused, sU0), "a paused mode shows its own shape (not an empty phase)");
  ok(!differs(sPlay0, sU0), "while playing at phase 0 the shape is undeformed");
})();

const hasLoadArrow = sc => sc.lines.some(l => l.color === "#e07b00");
const sCase = App.buildScene({ model: modelE, results: resultsE, opts: { caseIndex: 1, modeIndex: 0, scale: 1 } });
const sModeArrow = App.buildScene({ model: modelE, results: resultsE, opts: { caseIndex: 1, modeIndex: 1, scale: 100 } });
ok(hasLoadArrow(sCase), "static case view shows load arrows");
ok(!hasLoadArrow(sModeArrow), "mode view hides static load arrows");

/* ---- modal input markers (Preprocessing) ---- */
(function () {
  const preModal = (opts) => App.buildScene({ model: modelB, mode: "pre",
    opts: Object.assign({ modalInput: true, caseIndex: 1 }, opts || {}) });
  const sMod = preModal();
  ok(!hasLoadArrow(sMod), "modal input view hides static load arrows");
  ok(sMod.lines.some(l => l.color === "#802392"), "modal input view draws node mass markers");
  ok(sMod.lines.some(l => l.color === "#802392" && /^mass /.test(l.label || "")),
    "node mass marker is labelled 'mass ...'");
  const sNoMass = preModal({ showNodeInertia: false });
  ok(!sNoMass.lines.some(l => l.color === "#802392"), "showNodeInertia=false hides node mass markers");
  ok(!preModal({ showElemMass: false }).lines.some(l => /^extra mass /.test(l.label || "")),
    "showElemMass=false hides element extra-mass markers");
  const sPlain = App.buildScene({ model: modelB, mode: "pre", opts: { caseIndex: 1 } });
  ok(!sPlain.lines.some(l => l.color === "#802392"), "modal markers are hidden outside the modal input view");

  /* Postprocessing: input modal markers only in a modal view */
  const sPost = App.buildScene({ model: modelB, results: resultsB, mode: "post", opts: { caseIndex: 1, scale: 1 } });
  ok(!sPost.lines.some(l => l.color === "#802392"), "static Postprocessing view hides the modal markers");
  const sPostMode = App.buildScene({ model: modelB, results: resultsB, mode: "post",
    opts: { modeIndex: 1, scale: 1, phase: Math.PI / 2 } });
  ok(sPostMode.lines.some(l => l.color === "#802392"), "a Postprocessing mode view draws the input modal markers");
  const sPostOff = App.buildScene({ model: modelB, results: resultsB, mode: "post",
    opts: { modeIndex: 1, scale: 1, showNodeInertia: false, showElemMass: false } });
  ok(!sPostOff.lines.some(l => l.color === "#802392"), "modal markers can be switched off in a Postprocessing mode view");

  const modelF = App.parse3dd(ex("exF.3dd")).model;
  ok(!!(modelF.modal && modelF.modal.condensation), "exF has a condensation block");
  ok(modelF.modal.inertia.length === 4, "exF has 4 nodes with mass/inertia");
  const sFmass = App.buildScene({ model: modelF, mode: "pre", opts: { modalInput: true } });
  const massLines = sFmass.lines.filter(l => /^mass /.test(l.label || ""));
  ok(massLines.length === 4, "exF modal view draws 4 node mass/inertia markers");
  ok(massLines.some(l => /node 6/.test(l.label)), "node mass markers carry the node id");
  ok(massLines.some(l => /Ixx=/.test(l.label) && /Iyy=/.test(l.label) && /Izz=/.test(l.label)),
    "node inertia values are shown in the marker label");
  const sFnoMass = App.buildScene({ model: modelF, mode: "pre", opts: { modalInput: true, showNodeInertia: false } });
  ok(!sFnoMass.lines.some(l => /^mass /.test(l.label || "")), "showNodeInertia=false hides node mass/inertia markers");
  const sCond = App.buildScene({ model: modelF, mode: "pre", opts: { modalInput: true } });
  ok(sCond.lines.some(l => l.color === "#b0407f"), "exF modal view draws condensation markers");
  const sNoCond = App.buildScene({ model: modelF, mode: "pre", opts: { modalInput: true, showCondensation: false } });
  ok(!sNoCond.lines.some(l => l.color === "#b0407f"), "showCondensation=false hides condensation markers");

  /* exH carries element extra masses (163 rows) */
  const modelH = App.parse3dd(ex("exH.3dd")).model;
  ok(modelH.modal && modelH.modal.elemMass.length === 163, "exH has 163 element extra masses");
  const sH = App.buildScene({ model: modelH, mode: "pre", opts: { modalInput: true } });
  ok(sH.lines.some(l => l.color === "#802392" && /^extra mass /.test(l.label || "")),
    "exH modal view draws element extra-mass markers");
  ok(sH.lines.some(l => l.label === "extra mass 0.026 (el 46)"), "exH element 46 extra mass is drawn");
  const sHOff = App.buildScene({ model: modelH, mode: "pre", opts: { modalInput: true, showElemMass: false } });
  ok(!sHOff.lines.some(l => /^extra mass /.test(l.label || "")), "showElemMass=false hides the exH element masses");
})();

/* temperature colouring (the Loads > Colour by ΔT default): applies when the
   active case has temperature loads, otherwise the plain model look is kept */
const sTempNone = App.buildScene({ model: modelB, results: resultsB, opts: { caseIndex: 1, colorBy: "temperature" } });
ok(sTempNone.legend === null, "temperature colouring falls back to none when the case has no ΔT loads");
const sTemp = App.buildScene({ model, results, opts: { caseIndex: 2, colorBy: "temperature" } });
ok(!!sTemp.legend && /temperature/i.test(sTemp.legend.label) && sTemp.legend.max > 0,
  "temperature colouring produces a legend for a case with ΔT loads");
const sTempLoadsOff = App.buildScene({ model, results, opts: { caseIndex: 2, colorBy: "temperature", showLoads: false } });
ok(sTempLoadsOff.legend === null, "All loads off also suppresses temperature colouring");

process.exit(done() ? 1 : 0);
