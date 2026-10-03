/**
 * experiments/dynamics_checks.js - does the bench still teach the right physics?
 *
 * Every lab in frontend/labs.js asserts a law in its `aim`, and a student is
 * being asked to confirm it against a number the workbench measures. That makes
 * the workbench's own accuracy the one thing that cannot be taken on trust: an
 * integrator that lags half a step, a contact that hands back more energy than
 * it absorbed, or a timestamp that lands on the nearest step instead of on the
 * surface would each turn a confirmation into a contradiction, and none of them
 * would look wrong on screen.
 *
 * So this file runs the real modules - the same ParticleSystem, the same
 * geometry/sdf.js and the same simulation/collision_system.js the browser loads
 * - through the same order of operations frontend/main.js uses per step, and
 * checks the measured against the closed-form answer. It is deliberately
 * dependency-free and DOM-free, exactly like the physics it is checking:
 * `node experiments/dynamics_checks.js` is the whole interface.
 *
 * Tolerance is 1% for the closed-form laws (the error left over from a 0.01 s
 * step is well under that) and looser where the law itself is only approximate
 * in this model (Coulomb friction's discrete contacts).
 *
 * Run directly:  npm run check
 */
import { ParticleSystem } from "../simulation/particle_system.js";
import { BoxSDF, SDFScene, WedgeSDF, wedgeProfile } from "../geometry/sdf.js";
import { resolveParticleCollisions, resolveSDFCollisions } from "../simulation/collision_system.js";
import {
  createBody, resolveBallBodyContacts, shapeVolume, stepBody, syncPose,
} from "../simulation/shape_dynamics.js";

/* The same stage the frontend builds, to the centimetre: a floor slab and the
   world bounds every default in frontend/main.js is measured against. */
const BOUNDS = { x: 1.0, y: 1.1, z: 1.0 };
const FLOOR = { halfX: 1.6, halfZ: 1.6, thickness: 0.08, y: -BOUNDS.y };
const FLOOR_Y = FLOOR.y;

function floorScene(extra = []) {
  return new SDFScene([
    new BoxSDF(0, FLOOR.y - FLOOR.thickness / 2, 0, FLOOR.halfX, FLOOR.thickness / 2, FLOOR.halfZ),
    ...extra,
  ]);
}

/** The ramp preset, as frontend/ui.js ships it: an 18° wedge whose centre of
 *  mass sits 2hh/3 above the floor, standing on its base. */
const RAMP = { hw: 0.5, hh: 0.16246 };
const ramp = (x = 0) => new WedgeSDF(
  x, FLOOR_Y + (2 * RAMP.hh) / 3, 0, RAMP.hw, RAMP.hh, BOUNDS.z,
);
const rampTheta = Math.atan(RAMP.hh / RAMP.hw);

/* ---------------------------------- the runner ---------------------------------- */

/**
 * One physics step, in the order frontend/main.js runs it. Kept in step with
 * that file by hand, so it is short and there is only one of it: gather what is
 * airborne, integrate, resolve ball-ball, resolve geometry, latch whichever
 * balls just landed, and only then read the acceleration - the one moment in
 * the step when everything that acted on a ball has acted.
 *
 * `tracked` is what the frontend's selection means to the physics: landings are
 * only worth latching for balls someone is watching.
 */
function makeStepper(ps, scene, params, tracked, bodies = null) {
  const state = { time: 0 };
  /* The shapes that can move, in the collision scene where they stand: entry k
     belongs to scene.shapes[k + 1], because shape 0 is the floor. */
  const poseBodies = () => {
    if (!bodies) return;
    for (let k = 0; k < bodies.length; k++) {
      if (bodies[k]) syncPose(scene.shapes[k + 1], bodies[k]);
    }
  };
  // Which shapes the body pass owns, so the static pass leaves them alone - the
  // same division frontend/main.js hands the two solvers.
  const owned = bodies ? [false, ...bodies.map((b) => b !== null)] : null;
  const step = () => {
    const dt = params.dt;
    const separation = (i) =>
      scene.distance(ps.posX[i], ps.posY[i], ps.posZ[i]) - ps.radius[i];

    const airborne = [];
    for (const i of tracked()) {
      if (i >= ps.count || !ps.active[i]) continue;
      const gap = separation(i);
      if (gap <= 0.005) continue;
      const closing = Math.max(0, -ps.velY[i]) * dt + 0.5 * params.gravity * dt * dt;
      airborne.push([i, gap, closing]);
    }

    const restingSpeed = 2 * params.gravity * dt;
    ps.beginStep();
    ps.integrate(dt, params.gravity, params.drag);
    if (bodies) {
      for (const body of bodies) if (body) stepBody(body, dt, params.gravity, FLOOR_Y);
      poseBodies();
    }
    if (params.collisions) resolveParticleCollisions(ps, params.restitution, 0.09 * 2.2, restingSpeed);
    if (bodies && bodies.some(Boolean)) {
      resolveBallBodyContacts(
        ps, scene, bodies, params.materials ?? null,
        params.restitution, params.friction, restingSpeed, params.gravity, FLOOR_Y,
      );
      poseBodies();
    }
    resolveSDFCollisions(
      ps, scene, params.restitution, params.friction, restingSpeed, params.gravity,
      params.materials ?? null, owned,
    );

    const landing = [];
    for (const [i, gap, closing] of airborne) {
      if (i >= ps.count || !ps.active[i]) continue;
      if (separation(i) > 0.002) continue;
      landing.push(i);
      if (ps.touchT[i] < 0) {
        const crossed = closing > 1e-9 ? gap / closing : 1;
        const fraction = Math.min(1, Math.max(0, crossed));
        ps.touchT[i] = state.time + dt * fraction;
        ps.landingRange[i] =
          ps.posX[i] - ps.velX[i] * (1 - fraction) * dt - ps.bornX[i];
      }
      ps.peakY[i] = ps.posY[i];
    }
    ps.measureAccel(dt, landing);
    state.time += dt;
    return state.time;
  };
  return { step, state };
}

