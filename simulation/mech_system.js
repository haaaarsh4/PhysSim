/**
 * simulation/mech_system.js - a mechanical system, in real units.
 *
 * This is the whole of the Vibrations workbench's physics: masses sliding on one
 * axis, joined to each other and to the ground by springs and viscous dampers,
 * pushed by a force on one mass or shaken from the ground underneath. That is
 * every figure in a mechanical-vibrations text, and it is the model the two of
 * this workbench's kind - the spring-mass-damper and the quarter car - are both
 * special cases of.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS EXACT, AND WHAT IS NOT
 * ---------------------------------------------------------------------------
 * The model is linear, and that is what makes this file different from the other
 * two benches in this app. Nothing here is stepped: the equations of motion are
 * assembled into matrices once, and the state is advanced by the exact solution
 * of the linear ODE -
 *
 *     z' = A z,     z(t + h) = e^(A h) z(t)
 *
 * - so the curve on the screen is not an approximation of the analytic response,
 * it *is* the analytic response, sampled. That matters more than it sounds. A
 * resonance peak measured off a simulation that integrates badly can be wrong in
 * the one number the experiment is about, and a student has no way to tell a
 * numerical artefact from a physical one. Here there are no numerical artefacts:
 * the timestep sets how finely the answer is *reported*, never how wrong it is.
 * A step of a fortieth of a second gives the same trajectory as a step of a
 * millionth, and both agree with the closed form to the last bit the panel can
 * show.
 *
 * Three consequences, all of them checkable, and all of them checked in
 * experiments/mech_checks.js:
 *
 *   - the harmonic drive is *inside* the state. A sine input is not a staircase
 *     of held values, it is a harmonic oscillator - two more states obeying
 *     u'' = -omega^2 u - so a sine is integrated exactly too, however coarse the
 *     step.
 *   - the energy ledger is exact. Kinetic plus potential energy is a quadratic
 *     form in the state, so the work and the dissipation over a step are exact
 *     integrals of a quadratic form under a linear flow, computed with one more
 *     matrix exponential (Van Loan's block trick). U - U0 - W + Q is zero to
 *     floating-point noise, not to the order of the timestep.
 *   - the transfer function is not fitted. The denominator is det(M s^2 + C s +
 *     K) evaluated exactly - by interpolating the determinant on a circle and
 *     inverting the transform - and the numerator is the same determinant with
 *     the output's column replaced by the input's, which is Cramer's rule. So
 *     the panel's H(s) and the panel's frequency response come from the same
 *     matrices the simulation runs on, and the measured amplitude ratio in a
 *     steady-state run agrees with |H(j omega)| as a check rather than as a
 *     coincidence.
 *
 * What is *not* here, said out loud: friction and backlash. This is the linear
 * theory, on purpose - a Coulomb damper would make none of the above exact, and
 * the whole point of this bench is that the numbers can be taken as true. Sliding
 * friction, gaps and impacts belong to the Dynamics bench next door.
 *
 * ---------------------------------------------------------------------------
 * THE UNITS ARE REAL
 * ---------------------------------------------------------------------------
 * Kilograms, newtons, newtons per metre, newtons per metre per second, metres.
 * The default single-mass system is 1 kg on a 10 N/m spring with a 0.5 N s/m
 * damper: omega_n = 3.16 rad/s, f_n = 0.503 Hz, zeta = 0.079. A quarter car is
 * 300 kg of body on a 30 kN/m suspension over a 40 kg wheel on a 200 kN/m tyre,
 * which is what those parts of a real car weigh, and it rings at 1.2 Hz and
 * 11 Hz because that is what a real car does.
 */

/** The Boltzmann-free kind of constant: nothing this file needs beyond a few
 *  tolerances. Kept named so the reason for each is readable at the call site. */
const PIVOT_EPS = 1e-300;

/** Subscripts, for the labels the panels and the stage both use. A mass is
 *  m1 with a subscript rather than m1 with a digit, on the stage and in the
 *  rail alike, so the two pictures of one system read as one system. */
const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
export function subscript(n) {
  return String(n).split("").map((d) => SUBSCRIPTS[Number(d)] ?? d).join("");
}

/** The drive shapes a mass or a base can be pushed with. `off` is a waveform
 *  rather than an absence, because a drive that is switched off is still a drive
 *  standing on the stage - the same distinction the Thermo bench draws between a
 *  burner and its flame. */
export const WAVEFORMS = [
  { key: "off", label: "Off", note: "nothing is pushing it: whatever the system does, it does on its own" },
  { key: "step", label: "Step", note: "a constant force or offset, switched on at the start of the run" },
  { key: "sine", label: "Sine", note: "a harmonic force or base motion at a frequency you set: it swings one way, then the other, once every half cycle" },
  { key: "impulse", label: "Impulse", note: "a single blow: a momentum handed over at the start, then nothing - nothing keeps pushing, so the stage draws no arrow for it" },
];

/* ==================================================================================
   COMPLEX ARITHMETIC - four operations, on {re, im} pairs
   ================================================================================== */
/* Only what the polynomial algebra below needs: the determinant of a complex
   matrix, and a polynomial evaluated at a complex number. A complex library
   would be a dependency this file does not want. */

const czero = () => ({ re: 0, im: 0 });
const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im });
const csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cdiv = (a, b) => {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
};
const cabs = (a) => Math.hypot(a.re, a.im);

/* ==================================================================================
   SMALL DENSE LINEAR ALGEBRA
   ================================================================================== */
/* Matrices here are flat Float64Arrays with a stride of n, and every one of them
   is small: n is the number of masses, so 1 to 6, and the state matrix is twice
   that plus one two-state block per active drive. Nothing in this file is ever
   big enough for the constant factors to matter, which is why the simplest
   correct implementation of each operation is the one used. */

function zerosFlat(n) { return new Float64Array(n * n); }

/** A copy of a matrix times a scalar. Used to put the timestep into a generator
 *  before exponentiating it, which is the one place the step enters the physics. */
function scaleFlat(A, factor, n) {
  const B = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) B[i] = A[i] * factor;
  return B;
}

function identityFlat(n) {
  const A = zerosFlat(n);
  for (let i = 0; i < n; i++) A[i * n + i] = 1;
  return A;
}

/** C = A B. Allocates: called a handful of times per rebuild, never per step. */
function matMul(A, B, n) {
  const C = zerosFlat(n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < n; k++) {
      const a = A[i * n + k];
      if (a === 0) continue;
      for (let j = 0; j < n; j++) C[i * n + j] += a * B[k * n + j];
    }
  }
  return C;
}

/** y = A x, into a caller-owned array: this is the only one that runs per step. */
function matVec(A, x, y, n) {
  for (let i = 0; i < n; i++) {
    let s = 0;
    const row = i * n;
    for (let j = 0; j < n; j++) s += A[row + j] * x[j];
    y[i] = s;
  }
  return y;
}

/**
 * e^A, by scaling and squaring with a Taylor series.
 *
 * The series is summed to eighteen terms after scaling the matrix down until
 * every row sums to at most 0.25, where the first omitted term is of order
 * 1e-22 - below what a double can hold next to a term of order one - so this is
 * exact to machine precision, not merely accurate. The scaling is that bound
 * divided down in powers of two, so squaring back up is exact (a power of two
 * multiplies without rounding), which is the one place a mistake here would show
 * up as a slowly drifting energy in the ledger.
 */
export function expm(A, n) {
  let norm = 0;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += Math.abs(A[i * n + j]);
    norm = Math.max(norm, s);
  }
  let squarings = 0;
  while (norm > 0.25) { norm /= 2; squarings++; }

  const scale = Math.pow(2, -squarings);
  const B = zerosFlat(n);
  for (let i = 0; i < n * n; i++) B[i] = A[i] * scale;

  const result = identityFlat(n);
  let term = identityFlat(n);
  for (let k = 1; k <= 18; k++) {
    term = matMul(term, B, n);
    const f = 1 / k;
    for (let i = 0; i < n * n; i++) term[i] *= f;
    for (let i = 0; i < n * n; i++) result[i] += term[i];
  }
  for (let i = 0; i < squarings; i++) {
    const squared = matMul(result, result, n);
    result.set(squared);
  }
  return result;
}

/**
 * det(A) for a complex matrix held as two flat arrays, by Gaussian elimination
 * with partial pivoting. Overwrites its inputs: every caller here builds the
 * matrix for this call and throws it away.
 */
