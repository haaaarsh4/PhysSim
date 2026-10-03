/**
 * simulation/shape_dynamics.js - the shapes that can be knocked over.
 *
 * A shape in the scene is a solid with a mass, and that is the whole of this
 * file: a ball carries momentum into it, the contact is resolved at the point it
 * happened, and a hit that is not through the centre turns into torque. That is
 * the difference between a wall that slides and a wall that falls over, and it
 * is why a heavy ball thrown at a light panel knocks it flat while a light one
 * taps it aside.
 *
 * How much it weighs is not a number anyone has to guess: a shape is made of
 * something, everything has a density, and mass is density times volume. That is
 * why the model carries `density` and this file multiplies it out - so a wall
 * resized in the panel gets heavier the way a bigger wall does, the number the
 * inspector shows is the number the collision uses, and a brick wall is 351 kg
 * against a ball's fraction of one, which is why throwing it at the wall mostly
 * bounces the ball.
 *
 * A shape can still be scenery: pin it in the panel and it is `fixed`, which
 * means no body is made for it at all and the static solver owns it. A shape
 * with no density is the same thing by arithmetic, and is what a scene file
 * written before shapes had masses looks like.
 *
 * The motion is planar: shapes slide in x and y and turn about the bench's z
 * axis. That is not a shortcut taken casually. Every solid here is a profile
 * extruded through the bench's depth, and the plane of that extrusion is the
 * plane the 2D view measures and the 2D rulers are drawn on. Translation across
 * the depth is modelled, because a ball landing on a shape's front face really
 * does push it that way; rotation about the other two axes is not, because a
 * body free to tumble about them is a different kind of object than anything
 * this world contains.
 *
 * Contacts are solved the way the ball contacts are: one impulse per contact,
 * weighted by the effective mass *at the point of contact*, with Coulomb
 * friction capped by the normal impulse it hangs off. An impulse that lands
 * away from the centre of mass therefore turns the body as well as pushing it,
 * which is the whole of the tipping behaviour - there is no special case for it.
 *
 * A body standing on the floor is not a free body, though, and it must not be
 * solved as one. The floor is already holding it up, so a push at the top of a
 * wall cannot drive the wall down through the bench - the floor answers for it,
 * in the same instant, and the two impulses have to be found together. Solving
 * the ball's contact alone gives a wall that is hammered into the floor once a
 * step and flung back out again, which is not a wall being hit; it is a solver
 * arguing with itself. So the ball's contact and the body's own floor contacts
 * are one small system here, solved at once, with the floor allowed to push but
 * never pull - and the payoff is that the response *is* the textbook one: a wall
 * whose base is held cannot be pushed down, and a wall that can pivot about one
 * corner falls the way it really would.
 *
 * What is *not* here: shape against shape. Two solids are built where they do
 * not overlap, and a body shoved into another one is a rarer case than a ball
 * striking one, so a toppled wall can end up through a second wall. The floor
 * and every ball are handled.
 */
import { wedgeProfile } from "../geometry/sdf.js";

/** One step of gravity, the speed below which a contact is not a collision but a
 *  body being held up. Same rule the ball solver uses, and for the same reason:
 *  without it a body resting on the floor gains energy from its own weight. */
function restingSpeed(gravity, dt) {
  return 2 * gravity * dt;
}

/**
 * How much room a shape takes up, in cubic metres: every solid here is a
 * profile extruded straight through the world's depth, so the volume is the
 * profile's area times that depth. A wedge is half a box.
 *
 * @param {object} shape the model shape: kind, hw/hh/hd, or r for a sphere
 * @param {number} depth how deep the world is, in metres
 */
export function shapeVolume(shape, depth) {
  if (shape.kind === "ball") return (4 / 3) * Math.PI * shape.r * shape.r * shape.r;
  const hd = shape.hd ?? depth / 2;
  if (shape.kind === "wedge") return 4 * shape.hw * shape.hh * hd;
  return 8 * shape.hw * shape.hh * hd;
}

/**
 * What a shape weighs, in kilograms. A shape with no density has no mass and is
 * anchored - the same statement as pinning it by hand, and the state a shape
 * saved before the workbench knew about masses arrives in.
 */
export function shapeMass(shape, depth) {
  return (shape.density ?? 0) * shapeVolume(shape, depth);
}

/**
 * The mass properties of a shape, in the plane of the bench.
 *
 * A box of half-extents a and b spins about its own centre with I = m(a² + b²)/3
 * - the extrusion through the depth does not enter a rotation in the plane - and
 * a solid sphere is 2/5 m r². A right triangle of legs a and b is m(a² + b²)/18,
 * which is the same expression a third smaller: a wedge has less material away
 * from its centre than the box around it, so it is easier to turn.
 * @returns {null} when the shape is not a body, which is the anchored case: part
 * of the world, never moved by anything.
 */
