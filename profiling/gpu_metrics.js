/**
 * profiling/gpu_metrics.js - real WebGL metrics, honestly scoped.
 *
 * Browsers don't expose GPU utilization percentages to JavaScript - no
 * page can honestly show "GPU: 87%", so this module doesn't fabricate
 * one. What three.js's WebGLRenderer *does* expose via `.info` is real
 * and useful: draw calls, triangle count, and resident geometry/texture
 * counts for the current frame. `GPUMetrics.fromRenderer` reads exactly
 * that, live, from an actual THREE.WebGLRenderer instance - this is
 * genuine data, not a mock.
 *
 * Used with no renderer (e.g. from a Node script in experiments/, where
 * there is no WebGL context at all), it reports that plainly instead of
 * inventing numbers.
 */

export class GPUMetrics {
  get available() { return false; }
  report() { return "no WebGL renderer attached - no GPU metrics available"; }
}

export class WebGLRendererMetrics extends GPUMetrics {
  constructor(threeRenderer) {
    super();
    this.renderer = threeRenderer;
  }
  get available() { return true; }
  snapshot() {
    const info = this.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
    };
  }
  report() {
    const s = this.snapshot();
    return `draw calls: ${s.drawCalls}  triangles: ${s.triangles}  ` +
           `geometries: ${s.geometries}  textures: ${s.textures}`;
  }
}
