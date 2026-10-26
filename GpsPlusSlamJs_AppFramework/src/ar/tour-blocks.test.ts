/**
 * Why this test matters: a station's blocks (a short text, a long text, a
 * picture, a video, a sound, a 3D model, a character) are hand-editable
 * external data with caps that the editor's counters and every reader must
 * apply alike. A cap counted one way in the editor and another in the
 * reader either refuses a file the editor wrote or lets through a text the
 * world view cannot show. So every cap is pinned at N-1, N and N+1, in
 * the unit it is counted in (code points after trimming and collapsing
 * whitespace; UTF-16 units for a long text's body), with combining marks
 * (two code points, one visible character) and surrogate pairs (one code
 * point, two UTF-16 units) - the two places a naive `.length` or a
 * grapheme count would disagree with the rule. Required texts fail the
 * file over their cap; optional ones are left out and reported; every
 * media reference must name an asset of the right kind.
 */

import { describe, expect, it } from 'vitest';

import {
  checkTourBlockIdsUnique,
  checkTourBlockText,
  placeTourBlocks,
  readTourBlocks,
  TOUR_BLOCK_TEXT_RULES,
  TOUR_BLOCK_VIEWS,
  tourFloorView,
  tourTextCount,
  type TourBlock,
  type TourBlockDrop,
} from './tour-blocks';
import { parseTourAssets } from './tour-stations';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const ASSETS = parseTourAssets(
  [
    { id: 'gate', path: 'content/gate.jpg', width: 800, height: 600 },
    { id: 'voice', path: 'content/voice.mp3' },
    { id: 'arch', path: 'content/arch.glb' },
    { id: 'clip', path: 'content/clip.mp4' },
  ],
  { fail }
);

const pose = { position: [1, 0, 2], rotation: [0, 0, 0, 1] };

/** A valid block of each kind (in a view a free block may stand in where
 *  the kind has one). */
const VALID: Record<TourBlock['kind'], Record<string, unknown>> = {
  shortText: {
    id: 'b1',
    kind: 'shortText',
    view: 'pin',
    pose,
    caption: 'Gate',
  },
  longText: {
    id: 'b2',
    kind: 'longText',
    view: 'card',
    pose,
    title: 'History',
    body: 'Once upon a time.',
  },
  picture: {
    id: 'b3',
    kind: 'picture',
    view: 'plane',
    pose,
    image: 'gate',
    widthM: 1,
  },
  video: {
    id: 'b4',
    kind: 'video',
    view: 'card',
    pose,
    video: 'clip',
    transcript: 'A knight walks by.',
  },
  audio: {
    id: 'b5',
    kind: 'audio',
    view: 'card',
    pose,
    audio: 'voice',
    transcript: 'Hello.',
  },
  model: {
    id: 'b6',
    kind: 'model',
    view: 'placed',
    pose,
    asset: 'arch',
    sizeM: 3,
  },
  character: {
    id: 'b7',
    kind: 'character',
    view: 'stage',
    pose,
    name: 'Knight',
    image: 'gate',
    caption: 'I guard this gate.',
  },
};

interface ReadOptions {
  lenient?: boolean;
  shown?: readonly string[];
  drops?: TourBlockDrop[];
}

/** Read and place `blocks` as one station's, every block shown by a step
 *  unless `shown` says otherwise. */
function parse(blocks: unknown, options: ReadOptions = {}): TourBlock[] {
  const lenient = options.lenient === true;
  const onDropped = (drop: TourBlockDrop): void => {
    options.drops?.push(drop);
  };
  const read = readTourBlocks(blocks, 'blocks', {
    assets: ASSETS,
    fail,
    lenient,
    onDropped,
  });
  const shown = new Set(options.shown ?? read.map((r) => r.block.id));
  return placeTourBlocks(read, shown, { fail, lenient, onDropped });
}

function one(
  kind: TourBlock['kind'],
  patch: Record<string, unknown>,
  options: ReadOptions = {}
): TourBlock | undefined {
  return parse([{ ...VALID[kind], ...patch }], options)[0];
}

