/**
 * A message the user can actually see while immersed.
 *
 * **WHY THE APP'S EXISTING ERROR CHANNEL DOES NOT WORK HERE, twice over** (r509
 * review found both).
 *
 * 1. **It is outside the DOM overlay.** `initAR` passes its container to WebXR
 *    as `domOverlay.root`, and the browser composites **only that subtree** over
 *    the camera feed during an immersive session. The demo's status line lives
 *    in the header, which is not inside `#ar-root` — so a message written there
 *    is invisible for exactly as long as it is relevant.
 * 2. **It is erased before it can be painted.** `nonFatalError` sets
 *    `loading.phase = "error"`, and the far-travel warning is emitted in the
 *    same synchronous block that starts the refetch — whose `fetchStarted`
 *    immediately replaces the phase with `"fetching"`. Both dispatches run
 *    their subscribers synchronously, so the browser never renders the frame in
 *    between. A unit test asserting `warn` was called passes throughout.
 *
 * It would also have rendered as "Failed: You are 2.1 km from…", because the
 * only channel available was the error one.
 *
 * @see ar-toast.ts.md
 */

/** How long a message stays before it fades, ms. */
export const AR_TOAST_LINGER_MS = 8_000;

export interface ArToast {
  /** Show a message. Replaces any current one and restarts the timer. */
  show(message: string): void;
  /** Take any message down now, and stop the timer. Idempotent. */
  clear(): void;
}

/**
 * Create the toast surface inside the AR overlay root.
 *
 * @param root the SAME element passed to `initAR` — anything outside it is not
 *   composited during an immersive session.
 *
 * The element is created once and reused, rather than per message: `#ar-root`
 * is styled `position: fixed; inset: 0` and hidden only while `:empty`, so a
 * toast element living there permanently would keep a full-viewport,
 * click-eating layer over the whole page for the entire time AR is NOT running.
 * That exact regression is recorded in `ar-mode.ts`. It is therefore attached on
 * `show` and removed on `clear`.
 */
export function createArToast(root: HTMLElement): ArToast {
  const element = document.createElement("div");
  element.className = "ar-toast";
  // POLITE, not assertive: a drift warning is information, not an interruption,
  // and `alert` would cut across whatever a screen reader is saying.
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The deferred text write. See `show`. */
  let pending: ReturnType<typeof setTimeout> | undefined;
  /**
   * Which `show` a pending write belongs to.
   *
   * Two `show` calls in the same task would otherwise land in timer order and
   * the FIRST could win, leaving the older message on screen.
   */
  let sequence = 0;

  const clear = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (pending !== undefined) {
      clearTimeout(pending);
      pending = undefined;
    }
    // EMPTIED, not just detached. The next `show` attaches this same element,
    // and one still carrying the previous text would arrive populated — which
    // is the exact defect the deferral below exists to remove.
    element.textContent = "";
    element.remove();
  };

  return {
    show(message: string): void {
      // ATTACHED IN THIS TASK, POPULATED IN THE NEXT — and the second half is
      // the part that took two attempts (r511 review, then r513's).
      //
      // A live region is announced when its content CHANGES while it is in the
      // accessibility tree; one inserted already carrying its text is commonly
      // not announced at all. The first fix reordered the two statements, which
      // reads correctly and does nothing: browsers do not rebuild the
      // accessibility tree per DOM operation, they flush queued updates once at
      // the end of the task. With both mutations in the same task the AT still
      // sees a region that appeared with its text already in it — the reorder
      // was unobservable, and the test asserting it observed a state nothing
      // ever reaches.
      //
      // **The separation has to be a task, not a statement.** `setTimeout`
      // rather than `requestAnimationFrame`, deliberately: rAF is the tighter
      // fit for "after a rendering step", but it is throttled or paused in a
      // background tab, and `main.ts` can warn with no XR session running — so
      // the frame-based version can silently never deliver. A task boundary is
      // enough for the flush and always fires.
      //
      // `append`, not `insertBefore`: `initAR` puts its canvas at the FRONT of
      // this container, and the toast has to paint over it.
      sequence += 1;
      const mine = sequence;
      root.append(element);
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = undefined;
        // Cleared in the gap, or superseded by a later `show`. Writing either
        // way would resurrect a message the caller has already withdrawn.
        if (!element.isConnected || mine !== sequence) return;
        element.textContent = message;
      }, 0);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(clear, AR_TOAST_LINGER_MS);
    },
    clear,
  };
}
