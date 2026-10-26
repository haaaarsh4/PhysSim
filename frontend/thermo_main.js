/**
 * frontend/thermo.js - the Thermo workbench.
 *
 * The counterpart of frontend/main.js, and deliberately built from the same
 * furniture: the same title bar, the same two rails, the same page bar, the same
 * session that puts the experiment back after a reload. What is different is
 * what the panels say and what the stage is - a box of molecules rather than a
 * bench of shapes - and that lives in simulation/gas.js, rendering/gas_renderer.js
 * and frontend/thermo_ui.js. This file is the wiring between them.
 *
 * ---------------------------------------------------------------------------
 * THE ONE HONEST COMPROMISE, SAID UP FRONT
 * ---------------------------------------------------------------------------
 * A real gas at real speeds crosses this box in forty picoseconds, so nothing
 * that looked like it could be watched would be a real gas. This workbench
 * therefore runs the gas at real speeds and shows a *slice* of time: a fixed
 * number of physics steps per frame, at real dt, which is tens of picoseconds of
 * gas per second of watching. The panel quotes the exchange rate next to the
 * step, so the slow motion is stated rather than hidden, and every number on the
 * right is still a measurement of the real thing.
 *
 * The other consequence of running at real dt is that the frame loop is not
 * tied to wall-clock time: a slow machine shows the same gas, further apart,
 * rather than a gas that runs in slow motion. There is no time debt to catch up
 * on, because the gas's own clock is the one the panel reports.
 */
import * as THREE from "three";
import {
  createElement, ArrowLeft, Box, Square, Download, Upload, Eraser, RotateCcw,
  StepForward, Play, Pause, Plus, Minus, X, FlaskConical, Wrench, Flame, Weight, Table2,
  Gauge, Thermometer, ChevronLeft, ChevronRight,
} from "lucide";
import {
  GasBox, MAX_LENGTH, MAX_MOLECULES, MIN_LENGTH, MIN_MOLECULES,
  WINDOW_DURATION, speciesOf,
} from "../simulation/gas.js";
import { GasRenderer } from "../rendering/gas_renderer.js";
import { ThermoApparatus } from "../rendering/thermo_apparatus.js";
import { buildThermoLeftRail, buildThermoRightRail } from "./thermo_ui.js";
import { mountAxisGizmo } from "./axis_gizmo.js";
import { THERMO_LABS } from "./thermo_labs.js";
import { THERMO_INSTRUMENTS } from "./thermo_instruments.js";
import { createLabCard } from "./ui.js";
import { mountStageDrawers } from "./drawer.js";
import {
  downloadCSV, downloadJSON, uploadJSONFile, loadFromLocalStorage, saveToLocalStorage,
} from "../storage/io.js";

const ICONS = {
  ArrowLeft, Box, Square, Download, Upload, Eraser, RotateCcw, StepForward,
  Play, Pause, Plus, Minus, X, FlaskConical, Wrench, Flame, Weight, Table2, Gauge,
  Thermometer, ChevronLeft, ChevronRight,
};

