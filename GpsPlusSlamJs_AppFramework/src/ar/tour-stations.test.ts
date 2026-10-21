/**
 * Why this test matters: `tour.json` carries the tour kit's game content
 * (tour kit plan K1, §8 D7: the full schema in one step) - stations, their
 * steps, scene choices, quizzes and the media assets they name. It is
 * hand-editable external data that later drives what a visitor sees and
 * hears, so every cross-reference must be checked at the boundary: a step
 * naming a missing asset, an image block pointing at an audio file, a
 * choice jumping to a step that does not exist, a quiz whose correct answer
 * is not one of its options. Each would otherwise surface as a broken
 * station in the middle of a walk, far from the file that caused it.
 */

import { describe, expect, it } from 'vitest';

import {
  parseTourAssets,
  parseTourStations,
  type TourAsset,
} from './tour-stations';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const assetsJson = [
  { id: 'gate', path: 'content/gate.jpg', width: 800, height: 600 },
  { id: 'knight', path: 'content/knight.png', width: 512, height: 1024 },
  { id: 'voice', path: 'content/voice.mp3' },
  { id: 'arch', path: 'content/arch.glb' },
  { id: 'clip', path: 'content/clip.mp4' },
];

function assets(): TourAsset[] {
  return parseTourAssets(assetsJson, { fail });
}

const geo = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };

function station(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    geo,
    activateRadiusM: 25,
    foundRadiusM: 5,
    steps: [{ id: 'a', block: { kind: 'text', text: 'Welcome' } }],
    items: [],
    ...extra,
  };
}

function parse(stations: unknown) {
  return parseTourStations(stations, { assets: assets(), fail });
}

describe('parseTourAssets', () => {
  it('accepts allowlisted media named content/<id>.<ext> and derives the kind from the extension', () => {
    const parsed = assets();
    expect(parsed.map((a) => [a.id, a.kind])).toEqual([
      ['gate', 'image'],
      ['knight', 'image'],
      ['voice', 'audio'],
      ['arch', 'model'],
      ['clip', 'video'],
    ]);
    expect(parsed[0]).toEqual({
      id: 'gate',
      path: 'content/gate.jpg',
      kind: 'image',
      width: 800,
      height: 600,
    });
  });

  it.each([
    ['not an array', {}, /"assets" must be an array/],
    [
      'a path-unsafe id',
      [{ id: '../x', path: 'content/x.jpg' }],
      /assets\[0\]\.id/,
    ],
    [
      'a path that is not its own content entry',
      [{ id: 'a', path: 'content/b.jpg' }],
      /assets\[0\]\.path" must be content\/a\.<ext>/,
    ],
    [
      'an SVG (it can carry script, K0)',
      [{ id: 'a', path: 'content/a.svg' }],
      /assets\[0\]\.path/,
    ],
    [
      'a zero image width',
      [{ id: 'a', path: 'content/a.png', width: 0, height: 4 }],
      /assets\[0\]\.width/,
    ],
    [
      'a size on a non-image',
      [{ id: 'a', path: 'content/a.mp3', width: 4, height: 4 }],
      /assets\[0\]\.width.*only for an image/,
    ],
    [
      'a duplicate asset id',
      [
        { id: 'a', path: 'content/a.png' },
        { id: 'a', path: 'content/a.jpg' },
      ],
      /duplicate asset id "a"/,
    ],
  ])('rejects %s', (_label, data, message) => {
    expect(() => parseTourAssets(data, { fail })).toThrow(message);
  });
});

