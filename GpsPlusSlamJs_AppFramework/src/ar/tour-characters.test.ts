/**
 * Why this test matters: a recurring character is declared ONCE for the
 * tour (`characters`) and appears at several stations as a story block in
 * one of five views, its step moving on by itself when the line ends. All
 * of it is an additive minor (2): the writer keeps the block's inline name
 * and image, so an app that reads only an older minor still shows him by
 * name and words, and it must never refuse the tour. The last block of
 * tests opens the file with the reader the framework actually released
 * (1.31.0, minor 0), not with a simulation of one.
 */

import { describe, expect, it } from 'vitest';

import {
  parseTourManifest as parseReleased,
  serializeTourManifest as serializeReleased,
} from 'tour-reader-1-31/ar/tour-manifest';

import { TOUR_CHARACTER_VIEWS, parseTourCharacters } from './tour-characters';
import {
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
  TourManifestValidationError,
  type TourManifestDrop,
} from './tour-manifest';

const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const GEO = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };
const ASSETS = [
  { id: 'wendel', path: 'content/wendel.png', width: 512, height: 1024 },
  { id: 'wendel2', path: 'content/wendel2.png', width: 512, height: 1024 },
  { id: 'voice', path: 'content/voice.mp3' },
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
    blocks,
    steps: blocks.map((b, i) => ({
      id: `s${String(i)}`,
      action: { kind: 'show', block: (b as { id: string }).id },
      ...(advance === undefined ? {} : { advance }),
    })),
  };
}

function tour(extra: Record<string, unknown> = {}) {
  return {
    version: 4,
    minor: 2,
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

describe("a character block's reference to the declaration", () => {
  it("takes its name and image from the declaration, so the writer keeps the block's inline copies in step", () => {
    // Why: the inline name and image are what an older reader shows; a
    // creator who renames the declared character renames him everywhere.
    const manifest = parseTourManifest(
      tour({
        characters: [{ ...WENDEL, name: 'Wendel the Elder', image: 'wendel2' }],
      })
    );
    const block = manifest.stations[0]?.blocks[0];
    expect(block).toMatchObject({
      character: 'wendel',
      name: 'Wendel the Elder',
      image: 'wendel2',
    });
    const written = JSON.parse(serializeTourManifest(manifest)) as {
      stations: { blocks: Record<string, unknown>[] }[];
    };
    expect(written.stations[0]?.blocks[0]).toMatchObject({
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
    ).toThrow(/"stations\[0\]\.blocks\[0\]\.character" must name a character/);
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
    const block = manifest.stations[0]?.blocks[0];
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
    expect(manifest.stations[0]?.blocks[0]?.view).toBe(view);
  });

  it.each(TOUR_CHARACTER_VIEWS)(
    'refuses a free block in %s: he speaks only as a step',
    (view) => {
      const free = { ...station('gate', []), blocks: [figure({ view })] };
      expect(() => parseTourManifest(tour({ stations: [free] }))).toThrow(
        /no step shows block "w1"/
      );
    }
  );

  it('reads the advance "when the line ends", and refuses an unknown mode at its own minor', () => {
    const manifest = parseTourManifest(
      tour({
        stations: [station('gate', [figure()], { mode: 'lineEnd' })],
      })
    );
    expect(manifest.stations[0]?.steps[0]?.advance).toEqual({
      mode: 'lineEnd',
    });
    expect(() =>
      parseTourManifest(
        tour({ stations: [station('gate', [figure()], { mode: 'wave' })] })
      )
    ).toThrow(/"tap", "auto" or "lineEnd"/);
  });
});

describe('the minor the writer writes', () => {
  const minorOf = (data: unknown): number =>
    (
      JSON.parse(serializeTourManifest(parseTourManifest(data))) as {
        minor: number;
      }
    ).minor;
  const plain = figure({ view: 'stage' });

  it('is 2 when anything of the character uses minor 2, and lower once nothing does', () => {
    expect(TOUR_MANIFEST_MINOR).toBe(2);
    const without = { characters: undefined };
    expect(
      minorOf(tour({ ...without, stations: [station('g', [plain])] }))
    ).toBe(0);
    expect(minorOf(tour({ stations: [station('g', [plain])] }))).toBe(2);
    for (const view of TOUR_CHARACTER_VIEWS) {
      expect(
        minorOf(
          tour({ ...without, stations: [station('g', [figure({ view })])] })
        )
      ).toBe(2);
    }
    expect(
      minorOf(
        tour({
          ...without,
          stations: [station('g', [plain], { mode: 'lineEnd' })],
        })
      )
    ).toBe(2);
    expect(
      minorOf(
        tour({
          ...without,
          stations: [station('g', [plain], { mode: 'auto', afterS: 3 })],
        })
      )
    ).toBe(0);
  });

  it('a written minor-2 tour is a fixed point: read and written again, the same bytes', () => {
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

describe('the released reader (framework 1.31.0, minor 0) opens a minor-2 tour', () => {
  // Why: "additive" is a promise to readers already on phones. This is
  // the published package's own parser, installed as a dev dependency.
  const written = JSON.parse(
    serializeTourManifest(
      parseTourManifest(
        tour({
          stations: [
            station(
              'gate',
              [
                figure({
                  character: 'wendel',
                  view: 'two-stations',
                  voice: 'voice',
                }),
              ],
              { mode: 'lineEnd' }
            ),
          ],
        })
      )
    )
  ) as unknown;

  it('shows him as a card with his inline name, image and words, and taps on instead of waiting for the line', () => {
    const old = parseReleased(written);
    const block = old.stations[0]?.blocks[0];
    expect(block).toMatchObject({
      kind: 'character',
      view: 'card',
      name: 'Wendel',
      image: 'wendel',
      caption: 'Welcome to the old gate. Follow me to the well.',
      voice: 'voice',
    });
    expect(old.stations[0]?.steps[0]?.advance).toEqual({ mode: 'tap' });
    expect(old).not.toHaveProperty('characters');
  });

  it('refuses to write it back, instead of dropping what it cannot read', () => {
    expect(() => serializeReleased(parseReleased(written))).toThrow(
      /made with a newer version of the app/
    );
  });
});
