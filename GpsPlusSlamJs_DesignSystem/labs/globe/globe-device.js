/**
 * Who and what ran, for the globe lab's exports (the frame-hitch recorder,
 * globe zoom plan 2026-10-03-2017 §4.1 DEC-PERF-1, and the Debug panel,
 * round-6 plan 2026-10-04-1050 G6-0): the browser, the GPU, the screen,
 * the build (a preview's host names its branch or commit) and the page's
 * flags. Strings, numbers and booleans only. One implementation for both
 * (DEC-H3).
 *
 * @see globe-device.js.md
 */

/**
 * @param {{ renderer: { getContext(): WebGL2RenderingContext },
 *   params: Record<string, unknown>, relief: boolean,
 *   extra?: Record<string, unknown> }} parts
 */
export function deviceBlock({ renderer, params, relief, extra = {} }) {
  const gl = renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const flags = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === null || ["number", "string", "boolean"].includes(typeof v)) {
      flags[`flag.${k}`] = v;
    }
  }
  return {
    userAgent: navigator.userAgent,
    gpuVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null,
    gpuRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null,
    devicePixelRatio: window.devicePixelRatio,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    drawingBuffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}`,
    relief: relief ? 1 : 0,
    // A preview's host names its branch or commit: the build.
    host: location.host,
    path: location.pathname,
    hash: location.hash.slice(1, 400),
    parallelShaderCompile:
      gl.getExtension("KHR_parallel_shader_compile") !== null,
    floatLinear: gl.getExtension("OES_texture_float_linear") !== null,
    // Whether the GPU's pass times could be read; nothing here reads them.
    timerQuery: gl.getExtension("EXT_disjoint_timer_query_webgl2") !== null,
    deviceMemory: navigator.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    ...extra,
    ...flags,
  };
}
