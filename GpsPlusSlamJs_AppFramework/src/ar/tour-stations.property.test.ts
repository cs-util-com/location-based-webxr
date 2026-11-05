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

// One generation for the four claims (each used to draw its own 150-200
// station sets); each claim works on its own deep copy. The two claims that
// need a site (a media field, a choice step) skip a run without one and
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
            const stepIds = new Set(station.steps.map((s) => s.id));
            const blockIds = new Set(station.blocks.map((b) => b.id));
            const shown = tourShownBlockIds(station.steps);
            expect(
              station.steps.every((s) =>
                ['tap', 'auto'].includes(s.advance.mode)
              )
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
          expect(() => parseAll(copy), 'strict refuses').toThrow(Invalid);

          // Breaking any one asset reference is refused.
          const broken = copyOf();
          const sites = broken.flatMap((s) =>
            s.blocks.flatMap((block) =>
              MEDIA_FIELDS.filter((f) => typeof block[f] === 'string').map(
                (f) => () => {
                  block[f] = 'missing';
                }
              )
            )
          );
          if (sites.length > 0) {
            assetBreaks += 1;
            sites[pick % sites.length]!();
          }
          const assetRefusal =
            sites.length > 0 ? refusalOf(() => parseAll(broken)) : null;
          expect(
            assetRefusal === null || assetRefusal instanceof Invalid,
            'a broken asset reference is refused'
          ).toBe(true);

          // A choice jumping to a step that does not exist is refused.
          const jumped = copyOf();
          const station = jumped.find((s) =>
            s.steps.some((st) => (st.action as Json).kind === 'choice')
          );
          const canJump =
            station !== undefined &&
            !station.steps.some((st) => st.id === ghost);
          if (canJump) {
            choiceBreaks += 1;
            const choice = station.steps.find(
              (st) => (st.action as Json).kind === 'choice'
            )!.action as { options: { goto?: string }[] };
            choice.options[0]!.goto = ghost;
          }
          const choiceRefusal = canJump
            ? refusalOf(() => parseAll(jumped))
            : null;
          expect(
            choiceRefusal === null ||
              (choiceRefusal instanceof Error &&
                /must name a step of this station/.test(choiceRefusal.message)),
            'a choice to no step is refused'
          ).toBe(true);
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
 * The error `fn` throws, or undefined when it returns, so a property can
 * assert a refusal outside the branch that set its case up.
 */
function refusalOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
}
