/**
 * simulation/particle_system.js - rigid-body particles ("balls").
 *
 * Typed-array-backed particle store plus real physics: semi-implicit
 * Euler integration under gravity and air drag. Mass is proportional to
 * radius^3 so different-sized particles interact with correct momentum
 * in simulation/collision_system.js. No rendering or DOM code here:
 * this runs identically under Node (see experiments/benchmarks.js) and
 * in the browser (frontend/main.js).
 */
export class ParticleSystem {
  constructor(maxParticles, bounds = { x: 1, y: 1.1, z: 1 }) {
    this.maxParticles = maxParticles;
    this.bounds = bounds;

    this.posX = new Float64Array(maxParticles);
    this.posY = new Float64Array(maxParticles);
    this.posZ = new Float64Array(maxParticles);
    this.velX = new Float64Array(maxParticles);
    this.velY = new Float64Array(maxParticles);
    this.velZ = new Float64Array(maxParticles);
    this.accelMag = new Float64Array(maxParticles);
    /* What the ball *did*, as opposed to accelMag, which is what was asked of
       it (gravity plus its own force, in newtons per kilogram). The two agree
       in mid-air and only there, which is exactly the case that matters least:
       a ball resting on the floor is asked for 9.8 m/s^2 every step and does
       none of it, and a ball sliding on a bench under a steady force does the
       horizontal part but none of the vertical. Reading accelMag off a ball in
       contact is therefore how a student concludes that F = ma is false. This
       one is measured from the ball's own velocity before and after a step,
       once everything that acted on it has been accounted for. */
    this.netAccel = new Float64Array(maxParticles);
    this.radius = new Float64Array(maxParticles);
    this.mass = new Float64Array(maxParticles);
    this.active = new Uint8Array(maxParticles);

    /* A force the user applies to a single ball, in newtons. Constant until it
       is typed over, which is the whole point: Newton's second law is about
       what a *steady* force does to a mass. */
    this.forceX = new Float64Array(maxParticles);
    this.forceY = new Float64Array(maxParticles);
    this.forceZ = new Float64Array(maxParticles);

    /* Measurements, one slot per ball: where it was born, when (as the caller
       counts time - this file has no clock), the highest point it has reached
       and the fastest it has ever gone. They live here rather than in the
       frontend for one reason: sweep() moves balls between slots, so a reading
       kept anywhere else ends up stapled to whatever ball inherits the slot. */
    this.bornX = new Float64Array(maxParticles);
    this.bornY = new Float64Array(maxParticles);
    this.bornZ = new Float64Array(maxParticles);
    this.bornT = new Float64Array(maxParticles);
    this.peakY = new Float64Array(maxParticles);
    this.maxSpeed = new Float64Array(maxParticles);
    /* When it first touched anything, or -1 while it is still on its way. A
       stopwatch the caller stops by latching it - the caller knows what counts
       as a landing (the floor, a ramp, another ball), this file does not. */
    this.touchT = new Float64Array(maxParticles);
    /* Where it was, horizontally, at that first touch - the projectile lab's
       range, and -1 until the landing that defines it. Deliberately not "how
       far it is now": a ball that has landed and slid on is still moving, and
       a range that keeps growing is not the number the formula predicts. */
    this.landingRange = new Float64Array(maxParticles);

    this.count = 0;
  }

  /** Balls are water: 1000 kg/m^3, so a 9 cm ball weighs about 0.09 kg and a
   *  force typed into the inspector is a force in the same units a physics
   *  problem quotes. The density is arbitrary the way the metre is arbitrary -
   *  every collision here conserves momentum whatever it is - but it is not
   *  free: a mass of a fraction of a gram turns every force into a number with
   *  three leading zeroes, which is exactly the kind of thing that stops a
   *  student from reading their own results. */
  static DENSITY = 1000; // kg/m^3

  static massFromRadius(r) {
    return Math.max(r * r * r * ParticleSystem.DENSITY, 1e-4);
  }

  clear() {
    this.count = 0;
    this.active.fill(0);
  }

