# Physics Workbench

Four workbenches you can actually take apart. The whole thing runs on one rule:

**every number on screen was measured, and the theory it is checked against is
shown next to it.**

There is a bench for rigid bodies, where you throw things at each other and read
the energy off a chart. There is a bench for kinetic gases, where the pressure is
counted from the momentum the molecules hand to the walls, in real units, with
a pinhole you can open to watch effusion through it. There is a bench for
mechanical vibrations, where the trajectory on screen is the analytic solution
rather than an approximation, because the equations of motion are linear and
get advanced by a matrix exponential rather than stepped. And there is a bench
for liquids, where the free surface is a level set, surface tension is a real
force, and a body in the tank floats at its own density.

Underneath sit two fluid solvers, two interchangeable pressure solvers, a
profiler, and a set of check suites that refuse to let the physics quietly rot.
The benches are deliberately independent, so you can open one and take it apart
without ever needing any of the others.

There is no framework. No build step beyond Vite, no state library, no
`node_modules` holding a UI framework. The whole browser app is plain ES
modules, and the only place that imports `three` is `rendering/`.

---

## A word of thanks

This project grew out of the way Prof. Batty describes the work of the
computational physics group at the University of Waterloo in his teaching and
research materials. The idea of building a physics environment as a collection
of independent, well-tested modules rather than one monolithic engine comes from
that approach: each piece has a clear job, each piece can be read and tested on
its own, and the whole is only as strong as its best section. The drawings of
splashing liquid, floating bodies and falling sheets in these benches follow the
same tradition as his published work on the subject: the surface is a real
thing, the forces are real numbers, and a student can sit in front of the
screen and see the theory become a picture.