export function massProperties(shape, depth) {
  const mass = shapeMass(shape, depth);
  if (!(mass > 0)) return null;
  let inertia;
  if (shape.kind === "ball") inertia = 0.4 * mass * shape.r * shape.r;
  else if (shape.kind === "wedge") {
    const a = 2 * shape.hw, b = 2 * shape.hh;
    inertia = (mass * (a * a + b * b)) / 18;
  } else inertia = (mass * (shape.hw * shape.hw + shape.hh * shape.hh)) / 3;
  if (!(inertia > 0)) return null;
  return { mass, invMass: 1 / mass, inertia, invInertia: 1 / inertia };
}

/** The shape's z rotation, in radians, as the model stores it. */
function shapeAngle(shape) {
  return shape.rotation?.z ?? shape.angle ?? 0;
}

/** The corners of a shape's cross-section, in its own frame, measured from the
 *  centre of mass: a box's four, or a wedge's three. These are the points that
 *  can touch the floor, so they are the points the floor solve is asked about. */
function profileOf(shape, hw, hh) {
  if (shape.kind === "wedge") return wedgeProfile(hw, hh);
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
}

/**
 * A body for one shape, or null when the shape is anchored scenery. The body is
 * built *from* the model and writes back into it, so the model stays the single
 * description of the scene and a page, a checkpoint and a restart all carry a
 * moving shape with no new plumbing.
 *
 * Because every number it needs is in the model - including the velocity it was
 * left with - a body can be rebuilt at any moment: after a mass is retyped, a
 * coefficient changed, a run restarted. It is a view of the model, not a second
 * copy of it.
 *
 * @param {object} shape a model shape: kind, x, y, rotation/angle, hw/hh/r,
 *   density, and the velocities vx, vy, vz and omega (rad/s) it was left with
 * @param {number} bounce rebound of this shape's contact with the floor
 * @param {number} friction how hard the floor grips this shape
 * @param {number} depth how deep the world is, in metres
 */
export function createBody(shape, bounce, friction, depth) {
  const props = massProperties(shape, depth);
  if (!props) return null;
  const hw = shape.hw ?? 0, hh = shape.hh ?? 0;
  return {
    shape,
    ...props,
    bounce,
    friction,
    cx: shape.x,
    cy: shape.y,
    cz: shape.z ?? 0,
    vx: shape.vx ?? 0,
    vy: shape.vy ?? 0,
    vz: shape.vz ?? 0,
    omega: shape.omega ?? 0, // rad/s about z, positive = anticlockwise
    angle: shapeAngle(shape),
    hw,
    hh,
    r: shape.r ?? 0,
    box: shape.kind !== "ball",
    profile: shape.kind === "ball" ? null : profileOf(shape, hw, hh),
  };
}

/** Write the body's pose and velocity back into the model it came from, which is
 *  what the renderer, the inspector and every page snapshot read. */
export function writeBack(body) {
  const shape = body.shape;
  shape.x = body.cx;
  shape.y = body.cy;
  shape.z = body.cz;
  const rotation = { x: shape.rotation?.x ?? 0, y: shape.rotation?.y ?? 0, z: body.angle };
  shape.rotation = rotation;
  shape.angle = body.angle; // the legacy z field the SDF and the layer read
  shape.vx = body.vx;
  shape.vy = body.vy;
  shape.vz = body.vz;
  shape.omega = body.omega;
}

/** Hand a moving body's pose to the solid the collision scene queries, so what a
 *  ball hits this step is where the shape actually is this step. */
export function syncPose(sdf, body) {
  const rotation = body.shape.rotation ?? {};
  sdf.setPose(body.cx, body.cy, body.cz, {
    x: rotation.x ?? 0, y: rotation.y ?? 0, z: body.angle,
  });
}

/** The profile of a body, in the world, with its own rotation applied. */
function profilePoints(body) {
  if (!body.profile) return [[body.cx, body.cy - body.r]];
  const c = Math.cos(body.angle), s = Math.sin(body.angle);
  return body.profile.map(([lx, ly]) => [body.cx + lx * c - ly * s, body.cy + lx * s + ly * c]);
}

/** How fast the material at a contact point is moving, from the body's own
 *  motion: centre velocity plus the spin's contribution at that lever arm. */
function pointVelocity(body, rx, ry) {
  return [body.vx - body.omega * ry, body.vy + body.omega * rx];
}

/** One impulse at a point: it changes the velocity by 1/m, and the spin by the
 *  torque the same impulse makes about the centre of mass. */
function applyImpulse(body, jx, jy, rx, ry) {
  body.vx += jx * body.invMass;
  body.vy += jy * body.invMass;
  body.omega += (rx * jy - ry * jx) * body.invInertia;
}

/**
 * The corners of a body that are on the floor this instant, as the arms a floor
 * impulse would act on.
 *
 * `target` is the normal speed the floor is willing to leave the corner with: an
 * upward one, if the body is already leaving, and zero if it is not. That is the
 * unilateral half of a contact in one number - the floor can push a corner up,
 * and it can hold one still, and it can do nothing else.
 */