function mountIcon(el, name, attrs = {}) {
  const node = ICONS[name];
  if (!node) return;
  const existing = el.querySelector(":scope > svg.lucide");
  if (existing) existing.remove();
  el.insertBefore(
    createElement(node, { width: 16, height: 16, "stroke-width": 1.75, class: "lucide", ...attrs }),
    el.firstChild,
  );
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

/* The bench as it is the first time someone arrives, and the state every edit is
   layered onto. One object, so "what a fresh box is" is written once. */
const DEFAULT_STATE = {
  species: "ar", second: null, mixFraction: 0.5,
  count: 1400, temperature: 300,
  crossSection: 18e-9, length: 18e-9,
  hole: 0, walls: "thermal", lidThermal: true, lidMode: "fixed", load: 0, external: 0,
  membrane: false, membraneX: 9e-9,
  burner: false, burnerTemperature: 900,
  /* A view setting rather than a physical one, but it is part of a lab's setup:
     the experiment about where pressure comes from is not answerable with the
     impacts switched off. */
  impacts: false,
  /* The instruments that are furniture rather than physics, and therefore the
     only ones anything has to remember: the flame and the weights are read back
     off the box, and the bench is the stage itself and is always there. The
     box opens with the two dials already standing on it, because a gas in a box
     with nothing around it is a diagram, and the two numbers this workbench is
     most often asked for are those two dials. */
  instruments: ["gauge", "thermometer"],
};

/* The session lives under its own key: the two workbenches share an origin, and
   a Thermo session written over a Dynamics one would be the bench eating the
   other bench's experiment. */
const SESSION_KEY = "physics-workbench:thermo-session";
const SESSION_VERSION = 1;
const SESSION_SAVE_EVERY = 500; // ms
const TRACE_MAX = 800;
/* A point on the P-V trace is a point about a *volume change*: sampling by time
   would draw a thick blob while the lid sits still and a hairline while it
   moves, which is the wrong way round. */
const TRACE_MIN_FRACTION = 0.0015;
const LID_GRAB_PX = 28;
/* How long a frame may spend paying back the gas a dragged control owes the
   panel, in ms, and how many steps it commits to between two readings of the
   clock. Six of a sixteen-millisecond frame is a frame that still answers, and
   eight steps is about one millisecond of gas at the box's usual population. */
const SETTLE_BUDGET_MS = 6;
const SETTLE_SLICE = 8;

function formatGasTime(t) {
  if (!(t > 0)) return "0 ps";
  if (t < 1e-9) return `${(t * 1e12).toFixed(2)} ps`;
  if (t < 1e-6) return `${(t * 1e9).toFixed(3)} ns`;
  return `${(t * 1e6).toFixed(3)} µs`;
}

export function bootThermoWorkbench() {
  const canvas = document.getElementById("thermoCanvas");
  if (!canvas) return;

  for (const el of document.querySelectorAll("#thermo [data-icon]")) {
    mountIcon(el, el.dataset.icon);
  }

  /* ==================================================================================
     THE BOX
     ================================================================================== */
  /* One box for the life of the page, refilled rather than replaced: the
     renderer holds a reference to it and allocates its molecule instances from
     its capacity, so swapping the object would quietly decouple the picture from
     the physics. Every lab is a state applied to this box. */
  const box = new GasBox({ ...DEFAULT_STATE, maxMolecules: MAX_MOLECULES });
  const renderer = new GasRenderer(canvas, box);
  /* The stage's orientation triad: the same widget, reading this bench's own
     camera, so it turns with the box when the gas is orbited. */
  const axisGizmo = mountAxisGizmo(document.getElementById("thermoViewport"), () => renderer.camera);
  /* The apparatus is a separate layer because it answers to a different thing: the
     renderer's job is to draw the gas where the box says it is, and this one's
     is to draw what someone put on the bench. Both hang off the same root, so
     there is still one scene and one camera. */
  const apparatus = new ThermoApparatus(box);
  renderer.root.add(apparatus.group);
  /* A first visit has no session to put the bench back, and `applyState` - the
     one place that reads the instruments out of a state - is only reached from
     a lab, a reset or a restore. So the box's own default furniture is laid out
     here, which is where a fresh scene is actually built. */
  apparatus.setVisual(DEFAULT_STATE.instruments);
  /* The renderer draws the burner's stand and the burner's flame on two
     different answers - the stand because a burner is on the stage, the flame
     because the box is burning - so it is told where the burner is before the
     stage is framed around it. */
  renderer.setBurnerPresent(apparatus.has("burner"));
  /* The extent is handed over as a function, not as a rectangle: the box's own
     size and its lid move the instruments with them, so the reframes the
     renderer decides on for itself have to ask where everything is rather than
     read a remembered answer. */
  renderer.setStageExtent(() => apparatus.extent());

  let running = false;
  let stepsPerFrame = 6;
  let speedRamp = 1;
  let labId = null;
  let stepMs = 0;

  /* ------------------------------- the settle ------------------------------- */
  /* A box that has just been dealt owes the panel a measurement window: pressure
     is a rate - momentum collected per unit area per unit *time* - so a box with
     nothing behind it has no pressure to report, and nothing to report is not
     the same as reporting nought.

     Those steps are run here and now, before the handler that asked for them
     returns, and never from the frame loop. They used to be paid back in slices
     over the following frames, and the gas was drawn between the slices: a box
     that had just been dealt visibly streamed and swirled while the button said
     Paused. The bench was measuring itself in full view, and it looked exactly
     like an experiment that had started without being asked to.

     A window of gas is a few tens of milliseconds of arithmetic - two windows to
     settle a cold page - which is a price a click can pay without being seen to
     stall, and it buys the rule the page is supposed to keep: while Paused, the
     picture is still. The panel is therefore never empty either, so a rate is
     never printed as the dash it used to show until the slices caught up. */

  /** Run this many steps of gas now, then whatever was waiting on them.
   *
   * For the places that happen once and behind a curtain: the first gas of a
   * page load, a lab opening, a session coming back. Nothing is on screen yet
   * when these run, so a window of gas costs a few tens of milliseconds and
   * nobody sees it. */
  function settle(steps, onDone = null) {
    const n = Math.max(0, Math.round(steps));
    if (n > 0) advance(n);
    if (onDone) onDone();
  }

  /* What a reader's own control owes the box, paid from the frame loop instead.
     A slider sends an input event per pixel dragged and every one of them
     re-deals the gas, so a window per event inside the event is a drag that
     stops answering. The frame loop pays these back in small slices - and holds
     the picture still until they are paid, so the rule holds everywhere: a
     bench that is paused is a bench that is not moving. */
  let settleRemaining = 0;
  let settleOnDone = null;

  function settleLater(steps, onDone = null) {
    settleRemaining = Math.max(settleRemaining, Math.max(0, Math.round(steps)));
    if (onDone) settleOnDone = onDone;
  }

  /** Pay back as much of what the box is owed as one frame can afford. */
  function paySettle() {
    if (settleRemaining <= 0) return;
    const until = performance.now() + SETTLE_BUDGET_MS;
    do {
      const chunk = Math.min(SETTLE_SLICE, settleRemaining);
      advance(chunk);
      settleRemaining -= chunk;
    } while (settleRemaining > 0 && performance.now() < until);
    if (settleRemaining <= 0) {
      const done = settleOnDone;
      settleOnDone = null;
      if (done) done();
    }
  }

  /**
   * Settle the box with its pinhole shut, and open it again once the gas has
   * settled.
   *
   * A window measured through an open hole has already let a tenth of the gas out
   * by the time anyone presses Run, and "what has left the box" starting at 274
   * of the effusion lab's 2600 molecules is not the experiment that lab asks for.
   * So the hole is shut for the whole of the settle and not merely for its first
   * step - which is the difference between this and the old warm-up, that ran in
   * one go before anyone could look. The settle is spread over frames now, and an
   * open hole would be open across all of them.
   *
   * `applyState` is the one caller that does not come through here: it has
   * already shut the hole itself, to deal the gas into the sealed box the state
   * describes, and passes the radius its state asks for to `settle` directly.
   */
  function settleSealed(steps, onDone = null) {
    const hole = box.hole;
    if (!(hole > 0)) {
      settle(steps, onDone);
      return;
    }
    box.setHole(0);
    settle(steps, () => {
      /* Guarded on the hole still being shut: a reader who has since drilled one
         of their own means it, and this is not the place to overrule them. */
      if (box.hole === 0) box.setHole(hole, { rewindow: false });
      if (onDone) onDone();
    });
  }

  /* ------------------------------- the P-V trace ------------------------------- */
  let tracePoints = [];
  let lastTraceVolume = 0;

  function clearTrace() {
    tracePoints = [];
    lastTraceVolume = 0;
  }

  function sampleTrace() {
    if (!running) return;
    const v = box.volume;
    if (!tracePoints.length || Math.abs(v - lastTraceVolume) >= TRACE_MIN_FRACTION * Math.max(lastTraceVolume, 1e-30)) {
      /* Volume, pressure and the window's temperature: the two named laws are
         read off this one path, and the temperature is what tells them apart. */
      tracePoints.push([v, box.pressure(), box.windowTemperature()]);
      lastTraceVolume = v;
      if (tracePoints.length > TRACE_MAX) tracePoints.splice(0, tracePoints.length - TRACE_MAX);
    }
  }

  /* ------------------------------- the lid in hand ------------------------------- */
  /* The lid follows the pointer, one capped step at a time, so the push stays
     gentle enough that the process is reversible - see MAX_LID_MACH. The target
     is kept rather than applied once: the physics owns the pace. */
  let lidTarget = null;
  let lidGrabbing = false;

  const stateFromBox = () => ({
    species: box.speciesKey,
    second: box.secondKey,
    mixFraction: box.mixFraction,
    count: box.n,
    temperature: box.bath,
    crossSection: box.crossSection,
    length: box.lid.x,
    hole: box.hole,
    walls: box.walls,
    lidThermal: box.lidThermal,
    lidMode: box.lid.mode,
    load: box.lid.load,
    external: box.lid.external,
    membrane: box.membrane.present,
    membraneX: box.membrane.x,
    burner: box.burner.on,
    burnerTemperature: box.burner.temperature,
    impacts: box.trackImpacts,
    instruments: apparatus.visualKeys(),
  });

  /**
   * Put the instruments on the stage and frame the stage around them.
   *
   * Called when something has changed, never every frame: framing aims the
   * camera, and a camera re-aimed sixty times a second is a camera fighting the
   * hand that is trying to look at something.
   */
  function syncStage() {
    apparatus.refresh();
    /* Whether a burner stands under the box is the instrument layer's answer,
       and the renderer draws the stand on that while it draws the flame on the
       box's own. Told here rather than in each of the places that put a burner
       out or take one off: this is the one function every change to the stage
       already goes through. */
    renderer.setBurnerPresent(apparatus.has("burner"));
    renderer.frame();
    /* What is holding the lid is one of the things an instrument can change -
       the weights put a load on it - and this control is the only place that is
       written down, so it is re-read here rather than only when its own buttons
       are pressed. */
    leftRail.syncLidMode(box.lid.mode);
  }

  /* ==================================================================================
     THE SESSION
     ================================================================================== */
  let sessionTimer = null;
  let sessionWrittenAt = 0;
  let sessionDirty = false;

  function thermoSession() {
    return {
      version: SESSION_VERSION,
      viewMode: renderer.mode,
      stepsPerFrame,
      speedRamp,
      precision: box.precision,
      labId,
      trace: tracePoints,
      instruments: apparatus.visualKeys(),
      box: box.serialize(),
    };
  }

  function saveSession() {
    if (sessionTimer !== null) { clearTimeout(sessionTimer); sessionTimer = null; }
    if (!sessionDirty) return;
    sessionDirty = false;
    sessionWrittenAt = performance.now();
    try { saveToLocalStorage(SESSION_KEY, thermoSession()); } catch (err) { /* no storage, no session */ }
  }

  function scheduleSessionSave() {
    sessionDirty = true;
    if (sessionTimer !== null) return;
    sessionTimer = setTimeout(saveSession, 250);
  }

  /* ==================================================================================
     THE RAILS
     ================================================================================== */
  /*
   * The flame, in one place.
   *
   * The rail's switch, the instrument launcher and a lab's own setup all mean
   * the same thing by it, and none of them may grow a private version - which is
   * why there is exactly one function that lights it. Lighting it is a
   * *process*, not a re-deal: the gas climbs to the flame over the next windows,
   * and that climb is the experiment.
   *
   * It is the flame and only the flame. The burner it burns at is an instrument
   * of its own, standing on the bench, and it stays there: putting the flame out
   * leaves a burner that is off, which is a thing a bench can be holding, rather
   * than a stage with a hole where the fire was.
   */
  function setFlame(on) {
    box.setBurner(on, box.burner.temperature);
    /* Deliberately not a restage: the burner is where it was and the bench is
       where it was, so the frame loop redraws this on its own - and a restage
       re-frames the camera, which would take away a zoom the reader had made
       every time they flipped a switch. */
    edited();
  }

  /** How hot the flame is, whether or not it is lit: the next thing lit is lit
   *  at this temperature, which is what makes it worth setting while it is out. */
  function setFlameTemperature(T) {
    box.setBurner(box.burner.on, T);
    edited();
  }

  /**
   * The temperature of the air around the box: the gas's other boundary.
   *
   * It is set from the room thermometer's own panel, because that instrument
   * reads exactly this quantity - it stands on the bench clear of the box and
   * reports the room - and a panel that shows a number it can also be asked to
   * hold is one panel rather than two.
   */
  function setSurroundings(T) {
    box.setBath(T);
    edited();
  }

  /**
   * The load on the lid.
   *
   * Raising a load with the lid held by nothing is asking for the load to hold
   * it: the control means what it says rather than needing a second click on a
   * segmented picker to do anything. A weight of nothing is not an instrument
   * either, so the weights leave the stage when the load reaches zero.
   */
  function setLoad(p) {
    box.setLoad(p);
    if (p > 0) {
      if (box.lid.mode !== "load") box.setLidMode("load");
    } else if (box.lid.mode === "load") {
      /* A load of nothing is not a load. Left as it was, a lid in load mode with
         no load on it is a lid the gas pushes out of the box, which is what a
         reader who dragged the load to zero would watch happen next. It goes
         back to being held, exactly as it does when the weights are taken off
         the stage by their own button. */
      lidTarget = null;
      box.setLidMode("fixed");
      box.releaseLid();
    }
    syncStage();
    edited();
  }

  /**
   * The pressure of the air around the box, on the lid's outer face.
   *
   * This is the gauge's own number: the gauge is plumbed to that face, its panel
   * sets what the air there is doing, and the needle points at it, so the dial
   * and the slider are one quantity rather than a setting and a measurement that
   * happen to sit near each other. It is a boundary condition, so it is set and
   * left alone - the gas moving its own lid cannot change what the room is.
   *
   * Nothing about the stage changes with it, so this deliberately does not
   * restage: the instruments are where they were, and the frame is not the
   * camera's chance to take back a zoom. A load is the one that puts iron on the
   * lid, and a load is the weights' own business.
   */
  function setExternal(p) {
    box.setExternal(p);
    edited();
  }

  const leftRail = buildThermoLeftRail(document.getElementById("thermoLeftRail"), {
    onSpecies: (key) => { box.setSpecies(key); edited(); },
    onSecond: (key) => { box.setMixture(key, box.mixFraction); edited(); },
    onMixFraction: (f) => { box.setMixture(box.secondKey, f); edited(); },
    onCount: (n) => { box.setCount(n); edited(); },
    onWidth: (side) => { box.setCrossSection(side); renderer.syncBox(); syncStage(); edited(); },
    onLid: (x) => {
      if (box.lid.mode === "hand") {
        /* Hand mode: the slider is a hand. It sets a target and the physics
           drives the lid there at the gentle cap, so a squeeze made from the
           panel is the same squeeze as one made on the stage - which is what
           lets the P-V trace mean anything. */
        lidTarget = clamp(x, MIN_LENGTH, MAX_LENGTH);
        if (!running) setRunning(true);
      } else if (box.lid.mode === "fixed") {
        /* A held lid is a boundary, not a process: setting it is re-declaring
           the box, so it goes there now. */
        box.placeLid(x);
      }
      edited();
    },
    onLidMode: (mode) => {
      box.setLidMode(mode);
      if (mode !== "hand") { lidTarget = null; box.releaseLid(); }
      /* A lid held by a load is weights standing on the stage, so the two
         instruments that *are* physics can appear from this panel. */
      syncStage();
      edited();
      leftRail.setState(stateFromBox());
    },
    onHole: (r) => { box.setHole(r); edited(); },
    onMembrane: (on) => {
      if (on) {
        box.setMembrane(true, box.membrane.x);
        /* A partition divides the gas, so the gas is dealt into the side it is
           allowed in and the far side becomes the vacuum the expansion needs. */
        box.fill(box.n);
      } else {
        /* Taking it out is the expansion: nothing is added, nothing is
           displaced, and the gas goes where it likes. */
        box.removeMembrane();
        box.markWindow();
      }
      /* Where the partition is only means something while there is one, so the
         rail is told which of the two it is looking at before anything is
         drawn - a slider left dimmed over a partition that is now in place is a
         control that has stopped answering. */
      leftRail.setState(stateFromBox());
      edited();
    },
    onMembraneX: (x) => {
      if (!box.membrane.present) return;
      box.setMembrane(true, x);
      box.fill(box.n);
      edited();
    },
    onWalls: (mode) => { box.setWalls(mode); edited(); },
    onLidThermal: (on) => { box.setLidThermal(on); edited(); },
    onImpacts: (on) => {
      box.setTrackImpacts(on);
      box.clearImpacts();
      renderer.setShowImpacts(on);
      edited();
    },
    onSteps: (n) => { stepsPerFrame = Math.max(1, Math.round(n)); scheduleSessionSave(); },
    onSpeedRamp: (v) => { speedRamp = v; renderer.setSpeedScale(v); scheduleSessionSave(); },
    onPrecision: (p) => { box.setPrecision(p); edited(); },
  });

  const rightRail = buildThermoRightRail(document.getElementById("thermoRightRail"), {
    onClearTrace: () => { clearTrace(); updateReadouts(true); },
    onExportCSV: () => exportTrace(),
    /* The selected instrument's own controls, and the only handles on these
       quantities anywhere in the app: the flame and how hot it is belong to the
       burner, the temperature of the room to the thermometer that stands in it,
       the load to the weights, and the pressure the gauge is reading to the
       gauge - which is why none of them is on the left rail any more. */
    onFlame: (on) => setFlame(on),
    onFlameTemperature: (T) => setFlameTemperature(T),
    onSurroundings: (T) => setSurroundings(T),
    onLoad: (p) => setLoad(p),
    onExternal: (p) => setExternal(p),
    onRemove: (key) => {
      removeInstrument(key);
      /* The panel is about an instrument that is no longer there. */
      if (selectedInstrument === key) selectInstrument(null);
    },
  });

  /* Below the phone breakpoint the two rails are drawers over the stage and
     these are their handles; on anything wider this is inert and the rails are
     the columns they have always been. See frontend/drawer.js. */
  mountStageDrawers(document.getElementById("thermo"), {
    left: document.getElementById("thermoLeftRail"),
    right: document.getElementById("thermoRightRail"),
    labels: { left: "Controls", right: "Readouts" },
    mountIcon,
  });

  function edited() {
    clearTrace();
    /* An edit that re-deals the gas - a new count, a new species, a new width -
       empties the window and stops the clock, so without this the panel would
       print `0.000 MPa` beside a perfectly ordinary temperature until someone
       pressed Run. That state is the one thing on this page that looks broken
       and is not, and it is owed a window; the frame loop pays it back in slices
       so that dragging the slider that caused it stays smooth. */
    if (box.windowTime <= 0) settleLater(warmSteps());
    updateReadouts(true);
    scheduleSessionSave();
  }

  /* ==================================================================================
     THE INSTRUMENTS
     ================================================================================== */
  /**
   * A launcher pill and the strip it opens: the behaviour both corners of the
   * stage share, in one place. A menu opens on its pill, closes on Escape, on a
   * click outside it, and when its own choice is taken.
   */
  function attachMenu({ launcher, toggleButton, panel, label, labelOpen }) {
    let open = false;
    const set = (next, focus) => {
      open = next;
      launcher.classList.toggle("is-open", open);
      toggleButton.setAttribute("aria-expanded", String(open));
      toggleButton.setAttribute("aria-label", open ? labelOpen : label);
      panel.setAttribute("aria-hidden", String(!open));
      if (focus && !open) toggleButton.focus();
    };
    toggleButton.addEventListener("click", () => set(!open));
    document.addEventListener("pointerdown", (event) => {
      if (open && !panel.contains(event.target) && !toggleButton.contains(event.target)) set(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && open) set(false, true);
    });
    return { set, close: (focus) => set(false, focus), isOpen: () => open };
  }

  /* The stage's own left-hand corner: a strip of apparatus you put out one piece
     at a time, which is the one thing a rail cannot be. A flame, a bench, a dial
     and a thermometer stand *around* the box, and no switch in a panel can stand
     a bench on a bench. */
  const instrumentLauncher = document.getElementById("thermoInstrumentLauncher");
  const instrumentToggle = document.getElementById("thermoInstrumentToggle");
  const instrumentPicker = document.getElementById("thermoInstrumentPicker");
  const instrumentMenu = attachMenu({
    launcher: instrumentLauncher, toggleButton: instrumentToggle, panel: instrumentPicker,
    label: "Show the instruments", labelOpen: "Hide the instruments",
  });
  const instrumentButtons = new Map();

  /** Which instrument's settings are on the right rail, or null. */
  let selectedInstrument = null;

  for (const instrument of THERMO_INSTRUMENTS) {
    /* Exactly the shape launcher's own option: the glyph of the thing it puts
       out, then its name, in the same strip in the same corner. An instrument
       is picked the way a shape is picked, so it is picked with the same
       control. */
    const option = document.createElement("button");
    option.className = "shape-option";
    option.type = "button";
    option.title = instrument.note;
    option.setAttribute("aria-label", `${instrument.label}: ${instrument.note}`);
    /* The strip says whether the instrument is on the stage as well as which
       one is being set up: a toggle to the reader, which is what it looks
       like. */
    option.setAttribute("aria-pressed", "false");
    const glyph = document.createElement("span");
    mountIcon(glyph, instrument.icon, { width: 13, height: 13 });
    const label = document.createElement("span");
    label.textContent = instrument.label;
    option.append(glyph, label);
    option.addEventListener("click", () => toggleInstrument(instrument));
    instrumentPicker.appendChild(option);
    instrumentButtons.set(instrument.key, option);
  }

  /**
   * The strip's own gesture: an instrument is put out, or taken off the stage if
   * it is already on it. One click each way, the way the shape strip works, and
   * the accent on the glyph is what says which click it is going to be.
   *
   * The instrument being set up follows the click. Choosing one opens its
   * settings on the right rail and taking it off closes them again, because a
   * panel of controls for something that is not on the stage is a panel about
   * the last thing that was on the stage.
   */
  function toggleInstrument(instrument) {
    if (apparatus.has(instrument.key)) {
      removeInstrument(instrument.key);
      if (selectedInstrument === instrument.key) selectInstrument(null);
    } else {
      placeInstrument(instrument.key);
      selectInstrument(instrument);
    }
    /* The strip shuts on a choice, exactly as the shape strip does. */
    instrumentMenu.close();
  }

  /**
   * Make one instrument's settings the ones the right rail is showing, or an
   * empty panel for null.
   *
   * Reached three ways, which is why it is not part of any of them: a click in
   * the strip, a click on the instrument itself out on the stage, and the rail's
   * own remove button.
   */
  function selectInstrument(instrument) {
    selectedInstrument = instrument?.key ?? null;
    /* Both layers draw the picked thing in the accent, and only one of them owns
       the instrument the click landed on: the apparatus draws the instruments and
       the gas renderer draws the box and the burner. Each is told the *picked
       key*, so picking a second thing takes the outline off the first - a stage
       with three violet outlines on it says nothing about which one the panel
       belongs to. */
    apparatus.setSelected(selectedInstrument);
    renderer.setSelected(selectedInstrument);
    rightRail.setInstrument(instrument ?? null);
    /* Its settings are on the right rail, which scrolls: an instrument whose
       panel is off the top of the screen is an instrument whose click looked
       like it did nothing at all. */
    if (instrument) rightRail.reveal();
    syncInstrumentButtons();
  }

  /**
   * Pick whatever a click out on the stage landed on.
   *
   * An instrument opens its own settings; the *box* is the one thing on this
   * stage that is not an instrument and still worth picking - it is what the
   * whole page is about, and its own controls are in the left rail - so a click
   * on the gas outlines the box and shuts the instrument panel, exactly as a
   * click on the glass behind it does. Nothing is picked at all with nothing
   * under the pointer.
   *
   * @param {string|null} key an instrument key, "box", or null
   */
  function selectSubject(key) {
    if (key === "box") {
      selectedInstrument = null;
      apparatus.setSelected(null);
      renderer.setSelected("box");
      rightRail.setInstrument(null);
      syncInstrumentButtons();
      return;
    }
    selectInstrument(key ? THERMO_INSTRUMENTS.find((i) => i.key === key) ?? null : null);
  }

  /**
   * Put an instrument on the stage.
   *
   * The two physical ones go through the box, because that is what they are: a
   * burner is a lit flame and a weight is a lid resting on a load, so the picker
   * and the panel's own controls are two handles on one thing. The rest are the
   * stage's furniture and are kept in the apparatus layer's own list - and none
   * of the three of them clears the P-V trace, because none of them is an
   * experiment.
   */
  function placeInstrument(key) {
    if (key === "burner") {
      /* A burner arrives lit, because what the strip offers is gas burning under
         this box and a burner nobody has lit yet is not yet that. It is the
         flame that is the box's business; the stand is apparatus, and it is what
         stays behind when the flame is put out. */
      apparatus.toggleVisual("burner", true);
      setFlame(true);
      /* The bench stands a burner's height lower with one on it, so the stage
         has to be re-laid out and re-framed. */
      syncStage();
      return;
    }
    if (key === "weights") {
      /* A weight of nothing is not an instrument: putting one on the lid has to
         put a load on it, and the panel's slider is there to change how much. */
      if (!(box.lid.load > 0)) box.setLoad(1.3e6);
      box.setLidMode("load");
      syncStage();
      edited();
      return;
    }
    apparatus.toggleVisual(key, true);
    syncStage();
    updateReadouts(true);
    scheduleSessionSave();
  }

  /** Take an instrument off the stage, whatever kind of instrument it is. */
  function removeInstrument(key) {
    if (key === "burner") {
      /* Taking the burner off takes its flame with it: there is no gas burning
         over nothing, and a flame left standing in mid-air would be the picture
         of the instrument that has just left the stage. */
      setFlame(false);
      apparatus.toggleVisual("burner", false);
      syncStage();
      return;
    }
    if (key === "weights") {
      box.setLoad(0);
      if (box.lid.mode === "load") box.setLidMode("fixed");
      syncStage();
      edited();
      return;
    }
    apparatus.toggleVisual(key, false);
    syncStage();
    updateReadouts(true);
    scheduleSessionSave();
  }

  /* Which instruments are on the stage is something several places can change -
     this strip, the box itself, a lab - so the options read it back off the
     apparatus rather than being pushed at by each of them, and the two can
     never drift. A handful of class toggles against the work a frame already
     does is nothing. */
  function syncInstrumentButtons() {
    for (const [key, button] of instrumentButtons) {
      const on = apparatus.has(key);
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
      button.setAttribute("aria-current", key === selectedInstrument ? "true" : "false");
    }
  }

  /* ==================================================================================
     THE LAB BENCH
     ================================================================================== */
  const labCard = createLabCard(document.getElementById("thermoViewport"));
  const labLauncher = document.getElementById("thermoLabLauncher");
  const labToggle = document.getElementById("thermoLabLauncherToggle");
  const labPicker = document.getElementById("thermoLabPicker");
  const labRows = new Map();

  const labMenu = attachMenu({
    launcher: labLauncher, toggleButton: labToggle, panel: labPicker,
    label: "Show the lab bench", labelOpen: "Hide the lab bench",
  });

  for (const lab of THERMO_LABS) {
    const row = document.createElement("button");
    row.className = "lab-row";
    row.type = "button";
    const name = document.createElement("span");
    name.className = "lab-row-name";
    name.textContent = lab.name;
    const aim = document.createElement("span");
    aim.className = "lab-row-aim";
    aim.textContent = lab.aim;
    row.append(name, aim);
    row.addEventListener("click", () => { applyLab(lab.id); labMenu.close(true); });
    labPicker.appendChild(row);
    labRows.set(lab.id, row);
  }

  /* ==================================================================================
     APPLYING A STATE
     ================================================================================== */
  /**
   * Make the box be this. Raw fields first, then one fill: every setter that
   * refills would otherwise deal the gas several times over and reset the books
   * between the deals.
   */
  /**
   * How many steps of gas are worth running before the panel is allowed to show
   * a number.
   *
   * Pressure is a rate - momentum collected per unit area per unit time - so it
   * does not exist until a window of time has gone by, and a box that has been
   * built but not run would report a pressure of zero sitting next to a
   * perfectly ordinary temperature. Three measurement windows, capped, is enough
   * for a pressure to two or three percent and costs a few milliseconds.
   */
  function warmSteps() {
    /* Two whole windows, less the one step that would roll the last of them over
       and empty it. The first window is the one the gas was dealt into: it is
       spent melting the lattice `fill` laid the molecules out on, and whatever
       it reports is a transient. The second is the measurement, and it is the
       one the panel reads - a full window's worth of samples taken from steady
       gas.

       This number used to be eight. It was measured down to two on the real
       box: eight independent deals at 1400 molecules were run for one window and
       for eight, and the readings differed by 3.8% - which is the size of the
       spread between any two windows at all (the standard error of each arm was
       about 1%, and the eight-window arm's own readings ranged over 9%). The
       panel prints three decimals of a number whose window-to-window spread is a
       few percent, so windows three to eight were buying precision that the
       readout cannot show, at 390ms of blocked main thread on a cold page load.
       Two windows is the honest reserve: one to forget the lattice, one to
       measure. */
    const perWindow = Math.max(1, Math.round(WINDOW_DURATION / box.dt));
    return Math.min(3000, perWindow * 2 - 1);
  }

  function applyState(state, { keepTrace = false } = {}) {
    const s = { ...DEFAULT_STATE, ...state };
    box.speciesKey = speciesOf(s.species).key;
    box.secondKey = s.second ? speciesOf(s.second).key : null;
    box.mixFraction = clamp(s.mixFraction, 0, 1);
    box.bath = Math.max(1, s.temperature);
    box.crossSection = clamp(s.crossSection, MIN_LENGTH, MAX_LENGTH);
    box.walls = s.walls === "elastic" ? "elastic" : "thermal";
    box.lidThermal = s.lidThermal !== false;
    /* The flame is lit *after* the warm-up below, and deliberately not before
       it. The warm-up is how a new box gets a pressure window, and a box that
       heats itself during its own settling is an experiment that has already
       been running without you: a Charles's-law lab would open with the gas
       already hot and already expanded, with the one thing it asks you to watch
       already over. So the flame's temperature is set now - the step has to be
       fine enough for the fastest molecules it will make - and the flame itself
       is lit once the gas has settled at the air's temperature. */
    box.burner.temperature = clamp(s.burnerTemperature ?? 900, 1, 20000);
    box.burner.on = false;
    box.lid.mode = s.lidMode === "hand" || s.lidMode === "load" ? s.lidMode : "fixed";
    box.lid.velocity = 0;
    box.lid.x = clamp(s.length, MIN_LENGTH, MAX_LENGTH);
    box.lid.load = Math.max(0, s.load ?? 0);
    /* The air around the box is part of the state, not something that stays
       behind: a lab with its own pressure is a box in a different room. */
    box.lid.external = Math.max(0, s.external ?? 0);
    /* The lid has to be where the state says before anything fills the box, and
       the partition has to be in before it too - a gas is dealt into the space
       it is allowed to occupy. */
    box.setMembrane(!!s.membrane, s.membraneX ?? s.length / 2);
    /* The hole is deliberately left shut for the warm-up and opened after it.
       A window measured through an open hole has already let a tenth of the gas
       out by the time anyone presses Run - 274 of the effusion lab's 2600
       molecules - and "what has left the box" starting at 274 is not the
       experiment that lab asks for. The cost is one window of pressure measured
       on a sealed face, which the hole moves by well under the spread the panel
       already quotes. */
    box.setHole(0);
    box.stepLocked = false;
    box.windowDuration = WINDOW_DURATION;
    box.updateStep();
    box.fill(clamp(Math.round(s.count), MIN_MOLECULES, MAX_MOLECULES));
    box.markWindow();
    /* The gas has been sitting in the box since before anyone looked at it: the
       settle is what makes the first thing the panel says a measurement rather
       than a zero. The window is deliberately *not* re-marked afterwards -
       marking it is what empties it, and an empty window is the zero again. */
    settle(warmSteps(), () => {
      /* The pinhole opens once the gas has settled. Guarded on the hole still
         being shut: a reader who has since drilled one of their own means it, and
         this is not the place to overrule them. */
      if (s.hole && box.hole === 0) box.setHole(s.hole, { rewindow: false });
      /* And the run is anchored here rather than when the box was dealt, because
         the pinhole is part of the box a run begins in: anchored before the
         settle, a restart of the effusion lab would come back to a sealed one,
         with the experiment it exists for quietly closed. */
      markRunStart();
    });
    box.setBurner(!!s.burner, box.burner.temperature);
    box.setTrackImpacts(!!s.impacts);
    box.clearImpacts();
    renderer.setShowImpacts(!!s.impacts);

    /* What someone put on the bench comes back with the box, before the box is
       drawn. The weights are already on the stage by now - they came back with
       the load above - and a state that asks for a flame gets the burner that
       holds it, because a state written before the burner was an instrument of
       its own would otherwise light a fire on nothing. */
    apparatus.setVisual(Array.isArray(s.instruments) ? s.instruments : DEFAULT_STATE.instruments);

    lidTarget = null;
    if (!keepTrace) clearTrace();
    leftRail.setState(stateFromBox());
    renderer.syncBox();
    syncStage();
  }

  function applyLab(id) {
    const lab = THERMO_LABS.find((l) => l.id === id);
    if (!lab) return;
    labId = lab.id;
    applyState(lab.state);
    labCard.setLab(lab);
    for (const [rowId, row] of labRows) row.classList.toggle("on", rowId === id);
    /* A lab opens paused on a scene already set up: the first thing to do with a
       new experiment is look at it. */
    setRunning(false);
    markRunStart();
    /* A lab opens on the rail it opened for: the panel is not left to catch up
       on the next frame that happens to be a rail frame. */
    updateReadouts(true);
    scheduleSessionSave();
  }

  function clearBench() {
    labId = null;
    /* A cleared bench is a bench nobody is working on, so nothing is selected
       either: an instrument's settings on the rail with the instrument gone is
       a panel about the last experiment rather than about this one. */
    selectedInstrument = null;
    apparatus.setSelected(null);
    renderer.setSelected(null);
    rightRail.setInstrument(null);
    /* The timeline is part of the bench, not a property of the gas, so it is not
       in the box's state and `applyState` cannot put it back. Cleared by hand,
       before the box is dealt: the resolution is the step length the settle is
       about to run at, and setting it afterwards would leave the first window
       measured at the rate the last experiment was using. */
    box.setPrecision(1);
    stepsPerFrame = 6;
    speedRamp = 1;
    renderer.setSpeedScale(speedRamp);
    leftRail.syncTimeline({ steps: stepsPerFrame, ramp: speedRamp, resolution: box.precision });
    applyState(DEFAULT_STATE);
    labCard.hide();
    for (const row of labRows.values()) row.classList.remove("on");
    setRunning(false);
    markRunStart();
    updateReadouts(true);
    scheduleSessionSave();
  }

  /* ==================================================================================
     RUN / PAUSE / STEP / RESTART
     ================================================================================== */
  let runStart = null;
  const runBtn = document.getElementById("thermoRunBtn");
  const runBtnIcon = runBtn.querySelector(".run-btn-icon");
  const runBtnLabel = runBtn.querySelector(".run-btn-label");
  const restartBtn = document.getElementById("thermoRestartBtn");

  function syncRunButton() {
    mountIcon(runBtnIcon, running ? "Pause" : "Play");
    runBtnLabel.textContent = running ? "Pause" : "Run";
    runBtn.classList.toggle("paused", !running);
    document.getElementById("thermoStatusDot").classList.toggle("live", running);
    document.getElementById("thermoStatusText").textContent = running ? "running" : "paused";
  }

  function setRunning(on) {
    if (running === on) return;
    running = on;
    syncRunButton();
  }

  function syncRestartButton() {
    restartBtn.disabled = runStart === null;
  }

  /** Where a run begins: the box as it is now, and the trace it had at the top. */
  function markRunStart() {
    runStart = {
      box: box.serialize(),
      labId,
      instruments: apparatus.visualKeys(),
      trace: tracePoints.map((p) => [...p]),
    };
    syncRestartButton();
  }

  /**
   * One frame of watching: the gas's own clock, cut into steps.
   *
   * The lid is driven before each step rather than once a frame, so a hand that
   * is holding it is holding it on the same timeline the molecules live on - a
   * lid that jumped six steps' worth between steps would be a hammer, not a
   * hand, and would show up in the ledger as exactly that.
   */
  function advance(steps) {
    const driving = lidTarget !== null && box.lid.mode === "hand";
    for (let i = 0; i < steps; i++) {
      if (driving) box.setLid(lidTarget, box.dt);
      box.step();
      if (box.n === 0) break;
    }
  }

  function stepOnce() {
    setRunning(false);
    advance(stepsPerFrame);
    updateReadouts(true);
  }

  function restartRun() {
    if (!runStart) return;
    setRunning(false);
    box.restore(runStart.box);
    box.windowDuration = WINDOW_DURATION;
    box.markWindow();
    /* Back to a box with nothing behind it, so back to owing it a window: a
       restart that left the panel reading zero would be a restart that looked
       like a different bug. Sealed, because the box a run began in is the one
       the anchor above holds - pinhole and all. */
    settleSealed(warmSteps());
    labId = runStart.labId;
    apparatus.setVisual(runStart.instruments ?? DEFAULT_STATE.instruments);
    tracePoints = runStart.trace.map((p) => [...p]);
    lastTraceVolume = tracePoints.length ? tracePoints[tracePoints.length - 1][0] : 0;
    lidTarget = null;
    leftRail.setState(stateFromBox());
    renderer.syncBox();
    syncStage();
    updateReadouts(true);
    scheduleSessionSave();
  }

  runBtn.addEventListener("click", () => setRunning(!running));
  document.getElementById("thermoStepBtn").addEventListener("click", () => stepOnce());
  restartBtn.addEventListener("click", () => restartRun());
  document.getElementById("thermoResetBtn").addEventListener("click", () => clearBench());

  document.getElementById("thermoSaveBtn").addEventListener("click", () => {
    downloadJSON(`thermo-workbench-checkpoint-${Date.now()}.json`, box.serialize());
  });
  document.getElementById("thermoLoadBtn").addEventListener("click", async () => {
    const data = await uploadJSONFile();
    if (!data) return;
    box.restore(data);
    box.windowDuration = WINDOW_DURATION;
    box.markWindow();
    settleSealed(warmSteps(), markRunStart);
    lidTarget = null;
    clearTrace();
    leftRail.setState(stateFromBox());
    renderer.syncBox();
    syncStage();
    setRunning(false);
    markRunStart();
    updateReadouts(true);
    scheduleSessionSave();
  });

  function exportTrace() {
    downloadCSV(
      `thermo-pv-trace-${Date.now()}.csv`,
      ["volume_m3", "pressure_Pa", "temperature_K"],
      tracePoints.map(([v, p, T]) => [v, p, T ?? ""]),
    );
  }

  /* ==================================================================================
     VIEW MODE
     ================================================================================== */
  const viewToggle = document.getElementById("thermoViewToggle");
  viewToggle.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      viewToggle.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      setViewMode(b.dataset.mode);
      /* Which view someone works in is a choice about their bench, so it is
         written down the moment it is made - but only when it *was* a choice,
         which is why this is here and not inside setViewMode: the mode is also
         set while a session is being restored, and a restore is not an edit. */
      scheduleSessionSave();
    });
  });

  function setViewMode(mode) {
    renderer.setViewMode(mode);
    renderer.resize();
    renderer.frame();
    /* The 2D view is a fixed orthographic look at the box: a triad there would
       report an orientation the reader cannot change, so it goes away with the
       orbit. */
    if (axisGizmo?.element) axisGizmo.element.style.display = mode === "2d" ? "none" : "";
    for (const b of viewToggle.querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === mode);
    const hint = document.getElementById("thermoStageHint");
    if (hint) hint.textContent = mode === "2d" ? "Drag to pan · scroll to zoom" : "Drag to orbit · scroll to zoom";
  }

  /* The stage answers a wheel and a pinch already; these two are the same
     gesture for someone who is not holding one. The renderer decides which
     camera they drive, so the pair means the same thing in both views, and the
     wheel's own limits are what they stop at. A step is symmetric - out by a
     fifth, back in by the fourth that undoes it.

     Scoped to this shell: both benches are in the markup at once, and a button
     that moved the camera of the bench behind this one would be a control that
     works and does nothing. */
  const ZOOM_STEP = 0.8;
  for (const b of document.querySelectorAll("#thermo [data-zoom]")) {
    b.addEventListener("click", () => {
      renderer.zoom(b.dataset.zoom === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
    });
  }

  /* The camera only takes a drag that is not on the lid: a press that lands on
     the lid is for moving the lid, and the camera sits that gesture out. */
  const vetoCamera = (e) => !nearLid(e.clientX, e.clientY);
  renderer.orbit.canDrag = vetoCamera;
  renderer.pan2d.canDrag = vetoCamera;

  function nearLid(clientX, clientY) {
    if (box.lid.mode !== "hand") return false;
    const info = renderer.lidScreenInfo();
    const top = Math.min(info.top, info.bottom) - LID_GRAB_PX;
    const bottom = Math.max(info.top, info.bottom) + LID_GRAB_PX;
    return Math.abs(clientX - info.x) <= LID_GRAB_PX && clientY >= top && clientY <= bottom;
  }

  /* ------------------------ what a click on the stage is on ------------------------ */
  /* The instruments are objects standing on a bench, so the other way to ask about
     one - the short way, and the one the shape bench already taught - is to point at
     it. A click that lands on the dial, the pipe feeding it, the board or the flame
     opens that instrument's settings on the right rail, and a click on the glass
     shuts the panel again. */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  /* Every object here wears a hairline, and a hairline is a line: a raycaster's
     default reach for a line is a whole world unit, so without this a click a box
     away would count as a click on the dial. The outlines are still pickable, by a
     hair's breadth, which is the tolerance a hair deserves. */
  raycaster.params.Line.threshold = 0.01;

  /**
   * What is under a point on the canvas: an instrument key, "box", or null.
   *
   * Asked in two passes, and the order is the whole of the reason it is written
   * out. Everything standing on the stage is asked first, and the box second, so
   * a click meant for the burner lands on the burner even though the flame is
   * under the box and seen through its own floor: the box is a big translucent
   * thing with a face between the eye and nearly every part of the stage below
   * it, so on depth alone it would take every click down there. The box is the
   * last resort rather than the nearest thing, and it is still the thing a click
   * on the gas itself finds, because there is nothing else under the pointer
   * there.
   */
  function instrumentAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, renderer.mode === "2d" ? renderer.camera2d : renderer.camera3d);

    const targets = apparatus.pickables();
    /* The flame is drawn by the gas renderer rather than by the apparatus, and it
       is only there while it is lit. */
    if (apparatus.has("burner")) targets.push({ key: "burner", object: renderer.burnerGroup });
    /* And the box: the one thing on this stage that is not an instrument and is
       still picked, because a reader who points at the gas is pointing at the box
       the whole page is about. */
    const boxes = renderer.boxTargets().map((object) => ({ key: "box", object }));

    /* Which of a list owns what is under the pointer: the nearest thing hit, then
       the instrument that owns it - a gauge's case, its rim, the print in it and
       the pipe under it are one instrument. */
    const pickFrom = (list) => {
      if (!list.length) return null;
      const hits = raycaster.intersectObjects(list.map((t) => t.object), true);
      if (!hits.length) return null;
      for (let node = hits[0].object; node; node = node.parent) {
        const owner = list.find((t) => t.object === node);
        if (owner) return owner.key;
      }
      return null;
    };
    return pickFrom(targets) ?? pickFrom(boxes);
  }

  /* Whether the press now in flight began on the stage. A press that began on a
     pill or a rail is not a click on the stage, however close to it it ends. */
  let pressedOnStage = false;

  canvas.addEventListener("pointerdown", (e) => {
    pressedOnStage = e.button === 0;
    if (e.button !== 0 || !nearLid(e.clientX, e.clientY)) return;
    const x = renderer.lidPointerX(e.clientX, e.clientY);
    if (x === null || !Number.isFinite(x)) return;
    pressedOnStage = false;
    lidGrabbing = true;
    lidTarget = x;
    canvas.classList.add("lid-dragging");
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* no capture, still drags */ }
    if (!running) setRunning(true);
    e.preventDefault();
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("pointermove", (e) => {
    if (lidGrabbing) {
      const x = renderer.lidPointerX(e.clientX, e.clientY);
      if (x !== null && Number.isFinite(x)) lidTarget = x;
      return;
    }
    const lid = nearLid(e.clientX, e.clientY);
    canvas.classList.toggle("lid-hover", lid);
    /* An instrument under the pointer that can be opened: the cursor says so before
       the press is committed to it. */
    canvas.classList.toggle("instrument-hover", !lid && instrumentAt(e.clientX, e.clientY) !== null);
  });
  window.addEventListener("pointerup", (e) => {
    const onStage = pressedOnStage;
    pressedOnStage = false;
    if (lidGrabbing) {
      lidGrabbing = false;
      lidTarget = null;
      box.releaseLid();
      canvas.classList.remove("lid-dragging");
      scheduleSessionSave();
      return;
    }
    /* A click and not an orbit: the camera's own test is the one that knows the
       difference, and the press has to have begun on the stage to count at all. */
    if (!onStage || e.button !== 0 || e.target !== canvas) return;
    const controller = renderer.mode === "2d" ? renderer.pan2d : renderer.orbit;
    if (!controller.wasClick(e)) return;
    selectSubject(instrumentAt(e.clientX, e.clientY));
  });

  /* ==================================================================================
     READING OUT
     ================================================================================== */
  /*
   * The frame's own readout, in two parts, because they cost two different
   * things.
   *
   * The clock and the lid are two writes each, and they are worth making every
   * frame. The rail is a page of readouts, a speed histogram, a P-V chart and an
   * energy chart - several hundred microseconds of counting and two canvas
   * redraws - and redrawing all of that sixty times a second buys nothing that
   * can be seen: it is the same picture, and any number that moved between two
   * of those redraws moved by less than the last digit on screen. Ten times a
   * second is faster than anyone reads a number, and it takes that cost off
   * fifty frames in sixty.
   *
   * `force` is for the callers whose whole point is that the panel should now
   * say something new: an edit, a step, a lab, a restored page. Those are the
   * moments a reader is looking at the rail, and they are not sixty a second.
   */
  const READOUT_INTERVAL = 100; // ms
  let readoutAt = -Infinity;

  function updateReadouts(force = false) {
    renderer.syncLid();
    leftRail.setLive({
      dt: box.dt,
      rmsSpeed: box.rmsSpeed(),
      diameter: speciesOf(box.speciesKey).diameter,
      stepsPerFrame,
    });
    /* The slider follows the lid whenever the lid is not being aimed by the
       slider itself: a load-driven lid drifts and a dragged one moves under the
       hand, and both are worth seeing in the panel. */
    if (box.lid.mode === "load" || lidTarget === null || lidGrabbing) leftRail.syncLid(box.lid.x);

    syncInstrumentButtons();
    document.getElementById("thermoSbFrame").textContent = box.steps;
    document.getElementById("thermoSbTime").textContent = formatGasTime(box.time);
    document.getElementById("thermoSbRuntime").textContent = `${stepMs.toFixed(2)}ms`;
    document.getElementById("thermoSbMolecules").textContent = `${box.n} molecules`;

    const now = performance.now();
    if (!force && now - readoutAt < READOUT_INTERVAL) return;
    readoutAt = now;
    const o = box.observe();
    rightRail.update(o, box, tracePoints);
  }

  /* ==================================================================================
     PAGES - independent, savable boxes
     ================================================================================== */
  let pages = [];
  let activePageId = null;
  let pageIdCounter = 0;
  const pageTabs = document.getElementById("thermoPagebarTabs");

  function makePage() {
    pageIdCounter++;
    return {
      id: `page-${pageIdCounter}`,
      autoNamed: true,
      name: `Page ${pages.filter((p) => p.autoNamed).length + 1}`,
      snapshot: null,
      labId: null,
      instruments: [],
      trace: [],
    };
  }

  function renumberAutoPages() {
    let n = 0;
    for (const page of pages) if (page.autoNamed) page.name = `Page ${++n}`;
  }

  const activePage = () => pages.find((p) => p.id === activePageId);

  function saveIntoActivePage() {
    const page = activePage();
    if (!page) return;
    page.snapshot = box.serialize();
    page.labId = labId;
    page.instruments = apparatus.visualKeys();
    page.trace = tracePoints.map((p) => [...p]);
  }

  function loadPage(id) {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    if (page.snapshot) box.restore(page.snapshot);
    box.windowDuration = WINDOW_DURATION;
    box.markWindow();
    settleSealed(warmSteps(), markRunStart);
    labId = page.labId;
    apparatus.setVisual(Array.isArray(page.instruments) ? page.instruments : DEFAULT_STATE.instruments);
    tracePoints = page.trace.map((p) => [...p]);
    lastTraceVolume = tracePoints.length ? tracePoints[tracePoints.length - 1][0] : 0;
    lidTarget = null;
    leftRail.setState(stateFromBox());
    labCard.setLab(THERMO_LABS.find((l) => l.id === labId) ?? null);
    for (const [rowId, row] of labRows) row.classList.toggle("on", rowId === labId);
    renderer.syncBox();
    syncStage();
    setRunning(false);
    markRunStart();
    updateReadouts(true);
  }

  function renderPageTabs() {
    pageTabs.innerHTML = "";
    for (const page of pages) {
      const tab = document.createElement("div");
      tab.className = `page-tab${page.id === activePageId ? " active" : ""}`;
      const label = document.createElement("span");
      label.textContent = page.name;
      label.addEventListener("dblclick", (e) => {
        e.stopPropagation();
        const input = document.createElement("input");
        input.value = page.name;
        input.size = Math.max(4, page.name.length);
        label.replaceWith(input);
        input.focus(); input.select();
        const commit = () => {
          if (input.value.trim()) { page.name = input.value.trim(); page.autoNamed = false; }
          renderPageTabs();
        };
        input.addEventListener("blur", commit);
        input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") input.blur(); });
      });
      tab.appendChild(label);
      if (pages.length > 1) {
        const closeBtn = document.createElement("button");
        closeBtn.className = "close-btn";
        closeBtn.setAttribute("aria-label", `Close ${page.name}`);
        mountIcon(closeBtn, "X");
        closeBtn.addEventListener("click", (e) => { e.stopPropagation(); closePage(page.id); });
        tab.appendChild(closeBtn);
      }
      tab.addEventListener("click", () => switchToPage(page.id));
      pageTabs.appendChild(tab);
    }
  }

  function switchToPage(id) {
    if (id === activePageId) return;
    saveIntoActivePage();
    activePageId = id;
    loadPage(id);
    renderPageTabs();
    scheduleSessionSave();
  }

  function addPage() {
    saveIntoActivePage();
    const page = makePage();
    pages.push(page);
    renumberAutoPages();
    activePageId = page.id;
    loadPage(page.id);
    renderPageTabs();
    scheduleSessionSave();
  }

  function closePage(id) {
    if (pages.length <= 1) return;
    const idx = pages.findIndex((p) => p.id === id);
    if (idx === -1) return;
    pages.splice(idx, 1);
    renumberAutoPages();
    if (id === activePageId) {
      const next = pages[Math.max(0, idx - 1)];
      activePageId = next.id;
      loadPage(next.id);
    }
    renderPageTabs();
    scheduleSessionSave();
  }

  document.getElementById("thermoAddPageBtn").addEventListener("click", addPage);
  const firstPage = makePage();
  pages.push(firstPage);
  renumberAutoPages();
  activePageId = firstPage.id;
  renderPageTabs();

  /* ==================================================================================
     RESIZE + THE FRAME LOOP
     ================================================================================== */
  /* The two charts are sized from the rail's own width, and the rail's width
     changes when the window does - so the same event redraws both. The canvases
     are let out to their real pixel size here rather than every frame: a canvas
     that is resized clears itself, and a chart that blanked sixty times a second
     would be a strobe. */
  function resize() {
    renderer.resize();
    rightRail.fit();
  }
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { renderer.resize(); rightRail.fit(); })
      .observe(document.getElementById("thermoViewport"));
  }

  function frameLoop() {
    requestAnimationFrame(frameLoop);
    /* The Dynamics workbench may own the screen right now: keep the box and the
       clock, stop drawing, and do not step a gas nobody is looking at. A settle
       owed to the box waits here with it, for the same reason: it is the gas's
       own clock it is spending. */
    if (document.getElementById("thermo")?.hidden) return;
    paySettle();
    /* Mid-settle the box is half a measurement old, and drawing it would show
       gas in motion on a paused bench - which is precisely the thing the
       bench is not allowed to do. The frame after the last slice paints it. */
    if (settleRemaining > 0 && !running) return;
    if (running) {
      const t0 = performance.now();
      advance(stepsPerFrame);
      stepMs += ((performance.now() - t0) - stepMs) * 0.15;
      sampleTrace();
      sessionDirty = true;
    }
    /* The flame flickers whether or not the gas is running - it is outside the
       physics - but the sparks stop when the clock does, because they are on
       it. The instruments follow the box, which is why they are updated here
       with the rest of the picture rather than when they were put out. */
    const seconds = performance.now() / 1000;
    renderer.updateBurner(seconds);
    renderer.updateImpacts();
    /* The instruments are not turned to face anybody: they stand in the same
       plane the box's own front face is in and stay there, so the 3D view can
       be walked round them and the 2D view is a view of their front. */
    apparatus.update(seconds);
    renderer.updateMolecules();
    renderer.render();
    updateReadouts();
    if (performance.now() - sessionWrittenAt >= SESSION_SAVE_EVERY) saveSession();
  }

  /* ==================================================================================
     PUTTING IT BACK
     ================================================================================== */
  function applySession() {
    let saved = null;
    try { saved = loadFromLocalStorage(SESSION_KEY); } catch (err) { saved = null; }
    if (!saved || saved.version !== SESSION_VERSION || !saved.box) return false;

    box.restore(saved.box);
    box.windowDuration = WINDOW_DURATION;
    box.markWindow();
    /* A session written before the instruments existed has nothing to say about
       them, so it gets the box the workbench opens with - a bench and the two
       dials - rather than an empty stage that would look like something had
       been lost. */
    apparatus.setVisual(Array.isArray(saved.instruments) ? saved.instruments : DEFAULT_STATE.instruments);
    if (saved.precision) { box.precision = saved.precision; box.stepLocked = false; box.updateStep(); }
    if (saved.stepsPerFrame) stepsPerFrame = clamp(Math.round(saved.stepsPerFrame), 1, 24);
    /* A restored box has just had its counters emptied by markWindow, so without
       this the pressure, the collision rate and the impact rate would all read
       zero beside a perfectly ordinary temperature until someone pressed Run -
       the one state on this page that looks broken and is not. Same settle a
       fresh box gets, and it happens before the run is anchored below, so the
       restored run's ledger still starts at zero. */
    settleSealed(warmSteps());
    if (saved.speedRamp) { speedRamp = saved.speedRamp; renderer.setSpeedScale(speedRamp); }
    labId = saved.labId ?? null;
    tracePoints = Array.isArray(saved.trace) ? saved.trace.map((p) => [...p]) : [];
    lastTraceVolume = tracePoints.length ? tracePoints[tracePoints.length - 1][0] : 0;

    leftRail.setState(stateFromBox());
    leftRail.syncSteps(stepsPerFrame);
    labCard.setLab(THERMO_LABS.find((l) => l.id === labId) ?? null);
    for (const [rowId, row] of labRows) row.classList.toggle("on", rowId === labId);
    setViewMode(saved.viewMode === "2d" ? "2d" : "3d");
    renderer.syncBox();
    syncStage();
    saveIntoActivePage();
    setRunning(false);
    markRunStart();
    updateReadouts(true);

    document.getElementById("thermoSessionNote")?.classList.remove("is-hidden");
    return true;
  }

  function discardSession() {
    document.getElementById("thermoSessionNote")?.classList.add("is-hidden");
    box.precision = 1;
    clearBench();
    saveSession();
  }

  document.getElementById("thermoSessionDiscardBtn")?.addEventListener("click", discardSession);
  document.getElementById("thermoSessionNoteClose")?.addEventListener("click", () => {
    document.getElementById("thermoSessionNote")?.classList.add("is-hidden");
  });
  window.addEventListener("pagehide", saveSession);
  window.addEventListener("beforeunload", saveSession);

  document.getElementById("thermoBackHomeBtn")?.addEventListener("click", () => {
    /* The shell is a real subpage, so leaving it is the router's business -
       frontend/home.js owns the history stack. A plain click on Back is
       handled there; here we only make sure the work is written first. */
    saveSession();
  });

  /* ----------------------------------- boot ----------------------------------- */
  setViewMode("3d");
  leftRail.setState(stateFromBox());
  rightRail.setInstrument(null);
  leftRail.syncSteps(stepsPerFrame);
  renderer.setSpeedScale(speedRamp);
  renderer.frame();
  rightRail.fit();
  /* A refreshed gas, settled here and now: the first frame this page paints is
     one of gas already at its own equilibrium, with the clock stopped and
     nothing left to pay back. Whatever the session or the lab that follows asks
     for replaces this settle; see `settle`. */
  settleSealed(warmSteps());
  syncRunButton();
  syncRestartButton();
  markRunStart();
  restoreSession();
  requestAnimationFrame(frameLoop);

  function restoreSession() {
    try {
      if (!applySession()) return;
    } catch (err) {
      console.warn("could not restore the last thermo scene", err);
    }
  }

  document.getElementById("thermoStatusText").textContent = "paused";

  window.__workbench = {
    box, renderer, apparatus, labs: THERMO_LABS, instruments: THERMO_INSTRUMENTS,
    applyLab, applyState, stateFromBox, syncStage,
    selectInstrument, selectSubject, placeInstrument, removeInstrument,
    toggleInstrument, setRunning, setViewMode, advance, stepOnce,
    get running() { return running; },
    get trace() { return tracePoints; },
    get labId() { return labId; },
    get selected() { return selectedInstrument; },
  };
}
