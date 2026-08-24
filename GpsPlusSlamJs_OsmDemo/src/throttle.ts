/**
 * Sampling a continuous stream of events down to one call per interval.
 *
 * WHY IT EXISTS (DEC-R13-7). `MapControls` fires `change` while the camera
 * moves, and the camera target goes into the URL — so without this the demo
 * would call `history.replaceState` on every frame of a pan. The session asked
 * for exactly this and named both candidate shapes: "das müsste man so ein
 * bisschen **abwarten, beziehungsweise sampeln**, dass da sich nicht alle paar
 * Millisekunden die URL ändern muss".
 *
 * **SAMPLING, NOT WAITING — AND THE DIFFERENCE IS NOT ACADEMIC.** The first
 * implementation was a debounce, and it never fired once in a real browser.
 * `enableDamping` keeps easing the camera after the pointer is released, and
 * this view renders ON DEMAND: each `change` requests a frame, the frame calls
 * `controls.update()`, damping moves the camera a little and fires `change`
 * again. Measured in Playwright, that self-sustaining loop produced an event
 * roughly every 200 ms for as long as the damping took to converge — so a 400 ms
 * quiet period never arrived and the URL was never written. A debounce assumes
 * bursts end; this stream trails off instead.
 *
 * So: **at most one call per interval while events keep coming, and always one
 * final call after the last one.** The URL tracks a pan as it happens and is
 * correct once it stops.
 *
 * **TRAILING ONLY, NEVER LEADING.** The value worth keeping is where the camera
 * has got to, not where it was when the drag started — a leading edge would
 * write the URL of the view the user is leaving.
 *
 * **`latest-only.ts` IS A DIFFERENT TOOL, and both exist for a reason.** That
 * one runs every call and discards stale RESULTS, which is what an async
 * pipeline needs; this one never runs the intermediate calls at all, which is
 * what a side effect needs. Throttling a fetch would drop work the user asked
 * for; latest-only-ing a URL write would still write on every frame.
 *
 * @see throttle.ts.md
 */

/** A throttled function, with a way to stop a pending call. */
export interface Throttled<A extends readonly unknown[]> {
  (...args: A): void;
  /**
   * Drops any pending call.
   *
   * **NOTHING CALLS THIS TODAY, and the honest reason is that there is nowhere
   * to call it from** (noted in review on #276): the demo's only throttled
   * writer lives for the lifetime of the page, and `BuildingView.dispose()` has
   * no hook for a page-level callback. It exists because a timer outlives the
   * thing that scheduled it — the same reason every listener in
   * `building-view.ts` is held rather than anonymous — so a future caller with a
   * real teardown has the handle it needs rather than discovering it is missing.
   *
   * It is tested, so it is a working affordance rather than a claim.
   */
  cancel(): void;
}

/**
 * `run`, called at most once every `everyMs`, with the latest arguments.
 *
 * The first call schedules; further calls inside the window replace the pending
 * arguments **without pushing the deadline back**, which is precisely what
 * distinguishes this from a debounce and what makes it fire against a stream
 * that never goes quiet.
 *
 * Only the LATEST arguments survive; earlier ones are dropped rather than
 * queued, because this exists for "where are you now" rather than for
 * "everything you did".
 *
 * A non-finite or negative `everyMs` is clamped to 0 rather than rejected — the
 * failure mode of a bad interval here is a URL that never updates, which is
 * silent, and running immediately is the more useful wrong answer.
 */
export function throttle<A extends readonly unknown[]>(
  run: (...args: A) => void,
  everyMs: number,
): Throttled<A> {
  const interval = Number.isFinite(everyMs) ? Math.max(0, everyMs) : 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: A | undefined;

  const throttled = (...args: A): void => {
    pending = args;
    // ALREADY SCHEDULED MEANS ALREADY SCHEDULED. Resetting the timer here is
    // exactly the debounce this replaced, and exactly what a stream that never
    // stops defeats.
    if (timer !== undefined) return;
    timer = setTimeout(() => {
      timer = undefined;
      const latest = pending;
      pending = undefined;
      if (latest !== undefined) run(...latest);
    }, interval);
  };
  throttled.cancel = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };
  return throttled;
}
