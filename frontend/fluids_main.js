/**
 * frontend/fluids_main.js - the Fluids workbench.
 *
 * The fourth bench, and the fourth time the same shell: one title bar with a
 * wordmark and a 3D/2D switch, save/load/reset/restart/step/run, two rails, a
 * stage, a page bar and a status bar. What is different is the medium. The
 * Dynamics bench has bodies, the Thermo bench has molecules, the Vibrations
 * bench has a rig; this one has a *volume* - a cloud of liquid particles, a
 * density constraint, and a free surface that has to hold itself together in
 * three dimensions.
 *
 * The solver is simulation/fluid3d.js, the picture is
 * rendering/fluid3d_renderer.js, and the two experiments are
 * frontend/fluids_labs.js. Nothing here decides any physics: the rail reads
 * the solver, and the tank is rebuilt from a lab.
 *
 * The clock is the simulation's. A step is 1/60 s of liquid and the renderer
 * draws when it can; a machine that cannot keep up shows slow liquid rather
 * than a different experiment.
 */
import {
  createElement, ArrowLeft, Box, Square, Download, Upload, Eraser, RotateCcw,
  StepForward, Play, Pause, Plus, Minus, X, FlaskConical, ChevronLeft, ChevronRight,
} from "lucide";
import { Fluid3D } from "../simulation/fluid3d.js";
import { Fluid3DRenderer } from "../rendering/fluid3d_renderer.js";
import { Fluid2DRenderer } from "../rendering/fluid2d_renderer.js";
import { buildFluidLeftRail, buildFluidRightRail } from "./fluids_ui.js";
import { FLUID_LABS, labById, feedNozzle, nozzleOpenFor } from "./fluids_labs.js";
import { mountAxisGizmo } from "./axis_gizmo.js";
import { mountStageDrawers } from "./drawer.js";
import { createLabCard } from "./ui.js";
import {
  downloadJSON, uploadJSONFile, loadFromLocalStorage, saveToLocalStorage,
} from "../storage/io.js";

const ICONS = {
  ArrowLeft, Box, Square, Download, Upload, Eraser, RotateCcw, StepForward,
  Play, Pause, Plus, Minus, X, FlaskConical, ChevronLeft, ChevronRight,
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

/** The bench as it first arrives, and the state every edit is layered onto. */
const DEFAULT_STATE = {
  lab: "dam",
  gravity: 9.81,
  surfaceTension: 0.072,
  viscosity: 0.001,
  preset: "water",
  body: false,
  bodyPlaced: false,
  density: 480,
  radius: 0.06,
  field: "surface",
  shake: false,
  shakeAmplitude: 2,
  shakeFrequency: 0.62,
};

const STEP_DT = 1 / 60;
const MAX_STEPS_PER_FRAME = 2;
const SESSION_KEY = "physics-workbench:fluids-session";
const SESSION_SAVE_EVERY = 800;
const LIQUID_DENSITY = 1000;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));

