/**
 * rendering/fluid3d_renderer.js - the Fluids tank, in three dimensions.
 *
 * The solver hands over a cloud of particles and nothing else. This file turns
 * that cloud into a surface, and the surface is not a mesh: it is found per
 * pixel, by walking the view ray through a three-dimensional density field the
 * particles are splatted into and stopping at the first place the density
 * crosses the surface level.
 *
 * The difference matters. A polygonised field is only as smooth as its grid,
 * and a thin body of liquid - a pool a few particles deep - turns into a
 * crumpled sheet of overlapping triangles as soon as the isosurface and the
 * cells disagree. Marching the same field analytically gives one continuous
 * skin, a normal that is the field's own gradient, and a depth into the liquid
 * with which to shade absorption: thick honey is dark, a thin lip of it is
 * bright, and neither is a flat colour.
 *
 * Nothing here decides physics. It reads the solver's arrays, and the optical
 * constants it uses for water, oil and honey are the material presets the rail
 * picks.
 */
import * as THREE from "three";

import { OrbitCameraController } from "./camera.js";

/** How the three liquids look. The numbers are optical, not physical: what a
 *  litre of each does to the light that crosses it. `shallow` and `deep` are
 *  the colour of a thin film and of a body thick enough to swallow the light;
 *  `absorb` is how quickly one becomes the other, in metres. */
export const LIQUID_LOOKS = {
  water: {
    shallow: 0x5fc6d8,
    deep: 0x0d6a7d,
    absorb: 0.34,
    gloss: 260,
    spec: 1.5,
    rim: 0.16,
    sky: 0xa9d7e4,
  },
  oil: {
    /* Olive oil: a pale, almost clear gold that only deepens where the light
       crosses a lot of it. */
    shallow: 0xffe08a,
    deep: 0xd19a2a,
    absorb: 0.26,
    gloss: 300,
    spec: 1.8,
    rim: 0.16,
    sky: 0xffd79a,
  },
  honey: {
    /* Honey: the same gold, but a body of it swallows the light in centimetres,
       so the deep colour is a burnt amber rather than a brown-black. */
    shallow: 0xffc23f,
    deep: 0xa8490a,
    absorb: 0.07,
    gloss: 340,
    spec: 2.1,
    rim: 0.18,
    sky: 0xffc46b,
  },
};

const SPEED_RAMP = [
  [0.0, new THREE.Color(0x1f3b8f)],
  [0.25, new THREE.Color(0x1a86c9)],
  [0.5, new THREE.Color(0x2fc0b4)],
  [0.75, new THREE.Color(0xe8d24a)],
  [1.0, new THREE.Color(0xe8582f)],
];

/** A light studio as an equirectangular texture: white above, cool below, one
 *  warm window. The tank has no walls of its own, and the liquid needs
 *  something to reflect. */
function makeStudioEnvironment() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, "#ffffff");
  sky.addColorStop(0.42, "#f2f2f8");
  sky.addColorStop(0.5, "#e4e2ee");
  sky.addColorStop(0.62, "#d8d6e4");
  sky.addColorStop(1, "#b9b6c8");
  g.fillStyle = sky;
  g.fillRect(0, 0, 512, 256);

  const warm = g.createRadialGradient(120, 78, 4, 120, 78, 92);
  warm.addColorStop(0, "rgba(255,252,244,1)");
  warm.addColorStop(0.4, "rgba(255,248,232,0.55)");
  warm.addColorStop(1, "rgba(255,248,232,0)");
  g.fillStyle = warm;
  g.fillRect(0, 0, 512, 256);

  const cool = g.createRadialGradient(400, 110, 6, 400, 110, 120);
  cool.addColorStop(0, "rgba(226,238,255,0.85)");
  cool.addColorStop(1, "rgba(226,238,255,0)");
  g.fillStyle = cool;
  g.fillRect(0, 0, 512, 256);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Separable 1-2-1 blur over a cubic grid, all three axes.
 *
 * The three sweeps ping-pong between two buffers. They used to write all of
 * them into the same destination, which meant the middle sweep was thrown away
 * and the field was never smoothed vertically: every surface that ran up a wall
 * came out with a sawtooth one cell tall, and the steep faces were striped. */
function blurField(field, n, scratch) {
  const n2 = n * n;
  const tmp = scratch ?? new Float32Array(field.length);

  /* x: field -> tmp */
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      const row = z * n2 + y * n;
      for (let x = 0; x < n; x++) {
        const a = field[row + Math.max(0, x - 1)];
        const b = field[row + x];
        const c = field[row + Math.min(n - 1, x + 1)];
        tmp[row + x] = (a + 2 * b + c) * 0.25;
      }
    }
  }

  /* y: tmp -> field */
  for (let z = 0; z < n; z++) {
    for (let y = 0; y < n; y++) {
      const row = z * n2 + y * n;
      const up = z * n2 + Math.max(0, y - 1) * n;
      const dn = z * n2 + Math.min(n - 1, y + 1) * n;
      for (let x = 0; x < n; x++) {
        field[row + x] = (tmp[up + x] + 2 * tmp[row + x] + tmp[dn + x]) * 0.25;
      }
    }
  }

  /* z: field -> tmp */
  for (let z = 0; z < n; z++) {
    const zp = Math.max(0, z - 1) * n2;
    const zn = Math.min(n - 1, z + 1) * n2;
    const zc = z * n2;
    for (let y = 0; y < n; y++) {
      const row = y * n;
      for (let x = 0; x < n; x++) {
        const i = row + x;
        tmp[zc + i] = (field[zp + i] + 2 * field[zc + i] + field[zn + i]) * 0.25;
      }
    }
  }

  field.set(tmp);
}