function floorArms(body, floorY) {
  const arms = [];
  if (floorY === -Infinity) return arms;
  for (const [px, py] of profilePoints(body)) {
    if (py > floorY + 1e-6) continue;
    const rx = px - body.cx, ry = py - body.cy;
    const [, vy] = pointVelocity(body, rx, ry);
    /* Already on its way up: the floor is not holding this corner. The
       tolerance is not decoration. A body the floor has just settled is at rest
       to the last bit - its corner speeds come out of the last solve as ±1e-17
       - and a strict `> 0` then reads one of two symmetric corners as already
       leaving. Half a wall's support vanishes, the ball's push-out is handed to
       the body instead, and a heavy ball drives the base through the bench. */
    if (vy > 1e-9) continue;
    arms.push({ rx, ry, vy, target: 0 });
  }
  return arms;
}

/** Gaussian elimination with partial pivoting on an augmented matrix, `matrix[i]`
 *  being one row and its last entry the right-hand side.
 *  @returns {number[]|null} the solution, or null if the system is singular. */
function solveLinear(matrix) {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = col + 1; r < n; r++) {
      const factor = a[r][col] / a[col][col];
      for (let k = col; k <= n; k++) a[r][k] -= factor * a[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = a[r][n];
    for (let k = r + 1; k < n; k++) sum -= a[r][k] * x[k];
    x[r] = sum / a[r][r];
  }
  return x;
}

/**
 * The impulses for a set of contacts, solved *together*.
 *
 * One contact at a time is the obvious way and it is wrong. A wall standing on
 * two corners has both of them pressed into the floor, and stopping the left one
 * first turns the body before the right one is asked - so the second impulse
 * answers a question the first has changed the answer to. The artefact is not a
 * failure to settle but a slow rock: a standing wall oscillates a tenth of a
 * radian a second, and with friction under it a rocking wall walks. Solved as a
 * set, two symmetric corners take two symmetric impulses and the spin they would
 * have made cancels to nothing, so a wall at rest is at rest.
 *
 * The system is K j = v, where K[i][j] is the speed contact i gains per unit of
 * impulse at contact j: 1/m from the centre, plus (r_i × n_i)(r_j × n_j)/I from
 * the turn it causes. A negative impulse is a contact that is not really being
 * made - the floor holding up a body that is leaving, a corner that has already
 * lifted - so it is dropped and the rest are solved again, which is what the
 * contact set actually is.
 *
 * @param {number} size how many contacts there are
 * @param {(i:number,j:number)=>number} entry K[i][j]
 * @param {(i:number)=>number} rhs the change in speed contact i has to make -
 *   where it is now to where it is allowed to be, which is not the speed it is
 *   allowed to end up at unless it was already at rest
 * @param {number} keep how many leading contacts may never be dropped
 * @param {number} soften a hair added to the diagonal, for a contact set whose
 *   own arithmetic is degenerate - see rubOnFloor, where it is not optional
 * @returns {{impulses:number[], active:number[]}|null} each impulse with the
 *   contact it belongs to, the contacts that survived, or null if singular
 */
function solveContactSet(size, entry, rhs, keep = 0, soften = 0) {
  let active = [...Array(size).keys()];
  while (active.length) {
    const n = active.length;
    const matrix = active.map((i) => [...active.map((j) => entry(i, j) + (i === j ? soften : 0)), rhs(i)]);
    const x = solveLinear(matrix);
    if (!x) return null;
    let drop = -1;
    for (let r = keep; r < n; r++) if (x[r] < 0 && (drop < 0 || x[r] < x[drop])) drop = r;
    if (drop < 0) return { impulses: active.map((i, r) => [i, x[r]]), active };
    active = active.filter((_, r) => r !== drop);
  }
  return { impulses: [], active: [] };
}

/**
 * The bench's answer to a body standing on it.
 *
 * A ball meets the floor at a point and the point is the whole of it. A solid
 * meets it along a *face* - the base of a standing wall, the base of the ramp, a
 * plank laid down - and a face is not two points however much a profile's
 * corners make it look like one. Almost everything that was ever wrong with a
 * shape standing on the bench came out of that single substitution:
 *
 *   - Taken corner by corner, a body on a flat base rocks. An impulse at one
 *     corner stops that corner and turns the body about it, which drives the
 *     other corner into the surface; the next step stops that one and turns the
 *     body back. A ramp nudged across the bench therefore hums to itself for
 *     ever, and because its two corners are pinned in turn it walks - the
 *     artefact that reads on screen as a slope sliding off to the left on its
 *     own, long after the ball that disturbed it has rolled away.
 *   - The corners have to be taken *together*, and the floor has to be allowed
 *     to say no to one of them. A base on the floor has two corners down and
 *     both of them stopped, and once that is the answer there is no rocking
 *     left to do: a body set down on a face stays set down on it.
 *   - That one-sidedness is also what topples a wall. Shoved hard enough, the
 *     pressure under a base has to walk out to the leading edge to answer the
 *     shove, the trailing corner is asked to pull the body down - which a floor
 *     cannot do - and it lets go. The arithmetic that settles a ramp topples a
 *     wall, out of the sign of one impulse.
 *
 * So the contact set is the face and not the corner: every profile point that is
 * on the bench or within a millimetre of it. The solve is the same sequential
 * impulse the ball contacts use, run over that set a few times: each point takes
 * a push along the normal - accumulated, and never allowed to go negative, so a
 * point the body is pulling away from is a contact that is not being made and
 * drops out on its own - and a grip along the surface, never more than mu times
 * the push that same point is carrying. The push holds the body up; the grip,
 * acting along a base that is below the centre of mass, is also a torque, and
 * what answers that torque is the pressure under the base moving. That is why a
 * block slides flat rather than cartwheeling when it is shoved, and why a tall
 * enough one falls over instead.
 *
 * @returns {boolean} whether anything was touching
 */