  /** Move the particle in slot `from` into slot `to`, every field with it. */
  _move(from, to) {
    this.posX[to] = this.posX[from]; this.posY[to] = this.posY[from]; this.posZ[to] = this.posZ[from];
    this.velX[to] = this.velX[from]; this.velY[to] = this.velY[from]; this.velZ[to] = this.velZ[from];
    this.accelMag[to] = this.accelMag[from]; this.netAccel[to] = this.netAccel[from];
    this.radius[to] = this.radius[from]; this.mass[to] = this.mass[from];
    this.forceX[to] = this.forceX[from]; this.forceY[to] = this.forceY[from]; this.forceZ[to] = this.forceZ[from];
    this.bornX[to] = this.bornX[from]; this.bornY[to] = this.bornY[from]; this.bornZ[to] = this.bornZ[from];
    this.bornT[to] = this.bornT[from];
    this.peakY[to] = this.peakY[from]; this.maxSpeed[to] = this.maxSpeed[from];
    this.touchT[to] = this.touchT[from];
    this.landingRange[to] = this.landingRange[from];
    this.active[to] = this.active[from];
  }

  /**
   * Drop every particle `shouldDrop(i)` accepts, closing the gaps so the freed
   * slots can be spawned into again - and so a scene that has shed half its
   * balls can still be refilled to capacity.
   *
   * Particle indices do not survive a sweep: anything holding one (a
   * selection, a drag, an inspected ball) has to let go first.
   *
   * @returns {number} how many were dropped
   */
  sweep(shouldDrop) {
    let dropped = 0;
    for (let i = 0; i < this.count; ) {
      if (this.active[i] && !shouldDrop(i)) { i++; continue; }
      dropped++;
      const last = this.count - 1;
      if (i !== last) this._move(last, i);
      this.count = last;
      this.active[this.count] = 0; // the slot just vacated belongs to nobody
    }
    return dropped;
  }

  spawn(x, y, z, vx, vy, vz, radius) {
    if (this.count >= this.maxParticles) return -1;
    const i = this.count++;
    this.posX[i] = x; this.posY[i] = y; this.posZ[i] = z;
    this.velX[i] = vx; this.velY[i] = vy; this.velZ[i] = vz;
    this.radius[i] = radius;
    this.mass[i] = ParticleSystem.massFromRadius(radius);
    // A recycled slot keeps nothing from its last occupant except its index.
    this.forceX[i] = 0; this.forceY[i] = 0; this.forceZ[i] = 0;
    this.bornX[i] = x; this.bornY[i] = y; this.bornZ[i] = z;
    this.bornT[i] = 0;
    this.peakY[i] = y; this.maxSpeed[i] = 0;
    this.accelMag[i] = 0; this.netAccel[i] = 0;
    this.touchT[i] = -1; this.landingRange[i] = -1;
    this.active[i] = 1;
    return i;
  }

  /**
   * Spawn `n` particles in one of a few standard patterns, all sharing
   * `radius`. Returns the number actually spawned (capped by capacity).
   *
   * Patterns are anchored to `floorY` - the height of the ground they will
   * come to rest on - rather than dropped from the ceiling. That number is
   * normally the caller's, because only the caller knows what the ground is.
   * The difference is not cosmetic: a scene with no walls turns a two-metre
   * drop into a splash, and the balls thrown outward by it are over the edge
   * and gone before anything has settled. Set down, a grid stays a grid.
   */
  spawnPattern(n, radius, pattern = "grid", floorY = -this.bounds.y) {
    const room = this.maxParticles - this.count;
    n = Math.min(n, room);
    const start = this.count;
    const { x: bx, z: bz } = this.bounds;
    const base = floorY + radius + 0.012; // just clear of the surface

    if (pattern === "grid") {
      const perRow = Math.max(1, Math.ceil(Math.sqrt(n)));
      const spacing = Math.max(radius * 2.2, (bx * 1.6) / perRow);
      for (let i = 0; i < n; i++) {
        const gx = i % perRow, gz = Math.floor(i / perRow) % perRow;
        const gy = Math.floor(i / (perRow * perRow));
        /* Stacked layers only when there are more balls than fit in one - and
           then only a hair apart, so they settle instead of falling. */
        this.spawn(
          (gx - perRow / 2) * spacing + (Math.random() - 0.5) * 0.01,
          base + gy * radius * 2.1,
          (gz - perRow / 2) * spacing + (Math.random() - 0.5) * 0.01,
          0, 0, 0, radius
        );
      }
    } else if (pattern === "random") {
      for (let i = 0; i < n; i++) {
        this.spawn(
          (Math.random() - 0.5) * bx * 1.6,
          base + Math.random() * 0.5,
          (Math.random() - 0.5) * bz * 1.6,
          (Math.random() - 0.5) * 0.35, 0, (Math.random() - 0.5) * 0.35, radius
        );
      }
    } else if (pattern === "column") {
      for (let i = 0; i < n; i++) {
        this.spawn(
          (Math.random() - 0.5) * 0.04,
          base + i * (radius * 2.2),
          (Math.random() - 0.5) * 0.04,
          0, 0, 0, radius
        );
      }
    } else {
      throw new Error(`unknown spawn pattern '${pattern}'`);
    }
    return this.count - start;
  }

