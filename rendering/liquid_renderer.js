/**
 * rendering/liquid_renderer.js - the Fluids workbench's stage.
 *
 * A glass tank, a body of liquid in it, and a body floating in the liquid. The
 * liquid is a two-dimensional field (see simulation/liquid_solver.js) and the
 * tank is three-dimensional, so something has to be decided about the third
 * dimension. The decision here is the honest one: the liquid is a *slab*, the
 * cross-section of a tank that is deeper than the picture shows, and it is drawn
 * as one - a stack of thin planes through the same field, each a little more
 * transparent than the last, so the body has depth to look at from any angle
 * without pretending to be a full three-dimensional solve.
 *
 * That stack is also why the surface is not a mesh built from the level set.
 * A marching-squares surface would have to be triangulated every frame, would
 * fall apart the first time two drops merged, and would have one silhouette for
 * every cell it crossed. Sampling the level set into a texture instead means the
 * edge of the liquid is a smooth interpolated field at whatever resolution the
 * screen has, the topology is whatever the physics says it is, and the cost is
 * one texture upload and six draw calls.
 *
 * What is drawn, and why it is drawn that way:
 *
 *   - the liquid, tinted by a vertical gradient from the light at its surface
 *     to the ink at its floor. In "Speed" and "Pressure" the same body is tinted
 *     by the field instead, which is the view a reader wants the moment the
 *     question is "where is it going" rather than "where is it";
 *   - a thin bright line along the zero set, which is the one thing a level set
 *     gives for free and a particle cloud cannot: the meniscus itself;
 *   - the tank as its edges and a pale back panel, the same line-work language
 *     the rest of the site draws apparatus in;
 *   - the body, a cylinder across the tank because the solve is a plane and a
 *     sphere would be a lie about which part of it the fluid is touching.
 */
import * as THREE from "three";
import { OrbitCameraController, PanZoomController2D } from "./camera.js";

/* The palette is the site's, with one addition: a liquid that is darker than
   anything else on the stage, because a body of water has to be the darkest
   thing in a pale room or it reads as a drawing of water. */
const INK = 0x1a4a58;
const DEEP = 0x1f5966;
const SHALLOW = 0x7ec4c8;
/* The tone of the water where it meets the air. One number for the flanks and
   for the crown, so the two are the same surface and not two materials. */
const SURFACE = 0x2f6f7d;
const ACCENT = 0x7c5cff;
const MUTED = 0xa9a4bd;

/**
 * What each liquid looks like. Water is the site's own blue-green; oil is the
 * amber of a refined vegetable oil; honey is the darker, saturated amber of the
 * jar. The three presets already differ in viscosity and surface tension - what
 * they were missing was the colour, so honey ran slowly and looked exactly like
 * water while it did. `sheen` is how much white the crown picked up: a thin
 * fluid has a bright, glassy surface, a thick one a deeper, softer one.
 */
const FLUID_LOOKS = {
  water: { ink: INK, deep: DEEP, shallow: SHALLOW, surface: SURFACE, sheen: 0.07 },
  oil: { ink: 0x4a3008, deep: 0x8a5c0e, shallow: 0xf0c65e, surface: 0xbe8a20, sheen: 0.14 },
  honey: { ink: 0x40230a, deep: 0x7c4508, shallow: 0xe6aa3a, surface: 0xa86412, sheen: 0.18 },
};
const lookOf = (kind) => FLUID_LOOKS[kind] ?? FLUID_LOOKS.water;

/** The tank's depth, world units (metres, at 1:1 with the solver). */
export const TANK_DEPTH = 0.24;

/** How far inside the glass the drawn faces sit. A centimetre of clearance kept
 *  the faces from z-fighting with the tank, and edge-on it was a centimetre of
 *  daylight between the water and its own container - a slot no real liquid
 *  leaves. One and a half millimetres is under a pixel at this scale and still
 *  clear of the back panel. */
const WALL_INSET = 0.0015;

/* Two faces and no interior. The liquid is a cross-section, and a stack of
   translucent planes through it was tried first: with any depth at all the
   silhouette of each plane lands a few pixels from the next, and the body reads
   as a fan of cards rather than as one body of water. A front face that is
   nearly opaque and a back face behind it gives the slab its thickness from
   every angle the camera can reach, and the surface keeps a hard edge.

   Two faces are not a solid, though: turned side-on, the slab became a pair of
   vertical sheets with daylight between them, because the two ends of the block
   had no walls. The crown closes the top, the floor closes the bottom, and
   #updateTop now draws the two ends from the waterline at the first and last
   column, so the block is a closed prism and every face of the liquid is drawn
   from every angle the orbit can reach. */
const SLICES = 2;

