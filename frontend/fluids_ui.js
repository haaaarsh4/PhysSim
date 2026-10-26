/**
 * frontend/fluids_ui.js - the two rails of the Fluids workbench.
 *
 * Same furniture as the other three benches: panel titles, sections, slider
 * rows, segmented pickers, switches, readouts. What the rows say is different,
 * because this bench's subject is different - a continuous medium with three
 * material properties and four dimensionless groups, rather than bodies, a gas,
 * or a rig.
 *
 * The left rail is what you set: the fluid, the body in it, and the tank's own
 * agitation. The right rail is what it says, in the order a reader asks:
 *
 *   what flow is this (Re, We, Oh, Bo) -> what the solve is doing (volume,
 *   divergence, iterations) -> what the body is doing -> what the surface is.
 *
 * Nothing here computes physics. The groups come from the solver's own
 * `dimensionless()`, the numbers from its fields, and the notes are text.
 */

function el(tag, className = "", html = null) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== null) node.innerHTML = html;
  return node;
}

function slider({ label, min, max, step, value, format, onInput, title }) {
  const wrap = el("div", "ctrl");
  const row = el("div", "ctrl-row");
  const lab = el("span", "ctrl-label", label);
  const val = el("span", "ctrl-val tab-nums", format(value));
  if (title) { row.title = title; lab.title = title; }
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

function readout(label, title) {
  const row = el("div", "readout");
  const name = el("span", "rn", label);
  if (title) { row.title = title; name.title = title; }
  row.appendChild(name);
  const value = el("span", "rv tab-nums", "—");
  row.appendChild(value);
  return { row, value };
}

/** A readout that may carry one short comparison underneath it. */
function measured(label, note, title) {
  const row = el("div", "readout stacked");
  const head = el("div", "readout-head");
  const name = el("span", "rn", label);
  if (title) { row.title = title; name.title = title; }
  head.appendChild(name);
  const value = el("span", "rv tab-nums", "—");
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
    pick(key) { for (const [k, b] of buttons) b.classList.toggle("on", k === key); },
  };
}

function toggle(label, initial, onChange) {
  const row = el("div", "toggle-row");
  row.appendChild(el("span", "ctrl-label", label));
  const sw = el("button", `tswitch${initial ? " on" : ""}`, "<i></i>");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-label", label);
  sw.setAttribute("aria-checked", String(!!initial));
  sw.addEventListener("click", () => {
    const next = !sw.classList.contains("on");
    sw.classList.toggle("on", next);
    sw.setAttribute("aria-checked", String(next));
    onChange(next);
  });
  row.appendChild(sw);
  return {
    row,
    set(on) { sw.classList.toggle("on", !!on); sw.setAttribute("aria-checked", String(!!on)); },
  };
}

/* ==================================================================================
   THE LEFT RAIL
   ================================================================================== */

/**
 * @param {HTMLElement} container
 * @param {object} callbacks onGravity, onSurfaceTension, onViscosity, onPreset,
 *   onBody, onDensity, onRadius, onField, onShake, onShakeAmplitude, onShakeFrequency
 */