/** `n` code points as the rule counts them, written with combining marks
 *  (every other code point a U+0301 on the letter before it). */
function combining(n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += i % 2 === 0 ? 'e' : '́';
  return s;
}

/** `n` code points, each a surrogate pair (two UTF-16 units). */
function astral(n: number): string {
  return '\u{1F600}'.repeat(n);
}

describe('tourTextCount', () => {
  it('counts code points after trimming and collapsing whitespace runs to one space', () => {
    // Why: the editor's counter and the reader must agree on what "40"
    // means; whitespace a creator cannot see must not cost characters.
    expect(tourTextCount('  a \t\n  b  ')).toBe(3);
    expect(tourTextCount('é')).toBe(2);
    expect(tourTextCount('\u{1F600}')).toBe(1);
    expect(tourTextCount('')).toBe(0);
    expect(tourTextCount('  　 ')).toBe(0);
  });

  it('counts UTF-16 units as written for the long text body (no trimming)', () => {
    expect(tourTextCount('\u{1F600}', 'utf16')).toBe(2);
    expect(tourTextCount('  a  ', 'utf16')).toBe(5);
  });
});

describe('checkTourBlockText', () => {
  it('accepts a required text from 1 to its cap and refuses blank, over or non-text', () => {
    const rule = TOUR_BLOCK_TEXT_RULES.shortText.caption;
    expect(checkTourBlockText(rule, 'x')).toEqual({ ok: true, value: 'x' });
    expect(checkTourBlockText(rule, '   ')).toMatchObject({ ok: false });
    expect(checkTourBlockText(rule, 3)).toMatchObject({ ok: false });
    expect(checkTourBlockText(rule, 'x'.repeat(41))).toMatchObject({
      ok: false,
    });
  });

  it('keeps the text exactly as written: readers never rewrite it', () => {
    // Why: a reader that trimmed would make a save rewrite the creator's
    // text without a word; only the COUNT ignores the outer whitespace.
    const rule = TOUR_BLOCK_TEXT_RULES.picture.caption;
    expect(checkTourBlockText(rule, '  two  words ')).toEqual({
      ok: true,
      value: '  two  words ',
    });
  });
});

/** Every capped text field, its kind, whether a value over the cap fails
 *  the file (required) or is dropped (optional), and its unit. */
const CAPPED = [
  ['shortText', 'caption', 40, 'fail'],
  ['shortText', 'description', 160, 'drop'],
  ['longText', 'title', 80, 'fail'],
  ['longText', 'body', 32_000, 'fail'],
  ['picture', 'title', 40, 'drop'],
  ['picture', 'caption', 1200, 'drop'],
  ['picture', 'alt', 300, 'drop'],
  ['video', 'title', 40, 'drop'],
  ['video', 'transcript', 32_000, 'fail'],
  ['audio', 'title', 40, 'drop'],
  ['audio', 'transcript', 32_000, 'fail'],
  ['model', 'title', 80, 'drop'],
  ['character', 'name', 80, 'fail'],
  ['character', 'caption', 2000, 'fail'],
] as const;