export function resolveFloorContacts(body, floorY, gravity, dt) {
  if (floorY === -Infinity) return false;
  let contacts = floorContactSet(body, floorY);
  if (!contacts.length) return false;
  /* Out of the floor first and then stopped, in that order: both are questions
     about the same face, and the second one is about a body that is on the
     bench rather than in it. */
  liftOutOfFloor(body, contacts, dt);
  contacts = floorContactSet(body, floorY);
  if (!contacts.length) return false;
  solveFloorSet(body, contacts, dt, gravity);
  return true;
}

/** How close to the bench a point has to be to be one of the points carrying the
 *  body. A millimetre: a body at rest has its base on the floor to the last bit
 *  of a float, and a body its own last step has turned a hair is still standing
 *  on the same face. */
const CONTACT_MARGIN = 1e-3; // metres

/** How many times the push and the grip are solved against each other. They are
 *  two halves of one event and each changes the other's answer, so they are
 *  taken in turn and then taken again - the second pass is correcting a
 *  correction, and what it works with is the small term. See solveFloorSet. */
const FLOOR_PASSES = 2;

/** A hair on the diagonal, for the contact sets whose own arithmetic is
 *  degenerate. Two points along a flat base are indistinguishable to any
 *  sideways impulse - their rows are the same row - so a friction solved over
 *  both of them has no unique answer and an exact solve refuses it outright.
 *  Every body here weighs between a tenth of a gramme and a tonne, so the
 *  smallest term a matrix can honestly carry is 1e-3 and a hair of 1e-9 is six
 *  orders below it: too small to reach an answer, and still three orders above
 *  the point where the solve calls itself singular. */
const HAIR = 1e-9;

/**
 * The points of a shape that are on the bench, with the arm each one acts on.
 *
 * A box standing at an angle gives one, its lowest corner, and that is right:
 * the body really is balanced on an edge, and the face it no longer has on the
 * bench is not a face any more. A box standing flat gives two, and that is the
 * case the rest of this file turns on.
 */
function floorContactSet(body, floorY) {
  const contacts = [];
  for (const [px, py] of profilePoints(body)) {
    const gap = py - floorY;
    if (gap > CONTACT_MARGIN) continue;
    contacts.push({ rx: px - body.cx, ry: py - body.cy, gap });
  }
  return contacts;
}

/**
 * Stand the body back out of the bench, by the smallest motion that does it.
 *
 * The motion is found the way an impulse is found: the points are pushed out
 * *through the body's own inertia*, as a pseudo-velocity that is integrated into
 * the pose and never into the velocity, so that turning the body over a contact
 * is as natural as lifting it and the mass distribution picks the mix. That is
 * what makes this more than tidying up. A body goes into the floor because it
 * *turned* - a step of spin about the centre of mass swings one corner down - so
 * the height that has to come back is not the corner's own, it is that height
 * spent over the whole lever arm, and putting it back by lifting the centre of
 * mass puts back too much of it. A fraction of a millimetre of too much, every
 * step, is a body climbing the bench: an 18° ramp under a ball that has rolled
 * off it drifts away at a tenth of a metre a second, for as long as anyone
 * watches, on a bench it is merely resting on. Turned out through the contact
 * instead, the height goes back over the base it belongs to and nothing is
 * added, and a body given a spin while it lies on its base comes to rest on
 * that base rather than walking across the bench on its corners.
 *
 * The pseudo-velocity may never move a point further in - the bench pushes and
 * does not pull, here as everywhere else - so a base that is already clear is
 * left alone while the corner that is in it comes back up.
 */
function liftOutOfFloor(body, contacts, dt) {
  const lifted = solveContactSet(
    contacts.length,
    (a, b) => body.invMass + body.invInertia * contacts[a].rx * contacts[b].rx,
    (a) => Math.max(0, -contacts[a].gap) / dt,
    0,
    HAIR,
  );
  if (!lifted) return;
  let vy = 0, omega = 0;
  for (const [index, value] of lifted.impulses) {
    vy += value * body.invMass;
    omega += value * contacts[index].rx * body.invInertia;
  }
  body.cy += vy * dt;
  body.angle += omega * dt;
}

