/**
 * @vitest-environment jsdom
 *
 * Added when the side-effect-note test arrived: the rest of this file is pure
 * (`withLayerBusy` needs no DOM), but `attachLayerToggles` builds real elements
 * and there is no second place to put one test about them.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { ALL_LAYERS } from "./layers.js";
import { attachLayerToggles, withLayerBusy } from "./layer-toggles.js";

/**
 * WHY THESE TESTS MATTER (F58).
 *
 * The busy state exists because enabling the cell layer refetches — measured at
 * ~1880 ms, about 5x over the threshold at which `CLAUDE.md` requires an
 * in-progress state.
 *
 * The half that needs a unit test is the FAILURE path. The e2e cannot reach it:
 * `DemoPipeline.update` collects refused tiles rather than throwing, so an HTTP
 * 400 produces a successful, empty refresh and `refresh()` never rejects. A
 * `.then` instead of a `.finally` would therefore strand the switch — disabled
 * forever — on precisely the path no browser test can produce. Mutating
 * `finally` to `then` fails the second test here and nothing else in the suite.
 */
describe("withLayerBusy", () => {
  const spy = () => {
    const calls: Array<[string, boolean]> = [];
    return {
      calls,
      setBusy: (layer: string, busy: boolean) => {
        calls.push([layer, busy]);
      },
    };
  };

  it("marks the switch busy for the duration and clears it on success", async () => {
    const toggles = spy();
    await withLayerBusy(toggles, "cells", () => Promise.resolve());
    expect(toggles.calls).toEqual([
      ["cells", true],
      ["cells", false],
    ]);
  });

  it("clears it when the action REJECTS, so the control is never stranded", async () => {
    const toggles = spy();
    await expect(
      withLayerBusy(toggles, "cells", () =>
        Promise.reject(new Error("worker died")),
      ),
    ).rejects.toThrow("worker died");

    // The rejection PROPAGATES — swallowing it would hide a dead worker — and
    // the switch still comes back.
    expect(toggles.calls).toEqual([
      ["cells", true],
      ["cells", false],
    ]);
  });

  describe("more than one layer at a time", () => {
    // WHY THIS MATTERS (#256). `underground` joined `cells` as a data-gated
    // layer, and the call site still named `"cells"` literally — so clicking
    // the underground switch disabled the CELLS checkbox for ~1.9 s and gave
    // the clicked switch no feedback at all. The e2e passed throughout: it
    // asserts a busy state appears, not that it appears on the right control.
    // That is exactly the gap a unit test closes.
    it("marks every layer in the list, and clears every one", async () => {
      const toggles = spy();
      await withLayerBusy(toggles, ["cells", "underground"], () =>
        Promise.resolve(),
      );
      expect(toggles.calls).toEqual([
        ["cells", true],
        ["underground", true],
        ["cells", false],
        ["underground", false],
      ]);
    });

    it("marks the underground switch when only underground needs data", async () => {
      // The regression stated directly: the layer that needs the fetch is the
      // layer that spins, and no other one is touched.
      const toggles = spy();
      await withLayerBusy(toggles, ["underground"], () => Promise.resolve());
      expect(toggles.calls).toEqual([
        ["underground", true],
        ["underground", false],
      ]);
    });

    it("clears them all when the action rejects", async () => {
      const toggles = spy();
      await expect(
        withLayerBusy(toggles, ["cells", "underground"], () =>
          Promise.reject(new Error("worker died")),
        ),
      ).rejects.toThrow("worker died");

      // Neither switch is stranded — a `finally` that only covered the first
      // would leave the second disabled forever.
      expect(toggles.calls).toEqual([
        ["cells", true],
        ["underground", true],
        ["cells", false],
        ["underground", false],
      ]);
    });

    it("touches nothing when the list is empty", async () => {
      // `layersNeedingData` returns `[]` in the common case, and the caller
      // guards on length — but a helper that spun something for an empty list
      // would be a bug waiting for that guard to be relaxed.
      const toggles = spy();
      await withLayerBusy(toggles, [], () => Promise.resolve());
      expect(toggles.calls).toEqual([]);
    });
  });
});

