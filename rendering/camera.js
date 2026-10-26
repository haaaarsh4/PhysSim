/**
 * rendering/camera.js - a hand-rolled orbit camera controller.
 *
 * Wraps a three.js PerspectiveCamera with drag-to-orbit and
 * scroll-to-zoom, attached to a DOM element. No dependency on
 * three.js's own OrbitControls example/addon - this is a small,
 * self-contained implementation so the project has exactly one way to
 * move the camera, defined in exactly one place.
 *
 * Deliberately does nothing else: it never spawns particles, never
 * injects forces. Dragging in the viewport only ever moves the camera.
 */
export class OrbitCameraController {
  constructor(camera, domElement, opts = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.target = opts.target ?? { x: 0, y: 0, z: 0 };
    this.azimuth = opts.azimuth ?? 0.8;
    this.elevation = opts.elevation ?? 0.42;
    this.distance = opts.distance ?? 4.6;
    /* Called once per real camera move (a drag, or a wheel that lands), never
       on a plain click: the caller uses it to tell "the user has taken hold of
       the view" apart from "the user is inspecting a ball". */
    this.onInteract = opts.onInteract ?? null;
    /* A drag that starts on something in the scene is for moving that thing,
       not for orbiting: this is the veto that lets the caller say "not this
       gesture". Returns false and the camera sits the whole gesture out. */
    this.canDrag = opts.canDrag ?? null;
    this.minDistance = opts.minDistance ?? 1.6;
    this.maxDistance = opts.maxDistance ?? 10;
    /* How far the camera may tilt. A scene with a floor under it has a view from
       below that is a view of the underside of its own floor, and a scene that is
       a line of parts - a rig - has a view from directly overhead that is a row
       of blocks with nothing between them. Both ends are the caller's business,
       so both are options; the wide defaults are a scene with no floor to speak
       of, which is what this controller had before it had them. */
    this.minElevation = opts.minElevation ?? -1.3;
    this.maxElevation = opts.maxElevation ?? 1.4;
    /* How far the camera may swing round the side. A scene that is a slab - one
       plane of a tank, drawn with thickness - has a view from the side that is
       the edge of the slab and nothing else, so the swing is the caller's
       business too, and unbounded by default. */
    this.minAzimuth = opts.minAzimuth ?? -Math.PI;
    this.maxAzimuth = opts.maxAzimuth ?? Math.PI;

    this._dragging = false;
    this._lastX = 0; this._lastY = 0;
    this._downX = 0; this._downY = 0;

    this._onPointerDown = (e) => {
      if (this.canDrag && !this.canDrag(e)) return;
      this._dragging = true;
      this._lastX = this._downX = e.clientX;
      this._lastY = this._downY = e.clientY;
    };
    this._onPointerUp = () => { this._dragging = false; };
    this._onPointerMove = (e) => {
      if (!this._dragging) return;
      const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      this.azimuth = Math.max(this.minAzimuth, Math.min(this.maxAzimuth, this.azimuth - dx * 0.006));
      this.elevation = Math.max(this.minElevation, Math.min(this.maxElevation, this.elevation + dy * 0.006));
      this.update();
      if (this.onInteract) this.onInteract();
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance + e.deltaY * 0.0025));
      this.update();
      if (this.onInteract) this.onInteract();
    };

    this.dom.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointermove", this._onPointerMove);
    this.dom.addEventListener("wheel", this._onWheel, { passive: false });

    this.update();
  }

  /** True if the last pointer interaction was a click (not a drag):
   * lets the caller distinguish "orbit the camera" from "pick an object". */
  wasClick(e, thresholdPx = 4) {
    return Math.hypot(e.clientX - this._downX, e.clientY - this._downY) <= thresholdPx;
  }

  update() {
    const { azimuth: a, elevation: e, distance: d, target: t } = this;
    this.camera.position.set(
      t.x + d * Math.cos(e) * Math.sin(a),
      t.y + d * Math.sin(e),
      t.z + d * Math.cos(e) * Math.cos(a)
    );
    this.camera.lookAt(t.x, t.y, t.z);
  }

  /**
   * In or out by a factor: below one is closer, above one is further away, and
   * the wheel's own limits are the ones that hold. The one handle a zoom button
   * needs, and the pair to the 2D controller's - so a page with a zoom control
   * does not have to know which of the two cameras it is driving.
   */
  zoom(factor) {
    this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance * factor));
    this.update();
    if (this.onInteract) this.onInteract();
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointermove", this._onPointerMove);
    this.dom.removeEventListener("wheel", this._onWheel);
  }
}