describe('parseTourStations', () => {
  it('accepts a castle station: a character scene with a choice, a model and a quiz', () => {
    const [parsed] = parse([
      station({
        title: 'The gate',
        hint: 'arrow',
        steps: [
          {
            id: 'hello',
            block: {
              kind: 'character',
              name: 'Sir Kurt',
              image: 'knight',
              voice: 'voice',
              caption: 'Welcome to the castle!',
            },
          },
          {
            id: 'ask',
            block: {
              kind: 'choice',
              prompt: 'Where to?',
              options: [
                { id: 'tower', label: 'The tower', goto: 'arch' },
                { id: 'quiz', label: 'A question', goto: 'q' },
              ],
            },
          },
          {
            id: 'arch',
            block: { kind: 'model', asset: 'arch' },
            advance: { mode: 'auto', afterS: 4 },
          },
          {
            id: 'q',
            block: {
              kind: 'quiz',
              question: 'When was the gate built?',
              points: 10,
              answer: { type: 'number', value: 1250, tolerance: 10 },
            },
          },
        ],
      }),
    ]);
    expect(parsed?.title).toBe('The gate');
    expect(parsed?.geo).toEqual(geo);
    expect(parsed?.hint).toBe('arrow');
    expect(parsed?.steps.map((s) => s.block.kind)).toEqual([
      'character',
      'choice',
      'model',
      'quiz',
    ]);
    // Defaults are written out, so a renderer never guesses.
    expect(parsed?.steps[0]?.advance).toEqual({ mode: 'tap' });
    expect(parsed?.steps[2]?.advance).toEqual({ mode: 'auto', afterS: 4 });
  });

  it('defaults the hint to the arrow (K-D6)', () => {
    expect(parse([station()])[0]?.hint).toBe('arrow');
  });

  it('accepts every quiz answer type', () => {
    const hash = 'a'.repeat(64);
    const options = [
      { id: 'x', label: 'X' },
      { id: 'y', label: 'Y' },
    ];
    const answers = [
      { type: 'single', options, correct: 'y' },
      { type: 'multiple', options, correct: ['x', 'y'] },
      { type: 'text', salt: 's1', sha256: [hash] },
      { type: 'number', value: 3.5, tolerance: 0, unit: 'm' },
      { type: 'code', salt: 's2', sha256: [hash, 'b'.repeat(64)] },
    ];
    const [parsed] = parse([
      station({
        steps: answers.map((answer, i) => ({
          id: `q${String(i)}`,
          block: { kind: 'quiz', question: 'Q?', points: 1, answer },
        })),
      }),
    ]);
    expect(
      parsed?.steps.map((s) =>
        s.block.kind === 'quiz' ? s.block.answer.type : null
      )
    ).toEqual(['single', 'multiple', 'text', 'number', 'code']);
  });

  it('accepts answer routes and a default next station that name real stations', () => {
    const stations = parse([
      station({
        id: 's1',
        next: 's2',
        steps: [
          {
            id: 'q',
            block: {
              kind: 'quiz',
              question: 'Left or right?',
              points: 0,
              answer: {
                type: 'single',
                options: [
                  { id: 'l', label: 'Left' },
                  { id: 'r', label: 'Right' },
                ],
                correct: 'l',
              },
              route: { byOption: { l: 's2', r: 's3' }, wrong: 's3' },
            },
          },
        ],
      }),
      station({ id: 's2' }),
      station({ id: 's3' }),
    ]);
    expect(stations[0]?.next).toBe('s2');
    const block = stations[0]?.steps[0]?.block;
    expect(block?.kind === 'quiz' ? block.route : null).toEqual({
      byOption: { l: 's2', r: 's3' },
      wrong: 's3',
    });
  });

  const step = (block: Record<string, unknown>, extra = {}) => ({
    id: 'a',
    block,
    ...extra,
  });
  const single = {
    type: 'single',
    options: [
      { id: 'x', label: 'X' },
      { id: 'y', label: 'Y' },
    ],
    correct: 'x',
  };

  it.each([
    ['not an array', {}, /"stations" must be an array/],
    ['a bad station id', [station({ id: 'a b' })], /stations\[0\]\.id/],
    [
      'a duplicate station id',
      [station(), station()],
      /duplicate station id "s1"/,
    ],
    [
      'a station without a geo pose (no code-only station, D9)',
      [station({ geo: undefined, anchor: { code: 'a1b2c3d4e5f6' } })],
      /stations\[0\]\.geo/,
    ],
    [
      'a bad station geo pose',
      [station({ geo: { ...geo, lat: 95 } })],
      /stations\[0\]\.geo\.lat/,
    ],
    [
      'items that are not a list',
      [station({ items: {} })],
      /stations\[0\]\.items" must be an array/,
    ],
    [
      'an item without a local pose',
      [
        station({
          items: [
            {
              id: 'p1',
              kind: 'pin',
              label: 'Hi',
              createdAtIso: '2026-10-18T06:00:00.000Z',
            },
          ],
        }),
      ],
      /stations\[0\]\.items\[0\]\.pose/,
    ],
    [
      'an item placed absurdly far from its station',
      [
        station({
          items: [
            {
              id: 'p1',
              kind: 'pin',
              label: 'Hi',
              createdAtIso: '2026-10-18T06:00:00.000Z',
              pose: { position: [0, 0, 20_000], rotation: [0, 0, 0, 1] },
            },
          ],
        }),
      ],
      /stations\[0\]\.items\[0\]\.pose\.position" must be three numbers within 10000 m/,
    ],
    [
      'an item whose rotation is not a unit quaternion',
      [
        station({
          items: [
            {
              id: 'p1',
              kind: 'pin',
              label: 'Hi',
              createdAtIso: '2026-10-18T06:00:00.000Z',
              pose: { position: [0, 0, 0], rotation: [0, 0, 0, 2] },
            },
          ],
        }),
      ],
      /stations\[0\]\.items\[0\]\.pose\.rotation" must be a unit quaternion/,
    ],
    [
      'the same item twice in a station',
      [
        station({
          items: [
            {
              id: 'p1',
              kind: 'pin',
              label: 'Hi',
              createdAtIso: '2026-10-18T06:00:00.000Z',
              pose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
            },
            {
              id: 'p1',
              kind: 'pin',
              label: 'Again',
              createdAtIso: '2026-10-18T06:00:00.000Z',
              pose: { position: [1, 0, 0], rotation: [0, 0, 0, 1] },
            },
          ],
        }),
      ],
      /duplicate item id "p1"/,
    ],
    [
      'a found radius larger than the activation radius',
      [station({ foundRadiusM: 30 })],
      /stations\[0\]\.foundRadiusM" must not exceed "activateRadiusM"/,
    ],
    [
      'a zero radius',
      [station({ activateRadiusM: 0 })],
      /stations\[0\]\.activateRadiusM/,
    ],
    ['an unknown hint', [station({ hint: 'map' })], /stations\[0\]\.hint/],
    [
      'a duplicate step id',
      [
        station({
          steps: [
            step({ kind: 'text', text: 'a' }),
            step({ kind: 'text', text: 'b' }),
          ],
        }),
      ],
      /stations\[0\]: duplicate step id "a"/,
    ],
    [
      'an unknown block kind',
      [station({ steps: [step({ kind: 'html' })] })],
      /stations\[0\]\.steps\[0\]\.block\.kind/,
    ],
    [
      'an empty text',
      [station({ steps: [step({ kind: 'text', text: ' ' })] })],
      /steps\[0\]\.block\.text/,
    ],
    [
      'an image block naming a missing asset',
      [station({ steps: [step({ kind: 'image', asset: 'nope' })] })],
      /steps\[0\]\.block\.asset" must name an image asset/,
    ],
    [
      'an image block naming an audio asset',
      [station({ steps: [step({ kind: 'image', asset: 'voice' })] })],
      /steps\[0\]\.block\.asset" must name an image asset/,
    ],
    [
      'a character without a caption (captions always)',
      [
        station({
          steps: [step({ kind: 'character', name: 'K', image: 'knight' })],
        }),
      ],
      /steps\[0\]\.block\.caption/,
    ],
    [
      'a character voice that is not audio',
      [
        station({
          steps: [
            step({
              kind: 'character',
              name: 'K',
              image: 'knight',
              caption: 'Hi',
              voice: 'gate',
            }),
          ],
        }),
      ],
      /steps\[0\]\.block\.voice" must name an audio asset/,
    ],
    [
      'audio without a transcript (audio needs a text version)',
      [station({ steps: [step({ kind: 'audio', asset: 'voice' })] })],
      /steps\[0\]\.block\.transcript/,
    ],
    [
      'video without a transcript',
      [station({ steps: [step({ kind: 'video', asset: 'clip' })] })],
      /steps\[0\]\.block\.transcript/,
    ],
    [
      'a model block naming an image',
      [station({ steps: [step({ kind: 'model', asset: 'gate' })] })],
      /steps\[0\]\.block\.asset" must name a model asset/,
    ],
    [
      'an auto advance without a positive duration',
      [
        station({
          steps: [
            step(
              { kind: 'text', text: 'a' },
              { advance: { mode: 'auto', afterS: 0 } }
            ),
          ],
        }),
      ],
      /steps\[0\]\.advance\.afterS/,
    ],
    [
      'an unknown advance mode',
      [
        station({
          steps: [
            step({ kind: 'text', text: 'a' }, { advance: { mode: 'swipe' } }),
          ],
        }),
      ],
      /steps\[0\]\.advance\.mode/,
    ],
    [
      'a choice with one option',
      [
        station({
          steps: [
            step({
              kind: 'choice',
              prompt: 'P',
              options: [{ id: 'o', label: 'O', goto: 'a' }],
            }),
          ],
        }),
      ],
      /steps\[0\]\.block\.options" must list at least 2/,
    ],
    [
      'a choice jumping to a missing step',
      [
        station({
          steps: [
            step({
              kind: 'choice',
              prompt: 'P',
              options: [
                { id: 'o', label: 'O', goto: 'a' },
                { id: 'p', label: 'P', goto: 'zzz' },
              ],
            }),
          ],
        }),
      ],
      /options\[1\]\.goto" must name a step of this station/,
    ],
    [
      'a negative quiz score',
      [
        station({
          steps: [
            step({ kind: 'quiz', question: 'Q', points: -1, answer: single }),
          ],
        }),
      ],
      /steps\[0\]\.block\.points/,
    ],
    [
      'a single-choice correct answer that is not an option',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: { ...single, correct: 'z' },
            }),
          ],
        }),
      ],
      /block\.answer\.correct" must name one of its options/,
    ],
    [
      'a multiple-choice answer with no correct option',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: { ...single, type: 'multiple', correct: [] },
            }),
          ],
        }),
      ],
      /block\.answer\.correct" must list at least one of its options/,
    ],
    [
      'duplicate option ids',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: {
                ...single,
                options: [
                  { id: 'x', label: 'X' },
                  { id: 'x', label: 'Y' },
                ],
              },
            }),
          ],
        }),
      ],
      /block\.answer\.options: duplicate option id "x"/,
    ],
    [
      'a text answer hash that is not SHA-256 hex',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: { type: 'text', salt: 's', sha256: ['abc'] },
            }),
          ],
        }),
      ],
      /block\.answer\.sha256\[0\]/,
    ],
    [
      'a code answer without a salt',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: { type: 'code', salt: '', sha256: ['a'.repeat(64)] },
            }),
          ],
        }),
      ],
      /block\.answer\.salt/,
    ],
    [
      'a negative number tolerance',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: { type: 'number', value: 1, tolerance: -1 },
            }),
          ],
        }),
      ],
      /block\.answer\.tolerance/,
    ],
    [
      'a default next station that does not exist',
      [station({ next: 'nowhere' })],
      /stations\[0\]\.next" must name a station/,
    ],
    [
      'a route to a missing station',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: single,
              route: { correct: 'nowhere' },
            }),
          ],
        }),
      ],
      /block\.route\.correct" must name a station/,
    ],
    [
      'a route by an option the quiz does not have',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: single,
              route: { byOption: { z: 's1' } },
            }),
          ],
        }),
      ],
      /block\.route\.byOption" names "z", which is not one of its options/,
    ],
    [
      'a route by option on a quiz without options',
      [
        station({
          steps: [
            step({
              kind: 'quiz',
              question: 'Q',
              points: 1,
              answer: { type: 'number', value: 1, tolerance: 0 },
              route: { byOption: { x: 's1' } },
            }),
          ],
        }),
      ],
      /block\.route\.byOption" is only for a choice quiz/,
    ],
  ])('rejects %s', (_label, data, message) => {
    expect(() => parse(data)).toThrow(Invalid);
    expect(() => parse(data)).toThrow(message);
  });
});