function scene(params = {}) {
  const ps = new ParticleSystem(64, BOUNDS);
  const settings = {
    gravity: 9.8, restitution: 0.2, drag: 0, friction: 0, collisions: true, dt: 0.01,
    ...params,
  };
  const objectScene = params.scene ?? floorScene();
  const bodies = params.bodies ?? null;
  const watch = new Set();
  const stepper = makeStepper(ps, objectScene, settings, () => watch, bodies);
  return {
    ps, params: settings, objectScene, watch, bodies,
    step: stepper.step,
    get time() { return stepper.state.time; },
    /** Spawn one ball and watch it, the way selecting it in the UI would. */
    ball(x, y, z, vx, vy, vz, r, { watch: watchIt = true } = {}) {
      const i = ps.spawn(x, y, z, vx, vy, vz, r);
      ps.bornT[i] = stepper.state.time;
      ps.peakY[i] = y;
      if (watchIt) watch.add(i);
      return i;
    },
    drop(height, r, e, { onFloor = true } = {}) {
      const y = FLOOR_Y + r + height;
      return { i: this.ball(0, y, 0, 0, 0, 0, r), y };
    },
    /** Run until `done` or `limit` steps. */
    run(limit, done) {
      for (let s = 0; s < limit; s++) {
        this.step();
        if (done && done(s)) return true;
      }
      return false;
    },
  };
}

/* ----------------------------------- the checks ----------------------------------- */

const results = [];

function check(name, measured, expected, tolerance, unit = "", note = "") {
  const error = expected === 0 ? Math.abs(measured) : Math.abs(measured - expected) / Math.abs(expected);
  results.push({ name, measured, expected, unit, error, tolerance, note, ok: error <= tolerance });
}

function report() {
  const width = Math.max(...results.map((r) => r.name.length));
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "ok  " : "FAIL";
    if (!r.ok) failed++;
    const measured = `${r.measured.toPrecision(5)}${r.unit ? " " + r.unit : ""}`;
    const expected = `${r.expected.toPrecision(5)}${r.unit ? " " + r.unit : ""}`;
    const error = `${(r.error * 100).toFixed(2)}% (within ${(r.tolerance * 100).toFixed(1)}%)`;
    console.log(`${mark}  ${r.name.padEnd(width)}  measured ${measured.padEnd(16)} formula ${expected.padEnd(16)} ${error}`);
    if (r.note) console.log(`      ${" ".repeat(width)}  ${r.note}`);
  }
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  return failed;
}

/* --- 1. Free fall: h = ½gt², and the ball stops where the floor is --- */
{
  const w = scene();
  const { i } = w.drop(1.2, 0.06, 0);
  let fastest = 0;
  /* Speed on the way down - sampled every step so the last one before the
     contact is in there: the reflection is what happens *because* the ball
     arrived at this speed. */
  w.run(400, () => {
    fastest = Math.max(fastest, w.ps.speed(i));
    return w.ps.touchT[i] >= 0;
  });
  check("free fall: landing time", w.ps.touchT[i], Math.sqrt((2 * 1.2) / 9.8), 0.01, "s",
    "a 1.20 m drop, against sqrt(2h/g); the clock stops where the ball crossed the surface");
  check("free fall: rest height", FLOOR_Y + 0.06 - w.ps.posY[i], 0, 0.001, "m",
    "after landing the ball sits on the floor, not in it");
  check("free fall: impact speed", fastest, Math.sqrt(2 * 9.8 * 1.2), 0.01, "m/s");
}

/* --- 2. Bounce: e = sqrt(h'/h), per bounce, with no energy invented --- */
{
  for (const e of [1, 0.7]) {
    const w = scene({ restitution: e });
    const { i, y } = w.drop(1.2, 0.06, e);
    let apex = 0;
    let landed = false;
    for (let s = 0; s < 600; s++) {
      w.step();
      if (w.ps.touchT[i] >= 0 && w.ps.velY[i] > 0) landed = true; // on the way back up
      if (landed) apex = Math.max(apex, w.ps.posY[i] - (FLOOR_Y + 0.06));
      if (landed && w.ps.velY[i] < 0 && w.ps.posY[i] < y - 1.15) break;
    }
    check(`bounce e = ${e}: rebound height`, apex, e * e * 1.2, 0.03, "m",
      e === 1 ? "a perfect bounce must return to the height it was dropped from" : "h' = e²h");
  }
}

/* --- 3. A ball set down stays put: no drift, no shimmer, no measured acceleration --- */
{
  const w = scene({ restitution: 0.3, friction: 0.06 });
  const i = w.ball(-0.8, FLOOR_Y + 0.045, 0, 0, 0, 0, 0.045);
  const x0 = w.ps.posX[i], y0 = w.ps.posY[i];
  w.run(300);
  check("resting ball: drift", Math.hypot(w.ps.posX[i] - x0, w.ps.posY[i] - y0), 0, 0.001, "m",
    "3 s on the floor: a ball at rest is at rest, not creeping");
  check("resting ball: measured acceleration", w.ps.netAccel[i], 0, 0.05, "m/s²",
    "the floor cancels gravity, so the ball's own acceleration is zero");
}

/* --- 4. Projectile: range = v²sin2θ/g, and the flight time 2v sinθ/g --- */
{
  const w = scene({ restitution: 0.3, friction: 0 });
  const speed = 3, angle = 45, r = 0.045;
  const vx = speed * Math.cos((angle * Math.PI) / 180);
  const vy = speed * Math.sin((angle * Math.PI) / 180);
  const i = w.ball(-0.8, FLOOR_Y + r, 0, vx, vy, 0, r);
  w.run(400, () => w.ps.touchT[i] >= 0);
  check("projectile: flight time", w.ps.touchT[i] - w.ps.bornT[i], (2 * vy) / 9.8, 0.01, "s");
  check("projectile: range", w.ps.landingRange[i], (speed * speed * Math.sin((2 * angle * Math.PI) / 180)) / 9.8, 0.01, "m",
    "horizontal distance at the landing, which is what the formula is for");
}

