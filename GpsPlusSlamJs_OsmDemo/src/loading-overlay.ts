/**
 * The "we are loading" surface, centred on the 3D scene.
 *
 * WHY THIS IS NOT A TOAST, having been one for an hour. The first version used
 * the framework's `Toast` in the page's bottom-left corner, and the owner's
 * verdict on seeing it was that it belongs over the 3D view and must not leave
 * until the models are on screen: "less a toast and more a toast-looking
 * overlay on top of the 3D scene". Those two changes are the whole reason this
 * module exists rather than a second `createToast` call:
 *
 * - **A toast owns its own lifetime.** `toast-core` clears itself after a
 *   linger, which is exactly wrong here — a median cold tile takes about twice
 *   the 15 s the bar runs for, so the surface would leave while the wait
 *   continued. This one has no self-dismissal at all: it is shown until
 *   something tells it to go.
 * - **A toast lives in a page-corner root.** This mounts inside `#scene`, which
 *   is already `position: relative`, so it centres on the 3D view without a new
 *   stacking context or a fixed-position guess about where that view is.
 *
 * WHAT IT KEEPS FROM THE TOAST: the look. It wears the design system's surface
 * and the same draining bar, so the app still speaks with one voice.
 *
 * THE BAR STILL MEASURES SOMETHING TRUE. It drains over {@link BAR_DURATION_MS},
 * which is no longer a lifetime — it is "about how long this usually takes".
 * When it runs out and the load is still going, the fill switches to a moving
 * sweep (`data-overrun`), which is the honest message: still working, and this
 * one is slower than usual. A bar that silently restarted would promise another
 * fifteen seconds that nothing can keep.
 *
 * DELIBERATELY SHAPE-COMPATIBLE WITH `Toast` (`show`/`clear`), so
 * `loading-announcer.ts` — which decides WHEN to show and hide, and is tested
 * to the corner on a fake clock — did not have to change to accommodate the
 * move. The announcer already hides on the first published snapshot, and that
 * call sits after `drawScene` in the subscriber, so "the models are on screen"
 * is the moment it already acts on.
 *
 * @see loading-overlay.ts.md
 */

/**
 * How long the bar takes to drain, and therefore what it claims.
 *
 * The owner's 15 s, kept: it reads as "about this long" rather than as a
 * deadline, and the overrun sweep covers the rest honestly.
 */
export const BAR_DURATION_MS = 15_000;

export interface LoadingOverlay {
  /** Show the overlay with this message. Idempotent for the same message. */
  show(message: string): void;
  /** Take it down. Idempotent. */
  clear(): void;
  /** Remove it from the DOM and drop its timer. */
  dispose(): void;
}

export interface LoadingOverlayOptions {
  /** Overrides {@link BAR_DURATION_MS}; the tests use it to stay fast. */
  readonly barMs?: number;
}

/**
 * Builds the overlay inside `host`, which must be a positioned element — the
 * demo passes `#scene`.
 *
 * The element is created once and attached/detached on show/clear rather than
 * rebuilt, so the bar's animation restarts from a fresh attach and nothing has
 * to force a style flush. That is the same reason `loading-announcer.ts` clears
 * before every show.
 */
export function createLoadingOverlay(
  host: HTMLElement,
  options: LoadingOverlayOptions = {},
): LoadingOverlay {
  const barMs = options.barMs ?? BAR_DURATION_MS;

  const element = document.createElement("div");
  element.className = "loading-overlay plate";
  element.id = "loading-overlay";
  // ANNOUNCED, like the toast it replaces. `status` + `polite` because this is
  // information, not an interruption: it must not cut across whatever a screen
  // reader is already saying.
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  // It sits over the 3D view, and clicking that view is how a user retries.
  element.style.pointerEvents = "none";

  const text = document.createElement("span");
  text.className = "loading-overlay-text";

  const bar = document.createElement("span");
  bar.className = "loading-overlay-bar";
  const fill = document.createElement("span");
  fill.className = "loading-overlay-fill";
  bar.append(fill);

  element.append(text, bar);

  let overrunTimer: ReturnType<typeof setTimeout> | undefined;

  function stopOverrunTimer(): void {
    if (overrunTimer === undefined) return;
    clearTimeout(overrunTimer);
    overrunTimer = undefined;
  }

  return {
    show(message) {
      stopOverrunTimer();
      // Detach-then-attach, so the bar starts over on a re-show rather than
      // continuing a previous drain. `remove()` on an unattached node is a
      // no-op, so the first show costs nothing.
      element.remove();
      delete element.dataset["overrun"];
      text.textContent = message;
      host.append(element);
      // THE SWITCH TO "SLOWER THAN USUAL". A timer rather than a chained CSS
      // animation-delay: two animations on one property, one of them delayed,
      // is a subtlety nobody re-reads correctly, and this is trivially
      // testable on a fake clock.
      overrunTimer = setTimeout(() => {
        overrunTimer = undefined;
        element.dataset["overrun"] = "true";
      }, barMs);
    },

    clear() {
      stopOverrunTimer();
      element.remove();
    },

    dispose() {
      stopOverrunTimer();
      element.remove();
    },
  };
}
