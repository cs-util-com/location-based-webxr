/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";
import * as fc from "fast-check";

import {
  ENTRY_DOM_VEIL_CLASS,
  ENTRY_DOM_VEIL_FADE_S,
  ENTRY_DOM_VEIL_HOLD_S,
  ENTRY_READY_MAX_WAIT_S,
  createArEntryDomVeil,
  domVeilAlpha,
  entryDomVeilColour,
  entryFadeMayStart,
} from "./ar-entry-dom-veil.js";
import { ENTRY_VEIL_COLOUR } from "./ar-entry-veil.js";
import { DESCENT_ESTIMATE_WAIT_S } from "./ar-descent.js";

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
    // infinite reading means the fade is long over. `entryVeilAlpha` is the
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

describe("when the entry veil may start fading (DEC-M1)", () => {
  /**
   * Why these tests matter: this gate is the whole of M1 and M2 from the
   * eighteenth field session. It replaces "two frames have been drawn" as the
   * fade's trigger, and the two ways it can be wrong are opposites — opening
   * early shows a wrongly-rotated city, never opening leaves a black screen
   * with no way out. Both are pinned below.
   *
   * The hold lives HERE and nowhere else (cold review, finding 3). An earlier
   * draft also put a plateau inside `domVeilAlpha`, which composes to a 6 s
   * black screen and puts one constant in two places that must agree.
   */
  const ready = {
    waitedS: ENTRY_DOM_VEIL_HOLD_S,
    aligned: true,
    contentReady: true,
  };

  it("waits out the hold even when everything is already ready", () => {
    // The deliberate pause the field session asked for: "die ersten zwei
    // Sekunden muss da einfach erstmal nur dieser Text stehen". A warm start
    // has both readiness conditions on the first frame, so without this term
    // the entry is instant again — the behaviour being complained about.
    expect(entryFadeMayStart({ ...ready, waitedS: 0 })).toBe(false);
    expect(
      entryFadeMayStart({ ...ready, waitedS: ENTRY_DOM_VEIL_HOLD_S - 0.001 }),
    ).toBe(false);
    expect(entryFadeMayStart(ready)).toBe(true);
  });

  it("holds past the hold while the alignment has not landed (M2)", () => {
    // THE CORRECTNESS HALF. Until the framework has solved once, the city is
    // drawn in the phone's arbitrary start heading — the wrongly-rotated
    // overlay the session reported. Uncovering then is the defect.
    expect(entryFadeMayStart({ ...ready, aligned: false })).toBe(false);
    expect(entryFadeMayStart({ ...ready, waitedS: 5, aligned: false })).toBe(
      false,
    );
  });

  it("holds past the hold while the entry rebuild has not settled (M1)", () => {
    // "Nach den sechs Sekunden sollten die OpenStreetMap-3D-Sachen alle da
    // sein" — which is a readiness requirement, not a duration.
    expect(entryFadeMayStart({ ...ready, contentReady: false })).toBe(false);
  });

  it("opens at the ceiling however un-ready the session is", () => {
    // THE LID RULE, in gate form. A device that never gets a fix must not be
    // trapped behind a black screen: `ar-entry-dom-veil.ts` calls an opaque
    // layer over a live session strictly worse than having no veil at all.
    expect(
      entryFadeMayStart({
        waitedS: ENTRY_READY_MAX_WAIT_S,
        aligned: false,
        contentReady: false,
      }),
    ).toBe(true);
  });

  it("collapses an unusable clock reading to 'not yet', like descentMayStart", () => {
    // The opposite direction from `domVeilAlpha`'s rule, and deliberately so:
    // there the input is an opacity and the safe answer is "no veil"; here it
    // is a clock, and a NaN that opened the gate would uncover the camera on
    // the strength of a reading that means nothing. The ready path below shows
    // the guard does not swallow a genuinely ready session.
    for (const bad of [Number.NaN, Number.NEGATIVE_INFINITY]) {
      expect(entryFadeMayStart({ ...ready, waitedS: bad })).toBe(false);
      expect(
        entryFadeMayStart({
          waitedS: bad,
          aligned: false,
          contentReady: false,
        }),
      ).toBe(false);
    }
    // `+Infinity` is a real "long past the ceiling", so it opens.
    expect(
      entryFadeMayStart({
        waitedS: Number.POSITIVE_INFINITY,
        aligned: false,
        contentReady: false,
      }),
    ).toBe(true);
  });

  it("cannot open before the fly-in's own estimate wait has expired", () => {
    // WHICH GATE IS LOAD-BEARING, pinned as a constant relationship — the same
    // device `elevation-nudge.test.ts` uses for `DESCENT_MAX_START_M` against
    // the nudge's reach, and for the same reason: the two numbers live in
    // different modules and nothing else would notice them crossing.
    //
    // The milestone review found the plan claiming that on a slow-estimator
    // path the fly-in "still waits for the estimate". It cannot: the veil
    // cannot go before HOLD + FADE, and `descentMayStart`'s fallback expires at
    // `DESCENT_ESTIMATE_WAIT_S`, so once the veil is gone the estimate term is
    // already true on every path. That is fine — but it must be a stated
    // relationship rather than an accident, because reversing it would make the
    // estimate gate load-bearing again with no test noticing.
    expect(
      ENTRY_DOM_VEIL_HOLD_S + ENTRY_DOM_VEIL_FADE_S,
    ).toBeGreaterThanOrEqual(DESCENT_ESTIMATE_WAIT_S);
  });

  it("is monotone in time, so a fade can never un-start", () => {
    // THE PROPERTY THAT MATTERS MOST. The driver latches the fade's start on
    // the first frame this returns true; if the gate could go false again the
    // veil would re-opaque mid-fade, which reads as a flicker over a live
    // session and is unreachable by any single-point test.
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 20, noNaN: true }),
        fc.boolean(),
        fc.boolean(),
        (a, b, aligned, contentReady) => {
          const [earlier, later] = a <= b ? [a, b] : [b, a];
          const inputs = { aligned, contentReady };
          const opensEarlier = entryFadeMayStart({
            ...inputs,
            waitedS: earlier,
          });
          const opensLater = entryFadeMayStart({ ...inputs, waitedS: later });
          // Written as an implication rather than as a guarded assertion, so
          // the property holds in one expression: "open earlier" must imply
          // "open later", and every other combination is fine.
          expect(!opensEarlier || opensLater).toBe(true);
        },
      ),
    );
  });
});