/* --- 5. Collisions: momentum is conserved always, energy only sometimes --- */
{
  const setup = (e) => {
    const w = scene({ restitution: e, friction: 0, collisions: true });
    w.ball(-1.35, FLOOR_Y + 0.05, 0, 1.5, 0, 0, 0.05);
    w.ball(-0.25, FLOOR_Y + 0.05, 0, 0, 0, 0, 0.05);
    return w;
  };
  const totals = (w) => {
    let px = 0, ke = 0;
    for (let i = 0; i < w.ps.count; i++) {
      const m = w.ps.mass[i];
      px += m * w.ps.velX[i];
      ke += w.ps.kineticEnergy(i);
    }
    return { px, ke };
  };
  for (const [e, label] of [[1, "elastic"], [0, "inelastic"]]) {
    const w = setup(e);
    const before = totals(w);
    w.run(90); // one moving, one still, 1.1 m apart: this is the collision and after it
    const after = totals(w);
    check(`${label} collision: momentum`, after.px, before.px, 0.001, "kg·m/s",
      "equal masses, one at rest: the total does not blink");
    check(`${label} collision: kinetic energy`, after.ke, e === 1 ? before.ke : before.ke / 2, 0.02, "J",
      e === 1 ? "energy is not lost in a perfectly elastic collision" : "the two leave together at half speed: KE halves");
  }
}

/* --- 6. Coulomb friction: a ball sliding on the floor slows at μg --- */
{
  const mu = 0.2;
  const w = scene({ restitution: 0.2, friction: mu });
  const i = w.ball(-1.4, FLOOR_Y + 0.045, 0, 2.5, 0, 0, 0.045);
  w.run(20); // let it settle onto the floor before measuring
  const v0 = w.ps.velX[i];
  w.run(20);
  const measured = (v0 - w.ps.velX[i]) / (20 * w.params.dt);
  check("floor friction: deceleration", measured, mu * 9.8, 0.05, "m/s²", "μ·g, independent of mass and speed");
}

/* --- 7. The inclined plane: a = g(sinθ - μcosθ) --- */
{
  check("ramp: the slope is the angle the lab states", (rampTheta * 180) / Math.PI, 18, 0.01, "°",
    "the wedge's own base and height fix it: atan(hh/hw), not a rotation it was given");
  for (const mu of [0, 0.2]) {
    /* The ramp's own surface, exactly as the labs declare it in frontend/labs.js:
       μ = 0 for the idealised slope and 0.2 for the rough one. A shape carries
       its own coefficients, so the lab's number is the one that has to be here. */
    const w = scene({
      restitution: 0.05, friction: mu, scene: floorScene([ramp()]),
      materials: [null, { bounce: 0.05, friction: mu }],
    });
    /* Set down where the lab sets it down: 0.30 m above the floor on the slope,
       which on an 18° wedge is 2.7 mm of clear air above the surface and is on
       the surface, sliding, a step later. */
    const i = w.ball(0.24, FLOOR_Y + 0.30 + 0.05, 0.0, 0, 0, 0, 0.05);
    w.run(60); // land, settle, and get properly under way
    const a = w.ps.netAccel[i];
    check(`ramp μ = ${mu}: acceleration`, a, 9.8 * (Math.sin(rampTheta) - mu * Math.cos(rampTheta)), 0.06, "m/s²",
      "the ball slides; all the height goes into speed");
  }
}

/* --- 8. A shape's own surface: a wall that bounces on a bench that does not --- */
{
  /* The wall preset standing on the floor, at x = 0. Its contact is the one the
     panel's "Surface material" block edits, and the floor's is not: the two
     coefficients are per shape, so both directions have to be checked - a wall
     that answers with its own, and a wall that answers with the bench's. */
  const wall = new BoxSDF(0, -0.68, 0, 0.055, 0.42, BOUNDS.z, 0);
  for (const [benchE, wallE] of [[0, 0.8], [0.8, 0]]) {
    const w = scene({
      restitution: benchE, friction: 0, scene: floorScene([wall]),
      materials: [null, { bounce: wallE }], // index 0 is the floor: the bench's own
    });
    const i = w.ball(-0.8, -0.5, 0, 3, 0, 0, 0.06);
    let leaving = 0;
    // The wall's face is at -0.055, a ball of r = 0.06 touches it at -0.115.
    w.run(40, () => {
      if (w.ps.posX[i] < -0.12) return false;
      leaving = w.ps.velX[i];
      return true;
    });
    check(`shape material e = ${wallE} on a bench at ${benchE}: rebound`, Math.abs(leaving), 3 * wallE, 0.01, "m/s",
      "the wall answers with the coefficient its own panel carries");
  }
}

/* --- 9. Nothing tunnels: fast and small is the worst case a student can make --- */
{
  for (const [speed, r] of [[8, 0.05], [20, 0.015]]) {
    const w = scene({ restitution: 0.5, friction: 0 });
    const i = w.ball(0, 0.5, 0, 0, -speed, 0, r);
    w.run(600);
    check(`no tunneling at ${speed} m/s, r = ${r}`, w.ps.active[i] ? Math.abs(w.ps.posY[i] - (FLOOR_Y + r)) : 99, 0, 0.002, "m",
      "a ball that hits the floor is a ball that is on it, not through it");
  }
}

/* --- 10-13. A shape with a mass: the push it gives back is the push it took,
   and where the push lands decides whether it slides or falls over --- */
/**
 * A standing wall, as the scene holds one: the model shape the frontend edits,
 * the solid the solver queries, and - unless it is fixed - the body that lets it
 * be knocked over. `mass` becomes the density that produces it, so these checks
 * speak in kilogrammes and the physics speaks in kg/m³, exactly the way the panel
 * and the solver divide the work.
 *
 * The gravity is off in most of them, and `lift` holds the panel off the floor
 * as well, so the only thing that can move the numbers is the ball meeting the
 * panel - which is the whole of what is being checked. That is not a trick to
 * make the arithmetic easy: a struck wall really does pivot about its base, the
 * floor then takes a share of the event, and a check of a contact has to be able
 * to see that contact alone. The panel is still a body with the mass and the
 * inertia the solver gives it, and the checks that *are* about the floor put it
 * back down on it.
 */
