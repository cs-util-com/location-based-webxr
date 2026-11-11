/**
 * Why this test matters: a long text may stand in the world as a reading
 * stand (the `lectern` view), free at its station or inside a story, and
 * keeps that view through a write and a read.
 */

// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { describe, expect, it } from 'vitest';

import { TOUR_BLOCK_VIEWS, TOUR_WORLD_VIEWS } from './tour-blocks';
import {
  parseTourManifest,
  serializeTourManifest,
  TourManifestValidationError,
} from './tour-manifest';
import { tourObjectBlock, tourObjects } from './tour-station-pose';
import { tourStationBlocks } from './tour-story';

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
  minor: number = 0
) {
  const isShown = (b: unknown) => shown.includes((b as { id: string }).id);
  const story = {
    id: 'story',
    kind: 'folder',
    role: 'story',
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

describe('the lectern view of a long text', () => {
  it('is a long text view and a world view', () => {
    expect(TOUR_BLOCK_VIEWS.longText).toContain('lectern');
    expect(TOUR_WORLD_VIEWS.has('lectern')).toBe(true);
  });

  it('a free lectern stands in the world at its station, as a tour object', () => {
    const manifest = parseTourManifest(tour([lectern()]));
    expect(firstBlock(manifest)).toMatchObject({
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
    ).toEqual(firstBlock(manifest));
  });

  it('a story may hold it too, and it keeps the view', () => {
    const manifest = parseTourManifest(tour([lectern()], ['stand']));
    expect(firstBlock(manifest)?.view).toBe('lectern');
  });

  it('round-trips exactly', () => {
    const read = parseTourManifest(tour([lectern()]));
    const written = JSON.parse(serializeTourManifest(read)) as unknown;
    expect(parseTourManifest(written)).toEqual(read);
  });

  it('a free long text in the card view still fails: nothing would show it', () => {
    expect(() => parseTourManifest(tour([lectern({ view: 'card' })]))).toThrow(
      TourManifestValidationError
    );
  });
});