Thank you to Prof. Batty for the inspiration, and for making the study of
computational physics feel like something you could build rather than something
you could only read about. His pages at
[https://cs.uwaterloo.ca/~c2batty/](https://cs.uwaterloo.ca/~c2batty/)
showed that a course could be a laboratory, and this project is an attempt to
carry that further, one bench at a time.

---

## Getting it running

```bash
npm install
npm run dev
```

Vite prints a URL, usually `http://localhost:5173`. That is the homepage. From
there, the topic picker opens and the four benches are waiting.

| Route      | What it is                                            |
| ---------- | ----------------------------------------------------- |
| `/`        | The homepage: a hero channel and the bench list       |
| `/dynamics`| Rigid bodies, shapes, collisions                      |
| `/thermo`  | A box of gas, in real units                           |
| `/mech`    | Masses on springs, driving and measuring              |
| `/fluids`  | A tank of liquid, surface tension, a floating body    |

Every bench keeps its experiment. Reload and the scene comes back, with a
notice at the bottom of the stage telling you it did and offering to start
fresh instead.

Node 18 or newer is required, which is Vite 5's floor.

### Every script

| Script               | What it does                                            |
| -------------------- | ------------------------------------------------------- |
| `npm run dev`        | Vite dev server with hot reload                         |
| `npm run build`      | Production bundle into `dist/`                          |
| `npm run preview`    | Serve the built `dist/` exactly as a host would         |
| `npm run check`      | All four check suites, in order. Slow, see below        |
| `npm run check:fluids`| The Fluids suite alone (fast, a couple of minutes)     |
| `npm run check:mech` | The Vibrations suite alone (fast)                       |
| `npm run check:thermo`| The Thermo suite alone (slow, roughly ten minutes)      |
| `node experiments/dynamics_checks.js` | The Dynamics suite alone |
| `npm run bench`      | Times Jacobi against Conjugate Gradient on one problem  |
| `npm run sweep`      | Sweeps resolution by solver by timestep, writes JSON    |

`npm run check` runs dynamics, then thermo, then mech, then fluids. The Thermo
suite takes about ten minutes because it simulates real gases at real
timesteps, which is the whole point of it. The practical loop is to run the
suite you are working on by itself, then run the whole set before you call
something finished.

---

## The four workbenches

### Dynamics, at `/dynamics`

Typed-array rigid bodies under gravity and air drag, with real impulse-based
collisions.

Mass is proportional to radius cubed, so a big ball genuinely outweighs a small
one and the collision response comes out right without anyone tuning a
constant. Broad phase is a uniform spatial hash, so adding bodies costs
roughly linear work rather than a quadratic sweep.

The interesting part is the shapes. A wall, a wedge, a platform, a block or a
sphere is a solid with a mass, and the mass is not a number anybody guesses:
it is density times volume, from the material the shape is made of. A contact
is resolved at the point it happened, and a hit that misses the centre of mass
turns into torque. That one detail is the difference between a wall that slides
and a wall that falls over, and it is why a heavy ball flattens a light panel
while a light one taps it aside.

Every shape is two things at once: a signed distance field, which is what the
physics collides against, and a mesh, which is what the eye sees. The ramp you
can see and the ramp a ball rolls down are the same triangle, built once.

You also get pages (independent scenes that each remember their own state), a
real 3D and 2D camera swap rather than a label, an inspector with live
position, speed, measured acceleration, mass and kinetic energy, live charts
of total kinetic energy and mean speed, save and load to a real `.json` file,
and four instruments you can place on the stage: trails, velocity arrows, a
dashed predicted trajectory so you can watch the simulation disagree with the
textbook, and a floor grid to measure against.

### Thermo, at `/thermo`

A gas in a box, in real units, made of hard spheres that actually bounce.

Nothing is a curve fitted to a textbook. Pressure is the momentum the
molecules handed to the walls, counted as they hit. Temperature is their mean
kinetic energy. Work is the energy the lid put in. The species are noble gases
with their measured kinetic diameters and molar masses, the molecules are
drawn at their real size relative to the box (0.34 nm atoms inside an 18 nm
cube, which is what makes the near-emptiness of a real gas visible instead of
implied), and each one is tinted by its own speed.

**The one honest compromise, stated in the panel.** Argon crosses this box in
about forty picoseconds. There is no simulation of real molecules at real
speeds that looks calm, so this one runs at real speeds and shows a slice of
time: tens of picoseconds of gas per second of watching. The exchange rate is
printed next to the step, so the slow motion is declared rather than hidden.
Every number on the right is still a measurement of the real thing.

**What is exact.** Every molecule-molecule collision conserves momentum and
kinetic energy, unequal masses included. The first law holds live on every
step: internal energy only changes at a wall or the lid, each change is booked
as it happens, and `U - U0 - Q - W + E_escaped` sits at floating-point noise
where you can watch it. Nothing tells the gas what pressure to have;
reflection is the only thing a wall does.

**What is approximate, and labelled.** Collisions resolve on a fixed step
rather than at a solved crossing instant, so a collision happens where the
molecules ended the step rather than exactly where they met. Molecules are
spheres. And the gas is rarefied on purpose: the Knudsen number is about 0.3
rather than the 0.001 of air in a room, which is what makes it watchable and
why the measured compressibility sits a couple of percent above 1 instead of
on top of it.

**Walls that are physics, not textures.** An insulated wall reverses velocity
across the normal and does nothing else, which is exactly the idealisation a
textbook uses for an adiabatic process. That is why a slow squeeze of an
insulated box makes `P V^(5/3)` fall out on its own. An isothermal wall is
held at a temperature, and a molecule leaving it is drawn from the
flux-weighted Maxwellian rather than a plain half-Maxwellian, because a
molecule that leaves a surface is one that arrived. Draw the wrong
distribution and the box settles at the wrong temperature and the pressure
reads 0.82 of `n k T`. Done right, the gas finds the wall's temperature by
itself and the ideal gas law appears out of nothing but collisions.

**The pinhole** opens a real hole in the wall with a real area. Open it and
watch the escaping flux, and the pressure it leaves behind.

### Vibrations, at `/mech`

Masses sliding on one axis, joined by springs and viscous dampers, driven by a
force on one mass or shaken from the ground underneath. That model covers
every figure in a mechanical vibrations text, and the spring-mass-damper and
the quarter car are both special cases of it.

**Nothing here is stepped.** The equations of motion are assembled into
matrices once and the state is advanced by the exact solution of the linear
ODE:

```text
z' = A z        z(t + h) = e^(A h) z(t)
```

So the curve on the screen is not an approximation of the analytic response,
it is the analytic response, sampled. The timestep decides how finely the
answer is reported and never how wrong it is. A step of a fortieth of a
second gives the same trajectory as a step of a millionth.

Three things follow, and all three are checked:

- The harmonic drive is inside the state. A sine input is not a staircase of
  held values, it is a harmonic oscillator obeying `u'' = -omega^2 u`, so it
  is integrated exactly too, however coarse the step.
- The energy ledger is exact. Kinetic plus potential energy is a quadratic
  form in the state, so work and dissipation over a step are exact integrals
  under a linear flow, computed with one more matrix exponential.
  `U - U0 - W + Q` is zero to floating-point noise, not to the order of the
  timestep.
- The transfer function is not fitted. The denominator is `det(M s^2 + C s +
  K)` evaluated exactly, and the numerator is the same determinant with the
  output's column replaced by the input's, which is Cramer's rule. The
  measured amplitude ratio in a steady-state run agrees with `|H(j omega)|`
  as a check, not as a coincidence.

The panel gives you modes and poles, the transfer function written out as
`s^2 + 0.05s + 10` over a numerator, steady gain at zero frequency, the
measured response against the theoretical curve on one plot, and CSV export
for both.

What is not here, said out loud: friction, backlash, and anything nonlinear. A
Coulomb damper would make none of the above exact, and the point of this
bench is that the numbers can be taken as true. Sliding friction and impacts
belong to the Dynamics bench next door.

### Fluids, at `/fluids`

A tank of liquid with a free surface, solved as a cloud of particles in three
dimensions: a density constraint against each particle's neighbours in a
uniform grid, viscosity as a neighbour-mean drag, and a marching-cubes surface
over the particle density.

The method is **Position Based Fluids** (Macklin & Mueller, 2013). Gravity
predicts where every particle goes; a density constraint is then solved
Gauss-Seidel, four iterations a step, until the rest density is back; the
velocity is read back off the corrected position. That last detail is what
makes the scheme stable at 1/60 s: a stiff pressure force would need a far
smaller step, while a constraint that moves positions cannot inject energy on
its own. Neighbour search is a counting-sorted uniform grid, and the pairs it
finds are collected once per step into a flat list that the density,
gradient, correction and viscosity passes all walk.

**What the eye is reading.** Not a mesh: the particles are splatted into a
56-cubed density volume and each pixel walks its view ray to the
isosurface, so the skin is one continuous surface and the depth the ray
crossed through it is exact enough to shade absorption - a thin lip is
bright, a deep body is dark. Particles near the glass are mirrored through
it, which completes the half of their kernel the wall would have removed and
lets a full tank meet the glass flat instead of pulling away from it. The
silhouette is four sub-pixel rays and a coverage fade, because a raymarcher
discards its misses and cannot be antialiased by the framebuffer. A surface
cut by glass is shaded as a pane, not as a mirror, with a vertical falloff
so the cut reads as depth. The tint can be the liquid itself, or the speed
field, or the hydrostatic head, on the same geometry.

**The 2D switch.** It is a cross-section, not a second experiment: the same
particles, splatted into a plane in proportion to how close their depth is to
the tank's mid-plane, so the section is smooth instead of showing the gap
between two layers. The plane's own surface level is measured the way the 3D
one is, so both views put the water at the same height, and the three
palettes, the speed and pressure tints and the absorption with depth are the
3D bench's own - a thin lip is bright, a deep body dark. Dragging pans, the
wheel zooms, and Run, Step, the labs and every rail control drive the one
clock both views are drawn from.

**What is actually computed.** The PBF step (predict, density, lambda,
correction, velocity), XSPH viscosity with a mixing fraction set by the
material's viscosity, a wall clamp that takes the normal component of
velocity and leaves the tangential one, and a buoyant sphere coupled through
its own displacement and a collision. Water, oil and honey differ in
viscosity, in density and in their optical constants; the rail's viscosity
slider is the same coefficient the solver integrates.

**The body.** A sphere of your density, released above the water: buoyancy
`rho g V_submerged`, quadratic drag, and a collision that pushes the liquid
aside. It settles with the fraction of itself under water that its density
asks for, to within the meniscus it carries.

**The labs.** Dam break, drop impact, a sheet thinning as it falls, a
capillary ripple, a tank driven at its first sloshing mode, and buoyancy
against a density you choose.

**What is not here, said out loud.** The surface is a 56-cell volume, so a
feature thinner than about two cells - the tip of a jet, a sheet tearing - is
a rounded ribbon rather than a film, and the smallest droplets are blobs. The
pressure solve is four Gauss-Seidel iterations, so a deep pool settles a few
per cent shallower than the particle count implies; the volume itself is
exact, because particles are neither created nor destroyed. Surface tension
is not a separate force: the density constraint's own cohesion is what
rounds a free surface, and the We/Oh/Bond numbers on the rail describe the
material rather than being imposed on the solve. The drive on the sloshing
lab is a body force, which is what a shaken tank is in its own frame - not a
moving wall.

**The numbers that are measurements, not claims.** Reynolds, Weber, Ohnesorge
and Bond from the current peak speed and the tank's depth; the liquid volume
and its drift; the mean density error the constraint left; the iteration
count; the kinetic energy; the submerged fraction; the capillary length; how
many separate bodies of liquid the middle column crosses, which is what
turns 1 into 3 while a sheet breaks.

### The labs on every bench

Each bench ships a set of labs. A lab is not a worksheet: it is a box to fill,
a bench to set up, and two questions to answer. `aim` states the law in one
line, `asks` gives you the two things to try, and `state` is literally the
same options the simulation's constructor takes, so every lab is a setup a
student could have built by hand with the panels.

---

## The two fluid solvers

There are two, and they are for different questions.

**`simulation/fluid3d.js`** is the one the Fluids bench draws: a three
dimensional Position Based Fluids solve on a particle cloud, with a
uniform-grid neighbour search, a density constraint, XSPH viscosity, and a
marching-cubes surface. It is the only solver here that is three-dimensional,
and the only one whose volume is exactly conserved - particles cannot be
created or destroyed - which is why its volume readout is honest to the
digit.

**`simulation/liquid_solver.js`** is the level-set free-surface solver. It is
still here, and still tested: the interface is the zero set of a signed
distance field, advected semi-Lagrangian and reinitialised every few
sub-steps; surface tension is the divergence of the interface normal, scaled
by the curvature and spread onto the band; viscosity is solved implicitly,
one component at a time, by conjugate gradient on the faces that have liquid
on both sides. Pressure is solved on the liquid cells alone, with air at
zero and a ghost value at the floor that carries the weight the wall is
holding up.

That last detail is worth its own sentence. Mirroring pressure at a wall - the
usual zero-flux condition - hides the hydrostatic gradient, and a pool then
has no pressure at all: it free-falls until it compacts. The ghost condition
`dp/dn = rho g . n` is what lets a still pool sit still, and the check suite
asserts it: hydrostatic pressure at the floor to 3%, and a peak speed of
0.0002 m/s two seconds after the pool was poured.

**`simulation/fluid_solver.js`** is the older one: Jos Stam's stable fluids
(semi-Lagrangian advection, vorticity confinement, pressure projection) with
a pluggable pressure solve. It is what `npm run bench` and `npm run sweep`
measure, and it is the cleaner subject for a solver comparison because its
geometry is a box and nothing else.

The pressure solve there is pluggable. `solvers/` holds two independent,
from-scratch implementations of the same pressure Poisson equation, both
sharing one Laplacian operator so a comparison between them is measuring the
solvers rather than the discretisation:

- **Jacobi**: average the four neighbours, subtract the local divergence,
  using only values from the previous sweep. Slow to converge, but every
  iteration is cheap and trivially parallel, which is exactly why it is the
  default in real-time GPU fluid solvers.
- **Conjugate Gradient**: each search direction is L-orthogonal to every
  previous one, so it reaches a given residual in far fewer iterations.
  Matrix-free; it only ever applies the shared Laplacian.

`npm run bench` runs both on the same problem and prints real wall-clock
statistics plus each one's residual and iteration count. `npm run sweep`
sweeps resolution by solver by timestep and writes JSON to
`storage/experiment_results/`, including the divergence residual at each
point, so you can see exactly how far from converged the parameters are.

---

## How it is built

### The stack, and what is deliberately not in it

Vite 5 for dev and build, `three` for 3D, `lucide` for icons. Two runtime
dependencies. No framework, no component library, no state manager, no CSS
framework.

The rule that keeps it honest is a dependency boundary:

- `simulation/`, `geometry/`, `solvers/`, `profiling/` import nothing. They
  run identically in the browser and under Node, which is what lets the
  check suites test the exact modules the browser loads rather than a
  re-implementation.
- `rendering/` is the only folder that imports `three`.
- `storage/io.js` never touches Node's `fs`, so it is safe inside the
  bundle. `storage/io.node.js` does, and is never imported by the frontend.
  Keeping them in separate files avoids the problem instead of working
  around it with bundler configuration.

### One HTML file, three shells

`frontend/index.html` holds all three benches: `#app`, `#thermo` and `#mech`.
The route decides which one is shown. A tiny classic script in `<head>` adds
a class before the body is parsed, so a refresh on `/thermo` never paints the
homepage for even one frame, and `frontend/home.js` keeps that class in step
for in-page navigation from then on.

Each shell gets `class="booting"` until its physics has resolved, so you
never see half a scene.

### The folder map

```text
physics-workbench-web/
├── frontend/                 the browser app; the only place that touches the DOM
│   ├── index.html            all four shells: #app, #thermo, #mech, #fluids
│   ├── home.js               the homepage and the route
│   ├── main.js               Dynamics: owns the loop and the wiring
│   ├── thermo_main.js        Thermo: the same furniture, a box of gas
│   ├── mech_main.js          Vibrations: the same furniture, a chain of masses
│   ├── fluids_main.js        Fluids: the same furniture, a tank of liquid
│   ├── ui.js                 the shared panel furniture
│   ├── thermo_ui.js          the Thermo panels
│   ├── mech_ui.js            the Vibrations panels
│   ├── fluids_ui.js          the Fluids panels
│   ├── labs.js               Dynamics labs, data only
│   ├── thermo_labs.js        Thermo labs, data only
│   ├── mech_labs.js          Vibrations labs, data only
│   ├── fluids_labs.js        Fluids labs, and the nozzle that feeds one of them
│   ├── *_instruments.js      the instruments each bench can place
│   ├── drawer.js             the two rails as drawers, on a phone
│   ├── tube.js               the hero's glass channel, painted once
│   ├── channel.js            the marbles falling in it, no DOM
│   └── style.css             the one stylesheet
│
├── simulation/               environment-agnostic physics
│   ├── particle_system.js    typed-array rigid bodies
│   ├── collision_system.js   impulses, spatial hash, SDF contacts
│   ├── shape_dynamics.js     solids with mass, contact points, torque
│   ├── gas.js                the whole of the Thermo physics
│   ├── mech_system.js        the whole of the Vibrations physics
│   ├── liquid_solver.js      level-set liquid, surface tension, coupled body
│   ├── fluid_solver.js       stable fluids, pluggable pressure solve
│   └── simulation_state.js   the fluid grid
│
├── rendering/                the only folder that imports three
│   ├── renderer.js           Dynamics stage, InstancedMesh, picking
│   ├── gas_renderer.js       Thermo stage
│   ├── thermo_apparatus.js   the instruments that stand on the Thermo stage
│   ├── mech_renderer.js      Vibrations stage
│   ├── fluid3d_renderer.js   Fluids stage: glass tank, marching cubes, materials
│   ├── fluid2d_renderer.js   Fluids stage: the mid-depth cross-section
│   ├── liquid_renderer.js    the previous slab renderer, kept with its solver
│   ├── objects.js            shapes as mesh, kept in step with the SDF scene
│   ├── instruments.js        trails, vectors, predictions, grid
│   ├── camera.js             a hand-rolled orbit camera
│   └── visualization.js      colormaps as pure functions
│
├── geometry/                 sdf.js, mesh.js, reconstruction.js (marching squares)
├── solvers/                  solver_interface.js, jacobi.js, conjugate_gradient.js
├── profiling/                timers.js, memory.js, gpu_metrics.js
├── experiments/              the four check suites, benchmarks, sweep, checkpoints
├── storage/                  io.js (browser), io.node.js (Node), results
└── vite.config.js            root: frontend, outDir: ../dist
```

### The frame

One place per bench owns the loop. Each frame: pay back any pending settle,
run the physics, render, update the cheap readouts. Nothing else drives
time.

Two decisions there are worth knowing about, because they are the difference
between a page that boots and a page that does not:

- **The boot settle does not block the first paint.** The gas needs a few
  hundred steps before its measurement windows hold anything worth
  printing. Doing those in one go used to hold the first paint for 763 ms.
  Instead the settle pays back at most 6 ms per frame in 8-step chunks, so
  the scene is on screen and settling at the same time. Fresh-tab first
  contentful paint on the production build measured 503 ms, against 1204 ms
  before.
- **Warm-up is short because it was measured to be short.** Eight
  independent measurement windows were compared against one: the means came
  out 3.8% apart, with each arm's standard error around 1%, which is inside
  the noise of the readout itself. So the warm-up runs two windows rather
  than eight, 253 steps instead of 1015, and the panel shows an em dash
  rather than a fabricated zero until a window has real data in it.

Readouts are throttled to ten per second. The expensive part of an update
(count and histogram the molecules, redraw two charts) does not need to run
at frame rate, and was costing about 19 ms per second of wall clock at 1800
molecules.

### Working on a phone

A workbench is three things side by side: what you set up, what you watch,
and what it says. Three columns is right on a desk and wrong on a phone,
where the only thing worth the whole screen is the stage.

So below 640 px the two rails step out of the column and become drawers over
the stage. What is left of them on the stage is a tab at each edge, the
handle of a drawer, which is what a tab on the edge of a picture has always
meant. A tab opens its own drawer, the other tab swaps to the other one, the
stage behind it closes it, and Escape closes it. Above the breakpoint the
tabs are not rendered at all. It lives in one small file,
`frontend/drawer.js`, because drawer state belongs in exactly one place.

The title bar becomes two rows, the notices stack at the bottom of the stage
where a thumb is, and the stage keeps the whole column at tablet widths so
the canvas is never buried under controls.

### Deploying

It is a static site. `npm run build` writes everything to `dist/`, so any
static host will serve it. Vercel, Netlify and GitHub Pages all work with no
code changes. One thing to get right is deep links: the routes are real
paths, so the host needs to serve `index.html` for `/thermo` and `/mech`
instead of a 404.

---

## The rule the whole project runs on

Every bench shows a measured number and the closed form it should agree with,
side by side, and the labs ask you to compare them. That is the entire
design, and it has consequences that run through the codebase:

- **Count, do not assume.** Pressure is momentum handed to walls, not `n k
  T` printed on a label. If the two ever disagree, the simulation is wrong,
  not the formula.
- **Conserve what physics conserves.** Momentum and energy in collisions,
  the first law on every step, `U - U0 - W + Q` in the ledger. The ledgers
  are shown live precisely so they cannot quietly drift.
- **State the compromises.** Fixed-step collision resolution, spherical
  molecules, a rarefied gas, the picosecond slice of time. Each
  approximation is printed in the panel rather than buried here.
- **Never invent a measurement.** `profiling/gpu_metrics.js` reports draw
  calls, triangles and resident resources, because those are real numbers
  three.js exposes. No browser exposes GPU utilisation to JavaScript, so
  this project does not display one. When it is handed a renderer that does
  not exist, it says so instead of inventing a figure.
- **Keep the sample rate honest.** When a measurement window has not filled
  yet, the panel prints an em dash. A `0.000 MPa` from a gas that has not
  been measured is a lie with a decimal point in it.

---

## Tests: 361 checks that the physics still teaches

Four suites, all of which import the real modules the browser loads:

```bash
node experiments/dynamics_checks.js    # 69 checks
npm run check:thermo                   # 108 checks, about ten minutes
npm run check:mech                     # 158 checks, fast
npm run check:fluids                   # 26 checks, a couple of minutes
npm run check                          # all four in order
```

They exist because every lab asserts a law and asks a student to confirm it
against a number this code measured. That makes the accuracy of the
workbench the one thing that cannot be taken on trust. An integrator that
lags half a step, a contact that hands back more energy than it absorbed, a
wall that resamples the wrong distribution, a ledger that books the same
energy twice, or a timestamp that lands on the nearest step instead of on
the surface would each turn a confirmation into a contradiction, and none
of them would look wrong on screen.

So the checks run the same modules in the same order of operations the
browser uses, and compare what they measure against the closed form:

- **Dynamics**: momentum and energy through collisions, restitution
  behaviour, shapes not sinking or being launched, shapes staying on the
  bench they were drawn on, and each lab's own law.
- **Thermo**: the ledger staying at zero, the flux-weighted wall, the ideal
  gas law appearing from nothing but collisions, effusion rates, and the
  mean free path, with the tolerance each claim deserves.
- **Vibrations**: the exact claims to a part in `1e12` or better, because
  the model is linear and integrated exactly, then the numerical claims at
  the tolerance the reporting actually deserves.
- **Fluids**: hydrostatics to 3%, volume conservation over a dam break, the
  projection's leftover divergence against the flow's own strain rate,
  Archimedes at three densities, the first sloshing mode against `omega^2 =
  g k tanh(kH)`, and the implicit viscous solve against `2 nu k^2` - the
  last one called on its own, so the check measures the diffusion operator
  and not the advection scheme's numerical diffusion sitting on top of it.

A check prints `ok`, the number it measured, the number it expected, the
percentage between them, and the tolerance in words. When one fails it says
what the claim was, so the output is readable as physics rather than as a
stack trace.

---

## How to learn from this repository

There are five ways in, depending on what you are trying to learn.

### If you are learning physics

Pick a bench, open a lab, and do what it asks. The labs are ordered roughly
by how much they assume. Then break the claim on purpose: double the mass
and watch the frequency, open the pinhole and watch the pressure fall,
throw one ball at a wall and change the restitution to zero and watch the
total energy bleed off as the collisions become inelastic. The design
assumption is that the number will tell you the truth, so the fastest way
to understand a law here is to try to make the panel lie and fail.

### If you are learning to write a physics engine

Read in this order, because each file assumes the previous one:

1. `simulation/particle_system.js`. Typed arrays, semi-implicit Euler,
   mass as radius cubed. Small and readable, and the whole shape of the
   problem.
2. `simulation/collision_system.js`. The impulse formula `j = -(1+e) *
   v_rel . n / (1/m1 + 1/m2)`, positional correction so bodies do not sink
   into each other, and a spatial hash for broad phase.
3. `simulation/shape_dynamics.js`. Contact points, and how an off-centre
   hit becomes torque. This is where collision response stops being
   spheres.
4. `simulation/gas.js`. The same impulse idea at scale, plus the
   measurement layer: windows, ledgers, and the discipline of counting
   instead of assuming.
5. `simulation/mech_system.js`. The opposite approach. No stepping at all:
   assemble matrices, exponentiate, integrate exactly. Reading it after the
   others is the point, because it shows what the other approach buys and
   what it costs.

### If you are learning real-time graphics

`rendering/renderer.js` shows one `InstancedMesh` draw call for any number
of particles, pulling straight out of typed arrays with no per-particle
allocation. `rendering/camera.js` is a small hand-rolled orbit controller,
so the project has exactly one way to move a camera, defined in exactly one
place. `rendering/mech_renderer.js` is the interesting one: a system drawn
the way a system-dynamics textbook draws it, because that is the figure the
reader is comparing against. `rendering/thermo_apparatus.js` is worth
reading for the opposite reason: most of its objects are pure furniture,
and it is careful to say which ones are physical.

### If you are learning numerical methods

`simulation/mech_system.js` for the exact route (matrix exponential, exact
quadratic-form integrals under a linear flow, a determinant evaluated by
interpolation for the transfer function). `solvers/` for the iterative
route, two independent methods on one shared operator so the comparison is
fair. `geometry/reconstruction.js` for marching squares from scratch. And
`experiments/benchmarks.js` plus `experiments/parameter_sweep.js` for how
to time something honestly and write the results somewhere you can plot
them.

### If you are learning to read and write good comments

The comments in this repository are unusually deliberate and they explain
*why* rather than *what*. `simulation/gas.js` has a section on the
flux-weighted Maxwellian that explains the specific quiet failure of
drawing a plain half-Maxwellian, including the wrong pressure it produces,
because that is the kind of knowledge that otherwise gets lost. `frontend/style.css` explains each
layout decision in terms of the collision it was fixing and the
measurement that found it. `profiling/gpu_metrics.js` documents a number
it deliberately refuses to report.

### If you are working on this code

Two affordances exist for that. Every bench exposes a handle in the
console (`window.__workbench` for Dynamics and Thermo, `window.__mechWorkbench` for
Vibrations) with the module objects and the functions that drive them, so
you can script an experiment instead of clicking through it. And every
module's header comment is a genuine description of what that file owns
and what it deliberately leaves alone.

---

## Extending it

- **A new pressure solver.** Subclass `PressureSolver` in
  `solvers/solver_interface.js`, implement `solve(...)`, reuse the shared
  `applyLaplacian`, and add it to the registry in
  `experiments/parameter_sweep.js`. It is immediately comparable to the
  other two.
- **A new obstacle shape.** Subclass `SDF` in `geometry/sdf.js` and
  implement `distance(x, y, z)`.
- **A new lab.** Add an entry to `labs.js`, `thermo_labs.js` or
  `mech_labs.js`. `state` is the simulation's own options, so the lab is a
  setup rather than a special case, and `aim` and `asks` are the only
  things you have to write well.
- **A new instrument.** Add it to the bench's `_instruments.js` and to
  `rendering/instruments.js`. Instruments are world-space geometry the
  simulation writes into every frame and never touch the physics, so
  switching one on cannot change an experiment.
- **The fluid, on screen.** `simulation/fluid_solver.js`, `geometry/` and
  `rendering/visualization.js` are complete and tested, and not yet
  rendered. A second viewport drawing dye, velocity and pressure as a
  texture is the natural next step.

---

## Layout, in one place

- `simulation/` is the physics. Imports nothing.
- `rendering/` is the picture. The only folder that imports `three`.
- `frontend/` is the app. The only folder that touches the DOM.
- `geometry/`, `solvers/`, `profiling/` are shared tools.
- `experiments/` is everything runnable from a terminal: the three check
  suites, the benchmarks, the sweep, and the snapshot format.
- `storage/` is persistence, split browser and Node so neither has to
  pretend.

A module in `simulation/` can be read, tested and run under Node with no
browser in sight, and a module in `rendering/` cannot. That line is drawn
once and it does not move.
