/* test/app.test.js - full application flow through the stubbed DOM:
   file drops, auto-attach, menus, selection, visibility commands, reload
   semantics and the combined-animation controls. */
"use strict";
const fs = require("fs");
const H = require("./harness");
const { App, document, getEl, textOf, window } = H.loadApp();
const { ok, done } = H.makeReporter();
const ex = (n) => H.readExample(n);
const path = require("path");

/* capture the last scene the app built */
let lastScene = null;
const origBuild = App.buildScene;
App.buildScene = function (s) { lastScene = origBuild(s); return lastScene; };

let fails = 0;

/* in Preprocessing the results-only UI is hidden entirely */
try {
  const bar = getEl("menubar");
  const titles = bar.children.map(textOf).join("|");
  ok(titles.indexOf("Results") < 0, "Results menu hidden in Preprocessing");
  const disp0 = openTopMenu("Display");
  const labels = disp0.children.map(textOf).join("|");
  ok(labels.indexOf("Deformed shape") < 0, "Deformed shape hidden in Preprocessing");
  ok(labels.indexOf("Force diagrams") < 0, "Force diagrams hidden in Preprocessing");
  ok(labels.indexOf("Undeformed shape") >= 0, "Undeformed shape available in Preprocessing");
  ok(labels.indexOf("Color by (model)") >= 0, "Display offers model-based colouring in Preprocessing");
  ok(labels.indexOf("Load case") < 0, "Display no longer has a Load case submenu (top-bar list instead)");
} catch (e) { ok(false, "mode gating threw: " + e.message); }

/* View menu uses explicit axis views */
try {
  const vd = openTopMenu("View");
  const labels = vd.children.map(textOf).join("|");
  ["View +X", "View -X", "View +Y", "View -Y", "View +Z", "View -Z", "Isometric"].forEach(function (l) {
    ok(labels.indexOf(l) >= 0, "View menu has '" + l + "'");
  });
  const all = vd.children.length;
  ok(labels.indexOf("Front") < 0 && labels.indexOf("Side") < 0 && labels.indexOf("Top") < 0,
    "old Front/Side/Top labels removed (" + all + " items)");
  ok(labels.indexOf("Orientation") < 0 && labels.indexOf("Y up") < 0 && labels.indexOf("Z up") < 0,
    "no manual orientation choice (auto from the input geometry)");
  ok(labels.indexOf("Selection & visibility") >= 0, "View menu holds Selection & visibility (both modes)");
} catch (e) { ok(false, "View menu threw: " + e.message); }

const f1 = { name: "exB.3dd", _text: ex("exB.3dd") };
const f2 = { name: "exB.out", _text: ex("exB.out") };
try {
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [f1, f2] } });
  ok(true, "drop of input+output did not throw");
} catch (e) { ok(false, "drop threw: " + e.stack.split("\n").slice(0, 3).join(" | ")); }

ok(getEl("tb-nodes").children.length > 0, "Nodes table populated");
ok(getEl("tb-elements").children.length > 0, "Elements table populated");
ok(getEl("tb-loads").children.length >= 6, "Load Cases tab has blocks");
ok(getEl("tb-disp").children.length > 0, "Displacements table populated");
ok(getEl("tb-modes").children.length > 0, "Modes table populated");
ok(getEl("tb-shapes").children.length > 0, "Mode shape table populated");
ok(getEl("multi-mode").children.length > 0, "Modes tab multi-mode controls built");
ok(getEl("fileinfo").textContent.indexOf("exB.3dd") >= 0 && getEl("fileinfo").textContent.indexOf("exB.out") >= 0,
  "File info shows both names");

/* the top-bar combobox lists static cases and the modal input view in Pre */
try {
  const opts = caseModeLabels();
  ok(opts.indexOf("Static Case 1") >= 0 && opts.indexOf("Static Case 3") >= 0,
    "Pre combobox lists every static case (" + opts.join(" | ") + ")");
  ok(opts.indexOf("Modal analysis (6 modes)") >= 0, "Pre combobox offers the modal analysis view");
  ok(!opts.some(t => /^Mode 1\b/.test(t)), "Pre combobox has no result modes");

  setCaseMode("modal");
  ok(getEl("case-mode").value === "modal", "combobox selects the modal input view");
  ok(lastScene && !lastScene.lines.some(l => l.color === "#e07b00"), "modal input view hides static load arrows");
  ok(lastScene && lastScene.lines.some(l => l.color === "#802392"), "modal input view draws node mass markers");
  const loadsText = textOf(getEl("tb-loads"));
  ok(/Modal analysis parameters/.test(loadsText) && /Node masses and inertia/.test(loadsText) &&
    /Element extra mass/.test(loadsText) && /Animated modes/.test(loadsText),
    "Load cases tab shows the modal input tables");
  ok(loadBlockRows("Animated modes") === -1, "the Animated modes list is not rendered");
  ok(/Modal analysis/.test(textOf(getEl("legend"))), "legend reports the modal input view");

  const dispL = openTopMenu("Display");
  const lsubL = submenu(dispL, "Loads");
  const lsubText = lsubL.children.map(textOf).join("|");
  ok(lsubText.indexOf("Node masses / inertia") >= 0 && lsubText.indexOf("Element extra mass") >= 0 &&
    lsubText.indexOf("Condensation nodes") >= 0, "Display > Loads offers the modal marker toggles");

  setCaseMode("c:1");
  ok(lastScene && lastScene.lines.some(l => l.color === "#e07b00"), "returning to a static case draws the loads again");
} catch (e) { ok(false, "modal input combobox threw: " + e.message); }