export function bootFluidsWorkbench() {
  const canvas = document.getElementById("fluidsCanvas");
  if (!canvas) return;

  for (const el of document.querySelectorAll("#fluids [data-icon]")) {
    mountIcon(el, el.dataset.icon);
  }

  const viewport = document.getElementById("fluidsViewport");

  /* ==================================================================================
     THE TANK
     ================================================================================== */
  const solver = new Fluid3D({ width: 1.2, height: 0.9, depth: 0.6, spacing: 0.046 });
  const renderer = new Fluid3DRenderer(canvas, solver, { resolution: 56 });
  const axisGizmo = mountAxisGizmo(viewport, () => renderer.camera);

  /* The second view: the same tank in section, on its own canvas. Both are fed
     from the same solver on the same frame, so switching between them changes
     the viewpoint and nothing else - not the clock, not the lab, not the
     numbers on the rails. The 2D canvas is absent only if the shell it belongs
     to is, and every use below is guarded. */
  const flatCanvas = document.getElementById("fluidsCanvas2d");
  const twoD = flatCanvas ? new Fluid2DRenderer(flatCanvas, solver) : null;

  window.__fluids = { solver, renderer, renderer2d: twoD };

  const state = { ...DEFAULT_STATE };
  let viewMode = "3d";
  let running = false;
  let accumulator = 0;
  let lastFrameTime = performance.now();
  let stepMs = 0;
  let stepCount = 0;
  let labId = state.lab;
  let volumeAtLab = 0;

  /* ------------------------------- the two views ------------------------------ */

  /** Draw whichever view is on screen. The 2D renderer decides for itself
   *  whether anything has changed, so calling this every frame costs a string
   *  comparison on a paused bench rather than a redraw. */
  function drawStage() {
    if (viewMode === "2d" && twoD) {
      twoD.setLook(state.preset === "custom" ? "water" : state.preset, state.field);
      twoD.update();
      return;
    }
    renderer.update();
  }

  /** The scene itself changed - a lab rebuilt, a checkpoint restored, a tint
   *  switched - so the picture is redrawn even if the clock has not moved. */
  function redrawStage() {
    if (twoD) twoD.invalidate();
    drawStage();
  }

  /* ------------------------------- the run loop ------------------------------- */

  function syncRunButton() {
    const button = document.getElementById("fluidsRunBtn");
    button.classList.toggle("paused", !running);
    const icon = button.querySelector(".run-btn-icon");
    const label = button.querySelector(".run-btn-label");
    if (icon) mountIcon(icon, running ? "Pause" : "Play");
    if (label) label.textContent = running ? "Pause" : "Run";
    document.getElementById("fluidsStatusDot").classList.toggle("live", running);
    document.getElementById("fluidsStatusText").textContent = running ? "running" : "paused";
  }

  function setRunning(on) {
    running = !!on;
    accumulator = 0;
    lastFrameTime = performance.now();
    syncRunButton();
  }

  /** One step of the liquid, and the things that feed it. */
  function advance() {
    const t = solver.time;
    solver.params.bodyAccelX = state.shake
      ? state.shakeAmplitude * Math.sin(2 * Math.PI * state.shakeFrequency * t)
      : 0;
    feedNozzle(solver, labId, t < nozzleOpenFor, STEP_DT);
    const before = performance.now();
    solver.step(STEP_DT);
    stepMs += performance.now() - before;
    stepCount++;
  }

  /* ==================================================================================
     THE RAILS
     ================================================================================== */

  const leftRail = buildFluidLeftRail(document.getElementById("fluidsLeftRail"), {
    onGravity: (v) => { state.gravity = v; state.preset = "custom"; solver.params.gravity = v; },
    onSurfaceTension: (v) => { state.surfaceTension = v; state.preset = "custom"; solver.params.surfaceTension = v; },
    onViscosity: (v) => {
      state.viscosity = v;
      state.preset = "custom";
      solver.params.viscosity = v;
      /* A hand-mixed viscosity is still one of the three fluids by the look of
         it: below olive oil it reads as water, above it as oil, and the thick
         end as honey. */
      renderer.setLook(v >= 0.25 ? "honey" : v >= 0.02 ? "oil" : "water", state.field);
    },
    onPreset: (key) => setPreset(key),
    onBody: (on) => {
      state.body = on;
      if (on) state.bodyPlaced = true;
      setBodyPresent(on);
      leftRail.setState(state);
      /* The picture is allowed to be older than the rail only for as long as it
         takes to draw: putting a body in the tank while paused is a change you
         can see, and a view that waited for the next Run to show it would be
         showing the tank as it was. */
      redrawStage();
    },
    onDensity: (v) => {
      state.density = v;
      solver.ball.density = v;
      leftRail.setBodyHint(bodyHint());
      redrawStage();
    },
    onRadius: (v) => {
      state.radius = v;
      solver.ball.r = v;
      solver.ball.x = clamp(solver.ball.x, v, solver.width - v);
      solver.ball.y = clamp(solver.ball.y, v, solver.height - v);
      redrawStage();
    },
    onField: (key) => { state.field = key; renderer.setField(key); },
    onShake: (on) => { state.shake = on; leftRail.setState(state); },
    onShakeAmplitude: (v) => { state.shakeAmplitude = v; },
    onShakeFrequency: (v) => { state.shakeFrequency = v; },
  });

  const rightRail = buildFluidRightRail(document.getElementById("fluidsRightRail"), {});

  function bodyHint() {
    if (!(state.density > 0)) return "";
    const ratio = state.density / LIQUID_DENSITY;
    if (ratio < 0.995) return `Lighter than water: about ${Math.round(ratio * 100)}% of it settles below the surface.`;
    if (ratio > 1.005) return "Heavier than water: it will sink to the floor.";
    return "Neutral: it stays where you put it, which is the hard case.";
  }

  function setPreset(key) {
    if (key === "water") { state.surfaceTension = 0.072; state.viscosity = 0.001; }
    else if (key === "oil") { state.surfaceTension = 0.032; state.viscosity = 0.09; }
    else if (key === "honey") { state.surfaceTension = 0.05; state.viscosity = 0.7; }
    state.preset = key;
    solver.fluid = key;
    solver.params.surfaceTension = state.surfaceTension;
    solver.params.viscosity = state.viscosity;
    renderer.setLook(key, state.field);
    leftRail.setState(state);
  }

  function setBodyPresent(on) {
    state.body = on;
    solver.ball.visible = !!on;
    if (on) {
      solver.ball.r = state.radius;
      solver.ball.density = state.density;
      /* Put it where it can be seen doing something: above the pool, so it
         falls in rather than being planted in the middle. */
      solver.ball.x = solver.width * 0.5;
      solver.ball.z = solver.depth * 0.5;
      solver.ball.y = Math.max(solver.ball.y, solver.surfaceHeight() + solver.ball.r + 0.05);
      solver.ball.vy = 0;
    }
    leftRail.setBodyHint(bodyHint());
  }

  /* ==================================================================================
     THE LAB BENCH
     ================================================================================== */
  const labCard = createLabCard(viewport, { startCollapsed: true });
  const labLauncher = document.getElementById("fluidsLabLauncher");
  const labToggle = document.getElementById("fluidsLabLauncherToggle");
  const labPicker = document.getElementById("fluidsLabPicker");
  const labRows = new Map();

  let labOpen = false;
  function setLabMenu(open) {
    labOpen = open;
    labPicker.classList.toggle("is-open", open);
    labPicker.setAttribute("aria-hidden", String(!open));
    labToggle.setAttribute("aria-expanded", String(open));
    labLauncher.classList.toggle("is-open", open);
  }
  labToggle.addEventListener("click", (e) => { e.stopPropagation(); setLabMenu(!labOpen); });
  document.addEventListener("pointerdown", (e) => {
    if (labOpen && !labLauncher.contains(e.target)) setLabMenu(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && labOpen) setLabMenu(false);
  });

  for (const lab of FLUID_LABS) {
    const row = document.createElement("button");
    row.className = "lab-row";
    row.type = "button";
    const name = document.createElement("span");
    name.className = "lab-row-name";
    name.textContent = lab.name;
    const aim = document.createElement("span");
    aim.className = "lab-row-aim";
    aim.textContent = lab.blurb;
    row.append(name, aim);
    row.addEventListener("click", () => { applyLab(lab.id); setLabMenu(false); });
    labPicker.appendChild(row);
    labRows.set(lab.id, row);
  }

  /* ==================================================================================
     APPLYING A SCENE
     ================================================================================== */

  function adoptSolverParams() {
    state.gravity = solver.params.gravity;
    state.surfaceTension = solver.params.surfaceTension;
    state.viscosity = solver.params.viscosity;
    state.preset = Math.abs(state.viscosity - 0.001) < 1e-9 ? "water"
      : Math.abs(state.viscosity - 0.09) < 1e-9 ? "oil"
        : Math.abs(state.viscosity - 0.7) < 1e-9 ? "honey" : "custom";
    state.body = !!solver.ball.visible;
    if (state.body) {
      state.density = solver.ball.density;
      state.radius = solver.ball.r;
    }
    renderer.setLook(state.preset === "custom" ? "water" : state.preset, state.field);
  }

  function syncLab() {
    const lab = labById(labId);
    labCard.setLab({
      name: lab.name,
      aim: lab.note,
      asks: labAsks(labId),
      setup: labSetup(labId),
      hold: null,
    });
    for (const [id, row] of labRows) row.classList.toggle("on", id === labId);
    rightRail.setLab(lab);
  }

  function labAsks(id) {
    switch (id) {
      case "dam": return [
        "How fast does the front run, against sqrt(g h)?",
        "Turn gravity down: does the column still hold its shape?",
      ];
      case "impact": return [
        "Set surface tension to zero and run it again: what is left of the crown?",
        "Raise the viscosity: where does the crater go?",
      ];
      case "sheet": return [
        "Watch the tip of the sheet: where does it neck, and does the neck close?",
        "Raise the viscosity: does the sheet thin faster, or hold its width?",
      ];
      case "ripple": return [
        "Time five crests at a point and compare with the rail's period.",
        "Set surface tension to zero: which term of the dispersion relation is left?",
      ];
      case "slosh": return [
        "Sweep the shake frequency around 0.62 Hz and find the tallest wave.",
        "Add a body and watch it surf the first mode.",
      ];
      default: return [
        "Move the density through 1000 and watch the submerged fraction cross a half.",
        "Drop it from high up and watch the surface answer.",
      ];
    }
  }

  function labSetup(id) {
    switch (id) {
      case "dam": return "A column 0.34 m wide and 0.56 m tall, on a dry floor.";
      case "impact": return "A 7.5 cm drop, 1.4 m/s downward, into a pool 0.29 m deep.";
      case "sheet": return "A nozzle 10 cm square at the top, feeding at 0.6 m/s for 1.4 s.";
      case "ripple": return "Four wavelengths across 1.2 m, on a pool 0.38 m deep.";
      case "slosh": return "A pool 0.36 m deep in a tank being shaken sideways.";
      default: return "A body of the chosen density, released above the water.";
    }
  }

  function applyLab(id) {
    labId = id;
    /* The rail is part of the scene, so building a scene builds its rail too.
       Everything the last experiment (or the visitor) changed on the left is
       put back to the bench's own starting values first - a reset that leaves
       the body's density, the shake's amplitude or a hand-mixed preset standing
       is not a reset, it is the old experiment wearing a new tank. The lab's
       own numbers are not in here: they come back with the build, which is why
       `adoptSolverParams` runs after it and not before. */
    Object.assign(state, DEFAULT_STATE, { lab: id });
    const lab = labById(id);
    lab.build(solver);
    volumeAtLab = solver.volume();
    solver.time = 0;
    solver.frame = 0;
    solver.measureDensity();
    if (lab.shake) {
      state.shake = true;
      state.shakeAmplitude = lab.shake.amplitude;
      state.shakeFrequency = lab.shake.frequency;
    } else {
      state.shake = false;
    }
    solver.params.bodyAccelX = 0;
    if (state.shake) solver.params.bodyAccelX = state.shakeAmplitude;

    const placed = solver.ball.visible;
    state.body = !!placed;
    if (placed) {
      state.density = solver.ball.density;
      state.radius = solver.ball.r;
    } else {
      solver.ball.visible = false;
    }
    state.field = "surface";
    adoptSolverParams();
    leftRail.setState(state);
    leftRail.setBodyHint(bodyHint());
    renderer.setField(state.field);
    redrawStage();
    syncLab();
    setRunning(false);
    updateReadouts(true);
    markDirty();
  }

  function applyState(next) {
    Object.assign(state, next);
    labId = state.lab;
    labById(labId).build(solver);
    volumeAtLab = solver.volume();
    solver.measureDensity();
    solver.params.gravity = state.gravity;
    solver.params.surfaceTension = state.surfaceTension;
    solver.params.viscosity = state.viscosity;
    solver.params.bodyAccelX = 0;
    solver.fluid = state.preset === "custom" ? "water" : state.preset;
    if (solver.ball.visible) {
      solver.ball.r = state.radius;
      solver.ball.density = state.density;
      state.body = true;
    } else if (state.body && state.bodyPlaced) {
      setBodyPresent(true);
    } else {
      state.body = false;
      solver.ball.visible = false;
    }
    leftRail.setState(state);
    leftRail.setBodyHint(bodyHint());
    renderer.setLook(state.preset === "custom" ? "water" : state.preset, state.field);
    redrawStage();
    syncLab();
    setRunning(false);
    updateReadouts(true);
  }

  function clearBench() {
    applyLab(labId);
    setRunning(false);
  }

  /* Reset and Restart are the same act on this bench - put the lab back the way
     it was built - so both go through `applyLab`, and both therefore clear the
     rail as well as the tank. */

  /* ==================================================================================
     THE READOUTS
     ================================================================================== */
  function updateReadouts(force = false) {
    const dim = solver.dimensionless();
    const vol = solver.volume();
    const b = solver.ball;
    const submerged = b.visible ? solver.submergedFraction() : 0;
    const capillaryLength = Math.sqrt(
      state.surfaceTension / Math.max(1e-9, LIQUID_DENSITY * Math.max(1e-6, state.gravity)),
    );
    const k = (2 * Math.PI * 4) / solver.width;
    const omega2 = Math.max(0, state.gravity) * k
      + (state.surfaceTension * k ** 3) / LIQUID_DENSITY;
    const rippleTheory = omega2 > 0 ? (2 * Math.PI) / Math.sqrt(omega2) : 0;
    const bodyVolume = (4 / 3) * Math.PI * b.r ** 3;

    rightRail.setLive({
      reynolds: dim.reynolds,
      weber: dim.weber,
      ohnesorge: dim.ohnesorge,
      bond: dim.bond,
      volume: vol,
      drift: volumeAtLab > 0 ? (vol - volumeAtLab) / volumeAtLab : 0,
      divergence: solver.densityError(),
      iterations: solver.iterations,
      energy: solver.kineticEnergy(),
      speed: solver.maxSpeed(),
      bodyVisible: b.visible,
      bodyDensity: Math.round(b.density),
      liquidDensity: LIQUID_DENSITY,
      submerged,
      buoyancy: LIQUID_DENSITY * Math.max(0, state.gravity) * bodyVolume * submerged,
      depth: b.y,
      capillaryLength,
      segments: Math.max(
        solver.columnSegments(solver.width * 0.25),
        solver.columnSegments(solver.width * 0.5),
        solver.columnSegments(solver.width * 0.75),
      ),
      rippleTheory: labId === "ripple" ? rippleTheory : 0,
    });

    document.getElementById("fluidsSbFrame").textContent = String(solver.frame);
    document.getElementById("fluidsSbTime").textContent = `${solver.time.toFixed(2)} s`;
    const avg = stepCount ? stepMs / stepCount : 0;
    document.getElementById("fluidsSbRuntime").textContent = `${avg.toFixed(2)} ms`;
    document.getElementById("fluidsSbBody").textContent = b.visible
      ? `${Math.round(b.density)} kg/m³ body`
      : "liquid only";
    if (force) { stepMs = 0; stepCount = 0; }
  }

  /* ==================================================================================
     PAGES - independent tanks
     ================================================================================== */
  let pages = [];
  let activePageId = null;
  let pageIdCounter = 0;
  const pageTabs = document.getElementById("fluidsPagebarTabs");
  const activePage = () => pages.find((p) => p.id === activePageId);

  function makePage() {
    pageIdCounter++;
    return {
      id: `page-${pageIdCounter}`,
      autoNamed: true,
      name: `Page ${pages.filter((p) => p.autoNamed).length + 1}`,
      snapshot: null,
      state: null,
    };
  }

  function saveIntoActivePage() {
    const page = activePage();
    if (!page) return;
    page.snapshot = solver.snapshot();
    page.state = { ...state };
    page.labId = labId;
  }

  function loadPage(id) {
    const page = pages.find((p) => p.id === id);
    if (!page) return;
    if (page.snapshot && solver.restore(page.snapshot)) {
      Object.assign(state, page.state ?? state);
      labId = page.labId ?? state.lab;
      volumeAtLab = solver.volume();
      leftRail.setState(state);
      leftRail.setBodyHint(bodyHint());
      renderer.setLook(state.preset === "custom" ? "water" : state.preset, state.field);
      redrawStage();
      syncLab();
      setRunning(false);
      updateReadouts(true);
    } else if (page.state) {
      applyState(page.state);
    }
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
        input.focus();
        input.select();
        const commit = () => {
          if (input.value.trim()) { page.name = input.value.trim(); page.autoNamed = false; }
          renderPageTabs();
          markDirty();
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
    markDirty();
  }

  function addPage() {
    saveIntoActivePage();
    const page = makePage();
    pages.push(page);
    activePageId = page.id;
    page.snapshot = solver.snapshot();
    page.state = { ...state };
    page.labId = labId;
    renderPageTabs();
    markDirty();
  }

  function closePage(id) {
    if (pages.length <= 1) return;
    const index = pages.findIndex((p) => p.id === id);
    if (index < 0) return;
    pages.splice(index, 1);
    if (activePageId === id) {
      activePageId = pages[Math.min(index, pages.length - 1)].id;
      loadPage(activePageId);
    }
    renderPageTabs();
    markDirty();
  }

  document.getElementById("fluidsAddPageBtn").addEventListener("click", addPage);

  /* ==================================================================================
     THE FILE AND THE SESSION
     ================================================================================== */
  let sessionTimer = null;
  let sessionDirty = false;
  let sessionWrittenAt = 0;

  function markDirty() {
    sessionDirty = true;
    if (sessionTimer !== null) return;
    sessionTimer = setTimeout(saveSession, 250);
  }

  function sessionData() {
    saveIntoActivePage();
    return {
      version: 3,
      state: { ...state },
      labId,
      pages: pages.map((p) => ({ id: p.id, name: p.name, autoNamed: p.autoNamed, state: p.state, labId: p.labId })),
      activePageId,
    };
  }

  function saveSession() {
    if (sessionTimer !== null) { clearTimeout(sessionTimer); sessionTimer = null; }
    if (!sessionDirty) return;
    sessionDirty = false;
    sessionWrittenAt = performance.now();
    try { saveToLocalStorage(SESSION_KEY, sessionData()); } catch (err) { /* no storage, no session */ }
  }

  document.getElementById("fluidsSaveBtn").addEventListener("click", () => {
    saveIntoActivePage();
    downloadJSON("fluids-checkpoint.json", {
      format: "physics-workbench/fluids",
      version: 2,
      state: { ...state },
      labId,
      time: solver.time,
      snapshot: solver.snapshot(),
    });
  });

  document.getElementById("fluidsLoadBtn").addEventListener("click", async () => {
    const data = await uploadJSONFile();
    if (!data || !data.snapshot) return;
    if (solver.restore(data.snapshot)) {
      Object.assign(state, data.state ?? {});
      labId = data.labId ?? state.lab ?? "dam";
      volumeAtLab = solver.volume();
      leftRail.setState(state);
      leftRail.setBodyHint(bodyHint());
      renderer.setLook(state.preset === "custom" ? "water" : state.preset, state.field);
      redrawStage();
      syncLab();
      setRunning(false);
      updateReadouts(true);
      markDirty();
    }
  });

  const sessionNote = document.getElementById("fluidsSessionNote");
  document.getElementById("fluidsSessionDiscardBtn")?.addEventListener("click", () => {
    sessionNote.classList.add("is-hidden");
    try { localStorage.removeItem(SESSION_KEY); } catch (err) { /* nothing to remove */ }
    applyState({ ...DEFAULT_STATE });
    pages = [];
    pageIdCounter = 0;
    const page = makePage();
    pages.push(page);
    activePageId = page.id;
    saveIntoActivePage();
    renderPageTabs();
  });
  document.getElementById("fluidsSessionNoteClose")?.addEventListener("click", () => {
    sessionNote.classList.add("is-hidden");
  });

  /* ==================================================================================
     CONTROLS
     ================================================================================== */
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());

  document.getElementById("fluidsRunBtn").addEventListener("click", () => setRunning(!running));
  document.getElementById("fluidsStepBtn").addEventListener("click", () => {
    setRunning(false);
    advance();
    redrawStage();
    updateReadouts(true);
  });
  document.getElementById("fluidsRestartBtn").addEventListener("click", () => applyLab(labId));
  document.getElementById("fluidsResetBtn").addEventListener("click", clearBench);

  const viewHint = document.getElementById("fluidsStageHint");
  const viewButtons = [...document.querySelectorAll("#fluidsViewToggle button")];
  function setViewMode(mode) {
    const flat = mode === "2d" && twoD;
    viewMode = flat ? "2d" : "3d";

    /* One canvas on screen at a time, and both laid out to the whole stage: two
       canvases sharing the column would show the same tank twice, half size. */
    if (canvas) canvas.classList.toggle("is-hidden", !!flat);
    if (flatCanvas) flatCanvas.classList.toggle("is-hidden", !flat);

    /* The 3D camera still follows the switch, so coming back to it lands where
       it always has; the 2D view frames the tank afresh each time it is
       entered, which is also how it is got back after a pan. */
    renderer.setViewMode(flat ? "2d" : "3d");
    /* Back in three dimensions the canvas has just been laid out again, so its
       drawing buffer is measured afresh before the frame that shows it. */
    if (flat) twoD.fit();
    else renderer.resize();

    if (axisGizmo?.element) axisGizmo.element.style.display = flat ? "none" : "";
    for (const button of viewButtons) {
      const on = button.dataset.mode === (flat ? "2d" : "3d");
      button.classList.toggle("on", on);
      button.setAttribute("aria-pressed", String(on));
    }
    if (viewHint) {
      viewHint.textContent = flat
        ? "Cross-section at mid-depth · drag to pan · scroll to zoom"
        : "Drag to orbit · scroll to zoom";
    }
    redrawStage();
  }
  for (const button of viewButtons) {
    button.addEventListener("click", () => setViewMode(button.dataset.mode));
  }
  for (const button of document.querySelectorAll("#fluidsViewport [data-zoom]")) {
    button.addEventListener("click", () => {
      const factor = button.dataset.zoom === "in" ? 0.88 : 1 / 0.88;
      if (viewMode === "2d" && twoD) twoD.zoom(factor);
      else renderer.controls.zoom(factor);
    });
  }

  /* ==================================================================================
     BOOT
     ================================================================================== */
  applyState({ ...DEFAULT_STATE });

  pages = [];
  activePageId = null;
  pageIdCounter = 0;
  const firstPage = makePage();
  pages.push(firstPage);
  activePageId = firstPage.id;
  saveIntoActivePage();
  renderPageTabs();

  try {
    const saved = loadFromLocalStorage(SESSION_KEY);
    if (saved && saved.state && (saved.version ?? 1) >= 3) {
      applyState({ ...DEFAULT_STATE, ...saved.state });
      if (Array.isArray(saved.pages) && saved.pages.length) {
        pages = saved.pages.map((p) => ({
          id: p.id, name: p.name, autoNamed: !!p.autoNamed, state: p.state, labId: p.labId, snapshot: null,
        }));
        pageIdCounter = pages.length;
        activePageId = saved.activePageId ?? pages[0].id;
        renderPageTabs();
      }
      sessionNote.classList.remove("is-hidden");
    }
  } catch (err) { /* a corrupt session is no session */ }

  const drawers = mountStageDrawers(document.getElementById("fluids"), {
    left: document.getElementById("fluidsLeftRail"),
    right: document.getElementById("fluidsRightRail"),
    labels: { left: "Fluid", right: "Readouts" },
    mountIcon,
  });
  void drawers;

  function resize() {
    twoD?.resize();
    renderer.resize();
    redrawStage();
  }
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(() => resize()).observe(viewport);
  }
  window.addEventListener("resize", resize);
  window.addEventListener("pagehide", saveSession);

  updateReadouts(true);

  function frameLoop() {
    requestAnimationFrame(frameLoop);
    const now = performance.now();
    const elapsed = Math.min(0.05, (now - lastFrameTime) / 1000);
    lastFrameTime = now;
    if (running) {
      accumulator += elapsed;
      let budget = MAX_STEPS_PER_FRAME;
      while (accumulator >= STEP_DT && budget-- > 0) {
        advance();
        accumulator -= STEP_DT;
      }
      if (accumulator > STEP_DT * MAX_STEPS_PER_FRAME) accumulator = 0;
    }
    drawStage();
    if (now - sessionWrittenAt >= SESSION_SAVE_EVERY) saveSession();
    if (solver.frame % 3 === 0) updateReadouts();
  }

  setRunning(false);
  requestAnimationFrame(frameLoop);

  return { solver, renderer, renderer2d: twoD, setViewMode };
}
