/**
 * frontend/mech_ui.js - the two rails of the Vibrations workbench.
 *
 * Same furniture as the other two benches (frontend/ui.js, frontend/thermo_ui.js):
 * panel titles, rail sections, slider rows, segmented pickers, toggle switches,
 * readouts. What differs is that this rail's rows are not fixed - the model is a
 * list of masses, springs and dampers, and the panel that edits it is built from
 * that list and rebuilt when it changes. A system with three masses has three
 * mass rows, and there is no version of this panel with a wrong number of them.
 *
 * Nothing in here computes physics. The transfer function is the two polynomials
 * simulation/mech_system.js worked out, the modes are its eigenvalues, the ledger
 * is its own integrals, and every chart is a drawing of an array the caller
 * handed over. The one thing this file does decide is how a number is *written*:
 * subscripts on labels, millimetres for a displacement, decibels for a gain -
 * because those are the units a vibrations panel is read in.
 */
import { WAVEFORMS, subscript, polyRoots } from "../simulation/mech_system.js";

function el(tag, className = "", html = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== null) node.innerHTML = html;
  return node;
}

/* ---------------------------------- input rows ---------------------------------- */

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
    setDisabled(on) { input.disabled = !!on; wrap.classList.toggle("is-disabled", !!on); },
  };
}

/**
 * A slider whose travel is logarithmic, because that is the only travel that fits
 * the quantities on this bench.
 *
 * A spring may be 0.1 N/m or a hundred thousand, a mass a kilogram or a tonne,
 * and on a linear slider everything from the textbook to the car is inside the
 * first pixel. Log travel puts the whole of every range within reach, and the
 * readout carries the number so nothing is being estimated by eye.
 *
 * `zeroAtBottom` is the one concession: a damper of nothing is a real, wanted
 * setting rather than a limit, so the very bottom of a damper's travel is exactly
 * zero and everything above it is logarithmic. Written down here because the
 * alternative - a damper that cannot quite be removed - is a panel that refuses
 * to let a student do an experiment.
 */