/* results are shown only in Postprocessing */
function toPost() { getEl("mode-post").dispatch("click", { stopPropagation() {} }); }
toPost();

/* in Post the combobox lists static cases, result modes and Combined */
try {
  const opts = caseModeLabels();
  ok(opts.some(t => /^Mode 1 \(/.test(t)), "Post combobox lists result modes (" + opts.join(" | ") + ")");
  ok(opts.indexOf("Combined (multi-mode)") >= 0, "Post combobox offers the combined animation");
  ok(!opts.some(t => /Modal analysis/.test(t)), "Post combobox has no modal input view");
  ok(opts.indexOf("Static Case 1") >= 0, "Post combobox still lists the static cases");
  setCaseMode("m:1");
  ok(getEl("case-mode").value === "m:1", "combobox selects Mode 1 in Post");
  setCaseMode("c:1");
} catch (e) { ok(false, "Post combobox threw: " + e.message); }

/* deformation via the app path (auto scale) */
try {
  const modelB = App.parse3dd(ex("exB.3dd")).model;
  let moved = 0;
  for (let i = 0; i < lastScene.points.length && i < modelB.nodes.length; i++) {
    const n = modelB.nodes[i];
    if (Math.abs(lastScene.points[i].x - n.x) > 1e-6 || Math.abs(lastScene.points[i].y - n.z) > 1e-6) moved++;
  }
  ok(moved > 0, "app scene shows deformation (auto scale)");
} catch (e) { ok(false, "deformation check threw: " + e.message); }

/* element lines carry pick info (T1) */
ok(lastScene.lines.some(l => l.pick && l.pick.elem !== undefined), "element lines carry element pick info");

/* selecting a node/element highlights the matching result rows */
function tbRows(host) {
  const w = getEl(host);
  return (w.children[0] && w.children[0].children[0] && w.children[0].children[0].children[1])
    ? w.children[0].children[0].children[1].children : [];
}
try {
  tbRows("tb-nodes")[0].dispatch("click");           /* select node 1 */
  ok(tbRows("tb-disp").some(r => String(r.className).indexOf("sel") >= 0), "selected node highlights its Displacements row");
  ok(tbRows("tb-ef").some(r => String(r.className).indexOf("sel") >= 0), "selected node highlights End Forces rows");
  tbRows("tb-elements")[0].dispatch("click");        /* select the element group */
  ok(tbRows("tb-ef").filter(r => String(r.className).indexOf("sel") >= 0).length >= 2, "selected element highlights its End Forces rows");
  ok(tbRows("tb-disp").some(r => String(r.className).indexOf("sel") >= 0), "selected element highlights its node rows in Displacements");
  document.dispatch("keydown", { key: "Escape" });   /* clear selection for the next checks */
} catch (e) { ok(false, "table highlight threw: " + e.message); }

/* Colour by -> Nx via the Results menu */
function openTopMenu(label) {
  const bar = getEl("menubar");
  const btn = bar.children.filter(c => textOf(c) === label)[0];
  btn.dispatch("click", { stopPropagation() {} });
  return document.body.children[document.body.children.length - 1];
}
function submenu(box, label) {
  const host = box.children.filter(c => textOf(c).indexOf(label) >= 0 &&
    (c.children || []).some(x => (x.getAttribute && (x.getAttribute("class") || "")) === "msub"))[0];
  return host ? host.children.filter(x => (x.getAttribute && (x.getAttribute("class") || "")) === "msub")[0] : null;
}
function leaf(host, label) {
  return host.children.filter(c => textOf(c).indexOf(label) >= 0)[0];
}
/* drive the top-bar load case / mode combobox (the DOM stub has no native
   <select> semantics, so set the value and dispatch "change" by hand) */
function setCaseMode(value) {
  const sel = getEl("case-mode");
  sel.value = value;
  sel.dispatch("change");
}
function caseModeLabels() {
  return (getEl("case-mode").children || []).map(o => o.textContent);
}
/* number of table rows in the Load cases block whose title starts with `title`
   (-1 when the block is missing, 0 when it shows the empty message) */
function loadBlockRows(title) {
  const host = getEl("tb-loads");
  for (const sec of host.children || []) {
    if (!sec.children || !sec.children.length) continue;
    if (textOf(sec.children[0]).indexOf(title) !== 0) continue;
    const wrap = sec.children[1];
    const table = wrap && wrap.children[0] && wrap.children[0].children[0];
    if (!table || !table.children[1]) return 0;
    return table.children[1].children.length;
  }
  return -1;
}
try {
  /* switch to Postprocessing (results are loaded, so the mode button is enabled) */
  getEl("mode-post").dispatch("click", { stopPropagation() {} });
  ok(getEl("menubar").children.map(textOf).join("|").indexOf("Results") >= 0, "Results menu appears in Postprocessing");
  const dispP = openTopMenu("Display");
  ok(dispP.children.map(textOf).join("|").indexOf("Deformed shape") >= 0, "Deformed shape appears in Postprocessing");
  ok(dispP.children.map(textOf).join("|").indexOf("Load case") < 0, "Display no longer has a Load case submenu");
  const lsubP = submenu(dispP, "Loads");
  const lsubPText = lsubP.children.map(textOf).join("|");
  ok(lsubPText.indexOf("Node masses / inertia") >= 0 && lsubPText.indexOf("Condensation nodes") >= 0,
    "Display > Loads lists the modal marker toggles like every other load category");
  const dtLeafP = leaf(lsubP, "Colour members by \u0394T");
  ok(dtLeafP && /\u2713/.test(dtLeafP.children.map(textOf).join("")),
    "Colour members by \u0394T is enabled by default");
  ok(lastScene && !lastScene.lines.some(l => l.color === "#802392"),
    "static Postprocessing view hides the modal input markers");
  leaf(lsubP, "All loads").dispatch("click", { stopPropagation() {} });
  const dispOff = openTopMenu("Display");
  const lsubOff = submenu(dispOff, "Loads");
  const nodalOff = leaf(lsubOff, "Nodal forces");
  ok(nodalOff && !/\u2713/.test(nodalOff.children.map(textOf).join("")),
    "turning All loads off also unchecks the load categories");
  const dtOff = leaf(lsubOff, "Colour members by \u0394T");
  ok(dtOff && !/\u2713/.test(dtOff.children.map(textOf).join("")),
    "turning All loads off also unchecks Colour members by \u0394T");
  ok(lastScene && !lastScene.lines.some(l => l.color === "#e07b00"),
    "turning All loads off hides the static load arrows");
  leaf(lsubOff, "All loads").dispatch("click", { stopPropagation() {} });
  ok(lastScene && lastScene.lines.some(l => l.color === "#e07b00"),
    "turning All loads back on restores the load arrows");
  const dispOn = openTopMenu("Display");
  const dtOn = leaf(submenu(dispOn, "Loads"), "Colour members by \u0394T");
  ok(dtOn && /\u2713/.test(dtOn.children.map(textOf).join("")),
    "turning All loads back on re-checks Colour members by \u0394T");
  setCaseMode("m:1");
  ok(lastScene && lastScene.lines.some(l => l.color === "#802392"),
    "a Postprocessing mode view draws the modal input markers");
  document.dispatch("mousedown", { target: getEl("cv") });
  const dispM1 = openTopMenu("Display");
  const lsubM1 = submenu(dispM1, "Loads");
  ok(lsubM1.children.map(textOf).join("|").indexOf("Node masses / inertia") >= 0,
    "Display > Loads offers the modal toggles in a mode view");
  setCaseMode("c:1");
  const rdP = openTopMenu("Results");
  ok(rdP.children.map(textOf).join("|").indexOf("Mode") < 0, "Results no longer has a Mode submenu");
  ok(rdP.children.map(textOf).join("|").indexOf("Selection & visibility") < 0, "Results menu no longer has Selection & visibility");
  const dispQ = openTopMenu("Display");
  ok(dispQ.children.map(textOf).join("|").indexOf("Force diagrams") < 0 && dispQ.children.map(textOf).join("|").indexOf("Diagram kind") < 0,
    "Display has no diagram controls (they live in Results)");
  const rd = openTopMenu("Results");
  const csub = submenu(rd, "Color by");
  leaf(csub, "Nx").dispatch("click", { stopPropagation() {} });
  const colored = lastScene.lines.filter(l => typeof l.color === "string" && l.color.indexOf("rgb(") === 0);
  ok(!!lastScene.legend && colored.length > 0, "colour mapping produces a legend and coloured elements");
  ok(csub.children.map(textOf).join("|").indexOf("Material") < 0 && csub.children.map(textOf).join("|").indexOf("Support") < 0,
    "Results color-by has no model-based modes");
  const csubLabels = csub.children.map(textOf).join("|");
  ok(csubLabels.indexOf("dispX") >= 0 && csubLabels.indexOf("dispY") >= 0 && csubLabels.indexOf("dispZ") >= 0,
    "Results color-by has dispX/dispY/dispZ");
  const rdD = openTopMenu("Results");
  leaf(submenu(rdD, "Color by"), "dispX").dispatch("click", { stopPropagation() {} });
  ok(!!lastScene.legend && /dispX/.test(lastScene.legend.label), "dispX colouring works");

  /* Display > Color by (model) works with the model alone */
  const dispM = openTopMenu("Display");
  const mcsub = submenu(dispM, "Color by (model)");
  ok(!!mcsub, "Display has a Color by (model) submenu");
  ok(mcsub.children.map(textOf).join("|").indexOf("Temperature change") < 0,
    "Color by (model) no longer offers Temperature change (it lives in Loads > Colour by \u0394T)");
  if (mcsub) leaf(mcsub, "Support type").dispatch("click", { stopPropagation() {} });
  ok(!!lastScene.legend, "model-based colouring (Support type) works without results");
  const dispM2 = openTopMenu("Display");
  leaf(submenu(dispM2, "Color by (model)"), "none").dispatch("click", { stopPropagation() {} });

  /* Diagrams and Color by are mutually exclusive in the Static view */
  const rd2 = openTopMenu("Results");
  const dsub = submenu(rd2, "Diagrams");
  leaf(dsub, "Show force diagrams").dispatch("click", { stopPropagation() {} });
  ok(lastScene.lines.some(l => l.color === "#d9534f" || l.color === "#3a6fb0") && lastScene.legend === null,
    "enabling force diagrams turns colouring off (mutually exclusive)");
  const rdC = openTopMenu("Results");
  leaf(submenu(rdC, "Color by"), "Nx").dispatch("click", { stopPropagation() {} });
  ok(!!lastScene.legend, "selecting a Color by mode turns diagrams off");

  /* picking a Diagram Kind turns the colouring off and switches diagrams on */
  const rdK = openTopMenu("Results");
  leaf(submenu(submenu(rdK, "Diagrams"), "Kind"), "Mzz").dispatch("click", { stopPropagation() {} });
  ok(lastScene.legend === null, "picking a diagram Kind clears the colour mapping");
  ok(lastScene.lines.some(l => l.color === "#d9534f" || l.color === "#3a6fb0"),
    "picking a diagram Kind turns the force diagrams on");

  /* In Modes: Color by / Diagrams disabled, Play animation enabled; the
     load-case colouring set in Static is cleared */
  const rdN = openTopMenu("Results");
  leaf(submenu(rdN, "Color by"), "Nx").dispatch("click", { stopPropagation() {} });
  ok(!!lastScene.legend, "Nx colouring active in Static");
  setCaseMode("m:1");
  ok(lastScene.legend === null, "load-case colouring is cleared when a mode is selected");
  ok(getEl("speed-ctl").style.display !== "none", "Speed control appears for a displayed mode");
  const rd4 = openTopMenu("Results");
  const byLabel = t => rd4.children.filter(c => textOf(c).indexOf(t) >= 0)[0];
  ok(byLabel("Color by") && byLabel("Color by").classList.contains("disabled"), "Color by disabled in Modes");
  ok(byLabel("Diagrams") && byLabel("Diagrams").classList.contains("disabled"), "Diagrams disabled in Modes");
  ok(getEl("play-btn") && getEl("play-btn").textContent === "\u23F9" && !getEl("play-btn").disabled,
    "toolbar Play/Stop reads Stop while a mode animates");
  /* back to Static via the combobox: the toolbar button stays enabled and
     reads Play (the static deformation can be animated) */
  setCaseMode("c:1");
  ok(getEl("speed-ctl").style.display !== "none", "Speed control visible in Static (Postprocessing)");
  ok(getEl("play-btn") && getEl("play-btn").textContent === "\u25B6" && !getEl("play-btn").disabled,
    "toolbar Play/Stop enabled for a static case");
  /* the toolbar button animates the static deformation ("breathing") */
  getEl("play-btn").dispatch("click", { stopPropagation() {} });
  ok(getEl("play-btn").textContent === "\u23F9" && /Animating static deformation/.test(getEl("status").textContent),
    "toolbar Play/Stop starts the static deformation animation");
  getEl("play-btn").dispatch("click", { stopPropagation() {} });
  ok(getEl("play-btn").textContent === "\u25B6" && /Static deformation shown/.test(getEl("status").textContent),
    "toolbar Play/Stop stops the static deformation animation");

  /* Loads submenu off-toggle via Display > Loads */
  const disp = openTopMenu("Display");
  const lsub = submenu(disp, "Loads");
  leaf(lsub, "Uniform (distributed)").dispatch("click", { stopPropagation() {} });
  /* exB case1 has no uniform loads, so just assert no throw and the menu closed */
  ok(true, "Display > Loads submenu toggles without error");

  /* Measure menu activates distance/angle modes */
  const mm1 = openTopMenu("Measure");
  leaf(mm1, "Distance (2 points)").dispatch("click", { stopPropagation() {} });
  ok(/Measure distance/i.test(getEl("status").textContent), "Measure > Distance activates distance mode");
  const mm2 = openTopMenu("Measure");
  leaf(mm2, "Angle (3 points").dispatch("click", { stopPropagation() {} });
  ok(/Measure angle/i.test(getEl("status").textContent), "Measure > Angle activates angle mode");
  document.dispatch("keydown", { key: "Escape" });
  ok(!/Measure/i.test(getEl("status").textContent), "Escape clears the measurement");
  /* Display > Settings opens the size dialog */
  const dispS = openTopMenu("Display");
  leaf(dispS, "Settings").dispatch("click", { stopPropagation() {} });
  const modal = document.body.children.filter(c => c.getAttribute && String(c.getAttribute("class") || "").indexOf("modal-backdrop") >= 0)[0];
  ok(!!modal, "Settings dialog opens");
  if (modal) {
    function inputsIn(el, out) { out = out || []; (el.children || []).forEach(c => { if (c.tagName === "INPUT") out.push(c); inputsIn(c, out); }); return out; }
    const ins = inputsIn(modal);
    ok(ins.length === 5, "Settings has 5 size inputs (" + ins.length + ")");
    ins[0].value = "2"; ins[0].dispatch("input");
    ok(true, "changing a size input does not throw");
    document.dispatch("keydown", { key: "Escape" });
    ok(modal.style.display === "none", "Esc closes the Settings dialog");
  }

  /* Clicking Help in the menu bar opens the help dialog directly */
  const helpBtn = getEl("menubar").children.filter(c => textOf(c) === "Help")[0];
  ok(!!helpBtn, "Help menu button present");
  helpBtn.dispatch("click", { stopPropagation() {} });
  const modals = document.body.children.filter(c => c.getAttribute && String(c.getAttribute("class") || "").indexOf("modal-backdrop") >= 0);
  const help = modals[modals.length - 1];
  ok(!!help && help.style.display === "flex", "Clicking Help opens the help dialog (no dropdown)");
  ok(/Menu: File/.test(getEl("status").textContent) === false, "help text is no longer dumped into the status line");
  function findText(el, re, out) { out = out || []; (el.children || []).forEach(c => { if (re.test(textOf(c))) out.push(textOf(c)); findText(c, re, out); }); return out; }
  const navLabels = findText(help, /^(File|View|Display|Results|Mouse & keyboard)$/);
  ok(navLabels.length >= 4, "Help dialog has per-menu topics (" + navLabels.length + ")");
  ok(/Load model/.test(textOf(help)), "Help dialog shows the getting-started content");
  function findBtn(el, label) {
    let r = null;
    (el.children || []).forEach(c => {
      if (!r && c.tagName === "BUTTON" && textOf(c) === label) r = c;
      if (!r) r = findBtn(c, label);
    });
    return r;
  }
  const mouseBtn = findBtn(help, "Mouse & keyboard");
  ok(!!mouseBtn, "Help has a Mouse & keyboard topic");
  if (mouseBtn) {
    mouseBtn.dispatch("click", { stopPropagation() {} });
    ok(/box-select/.test(textOf(help)) && /Esc:/.test(textOf(help)), "Help mouse topic holds the full mouse/keyboard text");
  }
  document.dispatch("keydown", { key: "Escape" });
  ok(help.style.display === "none", "Esc closes the Help dialog");
} catch (e) { ok(false, "colour/menu threw: " + e.message); }

/* reloading a 2D model alone replaces the pair */
document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [{ name: "exA.3dd", _text: ex("exA.3dd") }] } });
ok(getEl("fileinfo").textContent.indexOf("12 nodes") >= 0, "after exA.3dd: 12 nodes shown");

