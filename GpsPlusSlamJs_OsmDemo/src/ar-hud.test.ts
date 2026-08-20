/**
 * @vitest-environment jsdom
 *
 * The AR readout's surface and its sampling cadence.
 *
 * WHY THESE TESTS MATTER. Two failures here are silent and both have precedent
 * in this demo. A readout outside the dom-overlay root is invisible for exactly
 * the session it measures (`ar-toast.ts` records that finding). And an element
 * left permanently inside `#ar-root` keeps a full-viewport, click-eating layer
 * over the whole page whenever AR is NOT running (`ar-mode.ts` records that
 * one, as a regression that shipped).
 *
 * @see ar-hud.ts.md
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { AR_HUD_SAMPLE_MS, createArHud } from "./ar-hud.js";

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.append(root);
  // THE EXPAND PREFERENCE OUTLIVES THE HUD BY DESIGN (DEC-H2), so without this
  // one test's toggle decides the next test's starting state — which is exactly
  // what happened the first time these were run together. Every test below sets
  // up whatever expansion it needs; the persistence test toggles its own.
  window.localStorage.clear();
});

afterEach(() => {
  root.remove();
});

describe("the AR HUD", () => {
  it("writes into the overlay root, where WebXR will composite it", () => {
    const hud = createArHud(root);

    hud.sample({ fps: 60 }, 0);

    expect(root.textContent).toContain("60 fps");
  });

  it("stays OUT of the root while there is nothing to report", () => {
    // `#ar-root` is `position: fixed; inset: 0` and hidden only while `:empty`.
    // An always-attached readout would keep that layer alive over the whole
    // page whenever AR is not running — a regression this demo has shipped.
    const hud = createArHud(root);

    hud.sample({}, 0);

    expect(root.children).toHaveLength(0);
  });

  it("leaves the root empty again when the numbers go away", () => {
    // The realistic path out: the session ends mid-sample, or every field
    // becomes unmeasurable. Attaching on the way in but never detaching would
    // leave the layer behind.
    const hud = createArHud(root);
    hud.sample({ fps: 60 }, 0);

    hud.sample({}, AR_HUD_SAMPLE_MS);

    expect(root.children).toHaveLength(0);
  });

  it("ignores samples inside the window, so the DOM is not written per frame", () => {
    // THE INSTRUMENT MUST NOT CHANGE THE READING. Writing `textContent` at
    // display rate puts layout on the critical path of the frame budget this
    // readout exists to measure.
    const hud = createArHud(root);
    hud.sample({ fps: 60 }, 0);

    hud.sample({ fps: 12 }, AR_HUD_SAMPLE_MS - 1);

    expect(root.textContent).toContain("60 fps");
    expect(root.textContent).not.toContain("12 fps");
  });

  it("takes the next sample once the window has elapsed", () => {
    // The counterweight: a cadence that never fires is a readout that never
    // updates, which looks identical to a frozen session.
    const hud = createArHud(root);
    hud.sample({ fps: 60 }, 0);

    hud.sample({ fps: 12 }, AR_HUD_SAMPLE_MS);

    expect(root.textContent).toContain("12 fps");
  });

  it("accepts the very first sample rather than waiting out a window", () => {
    // A half-second of blank readout at session start is half a second the
    // user spends wondering whether it works at all.
    const hud = createArHud(root);

    hud.sample({ fps: 60 }, 1234.5);

    expect(root.textContent).toContain("60 fps");
  });

  it("is hidden from assistive technology", () => {
    // It changes twice a second forever. Announcing that would make the page
    // unusable with a screen reader, and these are a developer instrument
    // rather than user-facing content — unlike the far-travel toast, which IS
    // announced politely, now that `#ar-root` no longer carries a static
    // `aria-hidden` that made its live region inert (r510 review).
    //
    // THE ATTRIBUTE MOVED from `.ar-hud` to `.ar-hud-values` when the readout
    // became collapsible (DEC-H2), and the invariant this test protects is
    // unchanged: the numbers are not announced. It cannot stay on the container
    // any more, because that container now holds a focusable toggle — and an
    // `aria-hidden` subtree with a focusable button in it is worse than either
    // choice, being keyboard-reachable and simultaneously invisible to the
    // screen reader that would describe it.
    const hud = createArHud(root);
    hud.sample({ fps: 60 }, 0);

    expect(
      root.querySelector(".ar-hud-values")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(root.querySelector(".ar-hud")?.hasAttribute("aria-hidden")).toBe(
      false,
    );
  });

  it("takes itself down on dispose, and can be sampled again afterwards", () => {
    // `dispose` runs on both AR exits. A HUD that could not be restarted would
    // make the second session of a page silently instrument-free.
    const hud = createArHud(root);
    hud.sample({ fps: 60 }, 0);

    hud.dispose();

    expect(root.children).toHaveLength(0);
    hud.sample({ fps: 30 }, 0);
    expect(root.textContent).toContain("30 fps");
  });
});

/**
 * Why these tests matter: DEC-H2 makes this ONE collapsible readout rather than
 * two tiers, and the whole value of the expanded state is that it is what you
 * open just before taking a screenshot. Three things have to hold for that to
 * work — the toggle has to survive a session (or it gets re-enabled by hand on
 * every field trip and then abandoned), it has to repaint immediately rather
 * than at the next 500 ms sample, and it must not make the numbers
 * screen-reader noise. The persistence test also pins that a throwing
 * `localStorage` cannot take the readout down with it.
 */