export class LiquidRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import("../simulation/liquid_solver.js").LiquidSolver} solver
   */
  constructor(canvas, solver) {
    this.canvas = canvas;
    this.solver = solver;
    this.width = solver.width;
    this.height = solver.height;
    /* The tank's depth is the solver's, not a second opinion: the volume the
       rail reads and the slab the eye sees have to be the same body. */
    this.depth = solver.depth ?? TANK_DEPTH;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    /* The stage is the site's own stage - the same clear colour as the two
       benches either side of this one, so a workbench is a room and not a
       viewport bolted into a page. */
    this.renderer.setClearColor(0xe7e6ee, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xe3e2ea, 0.055);

    this.perspectiveCamera = new THREE.PerspectiveCamera(42, 1, 0.02, 40);
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.02, 40);
    this.camera = this.perspectiveCamera;
    this.viewMode = "3d";

    this.scene.add(new THREE.AmbientLight(0xeceaf3, 1.05));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(2.6, 4.2, 3.2);
    const rim = new THREE.DirectionalLight(0xc9c8d4, 0.55);
    rim.position.set(-3, 1.6, -2.4);
    this.scene.add(key, rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    /* The field's own buffers, before anything that samples them: the liquid's
       texture is built around them, and a DataTexture handed an undefined array
       is a texture three cannot upload. */
    this.fieldMode = "surface";
    this.rimVisible = true;
    this.look = FLUID_LOOKS.water;
    this._textureData = new Uint8Array(solver.nx * solver.ny * 4);
    /* The field the picture is drawn from: phi after one 3x3 binomial pass.
       The solver's own phi is a cell quantity and its zero set steps from cell
       to cell, which on screen is a sawtooth. The physics is not touched; this
       is the same interface seen through a lens that is a little wider than a
       cell. */
    this._phiRender = new Float64Array(solver.nx * solver.ny);
    this._phiScratch = new Float64Array(solver.nx * solver.ny);
    this._node = new Float32Array((solver.nx + 1) * (solver.ny + 1));
    /* The prism's wall: six vertices a segment, two segments a cell at most. */
    /* The water's top: one quad per column of the grid, so it is as smooth as
       the surface it is drawn from and as cheap as a strip. This is the piece
       that makes the body closed when you look down on it, and the piece that
       makes it read as a liquid rather than as a card with a lid. */
    this._topPositions = new Float32Array(solver.nx * 18);
    this._topColors = new Float32Array(solver.nx * 18);
    this._topSkipped = new Uint8Array(solver.nx);

    this.#buildRoom();
    this.#buildLiquid();
    this.#buildMeniscus();
    this.#buildBody();

    /* The two cameras, each with the other's job: the orbit view drags to turn
       the tank, the 2D view pans and zooms without ever rotating, because a
       2D view that could rotate is a 3D view with the wrong name. */
    this.orbit = new OrbitCameraController(this.perspectiveCamera, canvas, {
      target: { x: 0, y: this.height * 0.46, z: 0 },
      azimuth: 0.30,
      elevation: 0.26,
      distance: 2.05,
      minDistance: 1.1,
      maxDistance: 6,
      minElevation: -0.12,
      maxElevation: 0.62,
    });
    /* The plane the body is dragged on, in world units. */
    this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this._raycaster = new THREE.Raycaster();
    this._pointer = new THREE.Vector2();

    this.zoom2d = new PanZoomController2D(this.orthoCamera, canvas, {
      target: { x: 0, y: this.height / 2 },
      zoomHeight: this.height * 1.28,
      minZoom: this.height * 0.42,
      maxZoom: this.height * 2.2,
    });

    this.resize();
    this.sync();
  }

  /* ======================================================================
     the room
     ====================================================================== */

  #buildRoom() {
    const W = this.width, H = this.height, D = this.depth;

    /* The plinth the tank stands on. Its top face is at y = 0 to the millimetre,
       because the tank's floor is at y = 0: a vessel that hovers five
       millimetres over its own stand is the first thing the eye catches on a
       pale stage, and it makes every edge of the tank look unattached. */
    const plinthH = 0.045;
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(W * 1.1, plinthH, D * 1.42),
      new THREE.MeshStandardMaterial({ color: 0xe0dfe9, roughness: 0.94, metalness: 0.0 }),
    );
    plinth.position.set(0, -plinthH / 2, 0);
    plinth.receiveShadow = true;
    this.root.add(plinth);

    /* A soft contact shadow on the plinth's top, under the glass: a radial
       gradient on a plane, not a shadow map. One light and one opaque slab do
       not need a depth pass to say "this is standing on that". */
    const shadowCanvas = document.createElement("canvas");
    shadowCanvas.width = shadowCanvas.height = 128;
    const sctx = shadowCanvas.getContext("2d");
    const grad = sctx.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, "rgba(26, 24, 40, 0.22)");
    grad.addColorStop(0.5, "rgba(26, 24, 40, 0.09)");
    grad.addColorStop(1, "rgba(26, 24, 40, 0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 128, 128);
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    shadowTex.colorSpace = THREE.SRGBColorSpace;
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(W * 1.04, D * 1.3),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.0003;
    this.root.add(shadow);

    /* The tank, as glass: a back panel, two side panels and a floor, each a
       faint tint of the same cool grey. Edges alone left a wireframe box with a
       card of water pasted inside it - the sides of a vessel are what say the
       water is in a vessel, and their tint is what says the tank is a volume and
       not a drawing of one. */
    const glassTint = 0xd9d8e6;
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({ color: glassTint, transparent: true, opacity: 0.62 }),
    );
    back.position.set(0, H / 2, -D / 2 + 0.0008);
    this.root.add(back);

    const sideMat = new THREE.MeshBasicMaterial({
      color: 0xcfcedd, transparent: true, opacity: 0.30, side: THREE.DoubleSide, depthWrite: false,
    });
    const sideGeo = new THREE.PlaneGeometry(D, H);
    for (const sx of [-1, 1]) {
      const side = new THREE.Mesh(sideGeo, sideMat);
      side.rotation.y = Math.PI / 2;
      side.position.set((sx * W) / 2, H / 2, 0);
      this.root.add(side);
    }

    /* The floor of the tank, just under the water: the line the liquid stands
       on. Without it the tank has no bottom and the water has no weight. */
    const tankFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshBasicMaterial({ color: 0xc7c6d6, transparent: true, opacity: 0.45, depthWrite: false }),
    );
    tankFloor.rotation.x = -Math.PI / 2;
    tankFloor.position.y = 0.0011;
    this.root.add(tankFloor);

    /* The rim: the top of the glass, a hairline, and the four verticals of the
       box. Nothing thick - the panels are what the tank is made of now, and the
       line-work is only there to sharpen the silhouette. */
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(W, H, D)),
      new THREE.LineBasicMaterial({ color: 0xa8a6ba, transparent: true, opacity: 0.5 }),
    );
    edges.position.set(0, H / 2, 0);
    this.root.add(edges);

    this.box = new THREE.Box3(
      new THREE.Vector3(-W / 2, 0, -D / 2),
      new THREE.Vector3(W / 2, H, D / 2),
    );
  }

  /* ======================================================================
     the liquid
     ====================================================================== */

  #buildLiquid() {
    const { nx, ny } = this.solver;
    this._texture = new THREE.DataTexture(this._textureData, nx, ny, THREE.RGBAFormat);
    this._texture.minFilter = THREE.LinearFilter;
    this._texture.magFilter = THREE.LinearFilter;
    this._texture.wrapS = THREE.ClampToEdgeWrapping;
    this._texture.wrapT = THREE.ClampToEdgeWrapping;
    this._texture.needsUpdate = true;

    const geo = new THREE.PlaneGeometry(this.width, this.height);
    geo.translate(0, this.height / 2, 0);

    this.slices = [];
    for (let i = 0; i < SLICES; i++) {
      /* Symmetric about the middle, so the stack is a slab and not a sheet with
         six copies behind it. The faces are ordered by a sort key set every
         frame; the middle slice is the densest because it is the one the eye
         reads as "inside". */
      const t = SLICES === 1 ? 0 : i / (SLICES - 1) * 2 - 1;
      const z = t * (this.depth / 2 - WALL_INSET);
      /* Both faces, always. Hiding the far one made the block hollow the moment
         the camera crossed its middle: you were looking into the inside of a
         shell whose near cap had been switched off. A body of water seen from
         any angle shows one face and hides the other because it is solid, not
         because a renderer decided which to draw. */
      const alpha = i === SLICES - 1 ? 0.97 : 0.9;
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uTex: { value: this._texture },
          uAlpha: { value: alpha },
          uMode: { value: 0 },
          uHeight: { value: this.height },
          uRef: { value: this.height * 0.5 },
          uInk: { value: new THREE.Color(INK) },
          uDeep: { value: new THREE.Color(DEEP) },
          uShallow: { value: new THREE.Color(SHALLOW) },
          uSurface: { value: new THREE.Color(SURFACE) },
          uAccent: { value: new THREE.Color(ACCENT) },
          uMuted: { value: new THREE.Color(MUTED) },
        },
        vertexShader: /* glsl */ `
          uniform float uRef;
          varying vec2 vUv;
          varying float vY;
          void main() {
            vUv = uv;
            vec4 world = modelMatrix * vec4(position, 1.0);
            /* depth into the water, not height up the tank: a shallow pool in a
               tall tank must still show its own gradient, and normalising by
               the tank height left every pool the colour of its floor */
            vY = clamp(world.y / max(uRef, 0.02), 0.0, 1.0);
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform sampler2D uTex;
          uniform float uAlpha;
          uniform int uMode;
          uniform float uHeight;
          uniform float uRef;
          uniform vec3 uInk;
          uniform vec3 uDeep;
          uniform vec3 uShallow;
          uniform vec3 uSurface;
          uniform vec3 uAccent;
          uniform vec3 uMuted;
          varying vec2 vUv;
          varying float vY;

          void main() {
            vec4 tex = texture2D(uTex, vUv);
            /* red carries signed distance in cells: four either side of the
               interface, which is all the band the solver keeps. */
            float s = tex.r * 8.0 - 4.0;
            /* Half a cell of feather, not a whole one: the face's alpha used to
               reach a cell past the level set, and at the end of a column that
               overhang read as a soft translucent lip coming out of the
               corner. */
            float cover = smoothstep(0.12, -0.12, s);
            if (cover < 0.004) discard;

            /* One body of water, one colour: ink at the floor, the surface's
               own tone where it meets the air, and the lift concentrated in
               the top third the way light actually dies in water. A linear
               ramp from ink to the surface tone made the block look like two
               materials stacked; a curve that stays dark and then lets go does
               not, and it is also the way a pool is lit. */
            vec3 tone = mix(uInk, uSurface, pow(smoothstep(0.0, 1.0, vY), 1.7));
            if (uMode == 1) {
              tone = mix(uDeep, uAccent, clamp(tex.g, 0.0, 1.0));
            } else if (uMode == 2) {
              float p = clamp(tex.b, 0.0, 1.0);
              tone = mix(uMuted, uAccent, p);
              tone = mix(tone, uShallow, 0.18);
            }
            /* The surface is the brightest part of a body of water: a band one
               cell wide either side of the zero set, lifted towards the light. */
            float rim = smoothstep(0.85, 0.0, abs(s));
            tone = mix(tone, uShallow, rim * 0.10);
            gl_FragColor = vec4(tone, cover * uAlpha);
            /* A raw ShaderMaterial writes its colour in linear light and three
               does not encode it for the display on its own - the built-in
               materials do that with this chunk. Without it every tone here
               lands on screen at its linear value, which is the same colour
               three stops darker: the water was rendering as near-black. */
            #include <colorspace_fragment>
          }
        `,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, material);
      mesh.position.z = z;
      mesh.renderOrder = i;
      this.slices.push(mesh);
      this.root.add(mesh);
    }
  }

  /* ======================================================================
     the meniscus
     ====================================================================== */

  /*
     The crown and the end walls. Both are rebuilt every frame from the level
     set; neither is an outline. A line along the surface reads as a bright
     thread lying inside the water wherever the near face is in front of it,
     which no real liquid has, so the body is drawn only with surfaces.
     */
  #buildMeniscus() {
    /* The water's top surface. A quad per column, from the waterline at one
       column edge to the waterline at the next, spanning the tank's depth. It is
       built from the same blurred field the two faces are drawn from, so its
       edge lies on their edge; a wall of marching-squares quads along the
       contour could not, and corrugated the surface a cell at a time. */
    const topGeo = new THREE.BufferGeometry();
    topGeo.setAttribute("position", new THREE.BufferAttribute(this._topPositions, 3));
    topGeo.setAttribute("color", new THREE.BufferAttribute(this._topColors, 3));
    topGeo.setDrawRange(0, 0);
    this.top = new THREE.Mesh(
      topGeo,
      new THREE.MeshBasicMaterial({
        color: 0xffffff, vertexColors: true, side: THREE.DoubleSide,
        transparent: true, opacity: 0.93, depthWrite: false,
      }),
    );
    this.top.frustumCulled = false;
    this.top.renderOrder = SLICES;
    this.root.add(this.top);

    /* The two ends of the slab, and the last two faces a solid body of water
       owes the eye. A rectangle per end, from the floor up to the waterline on
       that column, spanning the tank's depth - so a camera that orbits round
       to look along the tank's width sees one of them instead of the hollow
       space between the front and back sheets. They are rebuilt every frame
       from the same node heights as the crown, so a wave reaching the glass is
       followed by the glass's own wall of water. */
    /* Sixteen walls: enough for a pool's two ends and the two ends of seven
       thrown-off bodies besides, which is more separate liquid than this tank
       holds at once. */
    this._capPositions = new Float32Array(16 * 6 * 3);
    this._capColors = new Float32Array(16 * 6 * 3);
    const capGeo = new THREE.BufferGeometry();
    capGeo.setAttribute("position", new THREE.BufferAttribute(this._capPositions, 3));
    capGeo.setAttribute("color", new THREE.BufferAttribute(this._capColors, 3));
    capGeo.setDrawRange(0, 0);
    this.caps = new THREE.Mesh(
      capGeo,
      new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide,
        transparent: true, opacity: 0.96, depthWrite: false,
      }),
    );
    this.caps.frustumCulled = false;
    /* Between the back sheet (0) and the front one: the ends are the body's own
       walls, not a pane laid in front of it. */
    this.caps.renderOrder = SLICES - 0.5;
    this.root.add(this.caps);

  }

  /* ======================================================================
     the body in the liquid
     ====================================================================== */

  #buildBody() {
    const group = new THREE.Group();
    const shell = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, this.depth - 0.04, 56, 1, false),
      new THREE.MeshStandardMaterial({
        /* The body sits inside the body of water, so the liquid in front of it
           would hide it completely - the solve is a plane and the slab is
           opaque. It is drawn after the liquid with the depth test off, in the
           pale blue a white object has under water: the convention every
           two-dimensional flow figure uses, and the only one in which a body
           inside a liquid can be seen at all. */
        color: 0xdbe6ea, roughness: 0.34, metalness: 0.06,
        depthTest: false, transparent: true, opacity: 1,
      }),
    );
    shell.rotation.x = Math.PI / 2;
    group.add(shell);
    /* A ring around the front face: a white disc on a dark liquid is a disc, and
       a ring is what makes it a body with a thickness. */
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.05, 10, 56),
      new THREE.MeshStandardMaterial({
        color: 0x7c5cff, roughness: 0.4, metalness: 0.1, depthTest: false,
        transparent: true, opacity: 1,
      }),
    );
    ring.position.z = (this.depth - 0.04) / 2 + 0.002;
    group.add(ring);
    this.bodyRing = ring;
    this.bodyGroup = group;
    this.bodyShell = shell;
    group.visible = false;
    group.renderOrder = SLICES + 2;
    this.root.add(group);
  }

  /* ======================================================================
     the field, as a texture
     ====================================================================== */

  /**
   * Pack the level set, the speed and the pressure into one RGBA texture.
   *
   * Three channels of the same size, sampled by the same planes: the alternative
   * is three textures and three uploads a frame for the same number of pixels.
   * Red is signed distance in cells, which is what the edge is cut from; green
   * and blue are the two fields the view switch offers, each normalised to the
   * tank's own scale so the picture does not depend on how fast anything happens
   * to be moving.
   */
  #updateTexture() {
    const s = this.solver;
    const { nx, ny, dx, phi: raw, pressure } = s;
    const data = this._textureData;
    const phi = this._phiRender;
    /* Two binomial passes. One is enough to take the staircase off a flat
       surface and not enough for a steep one, where a cell's worth of difference
       between neighbours is most of the edge the eye is following. */
    let src = raw;
    for (let pass = 0; pass < 2; pass++) {
      const dst = pass === 1 ? this._phiScratch : phi;
      for (let j = 0; j < ny; j++) {
        const jm = j > 0 ? j - 1 : 0, jp = j < ny - 1 ? j + 1 : j;
        for (let i = 0; i < nx; i++) {
          const im = i > 0 ? i - 1 : 0, ip = i < nx - 1 ? i + 1 : i;
          dst[j * nx + i] = (
            src[jm * nx + im] + 2 * src[jm * nx + i] + src[jm * nx + ip] +
            2 * src[j * nx + im] + 4 * src[j * nx + i] + 2 * src[j * nx + ip] +
            src[jp * nx + im] + 2 * src[jp * nx + i] + src[jp * nx + ip]
          ) / 16;
        }
      }
      src = dst;
    }
    if (src !== phi) phi.set(src);

    /* Speed, in cells per second, scaled by the tank's own gravity wave speed:
       sqrt(g H) for a 1 m tank is 3 m/s, which is a good full-scale reading for
       a splash that is going quickly. */
    const speedScale = 1 / Math.max(0.5, Math.sqrt(Math.max(s.params.gravity, 1) * s.height) * 0.85);
    /* Pressure, as a fraction of the hydrostatic pressure at the floor. */
    const pScale = 1 / Math.max(1e-6, s.params.gravity * s.height);
    /* Speed and pressure are cell quantities; the faces either side are what the
       solver has, so the cell value is their average. */
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        const uc = 0.5 * (s.u[j * (nx + 1) + i] + s.u[j * (nx + 1) + i + 1]);
        const vc = 0.5 * (s.v[j * nx + i] + s.v[(j + 1) * nx + i]);
        const speed = Math.hypot(uc, vc) * speedScale;
        const p = pressure[k] * pScale;
        const q = k * 4;
        data[q] = Math.max(0, Math.min(255, Math.round((phi[k] / dx + 4) / 8 * 255)));
        data[q + 1] = Math.max(0, Math.min(255, Math.round(Math.min(1, speed) * 255)));
        data[q + 2] = Math.max(0, Math.min(255, Math.round(Math.min(1, Math.max(0, p)) * 255)));
        data[q + 3] = 255;
      }
    }
    this._texture.needsUpdate = true;
  }

  /**
   * The top of the water, one quad per column.
   *
   * The waterline is read off the same blurred field the faces are drawn from,
   * so the sheet's front edge lies exactly on the face's edge - which a contour
   * wall cannot promise, and the seam between them was the corrugated lip along
   * every surface. Columns with no liquid under them are skipped, so a drop in
   * the air has a top and a pool does not claim the space above it.
   */
  #updateTop() {
    const s = this.solver;
    const { nx, ny, dx } = s;
    const w = nx + 1;
    const node = this._node;
    /* The level set sampled at the nodes: each node is the average of the up to
       four cells that touch it, which is the same as sampling the field at the
       corner, and it is what both the waterline and the end walls are read
       from. */
    const phi = this._phiRender;
    const band = 2 * dx;
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        let sum = 0, n = 0;
        for (const [di, dj] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || ii >= nx || jj < 0 || jj >= ny) continue;
          sum += phi[jj * nx + ii];
          n++;
        }
        node[j * w + i] = n ? sum / n : band;
      }
    }
    const h = this._topH ?? (this._topH = new Float32Array(w));
    const pos = this._topPositions;
    const col = this._topColors;
    const z = this.depth / 2 - WALL_INSET;
    const zb = -z;
    const ox = -this.width / 2;

    for (let i = 0; i <= nx; i++) {
      let level = NaN;
      for (let j = ny - 1; j >= 0; j--) {
        const a = node[j * w + i], b = node[(j + 1) * w + i];
        /* Liquid at the lower node, air at the upper one: that is the water's
           own surface and not the underside of a drop. */
        if (a < 0 && b >= 0) { level = (j + a / (a - b)) * dx; break; }
      }
      h[i] = level;
    }

    /* The two ends of a run sit on the boundary column, where the level set is
       an average of one cell and can read a whole cell low. Left alone, that
       pulls the crown down into a rounded pillow at the corner of a column -
       a bevel centimetres across, where a real free surface meets a vertical
       face within a capillary length. The end node takes its neighbour's
       waterline, so the crown meets the end wall flat and the corner is the
       corner the geometry is. */
    for (let i = 0; i <= nx; i++) {
      const wet = Number.isFinite(h[i]);
      const prev = i > 0 ? Number.isFinite(h[i - 1]) : false;
      const next = i < nx ? Number.isFinite(h[i + 1]) : false;
      if (!wet || (prev && next)) continue;
      if (!prev && next) h[i] = h[i + 1];
      else if (prev && !next) h[i] = h[i - 1];
    }

    /* Two tones across the crown: the pale sheet the light lands on, and a
       darker one where it falls away. The shade follows the slope, so a wave's
       face is shaded and its crest is bright. */
    /* The crown of a body of water is the brightest part of it, and it is still
       water: a sheet of near-white reads as a lid of ice laid on the liquid.
       These two tones are the body's own teal, a shade apart - the sheet is the
       same liquid seen along its surface, not a second material. */
    /* A vertex colour buffer is read as linear light, so a hex written into it
       as 0..1 comes out two stops too bright once the renderer encodes the
       frame for a display. Three's Color does the conversion; these two are the
       tones the sheet is drawn between. */
    const brightC = new THREE.Color(this.look.surface).lerp(new THREE.Color(0xffffff), this.look.sheen);
    const darkC = new THREE.Color(this.look.surface).multiplyScalar(0.62);
    const bright = [brightC.r, brightC.g, brightC.b];
    const dark = [darkC.r, darkC.g, darkC.b];
    let p = 0;
    for (let i = 0; i < nx; i++) {
      const h0 = h[i], h1 = h[i + 1];
      if (!Number.isFinite(h0) || !Number.isFinite(h1)) continue;
      if (p + 18 > pos.length) break;
      const x0 = i * dx + ox, x1 = (i + 1) * dx + ox;
      const slope = Math.min(3, Math.abs(h1 - h0) / dx);
      const k = 1 / (1 + slope * 0.55);
      const r = dark[0] + (bright[0] - dark[0]) * k;
      const g = dark[1] + (bright[1] - dark[1]) * k;
      const b = dark[2] + (bright[2] - dark[2]) * k;
      /* The near edge of the sheet catches the light and the far edge falls
         away from it. Without that the crown is one flat tone across the tank's
         depth, which is the thing that makes a horizontal plane read as a pane
         laid on the water rather than as its surface. */
      const rf = r, gf = g, bf = b;
      /* A shade, not a step. A quarter darker at the far edge turned the crown
         into a band with a lit lip, and at the end of a column that lip looked
         like a bead of water sitting on the corner. The slab is one sheet of
         water; the slope above is what says where the light falls. */
      const rb = r * 0.94, gb = g * 0.94, bb = b * 0.94;
      const put = (x, y, zz, cc) => {
        pos[p++] = x; pos[p++] = y; pos[p++] = zz;
        col[p - 3] = cc[0]; col[p - 2] = cc[1]; col[p - 1] = cc[2];
      };
      const front = [rf, gf, bf], back = [rb, gb, bb];
      put(x0, h0, z, front); put(x1, h1, z, front); put(x1, h1, zb, back);
      put(x0, h0, z, front); put(x1, h1, zb, back); put(x0, h0, zb, back);
    }
    const attr = this.top.geometry.getAttribute("position");
    attr.needsUpdate = true;
    this.top.geometry.getAttribute("color").needsUpdate = true;
    this.top.geometry.setDrawRange(0, p / 3);
    this.top.geometry.computeBoundingSphere();

    /* Every end of every run of liquid: a wall from the floor to that run's
       waterline. A pool spanning the tank gets its two walls at the glass; a
       dam-break column gets one at the glass and one in mid-air, which is the
       vertical face the column shows when the camera swings round to look
       along the tank's width - the face that used to be missing, leaving two
       vertical sheets with a hole between them. Runs are found per node, so a
       splash that breaks into separate bodies gets a wall on each of them. */
    const capPos = this._capPositions;
    const capCol = this._capColors;
    const floorTone = new THREE.Color(this.look.ink);
    /* The end wall tops out at the same tone as the crown's far edge, not at the
       crown's bright near edge. Matched to the surface's own tone it was the
       brightest thing at the corner, and its thin band above the crown read as
       a rounded lip coming out of the water. */
    const crestTone = new THREE.Color(this.look.surface).multiplyScalar(0.74);
    const tone = new THREE.Color();
    const maxWalls = 16;
    let walls = 0;
    let q = 0;
    const wall = (x, level) => {
      if (!Number.isFinite(level) || level <= 0 || walls >= maxWalls) return;
      if (q + 18 > capPos.length) return;
      walls++;
      for (let k = 0; k < 6; k++) {
        /* Two triangles: floor-front, waterline-front, waterline-back; then
           floor-front, waterline-back, floor-back. */
        const y = k === 1 || k === 2 || k === 4 ? level : 0;
        capPos[q] = x;
        capPos[q + 1] = y;
        capPos[q + 2] = k === 2 || k === 4 || k === 5 ? zb : z;
        /* Same ramp as the front face: ink at the floor, the surface's own
           tone where it meets the air. */
        tone.copy(floorTone).lerp(crestTone, Math.pow(Math.min(1, y / Math.max(level, 1e-6)), 1.7));
        capCol[q] = tone.r;
        capCol[q + 1] = tone.g;
        capCol[q + 2] = tone.b;
        q += 3;
      }
    };
    let runStart = -1;
    for (let i = 0; i <= nx; i++) {
      const wet = i < nx && Number.isFinite(h[i]);
      if (wet && runStart < 0) runStart = i;
      if (runStart >= 0 && !wet) {
        wall(ox + runStart * dx, h[runStart]);
        wall(ox + i * dx, h[i - 1]);
        runStart = -1;
      }
    }
    this.caps.geometry.getAttribute("position").needsUpdate = true;
    this.caps.geometry.getAttribute("color").needsUpdate = true;
    this.caps.geometry.setDrawRange(0, q / 3);
    this.caps.geometry.computeBoundingSphere();
  }

  /* ======================================================================
     the frame
     ====================================================================== */

  /** Put the solver's state on the stage. Call once per drawn frame. */
  sync() {
    this.#updateTexture();
    if (this.rimVisible) {
      this.#updateTop();
    } else {
      this.top.visible = false;
    }
    this.caps.visible = this.rimVisible && this.caps.geometry.drawRange.count > 0;

    const b = this.solver.ball;
    if (b.visible && b.r > 0) {
      this.bodyGroup.visible = true;
      this.bodyGroup.position.set(b.x - this.width / 2, b.y, 0);
      /* Radii scale; the slab does not. The cylinder's axis is z after its
         rotation, so a z scale of one is what keeps it as deep as the tank
         whatever the body's radius is. */
      this.bodyGroup.scale.set(b.r, b.r, 1);
    } else {
      this.bodyGroup.visible = false;
    }

    const mode = this.fieldMode === "speed" ? 1 : this.fieldMode === "pressure" ? 2 : 0;
    /* The tint's depth scale: the tallest column of water on the stage. A pool
       18 cm deep in a 90 cm tank should be shaded over its own 18 cm, not over
       the tank, or the whole pool comes out the colour of its floor. */
    let tallest = 0;
    const { nx, ny, phi } = this.solver;
    for (let i = 0; i < nx; i++) {
      for (let j = ny - 1; j >= 0; j--) {
        if (phi[j * nx + i] < 0) { tallest = Math.max(tallest, (j + 1) * this.solver.dx); break; }
      }
    }
    this._refDepth = Math.max(0.09, tallest * 1.06);
    for (const slice of this.slices) {
      slice.material.uniforms.uMode.value = mode;
      slice.material.uniforms.uRef.value = this._refDepth;
    }

    /* Both caps are drawn; the depth buffer decides which one you see. Nothing
       here switches a face off, so nothing can catch a rotation half-way. */
    for (const slice of this.slices) slice.visible = true;
  }

  setFieldMode(mode) {
    this.fieldMode = mode;
    for (const slice of this.slices) {
      slice.material.uniforms.uMode.value = mode === "speed" ? 1 : mode === "pressure" ? 2 : 0;
    }
  }

  /**
   * Which liquid is on the bench, by the preset's own name.
   *
   * The three presets already set the solver's numbers; this sets the body's
   * colour and its sheen, so the tank you are looking at is the fluid you
   * picked. `custom` keeps water's colour, because a fluid mixed by hand is
   * still water unless it says otherwise.
   */
  setFluid(kind) {
    this.look = lookOf(kind);
    for (const slice of this.slices) {
      const u = slice.material.uniforms;
      u.uInk.value.setHex(this.look.ink);
      u.uDeep.value.setHex(this.look.deep);
      u.uShallow.value.setHex(this.look.shallow);
      u.uSurface.value.setHex(this.look.surface);
    }
    this.sync();
  }

  setViewMode(mode) {
    this.viewMode = mode === "2d" ? "2d" : "3d";
    this.camera = this.viewMode === "2d" ? this.orthoCamera : this.perspectiveCamera;
    this.resize();
  }

  resize({ keepView = false } = {}) {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(w, h, false);
    this.perspectiveCamera.aspect = w / h;
    this.perspectiveCamera.updateProjectionMatrix();
    this.zoom2d.resize(w, h);
  }

  /**
   * Frame the camera around the tank and the slab it stands on.
   *
   * Not an analytic fit: the camera looks down on the scene from an angle, so
   * the object that reaches furthest across the frame is not the object that is
   * widest in world space - the near corner of the slab wins. The corners are
   * projected and the distance corrected until the whole rig sits inside a
   * fixed margin of the frame, which is true at every aspect instead of only at
   * the one the algebra was written for.
   */
  frame() {
    const HW = this.width * 0.57;
    const HH = this.height;
    const HD = this.depth * 0.75;
    const y0 = -0.015;
    const corners = [
      [-HW, y0, -HD], [HW, y0, -HD], [-HW, y0, HD], [HW, y0, HD],
      [-HW, 0, -this.depth / 2], [HW, 0, -this.depth / 2],
      [-HW, 0, this.depth / 2], [HW, 0, this.depth / 2],
      [-this.width / 2, 0, 0], [this.width / 2, 0, 0],
      [-this.width / 2, HH, -this.depth / 2], [this.width / 2, HH, -this.depth / 2],
      [-this.width / 2, HH, this.depth / 2], [this.width / 2, HH, this.depth / 2],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z));

    const vfov = (this.perspectiveCamera.fov * Math.PI) / 180;
    const aspect = Math.max(0.2, this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight));
    const tanV = Math.tan(vfov / 2);
    const margin = 0.88;
    let dist = Math.max(
      (HH * 0.5 + 0.05) / tanV,
      (HW + 0.04) / (tanV * aspect),
    );
    const v = new THREE.Vector3();
    for (let k = 0; k < 6; k++) {
      this.orbit.distance = dist;
      this.orbit.target.y = this.height * 0.46;
      this.orbit.update();
      this.camera.updateMatrixWorld();
      let reach = 0;
      for (const c of corners) {
        v.copy(c).project(this.camera);
        reach = Math.max(reach, Math.abs(v.x), Math.abs(v.y));
      }
      if (Math.abs(reach - margin) < 0.004) break;
      dist *= reach / margin;
    }
    this.orbit.distance = dist;
    this.orbit.update();
    this.zoom2d.zoomHeight = this.height * 1.24;
    this.zoom2d.target.y = this.height * 0.5;
    this.zoom2d.update();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** The body under the pointer, in solver coordinates, or null. */
  pickBody(clientX, clientY) {
    const b = this.solver.ball;
    if (!b.visible || !(b.r > 0)) return null;
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._dragPlane, hit)) return null;
    const x = hit.x + this.width / 2;
    const y = hit.y;
    return Math.hypot(x - b.x, y - b.y) <= b.r * 1.25 ? { x, y } : null;
  }

  /** Where a drag lands, in solver coordinates, clamped to the tank. */
  dropPoint(clientX, clientY, r) {
    const rect = this.canvas.getBoundingClientRect();
    this._pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._pointer, this.camera);
    const hit = new THREE.Vector3();
    if (!this._raycaster.ray.intersectPlane(this._dragPlane, hit)) return null;
    return {
      x: Math.min(this.width - r, Math.max(r, hit.x + this.width / 2)),
      y: Math.min(this.height - r, Math.max(r, hit.y)),
    };
  }

  dispose() {
    this.orbit.dispose();
    this.zoom2d.dispose();
    this.renderer.dispose();
    this._texture.dispose();
  }
}

export const LIQUID_PALETTE = { INK, DEEP, SHALLOW, ACCENT, MUTED };
