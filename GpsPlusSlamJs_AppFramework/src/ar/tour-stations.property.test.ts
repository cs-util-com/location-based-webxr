/**
 * Why this test matters: the creator's phone writes stations and the
 * visitor's phone reads them, different builds days apart. Three
 * properties make that safe beyond the hand-written examples: every
 * well-formed set of assets and stations survives a JSON round trip
 * unchanged (so a parsed tour can be written back without drift); breaking
 * any ONE reference - an asset a block names, a child a choice jumps to -
 * is refused rather than reaching a renderer as a dangling id; and a file
 * of a newer minor, whatever closed-list value it adds, is read without
 * failing and leaves only references that resolve.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  TOUR_ARBITRARY_ASSETS,
  tourManifestArbitrary,
} from '../test-utils/tour-arbitraries';
import { parseTourAssets } from './tour-assets';
import { TOUR_FREE_BLOCK_VIEWS } from './tour-blocks';
import { parseTourStations } from './tour-stations';
import {
  isTourStoryBlock,
  tourChildrenFreeBlocks,
  tourStationBlocks,
  tourStories,
} from './tour-story';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

type Json = Record<string, unknown>;
type StationJson = Json & { children: Json[] };

/** One to four generated stations (their free blocks and stories). */
const stations = tourManifestArbitrary().map(
  (record) => record.stations as StationJson[]
);

const ASSETS = TOUR_ARBITRARY_ASSETS.map((a) => ({ ...a }));

function parseAll(data: unknown) {
  return parseTourStations(data, {
    assets: parseTourAssets(ASSETS, { fail }),
    fail,
  });
}

const storiesOf = (station: StationJson): Json[] =>
  station.children.filter((c) => c.kind === 'story');
const kidsOf = (story: Json): Json[] => story.children as Json[];
const isBlockRecord = (c: Json): boolean =>
  !['choice', 'quiz', 'story'].includes(c.kind as string);
/** Every block record of a station, free and in stories. */
const blocksOf = (station: StationJson): Json[] =>
  station.children.flatMap((c) =>
    c.kind === 'story' ? kidsOf(c).filter(isBlockRecord) : [c]
  );

/** The fields of a block that name an asset. */
const MEDIA_FIELDS = ['image', 'video', 'audio', 'asset', 'voice', 'poster'];

/** Replace one value of a closed list somewhere in `data` (picked by
 *  `pick`) with a value no reader knows. */
function injectUnknown(data: StationJson[], pick: number): void {
  const sites: (() => void)[] = [];
  for (const station of data) {
    sites.push(() => {
      station.hint = 'compass';
    });
    for (const block of blocksOf(station)) {
      sites.push(() => {
        block.kind = 'hologram';
      });
      for (const field of MEDIA_FIELDS) {
        if (typeof block[field] === 'string') {
          sites.push(() => {
            block[field] = 'splat';
          });
        }
      }
    }
    for (const kid of storiesOf(station).flatMap(kidsOf)) {
      if (isBlockRecord(kid)) {
        sites.push(() => {
          kid.advance = { mode: 'gaze' };
        });
        continue;
      }
      sites.push(() => {
        kid.kind = 'hologram';
      });
      if (kid.kind === 'quiz') {
        sites.push(() => {
          (kid.answer as Json).type = 'map-pick';
        });
      }
    }
  }
  sites[pick % sites.length]!();
}

// One generation for the four claims (each used to draw its own 150-200
// station sets); each claim works on its own deep copy. The two claims that
// need a site (a media field, a choice) skip a run without one and
// count the runs they checked, so the merged property cannot quietly test
// nothing (the old fc.pre discarded the whole run instead).
const RUNS = 200;
/** Each conditional claim must have checked at least this many of RUNS. */
const MIN_CHECKED = 50;