export function buildFluidLeftRail(container, callbacks = {}) {
  container.textContent = "";

  /* --------------------------------- THE FLUID --------------------------------- */
  container.appendChild(el("div", "panel-title", "THE FLUID"));

  const fluid = el("div", "rail-section");
  const gravity = slider({
    label: "Gravity", min: 0, max: 20, step: 0.05, value: 9.81,
    format: (v) => `${v.toFixed(2)} m/s²`,
    onInput: (v) => callbacks.onGravity?.(v),
    title: "The body force the whole tank feels. At zero the liquid is a puddle in space.",
  });
  const sigma = slider({
    label: "Surface tension", min: 0, max: 0.3, step: 0.001, value: 0.072,
    format: (v) => `${(v * 1000).toFixed(1)} mN/m`,
    onInput: (v) => callbacks.onSurfaceTension?.(v),
    title: "Water is 72 mN/m. This is what makes a drop round and a jet pinch.",
  });
  const mu = slider({
    label: "Viscosity", min: 1, max: 2000, step: 5, value: 1,
    format: (v) => `${v.toFixed(0)} mPa·s`,
    onInput: (v) => callbacks.onViscosity?.(v / 1000),
    title: "Water is 1 mPa·s, olive oil about 90, honey about 700 at room temperature. It is the XSPH mixing rate here: the higher it goes, the more each particle is dragged towards its neighbours' mean motion.",
  });
  const preset = segmented(
    "Preset",
    [["water", "Water", "Water: 72 mN/m, 1 mPa·s"], ["oil", "Oil", "Olive oil: 32 mN/m, 90 mPa·s"], ["honey", "Honey", "Honey: 50 mN/m, 700 mPa·s"]],
    "water",
    (key) => callbacks.onPreset?.(key),
  );
  fluid.append(gravity.wrap, sigma.wrap, mu.wrap, preset.wrap);
  container.appendChild(fluid);

  /* --------------------------------- THE BODY ---------------------------------- */
  container.appendChild(el("div", "panel-title", "THE BODY"));
  const bodySection = el("div", "rail-section");
  const bodyToggle = toggle("In the tank", false, (on) => callbacks.onBody?.(on));
  bodyToggle.row.title = "A rigid sphere in the tank, coupled to the liquid both ways: the liquid holds it up, it pushes the liquid aside.";
  const density = slider({
    label: "Density", min: 100, max: 2000, step: 10, value: 480,
    format: (v) => `${v.toFixed(0)} kg/m³`,
    onInput: (v) => callbacks.onDensity?.(v),
    title: "The liquid is 1000 kg/m³. A body lighter than that floats with that fraction under water.",
  });
  const radius = slider({
    label: "Radius", min: 20, max: 70, step: 1, value: 55,
    format: (v) => `${(v / 10).toFixed(1)} cm`,
    onInput: (v) => callbacks.onRadius?.(v / 1000),
    title: "Big enough to see the wake, small enough that the tank is still a tank.",
  });
  const floatNote = el("div", "rail-note", "A body lighter than water floats; heavier, it sinks.");
  bodySection.append(bodyToggle.row, density.wrap, radius.wrap, floatNote);
  container.appendChild(bodySection);

  /* ---------------------------------- THE TANK ---------------------------------- */
  container.appendChild(el("div", "panel-title", "THE TANK"));
  const tankSection = el("div", "rail-section");
  const field = segmented(
    "Tint",
    [["surface", "Surface", "The liquid itself"], ["speed", "Speed", "Tint by the speed of the flow"], ["pressure", "Pressure", "Tint by the pressure field"]],
    "surface",
    (key) => callbacks.onField?.(key),
  );
  const shake = toggle("Shake the tank", false, (on) => callbacks.onShake?.(on));
  shake.row.title = "Accelerate the whole tank sideways, the way a table would. The liquid sees it as a change in gravity.";
  const shakeAmp = slider({
    label: "Shake amplitude", min: 0.1, max: 6, step: 0.1, value: 2,
    format: (v) => `${v.toFixed(1)} m/s²`,
    onInput: (v) => callbacks.onShakeAmplitude?.(v),
  });
  const shakeHz = slider({
    label: "Shake frequency", min: 0.3, max: 3, step: 0.05, value: 0.7,
    format: (v) => `${v.toFixed(2)} Hz`,
    onInput: (v) => callbacks.onShakeFrequency?.(v),
    title: "The tank's first sloshing mode: 0.70 Hz for a pool 38 cm deep in a 1.2 m tank. Sweep through it and watch the wave grow and fall away either side.",
  });
  tankSection.append(field.wrap, shake.row, shakeAmp.wrap, shakeHz.wrap);
  container.appendChild(tankSection);

  return {
    setState(state) {
      gravity.setValue(state.gravity);
      sigma.setValue(state.surfaceTension);
      mu.setValue(state.viscosity * 1000);
      density.setValue(state.density);
      radius.setValue(state.radius * 1000);
      bodyToggle.set(state.body);
      density.setDisabled(!state.body);
      radius.setDisabled(!state.body);
      preset.pick(state.preset ?? "water");
      shake.set(state.shake);
      shakeAmp.setValue(state.shakeAmplitude);
      shakeHz.setValue(state.shakeFrequency);
      shakeAmp.setDisabled(!state.shake);
      shakeHz.setDisabled(!state.shake);
      field.pick(state.field);
    },
    setBodyHint(text) { floatNote.textContent = text; },
  };
}

/* ==================================================================================
   THE RIGHT RAIL
   ================================================================================== */

