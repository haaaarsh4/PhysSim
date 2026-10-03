/**
 * geometry/sdf.js - Signed Distance Fields.
 *
 * A signed distance function returns, for any point in space, the
 * distance to the nearest surface: negative inside a shape, zero on the
 * surface, positive outside. This is how the workbench represents solid
 * obstacles for both the particle system (simulation/collision_system.js)
 * and the fluid solver (rasterized into a boolean solid mask).
 *
 * Every shape is 3D (distance(x, y, z)); distance2D(x, y) is a
 * convenience for the fluid grid, which only needs the z=0 slice.
 * Dependency-free - runs identically in the browser and under Node.
 */

export class SDF {
  distance(_x, _y, _z) {
    throw new Error("SDF.distance must be implemented by a subclass");
  }

  distance2D(x, y) {
    return this.distance(x, y, 0);
  }

  /** Numerical gradient (unit normal, pointing away from the surface). */
  gradient(x, y, z, eps = 1e-3) {
    const d0 = this.distance(x, y, z);
    const dx = (this.distance(x + eps, y, z) - d0) / eps;
    const dy = (this.distance(x, y + eps, z) - d0) / eps;
    const dz = (this.distance(x, y, z + eps) - d0) / eps;
    const n = Math.hypot(dx, dy, dz) + 1e-12;
    return [dx / n, dy / n, dz / n];
  }

  inside(x, y, z) {
    return this.distance(x, y, z) < 0;
  }
}

export class SphereSDF extends SDF {
  constructor(cx, cy, cz, radius) {
    super();
    this.cx = cx; this.cy = cy; this.cz = cz; this.radius = radius;
  }
  distance(x, y, z) {
    return Math.hypot(x - this.cx, y - this.cy, z - this.cz) - this.radius;
  }
  /** Move it: a sphere has no orientation, so where it is *is* its pose. */
  setPose(cx, cy, cz) {
    this.cx = cx; this.cy = cy; this.cz = cz;
  }
}

/** 2D convenience: a sphere with no z-extent, for fluid-grid obstacles. */
export class CircleSDF extends SphereSDF {
  constructor(cx, cy, radius) {
    super(cx, cy, 0, radius);
  }
  distance(x, y) {
    return Math.hypot(x - this.cx, y - this.cy) - this.radius;
  }
}

/**
 * A solid with an orientation. Turning one is the same problem for every shape
 * here, so it is written once: the pose becomes a quaternion, the quaternion the
 * mesh is drawn with is the quaternion the solver queries with, and every
 * distance is answered in the solid's own frame.
 *
 * The frame transform writes into `this._frame` rather than returning a fresh
 * array: a distance query is the hottest path in the whole workbench, and a
 * gradient is four of them, so the alternative is a hundred thousand small
 * arrays a second for the collector to chase.
 */
class OrientedSDF extends SDF {
  /**
   * Put the solid somewhere else without rebuilding it, keeping its dimensions.
   *
   * This is what a solid that *moves* needs: a shape knocked by a ball changes
   * its pose every step, and a collision scene that answered with last step's
   * position - or that was rebuilt from scratch sixty times a second, meshes and
   * all - would be either wrong or wasteful. Re-deriving the quaternion here
   * keeps a moved box and an authored one identical to the solver.
   */
  setPose(cx, cy, cz, rotation = {}) {
    this.cx = cx; this.cy = cy; this.cz = cz;
    // Keep older callers working: a number is the former z-axis angle.
    const rx = typeof rotation === "number" ? 0 : (rotation.x ?? 0);
    const ry = typeof rotation === "number" ? 0 : (rotation.y ?? 0);
    const rz = typeof rotation === "number" ? rotation : (rotation.z ?? 0);
    this.angle = rz;
    const sx = Math.sin(rx / 2), cxr = Math.cos(rx / 2);
    const sy = Math.sin(ry / 2), cyr = Math.cos(ry / 2);
    const sz = Math.sin(rz / 2), czr = Math.cos(rz / 2);
    // Three.js's XYZ Euler order, shared with the rendered mesh.
    this.qx = sx * cyr * czr + cxr * sy * sz;
    this.qy = cxr * sy * czr - sx * cyr * sz;
    this.qz = cxr * cyr * sz + sx * sy * czr;
    this.qw = cxr * cyr * czr - sx * sy * sz;
    this._frame = this._frame ?? [0, 0, 0];
  }

