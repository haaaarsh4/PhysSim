import { LiquidSolver } from "../simulation/liquid_solver.js";
const s = new LiquidSolver({ width: 1.2, nx: 128, ny: 96, gravity: 9.81, surfaceTension: 0.072,
  viscosity: 0.001, density: 1000, pressureIterations: 60, pressureTolerance: 1e-4 });
s.empty();
s.addCircle(s.width * 0.52, s.height * 0.82, 0.075);
for (let j = 0; j < s.ny; j++) for (let i = 0; i < s.nx; i++) {
  if (s.phi[j*s.nx+i] >= 0) continue;
  const x = (i+0.5)*s.dx, y = (j+0.5)*s.dx;
  if (Math.hypot(x - s.width*0.52, y - s.height*0.82) > 0.075) continue;
  s.v[j*s.nx+i] -= 1.4;
}
s.captureVolume();
const com = () => { const c = s.centreOfMass(); return c.y; };
for (let n = 0; n < 60; n++) {
  s.step(1/240);
  if (n % 6 === 0) console.log(`t=${s.time.toFixed(3)} U=${s.maxSpeed().toFixed(3)} KE=${s.kineticEnergy().toFixed(3)} comY=${com().toFixed(3)} cells=${s.centreOfMass().cells} vol=${s.volume().toFixed(5)}`);
}