const fmt = {
  number: (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "—"),
  sci: (v, d = 1) => {
    if (!Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a === 0) return "0";
    if (a >= 1e5 || a < 1e-3) {
      const exp = Math.floor(Math.log10(a));
      return `${(v / 10 ** exp).toFixed(d)}×10${superscript(exp)}`;
    }
    return a >= 100 ? v.toFixed(0) : v.toFixed(a >= 10 ? 1 : 2);
  },
  percent: (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(v < 0.1 ? 2 : 1)}%` : "—"),
};

const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
function superscript(n) {
  return String(n).split("").map((c) => SUP[c] ?? c).join("");
}

/**
 * @param {HTMLElement} container
 * @param {object} callbacks onExportCSV
 */
export function buildFluidRightRail(container, callbacks = {}) {
  container.textContent = "";

  /* ----------------------------------- THE FLOW -------------------------------- */
  container.appendChild(el("div", "panel-title", "WHAT KIND OF FLOW"));
  const flow = el("div", "rail-section");

  const re = measured("Reynolds number", "inertia ÷ viscosity", "rho U L / mu. Under about 2000 a flow this size is laminar.");
  const we = measured("Weber number", "inertia ÷ surface tension", "rho U² L / sigma. Above one, a splash can break a surface apart.");
  const oh = measured("Ohnesorge number", "viscosity ÷ sqrt(inertia × tension)", "mu / sqrt(rho sigma L). It decides whether a drop bounces or splashes.");
  const bo = measured("Bond number", "gravity ÷ surface tension", "rho g L² / sigma. Below one, a drop is round because surface tension wins.");
  flow.append(re.row, we.row, oh.row, bo.row);
  container.appendChild(flow);

  /* ---------------------------------- THE SOLVE -------------------------------- */
  container.appendChild(el("div", "panel-title", "THE SOLVE"));
  const solve = el("div", "rail-section");
  const volume = readout("Liquid volume", "Particles times the volume of one rest cell. A particle method conserves it exactly, because nothing in the step can create or destroy a particle.");
  const drift = readout("Volume drift", "How far the tank has drifted from the volume it was filled with. It should be zero to the last digit.");
  const divergence = readout("Density error", "The mean |rho / rho0 - 1| left after the constraint iterations, as a percentage. Zero is an incompressible step.");
  const iterations = readout("Constraint iterations", "Gauss-Seidel iterations of the density constraint per sub-step.");
  const energy = readout("Kinetic energy");
  const speed = readout("Peak speed");
  solve.append(volume.row, drift.row, divergence.row, iterations.row, energy.row, speed.row);
  container.appendChild(solve);

  /* ---------------------------------- THE BODY --------------------------------- */
  const bodyTitle = el("div", "panel-title", "THE BODY");
  const bodySection = el("div", "rail-section");
  const submerged = measured("Submerged", "the fraction the liquid holds");
  const buoyancy = readout("Buoyancy force", "The pressure integral round the body.");
  const depth = readout("Depth of its centre");
  bodySection.append(submerged.row, buoyancy.row, depth.row);
  container.appendChild(bodyTitle);
  container.appendChild(bodySection);

  /* --------------------------------- THE SURFACE ------------------------------- */
  container.appendChild(el("div", "panel-title", "THE SURFACE"));
  const surface = el("div", "rail-section");
  const capillary = measured("Capillary length", "sqrt(sigma / rho g)", "The length below which a meniscus is round rather than flat.");
  const segments = measured("Pieces of liquid", "vertical crossings", "How many separate bodies of liquid a vertical line through the tank crosses, at its busiest of three columns. One for a pool; more once a sheet has broken into drops.");
  const period = measured("Ripple period", "dispersion relation", "The standing wave's own period, from omega^2 = g k + sigma k^3 / rho. Time it on the bench and compare.");
  surface.append(capillary.row, segments.row, period.row);
  container.appendChild(surface);

  /* ---------------------------------- METHOD ----------------------------------- */
  container.appendChild(el("div", "panel-title", "METHOD"));
  const method = el("div", "rail-section");
  const note = el("p", "rail-note", "");
  note.innerHTML =
    "Position Based Fluids: particles carry mass, gravity predicts where they go, and a " +
    "density constraint is solved against their neighbours in a uniform grid until the " +
    "rest density is back. Velocities are read off the corrected positions, so the step " +
    "cannot inject energy the way a stiff force can. The surface is a marching-cubes " +
    "isosurface of the particle density, and the body is coupled by buoyancy and a " +
    "collision, not by a pressure integral.";
  const credit = el("p", "rail-note credit", "After Macklin &amp; M&uuml;ller, <i>Position Based Fluids</i> (2013); &Ouml;chsner et al., surface tension for PBF.");
  method.append(note, credit);
  container.appendChild(method);

  return {
    setLive(r) {
      /* Both of these are built on the flow's own speed, and a pool that has
         not been let go has no speed to build them on: a Reynolds number
         invented from a floor under the speed is a number about nothing. */
      const still = !(r.speed > 1e-3);
      re.value.textContent = still ? "—" : fmt.sci(r.reynolds, 2);
      we.value.textContent = still ? "—" : fmt.sci(r.weber, 2);
      oh.value.textContent = fmt.number(r.ohnesorge, 3);
      bo.value.textContent = fmt.sci(r.bond, 2);

      volume.value.textContent = `${(r.volume * 1000).toFixed(1)} L`;
      drift.value.textContent = fmt.percent(r.drift);
      divergence.value.textContent = fmt.percent(r.divergence);
      iterations.value.textContent = `${r.iterations}`;
      energy.value.textContent = `${fmt.number(r.energy, 3)} J`;
      speed.value.textContent = `${fmt.number(r.speed, 2)} m/s`;

      const hasBody = r.bodyVisible;
      bodyTitle.classList.toggle("is-hidden", !hasBody);
      bodySection.classList.toggle("is-hidden", !hasBody);
      if (hasBody) {
        submerged.value.textContent = fmt.percent(r.submerged);
        submerged.theory.textContent = `${r.bodyDensity} kg/m³ in ${r.liquidDensity} kg/m³`;
        buoyancy.value.textContent = `${fmt.number(r.buoyancy, 2)} N`;
        depth.value.textContent = `${(r.depth * 100).toFixed(1)} cm`;
      }

      capillary.value.textContent = `${(r.capillaryLength * 1000).toFixed(2)} mm`;
      segments.value.textContent = `${r.segments}`;
      period.value.textContent = r.rippleTheory > 0 ? `${(r.rippleTheory * 1000).toFixed(0)} ms` : "—";
      period.theory.textContent = r.rippleTheory > 0 ? "for the four-wave mode" : "not a capillary lab";
    },
    setLab(lab) { note.dataset.lab = lab.id; },
  };
}
