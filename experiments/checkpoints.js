/**
 * experiments/checkpoints.js - snapshot and restore simulation state.
 *
 * Deliberately environment-agnostic: these functions only convert a
 * ParticleSystem's live typed arrays to/from a plain JSON-serializable
 * object. What actually happens with that object (a browser download,
 * an upload dialog, or a file on disk) is the caller's job - see
 * storage/io.js from the frontend, or storage/io.node.js from a Node
 * script - so this file works unmodified in both places.
 */

/*
 * What a snapshot has to carry, and why the list is longer than position and
 * velocity.
 *
 * A ball's mass is not derivable from its radius once someone has typed one:
 * the inspector writes a mass that the size no longer explains, which is the
 * whole point of the field - a hundred-kilogramme ball the size of a marble is
 * a legitimate experiment and it is the one the collision labs are built on.
 * Left out of the format, every path that saves and restores a scene silently
 * put that marble's weight back to water: switching pages, loading a
 * checkpoint, reloading the page. The same is true of the force the user
 * applied - Newton's second law is a lab about a *steady* force, and a restore
 * that quietly removed it was a lab with no force at all - and of the readings
 * the ball has accumulated, so that a restored scene shows the numbers it had
 * earned rather than pretending the ball has just been released.
 *
 * Every added field is optional on the way in. A file written before the field
 * existed simply does not have it, and the ball keeps whatever spawning gave
 * it - so old checkpoints still load.
 */
const CARRIED = [
  "posX", "posY", "posZ", "velX", "velY", "velZ", "radius", "active",
  "mass", "forceX", "forceY", "forceZ",
  "bornX", "bornY", "bornZ", "bornT", "peakY", "maxSpeed", "touchT", "landingRange",
];

/** The fields `spawn()` itself establishes, which a snapshot may therefore
 *  leave out without the ball being wrong: everything the other arrays hold is
 *  a number the student set or the run measured. */
const FROM_SPAWN = new Set(["posX", "posY", "posZ", "velX", "velY", "velZ", "radius", "active"]);

export function serializeParticleSystem(ps) {
  const data = {
    maxParticles: ps.maxParticles,
    bounds: ps.bounds,
    count: ps.count,
    savedAt: new Date().toISOString(),
  };
  for (const field of CARRIED) data[field] = Array.from(ps[field].subarray(0, ps.count));
  return data;
}

/** Mutates `ps` in place to match a previously-serialized snapshot.
 * `ps` must have been constructed with maxParticles >= data.count. */
export function deserializeParticleSystem(ps, data) {
  ps.clear();
  for (let i = 0; i < data.count; i++) {
    ps.spawn(data.posX[i], data.posY[i], data.posZ[i], data.velX[i], data.velY[i], data.velZ[i], data.radius[i]);
    ps.active[i] = data.active[i];
    for (const field of CARRIED) {
      if (FROM_SPAWN.has(field)) continue;
      const values = data[field];
      if (values && values[i] !== undefined) ps[field][i] = values[i];
    }
  }
}

export function serializeFluidState(state) {
  return {
    nx: state.nx, ny: state.ny, dx: state.dx, dt: state.dt,
    frame: state.frame, time: state.time,
    u: Array.from(state.u), v: Array.from(state.v), dye: Array.from(state.dye),
    pressure: Array.from(state.pressure), solidMask: Array.from(state.solidMask),
    savedAt: new Date().toISOString(),
  };
}

export function deserializeFluidState(state, data) {
  state.u.set(data.u); state.v.set(data.v); state.dye.set(data.dye);
  state.pressure.set(data.pressure); state.solidMask.set(data.solidMask);
  state.frame = data.frame; state.time = data.time;
}
