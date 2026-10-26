/**
 * frontend/home.js - the homepage.
 *
 * Two jobs:
 *
 *   1. The hero. The channel is not a looping tween: five marbles fall in,
 *      one after another, from out of frame above the left mouth, obey real
 *      one-dimensional gravity along the bend and collide with each other
 *      through equal-mass impulses until the line comes to rest in the
 *      middle of the bend. Then it dissolves and starts again. Nothing is
 *      keyframed, so it never repeats exactly. The simulation itself lives
 *      in channel.js (so it can run without a browser); the channel's own
 *      appearance is painted once by tube.js and cached. All this file does
 *      per frame is blit that, draw the marbles, and frost the half left of
 *      the seam.
 *
 *   2. Boilerplate: the topic picker, the routes, and booting the workbench
 *      (./main.js) only once a topic is actually chosen - so the homepage
 *      paints without three.js or the icon set. The workbench lives at
 *      /dynamics (see the routes section at the bottom of this file), which
 *      is also what makes a refresh there land on the workbench rather than
 *      throwing the user back to the homepage.
 */

import { REF, BOX, BALL, paintPanels, paintChannel, paintMarble } from './tube.js';
import { createChannel } from './channel.js';

/* ============================== the hero ============================== */
/* Held out here so the router can ask for a repaint: on a cold load of
   /dynamics the homepage is display:none before this ever runs, so the hero
   canvas has nothing to measure itself against, and it needs to size itself
   the moment the homepage is shown again. */
let heroResize = null;

(function heroChannel() {
  const cv = document.querySelector('.tube-canvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');

  const channel = createChannel();
  const marbles = channel.marbles;
  const RB = BALL.r;
  const STEP = 1 / 240;                // fixed physics step

  let bg = null;                       // panels + channel, painted per size
  const layer = document.createElement('canvas');   // marbles, full resolution
  const lctx = layer.getContext('2d');
  const frost = document.createElement('canvas');   // the same, at half size
  const fctx = frost.getContext('2d');
  let k = 1;                           // device pixels per reference unit
  let W = 0, H = 0;
  let sig = '';                        // what the last painted frame showed

  /* The frost, in reference units. Measured, not guessed: sweeping the blur
     radius against the reference frame bottoms out at 23 units, and the
     marbles left of the seam are the softest thing in the design. */
  const FROST = 23;

  /* A marble is behind the glass once its centre is past a mouth, and in
     front of it - crisp, in flight - until then. The whole point of the
     right-hand half being sharp is that the left-hand half is looking
     through something; a marble still falling in has not gone through it
     yet. Splitting it down the middle at the mouth is what makes the blur
     read as glass instead of as a smudge. */
  function inGlass(m) {
    if (m.free) return 1;
    const t = (m.s + RB) / (2 * RB);
    return t <= 0 ? 0 : t >= 1 ? 1 : t;
  }

  /* The tube's own silhouette - the wall between the two radii, below the
     mouth plane - as a clip. The frosted half is held inside it, so a
     marble's colour can spill across the wall but never off the tube: a free
     blur runs onto the backdrop, and off the bottom of the canvas. */
  function clipTube() {
    const cx = REF.cx * k, cy = (REF.cy - REF.top) * k;
    ctx.beginPath();
    ctx.arc(cx, cy, (REF.rout + 2) * k, 0, 6.2832);      // outer wall
    ctx.moveTo(cx + (REF.rin - 2) * k, cy);
    ctx.arc(cx, cy, (REF.rin - 2) * k, 0, 6.2832, true); // the hollow, wound back
    ctx.clip();
    ctx.beginPath();
    ctx.rect(0, cy, W, H - cy);                          // nothing above the mouths
    ctx.clip();
  }

  /* blit the cached backdrop, then the marbles: crisp to the right of the
     seam, pushed through heavy frost to its left */
  function paint() {
    if (!bg) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0);

    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.clearRect(0, 0, W, H);
    lctx.setTransform(k, 0, 0, k, 0, -REF.top * k);
    const entering = [];
    for (const m of marbles) {
      const [x, y] = channel.point(m);
      /* only as much of a marble as has made it inside the glass */
      const inside = inGlass(m);
      if (inside < 1) entering.push([m, x, y, inside]);
      lctx.globalAlpha = m.alpha * inside;
      paintMarble(lctx, m.spec, x, y, RB);
    }
    lctx.globalAlpha = 1;

    /* Half a resolution is plenty for the frosted half - it is about to be
       blurred past recognition anyway, and it keeps the blur cheap. */
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, frost.width, frost.height);
    fctx.drawImage(layer, 0, 0, frost.width, frost.height);

    const seam = REF.split * k;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, seam, H);
    ctx.clip();
    clipTube();
    ctx.filter = 'blur(' + (FROST * k) + 'px)';
    ctx.drawImage(frost, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(seam, 0, W - seam, H);
    ctx.clip();
    ctx.drawImage(layer, 0, 0);
    ctx.restore();

    /* whatever is still falling in is drawn sharp, in front of the glass,
       cross-fading into the frosted half as it crosses the mouth */
    if (entering.length) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, seam, H);
      ctx.clip();
      ctx.setTransform(k, 0, 0, k, 0, -REF.top * k);
      for (const [m, x, y, inside] of entering) {
        ctx.globalAlpha = m.alpha * (1 - inside);
        paintMarble(ctx, m.spec, x, y, RB);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function resize() {
    const box = cv.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(box.width * dpr));
    const h = Math.max(2, Math.round(box.height * dpr));
    if (w === W && h === H && bg) return;
    W = w; H = h;
    cv.width = W;
    cv.height = H;
    layer.width = W; layer.height = H;
    frost.width = Math.max(2, W >> 1); frost.height = Math.max(2, H >> 1);
    k = W / BOX.w;
    bg = bg || document.createElement('canvas');
    bg.width = W; bg.height = H;
    const b = bg.getContext('2d');
    paintPanels(b, W, H, k);
    paintChannel(b, W, H, k);
    sig = '';
    paint();
  }

  const still = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (still) {
    /* one calm, honest frame out of the same simulation: the line it settles
       into, held still */
    channel.seat();
    for (let t = 0; t < 1.2; t += STEP) channel.step(STEP);
  }
  /* otherwise the channel starts empty and fills: nothing is on screen until
     the first marble falls into frame a quarter of a second in */

  resize();
  window.addEventListener('resize', resize);
  heroResize = resize;

  if (still) return;

  let prev = 0;
  let acc = 0;
  let dirty = true;

  /* A still frame is still most of the time - the line rests for a couple of
     seconds, and the marbles creep by a hundredth of a pixel while it does.
     Repainting only when something actually moved keeps the hero off the CPU
     between drops without the picture ever looking asleep. */
  function signature() {
    let s = '';
    for (const m of marbles) {
      const [x, y] = channel.point(m);
      s += (Math.round(x * 4) * 8192 + Math.round(y * 4)) + ',' +
        Math.round(m.alpha * 64) + ';';
    }
    return s;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!prev) prev = now;
    let dt = (now - prev) / 1000;
    prev = now;
    if (dt > 0.05) dt = 0.05;
    /* nothing to simulate while the workbench owns the screen. A hidden tab
       needs no guard of its own: the browser stops calling us anyway. */
    if (!home || !home.hidden) {
      acc += dt;
      let guard = 0;
      while (acc >= STEP && guard++ < 24) {
        channel.step(STEP);
        acc -= STEP;
      }
      const next = signature();
      if (next !== sig) { sig = next; dirty = true; }
    }
    if (dirty) { paint(); dirty = false; }
  }
  requestAnimationFrame(frame);
})();

