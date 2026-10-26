/**
 * rendering/instruments.js - the measuring instruments of the lab bench.
 *
 * The floor and the balls show you what is happening; these four show you
 * *what to measure*. They are all the same kind of thing - world-space
 * geometry the simulation writes into every frame - and none of them touches
 * the physics, so switching one on can never change an experiment:
 *
 *   TrailLayer      - the path a ball has taken, drawn as a line behind it.
 *   VectorLayer     - an arrow per ball along its velocity.
 *   PredictionLayer - the trajectory the textbook predicts, dashed, so the
 *                     ball can be seen disagreeing with it.
 *   StageGrid       - half-metre squares on the floor: the ruler the eye
 *                     measures position against.
 *
 * Buffers are allocated once at construction and only ever refilled, because
 * these update every frame and an instrument that allocates in a render loop
 * is an instrument that shows up in the profiler as physics slowing down.
 */
import * as THREE from "three";

/* ------------------------------- motion trails ------------------------------- */

/**
 * The path a ball has taken. One line per tracked ball, sampled every `stride`
 * frames so a few seconds of flight is a few hundred points rather than a few
 * thousand - the shape of a parabola does not need 60 samples a second, and a
 * line that long is both slower to walk and harder to read.
 */
export class TrailLayer {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.maxPoints = opts.maxPoints ?? 480;
    this.stride = opts.stride ?? 2;
    this.material = new THREE.LineBasicMaterial({
      color: opts.color ?? 0x9e00ff, // --accent: this is the ball being watched
      transparent: true, opacity: 0.5, depthWrite: false,
    });
    this.trails = new Map(); // ball index -> { line, positions, count }
    this._tick = 0;
  }

  _trail(index) {
    let trail = this.trails.get(index);
    if (trail) return trail;
    const positions = new Float32Array(this.maxPoints * 3);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setDrawRange(0, 0);
    const line = new THREE.Line(geometry, this.material);
    /* Never culled: three.js would want a bounding sphere for the strip, and
       recomputing one every frame to draw a line the eye is already looking at
       is a cost with no return. */
    line.frustumCulled = false;
    line.renderOrder = 2;
    this.scene.add(line);
    trail = { line, positions, count: 0 };
    this.trails.set(index, trail);
    return trail;
  }

  /** Reposition the whole strip when a point falls off the end of the buffer. */
  _shift(trail) {
    trail.positions.copyWithin(0, 3);
    trail.count--;
  }

  /**
   * @param {import('../simulation/particle_system.js').ParticleSystem} ps
   * @param {Iterable<number>} indices the balls to trace
   */
  update(ps, indices) {
    const live = new Set();
    this._tick++;
    const sampling = this._tick % this.stride === 0;
    for (const i of indices) {
      if (i < 0 || i >= ps.count || !ps.active[i]) continue;
      live.add(i);
      if (!sampling) continue;
      const trail = this._trail(i);
      if (trail.count >= this.maxPoints) this._shift(trail);
      const at = trail.count * 3;
      trail.positions[at] = ps.posX[i];
      trail.positions[at + 1] = ps.posY[i];
      trail.positions[at + 2] = ps.posZ[i];
      trail.count++;
      trail.line.geometry.setDrawRange(0, trail.count);
      trail.line.geometry.attributes.position.needsUpdate = true;
    }
    // A ball that is gone (deselected, culled, cleared) takes its trail with it.
    for (const [index, trail] of this.trails) {
      if (live.has(index)) continue;
      this.scene.remove(trail.line);
      trail.line.geometry.dispose();
      this.trails.delete(index);
    }
  }

  clear() {
    for (const [, trail] of this.trails) {
      this.scene.remove(trail.line);
      trail.line.geometry.dispose();
    }
    this.trails.clear();
  }
}

/* ------------------------------ velocity vectors ----------------------------- */

const PER_BALL_VERTICES = 6; // shaft (2) + two barbs (2 each)

