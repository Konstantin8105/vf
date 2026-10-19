/* theme.js - single source of truth for the viewer's canvas/scene colours.
   Loaded right after util.js (which creates the App namespace) and before
   engine3d.js / viewer.js. Change colours only here.

   The UI chrome (panels, menus, tables) is themed with the CSS custom
   properties in the :root block of style.css; these values mirror that
   palette for the colours the drawing code needs in JS. */
(function () {
  "use strict";

  App.colors = {
    /* scene: points and elements */
    pointDefault: "#2b3440",
    pointGhost: "#c3ccd6",
    pointOutline: "#ffffff",
    pointLabelBg: "rgba(255,255,255,0.85)",
    pointLabelText: "#1f3a5f",
    elementDeformed: "#2f6fb8",
    elementUndeformed: "#b4bfcb",
    elementStatic: "#55616e",
    elementGhost: "#c3ccd6",
    lineDefault: "#55616e",
    faceFill: "#8fa8c4",
    faceStroke: "#7d97b5",
    lineLabelBg: "rgba(255,255,255,0.8)",
    lineLabelText: "#7a4a12",

    /* selection / hover */
    selection: "#d9822b",
    selectionOutline: "#1f3a5f",
    hover: "#2f6fb8",
    pending: "#e0a020",

    /* supports and member decorations */
    support: { x: "#d9534f", y: "#3f8f3a", z: "#3a6fb0" },
    fixedBlock: "#4a5a6a",
    hinge: "#7d3c98",
    prescribed: "#1f7a7a",
    inertia: "#802392",
    condensation: "#b0407f",
    localAxis: { x: "#d9534f", y: "#3f8f3a", z: "#3a6fb0" },
    principalAxis: "#e6a700",

    /* loads */
    load: "#e07b00",          /* nodal forces (orange) */
    moment: "#9c5b00",        /* nodal moments */
    uniformLoad: "#29a3d1",   /* uniformly distributed (light blue) */
    trapezoidLoad: "#7e57c2", /* trapezoidal distributed (violet) */
    pointLoad: "#c2185b",     /* interior point loads (magenta) */
    gravityLoad: "#5a6b7a",   /* self-weight (grey) */

    /* force diagrams */
    diagram: { positive: "#d9534f", negative: "#3a6fb0" },

    /* diverging value scale: min (negative) blue, zero green, max (positive) red */
    scale: { min: "#1f6fb2", mid: "#2e9b3f", max: "#d0342c" },

    /* measurement tool */
    measure: "#d81b60",

    /* canvas chrome */
    background: "#ffffff",
    grid: "#e3e9f0",
    axis: { x: "#d9534f", y: "#3f8f3a", z: "#3a6fb0" },
    rubberBand: {
      window: "#2f6fb8", crossing: "#2e8b57",
      windowFill: "rgba(47,111,184,0.12)", crossingFill: "rgba(46,139,87,0.14)"
    },
    badge: { bg: "rgba(255,255,255,0.88)", border: "#c3ccd6", text: "#3c4a59" },

    /* categorical palette (material / section groups, ...) */
    palette: ["#2f6fb8", "#d9534f", "#3f8f3a", "#e6a700", "#7d3c98", "#0f9b9b",
      "#c0632a", "#5a6b7a", "#b0407f", "#802392", "#8a6d3b", "#1f6fb2"]
  };
})();
