/**
 * frontend/axis_gizmo.js - the orientation triad in the corner of a stage.
 *
 * A small, live drawing of the world's three axes as the camera currently sees
 * them. It answers the one question a freely orbitable scene keeps asking -
 * "which way is up, and which way am I facing?" - without taking a click, a
 * frame of the scene, or a world unit of room.
 *
 * The drawing is SVG driven by the active camera's quaternion. Each axis is
 * projected into camera space, so the widget turns with the picture as the
 * pointer drags the camera. Axes pointing away from the viewer sit dimmer and
 * a little smaller; the ones pointing towards them sit on top. That depth is
 * the whole difference between a compass rose and an orientation cube.
 *
 * It is deliberately a separate module rather than part of a renderer: all
 * three benches have a camera and a stage, and none of them should have to know
 * how the other two draw a corner. `getCamera` is read every frame because all
 * three benches swap cameras when 3D turns into 2D.
 */

import * as THREE from "three";

const SVG_NS = "http://www.w3.org/2000/svg";

/* Screen-space geometry, in the widget's own viewBox units. 84 is the size the
   stylesheet gives the widget, and the centre leaves room for the longest axis
   plus its label. */
const CENTER = 42;
const REACH = 28;
const DOT_R = 5.4;

/* The ordinary axis colours: they are a legend, not a theme. The rest of the
   interface keeps the homepage's five-colour palette; a reader who has used any
   three-dimensional tool already knows red X, green Y and blue Z, and a
   monochrome triad would make every scene read the same orientation. */
const AXES = [
  { key: "x", axis: new THREE.Vector3(1, 0, 0), color: "#d9475b", label: "X" },
  { key: "y", axis: new THREE.Vector3(0, 1, 0), color: "#2f9e70", label: "Y" },
  { key: "z", axis: new THREE.Vector3(0, 0, 1), color: "#4a68f2", label: "Z" },
];

function node(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  return el;
}

/**
 * Mount an orientation triad in `container`.
 *
 * @param {HTMLElement} container the stage (`.viewport`) it sits in
 * @param {() => THREE.Camera | null | undefined} getCamera
 * @returns {{element: HTMLElement, update: () => void, dispose: () => void}}
 */
