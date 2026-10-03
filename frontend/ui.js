/**
 * frontend/ui.js - DOM construction and wiring for the side panels.
 *
 * Deliberately has no physics or rendering code in it: it builds the
 * SCENE / PHYSICS controls (left) and RESULTS / INSPECTOR readouts
 * (right), and reports user actions back to main.js via the `callbacks`
 * object. This keeps main.js's job to "own the simulation loop" and
 * this file's job to "own the DOM" - the two don't need to know much
 * about each other's internals.
 */

/** What a freshly built control panel starts at. Exported because the spawn
 *  settings are page state, and main.js needs the same starting point when it
 *  creates a page: a new page has to open on a reset panel, not on whatever
 *  the page you left was set to. */
export const DEFAULT_SPAWN = {
  count: 2, radius: 0.045, pattern: "grid",
  height: 0,   // metres above the floor a batch is released from
  speed: 0,    // m/s it is launched with, 0 being "simply set down"
  angle: 45,   // degrees above the horizontal
};

/**
 * The shapes a scene can be built out of.
 *
 * Data only - main.js decides where a new shape lands and owns the model, this
 * is just the menu. Sizes are in world units. The ramp is the one shape here
 * that is not a box: it is a wedge - a right triangle, /| - with a base on the
 * floor, a back you can push against and a slope at atan(hh/hw). A box tipped on
 * its edge is what a slope looks like and not what one is: it touches the floor
 * at a single corner, so it rocks and then lies down, and a ramp that falls over
 * when a ball is set down on it is not an inclined plane.
 *
 * `icon` is a lucide name, mounted by main.js: every row of the menu carries the
 * outline of the thing it makes, because a list of five words asks to be read
 * and a list of five shapes asks to be recognised.
 *
 * `material` is what the thing is made of, in the two coefficients the solver
 * reads: bounciness (e) and friction (mu), both measured values from a bench,
 * not round numbers chosen for looks. A brick wall is a brick wall, a plank is a
 * plank, and a ball left standing in the scene is rubber - so a shape arrives
 * with a surface that behaves like the object it looks like, and the panel's
 * sliders are there for the surfaces a student wants to change on purpose.
 *
 * `density` is the other half of what a thing is made of, in kg/m³, and it is
 * the same kind of number: a solid's mass is its volume times its density, so
 * these are what a shape weighs without anyone having to type a mass. Brick and
 * oak are heavy, and that is the point - a ball thrown at a brick wall should
 * bounce off it and leave it standing, and the only way it can do that is if the
 * wall really is two hundred times the ball's mass. Shrink one to a plank's
 * thickness, or type a smaller mass in the inspector, and it goes down.
 */
export const SHAPE_PRESETS = [
  { key: "wall", label: "Wall", icon: "BrickWall",
    material: { bounce: 0.6, friction: 0.65 }, density: 1900,
    spec: { kind: "box", hw: 0.055, hh: 0.42, angle: 0 } },
  /* 18.00°, the angle both inclined-plane labs state: hw/hh = tan 18°, so the
     slope the panel quotes is the slope the solid is. Its 195 kg is what oak
     that size weighs, and that is why a ball slid down it leaves it standing. */
  { key: "ramp", label: "Ramp", icon: "TrendingUp",
    material: { bounce: 0.4, friction: 0.4 }, density: 600,
    spec: { kind: "wedge", hw: 0.5, hh: 0.16246 } },
  { key: "platform", label: "Platform", icon: "RectangleHorizontal",
    material: { bounce: 0.4, friction: 0.4 }, density: 600,
    spec: { kind: "box", hw: 0.5, hh: 0.05, angle: 0 } },
  { key: "block", label: "Block", icon: "Square",
    material: { bounce: 0.4, friction: 0.4 }, density: 650,
    spec: { kind: "box", hw: 0.17, hh: 0.17, angle: 0 } },
  { key: "sphere", label: "Sphere", icon: "Circle",
    material: { bounce: 0.8, friction: 0.9 }, density: 1100,
    spec: { kind: "ball", r: 0.15 } },
];

/** The three traces of the energy chart, brightest first. No hue in the
 *  chrome, so they are told apart by weight, like the rail's own readouts. */
const ENERGY_TONES = ["rgb(232,231,240)", "rgb(157,156,168)", "rgb(109,108,120)"];

function el(tag, className, html) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** The three components of a vector as markup: one row per axis, each with the
 *  axis letter on the left and its number on the right. Exported because the
 *  inspector builds its own block for a group selection as a string, and the
 *  two must be the same object to the stylesheet - a vector in one panel and a
 *  vector in the other are the same thing. */
export function vec3HTML(x, y, z) {
  return ["x", "y", "z"].map((axis, i) => {
    const value = [x, y, z][i];
    return `<div class="vec3-row"><span class="vk">${axis}</span>`
      + `<span class="vv tab-nums">${value}</span></div>`;
  }).join("");
}

