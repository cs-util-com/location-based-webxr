/**
 * Why this test matters: a recurring character is declared ONCE for the
 * tour (`characters`) and appears at several stations as a story block in
 * one of five views, moving on by itself when the line ends. The writer
 * keeps the block's inline name and image in step with the declaration, so
 * one rename reaches every station.
 */

import { describe, expect, it } from 'vitest';

import {
  TOUR_CHARACTER_FRAMES,
  TOUR_CHARACTER_VIEWS,
  parseTourCharacters,
} from './tour-characters';
import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
  TourManifestValidationError,
  type TourManifest,
  type TourManifestDrop,
} from './tour-manifest';
import { tourStationStoryBlocks } from './tour-story';

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const GEO = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };
const ASSETS = [
  { id: 'wendel', path: 'content/wendel.png', width: 512, height: 1024 },
  { id: 'wendel2', path: 'content/wendel2.png', width: 512, height: 1024 },
  { id: 'voice', path: 'content/voice.mp3' },
  { id: 'sheet', path: 'content/sheet.webp', width: 2048, height: 1024 },
];
const WENDEL = { id: 'wendel', name: 'Wendel', image: 'wendel' };

function figure(extra: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    kind: 'character',
    view: 'bubble',
    name: 'Wendel',
    image: 'wendel',
    caption: 'Welcome to the old gate. Follow me to the well.',
    pose: POSE,
    ...extra,
  };
}

function station(
  id: string,
  blocks: unknown[],
  advance?: Record<string, unknown>
) {
  return {
    id,
    title: id,
    geo: GEO,
    activateRadiusM: 25,
    foundRadiusM: 4,
    children:
      blocks.length === 0
        ? []
        : [
            {
              id: `${id}-story`,
              kind: 'story',
              title: id,
              children: blocks.map((b) => ({
                ...(b as object),
                ...(advance === undefined ? {} : { advance }),
              })),
            },
          ],
  };
}

/** The first story block of the first station. */
const firstBlock = (manifest: TourManifest) =>
  tourStationStoryBlocks(manifest.stations[0]!)[0];

function tour(extra: Record<string, unknown> = {}) {
  return {
    version: 5,
    assets: ASSETS,
    characters: [WENDEL],
    stations: [station('gate', [figure({ character: 'wendel' })])],
    ...extra,
  };
}

describe('the characters declaration', () => {
  it('reads the declared characters, each an id, a name and an image asset', () => {
    const manifest = parseTourManifest(tour());
    expect(manifest.characters).toEqual([WENDEL]);
  });

  it('absent or empty reads as no declaration, and is written as none', () => {
    for (const characters of [undefined, []]) {
      const manifest = parseTourManifest(
        tour({ characters, stations: [station('gate', [figure()])] })
      );
      expect(manifest).not.toHaveProperty('characters');
      expect(
        JSON.parse(serializeTourManifest(manifest)) as object
      ).not.toHaveProperty('characters');
    }
  });

  it('a manifest built in code with no characters left is written without the list', () => {
    // Why: a page may hand the writer a manifest whose characters it
    // emptied (never parsed); the writer reads it through the parser
    // first, which drops an empty list.
    const built = {
      ...createEmptyTourManifest(),
      characters: [],
      stations: [station('gate', [])],
    } as unknown as TourManifest;
    const written = JSON.parse(serializeTourManifest(built)) as {
      minor: number;
    };
    expect(written.minor).toBe(0);
    expect(written).not.toHaveProperty('characters');
  });

  it.each([
    ['not a list', { characters: {} }, /"characters" must be an array/],
    ['an entry not an object', { characters: [7] }, /"characters\[0\]"/],
    [
      'a bad id',
      { characters: [{ ...WENDEL, id: 'a b' }] },
      /characters\[0\]\.id/,
    ],
    [
      'a repeated id',
      { characters: [WENDEL, { ...WENDEL, name: 'Again' }] },
      /character/,
    ],
    [
      'a blank name',
      { characters: [{ ...WENDEL, name: ' ' }] },
      /name" is empty/,
    ],
    [
      'a name over 80 characters',
      { characters: [{ ...WENDEL, name: 'x'.repeat(81) }] },
      /longer than 80/,
    ],
    [
      'an image that is no image asset',
      { characters: [{ ...WENDEL, image: 'voice' }] },
      /must name an image asset/,
    ],
  ])("refuses %s at this reader's own minor", (_label, extra, message) => {
    const data = tour({ ...extra, stations: [station('gate', [figure()])] });
    expect(() => parseTourManifest(data)).toThrow(TourManifestValidationError);
    expect(() => parseTourManifest(data)).toThrow(message);
  });

  it('a newer minor leaves out just the declaration it cannot read, and says so; a bad id still fails', () => {
    // Why: a later minor may widen a name's cap or let a character's
    // image be another kind of asset; the tour must still open.
    const drops: TourManifestDrop[] = [];
    const manifest = parseTourManifest(
      tour({
        minor: TOUR_MANIFEST_MINOR + 1,
        characters: [
          { ...WENDEL, name: 'x'.repeat(81) },
          { id: 'ada', name: 'Ada', image: 'wendel2' },
        ],
        stations: [station('gate', [figure()])],
      }),
      { onDropped: (drop) => drops.push(drop) }
    );
    expect(manifest.characters).toEqual([
      { id: 'ada', name: 'Ada', image: 'wendel2' },
    ]);
    expect(drops).toEqual([
      expect.objectContaining({ kind: 'character', character: 'wendel' }),
    ]);
    expect(() =>
      parseTourManifest(
        tour({
          minor: TOUR_MANIFEST_MINOR + 1,
          characters: [{ ...WENDEL, id: '' }],
        })
      )
    ).toThrow(/characters\[0\]\.id/);
  });

  it('parseTourCharacters is the one rule, also callable on its own', () => {
    expect(
      parseTourCharacters([WENDEL], {
        assets: [{ id: 'wendel', path: 'content/wendel.png', kind: 'image' }],
        fail: (m) => {
          throw new Error(m);
        },
      })
    ).toEqual([WENDEL]);
  });
});

