/* engine3d.js - minimal 3D viewer (orbit camera, painter's algorithm on 2D canvas).
   No external libraries. Scene is provided through a getter so the caller can
   rebuild geometry cheaply every animation frame.

   Scene object:
   {
     points: [{x,y,z,label,color,size}],
     lines:  [{a:{x,y,z}, b:{x,y,z}, color, label, width}],
     tris:   [{p:[{x,y,z},{x,y,z},{x,y,z}], color, fill, label}],
     quads:  [{p:[4 xyz], color, fill, label}],
     showAxes: bool, showGrid: bool, axesLen: number,
     show: {points:bool, pointLabels:bool, lines:bool, lineLabels:bool,
            faces:bool, faceLabels:bool, marks:bool}
   }
*/
"use strict";

/* ---- rectangle hit tests (AutoCAD window / crossing) ---------------- */
function rectHas(x, y, r) { return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1; }
function segRectHit(s, r) {
  if (rectHas(s.x1, s.y1, r) || rectHas(s.x2, s.y2, r)) return true;
  function o(px, py, qx, qy, rx, ry) { return (qy - py) * (rx - qx) - (qx - px) * (ry - qy); }
  function segSeg(a, b, c, d) {
    var o1 = o(a[0], a[1], b[0], b[1], c[0], c[1]);
    var o2 = o(a[0], a[1], b[0], b[1], d[0], d[1]);
    var o3 = o(c[0], c[1], d[0], d[1], a[0], a[1]);
    var o4 = o(c[0], c[1], d[0], d[1], b[0], b[1]);
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
  }
  var A = [s.x1, s.y1], B = [s.x2, s.y2];
  var C = [r.x0, r.y0], D = [r.x1, r.y0], E = [r.x1, r.y1], F = [r.x0, r.y1];
  return segSeg(A, B, C, D) || segSeg(A, B, D, E) || segSeg(A, B, E, F) || segSeg(A, B, F, C);
}

/* box selection. windowMode (left-to-right): only items fully inside;
   crossing (right-to-left): items that touch the rectangle. */
function hitRect(rect, windowMode, pts, segs) {
  var nodes = [], i;
  for (i = 0; i < (pts || []).length; i++) {
    var p = pts[i];
    if (p && rectHas(p.x, p.y, rect)) nodes.push(i);
  }
  var elems = [], seen = {};
  for (i = 0; i < (segs || []).length; i++) {
    var s = segs[i];
    if (!s || !s.pick) continue;
    var hit = windowMode ? (rectHas(s.x1, s.y1, rect) && rectHas(s.x2, s.y2, rect)) : segRectHit(s, rect);
    if (!hit) continue;
    var k = String(s.pick.elem);
    if (!seen[k]) { seen[k] = 1; elems.push(s.pick); }
  }
  return { nodes: nodes, elems: elems };
}

var THEME = App.colors;

/* free orbit rotation: yaw/pitch accumulate continuously with no clamp, so
   the model can be turned a full 360deg in any direction. The angles are
   wrapped by 2*pi only to keep them bounded; sin/cos are 2*pi-periodic, so
   the view stays perfectly continuous (no drag stop, no jump). */
function normAngle(a) { return ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI; }
function turntable(yaw, pitch, dx, dy) {
  return { yaw: normAngle(yaw + dx * 0.008), pitch: normAngle(pitch + dy * 0.008) };
}