/* CSV files are no longer supported */
document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [{ name: "exA_out.CSV", _text: ex("exA_out.CSV") }] } });
ok(getEl("fileinfo").textContent.indexOf("exA_out.CSV") < 0, "CSV output is not attached");
ok(/CSV files are not supported/.test(getEl("errbar").textContent), "CSV drop is rejected with a message");

/* exA has no modal block: no Modal analysis entry, one Static entry per case */
try {
  const opts = caseModeLabels();
  ok(opts.indexOf("Static Case 1") >= 0 && opts.indexOf("Static Case 2") >= 0,
    "combobox offers one Static entry per load case (" + opts.join(" | ") + ")");
  ok(!opts.some(t => /Modal analysis/.test(t)), "exA has no Modal analysis entry (no modal block)");
  setCaseMode("c:2");
  ok(getEl("case-mode").value === "c:2", "combobox selects Static Case 2");
  ok(!!lastScene && lastScene.points.length > 0, "scene rebuilt for Static Case 2 without error");
} catch (e) { ok(false, "per-case combobox entries threw: " + e.message); }

/* ---- selection + visibility via menus (T1/T2) ---- */
try {
  const wrap = getEl("tb-nodes").children[0];
  const row = wrap.children[0].children[1].children[1];
  row.dispatch("click");
  ok(lastScene.points.filter(p => p.color === "#d9822b" && p.size > 6).length === 1, "node row click highlights one node");
  /* a left click on empty space deselects everything (engine + app state) */
  getEl("cv").dispatch("mousedown", { button: 0, clientX: 40, clientY: 30, preventDefault() {} });
  window.dispatch("mouseup", { button: 0, clientX: 40, clientY: 30, preventDefault() {} });
  ok(lastScene.points.filter(p => p.color === "#d9822b").length === 0, "clicking empty space clears the selection");
  row.dispatch("click");
  document.dispatch("keydown", { key: "Escape" });
  ok(lastScene.points.filter(p => p.color === "#d9822b").length === 0, "Esc clears the selection");
  row.dispatch("click");   /* re-select, then isolate that node */
  const dd = openTopMenu("View");
  const sel = submenu(dd, "Selection & visibility");
  leaf(sel, "Show only selected").dispatch("click", { stopPropagation() {} });
  ok(lastScene.points.length === 1, "isolate leaves a single visible node (" + lastScene.points.length + ")");
  /* reload the same model: visibility must persist (camera not reset) */
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [{ name: "exA.3dd", _text: ex("exA.3dd") }] } });
  ok(lastScene.points.length === 1, "visibility persists across reload (still " + lastScene.points.length + " node)");
} catch (e) { ok(false, "selection/visibility menu threw: " + e.message); }

