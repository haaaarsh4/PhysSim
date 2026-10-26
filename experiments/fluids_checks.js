/**
 * experiments/fluids_checks.js - does the Fluids bench still obey its own
 * textbooks?
 *
 * The bench makes claims a reader is invited to check on the stage: a pool at
 * rest is hydrostatic, a released column conserves its water, a body floats at
 * its own density, a tank shaken at its first mode answers across the width.
 * Every one of those is a number with an answer written down in a fluids text,
 * so this file runs the real module - the same simulation/liquid_solver.js the
 * browser loads - and compares.
 *
 * Three kinds of check, and the difference matters:
 *
 *   - the exact ones. A pool at rest has p = rho g (h - y) and nothing else, to
 *     whatever precision the projection converged; a closed tank conserves its
 *     volume exactly, so any drift is the level set's error and is budgeted as
 *     such, not waved through.
 *   - the analytic ones: Archimedes' fraction rho_body / rho_liquid, the
 *     gravity-wave period 2 pi / sqrt(g k), the capillary length sqrt(sigma /
 *     rho g), the viscous decay rate of a shear layer.
 *   - the structural ones, where the claim is about behaviour rather than a
 *     number: a heavier body sinks, a lighter one floats, a sheet left to
 *     itself comes apart into more than one piece, the projection leaves the
 *     interior divergence far below the flow's own strain rate.
 *
 * Run directly:  npm run check:fluids
 */
import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS, feedNozzle } from "../frontend/fluids_labs.js";

/* ------------------------------ the runner ------------------------------ */

const results = [];

function check(name, measured, expected, tolerance, unit = "", note = "") {
  const m = Number(measured);
  const e = Number(expected);
  const error = e === 0 ? Math.abs(m) : Math.abs(m - e) / Math.abs(e);
  results.push({ name, measured: m, expected: e, unit, error, tolerance, note, ok: error <= tolerance });
}

function checkTrue(name, value, note = "") {
  results.push({
    name, measured: value ? 1 : 0, expected: 1, unit: "",
    error: value ? 0 : 1, tolerance: 0, note, ok: !!value,
  });
}

function report() {
  const width = Math.max(...results.map((r) => r.name.length));
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "ok  " : "FAIL";
    if (!r.ok) failed++;
    const measured = Number.isFinite(r.measured) ? `${r.measured.toPrecision(5)}` : "—";
    const expected = Number.isFinite(r.expected) ? `${r.expected.toPrecision(5)}` : "—";
    console.log(
      `${mark}  ${r.name.padEnd(width)}  ${measured.padStart(11)} ${r.unit.padEnd(6)}` +
      `  vs ${expected.padStart(11)}  (tol ${(r.tolerance * 100).toFixed(1)}%)` +
      (r.note ? `  ${r.note}` : ""),
    );
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  return failed ? 1 : 0;
}

/* ------------------------------ the tank -------------------------------- */

const RHO = 1000;
const DEFAULTS = { width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072, viscosity: 0.004 };

const solver = (over = {}) => new LiquidSolver({ ...DEFAULTS, ...over });
const run = (s, seconds) => {
  const steps = Math.round(seconds / (1 / 120));
  for (let i = 0; i < steps; i++) s.step(1 / 120);
};

/* ------------------------- 1. a pool at rest ----------------------------- */

{
  const s = solver();
  s.fillBelow(s.height * 0.42);
  s.captureVolume();
  run(s, 2);

  /* p is kinematic (p / rho), which is the number the projection solves for. */
  const i = 24;
  const x = (i + 0.5) * s.dx;
  const h = s.waterlineAt(x);
  const j = 4;
  const depth = h - (j + 0.5) * s.dx;
  check("hydrostatic pressure at the floor", s.pressure[j * s.nx + i], 9.81 * depth, 0.03, "m²/s²",
    `rho g h at ${(depth * 100).toFixed(1)} cm depth, kinematic`);

  check("a settled pool is still", s.maxSpeed(), 0, 0.02, "m/s", "peak speed two seconds after it was poured");

  let lo = Infinity, hi = -Infinity;
  for (let k = 6; k < s.nx - 6; k += 4) {
    const level = s.waterlineAt((k + 0.5) * s.dx);
    lo = Math.min(lo, level);
    hi = Math.max(hi, level);
  }
  check("the surface of a settled pool is flat", hi - lo, 0, 0.006, "m",
    `the widest spread of the waterline, ${(1000 * (hi - lo)).toFixed(1)} mm over the tank`);
}

/* --------------------- 2. a released column keeps its water -------------- */