function Engine3D(canvas, opts) {
  var self = this;
  this.cv = canvas;
  this.ctx = canvas.getContext("2d");
  this.opts = opts || {};
  /* local adaptations of the demo01 engine:
     - pan basis matches the projection plane exactly (cursor-following pan);
     - switchable perspective / orthographic projection via setProjection(). */
  this.getScene = this.opts.getScene || function () { return { points: [], lines: [], tris: [], quads: [] }; };

  this.cam = { yaw: -0.85, pitch: 0.55, dist: 120, tx: 0, ty: 0, tz: 0, f: 520 };
  this.axesLen = 10;  this.bounds = 20;
  this.axesScale = 1;  /* global-axes display size multiplier (Settings) */
  /* "persp" (default) or "ortho" - switchable through setProjection() */
  this.proj = this.opts.projection === "ortho" ? "ortho" : "persp";

  this.onPickPoint = null;   /* function(indexInScenePoints) */
  this.onPickElement = null; /* function(pickInfo) - a scene line carrying {pick} */
  this.onEmptyClick = null;
  this.onContextMenu = null; /* function(mouseEvent) - right click without drag */
  this.onBoxSelect = null;   /* function({nodes:[pointIdx], elems:[pickInfo]}) - left rubber band */
  this.hoverIndex = -1;
  this.pendingIndexes = [];  /* highlighted points (e.g. line pick mode) */
  this.selection = [];       /* selected point indexes */

  var drag = { on: false, btn: 0, x: 0, y: 0, moved: false, sx: 0, sy: 0,
               cx: 0, cy: 0, rect: null, dir: "window", add: false };
  var scr = [];              /* screen positions of points of last frame */
  var segScr = [];           /* projected line/segment endpoints of last frame
                                ([{x1,y1,x2,y2,pick}], parallel to scene.lines) */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  this.project = function (x, y, z) {
    var c = self.cam;
    var cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    var cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    var X = x - c.tx, Y = y - c.ty, Z = z - c.tz;
    var x1 = X * cy + Z * sy;
    var z1 = -X * sy + Z * cy;
    var y1 = Y * cp - z1 * sp;
    var z2 = Y * sp + z1 * cp;
    var d = c.dist - z2;
    if (d < 0.5) return null;
    /* perspective divides by depth; orthographic uses a constant scale
       set from the orbit distance so the apparent size is comparable. */
    var s = (self.proj === "ortho") ? (c.f / c.dist) : (c.f / d);
    return { x: canvas.width / 2 + x1 * s, y: canvas.height / 2 - y1 * s, d: d };
  };

  this.setProjection = function (mode) {
    self.proj = (mode === "ortho" || mode === "orthographic") ? "ortho" : "persp";
  };
  /* global-axes display size (multiplier around the fitted length) */
  this.setAxesScale = function (k) { self.axesScale = (Number(k) > 0) ? Number(k) : 1; };

  /* highlight a set of scene points (node selection) */
  this.setSelection = function (idx) {
    self.selection = Array.isArray(idx) ? idx.slice() : [];
  };

  /* cam basis (world) for panning.
     These are the exact inverse of project(): dragging with the mouse
     moves the model in the camera screen plane (right / up), so panning
     follows the cursor and is not skewed. */
  function basis() {
    var c = self.cam;
    var cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    var cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    return {
      right: [cy, 0, sy],
      up: [sy * sp, cp, -cy * sp]
    };
  }

  /* ---- interaction ---------------------------------------------- */
  /* Left button : pick a node, or rubber-band select several.
     Middle      : wheel zooms; press-and-drag pans in the view plane.
     Right       : press-and-drag rotates; a click without movement opens
                   the context menu (onContextMenu). */
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

  function canvasXY(e) {
    var r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  canvas.addEventListener("mousedown", function (e) {
    drag.on = true; drag.btn = e.button; drag.x = e.clientX; drag.y = e.clientY;
    drag.sx = e.clientX; drag.sy = e.clientY; drag.moved = false; drag.rect = null;
    drag.dir = "window";
    drag.add = !!(e.ctrlKey || e.metaKey);   /* remember Ctrl/Cmd at press time */
    var m = canvasXY(e); drag.cx = m.x; drag.cy = m.y;
    e.preventDefault();
  });

  window.addEventListener("mousemove", function (e) {
    if (drag.on) {
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 3) drag.moved = true;
      var pan = (drag.btn === 1) || (drag.btn === 0 && e.shiftKey);
      if (pan) {
        var b = basis();
        var k = self.cam.dist / self.cam.f;
        self.cam.tx -= dx * k * b.right[0];
        self.cam.ty -= dx * k * b.right[1];
        self.cam.tz -= dx * k * b.right[2];
        self.cam.tx += dy * k * b.up[0];
        self.cam.ty += dy * k * b.up[1];
        self.cam.tz += dy * k * b.up[2];
      } else if (drag.btn === 2) {
        /* full 360deg turntable rotation (see turntable()) */
        var rot = turntable(self.cam.yaw, self.cam.pitch, dx, dy);
        self.cam.yaw = rot.yaw;
        self.cam.pitch = rot.pitch;
      } else if (drag.btn === 0 && drag.moved) {
        var m = canvasXY(e);
        drag.rect = {
          x0: Math.min(drag.cx, m.x), y0: Math.min(drag.cy, m.y),
          x1: Math.max(drag.cx, m.x), y1: Math.max(drag.cy, m.y)
        };
        /* AutoCAD rule: left-to-right = window (fully inside),
           right-to-left = crossing (touch counts) */
        drag.dir = (m.x >= drag.cx) ? "window" : "crossing";
      }
    } else if (self._inside) {
      var idx = pick(e);
      if (idx !== self.hoverIndex) { self.hoverIndex = idx; canvas.style.cursor = idx >= 0 ? "pointer" : "default"; }
    }
  });

  canvas.addEventListener("mouseenter", function () { self._inside = true; });
  canvas.addEventListener("mouseleave", function () { self._inside = false; self.hoverIndex = -1; });

  window.addEventListener("mouseup", function (e) {
    if (!drag.on) return;
    drag.on = false;
    var btn = drag.btn, moved = drag.moved, rect = drag.rect;
    drag.rect = null;
    if (btn === 2) {
      if (!moved && self.onContextMenu) self.onContextMenu(e);
    } else if (btn === 0) {
      if (!moved) {
        var m = canvasXY(e);
        var idx = pickAt(m);
        if (idx >= 0 && self.onPickPoint) self.onPickPoint(idx);
        else {
          var pe = pickLineAt(m);
          if (pe && self.onPickElement) self.onPickElement(pe);
          else if (self.onEmptyClick) self.onEmptyClick();
        }
      } else if (rect) {
        var windowMode = drag.dir !== "crossing";
        var res = hitRect(rect, windowMode, scr, segScr);
        var additive = !!(drag.add || e.ctrlKey || e.metaKey);
        self.selection = res.nodes;
        if (self.onBoxSelect) self.onBoxSelect({ nodes: res.nodes, elems: res.elems, window: windowMode, additive: additive });
      }
    }
  });

  canvas.addEventListener("wheel", function (e) {
    self.cam.dist *= (e.deltaY > 0 ? 1.12 : 0.89);
    self.cam.dist = clamp(self.cam.dist, 0.05, 1e6);
    e.preventDefault();
  }, { passive: false });

  function pickAt(m) {
    var best = -1, bd = 10 * 10;
    for (var i = 0; i < scr.length; i++) {
      if (!scr[i]) continue;
      var dx = scr[i].x - m.x, dy = scr[i].y - m.y;
      var d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = i; }
    }
    return best;
  }
  function pick(e) { return pickAt(canvasXY(e)); }

  /* distance^2 from point (px,py) to segment (x1,y1)-(x2,y2) */
  function dist2seg(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var qx = x1 + t * dx, qy = y1 + t * dy;
    var ex = px - qx, ey = py - qy;
    return ex * ex + ey * ey;
  }
  /* nearest pickable scene line within ~6 px; returns its pick info */
  function pickLineAt(m) {
    var best = null, bd = 6 * 6;
    for (var k = 0; k < segScr.length; k++) {
      var s = segScr[k];
      if (!s || !s.pick) continue;
      var d2 = dist2seg(m.x, m.y, s.x1, s.y1, s.x2, s.y2);
      if (d2 < bd) { bd = d2; best = s.pick; }
    }
    return best;
  }
  /* ---- views ---------------------------------------------------- */
  /* camera angles are chosen so the camera sits on the requested scene
     axis: "view+x" looks at the model from +X, etc. */
  this.setView = function (name) {
    var v = String(name || "").toLowerCase();
    if (v === "view+x" || v === "+x" || v === "x+") { self.cam.yaw = -1.5708; self.cam.pitch = 0; }
    else if (v === "view-x" || v === "-x" || v === "x-") { self.cam.yaw = 1.5708; self.cam.pitch = 0; }
    else if (v === "view+y" || v === "+y" || v === "y+" || v === "top") { self.cam.yaw = 0; self.cam.pitch = 1.52; }
    else if (v === "view-y" || v === "-y" || v === "y-") { self.cam.yaw = 0; self.cam.pitch = -1.52; }
    else if (v === "view+z" || v === "+z" || v === "z+" || v === "front") { self.cam.yaw = 0; self.cam.pitch = 0; }
    else if (v === "view-z" || v === "-z" || v === "z-") { self.cam.yaw = Math.PI; self.cam.pitch = 0; }
    else if (v === "side") { self.cam.yaw = 1.5708; self.cam.pitch = 0; }
    else if (v === "iso" || v === "isometric") { self.cam.yaw = -0.85; self.cam.pitch = 0.55; }
  };

  this.fit = function (scene) {
    scene = scene || self.getScene();
    var pts = scene.points || [];
    if (!pts.length) { self.cam.dist = 60; self.cam.tx = self.cam.ty = self.cam.tz = 0; self.bounds = 20; return; }
    var x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
      if (p.z < z0) z0 = p.z; if (p.z > z1) z1 = p.z;
    }
    var dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
    self.bounds = Math.max(dx, dy, dz, 1e-6);
    self.cam.tx = (x0 + x1) / 2; self.cam.ty = (y0 + y1) / 2; self.cam.tz = (z0 + z1) / 2;
    self.axesLen = self.bounds * 0.35;
    self.cam.dist = self.bounds * 2.2;

    /* points plus axis ends take part in framing */
    var L = self.axesLen;
    var probe = pts.slice();
    var ad = scene.axes || { x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 } };
    probe.push({ x: 0, y: 0, z: 0 },
      { x: L * ad.x.x, y: L * ad.x.y, z: L * ad.x.z },
      { x: L * ad.y.x, y: L * ad.y.y, z: L * ad.y.z },
      { x: L * ad.z.x, y: L * ad.z.y, z: L * ad.z.z });

    /* project with f = 1 and return the screen bbox */
    function measure() {
      var sf = self.cam.f;
      self.cam.f = 1;
      var a0 = Infinity, b0 = Infinity, a1 = -Infinity, b1 = -Infinity, ok = false;
      for (var j = 0; j < probe.length; j++) {
        var q = self.project(probe[j].x, probe[j].y, probe[j].z);
        if (!q) continue;
        ok = true;
        if (q.x < a0) a0 = q.x; if (q.x > a1) a1 = q.x;
        if (q.y < b0) b0 = q.y; if (q.y > b1) b1 = q.y;
      }
      self.cam.f = sf;
      return ok ? { w: a1 - a0, h: b1 - b0, cx: (a0 + a1) / 2, cy: (b0 + b1) / 2, ok: true } : { ok: false };
    }

    function center() {
      var b = measure();
      if (!b.ok) return;
      var z = self.cam.dist;
      /* measure() runs at f = 1: world offset = screenOffset * z / f_used;
         screenOffset at real f equals (b.cx - W/2) * f, so the f cancels */
      var dxr = (b.cx - canvas.width / 2) * z;
      var dyr = (b.cy - canvas.height / 2) * z;
      var bs = basis();
      self.cam.tx += bs.right[0] * dxr;
      self.cam.ty += bs.right[1] * dxr;
      self.cam.tz += bs.right[2] * dxr;
      self.cam.tx -= bs.up[0] * dyr;
      self.cam.ty -= bs.up[1] * dyr;
      self.cam.tz -= bs.up[2] * dyr;
    }

    for (var pass = 0; pass < 2; pass++) {
      var b = measure();
      if (b.ok && b.w > 1e-9 && b.h > 1e-9) {
        self.cam.f = 0.84 * Math.min(canvas.width / b.w, canvas.height / b.h);
      } else {
        self.cam.f = Math.min(canvas.width, canvas.height) * 0.9;
      }
      center();
      center();
    }
  };

  /* ---- rendering ------------------------------------------------ */
  function colorOf(c, fallback) { return c || fallback; }

  function poly(pts2, fill, stroke, lw) {
    if (pts2.length < 2) return;
    var ctx = self.ctx;
    ctx.beginPath();
    ctx.moveTo(pts2[0].x, pts2[0].y);
    for (var i = 1; i < pts2.length; i++) ctx.lineTo(pts2[i].x, pts2[i].y);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  function hexA(hex, a) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.substr(0, 2), 16), g = parseInt(h.substr(2, 2), 16), b = parseInt(h.substr(4, 2), 16);
    return "rgba(" + r + "," + g + "," + b + "," + a + ")";
  }

  function drawAxes(scene) {
    var L = (self.axesLen || 10) * (self.axesScale > 0 ? self.axesScale : 1);
    var o = self.project(0, 0, 0);
    if (!o) return;
    /* scene.axes holds the model X/Y/Z directions after the orientation map,
       so the gizmo labels always match the reported global displacements */
    var d = (scene && scene.axes) || {
      x: { x: 1, y: 0, z: 0 }, y: { x: 0, y: 1, z: 0 }, z: { x: 0, y: 0, z: 1 }
    };
    var ax = [
      { p: self.project(L * d.x.x, L * d.x.y, L * d.x.z), c: THEME.axis.x, t: "X" },
      { p: self.project(L * d.y.x, L * d.y.y, L * d.y.z), c: THEME.axis.y, t: "Y" },
      { p: self.project(L * d.z.x, L * d.z.y, L * d.z.z), c: THEME.axis.z, t: "Z" }
    ];
    var ctx = self.ctx;
    ctx.save();
    ctx.lineWidth = 2; ctx.font = "bold 12px Segoe UI, Arial";
    for (var i = 0; i < ax.length; i++) {
      if (!ax[i].p) continue;
      ctx.strokeStyle = ax[i].c;
      ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(ax[i].p.x, ax[i].p.y); ctx.stroke();
      ctx.fillStyle = ax[i].c;
      ctx.fillText(ax[i].t, ax[i].p.x + 4, ax[i].p.y - 2);
    }
    ctx.restore();
  }

  function drawGrid() {
    var L = self.axesLen * 2 || 20;
    var n = 10;
    var ctx = self.ctx;
    ctx.save();
    ctx.strokeStyle = THEME.grid; ctx.lineWidth = 1;
    for (var i = 0; i <= n; i++) {
      var t = -L + (2 * L) * i / n;
      var a1 = self.project(t, 0, -L), a2 = self.project(t, 0, L);
      if (a1 && a2) { ctx.beginPath(); ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke(); }
      var b1 = self.project(-L, 0, t), b2 = self.project(L, 0, t);
      if (b1 && b2) { ctx.beginPath(); ctx.moveTo(b1.x, b1.y); ctx.lineTo(b2.x, b2.y); ctx.stroke(); }
    }
    ctx.restore();
  }

  function avgDepth(ps) {
    var s = 0, n = 0;
    for (var i = 0; i < ps.length; i++) if (ps[i]) { s += ps[i].d; n++; }
    return n ? s / n : 1e9;
  }

  this.render = function () {
    var ctx = self.ctx;
    var scene = self.getScene();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = THEME.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    var show = scene.show || {};
    if (scene.showGrid) drawGrid();

    /* project points once */
    var P = scene.points || [];
    scr = [];
    for (var i = 0; i < P.length; i++) scr.push(self.project(P[i].x, P[i].y, P[i].z));

    /* collect drawable items with depth */
    var items = [];
    var j;

    if (show.faces !== false) {
      var Q = scene.quads || [];
      for (j = 0; j < Q.length; j++) {
        var q = Q[j];
        var sp = [];
        for (var k = 0; k < q.p.length; k++) sp.push(self.project(q.p[k].x, q.p[k].y, q.p[k].z));
        if (sp.indexOf(null) >= 0) continue;
        items.push({ t: "f", z: avgDepth(sp), pts: sp, color: q.color, fill: q.fill, label: q.label });
      }
      var T = scene.tris || [];
      for (j = 0; j < T.length; j++) {
        var tr = T[j];
        var st = [];
        for (var k2 = 0; k2 < tr.p.length; k2++) st.push(self.project(tr.p[k2].x, tr.p[k2].y, tr.p[k2].z));
        if (st.indexOf(null) >= 0) continue;
        items.push({ t: "f", z: avgDepth(st), pts: st, color: tr.color, fill: tr.fill, label: tr.label });
      }
    }
    if (show.lines !== false) {
      var Ln = scene.lines || [];
      segScr = [];
      for (j = 0; j < Ln.length; j++) {
        var l = Ln[j];
        var s1 = self.project(l.a.x, l.a.y, l.a.z), s2 = self.project(l.b.x, l.b.y, l.b.z);
        if (!s1 || !s2) { segScr.push(null); continue; }
        segScr.push({ x1: s1.x, y1: s1.y, x2: s2.x, y2: s2.y, pick: l.pick || null });
        items.push({ t: "l", z: (s1.d + s2.d) / 2, pts: [s1, s2], color: l.color, width: l.width, label: l.label, overlay: !!l.overlay });
      }
    } else {
      segScr = [];
    }
    /* painter: far -> near; load annotations are overlays drawn on top */
    items.sort(function (a, b) {
      var ao = a.overlay ? 1 : 0, bo = b.overlay ? 1 : 0;
      if (ao !== bo) return ao - bo;
      return b.z - a.z;
    });

    ctx.lineJoin = "round";
    for (j = 0; j < items.length; j++) {
      var it = items[j];
      if (it.t === "f") {
        poly(it.pts, hexA(colorOf(it.color, THEME.faceFill), it.fill === undefined ? 0.22 : it.fill),
          hexA(colorOf(it.color, THEME.faceStroke), 0.75), 1);
      } else {
        ctx.strokeStyle = colorOf(it.color, THEME.lineDefault);
        ctx.lineWidth = it.width || 1.4;
        ctx.beginPath(); ctx.moveTo(it.pts[0].x, it.pts[0].y); ctx.lineTo(it.pts[1].x, it.pts[1].y); ctx.stroke();
      }
    }

    /* labels of faces/lines */
    ctx.font = "11px Segoe UI, Arial";
    for (j = 0; j < items.length; j++) {
      var it2 = items[j];
      var showLbl = (it2.t === "f") ? show.faceLabels : show.lineLabels;
      if (!showLbl || !it2.label) continue;
      var cx = 0, cy = 0;
      for (var m = 0; m < it2.pts.length; m++) { cx += it2.pts[m].x; cy += it2.pts[m].y; }
      cx /= it2.pts.length; cy /= it2.pts.length;
      ctx.fillStyle = THEME.lineLabelBg;
      var wdt = ctx.measureText(it2.label).width;
      ctx.fillRect(cx - 2, cy - 12, wdt + 4, 14);
      ctx.fillStyle = THEME.lineLabelText;
      ctx.fillText(it2.label, cx, cy - 2);
    }

    /* points last */
    if (show.points !== false) {
      for (i = 0; i < scr.length; i++) {
        if (!scr[i]) continue;
        var p = P[i];
        var isHov = (i === self.hoverIndex);
        var isPend = self.pendingIndexes.indexOf(i) >= 0;
        var isSel = self.selection.indexOf(i) >= 0;
        var r = (p.size || 3.2) + (isHov ? 1.6 : 0) + (isSel ? 1.2 : 0);
        ctx.beginPath();
        ctx.arc(scr[i].x, scr[i].y, r, 0, Math.PI * 2);
        ctx.fillStyle = isSel ? THEME.selection : (isPend ? THEME.pending : (isHov ? THEME.hover : colorOf(p.color, THEME.pointDefault)));
        ctx.fill();
        if (isSel) { ctx.strokeStyle = THEME.selectionOutline; ctx.lineWidth = 1.6; ctx.stroke(); }
        else if (isPend || isHov) { ctx.strokeStyle = THEME.pointOutline; ctx.lineWidth = 1.5; ctx.stroke(); }
        if (show.pointLabels && p.label) {
          ctx.fillStyle = THEME.pointLabelBg;
          var t = String(p.label);
          var w2 = ctx.measureText(t).width;
          ctx.fillRect(scr[i].x + 5, scr[i].y - 14, w2 + 4, 13);
          ctx.fillStyle = THEME.pointLabelText;
          ctx.fillText(t, scr[i].x + 7, scr[i].y - 4);
        }
      }
    }

    /* rubber-band selection rectangle: solid blue = window (fully inside),
       dashed green = crossing (touch counts) */
    if (drag.on && drag.rect) {
      var win = drag.dir !== "crossing";
      ctx.save();
      ctx.strokeStyle = win ? THEME.rubberBand.window : THEME.rubberBand.crossing;
      ctx.fillStyle = win ? THEME.rubberBand.windowFill : THEME.rubberBand.crossingFill;
      ctx.lineWidth = 1;
      if (ctx.setLineDash) ctx.setLineDash(win ? [] : [5, 3]);
      ctx.fillRect(drag.rect.x0, drag.rect.y0, drag.rect.x1 - drag.rect.x0, drag.rect.y1 - drag.rect.y0);
      ctx.strokeRect(drag.rect.x0 + 0.5, drag.rect.y0 + 0.5,
        drag.rect.x1 - drag.rect.x0 - 1, drag.rect.y1 - drag.rect.y0 - 1);
      if (ctx.setLineDash) ctx.setLineDash([]);
      ctx.restore();
    }

    if (scene.showAxes) drawAxes(scene);

    /* informational badge stack (e.g. solver stiffness options) */
    var badges = scene.badges || [];
    if (badges.length) {
      ctx.save();
      ctx.font = "11.5px Segoe UI, Arial";
      var pad = 6, lh = 15, wmax = 0;
      for (var bi = 0; bi < badges.length; bi++) wmax = Math.max(wmax, ctx.measureText(badges[bi]).width);
      var bw = wmax + pad * 2, bh = badges.length * lh + pad * 2 - 2;
      ctx.fillStyle = THEME.badge.bg;
      ctx.strokeStyle = THEME.badge.border;
      ctx.lineWidth = 1;
      ctx.fillRect(8.5, 8.5, bw, bh);
      ctx.strokeRect(8.5, 8.5, bw, bh);
      ctx.fillStyle = THEME.badge.text;
      for (bi = 0; bi < badges.length; bi++) ctx.fillText(badges[bi], 8 + pad, 8 + pad + 11 + bi * lh);
      ctx.restore();
    }
  };

  /* resize handling: keep apparent model size on screen */
  this.resize = function (wpx, hpx) {
    var oldW = canvas.width || 0;
    var w = Math.max(200, Math.floor(wpx)), h = Math.max(160, Math.floor(hpx));
    canvas.width = w;
    canvas.height = h;
    if (oldW > 0 && oldW !== w) self.cam.f *= w / oldW;
  };

  var running = false;
  this.start = function () {
    if (running) return;
    running = true;
    (function loop() { self.render(); requestAnimationFrame(loop); })();
  };
}

App.Engine3D = Engine3D;
App.hitRect = hitRect;
App.turntable = turntable;