function wallScene({ mass = 2, bounce = 0.6, friction = 0, fixed = false, lift = 0.5,
  hw = 0.055, hh = 0.42 } = {}) {
  const depth = BOUNDS.z * 2;
  const centre = FLOOR_Y + hh + lift;
  const shape = {
    kind: "box", hw, hh, hd: BOUNDS.z, x: 0, y: centre, z: 0,
    rotation: { x: 0, y: 0, z: 0 },
  };
  shape.density = mass / shapeVolume(shape, depth);
  const sdf = new BoxSDF(shape.x, centre, 0, hw, hh, BOUNDS.z, 0);
  return {
    centre, shape, sdf, scene: floorScene([sdf]),
    bodies: [fixed ? null : createBody(shape, bounce, friction, depth)],
  };
}

/**
 * The ramp of the inclined-plane labs as a body: the wedge the preset builds,
 * standing on its own base, at the mass its oak gives it. The lab's own surface
 * is the one it is made of here, μ = 0, so a ball sliding down it is the
 * frictionless idealisation and nothing else.
 */
function rampScene({ density = 600, bounce = 0.05, friction = 0 } = {}) {
  const depth = BOUNDS.z * 2;
  const shape = {
    kind: "wedge", hw: RAMP.hw, hh: RAMP.hh, hd: BOUNDS.z, x: 0,
    y: FLOOR_Y + (2 * RAMP.hh) / 3, z: 0, density, bounce, friction,
  };
  const body = createBody(shape, bounce, friction, depth);
  const w = scene({
    restitution: bounce, friction, scene: floorScene([ramp()]), bodies: [body],
    materials: [null, { bounce, friction }],
  });
  return { shape, body, w };
}

/**
 * A 10 kg wall of the brick preset's size, standing on the floor with the ball
 * about to land on its top edge - the scene a student builds by typing 10 over
 * the wall's 351 kg and dropping a 100 kg ball on it.
 */
function lightWallScene() {
  const depth = BOUNDS.z * 2;
  const shape = {
    kind: "box", hw: 0.055, hh: 0.42, hd: BOUNDS.z, x: 0, y: FLOOR_Y + 0.42, z: 0,
    rotation: { x: 0, y: 0, z: 0 }, bounce: 0.6, friction: 0.65,
  };
  shape.density = 10 / shapeVolume(shape, depth);
  const sdf = new BoxSDF(shape.x, shape.y, 0, shape.hw, shape.hh, shape.hd, 0);
  const wall = createBody(shape, shape.bounce, shape.friction, depth);
  const w = scene({
    restitution: 0, friction: 0, scene: floorScene([sdf]), bodies: [wall],
    materials: [null, { bounce: shape.bounce, friction: shape.friction }],
  });
  return { shape, wall, w };
}

/** One kilogramme of ball, three metres a second, straight at the panel's centre
 *  of mass: a head-on strike between two free bodies, which is the one case with
 *  an answer in the textbook. Both speeds are then closed forms - the panel
 *  leaves at (1 + e)·m₁v₁/(m₁ + m₂) and the ball at (m₁ - e·m₂)v₁/(m₁ + m₂). */
{
  const M1 = 1, M2 = 2, V = 3, E = 0.6;
  const wall = wallScene({ mass: M2 });
  const w = scene({
    gravity: 0, restitution: E, friction: 0, scene: wall.scene, bodies: wall.bodies,
    materials: [null, { bounce: E, friction: 0 }],
  });
  // The ball's own centre is the panel's centre of mass, so the push lands on
  // it: no lever arm, no spin, and the two speeds are the formulas' own.
  const i = w.ball(-0.35, wall.centre, 0, V, 0, 0, 0.05);
  w.ps.mass[i] = M1;
  const body = w.bodies[0];
  const momentum = () => w.ps.mass[i] * w.ps.velX[i] + body.mass * body.vx;
  const before = momentum();
  let worst = 0;
  w.run(40, () => { worst = Math.max(worst, Math.abs(momentum() - before)); return false; });
  check("light panel: momentum through the contact", worst, 0, 0.001, "kg·m/s",
    "equal and opposite: what the ball gives up, the panel takes, and nothing else moves it");
  check("light panel: the panel's speed", body.vx, ((1 + E) * M1 * V) / (M1 + M2), 0.01, "m/s",
    "about a metre and a half a second, off a ball that weighs half as much");
  check("light panel: the ball's speed", w.ps.velX[i], ((M1 - E * M2) * V) / (M1 + M2), 0.01, "m/s",
    "the light panel throws the ball back, slowly, because it is not heavy enough to stop it");
}

{
  /* Where the push lands is the difference between a slide and a fall. A panel
     struck above its own centre of mass topples the way the ball is travelling;
     struck below the centre it is tipped the other way; struck on the centre it
     is not turned at all. One impulse, three outcomes, and nothing in the solver
     says so: it is r × J, the lever arm, doing all of it.
     ω = (r × J)_z / I with J = (1 + e)v/(1/m₁ + 1/m₂ + d²/I) - the normal impulse
     with the panel's rotational inertia added to the pair's effective mass. */
  const M1 = 1, M2 = 2, V = 3, E = 0.6, HW = 0.055, HH = 0.42;
  const inertia = (M2 * (HW * HW + HH * HH)) / 3;
  const spinFor = (offset) => {
    const invEff = 1 / M1 + 1 / M2 + (offset * offset) / inertia;
    return (-offset * ((1 + E) * V)) / invEff / inertia;
  };
  const spin = (offset) => {
    const wall = wallScene({ mass: M2 });
    const w = scene({
      gravity: 0, restitution: E, friction: 0, scene: wall.scene, bodies: wall.bodies,
      materials: [null, { bounce: E, friction: 0 }],
    });
    const i = w.ball(-0.35, wall.centre + offset, 0, V, 0, 0, 0.05);
    w.ps.mass[i] = M1;
    w.run(30);
    return w.bodies[0].omega;
  };
  check("panel struck above its centre: spin", spin(0.2), spinFor(0.2), 0.005, "rad/s",
    "clockwise, so it falls the way the ball was going: 4.4 rad/s about its own centre");
  check("panel struck below its centre: spin", spin(-0.15), spinFor(-0.15), 0.005, "rad/s",
    "the same push on the other side of the centre of mass turns it the other way");
  check("panel struck on its centre: spin", spin(0), 0, 0.005, "rad/s",
    "a push through the centre of mass cannot turn a body: no leverage, no rotation");
}

