/**
 * rendering/visualization.js - field/value -> color.
 *
 * Pure functions, no framework dependency: given a scalar in [0,1] (or a
 * signed value for the diverging map), return [r, g, b] in 0..1. Used by
 * rendering/renderer.js to color particle instances by speed, and could
 * equally be used to build a texture for the fluid grid's dye/velocity
 * view.
 *
 * Both maps are built out of the homepage's palette (see the :root block at
 * the top of frontend/style.css), not out of a stock scientific colormap: a
 * magnitude field runs from the page's ink at rest to its one accent, violet,
 * at full tilt, and a signed field runs ink -> violet -> ink. There is no
 * third hue anywhere in the product, so the scene never shows a color the
 * chrome cannot.
 */

/* Three stops, one hue, and no fourth colour anywhere: a muted grape at rest
   (dark enough to hold its own against the pale stage, violet enough that a
   settled scene still belongs to the same family as a moving one), then
   --home-violet itself, then that violet opened up to an orchid at the top so
   "fast" is lighter as well as more saturated.

   NOTE: these are LINEAR values, not sRGB hex. renderer.js hands them to
   THREE.Color, which takes them in the renderer's working space, so the number
   you write is not the number that lands on screen: 0.20 here is about 0.40
   after the output transform. The hexes in the comments are only the nearest
   sRGB landmark, for recognition. */
const SPEED_STOPS = [
  { t: 0.0, c: [0.2, 0.13, 0.34] }, // muted grape slate (near #6E5A92 on screen)
  { t: 0.55, c: [0.55, 0.02, 1.0] }, // --home-violet
  { t: 1.0, c: [0.75, 0.25, 1.0] }, // orchid, its own tint
];

/** @param {number} t speed, normalised to 0..1 @returns {number[]} [r,g,b] in 0..1 */
export function speedRamp(t) {
  t = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < SPEED_STOPS.length - 2 && t > SPEED_STOPS[i + 1].t) i++;
  const a = SPEED_STOPS[i];
  const b = SPEED_STOPS[i + 1];
  const k = (t - a.t) / (b.t - a.t);
  return [
    a.c[0] + (b.c[0] - a.c[0]) * k,
    a.c[1] + (b.c[1] - a.c[1]) * k,
    a.c[2] + (b.c[2] - a.c[2]) * k,
  ];
}

/** @param {number} t signed value in -1..1 @returns {number[]} [r,g,b] in 0..1 */
export function diverging(t) {
  // The midpoint is the ink, and either extreme is the same violet: the sign
  // is carried by the ramp's direction, never by a second hue.
  const ink = [0.2, 0.13, 0.34];
  const pos = [0.75, 0.25, 1.0];
  const neg = [0.55, 0.02, 1.0];
  const k = Math.min(1, Math.abs(t));
  const target = t < 0 ? neg : pos;
  return [
    ink[0] + (target[0] - ink[0]) * k,
    ink[1] + (target[1] - ink[1]) * k,
    ink[2] + (target[2] - ink[2]) * k,
  ];
}
