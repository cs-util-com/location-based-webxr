/**
 * Why this test matters: in version 4 a station's story only orders and
 * asks - a step shows one of the station's blocks, asks a choice, or asks
 * a quiz. Every reference is resolved at the boundary so the scene player
 * never meets a dangling id: a `show` names a block of THIS station (never
 * another station's), a choice's `goto` names a step of this station or is
 * absent (continue at the next step), a block no step shows stands in the
 * world. A file of a newer minor may carry what this reader cannot show;
 * then it must skip it without failing, and without leaving a `show` that
 * names a skipped block or a choice with fewer than two ways on.
 */

import { describe, expect, it } from 'vitest';

import type { TourBlockDrop } from './tour-blocks';
import { parseTourAssets } from './tour-stations';
import {
  parseTourStationContent,
  serializeTourStationContent,
  type TourStationContent,
} from './tour-story';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const ASSETS = parseTourAssets(
  [
    { id: 'gate', path: 'content/gate.jpg', width: 800, height: 600 },
    { id: 'clip', path: 'content/clip.mp4' },
  ],
  { fail }
);

const pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

const pin = {
  id: 'sign',
  kind: 'shortText',
  view: 'pin',
  pose,
  caption: 'Gate',
};
const text = {
  id: 'intro',
  kind: 'longText',
  view: 'card',
  pose,
  title: 'Welcome',
  body: 'This gate is old.',
};
const video = {
  id: 'film',
  kind: 'video',
  view: 'card',
  pose,
  video: 'clip',
  transcript: 'Knights.',
};

const show = (id: string, block: string) => ({
  id,
  action: { kind: 'show', block },
});

const quiz = {
  id: 'q',
  action: {
    kind: 'quiz',
    question: 'How old?',
    points: 3,
    answer: {
      type: 'single',
      options: [
        { id: 'a', label: 'Old' },
        { id: 'b', label: 'New' },
      ],
      correct: 'a',
    },
  },
};

interface Options {
  lenient?: boolean;
  drops?: TourBlockDrop[];
}

function parse(
  content: { blocks: unknown[]; steps: unknown[] },
  options: Options = {}
): TourStationContent {
  return parseTourStationContent(content, 'stations[0]', {
    assets: ASSETS,
    fail,
    lenient: options.lenient === true,
    onDropped: (drop) => options.drops?.push(drop),
  });
}

describe('the story: show, choice, quiz', () => {
  it('reads show, choice and quiz steps, each tap to advance unless it says otherwise', () => {
    const content = parse({
      blocks: [pin, text],
      steps: [
        show('s1', 'intro'),
        {
          id: 'c',
          advance: { mode: 'auto', afterS: 4 },
          action: {
            kind: 'choice',
            prompt: 'Where next?',
            options: [
              { id: 'x', label: 'Again', goto: 's1' },
              { id: 'y', label: 'On' },
            ],
          },
        },
        quiz,
      ],
    });
    expect(content.steps).toEqual([
      {
        id: 's1',
        action: { kind: 'show', block: 'intro' },
        advance: { mode: 'tap' },
      },
      {
        id: 'c',
        action: {
          kind: 'choice',
          prompt: 'Where next?',
          options: [
            { id: 'x', label: 'Again', goto: 's1' },
            { id: 'y', label: 'On' },
          ],
        },
        advance: { mode: 'auto', afterS: 4 },
      },
      {
        id: 'q',
        action: quiz.action,
        advance: { mode: 'tap' },
      },
    ]);
    expect(content.blocks.map((b) => b.id)).toEqual(['sign', 'intro']);
  });

  it('a show step naming no block of this station fails', () => {
    // Why: a step showing nothing the station has is a broken file, as a
    // choice jumping to no step is (another station's block: the
    // manifest's tests, where block ids are tour-wide).
    expect(() =>
      parse({ blocks: [pin], steps: [show('s1', 'other-station-block')] })
    ).toThrow(/must name a block of this station/);
  });

  it('two steps may show one block (it is shown again)', () => {
    const content = parse({
      blocks: [text],
      steps: [show('a', 'intro'), show('b', 'intro')],
    });
    expect(content.steps).toHaveLength(2);
  });

  it('a choice goto is optional; one naming no step of this station fails', () => {
    expect(() =>
      parse({
        blocks: [],
        steps: [
          {
            id: 'c',
            action: {
              kind: 'choice',
              prompt: '?',
              options: [
                { id: 'x', label: 'X', goto: 'nowhere' },
                { id: 'y', label: 'Y' },
              ],
            },
          },
        ],
      })
    ).toThrow(/must name a step of this station/);
  });

  it('a choice needs two options with unique ids, and steps unique ids', () => {
    const choice = (options: unknown[]) => ({
      id: 'c',
      action: { kind: 'choice', prompt: '?', options },
    });
    expect(() =>
      parse({ blocks: [], steps: [choice([{ id: 'x', label: 'X' }])] })
    ).toThrow(/at least 2/);
    expect(() =>
      parse({
        blocks: [],
        steps: [
          choice([
            { id: 'x', label: 'X' },
            { id: 'x', label: 'Y' },
          ]),
        ],
      })
    ).toThrow(/duplicate option id "x"/);
    expect(() =>
      parse({ blocks: [text], steps: [show('a', 'intro'), show('a', 'intro')] })
    ).toThrow(/duplicate step id "a"/);
  });

  it('a quiz is read as before, and a quiz route is no longer part of the format (ignored)', () => {
    const content = parse({
      blocks: [],
      steps: [
        {
          ...quiz,
          action: { ...quiz.action, route: { correct: 'elsewhere' } },
        },
      ],
    });
    expect('route' in (content.steps[0]?.action ?? {})).toBe(false);
  });

  it("refuses an unknown action kind at this reader's own minor", () => {
    expect(() =>
      parse({ blocks: [], steps: [{ id: 'a', action: { kind: 'dance' } }] })
    ).toThrow(/action\.kind/);
  });
});

