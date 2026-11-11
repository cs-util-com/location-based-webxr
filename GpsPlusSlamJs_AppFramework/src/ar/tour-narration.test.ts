/**
 * Why this test matters: a long text may be read aloud (`narration`), with
 * a read-along track in its own archive entry `timing/<blockId>.json`. This
 * reader keeps every field exactly through a write and a read; a narration
 * it cannot use fails a file of its own minor (a writer's bug, found when
 * the tour is made) but drops only the narration of a newer minor's file
 * (the text itself still reads).
 */

import { describe, expect, it } from 'vitest';

import {
  TOUR_NARRATION_MAX_DURATION_MS,
  type TourLongTextBlock,
} from './tour-blocks';
import {
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
  TourManifestValidationError,
} from './tour-manifest';
import { tourStationBlocks } from './tour-story';

const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] };
const GEO = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };

const NARRATION = {
  audio: 'voice',
  timing: 'timing/text.json',
  voiceCredit: 'Read by the guild archive',
  synthetic: true,
  durationMs: 61_000,
};

function text(extra: Record<string, unknown> = {}) {
  return {
    id: 'text',
    kind: 'longText',
    view: 'reading',
    title: 'The guild house',
    body: 'The guild house burned in 1612. It was built again in stone.',
    pose: POSE,
    narration: NARRATION,
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
    assets: [
      { id: 'voice', path: 'content/voice.mp3' },
      { id: 'photo', path: 'content/photo.jpg' },
    ],
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

function longText(manifest: ReturnType<typeof parseTourManifest>) {
  return tourStationBlocks(manifest.stations[0]!)[0] as
    TourLongTextBlock | undefined;
}

describe('a narrated long text', () => {
  it('reads every field and round-trips exactly', () => {
    const read = parseTourManifest(tour([text()]));
    expect(longText(read)?.narration).toEqual(NARRATION);
    const written = JSON.parse(serializeTourManifest(read)) as {
      minor: number;
    };
    expect(written.minor).toBe(0);
    expect(parseTourManifest(written)).toEqual(read);
  });

  it('needs only its voice; synthetic reads as false when absent', () => {
    // Why: a voice without a read-along is a narration too (the creator
    // has not timed it yet), and an unsaid `synthetic` must not claim the
    // voice is a person's by accident of a missing field - it is false.
    const read = parseTourManifest(
      tour([text({ narration: { audio: 'voice' } })])
    );
    expect(longText(read)?.narration).toEqual({
      audio: 'voice',
      synthetic: false,
    });
  });

  it('accepts a duration at its edges', () => {
    for (const durationMs of [1, TOUR_NARRATION_MAX_DURATION_MS]) {
      const read = parseTourManifest(
        tour([text({ narration: { audio: 'voice', durationMs } })])
      );
      expect(longText(read)?.narration?.durationMs).toBe(durationMs);
    }
  });

  it.each([
    ['not an object', 'voice'],
    ['no voice', { synthetic: true }],
    ['a voice that is a picture', { audio: 'photo' }],
    ['a voice no asset has', { audio: 'nobody' }],
    ['another block’s timing', { audio: 'voice', timing: 'timing/x.json' }],
    ['a timing outside the folder', { audio: 'voice', timing: 'text.json' }],
    ['a synthetic that is no boolean', { audio: 'voice', synthetic: 'yes' }],
    ['a zero duration', { audio: 'voice', durationMs: 0 }],
    ['a fractional duration', { audio: 'voice', durationMs: 1.5 }],
    [
      'a duration over four hours',
      { audio: 'voice', durationMs: TOUR_NARRATION_MAX_DURATION_MS + 1 },
    ],
  ])('fails a file of its own minor with %s', (_label, narration) => {
    // Why: at this reader's own minor a narration it cannot use is a
    // writer's bug, found when the tour is made, not on a visitor's phone.
    expect(() => parseTourManifest(tour([text({ narration })]))).toThrow(
      TourManifestValidationError
    );
  });

  it('a newer minor drops only the narration it cannot use, keeping the text', () => {
    const drops: unknown[] = [];
    const read = parseTourManifest(
      tour(
        [text({ narration: { audio: 'voice', durationMs: 0 } })],
        [],
        TOUR_MANIFEST_MINOR + 1
      ),
      { onDropped: (d) => drops.push(d) }
    );
    expect(longText(read)).toMatchObject({ id: 'text', view: 'reading' });
    expect(longText(read)?.narration).toBeUndefined();
    expect(drops).toEqual([
      expect.objectContaining({
        kind: 'field',
        block: 'text',
        field: 'narration',
      }),
    ]);
  });

  it('a narration that is no object fails at every minor', () => {
    // Why: no later minor can make a string a narration: it is the shape,
    // not a rule a revision relaxes.
    expect(() =>
      parseTourManifest(
        tour([text({ narration: 3 })], [], TOUR_MANIFEST_MINOR + 1)
      )
    ).toThrow(TourManifestValidationError);
  });

  it('leaves out an over-long credit alone and says so', () => {
    const drops: unknown[] = [];
    const read = parseTourManifest(
      tour([
        text({ narration: { audio: 'voice', voiceCredit: 'x'.repeat(201) } }),
      ]),
      { onDropped: (d) => drops.push(d) }
    );
    expect(longText(read)?.narration).toEqual({
      audio: 'voice',
      synthetic: false,
    });
    expect(drops).toHaveLength(1);
    const kept = parseTourManifest(
      tour([
        text({ narration: { audio: 'voice', voiceCredit: 'x'.repeat(200) } }),
      ])
    );
    expect(longText(kept)?.narration?.voiceCredit).toHaveLength(200);
  });
});
