/* viewer.js - builds an Engine3D scene from the parsed Frame3DD model
   and results. The engine only draws points and lines plus, for fixed
   supports, a small solid "brick" (quads). Frame3DD is a skeletal frame
   system, so no triangles are produced.

   Public API:
     App.buildScene(state) -> scene
     App.modelSize(model, results) -> number
     App.maxDisp(state, opts) -> number
     App.elemDiagram(elm, A, B, endForces, memberLoads, kind) -> [{x,value}]
     App.supportKey(rec) / App.supportLabel(rec) -> string
*/
(function () {
  "use strict";

  var C = App.colors;
  var palette = C.palette;

  /* ---- geometry source ---------------------------------------------- */
  function geometry(state) {
    var model = state.model, results = state.results;
    var geo = results && results.geometryFromOut;
    var nodes = [], els = [];
    if (model && model.nodes && model.nodes.length) {
      for (var i = 0; i < model.nodes.length; i++) {
        var n = model.nodes[i];
        nodes.push({ id: n.id, x: n.x, y: n.y, z: n.z });
      }
      els = model.elements || [];
    } else if (geo && geo.nodes && geo.nodes.length) {
      for (var j = 0; j < geo.nodes.length; j++) {
        var g = geo.nodes[j];
        nodes.push({ id: g.id, x: g.x, y: g.y, z: g.z });
      }
      els = geo.elements || [];
    }
    return { nodes: nodes, els: els };
  }

  function is2D(nodes) {
    if (!nodes.length) return true;
    var z0 = nodes[0].z, z1 = nodes[0].z;
    for (var i = 1; i < nodes.length; i++) {
      if (nodes[i].z < z0) z0 = nodes[i].z;
      if (nodes[i].z > z1) z1 = nodes[i].z;
    }
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (i = 0; i < nodes.length; i++) {
      x0 = Math.min(x0, nodes[i].x); x1 = Math.max(x1, nodes[i].x);
      y0 = Math.min(y0, nodes[i].y); y1 = Math.max(y1, nodes[i].y);
    }
    var span = Math.max(x1 - x0, y1 - y0, 1e-9);
    return (z1 - z0) <= 1e-9 * span;
  }

  /* orientation: 'auto' | 'yup' | 'zup' -> world -> scene mapper */
  function orientFn(orientation, twoD) {
    var mode = orientation || "auto";
    if (mode === "auto") mode = twoD ? "yup" : "zup";
    if (mode === "zup") {
      return function (x, y, z) { return { x: x, y: z, z: -y }; };
    }
    return function (x, y, z) { return { x: x, y: y, z: z }; };
  }

  App.is2DGeometry = function (model, results) {
    return is2D(geometry({ model: model, results: results }).nodes);
  };

  App.modelSize = function (model, results) {
    var g = geometry({ model: model, results: results });
    var nodes = g.nodes;
    if (!nodes.length) return 1;
    var x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x);
      y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y);
      z0 = Math.min(z0, n.z); z1 = Math.max(z1, n.z);
    }
    var d = Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) + (z1 - z0) * (z1 - z0));
    return d > 1e-9 ? d : 1;
  };

  /* combined multi-mode displacement provider: u(t) = sum wi * phi_i * sin(w_i t) */
  function combinedShapes(res, opts) {
    var modes = (res && res.modes) || [];
    if (!modes.length) return null;
    var weights = opts.modeWeights, hasW = weights && typeof weights === "object";
    var enabled = opts.modeEnabled;
    var t = opts.time || 0, mm = {}, any = false;
    for (var i = 0; i < modes.length; i++) {
      var m = modes[i];
      if (!m.shapes || !m.shapes.length) continue;
      if (enabled && enabled[m.index] === false) continue;   /* mode switched off */
      var wt = hasW ? (weights[m.index] === undefined ? 1 : Number(weights[m.index])) : 1;
      if (!(Math.abs(wt) > 0)) continue;
      var w0 = 2 * Math.PI * (m.freq || 0);
      var s = wt * Math.sin(w0 * t);
      for (var k = 0; k < m.shapes.length; k++) {
        var sh = m.shapes[k];
        var cur = mm[sh.node] || (mm[sh.node] = { node: sh.node, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 });
        cur.ux += s * sh.ux; cur.uy += s * sh.uy; cur.uz += s * sh.uz;
        cur.rx += s * sh.rx; cur.ry += s * sh.ry; cur.rz += s * sh.rz;
        any = true;
      }
    }
    return any ? mm : null;
  }

  /* per-node displacement / mode-shape lookup for the active selection */
  function dispLookup(state, opts) {
    var res = state.results;
    if (!res) return null;
    if (opts.combined) return combinedShapes(res, opts);
    var mi = opts.modeIndex | 0;
    if (mi > 0) {
      var modeObj = res.modes && res.modes[mi - 1];
      var shapes = (modeObj && modeObj.shapes) || [];
      if (!shapes.length) return null;
      var mm = {};
      for (var i = 0; i < shapes.length; i++) mm[shapes[i].node] = shapes[i];
      return mm;
    }
    var ci = opts.caseIndex | 0;
    if (ci > 0 && res.loadCases) {
      var lc = null;
      for (var k = 0; k < res.loadCases.length; k++) if (res.loadCases[k].index === ci) lc = res.loadCases[k];
      if (lc) {
        var dm = {};
        for (var j = 0; j < lc.displacements.length; j++) dm[lc.displacements[j].node] = lc.displacements[j];
        return dm;
      }
    }
    return null;
  }

  App.maxDisp = function (state, opts) {
    opts = opts || {};
    var mm = dispLookup(state, opts);
    if (!mm) return 0;
    var max = 0;
    for (var id in mm) {
      if (!Object.prototype.hasOwnProperty.call(mm, id)) continue;
      var d = mm[id];
      var m = Math.sqrt(d.ux * d.ux + d.uy * d.uy + d.uz * d.uz);
      if (isFinite(m) && m > max) max = m;
    }
    return max;
  };

  /* ---- support classification --------------------------------------- */
  function supportKey(r) {
    if (!r) return "";
    return (r.Rx ? "1" : "0") + (r.Ry ? "1" : "0") + (r.Rz ? "1" : "0") +
      (r.Rxx ? "1" : "0") + (r.Ryy ? "1" : "0") + (r.Rzz ? "1" : "0");
  }
  function supportLabel(r) {
    var k = supportKey(r);
    if (k === "000000") return "free";
    if (k === "111111") return "fixed";
    if (k === "111000") return "pinned";
    /* otherwise list the restrained degrees of freedom in the Rx/Ry/Rz/
       Rxx/Ryy/Rzz notation (no "custom", no binary mask) */
    var t = [];
    if (r.Rx) t.push("Rx"); if (r.Ry) t.push("Ry"); if (r.Rz) t.push("Rz");
    if (r.Rxx) t.push("Rxx"); if (r.Ryy) t.push("Ryy"); if (r.Rzz) t.push("Rzz");
    return t.join(",");
  }
  App.supportKey = supportKey;
  App.supportLabel = supportLabel;

  /* ---- scene --------------------------------------------------------- */
  App.buildScene = function (state) {
    state = state || {};
    var opts = state.opts || {};
    /* Preprocessing shows the model only: no result displacements, mode
       shapes, result colouring or diagrams (those belong to Postprocessing). */
    var preMode = state.mode === "pre";
    var g = geometry(state);
    var nodes = g.nodes, els = g.els;
    var twoD = is2D(nodes);

    var nById = {};
    for (var i = 0; i < nodes.length; i++) nById[nodes[i].id] = nodes[i];

    var map = orientFn(opts.orientation, twoD);

    /* deformation amplitude */
    var mm = preMode ? null : dispLookup(state, opts);
    var modeSel = (opts.modeIndex | 0) > 0;
    var playing = state.playing === true;
    var amp = 0;
    if (mm) {
      amp = (opts.scale === undefined || opts.scale === null) ? 1 : opts.scale;
      /* a single mode animates with sin(phase) while playing; when paused it
         shows the mode's own shape at the deformation scale (not a frozen
         phase). A playing static case "breathes" with 0.5+0.5*sin(phase) so
         the amplitude stays in [0, scale]. */
      if (playing && !opts.combined) {
        var ph = opts.phase === undefined ? 0 : opts.phase;
        amp *= modeSel ? Math.sin(ph) : (0.5 + 0.5 * Math.sin(ph));
      }
    }

    function world(n, useDisp) {
      var x = n.x, y = n.y, z = n.z;
      if (useDisp && mm && amp !== 0) {
        var d = mm[n.id];
        if (d) { x += amp * d.ux; y += amp * d.uy; z += amp * d.uz; }
      }
      return { x: x, y: y, z: z };
    }
    function sc(n, useDisp) { var w = world(n, useDisp); return map(w.x, w.y, w.z); }

    var size = App.modelSize(state.model, state.results);
    var sz = opts.sizes || {};
    var DEF = { force: 0.45, moment: 0.95, support: 0.7, diagram: 0.3 };
    var sForce = (sz.force > 0) ? sz.force : DEF.force;
    var sSupport = (sz.support > 0) ? sz.support : DEF.support;
    var sMoment = (sz.moment > 0) ? sz.moment : DEF.moment;
    var ms = size * 0.035 * sSupport;   /* restraint marker size */
    var momBase = size * 0.035 * sMoment; /* moment-arc base radius */
    var alen = size * 0.14 * sForce;    /* load arrow length */

    /* a selected mode (or combined animation) always shows the deformed shape */
    var animating = (opts.modeIndex | 0) > 0 || !!opts.combined;
    var showDeformed = (opts.showDeformed !== false || animating) && amp !== 0 && !!mm;
    var showUndeformed = opts.showUndeformed !== false && showDeformed;

    /* ---- visibility (T2) -------------------------------------------- */
    var vis = state.vis || {};
    var hiddenN = vis.hiddenNodes || {};
    var hiddenE = vis.hiddenElems || {};
    var ghost = !!opts.ghostHidden;
    var nodeHasVisibleEl = {};
    for (var hE = 0; hE < els.length; hE++) {
      if (!hiddenE[els[hE].id]) { nodeHasVisibleEl[els[hE].n1] = 1; nodeHasVisibleEl[els[hE].n2] = 1; }
    }
    function elmDraw(id) { return !hiddenE[id]; }
    function nodeDraw(id) { return !hiddenN[id] || !!nodeHasVisibleEl[id]; }
    var GHOST_LINE = C.elementGhost, GHOST_POINT = C.pointGhost;

    /* ---- color mapping ---------------------------------------------- */
    /* Preprocessing keeps the model-only colour modes (material/support/
       temperature) but suppresses the result-based ones. */
    var MODEL_COLOR = { none: 1, matgroup: 1, support: 1, temperature: 1 };
    var colorBy = opts.colorBy || "none";
    /* model-only colour modes are allowed in Preprocessing and in mode views.
       Load/result colouring (Nx, shears, ...) belongs to the Static case and
       is suppressed in a mode view; mode-shape colouring is allowed there. */
    var inModeView = modeSel || !!opts.combined;
    if (preMode && !MODEL_COLOR[colorBy]) colorBy = "none";
    else if (inModeView && !MODEL_COLOR[colorBy]) colorBy = "none";
    /* colouring and force diagrams are not shown together */
    if (opts.showDiagrams && !preMode && !inModeView && state.results) colorBy = "none";
    var elColor = {};              /* elm id -> css color */
    var nodeColor = {};            /* node id -> css color (support / mode shape) */
    var legend = null;
    var badges = [];

    var efByElm = {};
    var caseObj = null;
    if (state.model && state.model.loadCases) {
      var mci = opts.caseIndex | 0;
      for (var mc = 0; mc < state.model.loadCases.length; mc++) {
        if (state.model.loadCases[mc].index === mci) caseObj = state.model.loadCases[mc];
      }
    }
    if (state.results && state.results.loadCases) {
      var ci = opts.caseIndex | 0, lc = null;
      for (var c = 0; c < state.results.loadCases.length; c++) {
        if (state.results.loadCases[c].index === ci) lc = state.results.loadCases[c];
      }
      if (lc) {
        for (var e = 0; e < lc.endForces.length; e++) {
          var rec = lc.endForces[e];
          (efByElm[rec.elm] = efByElm[rec.elm] || []).push(rec);
        }
      }
    }

    function absMax(a, key) {
      var m = 0;
      for (var i = 0; i < a.length; i++) { var v = Math.abs(a[i][key]); if (v > m) m = v; }
      return m;
    }
    function firstNx(a, el) {
      for (var i = 0; i < a.length; i++) if (a[i].node === el.n1) return a[i].nx;
      return a.length ? a[0].nx : NaN;
    }
    function dispMag(id) {
      var d = mm && mm[id];
      if (!d) return NaN;
      return Math.sqrt(d.ux * d.ux + d.uy * d.uy + d.uz * d.uz);
    }
    function dispComp(id, comp) {
      var d = mm && mm[id];
      if (!d) return NaN;
      return d[comp] || 0;   /* signed component */
    }

    var SCALARS = { Nx: 1, absVy: 1, absVz: 1, absTxx: 1, absMyy: 1, absMzz: 1 };
    /* displacement modes colour the nodes, not the members (disp is a nodal
       result, so its colormap lives on the points) */
    var NODE_SCALARS = { disp: 1, dispX: 1, dispY: 1, dispZ: 1 };
    var scalarLabel = {
      "Nx": "Axial force Nx (first end)", "absVy": "|Vy| shear", "absVz": "|Vz| shear",
      "absTxx": "|Txx| torsion", "absMyy": "|Myy| bending", "absMzz": "|Mzz| bending",
      "disp": "Nodal displacement magnitude",
      "dispX": "dispX", "dispY": "dispY", "dispZ": "dispZ"
    };

    /* element scalar for the continuous colormap modes */
    function elemScalar(el, mode) {
      var recs = efByElm[el.id] || [], val = NaN;
      if (mode === "Nx") val = recs.length ? firstNx(recs, el) : NaN;
      else if (mode === "absVy") val = absMax(recs, "vy");
      else if (mode === "absVz") val = absMax(recs, "vz");
      else if (mode === "absTxx") val = absMax(recs, "txx");
      else if (mode === "absMyy") val = absMax(recs, "myy");
      else if (mode === "absMzz") val = absMax(recs, "mzz");
      return val;
    }

    var tempByElm = null;
    if (caseObj && caseObj.temperature) {
      tempByElm = {};
      for (var te = 0; te < caseObj.temperature.length; te++) {
        var tr = caseObj.temperature[te];
        var dT = Math.max(Math.abs(tr.Typ || 0), Math.abs(tr.Tym || 0), Math.abs(tr.Tzp || 0), Math.abs(tr.Tzm || 0));
        tempByElm[tr.elm] = Math.max(tempByElm[tr.elm] || 0, dT);
      }
    }

    if (colorBy === "temperature" && opts.showLoads === false) {
      /* the master "All loads" switch also turns the ΔT colouring off */
      colorBy = "none";
    }
    if (colorBy === "temperature" && (!tempByElm || !Object.keys(tempByElm).length)) {
      /* nothing to colour for this case: fall back to the plain model look */
      colorBy = "none";
    }

    if (colorBy !== "none") {
      if (SCALARS[colorBy]) {
        var vmin = Infinity, vmax = -Infinity, cmap = {};
        for (var el2 = 0; el2 < els.length; el2++) {
          var el = els[el2], val = elemScalar(el, colorBy);
          if (isFinite(val)) { cmap[el.id] = val; if (val < vmin) vmin = val; if (val > vmax) vmax = val; }
        }
        if (!isFinite(vmin)) { vmin = 0; vmax = 0; }
        if (vmin > 0) vmin = 0;
        if (vmax < 0) vmax = 0;
        for (var id2 in cmap) {
          if (!Object.prototype.hasOwnProperty.call(cmap, id2)) continue;
          elColor[id2] = App.colorScale(cmap[id2], vmin, vmax);
        }
        legend = { label: scalarLabel[colorBy] || colorBy, min: vmin, max: vmax };
      } else if (NODE_SCALARS[colorBy]) {
        /* displacements are a nodal result: colour the nodes via nodeColor */
        var comp = colorBy === "disp" ? null : (colorBy === "dispX" ? "ux" : (colorBy === "dispY" ? "uy" : "uz"));
        var nmin = Infinity, nmax = -Infinity;
        for (var nk = 0; nk < nodes.length; nk++) {
          var d = mm && mm[nodes[nk].id];
          if (!d) continue;
          var nv = comp ? dispComp(nodes[nk].id, comp) : dispMag(nodes[nk].id);
          if (isFinite(nv)) { if (nv < nmin) nmin = nv; if (nv > nmax) nmax = nv; }
        }
        if (!isFinite(nmin)) { nmin = 0; nmax = 0; }
        if (nmin > 0) nmin = 0;
        if (nmax < 0) nmax = 0;
        for (nk = 0; nk < nodes.length; nk++) {
          var d2 = mm && mm[nodes[nk].id];
          if (!d2) continue;
          var nv2 = comp ? dispComp(nodes[nk].id, comp) : dispMag(nodes[nk].id);
          if (!isFinite(nv2)) continue;
          nodeColor[nodes[nk].id] = App.colorScale(nv2, nmin, nmax);
        }
        legend = { label: scalarLabel[colorBy] || colorBy, min: nmin, max: nmax };
      } else if (colorBy === "matgroup") {
        var groups = {}, gi = 0, gkey = {};
        for (var gm = 0; gm < els.length; gm++) {
          var ge = els[gm];
          var key = [ge.Ax, ge.Asy, ge.Asz, ge.Jxx, ge.Iyy, ge.Izz, ge.E, ge.G, ge.roll, ge.density].join("|");
          if (!(key in groups)) { groups[key] = gi++; }
          elColor[ge.id] = palette[groups[key] % palette.length];
        }
        var entries = [];
        for (var gk in groups) {
          if (!Object.prototype.hasOwnProperty.call(groups, gk)) continue;
          entries.push({ color: palette[groups[gk] % palette.length], text: "group " + (groups[gk] + 1) + "  (" + gk.split("|").slice(0, 3).join(", ") + " \u2026)" });
        }
        legend = { label: gi + " material/section group(s)", entries: entries };
      } else if (colorBy === "support") {
        var rest = restraintRecords(state, nById);
        var skey = {}, scnt = 0, se = [];
        for (var rn in rest) {
          if (!Object.prototype.hasOwnProperty.call(rest, rn)) continue;
          var kk = supportKey(rest[rn]);
          if (!(kk in skey)) { skey[kk] = scnt++; }
          nodeColor[rn] = palette[skey[kk] % palette.length];
        }
        /* support is a nodal property, so only the support nodes are coloured;
           element lines keep their default (deformed/static) colour */
        for (var kk2 in skey) {
          if (!Object.prototype.hasOwnProperty.call(skey, kk2)) continue;
          var rr = null;
          for (var q in rest) if (supportKey(rest[q]) === kk2) { rr = rest[q]; break; }
          se.push({ color: palette[skey[kk2] % palette.length], text: supportLabel(rr) });
        }
        legend = { label: "support type", entries: se };
      } else if (colorBy === "temperature") {
        var tmin = Infinity, tmax = -Infinity;
        for (var ee = 0; ee < els.length; ee++) {
          var dV = tempByElm ? tempByElm[els[ee].id] : undefined;
          if (dV === undefined || !isFinite(dV)) continue;
          if (dV < tmin) tmin = dV; if (dV > tmax) tmax = dV;
        }
        if (!isFinite(tmin)) { tmin = 0; tmax = 0; }
        for (ee = 0; ee < els.length; ee++) {
          var dV2 = tempByElm ? tempByElm[els[ee].id] : undefined;
          if (dV2 === undefined || !isFinite(dV2)) continue;
          elColor[els[ee].id] = App.colorScale(dV2, tmin, tmax);
        }
        legend = { label: "temperature change |\u0394T|", min: tmin, max: tmax };
      }
    }
    function colorFor(el) {
      return (colorBy === "none") ? null : (elColor[el.id] || null);
    }

    var deformedColor = C.elementDeformed;
    var undeformedColor = C.elementUndeformed;
    var HL = C.selection;                 /* highlight colour for a selected item */

    /* nodes / elements selected from the tables or the view */
    var selN = {}, selE = {};
    (opts.selectedNodes || []).forEach(function (id) { selN[id] = 1; });
    (opts.selectedElems || []).forEach(function (id) { selE[id] = 1; });

    /* ---- points / lines ---- */
    var points = [], lines = [], quads = [];

    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var shown = nodeDraw(node.id);
      if (!shown && !ghost) continue;
      var sp = sc(node, showDeformed && shown);
      var sN = !!selN[node.id];
      points.push({
        x: sp.x, y: sp.y, z: sp.z, label: node.id,
        color: sN ? HL : (nodeColor[node.id] || (shown ? C.pointDefault : GHOST_POINT)),
        size: sN ? 6.5 : (shown ? 3.0 : 2.2)
      });
    }

    for (var e2 = 0; e2 < els.length; e2++) {
      var elm = els[e2];
      var nA = nById[elm.n1], nB = nById[elm.n2];
      if (!nA || !nB) continue;
      var drawn = elmDraw(elm.id);
      if (!drawn && !ghost) continue;
      var base1 = sc(nA, false), base2 = sc(nB, false);
      if (showUndeformed && showDeformed && drawn) {
        lines.push({ a: base1, b: base2, color: undeformedColor, width: 1.0 });
      }
      var p1 = showDeformed && drawn ? sc(nA, true) : base1;
      var p2 = showDeformed && drawn ? sc(nB, true) : base2;
      var sE = !!selE[elm.id];
      lines.push({
        a: p1, b: p2,
        color: !drawn ? GHOST_LINE : (sE ? HL : (colorFor(elm) || (showDeformed ? deformedColor : C.elementStatic))),
        width: !drawn ? 1.0 : (sE ? 3.6 : (showDeformed ? 2.0 : 1.6)),
        label: (opts.showElemLabels && drawn ? String(elm.id) : null),
        pick: drawn ? { elem: elm.id } : null
      });
    }

    /* ---- member local axes at each element centre ------------------- */
    if (opts.showLocalAxes || opts.showPrincipalAxis) {
      var al = size * 0.07;
      var ixhat = C.localAxis;
      for (var ea = 0; ea < els.length; ea++) {
        var em = els[ea];
        if (!elmDraw(em.id)) continue;
        var eA = nById[em.n1], eB = nById[em.n2];
        if (!eA || !eB) continue;
        var midW = { x: (eA.x + eB.x) / 2, y: (eA.y + eB.y) / 2, z: (eA.z + eB.z) / 2 };
        var mid = map(midW.x, midW.y, midW.z);
        var la = localAxes(eA, eB, em.roll || 0);
        if (opts.showLocalAxes) {
          addAxisArrow(lines, mid, sceneDir(map, la.x), al, ixhat.x, "x");
          addAxisArrow(lines, mid, sceneDir(map, la.y), al, ixhat.y, "y");
          addAxisArrow(lines, mid, sceneDir(map, la.z), al, ixhat.z, "z");
        }
        if (opts.showPrincipalAxis) {
          var useY = (em.Iyy || 0) >= (em.Izz || 0);
          var pdir = useY ? la.y : la.z;
          addBiArrow(lines, mid, sceneDir(map, pdir), al * 1.4, C.principalAxis, useY ? "Iyy" : "Izz");
        }
      }
    }

    /* ---- hinges: moment-free member ends ---------------------------- */
    if (opts.showHinges !== false) {
      var hmap = hingeEnds(state, opts), hr = size * 0.011;
      if (hmap) {
        for (var eh = 0; eh < els.length; eh++) {
          var hel = els[eh], hrec = hmap[hel.id];
          if (!hrec || !elmDraw(hel.id)) continue;
          var hA = nById[hel.n1], hB = nById[hel.n2];
          if (!hA || !hB) continue;
          var hla = localAxes(hA, hB, hel.roll || 0);
          var haxis = sceneDir(map, hla.x);
          var hoff = hr * 1.6;   /* sit the ball near the member end, not the node */
          if (hrec[hel.n1]) addHingeBall(lines, v3add(sc(hA, false), v3scale(haxis, hoff)), haxis, hr, C.hinge);
          if (hrec[hel.n2]) addHingeBall(lines, v3sub(sc(hB, false), v3scale(haxis, hoff)), haxis, hr, C.hinge);
        }
      }
    }

    /* ---- restraint markers ----------------------------------------- */
    if (opts.showRestraints !== false) {
      var rests = restraintRecords(state, nById);
      var AXV = { x: sceneAxis(map, 1, 0, 0), y: sceneAxis(map, 0, 1, 0), z: sceneAxis(map, 0, 0, 1) };
      var SCOL = C.support;
      var TRD = [["x", "Rx"], ["y", "Ry"], ["z", "Rz"]];
      var ROD = [["x", "Rxx"], ["y", "Ryy"], ["z", "Rzz"]];
      for (var rkey in rests) {
        if (!Object.prototype.hasOwnProperty.call(rests, rkey)) continue;
        var rc = rests[rkey];
        var nd = nById[rc.node];
        if (!nd || !nodeDraw(nd.id)) continue;
        var c = sc(nd, false);
        var fullyFixed = !!(rc.Rx && rc.Ry && rc.Rz && rc.Rxx && rc.Ryy && rc.Rzz);
        if (fullyFixed) {
          /* fixed in all directions: a small hatched block, same size as the
             other support markers (not a big solid brick) */
          addFixedBlock(lines, c, AXV, ms * 1.1, C.fixedBlock);
          continue;
        }
        for (var ti = 0; ti < TRD.length; ti++) {
          if (rc[TRD[ti][1]]) addTransMark(lines, c, AXV[TRD[ti][0]], SCOL[TRD[ti][0]], ms * 1.1);
        }
        for (var ri = 0; ri < ROD.length; ri++) {
          if (rc[ROD[ri][1]]) addRotMark(lines, c, AXV[ROD[ri][0]], SCOL[ROD[ri][0]], ms * 0.9);
        }
      }
    }

    /* ---- loads ------------------------------------------------------ */
    var showStatic = preMode ? !opts.modalInput : ((opts.modeIndex | 0) === 0 && !opts.combined);
    if (state.model && caseObj && showStatic) {
      var elById = {};
      for (i = 0; i < els.length; i++) elById[els[i].id] = els[i];
      var LOADC = C.load;
      var ULOADC = C.uniformLoad || LOADC;
      var TLOADC = C.trapezoidLoad || LOADC;
      var PLOADC = C.pointLoad || LOADC;
      var GLOADC = C.gravityLoad || LOADC;
      function on(label) { return opts[label] === undefined ? true : !!opts[label]; }
      var showLoads = on("showLoads");
      var cat = {
        nodal: showLoads && on("showNodalLoads"),
        uniform: showLoads && on("showUniformLoads"),
        trapezoid: showLoads && on("showTrapezoidLoads"),
        point: showLoads && on("showPointLoads")
      };
      var showMoments = showLoads && on("showMomentLoads");
      var showPresc = showLoads && on("showPrescribed");
      var showGravity = showLoads && on("showGravity");

      /* per-category reference magnitude so a big nodal force does not
         shrink the distributed-load arrows */
      var lrefN = 0, lrefU = 0, lrefT = 0, lrefP = 0;
      caseObj.nodal.forEach(function (L) { lrefN = Math.max(lrefN, mag3(L.Fx, L.Fy, L.Fz)); });
      caseObj.uniform.forEach(function (u) { lrefU = Math.max(lrefU, mag3(u.Ux, u.Uy, u.Uz)); });
      caseObj.point.forEach(function (p) { lrefP = Math.max(lrefP, mag3(p.Px, p.Py, p.Pz)); });
      caseObj.trapezoid.forEach(function (w) {
        lrefT = Math.max(lrefT, Math.abs(w.wx1), Math.abs(w.wx2), Math.abs(w.wy1),
          Math.abs(w.wy2), Math.abs(w.wz1), Math.abs(w.wz2));
      });

      if (on("showLoads") && cat.nodal && lrefN > 0) {
        caseObj.nodal.forEach(function (L) {
          var m = mag3(L.Fx, L.Fy, L.Fz), nd = nById[L.node];
          if (!(m > 0) || !nd || !nodeDraw(nd.id)) return;
          addLoadArrow(lines, map, nd, { x: L.Fx / m, y: L.Fy / m, z: L.Fz / m }, alen * (m / lrefN), LOADC);
        });
      }
      if (on("showLoads") && cat.uniform && lrefU > 0) {
        caseObj.uniform.forEach(function (u) {
          var m = mag3(u.Ux, u.Uy, u.Uz), el = elById[u.elm];
          if (!(m > 0) || !el || !elmDraw(el.id)) return;
          var A = nById[el.n1], B = nById[el.n2];
          if (!A || !B) return;
          var la = localAxes(A, B, el.roll || 0);
          var dir = localToWorld(la, u.Ux / m, u.Uy / m, u.Uz / m);
          var len = alen * (m / lrefU);
          [0.2, 0.4, 0.6, 0.8].forEach(function (f) {
            addLoadArrow(lines, map, lerp(A, B, f), dir, len, ULOADC);
          });
        });
      }
      if (on("showLoads") && cat.trapezoid) {
        caseObj.trapezoid.forEach(function (w) {
          var el = elById[w.elm];
          if (!el || !elmDraw(el.id)) return;
          var A = nById[el.n1], B = nById[el.n2];
          if (!A || !B) return;
          var la = localAxes(A, B, el.roll || 0);
          trapezoidArrows(lines, map, A, B, la, w, [
            ["x", w.xx1, w.xx2, w.wx1, w.wx2], ["y", w.xy1, w.xy2, w.wy1, w.wy2],
            ["z", w.xz1, w.xz2, w.wz1, w.wz2]
          ], alen, lrefT, TLOADC);
        });
      }
      if (on("showLoads") && cat.point && lrefP > 0) {
        caseObj.point.forEach(function (p) {
          var m = mag3(p.Px, p.Py, p.Pz), el = elById[p.elm];
          if (!(m > 0) || !el || !elmDraw(el.id)) return;
          var A = nById[el.n1], B = nById[el.n2];
          if (!A || !B) return;
          var la = localAxes(A, B, el.roll || 0);
          var pt = v3add(A, v3scale(la.x, p.x || 0));
          addLoadArrow(lines, map, pt, localToWorld(la, p.Px / m, p.Py / m, p.Pz / m), alen * (m / lrefP), PLOADC);
        });
      }
      /* nodal moment loads: semicircle + arrow showing the sense */
      if (showMoments) {
        var mref = 0;
        caseObj.nodal.forEach(function (L) { mref = Math.max(mref, mag3(L.Mxx, L.Myy, L.Mzz)); });
        if (mref > 0) {
          var axes3 = [{ v: { x: 1, y: 0, z: 0 }, k: "Mxx" }, { v: { x: 0, y: 1, z: 0 }, k: "Myy" }, { v: { x: 0, y: 0, z: 1 }, k: "Mzz" }];
          caseObj.nodal.forEach(function (L) {
            var nd = nById[L.node];
            if (!nd || !nodeDraw(nd.id)) return;
            var c = sc(nd, false);
            axes3.forEach(function (axd) {
              var mag = L[axd.k];
              if (!(Math.abs(mag) > 0)) return;
              var axis = sceneAxis(map, axd.v.x, axd.v.y, axd.v.z);
              var r = momBase * (0.7 + 1.0 * (Math.abs(mag) / mref));
              addMomentArc(lines, c, axis, r, mag > 0 ? 1 : -1, C.moment);
            });
          });
        }
      }
      /* prescribed displacements: arrows / rings + value label */
      if (showPresc && caseObj.prescribed) {
        var PDCOL = C.prescribed;
        caseObj.prescribed.forEach(function (d) {
          var nd = nById[d.node];
          if (!nd || !nodeDraw(nd.id)) return;
          var c = sc(nd, false);
          var mags = [Math.abs(d.Dx || 0), Math.abs(d.Dy || 0), Math.abs(d.Dz || 0), Math.abs(d.Dxx || 0), Math.abs(d.Dyy || 0), Math.abs(d.Dzz || 0)];
          var ref = Math.max.apply(null, mags) || 1;
          var tv = [[d.Dx, sceneAxis(map, 1, 0, 0)], [d.Dy, sceneAxis(map, 0, 1, 0)], [d.Dz, sceneAxis(map, 0, 0, 1)]];
          tv.forEach(function (p) {
            if (!(Math.abs(p[0]) > 0)) return;
            var dir = v3scale(p[1], p[0] > 0 ? 1 : -1);
            lines.push({ a: v3sub(c, v3scale(dir, alen * (Math.abs(p[0]) / ref))), b: c, color: PDCOL, width: 2.0, overlay: true });
          });
          var rv = [[d.Dxx, sceneAxis(map, 1, 0, 0)], [d.Dyy, sceneAxis(map, 0, 1, 0)], [d.Dzz, sceneAxis(map, 0, 0, 1)]];
          rv.forEach(function (p) {
            if (!(Math.abs(p[0]) > 0)) return;
            addRing(lines, c, p[1], ms * 0.8, PDCOL);
          });
          var txt = prescribedText(d);
          if (txt) lines.push({ a: c, b: v3add(c, v3scale(sceneAxis(map, 0, 1, 0), ms * 1.9)), color: PDCOL, width: 0.8, label: txt, overlay: true });
        });
      }
      /* self-weight gravity arrow */
      if (on("showLoads") && showGravity) {
        var gr = caseObj.gravity || [0, 0, 0];
        var gm = mag3(gr[0], gr[1], gr[2]);
        if (gm > 0) {
          var gdir = { x: gr[0] / gm, y: gr[1] / gm, z: gr[2] / gm };
          var ctr = modelCenter(nById);
          var tail = v3sub(ctr, v3scale(gdir, alen * 1.4));
          var sTail = map(tail.x, tail.y, tail.z), sTip = map(ctr.x, ctr.y, ctr.z);
          lines.push({ a: sTail, b: sTip, color: GLOADC, width: 1.6, label: "g", overlay: true });
          var dg = v3norm(v3sub(sTip, sTail)), wg = v3perp(dg), hg = alen * 0.4;
          lines.push({ a: sTip, b: v3add(v3sub(sTip, v3scale(dg, hg)), v3scale(wg, hg * 0.5)), color: GLOADC, width: 1.4, overlay: true });
          lines.push({ a: sTip, b: v3sub(v3sub(sTip, v3scale(dg, hg)), v3scale(wg, hg * 0.5)), color: GLOADC, width: 1.4, overlay: true });
        }
      }
    }

    /* ---- modal input markers (input model) -------------------------- */
    /* Preprocessing shows them in the modal analysis view; in Postprocessing
       only a modal view (a vibration mode or the combined animation). */
    var modalView = preMode ? !!opts.modalInput
      : ((opts.modeIndex | 0) > 0 || !!opts.combined);
    if (state.model && state.model.modal && modalView && opts.showLoads !== false) {
      var im = state.model.modal;
      var up = sceneAxis(map, 0, 1, 0);
      if (opts.showNodeInertia !== false && im.inertia && im.inertia.length) {
        for (var ii = 0; ii < im.inertia.length; ii++) {
          var inr = im.inertia[ii], ind = nById[inr.node];
          if (!ind || !nodeDraw(ind.id)) continue;
          var ic = sc(ind, false);
          var itip = v3add(ic, v3scale(up, ms * 1.6));
          var ilabel = "mass " + fmtNum(inr.mass) + " (node " + inr.node + ")";
          if (inr.Ixx || inr.Iyy || inr.Izz) {
            ilabel += " (Ixx=" + fmtNum(inr.Ixx) + "; Iyy=" + fmtNum(inr.Iyy) + "; Izz=" + fmtNum(inr.Izz) + ")";
          }
          lines.push({ a: ic, b: itip, color: C.inertia, width: 1.6, label: ilabel });
        }
      }
      if (opts.showElemMass !== false && im.elemMass && im.elemMass.length) {
        var elById2 = {};
        for (var sz = 0; sz < els.length; sz++) elById2[els[sz].id] = els[sz];
        for (var ie = 0; ie < im.elemMass.length; ie++) {
          var iem = im.elemMass[ie];
          var fe = elById2[iem.elm];
          if (!fe || !elmDraw(fe.id)) continue;
          var fA = nById[fe.n1], fB = nById[fe.n2];
          if (!fA || !fB) continue;
          var fc = map((fA.x + fB.x) / 2, (fA.y + fB.y) / 2, (fA.z + fB.z) / 2);
          var etip = v3add(fc, v3scale(up, ms * 1.6));
          lines.push({ a: fc, b: etip, color: C.inertia, width: 1.6, label: "extra mass " + fmtNum(iem.m) + " (el " + iem.elm + ")" });
        }
      }
      if (opts.showCondensation !== false && im.condensation && im.condensation.nodes) {
        for (var icn = 0; icn < im.condensation.nodes.length; icn++) {
          var cnd = nById[im.condensation.nodes[icn].node];
          if (!cnd || !nodeDraw(cnd.id)) continue;
          var cc = sc(cnd, false);
          addRing(lines, cc, up, ms * 0.9, C.condensation);
          lines.push({ a: cc, b: v3add(cc, v3scale(up, ms * 1.6)), color: C.condensation, width: 0.8, label: "condensed" });
        }
      }
    }

    /* ---- stiffness overlay (informational badge) -------------------- */
    if (opts.showStiffness) {
      if (state.model) {
        badges.push("Geometric stiffness: " + (state.model.flags.geom ? "ON" : "OFF"));
        badges.push("Shear deformation: " + (state.model.flags.shear ? "ON" : "OFF"));
        if (state.model.modal) {
          badges.push("Mass matrix: " + (state.model.modal.lump ? "lumped" : "consistent"));
          if (state.model.modal.condensation) {
            badges.push("Condensation: method " + state.model.modal.condensation.cmethod +
              ", " + state.model.modal.condensation.nodes.length + " node(s)");
          }
        }
      }
    }

    /* ---- analytical force diagrams (T8) ----------------------------- */
    if (opts.showDiagrams && showStatic && state.results && !preMode) {
      drawDiagrams(state, opts, els, nById, map, lines, size, colorBy === "none" ? null : elColor);
    }

    /* ---- measure tool (distance / angle) ---------------------------- */
    var measuring = !!(state.measure && ((state.measure.done && state.measure.done.length) ||
      (state.measure.points && state.measure.points.length >= 2)));
    if (measuring) drawMeasure(state, nById, map, lines, size);

    var labelsForDiagrams = !!opts.showDiagrams && !!opts.diagramLabels;
    return {
      points: points,
      lines: lines,
      tris: [],
      quads: quads,
      badges: badges,
      /* global (model) axis directions in scene space: the orientation map may
         rotate the model (Z-up models), so the axes gizmo must follow it */
      axes: {
        x: sceneAxis(map, 1, 0, 0),
        y: sceneAxis(map, 0, 1, 0),
        z: sceneAxis(map, 0, 0, 1)
      },
      showAxes: opts.showAxes !== false,
      showGrid: !!opts.showGrid,
      show: {
        points: opts.showNodes !== false,
        pointLabels: !!opts.showNodeLabels,
        lines: opts.showElements !== false,
        lineLabels: !!(opts.showElemLabels || opts.showLocalAxes || opts.showPrincipalAxis || labelsForDiagrams || opts.showPrescribed !== false || measuring),
        faces: quads.length > 0,
        faceLabels: false,
        marks: false
      },
      legend: legend
    };
  };

  /* ---- restraint records keyed by node ------------------------------ */
  function restraintRecords(state, nById) {
    var out = {};
    if (state.model && state.model.reactions && state.model.reactions.length) {
      for (var rr = 0; rr < state.model.reactions.length; rr++) {
        var rc = state.model.reactions[rr];
        if (rc.Rx || rc.Ry || rc.Rz || rc.Rxx || rc.Ryy || rc.Rzz) out[rc.node] = rc;
      }
    } else if (state.results && state.results.geometryFromOut) {
      var gn = state.results.geometryFromOut.nodes;
      for (var q = 0; q < gn.length; q++) {
        var t = gn[q];
        if (t.Rx || t.Ry || t.Rz || t.Rxx || t.Ryy || t.Rzz) {
          out[t.id] = { node: t.id, Rx: t.Rx, Ry: t.Ry, Rz: t.Rz, Rxx: t.Rxx, Ryy: t.Ryy, Rzz: t.Rzz };
        }
      }
    }
    return out;
  }

  /* ---- force diagrams (T8) ----------------------------------------- */
  function fmtNum(v) {
    if (!isFinite(v)) return "-";
    var a = Math.abs(v);
    if (a !== 0 && (a < 1e-3 || a > 1e5)) return v.toExponential(2);
    return String(Number(v.toPrecision(4)));
  }

  /* per-element member loads for one load case (local, filtered) */
  function memberLoadsFor(caseObj, elmId) {
    if (!caseObj) return null;
    var out = {
      gravity: caseObj.gravity || [0, 0, 0], uniform: [], trapezoid: [], point: []
    };
    (caseObj.uniform || []).forEach(function (u) { if (u.elm === elmId) out.uniform.push(u); });
    (caseObj.trapezoid || []).forEach(function (w) { if (w.elm === elmId) out.trapezoid.push(w); });
    (caseObj.point || []).forEach(function (p) { if (p.elm === elmId) out.point.push(p); });
    return out;
  }

  /* analytic-with-correction diagram set for one element.
     Returns { L, la, Nx:[{x,value}], Vy, Vz, Myy, Mzz, Txx }. */
  App.elemDiagramSet = function (elm, A, B, ef, loads) {
    var la = localAxes(A, B, elm.roll || 0);
    var L = la.L;
    var q1 = ef.q1 || {}, q2 = ef.q2 || {};
    var tgt = {
      Nx0: -(q1.nx || 0), NxL: (q2.nx || 0),
      Vy0: -(q1.vy || 0), VyL: (q2.vy || 0),
      Vz0: -(q1.vz || 0), VzL: (q2.vz || 0),
      Tx0: -(q1.txx || 0), TxL: (q2.txx || 0),
      My0: (q1.myy || 0), MyL: -(q2.myy || 0),
      Mz0: -(q1.mzz || 0), MzL: (q2.mzz || 0)
    };

    var GN = 200;
    var xs = [], k;
    for (k = 0; k <= GN; k++) xs.push(k * L / GN);

    /* fallback: no member-load data -> straight interpolation between ends */
    if (!loads) {
      function lin(a, b) { var o = []; for (var z = 0; z <= GN; z++) o.push(a + (b - a) * (z / GN)); return o; }
      function mk(a, b) { return function (x) { return a + (b - a) * (L > 0 ? x / L : 0); }; }
      var fns = { Nx: mk(tgt.Nx0, tgt.NxL), Vy: mk(tgt.Vy0, tgt.VyL), Vz: mk(tgt.Vz0, tgt.VzL),
        Myy: mk(tgt.My0, tgt.MyL), Mzz: mk(tgt.Mz0, tgt.MzL), Txx: mk(tgt.Tx0, tgt.TxL) };
      return { L: L, la: la, x: xs, breaks: [0, L], approx: true,
        sample: function (kind, x) { return fns[kind](x); },
        Nx: lin(tgt.Nx0, tgt.NxL), Vy: lin(tgt.Vy0, tgt.VyL), Vz: lin(tgt.Vz0, tgt.VzL),
        Myy: lin(tgt.My0, tgt.MyL), Mzz: lin(tgt.Mz0, tgt.MzL), Txx: lin(tgt.Tx0, tgt.TxL) };
    }

    var g = loads.gravity || [0, 0, 0];
    var dens = elm.density || 0, Ax = elm.Ax || 0;
    var wx0 = dens * Ax * (la.x.x * g[0] + la.x.y * g[1] + la.x.z * g[2]);
    var wy0 = dens * Ax * (la.y.x * g[0] + la.y.y * g[1] + la.y.z * g[2]);
    var wz0 = dens * Ax * (la.z.x * g[0] + la.z.y * g[1] + la.z.z * g[2]);
    (loads.uniform || []).forEach(function (u) { wx0 += u.Ux || 0; wy0 += u.Uy || 0; wz0 += u.Uz || 0; });

    /* Each local axis carries a distributed load that is the sum of a
       constant (gravity + uniform), linear ramps (trapezoidal) and point
       loads. Integrating them in closed form removes the small step the
       fixed trapezoid grid produced when a load breakpoint fell between
       grid nodes (the "sometimes" jump near a diagram vertex). */
    function axisModel(axis) {
      var base = axis === 0 ? wx0 : (axis === 1 ? wy0 : wz0);
      var ramps = [], points = [];
      (loads.trapezoid || []).forEach(function (w) {
        var x1, x2, w1, w2;
        if (axis === 0) { x1 = w.xx1; x2 = w.xx2; w1 = w.wx1; w2 = w.wx2; }
        else if (axis === 1) { x1 = w.xy1; x2 = w.xy2; w1 = w.wy1; w2 = w.wy2; }
        else { x1 = w.xz1; x2 = w.xz2; w1 = w.wz1; w2 = w.wz2; }
        x1 = Math.max(0, Math.min(L, x1 || 0)); x2 = Math.max(0, Math.min(L, x2 || 0));
        if (x2 > x1) ramps.push({ x1: x1, x2: x2, w1: w1 || 0, w2: w2 || 0 });
      });
      (loads.point || []).forEach(function (p) {
        var P = axis === 0 ? (p.Px || 0) : (axis === 1 ? (p.Py || 0) : (p.Pz || 0));
        points.push({ x: Math.max(0, Math.min(L, p.x || 0)), P: P });
      });
      return { base: base, ramps: ramps, points: points };
    }
    /* closed-form first and second integrals of the distributed load */
    function rampInt1(r, x) {
      if (x <= r.x1) return 0;
      var D = r.x2 - r.x1, m = (r.w2 - r.w1) / D;
      if (x < r.x2) { var d = x - r.x1; return r.w1 * d + 0.5 * m * d * d; }
      return 0.5 * (r.w1 + r.w2) * D;
    }
    function rampInt2(r, x) {
      if (x <= r.x1) return 0;
      var D = r.x2 - r.x1, m = (r.w2 - r.w1) / D;
      if (x < r.x2) { var d = x - r.x1; return r.w1 * d * d / 2 + m * d * d * d / 6; }
      var first = 0.5 * (r.w1 + r.w2) * D;
      return r.w1 * D * D / 2 + m * D * D * D / 6 + first * (x - r.x2);
    }
    function W1(m, x) {          /* integral of the distributed load over [0,x] */
      var s = m.base * x;
      m.ramps.forEach(function (r) { s += rampInt1(r, x); });
      m.points.forEach(function (p) { if (x >= p.x) s += p.P; });
      return s;
    }
    function W2(m, x) {          /* integral of W1 over [0,x] */
      var s = m.base * x * x / 2;
      m.ramps.forEach(function (r) { s += rampInt2(r, x); });
      m.points.forEach(function (p) { if (x >= p.x) s += p.P * (x - p.x); });
      return s;
    }
    var mx = axisModel(0), my = axisModel(1), mz = axisModel(2);

    /* load breakpoints (ramp ends and point loads) so the drawn diagram has
       exact vertices at the kinks/steps instead of cutting the corner */
    var breakSet = {}; breakSet[0] = 1; breakSet[L] = 1;
    [mx, my, mz].forEach(function (m) {
      m.ramps.forEach(function (r) { if (r.x1 > 0 && r.x1 < L) breakSet[r.x1] = 1; if (r.x2 > 0 && r.x2 < L) breakSet[r.x2] = 1; });
      m.points.forEach(function (p) { if (p.x > 0 && p.x < L) breakSet[p.x] = 1; });
    });
    var breaks = Object.keys(breakSet).map(Number).sort(function (a, b) { return a - b; });

    /* closed-form raw internal forces (before the endpoint correction) */
    var raw = {
      Nx: function (x) { return tgt.Nx0 - W1(mx, x); },
      Vy: function (x) { return tgt.Vy0 - W1(my, x); },
      Vz: function (x) { return tgt.Vz0 - W1(mz, x); },
      Mzz: function (x) { return tgt.Mz0 - tgt.Vy0 * x + W2(my, x); },
      Myy: function (x) { return tgt.My0 - tgt.Vz0 * x + W2(mz, x); },
      Txx: function (x) { return tgt.Tx0 + (tgt.TxL - tgt.Tx0) * (L > 0 ? x / L : 0); }
    };
    var tgtOf = { Nx: [tgt.Nx0, tgt.NxL], Vy: [tgt.Vy0, tgt.VyL], Vz: [tgt.Vz0, tgt.VzL],
      Mzz: [tgt.Mz0, tgt.MzL], Myy: [tgt.My0, tgt.MyL], Txx: [tgt.Tx0, tgt.TxL] };
    var corr = {};
    Object.keys(raw).forEach(function (kind) {
      var a = tgtOf[kind][0], b = tgtOf[kind][1];
      var r0 = raw[kind](0), rL = raw[kind](L);
      corr[kind] = { off0: a - r0, res: b - (rL + (a - r0)) };
    });
    function sample(kind, x) {
      var c = corr[kind];
      return raw[kind](x) + c.off0 + c.res * (L > 0 ? x / L : 0);
    }

    var out = { L: L, la: la, x: xs, breaks: breaks, approx: false, sample: sample };
    ["Nx", "Vy", "Vz", "Myy", "Mzz", "Txx"].forEach(function (kind) {
      var a = [];
      for (var z = 0; z <= GN; z++) a.push(sample(kind, xs[z]));
      out[kind] = a;
    });
    return out;
  };

  /* public convenience: sample one kind at n points across 0..L */
  App.elemDiagram = function (elm, A, B, endForces, memberLoads, kind) {
    var set = App.elemDiagramSet(elm, A, B, endForces, memberLoads);
    var arr = set[kind];
    if (!arr) return [];
    var n = 40, out = [];
    for (var i = 0; i <= n; i++) {
      var x = set.L * i / n;
      var fi = x / set.L * (arr.length - 1);
      var i0 = Math.floor(fi), i1 = Math.min(arr.length - 1, i0 + 1);
      var v = arr[i0] + (arr[i1] - arr[i0]) * (fi - i0);
      out.push({ x: x, value: v });
    }
    return out;
  };

  var DIAG_KINDS = [["Nx", "Nx"], ["Vy", "|Vy|"], ["Vz", "|Vz|"], ["Txx", "|Txx|"], ["Myy", "|Myy|"], ["Mzz", "|Mzz|"]];
  App.diagramKinds = DIAG_KINDS;

  /* index a load case's element loads by element id (avoids O(E*loads)) */
  function loadsByElement(caseObj) {
    var out = {};
    function slot(id) { return out[id] || (out[id] = { uniform: [], trapezoid: [], point: [] }); }
    if (caseObj) {
      (caseObj.uniform || []).forEach(function (u) { slot(u.elm).uniform.push(u); });
      (caseObj.trapezoid || []).forEach(function (w) { slot(w.elm).trapezoid.push(w); });
      (caseObj.point || []).forEach(function (p) { slot(p.elm).point.push(p); });
    }
    return out;
  }

  /* build (once per case/model/results/kind/orientation) the scene-space
     diagram geometry for every element, cached as reusable line objects so
     per-frame drawing allocates almost nothing. */
  function fillDiagrams(cache, els, nById, map, caseObj, efByElm, kinds, size) {
    var maxAbs = cache.maxAbs;
    kinds.forEach(function (kk) { maxAbs[kk] = 0; });
    var byEl = loadsByElement(caseObj);
    var sets = {};
    for (var me = 0; me < els.length; me++) {
      var Elm = els[me];
      var eA = nById[Elm.n1], eB = nById[Elm.n2];
      if (!eA || !eB) continue;
      var recs = efByElm[Elm.id] || [], q1 = null, q2 = null;
      for (var r = 0; r < recs.length; r++) { if (recs[r].node === Elm.n1) q1 = recs[r]; if (recs[r].node === Elm.n2) q2 = recs[r]; }
      if (!q1 && recs.length) q1 = recs[0];
      if (!q2 && recs.length) q2 = recs[recs.length - 1];
      var ld = byEl[Elm.id] || { uniform: [], trapezoid: [], point: [] };
      var loads = { gravity: (caseObj && caseObj.gravity) || [0, 0, 0], uniform: ld.uniform, trapezoid: ld.trapezoid, point: ld.point };
      var set = App.elemDiagramSet(Elm, eA, eB, { q1: q1, q2: q2 }, loads);
      sets[Elm.id] = set;
      kinds.forEach(function (kk) {
        var arr = set[kk];
        if (!arr) return;
        for (var z = 0; z < arr.length; z++) { var av = Math.abs(arr[z]); if (av > maxAbs[kk]) maxAbs[kk] = av; }
      });
    }

    var height = size * 0.20;
    var dense = els.length <= 120;      /* coarser diagrams on large models */
    var segs = dense ? 16 : 8;          /* uniform envelope points */

    /* exact x of the maximum |value| via a coarse scan + ternary refine */
    function peakX(set, kind, L) {
      var N = 40, best = -1, bx = 0, i, x, v;
      for (i = 0; i <= N; i++) { x = L * i / N; v = Math.abs(set.sample(kind, x)); if (v > best) { best = v; bx = x; } }
      var lo = Math.max(0, bx - L / N), hi = Math.min(L, bx + L / N);
      for (i = 0; i < 40; i++) {
        var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
        if (Math.abs(set.sample(kind, m1)) < Math.abs(set.sample(kind, m2))) lo = m1; else hi = m2;
      }
      var xm = (lo + hi) / 2;
      return Math.abs(set.sample(kind, xm)) >= best ? xm : bx;
    }

    for (var di = 0; di < els.length; di++) {
      var elm = els[di];
      var st = sets[elm.id];
      if (!st) continue;
      var la = st.la, A = nById[elm.n1];
      var list = [];
      for (var ki = 0; ki < kinds.length; ki++) {
        var kk = kinds[ki];
        if (!(maxAbs[kk] > 0)) continue;
        var axis = (kk === "Vz" || kk === "Myy") ? la.z : la.y;
        var dir = sceneDir(map, axis);
        /* vertices: uniform + load breakpoints + the exact peak */
        var xsList = [];
        for (var s = 0; s <= segs; s++) xsList.push(st.L * s / segs);
        (st.breaks || []).forEach(function (b) { xsList.push(b); });
        xsList.push(peakX(st, kk, st.L));
        xsList.sort(function (a, b) { return a - b; });
        var base = [], curve = [], peakPt = null, peakAbs = -1, val = 0;
        for (var q = 0; q < xsList.length; q++) {
          var xq = xsList[q];
          if (q > 0 && Math.abs(xq - xsList[q - 1]) < 1e-9) { continue; }
          var wpos = { x: A.x + la.x.x * xq, y: A.y + la.x.y * xq, z: A.z + la.x.z * xq };
          var sp = map(wpos.x, wpos.y, wpos.z);
          var vq = st.sample(kk, xq);
          var cp = v3add(sp, v3scale(dir, (vq / maxAbs[kk]) * height));
          base.push(sp); curve.push(cp);
          if (Math.abs(vq) > peakAbs) { peakAbs = Math.abs(vq); peakPt = cp; val = vq; }
        }
        var col = val >= 0 ? C.diagram.positive : C.diagram.negative;
        /* label anchor is a zero-length segment, so no tick/spike is drawn */
        var ent = { segs: [], peak: { a: peakPt, b: peakPt, color: col, width: 2.2, label: null }, label: kk + "=" + fmtNum(val) };
        for (q = 0; q < base.length; q++) {
          if (q % 2 === 0) ent.segs.push({ a: base[q], b: curve[q], color: col, width: 1.0 });
        }
        for (q = 0; q < curve.length - 1; q++) ent.segs.push({ a: curve[q], b: curve[q + 1], color: col, width: 1.6 });
        list.push(ent);
      }
      cache.drawn[elm.id] = list;
    }
  }

  /* draw the cached diagrams for every visible element (very cheap per frame) */
  function drawDiagrams(state, opts, els, nById, map, lines, size) {
    var kind = opts.diagramKind || "Mzz";
    var kinds = (kind === "all") ? DIAG_KINDS.map(function (k) { return k[0]; }) : [kind];
    var lc = null;
    if (state.results && state.results.loadCases) {
      var ci = opts.caseIndex | 0;
      for (var l = 0; l < state.results.loadCases.length; l++) if (state.results.loadCases[l].index === ci) lc = state.results.loadCases[l];
    }
    if (!lc) return;
    var efByElm = {};
    for (var e = 0; e < lc.endForces.length; e++) (efByElm[lc.endForces[e].elm] = efByElm[lc.endForces[e].elm] || []).push(lc.endForces[e]);

    var cache = state.__diag;
    var sDiag = (opts.sizes && opts.sizes.diagram > 0) ? opts.sizes.diagram : 0.3;
    if (!cache || cache.caseIndex !== opts.caseIndex || cache.model !== state.model ||
        cache.results !== state.results || cache.kind !== kind || cache.sDiag !== sDiag) {
      cache = state.__diag = { caseIndex: opts.caseIndex, model: state.model, results: state.results, kind: kind, sDiag: sDiag, byElm: {}, maxAbs: {}, drawn: {}, filled: false };
    }
    if (!cache.filled) {
      fillDiagrams(cache, els, nById, map, caseObject(state, opts), efByElm, kinds, size * sDiag);
      cache.filled = true;
    }
    for (var de = 0; de < els.length; de++) {
      var elm = els[de];
      if (state.vis && state.vis.hiddenElems && state.vis.hiddenElems[elm.id]) continue;
      var list = cache.drawn[elm.id];
      if (!list) continue;
      for (var li = 0; li < list.length; li++) {
        var ent = list[li];
        for (var si = 0; si < ent.segs.length; si++) lines.push(ent.segs[si]);
        ent.peak.label = opts.diagramLabels ? ent.label : null;
        lines.push(ent.peak);
      }
    }
  }

  function caseObject(state, opts) {
    if (!state.model || !state.model.loadCases) return null;
    var ci = opts.caseIndex | 0;
    for (var i = 0; i < state.model.loadCases.length; i++) if (state.model.loadCases[i].index === ci) return state.model.loadCases[i];
    return null;
  }

  /* ---- measure tool ------------------------------------------------ */
  var MEASURE_COLOR = C.measure;
  function wdist(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  App.pointDistance = wdist;
  App.pointAngle = function (A, V, C) {
    var ux = A.x - V.x, uy = A.y - V.y, uz = A.z - V.z;
    var vx = C.x - V.x, vy = C.y - V.y, vz = C.z - V.z;
    var lu = Math.sqrt(ux * ux + uy * uy + uz * uz);
    var lv = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (!(lu > 0) || !(lv > 0)) return NaN;
    var c = (ux * vx + uy * vy + uz * vz) / (lu * lv);
    return Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI;
  };
  function drawMeasure(state, nById, map, lines, size) {
    var m = state.measure, col = MEASURE_COLOR;
    var done = (m && m.done) || [];
    function sp(p) { return map(p.x, p.y, p.z); }
    /* draw one completed (or in-progress) measurement: segments plus the
       distance label / angle arc+label, recomputed against the current
       geometry so stale node ids simply drop out */
    function drawOne(measurement) {
      var P = [], i;
      for (i = 0; i < measurement.points.length; i++) {
        var nd = nById[measurement.points[i]];
        if (nd) P.push(nd);
      }
      if (P.length < 2) return;
      for (i = 0; i < P.length - 1; i++) lines.push({ a: sp(P[i]), b: sp(P[i + 1]), color: col, width: 2.6 });
      if (measurement.mode === "distance" && P.length >= 2) {
        var a = sp(P[0]), b = sp(P[1]), d = wdist(P[0], P[1]);
        var mid = v3scale(v3add(a, b), 0.5), perp = v3perp(v3norm(v3sub(b, a)));
        lines.push({ a: v3add(mid, v3scale(perp, size * 0.012)), b: v3add(mid, v3scale(perp, -size * 0.012)),
          color: col, width: 1.0, label: "d = " + fmtNum(d) });
      } else if (measurement.mode === "angle" && P.length >= 3) {
        var V = sp(P[1]), A = sp(P[0]), C = sp(P[2]);
        var u1 = v3norm(v3sub(A, V)), u2 = v3norm(v3sub(C, V));
        var ang = App.pointAngle(P[0], P[1], P[2]);
        var r = Math.min(size * 0.12, 0.5 * v3len(v3sub(A, V)), 0.5 * v3len(v3sub(C, V)));
        addArc(lines, V, u1, u2, r, col);
        var bis = v3norm(v3add(u1, u2));
        if (!(v3len(bis) > 0.5)) bis = v3perp(u1);
        lines.push({ a: v3add(V, v3scale(bis, r * 1.35)), b: v3add(V, v3scale(bis, r * 1.6)),
          color: col, width: 1.0, label: "\u2220 = " + fmtNum(ang) + "\u00b0" });
      }
    }
    for (var d2 = 0; d2 < done.length; d2++) drawOne(done[d2]);
    if (m && m.points && m.points.length >= 2) drawOne({ mode: m.mode, points: m.points });
  }
  function addArc(lines, c, u1, u2, r, color) {
    var d = Math.max(-1, Math.min(1, v3dot(u1, u2)));
    var ang = Math.acos(d);
    if (!(ang > 1e-6)) return;
    var axis = v3cross(u1, u2);
    if (!(v3len(axis) > 1e-9)) return;
    axis = v3norm(axis);
    var n = 20, prev = null;
    for (var k = 0; k <= n; k++) {
      var a = ang * k / n;
      var p = v3add(v3scale(u1, Math.cos(a)),
        v3add(v3scale(v3cross(axis, u1), Math.sin(a)), v3scale(axis, v3dot(axis, u1) * (1 - Math.cos(a)))));
      var q = v3add(c, v3scale(p, r));
      if (prev) lines.push({ a: prev, b: q, color: color, width: 1.8 });
      prev = q;
    }
  }

  /* ---- drawing primitives ------------------------------------------- */
  function vec3(a, b, c) { return { x: a, y: b, z: c }; }
  function v3add(a, b) { return vec3(a.x + b.x, a.y + b.y, a.z + b.z); }
  function v3sub(a, b) { return vec3(a.x - b.x, a.y - b.y, a.z - b.z); }
  function v3scale(a, s) { return vec3(a.x * s, a.y * s, a.z * s); }
  function v3len(a) { return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z); }
  function v3norm(a) { var l = v3len(a) || 1; return vec3(a.x / l, a.y / l, a.z / l); }
  function v3cross(a, b) {
    return vec3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
  }
  function v3dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
  function v3perp(v) {
    var ref = Math.abs(v.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 1, 0);
    return v3norm(v3cross(v, ref));
  }
  function sceneAxis(map, x, y, z) {
    var o = map(0, 0, 0), p = map(x, y, z);
    return v3norm(v3sub(p, o));
  }
  function sceneDir(map, v) {
    var o = map(0, 0, 0), p = map(v.x, v.y, v.z);
    return v3norm(v3sub(p, o));
  }

  /* Frame3DD element local axes (coordtrans.c, Zvert = global Z vertical) */
  function localAxes(A, B, rollDeg) {
    var dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z;
    var L = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    var Cx = dx / L, Cy = dy / L, Cz = dz / L;
    var p = (rollDeg || 0) * Math.PI / 180, Cp = Math.cos(p), Sp = Math.sin(p);
    if (Math.abs(Math.abs(Cz) - 1) < 1e-9) {
      var s = Cz >= 0 ? 1 : -1;
      return { L: L,
        x: vec3(0, 0, s),
        y: vec3(-s * Sp, Cp, 0),
        z: vec3(-s * Cp, -Sp, 0) };
    }
    var den = Math.sqrt(1 - Cz * Cz);
    return { L: L,
      x: vec3(Cx, Cy, Cz),
      y: vec3((-Cx * Cz * Sp - Cy * Cp) / den, (-Cy * Cz * Sp + Cx * Cp) / den, Sp * den),
      z: vec3((-Cx * Cz * Cp + Cy * Sp) / den, (-Cy * Cz * Cp - Cx * Sp) / den, Cp * den) };
  }

  function addAxisArrow(lines, p, v, len, color, label) {
    var tip = v3add(p, v3scale(v, len));
    lines.push({ a: p, b: tip, color: color, width: 1.8, label: label || null });
    var w = v3perp(v), h = len * 0.2;
    lines.push({ a: tip, b: v3add(v3sub(tip, v3scale(v, h)), v3scale(w, h * 0.5)), color: color, width: 1.4 });
    lines.push({ a: tip, b: v3sub(v3sub(tip, v3scale(v, h)), v3scale(w, h * 0.5)), color: color, width: 1.4 });
  }

  function addBiArrow(lines, p, v, len, color, label) {
    var a = v3sub(p, v3scale(v, len)), b = v3add(p, v3scale(v, len));
    lines.push({ a: a, b: b, color: color, width: 2.2, label: label || null });
    var w = v3perp(v), h = len * 0.24;
    lines.push({ a: b, b: v3add(v3sub(b, v3scale(v, h)), v3scale(w, h * 0.5)), color: color, width: 1.8 });
    lines.push({ a: b, b: v3sub(v3sub(b, v3scale(v, h)), v3scale(w, h * 0.5)), color: color, width: 1.8 });
    lines.push({ a: a, b: v3add(v3add(a, v3scale(v, h)), v3scale(w, h * 0.5)), color: color, width: 1.8 });
    lines.push({ a: a, b: v3sub(v3add(a, v3scale(v, h)), v3scale(w, h * 0.5)), color: color, width: 1.8 });
  }

  function addTransMark(lines, p, v, color, len) {
    var tip = v3add(p, v3scale(v, len));
    lines.push({ a: p, b: tip, color: color, width: 1.8 });
    var w = v3perp(v), half = len * 0.55;
    var e1 = v3add(tip, v3scale(w, -half));
    var e2 = v3add(tip, v3scale(w, half));
    lines.push({ a: e1, b: e2, color: color, width: 1.8 });
    var t = len * 0.5, ta = v3scale(v, t);
    lines.push({ a: e1, b: v3add(v3add(e1, v3scale(w, -t)), ta), color: color, width: 1.2 });
    lines.push({ a: e2, b: v3add(v3add(e2, v3scale(w, t)), ta), color: color, width: 1.2 });
  }

  function addRotMark(lines, p, v, color, r) {
    var c = v3add(p, v3scale(v, r * 1.4));
    addRing(lines, c, v, r, color);
  }

  /* fully fixed support: a small hatched block (wireframe cube + hatch),
     the same overall size as the other support markers */
  function addFixedBlock(lines, p, ax, len, color) {
    var half = len * 0.5;
    var axx = ax.x, ayy = ax.y, azz = ax.z;
    function corner(sx, sy, sz) {
      return v3add(p, v3add(v3add(v3scale(axx, sx * half), v3scale(ayy, sy * half)), v3scale(azz, sz * half)));
    }
    var c = [];
    for (var sx = -1; sx <= 1; sx += 2)
      for (var sy = -1; sy <= 1; sy += 2)
        for (var sz = -1; sz <= 1; sz += 2) c.push(corner(sx, sy, sz));
    function idx(sx, sy, sz) { return ((sx > 0) ? 4 : 0) + ((sy > 0) ? 2 : 0) + ((sz > 0) ? 1 : 0); }
    var edges = [
      [idx(-1, -1, -1), idx(-1, -1, 1)], [idx(-1, 1, -1), idx(-1, 1, 1)],
      [idx(1, -1, -1), idx(1, -1, 1)], [idx(1, 1, -1), idx(1, 1, 1)],
      [idx(-1, -1, -1), idx(-1, 1, -1)], [idx(-1, -1, 1), idx(-1, 1, 1)],
      [idx(1, -1, -1), idx(1, 1, -1)], [idx(1, -1, 1), idx(1, 1, 1)],
      [idx(-1, -1, -1), idx(1, -1, -1)], [idx(-1, -1, 1), idx(1, -1, 1)],
      [idx(-1, 1, -1), idx(1, 1, -1)], [idx(-1, 1, 1), idx(1, 1, 1)]
    ];
    for (var e = 0; e < edges.length; e++) lines.push({ a: c[edges[e][0]], b: c[edges[e][1]], color: color, width: 1.6 });
    /* hatch on the two faces normal to local x */
    for (var h = 1; h <= 3; h++) {
      var t = h / 4;
      var f1 = idx(1, -1, -1), f2 = idx(1, 1, 1);
      var s1 = v3add(v3scale(c[f1], 1 - t), v3scale(c[f2], t));
      var g1 = idx(1, 1, -1), g2 = idx(1, -1, 1);
      var s2 = v3add(v3scale(c[g1], 1 - t), v3scale(c[g2], t));
      lines.push({ a: s1, b: s2, color: color, width: 1.0 });
      var b1 = idx(-1, -1, -1), b2 = idx(-1, 1, 1);
      var u1 = v3add(v3scale(c[b1], 1 - t), v3scale(c[b2], t));
      var v1 = idx(-1, 1, -1), v2 = idx(-1, -1, 1);
      var u2 = v3add(v3scale(c[v1], 1 - t), v3scale(c[v2], t));
      lines.push({ a: u1, b: u2, color: color, width: 1.0 });
    }
  }

  /* a half-circle arc about `axis` with one arrowhead showing the sense */
  function addMomentArc(lines, center, axis, r, sense, color) {
    var w = v3perp(axis), u = v3norm(v3cross(axis, w));
    var n = 10, prev = null;
    for (var k = 0; k <= n; k++) {
      var a = Math.PI * k / n;                 /* half circle, 0..PI */
      var q = v3add(center, v3add(v3scale(w, Math.cos(a) * r), v3scale(u, Math.sin(a) * r)));
      if (prev) lines.push({ a: prev, b: q, color: color, width: 1.8, overlay: true });
      prev = q;
    }
    /* arrowhead at the +axis end of the arc, sense flips the tangent */
    var a0 = 0, a1 = 0.22;
    var e0 = v3add(center, v3add(v3scale(w, Math.cos(a0) * r), v3scale(u, Math.sin(a0) * r)));
    var e1 = v3add(center, v3add(v3scale(w, Math.cos(a1) * r), v3scale(u, Math.sin(a1) * r)));
    var tangent = v3norm(v3sub(e0, e1));
    var side = v3norm(v3cross(tangent, axis));
    var back = v3norm(v3add(v3scale(tangent, -1), v3scale(axis, sense)));
    var head = r * 0.45;
    lines.push({ a: e0, b: v3add(e0, v3add(v3scale(back, head), v3scale(side, head * 0.6))), color: color, width: 1.6, overlay: true });
    lines.push({ a: e0, b: v3add(e0, v3add(v3scale(back, head), v3scale(side, -head * 0.6))), color: color, width: 1.6, overlay: true });
  }

  function mag3(x, y, z) { return Math.sqrt((x || 0) * (x || 0) + (y || 0) * (y || 0) + (z || 0) * (z || 0)); }
  function p3(x, y, z) { return { x: x, y: y, z: z }; }
  function lerp(A, B, f) { return p3(A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f, A.z + (B.z - A.z) * f); }
  function localToWorld(la, lx, ly, lz) {
    return v3norm(v3add(v3add(v3scale(la.x, lx), v3scale(la.y, ly)), v3scale(la.z, lz)));
  }
  function modelCenter(nById) {
    var x = 0, y = 0, z = 0, n = 0, k;
    for (k in nById) if (Object.prototype.hasOwnProperty.call(nById, k)) { x += nById[k].x; y += nById[k].y; z += nById[k].z; n++; }
    return n ? p3(x / n, y / n, z / n) : p3(0, 0, 0);
  }
  function addLoadArrow(lines, map, p, dirW, len, color) {
    if (!(len > 0) || !dirW || !(v3len(dirW) > 0)) return;
    var tail = v3sub(p, v3scale(dirW, len));
    var tip = map(p.x, p.y, p.z), t0 = map(tail.x, tail.y, tail.z);
    lines.push({ a: t0, b: tip, color: color, width: 1.6, overlay: true });
    var d = v3norm(v3sub(tip, t0)), w = v3perp(d), h = Math.min(len * 0.35, v3len(v3sub(tip, t0)) * 0.5);
    if (!(h > 0)) return;
    lines.push({ a: tip, b: v3add(v3sub(tip, v3scale(d, h)), v3scale(w, h * 0.5)),
    color: color, width: 1.4, overlay: true });
    lines.push({ a: tip, b: v3sub(v3sub(tip, v3scale(d, h)), v3scale(w, h * 0.5)),
    color: color, width: 1.4, overlay: true });
  }
  function trapezoidArrows(lines, map, A, B, la, w, comps, alen, lref, color) {
    var L = v3len(v3sub(B, A));
    comps.forEach(function (c) {
      var axis = la[c[0]];
      var p1 = Math.max(0, Math.min(L, c[1] || 0));
      var p2 = Math.max(0, Math.min(L, c[2] || 0));
      var w1 = c[3] || 0, w2 = c[4] || 0;
      if (!(Math.abs(w1) > 0) && !(Math.abs(w2) > 0)) return;
      if (!(lref > 0)) return;
      function place(pos, mag) {
        if (!(Math.abs(mag) > 0)) return;
        var dir = v3scale(axis, mag > 0 ? 1 : -1);
        var pt = v3add(A, v3scale(la.x, pos));
        addLoadArrow(lines, map, pt, dir, alen * (Math.abs(mag) / lref), color);
      }
      if (p2 > p1) {
        /* distribute arrows along the loaded span (triangular/trapezoidal) */
        var n = 6;
        for (var k = 0; k <= n; k++) {
          var t = k / n;
          place(p1 + (p2 - p1) * t, w1 + (w2 - w1) * t);
        }
      } else {
        place(p1, w1);
        place(p2, w2);
      }
    });
  }

  function addRing(lines, p, v, r, color) {
    var w = v3perp(v), u = v3norm(v3cross(v, w));
    var n = 12, prev = null;
    for (var k = 0; k <= n; k++) {
      var a = (k / n) * Math.PI * 2;
      var q = v3add(p, v3add(v3scale(w, Math.cos(a) * r), v3scale(u, Math.sin(a) * r)));
      if (prev) lines.push({ a: prev, b: q, color: color, width: 1.8 });
      prev = q;
    }
  }

  /* a hinge ball: three mutually perpendicular circles (axis + two
     perpendicular axes) so the joint reads from every viewing angle */
  function addHingeBall(lines, p, axis, r, color) {
    addRing(lines, p, axis, r, color);
    var w = v3perp(axis);
    addRing(lines, p, w, r, color);
    addRing(lines, p, v3norm(v3cross(axis, w)), r, color);
  }

  function prescribedText(d) {
    var parts = [];
    if (d.Dx) parts.push("Dx=" + fmtNum(d.Dx));
    if (d.Dy) parts.push("Dy=" + fmtNum(d.Dy));
    if (d.Dz) parts.push("Dz=" + fmtNum(d.Dz));
    if (d.Dxx) parts.push("Dxx=" + fmtNum(d.Dxx));
    if (d.Dyy) parts.push("Dyy=" + fmtNum(d.Dyy));
    if (d.Dzz) parts.push("Dzz=" + fmtNum(d.Dzz));
    return parts.join(" ");
  }

  function hingeEnds(state, opts) {
    var res = state.results;
    if (!res || !res.loadCases) return null;
    var ci = opts.caseIndex | 0, lc = null;
    for (var c = 0; c < res.loadCases.length; c++) if (res.loadCases[c].index === ci) lc = res.loadCases[c];
    if (!lc) lc = res.loadCases[0];
    if (!lc || !lc.endForces || !lc.endForces.length) return null;
    var ref = 0;
    for (var i = 0; i < lc.endForces.length; i++) {
      var f = lc.endForces[i];
      ref = Math.max(ref, Math.abs(f.myy) || 0, Math.abs(f.mzz) || 0);
    }
    if (!(ref > 0)) return null;
    var tol = ref * 1e-4, map = {};
    for (i = 0; i < lc.endForces.length; i++) {
      var e = lc.endForces[i];
      var rec = map[e.elm] || (map[e.elm] = {});
      rec[e.node] = (Math.max(Math.abs(e.myy) || 0, Math.abs(e.mzz) || 0) <= tol);
    }
    return map;
  }

  function addArrow(lines, a, b, color, head) {
    lines.push({ a: a, b: b, color: color, width: 1.6 });
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = -dx / len, uy = -dy / len;
    var px = -uy, py = ux;
    var h1 = { x: b.x + ux * head + px * head * 0.5, y: b.y + uy * head + py * head * 0.5, z: b.z };
    var h2 = { x: b.x + ux * head - px * head * 0.5, y: b.y + uy * head - py * head * 0.5, z: b.z };
    lines.push({ a: b, b: h1, color: color, width: 1.6 });
    lines.push({ a: b, b: h2, color: color, width: 1.6 });
  }
})();
