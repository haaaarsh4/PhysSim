/**
 * frontend/channel.js - the hero's physics, on its own.
 *
 * A half torus is a one-dimensional world. A marble's entire state is how
 * far along the bend it has travelled - its arclength s, 0 at the left
 * mouth, track.total at the right one - and how fast it is going.
 *
 * The forces on it are the ones a real marble in a real trough would feel:
 *
 *     gravity, along the track   a_g = k · G · cos(s / R)
 *     rolling resistance         a_r = μ · ( G·|sin(s / R)| + v² / R )
 *     air drag                   a_d = c · v
 *
 * with k = 5/7, because a solid sphere rolling without slipping spends two
 * sevenths of gravity's pull spinning itself up rather than moving. a_g runs
 * with the whole of G at either mouth (the tangent is vertical there), passes
 * through zero at the bottom of the bend and turns against the marble on the
 * far side - that is what makes the line swing, stall and fall back.
 *
 * a_r is what finally stops it. It is the resistance a rolling contact puts
 * up, so it scales with the marble's weight *against the wall* - the part of
 * gravity pressing across the track plus the v²/R the bend demands - which
 * means it bites hard through the curve and fades to nothing on the flat.
 * Unlike drag it does not care how fast the marble is going, so it takes the
 * swing down to nothing in finite time instead of leaving it creeping.
 *
 * Marbles collide through equal-mass impulses with restitution - but only
 * above an impact speed. Below it the two simply part with a common velocity,
 * which is what a real contact does and what lets a settled line stay settled
 * instead of buzzing against itself forever.
 *
 * Kept free of the DOM and of any rendering, so all of this can be simulated
 * - and checked - without a browser.
 */

import { REF, BALL, MARBLES, MARBLE_NAMES } from './tube.js';

export const TRACK = {
  R: BALL.path,                    // radius a marble's centre runs on
  RB: BALL.r,                      // marble radius
  total: Math.PI * BALL.path,      // arclength from mouth to mouth
  gap: 2 * BALL.r,                 // centre distance when two are touching
  floor: Math.PI * BALL.path / 2,  // arclength of the lowest point
};

export const ROTATION = MARBLE_NAMES.concat(['slate']);

/* arclength → point on the track */
export function at(s) {
  const th = Math.PI - s / TRACK.R;
  return [REF.cx + TRACK.R * Math.cos(th), REF.cy + TRACK.R * Math.sin(th)];
}

/* d(height)/ds, up to the 1/R: +1 at the left mouth, 0 at the bottom of the
   bend, -1 at the right one. Gravity along the track is G · slope. */
export function slope(s) {
  return Math.cos(s / TRACK.R);
}

/* A solid sphere rolling without slipping accelerates at 5/7 of the pull it
   would feel sliding; the other 2/7 goes into spin. */
const ROLLING = 5 / 7;

