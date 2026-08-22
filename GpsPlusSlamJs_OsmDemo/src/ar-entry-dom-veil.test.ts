/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from "vitest";

import {
  ENTRY_DOM_VEIL_CLASS,
  createArEntryDomVeil,
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
