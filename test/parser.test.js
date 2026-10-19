/* test/parser.test.js - parser coverage for .3dd input and .out output
   across the bundled examples. */
"use strict";
const H = require("./harness");
const { App } = H.loadApp();
const { ok, done } = H.makeReporter();
const ex = (n) => H.readExample(n);

function approx(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-6); }

/* ---------- exA input (.3dd) ---------- */
const rA = App.parse3dd(ex("exA.3dd"));
ok(rA.model.counts.nodes === 12, "exA.3dd nodes=12 (got " + rA.model.counts.nodes + ")");
ok(rA.model.counts.elements === 21, "exA.3dd elements=21");
ok(rA.model.counts.loadCases === 2, "exA.3dd cases=2");
ok(rA.model.title.indexOf("Example A") === 0, "exA.3dd title");
const e21 = rA.model.elements[20];
ok(e21.id === 21 && e21.n1 === 11 && e21.n2 === 12, "exA.3dd elem21 connectivity");
ok(approx(rA.model.elements[0].Izz, 0.01), "exA.3dd elem1 Izz=0.01");
ok(rA.model.loadCases[0].nodal.length === 5, "exA case1 nodal=5");
ok(approx(rA.model.loadCases[0].nodal[0].Fy, -10), "exA case1 node2 Fy=-10");
ok(rA.model.loadCases[1].temperature.length === 3, "exA case2 temp=3");
ok(rA.model.modal === null, "exA no modal");

/* ---------- exB input (.3dd) ---------- */
const rB = App.parse3dd(ex("exB.3dd"));
ok(rB.model.counts.nodes === 5, "exB.3dd nodes=5");
ok(rB.model.counts.elements === 4, "exB.3dd elements=4");
ok(rB.model.counts.loadCases === 3, "exB.3dd cases=3");
ok(rB.model.modal && rB.model.modal.nM === 6, "exB.3dd nM=6");
ok(rB.model.modal.animModes.length === 6, "exB nA list=6");
ok(approx(rB.model.modal.pan, 2), "exB pan=2");
ok(rB.model.modal.condensation === null, "exB no condensation");
ok(rB.model.loadCases[1].trapezoid.length === 2, "exB case2 trap=2");
const tr = rB.model.loadCases[1].trapezoid[0];
ok(approx(tr.elm, 3) && approx(tr.xx1, 20) && approx(tr.xx2, 80) && approx(tr.wz2, 0.07), "exB trap row values");
ok(rB.model.loadCases[2].point.length === 2, "exB case3 point=2");
ok(rB.warnings.length === 0, "exB.3dd no warnings (got " + JSON.stringify(rB.warnings) + ")");

/* ---------- exF condensation + node mass/inertia ---------- */
const rF = App.parse3dd(ex("exF.3dd"));
ok(rF.model.modal && rF.model.modal.condensation, "exF has condensation");
ok(rF.model.modal.condensation.cmethod === 2, "exF cmethod=2");
ok(rF.model.modal.condensation.nodes.length === 4, "exF nC=4");
ok(rF.model.modal.condensation.modes.length === 12, "exF cond modes=12");
ok(rF.model.modal.inertia.length === 4, "exF has 4 nodes with extra mass/inertia");
const ni = rF.model.modal.inertia[0];
ok(ni.node === 6 && approx(ni.mass, 4) && approx(ni.Ixx, 4.75e6) && approx(ni.Izz, 26.53e6),
  "exF node 6 mass and inertia parsed");
ok(rF.model.modal.elemMass.length === 0, "exF has no element extra mass");

/* ---------- exH element extra mass ---------- */
const rH = App.parse3dd(ex("exH.3dd"));
ok(rH.model.modal && rH.model.modal.nM === 5, "exH nM=5");
ok(rH.model.modal.inertia.length === 0, "exH has no node extra mass/inertia");
ok(rH.model.modal.elemMass.length === 163, "exH has 163 element extra masses");
const hm = rH.model.modal.elemMass.filter(function (e) { return e.elm === 46; })[0];
ok(hm && approx(hm.m, 0.026), "exH element 46 extra mass=0.026");

/* ---------- exA .out ---------- */
const oA = App.parseOut(ex("exA.out"));
ok(oA.results.geometryFromOut, "exA.out geometry echo present");
ok(oA.results.geometryFromOut.nodes.length === 12, "exA.out geo nodes=12");
ok(oA.results.geometryFromOut.elements.length === 21, "exA.out geo elems=21");
ok(oA.results.loadCases.length === 2, "exA.out result cases=2");
const c1 = oA.results.loadCases[0];
ok(c1.displacements.length === 12, "exA.out case1 disp=12");
ok(approx(c1.displacements[1].ux, 0.011745, 1e-6), "exA.out node2 ux=0.011745");
ok(approx(c1.displacements[9].uy, -0.315889, 1e-6), "exA.out node10 uy=-0.315889");
ok(c1.endForces.length === 42, "exA.out case1 endforces=42");
ok(approx(c1.endForces[0].nx, -28.383, 1e-3), "exA.out ef1 nx=-28.383");
ok(c1.reactions.length === 12, "exA.out case1 reactions=12");
ok(approx(c1.reactions[0].Fx, 11.941, 1e-3), "exA.out reac node1 Fx=11.941");
ok(oA.results.modes.length === 0, "exA.out no modes");

/* ---------- exB .out (peak + modes) ---------- */
const oB = App.parseOut(ex("exB.out"));
ok(oB.results.loadCases.length === 3, "exB.out result cases=3");
const b1 = oB.results.loadCases[0];
ok(b1.reactions.length === 4, "exB.out case1 reactions=4");
ok(b1.peakForces.length === 8, "exB.out case1 peaks=8");
const pk = b1.peakForces[0];
ok(pk.which === "max" && approx(pk.nx, -110.772, 1e-3) && approx(pk.myy, 312.827, 1e-3), "exB peak row1");
ok(oB.results.modes.length === 6, "exB modes=6");
const m1 = oB.results.modes[0];
ok(approx(m1.freq, 18.807942, 1e-5), "exB mode1 f=18.807942");
ok(approx(m1.period, 0.053169, 1e-6), "exB mode1 T");
ok(m1.shapes.length === 5, "exB mode1 shapes=5");

/* ---------- other examples sanity ---------- */
["exC", "exD", "exE", "exG", "exI", "exJ"].forEach(function (nm) {
  const r = App.parse3dd(ex(nm + ".3dd"));
  ok(r.model.nodes.length > 0 && r.model.elements.length > 0, nm + ".3dd parsed nodes/elements");
});
["exC", "exD", "exE", "exG", "exI", "exJ", "exF"].forEach(function (nm) {
  const o = App.parseOut(ex(nm + ".out"));
  ok(o.results.loadCases.length > 0 || o.results.modes.length > 0, nm + ".out parsed");
});

process.exit(done() ? 1 : 0);
