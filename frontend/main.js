/**
 * frontend/main.js - application entry point.
 *
 * Owns the whole wiring: a ParticleSystem (simulation/), the collision
 * step (simulation/collision_system.js), a ParticleRenderer + two
 * camera controllers (rendering/), a Profiler (profiling/), the two
 * side panels (frontend/ui.js) - and now two more pieces:
 *
 *   - Pages: independent, switchable scenes. Each page remembers its own
 *     particle snapshot and physics params (via experiments/checkpoints.js,
 *     the same serialize/deserialize used for manual save/load). Switching
 *     pages snapshots the outgoing page and restores the incoming one.
 *   - View mode: a real camera swap, not a cosmetic label. "3D" drives
 *     the perspective camera with full orbit; "2D" drives a fixed-front
 *     orthographic camera with pan/zoom only (rendering/camera.js's
 *     PanZoomController2D) - see rendering/renderer.js's setViewMode.
 *
 * The scene starts genuinely empty: nothing spawns until the user sets
 * a ball count and clicks Spawn, and nothing is in the way until they add a
 * solid through the shape picker. Dragging in the viewport orbits (or pans, in 2D)
 * unless it starts on a ball or a shape, in which case it moves that thing and
 * only that thing. Nothing here spawns particles or injects forces from the
 * mere movement of the mouse.
 */
import * as THREE from "three";
import {
  createElement, Download, Upload, RotateCcw, Play, Pause, Plus, Minus, X, Box, Square, ArrowLeft,
  StepForward, FlaskConical, Shapes, Eraser,
  BrickWall, TrendingUp, RectangleHorizontal, Circle,
  ChevronLeft, ChevronRight,
} from "lucide";
import { ParticleSystem } from "../simulation/particle_system.js";
import {
  resolveParticleCollisions, resolveSDFCollisions,
} from "../simulation/collision_system.js";
import {
  createBody, resolveBallBodyContacts, shapeMass, shapeVolume, stepBody, syncPose,
} from "../simulation/shape_dynamics.js";
import { SDFScene, SphereSDF, BoxSDF, WedgeSDF, wedgeProfile } from "../geometry/sdf.js";
import { ParticleRenderer } from "../rendering/renderer.js";
import { ObjectLayer } from "../rendering/objects.js";
import { OrbitCameraController, PanZoomController2D } from "../rendering/camera.js";
import { Profiler } from "../profiling/timers.js";
import { WebGLRendererMetrics } from "../profiling/gpu_metrics.js";
import { serializeParticleSystem, deserializeParticleSystem } from "../experiments/checkpoints.js";
import {
  downloadJSON, uploadJSONFile, saveToLocalStorage, loadFromLocalStorage,
} from "../storage/io.js";
import {
  buildLeftRail, buildRightRail, createLabCard, createResizeHandles, createStageRules,
  DEFAULT_SPAWN, SHAPE_PRESETS, vec3HTML,
} from "./ui.js";
import { LABS } from "./labs.js";
import { mountStageDrawers } from "./drawer.js";
import {
  PredictionLayer, StageGrid, TrailLayer, VectorLayer,
} from "../rendering/instruments.js";
import { downloadCSV } from "../storage/io.js";

/* --------------------------------------- icons --------------------------------------- */
const ICONS = {
  Download, Upload, RotateCcw, Play, Pause, Plus, Minus, X, Box, Square, ArrowLeft,
  StepForward, FlaskConical, Shapes, Eraser,
  BrickWall, TrendingUp, RectangleHorizontal, Circle,
  ChevronLeft, ChevronRight,
};

function mountIcon(el, name, attrs = {}) {
  const node = ICONS[name];
  if (!node) return;
  // Replace only a previously-mounted icon (if any), so this is safe to
  // call on elements that also carry a text label - e.g. the 3D/2D
  // toggle buttons, which have both an icon and a <span> with text.
  const existing = el.querySelector(":scope > svg.lucide");
  if (existing) existing.remove();
  el.insertBefore(
    createElement(node, { width: 16, height: 16, "stroke-width": 1.75, class: "lucide", ...attrs }),
    el.firstChild
  );
}

document.querySelectorAll("[data-icon]").forEach((el) => mountIcon(el, el.dataset.icon));

/**
 * Boots the whole simulation + UI. Deferred behind topic selection
 * (see frontend/home.js) rather than run at module load: the canvas
 * lives inside #app, which starts `hidden`, so constructing the
 * renderer/camera before the user picks "Dynamics" would size
 * everything against a 0x0 element.
 */