  /** The acceleration a ball is under this step: gravity plus whatever force
   *  is applied to it, per unit mass. Reported as a magnitude the inspector
   *  can show, and the same vector the integration below uses. */
  acceleration(i, gravity, out = { x: 0, y: 0, z: 0 }) {
    const invM = 1 / this.mass[i];
    out.x = this.forceX[i] * invM;
    out.y = this.forceY[i] * invM - gravity;
    out.z = this.forceZ[i] * invM;
    return out;
  }

  /**
   * Gravity + applied force + air drag + integration. Boundary/inter-particle
   * collision is handled separately by simulation/collision_system.js.
   *
   * The position step uses the *mean* of the velocity before and after the step
   * (trapezoidal, i.e. velocity-Verlet's position update) rather than the new
   * velocity alone. That single change is what makes this a physics teaching
   * tool instead of a physics-flavoured animation: under a constant force the
   * trapezoid is exact, so a projectile follows the textbook parabola and a
   * 1.20 m drop takes exactly the 0.495 s that sqrt(2h/g) promises. Plain
   * semi-implicit Euler - `pos += v_new * dt` - is stable and perfectly fine for
   * a game, but it lags the true path by half a step of acceleration, which at
   * the shipped dt = 0.01 s puts a thrown ball about a centimetre below where
   * the formula says it is. On a bench with a ruler on it, a centimetre is the
   * difference between confirming a law and doubting it.
   */
  integrate(dt, gravity, drag) {
    const a = this._accelScratch ?? (this._accelScratch = { x: 0, y: 0, z: 0 });
    const keep = 1 - drag;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i]) continue;
      this.acceleration(i, gravity, a);
      this.accelMag[i] = Math.hypot(a.x, a.y, a.z);
      const vx0 = this.velX[i], vy0 = this.velY[i], vz0 = this.velZ[i];
      this.velX[i] = (vx0 + a.x * dt) * keep;
      this.velY[i] = (vy0 + a.y * dt) * keep;
      this.velZ[i] = (vz0 + a.z * dt) * keep;
      this.posX[i] += (vx0 + this.velX[i]) * 0.5 * dt;
      this.posY[i] += (vy0 + this.velY[i]) * 0.5 * dt;
      this.posZ[i] += (vz0 + this.velZ[i]) * 0.5 * dt;
    }
  }

  /**
   * Remember every velocity, so the net acceleration can be measured after the
   * solvers have had their turn. Call once before integrate().
   */
  beginStep() {
    const n = this.maxParticles;
    const x = this._preVelX ?? (this._preVelX = new Float64Array(n));
    const y = this._preVelY ?? (this._preVelY = new Float64Array(n));
    const z = this._preVelZ ?? (this._preVelZ = new Float64Array(n));
    x.set(this.velX); y.set(this.velY); z.set(this.velZ);
  }

  /**
   * The ball's actual acceleration over the step just taken, from the change in
   * its velocity - which is a measurement rather than a restatement of the
   * forces, because it includes the floor and its neighbours.
   *
   * `skip` lists the balls that landed during this step: the step that stops a
   * ball is an impulse, and an impulse divided by a hundredth of a second is a
   * four-figure number that would flash across the panel and mean nothing. They
   * keep the reading they had, which is the acceleration on the way down - the
   * number a free-fall lab is asking for.
   */
  measureAccel(dt, skip) {
    if (!(dt > 0)) return;
    const x = this._preVelX, y = this._preVelY, z = this._preVelZ;
    if (!x) return;
    for (let i = 0; i < this.count; i++) {
      if (!this.active[i] || (skip && skip.length && skip.includes(i))) continue;
      this.netAccel[i] = Math.hypot(this.velX[i] - x[i], this.velY[i] - y[i], this.velZ[i] - z[i]) / dt;
    }
  }

  speed(i) {
    return Math.hypot(this.velX[i], this.velY[i], this.velZ[i]);
  }

  kineticEnergy(i) {
    const s = this.speed(i);
    return 0.5 * this.mass[i] * s * s;
  }

  totalKineticEnergy() {
    let sum = 0;
    for (let i = 0; i < this.count; i++) if (this.active[i]) sum += this.kineticEnergy(i);
    return sum;
  }

  averageSpeed() {
    let sum = 0, n = 0;
    for (let i = 0; i < this.count; i++) if (this.active[i]) { sum += this.speed(i); n++; }
    return n ? sum / n : 0;
  }
}
