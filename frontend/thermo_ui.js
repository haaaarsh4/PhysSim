/**
 * frontend/thermo_ui.js - the two rails of the Thermo workbench.
 *
 * Same furniture as the dynamics workbench (frontend/ui.js): panel titles, rail
 * sections, slider rows, segmented pickers, toggle switches, readouts. The
 * difference is what the rows say, and how little they say: a label and a
 * measurement. Explanations live in the lab cards and in the tooltips, where
 * they can be read on purpose instead of walked past. Two rows earn a second
 * line - the temperature against the bath setting it, and the compressibility
 * against the 1.000 of an ideal gas - because the comparison *is* the reading.
 *
 * Nothing in here computes physics. The histogram, the ledger and the P-V trace
 * are drawings of arrays that simulation/gas.js produced, and the readouts are
 * the key names from `box.observe()`.
 */
import {
  SPECIES, speciesOf, moleculeMass, rmsSpeedOf, meanSpeedOf, mostProbableSpeed,
} from "../simulation/gas.js";

/* The word the app uses for the moving face. The simulation calls it a lid
 * everywhere, and so does the panel, because "piston" is a word a student meets
 * in a textbook and "lid" is a word they already have. */
export const LID = "Lid";

function el(tag, className = "", html = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== null) node.innerHTML = html;
  return node;
}

function slider({ label, min, max, step, value, format, onInput }) {
  const wrap = el("div", "ctrl");
  const row = el("div", "ctrl-row");
  const lab = el("span", "ctrl-label", label);
  const val = el("span", "ctrl-val tab-nums", format(value));
  row.append(lab, val);
  const input = el("input");
  input.type = "range";
  input.setAttribute("aria-label", label);
  input.min = min; input.max = max; input.step = step; input.value = value;
  input.addEventListener("input", () => {
    const v = Number(input.value);
    val.textContent = format(v);
    onInput(v);
  });
  wrap.append(row, input);
  return {
    wrap, input,
    setValue(v) { input.value = v; val.textContent = format(Number(v)); },
    /* A control that cannot do anything right now says so by looking like it:
       a slider whose subject is switched off is still a live drag that quietly
       changes nothing, which is the one thing a control must never be. */
    setDisabled(on) { input.disabled = !!on; wrap.classList.toggle("is-disabled", !!on); },
  };
}

function readout(label) {
  const row = el("div", "readout");
  row.appendChild(el("span", "rn", label));
  const value = el("span", "rv tab-nums", "...");
  row.appendChild(value);
  return { row, value };
}

/** A readout that may carry one short comparison underneath it. */
function measured(label, note) {
  const row = el("div", "readout stacked");
  const head = el("div", "readout-head");
  /* The name is handed back as well as set, because one row here is about a
     species rather than about a fixed quantity - the mixture lab is a row per
     gas, and which gas a row is about is only known once the box exists. */
  const name = el("span", "rn", label);
  head.appendChild(name);
  const value = el("span", "rv tab-nums", "...");
  head.appendChild(value);
  const theory = el("div", "readout-sub", note ?? "");
  row.append(head, theory);
  return { row, label: name, value, theory };
}

function segmented(label, options, initial, onPick) {
  const wrap = el("div", "ctrl");
  if (label) wrap.appendChild(el("div", "ctrl-label", label));
  const bar = el("div", "seg");
  const buttons = new Map();
  /* An option is [key, text] or [key, text, title]. The title is what a picker
     of glyphs needs: a symbol is what the eye chooses by, and the word is what
     confirms the choice without widening the row. */
  for (const [key, text, title] of options) {
    const button = el("button", key === initial ? "on" : "", text);
    button.type = "button";
    if (title) { button.title = title; button.setAttribute("aria-label", title); }
    button.addEventListener("click", () => {
      for (const b of buttons.values()) b.classList.remove("on");
      button.classList.add("on");
      onPick(key);
    });
    buttons.set(key, button);
    bar.appendChild(button);
  }
  wrap.appendChild(bar);
  return {
    wrap,
    pick(key) {
      for (const [k, b] of buttons) b.classList.toggle("on", k === key);
    },
  };
}

