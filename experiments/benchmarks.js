/**
 * experiments/benchmarks.js - timing a solver honestly.
 *
 * benchmarkFluidSolver runs a fixed number of real fluid-solver steps
 * and reports actual wall-clock statistics (mean/median/p95) plus the
 * pressure solver's own iteration count and residual - a genuine
 * "Solver A vs Solver B" comparison, produced by actually running both,
 * not hand-typed numbers.
 *
 * Run directly:  npm run bench
 */
import { SimulationState } from "../simulation/simulation_state.js";
import { FluidSolver } from "../simulation/fluid_solver.js";
import { JacobiSolver } from "../solvers/jacobi.js";
import { ConjugateGradientSolver } from "../solvers/conjugate_gradient.js";

export function benchmarkFluidSolver(fluidSolver, state, nSteps = 100, warmup = 5) {
  for (let i = 0; i < warmup; i++) fluidSolver.step(state);

  const timesMs = [];
  let lastInfo = null;
  for (let i = 0; i < nSteps; i++) {
    const t0 = performance.now();
    lastInfo = fluidSolver.step(state);
    timesMs.push(performance.now() - t0);
  }
  timesMs.sort((a, b) => a - b);

  const mean = timesMs.reduce((a, b) => a + b, 0) / timesMs.length;
  return {
    solver: fluidSolver.pressureSolver.name,
    nSteps,
    meanMs: mean,
    medianMs: timesMs[Math.floor(timesMs.length / 2)],
    p95Ms: timesMs[Math.floor(0.95 * timesMs.length) - 1] ?? timesMs.at(-1),
    minMs: timesMs[0],
    maxMs: timesMs.at(-1),
    lastPressureIterations: lastInfo?.iterations ?? null,
    lastResidual: lastInfo?.residuals?.at(-1) ?? null,
  };
}

/** Same idea for the particle system's physics step (integration +
 * collision resolution), which has no "solver" to swap but still
 * benefits from a real timing breakdown as ball count grows. */
export function benchmarkParticleStep(stepFn, nSteps = 100, warmup = 5) {
  for (let i = 0; i < warmup; i++) stepFn();
  const timesMs = [];
  for (let i = 0; i < nSteps; i++) {
    const t0 = performance.now();
    stepFn();
    timesMs.push(performance.now() - t0);
  }
  timesMs.sort((a, b) => a - b);
  const mean = timesMs.reduce((a, b) => a + b, 0) / timesMs.length;
  return {
    nSteps, meanMs: mean,
    medianMs: timesMs[Math.floor(timesMs.length / 2)],
    p95Ms: timesMs[Math.floor(0.95 * timesMs.length) - 1] ?? timesMs.at(-1),
    minMs: timesMs[0], maxMs: timesMs.at(-1),
  };
}

function buildSeededState(resolution, dt) {
  const state = new SimulationState(resolution, resolution, 1 / resolution, dt);
  const cx = 0.5, cy = 0.25;
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      const wx = x / resolution, wy = y / resolution;
      const d2 = (wx - cx) ** 2 + (wy - cy) ** 2;
      const falloff = Math.exp(-d2 / (2 * 0.02 ** 2));
      const idx = y * resolution + x;
      state.v[idx] += 8 * falloff;
      state.dye[idx * 3 + 0] += 0.9 * falloff;
      state.dye[idx * 3 + 2] += 0.6 * falloff;
    }
  }
  return state;
}

async function main() {
  console.log("Benchmarking pressure solvers on a 64x64 grid, 60 steps each...\n");
  for (const Solver of [JacobiSolver, ConjugateGradientSolver]) {
    const state = buildSeededState(64, 0.016);
    const fluid = new FluidSolver(new Solver(), { pressureIters: 40 });
    const result = benchmarkFluidSolver(fluid, state, 60);
    console.log(result.solver);
    for (const [k, v] of Object.entries(result)) if (k !== "solver") console.log(`  ${k}: ${v}`);
    console.log();
  }
}

// Only run when invoked directly (`node experiments/benchmarks.js`), not on import.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
