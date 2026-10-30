/**
 * Why this test matters: a long text may stand in the world as a short
 * sign that opens the whole text in a sheet on a tap (the `reading` view,
 * `tour.json` version 4 minor 4), free at its station or reached by a
 * story step. From this minor on it is also the long text's floor: a free
 * long text in a view this reader does not know falls back to it instead
 * of being left out. It is an additive minor: the writer stamps 4.4 only
 * when a reading sign is in the tour, and the reader the framework
 * actually released (1.31.0, minor 0) opens such a tour leniently - a free
 * sign is left out, a story one shows as the card it always was - and
 * refuses to write it back.
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
  tourFloorView,
} from './tour-blocks';
import {
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
} from './tour-manifest';
import { tourObjectBlock, tourObjects } from './tour-station-pose';

const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] };
const GEO = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };

function sign(extra: Record<string, unknown> = {}) {
  return {
    id: 'sign',
    kind: 'longText',
    view: 'reading',
    title: 'The guild house',
    body: 'The guild house burned in 1612. It was built again in stone.',
    pose: POSE,
    ...extra,
  };
}

function tour(
  blocks: unknown[],
  shown: readonly string[] = [],
  minor: number = 4
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

describe('the reading view of a long text (minor 4)', () => {
  it('is a long text view, a world view, and the long text floor', () => {
    expect(TOUR_BLOCK_VIEWS.longText).toContain('reading');
    expect(TOUR_WORLD_VIEWS.has('reading')).toBe(true);
    expect(tourFloorView('longText', 'free')).toBe('reading');
    expect(tourFloorView('longText', 'story')).toBe('card');
    expect(TOUR_MANIFEST_MINOR).toBe(4);
  });

  it('a free sign stands in the world at its station, as a tour object', () => {
    const manifest = parseTourManifest(tour([sign()]));
    expect(manifest.stations[0]?.blocks[0]).toMatchObject({
      kind: 'longText',
      view: 'reading',
      pose: POSE,
    });
    const [object] = tourObjects(manifest);
    expect(object).toMatchObject({
      kind: 'longText',
      view: 'reading',
      title: 'The guild house',
      station: 'square',
    });
    expect(
      object === undefined ? null : tourObjectBlock(object, POSE as never)
    ).toEqual(manifest.stations[0]?.blocks[0]);
  });

  it('a story step may show it too, and it keeps the view', () => {
    const manifest = parseTourManifest(tour([sign()], ['sign']));
    expect(manifest.stations[0]?.blocks[0]?.view).toBe('reading');
  });

  it('needs minor 4, above a reading stand; a card needs none', () => {
    const blocks = parseTourManifest(
      tour([sign(), sign({ id: 'stand', view: 'lectern' })])
    ).stations[0]?.blocks;
    expect(tourBlocksMinor(blocks ?? [])).toBe(4);
    const card = parseTourManifest(tour([sign({ view: 'card' })], ['sign']))
      .stations[0]?.blocks;
    expect(tourBlocksMinor(card ?? [])).toBe(0);
  });

  it('round-trips exactly, written at minor 4', () => {
    const read = parseTourManifest(tour([sign()]));
    const written = JSON.parse(serializeTourManifest(read)) as {
      minor: number;
    };
    expect(written.minor).toBe(4);
    expect(parseTourManifest(written)).toEqual(read);
  });

  it('a free long text in a view of a newer minor stands as a reading sign', () => {
    // Why: from this minor on a free long text always has a world view
    // this reader draws, so it is shown rather than left out.
    const drops: unknown[] = [];
    const manifest = parseTourManifest(
      tour([sign({ view: 'captions' })], [], TOUR_MANIFEST_MINOR + 1),
      { onDropped: (d) => drops.push(d) }
    );
    expect(manifest.stations[0]?.blocks[0]).toMatchObject({
      id: 'sign',
      view: 'reading',
    });
    expect(drops).toEqual([]);
  });
});

describe('the released reader (framework 1.31.0, minor 0) opens a minor-4 tour', () => {
  // Why: "additive" is a promise to readers already on phones. This is
  // the published package's own parser, installed as a dev dependency.
  const free = JSON.parse(
    serializeTourManifest(
      parseTourManifest(
        tour([
          sign(),
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
    serializeTourManifest(parseTourManifest(tour([sign()], ['sign'])))
  ) as unknown;

  it('leaves a free sign out and keeps the rest of the station', () => {
    const drops: unknown[] = [];
    const old = parseReleased(free, { onDropped: (d) => drops.push(d) });
    expect(old.stations[0]?.blocks.map((b) => b.id)).toEqual(['pin']);
    expect(drops).toHaveLength(1);
  });

  it('shows a story sign as a card with its title and body', () => {
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
