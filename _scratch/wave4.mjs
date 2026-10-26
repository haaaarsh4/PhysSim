import { LiquidSolver } from "./solver_cut.mjs";

function surface(s) {
  const h = [];
  for (let i = 0; i < s.nx; i++) {
    let a = 0;
    for (let j = 0; j < s.ny; j++) a += Math.max(0, Math.min(1, 0.5 - s.phi[j * s.nx + i] / s.dx));
    h.push(a * s.dx);
  }
  return h;
}

for (const [iters, tol] of [[90, 1e-4], [300, 1e-6], [800, 1e-10]]) {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0, viscosity: 0.001,
    density: 1000, pressureIterations: iters, pressureTolerance: tol,
  });
  const k = (2 * Math.PI * 4) / s.width;
  const h0 = s.height * 0.42;
  for (let j = 0; j < s.ny; j++) {
    for (let i = 0; i < s.nx; i++) {
      const x = (i + 0.5) * s.dx, y = (j + 0.5) * s.dx;
      s.phi[j * s.nx + i] = Math.max(-s.band, Math.min(s.band, y - (h0 + 0.011 * Math.cos(k * x))));
    }
  }
  s.captureVolume();
  const dt = 1 / 240;
  const row = [];
  let used = 0;
  for (let n = 0; n < 120; n++) {
    s.step(dt);
    used += s.lastSolve.iterations;
    const h = surface(s);
    let re = 0;
    for (let i = 0; i < s.nx; i++) re += (h[i] - h0) * Math.cos(k * (i + 0.5) * s.dx);
    row.push(((2 / s.nx) * re * 1000).toFixed(1));
  }
  console.log(`iters=${iters} tol=${tol} (~${(used / 120).toFixed(0)}/step)  T_theory=0.438`);
  console.log("  " + row.join(" "));
}