describe('version 3 stations (tour editor plan 2026-10-17-1816, W3)', () => {
  // Why: a station is now the parent of what was placed around it. It has
  // its own geo pose and no code (D9), it may have no story at all (an
  // automatic station, D20: finding it completes it), and its pins and
  // photos carry local poses that move with it.
  it('a station may have no steps: an automatic station only groups its items', () => {
    const [parsed] = parse([station({ steps: [] })]);
    expect(parsed?.steps).toEqual([]);
  });

  it('reads its items with their local poses, kind by kind', () => {
    const [parsed] = parse([
      station({
        items: [
          {
            id: 'p1',
            kind: 'pin',
            label: 'The well',
            createdAtIso: '2026-10-18T06:00:00.000Z',
            pose: { position: [1, 0.5, -2], rotation: [0, 0, 0, 1] },
          },
          {
            id: 'f1',
            kind: 'photo',
            image: 'content/f1.jpg',
            imageWidth: 640,
            imageHeight: 480,
            createdAtIso: '2026-10-18T06:01:00.000Z',
            pose: { position: [3, 1.6, 0], rotation: [0, 0.6, 0, 0.8] },
          },
        ],
      }),
    ]);
    expect(parsed?.items).toEqual([
      {
        id: 'p1',
        kind: 'pin',
        label: 'The well',
        createdAtIso: '2026-10-18T06:00:00.000Z',
        pose: { position: [1, 0.5, -2], rotation: [0, 0, 0, 1] },
      },
      {
        id: 'f1',
        kind: 'photo',
        image: 'content/f1.jpg',
        imageWidth: 640,
        imageHeight: 480,
        createdAtIso: '2026-10-18T06:01:00.000Z',
        pose: { position: [3, 1.6, 0], rotation: [0, 0.6, 0, 0.8] },
      },
    ]);
  });

  // Why: a placed model names a model asset, and the reference is
  // resolved here, where the assets are known, so a renderer never meets a
  // model with no file or an image where a model should be.
  const placedModel = (asset: unknown) => ({
    id: 'm1',
    kind: 'model',
    asset,
    sizeM: 3,
    createdAtIso: '2026-10-19T12:00:00.000Z',
    pose: { position: [2, 0, 1], rotation: [0, 0, 0, 1] },
  });

  it('reads a placed model naming a model asset, its size exactly', () => {
    const [parsed] = parse([station({ items: [placedModel('arch')] })]);
    expect(parsed?.items).toEqual([placedModel('arch')]);
  });

  it.each([
    ['a missing asset', 'nowhere'],
    ['an image asset', 'gate'],
    ['an audio asset', 'voice'],
  ])('refuses a placed model naming %s', (_name, asset) => {
    expect(() => parse([station({ items: [placedModel(asset)] })])).toThrow(
      /"stations\[0\]\.items\[0\]\.asset" must name a model asset/
    );
  });

  it('a lenient read leaves out a model whose asset it left out or does not have', () => {
    // A newer minor's model format (here .usdz, unknown to this reader) is
    // left out of the assets; the model naming it cannot be shown.
    const newer = parseTourAssets(
      [...assetsJson, { id: 'tower', path: 'content/tower.usdz' }],
      { fail, lenient: true }
    );
    const [parsed] = parseTourStations(
      [
        station({
          items: [
            placedModel('tower'),
            { ...placedModel('nowhere'), id: 'm2' },
            { ...placedModel('arch'), id: 'm3' },
          ],
        }),
      ],
      { assets: newer, fail, lenient: true }
    );
    expect(parsed?.items.map((i) => i.id)).toEqual(['m3']);
  });

  it('ignores a code a version 2 station named: no station is found by a code any more', () => {
    const [parsed] = parse([station({ anchor: { code: 'a1b2c3d4e5f6' } })]);
    expect(parsed).not.toHaveProperty('anchor');
  });
});

