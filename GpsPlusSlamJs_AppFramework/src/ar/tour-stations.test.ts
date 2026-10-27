/**
 * Why this test matters: `tour.json` carries the tour's game content -
 * stations, the blocks they show, their stories (shows, choices,
 * quizzes) and the media assets the blocks name. It is hand-editable
 * external data that later drives what a visitor sees and hears, so every
 * cross-reference must be checked at the boundary: a block naming a
 * missing asset, a picture pointing at an audio file, a show naming
 * another station's block, a choice jumping to a step that does not
 * exist, a quiz whose correct answer is not one of its options. Each
 * would otherwise surface as a broken station in the middle of a walk,
 * far from the file that caused it.
 */

import { describe, expect, it } from 'vitest';

import { parseTourAssets, type TourAsset } from './tour-assets';
import { parseTourStations } from './tour-stations';

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
const POSE = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

/** A long text shown by a step, so a station has a story. */
const welcome = (id = 'welcome') => ({
  id,
  kind: 'longText',
  view: 'card',
  title: 'Welcome',
  body: 'Welcome',
  pose: POSE,
});

function station(extra: Record<string, unknown> = {}): Record<string, unknown> {
  const id = typeof extra.id === 'string' ? extra.id : 's1';
  return {
    id,
    geo,
    activateRadiusM: 25,
    foundRadiusM: 5,
    blocks: [welcome(`welcome-${id}`)],
    steps: [{ id: 'a', action: { kind: 'show', block: `welcome-${id}` } }],
    ...extra,
  };
}

function parse(stations: unknown) {
  return parseTourStations(stations, { assets: assets(), fail });
}