{
  /* The strike a student builds in half a minute and then argues with: a
     hundred-kilogramme ball fired at a ten-kilogramme wall. Ten to one the
     other way round from every other strike in this file, and the case where
     "the wall should be flung, not merely nudged" stops being a guess. Free
     bodies with the gravity off, so both speeds and the spin have the textbook's
     own answers and there is nothing else in the frame to blame for a number
     that looks wrong.

     Free, and not standing on the bench. The bench is not idle in a strike: a
     wall whose base is on it is held there, the floor takes a share of the push,
     and the panel no longer answers like a free ten-kilogramme body. That is
     correct, and it is a different problem - this is the one the formulas are
     written for, and the one to check the solver against first.

     J = (1 + e)v / (1/m₁ + 1/m₂ + d²/I), and the wall leaves at
     1.6·100/110 = 1.45 times the ball's speed. */
  const M1 = 100, M2 = 10, V = 3, E = 0.6, HW = 0.055, HH = 0.42, R = 0.06;
  const inertia = (M2 * (HW * HW + HH * HH)) / 3;
  const start = 0.5 * M1 * V * V;
  const strike = (offset) => {
    const wall = wallScene({ mass: M2, bounce: E, lift: 0.5 });
    const w = scene({
      gravity: 0, restitution: E, friction: 0, scene: wall.scene, bodies: wall.bodies,
      materials: [null, { bounce: E, friction: 0 }],
    });
    /* One step of travel away, so the ball arrives at the height it was aimed
       at and the lever arm is the one on the label. */
    const i = w.ball(-HW - R - V * w.params.dt, wall.centre + offset, 0, V, 0, 0, R);
    w.ps.mass[i] = M1;
    const body = w.bodies[0];
    const momentum = () => w.ps.mass[i] * w.ps.velX[i] + body.mass * body.vx;
    const energy = () => w.ps.kineticEnergy(i)
      + 0.5 * body.mass * (body.vx * body.vx + body.vy * body.vy + body.vz * body.vz)
      + 0.5 * body.inertia * body.omega * body.omega;
    const before = momentum();
    /* The wall's state as it *leaves* the contact, which is the thing the
       formula describes. Read at the first step the ball's speed changes, not at
       the end of the run: a light panel struck a third of a metre down its own
       face is flung turning nine radians a second, and a third of a second later
       its trailing edge has come back round onto the ball. That second strike is
       real and it is meant to be there - it is the panel the student just spun,
       arriving back - so the run is allowed to continue while the impulse being
       measured is the first one. */
    let worst = 0, peak = start, struck = null, again = false;
    w.run(40, () => {
      worst = Math.max(worst, Math.abs(momentum() - before));
      peak = Math.max(peak, energy());
      const ballVx = w.ps.velX[i];
      if (!struck && Math.abs(ballVx - V) > 1e-9) {
        struck = { wallVx: body.vx, omega: body.omega, ballVx };
      } else if (struck && Math.abs(ballVx - struck.ballVx) > 1e-9) again = true;
      return false;
    });
    const J = ((1 + E) * V) / (1 / M1 + 1 / M2 + (offset * offset) / inertia);
    return { body, struck, again, worst, peak, J, momentumIn: before };
  };

  const head = strike(0);
  check("100 kg into 10 kg, head on: the wall's speed", head.struck.wallVx, head.J / M2, 0.01, "m/s",
    "1.45 times the ball's speed, off a ball ten times its mass: the number that says the strike is real");
  check("100 kg into 10 kg, head on: the ball keeps most of its speed", head.struck.ballVx, V - head.J / M1, 0.01, "m/s",
    "it loses a seventh of its speed to the wall and no more, because that is all the wall can hold");
  check("100 kg into 10 kg, head on: the wall is not spun", head.struck.omega, 0, 1e-6, "rad/s",
    "square on the centre of mass: no lever arm, no rotation, however lopsided the masses are");

  /* The same strike a third of a metre down the wall, which is where a student
     actually hits it - a ball rolling along the bench is below the centre of a
     tall panel. The push is now also a torque, and the wall is turned the way a
     push below the centre turns anything: it comes away spinning, and its top
     goes back over the ball. */
  const low = strike(-0.30);
  check("100 kg into 10 kg, 0.30 m low: the wall's speed", low.struck.wallVx, low.J / M2, 0.01, "m/s",
    "the lever arm raises the pair's rotational compliance, so the push is smaller than head on");
  check("100 kg into 10 kg, 0.30 m low: the wall's spin", low.struck.omega, (-(-0.30) * low.J) / inertia, 0.05, "rad/s",
    "9.2 rad/s anticlockwise: hit below the centre and the panel comes away turning the other way");
  check("100 kg into 10 kg, 0.30 m low: the spun panel comes back round", low.again ? 1 : 0, 1, 0.001, "",
    "and it is struck a second time, by the edge the first strike set turning: a panel is not a trampoline");

  /* And the two things no model of a contact is allowed to get wrong, whichever
     masses and whatever the lever arm. */
  for (const [name, s] of [["head on", head], ["0.30 m low", low]]) {
    check(`100 kg into 10 kg, ${name}: momentum through the contact`, s.worst, 0, 0.005, "kg·m/s",
      "equal and opposite at the instant they touch: nothing in the scene can account for a drift here");
    check(`100 kg into 10 kg, ${name}: energy invented`, s.peak, start, 0.005, "J",
      "a heavy ball may leave a light wall racing, and not one joule of the racing is invented");
  }
  check("100 kg into 10 kg: the wall's momentum", head.momentumIn - M1 * V, 0, 0.005, "kg·m/s",
    "300 kg·m/s in and 300 kg·m/s out, shared between the two of them by the ratio of their masses");
}