describe("the side-effect note on a layer that does more than its name says", () => {
  /**
   * WHY THIS MATTERS. DEC-S1 accepted, in writing, that the marker set is not
   * independent of the layer set: switching `landuse` on makes pool, pitch and
   * parking markers disappear, because the area it draws already says what they
   * say. The decision recorded that as a cost rather than a mystery, and the
   * toggle is the only place a user ever meets it.
   *
   * A tooltip is the smallest honest thing. What this pins is that the note
   * exists on the layer with the coupling and NOT on the layers without it — a
   * note on everything would be noise, and a note on nothing would be the
   * silence the decision said to avoid.
   */
  it("marks `plates`, and only `plates`", () => {
    const container = document.createElement("div");
    attachLayerToggles({ container, onChange: () => {} });
    const noteFor = (layer: string): string =>
      (
        container.querySelector(`#layer-${layer}`)?.parentElement as
          | HTMLElement
          | undefined
      )?.title ?? "";
    expect(noteFor("plates")).toMatch(/pool, pitch and parking/);
    for (const layer of ["buildings", "trees", "roads", "poi", "cells"]) {
      expect(noteFor(layer)).toBe("");
    }
  });
});

describe("the switch inventory attachLayerToggles builds", () => {
  /**
   * WHY THESE TESTS MATTER, AND WHY THEY ARE NOT AN E2E (DEC-S3, 2026-08-07).
   *
   * "Every layer has exactly one switch, uniquely addressable, in the right
   * group" is a claim about DOM this module CONSTRUCTS. It asserts nothing about
   * what a browser painted, so it does not need one — and as an e2e it cost a
   * full boot: `stubNetwork` -> `goto` -> three progressive scoring rings, ~4.8 s
   * uncontended, to read checkbox ids.
   *
   * THE IDS ARE A PUBLISHED CONTRACT. `layer-toggles.ts` says so in a comment:
   * the suite addresses each switch as `#layer-<id>`, and the grouping work had
   * to move the elements without renaming any of them. A contract with no test
   * is a comment, so this is the test.
   *
   * What deliberately STAYS in the browser: that a collapsed header actually
   * hides the world and diagnostics groups. That is CSS resolving
   * `header[data-collapsed="true"] { display: none }`, i.e. rendering, and
   * asserting the attribute here instead would be the same
   * presenter-checks-its-own-output blindness the e2e suite exists to catch.
   */
  // The body is cleared between tests, and that is load-bearing rather than
  // tidiness: these switches carry IDS, so a container left behind by the
  // previous test puts a second `#layer-cells` in the document. jsdom resolves
  // an `#id` selector through the document's id map and then checks containment,
  // so the stale one wins the lookup and `container.querySelector` returns null
  // — which is exactly how this suite first failed.
  beforeEach(() => {
    document.body.replaceChildren();
  });

  const attach = () => {
    const container = document.createElement("div");
    document.body.append(container);
    const toggles = attachLayerToggles({ container, onChange: () => {} });
    return { container, toggles };
  };

  it("gives every layer exactly one switch", () => {
    const { container } = attach();
    const inputs = [
      ...container.querySelectorAll<HTMLInputElement>(
        "input[type=checkbox][data-layer]",
      ),
    ];

    // Against ALL_LAYERS rather than a hard-coded count, so adding a layer
    // without a switch fails here instead of being noticed on screen.
    expect(inputs.map((i) => i.dataset["layer"]).sort()).toEqual(
      [...ALL_LAYERS].sort(),
    );
  });

  it("addresses each switch by the `#layer-<id>` the suite depends on", () => {
    const { container } = attach();

    for (const layer of ALL_LAYERS) {
      const input = container.querySelector(`#layer-${layer}`);
      expect(input, `#layer-${layer} must exist`).not.toBeNull();
      expect(input).toBeInstanceOf(HTMLInputElement);
    }
  });

  it("gives every switch a UNIQUE id", () => {
    // The half a per-layer lookup cannot catch: two inputs sharing an id still
    // answer `querySelector`, and every locator in the suite would then silently
    // address the first one.
    const { container } = attach();
    const ids = [
      ...container.querySelectorAll<HTMLInputElement>("input[data-layer]"),
    ].map((i) => i.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("puts every switch inside a named group box", () => {
    // The grouping is the reason the ids had to be preserved, so it is asserted
    // alongside them: a switch outside a `layer-group-*` box is one the
    // collapsed header's CSS cannot reach.
    const { container } = attach();

    for (const layer of ALL_LAYERS) {
      const input = container.querySelector(`#layer-${layer}`);
      const box = input?.closest(".layer-group");
      expect(box, `#layer-${layer} must sit in a .layer-group`).toBeTruthy();
      expect(box?.id).toMatch(/^layer-group-/);
    }
  });
});