function toggle(label, initial, onChange) {
  const row = el("div", "toggle-row");
  row.appendChild(el("span", "ctrl-label", label));
  const sw = el("button", `tswitch${initial ? " on" : ""}`, "<i></i>");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-checked", String(!!initial));
  sw.addEventListener("click", () => {
    const next = !sw.classList.contains("on");
    sw.classList.toggle("on", next);
    sw.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  row.appendChild(sw);
  return { row, set(on) { sw.classList.toggle("on", !!on); sw.setAttribute("aria-checked", String(!!on)); } };
}

/* ==================================================================================
   THE LEFT RAIL - what the box is made of
   ================================================================================== */
/* What is left here is the box and the gas in it. The apparatus it is set up
   with - the flame under it, the air around it, the weight on its lid - is on
   the right rail's INSTRUMENT panel instead, because an instrument is set up
   where it is chosen. The two temperatures that used to be here are the clearest
   case: the flame belongs to the burner and the air the box stands in belongs to
   the thermometer that is standing in it, so neither of them is on this rail at
   all - and neither is on the other one's panel, because a switch about the fire
   and a slider about the room are about two different instruments. */

/**
 * @param {HTMLElement} container
 * @param {object} callbacks every on* below is optional
 * @returns {{ setState: (state:object)=>void, setLive:(o:object)=>void }}
 */
export function buildThermoLeftRail(container, callbacks = {}) {
  /* ----------------------------------- GAS ----------------------------------- */
  container.appendChild(el("div", "panel-title", "GAS"));
  const gasSection = el("div", "rail-section");

  const species = segmented(
    "Gas",
    SPECIES.map((s) => [s.key, s.symbol, `${s.name} (${s.symbol}), M = ${(s.molarMass * 1000).toFixed(2)} g/mol`]),
    "ar",
    (key) => callbacks.onSpecies?.(key),
  );
  species.wrap.classList.add("seg-wide");
  gasSection.appendChild(species.wrap);

  const mixture = segmented(
    "A second gas",
    [["none", "none", "One gas only"], ...SPECIES.map((s) => [s.key, s.symbol, `${s.name} (${s.symbol}) mixed in`])],
    "none",
    (key) => callbacks.onSecond?.(key === "none" ? null : key),
  );
  mixture.wrap.classList.add("seg-wide");
  gasSection.appendChild(mixture.wrap);

  const mixS = slider({
    label: "Mix", min: 0, max: 1, step: 0.05, value: 0.5,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    onInput: (v) => callbacks.onMixFraction?.(v),
  });
  gasSection.appendChild(mixS.wrap);

  const countS = slider({
    label: "Molecules", min: 100, max: 3200, step: 50, value: 1400,
    format: (v) => v.toFixed(0),
    onInput: (v) => callbacks.onCount?.(v),
  });
  gasSection.appendChild(countS.wrap);

  container.appendChild(gasSection);

  /* ----------------------------------- BOX ----------------------------------- */
  container.appendChild(el("div", "panel-title", "THE BOX"));
  const boxSection = el("div", "rail-section");

  const widthS = slider({
    label: "Width and height", min: 8, max: 40, step: 0.5, value: 18,
    format: (v) => `${v.toFixed(1)} nm`,
    onInput: (v) => callbacks.onWidth?.(v * 1e-9),
  });
  boxSection.appendChild(widthS.wrap);

  const lidS = slider({
    label: "Lid position", min: 6, max: 60, step: 0.25, value: 18,
    format: (v) => `${v.toFixed(2)} nm`,
    onInput: (v) => callbacks.onLid?.(v * 1e-9),
  });
  boxSection.appendChild(lidS.wrap);

  const lidMode = segmented(
    "What holds the lid",
    [["fixed", "Held"], ["hand", "By hand"], ["load", "A load"]],
    "fixed",
    (mode) => callbacks.onLidMode?.(mode),
  );
  /* What holds the lid is the last word about the lid in this group, and the
     pinhole under it is the next subject: it takes a group's own air, not the
     11px one row of a list stands off the row under it. */
  lidMode.wrap.classList.add("group-end");
  boxSection.appendChild(lidMode.wrap);

  const holeS = slider({
    label: "Pinhole", min: 0, max: 6, step: 0.1, value: 0,
    format: (v) => (v <= 0 ? "closed" : `${v.toFixed(1)} nm`),
    onInput: (v) => callbacks.onHole?.(v * 1e-9),
  });
  boxSection.appendChild(holeS.wrap);

  const partition = toggle("Partition", false, (on) => callbacks.onMembrane?.(on));
  boxSection.appendChild(partition.row);
  const membraneS = slider({
    label: "Partition at", min: 2, max: 40, step: 0.25, value: 9,
    format: (v) => `${v.toFixed(2)} nm`,
    onInput: (v) => callbacks.onMembraneX?.(v * 1e-9),
  });
  boxSection.appendChild(membraneS.wrap);
  container.appendChild(boxSection);

  /* ---------------------------------- WALLS ---------------------------------- */
  container.appendChild(el("div", "panel-title", "THE WALLS"));
  const wallSection = el("div", "rail-section");
  const held = toggle("Walls hold the temperature", true, (on) => callbacks.onWalls?.(on ? "thermal" : "elastic"));
  wallSection.appendChild(held.row);
  const lidHeld = toggle("Lid does too", true, (on) => callbacks.onLidThermal?.(on));
  wallSection.appendChild(lidHeld.row);
  /* Where the walls are being hit, drawn on the stage. It belongs to the walls
     because it *is* the walls: every spark is a molecule handing over the
     momentum the pressure is made of. */
  const impacts = toggle("Show wall impacts", false, (on) => callbacks.onImpacts?.(on));
  wallSection.appendChild(impacts.row);
  container.appendChild(wallSection);

  /* -------------------------------- TIMELINE -------------------------------- */
  container.appendChild(el("div", "panel-title", "TIMELINE"));
  const timeSection = el("div", "rail-section");

  const stepsS = slider({
    label: "Steps per frame", min: 1, max: 24, step: 1, value: 6,
    format: (v) => v.toFixed(0),
    onInput: (v) => callbacks.onSteps?.(v),
  });
  timeSection.appendChild(stepsS.wrap);

  const rampS = slider({
    label: "Speed up the colours", min: 0.4, max: 2.2, step: 0.1, value: 1,
    format: (v) => `${v.toFixed(1)}\u00D7`,
    onInput: (v) => callbacks.onSpeedRamp?.(v),
  });
  timeSection.appendChild(rampS.wrap);

  const precision = segmented(
    "Resolution",
    [["0.5", "Coarse"], ["1", "Standard"], ["2", "Fine"], ["4", "Finest"]],
    "1",
    (key) => callbacks.onPrecision?.(Number(key)),
  );
  /* The picker ends what this panel says about setting the run up; the three
     readings under it are what the run came to, and they are not another row of
     the same list. */
  precision.wrap.classList.add("group-end");
  timeSection.appendChild(precision.wrap);

  const stepRow = readout("Physics step");
  const travelRow = readout("Molecule travel");
  const paceRow = readout("One second shows");
  timeSection.append(stepRow.row, travelRow.row, paceRow.row);
  container.appendChild(timeSection);

  return {
    /** Sync every control to a box configuration. */
    setState(state) {
      species.pick(state.species ?? "ar");
      mixture.pick(state.second ?? "none");
      mixS.setValue(state.mixFraction ?? 0.5);
      countS.setValue(state.count ?? 1400);
      widthS.setValue(((state.crossSection ?? 18e-9) * 1e9));
      lidS.setValue(((state.length ?? 18e-9) * 1e9));
      lidMode.pick(state.lidMode ?? "fixed");
      holeS.setValue((state.hole ?? 0) * 1e9);
      partition.set(!!state.membrane);
      membraneS.setValue((state.membraneX ?? (state.length ?? 18e-9) / 2) * 1e9);
      /* Where the partition is only means something while there is one. */
      membraneS.setDisabled(!state.membrane);
      held.set(!state.walls || state.walls === "thermal");
      lidHeld.set(state.lidThermal !== false);
      /* Part of the state because a lab can ask for it: the one lab about where
         pressure comes from is not answerable with the sparks switched off. */
      impacts.set(!!state.impacts);
    },
    /** Numbers that can only be known once the box exists. */
    setLive(o) {
      stepRow.value.textContent = `${(o.dt * 1e15).toFixed(2)} fs`;
      const travel = (o.rmsSpeed * o.dt) / o.diameter;
      travelRow.value.textContent = `${(travel * 100).toFixed(0)}% of a diameter`;
      paceRow.value.textContent = `${(o.stepsPerFrame * o.dt * 60 * 1e12).toFixed(1)} ps of gas`;
    },
    syncLid(x) { lidS.setValue(x * 1e9); },
    /** Which of the three is holding the lid. Not a number that moves on its
     *  own, but an instrument can change it - the weights put a load on the lid
     *  - and this control is the only place that fact is written down. */
    syncLidMode(mode) { lidMode.pick(mode ?? "fixed"); },
    syncSteps(v) { stepsS.setValue(v); },
  };
}

/* ==================================================================================
   THE RIGHT RAIL - what the gas is doing
   ================================================================================== */

/**
 * The work a drawn P-V path represents, J: the area under it, by the trapezium
 * rule on the points the panel actually plotted.
 *
 * The sign is the textbook's - positive when the gas expanded - so this is the
 * negative of the ledger's "work in", and the two agreeing to a few percent is
 * a reader's own check that the curve on the screen and the account in the
 * energy panel are the same event.
 *
 * @param {Array<[number,number]>} points [volume, pressure]
 * @returns {number|null} null while there is no path to integrate
 */
function pathWork(points) {
  if (!points || points.length < 2) return null;
  let w = 0;
  for (let i = 1; i < points.length; i++) {
    const [v0, p0] = points[i - 1];
    const [v1, p1] = points[i];
    w += 0.5 * (p0 + p1) * (v1 - v0);
  }
  return w;
}

const SURFACE = "#1a1a22";
const GRID = "rgba(255,255,255,0.07)";
const ACCENT = "#b18cf5";
const THEORY = "rgba(255,255,255,0.5)";
const TRACE = "#e0b48a";

/**
 * A canvas that keeps its pixels square regardless of the panel's width.
 *
 * The height is the stylesheet's business - `.plot-histogram` and `.plot-trace`
 * each fix their own - so a chart is as tall as the rail says it is and can
 * never collapse to nothing between two rows of text. This only keeps the pixel
 * buffer square in device pixels, which is what stops the lines blurring.
 */
function stageCanvas(className) {
  const wrap = el("div", `plot ${className}`);
  const canvas = el("canvas");
  wrap.appendChild(canvas);
  const fit = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(2, Math.round(rect.width * dpr));
    canvas.height = Math.max(2, Math.round((rect.height || 1) * dpr));
  };
  return { wrap, canvas, fit };
}

/**
 * What each instrument's own panel is made of.
 *
 * An instrument is set up where it is *chosen*, not where it was built: the
 * rail on the right is the inspector, exactly as it is on the Dynamics bench,
 * and it shows the settings of whatever is selected on the stage. So a control
 * that belongs to an instrument lives here and nowhere else - the flame on the
 * burner, the weight pressing the lid on the weights - and no second copy of any
 * of them exists on the left.
 *
 * An instrument owns what it *is*, and that is why the two ends of the
 * temperature gradient belong to two different instruments here. A flame is a
 * surface held at a temperature, and it is the burner that holds it; the room
 * thermometer is the instrument standing out in the room the box sits in, so the
 * temperature of that room is its panel. One panel with both would be a switch
 * about the fire and a slider about the air sitting under one heading, which is
 * how a reader ends up trying to cool the room to change the flame.
 *
 * The two pressures that hold the lid are two numbers and two instruments, and
 * they used to be one number here: the weights' load and the gauge's reading
 * shared a slider, on the argument that `box.lid.load` is a pressure on the lid
 * whichever instrument is showing it. What that argument missed is that the two
 * instruments are about two different things. A load is something standing on
 * the lid, so it is drawn standing on the lid, and it belongs to the weights. A
 * gauge reads a pressure, and the one it is plumbed to is a boundary condition -
 * the air around the box, `box.lid.external` - so its panel sets *that*, its
 * needle points at what was set, and nothing about it appears on the lid. A
 * reader who turns the gauge's pressure up gets a pressure, not a pile of iron.
 */
const INSTRUMENT_SETTINGS = {
  burner: ["flame", "flameTemperature"],
  weights: ["load"],
  gauge: ["external"],
  thermometer: ["surroundings"],
};

/**
 * One short line under an instrument's name saying where its number comes from.
 *
 * The rail is a column of labels and measurements, so the one place a reader
 * asks "what am I actually setting here" is the panel they are setting it in -
 * and the two pressures on this bench are the pair that most needs the sentence
 * that tells them apart.
 */
const INSTRUMENT_NOTES = {
  burner: "the flame under the box",
  weights: "a load standing on the lid",
  gauge: "the air pressing the lid from outside",
  thermometer: "the air the box stands in",
};

/**
 * The instruments that carry a "Remove from the stage" button.
 *
 * A dial has nothing to switch off, and a burner whose flame is out is still a
 * burner standing on the bench, so both of those need a button that means off
 * the stage rather than off. The weights do not: their own slider is that act
 * already - a load of nothing is no weights - and the bench is not an instrument
 * at all, it is the table the box stands on and is always there.
 */
const REMOVABLE = new Set(["gauge", "thermometer", "burner"]);

/**
 * @param {HTMLElement} container
 * @param {object} callbacks onClearTrace, onExportCSV, onFlame, onFlameTemperature,
 *        onSurroundings, onLoad, onExternal, onRemove
 */
export function buildThermoRightRail(container, callbacks = {}) {
  /* --------------------------------- INSTRUMENT -------------------------------- */
  /* The panel an instrument is set up in, first on the rail because it is the
     one panel here that is about a thing rather than about the gas, and because
     the Dynamics bench keeps its inspector where this is.

     The heading and the section are one node, because this panel is either
     there or it is not. With nothing open there is no instrument to set up, and
     a heading standing over the words "nothing selected" is a heading for
     nothing: the rail runs from the gas's own numbers to the plot, and it
     begins at the top of the rail. */
  const instrumentPanel = el("div", "instrument-panel is-hidden");
  instrumentPanel.appendChild(el("div", "panel-title", "INSTRUMENT"));
  const instrumentSection = el("div", "rail-section");
  const instrumentName = el("div", "section-label", "");
  const instrumentNote = el("div", "instrument-note", "");
  const instrumentControls = el("div", "instrument-settings");

  const flameT = toggle("Flame underneath", false, (on) => callbacks.onFlame?.(on));
  const flameS = slider({
    label: "Flame temperature", min: 300, max: 2000, step: 25, value: 900,
    format: (v) => `${v.toFixed(0)} K`,
    onInput: (v) => callbacks.onFlameTemperature?.(v),
  });
  const bathS = slider({
    label: "Room temperature", min: 10, max: 1200, step: 5, value: 300,
    format: (v) => `${v.toFixed(0)} K`,
    onInput: (v) => callbacks.onSurroundings?.(v),
  });
  const loadS = slider({
    label: "Load", min: 0, max: 8, step: 0.02, value: 0,
    format: (v) => `${v.toFixed(2)} MPa`,
    onInput: (v) => callbacks.onLoad?.(v * 1e6),
  });
  /* The air around the box, on the lid's outer face. It is a boundary condition
     like the flame's temperature and the room's, so the slider states it, the
     gauge out on the stage reads it back, and it does not drift: what the gas
     is doing on the other side of the lid cannot move a number that says what
     the room is. */
  const externalS = slider({
    label: "External pressure", min: 0, max: 8, step: 0.02, value: 0,
    format: (v) => `${v.toFixed(2)} MPa`,
    onInput: (v) => callbacks.onExternal?.(v * 1e6),
  });
  const parts = new Map([
    ["flame", flameT.row],
    ["flameTemperature", flameS.wrap],
    ["surroundings", bathS.wrap],
    ["load", loadS.wrap],
    ["external", externalS.wrap],
  ]);
  for (const node of parts.values()) instrumentControls.appendChild(node);

  const removeRow = el("div", "btn-row");
  const removeBtn = el("button", "btn", "Remove from the stage");
  removeBtn.type = "button";
  removeBtn.addEventListener("click", () => { if (active) callbacks.onRemove?.(active); });
  removeRow.appendChild(removeBtn);

  instrumentSection.append(instrumentName, instrumentNote, instrumentControls, removeRow);
  instrumentPanel.appendChild(instrumentSection);
  container.appendChild(instrumentPanel);

  /** Which instrument's settings are on screen, or null. */
  let active = null;

  /* --------------------------------- WHAT IT IS -------------------------------- */
  container.appendChild(el("div", "panel-title", "THE GAS, RIGHT NOW"));
  const stateSection = el("div", "rail-section");

  const tempR = measured("Temperature", "");
  const pressR = measured("Pressure", "");
  const volumeR = measured("Volume", "");
  const countR = measured("Molecules", "");
  const zR = measured("Compressibility P V / N k T", "");
  /* The two combinations the two named laws are about, each beside the value it
     had when the path began: P V for a squeeze at constant temperature, V / T
     for a heating at constant pressure. A measurement with its unit and one
     comparison, which is the whole of what these rows say. */
  const pvR = measured("Pressure \u00D7 volume", "");
  /* "Per kelvin" rather than the division sign, and three significant figures:
     the rail is 250 pixels wide, and a caption and a value that between them
     overrun it wrap onto two lines, which breaks the column the readouts are. */
  const vtR = measured("Volume per kelvin", "");
  stateSection.append(tempR.row, pressR.row, volumeR.row, countR.row, zR.row, pvR.row, vtR.row);
  container.appendChild(stateSection);

  /* ----------------------------------- SPEEDS ---------------------------------- */
  container.appendChild(el("div", "panel-title", "SPEEDS"));
  const speedSection = el("div", "rail-section");
  const histogram = stageCanvas("plot-histogram");
  speedSection.appendChild(histogram.wrap);
  speedSection.appendChild(el(
    "div", "plot-legend",
    '<span class="key key-bar"></span>measured<span class="key key-curve"></span>Maxwell-Boltzmann',
  ));
  const mpR = readout("Most probable");
  const meanR = readout("Mean speed");
  const rmsR = readout("r.m.s. speed");
  /* One row per gas, when the box holds two: its own name, its own temperature
     and its own mean speed. They are the pair the mixture is about - the
     temperatures agree and the speeds do not - and there is nowhere else on
     either rail where one species can be read on its own. A box of one species
     shows neither row, because there is nothing to compare it with. */
  const kindRows = [measured("", ""), measured("", "")];
  speedSection.append(mpR.row, meanR.row, rmsR.row, kindRows[0].row, kindRows[1].row);
  container.appendChild(speedSection);

  /* -------------------------------- COLLISIONS --------------------------------- */
  container.appendChild(el("div", "panel-title", "COLLISIONS"));
  const collisionSection = el("div", "rail-section");
  const lambdaR = readout("Mean free path");
  const spacingR = readout("Distance to a neighbour");
  const freqR = readout("Collisions per molecule");
  const impactR = readout("Impacts on the walls");
  /* The force is the same measurement as the pressure, one multiplication
     earlier: the momentum those impacts handed over, per second. Both halves of
     P = F / A are read off the same window, so the row underneath can say the
     equation out loud with the numbers that are true right now. */
  const forceR = measured("Force on the walls", "");
  /* A readout with a second line, because an effusion experiment is a question
     about *which* molecules left: the count on the row, and the split between
     the two gases under it. A box of one species uses the same line for the
     rate they are going at, which is the same experiment read the other way. */
  const mixR = measured("What has left the box", "");
  collisionSection.append(lambdaR.row, spacingR.row, freqR.row, impactR.row, forceR.row, mixR.row);
  container.appendChild(collisionSection);

  /* ----------------------------------- ENERGY ---------------------------------- */
  container.appendChild(el("div", "panel-title", "ENERGY"));
  const energySection = el("div", "rail-section");
  const uR = readout("Internal energy U");
  const qR = readout("Heat in, Q");
  const rateR = readout("Heat rate");
  const wR = readout("Work in, W");
  const escR = readout("Carried out of the hole");
  const resR = readout("U - U0 - Q - W");
  resR.row.classList.add("ledger-residual");
  const ledger = el("div", "ledger");
  const bars = new Map();
  /* Three bars under the three rows above them, in the same order: how much of
     the energy each term accounts for. No legend needed - the order says it. */
  for (const key of ["q", "w", "esc"]) {
    const bar = el("div", "ledger-bar");
    bar.title = { q: "heat", w: "work", esc: "carried out of the hole" }[key];
    const fill = el("i", `ledger-fill ledger-${key}`);
    bar.appendChild(fill);
    ledger.appendChild(bar);
    bars.set(key, fill);
  }
  energySection.append(uR.row, qR.row, rateR.row, wR.row, escR.row, resR.row, ledger);
  container.appendChild(energySection);

  /* ---------------------------------- THE TRACE -------------------------------- */
  container.appendChild(el("div", "panel-title", "PRESSURE AND VOLUME"));
  const traceSection = el("div", "rail-section");
  const trace = stageCanvas("plot-trace");
  /* The path integral, measured off the curve that was drawn rather than taken
     from the energy books: the two are the same quantity arrived at two ways,
     so a reader can check one against the other. The sign is the textbook's -
     the work the *gas* did - which is why it is the negative of the ledger's
     "work in". */
  const workR = measured("Work done by the gas", "\u222B P dV");
  const traceNote = el("div", "rail-note", "");
  const traceRow = el("div", "btn-row plot-actions");
  const clearBtn = el("button", "btn", "Clear trace");
  const exportBtn = el("button", "btn", "Export CSV");
  clearBtn.addEventListener("click", () => callbacks.onClearTrace?.());
  exportBtn.addEventListener("click", () => callbacks.onExportCSV?.());
  traceRow.append(clearBtn, exportBtn);
  traceSection.append(trace.wrap, workR.row, traceNote, traceRow);
  container.appendChild(traceSection);

  /* ------------------------------------ DRAWING ---------------------------------- */

  function drawHistogram(box) {
    const { canvas } = histogram;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const bins = 44;
    const mass = box.meanMass();
    const reference = Math.max(box.temperature(), 1);
    /* The axis runs to just past the fastest speeds a gas at this temperature
       should have, so the curve keeps its shape when the temperature moves
       instead of rescaling under it. */
    const vMax = Math.max(3.1 * rmsSpeedOf(mass, reference), 60);
    const shape = box.speedHistogram(bins, vMax);

    let peak = 0;
    for (let b = 0; b < bins; b++) peak = Math.max(peak, shape.counts[b]);
    const curvePeak = Math.max(...Array.from({ length: 80 }, (_, i) => shape.theoretical(((i + 0.5) / 80) * vMax) * shape.width));
    const top = Math.max(peak, curvePeak) * 1.15 || 1;

    const pad = 4 * dpr;
    const plotH = H - 16 * dpr;
    const plotW = W - pad * 2;
    const x = (v) => pad + (v / vMax) * plotW;
    const y = (p) => plotH - (p / top) * (plotH - pad);

    /* gridlines every quarter of the axis */
    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    for (let k = 1; k < 4; k++) {
      const gx = pad + (k / 4) * plotW;
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, plotH); ctx.stroke();
    }

    /* the measured bars */
    const barW = plotW / bins;
    for (let b = 0; b < bins; b++) {
      const height = (shape.counts[b] / top) * (plotH - pad);
      ctx.fillStyle = "rgba(177,140,245,0.55)";
      ctx.fillRect(pad + b * barW + 0.5 * dpr, plotH - height, Math.max(1, barW - 1 * dpr), height);
    }

    /* and the curve they should be lying on */
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) {
      const v = (i / 120) * vMax;
      const p = shape.theoretical(v) * shape.width;
      const px = x(v);
      const py = y(p);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = THEORY;
    ctx.lineWidth = 1.4 * dpr;
    ctx.stroke();

    /* the most probable speed, marked, because it is the peak of that curve */
    if (shape.total) {
      const vmp = mostProbableSpeed(shape.mass, shape.temperature);
      ctx.beginPath();
      ctx.setLineDash([3 * dpr, 3 * dpr]);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.moveTo(x(vmp), plotH);
      ctx.lineTo(x(vmp), 0);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    /* axis label */
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `${9 * dpr}px Inter, system-ui, sans-serif`;
    ctx.fillText("0", pad, H - 2 * dpr);
    const label = `${vMax.toFixed(0)} m/s`;
    ctx.fillText(label, W - pad - ctx.measureText(label).width, H - 2 * dpr);
    return { shape, reference };
  }

  function drawTrace(points) {
    const { canvas } = trace;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (!points || points.length < 2) {
      /* An empty chart has to look like a chart waiting for something rather
         than a chart that failed to load: the frame it will be drawn inside,
         the axis it will run along, and the one gesture that fills it. */
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 1;
      ctx.strokeRect(6 * dpr, 6 * dpr, W - 12 * dpr, H - 12 * dpr);
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.font = `${10.5 * dpr}px Inter, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText("Squeeze the lid to trace a path", W / 2, H / 2 + 4 * dpr);
      ctx.textAlign = "left";
      ctx.font = `${9 * dpr}px Inter, system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.42)";
      const axis = "V \u2192";
      ctx.fillText(axis, W - 8 * dpr - ctx.measureText(axis).width, H - 6 * dpr);
      return;
    }
    const pad = 14 * dpr;
    let vMin = Infinity, vMax = -Infinity, pMin = Infinity, pMax = -Infinity;
    for (const [v, p] of points) {
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
      pMin = Math.min(pMin, p); pMax = Math.max(pMax, p);
    }
    if (vMax - vMin < 1e-30) vMax = vMin + 1e-30;
    if (pMax - pMin < 1e-30) pMax = pMin + 1e-30;
    /* Volume runs to the right, the way the axis label says it does. A P-V
       diagram whose volume axis is mirrored is read backwards - a compression
       looks like an expansion - and it is the one mistake a chart like this
       cannot make, because the direction of the path IS the sign of the work. */
    const x = (v) => pad + ((v - vMin) / (vMax - vMin)) * (W - pad * 2);
    const y = (p) => H - pad - ((p - pMin) / (pMax - pMin)) * (H - pad * 2);

    ctx.strokeStyle = GRID;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad, 0); ctx.lineTo(pad, H - pad); ctx.lineTo(W, H - pad); ctx.stroke();

    /* The area under the path is the work - W = integral of P dV - so it is
       filled, and the number in the rail is the area of that fill rather than a
       separate claim about it. Filled before the line is stroked, so the path
       itself stays the sharpest thing in the frame. */
    ctx.beginPath();
    ctx.moveTo(x(points[0][0]), H - pad);
    for (const [v, p] of points) ctx.lineTo(x(v), y(p));
    ctx.lineTo(x(points[points.length - 1][0]), H - pad);
    ctx.closePath();
    ctx.fillStyle = "rgba(224,180,138,0.13)";
    ctx.fill();

    ctx.beginPath();
    points.forEach(([v, p], i) => {
      const px = x(v); const py = y(p);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = TRACE;
    ctx.lineWidth = 1.6 * dpr;
    ctx.lineJoin = "round";
    ctx.stroke();

    const head = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(x(head[0]), y(head[1]), 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = ACCENT;
    ctx.fill();

    ctx.font = `${9 * dpr}px Inter, system-ui, sans-serif`;
    /* Both axis labels sit inside the frame, off the line's own corner, so a
       squeeze to the top-left of the plot cannot run under them. */
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    const vAxis = "V \u2192";
    ctx.fillText(vAxis, W - 8 * dpr - ctx.measureText(vAxis).width, H - 7 * dpr);
    ctx.fillText("\u2191 P", 8 * dpr, 20 * dpr);
    /* And the shaded shape is named, in the same colour it is drawn in. */
    ctx.fillStyle = "rgba(224,180,138,0.55)";
    const area = "\u222B P dV";
    ctx.fillText(area, W - 8 * dpr - ctx.measureText(area).width, 20 * dpr);
  }

  function bar(fill, value, scale) {
    const f = Math.abs(value) / (scale || 1);
    fill.style.width = `${Math.min(100, f * 100).toFixed(1)}%`;
    fill.classList.toggle("negative", value < 0);
  }

  return {
    /**
     * Show one instrument's settings, or an empty panel when there is nothing
     * selected. The values themselves are synced every frame: an instrument can
     * also be changed by a lab, by a keystroke on the stage or by the other
     * instrument that shares its box, and a control that only answered its own
     * clicks would be showing an old number. */
    setInstrument(instrument) {
      active = instrument?.key ?? null;
      /* No instrument, no panel: the heading goes with the section it heads. */
      instrumentPanel.classList.toggle("is-hidden", !active);
      instrumentName.textContent = instrument ? instrument.label : "";
      instrumentNote.textContent = instrument ? (INSTRUMENT_NOTES[active] ?? "") : "";
      const shown = new Set(INSTRUMENT_SETTINGS[active] ?? []);
      for (const [name, node] of parts) node.classList.toggle("is-hidden", !shown.has(name));
      removeRow.classList.toggle("is-hidden", !(active && REMOVABLE.has(active)));
    },

    /**
     * Bring this panel into view. It is the first thing on the rail and the rail
     * is what scrolls, so an instrument chosen while the reader was down at the
     * plot would have its settings opened several screens above them.
     */
    reveal() {
      container.scrollTop = 0;
    },
    /** Redraw everything from one `observe()` payload and the box itself. */
    update(o, box, tracePoints) {
      const species = speciesOf(box.speciesKey);
      const mass = moleculeMass(species);

      /* A *rate* has no value until a window of time has gone by to divide by,
         and a box that has just been re-dealt - a new count, a new species, a
         new width, a restored page - has spent none of that window yet. The
         momentum its walls have collected so far is nothing over nothing, and
         printing that as `0.000 MPa` is a number that is not a measurement. So
         the rows that are rates say they are waiting instead.

         They only ever wait for the handful of frames the settle in
         frontend/thermo_main.js takes to run the window (a tenth of a second at
         the box's usual population), and nothing that is not a rate waits at
         all: the temperature, the volume, the count and the whole speed
         distribution are properties of the gas as it stands, and they are on
         screen the moment the box is. */
      const pending = o.window <= 0;
      const rate = (text) => (pending ? "—" : text);

      /* The selected instrument's controls follow the box, so a lab that loads
         a flame and a load lands on the same numbers this panel is holding. */
      if (active === "burner") {
        flameT.set(box.burner.on);
        flameS.setValue(box.burner.temperature);
      } else if (active === "weights") {
        loadS.setValue(box.lid.load / 1e6);
      } else if (active === "gauge") {
        externalS.setValue(o.externalPressure / 1e6);
      } else if (active === "thermometer") {
        bathS.setValue(box.bath);
      }

      /* Two readings are worth one line of comparison and no more: the
         temperature against the bath that is supposed to be setting it, and
         the compressibility against the 1.000 of an ideal gas. Everything else
         on this rail is a number and its unit. */
      tempR.value.textContent = `${o.windowTemperature.toFixed(1)} K`;
      /* Which surfaces the gas is between, since a flame under the floor makes
         "the walls" two different temperatures rather than one. */
      tempR.theory.textContent = o.burner.on
        ? `air ${o.bath.toFixed(0)} K, floor ${o.burner.temperature.toFixed(0)} K`
        : `walls at ${o.bath.toFixed(0)} K`;
      pressR.value.textContent = rate(`${(o.pressure / 1e6).toFixed(3)} MPa`);
      /* Zeptolitres: 1e-24 m^3, which is the scale this box lives at - an 18 nm
         cube holds 5.8 of them. The factor used to be 1e27, which is a
         millizeptolitre under a label that said zL: the number was a thousand
         times the volume it claimed to be, on the one readout a student is most
         likely to check against the box on the screen. */
      volumeR.value.textContent = `${(o.volume * 1e24).toFixed(3)} zL`;
      countR.value.textContent = `${o.molecules}`;
      zR.value.textContent = rate(o.compressibility.toFixed(3));
      zR.theory.textContent = "ideal gas: 1.000";
      /* Independent of the ideal gas law and of the compressibility above: just
         the two numbers on the rows above, multiplied. Boyle's law is that this
         one does not move while the box does. */
      const first = tracePoints && tracePoints.length > 1 ? tracePoints[0] : null;
      pvR.value.textContent = rate(`${(o.pressure * o.volume * 1e18).toFixed(3)} aJ`);
      pvR.theory.textContent = first
        ? `path began at ${(first[0] * first[1] * 1e18).toFixed(3)} aJ`
        : "";
      /* Zeptolitres per kelvin, which is the row above with the temperature put
         where the pressure was: this is the combination Charles's law says does
         not move. The path's own starting temperature comes from the trace, so
         the comparison is against the same moment the P-V row's is. */
      const perKelvin = (v, T) => `${((v * 1e24) / Math.max(T, 1e-6)).toPrecision(3)} zL/K`;
      vtR.value.textContent = perKelvin(o.volume, o.windowTemperature);
      vtR.theory.textContent = first && Number.isFinite(first[2])
        ? `path began at ${perKelvin(first[0], first[2])}`
        : "";

      /* The bars are the histogram of the velocities the box actually dealt;
         the curve is the same distribution at the temperature those velocities
         came to, which is why it can sit a little off the bath's. */
      const { shape } = drawHistogram(box);
      mpR.value.textContent = `${mostProbableSpeed(mass, shape.temperature).toFixed(0)} m/s`;
      meanR.value.textContent = `${meanSpeedOf(mass, shape.temperature).toFixed(0)} m/s`;
      rmsR.value.textContent = `${rmsSpeedOf(mass, shape.temperature).toFixed(0)} m/s`;

      lambdaR.value.textContent = `${(o.freePath * 1e9).toFixed(2)} nm`;
      spacingR.value.textContent = `${(o.spacing * 1e9).toFixed(2)} nm`;
      freqR.value.textContent = rate(`${(o.collisionFrequency / 1e9).toFixed(1)} /ns`);
      impactR.value.textContent = rate(`${(o.impactRate / 1e28).toFixed(2)} e28 /(m\u00B2 s)`);
      forceR.value.textContent = `${(o.totalForce * 1e12).toFixed(2)} pN`;
      /* P = F / A, written out with the numbers that are on the other rows - and
         with nothing written out while the row it names is still waiting. */
      forceR.theory.textContent = pending
        ? ""
        : `= ${(o.pressure / 1e6).toFixed(3)} MPa \u00D7 ${(o.contactArea * 1e18).toFixed(2)} nm\u00B2`;
      /* Which molecules went, and how fast: the split between the two gases when
         there are two, and the rate they are leaving at when there is one. */
      if (o.escaped > 0) {
        const [a, b] = o.escapedByKind;
        const second = box.secondKey ? speciesOf(box.secondKey) : null;
        mixR.value.textContent = `${o.escaped} out`;
        mixR.theory.textContent = second
          ? `${species.symbol} ${a}, ${second.symbol} ${b}`
          : `${(o.escapeRate / 1e9).toFixed(2)} /ns`;
      } else {
        mixR.value.textContent = "...";
        mixR.theory.textContent = "";
      }

      /* The gases one at a time, where there are two of them. The temperature is
         the box's own instantaneous reading for that species rather than a
         windowed one, so the two numbers wander by a percent or so as the
         molecules collide - which is the agreement equipartition is about. */
      const mixed = box.secondKey ? [species, speciesOf(box.secondKey)] : [];
      kindRows.forEach((row, i) => {
        const kind = mixed[i];
        row.row.classList.toggle("is-hidden", !kind);
        if (!kind) return;
        row.label.textContent = kind.name;
        row.value.textContent = `${(o.kindTemperatures[i] ?? 0).toFixed(1)} K`;
        row.theory.textContent = `${(o.kindSpeeds[i] ?? 0).toFixed(0)} m/s mean`;
      });

      const l = o.ledger;
      const scale = Math.max(Math.abs(l.internalEnergy0), 1e-30);
      const residual = Math.abs(l.residual);
      uR.value.textContent = `${(l.internalEnergy * 1e18).toFixed(3)} aJ`;
      qR.value.textContent = `${(l.heat * 1e18).toFixed(4)} aJ`;
      /* What a flame is delivering right now, in watts: the heat in the ledger
         is the total, and this is the rate it is arriving at - which is what
         settles to zero when the floor and the air reach a balance. */
      rateR.value.textContent = rate(`${(o.heatRate * 1e6).toFixed(2)} \u00B5W`);
      wR.value.textContent = `${(l.work * 1e18).toFixed(4)} aJ`;
      escR.value.textContent = `${(l.escaped * 1e18).toFixed(4)} aJ`;
      resR.value.textContent = residual === 0 ? "0" : residual.toExponential(1);
      const unbalanced = residual > 1e-6 * scale;
      resR.row.classList.toggle("bad", unbalanced);
      resR.value.title = unbalanced ? "this should be zero: the ledger has lost something" : "";
      bar(bars.get("q"), l.heat, scale);
      bar(bars.get("w"), l.work, scale);
      bar(bars.get("esc"), l.escaped, scale);

      drawTrace(tracePoints);
      const path = pathWork(tracePoints);
      workR.value.textContent = path === null ? "..." : `${(path * 1e18).toFixed(3)} aJ`;
      traceNote.innerHTML = "";
      if (tracePoints && tracePoints.length > 1) {
        const [v0, p0] = tracePoints[0];
        const [v1, p1] = tracePoints[tracePoints.length - 1];
        const ratio = v0 / Math.max(v1, 1e-30);
        /* A slope needs a run to measure it on: over a percent of volume change
           the ratio is mostly window noise, and printing an exponent for it
           would be a number pretending to be a result. */
        if (ratio > 1.05) {
          /* The slope of the path on a log plot is the exponent in P V^x, and
             it is the whole result of a squeeze, so it gets the one line. */
          const exponent = Math.log(p1 / p0) / Math.log(ratio);
          const law = Math.abs(exponent - 1) < 0.06 ? ": isothermal"
            : Math.abs(exponent - 5 / 3) < 0.12 ? ": adiabatic" : "";
          traceNote.innerHTML =
            `V \u00D7 ${ratio.toFixed(2)}, P \u00D7 ${(p1 / p0).toFixed(2)}: exponent <b>${exponent.toFixed(3)}</b>${law}`;
        }
      }
    },
    fit() { histogram.fit(); trace.fit(); },
  };
}


