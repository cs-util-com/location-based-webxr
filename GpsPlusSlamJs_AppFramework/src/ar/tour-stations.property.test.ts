/**
 * Why this test matters: the creator's phone writes stations and the
 * visitor's phone reads them, different builds days apart. Three
 * properties make that safe beyond the hand-written examples: every
 * well-formed set of assets and stations survives a JSON round trip
 * unchanged (so a parsed tour can be written back without drift); breaking
 * any ONE reference - an asset a block names, a step a choice jumps to -
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
import { TOUR_WORLD_VIEWS } from './tour-blocks';
import { parseTourStations } from './tour-stations';
import { tourShownBlockIds } from './tour-story';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

type Json = Record<string, unknown>;
type StationJson = Json & { blocks: Json[]; steps: Json[] };

/** One to four generated stations (their blocks and stories). */
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
    for (const block of station.blocks) {
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
    for (const step of station.steps) {
      const action = step.action as Json;
      sites.push(() => {
        action.kind = 'hologram';
      });
      sites.push(() => {
        step.advance = { mode: 'gaze' };
      });
      if (action.kind === 'quiz') {
        sites.push(() => {
          (action.answer as Json).type = 'map-pick';
        });
      }
    }
  }
  sites[pick % sites.length]!();
}

describe('unknown values of a newer minor (properties)', () => {
  // Why this matters: a file of a newer minor may use any value a later
  // app adds to a closed list. With the lenient flag the parse must never
  // fail on one, and every reference that survives must still resolve -
  // the renderer's promise that it never meets a dangling id. Without the
  // flag (this reader's own minor) the same file is refused.
  const assetsWithUnknown = [
    ...ASSETS,
    { id: 'splat', path: 'content/splat.splat' },
  ];
  it('lenient: never fails, and what survives resolves; strict: refused', () => {
    fc.assert(
      fc.property(stations, fc.nat(), (data, pick) => {
        const copy = JSON.parse(JSON.stringify(data)) as StationJson[];
        injectUnknown(copy, pick);
        const assets = parseTourAssets(assetsWithUnknown, {
          fail,
          lenient: true,
        });
        expect(assets.map((a) => a.id)).not.toContain('splat');
        const parsed = parseTourStations(copy, { assets, fail, lenient: true });
        const assetIds = new Set(assets.map((a) => a.id));
        for (const station of parsed) {
          expect(station.hint).toBe('arrow');
          const stepIds = new Set(station.steps.map((s) => s.id));
          const blockIds = new Set(station.blocks.map((b) => b.id));
          const shown = tourShownBlockIds(station.steps);
          expect(
            station.steps.every((s) => ['tap', 'auto'].includes(s.advance.mode))
          ).toBe(true);
          expect([...shown].every((id) => blockIds.has(id))).toBe(true);
          for (const block of station.blocks) {
            const refs = MEDIA_FIELDS.flatMap((f) => {
              const v = (block as unknown as Json)[f];
              return typeof v === 'string' ? [v] : [];
            });
            expect(refs.every((r) => assetIds.has(r))).toBe(true);
            // A block no step shows stands in the world.
            expect(
              shown.has(block.id) || TOUR_WORLD_VIEWS.has(block.view)
            ).toBe(true);
          }
          for (const step of station.steps) {
            if (step.action.kind !== 'choice') continue;
            expect(step.action.options.length).toBeGreaterThanOrEqual(2);
            expect(
              step.action.options.every(
                (o) => o.goto === undefined || stepIds.has(o.goto)
              )
            ).toBe(true);
          }
        }
        expect(() => parseAll(copy)).toThrow(Invalid);
      }),
      { numRuns: 200 }
    );
  });
});

describe('tour stations (properties)', () => {
  it('every well-formed station set survives a JSON round trip unchanged', () => {
    fc.assert(
      fc.property(stations, (data) => {
        const parsed = parseAll(data);
        expect(parseAll(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
      }),
      { numRuns: 150 }
    );
  });

  it('breaking any one asset reference is refused', () => {
    fc.assert(
      fc.property(stations, fc.nat(), (data, pick) => {
        const copy = JSON.parse(JSON.stringify(data)) as StationJson[];
        const sites = copy.flatMap((s) =>
          s.blocks.flatMap((block) =>
            MEDIA_FIELDS.filter((f) => typeof block[f] === 'string').map(
              (f) => () => {
                block[f] = 'missing';
              }
            )
          )
        );
        fc.pre(sites.length > 0);
        sites[pick % sites.length]!();
        expect(() => parseAll(copy)).toThrow(Invalid);
      }),
      { numRuns: 150 }
    );
  });

  it('a choice jumping to a step that does not exist is refused', () => {
    fc.assert(
      fc.property(
        stations,
        fc.stringMatching(/^[a-z]{3,8}$/),
        (data, ghost) => {
          const copy = JSON.parse(JSON.stringify(data)) as StationJson[];
          const station = copy.find((s) =>
            s.steps.some((st) => (st.action as Json).kind === 'choice')
          );
          fc.pre(station !== undefined);
          fc.pre(!station.steps.some((st) => st.id === ghost));
          const choice = station.steps.find(
            (st) => (st.action as Json).kind === 'choice'
          )!.action as { options: { goto?: string }[] };
          choice.options[0]!.goto = ghost;
          expect(() => parseAll(copy)).toThrow(
            /must name a step of this station/
          );
        }
      ),
      { numRuns: 150 }
    );
  });
});
