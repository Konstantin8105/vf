/* parserout.js - Frame3DD output parser.
   Handles the plain-text `.out` report (geometry echo + results + modal).

   Public API:
     App.parseOut(text)     -> { results, warnings }
     App.parseOutText(text) -> { results, warnings }
*/
(function () {
  "use strict";

  /* letter-spaced headers and quoted cells match after removing all
     whitespace and quotes, and uppercasing. */
  function norm(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/"/g, "").replace(/\s+/g, "").toUpperCase();
  }

  var KEYS = [
    "NODEDATA", "FRAMEELEMENTDATA", "NODEDISPLACEMENTS", "FRAMEELEMENTENDFORCES",
    "REACTIONS", "PEAKFRAMEELEMENTINTERNALFORCES", "RMSRELATIVEEQUILIBRIUMERROR",
    "NATURALFREQUENCIES", "NODALLOADS", "PRESCRIBEDDISPLACEMENT", "TEMPERATURECHANGES",
    "UNIFORMLOADS", "TRAPEZOIDALLOADS", "CONCENTRATEDPOINTLOADS", "LOADCASE",
    "ELASTICSTIFFNESS", "MODALANALYSIS", "MATRIXITERATIONS"
  ];

  function isSectionHeader(n) {
    for (var i = 0; i < KEYS.length; i++) if (n.indexOf(KEYS[i]) >= 0) return true;
    if (/^MODE\s*\d/.test(n)) return true;
    return false;
  }

  function isNumericRow(line) {
    var s = String(line === null || line === undefined ? "" : line).trim();
    if (!s) return false;
    var first = s.split(/\s+/)[0];
    return App.isNumToken(first) || /^[-+]?\.\d/.test(first);
  }

  /* numeric columns of a whitespace row; non-numeric tokens are skipped
     so rows like "<elm> max  <six forces>" reduce cleanly. */
  function numsOf(line) {
    var s = String(line).trim();
    if (!s) return [];
    var toks = s.split(/\s+/);
    var out = [];
    for (var i = 0; i < toks.length; i++) {
      var v = App.sanitizeNum(toks[i]);
      if (isFinite(v)) out.push(v);
    }
    return out;
  }

  /* advance past any non-numeric decoration lines (column headers, blanks),
     stopping at the next recognised section header. */
  function skipToData(lines, i) {
    while (i < lines.length && !isNumericRow(lines[i]) && !isSectionHeader(norm(lines[i]))) i++;
    return i;
  }

  function newResults() {
    return { loadCases: [], modes: [], geometryFromOut: null };
  }

  /* =================================================================== */
  /* plain-text .out                                                     */
  /* =================================================================== */
  App.parseOutText = function (text) {
    var warnings = [];
    var lines = String(text === null || text === undefined ? "" : text).split(/\r?\n/);
    var results = newResults();
    var geoNodes = [], geoEls = [];
    var cur = null, caseNo = 0;

    function newCase() {
      caseNo++;
      cur = { index: caseNo, displacements: [], endForces: [], reactions: [], peakForces: [], rms: null };
      results.loadCases.push(cur);
      return cur;
    }

    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var n = norm(line);

      if (n.indexOf("NODEDATA") >= 0) {
        i = skipToData(lines, i + 1);
        while (i < lines.length && isNumericRow(lines[i])) {
          var a = numsOf(lines[i]);
          if (a.length >= 5) {
            geoNodes.push({
              id: a[0], x: a[1], y: a[2], z: a[3], r: a[4],
              Rx: a.length > 5 ? a[5] : 0, Ry: a.length > 6 ? a[6] : 0,
              Rz: a.length > 7 ? a[7] : 0, Rxx: a.length > 8 ? a[8] : 0,
              Ryy: a.length > 9 ? a[9] : 0, Rzz: a.length > 10 ? a[10] : 0
            });
          }
          i++;
        }
        continue;
      }

      if (n.indexOf("FRAMEELEMENTDATA") >= 0) {
        i = skipToData(lines, i + 1);
        while (i < lines.length && isNumericRow(lines[i])) {
          var b = numsOf(lines[i]);
          if (b.length >= 3) {
            geoEls.push({
              id: b[0], n1: b[1], n2: b[2],
              Ax: b.length > 3 ? b[3] : null, Asy: b.length > 4 ? b[4] : null,
              Asz: b.length > 5 ? b[5] : null, Jxx: b.length > 6 ? b[6] : null,
              Iyy: b.length > 7 ? b[7] : null, Izz: b.length > 8 ? b[8] : null,
              E: b.length > 9 ? b[9] : null, G: b.length > 10 ? b[10] : null,
              roll: b.length > 11 ? b[11] : null, density: b.length > 12 ? b[12] : null
            });
          }
          i++;
        }
        continue;
      }

      if (n.indexOf("NODEDISPLACEMENTS") >= 0) {
        if (!cur || cur.displacements.length) newCase();
        i = skipToData(lines, i + 1);
        while (i < lines.length && isNumericRow(lines[i])) {
          var d = numsOf(lines[i]);
          if (d.length >= 7) cur.displacements.push({
            node: d[0], ux: d[1], uy: d[2], uz: d[3], rx: d[4], ry: d[5], rz: d[6]
          });
          i++;
        }
        continue;
      }

      if (n.indexOf("FRAMEELEMENTENDFORCES") >= 0) {
        if (!cur) newCase();
        i = skipToData(lines, i + 1);
        while (i < lines.length && isNumericRow(lines[i])) {
          var f = numsOf(lines[i]);
          if (f.length >= 8) cur.endForces.push({
            elm: f[0], node: f[1], nx: f[2], vy: f[3], vz: f[4], txx: f[5], myy: f[6], mzz: f[7]
          });
          i++;
        }
        continue;
      }

      if (n.indexOf("REACTIONS") >= 0) {
        if (!cur) newCase();
        i = skipToData(lines, i + 1);
        while (i < lines.length && isNumericRow(lines[i])) {
          var r = numsOf(lines[i]);
          if (r.length >= 7) cur.reactions.push({
            node: r[0], Fx: r[1], Fy: r[2], Fz: r[3], Mxx: r[4], Myy: r[5], Mzz: r[6]
          });
          i++;
        }
        continue;
      }

      if (n.indexOf("PEAKFRAMEELEMENTINTERNALFORCES") >= 0) {
        if (!cur) newCase();
        i = skipToData(lines, i + 1);
        while (i < lines.length && isNumericRow(lines[i])) {
          var which = /min/i.test(lines[i]) ? "min" : "max";
          var pk = numsOf(lines[i]);   /* [elm, Nx, Vy, Vz, Txx, Myy, Mzz] */
          if (pk.length >= 7) cur.peakForces.push({
            elm: pk[0], which: which,
            nx: pk[1], vy: pk[2], vz: pk[3], txx: pk[4], myy: pk[5], mzz: pk[6]
          });
          i++;
        }
        continue;
      }

      if (n.indexOf("RMSRELATIVEEQUILIBRIUMERROR") >= 0) {
        if (!cur) newCase();
        var colon = line.indexOf(":");
        cur.rms = colon >= 0 ? App.sanitizeNum(line.slice(colon + 1)) : null;
        i++;
        continue;
      }

      if (n.indexOf("NATURALFREQUENCIES") >= 0) {
        i++;
        /* skip "mass normalized mode shapes" and tolerance header lines */
        while (i < lines.length && !/^MODE\s*\d/.test(norm(lines[i]))) {
          if (isNumericRow(lines[i]) && /f=/i.test(lines[i])) break;
          i++;
        }
        while (i < lines.length) {
          var mn = norm(lines[i]);
          var fm = lines[i].match(/f=\s*([+\-0-9.eEdD]+)\s*Hz/i);
          if (/^MODE\s*\d/.test(mn) && fm) {
            var mode = {
              index: App.sanitizeNum((lines[i].match(/MODE\s*([0-9]+)/i) || [])[1]),
              freq: App.sanitizeNum(fm[1]),
              period: App.sanitizeNum((lines[i].match(/T=\s*([+\-0-9.eEdD]+)\s*sec/i) || [])[1]),
              partX: 0, partY: 0, partZ: 0, shapes: []
            };
            results.modes.push(mode);
            i++;
            while (i < lines.length && /MODALPARTICIPATIONFACTOR/.test(norm(lines[i]))) {
              var pm = lines[i].match(/=\s*([+\-0-9.eEdD]+)/);
              var val = pm ? App.sanitizeNum(pm[1]) : 0;
              var pn = norm(lines[i]);          /* e.g. X-MODALPARTICIPATIONFACTOR=... */
              if (pn.charAt(0) === "X") mode.partX = val;
              else if (pn.charAt(0) === "Y") mode.partY = val;
              else if (pn.charAt(0) === "Z") mode.partZ = val;
              i++;
            }
            while (i < lines.length && !isNumericRow(lines[i]) && !/^MODE\s*\d/.test(norm(lines[i]))) i++;
            while (i < lines.length && isNumericRow(lines[i])) {
              var s = numsOf(lines[i]);
              if (s.length >= 7) mode.shapes.push({
                node: s[0], ux: s[1], uy: s[2], uz: s[3], rx: s[4], ry: s[5], rz: s[6]
              });
              i++;
            }
            continue;
          }
          i++;
        }
        continue;
      }

      i++;
    }

    if (geoNodes.length || geoEls.length) {
      results.geometryFromOut = { nodes: geoNodes, elements: geoEls };
    }
    if (!results.loadCases.length && !results.modes.length && !geoNodes.length) {
      warnings.push("No Frame3DD result sections were recognised in this output file.");
    }
    return { results: results, warnings: warnings };
  };

  /* ---- public entry point ------------------------------------------- */
  App.parseOut = function (text) {
    return App.parseOutText(String(text === null || text === undefined ? "" : text));
  };
})();