describe('every cap at N-1, N and N+1', () => {
  for (const [kind, field, cap, over] of CAPPED) {
    const utf16 = kind === 'longText' && field === 'body';
    describe(`${kind}.${field} (${String(cap)}, ${over} over)`, () => {
      // Each text is built to count exactly n in the field's own unit,
      // in three spellings: plain letters, combining marks, astral.
      const spellings: readonly [string, (n: number) => string][] = utf16
        ? [
            ['letters', (n) => 'a'.repeat(n)],
            // n UTF-16 units of surrogate pairs, plus one letter when odd.
            [
              'surrogate pairs',
              (n) => astral(Math.floor(n / 2)) + 'a'.repeat(n % 2),
            ],
            ['combining marks', (n) => combining(n)],
          ]
        : [
            ['letters', (n) => 'a'.repeat(n)],
            ['combining marks', (n) => combining(n)],
            ['surrogate pairs', (n) => astral(n)],
          ];
      for (const [name, text] of spellings) {
        it(`keeps ${String(cap - 1)} and ${String(cap)} ${name}`, () => {
          for (const n of [cap - 1, cap]) {
            const block = one(kind, { [field]: text(n) }) as unknown as Record<
              string,
              unknown
            >;
            expect(block[field]).toBe(text(n));
          }
        });
        if (over === 'fail') {
          it(`refuses ${String(cap + 1)} ${name}`, () => {
            expect(() => one(kind, { [field]: text(cap + 1) })).toThrow(
              Invalid
            );
          });
        } else {
          it(`drops ${String(cap + 1)} ${name}, and says so`, () => {
            const drops: TourBlockDrop[] = [];
            const block = one(kind, { [field]: text(cap + 1) }, { drops });
            expect(block).toBeDefined();
            expect(field in block!).toBe(false);
            expect(drops).toEqual([
              expect.objectContaining({
                kind: 'field',
                block: block!.id,
                field,
              }),
            ]);
          });
        }
      }
    });
  }

  it('counts an over-long raw text by its collapsed form: 40 letters with whitespace runs and padding is a valid caption', () => {
    // Why: the raw string is 60+ code points; the rule counts 40.
    const caption = `  ${'ab \t\n cd'.repeat(8).replace(/ \t\n /g, ' 　 ')}  `;
    expect(tourTextCount(caption)).toBeLessThanOrEqual(40);
    expect([...caption].length).toBeGreaterThan(40);
    expect(one('shortText', { caption })).toMatchObject({ caption });
  });

  it('a long text body counts UTF-16 units as written: 32 000 spaces around one letter is still at the cap', () => {
    const body = `${' '.repeat(15_999)}a${' '.repeat(16_000)}`;
    expect(body.length).toBe(32_000);
    expect(one('longText', { body })).toMatchObject({ body });
    expect(() => one('longText', { body: `${body} ` })).toThrow(Invalid);
    expect(() => one('longText', { body: ' '.repeat(10) })).toThrow(Invalid);
  });

  it('an optional text that is blank is simply absent, and nothing is reported', () => {
    const drops: TourBlockDrop[] = [];
    const block = one('picture', { caption: '  ' }, { drops });
    expect(block !== undefined && 'caption' in block).toBe(false);
    expect(drops).toEqual([]);
  });

  it('an optional text that is not a string is dropped and reported', () => {
    const drops: TourBlockDrop[] = [];
    const block = one('picture', { alt: 42 }, { drops });
    expect(block !== undefined && 'alt' in block).toBe(false);
    expect(drops).toHaveLength(1);
  });

  it('a required text that is missing or blank fails the file', () => {
    expect(() => one('shortText', { caption: undefined })).toThrow(Invalid);
    expect(() => one('character', { name: ' ' })).toThrow(Invalid);
    expect(() => one('video', { transcript: '' })).toThrow(Invalid);
  });
});

