/* parser3dd.js - Frame3DD input parser.
   Reads the plain-text `.3dd` grammar and reduces it to one numeric stream
   that is run through the grammar reader.

   Public API:
     App.tokens3dd(text)  -> { title, numbers: [..] }
     App.parse3dd(text)   -> { model, warnings }
*/
(function () {
  "use strict";

  /* ---- tokenizer ---------------------------------------------------- */
  /* Every line is reduced to its numeric tokens: drop the `#` comment and
     split on whitespace. */
  App.tokens3dd = function (text) {
    var lines = String(text === null || text === undefined ? "" : text).split(/\r?\n/);
    var nums = [];
    for (var li = 0; li < lines.length; li++) {
      var raw = lines[li];
      var hash = raw.indexOf("#");
      var noComment = (hash >= 0) ? raw.slice(0, hash) : raw;
      var toks = noComment.split(/\s+/);
      for (var t = 0; t < toks.length; t++) {
        if (App.isNumToken(toks[t])) nums.push(App.sanitizeNum(toks[t]));
      }
    }
    return { title: App.inputTitle(text), numbers: nums };
  };

  /* first non-empty line, stripped of quotes/trailing separators */
  App.inputTitle = function (text) {
    var lines = String(text === null || text === undefined ? "" : text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var s = lines[i].trim();
      if (!s) continue;
      s = s.replace(/,+\s*$/, "").trim();
      if (s.length >= 2 && s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') {
        s = s.slice(1, -1).trim();
      }
      if (s) return s;
    }
    return "";
  };

  /* ---- grammar ------------------------------------------------------ */
  App.parse3dd = function (text) {
    var warnings = [];
    var tk = App.tokens3dd(text);
    var t = tk.numbers;
    var p = 0;

    function more() { return p < t.length; }
    function num() {
      if (p >= t.length) { warnings.push("Unexpected end of numeric data."); return 0; }
      return t[p++];
    }
    function count(label) {
      if (p >= t.length) { warnings.push("Missing count for " + label + "; section skipped."); return 0; }
      var n = t[p++];
      if (n < 0 || n !== Math.floor(n)) { warnings.push("Bad count for " + label + ": " + n); return 0; }
      return n;
    }
    /* run fn() exactly n times, clamped once to the remaining token count
       (the clamp must not be re-evaluated while the pointer advances). */
    function rows(n, fn) {
      if (!(n > 0)) return;
      var avail = t.length - p;
      var m = n > avail ? avail : n;
      if (m < n) warnings.push("Truncated row block (" + n + " requested, " + m + " available).");
      for (var q = 0; q < m; q++) fn();
    }

    var model = {
      title: tk.title,
      nodes: [],
      reactions: [],
      elements: [],
      flags: { shear: 0, geom: 0, exaggStatic: 1, scale: 1, dx: -1 },
      loadCases: [],
      modal: null,
      counts: {}
    };

    try {
      /* nodes */
      var nN = count("nodes");
      rows(nN, function () {
        model.nodes.push({ id: num(), x: num(), y: num(), z: num(), r: num() });
      });

      /* restraints */
      var nR = count("restraints");
      rows(nR, function () {
        model.reactions.push({
          node: num(), Rx: num(), Ry: num(), Rz: num(), Rxx: num(), Ryy: num(), Rzz: num()
        });
      });

      /* frame elements */
      var nE = count("elements");
      rows(nE, function () {
        model.elements.push({
          id: num(), n1: num(), n2: num(),
          Ax: num(), Asy: num(), Asz: num(), Jxx: num(), Iyy: num(), Izz: num(),
          E: num(), G: num(), roll: num(), density: num()
        });
      });

      /* analysis flags */
      model.flags.shear = num();
      model.flags.geom = num();
      model.flags.exaggStatic = num();
      model.flags.scale = num();
      model.flags.dx = num();

      /* static load cases */
      var nL = count("load cases");
      rows(nL, function () {
        var lc = {
          gravity: [num(), num(), num()],
          nodal: [], uniform: [], trapezoid: [], point: [], temperature: [], prescribed: []
        };
        lc.index = model.loadCases.length + 1;

        rows(count("loaded nodes"), function () {
          lc.nodal.push({ node: num(), Fx: num(), Fy: num(), Fz: num(), Mxx: num(), Myy: num(), Mzz: num() });
        });
        rows(count("uniform loads"), function () {
          lc.uniform.push({ elm: num(), Ux: num(), Uy: num(), Uz: num() });
        });
        rows(count("trapezoidal loads"), function () {
          var row = { elm: num() };
          row.xx1 = num(); row.xx2 = num(); row.wx1 = num(); row.wx2 = num();
          row.xy1 = num(); row.xy2 = num(); row.wy1 = num(); row.wy2 = num();
          row.xz1 = num(); row.xz2 = num(); row.wz1 = num(); row.wz2 = num();
          lc.trapezoid.push(row);
        });
        rows(count("point loads"), function () {
          lc.point.push({ elm: num(), Px: num(), Py: num(), Pz: num(), x: num() });
        });
        rows(count("temperature loads"), function () {
          lc.temperature.push({
            elm: num(), alpha: num(), hy: num(), hz: num(),
            Typ: num(), Tym: num(), Tzp: num(), Tzm: num()
          });
        });
        rows(count("prescribed displacements"), function () {
          lc.prescribed.push({
            node: num(), Dx: num(), Dy: num(), Dz: num(),
            Dxx: num(), Dyy: num(), Dzz: num()
          });
        });
        model.loadCases.push(lc);
      });

      /* dynamic / modal data */
      var nM = num();
      if (nM > 0) {
        var modal = {
          nM: nM,
          method: num(),
          lump: num(),
          tol: num(),
          shift: num(),
          exagg: num(),
          inertia: [],
          elemMass: [],
          animModes: [],
          pan: 0,
          condensation: null
        };
        rows(count("node inertia"), function () {
          modal.inertia.push({ node: num(), mass: num(), Ixx: num(), Iyy: num(), Izz: num() });
        });
        rows(count("element mass"), function () {
          modal.elemMass.push({ elm: num(), m: num() });
        });
        rows(count("animated modes"), function () { modal.animModes.push(num()); });
        if (more()) modal.pan = num();

        /* optional condensation block */
        if (more()) {
          var cond = { cmethod: num(), nodes: [], modes: [] };
          rows(count("condensed nodes"), function () {
            cond.nodes.push({
              node: num(), cx: num(), cy: num(), cz: num(),
              cxx: num(), cyy: num(), czz: num()
            });
          });
          while (more()) cond.modes.push(num());
          modal.condensation = cond;
        }
        model.modal = modal;
      }
    } catch (err) {
      warnings.push("Parse aborted: " + (err && err.message ? err.message : String(err)));
    }

    if (p < t.length) {
      warnings.push((t.length - p) + " trailing numeric token(s) were ignored.");
    }
    model.counts = {
      nodes: model.nodes.length,
      restraints: model.reactions.length,
      elements: model.elements.length,
      loadCases: model.loadCases.length,
      modes: model.modal ? model.modal.nM : 0
    };
    return { model: model, warnings: warnings };
  };
})();