function slider({ label, min, max, step, value, format, onInput }) {
  const wrap = el("div", "ctrl");
  const row = el("div", "ctrl-row");
  const lab = el("span", "ctrl-label", label);

  /* The readout is also the editor. A double-click swaps the number for a
     field in place, and the two share one box so the value never jumps
     sideways the moment you start typing. */
  const val = el("span", "ctrl-val tab-nums");
  val.tabIndex = 0;
  val.setAttribute("role", "button");
  val.setAttribute("aria-label", label);
  val.title = "Double-click to type a value";
  const text = el("span", "val-text", format(value));
  const field = el("input", "val-field");
  field.type = "text";
  field.inputMode = "decimal";
  field.autocomplete = "off";
  field.spellcheck = false;
  field.setAttribute("aria-label", label);
  val.append(text, field);
  row.append(lab, val);

  const input = el("input");
  input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value;

  /* A typed value obeys the control it belongs to: clamped to the slider's
     range and snapped to its step, so whatever is entered lands somewhere
     the thumb could actually have been dragged to. */
  const decimals = (String(step).split(".")[1] || "").length;
  function quantise(v) {
    const stepped = Math.round((v - min) / step) * step + min;
    return parseFloat(Math.min(max, Math.max(min, stepped)).toFixed(decimals));
  }

  /** The one place that writes the pair, so the number on screen and the
   *  thumb can never disagree. notify=false is for programmatic moves. */
  function apply(v, notify) {
    input.value = v;
    text.textContent = format(v);
    if (notify) onInput(v);
  }

  input.addEventListener("input", () => apply(parseFloat(input.value), true));

  let editing = false;
  function beginEdit() {
    if (editing) return;
    editing = true;
    // freeze the box at roughly the width the number already used, plus room
    // for a longer one, so the row does not reflow while typing
    const w = Math.ceil(text.getBoundingClientRect().width);
    val.style.width = Math.max(52, w + 18) + "px";
    field.value = format(parseFloat(input.value));
    wrap.classList.add("editing");
    field.focus();
    field.select();
  }
  function endEdit(commit) {
    if (!editing) return;
    editing = false;
    wrap.classList.remove("editing");
    val.style.width = "";
    if (!commit) return;
    const parsed = parseFloat(String(field.value).replace(/[^0-9eE+\-.]/g, ""));
    if (Number.isFinite(parsed)) apply(quantise(parsed), true);
    else text.textContent = format(parseFloat(input.value));
  }

  val.addEventListener("dblclick", (e) => { e.preventDefault(); beginEdit(); });
  val.addEventListener("keydown", (e) => {
    if (!editing && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); beginEdit(); }
  });
  field.addEventListener("keydown", (e) => {
    // the editor owns Escape and Enter while it is open: nothing above it in
    // the page should be closing a modal out from under the caret
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); endEdit(true); }
    else if (e.key === "Escape") { e.preventDefault(); endEdit(false); }
  });
  field.addEventListener("blur", () => endEdit(true));

  wrap.append(row, input);
  return {
    wrap, input, valEl: text,
    /** Programmatically move the slider (e.g. when a Page is loaded)
     * without re-firing onInput - the caller already has the value. */
    setValue(v) { endEdit(false); apply(v, false); },
  };
}

function transformAxis({ axis, label, value, step = 0.001, decimals = 3, min, max, onChange }) {
  const wrap = el("label", "transform-axis");
  const axisLabel = el("span", "transform-axis-label", axis.toUpperCase());
  const input = el("input", "transform-axis-input tab-nums");
  input.type = "number";
  input.step = step;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  input.value = Number(value).toFixed(decimals);
  input.setAttribute("aria-label", label);
  input.title = label;

  let lastValue = Number(value);
  const format = (v) => Number(v).toFixed(decimals);
  function commit() {
    const parsed = input.valueAsNumber;
    if (!Number.isFinite(parsed)) {
      input.value = format(lastValue);
      return;
    }
    const scale = 10 ** decimals;
    let next = Math.round(parsed * scale) / scale;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    input.value = format(next);
    if (next === lastValue) return;
    lastValue = next;
    onChange(next);
  }

  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
      input.blur();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      input.value = format(lastValue);
      input.blur();
    }
  });
  wrap.append(axisLabel, input);
  return {
    wrap,
    setValue(v) {
      lastValue = Number(v);
      if (document.activeElement !== input) input.value = format(lastValue);
    },
  };
}

function transformGroup({ title, axes, values, step, decimals, min, max, onChange }) {
  const group = el("div", "transform-group");
  group.appendChild(el("div", "transform-group-title", title));
  /* A group of one field takes the whole row. Holding it to a third of the rail
     would clip anything with more than five digits in it - 351.1200 kg is a
     brick wall, not an edge case - and a number you cannot read is worse than a
     field that does not line up with the vector above it. */
  const row = el("div", `transform-axis-row${axes.length === 1 ? " lone" : ""}`);
  const fields = axes.map(({ key, label = key }) => {
    const field = transformAxis({
      axis: label, label: `${title} ${label.toUpperCase()}`, value: values[key],
      step, decimals, min, max, onChange: (value) => onChange(key, value),
    });
    row.appendChild(field.wrap);
    return [key, field];
  });
  group.appendChild(row);
  return {
    element: group,
    setValues(next) { for (const [key, field] of fields) field.setValue(next[key]); },
  };
}

function segmented({ options, initial, onChange }) {
  const wrap = el("div", "seg");
  const buttons = options.map(({ value, label }) => {
    const b = el("button", value === initial ? "on" : "", label);
    b.dataset.v = value;
    b.addEventListener("click", () => {
      wrap.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      onChange(value);
    });
    wrap.appendChild(b);
    return b;
  });
  return { wrap, buttons };
}



function toggle({ label, initial, onChange }) {
  const row = el("div", "toggle-row");
  const lab = el("span", "ctrl-label", label);
  // A real <button> with a switch role, not a clickable div: the switch is a
  // control, and that is what makes it reachable and operable by keyboard.
  const sw = el("button", `tswitch${initial ? " on" : ""}`, "<i></i>");
  sw.type = "button";
  sw.setAttribute("role", "switch");
  sw.setAttribute("aria-label", label);
  let on = initial;
  const sync = () => {
    sw.classList.toggle("on", on);
    sw.setAttribute("aria-checked", on ? "true" : "false");
  };
  sync();
  sw.addEventListener("click", () => {
    on = !on; sync(); onChange(on);
  });
  row.append(lab, sw);
  return {
    row, get value() { return on; },
    setValue(v) { on = v; sync(); },
  };
}

/**
 * The resize grips on the selected shape.
 *
 * Screen-space elements rather than meshes in the scene, and that is a
 * decision rather than a shortcut. A grip is a control: it has to be the same
 * size in both views and at every zoom, because a wall grows until it is off
 * the stage and a grip on it that shrank with it would be un-grabbable from
 * across the bench. An element also carries a cursor, and changing the pointer
 * is how a control says "this is a thing you can drag" - a mesh can do neither.
 *
 * The geometry - which grips there are and where they sit - is the caller's,
 * because it is geometry: it comes from the shape, not from the panel. This
 * file is handed client-space positions and puts a grip on each one.
 *
 * They are `aria-hidden` on purpose: a grip is a mouse gesture with no keyboard
 * equivalent, and a focusable control that does nothing when you press Enter is
 * worse than no control. The inspector's size fields are the accessible way to
 * the same numbers, and they always have been.
 */