/* changed model -> results detached */
try {
  const modified = ex("exA.3dd").replace("1\t0.0\t0.0\t0.0", "1\t5.0\t0.0\t0.0");
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [{ name: "exA.3dd", _text: modified }] } });
  const fi = getEl("fileinfo").textContent;
  const err = getEl("errbar").textContent;
  ok(fi.indexOf("out: \u2014") >= 0 || fi.indexOf("out: â€”") >= 0, "changed model detaches results (" + fi + ")");
  ok(/Input changed/i.test(err), "input-change warning shown");
} catch (e) { ok(false, "changed-model reload threw: " + e.message); }

/* folder drop: pair .3dd with .out by name; CSV entries are ignored */
function fileEntry(name, text) { return { isFile: true, isDirectory: false, file(cb) { cb({ name, _text: text }); } }; }
function dirEntry(children) {
  return { isDirectory: true, isFile: false, createReader() { let d = false; return { readEntries(cb) { if (!d) { d = true; cb(children); } else cb([]); } }; } };
}
try {
  const folder = dirEntry([
    fileEntry("exA.3dd", ex("exA.3dd")), fileEntry("exA.out", ex("exA.out")), fileEntry("exA_out.CSV", ex("exA_out.CSV"))
  ]);
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { items: [{ webkitGetAsEntry: () => folder }], files: [] } });
  const fi = getEl("fileinfo").textContent;
  ok(fi.indexOf("exA.3dd") >= 0 && fi.indexOf("exA.out") >= 0 && fi.indexOf("exA_out.CSV") < 0,
    "folder drop pairs the .3dd with its .out and ignores CSV");
} catch (e) { ok(false, "folder drop threw: " + e.message); }