/**
 * PanZoomController2D - the "2D view" counterpart to OrbitCameraController.
 *
 * Drives a three.js OrthographicCamera fixed to a straight-on front view
 * (looking down -Z, no rotation at all - that's what makes it read as
 * 2D). Dragging pans the frustum center in world units; scrolling
 * changes the frustum half-height (zoom). No orbit, by design: a "2D
 * view" that could still rotate wouldn't be 2D.
 */
export class PanZoomController2D {
  constructor(camera, domElement, opts = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.target = opts.target ?? { x: 0, y: 0 };
    this.zoomHeight = opts.zoomHeight ?? 2.6; // world units of vertical frustum
    this.minZoom = opts.minZoom ?? 0.6;
    this.maxZoom = opts.maxZoom ?? 8;
    /* Same contract as OrbitCameraController's: a pan or a zoom counts as the
       user taking hold of the view. Panning is the only way to move this
       camera, so without it a 2D pane would never report an interaction. */
    this.onInteract = opts.onInteract ?? null;
    /* Same veto as the orbit controller: a drag that begins on a ball or a
       shape moves that thing instead of sliding the world under it. */
    this.canDrag = opts.canDrag ?? null;

    this._dragging = false;
    this._lastX = 0; this._lastY = 0;
    this._downX = 0; this._downY = 0;

    this._onPointerDown = (e) => {
      if (this.canDrag && !this.canDrag(e)) return;
      this._dragging = true;
      this._lastX = this._downX = e.clientX;
      this._lastY = this._downY = e.clientY;
    };
    this._onPointerUp = () => { this._dragging = false; };
    this._onPointerMove = (e) => {
      if (!this._dragging) return;
      const rect = this.dom.getBoundingClientRect();
      const worldPerPixel = this.zoomHeight / rect.height;
      const dx = e.clientX - this._lastX, dy = e.clientY - this._lastY;
      this._lastX = e.clientX; this._lastY = e.clientY;
      this.target.x -= dx * worldPerPixel;
      this.target.y += dy * worldPerPixel;
      this.update();
      if (this.onInteract) this.onInteract();
    };
    this._onWheel = (e) => {
      e.preventDefault();
      this.zoomHeight = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomHeight + e.deltaY * 0.0025));
      this.update();
      if (this.onInteract) this.onInteract();
    };

    this.dom.addEventListener("pointerdown", this._onPointerDown);
    window.addEventListener("pointerup", this._onPointerUp);
    window.addEventListener("pointermove", this._onPointerMove);
    this.dom.addEventListener("wheel", this._onWheel, { passive: false });

    this.update();
  }

  wasClick(e, thresholdPx = 4) {
    return Math.hypot(e.clientX - this._downX, e.clientY - this._downY) <= thresholdPx;
  }

  /** Recomputes the orthographic frustum from the current aspect ratio +
   * zoomHeight, and repositions the camera at the (fixed) front view. */
  resize(width, height) {
    const aspect = width / Math.max(height, 1);
    const halfH = this.zoomHeight / 2;
    const halfW = halfH * aspect;
    this.camera.left = -halfW; this.camera.right = halfW;
    this.camera.top = halfH; this.camera.bottom = -halfH;
    this.camera.updateProjectionMatrix();
  }

  update() {
    this.camera.position.set(this.target.x, this.target.y, 5);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.target.x, this.target.y, 0);
    const rect = this.dom.getBoundingClientRect();
    this.resize(rect.width, rect.height);
  }

  /** In or out by a factor, within the wheel's own limits. See
   *  OrbitCameraController.zoom: the same call, on the other camera. */
  zoom(factor) {
    this.zoomHeight = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomHeight * factor));
    this.update();
    if (this.onInteract) this.onInteract();
  }

  dispose() {
    this.dom.removeEventListener("pointerdown", this._onPointerDown);
    window.removeEventListener("pointerup", this._onPointerUp);
    window.removeEventListener("pointermove", this._onPointerMove);
    this.dom.removeEventListener("wheel", this._onWheel);
  }
}
