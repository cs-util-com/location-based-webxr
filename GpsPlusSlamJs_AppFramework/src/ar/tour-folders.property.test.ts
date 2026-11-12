/**
 * Why this test matters: with plain folders a block may sit at any depth,
 * and every walker over a station must agree on which blocks it reaches.
 * The oracle here is the generator's own record of where it put each id,
 * never the walkers themselves: the walkers that descend (every block,
 * every free block, every id, a child's place) must return exactly the
 * recorded set, and the ones that must NOT descend (the stories and their
 * blocks - the story picker and the scene player read only these) must
 * return exactly the top-level set. The list also reads back exactly and
 * round-trips through JSON, at three sizes, so the writer keeps nested
 * folders, poses and scales as read.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  TOUR_ARBITRARY_ASSETS,
  tourStationChildrenPlacedArbitrary,
} from '../test-utils/tour-arbitraries';
import { parseTourAssets } from './tour-assets';
import { tourFreeBlocks } from './tour-station-pose';
import {
  isStory,
  parseTourStationChildren,
  tourChildrenBlocks,
  tourChildrenPlace,
  tourStationChildIds,
  tourStationStoryBlocks,
  tourStories,
  type TourStationChild,
  type TourStoryChild,
} from './tour-story';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const ASSETS = parseTourAssets(
  TOUR_ARBITRARY_ASSETS.map((a) => ({ ...a })),
  { fail }
);

const read = (list: unknown): TourStationChild[] =>
  parseTourStationChildren(list, 'children', { assets: ASSETS, fail }).children;

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const sorted = (ids: readonly string[]): string[] => [...ids].sort();

// Swept: few folders (mostly flat), some, and many (deep nests).
const SIZES = [
  { maxStories: 2, maxFreeBlocks: 3, maxStoryChildren: 2, maxFolders: 1 },
  { maxStories: 3, maxFreeBlocks: 6, maxStoryChildren: 3, maxFolders: 3 },
  { maxStories: 2, maxFreeBlocks: 10, maxStoryChildren: 2, maxFolders: 8 },
];

describe('stations with plain folders (properties)', () => {
  for (const size of SIZES) {
    it(`every walker returns exactly what the generator placed (up to ${String(size.maxFolders)} folders)`, () => {
      let nested = 0;
      fc.assert(
        fc.property(
          tourStationChildrenPlacedArbitrary(size),
          ({ children, placed }) => {
            const list = read(children);
            // Read exactly, and written back as read.
            expect(list).toEqual(children);
            expect(read(copy(list))).toEqual(list);
            const station = { children: list };
            if (placed.folderBlocks.length > 0) nested++;

            // The walkers that descend.
            expect(sorted(tourChildrenBlocks(list).map((b) => b.id))).toEqual(
              sorted([
                ...placed.topBlocks,
                ...placed.folderBlocks,
                ...placed.storyBlocks,
              ])
            );
            expect(sorted(tourFreeBlocks(station).map((b) => b.id))).toEqual(
              sorted([...placed.topBlocks, ...placed.folderBlocks])
            );
            expect(sorted(tourStationChildIds(station))).toEqual(
              sorted(placed.all)
            );
            for (const id of placed.all) {
              const place = tourChildrenPlace(list, id);
              const inner = place?.path[place.path.length - 1];
              const holder: readonly (TourStationChild | TourStoryChild)[] =
                inner === undefined ? list : inner.children;
              expect(place === null ? null : holder[place.index]?.id).toBe(id);
              // A story is only ever the innermost container, never one a
              // folder leads into.
              expect(place?.path.slice(0, -1).some(isStory)).toBe(false);
            }

            // The walkers that must not descend into folders.
            expect(tourStories(station).map((s) => s.id)).toEqual(
              list.filter(isStory).map((s) => s.id)
            );
            expect(sorted(tourStories(station).map((s) => s.id))).toEqual(
              sorted(placed.stories)
            );
            expect(
              sorted(tourStationStoryBlocks(station).map((b) => b.id))
            ).toEqual(sorted(placed.storyBlocks));
          }
        ),
        { numRuns: 150 }
      );
      // The property met folders holding blocks, not only empty ones.
      expect(nested).toBeGreaterThan(0);
    });
  }
});