/**
 * The bench's push and the bench's grip at every point of the face, each solved
 * for all the points at once and then each solved again against the other.
 *
 * The push is what it takes to stop every point the bench is holding where it
 * is, found as a set so that the corners answer together - a body on a flat base
 * has two points down, and putting both of them at rest is what leaves it with
 * no rocking to do. Solved with the contact set instead of one point at a time,
 * the two corners of a base cannot be answered with a pair of impulses that turn
 * the body about the first one to be looked at.
 *
 * A point the body is lifting gets a negative push and is dropped, and the rest
 * are solved again - the set the bench is really holding is not the set it was
 * asked about. That single sign is the whole of tipping: shoved hard enough, the
 * pressure under a base has to move to the leading edge to answer the shove's
 * torque, the trailing point is asked to pull the body down, and it lets go.
 *
 * The grip is the impulse that would stop the sliding at each of those points,
 * solved as a set for the same reason, and then held to Coulomb *as a patch*:
 * the bench grips by the amount it was asked for, or by mu times the weight it
 * is holding, whichever is less. Per point it may not be - the grip of a base is
 * the grip of a base, not of whichever corner happens to be asked first - which
 * is also why the sharing out of it between two points on one flat base does not
 * matter and cannot: a horizontal impulse acting at one height makes the same
 * torque about the centre of mass wherever along that height it is applied.
 *
 * The two are solved in turn - the push, then the grip against it, then the push
 * again against the torque the grip is making - because each changes the other's
 * answer. The grip acts at the base, below the centre of mass, so it is a torque
 * as well as a force, and what answers that torque is the pressure under the
 * base moving towards the side the body is travelling: that is the pencil
 * rolling rather than the book sliding, and a body whose base is too short to
 * move its pressure that far is the body that falls over instead. The second
 * pass is correcting a correction, so it is the small term it works with.
 */
function solveFloorSet(body, contacts, dt, gravity) {
  const count = contacts.length;
  const mu = body.friction > 0 ? body.friction : 0;
  const resting = restingSpeed(gravity, dt);
  for (const c of contacts) {
    const vy = body.vy + body.omega * c.rx;
    /* A corner coming down slower than one step of gravity is the bench holding
       the body up, not a collision: no bounce, or a body at rest would climb. */
    const restitution = vy < 0 && -vy >= resting ? body.bounce : 0;
    c.target = -restitution * vy;
  }

  const push = new Array(count).fill(0);
  const grip = new Array(count).fill(0);
  for (let pass = 0; pass < FLOOR_PASSES; pass++) {
    /* What it takes to stop every point, given the torque the grip is already
       making: the grip turns the body, and the turn is there to be answered. */
    let lean = 0;
    for (let i = 0; i < count; i++) lean += grip[i] * contacts[i].ry;
    const normals = solveContactSet(
      count,
      (a, b) => body.invMass + body.invInertia * contacts[a].rx * contacts[b].rx,
      (a) => contacts[a].target - (body.vy + body.omega * contacts[a].rx)
        + body.invInertia * contacts[a].rx * lean,
      0,
      HAIR,
    );
    if (!normals) return;
    push.fill(0);
    for (const [index, value] of normals.impulses) push[index] = value;

    if (!(mu > 0)) continue;
    let load = 0;
    const held = [];
    for (let i = 0; i < count; i++) {
      load += push[i];
      if (push[i] > 0) held.push(i);
    }
    grip.fill(0);
    if (!held.length || !(load > 0)) continue;
    const slide = solveContactSet(
      held.length,
      (a, b) => body.invMass + body.invInertia * contacts[held[a]].ry * contacts[held[b]].ry,
      (a) => -(body.vx - body.omega * contacts[held[a]].ry),
      held.length,
      HAIR,
    );
    if (!slide) continue;
    let wanted = 0;
    for (const [, value] of slide.impulses) wanted += value;
    const cap = mu * load;
    const scale = Math.abs(wanted) > cap ? cap / Math.abs(wanted) : 1;
    for (const [row, value] of slide.impulses) grip[held[row]] = value * scale;
  }

  /* One impulse per point, push and grip together, because they act at the same
     instant at the same place: the body never sees one without the other. */
  for (let i = 0; i < count; i++) {
    applyImpulse(body, grip[i], push[i], contacts[i].rx, contacts[i].ry);
  }
}