/* mismatched results are rejected */
try {
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { items: [], files: [{ name: "exB.out", _text: ex("exB.out") }] } });
  const fi = getEl("fileinfo").textContent;
  ok(fi.indexOf("exA.out") >= 0 && fi.indexOf("exB.out") < 0, "wrong results not attached");
  ok(/rejected/.test(getEl("errbar").textContent), "mismatch reported");
} catch (e) { ok(false, "mismatch check threw: " + e.message); }

/* combined animation control hides static loads */
try {
  const f = { name: "exB.3dd", _text: ex("exB.3dd") };
  const fo = { name: "exB.out", _text: ex("exB.out") };
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [f, fo] } });
  toPost();
  function findAll(el, pred, out) {
    out = out || [];
    (el.children || []).forEach(c => { if (pred(c)) out.push(c); findAll(c, pred, out); });
    return out;
  }
  const btns = findAll(getEl("multi-mode"), c => c.tagName === "BUTTON");
  ok(!btns.some(b => /combined/i.test(textOf(b))),
    "Modes tab no longer has a separate combined start/stop button (" + btns.map(textOf).join("|") + ")");

  /* the combobox enters the combined view; the toolbar Play/Stop controls it */
  setCaseMode("combined");
  ok(/[Cc]ombined/.test(getEl("status").textContent), "status reports combined animation");
  ok(!lastScene.lines.some(l => l.color === "#e07b00"), "combined view hides static load arrows");
  ok(getEl("play-btn") && getEl("play-btn").textContent === "\u23F9" && !getEl("play-btn").disabled,
    "toolbar Play/Stop reads Stop while the combined view animates");
  getEl("play-btn").dispatch("click", { stopPropagation() {} });
  ok(!lastScene.lines.some(l => l.color === "#e07b00"), "stopping combined keeps the combined view (no static loads)");
  ok(/frozen|stopped/i.test(getEl("status").textContent), "status says combined is stopped/frozen");
  ok(getEl("play-btn").textContent === "\u25B6", "toolbar Play/Stop becomes Play to resume");
  getEl("play-btn").dispatch("click", { stopPropagation() {} });
  ok(/Animating combined/i.test(getEl("status").textContent), "toolbar Play/Stop resumes the combined animation");
  /* Speed field (toolbar): wheel x/1.1, never negative; visible for modes */
  const speedInp = getEl("num-speed");
  ok(!!speedInp, "speed field present");
  ok(getEl("speed-ctl").style.display !== "none", "Speed control is shown while a mode/combined is active");
  if (speedInp) {
    speedInp.value = "1"; speedInp.dispatch("input");
    speedInp.dispatch("wheel", { deltaY: -100, preventDefault() {} });
    ok(Math.abs(parseFloat(speedInp.value) - 1.1) < 1e-9, "wheel up multiplies speed by 1.1 (" + speedInp.value + ")");
    speedInp.dispatch("wheel", { deltaY: 100, preventDefault() {} });
    ok(Math.abs(parseFloat(speedInp.value) - 1) < 1e-9, "wheel down divides speed by 1.1 (" + speedInp.value + ")");
    speedInp.value = "-3"; speedInp.dispatch("change");
    ok(parseFloat(speedInp.value) > 0, "negative speed rejected (" + speedInp.value + ")");
  }
  ok(!findAll(getEl("multi-mode"), c => c.tagName === "INPUT" && c.id === "num-speed").length,
    "Speed is no longer in the Modes results table");

  /* per-mode weight fields: non-negative, wheel x1.1 */
  const wInp = findAll(getEl("multi-mode"), c => c.tagName === "INPUT" && c.id === "weight-1")[0];
  ok(!!wInp, "per-mode weight field present");
  if (wInp) {
    wInp.value = "-5"; wInp.dispatch("change");
    ok(parseFloat(wInp.value) >= 0, "mode weight rejects negative values (" + wInp.value + ")");
    wInp.value = "2"; wInp.dispatch("wheel", { deltaY: -100, preventDefault() {} });
    ok(Math.abs(parseFloat(wInp.value) - 2.2) < 1e-9, "mode weight wheel multiplies by 1.1 (" + wInp.value + ")");
    /* unchecking the mode disables the field but keeps its value */
    const cb1 = wInp.parentNode.children[0];
    const keep = wInp.value;
    cb1.checked = false; cb1.dispatch("change");
    const wOff = findAll(getEl("multi-mode"), c => c.tagName === "INPUT" && c.id === "weight-1")[0];
    ok(!!wOff && wOff.disabled, "unchecked mode has a disabled amplitude field");
    ok(!!wOff && wOff.value === keep, "unchecked mode keeps its amplitude value (" + (wOff && wOff.value) + ")");
    if (wOff) {
      const cb2 = wOff.parentNode.children[0];
      cb2.checked = true; cb2.dispatch("change");
      const wOn = findAll(getEl("multi-mode"), c => c.tagName === "INPUT" && c.id === "weight-1")[0];
      ok(!!wOn && !wOn.disabled && wOn.value === keep, "re-enabled mode restores the value and becomes editable");
    }
  }
  /* leaving combined explicitly: the combobox Static Case 1 restores the static view */
  setCaseMode("c:1");
  ok(lastScene.lines.some(l => l.color === "#e07b00"), "static loads return after choosing Static Case 1");
} catch (e) { ok(false, "combined control threw: " + e.message); }