/**
 * One arrow per ball, pointing the way it is going and as long as it is fast.
 * The classic force diagram's other half: a field of arrows is what makes a
 * collision legible at a glance, because momentum is something you can see
 * change hands.
 */
export class VectorLayer {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.maxParticles = opts.maxParticles ?? 400;
    this.metersPerSpeed = opts.metersPerSpeed ?? 0.13;
    this.maxLength = opts.maxLength ?? 0.5;
    this.vertices = new Float32Array(this.maxParticles * PER_BALL_VERTICES * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.vertices, 3));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({
      color: opts.color ?? 0x7a00c4, transparent: true, opacity: 0.85, depthWrite: false,
    });
    this.lines = new THREE.LineSegments(this.geometry, this.material);
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 3;
    this.scene.add(this.lines);

    this._dir = new THREE.Vector3();
    this._side = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
  }

  /** @param {THREE.Camera} camera the barbs are built in screen space, so the
   *  arrow keeps its shape however the scene is turned. */
  update(ps, camera) {
    const v = this.vertices;
    const tip = new THREE.Vector3();
    const dir = this._dir, side = this._side;
    camera.getWorldDirection(this._camDir);
    let n = 0;
    for (let i = 0; i < ps.count; i++) {
      if (!ps.active[i]) continue;
      const speed = ps.speed(i);
      if (speed < 0.02) continue;
      const length = Math.min(speed * this.metersPerSpeed, this.maxLength);
      const x = ps.posX[i], y = ps.posY[i], z = ps.posZ[i];
      dir.set(ps.velX[i] / speed, ps.velY[i] / speed, ps.velZ[i] / speed);
      side.crossVectors(dir, this._camDir);
      if (side.lengthSq() < 1e-6) side.set(0, 1, 0);
      side.normalize().multiplyScalar(length * 0.17);
      tip.set(x + dir.x * length, y + dir.y * length, z + dir.z * length);

      const backX = tip.x - dir.x * length * 0.28, backY = tip.y - dir.y * length * 0.28, backZ = tip.z - dir.z * length * 0.28;
      let o = (n * PER_BALL_VERTICES) * 3;
      v[o] = x; v[o + 1] = y; v[o + 2] = z;               // shaft: ball -> tip
      v[o + 3] = tip.x; v[o + 4] = tip.y; v[o + 5] = tip.z;
      o += 6;
      v[o] = tip.x; v[o + 1] = tip.y; v[o + 2] = tip.z;    // barb one
      v[o + 3] = backX + side.x; v[o + 4] = backY + side.y; v[o + 5] = backZ + side.z;
      o += 6;
      v[o] = tip.x; v[o + 1] = tip.y; v[o + 2] = tip.z;    // barb two
      v[o + 3] = backX - side.x; v[o + 4] = backY - side.y; v[o + 5] = backZ - side.z;
      n++;
      if (n >= this.maxParticles) break;
    }
    this.geometry.setDrawRange(0, n * PER_BALL_VERTICES);
    this.geometry.attributes.position.needsUpdate = true;
  }

  setVisible(on) { this.lines.visible = on; }
}

/* --------------------------- predicted trajectory --------------------------- */

/**
 * The trajectory a physics textbook predicts for the launch the spawn panel is
 * set to: no air, no collisions, just x = x0 + vx t and y = y0 + vy t - gt^2/2.
 *
 * Dashed, and drawn *before* the ball is launched, because the interesting
 * result of the projectile lab is not that a ball makes an arc - it is how far
 * the ball's arc differs from this one, and the difference is the physics the
 * closed-form solution leaves out.
 */
