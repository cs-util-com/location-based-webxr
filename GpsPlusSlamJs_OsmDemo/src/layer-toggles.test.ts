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
});
