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

  const clear = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    element.remove();
  };

  return {
    show(message: string): void {
      // ATTACHED FIRST, POPULATED SECOND (r511 review). A live region is
      // watched for MUTATIONS while it is in the document, so one inserted
      // already carrying its text is commonly not announced at all — the
      // announcement depends on the text changing after the region exists.
      // Setting `textContent` first is the natural order and the silent one,
      // which for a surface whose whole purpose is reaching a user who cannot
      // see the screen would have made it inert for the second time.
      //
      // `append`, not `insertBefore`: `initAR` puts its canvas at the FRONT of
      // this container, and the toast has to paint over it.
      root.append(element);
      element.textContent = message;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(clear, AR_TOAST_LINGER_MS);
    },
    clear,
  };
}
