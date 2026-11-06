/**
 * Why this test matters: a long text may stand in the world as a short
 * sign that opens the whole text in a sheet on a tap (the `reading` view),
 * free at its station or inside a story. It is also the long text's floor:
 * a free long text in a view this reader does not know falls back to it
 * instead of being left out.
 */

// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { describe, expect, it } from 'vitest';

import {
  TOUR_BLOCK_VIEWS,
  TOUR_WORLD_VIEWS,
  tourFloorView,
} from './tour-blocks';
import {
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
} from './tour-manifest';
import { tourObjectBlock, tourObjects } from './tour-station-pose';
import { tourStationBlocks } from './tour-story';

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
  minor: number = 0
) {
  const isShown = (b: unknown) => shown.includes((b as { id: string }).id);
  const story = {
    id: 'story',
    kind: 'story',
    title: 'A story',
    children: blocks.filter(isShown),
  };
  return {
    version: 5,
    minor,
    assets: [],
    stations: [
      {
        id: 'square',
        title: 'Square',
        geo: GEO,
        activateRadiusM: 25,
        foundRadiusM: 4,
        children: [
          ...(shown.length === 0 ? [] : [story]),
          ...blocks.filter((b) => !isShown(b)),
        ],
      },
    ],
  };
}

const firstBlock = (manifest: ReturnType<typeof parseTourManifest>) =>
  tourStationBlocks(manifest.stations[0]!)[0];

describe('the reading view of a long text', () => {
  it('is a long text view, a world view, and the long text floor', () => {
    expect(TOUR_BLOCK_VIEWS.longText).toContain('reading');
    expect(TOUR_WORLD_VIEWS.has('reading')).toBe(true);
    expect(tourFloorView('longText')).toBe('reading');
  });

  it('a free sign stands in the world at its station, as a tour object', () => {
    const manifest = parseTourManifest(tour([sign()]));
    expect(firstBlock(manifest)).toMatchObject({
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
    ).toEqual(firstBlock(manifest));
  });

  it('a story may hold it too, and it keeps the view', () => {
    const manifest = parseTourManifest(tour([sign()], ['sign']));
    expect(firstBlock(manifest)?.view).toBe('reading');
  });

  it('round-trips exactly', () => {
    const read = parseTourManifest(tour([sign()]));
    const written = JSON.parse(serializeTourManifest(read)) as {
      minor: number;
    };
    expect(written.minor).toBe(0);
    expect(parseTourManifest(written)).toEqual(read);
  });

  it('a free long text in a view of a newer minor stands as a reading sign', () => {
    // Why: a free long text always has a world view this reader draws, so
    // it is shown rather than left out.
    const drops: unknown[] = [];
    const manifest = parseTourManifest(
      tour([sign({ view: 'captions' })], [], TOUR_MANIFEST_MINOR + 1),
      { onDropped: (d) => drops.push(d) }
    );
    expect(firstBlock(manifest)).toMatchObject({
      id: 'sign',
      view: 'reading',
    });
    expect(drops).toEqual([]);
  });
});