describe('media references and sizes', () => {
  it('every media field names an asset of its own kind', () => {
    // Why: a renderer must never meet a picture that is a sound.
    expect(() => one('picture', { image: 'voice' })).toThrow(/image asset/);
    expect(() => one('picture', { image: 'missing' })).toThrow(Invalid);
    expect(() => one('video', { video: 'gate' })).toThrow(/video asset/);
    expect(() => one('video', { poster: 'clip' })).toThrow(/image asset/);
    expect(one('video', { poster: 'gate' })).toMatchObject({ poster: 'gate' });
    expect(() => one('audio', { audio: 'clip' })).toThrow(/audio asset/);
    expect(() => one('model', { asset: 'gate' })).toThrow(/model asset/);
    expect(() => one('character', { image: 'arch' })).toThrow(/image asset/);
    expect(() => one('character', { voice: 'gate' })).toThrow(/audio asset/);
    expect(one('character', { voice: 'voice' })).toMatchObject({
      voice: 'voice',
    });
  });

  it('a picture is 0.05 to 50 m wide, inclusive', () => {
    for (const widthM of [0.05, 1, 50]) {
      expect(one('picture', { widthM })).toMatchObject({ widthM });
    }
    for (const widthM of [0.049, 50.01, 0, -1, Number.NaN, '1', undefined]) {
      expect(() => one('picture', { widthM })).toThrow(Invalid);
    }
  });

  it('sizeM is required for a placed model, refused for a staged one and optional in a card', () => {
    // Why: a placed model is drawn at its size in metres; a staged one at
    // its file's own size, so a size there would be a number nobody reads.
    expect(() => one('model', { sizeM: undefined })).toThrow(/sizeM/);
    expect(() => one('model', { view: 'stage' })).toThrow(/sizeM/);
    expect(one('model', { view: 'stage', sizeM: undefined })).toMatchObject({
      view: 'stage',
    });
    const card = one('model', { view: 'card', sizeM: undefined });
    expect(card !== undefined && 'sizeM' in card).toBe(false);
    expect(one('model', { view: 'card' })).toMatchObject({ sizeM: 3 });
    for (const sizeM of [0.05, 500]) {
      expect(one('model', { sizeM })).toMatchObject({ sizeM });
    }
    for (const sizeM of [0.049, 500.1, 0, Number.POSITIVE_INFINITY]) {
      expect(() => one('model', { sizeM })).toThrow(Invalid);
    }
  });

  it('keeps createdAtIso when it is a timestamp and refuses one that is not', () => {
    const at = '2026-10-26T10:00:00.000Z';
    expect(one('shortText', { createdAtIso: at })).toMatchObject({
      createdAtIso: at,
    });
    expect(() => one('shortText', { createdAtIso: 'yesterday' })).toThrow(
      Invalid
    );
  });

  it('every block carries a local pose', () => {
    expect(() => one('longText', { pose: undefined })).toThrow(/pose/);
  });
});

describe('ids', () => {
  it('a block id is a short path-safe id, up to 64 characters', () => {
    expect(one('shortText', { id: 'a'.repeat(64) })).toMatchObject({
      id: 'a'.repeat(64),
    });
    expect(() => one('shortText', { id: 'a'.repeat(65) })).toThrow(Invalid);
    expect(() => one('shortText', { id: 'a b' })).toThrow(Invalid);
  });

  it('a block id may equal an asset id (separate namespaces), but two blocks may not share one', () => {
    // Why: every reference is typed (a picture names an asset, a show
    // step a block), so a shared string is never ambiguous.
    expect(one('picture', { id: 'gate', image: 'gate' })).toMatchObject({
      id: 'gate',
      image: 'gate',
    });
    expect(() =>
      parse([VALID.shortText, { ...VALID.picture, id: 'b1' }])
    ).toThrow(/duplicate block id "b1"/);
  });

  it('checkTourBlockIdsUnique refuses one block id in two stations', () => {
    const blocks = parse([VALID.shortText]);
    expect(() =>
      checkTourBlockIdsUnique([{ blocks }, { blocks: [] }], fail)
    ).not.toThrow();
    expect(() =>
      checkTourBlockIdsUnique([{ blocks }, { blocks }], fail)
    ).toThrow(/duplicate block id "b1"/);
  });
});