export function createChannel(opts = {}) {
  /* Gravity is in reference units, and the scale is the hero's own: a
     marble is 114 units across and the bend is 980 end to end, so g = 3000
     swings one across the bend in about a second - the pace of the
     reference. */
  const G = opts.gravity ?? 3000;          // reference units / s²
  /* MU is what the reference's own swing decay comes to: it gives up about
     half of its energy between the two mouths. Glass on glass is nearer
     0.01, so this reads as a heavier ball rolling in a slightly grippy
     trough - which is exactly how the reference behaves. */
  const MU = opts.rolling ?? 0.32;         // rolling resistance, dimensionless
  const DRAG = opts.drag ?? 0.05;          // air drag, 1/s
  const REST = opts.restitution ?? 0.6;    // bounciness of a marble on a marble
  const HIT = opts.impact ?? 55;           // closing speed below which a
                                           // contact is dead, units/s

  /* How many marbles make a line, how often one falls in, and how still the
     line has to be - and for how long - before the cycle lets it rest. */
  const COUNT = opts.count ?? 5;
  const DROP_EVERY = opts.dropEvery ?? 0.34;
  const DROP_JITTER = opts.dropJitter ?? 0.08;
  const QUIET = opts.quiet ?? 0.4;         // seconds of stillness that count
                                           // as stopped
  /* what counts as still: a settled line still trades a couple of units a
     second with its own contacts, and at a pixel per reference unit that is
     a hundredth of a pixel a frame */
  const STILL = opts.still ?? 8;
  const GIVE_UP = opts.giveUp ?? 7;        // ...but never wait longer than this

  /* The marbles fall in from above the canvas, so they arrive out of frame:
     one spawns off the top edge, a full radius clear of the frame, and free
     falls down the tangent into the mouth. */
  const DROP_AT = REF.top - REF.cy - TRACK.RB;
  const DROP_V = opts.dropSpeed ?? 220;    // a nudge, so it arrives moving

  /* Once the line has come to rest the shot is over: hold the still frame,
     then let the marbles dissolve and start again. */
  const HOLD = opts.hold ?? 2.4;
  const FADE = opts.fade ?? 0.9;
  const PAUSE = opts.pause ?? 0.6;
  const EXIT_LIFE = opts.exitLife ?? 0.55;

  /* a tiny LCG, so a seeded channel replays exactly - the jitter between
     drops is what keeps the line from settling into a metronome */
  let rnd = (opts.seed ?? 12345) >>> 0;
  const rand = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 4294967296);

  const marbles = [];
  let phase = 'drop';
  let timer = HOLD;
  let dropTimer = 0.15;
  let dropped = 0;
  let quiet = 0;                            // seconds the line has been still
  let sinceDrop = 0;                        // ...and since the last one fell
  let handMeDown = null;                    // the colour of the last to leave

  /* `marbles` is always ordered by arclength, rear first, so that neighbours
     in the array are neighbours on the track - which is what the collision
     pass and the lip check both assume. A new marble falls in behind
     everything, so it goes on the front of the list. */
  function spawn(spec, s, v) {
    const m = { spec, s, v, free: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, alpha: 1 };
    marbles.unshift(m);
    return m;
  }

  function nextSpec() {
    let name = handMeDown;
    if (!name || marbles.some((m) => m.spec === MARBLES[name])) {
      name = ROTATION.find((n) => !marbles.some((m) => m.spec === MARBLES[n])) || 'slate';
    }
    handMeDown = null;
    return MARBLES[name];
  }

  /* one marble, one step: see the header for what each term is */
  function advance(m, dt) {
    if (m.free) {
      m.vy += G * dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.life -= dt;
      return;
    }

    if (m.s < 0) {                         // still falling, straight down
      m.v += (G - m.v * DRAG) * dt;
      m.s += m.v * dt;
      return;
    }

    const sl = slope(m.s);
    const aG = ROLLING * G * sl;           // gravity, along the track
    const across = Math.sqrt(Math.max(0, 1 - sl * sl));
    const aR = MU * (G * across + m.v * m.v / TRACK.R);   // rolling resistance

    let a;
    if (m.v === 0) {
      /* at a standstill the contact at the marble's back can hold it, but
         only up to what rolling resistance can carry */
      if (aG <= aR && aG >= -aR) return;
      a = aG - Math.sign(aG) * aR;
    } else {
      a = aG - Math.sign(m.v) * aR - m.v * DRAG;
    }

    const v = m.v + a * dt;
    /* resistance can only take energy out: if this step would carry the
       marble through a standstill, it stops in it */
    m.v = (m.v !== 0 && v * m.v < 0 && aG <= aR && aG >= -aR) ? 0 : v;
    m.s += m.v * dt;
  }

  function collide() {
    /* Several Gauss-Seidel passes: neighbours are resolved in order, and a
       pass or two more of that is much cheaper than a matrix solve. */
    for (let pass = 0; pass < 6; pass++) {
      for (let i = 0; i < marbles.length - 1; i++) {
        const a = marbles[i], b = marbles[i + 1];
        if (a.free || b.free) continue;
        const d = b.s - a.s;
        if (d >= TRACK.gap) continue;
        /* separate them, each taking half - they are the same size */
        const push = (TRACK.gap - d) / 2;
        a.s -= push;
        b.s += push;
        const u = b.v - a.v;               // < 0 while they are closing
        if (u < 0) {
          const e = -u > HIT ? REST : 0;   // a soft touch, not a bounce
          const j = -(1 + e) * u / 2;      // equal masses, so half each way
          a.v -= j;
          b.v += j;
        }
      }
    }
  }

  function cycle(dt) {
    if (phase === 'drop') {
      dropTimer -= dt;
      sinceDrop += dt;
      const rear = marbles[0];
      /* the mouth only has to be clear of the marble still on its way down
         - not of the whole line */
      const clear = !rear || rear.free || rear.s > DROP_AT + TRACK.gap;
      if (dropped < COUNT && dropTimer <= 0 && clear) {
        spawn(nextSpec(), DROP_AT, DROP_V);
        dropped++;
        sinceDrop = 0;
        dropTimer = DROP_EVERY + rand() * DROP_JITTER;
      }
      if (dropped >= COUNT && (quiet >= QUIET || sinceDrop > GIVE_UP)) {
        phase = 'rest';
        timer = HOLD;
      }
    } else if (phase === 'rest') {
      timer -= dt;
      if (timer <= 0) { phase = 'fade'; timer = FADE; }
    } else {                               // 'fade' - the line dissolves
      timer -= dt;
      if (timer <= 0) restart();
    }
  }

  function restart() {
    marbles.length = 0;
    dropped = 0;
    quiet = 0;
    sinceDrop = 0;
    phase = 'drop';
    dropTimer = PAUSE;
  }

  function step(dt) {
    for (const m of marbles) advance(m, dt);
    collide();

    /* Over the right lip? Then it is a projectile: it leaves along the
       tangent at the mouth, which is vertical, and fades as it goes. */
    for (let i = marbles.length - 1; i >= 0; i--) {
      const front = marbles[i];
      if (front.free) continue;
      if (front.s <= TRACK.total) break;
      front.free = true;
      front.x = REF.cx + TRACK.R;
      front.y = REF.cy;
      front.vx = 0;
      front.vy = -Math.max(front.v, 60);
      front.life = EXIT_LIFE;
      handMeDown = front.spec;
    }
    for (let i = marbles.length - 1; i >= 0; i--) {
      if (marbles[i].free && marbles[i].life <= 0) marbles.splice(i, 1);
    }

    cycle(dt);

    /* stillness is the only thing that ends the drop phase, so measure it
       before the next marble is fed in */
    let fastest = 0;
    for (const m of marbles) {
      if (!m.free && Math.abs(m.v) > fastest) fastest = Math.abs(m.v);
    }
    if (fastest < STILL && marbles.length) quiet += dt; else quiet = 0;

    const fade = phase === 'fade' ? Math.max(0, timer / FADE) : 1;
    for (const m of marbles) {
      m.alpha = m.free ? Math.max(0, Math.min(1, m.life / 0.5)) : fade;
    }
  }

  /* where a marble is drawn, in reference units */
  function point(m) {
    if (m.free) return [m.x, m.y];
    if (m.s <= 0) return [REF.cx - TRACK.R, REF.cy + m.s];   // still falling in
    return at(m.s);
  }

  /* The still frame, for prefers-reduced-motion: a settled line at the bottom
     of the bend, exactly where the simulation leaves one. */
  function seat(count = COUNT) {
    marbles.length = 0;
    for (let i = count - 1; i >= 0; i--) {
      spawn(MARBLES[ROTATION[i]], TRACK.floor + (i - (count - 1) / 2) * TRACK.gap, 0);
    }
    phase = 'rest';
    timer = Infinity;
    quiet = 9;
  }

  return { marbles, step, point, seat, track: TRACK, phase: () => phase };
}