describe('parseTourStations', () => {
  it('accepts a castle station: a character scene with a choice, a model and a quiz', () => {
    const [parsed] = parse([
      station({
        title: 'The gate',
        hint: 'arrow',
        blocks: [
          {
            id: 'kurt',
            kind: 'character',
            view: 'stage',
            name: 'Sir Kurt',
            image: 'knight',
            voice: 'voice',
            caption: 'Welcome to the castle!',
            pose: POSE,
          },
          {
            id: 'arch-model',
            kind: 'model',
            view: 'stage',
            asset: 'arch',
            pose: POSE,
          },
        ],
        steps: [
          { id: 'hello', action: { kind: 'show', block: 'kurt' } },
          {
            id: 'ask',
            action: {
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
            action: { kind: 'show', block: 'arch-model' },
            advance: { mode: 'auto', afterS: 4 },
          },
          {
            id: 'q',
            action: {
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
    expect(parsed?.steps.map((s) => s.action.kind)).toEqual([
      'show',
      'choice',
      'show',
      'quiz',
    ]);
    expect(parsed?.blocks.map((b) => [b.id, b.kind, b.view])).toEqual([
      ['kurt', 'character', 'stage'],
      ['arch-model', 'model', 'stage'],
    ]);
    // Defaults are written out, so a renderer never guesses.
    expect(parsed?.steps[0]?.advance).toEqual({ mode: 'tap' });
    expect(parsed?.steps[2]?.advance).toEqual({ mode: 'auto', afterS: 4 });
  });

  it('defaults the hint to the arrow', () => {
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
        blocks: [],
        steps: answers.map((answer, i) => ({
          id: `q${String(i)}`,
          action: { kind: 'quiz', question: 'Q?', points: 1, answer },
        })),
      }),
    ]);
    expect(
      parsed?.steps.map((s) =>
        s.action.kind === 'quiz' ? s.action.answer.type : null
      )
    ).toEqual(['single', 'multiple', 'text', 'number', 'code']);
  });

  it('ignores a station next and a quiz route, even naming no station: routing is not part of the format', () => {
    // Why: both were the walk's answer-routing, which left the format;
    // they are unknown fields now, ignored like any other, never checked
    // and never kept, so no writer writes them back.
    const stations = parse([
      station({
        id: 's1',
        next: 'nowhere',
        blocks: [],
        steps: [
          {
            id: 'q',
            action: {
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
              route: { byOption: { l: 'nowhere', z: 's3' }, wrong: 9 },
            },
          },
        ],
      }),
      station({ id: 's3' }),
    ]);
    expect(stations[0]).not.toHaveProperty('next');
    expect(stations[0]?.steps[0]?.action).not.toHaveProperty('route');
  });

  /** A station whose one step is `action` (and no blocks). */
  const withStep = (action: Record<string, unknown>, extra = {}) =>
    station({ blocks: [], steps: [{ id: 'a', action, ...extra }] });
  /** A station whose one block (shown by its one step) is `block`. */
  const withBlock = (block: Record<string, unknown>) =>
    station({
      blocks: [{ id: 'b', view: 'card', pose: POSE, ...block }],
      steps: [{ id: 'a', action: { kind: 'show', block: 'b' } }],
    });
  const quiz = (extra: Record<string, unknown>) => ({
    kind: 'quiz',
    question: 'Q',
    points: 1,
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
  const placedPin = (
    id: string,
    position: unknown[],
    rotation = [0, 0, 0, 1]
  ) => ({
    id,
    kind: 'shortText',
    view: 'pin',
    caption: 'Hi',
    pose: { position, rotation },
  });

  it.each([
    ['not an array', {}, /"stations" must be an array/],
    ['a bad station id', [station({ id: 'a b' })], /stations\[0\]\.id/],
    [
      'a duplicate station id',
      [station(), { ...station(), blocks: [], steps: [] }],
      /duplicate station id "s1"/,
    ],
    [
      'a station without a geo pose (no code-only station)',
      [station({ geo: undefined, anchor: { code: 'a1b2c3d4e5f6' } })],
      /stations\[0\]\.geo/,
    ],
    [
      'a bad station geo pose',
      [station({ geo: { ...geo, lat: 95 } })],
      /stations\[0\]\.geo\.lat/,
    ],
    [
      'blocks that are not a list',
      [station({ blocks: {} })],
      /stations\[0\]\.blocks" must be an array/,
    ],
    [
      'steps that are not a list',
      [station({ steps: {} })],
      /stations\[0\]\.steps" must be an array/,
    ],
    [
      'a block without a local pose',
      [
        station({
          blocks: [{ ...placedPin('p1', [0, 0, 0]), pose: undefined }],
          steps: [],
        }),
      ],
      /stations\[0\]\.blocks\[0\]\.pose/,
    ],
    [
      'a block placed absurdly far from its station',
      [station({ blocks: [placedPin('p1', [0, 0, 20_000])], steps: [] })],
      /stations\[0\]\.blocks\[0\]\.pose\.position" must be three numbers within 10000 m/,
    ],
    [
      'a block whose rotation is not a unit quaternion',
      [
        station({
          blocks: [placedPin('p1', [0, 0, 0], [0, 0, 0, 2])],
          steps: [],
        }),
      ],
      /stations\[0\]\.blocks\[0\]\.pose\.rotation" must be a unit quaternion/,
    ],
    [
      'the same block twice in a station',
      [
        station({
          blocks: [placedPin('p1', [0, 0, 0]), placedPin('p1', [1, 0, 0])],
          steps: [],
        }),
      ],
      /duplicate block id "p1"/,
    ],
    [
      'the same block id in two stations (block ids are tour-wide)',
      [
        station({ blocks: [placedPin('p1', [0, 0, 0])], steps: [] }),
        station({ id: 's2', blocks: [placedPin('p1', [0, 0, 0])], steps: [] }),
      ],
      /duplicate block id "p1"/,
    ],
    [
      "a show naming another station's block",
      [
        station({
          blocks: [welcome('w1')],
          steps: [{ id: 'a', action: { kind: 'show', block: 'w1' } }],
        }),
        station({
          id: 's2',
          blocks: [],
          steps: [{ id: 'a', action: { kind: 'show', block: 'w1' } }],
        }),
      ],
      /stations\[1\]\.steps\[0\]\.action\.block" must name a block of this station/,
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
            { id: 'a', action: { kind: 'show', block: 'welcome-s1' } },
            { id: 'a', action: { kind: 'show', block: 'welcome-s1' } },
          ],
        }),
      ],
      /stations\[0\]\.steps: duplicate step id "a"/,
    ],
    [
      'an unknown step kind',
      [withStep({ kind: 'html' })],
      /stations\[0\]\.steps\[0\]\.action\.kind/,
    ],
    [
      'a step stored under the earlier key block',
      [
        station({
          steps: [{ id: 'a', block: { kind: 'show', block: 'welcome-s1' } }],
        }),
      ],
      /stations\[0\]\.steps\[0\]\.action/,
    ],
    [
      'an unknown block kind',
      [withBlock({ kind: 'html' })],
      /stations\[0\]\.blocks\[0\]\.kind/,
    ],
    [
      'an empty long text',
      [withBlock({ kind: 'longText', title: 'T', body: ' ' })],
      /blocks\[0\]\.body/,
    ],
    [
      'a picture naming a missing asset',
      [withBlock({ kind: 'picture', image: 'nope', widthM: 1 })],
      /blocks\[0\]\.image" must name an image asset/,
    ],
    [
      'a picture naming an audio asset',
      [withBlock({ kind: 'picture', image: 'voice', widthM: 1 })],
      /blocks\[0\]\.image" must name an image asset/,
    ],
    [
      'a character without a caption (captions always)',
      [
        withBlock({
          kind: 'character',
          view: 'stage',
          name: 'K',
          image: 'knight',
        }),
      ],
      /blocks\[0\]\.caption/,
    ],
    [
      'a character voice that is not audio',
      [
        withBlock({
          kind: 'character',
          view: 'stage',
          name: 'K',
          image: 'knight',
          caption: 'Hi',
          voice: 'gate',
        }),
      ],
      /blocks\[0\]\.voice" must name an audio asset/,
    ],
    [
      'audio without a transcript (audio needs a text version)',
      [withBlock({ kind: 'audio', audio: 'voice' })],
      /blocks\[0\]\.transcript/,
    ],
    [
      'video without a transcript',
      [withBlock({ kind: 'video', video: 'clip' })],
      /blocks\[0\]\.transcript/,
    ],
    [
      'a model naming an image',
      [withBlock({ kind: 'model', asset: 'gate' })],
      /blocks\[0\]\.asset" must name a model asset/,
    ],
    [
      'an auto advance without a positive duration',
      [
        station({
          steps: [
            {
              id: 'a',
              action: { kind: 'show', block: 'welcome-s1' },
              advance: { mode: 'auto', afterS: 0 },
            },
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
            {
              id: 'a',
              action: { kind: 'show', block: 'welcome-s1' },
              advance: { mode: 'swipe' },
            },
          ],
        }),
      ],
      /steps\[0\]\.advance\.mode/,
    ],
    [
      'a choice with one option',
      [
        withStep({
          kind: 'choice',
          prompt: 'P',
          options: [{ id: 'o', label: 'O', goto: 'a' }],
        }),
      ],
      /steps\[0\]\.action\.options" must list at least 2/,
    ],
    [
      'a choice jumping to a missing step',
      [
        withStep({
          kind: 'choice',
          prompt: 'P',
          options: [
            { id: 'o', label: 'O', goto: 'a' },
            { id: 'p', label: 'P', goto: 'zzz' },
          ],
        }),
      ],
      /options\[1\]\.goto" must name a step of this station/,
    ],
    [
      'a negative quiz score',
      [withStep(quiz({ points: -1, answer: single }))],
      /steps\[0\]\.action\.points/,
    ],
    [
      'a single-choice correct answer that is not an option',
      [withStep(quiz({ answer: { ...single, correct: 'z' } }))],
      /action\.answer\.correct" must name one of its options/,
    ],
    [
      'a multiple-choice answer with no correct option',
      [
        withStep(
          quiz({ answer: { ...single, type: 'multiple', correct: [] } })
        ),
      ],
      /action\.answer\.correct" must list at least one of its options/,
    ],
    [
      'duplicate option ids',
      [
        withStep(
          quiz({
            answer: {
              ...single,
              options: [
                { id: 'x', label: 'X' },
                { id: 'x', label: 'Y' },
              ],
            },
          })
        ),
      ],
      /action\.answer\.options: duplicate option id "x"/,
    ],
    [
      'a text answer hash that is not SHA-256 hex',
      [
        withStep(
          quiz({ answer: { type: 'text', salt: 's', sha256: ['abc'] } })
        ),
      ],
      /action\.answer\.sha256\[0\]/,
    ],
    [
      'a code answer without a salt',
      [
        withStep(
          quiz({ answer: { type: 'code', salt: '', sha256: ['a'.repeat(64)] } })
        ),
      ],
      /action\.answer\.salt/,
    ],
    [
      'a negative number tolerance',
      [withStep(quiz({ answer: { type: 'number', value: 1, tolerance: -1 } }))],
      /action\.answer\.tolerance/,
    ],
  ])('rejects %s', (_label, data, message) => {
    expect(() => parse(data)).toThrow(Invalid);
    expect(() => parse(data)).toThrow(message);
  });
});

describe('stations as the parent of what was placed around them', () => {
  // Why: a station has its own geo pose and no code, it may have no story
  // at all (an automatic station: finding it completes it), and its
  // blocks carry local poses that move with it.
  it('a station may have no steps: an automatic station only groups its free blocks', () => {
    const [parsed] = parse([
      station({ blocks: [placedPinAt('p1')], steps: [] }),
    ]);
    expect(parsed?.steps).toEqual([]);
    expect(parsed?.blocks.map((b) => b.id)).toEqual(['p1']);
  });

  it('reads its free blocks with their local poses, kind by kind', () => {
    const pin = {
      id: 'p1',
      kind: 'shortText',
      view: 'pin',
      caption: 'The well',
      createdAtIso: '2026-10-18T06:00:00.000Z',
      pose: { position: [1, 0.5, -2], rotation: [0, 0, 0, 1] },
    };
    const picture = {
      id: 'f1',
      kind: 'picture',
      view: 'plane',
      image: 'gate',
      widthM: 1,
      createdAtIso: '2026-10-18T06:01:00.000Z',
      pose: { position: [3, 1.6, 0], rotation: [0, 0.6, 0, 0.8] },
    };
    const model = {
      id: 'm1',
      kind: 'model',
      view: 'placed',
      asset: 'arch',
      sizeM: 3,
      pose: { position: [2, 0, 1], rotation: [0, 0, 0, 1] },
    };
    const [parsed] = parse([
      station({ blocks: [pin, picture, model], steps: [] }),
    ]);
    expect(parsed?.blocks).toEqual([pin, picture, model]);
  });

  it('a lenient read leaves out a model whose asset it left out or does not have', () => {
    // A newer minor's model format (here .usdz, unknown to this reader) is
    // left out of the assets; the model naming it cannot be shown.
    const newer = parseTourAssets(
      [...assetsJson, { id: 'tower', path: 'content/tower.usdz' }],
      { fail, lenient: true }
    );
    const placedModel = (id: string, asset: string) => ({
      id,
      kind: 'model',
      view: 'placed',
      asset,
      sizeM: 3,
      pose: POSE,
    });
    const [parsed] = parseTourStations(
      [
        station({
          blocks: [
            placedModel('m1', 'tower'),
            placedModel('m2', 'nowhere'),
            placedModel('m3', 'arch'),
          ],
          steps: [],
        }),
      ],
      { assets: newer, fail, lenient: true }
    );
    expect(parsed?.blocks.map((b) => b.id)).toEqual(['m3']);
  });

  it('ignores a code an earlier station named: no station is found by a code any more', () => {
    const [parsed] = parse([station({ anchor: { code: 'a1b2c3d4e5f6' } })]);
    expect(parsed).not.toHaveProperty('anchor');
  });

  it('ignores the earlier items list: what a station shows is its blocks', () => {
    const [parsed] = parse([station({ items: [{ id: 'p1', kind: 'pin' }] })]);
    expect(parsed).not.toHaveProperty('items');
  });
});

function placedPinAt(id: string) {
  return {
    id,
    kind: 'shortText',
    view: 'pin',
    caption: 'Hi',
    pose: POSE,
  };
}

describe("a station's description and card image", () => {
  // Why: the 3D editor's station cards show a description and a picture.
  // Both are station fields a creator types or picks, so the reader keeps
  // exactly what the editor writes (a description trimmed, as the tour's
  // own), and never fails a tour over either: a value of the wrong shape
  // is dropped and reported (the writer refuses it), and a card image
  // whose image asset was deleted is dropped, reported like the cover's
  // `image-gone`, and the write still succeeds.
  type Drop = { field: string; station: string; cause?: string };
  function parseWithDrops(stations: unknown, lenient = false) {
    const dropped: Drop[] = [];
    const parsed = parseTourStations(stations, {
      assets: parseTourAssets(assetsJson, { fail, lenient }),
      fail,
      lenient,
      onDropped: (drop) => {
        if (!('station' in drop)) return;
        const d = drop;
        dropped.push({
          field: d.field,
          station: d.station,
          ...(d.cause === undefined ? {} : { cause: d.cause }),
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

  it("drops a description that is not text or is longer than the tour's own limit, and says so, never failing the tour", () => {
    // Why (as the tour details): a hand-edited 2001 character description
    // must cost the description, not the tour - a refused tour cannot even
    // be opened in the editor to fix it. The drop carries no cause, so the
    // writer still refuses such a value loudly.
    const { parsed, dropped } = parseWithDrops([
      station({ description: 42 }),
      station({ id: 's2', description: 'x'.repeat(2001) }),
    ]);
    for (const s of parsed) expect(s).not.toHaveProperty('description');
    expect(dropped).toEqual(
      ['s1', 's2'].map((id) => ({ field: 'description', station: id }))
    );
    expect(() => parse([station({ description: 42 })])).not.toThrow();
    // The limit counts characters, as the tour's description does: 2000
    // emoji are 4000 UTF-16 units and still fit.
    expect(
      parse([station({ description: '\u{1F3F0}'.repeat(2000) })])[0]
        ?.description
    ).toHaveLength(4000);
  });

  it('names an image asset of the tour', () => {
    const { parsed, dropped } = parseWithDrops([
      station({ image: 'gate' }),
      station({ id: 's2', image: 'knight' }),
    ]);
    expect(parsed.map((s) => s.image)).toEqual(['gate', 'knight']);
    expect(dropped).toEqual([]);
  });

  it('drops an image naming no image asset - a block, an audio or model asset, a missing id - and says so, never failing the tour', () => {
    const { parsed, dropped } = parseWithDrops([
      station({ image: 'p1', blocks: [placedPinAt('p1')], steps: [] }),
      station({ id: 's3', image: 'voice' }),
      station({ id: 's4', image: 'arch' }),
      station({ id: 's5', image: 'gone' }),
    ]);
    for (const s of parsed) expect(s).not.toHaveProperty('image');
    expect(dropped).toEqual(
      ['s1', 's3', 's4', 's5'].map((id) => ({
        field: 'image',
        station: id,
        cause: 'station-image-gone',
      }))
    );
  });

  it('drops an image that is not an id and says so, with no cause (the writer refuses it)', () => {
    for (const image of [42, 'not/an id', '']) {
      const { parsed, dropped } = parseWithDrops([station({ image })]);
      expect(parsed[0]).not.toHaveProperty('image');
      expect(dropped).toEqual([{ field: 'image', station: 's1' }]);
    }
  });

  it("a newer minor's malformed values read as none, unreported: that minor may have widened the rule", () => {
    for (const image of [42, 'not/an id', '']) {
      const { parsed, dropped } = parseWithDrops(
        [station({ image, description: 7 })],
        true
      );
      expect(parsed[0]).not.toHaveProperty('image');
      expect(parsed[0]).not.toHaveProperty('description');
      expect(dropped).toEqual([]);
    }
  });

  it("a newer minor's image naming what this reader skipped is left out unreported, never called gone", () => {
    // Why: a lenient read leaves out what it cannot show (an asset of a
    // newer media type); the picture is not gone, this reader just cannot
    // see it. Saying "gone" would be false, and such a tour is never
    // written back here anyway.
    const dropped: Drop[] = [];
    const parsed = parseTourStations([station({ image: 'f9' })], {
      assets: parseTourAssets(
        [...assetsJson, { id: 'f9', path: 'content/f9.heic' }],
        { fail, lenient: true }
      ),
      fail,
      lenient: true,
      onDropped: (drop) => {
        if ('station' in drop) dropped.push(drop);
      },
    });
    expect(parsed[0]).not.toHaveProperty('image');
    expect(dropped).toEqual([]);
  });
});
