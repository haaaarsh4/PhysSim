import { LiquidSolver } from "../simulation/liquid_solver.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 0, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 40, pressureTolerance: 2e-3 });
s.empty();
const cx = s.width * 0.5, cy = s.height * 0.5, R = 0.075;
s.fillEllipse(cx, cy, R * 1.28, R * 0.82);
s.captureVolume();
const dt = 1 / 240;
const out = [];
for (let n = 0; n < Math.round(8 / dt); n++) {
  s.step(dt);
  if (n % 24 === 0) {
    /* aspect ratio of the drop: width over height of the liquid bounding box */
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
      if (s.phi[j*s.nx+i] >= 0) continue;
      const x = (i+0.5)*s.dx, y = (j+0.5)*s.dx;
      x0 = Math.min(x0,x); x1 = Math.max(x1,x); y0 = Math.min(y0,y); y1 = Math.max(y1,y);
    }
    out.push((x1-x0)/(y1-y0));
  }
}
console.log(`aspect w/h every 0.1s: ${out.map(v => v.toFixed(2)).join(" ")}`);
console.log(`theory: omega^2 = sigma n(n^2-1)/(rho R^3), n=2 -> T=${(2*Math.PI/Math.sqrt(0.072*6/(1000*0.075**3))).toFixed(2)} s`);