export function bootWorkbench() {

/* ------------------------------------- scene setup ------------------------------------- */
const BOUNDS = { x: 1.0, y: 1.1, z: 1.0 };
const MAX_BALLS = 400;
const DEFAULT_PARAMS = {
  gravity: 9.8, restitution: 0.72, drag: 0.001, friction: 0.4, dt: 0.01, collisions: true,
};

/*
 * The floor is the one piece of geometry the workbench always provides, and it
 * is the whole of it: no walls, no ceiling, no wireframe box. It is a slab
 * with an edge, and its collision is an SDF like every other solid here, so
 * what you can see and what the balls can feel are the same thing. Walk off
 * the end and there is nothing under you - which is the difference between a
 * floor and a box.
 */
const FLOOR = { halfX: 1.6, halfZ: 1.6, thickness: 0.08, y: -BOUNDS.y };

/* How often a recorded series is sampled, in seconds of simulated time. Fast
   enough that a collision is more than one row, slow enough that a minute of
   experiment is a file a spreadsheet opens without complaint. */
const RECORD_INTERVAL = 0.05;

const ps = new ParticleSystem(MAX_BALLS, BOUNDS);
let params = { ...DEFAULT_PARAMS };

const canvas = document.getElementById("glcanvas");
const renderer = new ParticleRenderer(canvas, MAX_BALLS, BOUNDS, { floor: FLOOR });

/* The static geometry of the scene: the floor, plus whatever has been built
   from the shape picker. Rebuilt from `objects` on every edit, so the
   physics and the drawing can never disagree about what is out there. */
const objectScene = new SDFScene([]);
const objectLayer = new ObjectLayer(renderer.scene, { depth: BOUNDS.z * 2 });
const floorSDF = new BoxSDF(
  0, FLOOR.y - FLOOR.thickness / 2, 0,
  FLOOR.halfX, FLOOR.thickness / 2, FLOOR.halfZ
);

const profiler = new Profiler();
const gpuMetrics = new WebGLRendererMetrics(renderer.renderer);

/* Balls are always drawn on the speed ramp: one tone at rest through to the
   ramp's top stop at 0.7 m/s, where a ball falling under the shipped gravity
   gets to. A switch up on the stage used to flatten every ball to one tone, and
   it was the least explainable control in the workbench - the ramp is the one
   of the two that tells a student something, so it is what the scene uses. */
const COLOR_MODE = "speed";

/* ==================================================================================
   INSTRUMENTS - what the lab draws over the scene
   ================================================================================== */
/* Four world-space instruments (rendering/instruments.js) and a switch for each.
   They read the simulation every frame and write nothing back, so no combination
   of them can change an experiment - which is the only sane way for a measuring
   tool to behave. */
const trails = new TrailLayer(renderer.scene, { maxPoints: 420, stride: 2 });
const velocityArrows = new VectorLayer(renderer.scene, { maxParticles: MAX_BALLS });
const prediction = new PredictionLayer(renderer.scene);
const stageGrid = new StageGrid(renderer.scene, {
  halfX: FLOOR.halfX, halfZ: FLOOR.halfZ, y: FLOOR.y, spacing: 0.5,
});
const labCard = createLabCard(document.getElementById("viewport"));
const stageRules = createStageRules(document.getElementById("viewport"));

const tools = {
  trails: true, vectors: false, predict: true, grid: true, slowmo: false, record: false,
};

/** The launch the last spawn actually used, so the predicted path can be drawn
 *  from the same place and at the same speed as the ball it is predicting. */
let lastLaunch = null;

/** Height of the ball's lowest point above the floor, in metres - the height
 *  every lab quote is measured from. The floor's surface is the datum. */
function floorHeight(y, radius) {
  return y - radius - FLOOR_Y;
}

/** Lay the rulers out for the current 2D camera. Called whenever the camera
 *  can have moved, because that is the only time the mapping can be wrong. */
function layoutStageRules() {
  const rect = canvas.getBoundingClientRect();
  stageRules.setVisible(viewMode === "2d");
  if (viewMode !== "2d") return;
  stageRules.layout({
    width: rect.width, height: rect.height,
    targetX: cameraController.target.x, targetY: cameraController.target.y,
    zoomHeight: cameraController.zoomHeight, floorY: FLOOR_Y,
  });
}

/* ------------------------------- stage popovers ------------------------------- */
/**
 * A pill in the corner of the stage that opens a panel of choices: the shape
 * menu and the lab bench. Both close on an outside press or on Escape and hand
 * focus back to their button, and both have to do it identically - so they are
 * one implementation used twice rather than two that happen to look alike.
 */
function popover({ launcher, toggleButton, panel, label, labelOpen }) {
  let open = false;
  function set(next, restoreFocus = false) {
    open = next;
    launcher.classList.toggle("is-open", open);
    toggleButton.setAttribute("aria-expanded", String(open));
    toggleButton.setAttribute("aria-label", open ? labelOpen : label);
    panel.setAttribute("aria-hidden", String(!open));
    if (!open && (restoreFocus || panel.contains(document.activeElement))) {
      toggleButton.focus({ preventScroll: true });
    }
  }
  toggleButton.addEventListener("click", () => set(!open));
  document.addEventListener("pointerdown", (event) => {
    if (open && !panel.contains(event.target) && !toggleButton.contains(event.target)) set(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) set(false, true);
  });
  return { set, close: (restoreFocus) => set(false, restoreFocus), isOpen: () => open };
}

/* ------------------------------- shape launcher ------------------------------- */
const shapeLauncher = document.getElementById("shapeLauncher");
const shapeLauncherToggle = document.getElementById("shapeLauncherToggle");
const shapePicker = document.getElementById("shapePicker");

const shapeMenu = popover({
  launcher: shapeLauncher, toggleButton: shapeLauncherToggle, panel: shapePicker,
  label: "Show shape choices", labelOpen: "Hide shape choices",
});

for (const preset of SHAPE_PRESETS) {
  const option = document.createElement("button");
  option.className = "shape-option";
  option.type = "button";
  option.setAttribute("aria-label", `Add ${preset.label}`);
  /* The glyph of the thing it makes, then the name: the outline is what the eye
     picks the shape out by, and the word is what confirms it. */
  const glyph = document.createElement("span");
  mountIcon(glyph, preset.icon, { width: 13, height: 13 });
  const label = document.createElement("span");
  label.textContent = preset.label;
  option.append(glyph, label);
  option.addEventListener("click", () => {
    addShape(preset.key);
    shapeMenu.close(true);
  });
  shapePicker.appendChild(option);
}

/* ------------------------------- lab bench ------------------------------- */
/* The experiments, each one a scene to build and a question to answer. The
   list carries its aims because choosing an experiment is choosing what to
   measure, and a menu of nine names is not enough to choose with. */
const labLauncher = document.getElementById("labLauncher");
const labLauncherToggle = document.getElementById("labLauncherToggle");
const labPicker = document.getElementById("labPicker");
const labMenu = popover({
  launcher: labLauncher, toggleButton: labLauncherToggle, panel: labPicker,
  label: "Show the lab bench", labelOpen: "Hide the lab bench",
});

const labRows = new Map();
for (const lab of LABS) {
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
  row.addEventListener("click", () => {
    applyLab(lab.id);
    labMenu.close(true);
  });
  labPicker.appendChild(row);
  labRows.set(lab.id, row);
}

const VP_LABELS = {
  "3d": "3D view. Drag to orbit and scroll to zoom. Drag a ball or shape to move it; control-click to add to the selection.",
  "2d": "2D view. Drag to pan and scroll to zoom. Drag a ball or shape to move it; control-click to add to the selection.",
};

const inspector = buildRightRail(document.getElementById("rightRail"), {
  onObjectTransform: (section, axis, value) => setTransform(section, axis, value),
  onObjectMaterial: (section, value) => setObjectMaterial(section, value),
  onObjectMaterialReset: () => resetObjectMaterial(),
  onObjectFixed: (fixed) => setObjectFixed(fixed),
  onDeleteObject: () => deleteSelection(),
});

const leftRailApi = buildLeftRail(document.getElementById("leftRail"), {
  onSpawn(spawn, mode) {
    spawnBalls(spawn, mode);
  },
  onClear() {
    ps.clear();
    ballSelection.clear();
    held.clear();
    trails.clear();
    rebaseEnergy();
    renderInspector();
  },
  onParamChange(name, value) {
    params[name] = value;
    /* A selected shape that is still following the bench *displays* the bench's
       coefficients, so those numbers have to move when the sliders do - or the
       panel would read 0.72 while the solver ran on 0.40. */
    if (selectedObjectId) inspector.setSelectedObject(shapeInfo());
    /* The same two coefficients are what a body's own contact with the floor is
       made of, and they were read into it when the scene was built: the bodies
       are rebuilt so a slider that says the bench is icy makes the wall on it
       slide. Gravity and the step size need no rebuild - they are read every
       step. */
    if ((name === "restitution" || name === "friction") && bodies.some(Boolean)) rebuildObjects();
  },
  onTool(name, value) {
    tools[name] = value;
    // A new recording is a new series, and the old one is not mixed into it.
    if (name === "record" && value) {
      recording = [];
      recordAccum = 0;
      leftRailApi.setRecorded(0);
    }
  },
  onStep() {
    stepOnce();
  },
  onExportData() {
    exportRecording();
  },
});

/* Below the phone breakpoint the two rails are drawers over the stage, and these
   are their handles; on anything wider the module is inert and the rails are the
   columns they have always been. See frontend/drawer.js. */
mountStageDrawers(document.getElementById("app"), {
  left: document.getElementById("leftRail"),
  right: document.getElementById("rightRail"),
  mountIcon,
});

/* ==================================================================================
   SCENE SHAPES - the static objects a scene is built out of
   ================================================================================== */

/* Shapes are authored in x/y and extruded the full depth of the world. That is
   what makes the 2D view truthful rather than decorative: a ramp is the same
   ramp from either camera, and a ball can never sit beside one on screen while
   being inside it in the physics. The depth deliberately matches the floor's
   width - anything outside that footprint has no ground under it, so it is on
   its way out of the scene anyway. */
const OBJECT_DEPTH = BOUNDS.z * 2;
const FLOOR_Y = FLOOR.y;

let objects = [];
let objectIdCounter = 0;
let selectedObjectId = null;
const ballSelection = new Set();

const EMPTY_PICKED =
  '<div class="picked-empty">Click a ball or a shape to inspect it. Drag to ' +
  'move it, and ctrl-click to add to the selection.</div>';

/** How far below its own centre a shape reaches, so a new one can be set down
 *  on the floor rather than through it. */
function objectRotation(o) {
  return {
    x: o.rotation?.x ?? 0,
    y: o.rotation?.y ?? 0,
    z: o.rotation?.z ?? o.angle ?? 0,
  };
}

function restHeight(o) {
  if (o.kind === "ball") return o.r;
  const { x: rx, y: ry, z: rz } = objectRotation(o);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  const halfDepth = o.hd ?? OBJECT_DEPTH / 2;
  if (o.kind === "wedge") {
    /* A wedge is its own cross-section, so how low it reaches is the lowest of
       its three corners - measured from the centre of mass, which is where a
       wedge's own frame puts it. Set down, that is the base's own corners, all
       at once: the slope stands on a face, which is why it stands at all. */
    let deepest = 0;
    for (const [lx, ly] of wedgeProfile(o.hw, o.hh)) {
      deepest = Math.min(deepest, lx * sz + ly * cz);
    }
    return Math.abs(deepest) + Math.abs(halfDepth * sx * cy);
  }
  // The vertical extent of a rotated box is the sum of its half-sizes
  // projected onto world Y.
  return Math.abs(o.hw * (cx * sz + sx * sy * cz))
    + Math.abs(o.hh * (cx * cz - sx * sy * sz))
    + Math.abs(halfDepth * sx * cy);
}

/** Half the width a shape occupies along x - which is what decides whether two
 *  of them can stand side by side. */
function halfWidth(o) {
  if (o.kind === "ball") return o.r;
  const { x: rx, y: ry, z: rz } = objectRotation(o);
  const cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  const halfDepth = o.hd ?? OBJECT_DEPTH / 2;
  if (o.kind === "wedge") {
    let widest = 0;
    for (const [lx, ly] of wedgeProfile(o.hw, o.hh)) {
      widest = Math.max(widest, Math.abs(lx * cz - ly * sz));
    }
    return widest + Math.abs(halfDepth * sy);
  }
  return Math.abs(o.hw * cy * cz) + Math.abs(o.hh * cy * sz) + Math.abs(halfDepth * sy);
}

/**
 * Where a brand new shape goes: the middle of the stage when that is free, and
 * otherwise one step further out until it is. Dropping every new shape at the
 * same spot buries it in the one before it, which reads as a bug rather than as
 * a shape; a hand's width apart reads as two shapes.
 */
function freeSlot(shape) {
  const gap = 0.07;
  const free = (x) => !objects.some((o) => Math.abs(o.x - x) < halfWidth(shape) + halfWidth(o) + gap);
  if (free(0)) return 0;
  for (let k = 1; k <= 8; k++) {
    for (const x of [k * 0.32, -k * 0.32]) {
      if (Math.abs(x) > 1.35) continue;
      if (free(x)) return x;
    }
  }
  return 0;
}

/**
 * Lift freshly spawned balls out of any shape they landed inside. A grid laid
 * down across a ramp puts a row of its balls in the ramp, and whether the
 * solver would squeeze them out over the next second is beside the point: until
 * it has, the scene looks broken.
 *
 * Straight up, rather than along the surface normal, because the normal is the
 * wrong answer wherever two solids meet - a ball in the sliver under a ramp's
 * raised end has the ramp above it and the floor below, and the nearest surface
 * is the floor, so the normal would push it further in. Up always leaves, and
 * it leaves through the top, which is where a ball in a shape was going to
 * settle anyway.
 */
function ejectFromShapes(from) {
  /* A hair of tolerance, because a ball *placed* exactly on a surface is the
     ordinary case for a lab preset and the SDF's own arithmetic can land a
     few ulps on the wrong side of "touching": without this, a ball set down on
     the floor is lifted a whole radius, and every height in the experiment is
     then one ball too high. */
  const clear = (i) => objectScene.distance(ps.posX[i], ps.posY[i], ps.posZ[i]) >= ps.radius[i] - 1e-6;
  for (let i = from; i < ps.count; i++) {
    if (clear(i)) continue;
    /* Up in a step a ball can take, then *back down* to the surface by
       bisection. The lift alone leaves the ball wherever the last step put it,
       which is up to a step of clear air - and a lab that sets a ball down on a
       slope means the height on its own card: two millimetres of fall is a real
       impact, the normal component of it is absorbed by the contact, and the
       speed a student reads at the bottom comes out percent below the formula
       the lab is asking them to confirm. Twenty halvings put it on the surface
       to well under a tenth of a millimetre. */
    const step = Math.max(0.002, ps.radius[i] / 4);
    let inside = ps.posY[i];
    for (let k = 0; k < 400 && !clear(i); k++) { inside = ps.posY[i]; ps.posY[i] += step; }
    let out = ps.posY[i];
    for (let k = 0; k < 20; k++) {
      const mid = (inside + out) / 2;
      ps.posY[i] = mid;
      if (clear(i)) out = mid; else inside = mid;
    }
    ps.posY[i] = out;
  }
}

let objectMaterials = [null];
/* Which shapes a moving body owns, indexed the same way as the shapes (the
   floor first, always false). The static solver uses it to leave those contacts
   alone: they have already been made, and made against something with a mass. */
let objectOwned = [false];

/* The solids that can be moved, one entry per shape and in the same order, or
   null where a shape is anchored scenery. Rebuilt from `objects` whenever the
   scene changes: a body reads its mass, its pose and the velocity it was left
   with out of the model, so rebuilding one never loses anything, and the model
   stays the only place a scene is described. */
let bodies = [];

/** What a shape weighs, in kilograms: how big it is times what it is made of. */
function massOf(o) {
  return shapeMass(o, OBJECT_DEPTH);
}

function toSDF(o) {
  if (o.kind === "ball") return new SphereSDF(o.x, o.y, o.z ?? 0, o.r);
  if (o.kind === "wedge") {
    return new WedgeSDF(o.x, o.y, o.z ?? 0, o.hw, o.hh, o.hd ?? OBJECT_DEPTH / 2, objectRotation(o));
  }
  return new BoxSDF(o.x, o.y, o.z ?? 0, o.hw, o.hh, o.hd ?? OBJECT_DEPTH / 2, objectRotation(o));
}

/** Push the model into the physics and into the scene, in one place, so the two
 *  cannot drift apart. */
function rebuildObjects() {
  objectScene.shapes = [floorSDF, ...objects.map(toSDF)];
  /* A shape with no density is part of the world - anchored, and moved by
     nothing. Everything the picker builds has a density, so this is the
     exception, not the rule. */
  bodies = objects.map((o) => (o.fixed
    ? null
    : createBody(o, o.bounce ?? params.restitution, o.friction ?? params.friction, OBJECT_DEPTH)));
  /* The materials, indexed the same way - the floor first (null: it is the
     bench's own surface, and the PHYSICS sliders are its coefficients), then
     the shapes, which override the bench only where the user has set a
     coefficient of their own. The shapes themselves are handed over rather than
     their numbers, so that a shape inheriting the bench's value keeps following
     the slider instead of freezing whatever it was on this rebuild. */
  objectMaterials = [null, ...objects];
  objectOwned = [false, ...bodies.map((b) => b !== null)];
  objectLayer.sync(objects);
  objectLayer.setSelected(selectedObjectId);
}
rebuildObjects();

function selectObject(id) {
  selectedObjectId = id;
  ballSelection.clear();
  objectLayer.setSelected(id);
  inspector.setSelectedObject(shapeInfo());
  renderInspector();
}

function shapeInfo() {
  const o = objects.find((s) => s.id === selectedObjectId);
  if (!o) return null;
  return {
    name: o.name,
    kind: o.kind,
    mass: massOf(o),
    /* Whether it answers to a hit at all. A wall of brick weighs a third of a
       tonne and a ball barely nudges it, so "it did not move" is not a bug
       unless the panel says this, and a student who wants a panel they can
       knock over can type a smaller mass and watch it happen. */
    fixed: !!o.fixed,
    /* What this shape's surface answers with: its own coefficient where it has
       one, the bench's where it has not. Both numbers are shown either way,
       because an empty field would read as zero - and zero is a real material,
       the one that does not bounce at all. */
    material: {
      bounce: o.bounce ?? params.restitution,
      friction: o.friction ?? params.friction,
      own: o.bounce !== undefined || o.friction !== undefined,
    },
    position: { x: o.x, y: o.y, z: o.z ?? 0 },
    size: o.kind === "ball"
      ? { r: o.r }
      : { x: o.hw * 2, y: o.hh * 2, z: (o.hd ?? OBJECT_DEPTH / 2) * 2 },
    rotation: Object.fromEntries(
      Object.entries(objectRotation(o)).map(([axis, radians]) => [axis, radians * 180 / Math.PI])
    ),
  };
}

function addShape(key) {
  const preset = SHAPE_PRESETS.find((p) => p.key === key);
  if (!preset) return;
  const shape = {
    id: `shape-${++objectIdCounter}`, name: preset.label,
    ...preset.material, density: preset.density, ...preset.spec,
  };
  shape.x = freeSlot(shape);
  shape.y = FLOOR_Y + restHeight(shape);
  objects.push(shape);
  rebuildObjects();
  rebaseSceneEnergy();
  selectObject(shape.id);
  markRunStart(true); // the bench just changed: this is what it is now
}

function setObjectTransform(section, axis, value) {
  const o = objects.find((s) => s.id === selectedObjectId);
  if (!o || !Number.isFinite(value)) return;
  if (section === "position") {
    o[axis] = value;
  } else if (section === "size") {
    if (o.kind === "ball") {
      o.r = Math.max(0.01, value);
    } else {
      const half = Math.max(0.01, value / 2);
      if (axis === "x") o.hw = half;
      else if (axis === "y") o.hh = half;
      else if (axis === "z") o.hd = half;
    }
  } else if (section === "mass") {
    /* A mass typed here is the same statement as a material: what this thing is
       made of. It is converted to the density that produces it, so the mass
       follows the size the way a bigger wall is heavier, and a shape resized
       afterwards keeps behaving like a shape and not like a weight. */
    const volume = shapeVolume(o, OBJECT_DEPTH);
    if (volume > 1e-9) o.density = Math.max(0, value) / volume;
  } else if (section === "rotation") {
    const rotation = objectRotation(o);
    rotation[axis] = value * Math.PI / 180;
    o.rotation = rotation;
    o.angle = rotation.z;
  }
  commitShapeEdit();
}

/**
 * What every edit to a shape ends with, wherever it came from - a field in the
 * panel, or a grip dragged across the stage.
 *
 * The physics and the drawing are rebuilt from the model so they cannot drift
 * from it; the energy budget starts again from here; and the panel is handed the
 * shape as it now is, because a number typed into the panel and a corner pulled
 * on the stage are the same statement and each has to show the other. Resizing
 * or moving a solid changes how much potential energy the bench itself is
 * holding, and that is the scene's business rather than the experiment's:
 * without the rebase the panel reports a tonne of brick lifted a centimetre as
 * energy invented by the panel.
 */
function commitShapeEdit() {
  rebuildObjects();
  rebaseSceneEnergy();
  inspector.setSelectedObject(shapeInfo());
}

/** A coefficient typed for one shape, which from here on keeps it - this is what
 *  lets a bench hold two surfaces at once, and it is the one number that turns
 *  "the ball did not bounce" into an experiment with a cause. */
function setObjectMaterial(section, value) {
  const o = objects.find((s) => s.id === selectedObjectId);
  if (!o || !Number.isFinite(value)) return;
  o[section] = Math.min(1, Math.max(0, value));
  inspector.setSelectedObject(shapeInfo());
}

/** Pin a shape to the world, or let it be knocked about again. */
function setObjectFixed(fixed) {
  const o = objects.find((s) => s.id === selectedObjectId);
  if (!o) return;
  o.fixed = !!fixed;
  if (o.fixed) {
    // Anchored scenery does not carry motion into the next run: it is placed,
    // and where it was placed is where it is.
    delete o.vx; delete o.vy; delete o.vz; delete o.omega;
  }
  rebuildObjects();
  rebaseSceneEnergy();
  inspector.setSelectedObject(shapeInfo());
}

/** Hand the shape back to the bench's own surface. */
function resetObjectMaterial() {
  const o = objects.find((s) => s.id === selectedObjectId);
  if (!o) return;
  delete o.bounce;
  delete o.friction;
  inspector.setSelectedObject(shapeInfo());
}

function deleteSelectedObject() {
  if (!selectedObjectId) return;
  objects = objects.filter((o) => o.id !== selectedObjectId);
  selectedObjectId = null;
  rebuildObjects();
  rebaseSceneEnergy();
  selectObject(null);
  markRunStart(true);
}

/* ==================================================================================
   BALL EDITING - the transform editor's other half
   ================================================================================== */

/** The one ball the inspector is editing, or null when the selection is empty
 *  or more than one ball - a field can only be one body's number. */
function singleSelectedBall() {
  if (selectedObjectId) return null;
  const sel = selectedBallIndices();
  return sel.length === 1 ? sel[0] : null;
}

/** Which of the two models the transform editor is pointed at: a solid in the
 *  scene, or a single spawned ball. */
function setTransform(section, axis, value) {
  if (selectedObjectId) setObjectTransform(section, axis, value);
  else setBallTransform(section, axis, value);
}

/**
 * Edit the selected ball in place - where it is, how big it is, how heavy it
 * is, how it is moving - with the same typed fields a shape gets. Radius
 * carries the mass with it until the mass is typed over, because a bigger ball
 * of the same stuff is heavier and a ball whose mass no longer follows from its
 * size would collide like a different ball than it looks.
 * A ball being held in the hand has its copy moved too, or the next mouse move
 * would snap it back to where the hand still thinks it is.
 */
function setBallTransform(section, axis, value) {
  const i = singleSelectedBall();
  if (i === null || !Number.isFinite(value)) return;
  if (section === "position") {
    ps[`pos${axis.toUpperCase()}`][i] = value;
    const grip = held.get(i);
    if (grip) grip[{ x: 0, y: 1, z: 2 }[axis]] = value;
  } else if (section === "velocity") {
    ps[`vel${axis.toUpperCase()}`][i] = value;
  } else if (section === "size") {
    const r = Math.max(0.01, value);
    ps.radius[i] = r;
    ps.mass[i] = ParticleSystem.massFromRadius(r);
  } else if (section === "mass") {
    /* The mass every collision is weighed by: a heavy ball meeting a light one
       leaves the light one moving faster and itself barely slowed, which is the
       whole of the momentum lab with mass as its variable. The floor is a
       different matter - it has no mass here to be asked for. */
    ps.mass[i] = Math.max(1e-4, value);
  } else if (section === "force") {
    ps[`force${axis.toUpperCase()}`][i] = value;
  }
  /* Any of these is a statement about a body rather than about its motion, so
     the energy budget starts again from here - the same rule the shapes follow.
     Nothing else keeps the panel honest: the totals are summed over whatever
     the masses are *now*, so a ball retyped from 1 kg to 100 kg would otherwise
     be compared against a run that never contained a hundred-kilogram ball and
     the panel would report the difference as energy the bench had invented -
     the largest number on screen, and the one a student is being asked to
     trust. */
  rebaseSceneEnergy();
  renderInspector();
}

/** Take the selected ball out of the scene. The sweep that does it closes the
 *  gap behind it, so every index we were holding - the drag, the selection -
 *  belongs to a different body now and has to be let go of first. */
function removeSelectedBall() {
  const i = singleSelectedBall();
  if (i === null) return;
  held.clear();
  ballSelection.clear();
  ps.sweep((index) => index === i);
  inspector.setSelectedObject(null);
  renderInspector();
  // The sweep moved balls between slots, so the old snapshot describes bodies
  // that no longer exist: the scene from here is the one runs start from.
  markRunStart(true);
}

function deleteSelection() {
  if (selectedObjectId) deleteSelectedObject();
  else removeSelectedBall();
}

/* ==================================================================================
   MEASUREMENT - the two conservation laws, plus the numbers a lab writes down
   ================================================================================== */

/** The mechanical energy the current experiment started with. Every spawn, lab
 *  and page load rebases it, because those are the moments a new run begins and
 *  "how much is left" only means anything against a starting point. */
let energyBaseline = 0;

/* Where a run began. An experiment is only worth anything if it can be repeated
   on the same initial conditions, and the alternative to keeping those is the
   student rebuilding the scene by hand between attempts - which is both tedious
   and never quite the same scene twice. Filled in by markRunStart whenever the
   scene is rebuilt and when the clock leaves zero; read by restartRun. */
let runStart = null;
let recording = [];
let recordAccum = 0;

/**
 * Sum up the scene once: energies, momentum, and the per-ball extremes a lab
 * notebook keeps as columns.
 *
 * Height is measured from the floor's surface to the ball's centre, which is
 * the same datum the 2D rulers put their zero on - so a height read off the
 * stage is the height that went into the potential energy, and the two cannot
 * quietly disagree.
 *
 * Below that datum the height goes on falling, into negative numbers. It is
 * tempting to floor it at zero - nothing on the bench is ever below the bench -
 * and it reads as the safe thing to do, and it is the one place the panel tells
 * a student something that is not true. The bench ends: a ball that rolls off
 * the edge is in empty space and falls, which is exactly what the scene is
 * meant to show. Clamped, the ball's kinetic energy climbed while its potential
 * energy sat still, and the panel announced that the bench had invented
 * seventy-odd joules a metre on the way down - the largest number on screen, at
 * the moment a student had just watched a fall they could explain. Unclamped,
 * the fall trades one for the other and the change stays where it belongs, at
 * zero. Nothing above the bench moves: every resting ball and every standing
 * solid has a positive height, so this is a change to one case - the one that
 * was wrong.
 */
function measureScene() {
  let kinetic = 0, potential = 0, px = 0, py = 0, pz = 0;
  let count = 0, sumSpeed = 0, maxSpeed = 0;
  for (let i = 0; i < ps.count; i++) {
    if (!ps.active[i]) continue;
    const speed = ps.speed(i), m = ps.mass[i];
    kinetic += 0.5 * m * speed * speed;
    potential += m * params.gravity * (ps.posY[i] - FLOOR_Y);
    px += m * ps.velX[i]; py += m * ps.velY[i]; pz += m * ps.velZ[i];
    if (speed > ps.maxSpeed[i]) ps.maxSpeed[i] = speed;
    if (ps.posY[i] > ps.peakY[i]) ps.peakY[i] = ps.posY[i];
    count++; sumSpeed += speed;
    if (speed > maxSpeed) maxSpeed = speed;
  }
  /* The shapes are part of the scene, so they are part of its totals: a heavy
     ball that has just knocked a light wall over has handed that wall its
     momentum, and a readout that only counted balls would show the momentum of
     the scene being destroyed by the collision. What a struck shape holds is
     its translation *and* its spin, which is where an off-centre hit puts the
     energy the ball no longer has. */
  for (const body of bodies) {
    if (!body) continue;
    const speed = Math.hypot(body.vx, body.vy, body.vz);
    kinetic += 0.5 * body.mass * speed * speed + 0.5 * body.inertia * body.omega * body.omega;
    potential += body.mass * params.gravity * (body.cy - FLOOR_Y);
    px += body.mass * body.vx; py += body.mass * body.vy; pz += body.mass * body.vz;
  }
  return {
    kinetic, potential, mechanical: kinetic + potential,
    px, py, pz, count, avgSpeed: count ? sumSpeed / count : 0, maxSpeed,
  };
}

/** A scene that has just been altered is a new energy budget: the change the
 *  panel reports is measured against the scene as it stands, or adding a shape
 *  would read as 1445 joules of energy invented by the bench. */
function rebaseSceneEnergy() {
  energyBaseline = measureScene().mechanical;
  /* Every path that changes what is on the bench comes through here, so this is
     also where the session learns it is out of date - one place rather than a
     save call bolted onto each of them, which is how one gets forgotten. */
  scheduleSessionSave();
}

function rebaseEnergy() {
  energyBaseline = measureScene().mechanical;
  recording = [];
  recordAccum = 0;
  leftRailApi.setRecorded(0);
  scheduleSessionSave();
}

/* ------------------------------- physics settings ------------------------------- */

/**
 * Change the physics settings *in place*. In place and never by assignment:
 * `params` is the one object the simulation loop, the panels and the debug
 * handle all hold, and swapping it for a fresh one - as an innocuous-looking
 * `params = {...}` does - leaves every reader looking at a scene that is no
 * longer the one being run. Defaults first, then the changes, so a lab is a
 * complete description of its physics rather than a patch on whatever was on
 * screen before.
 */
function setParams(...layers) {
  Object.assign(params, ...layers);
}

/* -------------------------------------- spawning -------------------------------------- */

/**
 * Put a batch of balls on the stage and give them its launch.
 *
 * One place, because the spawn panel and a lab preset have to start an
 * experiment identically: a ball that begins with a velocity begins with the
 * same velocity whichever button began it.
 *
 * @param {{count:number, radius:number, pattern:string, height:number,
 *          speed:number, angle:number}} spawn
 * @param {'replace'|'add'} mode
 * @returns {number} the index the batch starts at
 */
function spawnBalls(spawn, mode) {
  if (mode === "replace") ps.clear();
  const from = ps.count;
  const speed = spawn.speed ?? 0;
  const radians = ((spawn.angle ?? 0) * Math.PI) / 180;
  // The launch is in the x/y plane, which is the plane every shape here lives
  // in and the plane the 2D view looks at: a projectile lab is a side view.
  const vx = speed * Math.cos(radians), vy = speed * Math.sin(radians);
  const height = spawn.height ?? 0;
  ps.spawnPattern(spawn.count, spawn.radius, spawn.pattern, FLOOR.y + height);
  for (let i = from; i < ps.count; i++) {
    const r = ps.radius[i];
    /* Released from `height` means the ball's underside starts there, not the
       hair of clearance the spawner leaves: a 1.20 m drop should be 1.20 m, or
       the number in the lab's own question is not the number on the screen. */
    if (height > 0) ps.posY[i] = FLOOR_Y + r + height;
    ps.velX[i] = vx; ps.velY[i] = vy; ps.velZ[i] = 0;
    ps.bornX[i] = ps.posX[i]; ps.bornY[i] = ps.posY[i]; ps.bornZ[i] = ps.posZ[i];
    ps.bornT[i] = simTime;
    ps.peakY[i] = ps.posY[i];
    ps.maxSpeed[i] = 0;
  }
  ejectFromShapes(from);
  if (ps.count > from) {
    lastLaunch = { x: ps.posX[from], y: ps.posY[from], z: ps.posZ[from], vx, vy, radius: ps.radius[from] };
  }
  trails.clear();
  rebaseEnergy();
  renderInspector();
  markRunStart(true); // a newly built batch is the state the next run starts from
  return from;
}

/* ==================================================================================
   THE LAB BENCH - nine experiments, set up in one click
   ================================================================================== */

/** A shape from frontend/labs.js: a preset with a place to stand. */
function buildShape(spec, index) {
  const preset = SHAPE_PRESETS.find((p) => p.key === spec.key);
  const shape = {
    id: `shape-${++objectIdCounter}`,
    name: preset?.label ?? spec.key,
    ...(preset?.material ?? {}),
    density: spec.density ?? preset?.density,
    ...(preset?.spec ?? {}),
    x: spec.x ?? 0,
  };
  // A lab that its own surface depends on says so in its own entry, so the
  // frictionless slope stays frictionless however the preset is made.
  if (spec.bounce !== undefined) shape.bounce = spec.bounce;
  if (spec.friction !== undefined) shape.friction = spec.friction;
  if (spec.rotation) shape.rotation = { ...spec.rotation };
  // Set down on the floor rather than through it: the same sum that places a
  // shape from the picker, with the rotation already taken into account.
  shape.y = spec.y ?? FLOOR_Y + restHeight(shape);
  return shape;
}

/**
 * The parts of a lab no panel can express: exactly where each ball stands, how
 * fast it is already going, and what is pushing it. A collision lab is two
 * balls and two velocities, and the panels deliberately only offer one launch.
 *
 * A `place` height is the ball's underside above the floor (0 = set down on it,
 * null = the lab's own release height), so a lab can put a ball on the ground or
 * on the side of a ramp without knowing anything about radius or floor level.
 */
function applyLabOverrides(lab, from, spawn) {
  for (const [k, place] of (lab.place ?? []).entries()) {
    const i = from + k;
    if (i >= ps.count) break;
    const [x, bottom] = place;
    const height = bottom === null || bottom === undefined ? (spawn.height ?? 0) : bottom;
    ps.posX[i] = x;
    ps.posY[i] = FLOOR_Y + ps.radius[i] + height;
    ps.bornX[i] = x; ps.bornY[i] = ps.posY[i]; ps.bornT[i] = simTime;
    ps.peakY[i] = ps.posY[i];
  }
  for (const [k, v] of (lab.velocity ?? []).entries()) {
    const i = from + k;
    if (i >= ps.count) break;
    ps.velX[i] = v[0]; ps.velY[i] = v[1]; ps.velZ[i] = v[2] ?? 0;
  }
  for (const [k, f] of (lab.force ?? []).entries()) {
    const i = from + k;
    if (i >= ps.count) break;
    ps.forceX[i] = f[0]; ps.forceY[i] = f[1]; ps.forceZ[i] = f[2] ?? 0;
  }
  // A ball can be *placed* inside a shape (on a ramp's back, say): the ejector
  // lifts it out to where it would rest, so the lab starts at rest on the
  // surface rather than half buried in it.
  ejectFromShapes(from);
  // The lift is part of where the ball started, so the recorded origin and the
  // peak it is measured against both follow it up.
  for (let i = from; i < ps.count; i++) {
    ps.bornY[i] = ps.posY[i];
    ps.peakY[i] = ps.posY[i];
  }
  rebaseEnergy();
}

/** Build the whole experiment: settings, shapes, balls, camera, instruments. */
function applyLab(id) {
  const lab = LABS.find((l) => l.id === id);
  if (!lab) return;
  setParams(DEFAULT_PARAMS, lab.params);
  leftRailApi.setParams(params);

  const spawn = { ...DEFAULT_SPAWN, ...lab.spawn };
  leftRailApi.setSpawn(spawn);

  objects = (lab.objects ?? []).map(buildShape);
  selectedObjectId = null;
  rebuildObjects();

  ballSelection.clear();
  held.clear();
  const from = spawnBalls(spawn, "replace");
  applyLabOverrides(lab, from, spawn);
  for (const index of lab.track ?? []) {
    if (from + index < ps.count && ps.active[from + index]) ballSelection.add(from + index);
  }

  // The lab is built in whichever view the user is in rather than being forced
  // into one: every experiment here is a real 3D scene, and the 2D view is a
  // way of looking at it, not a requirement of it. The camera is re-framed for
  // the mode in hand, since the stage it was pointing at has just been rebuilt.
  resetView();
  tools.predict = lab.predict ?? true;
  leftRailApi.setTools(tools);

  for (const [labId, row] of labRows) row.classList.toggle("on", labId === lab.id);
  labCard.setLab(lab);
  inspector.resetMeasurements();
  inspector.setSelectedObject(null);
  renderInspector();
  // A lab opens paused on a scene that is already set up, and stops there: the
  // first thing a lab asks for is usually a prediction, and a prediction has to
  // be made before the ball is dropped.
  setRunning(false);
  // After the lab's own placement, not during the spawn: the balls are not where
  // the run starts until the lab has put them there.
  markRunStart(true);
}

/* ==================================================================================
   RECORDING - from "it moved" to a table
   ================================================================================== */

const RECORD_COLUMNS = [
  "t", "ball", "x", "y", "z", "vx", "vy", "vz", "speed", "height",
  "ke", "pe", "mechanical",
  "scene_ke", "scene_pe", "scene_mechanical", "px", "py", "pz", "p_total",
];
const MAX_RECORDED_ROWS = 60000;

/** Which balls a sample covers: the ones being watched, or - if nothing is
 *  selected - the first few on the stage, so pressing Record always records
 *  something rather than silently doing nothing. */
function recordedIndices() {
  const selected = selectedBallIndices();
  if (selected.length) return selected;
  const indices = [];
  for (let i = 0; i < ps.count && indices.length < 32; i++) if (ps.active[i]) indices.push(i);
  return indices;
}

const round5 = (v) => Number(v.toFixed(5));

function recordSample(scene) {
  if (recording.length >= MAX_RECORDED_ROWS) return;
  const pMag = Math.hypot(scene.px, scene.py, scene.pz);
  for (const i of recordedIndices()) {
    const speed = ps.speed(i), m = ps.mass[i];
    const height = floorHeight(ps.posY[i], ps.radius[i]);
    recording.push([
      round5(simTime), i,
      round5(ps.posX[i]), round5(ps.posY[i]), round5(ps.posZ[i]),
      round5(ps.velX[i]), round5(ps.velY[i]), round5(ps.velZ[i]),
      round5(speed), round5(height),
      round5(ps.kineticEnergy(i)), round5(m * params.gravity * Math.max(height, 0)),
      round5(ps.kineticEnergy(i) + m * params.gravity * Math.max(height, 0)),
      round5(scene.kinetic), round5(scene.potential), round5(scene.mechanical),
      round5(scene.px), round5(scene.py), round5(scene.pz), round5(pMag),
    ]);
  }
  leftRailApi.setRecorded(recording.length);
}

/**
 * Keep the table at a fixed spacing in *simulated* time, so the same run
 * produces the same rows whether it was watched at 60 fps, in slow motion, or
 * stepped one frame at a time by hand - and so a stalled frame cannot swallow
 * a sample. `steps` is what the frame loop actually managed.
 */
function accumulateRecording(steps, scene) {
  if (!tools.record || steps <= 0) return;
  recordAccum += steps * params.dt;
  while (recordAccum >= RECORD_INTERVAL) {
    recordAccum -= RECORD_INTERVAL;
    recordSample(scene);
  }
}

function exportRecording() {
  if (!recording.length) return;
  downloadCSV(`dynamics-lab-${Date.now()}.csv`, RECORD_COLUMNS, recording);
}

function clearShapes() {
  objects = [];
  rebuildObjects();
  rebaseSceneEnergy();
  selectObject(null);
  // A bench with nothing on it is a scene, and a scene is where a run begins.
  markRunStart(true);
}

/* ==================================================================================
   PAGES - independent, switchable scenes
   ================================================================================== */
let pages = [];
let activePageId = null;
let pageIdCounter = 0;

/**
 * Pages the user has not named are numbered by their rank among themselves,
 * never by a running counter. A counter counts pages that no longer exist:
 * open a second page, close it, open another, and it would call the new one
 * "Page 3" with no Page 2 in sight. Ranking instead means the row always reads
 * 1..n, closing "Page 2" of three hands that name to the page behind it, and a
 * page the user has renamed keeps its name and is not counted at all.
 */
function renumberAutoPages() {
  let n = 0;
  for (const page of pages) {
    if (page.autoNamed) page.name = `Page ${++n}`;
  }
}

function makePage() {
  pageIdCounter++;
  return {
    id: `page-${pageIdCounter}`, // ids stay unique even when a name is reused
    autoNamed: true,
    name: `Page ${pages.filter((p) => p.autoNamed).length + 1}`,
    snapshot: null,
    params: { ...DEFAULT_PARAMS },
    spawn: { ...DEFAULT_SPAWN },
    objects: [],
  };
}

function activePage() {
  return pages.find((p) => p.id === activePageId);
}

/** Snapshot the live particle system + params into the currently active page. */
function saveIntoActivePage() {
  const page = activePage();
  if (!page) return;
  page.snapshot = ps.count > 0 ? serializeParticleSystem(ps) : null;
  page.params = { ...params };
  page.spawn = leftRailApi.getSpawn();
  page.objects = objects.map((o) => ({ ...o, rotation: o.rotation ? { ...o.rotation } : undefined }));
}

/** Load a page's snapshot + params into the live simulation. */
function loadPage(id) {
  const page = pages.find((p) => p.id === id);
  if (!page) return;
  ps.clear();
  if (page.snapshot && page.snapshot.count > 0) deserializeParticleSystem(ps, page.snapshot);
  setParams(DEFAULT_PARAMS, page.params);
  leftRailApi.setParams(params);
  leftRailApi.setSpawn(page.spawn ?? { ...DEFAULT_SPAWN });
  /* the shapes belong to the page too, and so does knowing that nothing is
     selected on it yet */
  objects = (page.objects ?? []).map((o) => ({ ...o, rotation: o.rotation ? { ...o.rotation } : undefined }));
  selectedObjectId = null;
  ballSelection.clear();
  held.clear();
  rebuildObjects();
  inspector.setSelectedObject(null);
  renderInspector();
  /* The physics counters describe the last step a page took, so leaving them
     alone would open a fresh page showing the previous one's numbers frozen
     on screen - there is no next step to overwrite them while paused. */
  stepMsSmooth = 0;
  collisionChecks = 0;
  inspector.setPerf({ stepMs: 0, collisionChecks: 0, fps: fpsSmooth });
  // A page is a scene, and a scene arriving is a run about to be set up.
  markRunStart(true);
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
  if (pages.length <= 1) return; // always at least one page
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

function renamePage(id, name) {
  const page = pages.find((p) => p.id === id);
  if (page && name.trim()) {
    page.name = name.trim();
    page.autoNamed = false; // typed by hand now, so its number is its own
  }
  renderPageTabs();
}

const pagebarTabs = document.getElementById("pagebarTabs");
function renderPageTabs() {
  pagebarTabs.innerHTML = "";
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
      const commit = () => renamePage(page.id, input.value);
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
    pagebarTabs.appendChild(tab);
  }
}

document.getElementById("addPageBtn").addEventListener("click", addPage);

// Start with exactly one empty page.
const firstPage = makePage();
pages.push(firstPage);
renumberAutoPages();
activePageId = firstPage.id;
renderPageTabs();

/* ==================================================================================
   VIEW MODE - 3D (orbit, perspective) vs 2D (pan/zoom, fixed orthographic front view)
   ================================================================================== */
/* The opening shot: dead-on at the stage's front face and a little above it.
   Azimuth 0 is straight down -Z, so the scene introduces itself square to the
   viewer instead of arriving half turned; the elevation is what tips the floor
   into view, without which a floor would read as a line. Distance is set so the
   whole slab fits with its front edge just inside the frame: a ground plane
   running out of the bottom of the viewport hides the one edge a ball can roll
   off, and an open scene is exactly the scene where you need to see that. */
const DEFAULT_VIEW = { azimuth: 0, elevation: 0.3, distance: 5.0 };

let viewMode = "3d";

/** The camera a mode opens with: an orbit and a perspective camera in 3D, a
 *  pan/zoom orthographic front view in 2D. One function, because two things
 *  need it - switching mode, and putting the camera back the way it started
 *  when a new scene arrives. */
function makeCameraController(mode) {
  /* A drag that starts on a ball or a shape is for moving that thing, not for
     orbiting: the camera only gets the gesture when it begins on the scene
     itself. This is the whole reason the two cameras take a veto. */
  const canDrag = (e) => !hitTest(e.clientX, e.clientY);
  if (mode === "3d") {
    return new OrbitCameraController(renderer.perspectiveCamera, canvas, {
      ...DEFAULT_VIEW,
      target: { x: 0, y: -0.1, z: 0 },
      canDrag,
    });
  }
  /* Framed like the 3D view rather than dead-centred on the origin: the floor
     is the only thing down there, so it sits about two thirds of the way down
     with the air above it left open for the balls to use. */
  return new PanZoomController2D(renderer.orthoCamera, canvas, {
    target: { x: 0, y: -0.7 }, zoomHeight: 2.4,
    canDrag,
    // The rulers are drawn in screen space, so a pan or a zoom redraws them.
    onInteract: () => layoutStageRules(),
  });
}

let cameraController = makeCameraController(viewMode);

function setViewMode(mode) {
  if (mode === viewMode) { layoutStageRules(); return; }
  viewMode = mode;
  renderer.setViewMode(mode);
  cameraController.dispose();
  cameraController = makeCameraController(mode);
  // A lab sets the view, so the toggle has to follow the view rather than the
  // other way round - the two ways in must not disagree about which is on.
  for (const b of viewToggle.querySelectorAll("button")) b.classList.toggle("on", b.dataset.mode === mode);
  canvas.setAttribute("aria-label", VP_LABELS[mode]);
  resize();
  /* Which view someone works in is a choice about their bench, not about this
     visit to it, and it is saved at once rather than at the next tick: it is
     the very last thing done before the page they are looking at goes away. */
  scheduleSessionSave();
}

/** Point the camera back where the current mode opens. A lab is a whole new
 *  scene, so arriving at one with the camera still aimed where the last drag
 *  left it can mean arriving at an empty-looking stage - the view mode is the
 *  user's, but the framing is the scene's. */
function resetView() {
  cameraController.dispose();
  cameraController = makeCameraController(viewMode);
  resize();
}

const viewToggle = document.getElementById("viewToggle");
viewToggle.querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    viewToggle.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    setViewMode(b.dataset.mode);
  });
});

