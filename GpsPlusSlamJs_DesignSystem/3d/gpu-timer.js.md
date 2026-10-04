# gpu-timer.js — GPU frame time for the look-dev readout

- Purpose: time each frame on the GPU with
  `EXT_disjoint_timer_query_webgl2`, for the page's cost readout (plan
  2026-09-23-0048, DEC-SKY-9: the base tier must fit a mid-range phone, and
  frame time on the CPU says little about the GPU).
- Public API: `createGpuTimer(gl)` → `{ supported, begin(), end(), poll() }`.
  - `begin()` / `end()` bracket one frame's draw calls; `poll()` collects
    finished queries and returns the latest GPU milliseconds, or `null`.
- Invariants & assumptions:
  - At most 4 queries in flight; a frame is skipped rather than stalling.
  - A disjoint event drops every pending query (their numbers are invalid).
  - Without the extension (most phones, SwiftShader) `supported` is false and
    `poll()` returns `null`; the readout says "GPU n/a", never a guess.
  - Queries die with the WebGL context: the page re-creates the timer on
    `webglcontextrestored` (pending queries would never report and freeze
    the readout).
  - Page-side only; not part of the framework.
- Examples: `timer.begin(); render(); timer.end(); const ms = timer.poll();`
- Tests: the look-dev smoke loads the page with it (no console errors);
  SwiftShader has no timer extension, so the number itself is checked by
  opening `/lookdev/` on a device, not in CI.
