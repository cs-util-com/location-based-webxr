/**
 * Why this test matters: the shim casts an untyped runtime export to a local
 * interface. If a 3d-tiles-renderer upgrade renames or drops the export, or
 * changes the constructor's defaults, the globe breaks at runtime only, on a
 * phone. This pins, under Node, that the export exists, constructs with the
 * options the globe uses, and keeps the defaults the design relies on.
 */

import { XYZTilesOverlay } from "3d-tiles-renderer/plugins";
import { describe, expect, it } from "vitest";

import { GeneratedSurfacePlugin } from "./generated-surface-plugin.js";

describe("GeneratedSurfacePlugin (shim)", () => {
  it("is the library runtime constructor", () => {
    expect(typeof GeneratedSurfacePlugin).toBe("function");
  });

  it("draws on the ellipsoid by default and keeps the overlay it is given", () => {
    const overlay = new XYZTilesOverlay({
      url: "/globe-assets/none/{z}/{x}/{y}.jpg",
      projection: "EPSG:4326",
      levels: 1,
    });
    const plugin = new GeneratedSurfacePlugin({
      overlay,
      applyOverlayTexture: false,
    });
    expect(plugin.projection).toBe("ellipsoid");
    expect(plugin.overlay).toBe(overlay);
  });
});
