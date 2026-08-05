import { describe, expect, it } from "vitest";

import { withLayerBusy } from "./layer-toggles.js";

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
