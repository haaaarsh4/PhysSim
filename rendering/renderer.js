/**
 * rendering/renderer.js - three.js scene wiring for the particle system.
 *
 * Owns the WebGLRenderer, the scene, the floor, and an InstancedMesh for the
 * particles themselves (one draw call for however many balls are active, up to
 * maxParticles). Pulls positions, radii, and colors straight from a
 * simulation.ParticleSystem's typed arrays every frame - no per-particle
 * object allocation.
 *
 * It also answers "what is under the pointer" and "how far has the pointer
 * moved" for both cameras, which is what lets one selection-and-drag
 * implementation in frontend/main.js serve the 3D and 2D views alike.
 *
 * The static shapes (walls, ramps and so on) are not drawn here - see
 * rendering/objects.js.
 */
import * as THREE from "three";
import { speedRamp } from "./visualization.js";

export class ParticleRenderer {
  /**
   * @param {{halfX:number, halfZ:number, thickness:number, y:number}} [opts.floor]
   *   the ground slab: its size, and the height of its top surface. Defaults to
   *   the play area, but it is normally handed in, because the caller also uses
   *   those numbers to build the floor's collision - and the floor you can see
   *   has to be the floor the balls can feel.
   */
  constructor(canvas, maxParticles, bounds, opts = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    /* Contact shadows, because a ball floating on a pale stage with no ground
       contact reads as a sticker on the screen. One extra depth pass for every
       ball and shape at once (they are instanced), and it is what makes the
       scene look like objects in a room rather than shapes on a diagram. */
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Every colour below is one of the homepage's five (see the :root block
    // at the top of frontend/style.css), so the canvas reads as the stage of
    // the same page rather than as a viewport bolted into it: the clear
    // colour IS --stage, and the fog a single step off it so distance simply
    // sinks into the surface instead of into a haze.
    this.renderer.setClearColor(0xe7e6ee, 1); // --stage

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0xdedde7, 0.07); // --stage-2

