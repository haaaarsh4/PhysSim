/**
 * simulation/collision_system.js - turning geometry + particles into physics.
 *
 * Three responsibilities:
 *   1. rasterizeSolidMask   - bake an SDFScene (geometry/sdf.js) into the
 *      boolean grid the fluid solver uses as a Neumann boundary.
 *   2. resolveParticleCollisions - real impulse-based sphere-sphere
 *      collision response between ParticleSystem entries: positional
 *      correction to remove overlap, then a momentum-conserving impulse
 *      scaled by a restitution coefficient. Mass-weighted, so different
 *      radii interact correctly. Uses a uniform spatial hash grid for
 *      broad-phase so this stays close to O(n) rather than O(n^2).
 *   3. resolveSDFCollisions - contact against static geometry, floor included.
 *      Everything a ball can touch is an SDF, so what a scene looks like and
 *      what it feels like are built from the same description.
 */

export function rasterizeSolidMask(sdfScene, nx, ny, dx) {
  const mask = new Uint8Array(nx * ny);
  for (let y = 0; y < ny; y++) {
    for (let x = 0; x < nx; x++) {
      mask[y * nx + x] = sdfScene.distance2D(x * dx, y * dx) < 0 ? 1 : 0;
    }
  }
  return mask;
}

class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }
  key(ix, iy, iz) { return `${ix},${iy},${iz}`; }
  build(ps) {
    this.cells.clear();
    const cs = this.cellSize;
    for (let i = 0; i < ps.count; i++) {
      if (!ps.active[i]) continue;
      const k = this.key(
        Math.floor(ps.posX[i] / cs), Math.floor(ps.posY[i] / cs), Math.floor(ps.posZ[i] / cs)
      );
      let arr = this.cells.get(k);
      if (!arr) { arr = []; this.cells.set(k, arr); }
      arr.push(i);
    }
  }
  forEachNeighbor(ps, i, cb) {
    const cs = this.cellSize;
    const ix = Math.floor(ps.posX[i] / cs), iy = Math.floor(ps.posY[i] / cs), iz = Math.floor(ps.posZ[i] / cs);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const arr = this.cells.get(this.key(ix + dx, iy + dy, iz + dz));
          if (arr) for (const j of arr) cb(j);
        }
  }
}

/**
 * @returns {number} number of narrow-phase pair checks performed (a real
 * performance metric, not an estimate - used by the Inspector panel).
 */
export function resolveParticleCollisions(ps, restitution, cellSize, minBounce = RESTING_SPEED) {
  const hash = new SpatialHash(Math.max(cellSize, 0.02));
  hash.build(ps);
  let checks = 0;

  for (let i = 0; i < ps.count; i++) {
    if (!ps.active[i]) continue;
    hash.forEachNeighbor(ps, i, (j) => {
      if (j <= i || !ps.active[j]) return;
      checks++;
      const dx = ps.posX[i] - ps.posX[j], dy = ps.posY[i] - ps.posY[j], dz = ps.posZ[i] - ps.posZ[j];
      const rSum = ps.radius[i] + ps.radius[j];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= rSum * rSum || d2 < 1e-10) return;

      const d = Math.sqrt(d2);
      const nx = dx / d, ny = dy / d, nz = dz / d;
      const overlap = rSum - d;
      const invMi = 1 / ps.mass[i], invMj = 1 / ps.mass[j];
      const corr = overlap / (invMi + invMj);
      ps.posX[i] += nx * corr * invMi; ps.posY[i] += ny * corr * invMi; ps.posZ[i] += nz * corr * invMi;
      ps.posX[j] -= nx * corr * invMj; ps.posY[j] -= ny * corr * invMj; ps.posZ[j] -= nz * corr * invMj;

      const rvx = ps.velX[i] - ps.velX[j], rvy = ps.velY[i] - ps.velY[j], rvz = ps.velZ[i] - ps.velZ[j];
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn < 0) {
        const j_ = -(1 + bounceOf(restitution, -vn, minBounce)) * vn / (invMi + invMj);
        ps.velX[i] += j_ * invMi * nx; ps.velY[i] += j_ * invMi * ny; ps.velZ[i] += j_ * invMi * nz;
        ps.velX[j] -= j_ * invMj * nx; ps.velY[j] -= j_ * invMj * ny; ps.velZ[j] -= j_ * invMj * nz;
      }
    });
  }
  return checks;
}

/**
 * How bouncy a contact of this speed actually is.
 *
 * A contact slower than one step of gravity is not a collision, it is a ball
 * being held up, and reflecting its velocity would hand it back the speed it
 * had just lost - every single step. The result is not a subtle drift: a ball
 * with a restitution of 1 sitting on the floor pumps itself higher and higher,
 * and the momentum readout of an elastic-collision lab quietly grows. Below the
 * threshold there is therefore no bounce at all, which is also what a ball
 * settling onto a bench does in front of you: it stops, it does not shimmer.
 *
 * @param {number} restitution the coefficient the scene asked for
 * @param {number} approachSpeed how fast the contact is being closed
 * @param {number} minBounce speeds below this are resting contacts
 */
function bounceOf(restitution, approachSpeed, minBounce) {
  return approachSpeed < minBounce ? 0 : restitution;
}

/** The default resting threshold, in metres per second. Callers that know the
 *  step size should pass their own, because one step of gravity is what sets it. */
const RESTING_SPEED = 0.15;