export function createResizeHandles(container, { onGrab }) {
  const layer = el("div", "resize-handles is-hidden");
  layer.setAttribute("aria-hidden", "true");
  container.appendChild(layer);
  const grips = new Map(); // handle key -> element

  function grip(key) {
    let node = grips.get(key);
    if (node) return node;
    node = el("div", "resize-handle");
    node.dataset.key = key;
    node.addEventListener("pointerdown", (e) => {
      /* Only the two buttons a resize can be asked for. The right one is the
         direct reshape - press anywhere on the shape and this grip is the one
         that takes the corner - the left one is the grip itself. */
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      e.stopPropagation();
      /* Capture, so the gesture survives the pointer leaving the grip (it
         always does - a grip is a dozen pixels) and does not go missing if the
         hand wanders off the window entirely. The drag itself is driven from
         the window either way, so a browser that will not grant it is not a
         reason for the pull to fail. */
      try { node.setPointerCapture(e.pointerId); } catch (err) { /* still pullable */ }
      onGrab(key, e);
    });
    // A grip is not a draggable image; the browser's own drag would ghost it
    // across the stage.
    node.addEventListener("dragstart", (e) => e.preventDefault());
    grips.set(key, node);
    layer.appendChild(node);
    return node;
  }

  return {
    element: layer,
    setVisible(on) { layer.classList.toggle("is-hidden", !on); },

    /**
     * Put a grip on each of `handles`, and take away any that are no longer
     * asked for.
     * @param {Array<{key:string,x:number,y:number,cursor:string}>} handles
     *   positions in client pixels, and the cursor each one should wear
     */
    sync(handles) {
      /* Shown first, because an element that is `display:none` measures zero
         and every grip would be placed at the top-left corner of the stage. */
      layer.classList.remove("is-hidden");
      const rect = layer.getBoundingClientRect();
      const live = new Set();
      for (const { key, x, y, cursor } of handles) {
        live.add(key);
        const node = grip(key);
        node.style.left = `${(x - rect.left).toFixed(1)}px`;
        node.style.top = `${(y - rect.top).toFixed(1)}px`;
        node.style.cursor = cursor;
        node.style.display = "";
      }
      for (const [key, node] of grips) if (!live.has(key)) node.style.display = "none";
    },
  };
}

/**
 * The ruler of the workbench: a height scale up the left edge and a distance
 * scale along the bottom, in metres.
 *
 * Only ever shown in the 2D view, and that is not a simplification - it is the
 * only view where it is true. The 2D camera is orthographic and square to the
 * stage, so world metres map to screen pixels by one number, and a scale drawn
 * from that number is exactly right. Under a perspective camera the same metre
 * is a different length depending on how far away it is, and a ruler that lied
 * about that would be worse than no ruler.
 *
 * The caller re-lays it out whenever the camera moves, which is the only time
 * it can be wrong.
 */
export function createStageRules(container) {
  const rules = el("div", "stage-rules is-hidden");
  const heightRule = el("div", "rule rule-height");
  const distanceRule = el("div", "rule rule-distance");
  rules.append(heightRule, distanceRule);
  container.appendChild(rules);

  /* A tick spacing a human would choose: labels never closer than ~34 px, and
     always round numbers, so the reader counts in halves and quarters rather
     than in whatever divides evenly. */
  function niceStep(pixelsPerMetre, minPixels) {
    const steps = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2];
    for (const step of steps) if (step * pixelsPerMetre >= minPixels) return step;
    return steps[steps.length - 1];
  }

  /* Read off the step, not from its size: 0.25 m is a round number on a ruler
     only when it is written as 0.25, and a tick labelled "0.3" that sits at
     0.25 is a ruler that lies by 5 cm. */
  const DECIMALS = { 0.02: 2, 0.05: 2, 0.1: 1, 0.25: 2, 0.5: 1, 1: 0, 2: 0 };
  const decimalsFor = (step) => DECIMALS[step] ?? 2;

  function tick(parent, position, text, extra) {
    const node = el("div", `tick${extra ? ` ${extra}` : ""}`);
    node.style.top = `${position.toFixed(1)}px`;
    if (text !== null) node.appendChild(el("span", "tick-label", text));
    parent.appendChild(node);
    return node;
  }

  return {
    element: rules,
    setVisible(on) { rules.classList.toggle("is-hidden", !on); },

    /**
     * @param {{width:number,height:number,targetX:number,targetY:number,
     *          zoomHeight:number,floorY:number}} view the 2D camera, as it is
     */
    layout(view) {
      const { width, height, targetX, targetY, zoomHeight, floorY } = view;
      if (!(width > 0) || !(height > 0) || !(zoomHeight > 0)) return;
      const pixelsPerMetre = height / zoomHeight;
      const toY = (world) => height / 2 - (world - targetY) * pixelsPerMetre;
      const toX = (world) => width / 2 + (world - targetX) * pixelsPerMetre;

      heightRule.innerHTML = "";
      const vStep = niceStep(pixelsPerMetre, 46);
      const vDecimals = decimalsFor(vStep);
      const topWorld = targetY + zoomHeight / 2;
      for (let h = 0; ; h += vStep) {
        const world = floorY + h;
        if (world > topWorld) break;
        const label = h === 0 ? "0" : `${h.toFixed(vDecimals)} m`;
        tick(heightRule, toY(world), label, h === 0 ? "tick-zero" : "");
        // one unlabelled minor tick between each pair, if there is room for it
        if (vStep * pixelsPerMetre >= 70 && world + vStep / 2 <= topWorld) {
          tick(heightRule, toY(world + vStep / 2), null, "tick-minor");
        }
      }

      distanceRule.innerHTML = "";
      const hStep = niceStep(pixelsPerMetre, 64);
      const hDecimals = decimalsFor(hStep);
      const leftWorld = targetX - width / 2 / pixelsPerMetre;
      const rightWorld = targetX + width / 2 / pixelsPerMetre;
      const first = Math.ceil(leftWorld / hStep) * hStep;
      for (let x = first; x <= rightWorld; x += hStep) {
        const node = el("div", "tick");
        node.style.left = `${toX(x).toFixed(1)}px`;
        const value = Math.abs(x) < hStep / 2 ? 0 : x; // -0.0 is not a distance
        node.appendChild(el("span", "tick-label", `${value.toFixed(hDecimals)} m`));
        distanceRule.appendChild(node);
      }
    },
  };
}

/**
 * The brief pinned to the bottom of the stage: what this experiment is asking,
 * and two things to try.
 *
 * It sits on the stage rather than in a rail because the questions are about
 * what is on the stage. A rail scrolls; the thing being asked about does not.
 */