export function mountAxisGizmo(container, getCamera) {
  if (!container) {
    return { element: null, update() {}, dispose() {} };
  }

  const root = document.createElement("div");
  root.className = "axis-gizmo";
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", "Orientation: X right, Y up, Z towards you");
  root.title = "Orientation";

  /* No plate, no dial, no ring: the triad floats on the stage the way a
     three-dimensional tool's triad does, and the picture behind it stays
     visible. A frosted disc here read as a random circle sitting on the scene
     rather than as a compass, which is the one thing this widget must not be. */
  const svg = node("svg", { viewBox: "0 0 84 84", "aria-hidden": "true" });
  const hub = node("circle", { cx: CENTER, cy: CENTER, r: 1.6, fill: "currentColor", "fill-opacity": "0.45" });
  svg.append(hub);

  const parts = AXES.map(({ key, color, label }) => {
    const group = node("g", { "data-axis": key });
    const negative = node("circle", {
      cx: CENTER, cy: CENTER, r: 1.8,
      fill: "none", stroke: color, "stroke-opacity": "0.42", "stroke-width": "1",
    });
    const line = node("line", {
      x1: CENTER, y1: CENTER, x2: CENTER, y2: CENTER,
      stroke: color, "stroke-opacity": "0.65", "stroke-width": "1.4",
      "stroke-linecap": "round",
    });
    const dot = node("circle", {
      cx: CENTER, cy: CENTER, r: DOT_R,
      fill: color, "fill-opacity": "0.95", stroke: "rgba(255,255,255,0.55)", "stroke-width": "0.8",
    });
    const text = node("text", {
      x: CENTER, y: CENTER, fill: "#fff",
      "font-size": "7.4", "font-weight": "800", "font-family": "Inter, sans-serif",
      "text-anchor": "middle", "dominant-baseline": "middle",
      "letter-spacing": "0.2",
    });
    text.textContent = label;
    group.append(negative, line, dot, text);
    svg.append(group);
    return { group, negative, line, dot, text, color };
  });

  root.append(svg);
  container.append(root);

  const inverse = new THREE.Quaternion();
  const v = new THREE.Vector3();
  let frame = 0;
  let last = 0;
  let paintOrder = "";

  function draw() {
    const camera = getCamera && getCamera();
    if (!camera) return;
    const hidden = container.hidden || container.offsetParent === null;
    if (hidden) return;

    inverse.copy(camera.quaternion).invert();

    AXES.forEach(({ axis }, i) => {
      const { group, negative, line, dot, text } = parts[i];
      v.copy(axis).applyQuaternion(inverse);

      /* Camera space: +x right, +y up, +z towards the viewer. A three.js
         camera looks down -z, so a positive component on z is the end coming
         out of the glass at you. Scale by that component to make depth felt,
         not merely stated. */
      const depth = THREE.MathUtils.clamp(v.z, -1, 1);
      const scale = 1 + depth * 0.09;
      const x = CENTER + v.x * REACH * scale;
      const y = CENTER - v.y * REACH * scale;
      const alpha = 0.55 + 0.45 * ((depth + 1) / 2);

      line.setAttribute("x2", x.toFixed(2));
      line.setAttribute("y2", y.toFixed(2));
      line.setAttribute("stroke-opacity", (0.35 + 0.4 * alpha).toFixed(3));

      dot.setAttribute("cx", x.toFixed(2));
      dot.setAttribute("cy", y.toFixed(2));
      dot.setAttribute("r", (DOT_R * (0.82 + 0.18 * alpha)).toFixed(2));
      dot.setAttribute("fill-opacity", (0.55 + 0.4 * alpha).toFixed(3));

      /* The opposite axis, drawn as a small hollow tick where it comes
         through from behind. It is what makes the triad read as three
         dimensions rather than as a star of three lines. */
      negative.setAttribute("cx", (CENTER - v.x * REACH * 0.72).toFixed(2));
      negative.setAttribute("cy", (CENTER + v.y * REACH * 0.72).toFixed(2));
      negative.setAttribute("stroke-opacity", (0.16 + 0.2 * (1 - alpha)).toFixed(3));

      /* The letter rides inside the bead, not beyond it. That keeps every
         label on the plate however the scene is turned - an outside label on
         an axis pointing straight up would hang off the top of the dial - and
         it makes each axis head read as one object rather than a dot and a
         nearby initial. */
      text.setAttribute("x", x.toFixed(2));
      text.setAttribute("y", y.toFixed(2));
      text.setAttribute("fill-opacity", (0.72 + 0.24 * alpha).toFixed(3));

      /* Closer axes are painted later. Sorting three tiny groups is cheaper
         than reasoning about which overlap matters today. */
      group.dataset.depth = depth.toFixed(3);
    });

    /* Paint far to near, but only when the order actually changed: re-appending
       three nodes every frame would be churn for a picture that usually holds
       still. */
    const ordered = parts
      .slice()
      .sort((a, b) => Number(a.group.dataset.depth) - Number(b.group.dataset.depth));
    const signature = ordered.map((part) => part.group.dataset.axis).join("");
    if (signature !== paintOrder) {
      paintOrder = signature;
      ordered.forEach(({ group }) => svg.append(group));
    }
  }

  function loop(now) {
    frame = requestAnimationFrame(loop);
    /* Thirty hertz is plenty for a widget this small, and it keeps a hidden
       bench from doing any work at all. */
    if (now - last < 32) return;
    last = now;
    draw();
  }

  draw();
  frame = requestAnimationFrame(loop);

  return {
    element: root,
    update: draw,
    dispose() {
      cancelAnimationFrame(frame);
      root.remove();
    },
  };
}
