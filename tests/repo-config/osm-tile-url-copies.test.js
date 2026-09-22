// Repo-meta test: the OSM raster tile URL is written down exactly once.
//
// WHY IT NEEDED A GUARD. Until 2026-09-22 there were THREE copies and two of
// them disagreed:
//
//   - `RecorderApp/src/ui/map-osm-base.ts` — `https://{s}.tile.openstreetmap.org/…`
//   - `OsmDemo/src/map-view.ts` — `https://tile.openstreetmap.org/…`
//   - `AppFramework/src/visualization/leaflet-map-overlay.ts` — the same, as an
//     option default.
//
// The `{s}` form is subdomain sharding, which HTTP/2 made pointless and the OSM
// tile usage policy now discourages. So this was not three copies of one
// string: it was a live behavioural divergence that nothing could see, because
// each copy is correct in isolation and the maps all render.
//
// It is the exact shape root `CLAUDE.md` calls out — "shared BEHAVIOUR is
// unified, wherever it lives" — and the exact shape `check:dup` cannot find:
// jscpd runs per package, so it never compares two of them, and a URL literal
// is far under its 50-token floor. `duplicate-helpers.test.js` cannot find it
// either, because that guard is keyed on NAMES and this was an inline string in
// two of the three places.
//
// WHAT IT CHECKS. That `openstreetmap.org` tile-URL templates appear in exactly
// one source file — the framework's `utils/osm-tiles.ts` — so a fourth consumer
// has to import rather than paste. Deliberately a LOCATION check rather than a
// string-equality check between known copies: the failure this guards against
// is a NEW copy appearing, and a guard over a hand-listed pair cannot see one.
//
// WHAT IT CANNOT DO:
//
//  - **It sees one workspace root**, like every guard in this folder. The core
//    library is in the other repo. It happens to have no tile URL today; that
//    is a fact about today, not something this enforces.
//  - **It matches the HOST, not the template.** A copy pointing at a different
//    tile provider is invisible to it, and reasonably so — that is a decision,
//    not a duplicate.
//  - **It cannot see a URL assembled from parts.** `'https://' + host + '/{z}…'`
//    passes. Nobody has written one; if anyone does, this is the file to widen.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The one file allowed to spell the tile URL out. */
const CANONICAL = 'GpsPlusSlamJs_AppFramework/src/utils/osm-tiles.ts';

const SOURCE_PATTERN = /^[^/]+\/(src|config|scripts)\/.*\.(ts|tsx|js|mjs|cjs)$/;

function trackedSourceFiles() {
  return execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean)
    .filter((file) => SOURCE_PATTERN.test(file))
    .filter((file) => !file.endsWith('.d.ts'));
}

/**
 * Whether `source` contains an OSM raster tile URL template.
 *
 * Exported so the matcher has its own tests — otherwise a green run cannot be
 * told apart from a matcher that matches nothing, which is the failure mode
 * every guard in this folder is written to avoid.
 *
 * The `{s}.` is optional on purpose: BOTH spellings must be caught, since
 * catching only the modern one would let the deprecated form come back.
 */
export function hasOsmTileUrl(source) {
  return /https:\/\/(\{s\}\.)?tile\.openstreetmap\.org\/\{z\}/.test(source);
}

describe('OSM tile URL', () => {
  describe('hasOsmTileUrl', () => {
    it('matches the modern subdomain-free template', () => {
      expect(hasOsmTileUrl("'https://tile.openstreetmap.org/{z}/{x}/{y}.png'")).toBe(
        true
      );
    });

    it('matches the deprecated {s} sharding template too', () => {
      // The one this guard exists for. A matcher that missed it would let the
      // divergence it was written to remove come straight back.
      expect(
        hasOsmTileUrl("'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'")
      ).toBe(true);
    });

    it('does not match an ordinary OSM link', () => {
      // The attribution anchor href is on nearly every map file in the repo.
      // Matching it would make this guard fire everywhere and get deleted.
      expect(
        hasOsmTileUrl('https://www.openstreetmap.org/copyright')
      ).toBe(false);
    });
  });

  it('is written down in exactly one source file', () => {
    const offenders = trackedSourceFiles().filter((file) => {
      if (file === CANONICAL) return false;
      try {
        return hasOsmTileUrl(readFileSync(resolve(repoRoot, file), 'utf8'));
      } catch {
        return false; // tracked but deleted in the working tree
      }
    });

    expect(
      offenders,
      offenders.length === 0
        ? ''
        : [
            'The OSM tile URL is duplicated. Import it from the framework instead:',
            '',
            "  import { OSM_TILE_URL, OSM_TILE_ATTRIBUTION, OSM_TILE_MAX_ZOOM }",
            "    from 'gps-plus-slam-app-framework/utils/osm-tiles';",
            '',
            'A package that genuinely cannot depend on the framework keeps its own',
            'copy and is added to this guard as a named exception, with the reason.',
            '',
            ...offenders,
          ].join('\n')
    ).toEqual([]);
  });

  it('the canonical file really does define it', () => {
    // Without this, deleting `osm-tiles.ts` would make the guard above pass
    // vacuously — zero copies is not the same as one home.
    expect(hasOsmTileUrl(readFileSync(resolve(repoRoot, CANONICAL), 'utf8'))).toBe(
      true
    );
  });
});