describe('views', () => {
  it('lists the views this reader draws, per kind', () => {
    expect(TOUR_BLOCK_VIEWS).toEqual({
      shortText: ['pin', 'card'],
      longText: ['card'],
      picture: ['plane', 'card'],
      video: ['card'],
      audio: ['card'],
      model: ['placed', 'stage', 'card'],
      character: ['stage', 'card'],
    });
  });

  it("refuses a view the kind does not have, at this reader's own minor", () => {
    expect(() => one('shortText', { view: 'plane' })).toThrow(/view/);
    expect(() => one('longText', { view: 'reading' })).toThrow(/view/);
  });

  it("refuses a block of an unknown kind at this reader's own minor", () => {
    expect(() => parse([{ ...VALID.shortText, kind: 'primitives' }])).toThrow(
      /kind/
    );
  });

  it('a free block (no step shows it) must stand in the world: pin, plane or placed', () => {
    // Why: a free block in a card would have no moment to open, and a
    // staged figure lives only while a story runs.
    for (const kind of ['shortText', 'picture', 'model'] as const) {
      expect(parse([VALID[kind]], { shown: [] })).toHaveLength(1);
    }
    for (const kind of ['longText', 'video', 'audio', 'character'] as const) {
      expect(() => parse([VALID[kind]], { shown: [] })).toThrow(
        /no step shows/
      );
    }
    expect(() =>
      parse([{ ...VALID.shortText, view: 'card' }], { shown: [] })
    ).toThrow(/no step shows/);
  });

  it("the floor view: the kind's own world view for a free block, card for a story block", () => {
    expect(tourFloorView('shortText', 'free')).toBe('pin');
    expect(tourFloorView('picture', 'free')).toBe('plane');
    expect(tourFloorView('model', 'free')).toBe('placed');
    for (const kind of ['longText', 'video', 'audio', 'character'] as const) {
      expect(tourFloorView(kind, 'free')).toBeNull();
    }
    for (const kind of Object.keys(VALID) as TourBlock['kind'][]) {
      expect(tourFloorView(kind, 'story')).toBe('card');
    }
  });
});

describe('a file of a newer minor (lenient)', () => {
  it('a story block in an unknown view falls back to card', () => {
    const drops: TourBlockDrop[] = [];
    const [block] = parse([{ ...VALID.shortText, view: 'sign' }], {
      lenient: true,
      drops,
    });
    expect(block).toMatchObject({ id: 'b1', view: 'card' });
  });

  it("a free block in an unknown view falls back to its kind's world view", () => {
    const [pin] = parse([{ ...VALID.shortText, view: 'sign' }], {
      lenient: true,
      shown: [],
    });
    expect(pin).toMatchObject({ view: 'pin' });
    const [placed] = parse([{ ...VALID.model, view: 'pedestal' }], {
      lenient: true,
      shown: [],
    });
    expect(placed).toMatchObject({ view: 'placed', sizeM: 3 });
  });

  it('a free long text in an unknown view is skipped and reported', () => {
    // Why: 4.0 has no world view for a long text; the reader cannot draw
    // it, so it says so instead of inventing a placement.
    const drops: TourBlockDrop[] = [];
    const blocks = parse([{ ...VALID.longText, view: 'reading' }], {
      lenient: true,
      shown: [],
      drops,
    });
    expect(blocks).toEqual([]);
    expect(drops).toEqual([
      expect.objectContaining({ kind: 'block', block: 'b2' }),
    ]);
  });

  it('a free model in an unknown view without a size is skipped (no size to place it at)', () => {
    const drops: TourBlockDrop[] = [];
    const blocks = parse(
      [{ ...VALID.model, view: 'pedestal', sizeM: undefined }],
      { lenient: true, shown: [], drops }
    );
    expect(blocks).toEqual([]);
    expect(drops).toHaveLength(1);
  });

  it('a block of an unknown kind, or naming an asset this reader does not have, is skipped and reported', () => {
    const drops: TourBlockDrop[] = [];
    const blocks = parse(
      [
        { ...VALID.shortText, id: 'x1', kind: 'primitives' },
        { ...VALID.picture, id: 'x2', image: 'splat' },
        VALID.shortText,
      ],
      { lenient: true, drops }
    );
    expect(blocks.map((b) => b.id)).toEqual(['b1']);
    expect(drops.map((d) => d.block)).toEqual(['x1', 'x2']);
  });

  it('a required text over its cap skips the block; an optional one is left out silently', () => {
    // Why: a newer minor may widen a cap; this reader cannot show what it
    // would have to cut, and the drop of an optional value is that
    // minor's business (the tour details' rule).
    const drops: TourBlockDrop[] = [];
    const blocks = parse(
      [
        { ...VALID.shortText, id: 'x1', caption: 'a'.repeat(41) },
        { ...VALID.shortText, description: 'a'.repeat(161) },
      ],
      { lenient: true, drops }
    );
    expect(blocks).toEqual([
      expect.not.objectContaining({ description: expect.anything() }),
    ]);
    expect(blocks.map((b) => b.id)).toEqual(['b1']);
    expect(drops.map((d) => [d.kind, d.block])).toEqual([['block', 'x1']]);
  });

  it("never throws on a newer minor's shapes inside a block list", () => {
    const odd = [
      { ...VALID.video, view: 'porthole', start: { trigger: 'look' } },
      { ...VALID.picture, view: 'thenNow', viewpoint: { hfovDeg: 60 } },
      { ...VALID.audio, mode: 'soundscape' },
      { kind: 'primitives', id: 'p', pose, parts: [] },
    ];
    expect(() => parse(odd, { lenient: true })).not.toThrow();
  });
});

