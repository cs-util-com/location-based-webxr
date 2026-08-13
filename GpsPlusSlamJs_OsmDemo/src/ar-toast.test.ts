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
    // The text lands a task later, deliberately — see the r513 block below.
    vi.advanceTimersByTime(0);

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

describe("the announcement actually fires (r511 review, corrected in r513)", () => {
  it("attaches EMPTY and stays empty for the rest of the task", () => {
    // THE OBSERVABLE THAT MATTERS, and the first version of this test did not
    // assert it. A live region is announced when its content changes while it
    // is in the accessibility tree, and browsers flush that tree once at the
    // END of a task rather than per DOM operation. So attaching and populating
    // in the same task — even in that order — presents the AT with a region
    // that appeared already carrying its text, which is the silent case.
    //
    // The previous test patched `root.append` to observe the text at attach
    // time. That is a state no accessibility layer ever reaches, so it passed
    // against code that announced nothing. This asserts the state that IS
    // observable: at the end of the synchronous block the region is attached
    // and still empty.
    const toast = createArToast(root);

    toast.show("drifting");

    expect(root.querySelector(".ar-toast")).not.toBeNull();
    expect(root.textContent).toBe("");
  });

  it("writes the text in a LATER task, which is what gets announced", () => {
    const toast = createArToast(root);
    toast.show("drifting");

    vi.advanceTimersByTime(0);

    expect(root.textContent).toContain("drifting");
  });

  it("does not resurrect a message cleared before the write lands", () => {
    // `clear()` can arrive in the gap — leaving AR, or a newer state replacing
    // the warning. What makes this hold is that `clear()` CANCELS the pending
    // timer, so the write never runs.
    //
    // Said precisely because the first version of this file claimed otherwise
    // (r513 review): it described an `element.isConnected` guard inside the
    // callback as the mechanism, and that guard could never fire — the
    // cancellation above it had already made the callback unreachable. This
    // test passed then and passes now, which is exactly why the wording had to
    // be corrected rather than left to imply coverage it does not have.
    const toast = createArToast(root);
    toast.show("drifting");

    toast.clear();
    vi.advanceTimersByTime(0);

    expect(root.children).toHaveLength(0);
    expect(root.textContent).toBe("");
  });

  it("shows the LATER message when two arrive in one task", () => {
    // Held by the same cancellation: the second `show` clears the first's
    // pending write before arming its own, so only one callback ever runs.
    const toast = createArToast(root);

    toast.show("first");
    toast.show("second");
    vi.advanceTimersByTime(0);

    expect(root.textContent).toContain("second");
    expect(root.textContent).not.toContain("first");
  });

  it("re-attaches EMPTY after a clear, not carrying the old text", () => {
    // The element is reused across messages, so `clear` has to empty it as well
    // as detach it — otherwise the second `show` attaches a populated region and
    // the whole deferral is undone.
    const toast = createArToast(root);
    toast.show("first");
    vi.advanceTimersByTime(0);
    toast.clear();

    toast.show("second");

    expect(root.textContent).toBe("");
    vi.advanceTimersByTime(0);
    expect(root.textContent).toContain("second");
  });
});
