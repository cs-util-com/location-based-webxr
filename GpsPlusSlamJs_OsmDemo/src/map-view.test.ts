// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

/**
 * Why this test matters (PR #365 review): `animate: false` on the two
 * programmatic pans IS the settle-flake bug fix — Leaflet's ~250 ms
 * animated pan overwrites the ResizeObserver's `invalidateSize`
 * compensation when a resize lands inside the window, parking the pan
 * target half the resize delta off centre permanently. The only other
 * thing that catches a revert is the e2e settle poll, i.e. the flaky
 * assertion the fix un-flakes: the defect reproduced in 11 of 30 soak
 * runs, so a revert would pass CI most of the time. This pins the option
 * deterministically.
 *
 * Leaflet is replaced by a recording proxy: every property is another
 * proxy, every call is recorded with its path — enough to construct the
 * real MapView (whose constructor chains maps, layers, controls and
 * markers) without a browser, while `getZoom` returns a real number so
 * the recorded `setView` arguments are assertable values.
 */

const calls: { path: string; args: unknown[] }[] = [];

function leafletStub(path: string): unknown {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (typeof prop === "symbol" || prop === "then") return undefined;
      if (prop === "getZoom") return () => 18;
      return leafletStub(`${path}.${String(prop)}`);
    },
    apply(_target, _thisArg, args: unknown[]) {
      calls.push({ path, args });
      return leafletStub(path);
    },
    construct() {
      return leafletStub(`${path}.new`) as object;
    },
  });
}

vi.mock("leaflet", () => ({ default: leafletStub("L") }));

import { MapView } from "./map-view";

function buildView(): MapView {
  return new MapView({
    container: document.createElement("div"),
    centre: { lat: 0, lng: 0 },
  });
}

function setViewCalls(): { path: string; args: unknown[] }[] {
  return calls.filter((c) => c.path.endsWith("setView"));
}

describe("MapView programmatic pans", () => {
  it("panTo pans WITHOUT animation — the animation window is what lost the resize correction", () => {
    const view = buildView();
    calls.length = 0;

    view.panTo({ lat: 1, lng: 2 });

    expect(setViewCalls()).toContainEqual(
      expect.objectContaining({ args: [[1, 2], 18, { animate: false }] }),
    );
  });

  it("centreOn pans WITHOUT animation, for the same reason", () => {
    const view = buildView();
    calls.length = 0;

    view.centreOn({ lat: 3, lng: 4 });

    expect(setViewCalls()).toContainEqual(
      expect.objectContaining({ args: [[3, 4], 18, { animate: false }] }),
    );
  });
});