/* Deformation scale is a plain number field (no slider) */
try {
  getEl("num-scale").value = "1";
  getEl("num-scale").dispatch("input");
  getEl("num-scale").dispatch("wheel", { deltaY: -100, preventDefault() {} });
  ok(Math.abs(parseFloat(getEl("num-scale").value) - 1.1) < 1e-9, "wheel up multiplies the scale by 1.1 (" + getEl("num-scale").value + ")");
  getEl("num-scale").dispatch("wheel", { deltaY: 100, preventDefault() {} });
  ok(Math.abs(parseFloat(getEl("num-scale").value) - 1) < 1e-9, "wheel down divides the scale by 1.1 (" + getEl("num-scale").value + ")");
  getEl("num-scale").value = "-5";
  getEl("num-scale").dispatch("change");
  ok(parseFloat(getEl("num-scale").value) > 0, "negative scale is rejected (" + getEl("num-scale").value + ")");
} catch (e) { ok(false, "scale field threw: " + e.message); }

/* regression: switching models resets visibility filters and auto scale */
try {
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [{ name: "exG.3dd", _text: ex("exG.3dd") }, { name: "exG.out", _text: ex("exG.out") }] } });
  const ddg0 = openTopMenu("View");
  leaf(submenu(ddg0, "Selection & visibility"), "Clear selection").dispatch("click", { stopPropagation() {} });
  const wrapG = getEl("tb-nodes").children[0];
  wrapG.children[0].children[1].children[1].dispatch("click");
  const ddg = openTopMenu("View");
  leaf(submenu(ddg, "Selection & visibility"), "Show only selected").dispatch("click", { stopPropagation() {} });
  ok(lastScene.points.length === 1, "isolating a node on exG shows one point");
  const scaleG = getEl("num-scale").value;
  ok((function (v) { v = parseFloat(v); return v >= 0.01 ? Math.abs(Math.round(v * 100) / 100 - v) < 1e-9 : true; })(scaleG),
    "auto deformation scale has at most 2 decimals (" + scaleG + ")");
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [{ name: "exA.3dd", _text: ex("exA.3dd") }, { name: "exA.out", _text: ex("exA.out") }] } });
  ok(lastScene.points.length === 12, "switching models clears previous visibility filters (" + lastScene.points.length + " points)");
  ok(getEl("num-scale").value !== scaleG, "switching models recomputes the deformation scale (" + scaleG + " -> " + getEl("num-scale").value + ")");
  const elRows = getEl("tb-elements").children[0].children[0].children[1].children;
  ok(elRows.length === 1, "exA identical elements grouped into one row (" + elRows.length + ")");
  const reRows = getEl("tb-restraints").children[0].children[0].children[1].children;
  ok(reRows.length === 4, "exA supports grouped by flag pattern into 4 rows (" + reRows.length + ")");
  ok(loadBlockRows("Nodal loads") === 2, "exA nodal loads are grouped by value into 2 rows (" +
    loadBlockRows("Nodal loads") + ")");
  const loadHeaders = textOf(getEl("tb-loads"));
  [
    "Nodal loads (grouped by value)",
    "Uniform element loads (local) \u2014 grouped by value",
    "Trapezoidal loads (local; grouped by value)",
    "Interior point loads (local; grouped by value)",
    "Temperature loads (local; grouped by value)",
    "Prescribed displacements (grouped by value)"
  ].forEach(function (title) {
    ok(loadHeaders.indexOf(title) >= 0, "load table is grouped: " + title);
  });
} catch (e) { ok(false, "model-switch regression threw: " + e.message); }