{
  /* A perfectly elastic strike, off centre, with no floor in the way: every
     joule the ball arrives with has to be somewhere afterwards - in the ball, in
     the panel's travel, and in the panel's spin. This is the check that says the
     rotational term is not bolted on: it is where the energy went. */
  const E = 1, M1 = 1, M2 = 2, V = 3;
  const wall = wallScene({ mass: M2, bounce: E });
  const w = scene({
    gravity: 0, restitution: E, friction: 0, scene: wall.scene, bodies: wall.bodies,
    materials: [null, { bounce: E, friction: 0 }],
  });
  const i = w.ball(-0.35, wall.centre + 0.2, 0, V, 0, 0, 0.05);
  w.ps.mass[i] = M1;
  const body = w.bodies[0];
  w.run(40);
  const after = w.ps.kineticEnergy(i)
    + 0.5 * body.mass * (body.vx * body.vx + body.vy * body.vy + body.vz * body.vz)
    + 0.5 * body.inertia * body.omega * body.omega;
  check("elastic strike off centre: energy", after, 0.5 * M1 * V * V, 0.005, "J",
    "the ball's kinetic energy turns into the panel's travel and its spin, and none is lost");
}

{
  /* The wall the picker builds, at the mass a brick wall really has, against the
     same ball on the same bench: e·v to within a percent, which is the textbook
     answer *because* the wall is two hundred times the ball. This is the check
     that says the movable shapes changed no lab: a ball that bounced off a wall
     before still bounces off the same wall, at the speed the panel predicted. */
  const wall = wallScene({ mass: 351.12, friction: 0, lift: 0 });
  const w = scene({
    restitution: 0.6, friction: 0, scene: wall.scene, bodies: wall.bodies,
    materials: [null, { bounce: 0.6, friction: 0 }],
  });
  const i = w.ball(-0.8, FLOOR_Y + 0.5, 0, 3, 0, 0, 0.06);
  let leaving = 0;
  w.run(60, () => {
    if (w.ps.posX[i] < -0.13) return false;
    leaving = w.ps.velX[i];
    return true;
  });
  check("brick wall: rebound off 351 kg", Math.abs(leaving), 0.6 * 3, 0.01, "m/s",
    "the ball cannot tell it from a wall bolted to the world");
}

{
  /* A contact that is barely sliding must be answered with a rub in proportion
     to the slide and no more. The tangential impulse is the sliding speed
     *divided* by the compliance - the same arithmetic as the normal row - and
     the ball set on a shape drifting under it has to be stopped by that rub,
     never sent back the other way. Reading the tangential impulse as a constant
     instead of as a speed is what flung a balanced ball off the wall it was
     resting on: a contact sliding at a millimetre a second was answered with
     the impulse that stops a whole metre a second, so the ball left sideways
     and the wall was shoved back.
     A 0.216 kg ball sliding at 2 cm/s on a 351 kg platform: stopping it takes
     m·u = 0.0043 kg·m/s, well under mu times the normal impulse (0.4 · 0.021 =
     0.0085), so the rub takes the whole slide out and leaves the ball at rest on
     the surface carrying it - not at -1.9 cm/s. */
  const { scene: platformScene, bodies } = wallScene({ mass: 351.12, hw: 0.5, hh: 0.05, friction: 0.4, lift: 0 });
  const w = scene({
    restitution: 0, friction: 0.4, scene: platformScene, bodies,
    materials: [null, { bounce: 0, friction: 0.4 }],
  });
  /* Let the platform sit down on the floor first, so the ball meets a shape the
     floor is already holding up rather than one still settling onto it. */
  w.run(3);
  const r = 0.06;
  const i = w.ball(0, FLOOR_Y + 2 * 0.05 + r, 0, 0.02, 0, 0, r);
  w.ps.mass[i] = 0.216;
  w.run(2);
  check("slow slide on a heavy shape: the rub stops it, it does not reverse it", w.ps.velX[i], 0, 0.002, "m/s",
    "the impulse is the sliding speed over the compliance, capped by mu·N - not a fixed shove");
}

{
  /* A body left alone is a body left alone. The floor holds it up with one step
     of impulse at a time, and if that arithmetic ever handed back more than it
     took, a wall would walk across the bench or sink into it - which is exactly
     what a collision solver that forgot its resting threshold does. */
  const wall = wallScene({ mass: 351.12, friction: 0.65, lift: 0 });
  const w = scene({ restitution: 0.6, friction: 0.65, scene: wall.scene, bodies: wall.bodies });
  w.run(300);
  const body = w.bodies[0];
  check("standing wall: drift over 3 s", Math.abs(body.cx), 0, 1e-4, "m",
    "weight and the floor's reaction cancel exactly: a tenth of a millimetre in three seconds");
  check("standing wall: sinkage", body.cy - body.hh - FLOOR_Y, 0, 1e-4, "m",
    "it stands on the floor, it does not lean into it");
  check("standing wall: speed", Math.abs(body.vy), 0, 1e-6, "m/s",
    "and the step of gravity it is given is taken back out, not merely undone by moving it");
}

{
  /* The floor holds a body up, and holding it up has to mean the velocity is
     taken out rather than only the position. A body whose fall is repaired by
     putting it back on the surface keeps every step of gravity it has ever been
     given: at rest the corner impulses come out zero, its speed grows without
     bound, and a surface with no bounce at all - a bench with restitution 0, and
     a shape inheriting it - never gets a reply in the first place. Three seconds
     of a brick wall standing on a dead floor: still standing, and still still. */
  const wall = wallScene({ mass: 351.12, bounce: 0, friction: 0.65, lift: 0 });
  const w = scene({ restitution: 0, friction: 0.65, scene: wall.scene, bodies: wall.bodies });
  w.run(300);
  const body = w.bodies[0];
  check("standing wall on a dead floor: speed", Math.abs(body.vy), 0, 1e-6, "m/s",
    "gravity is answered every step, so the body's fall never accumulates: 29.4 m/s after 3 s if it did");
  check("standing wall on a dead floor: sinkage", body.cy - body.hh - FLOOR_Y, 0, 1e-4, "m",
    "and it is still standing on the surface, not in it");
}