/* ======================== routes, picker and boot ========================
   The workbench is a real subpage rather than a hidden div: entering it puts
   /dynamics on the history stack, so the browser's own Back button leaves the
   workbench exactly the way the arrow in its title bar does, and a refresh on
   /dynamics lands back on the workbench instead of on the homepage. Anything
   else resolves to the homepage. */
const home = document.getElementById('home');
const app = document.getElementById('app');
const thermoApp = document.getElementById('thermo');
const modal = document.getElementById('topicModal');
const mechApp = document.getElementById('mech');
const fluidsApp = document.getElementById('fluids');

/* Each topic is a real subpage with its own segment, its own shell and its own
   module. Adding one is adding a row to this table and a shell to index.html -
   which is the point of the table: the router should not know what a topic is,
   only where it lives and what boots it. */
const TOPICS = {
  dynamics: { seg: 'dynamics', title: 'Dynamics Workbench', shell: () => app, boot: () => import('./main.js').then((m) => m.bootWorkbench()) },
  /* The module is named thermo_main.js and not thermo.js on purpose: the dev
     server resolves a URL to a file of the same name, and /thermo would then be
     served as the module itself rather than as the page it belongs to. */
  thermo:   { seg: 'thermo',   title: 'Thermo Workbench',   shell: () => thermoApp, boot: () => import('./thermo_main.js').then((m) => m.bootThermoWorkbench()) },
  /* Same reason again: the module is mech_main.js so that /mech is served as
     the page and not as the module. */
  mech:     { seg: 'mech',     title: 'Vibrations Workbench', shell: () => mechApp, boot: () => import('./mech_main.js').then((m) => m.bootMechWorkbench()) },
  /* And again: fluids_main.js, so /fluids is the page and not the module. */
  fluids:   { seg: 'fluids',   title: 'Fluids Workbench',   shell: () => fluidsApp, boot: () => import('./fluids_main.js').then((m) => m.bootFluidsWorkbench()) },
};

/* Derived from wherever this page was actually served from, so the routes keep
   working if the app is ever hosted under a base path rather than at /. */
const HOME_URL = (() => {
  const p = location.pathname.replace(/\/+$/, '');
  for (const { seg } of Object.values(TOPICS)) {
    if (p.endsWith('/' + seg)) return p.slice(0, -(seg.length + 1)) + '/';
  }
  return p + '/';
})();
const URL_OF = Object.fromEntries(
  Object.entries(TOPICS).map(([route, { seg }]) => [route, HOME_URL + seg]),
);

