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

// Activates the core library's licence before any module under test loads.
import '../test-setup';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  TOUR_FREE_VIEWS,
  tourIdArbitrary,
  tourManifestArbitrary,
} from '../test-utils/tour-arbitraries';
import {
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
} from './tour-manifest';
import { TOUR_WORLD_VIEWS, tourBlocksMinor } from './tour-blocks';
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
  // One generation for every claim about a manifest the writer accepts
  // (each claim used to draw its own 100-300 manifests): the reader accepts
  // it, serialize -> parse is the identity with poses bit for bit, parsing
  // is idempotent, a written file is a byte-for-byte fixed point, stations,
  // blocks and card images stay where they were written; and, collected
  // over the runs, the generator reaches every block kind, every step kind,
  // free blocks and every world view (were it to miss one, every claim
  // above would silently skip it). Unseeded, so every run draws new
  // manifests: the coverage claims held in 24 of 24 runs at 40 manifests and
  // in 20 of 24 at 20, so 300 leaves them a wide margin. Each claim carries
  // its own failure message.
  it('every manifest the writer accepts: identity, idempotent parse, a byte fixed point, stations and card images kept; the generator reaches every kind and world view', () => {
    // The generator's free views must be exactly the format's world views
    // (a long text's lectern and reading sign once went untested because
    // the generator never wrote them).
    expect(new Set(Object.values(TOUR_FREE_VIEWS).flat())).toEqual(
      TOUR_WORLD_VIEWS
    );
    const kinds = new Set<string>();
    const steps = new Set<string>();
    const views = new Set<string>();
    let free = 0;
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
        for (const station of parsed.stations) {
          for (const block of station.blocks) kinds.add(block.kind);
          for (const step of station.steps) steps.add(step.action.kind);
        }
        for (const object of tourObjects(parsed)) views.add(object.view);
        free += tourObjects(parsed).length;

        // Identity through the writer: the lowest minor the tour needs is
        // stamped, everything else reads back unchanged.
        const text = serializeTourManifest(parsed);
        const written = JSON.parse(text) as unknown;
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

        // Idempotent: parsing a parsed manifest changes nothing.
        expect(
          parseTourManifest(JSON.parse(JSON.stringify(parsed))),
          'parsing is idempotent'
        ).toEqual(parsed);

        // A written file is a fixed point: read and written again, the same
        // bytes; and every step is written under its one key.
        const file = written as {
          stations: { steps: Record<string, unknown>[] }[];
        };
        expect(
          file.stations
            .flatMap((s) => s.steps)
            .filter((s) => !('action' in s) || 'block' in s),
          'every step under its one key'
        ).toEqual([]);
        expect(
          serializeTourManifest(parseTourManifest(JSON.parse(text))),
          'a written file is a fixed point'
        ).toBe(text);

        // Every station and every block stays in the station it was
        // written in; a cover or card image only when it names an image
        // asset, and every card image dropped is reported.
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
        expect(
          parsed.cover === undefined || images.has(parsed.cover),
          'the cover names an image asset'
        ).toBe(true);
        for (const s of parsed.stations) {
          expect(
            s.image === undefined || images.has(s.image),
            'a card image names an image asset'
          ).toBe(true);
        }
        expect(dropped, 'every dropped card image is reported').toEqual(
          stations
            .filter(
              (s, i) =>
                s.image !== undefined && parsed.stations[i]?.image === undefined
            )
            .map((s) => s.id)
        );
      }),
      { numRuns: 300 }
    );
    expect([...kinds].sort(), 'every block kind').toEqual(
      [
        'audio',
        'character',
        'longText',
        'model',
        'picture',
        'shortText',
        'video',
      ].sort()
    );
    expect([...steps].sort(), 'every step kind').toEqual([
      'choice',
      'quiz',
      'show',
    ]);
    expect(free, 'free blocks').toBeGreaterThan(0);
    expect(views, 'every world view').toEqual(TOUR_WORLD_VIEWS);
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
});