{
  /* The ramp of the inclined-plane lab is a 195 kg wedge, and the lab's answer
     is the textbook one only while it stays put. Its recoil under a ball is real
     and it is millimetres: what this says is that a body in the scene does not
     disturb the experiment being run on it. */
  const { body, w } = rampScene({ density: 600 });
  w.ball(0.24, FLOOR_Y + 0.35, 0, 0, 0, 0, 0.05);
  w.run(120);
  check("movable ramp: recoil under a sliding ball", Math.abs(body.cx), 0, 0.005, "m",
    "the wedge is 4000 times the ball, so the push it feels moves it millimetres");
  check("movable ramp: it does not tip", Math.abs(body.angle), 0, 0.005, "rad",
    "and it does not fall over: a wedge stands on a face, not balanced on a corner");
}

{
  /* A ramp left alone, which is the thing a plank ramp could not do: an 18°
     box touches the floor at one corner, so it rocks, walks and then lies down
     - and a slope a student sets a ball on is not allowed to fall over while
     they watch. Three seconds of nothing happening is the whole check. */
  const { body, w } = rampScene({ density: 600 });
  w.run(300);
  check("standing ramp: drift", Math.abs(body.cx), 0, 1e-4, "m", "3 s alone on the bench");
  check("standing ramp: lean", Math.abs(body.angle), 0, 1e-4, "rad",
    "it is still the same 18° slope it was built as");
  check("standing ramp: sinkage", body.cy - (2 * body.hh) / 3 - FLOOR_Y, 0, 1e-4, "m",
    "and its base is on the floor, not in it");
}

{
  /* A heavy ball onto a light wall, which is the case that used to come apart: a
     100 kg ball on top of a 10 kg wall drove the wall into the floor once a step
     and the floor flung it back out, and the reply was asymmetric enough to spin
     it - motion the wall never could have had. With the floor solved as part of
     the contact the wall's base cannot be pushed through the bench at all, so
     the check is simply that it never is. */
  const { wall, w } = lightWallScene();
  const i = w.ball(0, FLOOR_Y + 1.2 + 0.06, 0, 0, 0, 0, 0.06);
  w.ps.mass[i] = 100;
  let deepest = 0, fastest = 0, peakEnergy = 0, rebound = 0;
  const start = 100 * 9.8 * (1.2 + 0.06);
  w.run(200, () => {
    deepest = Math.min(deepest, wall.cy - wall.hh - FLOOR_Y);
    fastest = Math.max(fastest, Math.hypot(wall.vx, wall.vy));
    /* The ball's own rebound, once it has met the wall: the wall's top face is
       0.84 m above the floor, so the ball's centre falls from 1.26 to 0.90 and
       arrives at sqrt(2g·0.36) = 2.66 m/s. */
    rebound = Math.max(rebound, w.ps.velY[i]);
    const energy = w.ps.kineticEnergy(i) + w.ps.mass[i] * 9.8 * (w.ps.posY[i] - FLOOR_Y)
      + 0.5 * wall.mass * (wall.vx * wall.vx + wall.vy * wall.vy + wall.vz * wall.vz)
      + 0.5 * wall.inertia * wall.omega * wall.omega
      + wall.mass * 9.8 * (wall.cy - wall.hh - FLOOR_Y);
    peakEnergy = Math.max(peakEnergy, energy);
    return false;
  });
  check("heavy ball on a light wall: the base is never driven through the floor", deepest, 0, 1e-4, "m",
    "the floor answers in the same instant the ball pushes: a supported wall cannot be pushed down");
  check("heavy ball on a light wall: energy", peakEnergy, start, 0.01, "J",
    "the wall is flung by the ball and by nothing else: no energy appears at the contact");
  check("heavy ball on a light wall: the wall's own speed", fastest, 0, 0.2, "m/s",
    "a ball landing on the middle of the wall cannot start it moving: the push goes to the floor");
  /* And the ball reads the wall as bolted down rather than as ten kilogrammes:
     the rebound is e·v, the same number the static solver would give it, which
     is what solving the floor together with the contact is for. */
  check("heavy ball on a light wall: the ball's rebound", rebound, 0.6 * Math.sqrt(2 * 9.8 * 0.36), 0.05, "m/s",
    "the wall's mass never enters the answer: its base is on the floor, so the floor takes the push");
}

/* --- 14. The floor, for a solid: Coulomb's force, the one-sided grip, and the
   energy a body on a base is not allowed to invent --- */
/**
 * A block of the picker's size standing on the floor, shoved sideways: the model
 * shape, and the body the floor solves. `mu` is both the block's own surface and
 * the bench's, the way the lab sheet sets it.
 */
function blockScene({ density = 650, mu = 0.2, hw = 0.17, hh = 0.17, vx = 0, omega = 0 } = {}) {
  const shape = {
    kind: "box", hw, hh, hd: BOUNDS.z, x: 0, y: FLOOR_Y + hh, z: 0,
    rotation: { x: 0, y: 0, z: 0 }, density, bounce: 0, friction: mu,
  };
  const body = createBody(shape, 0, mu, BOUNDS.z * 2);
  body.vx = vx;
  body.omega = omega;
  return body;
}

const bodyEnergy = (body) => 0.5 * body.mass * (body.vx ** 2 + body.vy ** 2 + body.vz ** 2)
  + 0.5 * body.inertia * body.omega ** 2
  + body.mass * 9.8 * (body.cy - FLOOR_Y);