  /** The world offset (dx, dy, dz) in this solid's own frame, as `_frame`. */
  _local(dx, dy, dz) {
    const { qx, qy, qz, qw } = this;
    const l = this._frame;
    l[0] = (1 - 2 * (qy * qy + qz * qz)) * dx
      + 2 * (qx * qy + qw * qz) * dy
      + 2 * (qx * qz - qw * qy) * dz;
    l[1] = 2 * (qx * qy - qw * qz) * dx
      + (1 - 2 * (qx * qx + qz * qz)) * dy
      + 2 * (qy * qz + qw * qx) * dz;
    l[2] = 2 * (qx * qz + qw * qy) * dx
      + 2 * (qy * qz - qw * qx) * dy
      + (1 - 2 * (qx * qx + qy * qy)) * dz;
    return l;
  }
}

/** A box with a full XYZ rotation. Rotation is stored as a quaternion so the
 *  point-to-box transform stays allocation-free on the collision hot path. */
export class BoxSDF extends OrientedSDF {
  constructor(cx, cy, cz, hx, hy, hz, rotation = {}) {
    super();
    this.hx = hx; this.hy = hy; this.hz = hz;
    this.setPose(cx, cy, cz, rotation);
  }

  distance(x, y, z) {
    // Rotate the query into the box's local frame using the inverse quaternion.
    const [lx, ly, lz] = this._local(x - this.cx, y - this.cy, z - this.cz);
    const qxLocal = Math.abs(lx) - this.hx;
    const qyLocal = Math.abs(ly) - this.hy;
    const qzLocal = Math.abs(lz) - this.hz;
    const outside = Math.hypot(Math.max(qxLocal, 0), Math.max(qyLocal, 0), Math.max(qzLocal, 0));
    const inside = Math.min(Math.max(qxLocal, Math.max(qyLocal, qzLocal)), 0);
    return outside + inside;
  }
}

/**
 * The profile of a wedge, in the wedge's own frame: the right triangle whose
 * base lies on the floor, whose back is a wall, and whose hypotenuse is the
 * slope - /| , which is what every inclined plane in a textbook is drawn as.
 *
 * The origin is the triangle's *centroid*, not the middle of its bounding box.
 * A body turns about its centre of mass, so a wedge whose model origin is its
 * centre of mass is one whose rotation needs no correction term - and a slope
 * that is not balanced where it is drawn is a slope that falls over.
 *
 * `hw` is half the base and `hh` half the height, so the slope's angle is
 * atan(hh / hw) and a wedge set down on the floor stands on a face rather than
 * balanced on a corner - which is the whole reason it stays where it is put.
 *
 * @returns {number[][]} the three corners, anticlockwise
 */
export function wedgeProfile(hw, hh) {
  return [
    [(-4 * hw) / 3, (-2 * hh) / 3], // the foot of the slope
    [(2 * hw) / 3, (-2 * hh) / 3], // the foot of the back wall
    [(2 * hw) / 3, (4 * hh) / 3], // the top of the back wall
  ];
}

/**
 * Distance from a point to a triangle's outline, negative inside it. iq's
 *  three-edge form, and the one detail that matters is that the two minima are
 *  taken *separately*: the nearest edge gives the distance, and the side value
 *  that decides inside from outside is the smallest of the three, not the one
 *  belonging to the nearest edge.
 *
 * They come apart exactly where it counts. A point past a corner - a ball that
 * has just rolled off the foot of a ramp, say - is nearest to an edge whose line
 * it is on the *inside* of, and the nearest-edge-only version would report it as
 * buried in the solid. The collision solver then teleports it out along whatever
 * direction that is, which is a ball sliding down a ramp and being flung back up
 * it, over and over.
 */