/* ------------------------------------- stage zoom ------------------------------------- */
/* The stage already answers a wheel and a pinch; these two are the same gesture
   for someone who is not holding one. They are bound to whichever controller the
   current view mode built, so the pair means one thing on both benches and in
   both views, and the wheel's own limits are what they stop at. A step is
   symmetric in both directions - out by a fifth, back in by the fourth that
   undoes it - so pressing in and out again lands exactly where it started.

   Scoped to this shell rather than to the document: both benches are in the
   markup at once, and a button that drove the bench behind the one on screen
   would be a control that works and does nothing. */
const ZOOM_STEP = 0.8;
for (const b of document.querySelectorAll("#app [data-zoom]")) {
  b.addEventListener("click", () => {
    cameraController.zoom(b.dataset.zoom === "in" ? ZOOM_STEP : 1 / ZOOM_STEP);
  });
}

/* ------------------------------- run / pause / reset / checkpoint ------------------------------- */
/* Paused to begin with: an empty scene has nothing to run, and stepping into
   the workbench should not start a clock the user never asked for. The light
   grey Run button is the invitation; the clock starts when it is pressed. */
let running = false;

/**
 * Remember where a run begins: every ball where it stands, how heavy it is and
 * what is pushing it, what was being watched, and the bench it stands on.
 *
 * Called for two different reasons, and the difference is `bench`. A scene being
 * *built* (a spawn, a lab, a shape added, a page opened) is when the bench is
 * worth remembering, because a wall resized in the panel afterwards still has to
 * come back to the size it was made as - that is the whole point of restarting
 * rather than rebuilding by hand. The clock leaving zero is when the *balls*
 * have settled into their starting state, so a ball dragged into place, given a
 * mass or handed a force before Run is part of the setup and survives the
 * restart; that call leaves the bench alone.
 */