describe('free and story blocks', () => {
  it('a block no step shows must stand in the world: a free card is refused', () => {
    expect(() => parse({ blocks: [text], steps: [] })).toThrow(
      /no step shows block "intro"/
    );
    expect(parse({ blocks: [pin], steps: [] }).blocks).toHaveLength(1);
  });

  it('a story block may be in a world view too (it appears when shown)', () => {
    const content = parse({ blocks: [pin], steps: [show('a', 'sign')] });
    expect(content.blocks[0]).toMatchObject({ view: 'pin' });
  });
});

describe('a file of a newer minor (lenient)', () => {
  it('a goto naming no step is reported at its step index in the file, past a skipped step', () => {
    // Why: the message is what an author reads to find the broken step; an
    // index into the steps left after the skipped ones points at the wrong
    // one.
    expect(() =>
      parse(
        {
          blocks: [text],
          steps: [
            { id: 'later', action: { kind: 'showTogether', blocks: [] } },
            {
              id: 'c',
              action: {
                kind: 'choice',
                prompt: '?',
                options: [
                  { id: 'x', label: 'X', goto: 'nowhere' },
                  { id: 'y', label: 'Y' },
                ],
              },
            },
            show('s', 'intro'),
          ],
        },
        { lenient: true }
      )
    ).toThrow(/steps\[1\]\.action\.options\[0\]\.goto/);
  });

  it('a free long text in an unknown view is skipped and reported', () => {
    const drops: TourBlockDrop[] = [];
    const content = parse(
      { blocks: [pin, { ...text, view: 'reading' }], steps: [] },
      { lenient: true, drops }
    );
    expect(content.blocks.map((b) => b.id)).toEqual(['sign']);
    expect(drops).toEqual([
      expect.objectContaining({ kind: 'block', block: 'intro' }),
    ]);
  });

  it('a story long text in an unknown view falls back to the card', () => {
    const content = parse(
      { blocks: [{ ...text, view: 'reading' }], steps: [show('a', 'intro')] },
      { lenient: true }
    );
    expect(content.blocks[0]).toMatchObject({ view: 'card' });
  });

  it('a show step naming a skipped block goes with it, and so does a choice left with one way on', () => {
    // Why: a scene must never reach a step whose block was never read,
    // nor a choice whose only remaining option is no choice at all.
    const content = parse(
      {
        blocks: [{ ...video, kind: 'hologram' }, text],
        steps: [
          show('s1', 'film'),
          show('s2', 'intro'),
          {
            id: 'c',
            action: {
              kind: 'choice',
              prompt: '?',
              options: [
                { id: 'x', label: 'X', goto: 's1' },
                { id: 'y', label: 'Y', goto: 's2' },
              ],
            },
          },
        ],
      },
      { lenient: true }
    );
    expect(content.steps.map((s) => s.id)).toEqual(['s2']);
  });

  it('an option without a goto always stays reachable (it continues at the next step)', () => {
    const content = parse(
      {
        blocks: [{ ...video, kind: 'hologram' }, text],
        steps: [
          show('s1', 'film'),
          {
            id: 'c',
            action: {
              kind: 'choice',
              prompt: '?',
              options: [
                { id: 'x', label: 'X', goto: 's1' },
                { id: 'y', label: 'Y' },
                { id: 'z', label: 'Z' },
              ],
            },
          },
          show('s2', 'intro'),
        ],
      },
      { lenient: true }
    );
    expect(content.steps.map((s) => s.id)).toEqual(['c', 's2']);
    const choice = content.steps[0]?.action;
    expect(
      choice?.kind === 'choice' && choice.options.map((o) => o.id)
    ).toEqual(['y', 'z']);
  });

  it('a block shown only by a step this reader skips is free, and a free card is then skipped, never failing', () => {
    // A newer minor's step kind may be what shows the long text here.
    const drops: TourBlockDrop[] = [];
    const content = parse(
      {
        blocks: [text],
        steps: [
          { id: 'a', action: { kind: 'showTogether', blocks: ['intro'] } },
        ],
      },
      { lenient: true, drops }
    );
    expect(content).toEqual({ blocks: [], steps: [] });
    expect(drops.map((d) => d.block)).toEqual(['intro']);
  });

  it('a quiz of an unknown answer type is skipped', () => {
    const content = parse(
      {
        blocks: [],
        steps: [
          {
            ...quiz,
            action: { ...quiz.action, answer: { type: 'map-pick' } },
          },
        ],
      },
      { lenient: true }
    );
    expect(content.steps).toEqual([]);
  });
});

describe('serializeTourStationContent', () => {
  it('writes what the reader reads back, and fails loud on a value a reader would drop', () => {
    const content = parse({ blocks: [pin, text], steps: [show('a', 'intro')] });
    const record = serializeTourStationContent(content, { assets: ASSETS });
    expect(
      parse(
        JSON.parse(JSON.stringify(record)) as {
          blocks: unknown[];
          steps: unknown[];
        }
      )
    ).toEqual(content);
    const broken = {
      ...content,
      blocks: [{ ...content.blocks[0]!, description: 'x'.repeat(161) }],
    } as TourStationContent;
    expect(() =>
      serializeTourStationContent(broken, { assets: ASSETS, fail })
    ).toThrow(/description/);
  });

  it('refuses a free card, which no reader would accept', () => {
    const content = parse({ blocks: [text], steps: [show('a', 'intro')] });
    expect(() =>
      serializeTourStationContent(
        { ...content, steps: [] },
        { assets: ASSETS, fail }
      )
    ).toThrow(Invalid);
  });
});
