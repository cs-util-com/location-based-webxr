/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  ENTRY_DOM_VEIL_CLASS,
  ENTRY_DOM_VEIL_FADE_S,
  createArEntryDomVeil,
  domVeilAlpha,
  entryDomVeilColour,
} from "./ar-entry-dom-veil.js";
import { ENTRY_VEIL_COLOUR } from "./ar-entry-veil.js";

/**
 * Why these tests matter: this element exists to be indistinguishable from the
 * mesh veil for a few hundred milliseconds, and every way it can fail is
 * invisible in a screenshot taken at any other moment.
 */

describe("the AR entry DOM veil", () => {
  it("paints exactly the mesh veil's colour", () => {
    // THE HANDOVER IS THE WHOLE POINT. The DOM veil is removed once a frame has
    // been drawn with the mesh veil in it, so if the two colours differ the
    // user sees a flash of the wrong black at the join — which is the artefact
    // this milestone exists to remove, reintroduced one layer up.
    expect(entryDomVeilColour()).toBe("#11131a");
    expect(Number.parseInt(entryDomVeilColour().slice(1), 16)).toBe(
      ENTRY_VEIL_COLOUR,
    );
  });

  it("attaches to the container it is given", () => {
    const container = document.createElement("div");
    const veil = createArEntryDomVeil(container);

    expect(veil.element.parentElement).toBe(container);
    expect(veil.element.className).toBe(ENTRY_DOM_VEIL_CLASS);
  });

  it("is hidden from assistive technology, because the status line speaks", () => {
    // The waiting line carries `role="status"`; a second node in the same
    // subtree would be announced for a layer that says nothing.
    const container = document.createElement("div");
    const veil = createArEntryDomVeil(container);

    expect(veil.element.getAttribute("aria-hidden")).toBe("true");
  });

  it("removes itself, and tolerates being removed twice", () => {
    // IDEMPOTENCE IS LOAD-BEARING, not politeness. Removal is called from the
    // frame hook AND from a `finally` covering every exit path, so the ordinary
    // success case calls it twice. A second call that threw would surface as a
    // failed AR entry.
    const container = document.createElement("div");
    const veil = createArEntryDomVeil(container);

    veil.remove();
    expect(container.children).toHaveLength(0);

    expect(() => {
      veil.remove();
    }).not.toThrow();
    expect(container.children).toHaveLength(0);
  });

  it("does not remove a LATER veil when an earlier one is removed twice", () => {
    // The failure the idempotence guard could hide: a `remove()` that simply
    // called `element.remove()` again would be harmless, but one that cleared
    // the container would take a re-entry's veil down with it.
    const container = document.createElement("div");
    const first = createArEntryDomVeil(container);
    first.remove();

    const second = createArEntryDomVeil(container);
    first.remove();

    expect(second.element.parentElement).toBe(container);
  });
});

describe("the fade (DEC-L1)", () => {
  /**
   * Why these tests matter: this veil no longer disappears in one step — it is
   * driven to zero over `ENTRY_DOM_VEIL_FADE_S` and removes itself when it gets
   * there. The seventeenth field session still saw a flash of camera at the
   * instant the hard cut happened, and no gate in this repo can reproduce that
   * (headless Chromium cannot start an immersive session), so the curve and its
   * degenerate inputs are the only part that CAN be pinned.
   *
   * **The failure this file exists to prevent is an opaque layer that never
   * leaves** — a lid over the passthrough, which `ar-entry-veil.ts` records as
   * strictly worse than having no veil at all. Every assertion below about a
   * degenerate input is about that.
   */

  it("is fully opaque when the fade begins", () => {
    // The whole point of DEC-L1: the black period is never SHORTER than the
    // hard cut it replaces. The fade starts where the removal used to happen.
    expect(domVeilAlpha(0)).toBe(1);
  });

  it("is fully transparent at the end of the fade, and stays there", () => {
    // Exactly 0, not approximately: the driver removes the element when the
    // alpha reaches 0, so a residual 0.01 is a permanent wash over the camera
    // AND an element that is never taken down.
    expect(domVeilAlpha(ENTRY_DOM_VEIL_FADE_S)).toBe(0);
    expect(domVeilAlpha(ENTRY_DOM_VEIL_FADE_S + 60)).toBe(0);
  });

  it("falls monotonically in between, so it reads as a fade rather than a step", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: ENTRY_DOM_VEIL_FADE_S, noNaN: true }),
        fc.double({ min: 0, max: ENTRY_DOM_VEIL_FADE_S, noNaN: true }),
        (a, b) => {
          const [earlier, later] = a <= b ? [a, b] : [b, a];
          expect(domVeilAlpha(earlier)).toBeGreaterThanOrEqual(
            domVeilAlpha(later),
          );
        },
      ),
    );
  });

  it("collapses EVERY unusable clock reading to transparent, never to opaque", () => {
    // THE LID RULE, and the direction is the whole assertion. A `NaN` that
    // resolved to 1 would paint an opaque element over a live AR session with
    // no error raised anywhere, and the driver would never reach its removal
    // condition — so the veil would outlive the entry it exists for.
    //
    // ⚠️ NOTE THIS IS *NOT* `ar-entry-veil.ts`'s `setAlpha` rule, which clamps
    // `+Infinity` UP to 1. There the input is an opacity and "as opaque as
    // possible" is a real request; here the input is ELAPSED TIME, so an
    // infinite reading means the fade is long over. `cameraFadeAlpha` is the
    // rule this follows: every degenerate input resolves to "no veil".
    for (const bad of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(domVeilAlpha(bad)).toBe(0);
    }
  });

  it("writes the alpha onto the element, clamped", () => {
    const container = document.createElement("div");
    const veil = createArEntryDomVeil(container);

    veil.setAlpha(0.5);
    expect(veil.element.style.opacity).toBe("0.5");

    // Out of range in either direction is clamped rather than propagated: a
    // CSS opacity outside [0,1] is invalid and the browser drops the
    // declaration, which restores the element to FULLY opaque — the lid again,
    // arriving through the one path that looks harmless.
    veil.setAlpha(2);
    expect(veil.element.style.opacity).toBe("1");
    veil.setAlpha(-1);
    expect(veil.element.style.opacity).toBe("0");
    veil.setAlpha(Number.NaN);
    expect(veil.element.style.opacity).toBe("0");
  });
});