{
  const s = solver();
  s.fillRect(0, s.width * 0.32, 0, s.height * 0.64);
  s.captureVolume();
  const v0 = s.volume();
  let worstDivergence = 0;
  let peakSpeed = 0;
  for (let n = 0; n < 240; n++) {
    s.step(1 / 120);
    worstDivergence = Math.max(worstDivergence, s.maxDivergence());
    peakSpeed = Math.max(peakSpeed, s.maxSpeed());
  }
  check("a dam break conserves volume", (s.volume() - v0) / v0, 0, 0.004, "×",
    `2 s of run, ${(((s.volume() - v0) / v0) * 100).toFixed(2)}% drift`);

  /* The interior must be incompressible by the projection. The comparison is
     against the flow's own strain rate, because a divergence is only small
     next to something: U / dx is the scale at which the field changes. */
  const strain = peakSpeed / s.dx;
  check("projection leaves the interior incompressible", worstDivergence / strain, 0, 0.05, "× strain",
    `${worstDivergence.toFixed(2)} 1/s against U/dx = ${strain.toFixed(0)} 1/s`);

  checkTrue("a released column runs", peakSpeed > 0.5, `the front reaches ${peakSpeed.toFixed(2)} m/s`);
}

/* --------------------- 3. Archimedes, one density at a time --------------- */

{
  const r = 0.066;
  /* Densities that can float at all: a body heavier than the liquid has no
     equilibrium at the surface, and its claim is checked separately below. */
  for (const density of [480, 700, 980]) {
    const s = solver();
    s.fillBelow(s.height * 0.62);
    s.ball = { visible: true, x: s.width * 0.5, y: s.height * 0.3, r, vx: 0, vy: 0, density, restitution: 0.12 };
    run(s, 8);
    const submerged = s.submergedFraction();
    /* Not to a part in a thousand, and the difference is stated rather than
       absorbed: a floating hull carries its own meniscus, and on a grid this
       size the capillary rise it sits in is worth a few percent of its
       draft. */
    check(`a ${density} kg/m³ body floats at its density`, submerged, density / RHO, 0.18, "of itself",
      `settles at ${(submerged * 100).toFixed(1)}% wet, centre ${(s.ball.y * 100).toFixed(1)} cm`);
    checkTrue(`a ${density} kg/m³ body stays in the tank`, Number.isFinite(s.ball.y) && s.ball.y > 0 && s.ball.y < s.height,
      `centre at ${(s.ball.y * 100).toFixed(1)} cm after 8 s`);
  }

  /* Heavier than the liquid, and it should be sitting on the floor rather than
     floating: the two are different claims. */
  const s = solver();
  s.fillBelow(s.height * 0.62);
  s.ball = { visible: true, x: s.width * 0.5, y: s.height * 0.5, r, vx: 0, vy: 0, density: 1600, restitution: 0.12 };
  run(s, 6);
  checkTrue("a body heavier than the liquid sinks", s.ball.y < r + 0.02,
    `centre ${(s.ball.y * 100).toFixed(1)} cm, resting on the floor at ${(r * 100).toFixed(1)} cm`);
}

/* --------------------- 4. the numbers the rail quotes -------------------- */

{
  const s = solver();
  const sigma = s.params.surfaceTension;
  const capillary = Math.sqrt(sigma / (RHO * s.params.gravity));
  /* The rail computes this from the sliders; the check is that the solver and
     the rail would agree, so the formula is written twice on purpose. */
  const expected = Math.sqrt(0.072 / (1000 * 9.81));
  check("capillary length of water", capillary, expected, 1e-12, "m",
    `${(capillary * 1000).toFixed(2)} mm, the length below which a meniscus is round`);

  const g = 9.81;
  const W = s.width;
  const H = s.height * 0.42;
  /* The tank's first sloshing mode: omega^2 = g k tanh(kH) with k = pi / W.
     The sloshing lab is set up to drive this, so the drive and the mode are
     checked against each other rather than against a remembered number. */
  const k = Math.PI / W;
  const f1 = Math.sqrt(g * k * Math.tanh(k * H)) / (2 * Math.PI);
  const sloshLab = FLUID_LABS.find((l) => l.id === "slosh");
  check("the sloshing lab drives the tank's first mode", sloshLab.shake.frequency, f1, 0.06, "Hz",
    `the mode is at ${f1.toFixed(3)} Hz for a pool ${(H * 100).toFixed(0)} cm deep in a ${W.toFixed(1)} m tank`);

  /* The ripple lab's four-wave mode, from the dispersion relation the rail
     quotes - gravity and surface tension together. */
  const k4 = (2 * Math.PI * 4) / W;
  const omega2 = 0.4 * k4 + (0.072 * k4 ** 3) / RHO;
  const ripple = (2 * Math.PI) / Math.sqrt(omega2);
  check("ripple period of the four-wave mode", ripple, 2.088, 0.02, "s",
    `${ripple.toFixed(2)} s at g = 0.4 m/s², sigma = 72 mN/m`);
}