function markRunStart(bench = false) {
  /* An empty bench is nothing to run and therefore nothing to come back to:
     Restart says so by being unavailable, rather than by doing nothing when it
     is pressed. */
  if (ps.count === 0 && objects.length === 0) {
    runStart = null;
    syncRestartButton();
    return;
  }
  runStart = {
    /* The masses and the applied forces ride in here with everything else: the
       format carries what the student set, so a run comes back with the weights
       it was built with rather than the ones the radii imply. */
    balls: serializeParticleSystem(ps),
    bench: bench || !runStart
      ? objects.map((o) => ({ ...o, rotation: o.rotation ? { ...o.rotation } : undefined }))
      : runStart.bench,
    selection: [...ballSelection],
    frame,
    simTime,
    energyBaseline,
  };
  syncRestartButton();
}

/** Restart is only an offer while there is a run to go back to. */
function syncRestartButton() {
  document.getElementById("restartBtn").disabled = runStart === null;
}

/** Back to the top of the run: the restore, the clock at zero, the counters
 *  cleared, paused on the scene it started from - so the same experiment can be
 *  watched again rather than merely read about. */
function restartRun() {
  if (!runStart) return;
  setRunning(false);
  deserializeParticleSystem(ps, runStart.balls);
  frame = runStart.frame;
  simTime = runStart.simTime;
  energyBaseline = runStart.energyBaseline;
  for (let i = 0; i < ps.count; i++) {
    if (!ps.active[i]) continue;
    /* The restore rebuilds each ball from its position, which is exactly what a
       freshly spawned ball is: released here, now. `simTime` says when. */
    ps.bornT[i] = simTime;
    ps.peakY[i] = ps.posY[i];
  }
  /* The bench itself, back the way it was built: shapes moved, resized or
     re-materialled since are put back, because the run being repeated is the one
     that started with them like this. */
  objects = runStart.bench.map((o) => ({ ...o, rotation: o.rotation ? { ...o.rotation } : undefined }));
  if (!objects.some((o) => o.id === selectedObjectId)) selectedObjectId = null;
  rebuildObjects();
  ballSelection.clear();
  for (const i of runStart.selection) if (i < ps.count && ps.active[i]) ballSelection.add(i);
  held.clear();
  trails.clear();
  // A restart is a new run, so the samples are a new series: leaving the old
  // rows in would put the same motion in the table twice under one clock.
  recording = [];
  recordAccum = 0;
  leftRailApi.setRecorded(0);
  stepMsSmooth = 0;
  collisionChecks = 0;
  inspector.resetMeasurements();
  inspector.setPerf({ stepMs: 0, collisionChecks: 0, fps: fpsSmooth });
  document.getElementById("sbFrame").textContent = frame;
  document.getElementById("sbTime").textContent = `${simTime.toFixed(2)}s`;
  document.getElementById("sbRuntime").textContent = "0.00ms";
  inspector.setSelectedObject(shapeInfo());
  renderInspector();
}

