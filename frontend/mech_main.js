/**
 * frontend/mech_main.js - the Vibrations workbench.
 *
 * The counterpart of frontend/main.js and frontend/thermo_main.js, and
 * deliberately built from the same furniture: the same title bar, the same two
 * rails, the same page bar, the same session that puts the experiment back after
 * a reload, the same two launchers in the same two corners of the stage. What is
 * different is what the panels say and what the stage holds - a chain of masses
 * on springs rather than a bench of shapes or a box of gas - and that lives in
 * simulation/mech_system.js, rendering/mech_renderer.js and frontend/mech_ui.js.
 * This file is the wiring between them.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE OWNS THAT THE OTHER TWO DO NOT
 * ---------------------------------------------------------------------------
 * A recorder. The thing a vibration bench is *for* is comparing a response with
 * what the transfer function says it should be, and that comparison needs a
 * moment of the response to measure: this keeps the last few thousandths of a
 * minute of the output in a ring buffer, measures the amplitude of its last few
 * cycles, and asks the system what the theory says. Both numbers land on the
 * panel beside each other and both are drawn on the chart, which is the whole
 * experiment - not a scope trace, an experiment.
 *
 * It also owns the one gesture the stage has: dragging a mass and letting go. A
 * plucked system is the oldest experiment in the subject and it needs no panel
 * at all - pull a block aside and watch - so that is what a drag on a block does,
 * and the run starts itself so that letting go is all it takes.
 *
 * The step size is *not* an accuracy setting here, and the panel says so:
 * simulation/mech_system.js advances the state by the exact solution of the
 * equations, so the step decides how finely the answer is reported and never how
 * right it is. A step of a two-hundredth of a second and a step of a millionth
 * produce the same trajectory, and experiments/mech_checks.js holds that claim.
 */
import {
  createElement, ArrowLeft, Box, Square, Download, Upload, Eraser, RotateCcw,
  StepForward, Play, Pause, Plus, Minus, X, FlaskConical, Zap, Vibrate, Gauge,
  Wrench, Boxes, Spline, Disc3, Unplug, Lock, LockOpen,
  /* the systems strip's own glyphs: one outline per rig, so a system is
     recognised by its shape the way a shape is on the other bench */
  Car, Layers, AlignHorizontalDistributeCenter, ArrowLeftRight, Blocks, Target,
  ChevronLeft, ChevronRight,
} from "lucide";
import { MechSystem, subscript } from "../simulation/mech_system.js";
import { mountStageDrawers } from "./drawer.js";
import { MechRenderer } from "../rendering/mech_renderer.js";
import { buildMechLeftRail, buildMechRightRail, polynomialString } from "./mech_ui.js";
import { MECH_LABS } from "./mech_labs.js";
import { MECH_SYSTEMS } from "./mech_systems.js";
import { MECH_INSTRUMENTS } from "./mech_instruments.js";
import { createLabCard } from "./ui.js";
import { mountAxisGizmo } from "./axis_gizmo.js";
import {
  downloadCSV, downloadJSON, uploadJSONFile, loadFromLocalStorage, saveToLocalStorage,
} from "../storage/io.js";

