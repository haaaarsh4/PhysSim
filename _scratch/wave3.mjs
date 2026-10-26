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

function trial({ label, g = 9.81, sigma = 0, skip = [], iters = 200, secs = 0.5 }) {
  const s = new LiquidSolver({
    width: 1.2, nx: 128, ny: 96, gravity: g, surfaceTension: sigma, viscosity: 0.001,
    density: 1000, pressureIterations: iters, pressureTolerance: 1e-6,
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

  if (skip.includes("tension")) s.applySurfaceTension = () => {};
  if (skip.includes("viscosity")) { const f = s.applyViscosity; s.applyViscosity = () => {}; }
  if (skip.includes("redistance")) s.redistance = () => {};
  if (skip.includes("volume")) s.correctVolume = () => {};
  if (skip.includes("gravity")) s.applyGravity = () => {};
  if (skip.includes("project")) s.project = () => {};
  if (skip.includes("phiadvect")) {
    const orig = s.advect.bind(s);
    s.advect = function (dt) {
      const phi0 = this.phi;
      orig(dt);
      this.phi = phi0;
    };
  }

  const dt = 1 / 240;
  const amps = [];
  for (let n = 0; n < Math.round(secs / dt); n++) {
    s.step(dt);
    if (n % 6) continue;
    const h = surface(s);
    let re = 0;
    for (let i = 0; i < s.nx; i++) re += (h[i] - h0) * Math.cos(k * (i + 0.5) * s.dx);
    amps.push((2 / s.nx) * re);
  }
  const h = surface(s);
  const rough = h.filter((_, i) => i % 4 === 0).map((v) => ((v - h0) * 1000));
  const rms = Math.sqrt(rough.reduce((a, v) => a + v * v, 0) / rough.length);
  console.log(`${label.padEnd(26)} a(t)=${amps.map((v) => (v * 1000).toFixed(1).padStart(6)).join("")}  rms=${rms.toFixed(2)}mm`);
}

console.log("t = 0 0.025 0.05 ... 0.5 s, mode amplitude in mm\n");
trial({ label: "full" });
trial({ label: "no surface tension", sigma: 0 });
trial({ label: "no viscosity", skip: ["viscosity"] });
trial({ label: "no redistance", skip: ["redistance"] });
trial({ label: "no volume correction", skip: ["volume"] });
trial({ label: "no gravity", skip: ["gravity"] });
trial({ label: "no projection", skip: ["project"] });
trial({ label: "no phi advection", skip: ["phiadvect"] });
trial({ label: "gravity+visc only", skip: ["phiadvect", "redistance", "volume"] });
trial({ label: "everything off but advect", skip: ["gravity", "project", "tension", "viscosity", "redistance", "volume"] });
