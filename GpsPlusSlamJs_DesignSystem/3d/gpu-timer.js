/**
 * GPU frame time for the look-dev page's cost readout (plan 2026-09-23-0048,
 * DEC-SKY-9): `EXT_disjoint_timer_query_webgl2` around each frame, results
 * collected a few frames later (a query is never ready in the frame that
 * issued it). Where the extension is missing (most phones, SwiftShader) the
 * readout says so instead of inventing a number.
 *
 * Page-side support only; nothing here ships in the framework.
 *
 * @see gpu-timer.js.md
 */

/** Queries in flight at most; older ones are dropped rather than stalled on. */
const MAX_PENDING = 4;

export function createGpuTimer(gl) {
  const ext = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const pending = [];
  let active = null;
  let lastMs = null;
  return {
    /** True when the device can time the GPU at all. */
    supported: ext !== null,
    begin() {
      if (!ext || active || pending.length >= MAX_PENDING) return;
      active = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end() {
      if (!ext || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    /** Collect finished queries; returns the latest GPU ms, or null. */
    poll() {
      if (!ext) return null;
      // A disjoint event (clock change, power state) invalidates every
      // query in flight: drop them rather than report garbage.
      if (gl.getParameter(ext.GPU_DISJOINT_EXT)) {
        for (const q of pending) gl.deleteQuery(q);
        pending.length = 0;
        return lastMs;
      }
      while (pending.length > 0) {
        const q = pending[0];
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        lastMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
        gl.deleteQuery(q);
        pending.shift();
      }
      return lastMs;
    },
  };
}
