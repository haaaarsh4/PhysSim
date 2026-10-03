/**
 * profiling/memory.js - exact memory accounting from typed arrays.
 *
 * Typed arrays know their own byte length exactly (`.byteLength`), so
 * this is real accounting, not an estimate. Used by both the fluid
 * SimulationState and the ParticleSystem to report memory alongside
 * runtime in experiments/parameter_sweep.js and the frontend HUD.
 */

export function typedArrayMemoryMB(...arrays) {
  return arrays.reduce((sum, a) => sum + a.byteLength, 0) / 1e6;
}

export function particleSystemMemoryReport(ps) {
  const fields = {
    posX: ps.posX, posY: ps.posY, posZ: ps.posZ,
    velX: ps.velX, velY: ps.velY, velZ: ps.velZ,
    radius: ps.radius, mass: ps.mass, active: ps.active,
  };
  const report = {};
  for (const [name, arr] of Object.entries(fields)) report[name] = arr.byteLength / 1e6;
  report.total_mb = Object.values(report).reduce((a, b) => a + b, 0);
  return report;
}

export function fluidStateMemoryReport(state) {
  const fields = {
    u: state.u, v: state.v, dye: state.dye, pressure: state.pressure,
    divergence: state.divergence, vorticity: state.vorticity, solidMask: state.solidMask,
  };
  const report = {};
  for (const [name, arr] of Object.entries(fields)) report[name] = arr.byteLength / 1e6;
  report.total_mb = Object.values(report).reduce((a, b) => a + b, 0);
  return report;
}
