/**
 * experiments/parameter_sweep.js - automated exploration of the
 * resolution / solver / timestep tradeoff space.
 *
 * The "Configuration / Runtime / Error" table: given lists of
 * resolutions, solver names, and timesteps, runs every combination for a
 * fixed number of steps from the same initial conditions, and records
 * real runtime plus a real accuracy proxy (the final divergence
 * residual). Results are written to storage/experiment_results/ as JSON.
 *
 * Run directly:  npm run sweep
 */
import { SimulationState } from "../simulation/simulation_state.js";
import { FluidSolver } from "../simulation/fluid_solver.js";
import { JacobiSolver } from "../solvers/jacobi.js";
import { ConjugateGradientSolver } from "../solvers/conjugate_gradient.js";
import { saveJSON } from "../storage/io.node.js";

const SOLVER_REGISTRY = { jacobi: JacobiSolver, conjugate_gradient: ConjugateGradientSolver };

function buildState(resolution, dt) {
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

export async function runParameterSweep({
  resolutions = [32, 64, 128],
  solverNames = ["jacobi", "conjugate_gradient"],
  timesteps = [0.016],
  nSteps = 60,
  pressureIters = 40,
  saveAs = "sweep_results",
} = {}) {
  const results = [];

  for (const resolution of resolutions) {
    for (const solverName of solverNames) {
      for (const dt of timesteps) {
        const state = buildState(resolution, dt);
        const pressureSolver = new SOLVER_REGISTRY[solverName]();
        const fluidSolver = new FluidSolver(pressureSolver, { pressureIters });

        const t0 = performance.now();
        let lastInfo = null;
        for (let i = 0; i < nSteps; i++) lastInfo = fluidSolver.step(state);
        const elapsedMs = performance.now() - t0;

        results.push({
          resolution, solver: solverName, dt, nSteps,
          totalMs: elapsedMs,
          msPerStep: elapsedMs / nSteps,
          finalDivergenceResidual: lastInfo?.residuals?.at(-1) ?? null,
          pressureIterationsLastStep: lastInfo?.iterations ?? null,
        });
      }
    }
  }

  if (saveAs) {
    const path = await saveJSON(`storage/experiment_results/${saveAs}.json`, results);
    console.log(`\nwrote ${results.length} results to ${path}`);
  }
  return results;
}

export function printResultsTable(results) {
  const header = `${"resolution".padStart(10)} ${"solver".padStart(18)} ${"dt".padStart(8)} ${"ms/step".padStart(9)} ${"residual".padStart(10)} ${"iters".padStart(6)}`;
  console.log(header);
  console.log("-".repeat(header.length));
  for (const r of results) {
    console.log(
      `${String(r.resolution).padStart(10)} ${r.solver.padStart(18)} ${r.dt.toFixed(4).padStart(8)} ` +
      `${r.msPerStep.toFixed(3).padStart(9)} ${r.finalDivergenceResidual.toExponential(2).padStart(10)} ` +
      `${String(r.pressureIterationsLastStep).padStart(6)}`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const results = await runParameterSweep({ resolutions: [32, 64, 128], nSteps: 40 });
  printResultsTable(results);
}