const ICONS = {
  ArrowLeft, Box, Square, Download, Upload, Eraser, RotateCcw, StepForward,
  Play, Pause, Plus, Minus, X, FlaskConical, Zap, Vibrate, Gauge,
  Wrench, Boxes, Car, Layers, AlignHorizontalDistributeCenter, ArrowLeftRight,
  Blocks, Target, Spline, Disc3, Unplug, Lock, LockOpen, ChevronLeft, ChevronRight,
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

/** The state a fresh bench opens on: the single mass, its spring and its damper,
 *  driven by a harmonic force at its own natural frequency. One object, so "what
 *  a new bench is" is written once. */
const DEFAULT_STATE = MECH_SYSTEMS[0].spec;

/* The session lives under its own key: the three workbenches share an origin, and
   a Vibrations session written over a Thermo one would be one bench eating
   another's experiment. */
const SESSION_KEY = "physics-workbench:mech-session";
const SESSION_VERSION = 1;
const SESSION_SAVE_EVERY = 500;
const TRACE_MAX = 1400;

/** How often the recorder takes a point, in seconds of the system's own time.
 *  Fifty a second: fast enough that a cycle at the highest frequency on this
 *  bench is a hundred points and slow enough that twenty-eight seconds of
 *  response is one ring buffer. */
const TRACE_INTERVAL = 0.02;

function formatRunTime(t) {
  if (!(t > 0)) return "0.000 s";
  if (t < 60) return `${t.toFixed(3)} s`;
  if (t < 3600) return `${Math.floor(t / 60)}m ${(t % 60).toFixed(1)}s`;
  return `${(t / 3600).toFixed(2)} h`;
}

const sig = (v, digits = 3) => {
  if (!Number.isFinite(v)) return "\u2014";
  if (v === 0) return "0";
  const magnitude = Math.abs(v);
  if (magnitude >= 1e5 || magnitude < 1e-3) return v.toExponential(2);
  return Number(v.toPrecision(digits)).toString();
};

export function bootMechWorkbench() {
  const canvas = document.getElementById("mechCanvas");
  if (!canvas) return;

  for (const el of document.querySelectorAll("#mech [data-icon]")) {
    mountIcon(el, el.dataset.icon);
  }

  /* ==================================================================================
     THE SYSTEM
     ================================================================================== */
  /* One system for the life of the page, re-dealt rather than replaced: the
     renderer holds a reference to it, the rails are built around it, and every
     lab is a state applied to it. Swapping the object would quietly decouple the
     picture from the physics. */
  const system = new MechSystem(DEFAULT_STATE);
  const renderer = new MechRenderer(canvas, system);
  /* The same orientation triad as the other two benches, reading this rig's
     camera. Mounted before the first frame is drawn, so the corner is never
     empty on arrival. */
  const axisGizmo = mountAxisGizmo(document.getElementById("mechViewport"), () => renderer.camera);

  let running = false;
  let stepsPerFrame = 12;
  let motionScale = 1;
  let labId = null;
  let stepMs = 0;
  let systemId = MECH_SYSTEMS[0].id;

  /* ------------------------------- the recorder ------------------------------- */
  const trace = { t: [], x: [] };
  let lastSample = -Infinity;

  function clearTrace() {
    trace.t.length = 0;
    trace.x.length = 0;
    lastSample = -Infinity;
    measured = null;
  }

  /** Take a point if enough of the system's own time has gone by. Sampled by
   *  *simulated* time rather than by frame, so a slowed picture draws the same
   *  curve over a longer minute rather than a shorter one. */
  function sampleTrace() {
    if (system.time - lastSample < TRACE_INTERVAL) return;
    lastSample = system.time;
    trace.t.push(system.time);
    trace.x.push(system.state[system.spec.output]);
    if (trace.t.length > TRACE_MAX) {
      trace.t.splice(0, trace.t.length - TRACE_MAX);
      trace.x.splice(0, trace.x.length - TRACE_MAX);
    }
  }

  /**
   * What the run has measured, and what the theory says it should be.
   *
   * The amplitude of the output is read off the last two cycles of the recorded
   * response - peak to peak, halved - and compared with |H(j omega)| times the
   * amplitude of the drive. Two independent things: one is what the system did,
   * the other is what the matrices say it must, and the difference between them
   * is the experiment. `settled` is the same idea in time: the last cycle within
   * a couple of percent of the one before it means the transient has died and the
   * steady state is what is being measured.
   */
  let measured = null;

  function measure() {
    const driven = system.activeInputs.find((input) => input.kind === "force")
      ?? system.activeInputs.find((input) => input.kind === "base");
    const waveform = driven
      ? (driven.kind === "force" ? system.spec.drive.waveform : system.spec.base.waveform)
      : "off";
    const frequency = driven ? driven.frequency : 0;
    const amplitudeOfDrive = driven
      ? (driven.kind === "force" ? system.spec.drive.amplitude : system.spec.base.amplitude)
      : 0;
    const from = driven ? driven.kind : "force";
    const period = waveform === "sine" && frequency > 0 ? 1 / frequency : 0;

    let amplitude;
    let settled = null;
    if (trace.t.length > 2 && (period === 0 || trace.t[trace.t.length - 1] - trace.t[0] > period * 0.5)) {
      const end = trace.t[trace.t.length - 1];
      const window = period > 0 ? Math.max(period, end - trace.t[0]) : end - trace.t[0];
      const windowStart = period > 0 ? end - window : trace.t[0];
      const lastCycle = [];
      const previousCycle = [];
      for (let i = 0; i < trace.t.length; i++) {
        if (trace.t[i] >= windowStart) {
          if (period > 0 && trace.t[i] < end - period) previousCycle.push(trace.x[i]);
          else lastCycle.push(trace.x[i]);
        }
      }
      const swing = (list) => {
        if (list.length < 3) return null;
        return (Math.max(...list) - Math.min(...list)) / 2;
      };
      const a = swing(lastCycle);
      const b = swing(previousCycle);
      if (a !== null && a > 0) {
        amplitude = a;
        settled = period === 0 ? true : (b !== null && Math.abs(a - b) / a < 0.03);
      }
    }

    const theoryAmplitude = period > 0 && from !== undefined
      ? system.frequencyResponse(from, system.spec.output, 2 * Math.PI * frequency).magnitude * amplitudeOfDrive
      : undefined;
    measured = {
      amplitude,
      settled,
      frequency,
      period,
      waveform,
      from,
      amplitudeOfDrive,
      theoryAmplitude,
      gain: amplitude !== undefined && amplitudeOfDrive > 0 ? amplitude / amplitudeOfDrive : 0,
      envelope: period > 0 && theoryAmplitude !== undefined ? theoryAmplitude : null,
    };
    return measured;
  }

  /* ------------------------------- the lid in hand ------------------------------- */
  /* A mass dragged on the stage is held where the hand is: the state is written,
     not the equations, so the block is exactly where the pointer put it and the
     rest of the system carries on around it. Letting go leaves it there, still,
     and it rings from there - which is the oldest experiment in the subject. */
  let holding = null;

  /** A block being reshaped by the hand, or null.
   *
   *  Right-drag is the direct resize, the same gesture the Dynamics bench puts on
   *  a shape: press on a block, pull sideways, and the block itself gets longer or
   *  shorter. What it changes is the mass, because a block's width here *is* its
   *  weight - that is the whole of what the drawing says with it.
   *
   *  The travel is read as a *ratio* rather than as a length, and that is not a
   *  preference: the picture's width goes as the sixth root of the number, so a
   *  drag that added width in proportion to the hand would carry a mass of a few
   *  kilograms into the thousands over a couple of centimetres of stage. A steady
   *  ratio per centimetre is fine where the mass is small and coarse where it is
   *  large, which is the only way a quantity the drawing shows logarithmically can
   *  be edited by hand.
   */
  let resizing = null;

  /** A part in the hand: a spring, a dashpot, a force or the probe being moved
   *  from where it is to where the hand lets it go. */
  let moving = null;

  /** A block in the hand, being *put* somewhere on the bench: where it was
   *  lifted from, and where the hand is carrying it. A placement is not a
   *  displacement - the rig's own numbers are not touched - and everything
   *  bolted to the block stays where it is, off the block it no longer reaches. */
  let placing = null;

  /** World units of travel that multiply a mass by e. A block's own width is
   *  about a quarter of a unit, so a drag of one block's width is a factor of
   *  about two and a half - a resize that visibly grows the block without
   *  throwing the number past what the reader meant. */
  const MASS_DRAG = 0.30;

  /** A mass a hand set, rounded to four figures: a slider's worth of precision
   *  and no more, so the panel does not print the arithmetic of the drag. */
  const tidyMass = (m) => Number(clamp(m, 0.01, 20000).toPrecision(4));

  function restage() {
    leftRail.setModel(system);
    rightRail.setModel(system);
    renderer.sync();
    renderer.frame();
    renderer.update();
  }

  /** Rebuild the rig without re-aiming the camera.
   *
   *  A mass is drawn at the width its weight earns it, so editing one has to
   *  rebuild the picture - but not re-frame it: a camera that re-aimed itself
   *  every time a slider moved would swing about while the reader was holding the
   *  slider, which is the one moment the view must hold still. */
  function resizeRig() {
    renderer.sync();
    renderer.update();
    /* A rebuild is where the set of parts can change - a spring added, an end
       dragged off a block - so it is also where the bench's notes about them
       change, and where a picked part has to be told it is picked again. */
    renderer.setSelected(selectedSelection());
    updateNotes();
  }

  /** What is picked right now, as the stage's own naming of it: the panel's
   *  selection carries the key and the instance, and a rebuild drops the
   *  highlight unless it is told again. */
  function selectedSelection() {
    if (!selectedInstrument) return null;
    if (selectedInstrument === "mass") return { key: "mass", index: activeMass };
    if (selectedInstrument === "element") return { key: "element", index: activeElement };
    if (selectedInstrument === "drive") return { key: "drive", index: activeDrive };
    return { key: selectedInstrument };
  }

  function edited({ structure = false } = {}) {
    if (structure) resizeRig();
    leftRail.sync(system);
    updateNotes();
    scheduleSessionSave();
  }

  /* ==================================================================================
     THE SESSION
     ================================================================================== */
  let sessionTimer = null;
  let sessionWrittenAt = 0;
  let sessionDirty = false;

  function mechSession() {
    return {
      version: SESSION_VERSION,
      viewMode: renderer.mode,
      stepsPerFrame,
      motionScale,
      probeOn,
      labId,
      systemId,
      trace: { t: trace.t.slice(), x: trace.x.slice() },
      system: system.serialize(),
      /* Where the blocks, the spare parts and the probe have been put. A
         placement is part of the scene and not part of the model, but it has to
         be saved with the model all the same: a part cut off a block remembers
         the reach it had, and a bench that came back without the block it was cut
         from would come back holding air. */
      stage: renderer.stageOffsets(),
      places: renderer.placesFor(),
    };
  }

  function saveSession() {
    if (sessionTimer !== null) { clearTimeout(sessionTimer); sessionTimer = null; }
    if (!sessionDirty) return;
    sessionDirty = false;
    sessionWrittenAt = performance.now();
    try { saveToLocalStorage(SESSION_KEY, mechSession()); } catch (err) { /* no storage, no session */ }
  }

  function scheduleSessionSave() {
    sessionDirty = true;
    if (sessionTimer !== null) return;
    sessionTimer = setTimeout(saveSession, 250);
  }

  /* ==================================================================================
     THE RAILS
     ================================================================================== */
  const leftRail = buildMechLeftRail(document.getElementById("mechLeftRail"), {
    /* A mass is drawn at the size it is - its width is its weight - so changing
       it rebuilds the rig rather than just redrawing it. Without the rebuild the
       panel's own Mass slider was a control that changed the physics and left the
       picture saying the old thing. */
    onMass: (i, v) => { system.setMass(i, v); resizeRig(); edited(); },
    onSpring: (index, v) => { system.setSpring(index, v); renderer.update(); edited(); },
    onDamper: (index, v) => { system.setDamper(index, v); renderer.update(); edited(); },
    onAddMass: () => {
      system.addMass(Math.max(1, system.M[system.n - 1] ?? 1), 10, 0.5);
      restage();
      edited();
      markRunStart();
    },
    onRemoveMass: () => {
      system.removeLastMass();
      restage();
      edited();
      markRunStart();
    },
    onExcitation: (key) => {
      if (key === "off") system.stopDriving();
      else system.setExcitation(key);
      /* Choosing what drives it is choosing an instrument, so the instrument
         that carries the numbers opens with it: a mode switch that left its own
         settings three panels down the rail would be a control that moved
         something invisible. */
      selectInstrument(key === "off" ? null : (MECH_INSTRUMENTS.find((entry) => entry.key === key) ?? { key }));
      leftRail.sync(system);
      rightRail.setModel(system);
      edited();
      scheduleSessionSave();
    },
    onStep: (dt) => { system.setDt(dt); leftRail.syncStepSize(system.dt); scheduleSessionSave(); },
    onSteps: (n) => { stepsPerFrame = clamp(Math.round(n), 1, 40); scheduleSessionSave(); },
    onMotion: (v) => { motionScale = v; renderer.setMotionScale(v); scheduleSessionSave(); },
    onSettle: () => {
      const n = system.n;
      for (let i = 0; i < n; i++) system.state[n + i] = 0;
      system.rebase();
      renderer.update();
    },
    onSelectElement: (index) => {
      selectInstrument(elementSelection(index));
    },
  });

  const rightRail = buildMechRightRail(document.getElementById("mechRightRail"), {
    /* The force the panel has open, which is not always the first one: a rig can
       carry a shaker on each of two masses, and the two are set up separately. */
    onDrive: (patch) => {
      system.setDrive(activeDrive, patch);
      leftRail.sync(system);
      edited();
    },
    onBase: (patch) => {
      system.setBase(patch);
      leftRail.sync(system);
      edited();
    },
    onOutput: (index) => {
      system.setOutput(index);
      clearTrace();
      renderer.setSelected({ key: "mass", index });
      rightRail.setModel(system);
      rightRail.setInstrument({ key: "probe" });
      edited();
    },
    onMass: (index, v) => { system.setMass(index, v); resizeRig(); edited(); },
    onElement: (index, v) => {
      const meta = system.elementIndices()[index];
      if (!meta) return;
      if (meta.kind === "spring") system.setSpring(meta.index, v);
      else system.setDamper(meta.index, v);
      renderer.update();
      edited();
    },
    /* Bolting an end of a spring somewhere else from the panel, which is the
       same edit a drag makes on the stage: the two ways in have to agree. */
    onElementEnd: (index, end, key) => {
      const value = key === "g" ? "g" : key === "none" ? null : Number(key);
      system.setElement(index, { [end]: value });
      restage();
      edited();
      markRunStart();
      selectInstrument(elementSelection(index));
    },
    onDriveMass: (index, mass) => {
      system.setDriveMass(index, mass);
      restage();
      edited();
      markRunStart();
    },
    onSpawn: (kind) => spawnInstrument(MECH_INSTRUMENTS.find((entry) => entry.key === kind) ?? { key: kind }),
    onExcitation: (key) => {
      if (key === "off") system.stopDriving(); else system.setExcitation(key);
      leftRail.sync(system);
      edited();
    },
    onTransferFrom: (key) => {
      /* Which input the transfer function is read from, and nothing else: a
         picker in the TRANSFER FUNCTION section must not switch the bench's own
         drives off to look at a curve. */
      system.setAnalysedInput(key);
      leftRail.sync(system);
      edited();
    },
    onClearTrace: () => { clearTrace(); updateReadouts(); },
    onExportResponse: () => exportResponse(),
    onExportBode: () => exportBode(),
    /* One way off the bench for every instrument, wherever the press came from:
       see takeOffBench below. */
    onRemove: (what) => takeOffBench(
      typeof what === "string" ? what : what.key,
      typeof what === "string" ? undefined : what.index,
    ),
  });

  /* ------------------------------- the instruments ------------------------------- */
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

  /* Below the phone breakpoint the two rails are drawers over the stage and
     these are their handles; on anything wider this is inert and the rails are
     the columns they have always been. See frontend/drawer.js. */
  mountStageDrawers(document.getElementById("mech"), {
    left: document.getElementById("mechLeftRail"),
    right: document.getElementById("mechRightRail"),
    labels: { left: "Controls", right: "Readouts" },
    mountIcon,
  });

  const instrumentLauncher = document.getElementById("mechInstrumentLauncher");
  const instrumentToggle = document.getElementById("mechInstrumentToggle");
  const instrumentPicker = document.getElementById("mechInstrumentPicker");
  const instrumentMenu = attachMenu({
    launcher: instrumentLauncher, toggleButton: instrumentToggle, panel: instrumentPicker,
    label: "Show the instruments", labelOpen: "Hide the instruments",
  });
  const instrumentButtons = new Map();
  let selectedInstrument = null;
  /* What kind of thing the panel has open and which instance of it, so the
     panel's own sliders edit the spring or the force that is on the stage rather
     than the first one there is. */
  let selectedKind = null;
  let activeDrive = 0;
  let activeElement = 0;
  let activeMass = 0;
  /* Whether the accelerometer is standing on the bench. The other two instruments
     are already in the model - a force and a shaken base are states of the system
     - so only the probe needs a home of its own outside it. */
  let probeOn = false;
  /* What the strip calls an instrument, and what the model calls the thing that
     drives the rig. They are two words for one state, and this is the one place
     they are said next to each other. */
  const EXCITATION_OF = { drive: "force", base: "base" };

  for (const instrument of MECH_INSTRUMENTS) {
    const option = document.createElement("button");
    option.className = "shape-option";
    option.type = "button";
    option.title = instrument.note;
    option.setAttribute("aria-label", `${instrument.label}: ${instrument.note}`);
    option.setAttribute("aria-pressed", "false");
    const glyph = document.createElement("span");
    mountIcon(glyph, instrument.icon, { width: 13, height: 13 });
    const label = document.createElement("span");
    label.textContent = instrument.label;
    option.append(glyph, label);
    option.addEventListener("click", () => useInstrument(instrument));
    instrumentPicker.appendChild(option);
    instrumentButtons.set(instrument.key, option);
  }

  /**
   * What pressing an entry in the strip does.
   *
   * Every entry is a switch, and the bench carries one of each: one spring, one
   * dashpot, one force, one shake table, one probe. Pressing an entry that is not
   * on the bench puts it on; pressing the entry that *is* takes it away again.
   * There is no such thing here as a second spring - a rig with two springs on
   * one face is not one of this bench's experiments - and a strip that put
   * another one out every time it was pressed was a strip nothing could be turned
   * off with.
   */
  function useInstrument(instrument) {
    toggleInstrument(instrument);
  }

  /** Where a new part should land: on the block the reader is looking at, which
   *  is the one the probe reads or the one a panel has open. A part that appears
   *  on a mass nobody was looking at is a part that has to be found. */
  function chosenMass() {
    if (selectedInstrument?.key === "mass") return selectedInstrument.index;
    if (selectedInstrument?.key === "probe") return system.spec.output;
    return system.spec.output;
  }

  /** Put a spring, a dashpot or a force on the bench, and open its panel: the
   *  half of the strip's switch gesture that puts one out.
   *
   *  One of each and no more, and the guard is here rather than at the call site
   *  so that the rule holds however the bench is driven - a spring is put out
   *  only when the bench is not already carrying one. */
  function spawnInstrument(instrument) {
    if (instrument.key === "drive") {
      if (system.spec.drives.some((d) => d.waveform !== "off" && d.mass !== null && d.mass !== undefined)) return;
    } else if (system.elements.some((e) => e.kind === instrument.key)) return;
    const mass = Math.min(Math.max(0, chosenMass()), system.n - 1);
    if (instrument.key === "drive") {
      const first = system.spec.drives[0];
      const index = system.addDrive({
        mass,
        waveform: "sine",
        amplitude: first?.amplitude ?? 1,
        frequency: first?.frequency || system.modes[0]?.frequency || 0.5,
      });
      restage();
      edited();
      selectInstrument({ key: "drive", index, label: `Force ${index + 1}` });
    } else {
      /* A new spring or dashpot goes from that mass to the ground, which is the
         one thing every rig on this bench has: from there, dragging either end
         is how it is moved onto whatever it should really hold. */
      const index = system.addElement(instrument.key, mass, "g");
      restage();
      edited();
      selectInstrument(elementSelection(index));
    }
    markRunStart();
    instrumentMenu.close();
  }

  /** How a spring or a dashpot is named to the panel and the stage: k1, c2, and
   *  the index the whole interface knows it by. */
  function elementSelection(index) {
    const meta = system.elementIndices()[index];
    if (!meta) return { key: "element", index };
    const kind = meta.kind === "spring" ? "spring" : "damper";
    return {
      key: "element",
      kind,
      index,
      label: `${meta.kind === "spring" ? "k" : "c"}${subscript(meta.index + 1)}`,
    };
  }

  /**
   * Take an instrument off the bench. One gesture, in one place, however it is
   * asked for: the strip's own switch, the panel's "take it off the bench"
   * button, or a press on the thing itself.
   *
   * A spring or a dashpot is removed outright - it is a part standing on a bench.
   * A force is *switched off* rather than deleted, because the model always
   * carries a force and a force that is off is exactly a force that is doing
   * nothing. The shake table is switched off the same way: the ground is always
   * there, and what it is doing is the thing that changes.
   */
  function takeOffBench(key, index) {
    if (key === "probe") {
      if (!probeOn) return;
      probeOn = false;
      renderer.setProbeVisible(false);
      renderer.update();
      selectInstrument(null);
      scheduleSessionSave();
      return;
    }
    if (key === "element") {
      const at = index ?? activeElement;
      if (!system.elements[at]) return;
      system.removeElement(at);
      restage();
      selectInstrument(null);
      edited();
      markRunStart();
      return;
    }
    if (key === "drive") {
      const drives = system.spec.drives;
      const at = index ?? activeDrive;
      if (!drives[at]) return;
      system.removeDrive(at);
      restage();
      selectInstrument(null);
      edited();
      markRunStart();
      return;
    }
    if (key === "base") {
      if (system.spec.base.waveform === "off") return;
      system.setBase({ waveform: "off" });
      leftRail.sync(system);
      rightRail.setModel(system);
      selectInstrument(null);
      edited();
    }
  }

  /** The strip's own gesture: an instrument is put out, or taken off the bench
   *  if it is already on it. */
  function toggleInstrument(instrument) {
    if (instrument.key === "spring" || instrument.key === "damper") {
      /* The one spring (or dashpot) the bench carries: the one whose panel is
         open if that is the kind being pressed, otherwise the last one there is
         - and pressing the entry again takes it away. */
      const meta = system.elementIndices();
      const open = selectedInstrument?.key === "element" ? selectedInstrument.index : -1;
      let index = meta[open]?.kind === instrument.key ? open : -1;
      if (index < 0) {
        for (let i = system.elements.length - 1; i >= 0; i--) {
          if (meta[i]?.kind === instrument.key) { index = i; break; }
        }
      }
      if (index >= 0) takeOffBench("element", index);
      else spawnInstrument(instrument);
      instrumentMenu.close();
      return;
    }
    if (instrument.key === "probe") {
      if (probeOn) takeOffBench("probe");
      else {
        probeOn = true;
        renderer.setProbeVisible(true);
        renderer.update();
        selectInstrument(instrument);
        scheduleSessionSave();
      }
      instrumentMenu.close();
      return;
    }
    /* A rig that arrived carrying more than one force - a system put on the bench
       from the strip above, or a session restored from an older bench - is put
       back to one by this switch before anything else: the bench carries one. */
    if (instrument.key === "drive" && system.spec.drives.length > 1) {
      takeOffBench("drive", system.spec.drives.length - 1);
      instrumentMenu.close();
      return;
    }
    if (instrument.key === "base" && system.spec.base.waveform !== "off") {
      takeOffBench("base");
      instrumentMenu.close();
      return;
    }
    const key = EXCITATION_OF[instrument.key];
    /* The two instruments are two instruments, so the strip switches one of
       them: putting the shake table out leaves the force where it was, and the
       other way round. (The left rail's "What drives it" is the other kind of
       statement - one thing drives this rig, so choosing one puts the other
       away - and that is what its three chips mean.) */
    const waveform = key === "force" ? system.spec.drive.waveform : system.spec.base.waveform;
    const on = waveform !== "off";
    system.setInput(key, !on);
    /* A force that had come unhooked from every block - which only an older bench
       could leave behind - is hooked back onto a block when it is switched on:
       an arrow pushing nothing is not a state this bench draws any more. */
    if (!on && key === "force" && system.spec.drive.mass === null) {
      system.setDrive(0, { mass: Math.min(Math.max(0, chosenMass()), system.n - 1) });
    }
    leftRail.sync(system);
    if (on) {
      if (selectedInstrument === instrument.key) selectInstrument(null);
    } else {
      rightRail.setModel(system);
      selectInstrument(instrument);
    }
    edited();
    instrumentMenu.close();
  }

  function selectInstrument(what) {
    selectedInstrument = what?.key ?? null;
    /* Which of the strip's entries the panel belongs to, and which spring, force
       or dashpot the panel's own sliders are editing. */
    selectedKind = what?.key === "element" ? (what.kind ?? "element") : selectedInstrument;
    if (what?.key === "drive") activeDrive = what.index ?? 0;
    if (what?.key === "element") activeElement = what.index ?? 0;
    if (what?.key === "mass") activeMass = what.index ?? 0;
    /* Panels that clear themselves - clearing the bench, choosing a system,
       restarting - have to clear the stage with them, or a block stays lit as
       the picked one with nothing on the rail to say what it is picked for. */
    if (!what) renderer.setSelected(null);
    if (what && (what.key === "mass" || what.key === "element")) {
      rightRail.setEditing(what.key === "mass" ? { mass: what.index } : { element: what.index });
    }
    /* Picking something says nothing about the camera. It used to: a pick aimed
       the view at the part, which is a stage that lurches every time a reader
       looks at something. What a pick changes is the *rail* and the outline on
       the stage, and the camera belongs to the reader - a double-click puts it
       back, and nothing else moves it.

       The rail says which element was picked, so the row a reader pressed and the
       spring on the stage are visibly the same spring. */
    leftRail.pick(what);
    rightRail.setInstrument(what);
    if (what) rightRail.reveal();
    syncInstrumentButtons();
  }

  function syncInstrumentButtons() {
    for (const [key, button] of instrumentButtons) {
      /* An instrument's button says whether that instrument is on the stage,
         not whether something else is: the two drives are independent, and so
         are the springs. */
      let on;
      if (key === "probe") on = probeOn;
      else if (key === "spring" || key === "damper") on = system.elements.some((e) => e.kind === key);
      else if (key === "drive") on = system.spec.drives.some((d) => d.waveform !== "off" && d.mass !== null && d.mass !== undefined);
      else on = system.spec.base.waveform !== "off";
      /* Which entry the panel on the right belongs to: a selected spring lights
         the Spring button, whichever spring it is. */
      const current = key === selectedInstrument
        || (key === "spring" || key === "damper" ? selectedInstrument === "element" && selectedKind === key : false);
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
      button.setAttribute("aria-current", current ? "true" : "false");
    }
  }

  /* ==================================================================================
     THE SYSTEMS AND THE LAB BENCH
     ================================================================================== */
  const systemsLauncher = document.getElementById("mechSystemLauncher");
  const systemsToggle = document.getElementById("mechSystemToggle");
  const systemsPicker = document.getElementById("mechSystemPicker");
  const systemsMenu = attachMenu({
    launcher: systemsLauncher, toggleButton: systemsToggle, panel: systemsPicker,
    label: "Show the systems", labelOpen: "Hide the systems",
  });
  const systemRows = new Map();

  for (const preset of MECH_SYSTEMS) {
    const option = document.createElement("button");
    option.className = "shape-option";
    option.type = "button";
    option.title = preset.blurb;
    option.setAttribute("aria-label", `${preset.name}: ${preset.blurb}`);
    const glyph = document.createElement("span");
    mountIcon(glyph, preset.icon, { width: 13, height: 13 });
    const label = document.createElement("span");
    label.textContent = preset.name;
    option.append(glyph, label);
    option.addEventListener("click", () => { applySystem(preset.id); systemsMenu.close(); });
    systemsPicker.appendChild(option);
    systemRows.set(preset.id, option);
  }

  function applySystem(id) {
    const preset = MECH_SYSTEMS.find((entry) => entry.id === id);
    if (!preset) return;
    systemId = preset.id;
    labId = null;
    system.setSpec(preset.spec);
    /* A layout belongs to the rig that was laid out: a new system is a new rig,
       and its blocks stand in their own slots and its spare parts at the near
       left of the slab until a hand says otherwise. */
    renderer.clearStage();
    renderer.clearPlaces();
    clearTrace();
    restage();
    labCard.hide();
    for (const [rowId, row] of labRows) row.classList.toggle("on", false);
    selectInstrument(null);
    setRunning(false);
    markRunStart();
    leftRail.syncStepSize(system.dt);
    leftRail.syncMotion(motionScale);
    syncSystemButtons();
    scheduleSessionSave();
  }

  function syncSystemButtons() {
    for (const [id, button] of systemRows) button.classList.toggle("on", id === systemId);
  }

  /* ----------------------------------- the labs ----------------------------------- */
  /**
   * How wide the two strips in the corner of the stage may be.
   *
   * They open out of their own pills on the left and run towards the lab pill on
   * the right, and a strip of seven systems is long enough to reach it and be read
   * through it. The room is measured from the page's own layout rather than guessed
   * from the window, because the rails, the window and the pills' own labels all
   * move together, and the strips wrap inside whatever they are given.
   */
  /* How wide a strip of chips is, laid out as the single row it is. The chips
     do not wrap and do not grow, so this is each chip's own width plus the gaps
     and the panel's own frame - and it does not depend on how wide the panel
     currently is, which is what lets the answer decide the panel's own size. */
  function stripWidth(panel) {
    const chips = [...panel.children];
    if (!chips.length) return 0;
    const style = getComputedStyle(panel);
    const num = (value) => parseFloat(value) || 0;
    const frame = num(style.paddingLeft) + num(style.paddingRight)
      + num(style.borderLeftWidth) + num(style.borderRightWidth);
    return chips.reduce((sum, chip) => sum + chip.getBoundingClientRect().width, 0)
      + num(style.columnGap) * (chips.length - 1) + frame;
  }

  /* Where the two strips stand, which is a measurement rather than a style.

     A strip opens out of its own pill towards the far side of the stage, and its
     natural width is its own business - seven names is about 670 px, which is
     more than the room between the two pills on a laptop and less than the room
     on a wide screen. So: it stands *beside* the pill when the whole of it fits
     in the room between this pill and the lab pill on the other side, and
     otherwise it takes a row of its own under the pills, where the stage gives
     it the whole width. Both are one line, at the size the design asks for; the
     strip is never wrapped, never cut short and never drawn across the pill on
     the far side. (It is written in the stylesheet as `.is-shelved`.) */
  function fitStrips() {
    const controls = document.querySelector("#mechViewport .viewport-controls");
    if (!controls) return;
    const band = controls.getBoundingClientRect();
    const labs = document.getElementById("mechLabLauncher")?.getBoundingClientRect() ?? null;
    /* On a phone the strip has already dropped to its own row (see the 640px
       block in the stylesheet), so it hangs off the pill's left edge. */
    const narrow = window.matchMedia("(max-width: 640px)").matches;
    for (const [picker, launcher] of [
      ["mechSystemPicker", "mechSystemLauncher"],
      ["mechInstrumentPicker", "mechInstrumentLauncher"],
    ]) {
      const panel = document.getElementById(picker);
      const pill = document.getElementById(launcher);
      if (!panel || !pill) continue;
      const pillBox = pill.getBoundingClientRect();
      /* Measured with the glyphs *in*, whatever the row happens to be drawing
         them at right now. The tight state drops every chip's icon, so a width
         taken in that state is a width of the row as it is and not of the row
         this measurement is about - and a row whose own tightness decides how
         wide it is flips between the two once per resize, which is a strip that
         blinks as the window is dragged. */
      const wasTight = panel.classList.contains("is-tight");
      if (wasTight) panel.classList.remove("is-tight");
      const width = stripWidth(panel);
      if (wasTight) panel.classList.add("is-tight");
      /* The room beside the pill - up to the *lab* pill, not to the edge of the
         stage, because a strip that has to be drawn across that pill to fit is a
         strip over a control the reader wants. */
      const beside = (labs ? labs.left - 12 : band.right) - (pillBox.right + 6);
      const shelve = narrow || (width > 0 && width > beside);
      panel.classList.toggle("is-shelved", shelve);
      if (!shelve) {
        panel.classList.remove("is-tight");
        panel.style.setProperty("--mech-strip-room", `${Math.max(180, Math.round(band.right - pillBox.right - 12))}px`);
        continue;
      }
      /* A row of its own: it starts where the pill starts and runs to the
         stage's own right inset, and it hangs below the *whole* column of
         controls rather than below its own pill, so it covers none of them. */
      const column = panel.closest(".stage-corner") ?? pill;
      const drop = column.getBoundingClientRect().bottom - pillBox.top + 6;
      const shelf = band.right - pillBox.left - 12;
      panel.style.setProperty("--mech-shelf-drop", `${Math.max(40, Math.round(drop))}px`);
      panel.style.setProperty("--mech-strip-room", `${Math.max(180, Math.round(shelf))}px`);
      /* And a stage that cannot hold the row even with a row of its own - a
         laptop's, with the rail still standing on the stage - gives up the
         glyphs rather than the words: a reader picks a system by its name, and
         the outline beside it was only ever a second look at the same thing. */
      if (width > 0 && width > shelf) panel.classList.add("is-tight");
      else panel.classList.remove("is-tight");
    }
  }
  fitStrips();
  window.addEventListener("resize", fitStrips);
  /* Words are what the block is measured in, so it is laid out again once the
     face they are set in has arrived and the chips have their real widths. */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitStrips).catch(() => {});
  if (window.ResizeObserver) {
    new ResizeObserver(fitStrips).observe(document.getElementById("mechViewport"));
  }

  const labCard = createLabCard(document.getElementById("mechViewport"));
  const labLauncher = document.getElementById("mechLabLauncher");
  const labToggle = document.getElementById("mechLabLauncherToggle");
  const labPicker = document.getElementById("mechLabPicker");
  const labRows = new Map();
  const labMenu = attachMenu({
    launcher: labLauncher, toggleButton: labToggle, panel: labPicker,
    label: "Show the lab bench", labelOpen: "Hide the lab bench",
  });

  for (const lab of MECH_LABS) {
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

  function applyLab(id) {
    const lab = MECH_LABS.find((entry) => entry.id === id);
    if (!lab) return;
    labId = lab.id;
    systemId = null;
    system.setSpec(lab.spec);
    renderer.clearStage();
    renderer.clearPlaces();
    clearTrace();
    restage();
    labCard.setLab(lab);
    for (const [rowId, row] of labRows) row.classList.toggle("on", rowId === id);
    selectInstrument(null);
    setRunning(false);
    markRunStart();
    syncSystemButtons();
    scheduleSessionSave();
  }

  function clearBench() {
    labId = null;
    selectedInstrument = null;
    rightRail.setInstrument(null);
    system.setSpec(DEFAULT_STATE);
    systemId = MECH_SYSTEMS[0].id;
    /* The timeline is part of the bench and not part of the rig, so `setSpec`
       cannot put it back: the step the solve is cut on, how many of those a
       frame runs, and how far the picture magnifies the motion. Cleared here so
       a reset clears the rail as well as the stage - a rig at one mass under a
       panel still magnifying a hundredfold is two answers to one question. */
    system.setDt(1 / 600);
    stepsPerFrame = 12;
    motionScale = 1;
    renderer.setMotionScale(motionScale);
    leftRail.syncStepSize(system.dt);
    leftRail.syncSteps(stepsPerFrame);
    leftRail.syncMotion(motionScale);
    renderer.clearStage();
    renderer.clearPlaces();
    clearTrace();
    restage();
    labCard.hide();
    for (const row of labRows.values()) row.classList.remove("on");
    selectInstrument(null);
    setRunning(false);
    markRunStart();
    syncSystemButtons();
    scheduleSessionSave();
  }

  /* ==================================================================================
     RUN / PAUSE / STEP / RESTART
     ================================================================================== */
  let runStart = null;
  const runBtn = document.getElementById("mechRunBtn");
  const runBtnIcon = runBtn.querySelector(".run-btn-icon");
  const runBtnLabel = runBtn.querySelector(".run-btn-label");
  const restartBtn = document.getElementById("mechRestartBtn");

  function syncRunButton() {
    mountIcon(runBtnIcon, running ? "Pause" : "Play");
    runBtnLabel.textContent = running ? "Pause" : "Run";
    runBtn.classList.toggle("paused", !running);
    document.getElementById("mechStatusDot").classList.toggle("live", running);
    document.getElementById("mechStatusText").textContent = running ? "running" : "paused";
  }

  function setRunning(on) {
    if (running === on) return;
    running = on;
    syncRunButton();
  }

  function syncRestartButton() {
    restartBtn.disabled = runStart === null;
  }

  /** Where a run begins: the system as it is now, and the trace it had. */
  function markRunStart() {
    runStart = {
      system: system.serialize(),
      labId,
      systemId,
      trace: { t: trace.t.slice(), x: trace.x.slice() },
    };
    syncRestartButton();
  }

  /** One frame of watching: the system's own clock, in steps. */
  function advance(steps) {
    for (let i = 0; i < steps; i++) system.step();
  }

  function stepOnce() {
    setRunning(false);
    advance(stepsPerFrame);
    sampleTrace();
    measure();
    updateReadouts();
  }

  function restartRun() {
    if (!runStart) return;
    setRunning(false);
    system.restore(runStart.system);
    labId = runStart.labId;
    systemId = runStart.systemId;
    trace.t = runStart.trace.t.slice();
    trace.x = runStart.trace.x.slice();
    lastSample = trace.t.length ? trace.t[trace.t.length - 1] : -Infinity;
    measured = null;
    restage();
    leftRail.syncStepSize(system.dt);
    leftRail.syncMotion(motionScale);
    labCard.setLab(MECH_LABS.find((lab) => lab.id === labId) ?? null);
    for (const [rowId, row] of labRows) row.classList.toggle("on", rowId === labId);
    syncSystemButtons();
    updateReadouts();
    scheduleSessionSave();
  }

  runBtn.addEventListener("click", () => setRunning(!running));
  document.getElementById("mechStepBtn").addEventListener("click", () => stepOnce());
  restartBtn.addEventListener("click", () => restartRun());
  document.getElementById("mechResetBtn").addEventListener("click", () => clearBench());

  document.getElementById("mechSaveBtn").addEventListener("click", () => {
    downloadJSON(`vibrations-checkpoint-${Date.now()}.json`, {
      session: mechSession(),
      transfer: (() => {
        const from = system.spec.excitation;
        const { num, den } = system.transfer(from, system.spec.output);
        return { from, to: system.spec.output, numerator: num, denominator: den };
      })(),
    });
  });
  document.getElementById("mechLoadBtn").addEventListener("click", async () => {
    const data = await uploadJSONFile();
    if (!data) return;
    const payload = data.session ?? data;
    if (!payload.system) return;
    system.restore(payload.system);
    labId = payload.labId ?? null;
    trace.t = payload.trace?.t?.slice() ?? [];
    trace.x = payload.trace?.x?.slice() ?? [];
    lastSample = trace.t.length ? trace.t[trace.t.length - 1] : -Infinity;
    clearTrace();
    restage();
    if (payload.stepsPerFrame) leftRail.syncSteps(clamp(Math.round(payload.stepsPerFrame), 1, 40));
    setRunning(false);
    markRunStart();
    scheduleSessionSave();
  });

  function exportResponse() {
    downloadCSV(
      `vibrations-response-${Date.now()}.csv`,
      ["time_s", "output_m", "theory_envelope_m"],
      trace.t.map((t, i) => [t, trace.x[i], measured?.envelope ?? ""]),
    );
  }

  function exportBode() {
    const from = system.spec.excitation;
    const to = system.spec.output;
    const modes = system.modes.map((mode) => mode.frequency).filter((f) => f > 1e-6);
    const lowest = modes.length ? Math.min(...modes) : 0.5;
    const highest = modes.length ? Math.max(...modes) : 5;
    const fMin = Math.max(1e-4, lowest / 30);
    const fMax = highest * 30;
    const rows = [];
    for (let i = 0; i <= 400; i++) {
      const f = fMin * Math.pow(fMax / fMin, i / 400);
      const value = system.frequencyResponse(from, to, 2 * Math.PI * f);
      rows.push([f, value.magnitude, value.phase, 20 * Math.log10(Math.max(value.magnitude, 1e-12))]);
    }
    downloadCSV(
      `vibrations-transfer-function-${Date.now()}.csv`,
      ["frequency_Hz", "magnitude_m_per_unit", "phase_deg", "magnitude_dB"],
      rows,
    );
  }

  /* ==================================================================================
     VIEW MODE AND THE STAGE'S OWN CONTROLS
     ================================================================================== */
  const viewToggle = document.getElementById("mechViewToggle");
  viewToggle.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      viewToggle.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      setViewMode(b.dataset.mode);
      scheduleSessionSave();
    });
  });

  function setViewMode(mode) {
    renderer.setViewMode(mode);
    renderer.resize();
    renderer.frame();
    /* A rig seen flat has no orientation to report: the triad belongs to the
       orbit, and the 2D view has no orbit. */
    if (axisGizmo?.element) axisGizmo.element.style.display = mode === "2d" ? "none" : "";
    for (const b of viewToggle.querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === mode);
    const hint = document.getElementById("mechStageHint");
    if (hint) hint.textContent = mode === "2d" ? "Drag to pan · scroll to zoom" : "Drag to orbit · scroll to zoom";
  }

  /* A rig is a set of parts bolted to each other and to the ground, and this
     bench always behaves like one: there is no lock, because taking the rig
     apart is not one of this bench's experiments.

     A block picked up and put down somewhere else *takes its springs with it*:
     the part is bolted to a face, and the face moved, so the part reaches to
     where the face is, leaning if the face went up. A spring's ends always take
     hold of the nearest bearing however far the hand carries them, a shaker
     cannot be pushed off its block, the probe always reads a block, and nothing
     on the bench is ever left holding nothing. The only thing a hand moves on
     this stage is a block. */
  const ZOOM_STEP = 0.8;
  for (const b of document.querySelectorAll("#mech [data-zoom]")) {
    b.addEventListener("click", () => {
      renderer.zoom(b.dataset.zoom === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
    });
  }

  /* ------------------- the stage: place, move, resize, or pick a thing -------------------
     Every part of the rig is a thing in the hand. A block dragged is *put*
     somewhere: it follows the hand in both directions across the bench and
     everything bolted to it stays where it is - the spring is not the block's
     luggage - so a block carried off a spring leaves the spring hanging on its
     other bearing, and the bench says out loud that it is holding nothing. (A
     block dragged with Alt or Shift held is the other experiment, the old one:
     it is *displaced* from its equilibrium and let go, and the rig rings.) A
     spring, a dashpot or a force dragged is *moved* the same way: it follows the
     hand and its ends let go of what they were holding and take hold of whatever
     they are dropped on, including nothing at all. And a right-drag on any of
     them resizes the one number it is: a block's kilograms, a spring's
     stiffness, a dashpot's damping, a force's newtons. */
  /** A press that begins on a block is for moving that block; anywhere else it
   *  turns the rig. The camera's own veto, exactly as the other two benches use
   *  it, so both views behave alike. */
  function massUnderPointer(clientX, clientY) {
    const hit = renderer.pick(clientX, clientY);
    return hit && hit.key === "mass" ? hit : null;
  }

  /* Only a left-drag turns the view, and only one that begins on nothing: a
     press on a block, a spring, an arrow or the probe is a press on a part of
     the rig, and a press on a part is the bench's own - it picks the part out
     and opens its panel. A right-press is the resize gesture, and a right-drag
     that lands an inch off a block must not swing the camera - a reader trying
     to stretch a block and missing it should see nothing happen rather than lose
     the stage. */
  const viewDrag = (e) => e.button === 0 && !renderer.pick(e.clientX, e.clientY);
  renderer.orbit.canDrag = viewDrag;
  renderer.pan2d.canDrag = viewDrag;

  /** The mass a whole part is dropped on, or the one it is moved to: the nearest
   *  block within `reach`, or null for "the hand has carried it clear of the
   *  rig". A block is a wide thing to hit, so the reach is a comfortable one -
   *  wider than the block itself, because a part dropped at a block's edge is
   *  dropped on the block. */
  function massNear(worldX, reach = 0.34) {
    let best = null;
    for (let i = 0; i < system.n; i++) {
      const distance = Math.abs(renderer.restX(i) - worldX);
      if (!best || distance < best.distance) best = { index: i, distance };
    }
    return best && best.distance <= reach ? best.index : null;
  }

  /**
   * Move a force with the hand.
   *
   * A force dragged sideways along the bench is moved from one block to another:
   * it is hooked onto the block it is dropped nearest, which is the same choice
   * the panel's own picker makes, made with the hand. The rig is whole, so an
   * arrow dragged anywhere at all is still pushing the block nearest it - there
   * is no such thing on this stage as a shaker standing on the bench pushing air.
   */
  function moveDriveTo(moving, point) {
    const index = moving.index;
    const spec = system.spec.drives[index];
    if (!spec) return;
    const mass = massNear(point.x, Infinity);
    if ((spec.mass ?? null) !== mass) system.setDriveMass(index, mass);
    resizeRig();
  }

  /**
   * Move the accelerometer.
   *
   * It is an instrument standing on the bench beside the rig, not a part of it,
   * so it is carried in both directions exactly as a block is - the hand's own
   * travel, from wherever it was. What it *reads* is decided by the same gesture:
   * let go over a block and it reads that block, which is the choice the panel's
   * own picker makes, made with the hand; let go anywhere else and it goes on
   * reading the mass it had. The lock is about the rig and not about the
   * instruments, so this is a gesture it does not govern.
   */
  function moveProbeTo(moving, point) {
    renderer.placePart(
      "probe",
      0,
      moving.home.x + (point.x - moving.grab.x),
      moving.home.y + (point.y - moving.grab.y),
    );
    const mass = massNear(point.x);
    if (mass !== null && mass !== system.spec.output) {
      system.setOutput(mass);
      clearTrace();
      rightRail.setModel(system);
    }
    resizeRig();
  }

  /** The one number a part is, for the right-drag that resizes it. */
  const RESIZE_LIMITS = {
    mass: [0.01, 20000], spring: [0.1, 3e6], damper: [0.002, 1e6], drive: [0.001, 1e6],
    /* The shake table's amplitude, in metres: a hundredth of a millimetre to half
       a metre, which is the whole of the rail's own slider. */
    base: [1e-5, 0.5],
  };

  /** How far a grip has to be pulled to walk the probe one block along. Wide
   *  enough that a press which does not move picks nothing. */
  const PROBE_STEP = 0.14;

  /**
   * The one number a part is, after a hand has pulled it: the value grows by e
   * per MASS_DRAG of travel, *outwards along the grip that was taken hold of* -
   * zero travel is the value it had, so a press that does not move changes
   * nothing, and a corner pulled up and away from the part grows it however the
   * stage happens to be turned.
   */
  function resizeValue(kind, from, travel) {
    const [lo, hi] = RESIZE_LIMITS[kind];
    return Number(clamp(from * Math.exp(travel / MASS_DRAG), lo, hi).toPrecision(4));
  }

  /* A double-click on the stage puts the view back the way the bench opens, at
     the opening angle and framed on the rig. The one gesture a reader who has
     turned the stage around reaches for, and the reason they cannot lose the rig
     off the edge of it. */
  canvas.addEventListener("dblclick", () => { renderer.resetView(); });

  let pressedOnStage = false;  canvas.addEventListener("pointerdown", (e) => {
    pressedOnStage = e.button === 0;
    /* Right-press on a part takes hold of the one number it is: a block's
       kilograms, a spring's stiffness, a dashpot's damping, a force's newtons.
       The browser's own menu is the one thing in the way, and on a stage it has
       nothing to offer anyway. */
    if (e.button === 2) {
      e.preventDefault();
      const target = renderer.pick(e.clientX, e.clientY);
      if (!target) return;
      const worldX = renderer.planeX(e.clientX, e.clientY);
      if (worldX === null || !Number.isFinite(worldX)) return;
      if (target.key === "mass") {
        /* A right-press anywhere on a part is a pull on the one number it is,
           read along the bench: the hand's own sideways travel. The grips on the
           part are the same pull with a corner to say which way it goes. */
        resizing = { kind: "mass", index: target.index, from: system.M[target.index], grab: { x: worldX, y: 0 }, axis: { x: 1, y: 0 } };
        selectInstrument({ key: "mass", index: target.index, label: `Mass ${subscript(target.index + 1)}` });
        renderer.setSelected({ key: "mass", index: target.index });
      } else if (target.key === "element") {
        const meta = system.elementIndices()[target.index];
        const element = system.elements[target.index];
        if (!meta || !element) return;
        resizing = {
          kind: meta.kind === "spring" ? "spring" : "damper",
          index: target.index,
          from: meta.kind === "spring" ? element.k : element.c,
          grab: { x: worldX, y: 0 },
          axis: { x: 1, y: 0 },
        };
        selectInstrument(elementSelection(target.index));
        renderer.setSelected({ key: "element", index: target.index });
      } else if (target.key === "drive") {
        const index = target.index ?? 0;
        resizing = {
          kind: "drive",
          index,
          from: system.spec.drives[index]?.amplitude ?? 1,
          grab: { x: worldX, y: 0 },
          axis: { x: 1, y: 0 },
        };
        selectInstrument({ key: "drive", index, label: index === 0 ? "The force" : `Force ${index + 1}` });
        renderer.setSelected({ key: "drive", index });
      } else if (target.key === "base") {
        resizing = {
          kind: "base",
          index: 0,
          from: Math.max(system.spec.base.amplitude, 1e-5),
          grab: { x: worldX, y: 0 },
          axis: { x: 1, y: 0 },
        };
        selectInstrument({ key: "base" });
        renderer.setSelected({ key: "base" });
      } else if (target.key === "probe") {
        resizing = {
          kind: "probe",
          index: 0,
          from: system.spec.output,
          grab: { x: worldX, y: 0 },
          axis: { x: 1, y: 0 },
        };
        selectInstrument({ key: "probe" });
        renderer.setSelected({ key: "probe" });
      } else {
        return;
      }
      canvas.classList.add("mass-resizing");
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* no capture, still drags */ }
      return;
    }
    if (e.button !== 0) return;
    const hit = renderer.pick(e.clientX, e.clientY);
    if (!hit) return;

    const worldX = renderer.planeX(e.clientX, e.clientY);
    if (worldX === null || !Number.isFinite(worldX)) return;
    pressedOnStage = false;
    /* The block is taken hold of but not moved yet, and not stopped either. A
       press is how a block is *picked* as much as how it is dragged, so a press
       that seized the mass would freeze a rig mid-swing just because someone
       clicked on it - and a press that started the run would make looking at a
       block an act with a consequence. Where the block is now is remembered, so
       what follows is how far the hand has travelled, not where on the block the
       hand happened to land. */
    if (hit.key === "mass") {
      /* A plain press on a block is the *bench*: the block is picked up and put
         down wherever the hand lets it go, in both directions, and everything
         bolted to it stays behind - a block is a thing on a slab before it is a
         number in a matrix, and a spring does not walk about because the block
         it was bolted to did. A press with a modifier on it is the other
         experiment: the block is *displaced* from its equilibrium and let go,
         and the rig rings. */
      if (e.altKey || e.shiftKey) {
        holding = {
          index: hit.index,
          from: system.observe().x[hit.index],
          grabX: worldX,
          grabClientX: e.clientX,
          moved: false,
        };
        canvas.classList.add("mass-dragging");
      } else {
        const point = renderer.planePoint(e.clientX, e.clientY);
        if (point === null) return;
        placing = {
          index: hit.index,
          home: renderer.stageOffset(hit.index),
          grab: { x: point.x, y: point.y },
          grabClientX: e.clientX,
          grabClientY: e.clientY,
          moved: false,
        };
        canvas.classList.add("part-dragging");
      }
      selectInstrument({ key: "mass", index: hit.index, label: `Mass ${subscript(hit.index + 1)}` });
      renderer.setSelected({ key: "mass", index: hit.index });
    } else if (hit.key === "element") {
      /* A spring and a dashpot are bolted to the faces they join and they stay
         where they are: they are not carried about the bench at all. A press on
         one picks it out, which is what opens its panel and puts the grips on
         its corners, and those two are where its one number is edited. The only
         things on this stage a hand *moves* are a block, a force and the probe. */
      selectInstrument(elementSelection(hit.index));
      renderer.setSelected({ key: "element", index: hit.index });
      return;
    } else if (hit.key === "drive") {
      /* A force dragged sideways *along* the bench is moved to another block, and
         a force dragged *down* off the bench is unhooked from every block - the
         vertical is the one direction with nothing else in it on this stage, so
         it is the one that means "off". */
      const index = hit.index ?? 0;
      const place = renderer.planePoint(e.clientX, e.clientY);
      const spec = system.spec.drives[index];
      const detached = (spec?.mass ?? null) === null;
      moving = {
        kind: "drive",
        index,
        /* Where it stands *now* if it is on the bench already, so the hand moves
           it from where it is rather than from the place it was last left. */
        home: detached ? renderer.partPlace("drive", index) : null,
        grab: place ?? { x: worldX, y: 0 },
        grabX: worldX,
        grabClientX: e.clientX,
        grabClientY: e.clientY,
        moved: false,
      };
      selectInstrument({ key: "drive", index, label: index === 0 ? "The force" : `Force ${index + 1}` });
      renderer.setSelected({ key: "drive", index });
      canvas.classList.add("part-dragging");
    } else if (hit.key === "probe") {
      const place = renderer.planePoint(e.clientX, e.clientY);
      moving = {
        kind: "probe",
        index: 0,
        home: renderer.partPlace("probe"),
        grab: place ?? { x: worldX, y: 0 },
        grabX: worldX,
        grabClientX: e.clientX,
        grabClientY: e.clientY,
        moved: false,
      };
      selectInstrument({ key: "probe" });
      renderer.setSelected({ key: "probe" });
      canvas.classList.add("part-dragging");
    } else {
      /* The wall and the shake table's own arrow are not moved: the ground is
         the ground. A press on one *picks* it, which is the whole reason this
         branch exists at all - the arrow on the wall is the only thing on this
         stage that is the shake table, so a press on it that did nothing would
         be a shake table that could not be chosen from the bench the reader is
         looking at. It is picked here rather than on release because every other
         instrument on this bench is picked where it is pressed, and this one was
         the one that was not. */
      const instrument = MECH_INSTRUMENTS.find((entry) => entry.key === hit.key);
      selectInstrument(instrument ?? { key: hit.key });
      renderer.setSelected(hit.key === "probe" || hit.key === "base" ? { key: hit.key } : null);
      return;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* no capture, still drags */ }
    e.preventDefault();
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  window.addEventListener("pointermove", (e) => {
    if (resizing) {
      const point = renderer.planePoint(e.clientX, e.clientY);
      if (point === null) return;
      /* How far the hand has pulled, outwards along the way this grip goes: a
         corner is pulled away from the part, a right-press sideways. */
      const travel = (point.x - resizing.grab.x) * resizing.axis.x
        + (point.y - resizing.grab.y) * resizing.axis.y;
      if (resizing.kind === "probe") {
        /* The probe's pull is a walk along the rig rather than a number that
           grows: the block it is clipped to is a whole number, and a grip pulled
           one step to the right reads the next block and no more. */
        const step = Math.round(travel / PROBE_STEP);
        const next = Math.min(Math.max(resizing.from + step, 0), system.n - 1);
        if (next !== system.spec.output) {
          system.setOutput(next);
          clearTrace();
          rightRail.setModel(system);
        }
        renderer.update();
        return;
      }
      const value = resizeValue(resizing.kind, resizing.from, travel);
      if (resizing.kind === "mass") system.setMass(resizing.index, tidyMass(value));
      else if (resizing.kind === "spring") system.setSpring(system.elementIndices()[resizing.index].index, value);
      else if (resizing.kind === "damper") system.setDamper(system.elementIndices()[resizing.index].index, value);
      else if (resizing.kind === "drive") system.setDrive(resizing.index, { amplitude: value });
      else if (resizing.kind === "base") system.setBase({ amplitude: value });
      resizeRig();
      leftRail.sync(system);
      return;
    }
    if (placing) {
      /* A drag starts at the first few pixels of travel rather than at the press,
         so a click that picks a block never shifts it. */
      if (!placing.moved
        && Math.hypot(e.clientX - placing.grabClientX, e.clientY - placing.grabClientY) < 3) return;
      const point = renderer.planePoint(e.clientX, e.clientY);
      if (point === null) return;
      /* The block is carried, and the rig goes with it: every spring, dashpot
         and force bolted to its faces reaches to wherever the face is now, the
         probe goes on reading it, and nothing comes off. A rig laid out
         somewhere else is the same rig, so nothing is severed, nothing is
         rebuilt, and there is no note to write. */
      if (!placing.moved) placing.moved = true;
      /* Where the hand has carried it from where it was lifted: the pointer's own
         travel on the bench, so the block goes where the hand goes and the
         direction the stage is looked at from never enters into it. */
      renderer.placeMass(
        placing.index,
        placing.home.x + (point.x - placing.grab.x),
        placing.home.y + (point.y - placing.grab.y),
      );
      renderer.update();
      return;
    }
    if (moving) {
      /* A drag starts at the first few pixels of travel rather than at the press,
         so a click that picks a part never nudges it. */
      if (!moving.moved
        && Math.hypot(e.clientX - moving.grabClientX, e.clientY - moving.grabClientY) < 3) return;
      moving.moved = true;
      /* The two things a hand moves across the bench - a force and the probe -
         are carried in both directions, exactly as a block is: the pointer's own
         travel on the plane the rig is drawn in. A spring and a dashpot are fixed
         to the faces they join and are not moved at all. */
      const point = renderer.planePoint(e.clientX, e.clientY);
      if (point === null) return;
      if (moving.kind === "drive") moveDriveTo(moving, point);
      else moveProbeTo(
        moving,
        point,
        point.x - moving.grab.x,
        point.y - moving.grab.y,
      );
      return;
    }
    if (holding) {
      /* A drag starts at the first few pixels of travel rather than at the press,
         so that a click - which is a press and a release in the same place, give
         or take a jitter - never displaces anything. Three pixels: below what a
         hand means by a drag and above what a trackpad means by a click. */
      if (!holding.moved && Math.abs(e.clientX - holding.grabClientX) < 3) return;
      const worldX = renderer.planeX(e.clientX, e.clientY);
      if (worldX === null || !Number.isFinite(worldX)) return;
      holding.moved = true;
      /* Divided by the scale the drawing is *at*, not the one the reader asked
         for: a hand that has pulled a block across the bench has MOVED it by what
         it looks like it moved it by, and when the rig's stroke is longer than
         the bench those two scales are not the same number. */
      system.hold(holding.index, holding.from + (worldX - holding.grabX) / renderer.drawnScale);
      /* A mass held by the hand is not a free system, and the ledger's promise -
         every joule in accounted for - does not hold while it is held: the hand
         is putting work in that the books cannot see. So the books start again
         from where the hand has it, exactly as they do for any other edit, and
         the residual never reports the reader's own hand as a lost joule. */
      system.rebase();
      renderer.update();
      return;
    }
    const over = massUnderPointer(e.clientX, e.clientY);
    canvas.classList.toggle("mass-hover", !!over);
    canvas.classList.toggle("thing-hover", !over && !!renderer.pick(e.clientX, e.clientY));
  });

  window.addEventListener("pointerup", (e) => {
    const onStage = pressedOnStage;
    pressedOnStage = false;
    if (resizing) {
      resizing = null;
      canvas.classList.remove("mass-resizing");
      /* A part set by hand is an edit like any other: it restarts the energy
         books, so the ledger does not go on reporting the work the hand did as
         energy the system invented. */
      system.rebase();
      renderer.update();
      edited();
      updateReadouts();
      return;
    }
    if (placing) {
      const index = placing.index;
      const moved = placing.moved;
      placing = null;
      canvas.classList.remove("part-dragging");
      if (moved) {
        /* Where the block has been put is where the rig is, so the books start
           again from it rather than counting the hand's own work as a joule the
           rig invented. The rig is rebuilt but *not* re-framed: a hand putting a
           block down somewhere is not a reason for the camera to look somewhere
           else, and framing the rig would swing the view back off whatever the
           reader had turned it to. */
        system.rebase();
        resizeRig();
        edited();
        markRunStart();
        updateReadouts();
        selectInstrument({ key: "mass", index, label: `Mass ${subscript(index + 1)}` });
        renderer.setSelected({ key: "mass", index });
      }
      return;
    }
    if (moving) {
      const kind = moving.kind;
      const index = moving.index;
      const moved = moving.moved;
      moving = null;
      canvas.classList.remove("part-dragging");
      if (moved) {
        /* Where a part has come to rest is where the rig now is, so the books
           start again from it: a part dragged onto a mass changes the system,
           and a ledger that went on counting from before the hand arrived would
           report the hand's own work as energy the rig invented. */
        system.rebase();
        restage();
        edited();
        markRunStart();
        selectInstrument({ key: kind, index, label: kind === "drive" ? (index === 0 ? "The force" : `Force ${index + 1}`) : undefined });
        updateReadouts();
      }
      return;
    }
    if (holding) {
      /* Let go where it is: the block keeps the displacement and starts from
         rest, which is a release and not a throw. Only a block that was actually
         moved has plucked anything, so only that starts the run - a plucked rig
         is meant to ring, and a clicked one is meant to sit there. */
      system.release();
      holding = null;
      canvas.classList.remove("mass-dragging");
      /* The hand has done work on the system that the ledger cannot know about,
         so the books start again from where the block was let go rather than
         reporting the hand's work as a missing joule. */
      system.rebase();
      updateReadouts();
      /* Nothing on this stage starts the run. Dragging a block displaces it and
         lets it go, and whether the bench is running is the Run button's business
         and nothing else's - a stage that started the clock because someone
         pushed a block about would be a stage you could not touch. */
      scheduleSessionSave();
      return;
    }
    if (!onStage || e.button !== 0 || e.target !== canvas) return;
    const controller = renderer.mode === "2d" ? renderer.pan2d : renderer.orbit;
    if (!controller.wasClick(e)) return;
    const hit = renderer.pick(e.clientX, e.clientY);
    if (!hit) { selectInstrument(null); renderer.setSelected(null); return; }
    if (hit.key === "mass") {
      selectInstrument({ key: "mass", index: hit.index, label: `Mass ${subscript(hit.index + 1)}` });
      renderer.setSelected({ key: "mass", index: hit.index });
    } else if (hit.key === "element") {
      selectInstrument(elementSelection(hit.index));
      renderer.setSelected({ key: "element", index: hit.index });
    } else if (hit.key === "drive") {
      const index = hit.index ?? 0;
      selectInstrument({ key: "drive", index, label: index === 0 ? "The force" : `Force ${index + 1}` });
      renderer.setSelected({ key: "drive", index });
    } else {
      /* The drive, the ground and the probe are chosen by pressing the thing on
       the stage as well as by the strip, and the panel that opens has to be
       the same panel: it is headed from the instrument's own name, so the name
       is looked up rather than invented from the pick's key. */
      const instrument = MECH_INSTRUMENTS.find((entry) => entry.key === hit.key);
      selectInstrument(instrument ?? { key: hit.key });
      /* The ground and the probe are picked on the stage like everything else,
         and everything picked wears its own outline: the shake table's arrow and
         the accelerometer are instruments on this bench and not furniture. */
      renderer.setSelected(hit.key === "probe" || hit.key === "base" ? { key: hit.key } : null);
    }
  });

  /* ==================================================================================
     READING OUT
     ================================================================================== */
  /* ------------------- what the bench has to say about the rig ------------------- */
  const notesBox = document.getElementById("mechNotes");
  let notesSignature = "";

  /**
   * Say what is loose, in the stage's own corner.
   *
   * The picture already draws a part that is holding nothing as a part drooping
   * in the ground's grey, and that is the drawing. This is the sentence: a part
   * that looks loose might be loose, or the stage might simply have been turned
   * - and whether a spring is in the system or lying on the bench is not a thing
   * the reader should have to work out from a silhouette. Each row is a press
   * away from the panel that owns it, so the note is also the way to the fix.
   *
   * Rebuilt only when what it says has changed: a DOM write per frame would be a
   * layout per frame on a stage that is otherwise drawing at sixty.
   */
  function updateNotes() {
    const notes = renderer.looseNotes();
    const signature = notes.map((note) => `${note.key}:${note.index}`).join("|");
    if (signature === notesSignature) return;
    notesSignature = signature;
    if (!notesBox) return;
    notesBox.innerHTML = "";
    notesBox.classList.toggle("is-hidden", notes.length === 0);
    if (!notes.length) return;
    const head = document.createElement("div");
    head.className = "bench-notes-head";
    const glyph = document.createElement("span");
    mountIcon(glyph, "Unplug", { width: 13, height: 13 });
    const headText = document.createElement("span");
    headText.textContent = notes.length === 1 ? "One part is not connected" : `${notes.length} parts are not connected`;
    head.append(glyph, headText);
    notesBox.appendChild(head);
    for (const note of notes) {
      const row = document.createElement("button");
      row.className = "bench-note";
      row.type = "button";
      const who = document.createElement("span");
      who.className = "who";
      who.textContent = note.what;
      const what = document.createElement("span");
      what.className = "what";
      what.textContent = ` - ${note.held}`;
      row.append(who, what);
      row.title = "Open its panel";
      row.addEventListener("click", () => {
        if (note.key === "element") selectInstrument(elementSelection(note.index));
        else selectInstrument({ key: "drive", index: note.index, label: note.index === 0 ? "The force" : `Force ${note.index + 1}` });
      });
      notesBox.appendChild(row);
    }
  }

  function updateReadouts() {
    const observed = system.observe();
    updateNotes();
    rightRail.update(observed, system, trace, measured ?? {});
    leftRail.setLive({ dt: system.dt, stepsPerFrame });
    /* The scale the picture is drawn at, which is the reader's own unless the
       rig's stroke is longer than the bench it stands on. Stated every frame,
       because it is the one thing about the drawing that can change under the
       reader's feet while the run goes on. */
    const drawn = renderer.drawnScale;
    leftRail.setDrawn(drawn, motionScale, drawn < motionScale - 1e-6);
    syncInstrumentButtons();
    document.getElementById("mechSbStep").textContent = observed.steps;
    document.getElementById("mechSbTime").textContent = formatRunTime(observed.time);
    document.getElementById("mechSbRuntime").textContent = `${stepMs.toFixed(2)}ms`;
    document.getElementById("mechSbSize").textContent = `${system.n} mass${system.n === 1 ? "" : "es"}`;
  }

  /* ==================================================================================
     PAGES - independent, savable systems
     ================================================================================== */
  let pages = [];
  let activePageId = null;
  let pageIdCounter = 0;
  const pageTabs = document.getElementById("mechPagebarTabs");

  function makePage() {
    pageIdCounter++;
    return {
      id: `page-${pageIdCounter}`,
      autoNamed: true,
      name: `Page ${pages.filter((page) => page.autoNamed).length + 1}`,
      snapshot: null,
      stage: null,
      places: null,
      labId: null,
      systemId: MECH_SYSTEMS[0].id,
      trace: { t: [], x: [] },
    };
  }

  function renumberAutoPages() {
    let n = 0;
    for (const page of pages) if (page.autoNamed) page.name = `Page ${++n}`;
  }

  const activePage = () => pages.find((page) => page.id === activePageId);

  function saveIntoActivePage() {
    const page = activePage();
    if (!page) return;
    page.snapshot = system.serialize();
    page.stage = renderer.stageOffsets();
    page.places = renderer.placesFor();
    page.labId = labId;
    page.systemId = systemId;
    page.trace = { t: trace.t.slice(), x: trace.x.slice() };
  }

  function loadPage(id) {
    const page = pages.find((entry) => entry.id === id);
    if (!page) return;
    if (page.snapshot) {
      system.restore(page.snapshot);
      renderer.setStage(page.stage ?? []);
      renderer.setPlaces(page.places ?? null);
    }
    labId = page.labId ?? null;
    systemId = page.systemId ?? null;
    trace.t = page.trace?.t?.slice() ?? [];
    trace.x = page.trace?.x?.slice() ?? [];
    lastSample = trace.t.length ? trace.t[trace.t.length - 1] : -Infinity;
    measured = null;
    restage();
    leftRail.syncStepSize(system.dt);
    leftRail.syncMotion(motionScale);
    labCard.setLab(MECH_LABS.find((lab) => lab.id === labId) ?? null);
    for (const [rowId, row] of labRows) row.classList.toggle("on", rowId === labId);
    syncSystemButtons();
    selectInstrument(null);
    setRunning(false);
    markRunStart();
    updateReadouts();
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
    const index = pages.findIndex((page) => page.id === id);
    if (index === -1) return;
    pages.splice(index, 1);
    renumberAutoPages();
    if (id === activePageId) {
      const next = pages[Math.max(0, index - 1)];
      activePageId = next.id;
      loadPage(next.id);
    }
    renderPageTabs();
    scheduleSessionSave();
  }

  document.getElementById("mechAddPageBtn").addEventListener("click", addPage);

  /* ==================================================================================
     RESIZE AND THE FRAME LOOP
     ================================================================================== */
  function resize() {
    renderer.resize();
    renderer.frame();
    renderer.update();
    rightRail.fit();
  }
  window.addEventListener("resize", resize);
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { renderer.resize(); rightRail.fit(); })
      .observe(document.getElementById("mechViewport"));
  }

  function frameLoop() {
    requestAnimationFrame(frameLoop);
    /* Another bench may own the screen right now: keep the system and its clock,
       stop drawing, and do not integrate a rig nobody is looking at. */
    if (document.getElementById("mech")?.hidden) return;
    if (running) {
      const t0 = performance.now();
      advance(stepsPerFrame);
      stepMs += ((performance.now() - t0) - stepMs) * 0.15;
      sampleTrace();
      measure();
      sessionDirty = true;
    }
    renderer.update();
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
    if (!saved || saved.version !== SESSION_VERSION || !saved.system) return false;

    system.restore(saved.system);
    renderer.setStage(saved.stage);
    renderer.setPlaces(saved.places);
    if (saved.stepsPerFrame) stepsPerFrame = clamp(Math.round(saved.stepsPerFrame), 1, 40);
    if (saved.motionScale) { motionScale = saved.motionScale; renderer.setMotionScale(motionScale); }
    probeOn = !!saved.probeOn;
    renderer.setProbeVisible(probeOn);
    labId = saved.labId ?? null;
    systemId = saved.systemId ?? null;
    trace.t = saved.trace?.t?.slice() ?? [];
    trace.x = saved.trace?.x?.slice() ?? [];
    lastSample = trace.t.length ? trace.t[trace.t.length - 1] : -Infinity;
    measured = null;

    restage();
    leftRail.syncSteps(stepsPerFrame);
    leftRail.syncStepSize(system.dt);
    leftRail.syncMotion(motionScale);
    labCard.setLab(MECH_LABS.find((lab) => lab.id === labId) ?? null);
    for (const [rowId, row] of labRows) row.classList.toggle("on", rowId === labId);
    syncSystemButtons();
    setViewMode(saved.viewMode === "2d" ? "2d" : "3d");
    saveIntoActivePage();
    setRunning(false);
    markRunStart();
    updateReadouts();

    document.getElementById("mechSessionNote")?.classList.remove("is-hidden");
    return true;
  }

  function discardSession() {
    document.getElementById("mechSessionNote")?.classList.add("is-hidden");
    clearBench();
    saveSession();
  }

  document.getElementById("mechSessionDiscardBtn")?.addEventListener("click", discardSession);
  document.getElementById("mechSessionNoteClose")?.addEventListener("click", () => {
    document.getElementById("mechSessionNote")?.classList.add("is-hidden");
  });
  window.addEventListener("pagehide", saveSession);
  window.addEventListener("beforeunload", saveSession);
  document.getElementById("mechBackHomeBtn")?.addEventListener("click", () => saveSession());

  /* ----------------------------------- boot ----------------------------------- */
  const firstPage = makePage();
  pages.push(firstPage);
  renumberAutoPages();
  activePageId = firstPage.id;
  renderPageTabs();

  setViewMode("3d");
  renderer.setMotionScale(motionScale);
  renderer.setProbeVisible(probeOn);
  leftRail.setModel(system);
  rightRail.setModel(system);
  leftRail.syncStepSize(system.dt);
  leftRail.syncSteps(stepsPerFrame);
  leftRail.syncMotion(motionScale);
  rightRail.setInstrument(null);
  renderer.resize();
  renderer.frame();
  renderer.update();
  rightRail.fit();
  syncInstrumentButtons();
  syncSystemButtons();
  syncRunButton();
  syncRestartButton();
  markRunStart();
  updateReadouts();

  try {
    if (!applySession()) { /* a first visit: the bench is what it is */ }
  } catch (err) {
    console.warn("could not restore the last vibrations scene", err);
  }

  if (!restartBtn) syncRestartButton();
  document.getElementById("mechStatusText").textContent = "paused";
  requestAnimationFrame(frameLoop);

  /* Everything a test or a console session might want to hold, in one place. */
  window.__mechWorkbench = {
    system, renderer, labs: MECH_LABS, systems: MECH_SYSTEMS, instruments: MECH_INSTRUMENTS,
    applyLab, applySystem, clearBench, selectInstrument, toggleInstrument, useInstrument,
    setRunning, setViewMode, stepOnce, restartRun, measure,
    get places() { return renderer.placesFor(); },
    get notes() { return renderer.looseNotes(); },
    get activeDrive() { return activeDrive; },
    get activeElement() { return activeElement; },
    transferString: () => {
      const { num, den } = system.transfer(system.spec.excitation, system.spec.output);
      return `H(s) = (${polynomialString(num)}) / (${polynomialString(den)})`;
    },
    get running() { return running; },
    get trace() { return trace; },
    get measured() { return measured; },
    get labId() { return labId; },
    get systemId() { return systemId; },
  };
}