const runBtn = document.getElementById("runBtn");
const runBtnIcon = runBtn.querySelector(".run-btn-icon");
const runBtnLabel = runBtn.querySelector(".run-btn-label");

function syncRunButton() {
  mountIcon(runBtnIcon, running ? "Pause" : "Play");
  runBtnLabel.textContent = running ? "Pause" : "Run";
  runBtn.classList.toggle("paused", !running);
  document.getElementById("statusDot").classList.toggle("live", running);
  document.getElementById("statusText").textContent = running ? "running" : "paused";
}
syncRunButton();

/** Run or pause from anywhere, so a lab can start an experiment and a step can
 *  stop one without either of them reaching for the button. */
function setRunning(on) {
  if (running === on) return;
  /* A clock leaving zero is the start of a run, and the one moment worth
     remembering: what the scene looked like just before Run was pressed. Later
     presses inside the same run deliberately do not overwrite it, so Restart
     always goes back to the top of the experiment and not to wherever it was
     last paused. */
  if (on && frame === 0 && simTime === 0) markRunStart();
  running = on;
  syncRunButton();
}

runBtn.addEventListener("click", () => setRunning(!running));
document.getElementById("stepBtn").addEventListener("click", () => stepOnce());
const restartBtn = document.getElementById("restartBtn");
restartBtn.addEventListener("click", () => restartRun());
syncRestartButton();
document.getElementById("resetBtn").addEventListener("click", () => {
  ps.clear();
  held.clear();
  ballSelection.clear();
  clearShapes(); // "clear the scene" means the whole scene
  markRunStart(true); // an empty scene is where the next run begins
});

document.getElementById("saveBtn").addEventListener("click", () => {
  downloadJSON(`physics-workbench-checkpoint-${Date.now()}.json`, serializeParticleSystem(ps));
});
document.getElementById("loadBtn").addEventListener("click", async () => {
  const data = await uploadJSONFile();
  if (!data) return;
  deserializeParticleSystem(ps, data);
  markRunStart(true);
});

/* ==================================================================================
   SELECTING AND DRAGGING
   One implementation for both views, because the only view-specific parts are
   the ray and the drag plane, and rendering/renderer.js already answers both
   from whichever camera is active.
   ================================================================================== */
const CLICK_SLOP = 4; // px: past this the gesture was a drag, not a click

let gesture = null; // the pointer gesture in progress
const held = new Map(); // ball index -> [x, y, z], while it is in the hand

/** What is under the pointer: the nearer of a ball and a shape. */
function hitTest(clientX, clientY) {
  const ray = renderer.ray(clientX, clientY);
  const ball = renderer.pickBall(clientX, clientY, ray);
  const shape = objectLayer.pick(ray);
  if (ball && shape) {
    return ball.distance <= shape.distance ? { kind: "ball", ...ball } : { kind: "shape", ...shape };
  }
  if (ball) return { kind: "ball", ...ball };
  if (shape) return { kind: "shape", ...shape };
  return null;
}

function selectedBallIndices() {
  return [...ballSelection].filter((i) => i < ps.count && ps.active[i]);
}

function selectBalls(indices) {
  ballSelection.clear();
  for (const i of indices) ballSelection.add(i);
  selectedObjectId = null;
  objectLayer.setSelected(null);
  inspector.setSelectedObject(null);
  renderInspector();
}

function toggleBall(index) {
  if (ballSelection.has(index)) ballSelection.delete(index);
  else ballSelection.add(index);
  selectedObjectId = null;
  objectLayer.setSelected(null);
  inspector.setSelectedObject(null);
  renderInspector();
}

/** Remember where a grabbed ball is, so the hand can hold it against gravity:
 *  see reapplyHeld(). */
function take(i) {
  if (i < ps.count && ps.active[i]) held.set(i, [ps.posX[i], ps.posY[i], ps.posZ[i]]);
}

/* ==================================================================================
   RESIZE GRIPS - the panel's Size fields, out on the shape itself
   ==================================================================================
 * A shape here is a section drawn in the x/y plane and extruded through the
 * depth, so its size is two numbers and every grip on it is a corner or an edge
 * of that section. Pulling one is the same statement as typing into the panel's
 * Size fields, made where the corner actually is - and the panel follows along as
 * it is pulled, because both go through the same model.
 *
 * A grip is named by a sign pair: (1, 1) is the top-right corner, (1, 0) the
 * middle of the right edge. And the resize is always the same statement - the
 * point opposite the one being pulled does not move, and the shape grows and
 * shifts to keep it where it was. That one rule covers a box, a ramp and a
 * sphere, from either camera, at any rotation, and it is what makes the far side
 * of a shape stay put under the hand instead of sliding away from it.
 *
 * The grips are DOM elements over the stage rather than meshes in it (ui.js):
 * they keep one size while the shape does not, they can carry a cursor, and a
 * grip on a shape pulled down to a sliver is still a grip. That is also why
 * their places have to be worked out again whenever the camera moves, which is
 * the frame loop's business.
 */

/* The layer of grips, drawn over the stage. A press on one begins a pull, and
   the pointer is listened to on the window from there on: a grip is a dozen
   pixels and the hand always leaves it. */
const resizeHandles = createResizeHandles(document.getElementById("viewport"), {
  onGrab: (key, event) => beginResize(key, event),
});

/** The pull in progress, or null. */
let reshape = null;

/** The smallest half-extent a shape can be pulled down to - the same floor the
 *  panel's own Size field carries, so the two ways in cannot disagree. */
const MIN_HALF = 0.01;

const _axisEuler = new THREE.Euler();
const _axisRotation = new THREE.Matrix4();
const _gripWorld = new THREE.Vector3();
const _gripCenter = new THREE.Vector3();
const _gripDelta = new THREE.Vector3();

/** A shape's cross-section as the numbers a grip works in: the two half-sizes of
 *  a box or a ramp, or the radius of a sphere. */
function sectionOf(o) {
  const round = o.kind === "ball";
  return {
    hd: o.hd ?? OBJECT_DEPTH / 2,
    hw: round ? undefined : o.hw,
    hh: round ? undefined : o.hh,
    r: round ? o.r : undefined,
  };
}

