/**
 * The globe lab's city worker asks the project's tile host first.
 *
 * Why this file matters: the lab's no-build worker keeps its own copy of the
 * Globe package's worker protocol, so the host the Tour Editor's shell
 * passes to the Globe core (`staticTilesBaseUrl`) does not reach it by
 * itself. Without the library's `staticTiles` option every lab city goes
 * straight to the donated Overpass servers. The worker runs only in a
 * browser, and it imports the Osm library by its package name (built
 * `dist`, which this package's gate does not build), so this test checks
 * its source: the base URL is the library's own constant, not a copied
 * string, and it reaches the tile source. That the host is then asked
 * before the race is the library's contract (`StaticTileSource`), shown
 * through the Tour Editor's shell in its unit test and here by the smoke
 * helpers' order check (`routeCityFixture`'s `order`).
 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// By path, not `new URL(...)`: knip reads a URL beside import.meta.url as an
// import and would then trace the worker's page-only paths as unresolved.
const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "globe-city-worker.js"), "utf8");

describe("the globe lab's city worker and the tile host", () => {
  it("takes the host's base URL from the Osm library", () => {
    const fromOsm = source.match(/import \{([^}]*)\} from "osm-h3";/);
    assert.ok(fromOsm, "the worker imports the Osm library");
    assert.match(fromOsm[1], /\bOSM_TILES_BASE_URL\b/);
    assert.doesNotMatch(source, /osm-tiles\.[a-z]+\.workers\.dev/);
  });

  it("hands it to the city tile source as the library's staticTiles option", () => {
    const calls = [...source.matchAll(/createCityTileSource\(([^)]*)\)/g)];
    assert.equal(calls.length, 1, "one tile source");
    assert.match(calls[0][1], /staticTiles: \{ baseUrl: OSM_TILES_BASE_URL \}/);
  });
});