/** Smooth the field along each wall, in the two directions the wall runs.
 *
 * Where the surface meets the glass the edge the eye follows is a *contact
 * line*: the height at which the isosurface crosses the wall plane. That height
 * is read off the density a cell or two inside the glass, and a particle
 * lattice is a ripple at exactly that scale, so the line comes out one particle
 * spacing tall and stepped - the staircase along the glass. Blurring the whole
 * field enough to remove it would round the waves away as well.
 *
 * Blurring only the slab against each wall, and only *along* the wall, removes
 * the ripple from the line without touching the body of the liquid or moving
 * the surface off the glass. The slab is a few cells deep because the walk to
 * the iso crossing happens within that distance of the wall. */
function smoothWallSlabs(field, n, passes = 2, depth = 3) {
  const n2 = n * n;
  const m = Math.min(depth, n - 1);
  const line = new Float32Array(n);

  /* One axis, one run of cells: a 1-2-1 sweep held back until the whole run is
     read, so it is a blur and not a smear. */
  const sweep = (cells) => {
    for (let i = 0; i < cells.length; i++) line[i] = field[cells[i]];
    for (let i = 0; i < cells.length; i++) {
      const a = line[Math.max(0, i - 1)];
      const b = line[i];
      const c = line[Math.min(cells.length - 1, i + 1)];
      field[cells[i]] = (a + 2 * b + c) * 0.25;
    }
  };

  const run = new Int32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < m; k++) {
      /* the two x walls, blurred along y and along z */
      for (const x of [k, n - 1 - k]) {
        for (let z = 0; z < n; z++) {
          for (let y = 0; y < n; y++) run[y] = z * n2 + y * n + x;
          sweep(run);
        }
        for (let y = 0; y < n; y++) {
          for (let z = 0; z < n; z++) run[z] = z * n2 + y * n + x;
          sweep(run);
        }
      }
      /* the two z walls, along x and along y */
      for (const z of [k, n - 1 - k]) {
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) run[x] = z * n2 + y * n + x;
          sweep(run);
        }
        for (let x = 0; x < n; x++) {
          for (let y = 0; y < n; y++) run[y] = z * n2 + y * n + x;
          sweep(run);
        }
      }
      /* the floor, along x and along z - it is a wall too, and the waterline
         along the base of the glass is the same staircase seen from below */
      for (const y of [k]) {
        for (let z = 0; z < n; z++) {
          for (let x = 0; x < n; x++) run[x] = z * n2 + y * n + x;
          sweep(run);
        }
        for (let x = 0; x < n; x++) {
          for (let z = 0; z < n; z++) run[z] = z * n2 + y * n + x;
          sweep(run);
        }
      }
    }
  }
}

function rampColor(t, out) {
  const x = Math.min(1, Math.max(0, t));
  for (let i = 1; i < SPEED_RAMP.length; i++) {
    if (x <= SPEED_RAMP[i][0]) {
      const [t0, c0] = SPEED_RAMP[i - 1];
      const [t1, c1] = SPEED_RAMP[i];
      const k = (x - t0) / Math.max(1e-6, t1 - t0);
      return out.copy(c0).lerp(c1, k);
    }
  }
  return out.copy(SPEED_RAMP[SPEED_RAMP.length - 1][1]);
}