/**
 * Coulomb's rub at every contact the floor is holding, solved together.
 *
 * The rub at one corner is bounded by mu times the push that corner is taking,
 * and one corner at a time is wrong for the same reason one normal impulse at a
 * time is: stopping the left corner's slide turns the body before the right
 * one is asked, and the right one then answers with an impulse computed against
 * a motion that no longer exists. With a body pressed hard - a wall taking a
 * blow - that overshoot is not a millimetre of creep: it is a spin, invented
 * out of a contact that had none, and a wall that tips over from it.
 *
 * So the tangential impulses are one system too. On a flat floor every one of
 * them is along x, which makes the coupling 1/m + r_iy·r_jy/I - the same
 * symmetric form the normals take, with y and x swapped. Each corner's share is
 * then held to its own cap, by scaling the whole set when one of them saturates:
 * a contact patch whose grip has run out lets go as a patch, it does not keep
 * gripping with the corner that happens to be looked at first.
 *
 * A patch, though, is exactly what makes this system degenerate - and the
 * degeneracy is the whole of an ordinary body's friction, so it cannot be
 * refused. Two corners on one flat base are at the same height, so their lever
 * arms against a *horizontal* impulse are the same number, r_y = r_y, and every
 * entry of K becomes that one number: the matrix has rank one. It is not
 * unsolvable, it is unsolvable *corner by corner* - the two corners cannot be
 * gripped independently, because nothing about a sideways push distinguishes
 * them. Solving it as if it could returns no answer, and an engine that gives up
 * there gives a wall no friction at all: nudge it and it slides away for ever,
 * at exactly the speed it was nudged with, however rough the bench is said to
 * be. The answer is the one any distribution of the grip gives - the two
 * impulses only ever enter the body's motion through their sum, which is why
 * they cannot be told apart, and why the least of them is the honest one. A hair
 * on the diagonal picks that solution out (it lies in the range of K, so the
 * hair changes nothing about it) and the corners share the grip evenly.
 */
function rubOnFloor(body, contacts, normals) {
  if (!(body.friction > 0)) return;
  const held = [];
  for (let k = 0; k < contacts.length; k++) if (normals[k] > 0) held.push(k);
  if (!held.length) return;
  /* keep = all of them: friction may act either way, so a share that comes out
     negative is a corner being gripped from the other side, not a contact that
     is not happening. The hair is what stops the flat-base set above from being
     refused. Every body here weighs between a tenth of a gramme and a tonne, so
     the smallest term the matrix can carry is 1e-3 and a hair of 1e-9 is six
     orders below it - far too small to reach an answer, and still three orders
     above the point where the solve calls itself singular. */
  const solved = solveContactSet(
    held.length,
    (a, b) => body.invMass + body.invInertia * contacts[held[a]].ry * contacts[held[b]].ry,
    (a) => {
      const { rx, ry } = contacts[held[a]];
      return -pointVelocity(body, rx, ry)[0];
    },
    held.length,
    HAIR,
  );
  if (!solved) return;
  let scale = 1;
  for (const [row, value] of solved.impulses) {
    const cap = body.friction * normals[held[row]];
    if (Math.abs(value) > cap) scale = Math.min(scale, cap / Math.abs(value));
  }
  for (const [row, value] of solved.impulses) {
    const { rx, ry } = contacts[held[row]];
    applyImpulse(body, value * scale, 0, rx, ry);
  }
}

/**
 * Advance one body: gravity, then the pose, then the floor. The model's own z
 * rotation is re-read first, so a body rotated by hand keeps that rotation and a
 * strike adds to it rather than replacing it.
 */
export function stepBody(body, dt, gravity, floorY) {
  body.angle = shapeAngle(body.shape);
  body.vy -= gravity * dt;
  body.cx += body.vx * dt;
  body.cy += body.vy * dt;
  body.cz += body.vz * dt;
  body.angle += body.omega * dt;
  resolveFloorContacts(body, floorY, gravity, dt);
  writeBack(body);
}

/** The two coefficients a contact with this shape is made of: its own where it
 *  has them, the bench's where it has not. Shared with the static solver's
 *  reading of the same shape, so a ball rebounds off a wall and a wall rebounds
 *  off the floor by one rule. */
function coefficientsOf(material, restitution, mu) {
  return {
    bounce: material?.bounce ?? restitution,
    friction: material?.friction ?? mu,
  };
}

/**
 * How much of a push the body answers with, once the floor has had its say.
 *
 * This is the compliance (1/effective mass) left in direction `n` at the contact
 * after the corners the floor is holding are accounted for: the free compliance
 * 1/m + (r × n)²/I, minus the share of it the floor takes back, which is
 * K_bf·K_ff⁻¹·K_bf. For a wall standing squarely on two corners, that subtraction
 * is the whole of it and the answer is zero - the wall cannot be pushed down,
 * because the floor is already under it - so the ball takes the entire push-out
 * and the wall stays where it is.
 *
 * @returns {number} the compliance, never negative
 */
function supportedCompliance(body, arms, rx, ry, lever, ny) {
  const free = body.invMass + lever * lever * body.invInertia;
  if (!arms.length) return free;
  const coupling = arms.map((arm) => body.invMass * ny + body.invInertia * lever * arm.rx);
  const matrix = arms.map((a, i) => [
    ...arms.map((b) => body.invMass + body.invInertia * a.rx * b.rx),
    coupling[i],
  ]);
  const x = solveLinear(matrix);
  if (!x) return free;
  let given = 0;
  for (let i = 0; i < x.length; i++) given += coupling[i] * x[i];
  return Math.max(0, free - given);
}