/**
 * Push any particle found inside a solid back out to its surface, reflect the
 * velocity into it, and rub off some of the velocity along it.
 *
 * Friction is what stops a ball that has landed from keeping every bit of its
 * sideways speed for ever. It matters more than it looks: a ramp with no
 * friction is a slingshot, nothing in the scene ever comes to rest, and a ball
 * that never stops rolling eventually rolls off the end of the world.
 *
 * The friction is Coulomb's, and that is a deliberate choice rather than a
 * detail. A fixed fraction of the tangential speed per contact - the obvious
 * implementation - is not a physical quantity: the same slide made of twice as
 * many contacts a second is twice as rough, so the surface's behaviour would
 * depend on dt, the machine and the frame rate, and a student could not measure
 * it and check it against anything. Coulomb friction limits the tangential
 * speed a contact may remove to mu times the normal speed that contact itself
 * absorbed, which gives the laws the textbooks actually teach: a ball sliding on
 * a floor slows at mu*g, and a block on a slope either grips (tan t < mu) or
 * slides at g(sin t - mu cos t). That is the inclined-plane experiment, and it
 * is now an experiment rather than an animation.
 *
 * @param {number} restitution 1 = perfectly bouncy, 0 = no bounce
 * @param {number} mu coefficient of friction: 0 is ice, 0.4 is a rough surface
 * @param {number} gravity needs to be known so the bounce can be worked out
 *   where the surface is rather than where the ball was caught, see below
 * @param {SDFScene} sdfScene the scene: `nearest` names the shape a contact is
 *   with and `normalOf` gives that shape's own outward normal
 * @param {Array<{bounce?: number, friction?: number}|null>} [materials] an
 *   optional entry per shape of `sdfScene`, indexed the same way, overriding
 *   the two coefficients above for contacts with that shape. A null entry, or
 *   a missing field on a non-null one, falls back to the scene's own values -
 *   so a bench keeps one surface until a shape is given a material of its own.
 * @param {Array<boolean>} [owned] an optional entry per shape: true where that
 *   shape is not static scenery. A solid that can move gives the ball its
 *   impulse in simulation/shape_dynamics.js, and this pass must not make the
 *   same contact again - reflecting a ball off a wall that is already leaving
 *   would take the ball's rebound straight back off it.
 */
export function resolveSDFCollisions(
  ps, sdfScene, restitution = 0.4, mu = 0.4, minBounce = RESTING_SPEED, gravity = 0, materials = null,
  owned = null,
) {
  for (let i = 0; i < ps.count; i++) {
    if (!ps.active[i]) continue;
    const px = ps.posX[i], py = ps.posY[i], pz = ps.posZ[i];
    /* Which body was hit, and how far into it. One walk over the scene answers
       both: the nearest surface is the one being touched, because a scene can
       be built out of more than one - a rubber wall next to an icy floor is two
       experiments in one scene - and it is the shape that was touched that
       decides which one this contact is made of, whether this pass is the one
       that makes it, and which way *out* of it is. */
    const [distance, index] = sdfScene.nearest(px, py, pz);
    const d = distance - ps.radius[i];
    if (d >= 0) continue;
    if (owned && owned[index]) continue;
    let e = restitution, f = mu;
    if (materials) {
      const material = materials[index];
      if (material) {
        if (material.bounce !== undefined) e = material.bounce;
        if (material.friction !== undefined) f = material.friction;
      }
    }
    /* The normal of the shape that was hit, never of the scene it stands in:
       see SDFScene.normalOf for what a scene-wide one does to a ball resting
       in the corner where two surfaces meet. */
    const [nx, ny, nz] = sdfScene.normalOf(index, px, py, pz);
    ps.posX[i] -= nx * d; ps.posY[i] -= ny * d; ps.posZ[i] -= nz * d;

    const vDotN = ps.velX[i] * nx + ps.velY[i] * ny + ps.velZ[i] * nz;
    if (vDotN >= 0) continue; // touching but separating: no contact force, no rub

    /* The ball is inside the surface by `d` because a step at 5 m/s is 5 cm
       long, and the push-out above has just lifted it back out. That lift is
       a gift of height, and the speed that came with it has to be given back
       too: 2g|d| of kinetic energy per kilogram, which for a 4.8 m/s drop is
       about 2%. Left in, a ball dropped from 1.2 m onto a floor with e = 1.0
       returns to 1.24 m, and the bouncing-ball lab measures e = 0.73 against a
       panel that says 0.70. A ball in *contact* is unaffected: it penetrates a
       step of gravity and is pushed back that same step, and this arithmetic
       takes it to zero, which is what the resting threshold below then does
       with it anyway. */
    const normalSpeed = -vDotN;
    const surfaceSpeed = gravity === 0
      ? normalSpeed
      : Math.sqrt(Math.max(0, normalSpeed * normalSpeed + 2 * gravity * ny * d));

    // The normal speed this contact takes out. The rub a contact can apply is
    // proportional to it, and the coefficient is the friction the panel shows.
    const bounce = normalSpeed + bounceOf(e, normalSpeed, minBounce) * surfaceSpeed;
    ps.velX[i] += bounce * nx;
    ps.velY[i] += bounce * ny;
    ps.velZ[i] += bounce * nz;

    if (f <= 0) continue;
    const vnAfter = ps.velX[i] * nx + ps.velY[i] * ny + ps.velZ[i] * nz;
    const tx = ps.velX[i] - vnAfter * nx;
    const ty = ps.velY[i] - vnAfter * ny;
    const tz = ps.velZ[i] - vnAfter * nz;
    const tangentialSpeed = Math.hypot(tx, ty, tz);
    if (tangentialSpeed < 1e-9) continue;
    // Capped twice over: by mu, and by the speed there actually is. A rub that
    // exceeded either would mean sliding backwards off the surface, which no
    // surface does.
    const rub = Math.min(tangentialSpeed, f * bounce) / tangentialSpeed;
    ps.velX[i] -= rub * tx;
    ps.velY[i] -= rub * ty;
    ps.velZ[i] -= rub * tz;
  }
}