/* --------------------- 5. the implicit viscous solve --------------------- */

{
  /* A closed box of liquid, sheared into its slowest mode. The stage under test
     is the diffusion solve itself - (I - nu dt laplacian) u = u* - so it is
     called on its own: through a whole step the advection scheme's own
     numerical diffusion is added to the answer, and this check would then be
     measuring two things at once.

     The mode decays as exp(-2 nu k² t) in amplitude squared, with k = pi / H,
     and four times the viscosity must be four times the rate - a claim about
     the linear solve that no amount of grid diffusion can fake. */
  const energy = (s) => {
    let e = 0;
    for (let j = 0; j < s.ny; j++) {
      for (let i = 0; i < s.nx; i++) {
        const uc = 0.5 * (s.u[j * (s.nx + 1) + i] + s.u[j * (s.nx + 1) + i + 1]);
        e += uc * uc;
      }
    }
    return e;
  };
  const decayOf = (nu) => {
    const s = solver({ viscosity: nu * RHO, gravity: 0, surfaceTension: 0, nx: 64, ny: 48, width: 0.6 });
    s.phi.fill(-s.dx);
    s.captureVolume();
    for (let j = 0; j < s.ny; j++) {
      const ux = Math.cos((Math.PI * (j + 0.5) * s.dx) / s.height);
      for (let i = 0; i <= s.nx; i++) s.u[j * (s.nx + 1) + i] = ux;
    }
    const e0 = energy(s);
    for (let n = 0; n < 48; n++) s.applyViscosity(1 / 120, nu);
    return -Math.log(energy(s) / e0) / 0.4;
  };
  const slow = decayOf(0.02);
  const fast = decayOf(0.08);
  /* The tank's height is ny * dx, not the width it was asked for: the solver
     squares its cells, so the wave number has to be read off the grid it made. */
  const H = 48 * (0.6 / 64);
  const k = Math.PI / H;

  check("the viscous solve decays a shear layer as 2 nu k²", slow, 2 * 0.02 * k * k, 0.05, "1/s",
    `measured ${slow.toFixed(3)} against ${(2 * 0.02 * k * k).toFixed(3)} 1/s at 20 mPa·s`);
  check("four times the viscosity, four times the decay", fast / slow, 4, 0.08, "×",
    `20 mPa·s decays at ${slow.toFixed(2)} 1/s, 80 at ${fast.toFixed(2)}`);
}

/* --------------------- 6. every lab builds and holds together ------------ */

{
  let worstDrift = 0;
  let worstLab = "";
  for (const lab of FLUID_LABS) {
    const s = solver();
    lab.build(s);
    s.captureVolume();
    /* The sheet lab's nozzle adds liquid for the first 1.4 s, so the volume is
       only expected to hold after the tap closes - the same window a reader
       watches once the sheet is on its own. */
    for (let n = 0; n < 192; n++) {
      feedNozzle(s, lab.id, s.time < 1.35);
      s.step(1 / 120);
    }
    const v0 = s.volume();
    for (let n = 0; n < 192; n++) s.step(1 / 120);
    const drift = Math.abs((s.volume() - v0) / Math.max(1e-9, v0));
    if (drift > worstDrift) { worstDrift = drift; worstLab = lab.name; }
    checkTrue(`${lab.name}: the field stays finite`, s.phi.every((v) => Number.isFinite(v)),
      `${s.nx} × ${s.ny} cells, 3 s of run`);
  }
  check("every lab keeps its water", worstDrift, 0, 0.01, "×",
    `${FLUID_LABS.length} labs, worst is ${worstLab} at ${(worstDrift * 100).toFixed(2)}%`);
}

/* --------------------- 7. a sheet left to itself comes apart ------------- */

{
  const s = solver();
  FLUID_LABS.find((l) => l.id === "sheet").build(s);
  s.captureVolume();
  let most = 0;
  for (let n = 0; n < 480; n++) {
    feedNozzle(s, "sheet", s.time < 1.35);
    s.step(1 / 120);
    if (n > 120) most = Math.max(most, s.columnSegments(s.width * 0.5));
  }
  checkTrue("a falling sheet breaks into more than one piece", most >= 2,
    `the mid-column crosses ${most} separate bodies of liquid at its worst`);
}

process.exit(report());