    // Two cameras, one active at a time: a perspective camera for the
    // orbiting "3D" view, and a fixed-orientation orthographic camera
    // for the "2D" view (see rendering/camera.js's PanZoomController2D).
    // Switching modes swaps which one `render()`/`ray()` use - the
    // scene and every particle instance are identical either way.
    this.perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.05, 100);
    this.camera = this.perspectiveCamera;
    this.viewMode = "3d";

    // Roughly 2.5x total irradiance on the lit side, which is about where a
    // surface resolves to its own albedo: the floor settles just under
    // --stage and a ball holds its hue instead of washing to white or
    // crushing to black. Any brighter and the violet would clip toward
    // magenta, a hue this palette does not contain. The ambient carries the
    // scene and the key shapes the balls, at about 3:1 between a ball's lit
    // and shadowed sides - which is what keeps a sphere reading as a sphere
    // on a stage this pale, instead of as a flat disc.
    this.scene.add(new THREE.AmbientLight(0xe8e7ef, 0.85)); // --on-shell hue
    const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 2);
    const rim = new THREE.DirectionalLight(0xc9c8d4, 0.4); rim.position.set(-3, 2, -3);
    /* Only the key casts, and its shadow camera is fitted tight around the
       play area: a shadow map only has the resolution you give it, and every
       unit of slack in the frustum is softness taken away from the contact
       edge, which is the only part of a shadow that carries information. */
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    const span = 2.6;
    Object.assign(key.shadow.camera, {
      left: -span, right: span, top: span, bottom: -span, near: 0.5, far: 24,
    });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0018; // a hair of depth bias: kills the acne on the floor
    key.shadow.radius = 2.4;
    this.scene.add(key, rim);

    // The ground, and nothing else: no walls, no wireframe box. A scene is
    // open, and whatever containment it has is a shape the user put there.
    // The slab has a thickness rather than being a plane so that it is still
    // there to see in the fixed 2D front view, where a plane seen edge on
    // would be a single invisible line.
    this.floor = opts.floor ?? {
      halfX: bounds.x, halfZ: bounds.z, thickness: 0.08, y: -bounds.y,
    };
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(this.floor.halfX * 2, this.floor.thickness, this.floor.halfZ * 2),
      new THREE.MeshStandardMaterial({ color: 0xdedde7, roughness: 0.95 }) // --stage-2
    );
    floor.position.y = this.floor.y - this.floor.thickness / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    this.maxParticles = maxParticles;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.08, vertexColors: true });
    this.instancedMesh = new THREE.InstancedMesh(geo, mat, maxParticles);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(maxParticles * 3), 3);
    this.instancedMesh.castShadow = true;
    this.instancedMesh.receiveShadow = true;
    /* Never culled, with an explicit bounding sphere instead of a computed one.
       Both are load-bearing. three.js fills in an InstancedMesh's bounding
       sphere the first time anything asks for it - here, the first frame, when
       the scene is still empty - and never recomputes it, and `raycast` uses
       it as a broad phase. A stale empty sphere therefore does not merely cost
       a little culling precision: it makes every ray except those passing
       within a ball's width of the world origin report no hit at all, so
       picking works in the middle of the stage and nowhere else. A sphere we
       set ourselves cannot go stale, and since this mesh is the entire scene,
       culling it would never have saved a draw call anyway. */
    this.instancedMesh.frustumCulled = false;
    this.instancedMesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 5);
    this.scene.add(this.instancedMesh);

    // One ring per selected ball, not one mesh each: a selection can be any
    // size, and this way it costs one draw call whatever it is. depthTest is
    // off so the ring is never swallowed by the ball it belongs to, and never
    // hidden by a wall the ball is behind - a selection you cannot see is
    // worse than one that ignores depth.
    this.selectionGeometry = new THREE.TorusGeometry(1, 0.075, 8, 32);
    this.selectionMaterial = new THREE.MeshBasicMaterial({
      color: 0x9e00ff, depthTest: false, transparent: true, opacity: 0.95,
    });
    this.selectionRings = new THREE.InstancedMesh(this.selectionGeometry, this.selectionMaterial, maxParticles);
    this.selectionRings.count = 0;
    this.selectionRings.frustumCulled = false;
    this.selectionRings.renderOrder = 5;
    this.scene.add(this.selectionRings);

    this._dummy = new THREE.Object3D();
    this._dragPlane = null;
    this._dragLast = null;
  }

  resize(width, height) {
    this.renderer.setSize(width, height, false);
    this.perspectiveCamera.aspect = width / Math.max(height, 1);
    this.perspectiveCamera.updateProjectionMatrix();
    // The ortho camera's frustum is driven by PanZoomController2D
    // (it needs zoomHeight, which lives on the controller, not here):
    // main.js calls that controller's own resize() right after this one.
  }

  /** @param {'3d'|'2d'} mode */
  setViewMode(mode) {
    this.viewMode = mode;
    this.camera = mode === "2d" ? this.orthoCamera : this.perspectiveCamera;
  }

  /* ------------------------------- picking ------------------------------- */

  /** A raycaster aimed from the canvas through a client-space point. Shared by
   *  picking and dragging so both agree on what "under the pointer" means. */
  ray(clientX, clientY) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    return raycaster;
  }

  /**
   * Where a world point lands on the canvas, in client pixels.
   *
   * The reverse of `ray`, and needed by anything that has to be drawn where a
   * world point *is* rather than where it started: the resize grips on a
   * selected shape are the first of those. Scaling and offsetting with the
   * element's own rect is what makes the answer client pixels - the same
   * coordinates the pointer arrives in, so no caller has to know that the
   * canvas is inset inside a stage inside a page.
   *
   * @param {number} x world metres
   * @param {number} y
   * @param {number} z
   * @param {{x:number,y:number,behind:boolean}} [out] reused, to keep the frame
   *   loop free of an allocation per grip per view
   */
  project(x, y, z, out = { x: 0, y: 0, behind: false }) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const v = this._projectScratch ?? (this._projectScratch = new THREE.Vector3());
    v.set(x, y, z).project(this.camera);
    out.x = rect.left + (v.x * 0.5 + 0.5) * rect.width;
    out.y = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
    /* Behind the eye, where the projection is not a place on the screen at all
       - the point comes back mirrored and squashed through the origin, and a
       grip drawn from it would be nonsense. */
    out.behind = v.z > 1;
    return out;
  }

  /**
   * Where a ray through a client point meets a plane: any plane, given one point
   * on it and its normal.
   *
   * This is the plane a dragged thing is dragged *along*. A shape here is a
   * section drawn in x and y and extruded through the depth, so the plane a
   * corner of it lives on - and therefore the plane a corner has to be pulled
   * along - is the shape's own section plane, which is the world's x/y plane
   * until the shape is turned out of it. A plane facing the camera is the one
   * answer that is always wrong: the same drag would mean a different amount of
   * the same shape at every orbit angle.
   *
   * @param {{x:number,y:number,z:number}} origin a point on the plane, in metres
   * @param {{x:number,y:number,z:number}} normal the plane's normal; need not be
   *   unit length
   * @returns {{x:number,y:number,z:number}|null} null when the ray runs along the
   *   plane, which is the one angle where the plane is edge-on and nothing on it
   *   can be aimed at anyway
   */
  pointOnPlane(clientX, clientY, origin, normal) {
    const ray = this.ray(clientX, clientY).ray;
    const denom = ray.direction.x * normal.x + ray.direction.y * normal.y + ray.direction.z * normal.z;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((origin.x - ray.origin.x) * normal.x
      + (origin.y - ray.origin.y) * normal.y
      + (origin.z - ray.origin.z) * normal.z) / denom;
    if (!(t > 0)) return null;
    const out = this._planeScratch ?? (this._planeScratch = { x: 0, y: 0, z: 0 });
    out.x = ray.origin.x + ray.direction.x * t;
    out.y = ray.origin.y + ray.direction.y * t;
    out.z = ray.origin.z + ray.direction.z * t;
    return out;
  }

  /** The ball under the pointer: which one, the world point that was hit, and
   *  how far away that is. null if the pointer is over empty space.
   *  @param {THREE.Raycaster} [readyRay] reuse a ray the caller already cast. */
  pickBall(clientX, clientY, readyRay) {
    const raycaster = readyRay ?? this.ray(clientX, clientY);
    const hits = raycaster.intersectObject(this.instancedMesh);
    if (!hits.length) return null;
    const hit = hits[0];
    return { index: hit.instanceId, point: hit.point.clone(), distance: hit.distance };
  }

  /* ------------------------------- dragging ------------------------------- */

  /** Begin a screen-space drag through `origin`: the point the grabbed thing
   *  is drawn at. */
  beginDrag(origin) {
    const normal = new THREE.Vector3();
    this.camera.getWorldDirection(normal);
    this._dragPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, origin);
    this._dragLast = origin.clone();
    return this;
  }

  /** How far the pointer has moved since the last call, in the plane the drag
   *  started on. The plane faces the camera and passes through the grabbed
   *  point, so the grabbed thing tracks the cursor exactly - and because this
   *  only ever uses the ray and the camera, it works the same under the
   *  perspective camera and the orthographic one. */
  dragDelta(clientX, clientY) {
    const zero = { x: 0, y: 0, z: 0 };
    if (!this._dragPlane) return zero;
    const point = new THREE.Vector3();
    if (!this.ray(clientX, clientY).ray.intersectPlane(this._dragPlane, point)) return zero;
    const delta = {
      x: point.x - this._dragLast.x,
      y: point.y - this._dragLast.y,
      z: point.z - this._dragLast.z,
    };
    this._dragLast.copy(point);
    return delta;
  }

  endDrag() {
    this._dragPlane = null;
    this._dragLast = null;
  }

  /**
   * Draw a ring around each selected ball. The rings face the camera, so a
   * selection reads as a selection from every angle and in both views.
   * @param {number[]|Iterable<number>} indices which balls are selected
   */
  updateSelection(ps, indices) {
    const dummy = this._dummy;
    const facing = this.camera.quaternion;
    let n = 0;
    for (const i of indices) {
      if (i < 0 || i >= ps.count || !ps.active[i]) continue;
      dummy.position.set(ps.posX[i], ps.posY[i], ps.posZ[i]);
      dummy.quaternion.copy(facing);
      dummy.scale.setScalar(ps.radius[i] * 1.85);
      dummy.updateMatrix();
      this.selectionRings.setMatrixAt(n++, dummy.matrix);
    }
    this.selectionRings.count = n;
    this.selectionRings.instanceMatrix.needsUpdate = true;
  }

  /* ------------------------------- particles ------------------------------- */

  /** @param {import('../simulation/particle_system.js').ParticleSystem} ps
   *  @param {'speed'|'uniform'} colorMode
   *  @param {number} speedNormalization speed that maps to the top of the ramp.
   *    0.7 is measured, not guessed: balls falling under the shipped 9.8 m/s^2
   *    peak around 0.4 and touch 0.63, so the ramp is spent by the time the
   *    scene is at its fastest and the violet is visible in normal use. */
  updateInstances(ps, colorMode = "speed", speedNormalization = 0.7) {
    const dummy = this._dummy;
    for (let i = 0; i < ps.count; i++) {
      if (!ps.active[i]) {
        dummy.position.set(0, -999, 0); dummy.scale.setScalar(0);
      } else {
        dummy.position.set(ps.posX[i], ps.posY[i], ps.posZ[i]);
        dummy.scale.setScalar(ps.radius[i]);
      }
      dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, dummy.matrix);

      let c;
      if (!ps.active[i]) c = [0, 0, 0];
      else if (colorMode === "speed") c = speedRamp(ps.speed(i) / speedNormalization);
      else c = [0.2, 0.13, 0.34]; // the ramp's own low stop: one flat tone, no scale at all
      this.instancedMesh.setColorAt(i, new THREE.Color(c[0], c[1], c[2]));
    }
    for (let i = ps.count; i < this.maxParticles; i++) {
      dummy.position.set(0, -999, 0); dummy.scale.setScalar(0); dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, dummy.matrix);
    }
    this.instancedMesh.count = ps.count > 0 ? ps.count : 0;
    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) this.instancedMesh.instanceColor.needsUpdate = true;
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
