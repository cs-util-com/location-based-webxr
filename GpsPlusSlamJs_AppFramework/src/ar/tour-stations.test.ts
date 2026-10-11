/**
 * Why this test matters: `tour.json` v2 carries the tour kit's game content
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
  return parseTourAssets(assetsJson, { objectIds: new Set(), fail });
}

const geo = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };

function station(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    anchor: { geo },
    activateRadiusM: 25,
    foundRadiusM: 5,
    steps: [{ id: 'a', block: { kind: 'text', text: 'Welcome' } }],
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
    expect(() => parseTourAssets(data, { objectIds: new Set(), fail })).toThrow(
      message
    );
  });

  it('rejects an asset id an object already uses, since both name a content file by id', () => {
    expect(() =>
      parseTourAssets([{ id: 'p1', path: 'content/p1.jpg' }], {
        objectIds: new Set(['p1']),
        fail,
      })
    ).toThrow(/assets\[0\]\.id" "p1" is already an object id/);
  });
});

describe('parseTourStations', () => {
  it('accepts a castle station: a character scene with a choice, a model and a quiz', () => {
    const [parsed] = parse([
      station({
        title: 'The gate',
        anchor: { code: 'a1b2c3d4e5f6', geo },
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
    expect(parsed?.anchor.code).toBe('a1b2c3d4e5f6');
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
      'an anchor with neither code nor geo',
      [station({ anchor: {} })],
      /stations\[0\]\.anchor" needs a code, a geo pose, or both/,
    ],
    [
      'an anchor code that cannot be a level id',
      [station({ anchor: { code: '../x' } })],
      /stations\[0\]\.anchor\.code/,
    ],
    [
      'a bad anchor geo pose',
      [station({ anchor: { geo: { ...geo, lat: 95 } } })],
      /stations\[0\]\.anchor\.geo\.lat/,
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
      'no steps',
      [station({ steps: [] })],
      /stations\[0\]\.steps" must be a non-empty array/,
    ],
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
