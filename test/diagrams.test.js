/* test/diagrams.test.js - T8 analytical force-diagram validation: the
   reconstructed internal forces at x=0 and x=L must equal the reported
   end forces under Frame3DD's local internal-force sign convention, and
   the parabolic bending moment under a uniform load must match the
   closed-form equilibrium. */
"use strict";
const H = require("./harness");
const { App } = H.loadApp();
const { ok, done } = H.makeReporter();
const ex = (n) => H.readExample(n);

/* Frame3DD internal-force / end-force mapping (frame3dd_io.c):
     N(0)  = -Nx_1     N(L)  =  Nx_2
     Vy(0) = -Vy_1     Vy(L) =  Vy_2
     Vz(0) = -Vz_1     Vz(L) =  Vz_2
     Mz(0) = -Mz_1     Mz(L) =  Mz_2
     My(0) =  My_1     My(L) = -My_2                                          */
function checkEndpoints(name, ci) {
  const model = App.parse3dd(ex(name + ".3dd")).model;
  const results = App.parseOut(ex(name + ".out")).results;
  const lc = results.loadCases.find(l => l.index === ci);
  const caseObj = model.loadCases.find(l => l.index === ci);
  const nById = {}; model.nodes.forEach(n => nById[n.id] = n);
  const ef = {}; lc.endForces.forEach(r => (ef[r.elm] = ef[r.elm] || []).push(r));
  let maxErr = 0;
  model.elements.forEach(elm => {
    const A = nById[elm.n1], B = nById[elm.n2];
    const recs = ef[elm.id] || [];
    const q1 = recs.find(r => r.node === elm.n1), q2 = recs.find(r => r.node === elm.n2);
    if (!q1 || !q2) return;
    const loads = {
      gravity: caseObj.gravity,
      uniform: caseObj.uniform.filter(u => u.elm === elm.id),
      trapezoid: caseObj.trapezoid.filter(u => u.elm === elm.id),
      point: caseObj.point.filter(u => u.elm === elm.id)
    };
    const set = App.elemDiagramSet(elm, A, B, { q1, q2 }, loads);
    const tgt = { Nx: [-q1.nx, q2.nx], Vy: [-q1.vy, q2.vy], Vz: [-q1.vz, q2.vz], Mzz: [-q1.mzz, q2.mzz], Myy: [q1.myy, -q2.myy] };
    Object.keys(tgt).forEach(k => {
      const arr = set[k];
      maxErr = Math.max(maxErr, Math.abs(arr[0] - tgt[k][0]), Math.abs(arr[arr.length - 1] - tgt[k][1]));
    });
  });
  return { model, results, caseObj, lc, maxErr };
}

["exA:1", "exB:1", "exB:2", "exG:1"].forEach(spec => {
  const [nm, ci] = spec.split(":");
  const r = checkEndpoints(nm, +ci);
  ok(r.maxErr < 1e-6, nm + " case " + ci + " diagram endpoints match mapped end forces (maxErr=" + r.maxErr.toExponential(2) + ")");
});

/* exG uniform load -> parabolic Myy matches the closed form (geometric
   stiffness is on, so accept a small relative tolerance) */
(function () {
  const { model, caseObj, lc } = checkEndpoints("exG", 1);
  const nById = {}; model.nodes.forEach(n => nById[n.id] = n);
  const ef = {}; lc.endForces.forEach(r => (ef[r.elm] = ef[r.elm] || []).push(r));
  let checked = 0, maxErr = 0, maxMag = 0;
  model.elements.forEach(elm => {
    const u = caseObj.uniform.filter(x => x.elm === elm.id);
    if (!u.length) return;
    const A = nById[elm.n1], B = nById[elm.n2];
    const recs = ef[elm.id]; if (!recs) return;
    const q1 = recs.find(r => r.node === elm.n1), q2 = recs.find(r => r.node === elm.n2);
    const set = App.elemDiagramSet(elm, A, B, { q1, q2 }, { gravity: caseObj.gravity, uniform: u, trapezoid: [], point: [] });
    const la = set.la, L = set.L, g = caseObj.gravity;
    const wz = elm.density * elm.Ax * (la.z.x * g[0] + la.z.y * g[1] + la.z.z * g[2]) + (u[0].Uz || 0);
    const My0 = q1.myy, Vz0 = -q1.vz;
    for (let i = 0; i <= 20; i++) {
      const x = L * i / 20;
      const expect = My0 - Vz0 * x + 0.5 * wz * x * x;
      maxMag = Math.max(maxMag, Math.abs(expect));
      maxErr = Math.max(maxErr, Math.abs(set.Myy[Math.round(i / 20 * (set.Myy.length - 1))] - expect));
    }
    checked++;
  });
  ok(checked > 0 && maxErr / maxMag < 5e-3, "exG parabolic Myy matches closed form (relErr=" + (maxErr / maxMag).toExponential(2) + ")");
})();

