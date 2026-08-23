/**
 * @vitest-environment jsdom
 *
 * The shared toast surface.
 *
 * WHY THESE TESTS MATTER. This component's two non-obvious behaviours are both
 * about ANNOUNCEMENT, which nothing on screen reveals: a message that renders
 * perfectly can still be silent to a screen reader. Both were found by review
 * rather than by use, and both survived a first fix that looked right:
 *
 * - the text must be written in a LATER TASK than the insertion, because
 *   browsers flush accessibility updates once per task, so reordering two
 *   statements in the same task changes nothing observable;
 * - supersession must be handled by CANCELLING the pending write, not by
 *   guarding inside it — guards there can never fire, and a sidecar that
 *   described them as the mechanism was documenting something the code did not
 *   do.
 *
 * The 2D toast added in round two exists so errors have a channel visible while
 * the header is collapsed, which is what lets the auto-expand rule retire
 * (DEC-U10). If this component is silent, that retirement makes errors
 * invisible rather than merely quieter — so these are the tests standing under
 * that decision.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createToast, DEFAULT_TOAST_LINGER_MS } from "./toast.js";

let root: HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  vi.useRealTimers();
  root.remove();
});

const toastIn = (container: HTMLElement): HTMLElement | null =>
  container.querySelector(".toast");

describe("createToast", () => {
  it("attaches an EMPTY live region first and fills it in a later task", () => {
    // THE ANNOUNCEMENT CONTRACT. A live region inserted already carrying its
    // text is commonly not announced at all — the AT sees a region that
    // appeared populated rather than one whose content changed. Asserting the
    // intermediate empty state is the only way to pin the deferral; a test that
    // only checked the final text passes for the silent version too.
    const toast = createToast(root);

    toast.show("Nothing nearby");

    const element = toastIn(root);
    expect(element).not.toBeNull();
    expect(element?.getAttribute("role")).toBe("status");
    expect(element?.getAttribute("aria-live")).toBe("polite");
    expect(element?.textContent).toBe("");

    vi.advanceTimersByTime(0);
    expect(toastIn(root)?.textContent).toBe("Nothing nearby");
  });

  it("takes the message down after the linger", () => {
    const toast = createToast(root);
    toast.show("Saved");
    vi.advanceTimersByTime(0);
    expect(toastIn(root)).not.toBeNull();

    vi.advanceTimersByTime(DEFAULT_TOAST_LINGER_MS);
    expect(toastIn(root)).toBeNull();
  });

  it("replaces a standing message and restarts its clock", () => {
    const toast = createToast(root);
    toast.show("first");
    vi.advanceTimersByTime(0);

    vi.advanceTimersByTime(DEFAULT_TOAST_LINGER_MS - 100);
    toast.show("second");
    vi.advanceTimersByTime(0);
    expect(toastIn(root)?.textContent).toBe("second");

    // The first message's deadline has now passed; the second's has not.
    vi.advanceTimersByTime(200);
    expect(toastIn(root)?.textContent).toBe("second");
  });

  it("never shows a superseded message, even for one task", () => {
    // The cancellation contract. Two `show` calls in the same task must not
    // produce a flash of the first text — which is what would happen if the
    // pending write were guarded rather than cancelled.
    const toast = createToast(root);
    toast.show("stale");
    toast.show("fresh");

    vi.advanceTimersByTime(0);
    expect(toastIn(root)?.textContent).toBe("fresh");
  });

  it("clear() removes the element and cancels a write already queued", () => {
    // Withdrawal must beat the deferred write. Without the cancellation a
    // cleared toast reappears one task later, populated.
    const toast = createToast(root);
    toast.show("about to be withdrawn");
    toast.clear();

    vi.advanceTimersByTime(0);
    expect(toastIn(root)).toBeNull();
  });

  it("is idempotent when cleared twice, and when cleared before anything shows", () => {
    const toast = createToast(root);
    expect(() => {
      toast.clear();
      toast.clear();
    }).not.toThrow();
  });

  it("reuses one element rather than leaking one per message", () => {
    // `#ar-root` is `position: fixed; inset: 0` and hidden only while `:empty`,
    // so a stray leftover child keeps a full-viewport click-eating layer over
    // the page. A per-message element would leave one behind on every show.
    const toast = createToast(root);
    for (const message of ["a", "b", "c"]) {
      toast.show(message);
      vi.advanceTimersByTime(0);
    }

    expect(root.querySelectorAll(".toast")).toHaveLength(1);
  });

  it("honours a custom class and linger", () => {
    const toast = createToast(root, { className: "ar-toast", lingerMs: 100 });
    toast.show("hi");
    vi.advanceTimersByTime(0);
    expect(root.querySelector(".ar-toast")?.textContent).toBe("hi");

    vi.advanceTimersByTime(100);
    expect(root.querySelector(".ar-toast")).toBeNull();
  });
});