describe("the character's frames sheet", () => {
  // Why: one image holds his four poses - idle, mouth half open, mouth
  // open, beckoning - in a fixed, documented layout (four equal cells in
  // one row), so every view knows which frame talks and which points for
  // ANY character, and a later import that slices an AI-made picture
  // writes exactly this. The single `image` stays the one-pose fallback.
  it('names the four frames in their fixed order, and reads a sheet that is an image asset', () => {
    expect(TOUR_CHARACTER_FRAMES).toEqual([
      'idle',
      'talk-a',
      'talk-b',
      'beckon',
    ]);
    const manifest = parseTourManifest(
      tour({ characters: [{ ...WENDEL, frames: 'sheet' }] })
    );
    expect(manifest.characters).toEqual([{ ...WENDEL, frames: 'sheet' }]);
    expect(parseTourManifest(tour()).characters?.[0]).not.toHaveProperty(
      'frames'
    );
  });

  it("refuses a sheet that is no image asset at this reader's own minor", () => {
    expect(() =>
      parseTourManifest(tour({ characters: [{ ...WENDEL, frames: 'voice' }] }))
    ).toThrow(/characters\[0\]\.frames" must name an image asset/);
  });

  it('a newer minor leaves out just the sheet it cannot read, keeping him with his one image', () => {
    const drops: TourManifestDrop[] = [];
    const manifest = parseTourManifest(
      tour({
        minor: TOUR_MANIFEST_MINOR + 1,
        characters: [{ ...WENDEL, frames: { cells: 6 } }],
      }),
      { onDropped: (drop) => drops.push(drop) }
    );
    expect(manifest.characters).toEqual([WENDEL]);
    // A FIELD drop: the report names the one field left out, so nothing
    // reading it can take it for the whole declaration.
    expect(drops).toEqual([
      {
        kind: 'character',
        character: 'wendel',
        field: 'characters[0].frames',
        reason: expect.stringMatching(/frames/) as unknown,
      },
    ]);
  });

  // Why: a sheet that is his one image would be sliced into four quarters
  // of one pose - a quarter figure per frame. It is refused like any other
  // sheet this reader cannot take.
  it('refuses a sheet that is his one image, and a newer minor drops just that field', () => {
    expect(() =>
      parseTourManifest(
        tour({ characters: [{ ...WENDEL, frames: WENDEL.image }] })
      )
    ).toThrow(/characters\[0\]\.frames" must name an image other than/);
    const drops: TourManifestDrop[] = [];
    const manifest = parseTourManifest(
      tour({
        minor: TOUR_MANIFEST_MINOR + 1,
        characters: [{ ...WENDEL, frames: WENDEL.image }],
      }),
      { onDropped: (drop) => drops.push(drop) }
    );
    expect(manifest.characters).toEqual([WENDEL]);
    expect(drops).toEqual([
      expect.objectContaining({
        kind: 'character',
        character: 'wendel',
        field: 'characters[0].frames',
      }),
    ]);
  });

  it('is written back as it was read: the same bytes again', () => {
    const once = serializeTourManifest(
      parseTourManifest(tour({ characters: [{ ...WENDEL, frames: 'sheet' }] }))
    );
    expect(JSON.parse(once)).toMatchObject({
      characters: [{ ...WENDEL, frames: 'sheet' }],
    });
    expect(serializeTourManifest(parseTourManifest(JSON.parse(once)))).toBe(
      once
    );
  });
});

describe("a character block's reference to the declaration", () => {
  it("takes its name and image from the declaration, so the writer keeps the block's inline copies in step", () => {
    // Why: the inline name and image are what an older reader shows; a
    // creator who renames the declared character renames him everywhere.
    const manifest = parseTourManifest(
      tour({
        characters: [{ ...WENDEL, name: 'Wendel the Elder', image: 'wendel2' }],
      })
    );
    const block = firstBlock(manifest);
    expect(block).toMatchObject({
      character: 'wendel',
      name: 'Wendel the Elder',
      image: 'wendel2',
    });
    const written = JSON.parse(serializeTourManifest(manifest)) as {
      stations: { children: { children: Record<string, unknown>[] }[] }[];
    };
    expect(written.stations[0]?.children[0]?.children[0]).toMatchObject({
      name: 'Wendel the Elder',
      image: 'wendel2',
      character: 'wendel',
    });
  });

  it('still needs its own valid inline name and image', () => {
    expect(() =>
      parseTourManifest(
        tour({
          stations: [
            station('gate', [figure({ character: 'wendel', name: '' })]),
          ],
        })
      )
    ).toThrow(/name" is empty/);
  });

  it("refuses a reference to no declared character at this reader's own minor", () => {
    expect(() =>
      parseTourManifest(
        tour({ stations: [station('gate', [figure({ character: 'ada' })])] })
      )
    ).toThrow(
      /"stations\[0\]\.children\[0\]\.children\[0\]\.character" must name a character/
    );
  });

  it('a newer minor drops just the reference, keeping the block with its inline name and image', () => {
    const drops: TourManifestDrop[] = [];
    const manifest = parseTourManifest(
      tour({
        minor: TOUR_MANIFEST_MINOR + 1,
        stations: [station('gate', [figure({ character: 'ada' })])],
      }),
      { onDropped: (drop) => drops.push(drop) }
    );
    const block = firstBlock(manifest);
    expect(block).toMatchObject({ name: 'Wendel', image: 'wendel' });
    expect(block).not.toHaveProperty('character');
    expect(drops).toEqual([
      expect.objectContaining({
        kind: 'field',
        block: 'w1',
        field: 'character',
      }),
    ]);
  });
});

describe("the character's five views and the line's end", () => {
  it('lists the views, every one a story view', () => {
    expect(TOUR_CHARACTER_VIEWS).toEqual([
      'bubble',
      'speak',
      'two-stations',
      'portrait',
      'popup',
    ]);
  });

  it.each(TOUR_CHARACTER_VIEWS)('reads a story block in %s', (view) => {
    const manifest = parseTourManifest(
      tour({ stations: [station('gate', [figure({ view })])] })
    );
    expect(firstBlock(manifest)?.view).toBe(view);
  });

  it.each(TOUR_CHARACTER_VIEWS)(
    'reads a free block in %s: he stands directly in a station too',
    (view) => {
      const free = { ...station('gate', []), children: [figure({ view })] };
      const manifest = parseTourManifest(tour({ stations: [free] }));
      expect(manifest.stations[0]?.children[0]).toMatchObject({ view });
    }
  );

  it('refuses a free character on the stage: that figure lives with a story', () => {
    const free = {
      ...station('gate', []),
      children: [figure({ view: 'stage' })],
    };
    expect(() => parseTourManifest(tour({ stations: [free] }))).toThrow(
      /block "w1" stands free in its station/
    );
  });

  it('reads the advance "when the line ends", and refuses an unknown mode at its own minor', () => {
    const manifest = parseTourManifest(
      tour({
        stations: [station('gate', [figure()], { mode: 'lineEnd' })],
      })
    );
    expect(firstBlock(manifest)?.advance).toEqual({ mode: 'lineEnd' });
    expect(() =>
      parseTourManifest(
        tour({ stations: [station('gate', [figure()], { mode: 'wave' })] })
      )
    ).toThrow(/"tap", "auto" or "lineEnd"/);
  });
});

describe('what the writer writes', () => {
  it('a written tour is a fixed point: read and written again, the same bytes', () => {
    const data = tour({
      stations: [
        station(
          'gate',
          [figure({ character: 'wendel', view: 'two-stations' })],
          {
            mode: 'lineEnd',
          }
        ),
        station('well', [
          figure({
            id: 'w2',
            character: 'wendel',
            view: 'portrait',
            voice: 'voice',
          }),
        ]),
      ],
    });
    const once = serializeTourManifest(parseTourManifest(data));
    expect(serializeTourManifest(parseTourManifest(JSON.parse(once)))).toBe(
      once
    );
  });
});