describe("a station's description and card image (minor 2, G2 build plan M1a)", () => {
  // Why: the 3D editor's station cards show a description and a picture
  // (G2 build plan 2026-10-21-2247, §3.4, §4.2.4). Both are station fields
  // a creator types or picks, so the reader keeps exactly what the editor
  // writes (a description trimmed, as the tour's own), refuses a value of
  // the wrong shape at its own minor, and never fails a tour because the
  // picture went: a card image whose photo or asset was deleted is
  // dropped, reported like the cover's `image-gone`, and the write still
  // succeeds (Q14).
  const photoItem = (id: string) => ({
    id,
    kind: 'photo',
    image: `content/${id}.jpg`,
    imageWidth: 640,
    imageHeight: 480,
    createdAtIso: '2026-10-21T06:01:00.000Z',
    pose: { position: [3, 1.6, 0], rotation: [0, 0, 0, 1] },
  });
  const pinItem = {
    id: 'p1',
    kind: 'pin',
    label: 'The well',
    createdAtIso: '2026-10-21T06:00:00.000Z',
    pose: { position: [1, 0.5, -2], rotation: [0, 0, 0, 1] },
  };
  type Drop = { field: string; station: string; cause?: string };
  function parseWithDrops(stations: unknown, lenient = false) {
    const dropped: Drop[] = [];
    const parsed = parseTourStations(stations, {
      assets: assets(),
      fail,
      lenient,
      onDropped: (drop) => {
        dropped.push({
          field: drop.field,
          station: drop.station,
          cause: drop.cause,
        });
      },
    });
    return { parsed, dropped };
  }

  it('reads a description trimmed, line breaks kept, and a blank one as none', () => {
    const [kept, blank] = parse([
      station({ description: '  Up the hill.\nThen left.  ' }),
      station({ id: 's2', description: ' \n ' }),
    ]);
    expect(kept?.description).toBe('Up the hill.\nThen left.');
    expect(blank).not.toHaveProperty('description');
  });

  it("refuses a description that is not text or is longer than the tour's own limit, at its own minor", () => {
    expect(() => parse([station({ description: 42 })])).toThrow(
      /"stations\[0\]\.description" must be text/
    );
    expect(() => parse([station({ description: 'x'.repeat(2001) })])).toThrow(
      /"stations\[0\]\.description" must be text of at most 2000/
    );
    // The limit counts characters, as the tour's description does: 2000
    // emoji are 4000 UTF-16 units and still fit.
    expect(
      parse([station({ description: '\u{1F3F0}'.repeat(2000) })])[0]
        ?.description
    ).toHaveLength(4000);
  });

  it('names a photo of the same station or an image asset of the tour', () => {
    const { parsed, dropped } = parseWithDrops([
      station({ image: 'f1', items: [photoItem('f1')] }),
      station({ id: 's2', image: 'gate' }),
    ]);
    expect(parsed.map((s) => s.image)).toEqual(['f1', 'gate']);
    expect(dropped).toEqual([]);
  });

  it("drops an image naming no picture of the station - another station's photo, a pin, an audio or model asset, a missing id - and says so, never failing the tour", () => {
    const { parsed, dropped } = parseWithDrops([
      station({ image: 'f2', items: [pinItem] }),
      station({ id: 's2', image: 'p1', items: [photoItem('f2')] }),
      station({ id: 's3', image: 'voice' }),
      station({ id: 's4', image: 'arch' }),
      station({ id: 's5', image: 'gone' }),
    ]);
    for (const s of parsed) expect(s).not.toHaveProperty('image');
    expect(dropped).toEqual(
      ['s1', 's2', 's3', 's4', 's5'].map((id) => ({
        field: 'image',
        station: id,
        cause: 'station-image-gone',
      }))
    );
  });

  it('refuses an image that is not an id at its own minor; a newer minor reads it as none', () => {
    for (const image of [42, 'not/an id', '']) {
      expect(() => parse([station({ image })])).toThrow(
        /"stations\[0\]\.image" must be an image id/
      );
      const { parsed, dropped } = parseWithDrops(
        [station({ image, description: 7 })],
        true
      );
      expect(parsed[0]).not.toHaveProperty('image');
      expect(parsed[0]).not.toHaveProperty('description');
      expect(dropped).toEqual([]);
    }
  });
});
