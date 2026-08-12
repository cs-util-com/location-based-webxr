/**
 * @vitest-environment jsdom
 *
 * The AR toast — the only surface a message can reach an immersed user on.
 *
 * WHY THESE TESTS MATTER. The r509 review found the far-travel warning going to
 * a channel that was invisible in AR (outside the DOM overlay) AND erased in the
 * same tick by `fetchStarted`. The unit test at the time asserted `warn` had
 * been called, which it had. So the assertions here are deliberately about the
 * DOM and about survival, not about the call.
 *
 * @see ar-toast.ts.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { AR_TOAST_LINGER_MS, createArToast } from "./ar-toast.js";

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

describe("the AR toast", () => {
  it("puts the message INSIDE the overlay root", () => {
    // THE WHOLE POINT. Only `initAR`'s container subtree is composited over the
    // camera feed; a message anywhere else on the page is not shown at all
    // during an immersive session, however correct the text is.
    const toast = createArToast(root);

    toast.show("You are 2.1 km from where this session was anchored");

    expect(root.textContent).toContain("2.1 km");
  });

  it("leaves the root EMPTY until there is something to say", () => {
    // `#ar-root` is `position: fixed; inset: 0` and hidden only while `:empty`.
    // A toast element living there permanently would keep a full-viewport,
    // click-eating layer over the entire page whenever AR is not running —
    // which is a regression this demo has already shipped once (`ar-mode.ts`).
    createArToast(root);

    expect(root.children).toHaveLength(0);
  });

  it("is announced politely rather than interrupting", () => {
    const toast = createArToast(root);

    toast.show("drifting");

    const element = root.querySelector(".ar-toast");
    expect(element?.getAttribute("role")).toBe("status");
    expect(element?.getAttribute("aria-live")).toBe("polite");
  });

  it("takes itself down, and leaves the root empty again", () => {
    const toast = createArToast(root);
    toast.show("drifting");

    vi.advanceTimersByTime(AR_TOAST_LINGER_MS + 1);

    expect(root.children).toHaveLength(0);
  });

  it("restarts the timer on a second message rather than inheriting the first's", () => {
    // The warning repeats as the user walks. Without this the second message
    // would inherit whatever was left of the first's timer and could vanish
    // almost immediately.
    const toast = createArToast(root);
    toast.show("first");
    vi.advanceTimersByTime(AR_TOAST_LINGER_MS - 100);

    toast.show("second");
    vi.advanceTimersByTime(AR_TOAST_LINGER_MS - 100);

    expect(root.textContent).toContain("second");
  });

  it("clears on demand, so leaving AR does not leave a message hanging", () => {
    const toast = createArToast(root);
    toast.show("drifting");

    toast.clear();

    expect(root.children).toHaveLength(0);
  });

  it("survives a clear with nothing showing", () => {
    const toast = createArToast(root);

    expect(() => {
      toast.clear();
    }).not.toThrow();
  });
});