const VERTEX_SHADER = /* glsl */ `
  out vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  precision highp float;
  precision highp sampler3D;

  uniform sampler3D uField;
  uniform sampler3D uColorField;
  uniform bool uUseData;

  uniform vec3 uBoxMin;
  uniform vec3 uBoxMax;
  uniform vec3 uLiveMin;
  uniform vec3 uLiveMax;

  uniform float uIso;
  uniform float uStep;
  uniform float uCell;

  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uAbsorb;
  uniform float uGloss;
  uniform float uSpec;
  uniform float uRim;
  uniform vec3 uSky;

  uniform vec3 uKeyDir;
  uniform vec3 uFillDir;
  uniform float uSurfaceY;
  uniform float uDebug;
  uniform vec3 uCam;
  uniform vec3 uCamRight;
  uniform vec3 uCamUp;
  uniform float uPixel;

  uniform mat4 uProj;
  uniform mat4 uView;

  in vec3 vWorld;
  out vec4 fragColor;

  /** Density at a point, the tank's own liquid continued through the glass.
   *
   * A point outside the tank is reflected back through the wall it is past and
   * read there. This matters for the *gradient*, not for the surface: the
   * normal is a difference of two samples three cells apart, and within three
   * cells of a wall that stencil used to reach outside the tank and read zero.
   * Half the slope vanished, the normal turned towards the wall, and the liquid
   * grew a flat band about three cells wide along every pane and along the
   * floor - a rectangle, with a hard edge where the stencil started landing
   * inside again. Reflecting costs a comparison per axis and removes the band
   * at its cause.
   *
   * The tolerance at the boundary is not cosmetic. A ray that enters the box
   * lands on uvw exactly 0 or 1, and in floating point that is as often
   * 1.0000001 as 0.9999999; a strict comparison then returns zero for half the
   * pixels along the face and the liquid grows a stippled, dotted edge exactly
   * where it touches the glass. */
  float density(vec3 p) {
    vec3 span = uBoxMax - uBoxMin;
    vec3 q = p;
    if (q.x < uBoxMin.x) q.x = 2.0 * uBoxMin.x - q.x;
    else if (q.x > uBoxMax.x) q.x = 2.0 * uBoxMax.x - q.x;
    if (q.z < uBoxMin.z) q.z = 2.0 * uBoxMin.z - q.z;
    else if (q.z > uBoxMax.z) q.z = 2.0 * uBoxMax.z - q.z;
    /* A floor and no lid: below the floor the body continues, above the tank
       there is only air, so only the floor is reflected. */
    if (q.y < uBoxMin.y) q.y = 2.0 * uBoxMin.y - q.y;
    vec3 uvw = (q - uBoxMin) / span;
    if (uvw.x < -0.002 || uvw.y < -0.002 || uvw.z < -0.002 ||
        uvw.x > 1.002 || uvw.y > 1.002 || uvw.z > 1.002) return 0.0;
    return texture(uField, clamp(uvw, 0.0, 1.0)).r;
  }

  vec3 dataColor(vec3 p) {
    vec3 uvw = (p - uBoxMin) / (uBoxMax - uBoxMin);
    return texture(uColorField, clamp(uvw, 0.0, 1.0)).rgb;
  }

  /** The entry and exit distances of a ray through an axis-aligned box. */
  vec2 hitBox(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
    vec3 inv = 1.0 / rd;
    vec3 t0 = (lo - ro) * inv;
    vec3 t1 = (hi - ro) * inv;
    vec3 tmin = min(t0, t1);
    vec3 tmax = max(t0, t1);
    return vec2(max(max(tmin.x, tmin.y), tmin.z),
                min(min(tmax.x, tmax.y), tmax.z));
  }

  /** The density slope, sampled over three cells.
   *
   * Wide on purpose. The texture is interpolated linearly, so the slope inside
   * one cell is constant and changes only when a sample crosses a cell wall: at
   * the near-vertical face of a column of liquid that paints the surface in
   * vertical stripes one cell wide. Two taps three cells apart average the kink
   * out without touching a wave five cells across. */
  vec3 gradient(vec3 p) {
    float e = uCell;
    float w = uCell * 3.0;
    return vec3(
      (density(p + vec3(w, 0.0, 0.0)) - density(p - vec3(w, 0.0, 0.0))) * 0.8
        + (density(p + vec3(e, 0.0, 0.0)) - density(p - vec3(e, 0.0, 0.0))) * 0.2,
      (density(p + vec3(0.0, w, 0.0)) - density(p - vec3(0.0, w, 0.0))) * 0.8
        + (density(p + vec3(0.0, e, 0.0)) - density(p - vec3(0.0, e, 0.0))) * 0.2,
      (density(p + vec3(0.0, 0.0, w)) - density(p - vec3(0.0, 0.0, w))) * 0.8
        + (density(p + vec3(0.0, 0.0, e)) - density(p - vec3(0.0, 0.0, e))) * 0.2
    );
  }

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec3 aces(vec3 x) {
    return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
  }

  /* Sixteen sub-pixel rays, one per sub-cell of a four by four grid, so each
     counts for a sixteenth of the pixel. A raymarcher decides coverage inside
     the shader, so the framebuffer cannot antialias it: the silhouette of the
     liquid is one pixel hard. Sixteen levels are finer than the eye resolves
     at this scale. */
  /* Sixteen sub-pixel rays. The first four are the pixel's own corners, at
     exactly half a pixel, and everything after them is inside: the corner
     quartet is what settles a pixel in four rays, and it only settles it
     soundly if those four really are the corners. They used to be one row of
     sub-cell centres, which left the outer eighth of the pixel untested - a
     shallow edge ran through that strip unseen, and every grazing waterline
     came out as a comb of full and half-covered pixels. */
  const vec2 SAMPLES[16] = vec2[16](
    vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5), vec2(0.5, 0.5),
    vec2(-0.375, -0.375), vec2(-0.125, -0.375), vec2(0.125, -0.375), vec2(0.375, -0.375),
    vec2(-0.375, -0.125), vec2(-0.125, -0.125), vec2(0.125, -0.125), vec2(0.375, -0.125),
    vec2(-0.375,  0.125), vec2(-0.125,  0.125), vec2(0.125,  0.125), vec2(0.375,  0.125)
  );

  /** Walk one ray to the liquid.
   *
   * Returns the distance at which it crosses the surface, or a negative number
   * for a miss. cov is that sample's coverage of the pixel: one for a hit,
   * and for a miss the fraction implied by how near the ray came. That second
   * number is what turns a hard one-pixel silhouette into a soft one.
   * entered is set when the ray was already inside the body at the tank wall:
   * a cut through liquid behind glass, not a free surface with air above. */
  float march(vec3 ro, vec3 rd, float tStart, float tEnd, out float cov, out bool entered) {
    cov = 0.0;
    entered = false;
    if (tEnd <= tStart) return -1.0;

    for (int i = 0; i < 460; i++) {
      if (tStart > tEnd) break;
      if (density(ro + rd * tStart) > uIso) {
        float a = max(tStart - uStep, 0.0);
        float b = tStart;
        for (int k = 0; k < 7; k++) {
          float m = 0.5 * (a + b);
          if (density(ro + rd * m) > uIso) b = m; else a = m;
        }
        /* A body that starts at the glass rather than at a free surface. */
        if (b - tStart < uStep * 1.5 && i < 1) entered = true;
        cov = 1.0;
        return b;
      }
      tStart += uStep;
    }

    /* A miss. Coverage stays zero: the four sub-pixel rays are the whole of the
       antialiasing, so a pixel edge is a count out of four and nothing else. */
    return -1.0;
  }

  /** Liquid in front of the eye along this ray, as a Beer-Lambert path length:
   *  the density field itself integrated step by step, not the distance from a
   *  bounding box. This is what makes a thin lip bright and a deep body dark,
   *  and because it is measured from the same field that draws the surface it
   *  cannot draw a straight seam across the pool where a box happens to end. */
  float pathLength(vec3 p, vec3 rd, float maxLen, float jitter) {
    float s = uCell * 1.6;
    float norm = max(uIso / 0.42, 1e-4);
    float acc = 0.0;
    /* Jittered trapezoid, not a box sum. A fixed step quantises the integral
       into whole steps, and on a face seen at a grazing angle those steps are
       bands one cell wide straight down the body - the dark stripe that reads
       as a seam. Integrating the segment between samples, and starting each
       sub-ray at a different fraction of a step, turns the quantisation into
       something the sixteen samples average away. */
    float t = s * (0.15 + 0.7 * jitter);
    float prev = clamp(density(p) / norm, 0.0, 1.0);
    for (int i = 0; i < 56; i++) {
      if (t >= maxLen) break;
      float tt = min(t + s, maxLen);
      float cur = clamp(density(p + rd * tt) / norm, 0.0, 1.0);
      acc += 0.5 * (prev + cur) * max(tt - t, 0.0);
      prev = cur;
      t = tt;
    }
    return acc;
  }

  vec3 shade(vec3 p, vec3 rd, float tExit, float jitter) {
    vec3 v = -rd;

    float thick = clamp(pathLength(p + rd * uCell * 0.5, rd, max(tExit, uCell), jitter), 0.0, 1.4);
    vec3 body = mix(uShallow, uDeep, 1.0 - exp(-thick / uAbsorb));

    vec3 g = gradient(p);
    vec3 n = length(g) > 1e-5 ? normalize(-g) : v;
    if (uDebug > 1.5 && uDebug < 2.5) return vec3(0.5) + 0.5 * n;
    if (uDebug > 2.5 && uDebug < 3.5) return body * 2.0;

    float ndl = max(dot(n, uKeyDir), 0.0);
    float ndf = max(dot(n, uFillDir), 0.0);
    vec3 base = uUseData ? dataColor(p) : body;

    /* --- the free surface: a window at normal incidence, a mirror at grazing */
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.5);
    vec3 refl = reflect(-v, n);
    /* A horizon in the reflection, not a smooth ramp: a real surface mirrors
       the bright wall above the room's midline and the dim floor below it, and
       that edge is the single strongest cue that what you are looking at is
       wet. */
    vec3 room = mix(uDeep * 0.45, uSky, smoothstep(-0.04, 0.22, refl.y));
    room += vec3(1.0) * pow(max(dot(refl, uKeyDir), 0.0), 180.0) * 1.6;

    vec3 wet = base * (0.42 + 0.58 * ndl + 0.16 * ndf);
    wet = mix(wet, room, 0.10 + 0.62 * fres);
    wet += vec3(1.0) * pow(max(dot(n, normalize(uKeyDir + v)), 0.0), uGloss) * uSpec;
    wet += uSky * pow(max(dot(n, normalize(uFillDir + v)), 0.0), 24.0) * 0.14;
    wet += vec3(0.9, 0.97, 1.0) * fres * uRim;

    return aces(wet);
  }

  void main() {
    vec3 rel = vWorld - uCam;
    float L = length(rel);
    vec3 dir = rel / L;

    /* Most of the screen is above the liquid. Clipping the walk to the box the
       particles actually occupy is what keeps a full-screen march down to the
       few centimetres of tank where anything can happen. */
    vec2 live = hitBox(uCam, dir, uLiveMin, uLiveMax);
    float tStart = max(live.x, 0.0);
    float tEnd = live.y;
    if (tEnd <= tStart) discard;

    /* The body the light crosses ends at the glass, wherever the particles are:
       the live box only bounds the search. */
    vec2 tank = hitBox(uCam, dir, uBoxMin, uBoxMax);

    vec3 right = uCamRight * (uPixel * L);
    vec3 up = uCamUp * (uPixel * L);

    vec3 sum = vec3(0.0);
    float hits = 0.0;
    float total = 16.0;
    float nearest = 1e9;

    /* Adaptive. The pixel's four corners decide nearly every pixel: all four
       inside means every part of it is inside, all four outside means it is
       empty, and only the one-pixel band along the silhouette is neither. That
       band gets the other twelve rays, which is the whole of the
       antialiasing. */
    for (int s = 0; s < 16; s++) {
      if (s == 4) {
        if (hits > 3.5) { total = 4.0; break; }
        if (hits < 0.5) discard;
      }
      vec2 o = SAMPLES[s];
      vec3 rd = normalize(rel + right * o.x + up * o.y);

      /* The body the light crosses ends at the glass, wherever the particles
         are: the live box only bounds the search. */
      vec2 tankS = hitBox(uCam, rd, uBoxMin, uBoxMax);
      float boxExit = min(tankS.y, tEnd + uStep);

      float cov;
      bool entered;
      float hit = march(uCam, rd, tStart, tEnd, cov, entered);
      /* Kept for the debug view only: a hit at the live box's entry is the
         inside of the body, whatever its distance says. */
      if (hit < 0.0 || cov <= 0.01) continue;

      vec3 p = uCam + rd * hit;
      sum += (uDebug > 0.5 && uDebug < 1.5 ? (entered ? vec3(1.0, 0.0, 1.0) : vec3(0.0, 0.8, 0.9)) : shade(p, rd, max(boxExit - hit, 0.0), hash12(gl_FragCoord.xy + float(s) * 17.3)));
      hits += 1.0;
      nearest = min(nearest, hit);
    }

    float covered = hits;

    if (covered < 0.02) discard;

    if (uDebug > 4.5 && uDebug < 5.5) {
      fragColor = vec4(vec3(covered / total), 1.0);
      return;
    }
    fragColor = vec4(sum / covered, min(covered / total, 1.0));

    /* The glass is drawn after the liquid, and it has to be able to tell where
       the liquid is. */
    vec4 clip = uProj * uView * vec4(uCam + dir * nearest, 1.0);
    gl_FragDepth = clamp(0.5 + 0.5 * clip.z / clip.w, 0.0, 1.0);
  }
`;

