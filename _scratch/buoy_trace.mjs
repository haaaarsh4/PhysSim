import { LiquidSolver } from "../simulation/liquid_solver.js";
for (const density of [480, 700, 980]) {
  const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
    viscosity: 0.001, density: 1000, pressureIterations: 90, pressureTolerance: 1e-4 });
  s.empty(); s.fillBelow(s.height * 0.62);
  const r = 0.066;
  s.ball = { visible: true, x: s.width * 0.5, y: s.height * 0.3, r, vx: 0, vy: 0, density, restitution: 0.12 };
  s.captureVolume();
  const out = [];
  for (let n = 0; n < 120 * 30; n++) {
    s.step(1 / 120);
    if (n % 120 === 0) out.push(`${s.ball.y.toFixed(3)}/${(s.submergedFraction() * 100).toFixed(0)}%`);
  }
  console.log(`${density}: ${out.join(" ")}`);
}