export class PredictionLayer {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.maxDashes = opts.maxDashes ?? 70;
    /* Dashes are built as separate short segments with gaps between them
       rather than with three.js's dash material: a dash here has to be a slice
       of *time* (so the marks stay a readable size whatever the launch speed),
       and a material that dashes by arc length cannot know about time. */
    this.dashSeconds = opts.dashSeconds ?? 0.022;
    this.positions = new Float32Array(this.maxDashes * 2 * 3);
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setDrawRange(0, 0);
    this.material = new THREE.LineBasicMaterial({
      color: opts.color ?? 0x8f8d9c, transparent: true, opacity: 0.95, depthWrite: false,
    });
    this.line = new THREE.LineSegments(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 1;
    this.scene.add(this.line);
  }

  /**
   * @param {{x:number,y:number,z:number,vx:number,vy:number,vz:number,
   *          gravity:number,floorY:number,radius:number,show:boolean}} launch
   */
  update(launch) {
    this.line.visible = launch.show;
    if (!launch.show) return;
    /* A launch point with one missing component used to poison every third
       vertex of this buffer with NaN: the dashed arc simply never drew, and
       three.js warned once a frame that the geometry's bounds were NaN. The
       caller is fixed, but a drawing helper still has no business writing NaN
       into a buffer - one bad number would take the whole arc down again - so
       every input is made finite here, once. */
    const finite = (value, fallback = 0) => (Number.isFinite(value) ? value : fallback);
    const x = finite(launch.x), y = finite(launch.y), z = finite(launch.z);
    const vx = finite(launch.vx), vy = finite(launch.vy), vz = finite(launch.vz);
    const gravity = finite(launch.gravity), floorY = finite(launch.floorY);
    const radius = finite(launch.radius, 0.05);
    /* Where it comes back down: the positive root of y0 + vy t - gt^2/2 = floor.
       With no gravity there is no "down" to come back to, so the arc is drawn
       for a fixed second and simply leaves. */
    let flight = 1;
    if (gravity > 0.01) {
      const c = y - (floorY + radius);
      flight = (vy + Math.sqrt(Math.max(vy * vy + 2 * gravity * c, 0))) / gravity;
    }
    const v = this.positions;
    const dashes = Math.max(3, Math.min(this.maxDashes, Math.round(flight / (2 * this.dashSeconds))));
    const step = flight / (dashes * 2);
    for (let k = 0; k < dashes; k++) {
      const t0 = k * 2 * step, t1 = t0 + step;
      const y0 = y + vy * t0 - 0.5 * gravity * t0 * t0;
      const y1 = y + vy * t1 - 0.5 * gravity * t1 * t1;
      const at = k * 6;
      v[at] = x + vx * t0; v[at + 1] = y0; v[at + 2] = z + vz * t0;
      v[at + 3] = x + vx * t1; v[at + 4] = y1; v[at + 5] = z + vz * t1;
    }
    const n = dashes;
    this.geometry.setDrawRange(0, n * 2);
    this.geometry.attributes.position.needsUpdate = true;
  }
}

/* ------------------------------- the floor grid ------------------------------- */

/**
 * Half-metre squares on the floor. A pale stage with one dark ball on it gives
 * the eye no scale at all - the ball could be a marble on a table or a planet
 * in space - and every reading in this app is in metres, so the grid is what
 * turns a number in the rail into a distance on screen.
 */
export class StageGrid {
  constructor(scene, opts = {}) {
    this.scene = scene;
    const { halfX = 1.6, halfZ = 1.6, y = -1.1, spacing = 0.5 } = opts;
    const pts = [];
    const lift = y + 0.002; // a hair above the floor, or it z-fights with it
    const nx = Math.round(halfX / spacing), nz = Math.round(halfZ / spacing);
    for (let i = -nx; i <= nx; i++) {
      const x = i * spacing;
      pts.push(x, lift, -halfZ, x, lift, halfZ);
    }
    for (let i = -nz; i <= nz; i++) {
      const z = i * spacing;
      pts.push(-halfX, lift, z, halfX, lift, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      color: opts.color ?? 0xcdccd7, transparent: true, opacity: 0.85,
    }));
    this.lines.renderOrder = 0;
    this.scene.add(this.lines);
  }

  setVisible(on) { this.lines.visible = on; }
}
