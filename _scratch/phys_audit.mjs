import { LiquidSolver } from "../simulation/liquid_solver.js";
import { FLUID_LABS, feedNozzle } from "../frontend/fluids_labs.js";

const lab = (id) => FLUID_LABS.find((l) => l.id === id);

function profile(s, n = 24) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const x = ((k + 0.5) / n) * s.width;
    out.push(s.waterlineAt(x));
  }
  return out;
}

function fmt(arr, scale = 1) {
  return arr.map((v) => (v * scale).toFixed(1).padStart(6)).join("");
}

/* ---------------- 1. dam break ---------------- */
function dam(iters, tol, dt) {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000,
    pressureIterations: iters, pressureTolerance: tol,
  });
  lab("dam").build(s);
  s.captureVolume();
  const marks = [0.05, 0.1, 0.2, 0.4, 0.8, 1.5, 3, 6];
  let m = 0;
  let worstDiv = 0;
  let itersUsed = 0;
  console.log(`\n== dam  iters=${iters} tol=${tol} dt=${dt.toFixed(4)} (cm waterline)`);
  while (m < marks.length) {
    const target = marks[m];
    while (s.time < target - 1e-9) {
      s.step(dt);
      worstDiv = Math.max(worstDiv, s.maxDivergence());
      itersUsed += s.lastSolve.iterations;
    }
    console.log(
      `t=${s.time.toFixed(2)}  U=${s.maxSpeed().toFixed(2)}  ` +
      `div=${s.maxDivergence().toFixed(1)}  ~it=${(itersUsed / Math.max(1, s.frame)).toFixed(0)}  ` +
      fmt(profile(s), 100),
    );
    m++;
  }
  console.log(`worst div ${worstDiv.toFixed(1)} 1/s, U/dx ${(s.maxSpeed() / s.dx).toFixed(0)}`);
}

const which = process.argv[2] ?? "dam";
if (which === "dam") {
  dam(30, 2e-3, 1 / 120);
  dam(300, 1e-6, 1 / 120);
  dam(300, 1e-6, 1 / 480);
}

/* ---------------- 2. pool at rest ---------------- */
if (which === "rest") {
  for (const [iters, tol] of [[30, 2e-3], [300, 1e-6]]) {
    const s = new LiquidSolver({
      width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
      viscosity: 0.001, density: 1000, pressureIterations: iters, pressureTolerance: tol,
    });
    lab("slosh").build(s);
    s.captureVolume();
    for (let n = 0; n < 240; n++) s.step(1 / 120);
    console.log(`rest it=${iters}: t=${s.time.toFixed(2)} U=${s.maxSpeed().toFixed(4)} ` +
      `spread=${((Math.max(...profile(s)) - Math.min(...profile(s))) * 1000).toFixed(2)}mm ` +
      `KE=${s.kineticEnergy().toExponential(2)}`);
    console.log("  " + fmt(profile(s), 1000));
  }
}

/* ---------------- 3. slosh resonance ---------------- */
if (which === "slosh") {
  for (const [freq, label] of [[0.7, "resonance"], [0.35, "half"], [1.4, "double"]]) {
    const s = new LiquidSolver({
      width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
      viscosity: 0.001, density: 1000, pressureIterations: 200, pressureTolerance: 1e-5,
    });
    lab("slosh").build(s);
    s.captureVolume();
    const dt = 1 / 120;
    let peak = 0;
    for (let n = 0; n < Math.round(6 / dt); n++) {
      s.params.bodyAccelX = 2.4 * s.params.gravity === 0 ? 0 : 2.4 * Math.sin(2 * Math.PI * freq * s.time);
      s.step(dt);
      if (n > 120) peak = Math.max(peak, Math.abs(s.waterlineAt(s.width * 0.06) - s.waterlineAt(s.width * 0.94)));
    }
    console.log(`slosh ${freq}Hz (${label}): peak end-to-end ${(peak * 100).toFixed(1)} cm`);
  }
}

/* ---------------- 4. ripple period ---------------- */
if (which === "ripple") {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: 0.4, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 200, pressureTolerance: 1e-5,
  });
  lab("ripple").build(s);
  s.captureVolume();
  const dt = 1 / 120;
  const h = [];
  for (let n = 0; n < Math.round(4 / dt); n++) {
    s.step(dt);
    h.push(s.waterlineAt(s.dx * 0.5) - s.height * 0.42);
  }
  /* zero crossings */
  const cross = [];
  for (let i = 1; i < h.length; i++) if (h[i - 1] > 0 && h[i] <= 0) cross.push(i * dt);
  const periods = cross.slice(1).map((t, i) => t - cross[i]);
  console.log(`ripple: crossings ${cross.length}, mean period ${(periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length)).toFixed(3)} s vs theory 2.088 s`);
  console.log(`  crest amplitude ${(Math.max(...h) * 1000).toFixed(2)} mm -> ${(h[h.length - 1] * 1000).toFixed(2)} mm`);
}

/* ---------------- 5. buoyancy ---------------- */
if (which === "buoy") {
  for (const density of [480, 700, 980]) {
    const s = new LiquidSolver({
      width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
      viscosity: 0.001, density: 1000, pressureIterations: 200, pressureTolerance: 1e-5,
    });
    lab("buoyancy").build(s);
    s.ball.density = density;
    s.captureVolume();
    const dt = 1 / 120;
    const trace = [];
    for (let n = 0; n < Math.round(8 / dt); n++) {
      s.step(dt);
      if (n % 120 === 0) trace.push(s.ball.y.toFixed(3));
    }
    console.log(`buoy ${density}: submerged ${(s.submergedFraction() * 100).toFixed(1)}% vs ${(density / 10).toFixed(0)}%  y trace ${trace.join(" ")}`);
  }
}

/* ---------------- 6. drop impact ---------------- */
if (which === "impact") {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 200, pressureTolerance: 1e-5,
  });
  lab("impact").build(s);
  s.captureVolume();
  const dt = 1 / 120;
  let crown = 0;
  for (let n = 0; n < Math.round(1.2 / dt); n++) {
    s.step(dt);
    const p = profile(s, 32);
    crown = Math.max(crown, Math.max(...p) - s.height * 0.34);
    if (n % 12 === 0) console.log(`t=${s.time.toFixed(2)} ` + fmt(p, 100));
  }
  console.log(`impact: tallest rise ${(crown * 100).toFixed(1)} cm`);
}

/* ---------------- 7. phase: does the ball float AT the surface ---------------- */
if (which === "ball") {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 200, pressureTolerance: 1e-5,
  });
  lab("buoyancy").build(s);
  s.captureVolume();
  for (let n = 0; n < 240; n++) s.step(1 / 120);
  console.log(`ball y=${s.ball.y.toFixed(3)} r=${s.ball.r.toFixed(3)} waterline=${s.waterlineAt(s.width * 0.5).toFixed(3)} ` +
    `sub=${s.submergedFraction().toFixed(3)}`);
  console.log(fmt(profile(s, 30), 100));
}
