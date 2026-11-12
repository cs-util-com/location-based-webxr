/**
 * Why this test matters: the list of kinds is what a new kind is added to,
 * and everything else is derived from it. These tests hold the rules the
 * compiler cannot: a row's views agree with each other, a kind's `read`
 * stays inside its own fields (a tour is untrusted input, so the envelope
 * is the reader's), every kind says which assets it names, and a kind
 * added at a later minor makes the file say that minor, or an older viewer
 * would fail the whole tour instead of skipping one block.
 */

// Activates the core library's licence before any module under test loads.
import '../test-setup';
import { describe, expect, it } from 'vitest';

import type { TourBlockReadContext } from './tour-block-read';
import {
  isTourBlockKind,
  TOUR_KINDS,
  tourBlockAssetIds,
  tourBlockKinds,
  tourBlockMinor,
  tourBlockRefs,
  tourKindsMinor,
} from './tour-kinds';
import { TOUR_MANIFEST_MINOR } from './tour-manifest';

const MARKDOWN_PICTURE = '![a door](asset:door)';

/** One valid block of every kind, naming each asset its kind can name. */
const VALID = {
  shortText: { id: 's', kind: 'shortText', view: 'pin', caption: 'Gate' },
  longText: {
    id: 'l',
    kind: 'longText',
    view: 'reading',
    title: 'The gate',
    body: MARKDOWN_PICTURE,
    narration: {
      audio: 'voice',
      timing: 'timing/l.json',
      durationMs: 1000,
    },
  },
  picture: {
    id: 'p',
    kind: 'picture',
    view: 'plane',
    image: 'photo',
    widthM: 1,
  },
  video: {
    id: 'v',
    kind: 'video',
    view: 'card',
    video: 'clip',
    poster: 'still',
  },
  audio: { id: 'a', kind: 'audio', view: 'card', audio: 'bell' },
  model: { id: 'm', kind: 'model', view: 'placed', asset: 'arch', sizeM: 3 },
  character: {
    id: 'c',
    kind: 'character',
    view: 'speak',
    name: 'Sir',
    image: 'sir',
    voice: 'hail',
  },
} as const;

const EXPECTED_REFS = {
  shortText: [],
  longText: [
    { id: 'door', kind: 'image', required: false, field: 'body' },
    {
      id: 'voice',
      kind: 'audio',
      required: true,
      field: 'narration',
      optional: true,
    },
  ],
  picture: [{ id: 'photo', kind: 'image', required: true, field: 'image' }],
  video: [
    { id: 'clip', kind: 'video', required: true, field: 'video' },
    {
      id: 'still',
      kind: 'image',
      required: true,
      field: 'poster',
      optional: true,
    },
  ],
  audio: [{ id: 'bell', kind: 'audio', required: true, field: 'audio' }],
  model: [{ id: 'arch', kind: 'model', required: true, field: 'asset' }],
  character: [
    { id: 'sir', kind: 'image', required: true, field: 'image' },
    {
      id: 'hail',
      kind: 'audio',
      required: true,
      field: 'voice',
      optional: true,
    },
  ],
};

function contextFor(id: string): TourBlockReadContext {
  return {
    id,
    at: 'block',
    assets: new Map(
      tourBlockKinds().flatMap((kind) =>
        tourBlockRefs(VALID[kind]).map((ref) => [ref.id, ref.kind] as const)
      )
    ),
    characters: new Map(),
    fail: (message) => {
      throw new Error(message);
    },
    lenient: false,
    onDropped: (drop) => {
      throw new Error(drop.reason);
    },
  };
}

