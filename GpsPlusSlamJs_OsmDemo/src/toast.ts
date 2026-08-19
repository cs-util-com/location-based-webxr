/**
 * A transient message, announced to assistive technology, in any container.
 *
 * @see toast.ts.md
 */

/** How long a message stays before it goes, ms. */
export const DEFAULT_TOAST_LINGER_MS = 6_000;

export interface Toast {
  /** Show a message. Replaces any current one and restarts the timer. */
  show(message: string): void;
  /** Take any message down now, and stop the timer. Idempotent. */
  clear(): void;
}

export interface ToastOptions {
  /** Class on the toast element. Defaults to `"toast"`. */
  readonly className?: string;
  /** Overrides {@link DEFAULT_TOAST_LINGER_MS}. */
  readonly lingerMs?: number;
}

/**
 * Creates a toast surface inside `root`.
 *
 * EXTRACTED FROM `ar-toast.ts` RATHER THAN WRITTEN BESIDE IT. That component
 * carries two corrections that cost three review rounds between them, and both
 * are invisible in the finished code — a second copy would have reproduced the
 * bugs, not the fixes:
 *
 * 1. **The text is written in the NEXT task, not the same one.** A live region
 *    is announced when its content changes while it is in the accessibility
 *    tree; one inserted already carrying its text is commonly not announced at
 *    all. Reordering the two statements reads correctly and does nothing —
 *    browsers flush accessibility updates once at the end of a task, so the AT
 *    still sees a region that appeared fully populated. The separation has to
 *    be a task boundary.
 *    - `setTimeout`, not `requestAnimationFrame`: rAF is the tighter fit for
 *      "after a rendering step" but is throttled or paused in a background tab,
 *      and messages are emitted with no rendering guaranteed. A task always
 *      fires.
 * 2. **Withdrawal and supersession are handled by CANCELLING the timer, never
 *    by guarding inside the callback.** Guards on `isConnected` or a sequence
 *    number can never be false: both `clear()` and a second `show()` cancel the
 *    pending write before anything else, so a superseded write never runs. The
 *    guards were deleted because the sidecar had begun describing them as the
 *    mechanism — a description asserting something the code does not do, which
 *    is the same defect this component exists to fix, one level up.
 *
 * **The element is attached on `show` and removed on `clear`**, rather than
 * living in the DOM permanently. For the AR root that is mandatory: `#ar-root`
 * is `position: fixed; inset: 0` and hidden only while `:empty`, so a permanent
 * child would keep a full-viewport click-eating layer over the page whenever AR
 * is NOT running — a regression already recorded in `ar-mode.ts`. For the 2D
 * root it is merely tidy, and keeping one rule for both is worth more than the
 * saved DOM operation.
 */
export function createToast(
  root: HTMLElement,
  options: ToastOptions = {},
): Toast {
  const element = document.createElement("div");
  element.className = options.className ?? "toast";
  // POLITE, not assertive: these are information, not interruptions, and
  // `alert` would cut across whatever a screen reader is currently saying.
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");

  const lingerMs = options.lingerMs ?? DEFAULT_TOAST_LINGER_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The deferred text write. See the class comment. */
  let pending: ReturnType<typeof setTimeout> | undefined;

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
    // and one still carrying the previous text would arrive populated — the
    // exact state the deferred write exists to avoid.
    element.textContent = "";
    element.remove();
  };

  return {
    show(message: string): void {
      // `append`, not `insertBefore`: in the AR root the XR canvas sits at the
      // FRONT of the container and the toast has to paint over it.
      root.append(element);
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => {
        pending = undefined;
        element.textContent = message;
      }, 0);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(clear, lingerMs);
    },
    clear,
  };
}
