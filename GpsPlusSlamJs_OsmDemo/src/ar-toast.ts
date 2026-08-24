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

import {
  createToast,
  type Toast,
} from "gps-plus-slam-app-framework/utils/toast-core";

/** How long a message stays before it fades, ms. */
export const AR_TOAST_LINGER_MS = 8_000;

/**
 * The AR toast is the shared {@link Toast}, in the AR overlay root.
 *
 * IT WAS GENERALISED RATHER THAN COPIED when the 2D toast arrived in round two
 * (N3). The mechanism here — attach empty, write the text one task later,
 * handle supersession by cancelling rather than by guarding — cost three review
 * rounds to get right, and none of it is visible in the finished code. A second
 * hand-written copy in `main.ts` would have reproduced the bugs rather than the
 * fixes. The framework's `utils/toast-core.ts` carries the reasoning; this file
 * keeps the argument for why AR needs a channel of its own at all, which is a
 * different question and still true.
 *
 * The linger stays LONGER than the 2D default: a message in AR competes with
 * the camera feed and with the user's attention on the physical world, and
 * there is no scrollback to recover it from.
 */
export type ArToast = Toast;

/**
 * Create the toast surface inside the AR overlay root.
 *
 * @param root the SAME element passed to `initAR` — anything outside it is not
 *   composited during an immersive session.
 */
export function createArToast(root: HTMLElement): ArToast {
  return createToast(root, {
    className: "ar-toast",
    lingerMs: AR_TOAST_LINGER_MS,
  });
}