export function createLabCard(container) {
  const card = el("div", "lab-card is-hidden");
  const head = el("div", "lab-card-head");
  // The card's label *is* the lab's name, in the accent the word "Lab" used to
  // wear: one line, and the one word on it that is the experiment's.
  const name = el("span", "lab-card-name", "");
  const close = el("button", "lab-card-close", "\u00D7");
  close.type = "button";
  close.setAttribute("aria-label", "Hide the lab brief");
  const aim = el("p", "lab-card-aim", "");
  /* What the lab put on the bench and what it set the room to, in the numbers
     the panels are holding: the brief a reader wants before they touch anything,
     because a lab is a setup before it is a question. A lab that carries a
     `setup` says so; one that does not simply has no line drawn. */
  const setup = el("p", "lab-card-setup is-hidden", "");
  const asks = el("ul", "lab-card-asks");
  /* How long the experiment is worth watching for. A lab that carries a `hold`
     says so; the other workbench's labs do not carry one and the line simply
     is not drawn. */
  const hold = el("p", "lab-card-hold is-hidden", "");
  head.append(name, close);
  card.append(head, aim, setup, asks, hold);
  container.appendChild(card);

  const hide = () => card.classList.add("is-hidden");
  close.addEventListener("click", hide);

  return {
    element: card,
    /** @param {{name:string, aim:string, asks:string[], setup?:string}} lab */
    setLab(lab) {
      if (!lab) { hide(); return; }
      name.textContent = lab.name;
      aim.textContent = lab.aim;
      setup.textContent = lab.setup ?? "";
      setup.classList.toggle("is-hidden", !lab.setup);
      asks.innerHTML = "";
      for (const question of lab.asks ?? []) asks.appendChild(el("li", "", question));
      /* How long the experiment is worth watching for, in whatever the bench
         measures its own clock in: the Thermo bench counts picoseconds of gas
         time and the Vibrations bench counts seconds of response, and the line
         is written once for both of them. */
      hold.textContent = lab.hold ? `Worth running for about ${lab.hold} ${lab.holdUnit ?? "ps of gas time"}.` : "";
      hold.classList.toggle("is-hidden", !lab.hold);
      card.classList.remove("is-hidden");
    },
    hide,
  };
}

/**
 * Builds the SCENE + PHYSICS panel into `container` and returns
 * { getParams(): object, getSpawnRequest setters... } via a small API
 * the caller wires up through the `callbacks` it supplies.
 */
