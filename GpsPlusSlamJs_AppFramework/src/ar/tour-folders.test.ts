/**
 * Why this test matters: every container in a station is a folder. A story
 * is a folder with the story role and keeps every story rule; a plain
 * folder groups free blocks (and plain folders) under a pose and a scale.
 * The two must never mix - a story inside a folder, or a folder inside a
 * story, would put blocks where the story player or the world view cannot
 * reach them - so each illegal nesting is refused here, by name, and a
 * newer minor's file that has one still opens with it left out. The
 * writer writes back exactly what it read, so a story is written in the
 * folder shape.
 */

import { describe, expect, it } from 'vitest';

import { parseTourAssets } from './tour-assets';
import { parseTourManifest, serializeTourManifest } from './tour-manifest';
import {
  isStory,
  isTourBlockChild,
  isTourFolder,
  parseTourStationChildren,
  TOUR_FOLDER_SCALE_RANGE,
  tourChildPlace,
  tourChildrenBlocks,
  tourChildrenPlace,
  tourStationChildIds,
  tourStories,
  type TourChildDrop,
  type TourStationChild,
} from './tour-story';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const ASSETS = parseTourAssets([], { fail });

const pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const pin = (id: string) => ({
  id,
  kind: 'shortText',
  view: 'pin',
  pose,
  caption: 'Gate',
});
const card = (id: string) => ({
  id,
  kind: 'shortText',
  view: 'card',
  pose,
  caption: 'Hello',
});
const story = (id: string, kids: unknown[]) => ({
  id,
  kind: 'folder',
  role: 'story',
  title: 'The old gate',
  children: kids,
});
const folder = (id: string, kids: unknown[], extra: object = {}) => ({
  id,
  kind: 'folder',
  ...extra,
  children: kids,
});

function read(
  value: unknown,
  options: { lenient?: boolean; drops?: TourChildDrop[] } = {}
): TourStationChild[] {
  return parseTourStationChildren(value, 'stations[0].children', {
    assets: ASSETS,
    fail,
    lenient: options.lenient === true,
    onDropped: (drop) => options.drops?.push(drop),
  }).children;
}

