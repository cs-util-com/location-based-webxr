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
    const hud = createArHud(root);
    hud.sample({ fps: 60 }, 0);

    expect(root.querySelector(".ar-hud")?.getAttribute("aria-hidden")).toBe(
      "true",
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