/**
 * Where the grip named by `sx`/`sy` sits, in the shape's own frame: an offset
 * from its centre, in metres.
 *
 * A ramp is the one shape whose numbers are not simply its half-sizes. It is a
 * right triangle standing on its base with its centre of mass at the origin, so
 * its three corners are at minus four thirds and two thirds of the way across -
 * which is exactly geometry/sdf.js's wedgeProfile, the same three points the
 * mesh is extruded from and the solver is handed. One profile, read three times.
 */
function gripLocalPoint(kind, s, sx, sy) {
  if (kind === "ball") return [sx * s.r, sy * s.r, 0];
  if (kind === "wedge") {
    return [
      sx > 0 ? 2 * s.hw / 3 : -4 * s.hw / 3,
      sy > 0 ? 4 * s.hh / 3 : -2 * s.hh / 3,
      s.hd,
    ];
  }
  return [sx * s.hw, sy * s.hh, s.hd];
}

/* A box wears all eight grips of its section; a sphere four, one per point of
   its silhouette; and a ramp has no fourth corner to offer, so its three are
   all there is. Which axes a grip resizes is not decided here - it falls out of
   whether that corner moves when the number does. */
const BOX_GRIPS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const WEDGE_GRIPS = [[-1, -1], [1, -1], [1, 1]];
const BALL_GRIPS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function gripsOf(o) {
  if (o.kind === "wedge") return WEDGE_GRIPS;
  if (o.kind === "ball") return BALL_GRIPS;
  return BOX_GRIPS;
}

/** What a grip wears for a cursor: the arrow says which way its corner goes.
 *  It is read off the shape's own axes, so on a shape turned well away from the
 *  camera it is a hint rather than a promise - but a hint in the right family is
 *  worth more than one cursor for all of them. */
function gripCursor(sx, sy) {
  if (sx && sy) return sx === sy ? "nwse-resize" : "nesw-resize";
  return sx ? "ew-resize" : "ns-resize";
}

/** A shape's own frame, in the order its mesh is drawn in. */
function rotationInto(o, out) {
  const r = objectRotation(o);
  return out.makeRotationFromEuler(_axisEuler.set(r.x, r.y, r.z, "XYZ"));
}

/** The shape on the panel, if there is one (a selected ball is not a shape). */
function selectedShape() {
  return objects.find((o) => o.id === selectedObjectId) ?? null;
}

/**
 * Where every grip on a shape is on screen, in client pixels.
 *
 * The grips sit on the section's own plane - the shape's front face - rather
 * than on the mid-plane it is built around: that face is what the eye reads an
 * edge from, and in the 3D view it is the near side, where a grip belongs. A
 * grip the camera has gone behind is left out; its projection is not a place on
 * screen at all.
 */
function gripPositions(o) {
  const out = [];
  if (!o) return out;
  const s = sectionOf(o);
  rotationInto(o, _axisRotation);
  _gripCenter.set(o.x, o.y, o.z ?? 0);
  for (const [sx, sy] of gripsOf(o)) {
    const [lx, ly, lz] = gripLocalPoint(o.kind, s, sx, sy);
    _gripWorld.set(lx, ly, lz).applyMatrix4(_axisRotation).add(_gripCenter);
    const p = renderer.project(_gripWorld.x, _gripWorld.y, _gripWorld.z);
    if (p.behind) continue;
    out.push({ key: `${sx},${sy}`, x: p.x, y: p.y, cursor: gripCursor(sx, sy) });
  }
  return out;
}

/**
 * Put a grip on every corner of the selected shape, and take them all away when
 * nothing is selected.
 *
 * Called every frame rather than on every edit: the camera can move underneath
 * them - an orbit, a zoom, a switch between the two views - and a grip that
 * stayed where it was while the shape it belongs to moved across the stage would
 * be worse than no grip at all.
 */
function syncResizeHandles() {
  const o = selectedShape();
  if (!o) { resizeHandles.setVisible(false); return; }
  resizeHandles.sync(gripPositions(o));
}

/** The grip nearest a point on a shape, which is what a right-press takes hold
 *  of: the corner you meant is the one under your hand, not the one you would
 *  have had to aim at. */
function nearestHandle(id, clientX, clientY) {
  const o = objects.find((s) => s.id === id);
  if (!o) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const { key, x, y } of gripPositions(o)) {
    const d = Math.hypot(x - clientX, y - clientY);
    if (d < bestDistance) { bestDistance = d; best = key; }
  }
  return best;
}

/**
 * Take hold of a grip: work out where the pull starts and what has to stay
 * still, and leave the rest to updateResize.
 *
 * Two things have to be right for a corner to track the hand exactly, and
 * neither is obvious. The first is which plane the pull is solved on. The ray
 * through the pointer has to meet a plane the grip is actually on, or the grip
 * starts out somewhere other than under the hand and the shape jumps at the
 * first move. The grips are drawn on the section's own plane, so that is the
 * plane - which is also why the pull is measured in the shape's x and y rather
 * than the screen's.
 *
 * The second is the anchor: the corner opposite the grip, in the shape's own
 * frame. Handed a shape, it reads as the far side staying put - which is what
 * holding one edge of something and pulling the other expects.
 */
function beginResize(key, event) {
  const o = selectedShape();
  const [sx, sy] = String(key).split(",").map(Number);
  if (!o || !Number.isFinite(sx) || !Number.isFinite(sy) || (!sx && !sy)) return;
  const s = sectionOf(o);
  const matrix = rotationInto(o, new THREE.Matrix4());
  const grip = gripLocalPoint(o.kind, s, sx, sy);
  const anchor = gripLocalPoint(o.kind, s, -sx, -sy);
  const anchorWorld = new THREE.Vector3(anchor[0], anchor[1], anchor[2])
    .applyMatrix4(matrix).add(new THREE.Vector3(o.x, o.y, o.z ?? 0));
  /* The pull is solved on the shape's own section plane, and the plane is taken
     through the anchor: the corner opposite the grip is the one point of the
     plane that does not move while the corner is pulled, so the plane is fixed
     for the whole gesture. A shape turned out of the world's own x/y plane has a
     section plane of its own, and a pull solved on any other would walk the
     corner away from the hand.
     A plane seen exactly edge-on is a line on screen: nothing on it can be aimed
     at, and the honest answer is that this angle has no pull in it. A few
     degrees of orbit is the way out, and it is a way the user already has. */
  const normal = new THREE.Vector3(0, 0, 1).applyMatrix4(matrix);
  const from = renderer.pointOnPlane(event.clientX, event.clientY, anchorWorld, normal);
  if (!from) return;

  /* How fast each free dimension answers the hand, in metres of size per metre
     of travel. A grip whose corner does not move when a number does has no
     answer here and resizes nothing in it: the middle of an edge leaves the
     other axis alone, and the top of a ramp leaves its own footprint alone. */
  const paramX = o.kind === "ball" ? "r" : "hw";
  const paramY = o.kind === "ball" ? "r" : "hh";
  const kx = s[paramX] ? (grip[0] - anchor[0]) / s[paramX] : 0;
  const ky = s[paramY] ? (grip[1] - anchor[1]) / s[paramY] : 0;

  reshape = {
    id: o.id, sx, sy, matrix, inverse: matrix.clone().invert(), normal,
    paramX, paramY, kx, ky,
    sizes: { ...s },
    from: { x: from.x, y: from.y, z: from.z },
    anchorWorld,
  };
  canvas.style.cursor = gripCursor(sx, sy);
}

/**
 * Reshape what is in hand so that it follows the hand.
 *
 * The travel is read in the shape's own frame, not the screen's: a shape can be
 * turned away from the camera, and a pull that resized it along the screen's
 * axes would leave it a differently shaped thing rather than a bigger one.
 * Everything else follows from the anchor - the new centre is wherever it has to
 * be to keep the anchor exactly where it was - and the edit ends the same way a
 * typed number does, so the panel counts up under the hand.
 */
function updateResize(clientX, clientY) {
  if (!reshape) return;
  const o = objects.find((s) => s.id === reshape.id);
  /* The shape can go while it is in hand - a page switch, a delete from the
     panel - and a pull with nothing at the far end of it is over. */
  if (!o) { endResize(); return; }
  const to = renderer.pointOnPlane(clientX, clientY, reshape.anchorWorld, reshape.normal);
  if (!to) return;
  /* The travel is read in the shape's own frame, where the plane it was solved
     on is the x/y plane: the out-of-plane part of the reading is the plane's own
     slant and carries no size, which is why only the two axes are used. */
  _gripDelta.set(to.x - reshape.from.x, to.y - reshape.from.y, to.z - reshape.from.z)
    .applyMatrix4(reshape.inverse);

  const next = { ...reshape.sizes };
  const smallest = (v) => Math.max(MIN_HALF, v);
  if (reshape.kx) next[reshape.paramX] = smallest(reshape.sizes[reshape.paramX] + _gripDelta.x / reshape.kx);
  if (reshape.ky) next[reshape.paramY] = smallest(reshape.sizes[reshape.paramY] + _gripDelta.y / reshape.ky);

  const anchor = gripLocalPoint(o.kind, next, -reshape.sx, -reshape.sy);
  _gripWorld.set(anchor[0], anchor[1], anchor[2]).applyMatrix4(reshape.matrix);
  if (o.kind === "ball") o.r = next.r;
  else { o.hw = next.hw; o.hh = next.hh; }
  o.x = reshape.anchorWorld.x - _gripWorld.x;
  o.y = reshape.anchorWorld.y - _gripWorld.y;
  o.z = reshape.anchorWorld.z - _gripWorld.z;
  commitShapeEdit();
}

/** Let go: the pull is over, and the shape is wherever it has been left. */
function endResize() {
  if (!reshape) return;
  reshape = null;
  canvas.style.cursor = "";
}

canvas.addEventListener("pointerdown", (e) => {
  /* Right-drag is the direct reshape: press anywhere on a shape and the grip
     nearest the press takes the corner, so a shape is reshaped without first
     finding a grip the size of a fingertip. The browser's own menu is the one
     thing in the way, and on a stage it has nothing to offer anyway. */
  if (e.button === 2) {
    e.preventDefault();
    const target = hitTest(e.clientX, e.clientY);
    if (target?.kind === "shape") {
      if (selectedObjectId !== target.id) selectObject(target.id);
      const key = nearestHandle(target.id, e.clientX, e.clientY);
      if (key) beginResize(key, e);
    }
    return;
  }
  if (e.button !== 0) return;
  const hit = hitTest(e.clientX, e.clientY);
  gesture = { hit, from: { x: e.clientX, y: e.clientY }, moved: false, additive: e.ctrlKey || e.metaKey || e.shiftKey };  if (!hit) return;

  /* A plain press on something not yet selected selects it now, so that what

     you are about to drag is what you see selected. A press on something
     already selected leaves the selection alone - that is how a group is
     dragged. An additive press changes nothing until release, so a misjudged
     ctrl-drag can still be undone by the same gesture. */
  if (hit.kind === "ball") {
    if (!gesture.additive && !ballSelection.has(hit.index)) selectBalls([hit.index]);
  } else if (!gesture.additive && selectedObjectId !== hit.id) {
    selectObject(hit.id);
  }

  /* The drag plane is fixed at the moment of the grab: through the point that
     was grabbed, facing the camera. The grabbed thing therefore keeps the
     depth it was grabbed at and tracks the pointer exactly. */
  renderer.beginDrag(hit.point);
  held.clear();
  if (hit.kind === "ball") for (const i of ballSelection) take(i);
});

canvas.addEventListener("contextmenu", (e) => e.preventDefault());
/* A pull can be taken hold of on a grip as well as on the canvas - the grips
   stand over the evidence - and the menu has to stay out of the way of both.
   The press that begins it always lands before the menu does. */
document.addEventListener("contextmenu", (e) => { if (reshape) e.preventDefault(); });

window.addEventListener("pointermove", (e) => {
  if (reshape) { updateResize(e.clientX, e.clientY); return; }
  if (!gesture) { updateHover(e.clientX, e.clientY); return; }
  if (!gesture.moved) {
    const far = Math.hypot(e.clientX - gesture.from.x, e.clientY - gesture.from.y);
    if (far <= CLICK_SLOP) return;
    gesture.moved = true; // and the next delta covers the whole gesture so far
  }
  moveGrabbed(renderer.dragDelta(e.clientX, e.clientY));
});

/* The cursor answers "is there something here I could pick up?" before the
   press does, so a ball and an empty patch of stage do not look alike. Only
   consulted between gestures - a boolean once per move, no reflow. */
let hovered = false;
function updateHover(x, y) {
  const hit = !!hitTest(x, y);
  if (hit === hovered) return;
  hovered = hit;
  canvas.classList.toggle("pickable", hit);
}

