/**
 * The frame-time recorder's screen wake lock: keeps a phone's screen on
 * while a sweep runs untouched for minutes. A browser drops the lock
 * whenever the page is hidden, and a battery saver may drop it while the
 * page stays on screen, so it is asked for again when the page comes back
 * and at once when it is released while visible; every refusal and loss
 * is recorded for the export. Takes the API and the document as
 * arguments, so it runs under `node --test`.
 *
 * @see globe-perf-wake.js.md
 */

/** At most this many refusals are kept (a page that keeps returning). */
const REFUSALS_KEPT = 10;

/**
 * `wakeLock` is `navigator.wakeLock` (undefined where unsupported), `doc`
 * the document (its `visibilityState` and `visibilitychange`), `onChange`
 * called with `true` or `false` whenever the lock is gained or lost (the
 * status line), `startTimeoutMs` how long `start` waits for the first
 * request. Returns `{ start(), stop(), report() }`: `start` asks for the
 * screen lock and resolves to whether it is held (false after the
 * timeout; a later grant still holds it); `stop` releases it and stops
 * asking; `report` is `{ supported, held, everHeld, requests, refused,
 * lost, reacquired, heldThroughout, startTimedOut }` (`refused` as "Name:
 * message" texts, `lost` the releases not asked for, `heldThroughout` held
 * from the start with no loss). Never throws: a refusal is recorded. At
 * most one request is in flight.
 */
export function createWakeKeeper({
  wakeLock,
  doc,
  onChange = () => {},
  startTimeoutMs = 3_000,
}) {
  const supported = typeof wakeLock?.request === "function";
  let active = false;
  let sentinel = null;
  /** The request in flight, or null. */
  let pending = null;
  let everHeld = false;
  let requests = 0;
  let lost = 0;
  let reacquired = 0;
  let firstHeld = false;
  let startTimedOut = false;
  const refused = [];

  const ask = async () => {
    requests += 1;
    try {
      const s = await wakeLock.request("screen");
      if (!active) {
        await s.release();
        return false;
      }
      sentinel = s;
      if (everHeld) reacquired += 1;
      everHeld = true;
      s.addEventListener("release", () => {
        if (sentinel !== s) return;
        sentinel = null;
        if (!active) return;
        lost += 1;
        onChange(false);
        // A release while the page stays on screen (a battery saver):
        // no visibilitychange follows, so ask again now.
        if (doc.visibilityState === "visible") void request();
      });
      onChange(true);
      return true;
    } catch (error) {
      if (refused.length < REFUSALS_KEPT) {
        refused.push(`${error?.name ?? "Error"}: ${error?.message ?? error}`);
      }
      return false;
    }
  };
  const request = () => {
    if (!supported || !active || sentinel) {
      return Promise.resolve(sentinel !== null);
    }
    pending ??= ask().finally(() => {
      pending = null;
    });
    return pending;
  };
  const onVisibility = () => {
    if (doc.visibilityState === "visible") void request();
  };

  return {
    async start() {
      if (active) return sentinel !== null;
      active = true;
      doc.addEventListener("visibilitychange", onVisibility);
      let timer = null;
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => {
          startTimedOut = true;
          resolve(false);
        }, startTimeoutMs);
      });
      firstHeld = await Promise.race([request(), timeout]);
      clearTimeout(timer);
      return firstHeld;
    },
    async stop() {
      active = false;
      doc.removeEventListener("visibilitychange", onVisibility);
      const s = sentinel;
      sentinel = null;
      try {
        await s?.release();
      } catch {
        // Already released by the browser: nothing to give back.
      }
    },
    report: () => ({
      supported,
      held: sentinel !== null,
      everHeld,
      requests,
      refused: [...refused],
      lost,
      reacquired,
      heldThroughout: firstHeld && lost === 0,
      startTimedOut,
    }),
  };
}
