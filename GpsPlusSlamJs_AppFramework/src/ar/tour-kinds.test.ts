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
    { id: 'door', kind: 'image', required: false },
    { id: 'voice', kind: 'audio', required: true },
  ],
  picture: [{ id: 'photo', kind: 'image', required: true }],
  video: [
    { id: 'clip', kind: 'video', required: true },
    { id: 'still', kind: 'image', required: true },
  ],
  audio: [{ id: 'bell', kind: 'audio', required: true }],
  model: [{ id: 'arch', kind: 'model', required: true }],
  character: [
    { id: 'sir', kind: 'image', required: true },
    { id: 'hail', kind: 'audio', required: true },
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

  it.each(tourBlockKinds())('%s: says the minor that brought it', (kind) => {
    const { sinceMinor } = TOUR_KINDS[kind];
    expect(Number.isInteger(sinceMinor)).toBe(true);
    expect(sinceMinor).toBeGreaterThanOrEqual(0);
    expect(sinceMinor).toBeLessThanOrEqual(TOUR_MANIFEST_MINOR);
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
    expect(tourKindsMinor()).toBe(TOUR_MANIFEST_MINOR);
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