function detComplex(re, im, n) {
  let detRe = 1, detIm = 0;
  for (let c = 0; c < n; c++) {
    let pivot = c;
    let best = Math.hypot(re[c * n + c], im[c * n + c]);
    for (let r = c + 1; r < n; r++) {
      const v = Math.hypot(re[r * n + c], im[r * n + c]);
      if (v > best) { best = v; pivot = r; }
    }
    if (pivot !== c) {
      for (let k = c; k < n; k++) {
        const a = c * n + k, b = pivot * n + k;
        let t = re[a]; re[a] = re[b]; re[b] = t;
        t = im[a]; im[a] = im[b]; im[b] = t;
      }
      detRe = -detRe; detIm = -detIm;
    }
    const pr = re[c * n + c], pi = im[c * n + c];
    if (Math.hypot(pr, pi) < PIVOT_EPS) return czero();
    const nr = detRe * pr - detIm * pi;
    const ni = detRe * pi + detIm * pr;
    detRe = nr; detIm = ni;
    const d2 = pr * pr + pi * pi;
    for (let r = c + 1; r < n; r++) {
      const ar = re[r * n + c], ai = im[r * n + c];
      if (ar === 0 && ai === 0) continue;
      const fr = (ar * pr + ai * pi) / d2;
      const fi = (ai * pr - ar * pi) / d2;
      for (let k = c; k < n; k++) {
        const br = re[c * n + k], bi = im[c * n + k];
        re[r * n + k] -= fr * br - fi * bi;
        im[r * n + k] -= fr * bi + fi * br;
      }
    }
  }
  return { re: detRe, im: detIm };
}

/* ==================================================================================
   POLYNOMIALS - evaluation, roots, and the determinant of a matrix of them
   ================================================================================== */

/** p(s) at a complex s. `coeffs` runs highest power first, the way it is read. */
export function evalPolyComplex(coeffs, s) {
  let acc = czero();
  for (let i = 0; i < coeffs.length; i++) acc = cadd(cmul(acc, s), { re: coeffs[i], im: 0 });
  return acc;
}

/** p(x) at a real x, by Horner. */
export function evalPoly(coeffs, x) {
  let acc = 0;
  for (let i = 0; i < coeffs.length; i++) acc = acc * x + coeffs[i];
  return acc;
}

/**
 * Every root of a real polynomial, by the Durand-Kerner iteration.
 *
 * Simultaneous iteration on all n roots at once, which is what makes it reliable
 * here: each step divides the polynomial by the product of the other estimates,
 * so the roots converge together and none of them can be lost to a deflation
 * that has already gone wrong. The starting points are the powers of a complex
 * number just inside the unit circle, which for the degrees this file produces
 * (two per mass, so up to twelve) always separates. Complex coefficients are
 * carried throughout even though the polynomial is real, because a conjugate
 * pair is the answer that matters - a lightly damped mode is two complex poles,
 * and reporting it as two real ones would be a lie about the physics.
 *
 * @param {number[]|Float64Array} coeffs highest power first
 * @returns {Array<{re:number, im:number}>} one entry per root
 */
export function polyRoots(coeffs) {
  const c = Array.from(coeffs);
  while (c.length > 1 && c[0] === 0) c.shift();
  const degree = c.length - 1;
  if (degree <= 0) return [];
  const a = c.map((v) => v / c[0]);          // monic
  const scale = Math.max(...a.map(Math.abs), 1e-300);

  const seed = { re: 0.4, im: 0.9 };
  const roots = [];
  let z = { re: 1, im: 0 };
  for (let k = 0; k < degree; k++) { z = cmul(z, seed); roots.push({ ...z }); }

  for (let iter = 0; iter < 400; iter++) {
    let worst = 0;
    for (let i = 0; i < degree; i++) {
      const p = evalPolyComplex(a, roots[i]);
      let denom = { re: 1, im: 0 };
      for (let j = 0; j < degree; j++) {
        if (j === i) continue;
        denom = cmul(denom, csub(roots[i], roots[j]));
      }
      if (cabs(denom) < 1e-280) { roots[i] = cadd(roots[i], { re: 1e-8, im: 1e-8 }); continue; }
      const step = cdiv(p, denom);
      roots[i] = csub(roots[i], step);
      worst = Math.max(worst, cabs(step) / Math.max(cabs(roots[i]), 1e-30));
    }
    if (worst < 1e-15) break;
  }
  /* A root whose imaginary part is a rounding error is a real one: an
     overdamped mode is two real poles and must not be shown as a conjugate pair
     that misses the real axis by 1e-17. */
  const tol = 1e-9 * Math.max(1, scale);
  for (const root of roots) if (Math.abs(root.im) < tol) root.im = 0;
  return roots.sort((p, q) => p.re - q.re || p.im - q.im);
}

/**
 * det(A0 + A1 s + A2 s^2), and the same determinant with one column replaced.
 *
 * The determinant of a matrix whose entries are polynomials of degree two is
 * itself a polynomial of degree 2n, and this is how it is obtained: evaluate the
 * determinant at 2n+1 points equally spaced around a circle of radius `rho`, then
 * invert the transform. The points are roots of unity, so the inverse is a plain
 * sum - no matrix to invert, no Vandermonde to fight - and the answer is exact
 * to rounding rather than to a fit.
 *
 * `rho` is the one number that has to be chosen well, and it is chosen from the
 * matrices: the circle is placed at the frequency the system actually lives at,
 * so no sample is so large that the s^2 terms swamp the constants or so small
 * that they vanish under them.
 *
 * @param {Float64Array} A0 constant term, flat n x n
 * @param {Float64Array} A1 coefficient of s
 * @param {Float64Array} A2 coefficient of s^2
 * @param {{col:number, b0:Float64Array, b1?:Float64Array|null}} [replace] swap
 *   column `col` for the polynomial b0 + b1 s - Cramer's rule, which is what
 *   turns the same determinant into a transfer function's numerator
 * @returns {Float64Array} coefficients, power-ascending (index = power of s)
 */
function polynomialDeterminant(A0, A1, A2, n, rho, replace = null) {
  const count = 2 * n + 1;
  const samples = [];
  for (let k = 0; k < count; k++) {
    const theta = (2 * Math.PI * k) / count;
    const sr = rho * Math.cos(theta);
    const si = rho * Math.sin(theta);
    const s2r = sr * sr - si * si;
    const s2i = 2 * sr * si;
    const re = new Float64Array(n * n);
    const im = new Float64Array(n * n);
    for (let i = 0; i < n * n; i++) {
      re[i] = A0[i] + A1[i] * sr + A2[i] * s2r;
      im[i] = A1[i] * si + A2[i] * s2i;
    }
    if (replace) {
      for (let i = 0; i < n; i++) {
        const at = i * n + replace.col;
        re[at] = replace.b0[i] + (replace.b1 ? replace.b1[i] * sr : 0);
        im[at] = replace.b1 ? replace.b1[i] * si : 0;
      }
    }
    samples.push(detComplex(re, im, n));
  }
  const out = new Float64Array(2 * n + 1);
  for (let j = 0; j <= 2 * n; j++) {
    let ar = 0, ai = 0;
    for (let k = 0; k < count; k++) {
      const theta = (-2 * Math.PI * j * k) / count;
      const cr = Math.cos(theta), ci = Math.sin(theta);
      ar += samples[k].re * cr - samples[k].im * ci;
      ai += samples[k].re * ci + samples[k].im * cr;
    }
    /* The samples were taken at rho times a root of unity, so the transform
       comes back with each coefficient carrying rho to its own power; undoing
       that is what turns the numbers into the coefficients of s itself. */
    out[j] = (ar / count) / Math.pow(rho, j);
    /* The imaginary part is identically zero for real matrices; it is dropped by
       not being read, which is where the realness of the answer is enforced. */
    void ai;
  }
  return out;
}

/** Power-ascending to highest-first, dropping coefficients that are zero to
 *  within the noise of the interpolation - a numerator's leading terms are the
 *  small ones, and a 1e-18 s^4 in front of a 1 s^2 is not a term. */
function descending(ascending, scale) {
  const list = Array.from(ascending);
  while (list.length > 1 && Math.abs(list[list.length - 1]) < 1e-12 * scale) list.pop();
  return list.reverse();
}

/**
 * The roots of a symmetric matrix's eigenvalue problem, by cyclic Jacobi
 * rotations.
 *
 * Written out rather than borrowed because this is the only eigenproblem in the
 * project and it is a symmetric one: repeatedly annihilate the largest
 * off-diagonal entry with a plane rotation, and the matrix converges to diagonal
 * with a norm that is accurate to the last bit and eigenvectors that come out
 * orthogonal for free. `s` is the largest off-diagonal magnitude in the matrix;
 * rotations stop when the off-diagonals are that many orders below the
 * diagonal, which is the accuracy of the input rather than of the algorithm.
 *
 * @returns {{values:number[], vectors:Float64Array[]}} values ascending, each
 *   vector a column normalized to unit length
 */
