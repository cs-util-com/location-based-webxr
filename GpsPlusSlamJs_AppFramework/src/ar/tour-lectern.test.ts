/**
 * Why this test matters: a long text may stand in the world as a reading
 * stand (the `lectern` view, `tour.json` version 4 minor 3), free at its
 * station or reached by a story step. It is an additive minor: the writer
 * stamps 4.3 only when a lectern is in the tour, so a tour without one
 * stays readable by every older app in full, and the reader the framework
 * actually released (1.31.0, minor 0) opens a 4.3 tour leniently - a free
 * lectern is left out (it draws no long text in the world), a story one
 * shows as the card it always was - and refuses to write it back.
 */

import { describe, expect, it } from 'vitest';

import {
  parseTourManifest as parseReleased,
  serializeTourManifest as serializeReleased,
} from 'tour-reader-1-31/ar/tour-manifest';

import {
  TOUR_BLOCK_VIEWS,
  TOUR_WORLD_VIEWS,
  tourBlocksMinor,
} from './tour-blocks';
import {
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
  TourManifestValidationError,
} from './tour-manifest';
import { tourObjectBlock, tourObjects } from './tour-station-pose';

const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] };
const GEO = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };

function lectern(extra: Record<string, unknown> = {}) {
  return {
    id: 'stand',
    kind: 'longText',
    view: 'lectern',
    title: 'The guild house',
    body: 'The guild house burned in 1612. It was built again in stone.',
    pose: POSE,
    ...extra,
  };
}

function tour(
  blocks: unknown[],
  shown: readonly string[] = [],
  minor: number = 3
) {
  return {
    version: 4,
    minor,
    assets: [],
    stations: [
      {
        id: 'square',
        title: 'Square',
        geo: GEO,
        activateRadiusM: 25,
        foundRadiusM: 4,
        blocks,
        steps: shown.map((block, i) => ({
          id: `s${String(i)}`,
          action: { kind: 'show', block },
        })),
      },
    ],
  };
}

describe('the lectern view of a long text (minor 3)', () => {
  it('is a long text view and a world view', () => {
    expect(TOUR_BLOCK_VIEWS.longText).toContain('lectern');
    expect(TOUR_WORLD_VIEWS.has('lectern')).toBe(true);
    // Known from minor 3 on (`tour-reading.test.ts` pins the current one).
    expect(TOUR_MANIFEST_MINOR).toBeGreaterThanOrEqual(3);
  });

  it('a free lectern stands in the world at its station, as a tour object', () => {
    const manifest = parseTourManifest(tour([lectern()]));
    expect(manifest.stations[0]?.blocks[0]).toMatchObject({
      kind: 'longText',
      view: 'lectern',
      pose: POSE,
    });
    const [object] = tourObjects(manifest);
    expect(object).toMatchObject({
      kind: 'longText',
      view: 'lectern',
      title: 'The guild house',
      station: 'square',
    });
    // Back to the block it is: the same fields at its local pose.
    expect(
      object === undefined ? null : tourObjectBlock(object, POSE as never)
    ).toEqual(manifest.stations[0]?.blocks[0]);
  });

  it('a story step may show it too, and it keeps the view', () => {
    const manifest = parseTourManifest(tour([lectern()], ['stand']));
    expect(manifest.stations[0]?.blocks[0]?.view).toBe('lectern');
  });

  it('needs minor 3, and only a lectern does', () => {
    const [block] =
      parseTourManifest(tour([lectern()])).stations[0]?.blocks ?? [];
    expect(block === undefined ? -1 : tourBlocksMinor([block])).toBe(3);
    const card = parseTourManifest(tour([lectern({ view: 'card' })], ['stand']))
      .stations[0]?.blocks;
    expect(tourBlocksMinor(card ?? [])).toBe(0);
  });

  it('round-trips exactly, written at minor 3; a tour without one is written lower', () => {
    const read = parseTourManifest(tour([lectern()]));
    const written = JSON.parse(serializeTourManifest(read)) as {
      minor: number;
    };
    expect(written.minor).toBe(3);
    expect(parseTourManifest(written)).toEqual(read);
    const plain = JSON.parse(
      serializeTourManifest(
        parseTourManifest(tour([lectern({ view: 'card' })], ['stand']))
      )
    ) as { minor: number };
    expect(plain.minor).toBe(0);
  });

  it('a free long text in the card view still fails: nothing would show it', () => {
    expect(() => parseTourManifest(tour([lectern({ view: 'card' })]))).toThrow(
      TourManifestValidationError
    );
  });
});

describe('the released reader (framework 1.31.0, minor 0) opens a minor-3 tour', () => {
  // Why: "additive" is a promise to readers already on phones. This is
  // the published package's own parser, installed as a dev dependency.
  const free = JSON.parse(
    serializeTourManifest(
      parseTourManifest(
        tour([
          lectern(),
          {
            id: 'pin',
            kind: 'shortText',
            view: 'pin',
            caption: 'Here',
            pose: POSE,
          },
        ])
      )
    )
  ) as unknown;
  const story = JSON.parse(
    serializeTourManifest(parseTourManifest(tour([lectern()], ['stand'])))
  ) as unknown;

  it('leaves a free lectern out and keeps the rest of the station', () => {
    const drops: unknown[] = [];
    const old = parseReleased(free, { onDropped: (d) => drops.push(d) });
    expect(old.stations[0]?.blocks.map((b) => b.id)).toEqual(['pin']);
    expect(drops).toHaveLength(1);
  });

  it('shows a story lectern as a card with its title and body', () => {
    const old = parseReleased(story);
    expect(old.stations[0]?.blocks[0]).toMatchObject({
      kind: 'longText',
      view: 'card',
      title: 'The guild house',
    });
  });

  it('refuses to write it back, instead of dropping what it cannot read', () => {
    expect(() => serializeReleased(parseReleased(story))).toThrow(
      /made with a newer version of the app/
    );
  });
});