describe('the list of kinds', () => {
  it.each(tourBlockKinds())('%s: its views agree with each other', (kind) => {
    // Why: a floor outside the free views makes a newer file's unknown view
    // land on a view the writer refuses; a world view that is not free
    // could never stand.
    const row: {
      readonly views: readonly string[];
      readonly freeViews: readonly string[];
      readonly worldViews: readonly string[];
      readonly floor: string;
    } = TOUR_KINDS[kind];
    expect(row.views).toContain('card');
    expect(row.freeViews).toContain(row.floor);
    for (const view of row.freeViews) expect(row.views).toContain(view);
    for (const view of row.worldViews) expect(row.freeViews).toContain(view);
  });

  it('says the minor that brought each kind and view, pinned', () => {
    // Why: the bound `TOUR_MANIFEST_MINOR` is itself the largest
    // `sinceMinor`, so a check against it passes any row. A kind of
    // version 5 written with a later minor would make a released viewer
    // skip it; one added later and written at 0 would make that viewer
    // fail the whole tour. So the list is pinned: a new kind adds its row
    // here with its own minor.
    const minors = Object.fromEntries(
      tourBlockKinds().map((kind) => {
        const row: { sinceMinor: number; viewsSince?: object } =
          TOUR_KINDS[kind];
        return [kind, [row.sinceMinor, row.viewsSince ?? {}]];
      })
    );
    expect(minors).toEqual({
      shortText: [0, {}],
      longText: [0, {}],
      picture: [0, {}],
      video: [0, {}],
      audio: [0, {}],
      model: [0, {}],
      character: [0, {}],
    });
  });

  it.each(tourBlockKinds())('%s: read writes no envelope field', (kind) => {
    // Why: the envelope (id, kind, view, pose) is what makes a block
    // placeable and every kind equal to the rest of the reader. A row that
    // could overwrite it could turn one kind into another.
    const block = VALID[kind];
    const fields = TOUR_KINDS[kind].read(
      block,
      block.view,
      contextFor(block.id)
    );
    for (const envelope of ['id', 'kind', 'view', 'pose', 'createdAtIso']) {
      expect(fields).not.toHaveProperty(envelope);
    }
  });

  it.each(tourBlockKinds())('%s: names its assets', (kind) => {
    expect(tourBlockRefs(VALID[kind])).toEqual(EXPECTED_REFS[kind]);
  });

  it('says which references sit in a field the block stands without', () => {
    // Why: deleting a file must tell the block MADE of it (it goes) from a
    // block that only mentions it (the field goes, the block stays) - a
    // narration, a poster, a voice. Read from here, not from a list of
    // kinds elsewhere, so a new optional field is classed where it is born.
    const optional = tourBlockKinds().flatMap((kind) =>
      tourBlockRefs(VALID[kind]).flatMap((ref) =>
        ref.optional === true ? [[kind, ref.field]] : []
      )
    );
    expect(optional).toEqual([
      ['longText', 'narration'],
      ['video', 'poster'],
      ['character', 'voice'],
    ]);
  });

  it('asks only for what the format requires, when asked to', () => {
    // Why: a long text's body may name a picture the tour lacks (the
    // visitor reads its alt text); a write keeps it, a restore does not
    // insist on it.
    expect(tourBlockAssetIds(VALID.longText)).toEqual(['door', 'voice']);
    expect(tourBlockAssetIds(VALID.longText, true)).toEqual(['voice']);
  });

  it('reads no reference out of a value that holds none', () => {
    // Why: `refs` also runs over a draft's record before its fields are
    // checked, so a broken field must mean "names nothing", not a throw.
    const broken = { kind: 'longText', body: 7, narration: 'x' };
    expect(tourBlockRefs(broken)).toEqual([]);
    const badId = { kind: 'picture', image: 'no/id' };
    expect(tourBlockRefs(badId)).toEqual([]);
    const unknownKind = { kind: 'hologram', image: 'a' };
    expect(tourBlockRefs(unknownKind)).toEqual([]);
    expect(tourBlockRefs({})).toEqual([]);
  });

  it('knows its kinds and nothing inherited', () => {
    expect(isTourBlockKind('model')).toBe(true);
    expect(isTourBlockKind('hologram')).toBe(false);
    expect(isTourBlockKind('toString')).toBe(false);
    expect(isTourBlockKind(1)).toBe(false);
  });
});

describe('the minor a kind brings', () => {
  // Why: `sinceMinor` is the seam for the kinds to come. Written at minor 0,
  // a tour with a kind a released viewer does not know fails there as a
  // broken file; written at the kind's minor, that viewer skips one block.
  const later = {
    shortText: { sinceMinor: 0 },
    model: { sinceMinor: 0, viewsSince: { orbit: 2 } },
    video360: { sinceMinor: 1 },
  };

  it('is what this reader is strict about', () => {
    expect(tourKindsMinor(later)).toBe(2);
    // The literal: a row whose minor moved changes what this reader is
    // strict about, which no comparison with the derived value can see.
    expect(tourKindsMinor()).toBe(0);
    expect(TOUR_MANIFEST_MINOR).toBe(0);
  });

  it('is what a block needs: its kind, then its view', () => {
    const block = (kind: string, view: string) => ({ kind, view });
    expect(tourBlockMinor(block('video360', 'card'), later)).toBe(1);
    expect(tourBlockMinor(block('model', 'orbit'), later)).toBe(2);
    expect(tourBlockMinor(block('model', 'placed'), later)).toBe(0);
    expect(tourBlockMinor(block('shortText', 'pin'), later)).toBe(0);
    expect(tourBlockMinor(block('hologram', 'card'), later)).toBe(0);
  });
});

