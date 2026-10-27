/**
 * The frame-time recorder's screen wake lock: keeps a phone's screen on
 * while a sweep runs untouched for minutes. A browser drops the lock
 * whenever the page is hidden, so it is asked for again when the page
 * comes back; every refusal and loss is recorded for the export. Takes
 * the API and the document as arguments, so it runs under `node --test`.
 *
 * @see globe-perf-wake.js.md
 */

/** At most this many refusals are kept (a page that keeps returning). */
const REFUSALS_KEPT = 10;

/**
 * `wakeLock` is `navigator.wakeLock` (undefined where unsupported), `doc`
 * the document (its `visibilityState` and `visibilitychange`). Returns
 * `{ start(), stop(), report() }`: `start` asks for the screen lock and
 * resolves to whether it is held; `stop` releases it and stops asking;
 * `report` is `{ supported, held, everHeld, requests, refused, lost,
 * reacquired, heldThroughout }` (`refused` as "Name: message" texts,
 * `lost` the releases not asked for, `heldThroughout` held from the start
 * with no loss). Never throws: a refusal is recorded.
 */
export function createWakeKeeper({ wakeLock, doc }) {
  const supported = typeof wakeLock?.request === "function";
  let active = false;
  let sentinel = null;
  let everHeld = false;
  let requests = 0;
  let lost = 0;
  let reacquired = 0;
  let firstHeld = false;
  const refused = [];

  const request = async () => {
    if (!supported || !active || sentinel) return sentinel !== null;
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
        if (active) lost += 1;
      });
      return true;
    } catch (error) {
      if (refused.length < REFUSALS_KEPT) {
        refused.push(`${error?.name ?? "Error"}: ${error?.message ?? error}`);
      }
      return false;
    }
  };
  const onVisibility = () => {
    if (doc.visibilityState === "visible") void request();
  };

  return {
    async start() {
      if (active) return sentinel !== null;
      active = true;
      doc.addEventListener("visibilitychange", onVisibility);
      firstHeld = await request();
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
    }),
  };
}