describe('tour stations (properties)', () => {
  // Why the newer-minor claim matters: a file of a newer minor may use any
  // value a later app adds to a closed list. With the lenient flag the parse
  // must never fail on one, and every reference that survives must still
  // resolve - the renderer's promise that it never meets a dangling id.
  // Without the flag (this reader's own minor) the same file is refused.
  const assetsWithUnknown = [
    ...ASSETS,
    { id: 'splat', path: 'content/splat.splat' },
  ];
  it('round trip unchanged; an unknown value of a newer minor: lenient never fails and what survives resolves, strict refuses; any one broken asset reference or choice target is refused', () => {
    let assetBreaks = 0;
    let choiceBreaks = 0;
    fc.assert(
      fc.property(
        stations,
        fc.nat(),
        fc.stringMatching(/^[a-z]{3,8}$/),
        (data, pick, ghost) => {
          const copyOf = () =>
            JSON.parse(JSON.stringify(data)) as StationJson[];

          // Every well-formed station set survives a JSON round trip.
          const parsedOnce = parseAll(data);
          expect(
            parseAll(JSON.parse(JSON.stringify(parsedOnce))),
            'a JSON round trip changes nothing'
          ).toEqual(parsedOnce);

          // Unknown values of a newer minor.
          const copy = copyOf();
          injectUnknown(copy, pick);
          const assets = parseTourAssets(assetsWithUnknown, {
            fail,
            lenient: true,
          });
          expect(assets.map((a) => a.id)).not.toContain('splat');
          const parsed = parseTourStations(copy, {
            assets,
            fail,
            lenient: true,
          });
          const assetIds = new Set(assets.map((a) => a.id));
          for (const station of parsed) {
            expect(station.hint).toBe('arrow');
            for (const block of tourStationBlocks(station)) {
              const refs = MEDIA_FIELDS.flatMap((f) => {
                const v = (block as unknown as Json)[f];
                return typeof v === 'string' ? [v] : [];
              });
              expect(refs.every((r) => assetIds.has(r))).toBe(true);
            }
            // A free block stands in a view its kind may stand in free.
            expect(
              tourChildrenFreeBlocks(station.children).every((b) =>
                (TOUR_FREE_BLOCK_VIEWS[b.kind] as readonly string[]).includes(
                  b.view
                )
              )
            ).toBe(true);
            for (const story of tourStories(station)) {
              const ids = new Set(story.children.map((c) => c.id));
              expect(
                story.children
                  .filter(isTourStoryBlock)
                  .every((b) =>
                    ['tap', 'auto', 'lineEnd'].includes(b.advance.mode)
                  )
              ).toBe(true);
              for (const child of story.children) {
                if (child.kind !== 'choice') continue;
                expect(child.options.length).toBeGreaterThanOrEqual(2);
                expect(
                  child.options.every(
                    (o) => o.goto === undefined || ids.has(o.goto)
                  )
                ).toBe(true);
              }
            }
          }
          expect(() => parseAll(copy), 'strict refuses').toThrow(Invalid);

          // Breaking any one asset reference, or a choice target, is refused.
          assetBreaks += Number(refusesABrokenAsset(data, pick));
          choiceBreaks += Number(refusesAChoiceToNoChild(data, ghost));
        }
      ),
      { numRuns: RUNS }
    );
    expect(
      assetBreaks,
      'runs with an asset reference to break'
    ).toBeGreaterThanOrEqual(MIN_CHECKED);
    expect(choiceBreaks, 'runs with a choice to break').toBeGreaterThanOrEqual(
      MIN_CHECKED
    );
  });
});

/**
 * Breaks one asset reference of a copy of `data` and expects the parse to
 * refuse it; false (nothing checked) when no block has a media field.
 */
function refusesABrokenAsset(
  data: readonly StationJson[],
  pick: number
): boolean {
  const broken = JSON.parse(JSON.stringify(data)) as StationJson[];
  const sites = broken.flatMap((s) =>
    blocksOf(s).flatMap((block) =>
      MEDIA_FIELDS.filter((f) => typeof block[f] === 'string').map(
        (f) => () => {
          block[f] = 'missing';
        }
      )
    )
  );
  if (sites.length === 0) return false;
  sites[pick % sites.length]!();
  expect(() => parseAll(broken), 'a broken asset reference').toThrow(Invalid);
  return true;
}

/**
 * Points the first choice of a copy of `data` at the step `ghost` and
 * expects the parse to refuse it; false (nothing checked) when no station
 * has a choice or `ghost` happens to name one of its steps.
 */
function refusesAChoiceToNoChild(
  data: readonly StationJson[],
  ghost: string
): boolean {
  const jumped = JSON.parse(JSON.stringify(data)) as StationJson[];
  const story = jumped
    .flatMap(storiesOf)
    .find((s) => kidsOf(s).some((c) => c.kind === 'choice'));
  if (story === undefined || kidsOf(story).some((c) => c.id === ghost)) {
    return false;
  }
  const choice = kidsOf(story).find((c) => c.kind === 'choice') as unknown as {
    options: { goto?: string }[];
  };
  choice.options[0]!.goto = ghost;
  expect(() => parseAll(jumped), 'a choice to no child').toThrow(
    /must name a child of this story/
  );
  return true;
}
