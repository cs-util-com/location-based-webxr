// Repo-meta test: the city-load measurement script names the same tile host
// as the Osm library.
//
// WHY. `GpsPlusSlamJs_DesignSystem/measure-city-load.mjs` sorts a page's
// requests into tile host, Overpass and elevation by host name. It is a plain
// Node script in a package that does not depend on the Osm library, and the
// library's constant lives in TypeScript whose imports name `.js` files, so
// the script cannot import `OSM_TILES_BASE_URL` and keeps a hand copy of its
// host. If the host moved and the copy did not, the script would count every
// tile-host request as "other" and report a city load that never asked the
// host, with nothing failing. The two packages are unrelated in the package
// graph, so no package gate sees both files; this root guard does.
//
// WHAT IT CANNOT DO: it compares the two spellings it knows. A third hand
// copy elsewhere is not looked for.

import { describe, expect, it } from 'vitest';

import { readTracked } from './tracked-tree.js';

const LIBRARY = 'GpsPlusSlamJs_Osm/src/source/static-tile-source.ts';
const SCRIPT = 'GpsPlusSlamJs_DesignSystem/measure-city-load.mjs';

describe('the tile host name in the city-load script', () => {
  it('is the host of the Osm library\'s OSM_TILES_BASE_URL', () => {
    const base = readTracked(LIBRARY).match(
      /export const OSM_TILES_BASE_URL = "([^"]+)";/
    );
    const copy = readTracked(SCRIPT).match(/const TILE_HOST = "([^"]+)";/);
    // Both matchers must find their line, or the comparison is vacuous.
    expect(base, `${LIBRARY} no longer defines OSM_TILES_BASE_URL`).not.toBeNull();
    expect(copy, `${SCRIPT} no longer defines TILE_HOST`).not.toBeNull();
    expect(copy?.[1]).toBe(new URL(base?.[1] ?? 'invalid:').hostname);
  });
});
