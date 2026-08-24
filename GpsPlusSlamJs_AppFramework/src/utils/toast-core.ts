/**
 * A transient message, announced to assistive technology, in any container.
 *
 * WHY THE FRAMEWORK OWNS THIS. There were four toasts in the workspace, and the
 * three outside this file agreed on nothing: one announced politely, one had no
 * ARIA at all, one wrote its text synchronously, one deferred it, two attached
 * and detached the element while two toggled a class. The mechanism below
 * carries corrections that cost three review rounds between them and are
 * invisible in the finished code — which is exactly the kind of thing a second
 * hand-written copy reproduces the bugs of rather than the fixes.
 *
 * WHAT IT DOES NOT DO. It does not own the toast's PLACEMENT or its LIFETIME.
 * A container-scoped factory and a document-level singleton are genuinely
 * different lifetimes, and an immersive-AR overlay is a genuinely different
 * placement from a page. Callers keep those; this owns the element, the ARIA
 * contract, the timer and the replace-and-restart semantics.
 *
 * @see toast-core.ts.md
 */

/** How long a message stays before it goes, ms. */
export const DEFAULT_TOAST_LINGER_MS = 6_000;

export interface Toast {
  /**
   * Show a message. Replaces any current one and restarts the timer.
   *
   * `options` override this toast's defaults for THIS message only — a longer
   * linger for an error, a different class for a severity — without the caller
   * having to keep a second `Toast` around.
   */
  show(message: string, options?: ToastShowOptions): void;
  /** Take any message down now, and stop the timer. Idempotent. */
  clear(): void;
}

export interface ToastShowOptions {
  /** Replaces the element's class for this message. */
  readonly className?: string;
  /** Overrides the linger for this message. */
  readonly lingerMs?: number;
}

export interface ToastOptions {
  /** Class on the toast element. Defaults to `"toast"`. */
  readonly className?: string;
  /** Overrides {@link DEFAULT_TOAST_LINGER_MS}. */
  readonly lingerMs?: number;
  /** `id` on the toast element, for CSS or a test hook. Omitted by default. */
  readonly id?: string;
}

/**
 * Creates a toast surface inside `root`.
 *
 * THE TWO CORRECTIONS THIS CARRIES, both invisible in the code:
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
 * living in the DOM permanently. For an AR overlay root that is mandatory: such
 * a root is typically `position: fixed; inset: 0` and hidden only while
 * `:empty`, so a permanent child would keep a full-viewport click-eating layer
 * over the page whenever AR is NOT running — a regression already recorded in
 * the OSM demo's `ar-mode.ts`. For an ordinary page root it is merely tidy, and
 * one rule for both is worth more than the saved DOM operation.
 */
export function createToast(
  root: HTMLElement,
  options: ToastOptions = {}
): Toast {
  const element = document.createElement('div');
  const defaultClassName = options.className ?? 'toast';
  element.className = defaultClassName;
  if (options.id !== undefined) element.id = options.id;
  // POLITE, not assertive: these are information, not interruptions, and
  // `alert` would cut across whatever a screen reader is currently saying.
  element.setAttribute('role', 'status');
  element.setAttribute('aria-live', 'polite');

  const defaultLingerMs = options.lingerMs ?? DEFAULT_TOAST_LINGER_MS;

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The deferred text write. See the function comment. */
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
    element.textContent = '';
    element.remove();
  };

  return {
    show(message: string, showOptions: ToastShowOptions = {}): void {
      if (pending !== undefined) clearTimeout(pending);
      // EMPTIED FIRST, for the reason `clear()` gives: on a replacement this
      // element is already attached and still carrying the previous message,
      // so without this it would wear the new severity over the old text for
      // one task, and a re-inserted region would arrive populated.
      element.textContent = '';
      // Applied BEFORE attaching, so the element never appears in the DOM
      // wearing the previous message's severity for a frame.
      element.className = showOptions.className ?? defaultClassName;
      // `append`, not `insertBefore`: in an AR root the XR canvas sits at the
      // FRONT of the container and the toast has to paint over it. Skipped
      // when already parented, because `append` on a current child is a
      // spec-level remove-then-insert — it would tear the live region out of
      // the accessibility tree on every replacement.
      if (element.parentNode !== root) root.append(element);
      pending = setTimeout(() => {
        pending = undefined;
        element.textContent = message;
      }, 0);
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(clear, showOptions.lingerMs ?? defaultLingerMs);
    },
    clear,
  };
}