describe('the exact words a tour author reads, and shapes coerced into valid ones', () => {
  // Why this test matters: the messages name the field path and the rule
  // broken, which is all a hand-editing author has to go on; the tests
  // above match only a fragment, so a message that lost its path, its
  // unit or its article still passed. And a number or an array where a
  // string belongs can coerce into a valid id, kind or timestamp
  // (`String(['shortText'])`, `Date.parse(123)`, a regex test on 123),
  // which the reader must refuse rather than accept by accident.
  it('says which field broke which rule, in words', () => {
    expect(() => one('shortText', { caption: 'x'.repeat(41) })).toThrow(
      '"blocks[0].caption" is longer than 40 characters'
    );
    expect(
      checkTourBlockText(
        TOUR_BLOCK_TEXT_RULES.longText.body,
        'x'.repeat(32_001)
      )
    ).toEqual({ ok: false, reason: 'is longer than 32000 UTF-16 units' });
    expect(() => one('picture', { image: 'voice' })).toThrow(
      '"blocks[0].image" must name an image asset'
    );
    expect(() => one('audio', { audio: 'clip' })).toThrow(
      '"blocks[0].audio" must name an audio asset'
    );
    expect(() => one('video', { video: 'gate' })).toThrow(
      '"blocks[0].video" must name a video asset'
    );
    expect(() => one('model', { asset: 'gate' })).toThrow(
      '"blocks[0].asset" must name a model asset'
    );
    expect(() => one('picture', { widthM: 60 })).toThrow(
      '"blocks[0].widthM" must be a number of metres from 0.05 to 50'
    );
    expect(() => one('shortText', { view: 'plane' })).toThrow(
      '"blocks[0].view" must be pin, card for a shortText'
    );
    expect(() => one('shortText', { createdAtIso: 'yesterday' })).toThrow(
      '"blocks[0].createdAtIso" must be an ISO-8601 timestamp'
    );
    expect(() => one('shortText', { id: 'a b' })).toThrow(
      '"blocks[0].id" must be a short path-safe id'
    );
    expect(() => parse([VALID.shortText, 42])).toThrow(
      '"blocks[1]" must be an object'
    );
    expect(() => parse([null])).toThrow('"blocks[0]" must be an object');
  });

  it('refuses a number or an array that would coerce into a valid id, kind or timestamp', () => {
    expect(() => one('shortText', { id: 123 })).toThrow(Invalid);
    expect(() => one('shortText', { kind: ['shortText'] })).toThrow(Invalid);
    expect(() => one('shortText', { createdAtIso: 123 })).toThrow(Invalid);
  });

  it('a size that is not positive is malformed even for a newer minor; one out of range only skips the block', () => {
    for (const widthM of [0, -1]) {
      expect(() => one('picture', { widthM }, { lenient: true })).toThrow(
        Invalid
      );
    }
    expect(one('picture', { widthM: 60 }, { lenient: true })).toBeUndefined();
  });

  it('an optional text over its cap is left out without a listener too', () => {
    const read = readTourBlocks(
      [{ ...VALID.shortText, description: 'x'.repeat(10_000) }],
      'blocks',
      { assets: ASSETS, fail }
    );
    expect(read.map((r) => r.block)).toEqual([
      expect.not.objectContaining({ description: expect.anything() }),
    ]);
  });
});