function symmetricEigen(matrix, n) {
  const A = Float64Array.from(matrix);
  const V = identityFlat(n);

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i * n + j] * A[i * n + j];
    if (Math.sqrt(off) < 1e-14) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q];
        if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p], aqq = A[q * n + q];
        const theta = 0.5 * Math.atan2(2 * apq, aqq - app);
        const c = Math.cos(theta), s = Math.sin(theta);
        for (let k = 0; k < n; k++) {
          const akp = A[k * n + p], akq = A[k * n + q];
          A[k * n + p] = c * akp - s * akq;
          A[k * n + q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = A[p * n + k], aqk = A[q * n + k];
          A[p * n + k] = c * apk - s * aqk;
          A[q * n + k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k * n + p], vkq = V[k * n + q];
          V[k * n + p] = c * vkp - s * vkq;
          V[k * n + q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => A[a * n + a] - A[b * n + b]);
  const values = order.map((i) => A[i * n + i]);
  const vectors = order.map((i) => {
    const v = new Float64Array(n);
    for (let k = 0; k < n; k++) v[k] = V[k * n + i];
    return v;
  });
  return { values, vectors };
}

/* ==================================================================================
   THE MODEL - one node per mass, and two kinds of element between them
   ================================================================================== */

/** The masses and their plumbing, in the shape the panels and the saved files
 *  both use. Exported because a lab is written in it. */
export function defaultSpec() {
  return {
    masses: [{ m: 1 }],
    elements: [
      { kind: "spring", a: 0, b: "g", k: 10 },
      { kind: "damper", a: 0, b: "g", c: 0.5 },
    ],
    drive: { mass: 0, waveform: "sine", amplitude: 1, frequency: 0.5 },
    base: { waveform: "off", amplitude: 0.01, frequency: 1 },
    excitation: "force",
    output: 0,
    x0: [0],
    v0: [0],
  };
}

/** One mass appended to the right end of whatever chain is there, joined to its
 *  neighbour by a spring and a damper. Used by the rail's own "add a mass": the
 *  topology of a bench-built system is a chain, and extending it is a row of
 *  numbers in the panel and a coil on the stage. */
function appendedMass(spec, m = 1, k = 10, c = 0.5) {
  const n = spec.masses.length;
  const next = {
    ...spec,
    masses: [...spec.masses.map((x) => ({ ...x })), { m }],
    elements: [
      ...spec.elements.map((e) => ({ ...e })),
      { kind: "spring", a: n - 1, b: n, k },
      { kind: "damper", a: n - 1, b: n, c },
    ],
    drive: { ...spec.drive },
    base: { ...spec.base },
    x0: [...spec.x0, 0],
    v0: [...spec.v0, 0],
  };
  return next;
}

export { appendedMass };

/** The forces on the bench, as a list.
 *
 *  A spec written before this bench could carry more than one force says
 *  `drive`, and one shaker is still what most of these experiments are, so the
 *  list is made from it. From here on `drives` is the model and `spec.drive` is
 *  a *mirror* of its first entry - see mirrorDrive - which is what keeps every
 *  reader of the old name working: the panels, the checks and a file saved by an
 *  older bench all read and write the first force exactly as they did. */
function driveList(input) {
  const raw = Array.isArray(input.drives) && input.drives.length ? input.drives : [input.drive ?? {}];
  return raw.map((d) => ({ ...d }));
}

/** Make `spec.drive` an alias of `spec.drives[0]`, so the two names cannot
 *  disagree: reading it reads the first force, writing it writes the first
 *  force, and it is enumerable, so a spread or a JSON round trip still carries
 *  both - which is what lets an older saved session load and a newer one be
 *  read by anything that only knows the old name. */
function mirrorDrive(spec) {
  if (Object.getOwnPropertyDescriptor(spec, "drive")?.get) return spec;
  Object.defineProperty(spec, "drive", {
    enumerable: true,
    configurable: true,
    get() { return this.drives[0]; },
    set(value) { this.drives[0] = value; },
  });
  return spec;
}

/** Fill in, clamp and repair a spec: every field present, every node a real
 *  mass or the ground, and nothing that would make the assembly ill-defined. */
export function normalizeSpec(input = {}) {
  const base = defaultSpec();
  const spec = {
    ...base,
    ...input,
    masses: (input.masses ?? [{ m: 1 }]).map((m) => ({ m: Math.max(1e-6, Number(m.m) || 1e-6) })),
    elements: (input.elements ?? []).map((e) => ({ ...e })),
    drives: driveList(input),
    base: { ...base.base, ...(input.base ?? {}) },
  };
  const n = spec.masses.length;
  /* An element whose end is a mass or the ground is part of the system. One
     whose end is *nothing* is a spring lying on the bench: it is kept rather
     than thrown away, because a part that is not connected is a part the reader
     put there - the stage draws it hanging off what it does still hold, and the
     bench says out loud that it is holding nothing. What it contributes to the
     assembly is nothing at all, which is the whole of the physics of it: a
     spring bolted to one thing and to nothing else cannot pull on anything. */
  const isEnd = (v) => v === null || v === undefined || v === "g"
    || (Number.isInteger(v) && v >= 0 && v < n);
  const loose = (v) => v === null || v === undefined;
  spec.elements = spec.elements.filter((e) => isEnd(e.a) && isEnd(e.b)
    && !(e.a === e.b && !loose(e.a)));
  spec.drives = spec.drives.map((d) => ({
    mass: loose(d.mass) ? null : Math.min(Math.max(0, Math.round(d.mass)), n - 1),
    waveform: WAVEFORMS.some((w) => w.key === d.waveform) ? d.waveform : "sine",
    amplitude: Number.isFinite(Number(d.amplitude)) ? Number(d.amplitude) : 1,
    frequency: Math.max(0, Number(d.frequency) || 0),
  }));
  mirrorDrive(spec);
  spec.output = Math.min(Math.max(0, Math.round(spec.output ?? 0)), n - 1);
  spec.base.amplitude = Number.isFinite(Number(spec.base.amplitude)) ? Number(spec.base.amplitude) : 0;
  spec.base.frequency = Math.max(0, Number(spec.base.frequency) || 0);
  if (!WAVEFORMS.some((w) => w.key === spec.base.waveform)) spec.base.waveform = "off";
  if (spec.excitation !== "base" && spec.excitation !== "force") spec.excitation = "force";
  /* Whether anything at all is pushing the rig: the question the analysis asks
     when it decides which of the two inputs to read a curve from. A force that
     is off, or that is attached to nothing, is not pushing anything. */
  const forceOn = spec.drives.some((d) => !loose(d.mass) && d.waveform !== "off");
  /* Both inputs may be on at once. A rig pushed by a force *and* shaken from the
     ground is one experiment - the flow matrix carries a generator for each, the
     ledger carries the work from each - and forbidding it would be forbidding a
     reader to shake a bench they are also driving.

     `excitation` is therefore not "the one that is on": it is which of the two
     inputs the transfer function, the response and the frequency response are
     read from, and it is kept pointing at one that is actually driving so the
     analysis is never about a source that is switched off. */
  if (spec.excitation === "force" && !forceOn && spec.base.waveform !== "off") spec.excitation = "base";
  if (spec.excitation === "base" && spec.base.waveform === "off" && forceOn) spec.excitation = "force";
  spec.x0 = Array.from({ length: n }, (_, i) => Number(spec.x0?.[i]) || 0);
  spec.v0 = Array.from({ length: n }, (_, i) => Number(spec.v0?.[i]) || 0);
  return spec;
}

/* ==================================================================================
   THE SYSTEM
   ================================================================================== */

export class MechSystem {
  /** @param {object} [spec] see defaultSpec(); anything missing gets a default */
  constructor(spec = {}) {
    this.spec = normalizeSpec(spec);
    this.dt = 1 / 600;                 // seconds per step: a reporting choice, not an accuracy one
    this.time = 0;
    this.steps = 0;
    this.held = null;                  // { index, x } while a mass is in hand
    this._transferCache = new Map();
    this.rebuild();
    this.reset();
  }

  get n() { return this.spec.masses.length; }
  get masses() { return this.spec.masses; }
  get elements() { return this.spec.elements; }

  /** The label a mass, spring or damper wears on the stage and in the rail. */
  labels() {
    const springs = [], dampers = [];
    let k = 0, c = 0;
    for (const e of this.spec.elements) {
      if (e.kind === "spring") springs.push(`k${subscript(++k)}`);
      else dampers.push(`c${subscript(++c)}`);
    }
    return {
      masses: this.spec.masses.map((_, i) => `m${subscript(i + 1)}`),
      displacements: this.spec.masses.map((_, i) => `x${subscript(i + 1)}`),
      springs, dampers,
    };
  }

  /** Every spring's, damper's or mass's own index within its kind, so a stage
   *  label and a rail row can be matched to the element that owns them. */
  elementIndices() {
    let k = 0, c = 0;
    return this.spec.elements.map((e) => (e.kind === "spring" ? { kind: "spring", index: k++ } : { kind: "damper", index: c++ }));
  }

  /* ----------------------------------------------------------------------------
     ASSEMBLY
     ---------------------------------------------------------------------------- */

  /**
   * Build the matrices this system runs on, and everything derived from them.
   *
   * Called whenever the model changes - a mass, a spring, a waveform, which mass
   * is driven - and never during a run: a parameter typed in mid-flight changes
   * the system from that step on, and the state carries across untouched, which
   * is exactly what a hand on a spring would do.
   */
  rebuild() {
    const n = this.n;
    const spec = this.spec;
    this.M = new Float64Array(n);
    for (let i = 0; i < n; i++) this.M[i] = spec.masses[i].m;

    const K = zerosFlat(n);
    const C = zerosFlat(n);
    const kg = new Float64Array(n);
    const cg = new Float64Array(n);
    const Kspec = zerosFlat(n);
    const Cspec = zerosFlat(n);
    for (const e of spec.elements) {
      const a = e.a, b = e.b;
      /* An element with an end in the air is bolted to nothing at that end, and
         stamps nothing: a spring that holds one thing and nothing else has
         nothing to pull on. It stays in the model - the stage draws it, the
         bench says it is loose - and it contributes exactly zero, which is what
         a loose spring contributes to a rig. */
      if (a === null || a === undefined || b === null || b === undefined) continue;
      const value = Number(e.kind === "spring" ? e.k : e.c) || 0;
      const target = e.kind === "spring" ? K : C;
      const mirror = e.kind === "spring" ? Kspec : Cspec;
      const ground = e.kind === "spring" ? kg : cg;
      if (b === "g") {
        target[a * n + a] += value;
        mirror[a * n + a] += value;      // the same stamp, without the ground folded in
        ground[a] += value;
      } else if (a === "g") {
        target[b * n + b] += value;
        mirror[b * n + b] += value;
        ground[b] += value;
      } else {
        target[a * n + a] += value;
        target[b * n + b] += value;
        target[a * n + b] -= value;
        target[b * n + a] -= value;
        mirror[a * n + a] += value;
        mirror[b * n + b] += value;
        mirror[a * n + b] -= value;
        mirror[b * n + a] -= value;
      }
    }
    this.K = K;
    this.C = C;
    /* The ground's own half of each element that reaches it: the stiffness and
       damping that a base motion pushes on the masses through. The springs and
       dampers between masses are unaffected by the ground and do not appear. */
    this.groundStiffness = kg;
    this.groundDamping = cg;
    this.hasGround = kg.some((v) => v > 0) || cg.some((v) => v > 0);

    /* The scale the polynomial determinant is sampled at: the frequency this
       system lives at, from its own numbers rather than from a guess. A system
       with no springs at all is still a system - a mass on a damper, whose time
       scale is m/c - so the dampers get a vote too. */
    let maxK = 0, maxC = 0, minM = Infinity;
    for (let i = 0; i < n; i++) {
      maxK = Math.max(maxK, Math.abs(K[i * n + i]));
      maxC = Math.max(maxC, Math.abs(C[i * n + i]));
      minM = Math.min(minM, this.M[i]);
    }
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        maxK = Math.max(maxK, Math.abs(K[i * n + j]));
        maxC = Math.max(maxC, Math.abs(C[i * n + j]));
      }
    }
    this.rho = Math.max(1e-9, Math.min(1e12,
      Math.max(Math.sqrt(maxK / Math.max(minM, 1e-30)), maxC / Math.max(minM, 1e-30), 1e-3)));

    /* The denominator of every transfer function this system has: one polynomial,
       and every numerator is the same determinant with one column moved. */
    const denAscending = polynomialDeterminant(K, C, this.diagM(), n, this.rho, null);
    /* Sign convention: a positive leading coefficient, so a panel that prints
       s^4 first prints the physical version of it and never its negative. */
    if (denAscending[2 * n] < 0) for (let i = 0; i < denAscending.length; i++) denAscending[i] = -denAscending[i];
    this.denominatorAscending = Float64Array.from(denAscending);
    const denScale = Math.max(...Array.from(denAscending, Math.abs), 1e-300);
    this.denominator = descending(denAscending, denScale);
    this.denScale = denScale;
    this.poles = polyRoots(this.denominator);

    this._transferCache.clear();
    this._buildStateSpace();
    this._buildModes();
    this._buildLedger();
    return this;
  }

  /** M as a diagonal matrix, which is all it ever is: one coordinate per mass. */
  diagM() {
    const n = this.n;
    const D = zerosFlat(n);
    for (let i = 0; i < n; i++) D[i * n + i] = this.M[i];
    return D;
  }

  /** The inputs this system can be driven by, as the transfer-function panel
   *  needs them: a force on a mass, and the base motion if anything reaches the
   *  ground. `b0` is the constant part and `b1` the part that goes with s - a
   *  base displacement enters through both a spring and a damper. */
  inputs() {
    const n = this.n;
    const labels = this.labels();
    const list = [];
    /* One entry per force that is actually on a mass. A force the reader has
       unhooked from every block is not an input at all: there is no column of
       the flow for it to enter through, which is exactly what an unconnected
       shaker does to a rig. */
    this.spec.drives.forEach((drive, index) => {
      if (drive.mass === null || drive.mass === undefined) return;
      if (!(drive.mass >= 0 && drive.mass < n)) return;
      const b0 = new Float64Array(n);
      b0[drive.mass] = 1;
      list.push({
        key: index === 0 ? "force" : `force${index + 1}`,
        drive: index,
        kind: "force",
        label: `A force on ${labels.masses[drive.mass] ?? "a mass"}`,
        b0,
        b1: null,
      });
    });
    if (this.hasGround) {
      list.push({
        key: "base",
        kind: "base",
        label: "The base moving",
        b0: Float64Array.from(this.groundStiffness),
        b1: Float64Array.from(this.groundDamping),
      });
    }
    return list;
  }

  /** One input by name. A rig with no inputs at all - nothing pushing, nothing
   *  shaken - has none to hand back, so a caller that only wants to draw a curve
   *  gets null and draws nothing rather than an exception. */
  input(key) {
    const list = this.inputs();
    return list.find((i) => i.key === key) ?? list[0] ?? null;
  }

  _buildStateSpace() {
    const n = this.n;
    const spec = this.spec;

    /* Which drives are actually on, and therefore which have a generator in the
       state. An impulse contributes no generator: it is a velocity handed over at
       the start of the run, not a force that persists. */
    const active = [];
    const add = (kind, waveform, amplitude, frequency, b0, b1) => {
      if (waveform === "off" || waveform === "impulse") return null;
      const entry = { kind, waveform, amplitude, frequency, b0, b1, omega: 2 * Math.PI * frequency };
      active.push(entry);
      return entry;
    };
    /* Every force on the bench that is on gets its own generator, so a rig with
       a shaker on each of two masses is one state-space problem with two
       sources and not two problems - the masses are joined, and the answer to
       "what does each shaker do" is only meaningful with both of them in the
       same flow. */
    for (const input of this.inputs()) {
      const source = input.kind === "base" ? spec.base : (spec.drives[input.drive] ?? {});
      const entry = add(input.kind, source.waveform, source.amplitude, source.frequency, input.b0, input.b1);
      /* Which force this generator *is*, so a panel can read its own number back
         out of the state rather than the first force's. */
      if (entry) entry.drive = input.drive;
    }
    this.activeInputs = active;

    const ns = 2 * n + 2 * active.length;
    this.ns = ns;
    const A = zerosFlat(ns);
    for (let i = 0; i < n; i++) A[i * ns + (n + i)] = 1;
    for (let i = 0; i < n; i++) {
      const inv = 1 / this.M[i];
      for (let j = 0; j < n; j++) {
        A[(n + i) * ns + j] = -inv * this.K[i * n + j];
        A[(n + i) * ns + (n + j)] = -inv * this.C[i * n + j];
      }
    }
    active.forEach((input, k) => {
      const g = 2 * n + 2 * k;
      for (let i = 0; i < n; i++) {
        const inv = 1 / this.M[i];
        A[(n + i) * ns + g] += inv * input.b0[i];
        if (input.b1) A[(n + i) * ns + (g + 1)] += inv * input.b1[i];
      }
      if (input.waveform === "sine") {
        A[g * ns + (g + 1)] = 1;
        A[(g + 1) * ns + g] = -input.omega * input.omega;
      }
      input.index = g;
    });
    this.A = A;
    /* The flow over one step, which is the whole of the numerical method: e^(A dt).
       Every parameter that reaches the state matrix has already been applied, so
       this is the same step the equations describe and not a discretisation of
       them. */
    this.Phi = expm(scaleFlat(A, this.dt, ns), ns);
  }

  /** Each active drive's two state values at t = 0, so that the generator solves
   *  the waveform the panel says it does: a sine starts at zero going up, a step
   *  starts at its full value. */
  _generatorInitialState() {
    const z = new Float64Array(this.ns);
    for (const input of this.activeInputs) {
      const g = input.index;
      if (input.waveform === "sine") {
        z[g] = 0;
        z[g + 1] = input.amplitude * input.omega;
      } else {
        z[g] = input.amplitude;
        z[g + 1] = 0;
      }
    }
    return z;
  }

  _buildModes() {
    const n = this.n;
    /* The undamped problem, made symmetric by the mass: B = M^-1/2 K M^-1/2 has
       the same eigenvalues as M^-1 K and eigenvectors that cost one division to
       turn back into mode shapes. Symmetry is what lets a simple, always-
       convergent rotation method be used rather than a general eigensolver. */
    const B = zerosFlat(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        B[i * n + j] = this.K[i * n + j] / Math.sqrt(this.M[i] * this.M[j]);
      }
    }
    const { values, vectors } = symmetricEigen(B, n);
    this.modes = values.map((value, index) => {
      const omega = Math.sqrt(Math.max(0, value));
      const shape = new Float64Array(n);
      for (let i = 0; i < n; i++) shape[i] = vectors[index][i] / Math.sqrt(this.M[i]);
      /* A mode's shape is only a direction, so the largest component is made
         positive: two runs of the same system then draw the same picture. */
      let biggest = 0;
      for (let i = 0; i < n; i++) if (Math.abs(shape[i]) > Math.abs(shape[biggest])) biggest = i;
      if (shape[biggest] < 0) for (let i = 0; i < n; i++) shape[i] = -shape[i];
      return { omega, frequency: omega / (2 * Math.PI), shape };
    });
  }

  /**
   * The two quadratic forms the energy ledger is made of, and their exact
   * integrals over one step.
   *
   * Kinetic energy, elastic energy and the power in from the base are all
   * quadratic forms in the state - energy is one by construction, and the base's
   * power is because the force it applies is proportional to the relative
   * displacement and velocity. The integral of a quadratic form along a linear
   * flow has a closed form:
   *
   *     integral of z' Q z dt from 0 to h = z0' ( integral of Phi' Q Phi dt ) z0
   *
   * and both matrices in that product come out of one matrix exponential, by Van
   * Loan's block trick: exponentiating [[-A', Q], [0, A]] gives the integral in
   * its corner. So the ledger is not accumulated step by step and hoping for the
   * best - it is exact, and the residual the panel prints is floating-point noise
   * rather than the order of the timestep.
   */
  _buildLedger() {
    const n = this.n;
    const ns = this.ns;
    const spec = this.spec;
    const W = zerosFlat(ns);        // total energy: kinetic plus elastic
    const QinForce = zerosFlat(ns); // power in from a force on a mass
    const QinBase = zerosFlat(ns);  // power in from the base, either sign
    const Qd = zerosFlat(ns);       // power leaving through the dampers

    /* The half-symmetric stamp: a term a*z_i*z_j in the form is Q_ij = Q_ji = a/2,
       because z'Qz counts a cross term twice. Written once, used everywhere. */
    const half = (matrix, i, j, value) => {
      matrix[i * ns + j] += value / 2;
      matrix[j * ns + i] += value / 2;
    };

    /* KE and PE, as one form. Kinetic first: mass in the velocity block. */
    for (let i = 0; i < n; i++) W[(n + i) * ns + (n + i)] = this.M[i];

    const baseIndex = this.activeInputs.find((i) => i.kind === "base")?.index ?? null;
    for (const e of this.spec.elements) {
      if (e.kind !== "spring") continue;
      /* A spring with an end in the air stores no energy: there is no pair of
         coordinates for the stretch between them to live on. */
      if (e.a === null || e.a === undefined || e.b === null || e.b === undefined) continue;
      const value = Number(e.k) || 0;
      const a = e.a === "g" ? null : e.a;
      const b = e.b === "g" ? null : e.b;
      if (a !== null && b !== null) {
        W[a * ns + a] += value; W[b * ns + b] += value;
        W[a * ns + b] -= value; W[b * ns + a] -= value;
      } else {
        /* A spring to the ground. When the base is moving, the ground is a
           coordinate in its own right and the spring's energy is measured
           between the mass and it - which is what makes the ledger balance
           during a base-excited run. When the base is held still the ground is
           an origin, and the spring is the mass's own stiffness. */
        const mass = a !== null ? a : b;
        if (baseIndex !== null) {
          W[mass * ns + mass] += value;
          W[baseIndex * ns + baseIndex] += value;
          W[mass * ns + baseIndex] -= value;
          W[baseIndex * ns + mass] -= value;
        } else {
          W[mass * ns + mass] += value;
        }
      }
    }

    for (const input of this.activeInputs) {
      const g = input.index;
      if (input.kind === "force") {
        /* P = f v: the force is the generator's own state, so this is u times the
           driven mass's velocity. */
        for (let i = 0; i < n; i++) if (input.b0[i] !== 0) half(QinForce, g, n + i, input.b0[i]);
      } else {
        /* The base delivers -(k dq + c dv) * vg, the reaction on the ground doing
           work at the ground's own speed. It is negative whenever the base is
           taking energy out of the system, which is the whole of how a vibration
           isolator works. Expanded into stamps:

             -k q_a w + k u w - c v_a w + c w^2
        */
        const w = g + 1;
        for (let i = 0; i < n; i++) {
          if (input.b0[i] !== 0) {
            half(QinBase, i, w, -input.b0[i]);
            half(QinBase, g, w, input.b0[i]);
          }
          if (input.b1[i] !== 0) {
            half(QinBase, n + i, w, -input.b1[i]);
            QinBase[w * ns + w] += input.b1[i];
          }
        }
      }
    }

    const baseVelocity = baseIndex === null ? null : baseIndex + 1;
    for (const e of this.spec.elements) {
      if (e.kind !== "damper") continue;
      /* A damper with an end in the air dissipates nothing, for the same reason
         a spring with one stores nothing: there is no relative velocity. */
      if (e.a === null || e.a === undefined || e.b === null || e.b === undefined) continue;
      const value = Number(e.c) || 0;
      const a = e.a === "g" ? null : e.a;
      const b = e.b === "g" ? null : e.b;
      if (a !== null && b !== null) {
        Qd[(n + a) * ns + (n + a)] += value; Qd[(n + b) * ns + (n + b)] += value;
        Qd[(n + a) * ns + (n + b)] -= value; Qd[(n + b) * ns + (n + a)] -= value;
      } else {
        /* A damper to the ground dissipates c (v_a - vg)^2, which is three
           stamps rather than one as soon as the ground can move - and the cross
           term is the whole of (v_a - vg)^2, so it carries the two of the 2 v_a
           vg that the expansion has. Written with the two, because a damper that
           is only wrong while the floor is moving is exactly the kind of error a
           check on a still floor would never see. */
        const mass = a !== null ? a : b;
        Qd[(n + mass) * ns + (n + mass)] += value;
        if (baseVelocity !== null) {
          half(Qd, n + mass, baseVelocity, -2 * value);
          Qd[baseVelocity * ns + baseVelocity] += value;
        }
      }
    }

    this.W = W;
    this.QinForce = QinForce;
    this.QinBase = QinBase;
    this.Qdissipated = Qd;
    this.ZinForce = this._quadraticIntegral(QinForce);
    this.ZinBase = baseIndex === null ? null : this._quadraticIntegral(QinBase);
    this.Zd = this._quadraticIntegral(Qd);
  }

  /** ∫ Phi' Q Phi dt over one step, from exp of the Van Loan block matrix. */
  _quadraticIntegral(Q) {
    const ns = this.ns;
    const A = this.A;
    const size = 2 * ns;
    const block = zerosFlat(size);
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < ns; j++) {
        block[i * size + j] = -A[j * ns + i];                 // -A'
        block[i * size + (ns + j)] = Q[i * ns + j];           // Q
        block[(ns + i) * size + (ns + j)] = A[i * ns + j];    // A
      }
    }
    const E = expm(scaleFlat(block, this.dt, size), size);
    const corner = zerosFlat(ns);
    for (let i = 0; i < ns; i++) for (let j = 0; j < ns; j++) corner[i * ns + j] = E[i * size + (ns + j)];
    /* Phi' * corner, with Phi' available as the transpose of Phi. */
    const out = zerosFlat(ns);
    for (let i = 0; i < ns; i++) {
      for (let j = 0; j < ns; j++) {
        let s = 0;
        for (let k = 0; k < ns; k++) s += this.Phi[k * ns + i] * corner[k * ns + j];
        out[i * ns + j] = s;
      }
    }
    return out;
  }

  /** z' Q z, the only way these forms are ever read. */
  _quadratic(Z, z) {
    const ns = this.ns;
    let total = 0;
    for (let i = 0; i < ns; i++) {
      let row = 0;
      for (let j = 0; j < ns; j++) row += Z[i * ns + j] * z[j];
      total += row * z[i];
    }
    return total;
  }

  /* ----------------------------------------------------------------------------
     RUNNING
     ---------------------------------------------------------------------------- */

  /** Put the system where a run starts: the state the spec asks for, the
   *  generators set to the waveform's value at t = 0, and the ledger empty but
   *  for the work any impulses have already done. */
  reset() {
    const n = this.n;
    const z = this._generatorInitialState();
    for (let i = 0; i < n; i++) {
      z[i] = this.spec.x0[i];
      z[n + i] = this.spec.v0[i];
    }
    /* The books are opened *before* the blow lands. A blow puts energy into the
       system, and energy the system did not have a moment ago has to appear in
       the ledger as work in - measuring the starting energy afterwards would
       fold the whole of the impulse into what the system "began with" and leave
       the one experiment that is nothing but a blow with a residual of exactly
       the energy it is about. */
    this.energy0 = this._quadratic(this.W, z) / 2;
    let impulseWork = 0;
    /* Every force set to a blow lands its own blow, on its own mass, at the same
       instant: two hammers striking together are two hammers. A blow that is not
       attached to anything strikes nothing. */
    for (const drive of this.spec.drives) {
      if (drive.waveform !== "impulse") continue;
      if (drive.mass === null || drive.mass === undefined) continue;
      const j = drive.mass;
      const before = z[n + j];
      const after = before + drive.amplitude / this.M[j];
      /* What a blow delivers is the impulse times the speed it meets: pushing a
         mass that is already moving does more work than pushing one at rest. */
      impulseWork += drive.amplitude * (before + (after - before) / 2);
      z[n + j] = after;
    }
    this.state = z;
    this._scratch = new Float64Array(this.ns);
    this.time = 0;
    this.steps = 0;
    this.workDrive = 0;
    this.workBase = 0;
    this.workImpulse = impulseWork;
    this.dissipated = 0;
    this.power = { drive: 0, base: 0, dissipated: 0 };
    this.held = null;
    this.peak = { displacement: 0, velocity: 0, acceleration: 0 };
    return this;
  }

  /**
   * One step, exactly.
   *
   * The whole of the numerical method is this one multiplication, and the reason
   * it is enough is that the drive is part of the state: a sine is generated by
   * the same linear flow the masses obey, so advancing both together by the
   * matrix exponential is the exact solution of the driven system - not an
   * approximation of it with the input held across the step, which is how a sine
   * would quietly become a staircase.
   *
   * The ledger's integrals are read on the state the step *starts* from, because
   * over the step the state is exactly Phi(t) z0. Where a mass is being held by a
   * hand the equations are bypassed for that one coordinate - an intervention and
   * not a step - and the ledger is left alone, since the hand's own work is not
   * the system's business.
   */
  step() {
    const z = this.state;
    const ns = this.ns;
    if (this.held === null) {
      this.workDrive += this._quadratic(this.ZinForce, z);
      if (this.ZinBase) this.workBase += this._quadratic(this.ZinBase, z);
      this.dissipated += this._quadratic(this.Zd, z);
      this.power.drive = this._quadratic(this.QinForce, z);
      this.power.base = this.ZinBase ? this._quadratic(this.QinBase, z) : 0;
      this.power.dissipated = this._quadratic(this.Qdissipated, z);
      matVec(this.Phi, z, this._scratch, ns);
      const next = this._scratch;
      this._scratch = z;
      this.state = next;
    } else {
      /* Held: the mass is where the hand put it, at rest, and only the other
       *  coordinates advance. A one-coordinate override of the exact flow, which
       *  is exactly what a clamp is. */
      const { index } = this.held;
      matVec(this.Phi, z, this._scratch, ns);
      this._scratch[index] = this.held.x;
      this._scratch[this.n + index] = 0;
      const next = this._scratch;
      this._scratch = z;
      this.state = next;
    }
    this.time += this.dt;
    this.steps++;
    return this;
  }

  /** Advance n steps; stops early if nothing is moving and nothing is driving. */
  advance(count) {
    for (let i = 0; i < count; i++) this.step();
    return this;
  }

  /** Hold one mass at a displacement, the way a hand does: the state is written,
   *  not the equations, so the system is in exactly that position while it is
   *  held, and lets go from there when it is not. */
  hold(index, x) {
    this.held = { index, x };
    this.state[index] = x;
    this.state[this.n + index] = 0;
    return this;
  }

  release() { this.held = null; return this; }

  /** The reporting step. Changing it re-assembles the flow, since the step is
   *  inside the matrix exponential the whole method is. */
  setDt(dt) {
    this.dt = Math.max(1e-6, Number(dt) || 1 / 600);
    this.rebuild();
    return this;
  }

  /* ----------------------------------------------------------------------------
     WHAT THE PANELS READ
     ---------------------------------------------------------------------------- */

  /** Displacement, velocity and acceleration of every mass, plus the two
   *  energies, the ledger, and the live value of each drive. Allocates a small
   *  payload per call: this is called once per frame, not once per step. */
  observe() {
    const n = this.n;
    const ns = this.ns;
    const z = this.state;
    const x = new Float64Array(n);
    const v = new Float64Array(n);
    const a = new Float64Array(n);
    for (let i = 0; i < n; i++) { x[i] = z[i]; v[i] = z[n + i]; }
    for (let i = 0; i < n; i++) {
      let acc = 0;
      for (let j = 0; j < n; j++) acc += -this.K[i * n + j] * x[j] - this.C[i * n + j] * v[j];
      a[i] = acc / this.M[i];
    }

    /* The acceleration above came from the springs and dampers alone, and the
       drives are not in those matrices - they are in the state - so their share
       is added here. One line, and the same line for both kinds of input, since
       a base motion enters the masses' equations through exactly the influence
       vectors a force does. */
    const demands = [];
    for (const input of this.activeInputs) {
      const g = input.index;
      const u = z[g];
      const rate = z[g + 1];
      for (let i = 0; i < n; i++) {
        let force = input.b0[i] * u;
        if (input.b1) force += input.b1[i] * rate;
        if (force !== 0) a[i] += force / this.M[i];
      }
      if (input.kind === "force") {
        demands.push({ kind: "force", drive: input.drive, value: u, rate, omega: input.omega, amplitude: input.amplitude });
      } else {
        demands.push({
          kind: "base", value: u, rate, omega: input.omega, amplitude: input.amplitude,
          acceleration: input.waveform === "sine" ? -input.omega * input.omega * u : 0,
        });
      }
    }

    const kinetic = this._velocityEnergy(z);
    const elastic = this._quadratic(this.W, z) / 2 - kinetic;
    const total = kinetic + elastic;
    const forces = this.activeInputs.filter((i) => i.kind === "force");
    const drive = forces[0] ?? null;
    const base = this.activeInputs.find((i) => i.kind === "base");

    const out = this.spec.output;
    const probe = { index: out, x: x[out], v: v[out], a: a[out] };
    this.peak.displacement = Math.max(this.peak.displacement, Math.abs(x[out]));
    this.peak.velocity = Math.max(this.peak.velocity, Math.abs(v[out]));
    this.peak.acceleration = Math.max(this.peak.acceleration, Math.abs(a[out]));

    const workIn = this.workImpulse + this.workDrive + this.workBase;
    return {
      time: this.time,
      steps: this.steps,
      dt: this.dt,
      x, v, a,
      kinetic,
      elastic,
      total,
      energy0: this.energy0,
      workDrive: this.workDrive,
      workBase: this.workBase,
      workImpulse: this.workImpulse,
      workIn,
      dissipated: this.dissipated,
      power: { ...this.power },
      residual: (total - this.energy0) - workIn + this.dissipated,
      /* What the residual is measured *against*, and the energy actually in the
         system belongs in it. A residual is a rounding error of the arithmetic
         that produced the energies, so it is only ever as small as the largest
         of them - and at rest, with an empty ledger and the books freshly
         started, every one of those terms is nought and the nought they are
         divided by turns a few picquoles of rounding into an enormous ratio. */
      residualScale: Math.max(Math.abs(total), Math.abs(this.energy0), Math.abs(workIn), Math.abs(this.dissipated), 1e-30),
      /* Every force on the bench and what it is doing right now. `drives` is the
         whole list - a rig can carry a shaker on each of two masses, and each
         one's panel reads its own number out of this - and `drive` is the first
         of them, which is what every reader that has only ever known one force
         (the checks, the readouts, an older panel) still asks for. */
      drives: forces.map((input) => ({
        index: input.drive,
        mass: this.spec.drives[input.drive]?.mass ?? null,
        value: z[input.index],
        rate: z[input.index + 1],
        amplitude: input.amplitude,
        frequency: input.frequency ?? 0,
        waveform: input.waveform,
      })),
      drive: drive ? {
        index: drive.drive,
        mass: this.spec.drives[drive.drive]?.mass ?? null,
        value: z[drive.index],
        rate: z[drive.index + 1],
        amplitude: drive.amplitude,
        frequency: drive.frequency ?? 0,
        waveform: drive.waveform,
      } : null,
      base: base
        ? { value: z[base.index], velocity: z[base.index + 1], frequency: this.spec.base.frequency, amplitude: this.spec.base.amplitude }
        : null,
      probe,
      peak: { ...this.peak },
      demands,
    };
  }

  _velocityEnergy(z) {
    const n = this.n;
    let total = 0;
    for (let i = 0; i < n; i++) { const v = z[n + i]; total += 0.5 * this.M[i] * v * v; }
    return total;
  }

  /* ----------------------------------------------------------------------------
     TRANSFER FUNCTIONS, POLES AND THE FREQUENCY RESPONSE
     ---------------------------------------------------------------------------- */

  /**
   * H(s) from one input to one mass's displacement, as two polynomials.
   *
   * Straight out of the matrices: the denominator is det(M s^2 + C s + K) and the
   * numerator is the same determinant with the output's column replaced by the
   * input's influence vector - Cramer's rule, applied to the polynomial matrix
   * instead of a numerical one. So this is the transfer function the system
   * *has*, computed from its own numbers, not a fit to a response.
   *
   * @param {'force'|'base'} from
   * @param {number} to mass index
   * @returns {{from:string, to:number, num:number[], den:number[]}} highest first
   */
  transfer(from, to) {
    const key = `${from}:${Math.round(to)}`;
    const cached = this._transferCache.get(key);
    if (cached) return cached;
    const input = this.input(from);
    const target = Math.min(Math.max(0, Math.round(to)), this.n - 1);
    /* A rig with nothing on it that can be pushed - every force unhooked, no
       ground to shake - has no transfer function to draw, and a panel that asks
       for one gets a flat zero rather than an exception. */
    if (!input) {
      const zero = { from, to: target, num: [0], den: Array.from(this.denominator) };
      return zero;
    }
    const n = this.n;
    const ascending = polynomialDeterminant(
      this.K, this.C, this.diagM(), n, this.rho,
      { col: target, b0: input.b0, b1: input.b1 },
    );
    const denLeading = this.denominator[0];
    if (denLeading < 0) for (let i = 0; i < ascending.length; i++) ascending[i] = -ascending[i];
    const num = descending(ascending, this.denScale);
    const result = { from, to: target, num, den: Array.from(this.denominator) };
    this._transferCache.set(key, result);
    return result;
  }

  /** H(j omega) as magnitude and phase, in degrees. Evaluated from the same two
   *  polynomials the panel prints, so the curve and the formula cannot disagree. */
  frequencyResponse(from, to, omega) {
    const { num, den } = this.transfer(from, to);
    const s = { re: 0, im: omega };
    const numerator = evalPolyComplex(num, s);
    const denominator = evalPolyComplex(den, s);
    const value = cdiv(numerator, denominator);
    return {
      re: value.re,
      im: value.im,
      magnitude: cabs(value),
      phase: (Math.atan2(value.im, value.re) * 180) / Math.PI,
    };
  }

  /** The gain at zero frequency: what a steady push does in the end. Infinity is
   *  a real answer - a system with a rigid-body mode has no steady deflection from
   *  a constant force, it has a steady acceleration. */
  dcGain(from, to) {
    const { num, den } = this.transfer(from, to);
    const denominator = den[den.length - 1];
    /* The constant term of the denominator is the product of the ground
       stiffnesses, or zero for a rig with a mass nothing holds: the friction
       pair's upper block, for one. Zero there is not "a very small number" - it
       is a rigid-body mode, and a steady force on one of those produces a steady
       *acceleration*, so there is no gain to report and the panel says so.

       Which of the two it is has to be asked relatively: the term that should be
       exactly zero comes out of the assembly as rounding, next to coefficients
       of order a hundred, so an absolute threshold would divide one rounding by
       another and hand the reader a number with no meaning at all. */
    const scale = den.reduce((biggest, value) => Math.max(biggest, Math.abs(value)), 0);
    if (!Number.isFinite(denominator) || Math.abs(denominator) <= 1e-9 * scale) return null;
    return num[num.length - 1] / denominator;
  }

  /** The poles as damping ratios and damped frequencies, which is what a
   *  vibrations panel is actually asked for: a pole is where the system would
   *  ring if you let it, and zeta is how long it rings for. */
  poleReport() {
    return this.poles.map((pole) => {
      const omega = Math.hypot(pole.re, pole.im);
      return {
        re: pole.re,
        im: pole.im,
        omega,
        frequency: omega / (2 * Math.PI),
        damping: omega > 0 ? -pole.re / omega : 0,
      };
    });
  }

  /* ----------------------------------------------------------------------------
     EDITING THE MODEL
     ---------------------------------------------------------------------------- */

  /** Change one number and re-assemble. The state is left exactly as it was:
   *  stiffening a spring mid-run stiffens it from that step on, which is the
   *  experiment, not a reason to start again. */
  _edit(mutate, { rebase = true } = {}) {
    mutate(this.spec);
    this.spec = normalizeSpec(this.spec);
    this.rebuild();
    /* A rebuild can change how many states the drive brings with it, so the
     *  state vector is re-made where the generators are concerned and the masses
     *  are carried across. */
    if (this.ns !== this.state.length) {
      const previous = this.state;
      const next = this._generatorInitialState();
      for (let i = 0; i < this.n; i++) {
        next[i] = previous[i] ?? this.spec.x0[i];
        next[this.n + i] = previous[this.n + i] ?? 0;
      }
      this.state = next;
      this._scratch = new Float64Array(this.ns);
    }
    /* A drive that has been retuned starts its waveform again, while the masses
       keep exactly where they were: changing a drive's frequency is changing what
       the source is doing, and a sine that carried on from wherever the last one
       had got to would be a source with a memory it does not have. */
    if (this.ns > 2 * this.n) {
      const initial = this._generatorInitialState();
      for (let k = 2 * this.n; k < this.ns; k++) this.state[k] = initial[k];
    }
    if (rebase) this.rebase();
    return this;
  }

  /**
   * Start the energy books again from where the system is now.
   *
   * The same move the Dynamics bench makes when a shape is edited: retuning a
   * spring or adding a mass changes how much energy the system is holding, and a
   * ledger that carried on across the change would report the difference as
   * energy invented by the panel. So an edit is a new experiment - the state is
   * kept, the books are new - and the residual the panel prints stays zero
   * because every term of it was written down after the change instead of before.
   */
  rebase() {
    this.energy0 = this._quadratic(this.W, this.state) / 2;
    this.workDrive = 0;
    this.workBase = 0;
    this.workImpulse = 0;
    this.dissipated = 0;
    this.power = { drive: 0, base: 0, dissipated: 0 };
    this.peak = { displacement: 0, velocity: 0, acceleration: 0 };
    return this;
  }

  setMass(i, m) { return this._edit((s) => { s.masses[i].m = m; }); }

  setSpring(index, k) {
    return this._edit((s) => {
      let seen = 0;
      for (const e of s.elements) if (e.kind === "spring" && seen++ === index) e.k = k;
    });
  }

  setDamper(index, c) {
    return this._edit((s) => {
      let seen = 0;
      for (const e of s.elements) if (e.kind === "damper" && seen++ === index) e.c = c;
    });
  }  /** Change a force's own numbers: `setDrive(patch)` is the first force and
   *  `setDrive(index, patch)` is the one the panel has open. */
  setDrive(indexOrPatch, patch) {
    if (typeof indexOrPatch === "number") {
      return this._edit((s) => { Object.assign(s.drives[indexOrPatch] ?? s.drives[0], patch ?? {}); });
    }
    return this._edit((s) => { Object.assign(s.drives[0], indexOrPatch ?? {}); });
  }
  setBase(patch) { return this._edit((s) => { Object.assign(s.base, patch); }); }

  /**
   * Say what is driving the system, and make the drives agree with it: one thing
   * excited, one answer to "what is driving it".
   *
   * This is the one-drive command behind the panel's "What drives it" picker,
   * and it is a *statement* rather than a pair of switches: choosing the force
   * puts the shake table away and the other way round. The instruments in the
   * stage's own strip are the other door into the same two numbers, and they are
   * independent - setInput switches one without touching the other - because a
   * reader who wants to shake a bench they are already driving should be able to.
   */
  setExcitation(kind) {
    return this._edit((s) => {
      s.excitation = kind === "base" ? "base" : "force";
      if (s.excitation === "force") {
        if (s.drive.waveform === "off") s.drive.waveform = "sine";
        s.base.waveform = "off";
      } else {
        if (s.base.waveform === "off") s.base.waveform = "sine";
        s.drive.waveform = "off";
      }
    });
  }

  /**
   * Switch one of the two inputs on or off and leave the other exactly as it is.
   *
   * The two are two instruments: putting the shake table out does not take the
   * force off the bench, and switching the force on does not stop the ground
   * moving. Switching one on also points the analysis at it, because a reader
   * who has just put something out is asking about that; switching one off moves
   * the analysis to the other if it was reading the one that has gone quiet.
   */
  setInput(kind, on) {
    return this._edit((s) => {
      const key = kind === "base" ? "base" : "force";
      const target = key === "base" ? s.base : s.drive;
      const other = key === "base" ? s.drive : s.base;
      if (on) {
        if (target.waveform === "off") target.waveform = "sine";
        s.excitation = key;
      } else {
        target.waveform = "off";
        if (s.excitation === key && other.waveform !== "off") s.excitation = key === "base" ? "force" : "base";
      }
    });
  }

  /**
   * Which input the transfer function and the response readouts are read from.
   *
   * Analysis only: it starts nothing, stops nothing and moves nothing on the
   * stage, so a reader can ask what the ground would do to this rig without
   * switching the force off to find out. That is also why it leaves the energy
   * books alone - like moving the probe, it is a change of what is being
   * *looked at*, not of what the system is doing.
   */
  setAnalysedInput(kind) {
    return this._edit((s) => { s.excitation = kind === "base" ? "base" : "force"; }, { rebase: false });
  }

  /** Stop driving, without taking any instrument off the stage. */
  stopDriving() {
    return this._edit((s) => { s.drive.waveform = "off"; s.base.waveform = "off"; });
  }

  /* Moving the probe changes nothing the system is doing, so the ledger carries
     on across it: this is the one edit that is not a new experiment. */
  setOutput(i) { return this._edit((s) => { s.output = i; }, { rebase: false }); }

  /** Displace one mass and let go: the classic plucked system, and what a drag
   *  on the stage leaves behind. The displacement is remembered as the starting
   *  condition, so a restart reproduces it. */
  pluck(index, x) {
    this._edit((s) => {
      s.x0[index] = x;
      for (let i = 0; i < s.x0.length; i++) if (i !== index) s.x0[i] = 0;
      for (let i = 0; i < s.v0.length; i++) s.v0[i] = 0;
    });
    return this.reset();
  }

  /** Add one mass to the right end of the chain, joined to its neighbour by a
   *  spring and a damper: the button that turns a two-mass problem into a
   *  three-mass one without anyone editing a file. */
  addMass(m = 1, k = 10, c = 0.5) {
    const next = appendedMass(this.spec, m, k, c);
    next.output = this.spec.output;
    /* Every force is left where it was: normalizeSpec clamps a mass index into
       the new range, and a force that was unhooked from every mass stays
       unhooked - adding a block to the bench does not push an arrow onto it. */
    return this._edit((s) => { Object.assign(s, next); });
  }

  /** Take the last mass off, and every element that reached it. */
  removeLastMass() {
    if (this.n <= 1) return this;
    const last = this.n - 1;
    return this._edit((s) => {
      s.masses = s.masses.slice(0, last);
      s.elements = s.elements.filter((e) => e.a !== last && e.b !== last);
      s.x0 = s.x0.slice(0, last);
      s.v0 = s.v0.slice(0, last);
      s.output = Math.min(s.output, last - 1);
      for (const drive of s.drives) {
        if (drive.mass === null || drive.mass === undefined) continue;
        drive.mass = Math.min(drive.mass, last - 1);
      }
    });
  }

  /* ----------------------------------------------------------------------------
     PUTTING A PART ON THE BENCH, MOVING IT, AND TAKING IT OFF AGAIN
     ----------------------------------------------------------------------------
     A part is either bolted to a mass, bolted to the ground, or bolted to
     nothing at all - and the third one is a real answer rather than a missing
     one. A spring lying on the bench holding nothing is a state a reader can put
     the bench into by hand, the stage draws it hanging off whatever it still
     holds, and the bench says out loud that it is holding nothing. What it does
     to the physics is nothing, which is what a loose spring does to a rig. */

  /** Put a spring or a dashpot on the bench, between two things: a mass index,
   *  "g" for the ground, or null for nothing.
   *
   *  @returns {number} the index the new element has in the spec's own list,
   *    which is the index the stage and the panels call it by. */
  addElement(kind = "spring", a = 0, b = "g", value = null) {
    const index = this.spec.elements.length;
    const amount = Number(value);
    this._edit((s) => {
      s.elements = [...s.elements, kind === "damper"
        ? { kind: "damper", a, b, c: amount > 0 ? amount : 0.5 }
        : { kind: "spring", a, b, k: amount > 0 ? amount : 10 }];
    });
    return index;
  }

  /** Take one element off the bench, by its index in the spec's own list. */
  removeElement(index) {
    return this._edit((s) => { s.elements = s.elements.filter((_, i) => i !== index); });
  }

  /** Bolt an element's ends to something: a mass index, "g", or null for
   *  nothing. Both ends in one edit, so a part dragged across the bench never
   *  passes through a moment where it is bolted to the same thing twice.
   *
   *  A patch may also carry `hang` (which way a part with an end in the air
   *  hangs) and `stub` (how far that end still reaches, signed) - the two
   *  numbers that let a part whose block was picked up and carried off be drawn
   *  *exactly where it was*: it is the same part, the same length, in the same
   *  place, holding nothing. A part that is bolted at both ends again has no use
   *  for either, so they are dropped when it is reconnected. */
  setElement(index, patch = {}) {
    return this._edit((s) => {
      const element = s.elements[index];
      if (!element) return;
      if (patch.a !== undefined) element.a = patch.a;
      if (patch.b !== undefined) element.b = patch.b;
      const loose = (v) => v === null || v === undefined;
      /* Both ends on one thing is a spring from a mass to itself: not a spring,
         and not what the hand that dropped it there meant either. The far end
         lets go instead. */
      if (element.a === element.b && !loose(element.a)) element.b = null;
      if (patch.hang === 1 || patch.hang === -1) element.hang = patch.hang;
      if (patch.stub === null || patch.stub === undefined) delete element.stub;
      else if (Number.isFinite(Number(patch.stub)) && Number(patch.stub) !== 0) {
        element.stub = Number(patch.stub);
      }
      if (!loose(element.a) && !loose(element.b)) delete element.stub;
    });
  }

  /** Put another force on the bench.
   *
   *  A rig can carry a shaker on each of two masses: the two are independent
   *  sources, the flow carries a generator for each, and the ledger books what
   *  each of them puts in - so this is the second shaker as often as the first.
   *
   *  @returns {number} the index of the new force in the spec's own list. */
  addDrive(patch = {}) {
    const index = this.spec.drives.length;
    this._edit((s) => {
      s.drives = [...s.drives, { mass: 0, waveform: "sine", amplitude: 1, frequency: 0.5, ...patch }];
    });
    return index;
  }

  /** Take a force off the bench. The last one is not removed but switched off:
   *  a spec always carries at least one force, and a force that is off is
   *  exactly a force that is doing nothing. */
  removeDrive(index) {
    if (this.spec.drives.length <= 1) return this.setDrive(0, { waveform: "off" });
    return this._edit((s) => { s.drives = s.drives.filter((_, i) => i !== index); });
  }

  /** Hook a force onto a mass, or off every mass: null is a shaker standing on
   *  the bench with its arrow pointing at nothing, which pushes nothing. */
  setDriveMass(index, mass) {
    return this._edit((s) => {
      const drive = s.drives[index];
      if (!drive) return;
      drive.mass = mass === null || mass === undefined ? null : Math.round(mass);
    });
  }

  /** Exchange two masses' places along the bench, with everything attached to
   *  each of them going with it: the springs, the dashpots, the force on it and
   *  the probe. The rig is the same rig drawn the other way round, which is what
   *  moving a block past its neighbour means - and when the two blocks are not
   *  the same block, it is a different system afterwards, because what was
   *  attached to the left-hand one now hangs off the right-hand one. */
  swapMasses(i, j) {
    if (i === j) return this;
    const n = this.n;
    if (!(i >= 0 && i < n && j >= 0 && j < n)) return this;
    const move = (v) => (v === i ? j : v === j ? i : v);
    const onto = (v) => (v === null || v === undefined || v === "g" ? v : move(v));
    this._edit((s) => {
      const held = s.masses[i];
      s.masses[i] = s.masses[j];
      s.masses[j] = held;
      for (const element of s.elements) {
        element.a = onto(element.a);
        element.b = onto(element.b);
      }
      for (const drive of s.drives) drive.mass = onto(drive.mass);
      s.output = move(s.output);
      const x = s.x0[i]; s.x0[i] = s.x0[j]; s.x0[j] = x;
      const v = s.v0[i]; s.v0[i] = s.v0[j]; s.v0[j] = v;
    });
    /* The state goes with the blocks, so the picture does not jump: what was
       the left-hand mass's displacement is now the right-hand mass's. */
    const state = this.state;
    const x = state[i]; state[i] = state[j]; state[j] = x;
    const v = state[n + i]; state[n + i] = state[n + j]; state[n + j] = v;
    return this.rebase();
  }

  /** Replace the whole model. A system preset is a whole system, so choosing one
   *  is this and not four separate edits. */
  setSpec(spec) {
    this.spec = normalizeSpec(spec);
    this.rebuild();
    this.reset();
    return this;
  }

  /* ----------------------------------------------------------------------------
     SAVING
     ---------------------------------------------------------------------------- */

  serialize() {
    return {
      version: 1,
      dt: this.dt,
      spec: JSON.parse(JSON.stringify(this.spec)),
      state: Array.from(this.state),
      time: this.time,
      steps: this.steps,
      dissipated: this.dissipated,
      workDrive: this.workDrive,
      workImpulse: this.workImpulse,
      workBase: this.workBase,
      energy0: this.energy0,
    };
  }

  restore(data) {
    if (!data) return this;
    if (data.spec) this.spec = normalizeSpec(data.spec);
    if (Number.isFinite(data.dt)) this.dt = Math.max(1e-6, data.dt);
    /* Re-assembled before anything is put back into it: the state vector's
       length and the flow both depend on the model and the step. */
    this.rebuild();
    this.reset();
    if (Array.isArray(data.state) && data.state.length === this.ns) {
      const z = new Float64Array(this.ns);
      for (let i = 0; i < this.ns; i++) z[i] = Number(data.state[i]) || 0;
      this.state = z;
      this._scratch = new Float64Array(this.ns);
    }
    if (Number.isFinite(data.time)) this.time = data.time;
    if (Number.isFinite(data.steps)) this.steps = data.steps;
    /* The ledger comes back as it was written, and it has to: a saved run is a
       run that has already spent energy, and a restored one whose books had been
       zeroed would report the work it has done as having appeared from nowhere.
       The residual stays zero because every term of it is restored together. */
    if (Number.isFinite(data.dissipated)) this.dissipated = data.dissipated;
    if (Number.isFinite(data.workDrive)) this.workDrive = data.workDrive;
    if (Number.isFinite(data.workBase)) this.workBase = data.workBase;
    if (Number.isFinite(data.workImpulse)) this.workImpulse = data.workImpulse;
    if (Number.isFinite(data.energy0)) this.energy0 = data.energy0;
    return this;
  }
}
