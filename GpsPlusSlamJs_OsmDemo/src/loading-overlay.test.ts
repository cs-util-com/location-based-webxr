/**
 * @vitest-environment jsdom
 */

/**
 * The loading surface itself: where it lives, and what it does when the wait
 * outlasts its bar.
 *
 * WHY THESE TESTS AND NOT OTHERS. The DECISION to show or hide is
 * `loading-announcer.ts`'s, and is tested there on a fake clock. What is left
 * here is exactly the two things the owner changed after seeing the first
 * version: it must sit on the 3D scene rather than in a page corner, and it
 * must NOT take itself down — a toast's self-dismissal is what would have left
 * the user with nothing halfway through a median cold load.
 *
 * @see loading-overlay.ts.md
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLoadingOverlay } from "./loading-overlay.js";

beforeEach(() => {
  document.body.innerHTML = "";
  vi.useFakeTimers();
  return () => {
    vi.useRealTimers();
  };
});

/** Stands in for `#scene`, which is `position: relative` in the real page. */
function scene(): HTMLElement {
  const host = document.createElement("div");
  host.id = "scene";
  document.body.append(host);
  return host;
}

describe("createLoadingOverlay", () => {
  it("mounts inside the 3D scene, not the page", () => {
    // THE OWNER'S FIRST CORRECTION. The original sat in the page's bottom-left
    // toast root; it belongs over the view whose content is being waited for.
    const host = scene();
    const overlay = createLoadingOverlay(host);

    overlay.show("Loading OpenStreetMap data…");

    const element = host.querySelector("#loading-overlay");
    expect(element).not.toBe(null);
    expect(element?.parentElement).toBe(host);
    expect(element?.textContent).toContain("Loading");
  });

  it("NEVER takes itself down", () => {
    // THE OWNER'S SECOND CORRECTION, and the reason this is not a `Toast`.
    // `toast-core` clears itself after its linger; a median cold tile takes
    // roughly twice the bar's 15 s, so a self-dismissing surface would leave
    // exactly when the wait was at its worst. An hour is far past any linger.
    const host = scene();
    const overlay = createLoadingOverlay(host);

    overlay.show("Loading OpenStreetMap data…");
    vi.advanceTimersByTime(60 * 60 * 1000);

    expect(host.querySelector("#loading-overlay")).not.toBe(null);
  });

  it("marks itself overrunning once the bar has drained", () => {
    // What the sweep is driven by. Before the bar runs out there is nothing to
    // say beyond "loading"; after it, "slower than usual" is true and is the
    // honest thing to show.
    const host = scene();
    const overlay = createLoadingOverlay(host, { barMs: 1_000 });

    overlay.show("Loading…");
    const element = host.querySelector<HTMLElement>("#loading-overlay");
    expect(element?.dataset["overrun"]).toBeUndefined();

    vi.advanceTimersByTime(1_000);

    expect(element?.dataset["overrun"]).toBe("true");
  });

  it("starts the bar over on a re-show, and drops a stale overrun", () => {
    // A second gesture is a new wait. Without the reset the fresh overlay would
    // inherit the previous one's drained bar and its "slower than usual" mark,
    // which would be a claim about a load that had not started yet.
    const host = scene();
    const overlay = createLoadingOverlay(host, { barMs: 1_000 });

    overlay.show("Loading…");
    vi.advanceTimersByTime(1_000);
    expect(
      host.querySelector<HTMLElement>("#loading-overlay")?.dataset["overrun"],
    ).toBe("true");

    overlay.show("Loading…");

    const element = host.querySelector<HTMLElement>("#loading-overlay");
    expect(element?.dataset["overrun"]).toBeUndefined();
    vi.advanceTimersByTime(999);
    expect(element?.dataset["overrun"]).toBeUndefined();
  });

  it("goes when cleared, and stays gone", () => {
    const host = scene();
    const overlay = createLoadingOverlay(host, { barMs: 1_000 });

    overlay.show("Loading…");
    overlay.clear();
    expect(host.querySelector("#loading-overlay")).toBe(null);

    // The pending overrun timer must not resurrect anything or throw.
    vi.advanceTimersByTime(10_000);
    expect(host.querySelector("#loading-overlay")).toBe(null);
  });

  it("does not eat clicks on the view it covers", () => {
    // Clicking the map is how a user retries a slow load; an overlay that
    // swallowed that would make the app feel stuck AND be unrecoverable.
    const host = scene();
    const overlay = createLoadingOverlay(host);

    overlay.show("Loading…");

    const element = host.querySelector<HTMLElement>("#loading-overlay");
    expect(element?.style.pointerEvents).toBe("none");
  });
});
