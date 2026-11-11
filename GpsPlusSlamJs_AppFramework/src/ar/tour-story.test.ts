/**
 * Why this test matters: a station holds one ordered list of children, free
 * blocks standing in the world and stories with their own blocks, choices
 * and quizzes. A block lives in exactly one place, so being inside a story
 * is what shows it. Every reference is resolved at the boundary so the
 * scene player never meets a dangling id. A file of a newer minor may carry
 * what this reader cannot show; then it must skip it without failing, and
 * without leaving a choice with fewer than two ways on.
 */

import { describe, expect, it } from 'vitest';

import { TOUR_BLOCK_VIEWS, tourTextCount } from './tour-blocks';
import { parseTourAssets } from './tour-assets';
import { tourFreeBlocks } from './tour-station-pose';
import {
  checkTourChildIdsUnique,
  isStory,
  parseTourStationChildren,
  TOUR_CHILD_KINDS,
  tourChildPlace,
  tourChildrenBlocks,
  tourChildrenPlace,
  tourChildrenStories,
  tourStationBlocks,
  tourStationChildIds,
  tourStationStoryBlocks,
  tourStories,
  tourStoryBlocks,
  tourStoryChildrenBlocks,
  type TourChildDrop,
  type TourStationChild,
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

// Every rule below is what keeps the visitor's player and the editor's tree from meeting a
// dangling jump, a block in two places, or a free card nobody can reach.
// The editor writes story folders FIRST and free items below them, so no
// test here (and nothing in the reader) may assume free blocks come first.

type ChildrenOptions = { lenient?: boolean; drops?: TourChildDrop[] };

function childrenRead(value: unknown, options: ChildrenOptions = {}) {
  return parseTourStationChildren(value, 'stations[0].children', {
    assets: ASSETS,
    fail,
    lenient: options.lenient === true,
    onDropped: (drop) => options.drops?.push(drop),
  });
}

function children(
  value: unknown,
  options: ChildrenOptions = {}
): TourStationChild[] {
  return childrenRead(value, options).children;
}

const storyOf = (id: string, kids: unknown[], title = 'The old gate') => ({
  id,
  kind: 'folder',
  role: 'story',
  title,
  children: kids,
});
const choiceOf = (id: string, gotos: (string | undefined)[]) => ({
  id,
  kind: 'choice',
  prompt: 'Where next?',
  options: gotos.map((goto, i) => ({
    id: `o${String(i)}`,
    label: `Option ${String(i)}`,
    ...(goto === undefined ? {} : { goto }),
  })),
});
// The quiz action already carries `kind: 'quiz'`.
const quizOf = (id: string) => ({ id, ...quiz.action });
const tap = { mode: 'tap' } as const;

describe('children: what a valid file says is what is read', () => {
  it('reads stories and free blocks in the order of the file, stories first or last', () => {
    // Why: the editor puts story folders first and free items below; a
    // hand-made file may do the opposite or interleave. Both orders read,
    // and the order is kept as written (nothing sorts free blocks first).
    const story = storyOf('welcome', [text]);
    const storiesFirst = children([story, pin]);
    expect(storiesFirst.map((c) => c.id)).toEqual(['welcome', 'sign']);
    const freeFirst = children([pin, story]);
    expect(freeFirst.map((c) => c.id)).toEqual(['sign', 'welcome']);
    expect(storiesFirst[0]).toEqual({
      id: 'welcome',
      kind: 'folder',
      role: 'story',
      title: 'The old gate',
      children: [{ ...text, advance: tap }],
    });
    expect(storiesFirst[1]).toEqual(pin);
  });

  it('a free block in a card fails; the same block inside a story reads', () => {
    // Why: a free block stands in the world while its station is shown; a
    // card opens only when a story reaches it, so a free card is content
    // no visitor can ever see.
    expect(() => children([text])).toThrow(/must stand in the world/);
    const [story] = children([storyOf('s', [text])]);
    expect(story).toMatchObject({ children: [{ id: 'intro', view: 'card' }] });
  });

  it('a story block in a world view reads (it appears when reached)', () => {
    const [story] = children([storyOf('s', [pin])]);
    expect(story).toMatchObject({ children: [{ id: 'sign', view: 'pin' }] });
  });

  it('a story block without an advance reads as a tap; one with an advance keeps it', () => {
    const [story] = children([
      storyOf('s', [
        text,
        { ...pin, advance: { mode: 'auto', afterS: 4 } },
        { ...video, advance: { mode: 'lineEnd' } },
      ]),
    ]);
    expect(
      story !== undefined &&
        isStory(story) &&
        story.children.map((c) => ('advance' in c ? c.advance : null))
    ).toEqual([tap, { mode: 'auto', afterS: 4 }, { mode: 'lineEnd' }]);
  });

  it("a free block's advance, and a choice's or a quiz's, is ignored and never read", () => {
    // Why: only a story block moves on; an advance anywhere else is an
    // unknown field. Even a malformed one must not fail the file, and it
    // must not reach the writer.
    const read = children([
      { ...pin, advance: 'soon' },
      storyOf('s', [
        { ...choiceOf('c', [undefined, undefined]), advance: { mode: 'x' } },
        { ...quizOf('q'), advance: 7 },
      ]),
    ]);
    expect(read[0]).toEqual(pin);
    expect('advance' in (read[0] ?? {})).toBe(false);
    const story = read[1];
    expect(
      story !== undefined &&
        isStory(story) &&
        story.children.map((c) => 'advance' in c)
    ).toEqual([false, false]);
  });

  it('an empty story reads (the editor holds one while it is being filled)', () => {
    expect(children([storyOf('s', [])])).toEqual([storyOf('s', [])]);
  });

  it('an empty station reads', () => {
    expect(children([])).toEqual([]);
  });

  it('a story holds blocks, choices and quizzes; a choice jumps back or forward within its story', () => {
    const read = children([
      storyOf('s', [
        text,
        choiceOf('c', ['intro', 'q', undefined]),
        quizOf('q'),
      ]),
    ]);
    expect(read).toEqual([
      storyOf('s', [
        { ...text, advance: tap },
        choiceOf('c', ['intro', 'q', undefined]),
        quizOf('q'),
      ]),
    ]);
  });

  it('the kinds a child may have besides the block kinds are disjoint from them', () => {
    // Why: `kind` is the one discriminant of every child; a block kind named
    // "folder", "choice" or "quiz" would make a file mean two things.
    const childKinds: readonly string[] = TOUR_CHILD_KINDS;
    expect(childKinds).toEqual(['folder', 'choice', 'quiz']);
    expect(
      Object.keys(TOUR_BLOCK_VIEWS).filter((k) => childKinds.includes(k))
    ).toEqual([]);
  });
});

describe('children: what fails the file (strict)', () => {
  it("a goto naming another story's child, a free block, its own story or nothing fails, named by its index in the file", () => {
    // Why: a choice jumps within its own story only; anything else would
    // leave the player in a story the visitor did not pick, or nowhere.
    const other = storyOf('b', [{ ...pin, id: 'there' }]);
    for (const target of ['there', 'sign', 'a', 'nowhere']) {
      expect(() =>
        children([
          pin,
          other,
          storyOf('a', [text, choiceOf('c', [target, undefined])]),
        ])
      ).toThrow(
        /"stations\[0\]\.children\[2\]\.children\[1\]\.options\[0\]\.goto" must name a child of this story/
      );
    }
  });

  it('a goto is reported at its index in the file, past a child a lenient reader skipped', () => {
    expect(() =>
      children(
        [
          storyOf('a', [
            { id: 'later', kind: 'scene' },
            choiceOf('c', ['nowhere', undefined]),
          ]),
        ],
        { lenient: true }
      )
    ).toThrow(/children\[0\]\.children\[1\]\.options\[0\]\.goto/);
  });

  it('ids are one namespace in a station: blocks, stories, choices and quizzes', () => {
    const cases: [string, unknown[]][] = [
      [
        'two stories sharing a child id',
        [storyOf('a', [text]), storyOf('b', [{ ...text }])],
      ],
      ['a story and a free block sharing an id', [pin, storyOf('sign', [])]],
      ['a story and its own child sharing an id', [storyOf('intro', [text])]],
      [
        'a choice and a free block sharing an id',
        [pin, storyOf('a', [choiceOf('sign', [undefined, undefined])])],
      ],
      ['two free blocks sharing an id', [pin, { ...pin }]],
    ];
    for (const [name, value] of cases) {
      expect(() => children(value), name).toThrow(/duplicate child id/);
    }
  });

  it('option ids repeat in one choice: fails; across two choices: reads', () => {
    const twice = {
      ...choiceOf('c', [undefined, undefined]),
      options: [
        { id: 'x', label: 'X' },
        { id: 'x', label: 'Y' },
      ],
    };
    expect(() => children([storyOf('a', [twice])])).toThrow(
      /duplicate option id "x"/
    );
    const read = children([
      storyOf('a', [
        choiceOf('c1', [undefined, undefined]),
        choiceOf('c2', [undefined, undefined]),
      ]),
    ]);
    expect(read).toHaveLength(1);
  });

  it('a choice needs at least two options', () => {
    expect(() =>
      children([storyOf('a', [choiceOf('c', [undefined])])])
    ).toThrow(/at least 2 options/);
  });

  it('a story title is required: missing, blank or not text fails', () => {
    for (const title of [undefined, '', '  \n ', 7]) {
      expect(() =>
        children([
          { id: 's', kind: 'folder', role: 'story', title, children: [] },
        ])
      ).toThrow(/"stations\[0\]\.children\[0\]\.title"/);
    }
  });

  it('a story title counts code points by the shared count: 80 reads, 81 fails, with a combining mark and a surrogate pair inside', () => {
    // Why: the boundary is counted ONE way (`tourTextCount`), the way the
    // editor's counter counts. A combining mark is a code point of its
    // own; a surrogate pair is one code point and two UTF-16 units, so a
    // UTF-16 count would refuse the 80 here and a grapheme count would
    // accept the 81.
    const eighty = 'a'.repeat(76) + 'é' + '\u{1F600}' + 'b';
    expect(tourTextCount(eighty)).toBe(80);
    expect(eighty.length).toBe(81);
    const [read] = children([storyOf('s', [], eighty)]);
    expect(read).toMatchObject({ title: eighty });
    expect(() => children([storyOf('s', [], `${eighty}c`)])).toThrow(
      /title" is longer than 80 characters/
    );
    // Whitespace runs and padding are not counted, and the title is kept as
    // written; the lower boundary, one code point, reads.
    const padded = `  ${'a'.repeat(39)} \t\n ${'b'.repeat(40)}  `;
    expect(tourTextCount(padded)).toBe(80);
    expect(children([storyOf('s', [], padded)])[0]).toMatchObject({
      title: padded,
    });
    expect(children([storyOf('s', [], 'x')])).toHaveLength(1);
  });

  it('a story without a children list, or a station children value that is no list, fails', () => {
    expect(() =>
      children([{ id: 's', kind: 'folder', role: 'story', title: 'T' }])
    ).toThrow(/children\[0\]\.children" must be an array/);
    expect(() => children({ blocks: [] })).toThrow(
      /"stations\[0\]\.children" must be an array/
    );
  });

  it("a child of a kind unknown in its place fails at this reader's minor", () => {
    expect(() => children([{ id: 'x', kind: 'scene' }])).toThrow(
      /children\[0\]\.kind" must be/
    );
    // Choices and quizzes live in a story only; stories do not nest.
    expect(() => children([choiceOf('c', [undefined, undefined])])).toThrow(
      /children\[0\]\.kind" must be/
    );
    expect(() => children([storyOf('a', [storyOf('b', [])])])).toThrow(
      /children\[0\]\.children\[0\]\.kind" must be/
    );
    expect(() =>
      children([storyOf('a', [{ ...text, advance: { mode: 'gaze' } }])])
    ).toThrow(/advance\.mode/);
  });
});

describe('children: ids across stations', () => {
  const read = (value: unknown[]) => childrenRead(value);

  it('a choice id used in two stations fails', () => {
    const a = read([storyOf('a', [choiceOf('c', [undefined, undefined])])]);
    const b = read([storyOf('b', [choiceOf('c', [undefined, undefined])])]);
    expect(() => checkTourChildIdsUnique([a, b], fail)).toThrow(
      /duplicate child id "c"/
    );
  });

  it("a story id equal to another station's free block fails", () => {
    const a = read([pin]);
    const b = read([storyOf('sign', [])]);
    expect(() => checkTourChildIdsUnique([a, b], fail)).toThrow(
      /duplicate child id "sign"/
    );
  });

  it("a quiz id equal to another station's story id fails", () => {
    const a = read([storyOf('gate', [])]);
    const b = read([storyOf('b', [quizOf('gate')])]);
    expect(() => checkTourChildIdsUnique([a, b], fail)).toThrow(
      /duplicate child id "gate"/
    );
  });

  it('distinct ids across stations pass, asset ids being a namespace of their own', () => {
    const a = read([pin, storyOf('a', [text])]);
    const b = read([storyOf('gate', [quizOf('q')])]);
    expect(() => checkTourChildIdsUnique([a, b], fail)).not.toThrow();
  });

  it('an id a lenient read left out still counts across stations', () => {
    // Why: a newer minor's child this reader cannot show still owns its id
    // in the file; another station reusing it is a duplicate there, as it
    // is within one station. Each case: what station 0 left out, and the
    // id station 1's free block reuses.
    const lenient = (value: unknown[]) =>
      childrenRead(value, { lenient: true });
    const cases: [unknown[], string][] = [
      [[{ id: 'x', kind: 'scene' }], 'x'],
      [[storyOf('a', [{ id: 'x', kind: 'scene' }])], 'x'],
      [[storyOf('a', [{ ...quizOf('x'), answer: { type: 'map-pick' } }])], 'x'],
      [
        [
          storyOf('a', [
            choiceOf('x', ['gone', undefined]),
            { id: 'gone', kind: 'scene' },
          ]),
        ],
        'x',
      ],
      [[storyOf('x', [text], 't'.repeat(81))], 'x'],
      [[storyOf('a', [text], 't'.repeat(81))], 'intro'],
    ];
    for (const [first, id] of cases) {
      const a = lenient(first);
      const b = lenient([{ ...pin, id }]);
      expect(() => checkTourChildIdsUnique([a, b], fail)).toThrow(
        `duplicate child id "${id}"`
      );
    }
  });
});

describe('children: a file of a newer minor (lenient)', () => {
  it('an unknown child kind is skipped and reported, at the station and in a story', () => {
    const drops: TourChildDrop[] = [];
    const read = children(
      [
        { id: 'scene1', kind: 'scene' },
        storyOf('a', [{ id: 'scene2', kind: 'scene' }, text]),
        pin,
      ],
      { lenient: true, drops }
    );
    expect(read.map((c) => c.id)).toEqual(['a', 'sign']);
    expect(read[0]).toMatchObject({ children: [{ id: 'intro' }] });
    expect(drops).toEqual([
      expect.objectContaining({ kind: 'child', child: 'scene1' }),
      expect.objectContaining({ kind: 'child', child: 'scene2' }),
    ]);
  });

  it('an option pruned from a choice that keeps two ways on is reported', () => {
    // Why: the visitor loses a way on; an editor opening a newer file must
    // be able to say so, as it does for every child it left out.
    const drops: TourChildDrop[] = [];
    children(
      [
        storyOf('a', [
          { id: 'later', kind: 'scene' },
          choiceOf('c', ['later', 'intro', undefined]),
          text,
        ]),
      ],
      { lenient: true, drops }
    );
    expect(drops).toEqual([
      expect.objectContaining({ kind: 'child', child: 'later' }),
      expect.objectContaining({ kind: 'option', child: 'c', option: 'o0' }),
    ]);
  });

  it('a known kind out of its place is skipped and reported: a choice or a quiz in a station, a story in a story', () => {
    // Why: the strict side fails these; the lenient side must leave them
    // out and say so, never place them somewhere they do not belong.
    const drops: TourChildDrop[] = [];
    const read = children(
      [
        choiceOf('c', [undefined, undefined]),
        quizOf('q'),
        storyOf('a', [storyOf('inner', [text]), video]),
        pin,
      ],
      { lenient: true, drops }
    );
    expect(read.map((c) => c.id)).toEqual(['a', 'sign']);
    expect(read[0]).toMatchObject({ children: [{ id: 'film' }] });
    expect(drops.map((d) => [d.kind, 'child' in d ? d.child : ''])).toEqual([
      ['child', 'c'],
      ['child', 'q'],
      ['child', 'inner'],
    ]);
  });

  it('a goto naming a child the reader skipped prunes that option, not the file', () => {
    const choice = choiceOf('c', ['later', 'intro', undefined]);
    const read = children(
      [storyOf('a', [{ id: 'later', kind: 'scene' }, choice, text])],
      { lenient: true }
    );
    expect(read).toEqual([
      storyOf('a', [
        { ...choice, options: choice.options.slice(1) },
        { ...text, advance: tap },
      ]),
    ]);
  });

  it('a choice left with fewer than two ways on goes, reported, and so does a choice that jumped only to it', () => {
    const drops: TourChildDrop[] = [];
    const read = children(
      [
        storyOf('a', [
          choiceOf('c0', ['c1', 'c1']),
          choiceOf('c1', ['gone', undefined]),
          { id: 'gone', kind: 'scene' },
          text,
        ]),
      ],
      { lenient: true, drops }
    );
    expect(read).toEqual([storyOf('a', [{ ...text, advance: tap }])]);
    expect(
      drops.map((d) =>
        'child' in d ? d.child : 'block' in d ? d.block : d.folder
      )
    ).toEqual(['gone', 'c1', 'c0']);
  });

  it('a quiz of an unknown answer type is skipped and reported', () => {
    const drops: TourChildDrop[] = [];
    const read = children(
      [storyOf('a', [{ ...quizOf('q'), answer: { type: 'map-pick' } }])],
      { lenient: true, drops }
    );
    expect(read).toEqual([storyOf('a', [])]);
    expect(drops).toEqual([
      expect.objectContaining({ kind: 'child', child: 'q' }),
    ]);
  });

  it('a story title over the cap skips the story (a newer minor may widen it), reported', () => {
    const drops: TourChildDrop[] = [];
    const read = children([storyOf('a', [text], 'w'.repeat(81)), pin], {
      lenient: true,
      drops,
    });
    expect(read.map((c) => c.id)).toEqual(['sign']);
    expect(drops).toEqual([
      expect.objectContaining({ kind: 'child', child: 'a' }),
    ]);
  });

  it('views: a free block in an unknown view takes its floor, a free video too; a story block falls back to the card', () => {
    const drops: TourChildDrop[] = [];
    const read = children(
      [
        { ...text, view: 'captions' },
        { ...video, view: 'hologram' },
        storyOf('a', [{ ...pin, view: 'hologram' }]),
      ],
      { lenient: true, drops }
    );
    expect(read[0]).toMatchObject({ id: 'intro', view: 'reading' });
    expect(read[1]).toMatchObject({ id: 'film', view: 'card' });
    expect(read[2]).toMatchObject({
      id: 'a',
      children: [{ id: 'sign', view: 'card' }],
    });
    expect(read).toHaveLength(3);
    expect(drops).toEqual([]);
  });

  it('an unknown advance mode is a tap', () => {
    const [story] = children(
      [storyOf('a', [{ ...text, advance: { mode: 'gaze' } }])],
      { lenient: true }
    );
    expect(story).toMatchObject({ children: [{ advance: tap }] });
  });

  it('structural faults still fail a lenient read: a duplicate id, a goto naming nothing, a story without a title or children, no list', () => {
    const lenient = (value: unknown) => () =>
      children(value, { lenient: true });
    expect(lenient([pin, storyOf('sign', [])])).toThrow(/duplicate child id/);
    // A skipped child's id still counts.
    expect(lenient([{ id: 'x', kind: 'scene' }, storyOf('x', [])])).toThrow(
      /duplicate child id "x"/
    );
    expect(
      lenient([storyOf('a', [choiceOf('c', ['nowhere', undefined])])])
    ).toThrow(/must name a child of this story/);
    expect(
      lenient([
        { id: 's', kind: 'folder', role: 'story', title: ' ', children: [] },
      ])
    ).toThrow(/title/);
    // A missing or non-text title is not a newer minor's longer one.
    for (const title of [undefined, 7]) {
      expect(
        lenient([
          { id: 's', kind: 'folder', role: 'story', title, children: [] },
        ])
      ).toThrow(/title/);
    }
    // A title over the cap leaves the story out, but its children are
    // still read: their structural faults fail the file.
    expect(
      lenient([
        storyOf('a', [choiceOf('c', ['nowhere', undefined])], 't'.repeat(81)),
      ])
    ).toThrow(/must name a child of this story/);
    expect(
      lenient([{ id: 's', kind: 'folder', role: 'story', title: 'T' }])
    ).toThrow(/must be an array/);
    expect(lenient(undefined)).toThrow(/must be an array/);
    expect(lenient([{ kind: 'scene' }])).toThrow(/\.id"/);
  });
});

describe('children: functions over a children list', () => {
  const list = children([
    storyOf('a', [text, choiceOf('c', [undefined, undefined]), video]),
    pin,
    storyOf('b', [quizOf('q')]),
    { ...pin, id: 'sign2' },
  ]);

  it("the stories, the free blocks, every block, and a story's blocks, each in document order", () => {
    expect(tourChildrenStories(list).map((s) => s.id)).toEqual(['a', 'b']);
    expect(tourFreeBlocks({ children: list }).map((b) => b.id)).toEqual([
      'sign',
      'sign2',
    ]);
    expect(tourChildrenBlocks(list).map((b) => b.id)).toEqual([
      'intro',
      'film',
      'sign',
      'sign2',
    ]);
    const [a] = tourChildrenStories(list);
    expect(tourStoryChildrenBlocks(a?.children ?? []).map((b) => b.id)).toEqual(
      ['intro', 'film']
    );
  });

  it("a child's place: its index in the station, or its story and its index there; null for none", () => {
    expect(tourChildrenPlace(list, 'sign')).toEqual({ index: 1, path: [] });
    expect(tourChildrenPlace(list, 'b')).toEqual({ index: 2, path: [] });
    expect(tourChildrenPlace(list, 'film')).toEqual({
      index: 2,
      path: [list[0]],
      story: list[0],
    });
    expect(tourChildrenPlace(list, 'q')).toEqual({
      index: 0,
      path: [list[2]],
      story: list[2],
    });
    expect(tourChildrenPlace(list, 'nowhere')).toBeNull();
  });
});

describe('reading a station through its children', () => {
  // Why: pages read a station through these helpers, never its list by
  // hand. A story block listed once, in document order, whatever mix of
  // stories and free blocks the file holds, is what keeps the preloader,
  // the problem list and the editor's tree from showing one twice or
  // losing one.
  const holder = {
    children: children([
      storyOf('s1', [text, choiceOf('c1', [undefined, undefined]), video]),
      pin,
      storyOf('s2', [{ ...pin, id: 'sign-2' }, quizOf('q1')]),
    ]),
  };

  it('splits a station into its stories and their blocks, each in its order', () => {
    expect(tourStories(holder).map((s) => s.id)).toEqual(['s1', 's2']);
    const [first] = tourStories(holder);
    expect(tourStoryBlocks(first!).map((b) => b.id)).toEqual(['intro', 'film']);
    expect(tourStationStoryBlocks(holder).map((b) => b.id)).toEqual([
      'intro',
      'film',
      'sign-2',
    ]);
    expect(tourStationBlocks(holder).map((b) => b.id)).toEqual([
      'intro',
      'film',
      'sign',
      'sign-2',
    ]);
  });

  it('lists every id of a station, stories and their children included', () => {
    expect(tourStationChildIds(holder)).toEqual([
      's1',
      'intro',
      'c1',
      'film',
      'sign',
      's2',
      'sign-2',
      'q1',
    ]);
  });

  it('finds a child across a tour, with its station and its story', () => {
    const other = { children: children([{ ...pin, id: 'far' }]) };
    const tour = { stations: [other, holder] };
    expect(tourChildPlace(tour, 'far')).toEqual({
      index: 0,
      path: [],
      station: other,
    });
    const place = tourChildPlace(tour, 'q1');
    expect(place?.station).toBe(holder);
    expect(place?.story?.id).toBe('s2');
    expect(place?.index).toBe(1);
    expect(tourChildPlace(tour, 'nothing')).toBeNull();
  });
});
