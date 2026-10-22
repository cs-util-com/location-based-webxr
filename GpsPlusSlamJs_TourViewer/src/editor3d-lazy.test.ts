/**
 * The 3D view's code loads only when it is asked for.
 *
 * Why this test matters: the 3D editor brings the globe's relief, the 3D
 * tiles renderer and the geoid (the geoid's table alone is about 170 KB).
 * A visitor scanning a printed code must never download any of it, and the
 * desktop editor's map page must not wait for it either: the view switch
 * imports it at the click. One static import anywhere on a page's module
 * graph would put it into that page's bundle silently, and every other
 * test would still pass. So a production build of the app is read here:
 * for every page, the modules it loads before any `import()` runs hold
 * none of the globe, the tile renderer, the elevation package or the 3D
 * view's own modules - and the editor's page does reach them through
 * `import()`, which proves the test can see them at all. The import
 * fences beside it (`editor-only-packages.test.ts`, the dependency rules
 * in `config/.dependency-cruiser.cjs`) hold the source; this holds the
 * bundle the browser gets.
 */
import { existsSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import {
  appChunks,
  staticClosure,
  type BuiltChunk,
} from "./test-support/bundled-packages.js";

/** What only the 3D view may load: the globe (the workspace package's
 *  source), its tile renderer, the elevation package and the view's own
 *  modules. */
const THREE_D_ONLY: readonly [string, RegExp][] = [
  ["the globe", /\/GpsPlusSlamJs_Globe\/|\/gps-plus-slam-globe\//],
  ["the 3D tiles renderer", /\/node_modules\/3d-tiles-renderer\//],
  ["the elevation package", /\/GpsPlusSlamJs_Osm\/|\/gps-plus-slam-osm\//],
  ["the 3D view", /\/src\/editor3d\//],
];

/** The pages with a script of their own (`legal.html` has none: it loads
 *  no module at all). */
const PAGES = ["main", "edit", "writeProbe"];

describe("the 3D view's code in the app's bundle", () => {
  let chunks: BuiltChunk[];

  beforeAll(async () => {
    chunks = await appChunks();
  }, 180_000);

  it.each(PAGES)(
    "is not loaded by the %s page before an import() runs",
    (page) => {
      const loaded = [...staticClosure(chunks, page)];
      for (const [what, pattern] of THREE_D_ONLY) {
        expect(
          loaded.filter((id) => pattern.test(id)),
          `${page} loads ${what}`,
        ).toEqual([]);
      }
    },
  );

  it("is reached from the editor's page by import(), the geoid with it", () => {
    const edit = chunks.find((c) => c.entry === "edit");
    expect(edit).toBeDefined();
    // Everything the build holds, the lazy chunks included.
    const all = chunks.flatMap((c) => c.moduleIds);
    expect(
      all.some((id) => id.endsWith("/src/editor3d/editor3d-scene.ts")),
    ).toBe(true);
    expect(
      all.some((id) => /\/node_modules\/3d-tiles-renderer\//.test(id)),
    ).toBe(true);
    expect(all.some((id) => /elevation\/egm96/.test(id))).toBe(true);
    // The scene's chunk is a dynamic import of the editor's page.
    const scene = chunks.find((c) =>
      c.moduleIds.some((id) => id.endsWith("/src/editor3d/editor3d-scene.ts")),
    );
    expect(scene).toBeDefined();
    const reachedLazily = chunks.some((c) =>
      c.dynamicImports.includes(scene!.fileName),
    );
    expect(reachedLazily).toBe(true);
  });

  // Why: the globe's whole-Earth imagery (about 13 MB, served only by the
  // globe's own pages) must not reach this app in any chunk: the editor
  // draws a plain ground under the map.
  it("holds none of the globe's whole-Earth imagery", () => {
    // Its module is bundled (the relief's tile helpers live beside it), so
    // the code is read: the imagery's factory does not survive the build,
    // and nothing builds a tile overlay on its files. (The globe's source
    // registry - a table of names, paths and credits - does ride along:
    // the surface module reads it at load. Data, never a request.)
    expect(
      chunks
        .filter((c) => c.code.includes("createGlobeImagery"))
        .map((c) => c.fileName),
    ).toEqual([]);
    // And the check can see the 3D view's chunk at all.
    expect(chunks.some((c) => c.code.includes("plainImagery"))).toBe(true);
    // The files themselves are served only by the globe's own pages.
    expect(existsSync(new URL("../public/globe-assets", import.meta.url))).toBe(
      false,
    );
  });
});