/**
 * A ball meeting a shape that can move.
 *
 * This is the collision that makes a shape's mass mean something, and it is the
 * same impulse the ball-to-ball solver uses, with one substitution: the second
 * body is not a point but a solid, so its share of the push is measured at the
 * contact point - where the impulse arrives. A ball hitting a wall a third of
 * the way up pushes that third, and the wall answers by turning.
 *
 * The ball's contact and the body's own floor contacts are solved as one system,
 * with the ball's contact first and never dropped. That is what a body standing
 * on the bench requires: pushed from above it cannot go down, because the floor
 * is holding it, and the two impulses that say so have to be found in the same
 * breath. Solving the ball's contact alone makes the wall answer with its own
 * weight alone, so a heavy ball hammers it into the floor once a step and the
 * floor flings it back - motion the wall never could have had - and any
 * asymmetry in the floor's reply turns into a spin that looks like a glitch
 * because it is one.
 *
 * Both halves are conservative. The impulse the ball takes, the body takes back,
 * and the positional correction that separates them is split by the same
 * compliances, so the momentum of the scene does not change in the contact: a
 * heavy ball leaves a light panel moving and a light ball leaves a heavy wall
 * alone, which is what the ratio of the two masses says should happen.
 *
 * A shape that is pinned (or has no mass) is skipped: the static solver owns it,
 * and this pass must not charge the same contact twice. The two passes divide
 * the scene between them for exactly that reason, and the caller tells the
 * static one which shapes these were.
 *
 * @param {Array<object|null>} bodies one entry per shape of `sdfScene`, in the
 *   same order and offset: entry k is the body of shape k + 1 (shape 0 is the
 *   floor). null means anchored.
 * @param {number} floorY where the floor is, so a body standing on it is solved
 *   with the bench holding it up. -Infinity to treat every body as airborne.
 * @returns {number} how many contacts were resolved
 */
