import { LiquidSolver } from "./solver_cut.mjs";

function surface(s) {
  /* Liquid fraction per column, sub-cell, from the level set: robust to the
     exact cell the interface lands in. */
  const h = [];
  for (let i = 0; i < s.nx; i++) {
    let a = 0;
    for (let j = 0; j < s.ny; j++) {
      const p = s.phi[j * s.nx + i];
      a += Math.max(0, Math.min(1, 0.5 - p / s.dx));
    }
    h.push(a * s.dx);
  }
  return h;
}

function run({ nx = 128, ny = 96, g = 9.81, sigma = 0.072, waves = 4, amp = 0.011, secs = 3, iters = 200, label }) {
  const s = new LiquidSolver({
    width: 1.2, nx, ny, gravity: g, surfaceTension: sigma, viscosity: 0.001,
    density: 1000, pressureIterations: iters, pressureTolerance: 1e-6,
  });
  const k = (2 * Math.PI * waves) / s.width;
  const h0 = s.height * 0.42;
  for (let j = 0; j < s.ny; j++) {
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * s.dx, y = (j + 0.5) * s.dx;
      s.phi[j * s.nx + i] = Math.max(-s.band, Math.min(s.band, y - (h0 + amp * Math.cos(k * x))));
    }
  }
  s.captureVolume();
  const dt = 1 / 240;
  const ts = [], as = [];
  for (let n = 0; n < Math.round(secs / dt); n++) {
    s.step(dt);
    if (n % 4) continue;
    const h = surface(s);
    let re = 0;
    for (let i = 0; i < s.nx; i++) re += (h[i] - h0) * Math.cos(k * (i + 0.5) * s.dx);
    ts.push(s.time); as.push((2 / s.nx) * re);
  }
  const cross = [];
  for (let i = 1; i < as.length; i++) if (as[i - 1] > 0 && as[i] <= 0) cross.push(ts[i]);
  const period = cross.length > 1 ? (2 * (cross[cross.length - 1] - cross[0])) / (cross.length - 1) : NaN;
  const w2 = g * k + (sigma * k ** 3) / 1000;
  console.log(`${label.padEnd(18)} T=${Number.isFinite(period) ? period.toFixed(3) : "  ---"} vs ${((2 * Math.PI) / Math.sqrt(w2)).toFixed(3)}  crossings ${cross.length}  ` +
    `a(t): ${as.filter((_, i) => i % 8 === 0).map((v) => (v * 1000).toFixed(1)).join(" ")}`);
  return { s, h0, k };
}

const a = run({ sigma: 0, label: "gravity 4-wave" });
const b = run({ sigma: 0, waves: 12, label: "gravity 12-wave" });
run({ g: 0.4, sigma: 0.072, label: "capillary 4-wave" });
run({ g: 9.81, sigma: 0.072, waves: 12, label: "water 12-wave" });

/* the shape, in mm above the mean, across the tank */
for (const [name, { s, h0 }] of [["gravity 4-wave", a], ["gravity 12-wave", b]]) {
  console.log(`\n${name} profile (mm) at t=${s.time.toFixed(2)}:`);
  const h = surface(s);
  console.log(h.filter((_, i) => i % 4 === 0).map((v) => ((v - h0) * 1000).toFixed(1).padStart(6)).join(""));
}