function routeOf() {
  const p = location.pathname.replace(/\/+$/, '');
  for (const [route, { seg }] of Object.entries(TOPICS)) {
    if (p.endsWith('/' + seg)) return route;
  }
  return 'home';
}

/* Each topic's module is pulled in on demand and only ever once, however many
   times the route changes afterwards. */
const boots = new Map();
function bootTopic(route) {
  if (!boots.has(route)) boots.set(route, TOPICS[route].boot());
  return boots.get(route);
}

let enteredInApp = false;

const root = document.documentElement;

function render(route) {
  const topic = TOPICS[route] ?? null;
  // the same switch the <head> sets, kept in step so in-page navigation and
  // the first paint agree on who owns the screen
  root.classList.toggle('route-workbench', !!topic);
  if (home) home.hidden = !!topic;
  document.title = topic ? topic.title : 'Physics Workbench';
  /* Leaving the page closes the picker, so coming back to the homepage never
     lands on a sheet that was left open over a bench. */
  closePicker();

  /* Exactly one shell is allowed to own the screen. A topic left behind keeps
     its own state and its own clock; it just is not the one being looked at. */
  if (app) app.hidden = route !== 'dynamics';
  if (thermoApp) thermoApp.hidden = route !== 'thermo';
  if (mechApp) mechApp.hidden = route !== 'mech';
  if (fluidsApp) fluidsApp.hidden = route !== 'fluids';

  if (!topic) {
    /* The hero canvas was never able to measure itself if the page opened on a
       workbench, so give it a chance once the homepage is back in flow. */
    if (heroResize) requestAnimationFrame(heroResize);
    return;
  }
  /* The shell is un-hidden before the boot (its layout has to be live or the
     canvas would measure 0x0), but it is held unpainted until the boot has
     actually finished - otherwise the first frames show an empty rail and a
     run button that has not been synced to the simulation yet. `booting` only
     hides it; it is still laid out underneath, so nothing shifts when it
     appears. */
  const shell = topic.shell();
  if (shell) shell.classList.add('booting');
  bootTopic(route).then(() => {
    if (shell && routeOf() === route) shell.classList.remove('booting');
  });
}

function navigate(route, { replace = false } = {}) {
  const url = URL_OF[route] ?? HOME_URL;
  if (location.pathname !== url) {
    if (replace) {
      history.replaceState({ route }, '', url);
    } else {
      history.pushState({ route }, '', url);
      enteredInApp = route !== 'home';
    }
  }
  render(route);
}

window.addEventListener('popstate', () => {
  enteredInApp = false;
  render(routeOf());
});

/* The picker: the one button on the hero opens it, and the list inside is the
   only place an experiment is chosen from. */
function openPicker() {
  modal && modal.classList.add('open');
}
function closePicker() {
  modal && modal.classList.remove('open');
}

document.getElementById('tryItBtn')?.addEventListener('click', openPicker);
document.getElementById('closeModalBtn')?.addEventListener('click', closePicker);
modal?.addEventListener('click', (e) => { if (e.target === modal) closePicker(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePicker(); });

/* The picker's icons, and the play mark on the button beside it: lucide is
   fetched once, after the page has painted, so the first frame is type and
   panels and nothing else. */
let iconsMounted = false;
function mountIcons() {
  if (iconsMounted) return;
  iconsMounted = true;
  import('lucide').then(({ createElement, ArrowRight, Play, X }) => {
    const MAP = { ArrowRight, Play, X };
    for (const el of document.querySelectorAll('[data-icon]')) {
      const node = MAP[el.dataset.icon];
      if (!node) continue;
      const old = el.querySelector(':scope > svg.lucide');
      if (old) old.remove();
      el.insertBefore(createElement(node, { width: 16, height: 16, 'stroke-width': 1.75, class: 'lucide' }), el.firstChild);
    }
  });
}

/* One row per bench, each one a link into its own workbench. The rows are real
   buttons, so Tab reaches them and Enter opens the bench - the same contract
   the benches' own lists keep. */
document.querySelectorAll('.topic-row').forEach((card) => {
  card.addEventListener('click', () => {
    if (card.disabled) return;
    const topic = card.dataset.topic;
    if (!TOPICS[topic]) return;
    closePicker();
    navigate(topic);
  });
});

/* Every workbench wears the same arrow, and it means the same thing in all of
   them. */
function backHome() {
  // Go back through the entry this session pushed, when there is one, so the
  // arrow and the browser's Back button agree; otherwise swap the URL in place
  // rather than leaving a stranded workbench URL behind the homepage.
  if (enteredInApp) history.back();
  else navigate('home', { replace: true });
}
for (const id of ['backHomeBtn', 'thermoBackHomeBtn', 'mechBackHomeBtn', 'fluidsBackHomeBtn']) {
  document.getElementById(id)?.addEventListener('click', backHome);
}

mountIcons();
render(routeOf());