export function resolveBallBodyContacts(
  ps, sdfScene, bodies, materials, restitution = 0.4, mu = 0.4, minBounce = 0.15,
  gravity = 0, floorY = -Infinity,
) {
  let contacts = 0;
  for (let i = 0; i < ps.count; i++) {
    if (!ps.active[i]) continue;
    const x = ps.posX[i], y = ps.posY[i], z = ps.posZ[i], r = ps.radius[i];
    const [distance, index] = sdfScene.nearest(x, y, z);
    const penetration = distance - r;
    if (penetration >= 0) continue;
    const body = index > 0 ? bodies[index - 1] : null;
    if (!body) continue;

    /* The normal of the shape that was hit, not of the scene around it: a ball
       wedged where a wall meets the bench would otherwise be answered with a
       normal that belongs to neither, and be flung out along it. */
    const [nx, ny, nz] = sdfScene.normalOf(index, x, y, z);
    // The point on the surfaces where they meet, which is also the lever arm
    // the strike makes about the body's centre of mass.
    const rx = x - nx * r - body.cx;
    const ry = y - ny * r - body.cy;
    const lever = rx * ny - ry * nx; // (r × n)_z: the torque per unit impulse
    const invBall = 1 / ps.mass[i];
    /* Whatever the floor is holding, it is holding right now, and the push-out
       below has to respect that as much as the impulse does: a body the floor
       supports is not shoved sideways by a correction meant for the ball. */
    const arms = floorArms(body, floorY);
    const bodyGive = supportedCompliance(body, arms, rx, ry, lever, ny);

    const overlap = -penetration;
    const total = invBall + bodyGive;
    const ballShare = total > 0 ? overlap * (invBall / total) : overlap;
    const bodyShare = overlap - ballShare;
    ps.posX[i] += nx * ballShare; ps.posY[i] += ny * ballShare; ps.posZ[i] += nz * ballShare;
    body.cx -= nx * bodyShare; body.cy -= ny * bodyShare; body.cz -= nz * bodyShare;

    /* How fast the two surfaces are closing, measured where they touch: the
       ball against the body's own motion *at that point*. The body's spin counts
       - a turning panel meets the ball with more speed on one side than the
       other, which is what makes it turn further rather than stop dead. */
    const bvx = body.vx - body.omega * ry, bvy = body.vy + body.omega * rx;
    const rvx = ps.velX[i] - bvx, rvy = ps.velY[i] - bvy, rvz = ps.velZ[i] - body.vz;
    const vn = rvx * nx + rvy * ny + rvz * nz;
    if (vn >= 0) continue; // touching but separating: no contact force, no rub

    const normalSpeed = -vn;
    const { bounce, friction } = coefficientsOf(
      materials ? materials[index] : null, restitution, mu,
    );
    /* The same height correction the static solver makes: the push-out above
       lifted the ball along the normal, and the speed that came with the lift
       has to come back out of the contact. */
    const surfaceSpeed = gravity === 0
      ? normalSpeed
      : Math.sqrt(Math.max(0, normalSpeed * normalSpeed + 2 * gravity * ny * penetration));
    const leave = normalSpeed + (normalSpeed < minBounce ? 0 : bounce) * surfaceSpeed;

    /* One system, the ball's row first. The ball's row and the floor's are
       *opposed*: an impulse at the ball's contact drives the body down, which is
       a decrease in a floor corner's upward speed, and a floor impulse holding
       the corner still is a spring the ball leans on - one statement, so the
       off-diagonal terms are the same number with a minus sign, and the system
       stays symmetric. Getting that sign wrong is not a subtle error: it asks
       the floor to pull the body *into* the bench, and the wall leaves at the
       speed of a body the floor is helping. */
    const size = arms.length + 1;
    const coupling = (arm) => -(body.invMass * ny + body.invInertia * lever * arm.rx);
    const solved = solveContactSet(
      size,
      (a, b) => {
        if (a === 0 && b === 0) return invBall + body.invMass + lever * lever * body.invInertia;
        if (a === 0) return coupling(arms[b - 1]);
        if (b === 0) return coupling(arms[a - 1]);
        return body.invMass + body.invInertia * arms[a - 1].rx * arms[b - 1].rx;
      },
      (a) => (a === 0 ? leave : arms[a - 1].target - arms[a - 1].vy),
      1,
    );
    /* A singular set means the floor's corners are in a line, which no profile
       here is; fall back to the free-body answer rather than dropping a hit. */
    const freeJ = leave / (invBall + body.invMass + lever * lever * body.invInertia);
    const impulses = solved
      ? new Map(solved.impulses)
      : new Map([[0, freeJ]]);
    const j = impulses.get(0) ?? 0;
    if (!(j > 0)) continue;
    ps.velX[i] += j * nx * invBall;
    ps.velY[i] += j * ny * invBall;
    ps.velZ[i] += j * nz * invBall;
    applyImpulse(body, -j * nx, -j * ny, rx, ry);
    body.vz -= j * nz * body.invMass;
    /* The floor's share of the same event: the reaction that keeps the body on
       the bench while the ball leans on it, and the grip that stops the shove
       from sliding it away. */
    const floorContacts = arms;
    const floorNormals = new Array(arms.length).fill(0);
    for (const [row, value] of impulses) {
      if (row === 0 || !(value > 0)) continue;
      const arm = floorContacts[row - 1];
      applyImpulse(body, 0, value, arm.rx, arm.ry);
      floorNormals[row - 1] = value;
    }
    rubOnFloor(body, floorContacts, floorNormals);
    contacts++;

    const cap = friction * j;
    if (cap <= 0) continue;
    /* Coulomb's rub, twice over: the impulse that would stop the sliding at this
       point, and never more than μ times the normal impulse above. The in-plane
       and across-the-depth parts take different amounts of the body's inertia -
       a spin in the plane has no say in a push through the depth - so each is
       worked out on its own and then the two together are held to the cap. */
    const bvx2 = body.vx - body.omega * ry, bvy2 = body.vy + body.omega * rx;
    const wx = ps.velX[i] - bvx2, wy = ps.velY[i] - bvy2, wz = ps.velZ[i] - body.vz;
    const vAfter = wx * nx + wy * ny + wz * nz;
    const tx = wx - vAfter * nx, ty = wy - vAfter * ny, tz = wz - vAfter * nz;
    const planar = Math.hypot(tx, ty);
    let px = 0, py = 0, pz = 0;
    if (planar > 1e-9) {
      const ux = tx / planar, uy = ty / planar;
      const arm = rx * uy - ry * ux;
      const invT = invBall + body.invMass + arm * arm * body.invInertia;
      /* The impulse that would stop the sliding, which is the relative speed
         divided by the compliance - the same arithmetic as the normal row
         above, and not the same arithmetic with the speed divided out again.
         Dividing by `planar` a second time made the rub a constant *mass*
         instead of a speed: a contact sliding at a millimetre a second was
         answered with the impulse that stops a whole metre a second, so a ball
         sitting on a barely-turning shape was flung sideways and the shape was
         shoved back - the wall that shivers under a ball it is holding up. */
      px = tx / invT; py = ty / invT;
    }
    if (Math.abs(tz) > 1e-9) pz = tz / (invBall + body.invMass);
    const wanted = Math.hypot(px, py, pz);
    if (wanted < 1e-12) continue;
    const scale = Math.min(1, cap / wanted);
    const jx = px * scale, jy = py * scale, jz = pz * scale;
    ps.velX[i] -= jx * invBall; ps.velY[i] -= jy * invBall; ps.velZ[i] -= jz * invBall;
    applyImpulse(body, jx, jy, rx, ry);
    body.vz += jz * body.invMass;
  }
  return contacts;
}