export function buildLeftRail(container, callbacks) {
  container.appendChild(el("div", "panel-title", "SCENE"));
  const sceneSection = el("div", "rail-section");

  let ballCount = DEFAULT_SPAWN.count;
  let spawnRadius = DEFAULT_SPAWN.radius;
  let spawnPattern = DEFAULT_SPAWN.pattern;
  let launchHeight = DEFAULT_SPAWN.height;
  let launchSpeed = DEFAULT_SPAWN.speed;
  let launchAngle = DEFAULT_SPAWN.angle;

  const countS = slider({
    label: "Ball count", min: 1, max: 400, step: 1, value: ballCount,
    format: (v) => v.toFixed(0), onInput: (v) => { ballCount = v; },
  });
  const radiusS = slider({
    label: "Ball radius", min: 0.015, max: 0.09, step: 0.005, value: spawnRadius,
    format: (v) => v.toFixed(3), onInput: (v) => { spawnRadius = v; },
  });

  const patternLabel = el("div", "ctrl-row");
  patternLabel.appendChild(el("span", "ctrl-label", "Spawn pattern"));
  const patternWrap = el("div", "ctrl");
  const patternSeg = segmented({
    options: [{ value: "grid", label: "Grid" }, { value: "random", label: "Random" }, { value: "column", label: "Column" }],
    initial: spawnPattern, onChange: (v) => { spawnPattern = v; },
  });
  patternWrap.append(patternLabel, patternSeg.wrap);

  /* Where a batch is released from and where it is pointed, which together
     with the pattern is the entire initial condition of an experiment: a
     projectile lab is a height, a speed and an angle, and nothing else. */
  const heightS = slider({
    label: "Release height (m)", min: 0, max: 1.5, step: 0.05, value: launchHeight,
    format: (v) => v.toFixed(2), onInput: (v) => { launchHeight = v; },
  });
  const speedS = slider({
    label: "Launch speed (m/s)", min: 0, max: 6, step: 0.05, value: launchSpeed,
    format: (v) => v.toFixed(2), onInput: (v) => { launchSpeed = v; },
  });
  const angleS = slider({
    label: "Launch angle (\u00B0)", min: -90, max: 90, step: 1, value: launchAngle,
    format: (v) => v.toFixed(0), onInput: (v) => { launchAngle = v; },
  });

  const spawnReplaceBtn = el("button", "btn primary", "Spawn (replace)");
  const spawnAddBtn = el("button", "btn", "Add to scene");
  const clearBtn = el("button", "btn danger", "Clear all");
  const row1 = el("div", "btn-row"); row1.appendChild(spawnReplaceBtn);
  const row2 = el("div", "btn-row"); row2.append(spawnAddBtn, clearBtn);

  const currentSpawn = () => ({
    count: ballCount, radius: spawnRadius, pattern: spawnPattern,
    height: launchHeight, speed: launchSpeed, angle: launchAngle,
  });
  spawnReplaceBtn.addEventListener("click", () => callbacks.onSpawn(currentSpawn(), "replace"));
  spawnAddBtn.addEventListener("click", () => callbacks.onSpawn(currentSpawn(), "add"));
  clearBtn.addEventListener("click", () => callbacks.onClear());

  sceneSection.append(
    countS.wrap, radiusS.wrap, patternWrap,
    heightS.wrap, speedS.wrap, angleS.wrap,
    row1, row2,
  );
  container.appendChild(sceneSection);

  container.appendChild(el("div", "panel-title", "PHYSICS"));
  const physicsSection = el("div", "rail-section");

  const gravityS = slider({
    label: "Gravity (m/s²)", min: 0, max: 24, step: 0.2, value: 9.8,
    format: (v) => v.toFixed(1), onInput: (v) => callbacks.onParamChange("gravity", v),
  });
  const restS = slider({
    label: "Restitution (bounciness)", min: 0, max: 1, step: 0.02, value: 0.72,
    format: (v) => v.toFixed(2), onInput: (v) => callbacks.onParamChange("restitution", v),
  });
  const dragS = slider({
    label: "Air drag", min: 0, max: 0.02, step: 0.001, value: 0.001,
    format: (v) => v.toFixed(3), onInput: (v) => callbacks.onParamChange("drag", v),
  });
  const dtS = slider({
    label: "Time step (dt)", min: 0.002, max: 0.02, step: 0.0005, value: 0.01,
    format: (v) => v.toFixed(4), onInput: (v) => callbacks.onParamChange("dt", v),
  });
  /* The coefficient of friction, as a coefficient: 0 is ice, 0.4 is a rough
     surface. Because it is a real mu, the labs that depend on it are real
     experiments - a slope holds a ball while tan(theta) is under it and lets it
     go once it is over, and a ball sliding on the floor slows at mu*g. */
  const frictionS = slider({
    label: "Surface friction (\u03BC)", min: 0, max: 1, step: 0.05, value: 0.4,
    format: (v) => v.toFixed(2),
    onInput: (v) => callbacks.onParamChange("friction", v),
  });
  const collToggle = toggle({
    label: "Ball-ball collisions", initial: true,
    onChange: (v) => callbacks.onParamChange("collisions", v),
  });

  physicsSection.append(gravityS.wrap, restS.wrap, dragS.wrap, frictionS.wrap, dtS.wrap, collToggle.row);
  container.appendChild(physicsSection);

  /* What the lab draws over the scene. Off by choice rather than always on:
     four instruments at once is a diagram, not an experiment, and which of
     them helps depends entirely on the question being asked. */
  container.appendChild(el("div", "panel-title", "VIEW"));
  const viewSection = el("div", "rail-section");
  const trailsToggle = toggle({
    label: "Motion trails", initial: true,
    onChange: (v) => callbacks.onTool("trails", v),
  });
  const vectorsToggle = toggle({
    label: "Velocity arrows", initial: false,
    onChange: (v) => callbacks.onTool("vectors", v),
  });
  const predictToggle = toggle({
    label: "Predicted path", initial: true,
    onChange: (v) => callbacks.onTool("predict", v),
  });
  const gridToggle = toggle({
    label: "Floor grid", initial: true,
    onChange: (v) => callbacks.onTool("grid", v),
  });
  const slowToggle = toggle({
    label: "Slow motion", initial: false,
    onChange: (v) => callbacks.onTool("slowmo", v),
  });
  viewSection.append(
    trailsToggle.row, vectorsToggle.row, predictToggle.row,
    gridToggle.row, slowToggle.row,
  );
  container.appendChild(viewSection);

  /* Recording is the bridge from "it moved" to a table a lab report can use.
     Everything else here shows a number now; this one keeps a series. */
  container.appendChild(el("div", "panel-title", "DATA"));
  const dataSection = el("div", "rail-section");
  const recordToggle = toggle({
    label: "Record samples", initial: false,
    onChange: (v) => callbacks.onTool("record", v),
  });
  const recordCount = el("div", "picked-empty", "No samples yet.");
  const stepBtn = el("button", "btn", "Step one frame");
  stepBtn.addEventListener("click", () => callbacks.onStep?.());
  const exportBtn = el("button", "btn", "Export CSV");
  exportBtn.disabled = true;
  exportBtn.addEventListener("click", () => callbacks.onExportData?.());
  const dataRow = el("div", "btn-row"); dataRow.append(stepBtn);
  const exportRow = el("div", "btn-row"); exportRow.append(exportBtn);
  dataSection.append(recordToggle.row, recordCount, dataRow, exportRow);
  container.appendChild(dataSection);

  return {
    /** Sync every control to a params object - used when switching Pages
     * so the sliders reflect the page being loaded, not the previous one. */
    setParams(p) {
      if (p.gravity !== undefined) gravityS.setValue(p.gravity);
      if (p.restitution !== undefined) restS.setValue(p.restitution);
      if (p.drag !== undefined) dragS.setValue(p.drag);
      if (p.friction !== undefined) frictionS.setValue(p.friction);
      if (p.dt !== undefined) dtS.setValue(p.dt);
      if (p.collisions !== undefined) collToggle.setValue(p.collisions);
    },
    /** The spawn controls are page state too: they are what the next Spawn
     *  will do, so they belong to the page it will be done on. */
    getSpawn() {
      return currentSpawn();
    },
    setSpawn(s) {
      if (!s) return;
      if (s.count !== undefined) { ballCount = s.count; countS.setValue(s.count); }
      if (s.radius !== undefined) { spawnRadius = s.radius; radiusS.setValue(s.radius); }
      if (s.height !== undefined) { launchHeight = s.height; heightS.setValue(s.height); }
      if (s.speed !== undefined) { launchSpeed = s.speed; speedS.setValue(s.speed); }
      if (s.angle !== undefined) { launchAngle = s.angle; angleS.setValue(s.angle); }
      if (s.pattern !== undefined) {
        spawnPattern = s.pattern;
        for (const b of patternSeg.buttons) b.classList.toggle("on", b.dataset.v === s.pattern);
      }
    },
    /** The instrument switches, for when a lab wants to set the stage itself. */
    setTools(t) {
      if (t.trails !== undefined) trailsToggle.setValue(t.trails);
      if (t.vectors !== undefined) vectorsToggle.setValue(t.vectors);
      if (t.predict !== undefined) predictToggle.setValue(t.predict);
      if (t.grid !== undefined) gridToggle.setValue(t.grid);
      if (t.slowmo !== undefined) slowToggle.setValue(t.slowmo);
      if (t.record !== undefined) recordToggle.setValue(t.record);
    },
    setRecorded(count) {
      recordCount.textContent = count
        ? `${count} sample${count === 1 ? "" : "s"} recorded.`
        : "No samples yet.";
      exportBtn.disabled = count === 0;
    },
  };
}

/**
 * Builds the RESULTS + INSPECTOR panel and returns an update API the
 * simulation loop calls every frame: { setPicked, setAggregates, setPerf }
 * plus setSelectedObject, which the caller fires on a selection change.
 *
 * `callbacks` wires transform edits back to the scene model.
 */
