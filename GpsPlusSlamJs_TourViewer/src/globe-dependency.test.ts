/**
 * Why these tests matter: the 3D editor imports the globe's building blocks
 * into this Vite app, and until now the globe package was served without a
 * build to the design system's lab only: no `exports`, never resolved by
 * Vite as a dependency, never built into an app's bundle. They pin that:
 * - the package resolves by its name (`gps-plus-slam-globe/editor`)
 *   through Vite's resolver (vitest's) and TypeScript's (this file is
 *   type-checked under the app's compiler options), and its code runs;
 * - a production Vite build of an entry that imports the editor blocks
 *   succeeds and holds ONE three (two copies would make the globe's meshes
 *   foreign to the app's scene: `instanceof` checks fail and two renderers'
 *   state diverges).
 *
 * The licences of what that build bundles (3d-tiles-renderer's Apache 2.0
 * text, its patched copy declared) are held, with every other package the
 * app bundles, by `third-party-licenses.test.ts`.
 */
import { GROUND_HIT, groundReachM } from "gps-plus-slam-globe/editor";
import { describe, expect, it } from "vitest";

import {
  globeEntryModuleIds,
  packageOf,
} from "./test-support/bundled-packages.js";

describe("the globe package as a dependency of this Vite app", () => {
  it("resolves by its name and runs", () => {
    expect(groundReachM(1.7)).toBe(GROUND_HIT.maxDistanceM);
    expect(groundReachM(3_000) / 1000).toBeCloseTo(195.5, 0);
  });

  it("builds with one three, the globe's own source and its tile renderer in the bundle", async () => {
    const ids = await globeEntryModuleIds();
    // The globe's own source is in the build, through the package link.
    expect(
      ids.some((id) => id.endsWith("GpsPlusSlamJs_Globe/src/globe-editor.ts")),
    ).toBe(true);
    // One three: every three module from one installed copy.
    const threeDirs = new Set(
      ids
        .filter((id) => packageOf(id) === "three")
        .map((id) => id.replace(/\/node_modules\/three\/.*$/, "")),
    );
    expect([...threeDirs]).toHaveLength(1);
    expect(ids.some((id) => packageOf(id) === "3d-tiles-renderer")).toBe(true);
  }, 120_000);
});