function logSlider({ label, min, max, value, format, onInput, zeroAtBottom = false, span = 1000 }) {
  let lo = min;
  let hi = max;
  let zero = zeroAtBottom;
  let fmt = format;
  let logMin = Math.log(Math.max(lo, 1e-9));
  let logMax = Math.log(hi);
  const toSlider = (v) => {
    if (zero && !(v > 0)) return 0;
    const t = (Math.log(Math.max(v, lo)) - logMin) / (logMax - logMin);
    return Math.round(1 + t * (span - 1));
  };
  const fromSlider = (s) => {
    if (zero && s <= 0) return 0;
    const t = (s - 1) / (span - 1);
    return Math.exp(logMin + t * (logMax - logMin));
  };
  const control = slider({
    label,
    min: 0, max: span, step: 1,
    value: toSlider(value),
    format: (v) => fmt(v),
    onInput: (s) => onInput(fromSlider(s)),
  });
  return {
    wrap: control.wrap,
    setValue(v) { control.input.value = toSlider(v); control.wrap.querySelector(".ctrl-val").textContent = fmt(v); },
    setDisabled(on) { control.setDisabled(on); },
    /** Re-scale the travel: the same row is a stiffness when a spring is
     *  selected and a damping when a dashpot is, and a newton per metre is not
     *  a newton second per metre - not in its number, not in its range, and not
     *  in what the bottom of the travel means. */
    setScale({ min: nextMin, max: nextMax, format: nextFormat, zeroAtBottom: nextZero }) {
      if (nextMin !== undefined) lo = nextMin;
      if (nextMax !== undefined) hi = nextMax;
      if (nextFormat !== undefined) fmt = nextFormat;
      if (nextZero !== undefined) zero = nextZero;
      logMin = Math.log(Math.max(lo, 1e-9));
      logMax = Math.log(hi);
      control.wrap.querySelector(".ctrl-val").textContent = fmt(0);
    },
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
  const name = el("span", "rn", label);
  head.appendChild(name);
  const value = el("span", "rv tab-nums", "...");
  head.appendChild(value);
  const sub = el("div", "readout-sub", note ?? "");
  row.append(head, sub);
  return { row, label: name, value, theory: sub };
}

function segmented(label, options, initial, onPick) {
  const wrap = el("div", "ctrl");
  if (label) wrap.appendChild(el("div", "ctrl-label", label));
  const bar = el("div", "seg");
  const buttons = new Map();
  function build(list) {
    bar.innerHTML = "";
    buttons.clear();
    for (const [key, text, title] of list) {
      const button = el("button", key === current ? "on" : "", text);
      button.type = "button";
      if (title) { button.title = title; button.setAttribute("aria-label", title); }
      button.addEventListener("click", () => {
        for (const b of buttons.values()) b.classList.remove("on");
        button.classList.add("on");
        current = key;
        onPick(key);
      });
      buttons.set(key, button);
      bar.appendChild(button);
    }
  }
  let current = initial;
  build(options);
  wrap.appendChild(bar);
  return {
    wrap,
    /** Which option is chosen. The one thing a picker has to be able to answer,
     *  since several panels read their own selection back out of it. */
    get() { return current; },
    pick(key) { current = key; for (const [k, b] of buttons) b.classList.toggle("on", k === key); },
    setOptions(list, nextCurrent = current) { current = nextCurrent; build(list); },
    setEnabled(key, on) {
      const button = buttons.get(key);
      if (!button) return;
      button.disabled = !on;
      button.classList.toggle("is-off", !on);
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

/* --------------------------------- formatting --------------------------------- */
/* The units a vibrations panel is read in. Every one of these is a decision about
 * how a number is written and none of them is a decision about physics. */

const sig = (v, digits = 3) => {
  if (!Number.isFinite(v)) return "\u2014";
  if (v === 0) return "0";
  const magnitude = Math.abs(v);
  /* A stiffness of two hundred thousand newtons per metre is read as 2.00x10^5,
     with the exponent raised: the caret form is a piece of programming notation
     that has no business in a panel of numbers. */
  if (magnitude >= 1e5 || magnitude < 1e-3) {
    const [mantissa, exponent] = v.toExponential(2).split("e");
    return `${mantissa}\u00D710${superscript(Number(exponent))}`;
  }
  return Number(v.toPrecision(digits)).toString();
};

const mm = (v) => `${sig(v * 1000)} mm`;
const hz = (v) => `${sig(v)} Hz`;
const kg = (v) => `${sig(v)} kg`;
const newtons = (v) => `${sig(v)} N`;

/**
 * What a drive's own shape is, written beside the number it is at this instant.
 *
 * The arrow on the stage says how big the push is and which way it is going, and
 * the question that raises is always the same one - is this a push that is simply
 * *on*, a push that swings, or one blow - so the line under the readout answers
 * it in the drive's own words rather than leaving it to be worked out from the
 * waveform's name.
 *
 * @param {string} waveform one of simulation/mech_system.js's WAVEFORMS keys
 * @param {string} size the amplitude, already written in the drive's own unit
 * @param {number} frequency hertz
 */
function driveShape(waveform, size, frequency) {
  if (waveform === "step") return `${size}, switched on and held`;
  if (waveform === "impulse") return `${size}\u00B7s, one blow as the run starts`;
  if (waveform === "off") return "nothing is pushing it";
  return `\u00B1${size} at ${hz(frequency)}`;
}

/**
 * What is driving the system, in one line, for the foot of the WHAT DRIVES IT
 * section.
 *
 * The buttons above it say *that* something is driving; this says what the drive
 * is, in the same words the readouts use - so whether the push is one that stays
 * on, one that swings, or one blow is answered where the question is asked,
 * without opening an instrument's panel to read its waveform.
 *
 * @param {object} system the model
 */
function driveLine(system) {
  const say = [];
  for (const drive of system.spec.drives) {
    if (drive.waveform === "off") continue;
    if (drive.mass === null || drive.mass === undefined) continue;
    const mass = `m${subscript(drive.mass + 1)}`;
    say.push(drive.waveform === "impulse"
      ? `one blow on ${mass}, ${sig(drive.amplitude, 3)} N\u00B7s as the run starts`
      : `a ${drive.waveform} push on ${mass}, ${driveShape(drive.waveform, `${sig(drive.amplitude, 3)} N`, drive.frequency)}`);
  }
  if (system.spec.base.waveform !== "off") {
    const base = system.spec.base;
    const what = base.waveform === "step" ? "the ground itself offset" : "the ground itself shaking";
    say.push(`${what}, ${driveShape(base.waveform, `${sig(base.amplitude * 1000, 3)} mm`, base.frequency)}`);
  }
  if (!say.length) return "nothing pushing: whatever it does, it does on its own";
  return say.join(", and ");
}
const stiffness = (v) => `${sig(v)} N/m`;
const damping = (v) => `${sig(v)} N\u00B7s/m`;
const radPerSecond = (v) => `${sig(v)} rad/s`;

/** A polynomial as it is written on paper: highest power first, terms joined by
 *  the sign of the next one, and nothing but a zero when there is nothing. */
export function polynomialString(coeffs, variable = "s") {
  const power = (n) => (n === 0 ? "" : n === 1 ? variable : `${variable}\u00B0`.replace("\u00B0", superscript(n)));
  const terms = [];
  coeffs.forEach((c, i) => {
    const exponent = coeffs.length - 1 - i;
    if (Math.abs(c) < 1e-14 * Math.max(...coeffs.map(Math.abs), 1)) return;
    const magnitude = sig(Math.abs(c), 4);
    const body = `${magnitude === "1" && exponent > 0 ? "" : magnitude}${power(exponent)}`;
    terms.push({ body, negative: c < 0 });
  });
  if (!terms.length) return "0";
  return terms.map((term, i) => (i === 0
    ? (term.negative ? `\u2212${term.body}` : term.body)
    : ` ${term.negative ? "\u2212" : "+"} ${term.body}`)).join("");
}

function superscript(n) {
  const map = {
    0: "\u2070", 1: "\u00B9", 2: "\u00B2", 3: "\u00B3", 4: "\u2074",
    5: "\u2075", 6: "\u2076", 7: "\u2077", 8: "\u2078", 9: "\u2079",
    "-": "\u207B",
  };
  return String(n).split("").map((d) => map[d] ?? d).join("");
}

/* ==================================================================================
   THE LEFT RAIL - what the system is
   ================================================================================== */

/**
 * @param {HTMLElement} container
 * @param {object} callbacks onMass, onSpring, onDamper, onAddMass, onRemoveMass,
 *        onExcitation, onWaveform?, onStep, onSteps, onMotion, onSettle
 */
export function buildMechLeftRail(container, callbacks = {}) {
  /* ---------------------------------- THE MODEL ---------------------------------- */
  container.appendChild(el("div", "panel-title", "THE SYSTEM"));
  const modelSection = el("div", "rail-section");
  const modelRows = el("div", "model-rows");
  const modelButtons = el("div", "btn-row");
  const addBtn = el("button", "btn", "Add a mass");
  /* Two words each, because these two share one row: a label that wraps puts the
     pair at two different heights, and two buttons of one row that do not line
     up are the first thing a reader sees on a rail. */
  const removeBtn = el("button", "btn", "Remove last");
  addBtn.type = "button";
  removeBtn.type = "button";
  addBtn.addEventListener("click", () => callbacks.onAddMass?.());
  removeBtn.addEventListener("click", () => callbacks.onRemoveMass?.());
  modelButtons.append(addBtn, removeBtn);
  modelSection.append(modelRows, modelButtons);
  container.appendChild(modelSection);

  /* --------------------------------- THE DRIVING --------------------------------- */
  /* What is exciting the system, in one place, because a force on a mass and a
     shaking base are two answers to one question - and a system being driven by
     both at once has no single transfer function to put on the right rail. The
     numbers behind each one belong to the instrument that carries them. */
  container.appendChild(el("div", "panel-title", "WHAT DRIVES IT"));
  const driveSection = el("div", "rail-section");
  const excitation = segmented(
    "",
    [["force", "A force"], ["base", "The base"], ["off", "Nothing"]],
    "force",
    (key) => callbacks.onExcitation?.(key),
  );
  driveSection.appendChild(excitation.wrap);
  /* The buttons say which kind of thing is driving; this says what the drive
     actually is, from the model, in the readouts' own words. */
  const driveNote = el("div", "rail-note", "");
  driveSection.appendChild(driveNote);
  container.appendChild(driveSection);

  /* ---------------------------------- TIMELINE ---------------------------------- */
  container.appendChild(el("div", "panel-title", "TIMELINE"));
  const timeSection = el("div", "rail-section");

  const stepSize = segmented(
    "The step it is solved on",
    [["0.005", "Coarse"], ["0.002", "Standard"], ["0.0005", "Fine"], ["0.0001", "Finest"]],
    "0.002",
    (key) => callbacks.onStep?.(Number(key)),
  );
  stepSize.wrap.classList.add("group-end");
  timeSection.appendChild(stepSize.wrap);

  const stepsS = slider({
    label: "Steps per frame", min: 1, max: 40, step: 1, value: 12,
    format: (v) => v.toFixed(0),
    onInput: (v) => callbacks.onSteps?.(v),
  });
  timeSection.appendChild(stepsS.wrap);

  const motionS = logSlider({
    label: "Magnify the motions", min: 0.5, max: 200, value: 1,
    format: (v) => `${sig(v, 2)}\u00D7`,
    onInput: (v) => callbacks.onMotion?.(v),
  });
  /* The picture is magnified and the panel says so: a quarter car's millimetres
     drawn at life size is a picture of nothing moving, and a picture whose scale
     is not stated is worse than one that is. */
  motionS.wrap.classList.add("group-end");
  timeSection.appendChild(motionS.wrap);

  const stepRow = readout("The step solves");
  const paceRow = readout("One second shows");
  /* How much the stage is *actually* magnifying by. The slider above asks for a
     scale; the picture is drawn at that one or, when the rig's stroke is longer
     than the bench it stands on, at the largest one that still fits - and a
     picture whose scale is not the one the slider says is a picture that has to
     say so itself. */
  const drawnRow = readout("The picture is drawn at");
  timeSection.append(stepRow.row, paceRow.row, drawnRow.row);

  const settleRow = el("div", "btn-row plot-actions");
  const settleBtn = el("button", "btn", "Stop it where it is");
  settleBtn.type = "button";
  settleBtn.addEventListener("click", () => callbacks.onSettle?.());
  settleRow.appendChild(settleBtn);
  timeSection.appendChild(settleRow);
  container.appendChild(timeSection);

  /* ---------------------------------- the model rows ---------------------------------- */
  let rows = [];
  /* The element rows by the index they edit, so a spring picked on the stage can
     be shown on the rail as the row that is talking about it. */
  const elementWraps = new Map();

  /**
   * Build the panel's rows from the model. Called whenever the model changes and
   * never otherwise: the row for a spring that has just been added is created
   * once, with its own callback closed over its own index, and from then on it is
   * only ever synced.
   */
  function setModel(system) {
    for (const row of rows) row.wrap.remove();
    rows = [];
    elementWraps.clear();
    const labels = system.labels();
    const elementIndices = system.elementIndices();

    system.masses.forEach((mass, i) => {
      const control = logSlider({
        label: labels.masses[i], min: 0.01, max: 20000, value: mass.m,
        format: kg,
        onInput: (v) => callbacks.onMass?.(i, v),
      });
      control.wrap.title = `${labels.masses[i]}: what this mass weighs, in kilograms`;
      modelRows.appendChild(control.wrap);
      rows.push(control);
    });

    system.elements.forEach((element, index) => {
      const meta = elementIndices[index];
      const isSpring = element.kind === "spring";
      const label = `${isSpring ? "k" : "c"}${subscript(meta.index + 1)}`;
      const control = isSpring
        ? logSlider({
          label, min: 0.1, max: 3e6, value: element.k,
          format: stiffness,
          onInput: (v) => callbacks.onSpring?.(meta.index, v),
        })
        : logSlider({
          label, min: 0.002, max: 1e6, value: element.c, zeroAtBottom: true,
          format: (v) => (v <= 0 ? "none" : damping(v)),
          onInput: (v) => callbacks.onDamper?.(meta.index, v),
        });
      control.wrap.title = isSpring
        ? `${label}: the stiffness of this spring, in newtons per metre`
        : `${label}: the viscous damping of this dashpot, in newton seconds per metre`;
      /* The element's own index within its kind is what the panel edits; its
         place in the model's list is only needed to find it. */
      control.wrap.addEventListener("pointerdown", () => callbacks.onSelectElement?.(index));
      elementWraps.set(index, control.wrap);
      modelRows.appendChild(control.wrap);
      rows.push(control);
    });

    removeBtn.disabled = system.n <= 1;
    sync(system);
  }

  /** Sync every control to the model as it is now. The rows are built in one
   *  order - masses first, then the elements in the model's own order - so this
   *  walks the same list in the same order and cannot get out of step. */
  function sync(system) {
    let at = 0;
    for (const mass of system.masses) rows[at++]?.setValue(mass.m);
    for (const element of system.elements) {
      rows[at++]?.setValue(element.kind === "spring" ? element.k : element.c);
    }
    excitation.setEnabled("base", !!system.hasGround);
    const driving = system.spec.drive.waveform !== "off" || system.spec.base.waveform !== "off";
    excitation.pick(!driving ? "off" : (system.spec.excitation === "base" ? "base" : "force"));
    driveNote.textContent = driveLine(system);
  }

  return {
    setModel,
    sync,
    setLive(o) {
      stepRow.value.textContent = `${sig(o.dt * 1000, 3)} ms`;
      paceRow.value.textContent = `${sig(o.stepsPerFrame * o.dt, 3)} s of motion`;
    },
    syncSteps(v) { stepsS.setValue(v); },
    syncStepSize(dt) {
      /* The picker shows the nearest of its four steps, so a session restored
         with a step from an older version still reads as one of them rather
         than as nothing at all. */
      let best = "0.002";
      for (const key of ["0.005", "0.002", "0.0005", "0.0001"]) {
        if (Math.abs(Number(key) - dt) < Math.abs(Number(best) - dt)) best = key;
      }
      stepSize.pick(best);
    },
    syncMotion(v) { motionS.setValue(v); },
    /** What the drawing is magnified by, and whether that is what was asked for. */
    setDrawn(v, wanted, capped) {
      drawnRow.value.textContent = `${sig(v, 2)}\u00D7`;
      drawnRow.value.classList.toggle("is-capped", !!capped);
      drawnRow.row.title = capped
        ? `The rig's stroke is longer than the bench: drawn at ${sig(v, 2)}\u00D7 rather than the ${sig(wanted, 2)}\u00D7 set above, so the rig stays inside its own bench. The readings are all at life size.`
        : "The motion on the stage, at the scale the slider above is set to.";
    },
    syncExcitation(system) { sync(system); },
    /** Say which row the stage has picked, so the spring a reader clicked on the
     *  stage is the spring that looks picked on the rail. */
    pick(what) {
      for (const wrap of elementWraps.values()) wrap.classList.remove("picked");
      if (what?.key === "element") elementWraps.get(what.index)?.classList.add("picked");
    },
  };
}

/* ==================================================================================
   THE RIGHT RAIL - what the system is doing
   ================================================================================== */

const GRID = "rgba(255,255,255,0.07)";
const AXIS = "rgba(255,255,255,0.18)";
const ACCENT = "#b18cf5";
const THEORY = "rgba(255,255,255,0.5)";
const TRACE = "#e0b48a";
const MEASURED_DOT = "#7fc0b1";

/** A canvas that keeps its pixels square whatever the panel's width. Same helper
 *  the Thermo rail uses, and for the same reason: the height is the stylesheet's
 *  business and this only keeps the buffer square. */
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

function plotFrame(ctx, W, H, dpr) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.font = `${9 * dpr}px Inter, system-ui, sans-serif`;
}

/**
 * The poles and zeros on the complex plane.
 *
 * The one picture in a vibrations course that is drawn as a diagram rather than
 * as a measurement, and worth drawing because it is where the two halves of the
 * panel meet: a pole's distance from the origin is the frequency a mode rings at
 * and its angle from the imaginary axis is how long it rings for. Two circles -
 * the natural frequency and the damped one - are drawn so that a pole sitting
 * between them is visibly a damped mode and not a mistake.
 */
function drawRootMap(canvas, poles, zeros) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  plotFrame(ctx, W, H, dpr);

  const all = [...poles, ...zeros];
  if (!all.length) {
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.textAlign = "center";
    ctx.fillText("no poles yet", W / 2, H / 2);
    ctx.textAlign = "left";
    return;
  }
  let maxRe = 0, maxIm = 0;
  for (const point of all) {
    maxRe = Math.max(maxRe, Math.abs(point.re));
    maxIm = Math.max(maxIm, Math.abs(point.im));
  }
  maxIm = Math.max(maxIm, 1e-9);
  const pad = 8 * dpr;
  const span = Math.max(maxRe / 0.8, 1e-9);
  const x = (re) => pad + ((re + span) / (2 * span)) * (W - pad * 2);
  const scale = (W - pad * 2) / (2 * span);
  const y = (im) => H / 2 - im * scale;

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, H / 2); ctx.lineTo(W - pad, H / 2);
  ctx.moveTo(x(0), 2 * dpr); ctx.lineTo(x(0), H - 2 * dpr);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillText("Re", W - pad - ctx.measureText("Re").width, H / 2 + 11 * dpr);
  ctx.fillText("Im", x(0) + 4 * dpr, 9 * dpr);

  const mark = (point, kind) => {
    const px = x(point.re);
    const py = y(point.im);
    const size = 4.2 * dpr;
    ctx.strokeStyle = kind === "zero" ? MEASURED_DOT : ACCENT;
    ctx.fillStyle = kind === "zero" ? "transparent" : ACCENT;
    ctx.lineWidth = 1.6 * dpr;
    if (kind === "zero") {
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(px - size, py - size); ctx.lineTo(px + size, py + size);
      ctx.moveTo(px + size, py - size); ctx.lineTo(px - size, py + size);
      ctx.stroke();
    }
  };
  for (const point of poles) if (Math.abs(point.im) < 1e-9 ? true : point.im > 0) { mark(point, "pole"); if (point.im > 1e-9) mark({ re: point.re, im: -point.im }, "pole"); }
  for (const point of zeros) if (Math.abs(point.im) < 1e-9 ? true : point.im > 0) { mark(point, "zero"); if (point.im > 1e-9) mark({ re: point.re, im: -point.im }, "zero"); }
}

/** The magnitude of H(j omega) in decibels, against log frequency: the plot a
 *  vibration test produces and a designer reads. */
function drawBode(canvas, system, from, to, markerHz, measuredGain) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  plotFrame(ctx, W, H, dpr);

  const modes = system.modes.map((mode) => mode.frequency).filter((f) => f > 1e-6);
  const lowest = modes.length ? Math.min(...modes) : 0.5;
  const highest = modes.length ? Math.max(...modes) : 5;
  const fMin = Math.max(1e-4, lowest / 30);
  const fMax = highest * 30;
  const pad = 10 * dpr;
  const x = (f) => pad + (Math.log10(f) - Math.log10(fMin)) / (Math.log10(fMax) - Math.log10(fMin)) * (W - pad * 2);

  /* The decibel range is set from the curve rather than fixed, so a lightly
     damped rig's tall peak is drawn to the top of the frame instead of off it. */
  const samples = [];
  let top = 0;
  for (let i = 0; i <= 220; i++) {
    const f = fMin * Math.pow(fMax / fMin, i / 220);
    const value = system.frequencyResponse(from, to, 2 * Math.PI * f);
    const db = 20 * Math.log10(Math.max(value.magnitude, 1e-12));
    samples.push({ f, db });
    top = Math.max(top, db);
  }
  const ceiling = Math.max(10, Math.ceil(top / 10) * 10);
  const floor = Math.min(-40, Math.ceil((Math.min(...samples.map((s) => s.db)) - 10) / 20) * 20);
  const y = (db) => H - pad - ((db - floor) / (ceiling - floor)) * (H - pad * 2);

  ctx.strokeStyle = GRID;
  ctx.beginPath();
  for (let db = floor; db <= ceiling; db += Math.max(20, (ceiling - floor) / 4)) {
    ctx.moveTo(pad, y(db)); ctx.lineTo(W - pad, y(db));
  }
  ctx.stroke();
  /* The 0 dB line is the one that says "as loud as it was": it is drawn in the
     axis colour rather than the grid's, because everything above it is a system
     being made worse by the thing holding it. */
  ctx.strokeStyle = AXIS;
  ctx.beginPath();
  ctx.moveTo(pad, y(0)); ctx.lineTo(W - pad, y(0));
  ctx.stroke();

  ctx.beginPath();
  samples.forEach((sample, i) => {
    if (i === 0) ctx.moveTo(x(sample.f), y(sample.db));
    else ctx.lineTo(x(sample.f), y(sample.db));
  });
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 1.6 * dpr;
  ctx.stroke();

  /* Resonance marks: a hairline at each undamped natural frequency, so the peaks
     on the curve and the frequencies in the panel are visibly the same list. */
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.setLineDash([3 * dpr, 4 * dpr]);
  for (const f of modes) {
    ctx.beginPath();
    ctx.moveTo(x(f), 0); ctx.lineTo(x(f), H - pad);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (markerHz > 0 && markerHz >= fMin && markerHz <= fMax) {
    const value = system.frequencyResponse(from, to, 2 * Math.PI * markerHz);
    const db = 20 * Math.log10(Math.max(value.magnitude, 1e-12));
    ctx.strokeStyle = "rgba(224,180,138,0.75)";
    ctx.beginPath();
    ctx.moveTo(x(markerHz), H - pad); ctx.lineTo(x(markerHz), y(db));
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x(markerHz), y(db), 3.4 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = TRACE;
    ctx.fill();
  }
  /* And the measured point, where a settling run actually got to. The two being
     on top of each other is the experiment working. */
  if (measuredGain > 0 && markerHz > 0 && markerHz >= fMin && markerHz <= fMax) {
    const db = 20 * Math.log10(Math.max(measuredGain, 1e-12));
    ctx.beginPath();
    ctx.arc(x(markerHz), y(db), 3.4 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = MEASURED_DOT;
    ctx.fill();
  }

  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillText(`${sig(fMin / 2, 2)} Hz`, pad, H - 2 * dpr);
  const rightLabel = `${sig(fMax / 2, 2)} Hz`;
  ctx.fillText(rightLabel, W - pad - ctx.measureText(rightLabel).width, H - 2 * dpr);
  ctx.fillText(`${ceiling} dB`, pad + 2 * dpr, 10 * dpr);
}

/**
 * The response, as a chart recorder: the probe's displacement against time, with
 * the last few seconds kept.
 *
 * The dashed pair of lines is what makes this more than a scope trace. During a
 * harmonic run the steady state the transfer function predicts is known, and it
 * is drawn as an envelope the response has to settle onto - so "does the theory
 * hold" is answered by looking at whether the wiggles stay inside the lines.
 */
function drawResponse(canvas, trace, envelope, period) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  plotFrame(ctx, W, H, dpr);

  if (!trace || trace.t.length < 2) {
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.strokeRect(6 * dpr, 6 * dpr, W - 12 * dpr, H - 12 * dpr);
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(255,255,255,0.30)";
    ctx.textAlign = "center";
    ctx.fillText("Something has to move first", W / 2, H / 2 + 4 * dpr);
    ctx.textAlign = "left";
    return;
  }

  const pad = 8 * dpr;
  const t0 = trace.t[0];
  const t1 = trace.t[trace.t.length - 1];
  let peak = 0;
  for (const value of trace.x) peak = Math.max(peak, Math.abs(value));
  if (envelope) peak = Math.max(peak, Math.abs(envelope));
  peak = peak || 1;
  const top = peak * 1.15;
  const x = (t) => pad + ((t - t0) / Math.max(t1 - t0, 1e-9)) * (W - pad * 2);
  const y = (v) => H / 2 - (v / top) * (H / 2 - pad);

  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, H / 2); ctx.lineTo(W - pad, H / 2);
  ctx.stroke();

  if (envelope) {
    ctx.strokeStyle = "rgba(177,140,245,0.55)";
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    ctx.beginPath();
    ctx.moveTo(pad, y(envelope)); ctx.lineTo(W - pad, y(envelope));
    ctx.moveTo(pad, y(-envelope)); ctx.lineTo(W - pad, y(-envelope));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  trace.x.forEach((value, i) => {
    const px = x(trace.t[i]);
    const py = y(value);
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  });
  ctx.strokeStyle = TRACE;
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = "round";
  ctx.stroke();

  ctx.fillStyle = "rgba(255,255,255,0.45)";
  const span = t1 - t0;
  ctx.fillText(`${sig(span, 2)} s`, pad, H - 2 * dpr);
  const scale = `\u00B1${sig(top * 1000, 2)} mm`;
  ctx.fillText(scale, W - pad - ctx.measureText(scale).width, H - 2 * dpr);
  if (period) {
    const label = `1 period = ${sig(period, 2)} s`;
    ctx.fillText(label, W - pad - ctx.measureText(label).width, 10 * dpr);
  }
}

/**
 * The instruments' own panels, and the one thing each of them owns.
 *
 * An instrument is set up where it is *chosen*, exactly as on the Thermo bench:
 * the right rail is the inspector, and it shows the settings of whatever is
 * selected on the stage. So the force and its frequency belong to the drive, the
 * road's motion to the shake table, and the choice of which mass is the output to
 * the probe - and none of them has a second copy on the left.
 */
const INSTRUMENT_SETTINGS = {
  drive: ["driveWaveform", "driveAmplitude", "driveFrequency", "driveMass"],
  base: ["baseWaveform", "baseAmplitude", "baseFrequency"],
  probe: ["probeMass"],
  mass: ["massValue"],
  element: ["elementValue"],
};

const INSTRUMENT_NOTES = {
  /* The arrow on the stage says where the force is applied and which way it
     pushes; the number here says how hard. The note divides the two, because a
     reader who takes the arrow's length for the size of the push has been told
     the wrong thing about both - and the Waveform above is where the force's own
     shape is, so the note points at it rather than at the stage. */
  drive: "a force applied to one mass: the arrow on the stage shows the face it is applied to and stands there for as long as the drive is on, and the Force number is what it is pushing with right now - whether that push stays on, swings, or lands one blow is the Waveform above",
  base: "the ground itself, moved",
  probe: "the accelerometer that makes one mass the output",
  mass: "one of the blocks the system is made of",
  element: "one spring or dashpot",
};

/**
 * @param {HTMLElement} container
 * @param {object} callbacks onDrive, onBase, onOutput, onMass, onElement,
 *        onExcitation, onClearTrace, onExportResponse, onExportBode, onRemove
 */
export function buildMechRightRail(container, callbacks = {}) {
  /* --------------------------------- INSTRUMENT --------------------------------- */
  const instrumentPanel = el("div", "instrument-panel is-hidden");
  instrumentPanel.appendChild(el("div", "panel-title", "INSTRUMENT"));
  const instrumentSection = el("div", "rail-section");
  const instrumentName = el("div", "section-label", "");
  const instrumentNote = el("div", "instrument-note", "");
  const controls = el("div", "instrument-settings");

  const driveWave = segmented(
    "Waveform",
    WAVEFORMS.map((wave) => [wave.key, wave.label, wave.note]),
    "sine",
    (key) => callbacks.onDrive?.({ waveform: key }),
  );
  const driveAmp = logSlider({
    label: "Force", min: 0.001, max: 1e6, value: 1, format: newtons,
    onInput: (v) => callbacks.onDrive?.({ amplitude: v }),
  });
  const driveFreq = logSlider({
    label: "Frequency", min: 0.01, max: 200, value: 0.5, format: hz,
    onInput: (v) => callbacks.onDrive?.({ frequency: v }),
  });
  /* Which mass a force pushes, plus the one option that is not a mass: a force
     bolted to nothing, which is a shaker standing on the bench pushing air - and
     the bench says so out loud when it is. */
  const driveMassPick = segmented(
    "On",
    [["0", "m\u2081"], ["none", "nothing"]],
    "0",
    (key) => callbacksDriveMass(key));
  /* Where the whole of a part is bolted is the model's own edit, not the drive's
     own numbers, so it goes out on its own callback. */
  function callbacksDriveMass(key) {
    if (key === "none") callbacks.onDriveMass?.(currentInstance ?? 0, null);
    else callbacks.onDriveMass?.(currentInstance ?? 0, Number(key));
  }

  const baseWave = segmented(
    "Waveform",
    WAVEFORMS.filter((wave) => wave.key !== "impulse").map((wave) => [wave.key, wave.label, wave.note]),
    "sine",
    (key) => callbacks.onBase?.({ waveform: key }),
  );
  const baseAmp = logSlider({
    label: "Amplitude", min: 0.01, max: 500, value: 10,
    format: (v) => `${sig(v, 3)} mm`,
    onInput: (v) => callbacks.onBase?.({ amplitude: v / 1000 }),
  });
  const baseFreq = logSlider({
    label: "Frequency", min: 0.01, max: 200, value: 1, format: hz,
    onInput: (v) => callbacks.onBase?.({ frequency: v }),
  });

  const probeMassPick = segmented("", [["0", "m\u2081"]], "0", (key) => callbacks.onOutput?.(Number(key)));
  const massValue = logSlider({
    label: "Mass", min: 0.01, max: 20000, value: 1, format: kg,
    onInput: (v) => callbacks.onMass?.(currentMass, v),
  });
  /* One row for both kinds of element, re-scaled when the selection changes:
     a spring's stiffness and a dashpot's damping are different quantities with
     different ranges and different units, and a panel that showed one in the
     other's would be a panel that cannot be trusted to set either. The limits
     are the left rail's own, so the two ways into the same number cannot
     disagree. */
  const elementValue = logSlider({
    label: "Stiffness", min: 0.1, max: 3e6, value: 1, format: stiffness,
    onInput: (v) => callbacks.onElement?.(currentElement, v),
  });
  const ELEMENT_SCALE = {
    spring: { min: 0.1, max: 3e6, format: stiffness, zeroAtBottom: false },
    damper: { min: 0.002, max: 1e6, format: (v) => (v <= 0 ? "none" : damping(v)), zeroAtBottom: true },
  };
  /* Which end of the element this is bolted to, so a spring that has come off
     its bearing can be bolted back on from the panel as well as by dragging it.
     The options are the model's own, rebuilt with it, because a rig can gain a
     mass while the panel is open. */
  const elementEndA = segmented("From", [["0", "m\u2081"]], "0", (key) => callbacks.onElementEnd?.(currentElement, "a", key));
  const elementEndB = segmented("To", [["0", "m\u2081"]], "0", (key) => callbacks.onElementEnd?.(currentElement, "b", key));
  const elementNote = el("div", "instrument-note", "");
  elementNote.classList.add("is-hidden");
  const elementStatus = el("div", "instrument-note", "");
  elementStatus.classList.add("is-hidden");

  const driveRead = measured("The force right now");
  const baseRead = measured("The ground right now");
  const probeRead = measured("This mass is doing");
  const massRead = measured("Where it is", "");

  const parts = new Map([
    ["driveWaveform", driveWave.wrap],
    ["driveAmplitude", driveAmp.wrap],
    ["driveFrequency", driveFreq.wrap],
    ["driveMass", driveMassPick.wrap],
    ["baseWaveform", baseWave.wrap],
    ["baseAmplitude", baseAmp.wrap],
    ["baseFrequency", baseFreq.wrap],
    ["probeMass", probeMassPick.wrap],
    ["probeRead", probeRead.row],
    ["massValue", massValue.wrap],
    ["massRead", massRead.row],
    ["elementValue", elementValue.wrap],
    ["elementEndA", elementEndA.wrap],
    ["elementEndB", elementEndB.wrap],
    ["elementNote", elementNote],
    ["elementStatus", elementStatus],
    ["driveRead", driveRead.row],
    ["baseRead", baseRead.row],
  ]);
  for (const node of parts.values()) controls.appendChild(node);

  const removeRow = el("div", "btn-row");
  const removeBtn = el("button", "btn", "Take it off the bench");
  removeBtn.type = "button";
  removeBtn.addEventListener("click", () => { if (active) callbacks.onRemove?.(active); });
  removeRow.appendChild(removeBtn);

  instrumentSection.append(instrumentName, instrumentNote, controls, removeRow);
  instrumentPanel.appendChild(instrumentSection);
  container.appendChild(instrumentPanel);

  let active = null;
  let currentInstance = null;
  let currentMass = 0;
  let currentElement = 0;
  /* Which kind of element the Value row is currently scaled for, so the row is
     re-scaled when the selection changes kind and not once per frame. */
  let elementScaleShown = null;

  /* ------------------------------- WHAT IT IS DOING ------------------------------- */
  container.appendChild(el("div", "panel-title", "THE SYSTEM, RIGHT NOW"));
  const stateSection = el("div", "rail-section");
  const massRows = [];
  const massRowsWrap = el("div", "state-rows");
  stateSection.appendChild(massRowsWrap);
  const keR = readout("Kinetic energy");
  const peR = readout("Elastic energy");
  const totalR = readout("Total");
  const inR = readout("Work in");
  const dissR = readout("Dissipated");
  const resR = readout("U \u2212 U\u2080 \u2212 W + Q");
  resR.row.classList.add("ledger-residual");
  stateSection.append(keR.row, peR.row, totalR.row, inR.row, dissR.row, resR.row);
  container.appendChild(stateSection);

  /* --------------------------------- MODES AND POLES --------------------------------- */
  container.appendChild(el("div", "panel-title", "MODES AND POLES"));
  const modeSection = el("div", "rail-section");
  const modeRows = el("div", "state-rows");
  const rootMap = stageCanvas("plot-roots");
  modeSection.append(modeRows, rootMap.wrap);
  container.appendChild(modeSection);

  /* --------------------------------- THE TRANSFER FUNCTION --------------------------------- */
  container.appendChild(el("div", "panel-title", "TRANSFER FUNCTION"));
  const transferSection = el("div", "rail-section");
  const fromPick = segmented("From", [["force", "A force", "the drive"]], "force", (key) => callbacks.onTransferFrom?.(key));
  const toPick = segmented("To", [["0", "m\u2081"]], "0", (key) => callbacks.onOutput?.(Number(key)));
  const formula = el("div", "formula tab-nums", "");
  const dcR = measured("Steady gain at zero frequency", "");
  const pointR = measured("At the drive's own frequency", "");
  const bode = stageCanvas("plot-bode");
  const bodeNote = el("div", "plot-legend",
    '<span class="key key-curve"></span>the theory<span class="key key-measured"></span>what the run measured');
  const bodeRow = el("div", "btn-row plot-actions");
  const exportBode = el("button", "btn", "Export the curve");
  exportBode.type = "button";
  exportBode.addEventListener("click", () => callbacks.onExportBode?.());
  bodeRow.appendChild(exportBode);
  transferSection.append(fromPick.wrap, toPick.wrap, formula, pointR.row, dcR.row, bode.wrap, bodeNote, bodeRow);
  container.appendChild(transferSection);

  /* ------------------------------------ THE RESPONSE ------------------------------------ */
  container.appendChild(el("div", "panel-title", "RESPONSE"));
  const responseSection = el("div", "rail-section");
  const response = stageCanvas("plot-response");
  const ampR = measured("Amplitude of the output", "");
  const peakR = readout("Peak");
  const phaseR = measured("Steady yet", "");
  const responseRow = el("div", "btn-row plot-actions");
  const clearBtn = el("button", "btn", "Clear the trace");
  const exportResp = el("button", "btn", "Export CSV");
  clearBtn.type = "button";
  exportResp.type = "button";
  clearBtn.addEventListener("click", () => callbacks.onClearTrace?.());
  exportResp.addEventListener("click", () => callbacks.onExportResponse?.());
  responseRow.append(clearBtn, exportResp);
  responseSection.append(response.wrap, ampR.row, peakR.row, phaseR.row, responseRow);
  container.appendChild(responseSection);

  /* ------------------------------------ syncing ------------------------------------ */

  /** Rebuild the pickers that name masses: their options are the model's, so they
   *  are rebuilt with it rather than being kept in step by hand. */
  function setModel(system) {
    const labels = system.labels();
    const options = labels.masses.map((name, i) => [String(i), name]);
    /* The two ends of an element are picked from the same list of masses the
       rest of the panel uses, plus the ground - and one option that is not a
       place at all, which is what a part that is not connected is bolted to. */
    const endOptions = [...options, ["g", "the ground"], ["none", "nothing"]];
    elementEndA.setOptions(endOptions, "0");
    elementEndB.setOptions(endOptions, "g");
    /* Which mass the force acts on, said out loud on hover: a force bolted to
       nothing is a shaker standing on the bench pushing air, and the stage draws
       it as one, so the option that puts it there has to say so. */
    driveMassPick.setOptions([
      ...options.map(([key, text]) => [key, text, `the force pushes ${text}`]),
      ["none", "nothing", "bolted to nothing: a shaker standing on the bench, pushing air"],
    ], "0");
    probeMassPick.setOptions(options, String(system.spec.output));
    toPick.setOptions(options, String(system.spec.output));
    const inputs = system.inputs();
    fromPick.setOptions(inputs.map((input) => [input.key, input.key === "base" ? "The base" : "A force"]), system.spec.excitation);
    fromPick.setEnabled("base", system.hasGround);
  }

  function setInstrument(what) {
    active = what?.key ?? null;
    /* Which instance of it: a rig put on the bench from above can carry several
       springs and more than one block, and a panel that opened the first one
       whatever was pressed would be a panel that edited a different spring than
       the one on the stage. */
    currentInstance = what?.index ?? null;
    instrumentPanel.classList.toggle("is-hidden", !active);
    const shown = new Set(INSTRUMENT_SETTINGS[active] ?? []);
    if (active === "mass") shown.add("massRead");
    if (active === "probe") shown.add("probeRead");
    if (active === "drive") shown.add("driveRead");
    if (active === "base") shown.add("baseRead");
    if (active === "mass" || active === "element") {
      instrumentName.textContent = active === "mass"
        ? (what.index === undefined ? "" : `Mass ${subscript(what.index + 1)}`)
        : `${what.label ?? (active === "element" ? "Spring" : "")}`;
    } else {
      instrumentName.textContent = what?.label ?? "";
    }
    instrumentNote.textContent = active
      ? (active === "mass" || active === "element" ? INSTRUMENT_NOTES[active] : INSTRUMENT_NOTES[active] ?? "")
      : "";
    for (const [name, node] of parts) node.classList.toggle("is-hidden", !shown.has(name));
    /* Every instrument this bench has can be taken off it, the accelerometer
       included: a strip that offers to put something out and then cannot take it
       back is a strip that only works one way. A spring, a dashpot and a force
       are taken off the same way - and when the last force goes, it is switched
       off rather than removed, which is what the model does with it. */
    removeRow.classList.toggle("is-hidden",
      !(active === "drive" || active === "base" || active === "probe" || active === "element"));
    removeBtn.textContent = active === "element" ? "Take it off the bench" : "Take it off the bench";
    return { active };
  }

  /** How an end of an element is written in the panel's own pickers. */
  const endKey = (v) => (v === null || v === undefined ? "none" : String(v));

  /** The sentence the panel prints about an element that is holding nothing: the
   *  same statement the stage's own note makes, in the same words, so the two
   *  cannot read as two different problems. */
  function looseSentence(element, labels) {
    const looseA = element.a === null || element.a === undefined;
    const looseB = element.b === null || element.b === undefined;
    if (!looseA && !looseB) return "";
    const held = looseA ? element.b : element.a;
    const where = held === null || held === undefined
      ? "anything"
      : held === "g" ? "the ground" : labels.masses[held] ?? "a mass";
    if (looseA && looseB) return "Not connected to anything: this part is lying on the bench, and it does nothing.";
    return `Not connected to ${looseA ? "its left end" : "its right end"}: it is still holding ${where}, and a part bolted to one thing pulls on nothing.`;
  }

  return {
    setInstrument,
    setModel,
    reveal() { container.scrollTop = 0; },
    /** Remember which mass and element the instrument panel is editing, so a
     *  slider's callback knows what it is editing. */
    setEditing({ mass, element }) {
      if (mass !== undefined) currentMass = mass;
      if (element !== undefined) currentElement = element;
    },

    /**
     * Redraw everything from one frame's worth of state.
     *
     * @param {object} observed what simulation/mech_system.js observe() returned
     * @param {object} system the model
     * @param {{t:number[], x:number[]}} trace the probe's recent history
     * @param {object} measured what the run has measured against the theory
     */
    update(observed, system, trace, measuredValues = {}) {
      const labels = system.labels();
      const elements = system.elementIndices();

      /* --- the selected instrument's own controls follow the model --- */
      if (active === "drive") {
        /* The force this panel has open, not the first one on the bench: a rig
           can carry two, and the second one has its own panel. */
        const index = currentInstance ?? 0;
        const spec = system.spec.drives[index] ?? system.spec.drive;
        driveWave.pick(spec.waveform);
        driveAmp.setValue(spec.amplitude);
        driveFreq.setValue(spec.frequency);
        driveMassPick.pick(spec.mass === null || spec.mass === undefined ? "none" : String(spec.mass));
        const driving = (observed.drives ?? []).find((entry) => entry.index === index) ?? null;
        /* The instantaneous force, or a dash where there is no such thing: a
           blow that has already landed is not pushing on anything now, and the
           line underneath is where its own size is written. An impulse has no
           generator in the state at all, so it has to be described from the
           drive itself rather than read back out of the run. */
        const waveform = spec.waveform ?? "sine";
        driveRead.value.textContent = driving ? newtons(driving.value) : "\u2014";
        driveRead.theory.textContent = driving
          ? driveShape(driving.waveform ?? waveform, `${sig(driving.amplitude, 3)} N`, driving.frequency)
          : spec.mass === null || spec.mass === undefined
            ? "not connected to anything"
            : driveShape(waveform, `${sig(spec.amplitude, 3)} N`, spec.frequency);
      } else if (active === "base") {
        baseWave.pick(system.spec.base.waveform);
        baseAmp.setValue(system.spec.base.amplitude * 1000);
        baseFreq.setValue(system.spec.base.frequency);
        const shaking = observed.base;
        baseRead.value.textContent = shaking ? mm(shaking.value) : "\u2014";
        baseRead.theory.textContent = shaking
          ? driveShape(system.spec.base.waveform, `${sig(shaking.amplitude * 1000, 3)} mm`, shaking.frequency)
          : "";
      } else if (active === "probe") {
        probeMassPick.pick(String(system.spec.output));
        const reading = observed.probe;
        probeRead.value.textContent = `${sig(reading.v, 3)} m/s`;
        probeRead.theory.textContent =
          `${sig(reading.a, 3)} m/s\u00B2, peak ${mm(observed.peak.displacement)}`;
      } else if (active === "mass") {
        massValue.setValue(system.M[currentMass] ?? 1);
        massRead.value.textContent = mm(observed.x[currentMass] ?? 0);
        massRead.theory.textContent = `${sig(observed.v[currentMass] ?? 0, 3)} m/s, ${sig(observed.a[currentMass] ?? 0, 3)} m/s\u00B2`;
      } else if (active === "element") {
        const index = currentInstance ?? currentElement;
        const element = system.elements[index];
        if (element) {
          const isSpring = element.kind === "spring";
          const scale = isSpring ? ELEMENT_SCALE.spring : ELEMENT_SCALE.damper;
          if (elementScaleShown !== scale) {
            elementValue.setScale(scale);
            elementScaleShown = scale;
            elementValue.wrap.querySelector(".ctrl-label").textContent = isSpring ? "Stiffness" : "Damping";
            elementValue.wrap.title = isSpring
              ? "how stiff this spring is, in newtons per metre"
              : "how much damping this dashpot has, in newton seconds per metre";
          }
          elementValue.setValue(isSpring ? element.k : element.c);
          elementEndA.pick(endKey(element.a));
          elementEndB.pick(endKey(element.b));
          /* The panel says what the stage says: a part holding nothing is a part
             the bench has a sentence about, and it is printed here as well as
             drawn there - this is where a reader is looking when they have just
             dragged an end off a block. */
          const sentence = looseSentence(element, labels);
          elementStatus.textContent = sentence;
          elementStatus.classList.toggle("is-hidden", !sentence);
          elementStatus.classList.toggle("is-loose", !!sentence);
          const meta = system.elementIndices()[index];
          instrumentNote.textContent = meta
            ? `${isSpring ? "spring" : "dashpot"} ${isSpring ? "k" : "c"}${subscript(meta.index + 1)}, in ${isSpring ? "newtons per metre" : "newton seconds per metre"}`
            : "";
        }
      }

      /* --- one row per mass: where it is, and how fast --- */
      while (massRows.length < system.n) {
        const row = measured("", "");
        massRowsWrap.appendChild(row.row);
        massRows.push(row);
      }
      for (let i = 0; i < massRows.length; i++) {
        const row = massRows[i];
        if (i >= system.n) { row.row.classList.add("is-hidden"); continue; }
        row.row.classList.remove("is-hidden");
        row.label.textContent = labels.displacements[i];
        row.value.textContent = mm(observed.x[i]);
        row.theory.textContent = `${sig(observed.v[i], 3)} m/s, ${sig(observed.a[i], 3)} m/s\u00B2`;
      }

      /* --- the energies and the ledger --- */
      keR.value.textContent = `${sig(observed.kinetic, 4)} J`;
      peR.value.textContent = `${sig(observed.elastic, 4)} J`;
      totalR.value.textContent = `${sig(observed.total, 4)} J`;
      inR.value.textContent = `${sig(observed.workIn, 4)} J`;
      dissR.value.textContent = `${sig(observed.dissipated, 4)} J`;
      const relative = Math.abs(observed.residual) / observed.residualScale;
      resR.value.textContent = relative === 0 ? "0" : relative.toExponential(1);
      const unbalanced = relative > 1e-8;
      resR.row.classList.toggle("bad", unbalanced);
      resR.value.title = unbalanced ? "this should be zero: the ledger has lost something" : "";

      /* --- modes and poles --- */
      while (modeRows.children.length < system.modes.length + system.poleReport().length) {
        modeRows.appendChild(measured("", "").row);
      }
      const rows = [...modeRows.children];
      system.modes.forEach((mode, i) => {
        const row = rows[i];
        if (!row) return;
        row.classList.toggle("is-hidden", false);
        row.querySelector(".rn").textContent = `Mode ${i + 1}`;
        row.querySelector(".rv").textContent = mode.omega === 0 ? "rigid" : hz(mode.frequency);
        const shape = Array.from(mode.shape).map((v) => sig(v, 2)).join(", ");
        row.querySelector(".readout-sub").textContent =
          `${radPerSecond(mode.omega)}, shape ${shape}`;
      });
      const poles = system.poleReport();
      const pairs = [];
      for (const pole of poles) {
        if (poles.some((other) => other !== pole && Math.abs(other.re - pole.re) < 1e-9 && Math.abs(other.im + pole.im) < 1e-9)) {
          if (pole.im > 0) pairs.push(pole);
        } else pairs.push(pole);
      }
      pairs.forEach((pole, i) => {
        const row = rows[system.modes.length + i];
        if (!row) return;
        row.classList.toggle("is-hidden", false);
        /* A pole at the origin is not an overdamped one: it is a mass nothing is
           holding, which neither rings nor decays - a rig with a free block in
           it, like the upper block of the friction pair. Calling that
           "overdamped" is the one reading of it that is definitely wrong. */
        const free = pole.omega < 1e-9;
        row.querySelector(".rn").textContent = pole.im > 0 ? `Pole ${i + 1}` : "Real pole";
        row.querySelector(".rv").textContent = free ? "0 Hz" : hz(pole.frequency);
        row.querySelector(".readout-sub").textContent = free
          ? "a free body: it neither rings nor decays"
          : pole.im > 0
            ? `\u03B6 = ${sig(pole.damping, 2)}, resonant at ${radPerSecond(pole.omega)}`
            : `${radPerSecond(pole.omega)} decay rate, overdamped`;
      });
      for (let i = system.modes.length + pairs.length; i < rows.length; i++) rows[i].classList.add("is-hidden");

      const transferFrom = fromPick.get();
      const transferTo = system.spec.output;
      /* The zeros are the numerator's roots, worked out here from the numerator
         the panel is about to print: the map and the formula are then two views
         of one polynomial rather than two calculations that have to agree. */
      const transfer = system.transfer(transferFrom, transferTo);
      const zeros = polyRoots(transfer.num);
      drawRootMap(rootMap.canvas, poles, zeros);

      /* One fraction, written as one: the bar over the denominator is the
         denominator's own top border, so it is exactly as wide as the wider of
         the two polynomials instead of being a fixed run of dashes that fits
         some systems and misses others. */
      formula.innerHTML =
        `H(s) = <span class="formula-frac">`
        + `<span class="formula-num">${polynomialString(transfer.num)}</span>`
        + `<span class="formula-den">${polynomialString(transfer.den)}</span></span>`;
      /* The unit of the gain follows what the input *is*. A force is newtons, so
         metres per newton; a base is a displacement, so the answer is a ratio -
         which is why a quarter car's gain at zero frequency is 1 m/m and not the
         reciprocal of a stiffness. One label for a transfer function that is
         sometimes one and sometimes the other is a label that is wrong half the
         time. */
      const unit = transferFrom === "base" ? "m/m" : "m/N";
      const dc = system.dcGain(transferFrom, transferTo);
      dcR.value.textContent = dc === null ? "\u2014" : `${sig(dc, 3)} ${unit}`;
      dcR.theory.textContent = dc === null ? "no steady state" : "";
      const driveFrequency = measuredValues.frequency ?? 0;
      if (driveFrequency > 0) {
        const value = system.frequencyResponse(transferFrom, transferTo, 2 * Math.PI * driveFrequency);
        pointR.value.textContent = `|H| = ${sig(value.magnitude, 3)} ${unit}`;
        pointR.theory.textContent = `phase ${sig(value.phase, 3)}\u00B0 at ${hz(driveFrequency)}`;
      } else {
        pointR.value.textContent = "\u2014";
        pointR.theory.textContent = "nothing is being driven";
      }
      drawBode(bode.canvas, system, transferFrom, transferTo, driveFrequency, measuredValues.gain ?? 0);

      /* --- the response --- */
      drawResponse(response.canvas, trace, measuredValues.envelope ?? null, measuredValues.period ?? 0);
      ampR.value.textContent = measuredValues.amplitude === undefined ? "\u2014" : mm(measuredValues.amplitude);
      ampR.theory.textContent = measuredValues.theoryAmplitude === undefined
        ? "waiting for a full cycle"
        : `theory ${mm(measuredValues.theoryAmplitude)}`;
      peakR.value.textContent = mm(observed.peak.displacement);
      phaseR.value.textContent = measuredValues.settled === undefined
        ? "\u2014"
        : (measuredValues.settled ? "settled" : "still changing");
      phaseR.theory.textContent = measuredValues.settled
        ? ""
        : (measuredValues.settled === undefined ? "" : "still growing or dying");
    },

    fit() { rootMap.fit(); bode.fit(); response.fit(); },
  };
}