export class Fluid3DRenderer {
  constructor(canvas, sim, opts = {}) {
    this.canvas = canvas;
    this.sim = sim;
    this.resolution = opts.resolution ?? 56;
    this.fieldMode = "surface";
    this.speedScale = 1.4;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0xe9e7f0, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe9e7f0);
    this.scene = scene;

    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envMap = pmrem.fromEquirectangular(makeStudioEnvironment()).texture;
    scene.environment = this.envMap;
    pmrem.dispose();

    const key = new THREE.DirectionalLight(0xfff6ea, 1.7);
    key.position.set(1.6, 2.6, 2.2);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe9ff, 0.55);
    fill.position.set(-2, 1.2, -1.4);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0xf6f4ff, 0.35));

    this.camera = new THREE.PerspectiveCamera(34, 1, 0.05, 40);
    this.camera.position.set(1.4, 1.0, 2.0);
    this.controls = new OrbitCameraController(this.camera, canvas, {
      target: { x: 0, y: 0.33, z: 0 },
      azimuth: 0.52,
      elevation: 0.22,
      distance: 2.35,
      minDistance: 1.05,
      maxDistance: 5.2,
      minElevation: -0.35,
      maxElevation: 1.45,
      /* The tank can be walked all the way round: a liquid whose far side
         disappears when you orbit past it is a card, not a body. */
      minAzimuth: -Math.PI,
      maxAzimuth: Math.PI,
      onInteract: opts.onInteract,
    });

    /* ------------------------------- the tank ------------------------------ */
    const tank = new THREE.Group();
    const W = sim.width, H = sim.height, D = sim.depth;
    this.tankGroup = tank;
    scene.add(tank);

    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xeef4ff,
      transparent: true,
      opacity: 0.14,
      roughness: 0.06,
      metalness: 0,
      transmission: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 1.2,
    });
    this.glassMaterial = glass;

    const wall = (w, h, d, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), glass);
      mesh.position.set(x, y, z);
      mesh.renderOrder = 3;
      tank.add(mesh);
      return mesh;
    };
    const t = 0.008;
    /* A hair of clearance. The liquid's box is exactly the tank's interior, so
       glass laid *on* that plane shares it with the liquid's own surface: the
       depth buffer cannot order two coincident surfaces, and the result is a
       dotted, stitched line along every edge where water meets glass. Three
       millimetres out is invisible at this scale and makes the depth test
       unambiguous. */
    const c = 0.003;
    wall(W + t * 2, t, D + t * 2, 0, -t / 2 - c, 0);
    wall(t, H, D, -W / 2 - t / 2 - c, H / 2, 0);
    wall(t, H, D, W / 2 + t / 2 + c, H / 2, 0);
    wall(W, H, t, 0, H / 2, -D / 2 - t / 2 - c);
    wall(W, H, t, 0, H / 2, D / 2 + t / 2 + c);

    const edgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(W + c * 2, H, D + c * 2));
    const edges = new THREE.LineSegments(
      edgeGeo,
      new THREE.LineBasicMaterial({ color: 0x585468, transparent: true, opacity: 0.55 }),
    );
    edges.position.set(0, H / 2, 0);
    edges.renderOrder = 4;
    tank.add(edges);
    this.tankEdges = edges;

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.6, 64),
      new THREE.MeshBasicMaterial({ color: 0xe3e1ec, transparent: true, opacity: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.004;
    scene.add(floor);

    /* ------------------------------ the liquid ----------------------------- */
    const n = this.resolution;
    this.fieldSize = n;
    this.field = new Float32Array(n * n * n);
    this.palette = new Float32Array(n * n * n * 3);

    this.fieldTex = new THREE.Data3DTexture(new Uint16Array(n * n * n), n, n, n);
    this.fieldTex.format = THREE.RedFormat;
    this.fieldTex.type = THREE.HalfFloatType;
    this.fieldTex.minFilter = THREE.LinearFilter;
    this.fieldTex.magFilter = THREE.LinearFilter;
    this.fieldTex.wrapS = THREE.ClampToEdgeWrapping;
    this.fieldTex.wrapT = THREE.ClampToEdgeWrapping;
    this.fieldTex.wrapR = THREE.ClampToEdgeWrapping;
    this.fieldTex.unpackAlignment = 1;

    this.colorTex = new THREE.Data3DTexture(new Uint16Array(n * n * n * 4), n, n, n);
    this.colorTex.format = THREE.RGBAFormat;
    this.colorTex.type = THREE.HalfFloatType;
    this.colorTex.minFilter = THREE.LinearFilter;
    this.colorTex.magFilter = THREE.LinearFilter;
    this.colorTex.wrapS = THREE.ClampToEdgeWrapping;
    this.colorTex.wrapT = THREE.ClampToEdgeWrapping;
    this.colorTex.wrapR = THREE.ClampToEdgeWrapping;
    this.colorTex.unpackAlignment = 1;

    this.liquidMaterial = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uField: { value: this.fieldTex },
        uColorField: { value: this.colorTex },
        uUseData: { value: false },
        uBoxMin: { value: new THREE.Vector3(-W / 2, 0, -D / 2) },
        uBoxMax: { value: new THREE.Vector3(W / 2, H, D / 2) },
        uLiveMin: { value: new THREE.Vector3(-W / 2, 0, -D / 2) },
        uLiveMax: { value: new THREE.Vector3(W / 2, H, D / 2) },
        uIso: { value: 0.4 },
        uStep: { value: (W / (n - 1)) * 0.45 },
        uCell: { value: W / (n - 1) },
        uShallow: { value: new THREE.Color(0x5fc6d8) },
        uDeep: { value: new THREE.Color(0x0d6a7d) },
        uAbsorb: { value: 0.34 },
        uGloss: { value: 260 },
        uSpec: { value: 1.5 },
        uRim: { value: 0.16 },
        uSky: { value: new THREE.Color(0xa9d7e4) },
        uKeyDir: { value: new THREE.Vector3(1.6, 2.6, 2.2).normalize() },
        uFillDir: { value: new THREE.Vector3(-2, 1.2, -1.4).normalize() },
        uDebug: { value: 0 },
        uCam: { value: new THREE.Vector3() },
        uSurfaceY: { value: 0.3 },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uPixel: { value: 0.001 },
        uProj: { value: new THREE.Matrix4() },
        uView: { value: new THREE.Matrix4() },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
    });

    const liquid = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), this.liquidMaterial);
    liquid.position.set(0, H / 2, 0);
    liquid.renderOrder = 1;
    liquid.frustumCulled = false;
    scene.add(liquid);
    this.liquid = liquid;

    /* The field box is the tank's inside: a particle at the glass is a particle
       at the edge of the texture, and the liquid meets the wall exactly. */
    this.boxMin = new THREE.Vector3(-W / 2, 0, -D / 2);
    this.boxMax = new THREE.Vector3(W / 2, H, D / 2);

    /* -------------------------------- the body ----------------------------- */
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 32),
      new THREE.MeshPhysicalMaterial({
        color: 0xcfcadd,
        roughness: 0.22,
        metalness: 0.05,
        clearcoat: 0.8,
        clearcoatRoughness: 0.15,
        envMapIntensity: 1.1,
      }),
    );
    ball.visible = false;
    scene.add(ball);
    this.ball = ball;

    this._tmpColor = new THREE.Color();
    this._half = new Float32Array(1);
    this.peekLevel = 0.4;
    this.setLook("water", "surface");
    this._lastUpdate = performance.now();

    this.resize();
  }

  setLook(preset, fieldMode = this.fieldMode) {
    const look = LIQUID_LOOKS[preset] ?? LIQUID_LOOKS.water;
    this.preset = preset;
    this.fieldMode = fieldMode;
    const u = this.liquidMaterial.uniforms;
    u.uShallow.value.setHex(look.shallow);
    u.uDeep.value.setHex(look.deep);
    u.uAbsorb.value = look.absorb;
    u.uGloss.value = look.gloss;
    u.uSpec.value = look.spec;
    u.uRim.value = look.rim;
    u.uSky.value.setHex(look.sky);
    u.uUseData.value = fieldMode !== "surface";
  }

  setField(mode) {
    this.setLook(this.preset, mode);
  }

  /* ======================================================================
     the field
     ====================================================================== */

  #splat(dataView) {
    const field = this.field;
    const palette = this.palette;
    const n = this.fieldSize;
    const n2 = n * n;
    field.fill(0);
    if (dataView) palette.fill(0);

    const sim = this.sim;
    const W = sim.width, H = sim.height, D = sim.depth;
    const sx = (n - 1) / W, sy = (n - 1) / H, sz = (n - 1) / D;
    /* Two particle spacings of support: the width at which neighbours merge
       into one body instead of showing the lattice as a row of beads. */
    const cell = W / (n - 1);
    const radius = this.splatRadius ?? Math.max(2.0, 1.95 * (sim.spacing / cell));
    const r2 = radius * radius;
    const invR2 = 1 / r2;
    const tmp = this._tmpColor;
    const surfaceY = sim.surfaceHeight();

    const splat = (px, py, pz, cr, cg, cb) => {
      const gx = px * sx, gy = py * sy, gz = pz * sz;
      const x0 = Math.max(0, Math.floor(gx - radius));
      const x1 = Math.min(n - 1, Math.ceil(gx + radius));
      const y0 = Math.max(0, Math.floor(gy - radius));
      const y1 = Math.min(n - 1, Math.ceil(gy + radius));
      const z0 = Math.max(0, Math.floor(gz - radius));
      const z1 = Math.min(n - 1, Math.ceil(gz + radius));
      for (let z = z0; z <= z1; z++) {
        const dz = (z - gz) ** 2;
        for (let y = y0; y <= y1; y++) {
          const dy = (y - gy) ** 2;
          const row = z * n2 + y * n;
          for (let x = x0; x <= x1; x++) {
            const d2 = (x - gx) ** 2 + dy + dz;
            if (d2 > r2) continue;
            const w = 1 - d2 * invR2;
            const idx = row + x;
            const ww = w * w * w;
            field[idx] += ww;
            if (dataView) {
              palette[idx * 3] += cr * ww;
              palette[idx * 3 + 1] += cg * ww;
              palette[idx * 3 + 2] += cb * ww;
            }
          }
        }
      }
    };

    for (let i = 0; i < sim.count; i++) {
      const px = sim.x[i], py = sim.y[i], pz = sim.z[i];
      if (px < 0 || py < 0 || pz < 0 || px > W || py > H || pz > D) continue;

      let cr = 1, cg = 1, cb = 1;
      if (dataView) {
        if (this.fieldMode === "speed") {
          const v = Math.hypot(sim.vx[i], sim.vy[i], sim.vz[i]) / this.speedScale;
          rampColor(v, tmp);
          cr = tmp.r; cg = tmp.g; cb = tmp.b;
        } else {
          const t = Math.min(1, Math.max(0, (surfaceY - py) / Math.max(0.05, sim.height * 0.7)));
          tmp.setRGB(0.24 + 0.75 * t, 0.78 - 0.45 * t, 0.92 - 0.55 * t);
          cr = tmp.r; cg = tmp.g; cb = tmp.b;
        }
      }

      /* ------------------------ the glass ------------------------
         A particle's kernel is a sphere, and a particle half a spacing from
         the glass has half that sphere outside the tank. Splatting only the
         inside half reads 0.69 of the tank's own density at the wall - not a
         small error: it drags the whole surface four cells in from the glass
         and prints the lattice on it as a staircase, because the deficit is
         the lattice's phase, not the wall's distance.

         Reflecting the particle through each wall it can reach restores the
         missing half exactly. The reflected cloud is the same body of liquid
         seen through the glass, so at the wall the sum is the tank's own
         density, flat, and the surface runs out to the glass, meets it
         square, and stops. Mirroring only where the kernel actually reaches a
         wall costs a handful of extra splats per frame. */
      const reach = radius * cell;
      const reflX = px < reach ? -px : NaN;
      const reflX2 = W - px < reach ? 2 * W - px : NaN;
      const reflZ = pz < reach ? -pz : NaN;
      const reflZ2 = D - pz < reach ? 2 * D - pz : NaN;
      const reflY = py < reach ? -py : NaN;
      const xs = [px];
      if (reflX === reflX) xs.push(reflX);
      if (reflX2 === reflX2) xs.push(reflX2);
      const zs = [pz];
      if (reflZ === reflZ) zs.push(reflZ);
      if (reflZ2 === reflZ2) zs.push(reflZ2);
      const ys = [py];
      if (reflY === reflY) ys.push(reflY);
      for (let a = 0; a < xs.length; a++) {
        for (let b = 0; b < ys.length; b++) {
          for (let c = 0; c < zs.length; c++) {
            splat(xs[a], ys[b], zs[c], cr, cg, cb);
          }
        }
      }
    }

    /* Two smoothing passes. The splat radius is deliberately just wide enough to
       close the gaps between particles, which leaves the lattice faintly in the
       field; a 1-2-1 blur in each axis takes that out without rounding the
       waves away. */
    blurField(field, n);
    blurField(field, n);
    blurField(field, n);
    /* The contact line, smoothed where it is read and nowhere else. */
    smoothWallSlabs(field, n, 3, 4);

    if (dataView) {
      /* The tint is a weighted average of the particles' colours, so it has to
         be smoothed exactly like the density that weights it - otherwise the
         colour is unsmoothed cell to cell and the pool comes out in vertical
         stripes one grid cell wide. */
      const ch = this._channel ??= new Float32Array(field.length);
      for (let c = 0; c < 3; c++) {
        for (let i = 0; i < field.length; i++) ch[i] = palette[i * 3 + c];
        blurField(ch, n);
        for (let i = 0; i < field.length; i++) palette[i * 3 + c] = ch[i];
      }
      for (let idx = 0; idx < field.length; idx++) {
        const f = field[idx];
        if (f <= 1e-5) continue;
        palette[idx * 3] /= f;
        palette[idx * 3 + 1] /= f;
        palette[idx * 3 + 2] /= f;
      }
    }


    /* The surface level, measured from the field itself: the volume is sampled
       on a 56-cubed grid, and the value a full body of particles reports is the
       only number that keeps the surface where the particles are when spacing,
       radius or particle count change. */
    let peak = 0, occupied = 0;
    for (let i = 0; i < field.length; i++) {
      const v = field[i];
      if (v > 0.02) { occupied++; if (v > peak) peak = v; }
    }
    let level = peak * 0.42;
    if (peak > 0 && occupied > 64) {
      /* Fine bins, and the percentile is interpolated inside its bin. A coarse
         histogram quantises the level, and a level that jumps a bin every few
         frames moves the surface by a fraction of a cell - which shows up as a
         stippled, crawling silhouette along exactly the edges the eye is
         following. */
      const bins = 256;
      const hist = new Uint32Array(bins);
      for (let i = 0; i < field.length; i++) {
        const v = field[i];
        if (v < 0.02) continue;
        hist[Math.min(bins - 1, ((v / peak) * bins) | 0)]++;
      }
      const goal = occupied * 0.72;
      let acc = 0;
      for (let b = 0; b < bins; b++) {
        const next = acc + hist[b];
        if (next >= goal) {
          const within = hist[b] ? (goal - acc) / hist[b] : 0.5;
          level = ((b + within) / bins) * peak;
          break;
        }
        acc = next;
      }
    }
    const target = Math.max(0.02, level * 0.5);
    /* Eased, so a level that moves by a hundredth of a cell between frames is a
       hundredth of a cell of motion and not a visible shimmer. Not eased on the
       first frames, though: the level starts at a guess, and easing it towards
       the measured one from there is the surface visibly swelling for the first
       second the page is open - liquid moving on a bench nobody has started. */
    this.peekLevel = this._levelFrames > 1
      ? this.peekLevel * 0.88 + target * 0.12
      : target;
    this._levelFrames = (this._levelFrames ?? 0) + 1;
    this.liquidMaterial.uniforms.uIso.value = this.peekLevel;
    return peak;
  }

  #upload(dataView, peak) {
    const n = this.fieldSize;
    const field = this.field;
    const tex = this.fieldTex;
    const src = tex.image.data;
    const toHalf = THREE.DataUtils.toHalfFloat;
    /* The texture carries the density in the field's own units - the same units
       the isolevel is measured in - so the wall and the shader cannot fall out
       of step over a change of scale. */
    void peak;
    for (let i = 0; i < field.length; i++) src[i] = toHalf(field[i]);
    tex.needsUpdate = true;

    if (!dataView) return;
    const palette = this.palette;
    const cdst = this.colorTex.image.data;
    for (let i = 0; i < field.length; i++) {
      cdst[i * 4] = toHalf(palette[i * 3]);
      cdst[i * 4 + 1] = toHalf(palette[i * 3 + 1]);
      cdst[i * 4 + 2] = toHalf(palette[i * 3 + 2]);
      cdst[i * 4 + 3] = toHalf(1);
    }
    this.colorTex.needsUpdate = true;
  }

  /* ======================================================================
     frame
     ====================================================================== */

  update() {
    const sim = this.sim;
    const mode = this.fieldMode;
    const t0 = performance.now();
    const peak = this.#splat(mode !== "surface");
    const t1 = performance.now();
    this.#upload(mode !== "surface", peak);
    const t2 = performance.now();
    this.timings = { splat: t1 - t0, upload: t2 - t1 };

    if (sim.count) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (let i = 0; i < sim.count; i++) {
        const x = sim.x[i], y = sim.y[i], z = sim.z[i];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      /* Wide enough to clear the splat kernel by a comfortable margin: a ray
         that misses the liquid only because it left this box is not a ray that
         missed the liquid, and the box face would then be what the silhouette
         is drawn against. Anything wider than this is paid for on every pixel
         of the screen, so it is not generous for generosity's sake. */
      const pad = sim.spacing * 6;
      const u = this.liquidMaterial.uniforms;
      u.uLiveMin.value.set(
        Math.max(-sim.width / 2, minX - sim.width / 2 - pad),
        Math.max(0, minY - pad),
        Math.max(-sim.depth / 2, minZ - sim.depth / 2 - pad),
      );
      u.uLiveMax.value.set(
        Math.min(sim.width / 2, maxX - sim.width / 2 + pad),
        Math.min(sim.height, maxY + pad),
        Math.min(sim.depth / 2, maxZ - sim.depth / 2 + pad),
      );
    }

    const b = sim.ball;
    this.ball.visible = !!b.visible;
    if (b.visible) {
      this.ball.position.set(b.x - sim.width / 2, b.y, b.z - sim.depth / 2);
      this.ball.scale.setScalar(b.r);
    }

    this.controls.update();
    this.camera.updateMatrixWorld();
    const u = this.liquidMaterial.uniforms;
    u.uCam.value.copy(this.camera.position);
    u.uSurfaceY.value = sim.surfaceHeight();
    u.uCamRight.value.setFromMatrixColumn(this.camera.matrixWorld, 0);
    u.uCamUp.value.setFromMatrixColumn(this.camera.matrixWorld, 1);
    /* One pixel's angular width: what a sub-pixel ray has to be offset by, in
       units of distance along the view ray. */
    const buf = this.renderer.getDrawingBufferSize(this._bufSize ??= new THREE.Vector2());
    u.uPixel.value = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / Math.max(1, buf.y);
    u.uProj.value.copy(this.camera.projectionMatrix);
    u.uView.value.copy(this.camera.matrixWorldInverse);
    const t3 = performance.now();
    this.renderer.render(this.scene, this.camera);
    this.timings.render = performance.now() - t3;
  }

  setViewMode(mode) {
    if (mode === "2d") {
      this.controls.azimuth = 0;
      this.controls.elevation = 0.04;
      this.controls.distance = 2.55;
      this.controls.target = { x: 0, y: 0.34, z: 0 };
    } else {
      this.controls.azimuth = 0.52;
      this.controls.elevation = 0.22;
      this.controls.distance = 2.35;
      this.controls.target = { x: 0, y: 0.33, z: 0 };
    }
    this.controls.update();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.controls.dispose();
    this.fieldTex.dispose();
    this.colorTex.dispose();
    this.liquidMaterial.dispose();
    this.envMap?.dispose?.();
    this.renderer.dispose();
  }
}