describe('an audio item in the world', () => {
  const read = (view: string | null, fields: Record<string, unknown>) =>
    TOUR_KINDS.audio.read(
      { id: 'a', kind: 'audio', view, audio: 'bell', ...fields },
      view,
      contextFor('a')
    );

  it('stands as a narration circle or an ambient zone, free', () => {
    // Why: the two world views are what a station shows of a sound; the
    // card alone reaches nothing when the item stands free.
    expect(TOUR_KINDS.audio.views).toEqual(['spot', 'zone', 'card']);
    expect(TOUR_KINDS.audio.freeViews).toEqual(['spot', 'zone']);
    expect(TOUR_KINDS.audio.worldViews).toEqual(['spot', 'zone']);
    expect(TOUR_KINDS.audio.floor).toBe('spot');
  });

  it('reads a narration circle by its radius, required there', () => {
    // Why: the circle is where the player opens; without a radius the
    // creator's choice would be lost to a default nobody saw.
    expect(read('spot', { radiusM: 6 })).toMatchObject({ radiusM: 6 });
    expect(() => read('spot', {})).toThrow(/radiusM/);
    expect(() => read('spot', { radiusM: 0.5 })).toThrow(/radiusM/);
    expect(() => read('spot', { radiusM: 'x' })).toThrow(/radiusM/);
  });

  it('reads an ambient zone by its reach, inner calm and volume', () => {
    // Why: reach and volume decide what is heard; the inner radius is
    // optional (full volume only at the centre without it) and must lie
    // inside the reach, or the loudness curve would run backwards.
    expect(read('zone', { maxM: 20, volume: 0.5 })).toEqual({
      audio: 'bell',
      maxM: 20,
      volume: 0.5,
    });
    expect(read('zone', { maxM: 20, minM: 5, volume: 1 })).toMatchObject({
      minM: 5,
    });
    expect(() => read('zone', { volume: 1 })).toThrow(/maxM/);
    expect(() => read('zone', { maxM: 20 })).toThrow(/volume/);
    expect(() => read('zone', { maxM: 20, volume: 1.5 })).toThrow(/volume/);
    expect(() => read('zone', { maxM: 20, minM: 20, volume: 1 })).toThrow(
      /minM/
    );
  });

  it('keeps the other view fields when present, so a view switch keeps them', () => {
    // Why: the editor switches between the two views; the fields of the
    // other one are kept (and still checked), so switching back loses
    // nothing. A card in a story reads the same way.
    expect(read('card', { radiusM: 6, maxM: 20, volume: 0.5 })).toMatchObject({
      radiusM: 6,
      maxM: 20,
      volume: 0.5,
    });
    expect(read('card', {})).toEqual({ audio: 'bell' });
    expect(read(null, {})).toEqual({ audio: 'bell' });
    expect(() => read('card', { volume: -1 })).toThrow(/volume/);
  });
});