export function buildRightRail(container, callbacks = {}) {
  container.appendChild(el("div", "panel-title", "INSPECTOR"));
  const pickedSection = el("div", "rail-section inspector-selection");
  const selectionLabel = el("div", "section-label", "Selection");
  pickedSection.appendChild(selectionLabel);
  const pickedBlock = el("div", "", '<div class="picked-empty">Click a ball or a shape in the view to inspect it.</div>');
  pickedSection.appendChild(pickedBlock);

  const objectEdit = el("div", "object-edit is-hidden");
  const transformGroups = el("div", "transform-groups");
  const positionGroup = transformGroup({
    title: "Position · m",
    axes: [{ key: "x" }, { key: "y" }, { key: "z" }],
    values: { x: 0, y: 0, z: 0 }, step: 0.001, decimals: 3,
    onChange: (axis, value) => callbacks.onObjectTransform?.("position", axis, value),
  });
  const boxSizeGroup = transformGroup({
    title: "Size · m",
    axes: [{ key: "x" }, { key: "y" }, { key: "z" }],
    values: { x: 1, y: 1, z: 1 }, step: 0.001, decimals: 3, min: 0.02,
    onChange: (axis, value) => callbacks.onObjectTransform?.("size", axis, value),
  });
  /* One round size, not three: a ball is described by its radius whether it is
     a solid in the scene or one of the particles falling through it. */
  const radiusGroup = transformGroup({
    title: "Radius · m",
    axes: [{ key: "r", label: "R" }],
    values: { r: 0.15 }, step: 0.001, decimals: 3, min: 0.01,
    onChange: (axis, value) => callbacks.onObjectTransform?.("size", axis, value),
  });
  /* How heavy a thing is, in kilograms - the number every collision here is
     weighed by, and the one a physics question gives you before it asks what
     happens. A ball starts at what its own size makes it (a ball of water) and
     typing over it makes it lead or cork; a shape starts at what it is made of,
     measured rather than chosen, and typing over it changes the material it is
     made of - so a wall resized afterwards is heavier for it, the way a bigger
     wall is. */
  const massGroup = transformGroup({
    title: "Mass · kg",
    axes: [{ key: "m", label: "M" }],
    // The step is the field's own resolution (0.1 g), which is what the arrows
    // move by and what the minimum sits on: a grid whose smallest value is off
    // the step is a field the browser reports as badly filled in.
    values: { m: 0.05 }, step: 0.0001, decimals: 4, min: 0.0001,
    onChange: (axis, value) => callbacks.onObjectTransform?.("mass", axis, value),
  });
  /* A shape's other possibility: no mass at all, because it is part of the
     world. Every lab's floor is like this and so is a ramp bolted down, and a
     scene with a wall pinned in place is how a student separates "the ball
     bounced" from "the wall gave way". */
  const fixedToggle = toggle({
    label: "Fixed in place", initial: false,
    onChange: (on) => callbacks.onObjectFixed?.(on),
  });
  fixedToggle.row.classList.add("mass-fixed");
  massGroup.element.appendChild(fixedToggle.row);
  const rotationGroup = transformGroup({
    title: "Rotation · °",
    axes: [{ key: "x" }, { key: "y" }, { key: "z" }],
    values: { x: 0, y: 0, z: 0 }, step: 0.1, decimals: 1,
    onChange: (axis, value) => callbacks.onObjectTransform?.("rotation", axis, value),
  });
  /* A ball's third degree of freedom where a box's is rotation: speed and
     direction, typed as three numbers, so a ball can be thrown rather than
     only dropped. */
  const velocityGroup = transformGroup({
    title: "Velocity · m/s",
    axes: [{ key: "x" }, { key: "y" }, { key: "z" }],
    values: { x: 0, y: 0, z: 0 }, step: 0.01, decimals: 3,
    onChange: (axis, value) => callbacks.onObjectTransform?.("velocity", axis, value),
  });
  /* A steady force you can type in newtons. With gravity, collisions and drag
     all in, this is the one term of Newton's second law the scene could not
     previously be given: everything else here falls, this one is pushed. */
  const forceGroup = transformGroup({
    title: "Applied force · N",
    axes: [{ key: "x" }, { key: "y" }, { key: "z" }],
    values: { x: 0, y: 0, z: 0 }, step: 0.01, decimals: 3,
    onChange: (axis, value) => callbacks.onObjectTransform?.("force", axis, value),
  });
  transformGroups.append(
    positionGroup.element, boxSizeGroup.element, radiusGroup.element, massGroup.element,
    rotationGroup.element, velocityGroup.element, forceGroup.element,
  );

  /* The surface the shape is made of. It starts on the bench's own coefficients
     - the PHYSICS sliders - and keeps a value of its own only once one is set
     here, which is what lets one scene hold a rubber wall and an icy floor, and
     what turns "the ball bounced off the ramp but not the wall" into a question
     the panel answers. */
  const materialGroup = el("div", "transform-group material-group");
  const bounceSlider = slider({
    label: "Bounciness (e)", min: 0, max: 1, step: 0.02, value: 0,
    format: (v) => v.toFixed(2),
    onInput: (v) => callbacks.onObjectMaterial?.("bounce", v),
  });
  const frictionSlider = slider({
    label: "Friction (\u03BC)", min: 0, max: 1, step: 0.05, value: 0,
    format: (v) => v.toFixed(2),
    onInput: (v) => callbacks.onObjectMaterial?.("friction", v),
  });
  const materialResetBtn = el("button", "btn material-reset", "Use the bench's surface");
  materialResetBtn.type = "button";
  materialResetBtn.addEventListener("click", () => callbacks.onObjectMaterialReset?.());
  materialGroup.append(
    el("div", "transform-group-title", "Surface material"),
    bounceSlider.wrap, frictionSlider.wrap, materialResetBtn,
  );

  const deleteObjectBtn = el("button", "btn danger object-delete", "Delete shape");
  deleteObjectBtn.addEventListener("click", () => callbacks.onDeleteObject?.());
  objectEdit.append(transformGroups, materialGroup, deleteObjectBtn);
  pickedSection.appendChild(objectEdit);

  container.appendChild(pickedSection);

  /** One label and one tabular number: the rail's unit of measurement. */
  function readout(label) {
    const r = el("div", "readout");
    r.append(el("span", "rn", label), el("span", "rv tab-nums", "0.000"));
    return r;
  }

  /* Every question in a mechanics lab is one of two questions: where did the
     energy go, or did the momentum survive. Both are about the whole scene
     rather than about any one ball, so both are answered here, and the chart
     is the answer to the first one - a trace that stays flat is a conservation
     law you can see. */
  container.appendChild(el("div", "panel-title", "MEASUREMENTS"));
  const measureSection = el("div", "rail-section");
  const keTotalRow = readout("Kinetic energy");
  const peTotalRow = readout("Potential energy");
  const meTotalRow = readout("Mechanical energy");
  const changeRow = readout("Energy change");
  const energyCanvas = el("canvas", "chart");
  const energyLegend = el("div", "chart-legend");
  for (const [label, tone] of [
    ["Kinetic", ENERGY_TONES[0]], ["Potential", ENERGY_TONES[1]], ["Total", ENERGY_TONES[2]],
  ]) {
    const key = el("span", "chart-key");
    const swatch = el("i", "swatch");
    swatch.style.background = tone;
    key.append(swatch, el("span", "", label));
    energyLegend.appendChild(key);
  }
  const momentumRow = readout("Momentum");
  const momentumVec = el("div", "vec3", vec3HTML("0.000", "0.000", "0.000"));
  const momentumCells = [...momentumVec.querySelectorAll(".vv")];
  measureSection.append(
    keTotalRow, peTotalRow, meTotalRow, changeRow,
    energyCanvas, energyLegend, momentumRow, momentumVec,
  );
  container.appendChild(measureSection);

  container.appendChild(el("div", "panel-title", "RESULTS"));
  const resultsSection = el("div", "rail-section");
  const speedRow = readout("Avg speed");
  const sparkSpeed = el("canvas", "spark");
  const maxSpeedRow = readout("Max speed");
  const countRow = readout("Ball count");

  resultsSection.append(speedRow, sparkSpeed, maxSpeedRow, countRow);
  container.appendChild(resultsSection);

  container.appendChild(el("div", "panel-title", "PERFORMANCE"));
  const perfSection = el("div", "rail-section");
  const stepRow = readout("Physics step");
  const collRow = readout("Collision checks");
  const fpsRow = readout("FPS");
  perfSection.append(stepRow, collRow, fpsRow);
  container.appendChild(perfSection);

  /* The measurement record of one ball: everything a lab notebook would have a
     column for. Read, not typed - the fields above are what you set, this is
     what the experiment did with it. */
  const statsGroup = el("div", "transform-group is-hidden");
  statsGroup.appendChild(el("div", "transform-group-title", "Measured"));
  const ballSpeedRow = readout("Speed");
  const ballAccelRow = readout("Acceleration");
  const ballPeakRow = readout("Peak height");
  const ballReleaseRow = readout("Released at");
  const ballRangeRow = readout("Landing range");
  const ballElapsedRow = readout("Time since release");
  const ballImpactRow = readout("First impact at");
  // Mass and weight side by side, because they are the pair a student is asked
  // to keep apart: one is the ball, the other is the pull on it.
  const ballMassRow = readout("Mass");
  const ballWeightRow = readout("Weight (m\u00B7g)");
  const ballEnergyRow = readout("Kinetic energy");
  const ballPotRow = readout("Potential energy");
  const ballTotalRow = readout("Mechanical energy");
  statsGroup.append(
    ballSpeedRow, ballAccelRow, ballPeakRow, ballReleaseRow, ballRangeRow,
    ballElapsedRow, ballImpactRow, ballMassRow, ballWeightRow, ballEnergyRow, ballPotRow, ballTotalRow,
  );
  /* Last of the groups, not bolted on after them: inside .transform-groups it
     inherits the hairline and the gap every other group is separated by. */
  transformGroups.appendChild(statsGroup);

  /* Kinetic, potential and mechanical energy on one shared scale. Drawn by
     hand rather than with a charting library for the same reason the rest of
     this is: the trace has to sit in the rail's own greys, and an axis nobody
     reads is worse than no axis at all - the numbers above the chart are the
     axis. */
  const energyHistory = ENERGY_TONES.map(() => []);
  const ENERGY_WINDOW = 150; // ~2.5 s at 60 fps: long enough to see a whole arc
  function drawEnergyChart(hasData) {
    const canvas = energyCanvas;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!hasData || energyHistory[0].length < 2) return;
    let max = 0;
    for (const series of energyHistory) for (const v of series) if (v > max) max = v;
    // A scene at rest has a flat zero in it and no information at all.
    if (max < 1e-9) return;
    energyHistory.forEach((series, k) => {
      ctx.beginPath();
      series.forEach((value, i) => {
        const x = (i / (ENERGY_WINDOW - 1)) * canvas.width;
        const y = canvas.height - (value / max) * canvas.height * 0.86 - 4;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = ENERGY_TONES[k];
      ctx.lineWidth = 1.3 * dpr; ctx.lineJoin = "round"; ctx.stroke();
    });
  }

  const sparkline = (canvas, color) => {
    const hist = []; const MAXN = 90;
    return (v, hasData) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth * dpr, h = canvas.clientHeight * dpr;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // With no balls in the scene every value is a flat 0 - drawing that
      // as a "trend line" is meaningless noise, so an empty scene simply
      // shows an empty chart instead of a flat colored bar across it.
      if (!hasData) { hist.length = 0; return; }
      hist.push(v); if (hist.length > MAXN) hist.shift();
      if (hist.length < 2) return;
      const max = Math.max(...hist), min = Math.min(...hist, 0);
      const range = max - min;
      if (range < 1e-9) return; // perfectly flat real data - nothing meaningful to trace yet
      ctx.beginPath();
      hist.forEach((val, i) => {
        const x = (i / (MAXN - 1)) * canvas.width;
        const y = canvas.height - ((val - min) / range) * canvas.height * 0.82 - 4;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color; ctx.lineWidth = 1.3 * dpr; ctx.lineJoin = "round"; ctx.stroke();
      ctx.lineTo(canvas.width, canvas.height); ctx.lineTo(0, canvas.height); ctx.closePath();
      ctx.fillStyle = color.replace("rgb", "rgba").replace(")", ",0.07)");
      ctx.fill();
    };
  };
  // No hue anywhere in the chrome: the traces are told apart by their weight
  // against the rail - the bright end of --on-shell for one, the dim end of
  // --on-shell-3 for the other - exactly as the homepage keeps its own greys
  // to a single ink at three weights.
  const pushSpeed = sparkline(sparkSpeed, "rgb(109,108,120)");

  return {
    setPicked(text) { pickedBlock.innerHTML = text; },
    /**
     * Show and sync the transform editor for the selection.
     *
     * `o` is a shape (`kind: "box"|"ball"`) or a single spawned ball
     * (`kind: "particle"`), and both are edited through one set of fields:
     * every selection gets Position, the shape of it gets either a three-axis
     * Size or a single Radius, a box gets Rotation where a ball gets Velocity.
     * Nothing names the kind of thing in words - the fields it offers already
     * say it, and the Selection heading above them says the rest.
     */
    setSelectedObject(o) {
      const selected = !!o;
      objectEdit.classList.toggle("is-hidden", !selected);
      pickedBlock.classList.toggle("is-hidden", selected);
      if (!selected) return;
      const particle = o.kind === "particle";
      const round = particle || o.kind === "ball";
      positionGroup.setValues(o.position);
      materialGroup.classList.toggle("is-hidden", particle);
      if (o.material) {
        bounceSlider.setValue(o.material.bounce);
        frictionSlider.setValue(o.material.friction);
        // Offered only when there is a surface of its own to hand back.
        materialResetBtn.disabled = !o.material.own;
      }
      boxSizeGroup.element.classList.toggle("is-hidden", round);
      radiusGroup.element.classList.toggle("is-hidden", !round);
      // Mass belongs to both: a ball is weighed by every collision it makes and
      // so is a shape, and it is the same field asking the same question.
      massGroup.setValues({ m: o.mass });
      // Only a shape can be part of the world; a ball is always free to fall.
      fixedToggle.row.classList.toggle("is-hidden", particle);
      fixedToggle.setValue(!!o.fixed);
      rotationGroup.element.classList.toggle("is-hidden", round);
      velocityGroup.element.classList.toggle("is-hidden", !particle);
      forceGroup.element.classList.toggle("is-hidden", !particle);
      statsGroup.classList.toggle("is-hidden", !particle);
      if (round) {
        radiusGroup.setValues(o.size);
      } else {
        boxSizeGroup.setValues(o.size);
        rotationGroup.setValues(o.rotation);
      }
      if (particle) {
        velocityGroup.setValues(o.velocity);
        forceGroup.setValues(o.force);
        const m = o.measured;
        ballSpeedRow.querySelector(".rv").textContent = `${m.speed.toFixed(3)} m/s`;
        ballAccelRow.querySelector(".rv").textContent = `${m.accel.toFixed(3)} m/s\u00B2`;
        // The current height is what the 2D ruler already reads off the stage.
        ballPeakRow.querySelector(".rv").textContent = `${m.peak.toFixed(3)} m`;
        ballReleaseRow.querySelector(".rv").textContent = `${m.releaseHeight.toFixed(3)} m`;
        ballRangeRow.querySelector(".rv").textContent =
          m.range === null ? "..." : `${m.range.toFixed(3)} m`;
        ballElapsedRow.querySelector(".rv").textContent = `${m.sinceRelease.toFixed(3)} s`;
        ballImpactRow.querySelector(".rv").textContent =
          m.firstImpact === null ? "..." : `${m.firstImpact.toFixed(3)} s`;
        ballMassRow.querySelector(".rv").textContent = `${m.mass.toFixed(4)} kg`;
        ballWeightRow.querySelector(".rv").textContent = `${m.weight.toFixed(4)} N`;
        ballEnergyRow.querySelector(".rv").textContent = `${m.kinetic.toFixed(4)} J`;
        ballPotRow.querySelector(".rv").textContent = `${m.potential.toFixed(4)} J`;
        ballTotalRow.querySelector(".rv").textContent = `${m.mechanical.toFixed(4)} J`;
      }
      deleteObjectBtn.textContent = particle ? "Remove ball" : "Delete shape";
    },
    /** The scene's two conservation laws, once a frame. */
    setMeasurements({ kinetic, potential, mechanical, change, baseline, momentum, hasData }) {
      keTotalRow.querySelector(".rv").textContent = `${kinetic.toFixed(4)} J`;
      peTotalRow.querySelector(".rv").textContent = `${potential.toFixed(4)} J`;
      meTotalRow.querySelector(".rv").textContent = `${mechanical.toFixed(4)} J`;
      /* Against the energy the scene started with: the percentage is the
         headline, because "2% of it is gone" is the finding and "-0.04 J" is
         the arithmetic behind it. */
      changeRow.querySelector(".rv").textContent = baseline > 1e-6
        ? `${change.toFixed(4)} J (${((100 * change) / baseline).toFixed(1)}%)`
        : `${change.toFixed(4)} J`;
      momentumRow.querySelector(".rv").textContent = `${momentum.magnitude.toFixed(4)} kg\u00B7m/s`;
      momentumCells[0].textContent = momentum.x.toFixed(3);
      momentumCells[1].textContent = momentum.y.toFixed(3);
      momentumCells[2].textContent = momentum.z.toFixed(3);
      if (!hasData) {
        for (const series of energyHistory) series.length = 0;
        drawEnergyChart(false);
        return;
      }
      [kinetic, potential, mechanical].forEach((value, k) => {
        const series = energyHistory[k];
        series.push(value);
        if (series.length > ENERGY_WINDOW) series.shift();
      });
      drawEnergyChart(true);
    },
    /** Throw the energy chart away - a new experiment starts a new graph. */
    resetMeasurements() {
      for (const series of energyHistory) series.length = 0;
      drawEnergyChart(false);
    },
    setAggregates({ avgSpeed, maxSpeed, count }) {
      speedRow.querySelector(".rv").textContent = avgSpeed.toFixed(3);
      maxSpeedRow.querySelector(".rv").textContent = maxSpeed.toFixed(3);
      countRow.querySelector(".rv").textContent = String(count);
      pushSpeed(avgSpeed, count > 0);
    },
    setPerf({ stepMs, collisionChecks, fps }) {
      stepRow.querySelector(".rv").textContent = `${stepMs.toFixed(2)} ms`;
      collRow.querySelector(".rv").textContent = String(collisionChecks);
      fpsRow.querySelector(".rv").textContent = String(Math.round(fps));
    },
  };
}
