import { LiquidSolver } from "./solver_cut.mjs";

function trace({ g, sigma, secs = 6, label }) {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: g, surfaceTension: sigma,
    viscosity: 0.001, density: 1000, pressureIterations: 150, pressureTolerance: 1e-6,
  });
  const k = (2 * Math.PI * 4) / s.width;
  const h0 = s.height * 0.42;
  for (let j = 0; j < s.ny; j++) {
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * s.dx, y = (j + 0.5) * s.dx;
      s.phi[j * s.nx + i] = Math.max(-s.band, Math.min(s.band, y - (h0 + 0.0108 * Math.cos(k * x))));
    }
  }
  s.captureVolume();
  const dt = 1 / 480;
  const T = [], A = [];
  for (let n = 0; n < Math.round(secs / dt); n++) {
    s.step(dt);
    if (n % 8) continue;               // 60 Hz
    let re = 0;
    for (let i = 0; i < s.nx; i++) re += (s.waterlineAt((i + 0.5) * s.dx) - h0) * Math.cos(k * (i + 0.5) * s.dx);
    T.push(s.time); A.push((2 / s.nx) * re);
  }
  /* local maxima */
  const peaks = [];
  for (let i = 2; i < A.length - 2; i++) {
    if (A[i] > A[i - 1] && A[i] >= A[i + 1] && A[i] > 0) peaks.push([T[i], A[i]]);
  }
  const periods = peaks.slice(1).map((p, i) => p[0] - peaks[i][0]).filter((p) => p > 0.2);
  const mean = periods.reduce((a, b) => a + b, 0) / Math.max(1, periods.length);
  console.log(`${label.padEnd(20)} periods ${periods.map((p) => p.toFixed(2)).join(" ")} -> ${mean.toFixed(2)} s ` +
    `(theory ${((2 * Math.PI) / Math.sqrt(g * k + (sigma * k ** 3) / 1000)).toFixed(2)})`);
  console.log("   amp " + A.filter((_, i) => i % 15 === 0).map((v) => (v * 1000).toFixed(1)).join(" "));
}

trace({ g: 0.4, sigma: 0, label: "g=0.4 no tension" });
trace({ g: 9.81, sigma: 0, label: "g=9.81 no tension" });
trace({ g: 9.81, sigma: 0.072, label: "g=9.81 water" });