describe('a picture in the world', () => {
  const read = (view: string | null, fields: Record<string, unknown>) =>
    TOUR_KINDS.picture.read(
      {
        id: 'p',
        kind: 'picture',
        view,
        image: 'photo',
        widthM: 1.6,
        ...fields,
      },
      view,
      contextFor('p')
    );
  const VIEWPOINT = {
    position: [4, 1.6, -2],
    rotation: [0, 0, 0, 1],
    hfovDeg: 50,
    distanceM: 12,
  };

  it('stands framed, cut out or lined up from a spot, free', () => {
    // Why: every world view is one a station shows on its own; `plane`
    // stays the floor, so an older or unknown view still draws something.
    expect(TOUR_KINDS.picture.views).toEqual([
      'plane',
      'framed',
      'cutout',
      'thenNow',
      'sharpen',
      'finder',
      'window',
      'viewer',
      'card',
    ]);
    expect(TOUR_KINDS.picture.freeViews).toEqual(
      TOUR_KINDS.picture.views.filter((v) => v !== 'card')
    );
    expect(TOUR_KINDS.picture.floor).toBe('plane');
  });

  it('reads its credit, year, tag switch and viewpoint in write order', () => {
    // Why: a plate and a sheet show the credit and the year; the year is
    // text ("about 1880s"), never a number; the field order is the
    // writer's, so a file round-trips byte for byte.
    const fields = read('framed', {
      credit: 'City archive',
      year: 'about 1880s',
      showTag: false,
      viewpoint: VIEWPOINT,
    });
    expect(Object.keys(fields)).toEqual([
      'image',
      'credit',
      'year',
      'widthM',
      'showTag',
      'viewpoint',
    ]);
    expect(fields).toMatchObject({
      year: 'about 1880s',
      showTag: false,
      viewpoint: VIEWPOINT,
    });
  });

  it('leaves out an over-long credit or year alone, and says so', () => {
    // Why: an optional text over its cap drops by itself (reported), the
    // picture stays; the year's cap is 24 characters of text.
    expect(() => read('framed', { year: 'x'.repeat(25) })).toThrow(/year/);
    expect(() => read('framed', { credit: 'x'.repeat(201) })).toThrow(/credit/);
    expect(read('framed', { year: 'x'.repeat(24) })).toMatchObject({
      year: 'x'.repeat(24),
    });
  });

  it('refuses a tag switch that is not true or false', () => {
    // Why: a string "false" would show the tag the creator turned off.
    expect(() => read('cutout', { showTag: 'false' })).toThrow(/showTag/);
    expect(read('cutout', {})).not.toHaveProperty('showTag');
  });

  it('keeps a viewpoint in every view, so a view switch loses nothing', () => {
    // Why: the creator tries views; switching from then-and-now to framed
    // and back must find the spot where it was.
    for (const view of [...TOUR_KINDS.picture.views, null]) {
      expect(read(view, { viewpoint: VIEWPOINT })).toMatchObject({
        viewpoint: VIEWPOINT,
      });
    }
  });

  it('reads a viewpoint view without a viewpoint, for the viewer to draw as a plane', () => {
    // Why: the format keeps the picture (its floor drawing stands in);
    // the editor never writes one, as it gives a viewpoint on the switch.
    expect(read('thenNow', {})).not.toHaveProperty('viewpoint');
  });

  it.each([
    [{ ...VIEWPOINT, hfovDeg: 9 }, /hfovDeg/],
    [{ ...VIEWPOINT, hfovDeg: 121 }, /hfovDeg/],
    [{ ...VIEWPOINT, hfovDeg: 'wide' }, /hfovDeg/],
    [{ ...VIEWPOINT, distanceM: 0.5 }, /distanceM/],
    [{ ...VIEWPOINT, distanceM: 501 }, /distanceM/],
    [{ ...VIEWPOINT, position: [1, 2] }, /position/],
    [{ ...VIEWPOINT, rotation: [0, 0, 0, 0] }, /rotation/],
    ['north', /viewpoint/],
  ])('refuses the viewpoint %j', (viewpoint, message) => {
    // Why: the lens sizes the picture and the distance sets its depth; a
    // value outside the bounds would hang it out of sight or fill the sky.
    expect(() => read('thenNow', { viewpoint })).toThrow(message);
  });

  it('takes the bounds themselves', () => {
    // Why: the bounds are inclusive, as every metres field of the format.
    for (const [hfovDeg, distanceM] of [
      [10, 1],
      [120, 500],
    ]) {
      expect(
        read('finder', { viewpoint: { ...VIEWPOINT, hfovDeg, distanceM } })
      ).toMatchObject({ viewpoint: { hfovDeg, distanceM } });
    }
  });
});

describe("a newer minor's picture viewpoint", () => {
  it('drops just the viewpoint, keeping the picture, and says so', () => {
    // Why: a later minor may give the viewpoint a shape this reader does
    // not know; the picture must still stand (as a plane), not fail the
    // tour or vanish.
    const drops: string[] = [];
    const fields = TOUR_KINDS.picture.read(
      {
        id: 'p',
        kind: 'picture',
        image: 'photo',
        widthM: 1,
        viewpoint: { hfovDeg: 60 },
      },
      'thenNow',
      {
        ...contextFor('p'),
        lenient: true,
        onDropped: (drop) => drops.push(drop.reason),
      }
    );
    expect(fields).not.toHaveProperty('viewpoint');
    expect(fields).toMatchObject({ image: 'photo', widthM: 1 });
    expect(drops).toEqual([
      '"block.viewpoint.position" must be three numbers within 10000 m',
    ]);
  });
});