/* exA is a truss: end moments vanish -> straight (near-zero) moment diagrams */
(function () {
  const model = App.parse3dd(ex("exA.3dd")).model;
  const results = App.parseOut(ex("exA.out")).results;
  const caseObj = model.loadCases[0], lc = results.loadCases[0];
  const nById = {}; model.nodes.forEach(n => nById[n.id] = n);
  const ef = {}; lc.endForces.forEach(r => (ef[r.elm] = ef[r.elm] || []).push(r));
  const elm = model.elements[0];
  const recs = ef[elm.id];
  const q1 = recs.find(r => r.node === elm.n1), q2 = recs.find(r => r.node === elm.n2);
  const set = App.elemDiagramSet(elm, nById[elm.n1], nById[elm.n2], { q1, q2 },
    { gravity: caseObj.gravity, uniform: [], trapezoid: [], point: [] });
  const peak = Math.max.apply(null, set.Mzz.map(Math.abs));
  ok(peak < 1e-2, "exA truss member moment diagram is ~zero (peak=" + peak.toExponential(2) + ")");
  const nPeak = Math.max.apply(null, set.Nx.map(Math.abs));
  ok(nPeak > 0, "exA truss member has a nonzero axial diagram");
})();

/* trapezoidal load with breakpoints off the sampling grid: the analytic
   integration must match the closed form exactly (the old fixed-grid
   trapezoid produced a small alignment-dependent step near the ramp ends) */
(function () {
  const L = 100, x1 = 13.7, x2 = 86.3, w1 = 0.4, w2 = 1.1;
  function rI1(x) { if (x <= x1) return 0; const D = x2 - x1, m = (w2 - w1) / D; if (x < x2) { const d = x - x1; return w1 * d + 0.5 * m * d * d; } return 0.5 * (w1 + w2) * D; }
  function rI2(x) { if (x <= x1) return 0; const D = x2 - x1, m = (w2 - w1) / D; if (x < x2) { const d = x - x1; return w1 * d * d / 2 + m * d * d * d / 6; } const first = 0.5 * (w1 + w2) * D; return w1 * D * D / 2 + m * D * D * D / 6 + first * (x - x2); }
  const Vz0 = 0, My0 = 0;
  const My = x => My0 - Vz0 * x + rI2(x);
  const q1 = { nx: 0, vy: 0, vz: -Vz0, txx: 0, myy: My0, mzz: 0 };
  const q2 = { nx: 0, vy: 0, vz: Vz0 - rI1(L), txx: 0, myy: -My(L), mzz: 0 };
  const elm = { id: 1, roll: 0, Ax: 1, Asy: 1, Asz: 1, Jxx: 1, Iyy: 1, Izz: 1, E: 1, G: 1, density: 0 };
  const A = { x: 0, y: 0, z: 0 }, B = { x: L, y: 0, z: 0 };
  const loads = { gravity: [0, 0, 0], uniform: [], point: [], trapezoid: [{ elm: 1, xx1: 0, xx2: 0, wx1: 0, wx2: 0, xy1: 0, xy2: 0, wy1: 0, wy2: 0, xz1: x1, xz2: x2, wz1: w1, wz2: w2 }] };
  const set = App.elemDiagramSet(elm, A, B, { q1: q1, q2: q2 }, loads);
  let maxE = 0;
  for (let i = 0; i < set.Myy.length; i++) maxE = Math.max(maxE, Math.abs(set.Myy[i] - My(set.x[i])));
  ok(maxE < 1e-6, "trapezoidal moment matches the closed form with no grid-alignment step (maxErr=" + maxE.toExponential(2) + ")");
  ok(typeof set.sample === "function" && Math.abs(set.sample("Myy", set.x[100]) - set.Myy[100]) < 1e-9,
    "diagram set exposes an exact sampler matching the sampled arrays");
  ok(set.breaks.indexOf(x1) >= 0 && set.breaks.indexOf(x2) >= 0,
    "load breakpoints are exposed as exact diagram vertices");
})();

process.exit(done() ? 1 : 0);
