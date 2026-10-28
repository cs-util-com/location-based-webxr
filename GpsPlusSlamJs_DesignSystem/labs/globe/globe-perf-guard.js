/**
 * The frame-time recorder's guards (`globe-perf.js`): a lost graphics
 * context noticed whenever it happens, and a watchdog for frames that stop
 * while the page is on screen. Takes the canvas, the context and the clock
 * as arguments, so it runs under `node --test`.
 *
 * @see globe-perf-guard.js.md
 */

/**
 * Watches `canvas` for `webglcontextlost` and `webglcontextrestored`, run
 * or no run. `gl` is the renderer's context (`isContextLost()`), `now` the
 * clock (ms). Returns `{ setLabel(label), isLost(), report() }`:
 * `setLabel` names where the sweep is (a loss is recorded with it);
 * `isLost` is true from the first loss on, by the event or by the context
 * itself (a loss whose event was missed), and stays true after a restore
 * (what was measured since the loss is not comparable); `report` is
 * `{ lost: { atMs, at, by: "event" | "check" } | null, restored: { atMs }
 * | null }`. Only the first loss and the first restore after it are kept.
 */
export function createContextWatch({ canvas, gl, now }) {
  let label = null;
  let lost = null;
  let restored = null;
  const record = (by) => {
    lost ??= { atMs: now(), at: label, by };
  };
  canvas.addEventListener("webglcontextlost", () => record("event"));
  canvas.addEventListener("webglcontextrestored", () => {
    if (lost !== null) restored ??= { atMs: now() };
  });
  return {
    setLabel(next) {
      label = next;
    },
    isLost() {
      if (lost === null && gl.isContextLost()) record("check");
      return lost !== null;
    },
    report: () => ({
      lost: lost && { ...lost },
      restored: restored && { ...restored },
    }),
  };
}

/**
 * A frame watchdog: `frame(now)` at every frame, `expired(now, visible)`
 * on a timer. Expired when no frame came for more than `timeoutMs` while
 * the page was visible; a hidden page gets no frames by design, so the
 * time hidden never counts (the wait starts afresh when it is visible
 * again). RangeError for a timeout that is not finite and > 0.
 */
export function createFrameWatchdog({ timeoutMs }) {
  if (!(Number.isFinite(timeoutMs) && timeoutMs > 0)) {
    throw new RangeError(
      `the watchdog's timeout must be finite and > 0, got ${timeoutMs}`,
    );
  }
  let last = null;
  return {
    frame(now) {
      last = now;
    },
    expired(now, visible) {
      if (!visible || last === null) {
        last = now;
        return false;
      }
      return now - last > timeoutMs;
    },
  };
}