describe('folders: each shape reads', () => {
  it('a story is a folder with the story role, read with its title and children', () => {
    const [s] = read([story('s', [card('c')])]);
    expect(s).toEqual({
      id: 's',
      kind: 'folder',
      role: 'story',
      title: 'The old gate',
      children: [{ ...card('c'), advance: { mode: 'tap' } }],
    });
    expect(s !== undefined && isStory(s)).toBe(true);
  });

  it('a plain folder reads with no pose, a pose, a scale, both, or empty', () => {
    const turned = {
      position: [1, 2, 3],
      rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    };
    const shapes = [
      folder('f1', [pin('a')]),
      folder('f2', [pin('b')], { pose: turned }),
      folder('f3', [pin('c')], { scale: 2 }),
      folder('f4', [pin('d')], { pose: turned, scale: 0.5 }),
      folder('f5', []),
    ];
    const got = read(shapes);
    expect(got).toEqual(shapes);
    expect(got.every((c) => isTourFolder(c) && !isStory(c))).toBe(true);
  });

  it('plain folders nest, and hold free blocks only in a world view', () => {
    const nested = folder('outer', [pin('a'), folder('inner', [pin('b')])]);
    expect(read([nested])).toEqual([nested]);
    // A free block in a folder stands in the world, as at the top.
    expect(() => read([folder('f', [card('c')])])).toThrow(
      /must stand in the world/
    );
  });

  it('a scale at both ends of its range reads; just outside, or no number, fails', () => {
    const { min, max } = TOUR_FOLDER_SCALE_RANGE;
    for (const scale of [min, 1, max]) {
      expect(read([folder('f', [], { scale })])).toHaveLength(1);
    }
    for (const scale of [min * 0.999, max * 1.001, 0, -1, NaN, '2']) {
      expect(() => read([folder('f', [], { scale })])).toThrow(
        /children\[0\]\.scale" must be a number from/
      );
    }
  });

  it("a folder's pose is checked as a block's is", () => {
    expect(() =>
      read([
        folder('f', [], { pose: { position: [0, 0], rotation: [0, 0, 0, 1] } }),
      ])
    ).toThrow(/children\[0\]\.pose\.position"/);
  });
});

describe('folders: every illegal nesting is refused, and left out of a newer minor', () => {
  const cases: readonly [string, unknown[], RegExp][] = [
    [
      'a story inside a plain folder',
      [folder('f', [story('s', [])])],
      /children\[0\]\.children\[0\]" is a story inside a folder/,
    ],
    [
      'a story inside a nested plain folder',
      [folder('f', [folder('g', [story('s', [])])])],
      /children\[0\]\.children\[0\]\.children\[0\]" is a story inside a folder/,
    ],
    [
      'a plain folder inside a story',
      [story('s', [folder('f', [])])],
      /children\[0\]\.children\[0\]\.kind" must be a block kind, choice or quiz/,
    ],
    [
      'a story inside a story',
      [story('s', [story('t', [])])],
      /children\[0\]\.children\[0\]\.kind" must be a block kind, choice or quiz/,
    ],
    [
      'a folder of an unknown role',
      [{ ...folder('f', []), role: 'scene' }],
      /children\[0\]\.role" must be "story" or absent/,
    ],
    [
      'a story with a pose',
      [{ ...story('s', []), pose }],
      /children\[0\]" is a story: it takes no pose or scale/,
    ],
    [
      'a story with a scale',
      [{ ...story('s', []), scale: 2 }],
      /children\[0\]" is a story: it takes no pose or scale/,
    ],
  ];

  for (const [name, value, reason] of cases) {
    it(`${name}: refused strict`, () => {
      expect(() => read(value)).toThrow(reason);
    });
  }

  it('lenient: a misplaced story or a folder of an unknown role is left out and reported; the rest stays', () => {
    const drops: TourChildDrop[] = [];
    const got = read(
      [
        folder('f', [pin('a'), story('s', [card('c')])]),
        { ...folder('g', [pin('b')]), role: 'scene' },
        story('t', [folder('h', [])]),
      ],
      { lenient: true, drops }
    );
    expect(got).toEqual([
      folder('f', [pin('a')]),
      {
        id: 't',
        kind: 'folder',
        role: 'story',
        title: 'The old gate',
        children: [],
      },
    ]);
    expect(drops.map((d) => ('child' in d ? d.child : null))).toEqual([
      's',
      'g',
      'h',
    ]);
  });

  it("lenient: a story's pose and scale are ignored as unknown fields", () => {
    const [s] = read([{ ...story('s', []), pose, scale: 2 }], {
      lenient: true,
    });
    expect(s).toEqual({
      id: 's',
      kind: 'folder',
      role: 'story',
      title: 'The old gate',
      children: [],
    });
  });

  it("ids inside folders share the station's namespace", () => {
    expect(() => read([pin('a'), folder('f', [pin('a')])])).toThrow(
      /duplicate child id "a"/
    );
    expect(() => read([folder('f', [folder('f', [])])])).toThrow(
      /duplicate child id "f"/
    );
  });
});

describe('folders: the three-way split and the walkers', () => {
  const list = read([
    story('s', [card('c')]),
    pin('a'),
    folder('f', [pin('b'), folder('g', [pin('d')])]),
  ]);

  it('every child is exactly one of block, story, plain folder', () => {
    for (const child of list) {
      const kinds = [
        isTourBlockChild(child),
        isStory(child),
        isTourFolder(child),
      ];
      expect(kinds.filter(Boolean)).toHaveLength(1);
    }
  });

  it('stories stay at the top; blocks and ids reach into folders at any depth', () => {
    expect(tourStories({ children: list }).map((s) => s.id)).toEqual(['s']);
    expect(tourChildrenBlocks(list).map((b) => b.id)).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
    expect(tourStationChildIds({ children: list })).toEqual([
      's',
      'c',
      'a',
      'f',
      'b',
      'g',
      'd',
    ]);
  });

  it('a place carries the containers that hold the child, outermost first', () => {
    const [s, , f] = list;
    expect(tourChildrenPlace(list, 'a')).toEqual({ index: 1, path: [] });
    expect(tourChildrenPlace(list, 'c')).toEqual({
      index: 0,
      path: [s],
      story: s,
    });
    const g = f !== undefined && isTourFolder(f) ? f.children[1] : undefined;
    expect(tourChildrenPlace(list, 'd')).toEqual({ index: 0, path: [f, g] });
    expect(
      tourChildPlace({ stations: [{ children: list }] }, 'g')
    ).toMatchObject({ index: 1, path: [f] });
  });
});

describe('folders: the writer', () => {
  it('writes a story in the folder shape, and a plain folder back as read', () => {
    const manifest = parseTourManifest({
      version: 5,
      order: 'fixed',
      assets: [],
      stations: [
        {
          id: 'st',
          geo: { lat: 48, lon: 11, alt: 500, headingDeg: 0 },
          activateRadiusM: 20,
          foundRadiusM: 5,
          children: [
            story('s', [card('c')]),
            folder('f', [pin('a')], { scale: 2 }),
          ],
        },
      ],
    });
    const written = JSON.parse(serializeTourManifest(manifest)) as {
      stations: { children: unknown[] }[];
    };
    expect(written.stations[0]?.children).toEqual([
      {
        id: 's',
        kind: 'folder',
        role: 'story',
        title: 'The old gate',
        children: [{ ...card('c'), advance: { mode: 'tap' } }],
      },
      folder('f', [pin('a')], { scale: 2 }),
    ]);
  });
});