function triangleDistance(px, py, profile) {
  const [[a0x, a0y], [b0x, b0y], [c0x, c0y]] = profile;
  const e0x = b0x - a0x, e0y = b0y - a0y;
  const e1x = c0x - b0x, e1y = c0y - b0y;
  const e2x = a0x - c0x, e2y = a0y - c0y;
  const v0x = px - a0x, v0y = py - a0y;
  const v1x = px - b0x, v1y = py - b0y;
  const v2x = px - c0x, v2y = py - c0y;
  const t0 = Math.min(1, Math.max(0, (v0x * e0x + v0y * e0y) / (e0x * e0x + e0y * e0y)));
  const t1 = Math.min(1, Math.max(0, (v1x * e1x + v1y * e1y) / (e1x * e1x + e1y * e1y)));
  const t2 = Math.min(1, Math.max(0, (v2x * e2x + v2y * e2y) / (e2x * e2x + e2y * e2y)));
  const q0x = v0x - e0x * t0, q0y = v0y - e0y * t0;
  const q1x = v1x - e1x * t1, q1y = v1y - e1y * t1;
  const q2x = v2x - e2x * t2, q2y = v2y - e2y * t2;
  const s = Math.sign(e0x * e2y - e0y * e2x) || 1;
  const d0 = q0x * q0x + q0y * q0y;
  const d1 = q1x * q1x + q1y * q1y;
  const d2 = q2x * q2x + q2y * q2y;
  const near = Math.min(d0, d1, d2);
  const side = Math.min(
    s * (v0x * e0y - v0y * e0x),
    s * (v1x * e1y - v1y * e1x),
    s * (v2x * e2y - v2y * e2x),
  );
  return -Math.sqrt(near) * Math.sign(side);
}

/**
 * A wedge: the triangular profile above, extruded straight through the world's
 * depth like every other solid here, so what the 2D view shows is the section
 * the physics uses.
 */
export class WedgeSDF extends OrientedSDF {
  constructor(cx, cy, cz, hw, hh, hz, rotation = {}) {
    super();
    this.hw = hw; this.hh = hh; this.hz = hz;
    this.profile = wedgeProfile(hw, hh);
    this.setPose(cx, cy, cz, rotation);
  }

  distance(x, y, z) {
    const [lx, ly, lz] = this._local(x - this.cx, y - this.cy, z - this.cz);
    const section = triangleDistance(lx, ly, this.profile);
    const depth = Math.abs(lz) - this.hz;
    if (section > 0 || depth > 0) {
      return Math.hypot(Math.max(section, 0), Math.max(depth, 0));
    }
    return Math.max(section, depth);
  }
}

export class PlaneSDF extends SDF {
  constructor(px, py, pz, nx, ny, nz) {
    super();
    const n = Math.hypot(nx, ny, nz) + 1e-12;
    this.px = px; this.py = py; this.pz = pz;
    this.nx = nx / n; this.ny = ny / n; this.nz = nz / n;
  }
  distance(x, y, z) {
    return (x - this.px) * this.nx + (y - this.py) * this.ny + (z - this.pz) * this.nz;
  }
}

/** Union of shapes: distance is the minimum over all of them. */
export class SDFScene extends SDF {
  constructor(shapes = []) {
    super();
    this.shapes = shapes;
  }
  distance(x, y, z) {
    if (this.shapes.length === 0) return Infinity;
    let d = this.shapes[0].distance(x, y, z);
    for (let i = 1; i < this.shapes.length; i++) {
      d = Math.min(d, this.shapes[i].distance(x, y, z));
    }
    return d;
  }

  /** Distance to the nearest surface *and which shape it belongs to*: a contact
   *  is with one body at a time, so the material it is made of has to come from
   *  the shape that was actually hit.
   *  @returns {[number, number]} the distance, and the index into `shapes`
   *    (-1 for an empty scene). */
  nearest(x, y, z) {
    if (this.shapes.length === 0) return [Infinity, -1];
    let best = this.shapes[0].distance(x, y, z), index = 0;
    for (let i = 1; i < this.shapes.length; i++) {
      const d = this.shapes[i].distance(x, y, z);
      if (d < best) { best = d; index = i; }
    }
    return [best, index];
  }

  /**
   * Which way is out of one shape of this scene, at a point.
   *
   * A contact is with one body at a time, and so is the normal: the surface that
   * is actually being touched is the one that has to say which way *out* is, not
   * the scene. Taking it from `gradient` here instead - a difference of
   * `distance`, which is a minimum over the shapes - is wrong exactly where two
   * surfaces are close together, which is where bodies are: the difference is
   * taken a millimetre apart, so at a point where the nearest shape changes
   * inside that millimetre, half the samples belong to one surface and half to
   * the other and the answer is a direction that is neither. A ball resting on
   * the bench at the foot of a wall then reads as a ball on a 45-degree slope:
   * it is pushed out sideways, reflects off a surface that is not there, and
   * gathers speed against nothing for as long as it is left alone - energy
   * invented on a bench with none in it.
   *
   * @param {number} index which shape, as `nearest` reported it
   */
  normalOf(index, x, y, z) {
    const shape = this.shapes[index];
    return (shape ?? this).gradient(x, y, z);
  }
}
