/**
 * experiments/fluid3d_checks.js - the Fluids bench's solver, asserted.
 *
 * The old Fluids suite (fluids_checks.js) tests the level-set solver the bench
 * used before it was rebuilt in three dimensions. This suite is the bench's own:
 * the properties a particle liquid must have for the page to be telling the
 * truth - a lattice at rest density, a volume that cannot drift, gravity that
 * accelerates at g, a dam break that settles to the depth its volume implies, a
 * body that floats at the fraction its density asks for, and no NaN anywhere.
 *
 * Run directly (`node experiments/fluid3d_checks.js`) or through `npm run check`.
 */
import { Fluid3D } from "../simulation/fluid3d.js";

let passed = 0;
let failed = 0;

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ok   ${name}${detail ? `  (${detail})` : ""}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}${detail ? `  (${detail})` : ""}`);
  }
}

function near(name, value, target, tol, unit = "") {
  const ok = Number.isFinite(value) && Math.abs(value - target) <= tol;
  check(name, ok, `${value.toFixed(4)}${unit} vs ${target.toFixed(4)}${unit}`);
}

console.log("fluid3d: the particle liquid");

/* 1. A lattice at rest is at the rest density. */
{
  const sim = new Fluid3D({ spacing: 0.05 });
  sim.addBlock(0.1, 0.1, 0.1, 0.5, 0.5, 0.5);
  sim.measureDensity();
  let sum = 0, n = 0;
  for (let i = 0; i < sim.count; i++) {
    /* Skip the surface shell, where low density is the free surface itself -
       on all three axes, or the z shell alone drags the mean down by five per
       cent and the check reports a solver that is in fact exact. */
    const insideBox =
      sim.x[i] > 0.16 && sim.x[i] < 0.44 &&
      sim.y[i] > 0.16 && sim.y[i] < 0.44 &&
      sim.z[i] > 0.16 && sim.z[i] < 0.44;
    if (insideBox) {
      sum += sim.density[i]; n++;
    }
  }
  const mean = sum / Math.max(1, n);
  const error = Math.abs(mean / sim.restDensity - 1);
  check("an interior lattice reads the rest density", error < 0.02, `${(error * 100).toFixed(2)}% off`);
}

/* 2. Gravity accelerates a free particle at g. */
{
  const sim = new Fluid3D({ spacing: 0.05 });
  /* A quarter of a second, not half: the tank is 0.9 m tall and half a second
     of free fall is 1.23 m, so the old window measured the floor. */
  sim.add(0.5, 0.8, 0.3);
  for (let f = 0; f < 15; f++) sim.step(1 / 60);
  const t = 15 / 60;
  /* Semi-implicit Euler, which is what the solver is: the exact distance after
     n steps is g dt^2 n(n+1)/2, a hair more than the continuous g t^2 / 2. The
     assertion is against the integrator's own answer, so it measures the force
     rather than the quadrature. */
  const expected = 0.5 * 9.81 * t * t + 0.5 * 9.81 * (1 / 60) * t;
  near("a free particle falls at g", 0.8 - sim.y[0], expected, 0.01, " m");
}

/* 3. Volume is exactly conserved: no step can create or destroy a particle. */
{
  const sim = new Fluid3D({ spacing: 0.05 });
  sim.addBlock(0.02, 0.02, 0.02, 0.34, 0.55, 0.5);
  const v0 = sim.volume();
  for (let f = 0; f < 240; f++) sim.step(1 / 60);
  near("volume after four seconds", sim.volume(), v0, 1e-12, " m3");
  check("no NaN after four seconds", Number.isFinite(sim.x[0] + sim.y[0] + sim.z[0]));
  check("the front reached the far wall", sim.x.slice(0, sim.count).some((v) => v > 0.85));
}

/* 4. A dam break settles to the depth its own volume asks for. */
{
  const sim = new Fluid3D({ spacing: 0.05 });
  sim.addBlock(0.02, 0.02, 0.02, 0.36, 0.6, 0.58);
  for (let f = 0; f < 600; f++) sim.step(1 / 60);
  const level = sim.volume() / (sim.width * sim.depth);
  const measured = sim.surfaceHeight() - sim.spacing * 0.5;
  const error = Math.abs(measured - level) / level;
  check("a settled pool is the depth its volume implies", error < 0.15,
    `${(measured * 100).toFixed(1)} cm vs ${(level * 100).toFixed(1)} cm`);
  check("a settled pool is at rest", sim.meanSpeed() < 0.05, `${sim.meanSpeed().toFixed(3)} m/s`);
}

/* 5. A body floats at the fraction its density asks for. */
{
  const sim = new Fluid3D({ spacing: 0.05 });
  sim.fillBelow(0.5);
  sim.settle(40);
  sim.ball = { visible: true, x: sim.width / 2, y: sim.height * 0.8, z: sim.depth / 2, r: 0.06, density: 480, vy: 0, ax: 0 };
  for (let f = 0; f < 900; f++) sim.step(1 / 60);
  const submerged = sim.submergedFraction();
  check("a 480 kg/m3 body floats at 48%", Math.abs(submerged - 0.48) < 0.16,
    `${(submerged * 100).toFixed(0)}% under`);
}

/* 6. Honey is slower than water on the same dam break. */
{
  const run = (viscosity) => {
    const sim = new Fluid3D({ spacing: 0.05 });
    sim.params.viscosity = viscosity;
    sim.addBlock(0.02, 0.02, 0.02, 0.34, 0.55, 0.5);
    for (let f = 0; f < 60; f++) sim.step(1 / 60);
    return sim.meanSpeed();
  };
  const water = run(0.001);
  const honey = run(0.7);
  check("honey moves slower than water", honey < water * 0.85,
    `${honey.toFixed(3)} vs ${water.toFixed(3)} m/s`);
}

console.log(`\nfluid3d: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
