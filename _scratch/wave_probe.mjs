import { LiquidSolver } from "../simulation/liquid_solver.js";

/* A single Fourier mode of the free surface: measure its period and its
   decay against the linear dispersion relation. */
function mode({ nx = 128, ny = 96, g = 9.81, sigma = 0.072, mu = 0.001, waves = 4, amp = 0.011, secs = 4, iters = 200 }) {
  const s = new LiquidSolver({
    width: 1.2, nx, ny, gravity: g, surfaceTension: sigma, viscosity: mu,
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
    let re = 0, im = 0;
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * s.dx;
      const a = s.waterlineAt(x) - h0;
      re += a * Math.cos(k * x);
      im += a * Math.sin(k * x);
    }
    ts.push(s.time);
    as.push((2 / s.nx) * Math.hypot(re, im));
  }

  /* zero crossings of the cosine projection and the peak envelope */
  const cross = [];
  for (let i = 1; i < as.length; i++) if (as[i - 1] > 0 && as[i] <= 0) cross.push(ts[i]);
  const period = cross.length > 1 ? (2 * (cross[cross.length - 1] - cross[0])) / (cross.length - 1) : NaN;
  const peaks = [];
  for (let i = 1; i < as.length - 1; i++) if (as[i] > as[i - 1] && as[i] >= as[i + 1]) peaks.push([ts[i], as[i]]);
  const decay = peaks.length > 1
    ? Math.log(peaks[0][1] / peaks[peaks.length - 1][1]) / (peaks[peaks.length - 1][0] - peaks[0][0])
    : NaN;

  const w2 = g * k + (sigma * k ** 3) / 1000;
  return {
    dx: s.dx,
    theory: (2 * Math.PI) / Math.sqrt(w2),
    measured: period,
    amp0: amp,
    ampEnd: as[as.length - 1],
    decay,
    idealDecay: 2 * (mu / 1000) * k * k,
    peaks: peaks.map(([t, a]) => `${t.toFixed(2)}s:${(a * 1000).toFixed(1)}mm`).join(" "),
  };
}

const rows = [
  ["gravity only 128", { sigma: 0, g: 9.81 }],
  ["gravity only 256", { sigma: 0, g: 9.81, nx: 256, ny: 192 }],
  ["capillary 128", { sigma: 0.072, g: 0.4 }],
  ["capillary 256", { sigma: 0.072, g: 0.4, nx: 256, ny: 192 }],
  ["water 128", { sigma: 0.072, g: 9.81 }],
  ["water 256", { sigma: 0.072, g: 9.81, nx: 256, ny: 192 }],
];
for (const [label, opts] of rows) {
  const r = mode(opts);
  console.log(
    `${label.padEnd(16)} dx=${(r.dx * 1000).toFixed(1)}mm  T=${r.measured.toFixed(3)} vs ${r.theory.toFixed(3)} ` +
    `(${((r.measured / r.theory - 1) * 100).toFixed(0)}%)  decay ${r.decay.toFixed(3)} vs ${r.idealDecay.toFixed(4)} 1/s  ` +
    `amp ${(r.amp0 * 1000).toFixed(1)}->${(r.ampEnd * 1000).toFixed(1)}mm`,
  );
  console.log(`   peaks ${r.peaks}`);
}