describe("createArHud — collapse and expand", () => {
  const measurements = {
    altitudeM: 105.5,
    terrainHeightM: 104,
    terrainHasData: true,
    geoidUndulationM: 46.2,
  };

  const toggle = (): HTMLElement => {
    const button = root.querySelector("button");
    if (button === null) throw new Error("no toggle button");
    return button;
  };

  it("starts collapsed, and expands to show the screenshot values", () => {
    const hud = createArHud(root);
    hud.sample(measurements, 0);

    expect(root.textContent).toContain("gps-dem +1.5 m");
    expect(root.textContent).not.toContain("geoid N");

    toggle().click();
    expect(root.textContent).toContain("geoid N +46.2 m");
    expect(root.textContent).toContain("terrain 104.0 m");

    hud.dispose();
  });

  it("repaints on the press instead of waiting for the next sample", () => {
    // The sample window is 500 ms. A toggle that waited for it would read as an
    // unresponsive control, and the user would press it again.
    const hud = createArHud(root);
    hud.sample(measurements, 0);
    toggle().click();

    // No further `sample` call, and no clock advance:
    expect(root.textContent).toContain("geoid N +46.2 m");

    hud.dispose();
  });

  it("remembers the expanded state across sessions", () => {
    // Otherwise it is re-enabled by hand on every field trip, which is the
    // friction that gets an instrument abandoned.
    const first = createArHud(root);
    first.sample(measurements, 0);
    toggle().click();
    first.dispose();

    const second = createArHud(root);
    second.sample(measurements, 0);
    expect(root.textContent).toContain("geoid N +46.2 m");
    second.dispose();
  });

  it("still works when localStorage throws", () => {
    // Private mode and sandboxed iframes both do this. Losing the preference is
    // acceptable; losing the readout is not.
    const original = window.localStorage;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new Error("denied");
      },
    });

    try {
      const hud = createArHud(root);
      expect(() => hud.sample(measurements, 0)).not.toThrow();
      expect(root.textContent).toContain("gps-dem +1.5 m");
      expect(() => toggle().click()).not.toThrow();
      expect(root.textContent).toContain("geoid N +46.2 m");
      hud.dispose();
    } finally {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });

  it("names the toggle for a screen reader while keeping the NUMBERS silent", () => {
    // `#ar-root` is no longer inert (r510 review), so its contents are
    // reachable. The numbers change twice a second — announcing them would make
    // the page unusable — but an unlabelled button is just as bad.
    const hud = createArHud(root);
    hud.sample(measurements, 0);

    expect(toggle().getAttribute("aria-label")).toMatch(/debug/i);
    const readout = root.querySelector(".ar-hud-values");
    expect(readout?.getAttribute("aria-hidden")).toBe("true");

    hud.dispose();
  });

  it("takes the toggle down with the readout on dispose", () => {
    // The `#ar-root` trap: anything left behind keeps a full-viewport layer over
    // the page whenever AR is not running.
    const hud = createArHud(root);
    hud.sample(measurements, 0);
    expect(root.children.length).toBeGreaterThan(0);

    hud.dispose();
    expect(root.children).toHaveLength(0);
  });
});

describe("due", () => {
  /**
   * WHY THIS MATTERS (PR review of P4/P5, finding 7).
   *
   * `sample` is cheap; its ARGUMENT is not. Assembling one costs an ENU
   * transform, a bilinear terrain read and a great-circle distance, and the XR
   * frame loop was paying all of that at display rate to feed a readout that
   * accepts a value twice a second — roughly 30 of every 31 builds discarded,
   * on a phone, inside the render loop.
   *
   * `due` lets the caller skip the build. It is a query on the SAME
   * `lastWriteMs` that `sample` gates on, deliberately: a caller that kept its
   * own copy of the interval would be the second cadence `sample`'s return
   * value already exists to prevent.
   */
  const measurements = { fps: 60 };

  it("is true before anything has been sampled", () => {
    const hud = createArHud(root);
    expect(hud.due(0)).toBe(true);
  });

  it("agrees with `sample` on both sides of the window", () => {
    // THE INVARIANT THAT MAKES IT SAFE TO SKIP THE BUILD: if `due` ever said
    // false while `sample` would have accepted, the readout would silently stop
    // updating — a defect that looks exactly like a frozen GPS, which is the
    // report this whole area came from.
    const hud = createArHud(root);
    hud.sample(measurements, 1_000);

    expect(hud.due(1_000 + AR_HUD_SAMPLE_MS - 1)).toBe(false);
    expect(hud.sample(measurements, 1_000 + AR_HUD_SAMPLE_MS - 1)).toBe(false);

    expect(hud.due(1_000 + AR_HUD_SAMPLE_MS)).toBe(true);
    expect(hud.sample(measurements, 1_000 + AR_HUD_SAMPLE_MS)).toBe(true);
  });

  it("does not advance the window by itself", () => {
    // A query, not a tick. Calling it repeatedly must not starve the readout.
    const hud = createArHud(root);
    hud.sample(measurements, 1_000);
    const later = 1_000 + AR_HUD_SAMPLE_MS;
    expect(hud.due(later)).toBe(true);
    expect(hud.due(later)).toBe(true);
    expect(hud.sample(measurements, later)).toBe(true);
  });
});