function moveGrabbed(d) {
  if (!d.x && !d.y && !d.z) return;
  const shape = objects.find((o) => o.id === selectedObjectId);
  if (shape) {
    /* A shape under the hand is being placed, not pushed: the drag takes the
       motion out of it as well as moving it. The hand cannot carry a velocity,
       and a body rebuilt from the model reads whatever velocity the model was
       left holding - so a slab grabbed mid-slide used to arrive where it was
       put still travelling, and started sliding again the moment it was let go.
       Zeroing it here, on every move of the drag, is what makes "put it down
       there" mean "leave it there". */
    shape.x += d.x;
    shape.y += d.y;
    shape.z = (shape.z ?? 0) + d.z;
    shape.vx = 0; shape.vy = 0; shape.vz = 0; shape.omega = 0;
    rebuildObjects();
    rebaseSceneEnergy();
    inspector.setSelectedObject(shapeInfo());
    return;
  }
  for (const [i, p] of held) {
    p[0] += d.x; p[1] += d.y; p[2] += d.z;
    ps.posX[i] = p[0]; ps.posY[i] = p[1]; ps.posZ[i] = p[2];
    ps.velX[i] = 0; ps.velY[i] = 0; ps.velZ[i] = 0;
  }
}

/* A reshape ends wherever the hand is let go, which is usually nowhere near
   the eleven pixels it started on - so the gesture listens to the window rather
   than to the shape. */
window.addEventListener("pointerup", () => { if (reshape) endResize(); });
window.addEventListener("pointercancel", () => { if (reshape) endResize(); });

canvas.addEventListener("pointerup", (e) => {
  if (e.button !== 0) return;
  const g = gesture;
  gesture = null;
  renderer.endDrag();
  held.clear();
  if (!g) return;
  if (g.moved) return; // that was a drag: the scene has already moved
  if (!g.hit) {
    ballSelection.clear();
    selectObject(null);
  } else if (g.additive && g.hit.kind === "ball") {
    toggleBall(g.hit.index);
  }
});

/* -------------------------------------- inspector -------------------------------------- */

/** The INSPECTOR panel: whatever is selected, or how to select something. */
function renderInspector() {
  if (selectedObjectId) return;
  const sel = selectedBallIndices();
  if (!sel.length) {
    inspector.setSelectedObject(null);
    inspector.setPicked(EMPTY_PICKED);
    return;
  }
  /* One ball gets the transform editor a shape gets; several get the current
     readout, because there is no single number to type when the selection is
     three bodies moving differently. */
  if (sel.length === 1) { inspector.setSelectedObject(ballInfo(sel[0])); return; }
  inspector.setSelectedObject(null);
  inspector.setPicked(groupReport(sel));
}

/**
 * The selected ball, shaped like a selected shape so one editor can serve
 * both: position and radius are the ball's own, velocity stands in for the
 * rotation a box would have, and the live numbers ride along so the panel can
 * show what it cannot be asked to type.
 */
function ballInfo(i) {
  const m = ps.mass[i];
  const height = floorHeight(ps.posY[i], ps.radius[i]);
  const kinetic = ps.kineticEnergy(i);
  const potential = m * params.gravity * Math.max(height, 0);
  return {
    kind: "particle",
    position: { x: ps.posX[i], y: ps.posY[i], z: ps.posZ[i] },
    size: { r: ps.radius[i] },
    mass: m,
    velocity: { x: ps.velX[i], y: ps.velY[i], z: ps.velZ[i] },
    force: { x: ps.forceX[i], y: ps.forceY[i], z: ps.forceZ[i] },
    /* The measured column of the notebook: everything the experiment produced
       that the fields above cannot show, because the fields are what you set. */
    measured: {
      speed: ps.speed(i),
      accel: ps.netAccel[i],
      height,
      peak: floorHeight(ps.peakY[i], ps.radius[i]),
      // The label is just "Peak height": it is the same quantity in every lab,
      // and what it is measured *from* is documented where it is restarted.
      releaseHeight: floorHeight(ps.bornY[i], ps.radius[i]),
      range: ps.landingRange[i] < 0 ? null : ps.landingRange[i],
      sinceRelease: Math.max(0, simTime - ps.bornT[i]),
      // -1 in the store means "not yet", which the panel shows as a dash.
      firstImpact: ps.touchT[i] < 0 ? null : Math.max(0, ps.touchT[i] - ps.bornT[i]),
      mass: m,
      // Weight, not mass: the force the ball hangs off the bench with, which is
      // the product a student is asked for and the one that moves with gravity.
      weight: m * params.gravity,
      kinetic,
      potential,
      mechanical: kinetic + potential,
    },
  };
}

function groupReport(sel) {
  let cx = 0, cy = 0, cz = 0, speed = 0, mass = 0, energy = 0;
  for (const i of sel) {
    cx += ps.posX[i]; cy += ps.posY[i]; cz += ps.posZ[i];
    speed += ps.speed(i); mass += ps.mass[i]; energy += ps.kineticEnergy(i);
  }
  const n = sel.length;
  return `
    <div class="picked-id">${n} balls selected</div>
    <div class="vec3">${vec3HTML((cx / n).toFixed(3), (cy / n).toFixed(3), (cz / n).toFixed(3))}</div>
    <div class="readout"><span class="rn">Centre of mass</span><span class="rv tab-nums">avg of ${n}</span></div>
    <div class="readout"><span class="rn">Avg speed</span><span class="rv tab-nums">${(speed / n).toFixed(3)} m/s</span></div>
    <div class="readout"><span class="rn">Combined mass</span><span class="rv tab-nums">${mass.toFixed(4)}</span></div>
    <div class="readout"><span class="rn">Kinetic energy</span><span class="rv tab-nums">${energy.toFixed(4)}</span></div>
    <div class="picked-empty">Drag any of them to move the group; ctrl-click to add or remove one.</div>
  `;
}

/* --------------------------------------- resize --------------------------------------- */
function resize() {
  const vp = document.getElementById("viewport");
  renderer.resize(vp.clientWidth, vp.clientHeight);
  if (viewMode === "2d") cameraController.resize(vp.clientWidth, vp.clientHeight);
  layoutStageRules();
}
window.addEventListener("resize", resize);
resize();
/* The viewport can also change size without the window doing anything - the
   workbench is un-hidden inside a page that is already laid out - and the
   rulers have to be right the first time they are seen. */
new ResizeObserver(() => layoutStageRules()).observe(document.getElementById("viewport"));

/* ------------------------------------- main loop ------------------------------------- */
let lastT = performance.now();
let fpsSmooth = 60, stepMsSmooth = 0, simTime = 0, frame = 0, collisionChecks = 0;

/** How far a ball's surface is from whatever solid is nearest - negative when
 *  it is inside one. */
function separation(i) {
  return objectScene.distance(ps.posX[i], ps.posY[i], ps.posZ[i]) - ps.radius[i];
}

function step() {
  /* Which watched balls are clear of everything as this step begins. A ball that
     is clear before the step and in contact after it has just landed - the only
     reliable reading of "it hit the ground", because a ball *resting* on the
     floor is in contact half the time, and a bounce has already thrown the
     velocity the other way by the time anything outside this function could
     look at it. */
  const airborne = [];
  for (const i of ballSelection) {
    if (i >= ps.count || !ps.active[i]) continue;
    const gap = separation(i);
    if (gap <= 0.005) continue;
    /* How far it is going to fall this step, from where it is now: leading
       with its current speed and finishing the step with gravity's
       contribution, which is how the position update itself is shaped. */
    const closing =
      Math.max(0, -ps.velY[i]) * params.dt + 0.5 * params.gravity * params.dt * params.dt;
    airborne.push([i, gap, closing]);
  }

  /* The line between a bounce and a ball simply resting on something: one step
     of gravity. Anything slower than that cannot be a collision, because the
     floor's own reaction is the only thing that could have made it.

     The ball-ball threshold is a shade lower, because the solver there measures
     the approach from both balls at once. */
  const restingSpeed = 2 * params.gravity * params.dt;
  ps.beginStep();
  profiler.time("integrate", () => {
    ps.integrate(params.dt, params.gravity, params.drag);
    /* A shape that can move is advanced on the same clock as the balls, one
       step of gravity at a time, so a struck wall and the ball that struck it
       are always at the same instant. */
    for (const body of bodies) if (body) stepBody(body, params.dt, params.gravity, FLOOR_Y);
  });
  const movable = bodies.some(Boolean);
  if (movable) syncBodyScene();
  if (params.collisions) {
    collisionChecks = profiler.time("collisions", () =>
      resolveParticleCollisions(ps, params.restitution, 0.09 * 2.2, restingSpeed)
    );
  } else {
    collisionChecks = 0;
  }
  /* Ball against shape, for the shapes that have a mass, and *before* the
     static solver - which is the pass that would otherwise treat a wall as
     immovable and reflect the ball off it as if it weighed the world. The two
     passes divide the shapes between them: this one owns the movable ones and
     resolves them completely, push-out and impulse together, and the static
     solver then finds nothing left to do with them. */
  if (movable) {
    collisionChecks += profiler.time("shape_collision", () => resolveBallBodyContacts(
      ps, objectScene, bodies, objectMaterials,
      params.restitution, params.friction, restingSpeed, params.gravity, FLOOR_Y,
    ));
    syncBodyScene();
  }
  profiler.time("sdf_collision", () =>
    resolveSDFCollisions(
      ps, objectScene, params.restitution, params.friction, restingSpeed, params.gravity,
      objectMaterials, objectOwned,
    )
  );

  const landing = [];
  for (const [i, gap, closing] of airborne) {
    if (i >= ps.count || !ps.active[i]) continue;
    if (separation(i) > 0.002) continue;
    landing.push(i);
    /* The clock stops where the surface is, not at the end of the step: the
       ball crossed the last couple of centimetres of its fall part-way through
       the step, and `gap` over the step's own fall says where. The solver has
       already snapped the ball onto the surface by now - the reading has to
       come from the motion that got it there. Without this a 1.20 m drop reads
       exactly 0.500 s against the formula's 0.495: the right answer, rounded to
       the nearest step, next to a position update that is exact. */
    if (ps.touchT[i] < 0) {
      const crossed = closing > 1e-9 ? gap / closing : 1;
      const fraction = Math.min(1, Math.max(0, crossed));
      ps.touchT[i] = simTime + params.dt * fraction;
      /* And the range is measured at the same instant, for the same reason: the
         step the ball landed on carried it up to two centimetres past the
         landing, which is 1.6% of a projectile's range - the difference between
         confirming v²sin2θ/g and wondering whether it is right. */
      ps.landingRange[i] =
        ps.posX[i] - ps.velX[i] * (1 - fraction) * params.dt - ps.bornX[i];
    }
    /* The peak is restarted at every impact, which is what makes one number
       answer three different labs: a projectile has no impact, so its peak is
       the apex of its arc; a ball set down on a ramp has one, at the bottom, so
       its peak is the height it was released from; and a bouncer's peak is the
       rebound it is being asked about. All three are "the highest it has been
       since it was last on something", which is one rule and not three. */
    ps.peakY[i] = ps.posY[i];
  }

  /* Everything that acted on the balls this step has now acted, so this is the
     one moment a true acceleration can be read: the balls that just landed are
     left out, because stopping is an impulse and not an acceleration. */
  ps.measureAccel(params.dt, landing);

  cullEscapees();
}

/** Put every moving shape's pose into the collision scene. Called after the
 *  bodies have moved and after a contact has shifted them, because from that
 *  moment on, where a ball finds the wall is where the wall now is. */
function syncBodyScene() {
  for (let k = 0; k < bodies.length; k++) {
    const body = bodies[k];
    if (body) syncPose(objectScene.shapes[k + 1], body);
  }
  /* The meshes ride along: the shapes are drawn where the physics says they
     are, or a knock-over would be something you read about in the panel rather
     than something you watch. */
  objectLayer.sync(objects);
}

/** Anything that has fallen well clear of the floor leaves the scene rather
 *  than falling forever underneath it. */
function cullEscapees() {
  if (!ps.sweep((i) => ps.posY[i] < FLOOR_Y - 0.75)) return;
  /* A sweep shuffles particles between slots, so every index we were holding is
     now somebody else's. Let go of all of them. */
  ballSelection.clear();
  held.clear();
  renderInspector();
  /* Deliberately *not* a new starting point: a ball that flew off the end of the
     bench was lost by the run, not by the scene, so Restart is what brings it
     back to where it was placed. The snapshot describes positions rather than
     slots, which is exactly why it survives the sweep. */
}

