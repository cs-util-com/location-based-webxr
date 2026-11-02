/**
 * Why this test matters: the creator's session writes the manifest and the
 * visitor's reads it, on different phones, days apart. The property that
 * makes that safe is exact round-trip: any manifest the writer accepts
 * parses back to the same records - every station's geo pose and every
 * block's local pose bit for bit (nothing may nudge a local pose) - for
 * every mix of stations, free and story blocks of every kind, shows,
 * choices and quizzes, details, station descriptions and card images the
 * generators can produce, not only the hand-written examples. A tour of a
 * newer minor is never written back: it was read without what this
 * reader does not know.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  tourIdArbitrary,
  tourManifestArbitrary,
} from '../test-utils/tour-arbitraries';
import {
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
} from './tour-manifest';
import { tourBlocksMinor } from './tour-blocks';
import { tourObjects } from './tour-station-pose';

/** What a card image or the cover may name: an image asset, another
 *  asset, a block id, or nothing the tour has. */
const imagePick = fc.option(
  fc.constantFrom('gate', 'voice', 'block', 'no-such-image'),
  { nil: undefined }
);

/** A generated tour with the tour's own fields and each station's
 *  description and card image. */
const manifest = tourManifestArbitrary().chain((record) => {
  const stations = record.stations as Record<string, unknown>[];
  return fc
    .record({
      extras: fc.array(
        fc.record({
          description: fc.option(fc.string({ maxLength: 40 }), {
            nil: undefined,
          }),
          image: imagePick,
        }),
        { minLength: stations.length, maxLength: stations.length }
      ),
      needsNoGps: fc.option(fc.boolean(), { nil: undefined }),
      tourId: fc.option(tourIdArbitrary, { nil: undefined }),
      description: fc.option(fc.stringMatching(/^[A-Za-z]{1,40}$/), {
        nil: undefined,
      }),
      cover: imagePick,
    })
    .map(({ extras, needsNoGps, tourId, description, cover }) => {
      const firstBlock = (s: Record<string, unknown>) =>
        (s.blocks as { id: string }[])[0]?.id ?? 'no-block';
      const named = (pick: string, s: Record<string, unknown>) =>
        pick === 'block' ? firstBlock(s) : pick;
      return {
        ...record,
        stations: stations.map((s, i) => {
          const { description: d, image } = extras[i]!;
          return {
            ...s,
            ...(d === undefined ? {} : { description: d }),
            ...(image === undefined ? {} : { image: named(image, s) }),
          };
        }),
        ...(needsNoGps === undefined ? {} : { needsNoGps }),
        ...(tourId === undefined ? {} : { tourId }),
        ...(description === undefined ? {} : { description }),
        ...(cover === undefined ? {} : { cover: named(cover, stations[0]!) }),
      };
    });
});

/** The ids of the tour's image assets. */
function imageIds(m: ReturnType<typeof parseTourManifest>): Set<string> {
  return new Set(m.assets.filter((a) => a.kind === 'image').map((a) => a.id));
}

describe('tour manifest version 4 (properties)', () => {
  it('serialize -> parse is the identity on every manifest the writer accepts, local poses bit for bit', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const parsed = parseTourManifest(m);
        const written = JSON.parse(serializeTourManifest(parsed)) as unknown;
        const again = parseTourManifest(written);
        // The writer stamps the lowest minor the tour needs; everything
        // else reads back unchanged.
        const needed = tourBlocksMinor(
          parsed.stations.flatMap((s) => s.blocks)
        );
        expect(again).toEqual({ ...parsed, minor: needed });
        expect(written).toMatchObject({ version: 4, minor: needed });
        // The same numbers exactly, not merely close: JSON round trips a
        // double exactly, and nothing on the way may recompute a pose.
        const poses = (x: typeof parsed) =>
          JSON.stringify(x.stations.map((s) => s.blocks.map((b) => b.pose)));
        expect(poses(again)).toBe(poses(parsed));
        expect(JSON.stringify(tourObjects(again))).toBe(
          JSON.stringify(tourObjects(parsed))
        );
      }),
      { numRuns: 150 }
    );
  });

  it('parsing is idempotent: parsing a parsed manifest changes nothing', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const once = parseTourManifest(m);
        expect(parseTourManifest(JSON.parse(JSON.stringify(once)))).toEqual(
          once
        );
      }),
      { numRuns: 100 }
    );
  });

  it('the writer refuses every tour of a newer minor: it was read without what this reader does not know', () => {
    fc.assert(
      fc.property(
        manifest,
        fc.integer({ min: TOUR_MANIFEST_MINOR + 1, max: 99 }),
        (m, minor) => {
          const parsed = parseTourManifest({ ...m, minor });
          expect(parsed.minor).toBe(minor);
          expect(() => serializeTourManifest(parsed)).toThrow(
            /made with a newer version of the app/
          );
        }
      ),
      { numRuns: 60 }
    );
  });

  it('keeps every station and every block in the station it was written in, and a cover or card image only when it names an image asset, reporting every card image it drops', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const dropped: string[] = [];
        const parsed = parseTourManifest(m, {
          onDropped: (drop) => {
            if ('station' in drop && drop.field === 'image') {
              dropped.push(drop.station);
            }
          },
        });
        const stations = m.stations as {
          id: string;
          blocks: { id: string }[];
          image?: string;
        }[];
        expect(parsed.stations.map((s) => s.id)).toEqual(
          stations.map((s) => s.id)
        );
        expect(parsed.stations.map((s) => s.blocks.map((b) => b.id))).toEqual(
          stations.map((s) => s.blocks.map((b) => b.id))
        );
        const images = imageIds(parsed);
        expect(parsed.cover === undefined || images.has(parsed.cover)).toBe(
          true
        );
        for (const s of parsed.stations) {
          expect(s.image === undefined || images.has(s.image)).toBe(true);
        }
        expect(dropped).toEqual(
          stations
            .filter(
              (s, i) =>
                s.image !== undefined && parsed.stations[i]?.image === undefined
            )
            .map((s) => s.id)
        );
      }),
      { numRuns: 150 }
    );
  });
});