{
  /* The grip on a solid is a force, not a shove: mu times the push the floor is
     making, applied along the base. The push is the body's weight, so the
     deceleration is mu*g - the mass cancels and so does the speed - and the
     impulse that stops the slide is capped rather than computed, which is what
     leaves a body sliding at a metre a second still sliding at 0.8 rather than
     stopping dead and being flung back. The same law the ball's friction is
     measured against, now with a body the student built. */
  const mu = 0.2;
  const decel = (density, vx) => {
    const body = blockScene({ density, mu, vx });
    const before = body.vx;
    for (let s = 0; s < 5; s++) stepBody(body, 0.01, 9.8, FLOOR_Y);
    return (before - body.vx) / 0.05;
  };
  check("a sliding block: deceleration", decel(650, 1), mu * 9.8, 0.02, "m/s²",
    "μ·g, and the block's mass is not in the answer");
  check("a sliding block: heavy against light", decel(1200, 1), decel(200, 1), 0.001, "m/s²",
    "a tonne of brick and a box of feathers slow down at the same rate");
  check("a sliding block: fast against slow", decel(650, 1), decel(650, 0.2), 0.005, "m/s²",
    "friction does not care how fast the two surfaces are passing either");

  /* Where a slide ends: v²/2μg, which is the whole of the block's travel and
     the one number a student can measure with the ruler. */
  const body = blockScene({ mu, vx: 1 });
  for (let s = 0; s < 200; s++) stepBody(body, 0.01, 9.8, FLOOR_Y);
  check("a sliding block: where it stops", body.cx, 1 / (2 * mu * 9.8), 0.05, "m",
    "v²/2μg, to within the half step the block takes getting to rest");
  check("a sliding block: and it stays there", Math.hypot(body.vx, body.omega), 0, 1e-9, "",
    "the floor took the whole slide out, and the block is not creeping afterwards");
}

{
  /* The bench used to hand a body energy, and this is the arithmetic that did
     it: a body is put back on the surface by lifting its centre of mass by the
     depth of its deepest corner, which is more height than the body lost
     whenever the corner went in because the body *turned*. A ramp lying on its
     base and given the spin a ball leaves it with therefore climbed on its own
     corners - millimetres a step, and it never stopped, which is what a ramp
     sliding off to one side on screen was. Energy at the end of a step may be
     less than it started with, because friction is real; it may never be more. */
  const shape = {
    kind: "wedge", hw: RAMP.hw, hh: RAMP.hh, hd: BOUNDS.z, x: 0,
    y: FLOOR_Y + (2 * RAMP.hh) / 3, z: 0, rotation: { x: 0, y: 0, z: 0 },
    density: 600, bounce: 0, friction: 0.2,
  };
  const body = createBody(shape, 0, 0.2, BOUNDS.z * 2);
  body.omega = 0.5; // the spin a ball rolling down the slope leaves it with
  const start = bodyEnergy(body);
  let peak = start;
  for (let s = 0; s < 1000; s++) {
    stepBody(body, 0.01, 9.8, FLOOR_Y);
    peak = Math.max(peak, bodyEnergy(body));
  }
  check("a spin on a base: energy invented over 10 s", peak - start, 0, 0.005, "J",
    "the floor takes energy out of a body; it never puts any in");
  check("a spin on a base: how far the body got", Math.abs(body.cx), 0, 1e-4, "m",
    "and a body on a face is stopped by it, not walked across the bench by it");
  check("a spin on a base: it is at rest", Math.hypot(body.vx, body.omega), 0, 1e-6, "",
    "the base took the spin out of it the same instant it took the slide out of a shove");
}

{
  /* One-sidedness, which is what a floor is and a spring is not. A tall thin
     wall shoved along the bench needs its pressure to move to the leading edge
     to answer the shove's torque; its base is too short to move the pressure
     that far, so the trailing corner is asked to pull the body down, the floor
     refuses, and the wall goes over. It then has to *land*: a wall lying on its
     side is a body on a face again, and a face that rocks for ever on its own
     corners is the same bug as the ramp wearing a different hat. */
  const tall = blockScene({ density: 1900, mu: 0.65, hw: 0.055, hh: 0.42, vx: 1 });
  const launch = bodyEnergy(tall);
  let peak = launch;
  for (let s = 0; s < 1200; s++) {
    stepBody(tall, 0.01, 9.8, FLOOR_Y);
    peak = Math.max(peak, bodyEnergy(tall));
  }
  check("a tall wall shoved: it falls over", (tall.angle * 180) / Math.PI, -90, 0.01, "°",
    "μ·h = 0.27 m of pressure shift on a base 0.11 m wide: it cannot answer the shove, so it goes over");
  check("a tall wall that fell: it lies still", Math.hypot(tall.vx, tall.omega), 0, 1e-6, "",
    "landed on its side, and a face on the floor is not a rocking chair");
  check("a tall wall that fell: energy invented", peak - launch, 0, 0.005, "J",
    "and every joule it spent going over came out of the shove");

  /* A base long enough to move the pressure the mu·h it needs slides instead,
     however hard it is shoved: the same arithmetic, the other answer. */
  const flat = blockScene({ density: 600, mu: 0.4, hw: 0.5, hh: 0.05, vx: 1 });
  for (let s = 0; s < 600; s++) stepBody(flat, 0.01, 9.8, FLOOR_Y);
  check("a flat block shoved: it slides, it does not cartwheel", Math.abs(flat.angle), 0, 1e-3, "rad",
    "μ·h = 0.02 m of shift on a base a metre wide: the pressure has room, and the block stays flat");
}

{
  /* The ramp of the inclined-plane lab again, with the ball that disturbs it and
     the bench's own friction under it: the recoil is real and it is millimetres,
     and what this says is that it is over. A slope that is still creeping three
     seconds after the ball has rolled off it is a slope the engineering has gone
     out of - which is exactly what the lab sheet showed. */
  const { body, w } = rampScene({ density: 600, friction: 0.2 });
  w.ball(0.24, FLOOR_Y + 0.35, 0, 0, 0, 0, 0.05);
  w.run(600);
  const rested = body.cx;
  w.run(1200);
  check("movable ramp: it stops and stays stopped", body.cx - rested, 0, 1e-5, "m",
    "six seconds after the ball has gone, the ramp has not moved a hundredth of a millimetre");
  check("movable ramp: total drift over 18 s", Math.abs(body.cx), 0, 0.01, "m",
    "the recoil under a 4000-to-1 ball is millimetres, and it stays millimetres");
}

process.exitCode = report() ? 1 : 0;