/** Put the grabbed balls back where the hand is holding them. Without this,
 *  gravity gets a vote on a ball being dragged and it sags out from under the
 *  pointer between mouse moves. */
function reapplyHeld() {
  for (const [i, p] of held) {
    ps.posX[i] = p[0]; ps.posY[i] = p[1]; ps.posZ[i] = p[2];
    ps.velX[i] = 0; ps.velY[i] = 0; ps.velZ[i] = 0;
  }
}

/** Advance the clock by exactly one step and show it. Stepping pauses first, or
 *  a button that promised one frame would silently deliver sixty. */
function stepOnce() {
  setRunning(false);
  step();
  frame++;
  simTime += params.dt;
  accumulateRecording(1, measureScene());
  renderInspector();
}

/** The predicted arc for the launch the last spawn used, if there is one to
 *  predict and the instrument is switched on. */
function predictionInput() {
  const launched = !!lastLaunch
    && lastLaunch.vx * lastLaunch.vx + lastLaunch.vy * lastLaunch.vy > 0.0004
    && ps.count > 0;
  return {
    show: tools.predict && launched,
    x: lastLaunch?.x ?? 0, y: lastLaunch?.y ?? 0, z: lastLaunch?.z ?? 0,
    vx: lastLaunch?.vx ?? 0, vy: lastLaunch?.vy ?? 0,
    radius: lastLaunch?.radius ?? 0.05,
    gravity: params.gravity, floorY: FLOOR_Y,
  };
}

/* Wall-clock time owed to the simulation. The step is fixed (dt is a physics
   setting, not a frame budget) and this is what turns elapsed real time into a
   count of steps, so a 0.5 s fall takes 0.5 s to watch and a lab's stopwatch
   and its ruler agree. Stepping once per frame instead - the obvious loop -
   makes the simulation run at whatever fraction of real time the machine
   manages, which on a laptop is about a third: the numbers come out right and
   every experiment takes three times as long as it says. */
let owedSeconds = 0;
const MAX_STEPS_PER_FRAME = 8; // a stall must not become a spiral

function frameLoop() {
  requestAnimationFrame(frameLoop);
  /* Another topic owns the screen: this workbench keeps its scene and its
     state, but it stops drawing. Two stages rendering at once would be two
     WebGL contexts racing for one frame budget, and the hidden one has nothing
     to say to anybody. */
  if (document.getElementById("app")?.hidden) return;
  const now = performance.now();
  const rawDt = now - lastT; lastT = now;
  fpsSmooth += (1000 / Math.max(rawDt, 1) - fpsSmooth) * 0.08;

  /* Slow motion stretches wall-clock time, never the physics: the same dt, the
     same trajectories, fewer steps a second. A control that changed dt instead
     would be showing a different simulation, which is the one thing a
     slow-motion control must never do. */
  if (running) owedSeconds += Math.min(rawDt, 250) / 1000 * (tools.slowmo ? 0.25 : 1);
  else owedSeconds = 0;

  let steps = 0;
  if (running) {
    const t0 = performance.now();
    while (owedSeconds >= params.dt && steps < MAX_STEPS_PER_FRAME) {
      step();
      owedSeconds -= params.dt;
      steps++;
      frame++;
      simTime += params.dt;
    }
    // The cap was reached with time still owed: drop it rather than trying to
    // catch up next frame, or one slow frame becomes a stampede of them.
    if (steps === MAX_STEPS_PER_FRAME) owedSeconds = 0;
    if (steps && held.size) reapplyHeld();
    if (steps) stepMsSmooth += ((performance.now() - t0) / steps - stepMsSmooth) * 0.15;
  }
  const stepping = steps > 0;

  const scene = measureScene();

  if (stepping) accumulateRecording(steps, scene);

  renderer.updateInstances(ps, COLOR_MODE);
  // the rings face the camera, so they are re-placed every frame, not rebuilt
  renderer.updateSelection(ps, ballSelection);
  trails.update(ps, tools.trails ? ballSelection : []);
  velocityArrows.setVisible(tools.vectors);
  if (tools.vectors) velocityArrows.update(ps, renderer.camera);
  stageGrid.setVisible(tools.grid);
  prediction.update(predictionInput());
  renderer.render();
  /* After the render, never before: the grips are placed by projecting world
     points through the camera, and the camera is only up to date once the frame
     it belongs to has been drawn. */
  syncResizeHandles();

  const momentum = {
    x: scene.px, y: scene.py, z: scene.pz,
    magnitude: Math.hypot(scene.px, scene.py, scene.pz),
  };
  inspector.setMeasurements({
    kinetic: scene.kinetic, potential: scene.potential, mechanical: scene.mechanical,
    change: scene.mechanical - energyBaseline, baseline: energyBaseline,
    momentum, hasData: scene.count > 0,
  });
  inspector.setAggregates({ avgSpeed: scene.avgSpeed, maxSpeed: scene.maxSpeed, count: scene.count });
  inspector.setPerf({ stepMs: stepMsSmooth, collisionChecks, fps: fpsSmooth });
  if (ballSelection.size) renderInspector();

  document.getElementById("sbFrame").textContent = frame;
  document.getElementById("sbTime").textContent = `${simTime.toFixed(2)}s`;
  document.getElementById("sbRuntime").textContent = `${stepMsSmooth.toFixed(2)}ms`;
  document.getElementById("sbBalls").textContent = `${scene.count} balls`;

  /* A catch-all, so nothing has to remember to ask for a save: whatever the
     frame changed, the session a second later is the scene on screen. A run in
     progress keeps asking, because the balls are somewhere new every frame and
     a pause after ten seconds should come back as ten seconds in. */
  if (stepping && ps.count > 0) sessionDirty = true;
  if (performance.now() - sessionWrittenAt >= SESSION_SAVE_EVERY) saveSession();
}

/* ==================================================================================
   THE SESSION - the scene outlives the page it was built on
   ================================================================================== */
/**
 * Work is not allowed to disappear because the page went away.
 *
 * Nothing here was ever the user's doing: a reload is the one gesture with no
 * undo, and the page has a hundred ways to take one - the reload button, a
 * crashed tab, and, in development, the full reload a bundler forces on every
 * save to a module. From the bench it is all the same event, and all of it read
 * as the workbench throwing an experiment away for no reason at all.
 *
 * So the scene is written to local storage as it is used - a few times a second
 * while anything is moving, and once more at the last moment the page is alive -
 * and read back on the way in. Everything the user built is in it: the balls and
 * their weights and forces, the shapes, the physics sliders, the view they were
 * working in. "Clear the scene" is still the way to say *this scene, forget it*,
 * and it forgets it because a cleared scene is what gets saved next.
 */
const SESSION_KEY = "physics-workbench:session";
const SESSION_VERSION = 1;
/* Long enough not to write a large snapshot on every frame of a run, short
   enough that anything built and abandoned within a moment is still there. */
const SESSION_SAVE_EVERY = 500; // ms

let sessionTimer = null;
let sessionWrittenAt = 0;
/* Whether *this* tab has anything of its own to save.
 *
 * There is one session per origin and there can be several workbenches open on
 * it, so a tab that was merely opened - still empty, because it was opened
 * before this one built anything - would otherwise write its own bare stage
 * over somebody else's experiment, several times a second. A tab writes only
 * once it has been asked to: a change, or a run that is actually going. */
let sessionDirty = false;

function sessionScene() {
  return {
    version: SESSION_VERSION,
    viewMode,
    params: { ...params },
    spawn: leftRailApi.getSpawn(),
    tools: { ...tools },
    objects: objects.map((o) => ({ ...o, rotation: o.rotation ? { ...o.rotation } : undefined })),
    balls: ps.count > 0 ? serializeParticleSystem(ps) : null,
  };
}

/** Write the scene now. Never throws: storage can be full, or switched off
 *  entirely in a private window, and neither is worth losing the session to. */
function saveSession() {
  if (sessionTimer !== null) { clearTimeout(sessionTimer); sessionTimer = null; }
  if (!sessionDirty) return;
  sessionDirty = false;
  sessionWrittenAt = performance.now();
  try { saveToLocalStorage(SESSION_KEY, sessionScene()); } catch (err) { /* no storage, no session */ }
}

/** Save once the current interaction is over, rather than during it - a drag
 *  across the bench is one change, not four hundred. */
function scheduleSessionSave() {
  sessionDirty = true;
  if (sessionTimer !== null) return;
  sessionTimer = setTimeout(saveSession, 250);
}

/**
 * Put back the scene the last visit was working on, and say so.
 *
 * A restore is worth announcing. A bench that has quietly filled itself with
 * someone's half-finished experiment is more confusing than an empty one, and
 * the offer to start over has to be visible next to the explanation.
 */
function restoreSession() {
  try {
    return applySession();
  } catch (err) {
    /* A session is a convenience, and a convenience is never allowed to be the
       reason the workbench will not open. Anything unreadable in it and this
       boot is a fresh bench, which is where we were going anyway. */
    console.warn("could not restore the last scene", err);
    return false;
  }
}

function applySession() {
  let saved = null;
  try { saved = loadFromLocalStorage(SESSION_KEY); } catch (err) { saved = null; }
  if (!saved || saved.version !== SESSION_VERSION) return false;
  /* Nothing on the bench is nothing to announce. A session with no balls and no
     shapes is an empty page, and opening onto one with a note explaining that
     an empty page has been restored is a worse first impression than the empty
     page it is describing. */
  if (!(saved.objects?.length > 0) && !(saved.balls?.count > 0)) return false;

  setParams(DEFAULT_PARAMS, saved.params ?? {});
  leftRailApi.setParams(params);
  leftRailApi.setSpawn(saved.spawn ?? { ...DEFAULT_SPAWN });
  if (saved.tools) {
    Object.assign(tools, saved.tools);
    leftRailApi.setTools(tools);
  }

  objects = (saved.objects ?? []).map((o) => ({ ...o, rotation: o.rotation ? { ...o.rotation } : undefined }));
  /* Ids are minted from a counter that starts at zero every boot, so it has to
     be picked up after the highest one that came back or the next shape added
     would reuse an id an existing shape is already wearing. */
  for (const o of objects) {
    const n = Number.parseInt(String(o.id ?? "").split("-").pop(), 10);
    if (Number.isFinite(n)) objectIdCounter = Math.max(objectIdCounter, n);
  }
  selectedObjectId = null;
  ballSelection.clear();
  held.clear();
  rebuildObjects();
  if (saved.balls && saved.balls.count > 0 && saved.balls.count <= MAX_BALLS) {
    deserializeParticleSystem(ps, saved.balls);
  }

  setViewMode(saved.viewMode === "2d" ? "2d" : "3d");
  /* The page the app opens on has to describe the scene that came back, or
     switching away and back would restore the empty bench it booted with. */
  saveIntoActivePage();
  renderInspector();
  rebaseEnergy();
  markRunStart(true);

  const note = document.getElementById("sessionNote");
  if (note) note.classList.remove("is-hidden");
  return true;
}

/** Throw the session away and hand back an empty bench, from the notice. */
function discardSession() {
  document.getElementById("sessionNote")?.classList.add("is-hidden");
  ps.clear();
  held.clear();
  ballSelection.clear();
  clearShapes();
  renderInspector();
  rebaseEnergy();
  markRunStart(true);
  saveSession();
}

document.getElementById("sessionDiscardBtn")?.addEventListener("click", discardSession);
/* Dismissing is not the same as discarding: the scene is worth keeping, the
   note is not worth reading twice. */
document.getElementById("sessionNoteClose")?.addEventListener("click", () => {
  document.getElementById("sessionNote")?.classList.add("is-hidden");
});

/* The last moment the page is alive is also the moment a snapshot taken a
   moment ago is worth bringing up to date: whatever the reload was for, what
   the user was looking at is what comes back. */
window.addEventListener("pagehide", saveSession);
window.addEventListener("beforeunload", saveSession);

renderInspector();
restoreSession();
requestAnimationFrame(frameLoop);

// Exposed for debugging from the browser console; not used internally.
// `camera` is a getter because switching view modes replaces the controller.
window.__workbench = {
  ps, params, objectScene, gpuMetrics, pages, renderer, hitTest,
  tools, labs: LABS, applyLab, measureScene, spawnBalls, setViewMode,
  step, ballInfo, floorHeight, massOf, rebuildObjects,
  get camera() { return cameraController; },
  get objects() { return objects; },
  get bodies() { return bodies; },
  get selection() { return [...ballSelection]; },
  get selectedObjectId() { return selectedObjectId; },
  get baseline() { return energyBaseline; },
  get recording() { return recording; },
  get reshaping() { return reshape; },
};

} // end bootWorkbench