/* results without an input model are rejected with a dialog */
try {
  const fd = openTopMenu("File");
  leaf(fd, "Clear all").dispatch("click", { stopPropagation() {} });
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [{ name: "exA.out", _text: ex("exA.out") }] } });
  ok(/model/i.test(getEl("errbar").textContent), "loading results without a model shows an error dialog (" + getEl("errbar").textContent + ")");
  ok(getEl("fileinfo").textContent.indexOf("exA.out") < 0, "results were not attached without a model");
} catch (e) { ok(false, "no-model results check threw: " + e.message); }

/* model-only: model-based colouring works without results */
try {
  document.dispatch("drop", { preventDefault() {}, dataTransfer: { files: [{ name: "exH.3dd", _text: ex("exH.3dd") }] } });
  const dm = openTopMenu("Display");
  leaf(submenu(dm, "Color by (model)"), "Material / section groups").dispatch("click", { stopPropagation() {} });
  ok(!!lastScene.legend && /material\/section group/.test(lastScene.legend.label),
    "Material colouring works with the model alone (no results)");
} catch (e) { ok(false, "model-only colour threw: " + e.message); }

/* auto-discovery by relative URL */
global.fetch = function (url) {
  const m = String(url).match(/frame3dd\/examples\/(exD\.out)$/);
  if (m) return Promise.resolve({ ok: true, text: () => Promise.resolve(ex(m[1])) });
  return Promise.reject(new Error("404 " + url));
};
(async () => {
  try {
    document.dispatch("drop", { preventDefault() {}, dataTransfer: { items: [], files: [{ name: "exD.3dd", _text: ex("exD.3dd") }] } });
    await new Promise(r => setTimeout(r, 30));
    ok(getEl("fileinfo").textContent.indexOf("exD.out") >= 0, "model alone auto-fetches exD.out by name");
    ok(/auto-attached/.test(getEl("status").textContent), "status reports auto-attach");
  } catch (e) { ok(false, "auto-fetch threw: " + e.message); }

  /* the modal input view must not leak from one model to the next: exH has a
     modal block, exC too, but loading exC must show its static uniform loads */
  try {
    document.dispatch("drop", { preventDefault() {}, dataTransfer: { items: [], files: [{ name: "exH.3dd", _text: ex("exH.3dd") }] } });
    ok(caseModeLabels().some(t => /Modal analysis/.test(t)), "exH offers the modal analysis view");
    setCaseMode("modal");
    ok(getEl("case-mode").value === "modal", "exH modal view selected");
    const loadsH = textOf(getEl("tb-loads"));
    ok(/Element extra mass \(grouped by value\)/.test(loadsH),
      "exH element extra masses are grouped by value");
    ok(loadsH.indexOf("0.026") >= 0 && loadsH.indexOf("163") >= 0,
      "the grouped extra-mass row shows the mass and the element count");
    document.dispatch("drop", { preventDefault() {}, dataTransfer: { items: [], files: [{ name: "exC.3dd", _text: ex("exC.3dd") }] } });
    ok(getEl("case-mode").value === "c:1", "loading a new model returns to Static Case 1");
    ok(loadBlockRows("Uniform element loads") === 1,
      "exC uniform loads are grouped into one row (" + loadBlockRows("Uniform element loads") + ")");
    ok(lastScene && lastScene.lines.some(l => l.color === App.colors.uniformLoad),
      "static loads (exC uniform) are visible right after loading the new model");
  } catch (e) { ok(false, "modal-view reset on model load threw: " + e.message); }

  /* node masses/inertia and condensation nodes are grouped by value too */
  try {
    document.dispatch("drop", { preventDefault() {}, dataTransfer: { items: [], files: [{ name: "exF.3dd", _text: ex("exF.3dd") }] } });
    ok(loadBlockRows("Nodal loads") === 2, "exF nodal loads are grouped by value into 2 rows (" +
      loadBlockRows("Nodal loads") + ")");
    setCaseMode("modal");
    const loadsF = textOf(getEl("tb-loads"));
    ok(/Node masses and inertia \(grouped by value\)/.test(loadsF),
      "exF node masses/inertia are grouped by value");
    ok(/Condensation nodes \(grouped by value\)/.test(loadsF),
      "exF condensation nodes are grouped by value");
    ok(loadsF.indexOf("6, 19, 26, 33") >= 0,
      "four identical node masses collapse into one grouped row");
    ok(/Modes to match/.test(loadsF), "the condensation modes list is still shown");
  } catch (e) { ok(false, "grouped node mass/condensation tables threw: " + e.message); }

  /* File > Load model always drops the attached results, even for the same model */
  try {
    document.dispatch("drop", { preventDefault() {}, dataTransfer: { items: [], files: [
      { name: "exB.3dd", _text: ex("exB.3dd") }, { name: "exB.out", _text: ex("exB.out") }
    ] } });
    ok(getEl("fileinfo").textContent.indexOf("out: exB.out") >= 0, "results attached before the explicit model load");
    const nRows = getEl("tb-nodes").children[0].children[0].children[1].children;
    nRows[0].dispatch("click");
    ok(lastScene && lastScene.points.some(p => p.color === App.colors.selection),
      "a node is selected before Load model");
    const fi = getEl("file-input");
    fi.files = [{ name: "exB.3dd", _text: ex("exB.3dd") }];
    fi.dispatch("change");
    ok(!lastScene.points.some(p => p.color === App.colors.selection),
      "Load model deselects all nodes and elements");
    ok(getEl("fileinfo").textContent.indexOf("out: \u2014") >= 0,
      "Load model clears the output file even when the model is the same");
    ok(/without results/i.test(getEl("status").textContent),
      "status tells the user to attach results explicitly");
    ok(getEl("case-mode").value === "c:1", "the model is shown in its Static Case 1");
  } catch (e) { ok(false, "explicit Load model clearing threw: " + e.message); }

  /* static HTML wiring */
  try {
    const html = fs.readFileSync(path.join(H.base, "index.html"), "utf8");
    const tabs = [...html.matchAll(/class="tabbtn[^"]*"\s+data-tab="([^"]+)"\s+data-mode="([^"]+)"/g)];
    ok(tabs.length >= 11, "tab buttons carry data-mode (" + tabs.length + ")");
    const paneIds = new Set([...html.matchAll(/class="pane[^"]*"\s+id="([^"]+)"/g)].map(m => m[1]));
    ok(tabs.every(t => paneIds.has(t[1])), "every tab maps to a pane");
    ok(/id="multi-mode"/.test(html), "index.html has the multi-mode host");
    ok(/id="num-scale"/.test(html) && !/id="rng-scale"/.test(html), "Deformation scale is a number field, no slider");
    ok(/id="speed-ctl"/.test(html) && /id="num-speed"/.test(html), "Speed control is in the toolbar");
    ok(/id="play-btn"/.test(html) && /class="playbtn"/.test(html), "index.html has the toolbar Play/Stop button");
    ok(/class="modebtn"[^>]*data-mode="post"/.test(html), "index.html marks the Postprocessing mode button");
    ok(/data-needs="results"/.test(html), "result tabs carry data-needs=\"results\"");
    ok(/js\/viewer\.js/.test(html) && /js\/app\.js/.test(html), "all scripts referenced");
    ok(/js\/theme\.js/.test(html), "theme.js is loaded");
    ok(/id="case-mode"/.test(html) && /<select[^>]*id="case-mode"/.test(html),
      "index.html has the top-bar load case / mode combobox");
    const css = fs.readFileSync(path.join(H.base, "style.css"), "utf8");
    ok(/\.scale-ctl input\[type=number\]\s*\{[^}]*width:9ch/.test(css),
      "Deformation scale / Speed fields are half as wide (9ch)");
    ok(/select\.casemode/.test(css), "style.css styles the combobox");
  } catch (e) { ok(false, "static HTML check threw: " + e.message); }

  process.exit(done() ? 1 : 0);
})();






