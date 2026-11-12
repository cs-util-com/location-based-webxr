/**
 * Why this test matters: a short text's look in the world (a sign, a hint
 * at the screen's edge, an arrow on the ground) is decided by a handful of
 * optional fields a tour file carries. A tour is untrusted input, so each
 * field is read by one rule here: a value of the wrong type fails at every
 * minor, while a value a later minor may allow (a new role, a wider bend)
 * fails a file of this reader's own minor and, in a newer file, drops just
 * that field so the block still shows with its default.
 */

// Activates the core library's licence before any module under test loads.
import '../test-setup';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { TourBlockDrop, TourBlockReadContext } from './tour-block-read';
import { TOUR_KINDS } from './tour-kinds';
import {
  shortTextLetterHeightM,
  TOUR_GROUND_MAX_BEND_DEG,
  TOUR_GROUND_STYLES,
  TOUR_SHORT_TEXT_MAX_READ_AT_M,
  TOUR_SHORT_TEXT_MIN_READ_AT_M,
  TOUR_SHORT_TEXT_POINT_MAX_M,
} from './tour-short-text';

function context(lenient = false, drops: TourBlockDrop[] = []) {
  return {
    id: 's',
    at: 'block',
    assets: new Map(),
    characters: new Map(),
    fail: (message: string) => {
      throw new Error(message);
    },
    lenient,
    onDropped: (drop: TourBlockDrop) => {
      drops.push(drop);
    },
  } satisfies TourBlockReadContext;
}

const read = (fields: Record<string, unknown>, view: string | null = 'sign') =>
  TOUR_KINDS.shortText.read(
    { id: 's', kind: 'shortText', view, caption: 'Gate', ...fields },
    view,
    context()
  );

describe('a short text in the world', () => {
  it('stands as a pin, a sign or a hint at the screen edge', () => {
    // Why: every one of these is drawn in the station for as long as the
    // block is there; the card is a story's alone. An unknown view of a
    // newer file falls back to the pin, which every reader draws.
    expect(TOUR_KINDS.shortText.views).toEqual([
      'pin',
      'sign',
      'edgeHint',
      'card',
    ]);
    expect(TOUR_KINDS.shortText.freeViews).toEqual(['pin', 'sign', 'edgeHint']);
    expect(TOUR_KINDS.shortText.worldViews).toEqual(
      TOUR_KINDS.shortText.freeViews
    );
    expect(TOUR_KINDS.shortText.floor).toBe('pin');
  });

  it('reads only its caption when no look field is written', () => {
    // Why: every look field is optional, so a pin written before them
    // reads back exactly as it was.
    expect(read({}, 'pin')).toEqual({ caption: 'Gate' });
  });

  it('reads every look field, in every view, so a view switch keeps them', () => {
    // Why: the editor switches a short text between its views; a field
    // the current view does not read is kept, so switching back loses
    // nothing.
    const fields = {
      role: 'warning',
      orientation: 'face',
      readAtM: 12,
      pointsTo: [3, 0, -4],
      lang: 'de-CH',
      style: 'vanes',
      bendDeg: -30,
      floorPlacement: 'hovering',
      captionOnArrow: true,
      color: '#5fe3c9',
      darkColor: '#151A20',
    };
    for (const view of ['pin', 'sign', 'edgeHint', 'card', null]) {
      expect(read(fields, view)).toEqual({ caption: 'Gate', ...fields });
    }
  });

  it.each([
    ['role', 'shout'],
    ['orientation', 'sideways'],
    ['style', 'balloons'],
    ['floorPlacement', 'flying'],
    ['readAtM', 0.5],
    ['readAtM', 41],
    ['pointsTo', [TOUR_SHORT_TEXT_POINT_MAX_M + 1, 0, 0]],
    ['bendDeg', TOUR_GROUND_MAX_BEND_DEG + 1],
    ['lang', 'not a language'],
    ['color', 'red'],
    ['darkColor', '#12345'],
    ['captionOnArrow', 'yes'],
  ])(
    '%s = %j fails a file of this minor and is dropped from a newer one',
    (field, value) => {
      // Why: these are rules a later minor may relax (a new role, a wider
      // bend). Its own file must hold them; a newer file's block still
      // shows, without just that field.
      expect(() => read({ [field]: value })).toThrow(field);
      const drops: TourBlockDrop[] = [];
      const lenient = TOUR_KINDS.shortText.read(
        { caption: 'Gate', [field]: value },
        'sign',
        context(true, drops)
      );
      expect(lenient).toEqual({ caption: 'Gate' });
      expect(drops).toEqual([
        expect.objectContaining({ kind: 'field', block: 's', field }),
      ]);
    }
  );

  it.each([
    ['readAtM', 'far'],
    ['readAtM', -3],
    ['pointsTo', [1, 2]],
    ['pointsTo', [1, Number.NaN, 2]],
    ['bendDeg', 'left'],
  ])(
    '%s = %j fails at every minor: no revision makes it valid',
    (field, value) => {
      // Why: a distance that is not a positive number, or a point that is
      // not three numbers, is broken data rather than a newer value.
      expect(() =>
        TOUR_KINDS.shortText.read(
          { caption: 'Gate', [field]: value },
          'sign',
          context(true)
        )
      ).toThrow(field);
    }
  );

  it('knows the five ground styles', () => {
    // Why: the editor offers these and the viewer draws them; a newer
    // style is dropped by an older reader, which then draws the ribbon.
    expect(TOUR_GROUND_STYLES).toEqual([
      'ribbon',
      'vanes',
      'footprints',
      'lights',
      'floor',
    ]);
  });
});

describe('the letter height a reading distance asks for', () => {
  it('is 2.64 cm per metre of reading distance', () => {
    // Why: one size knob, "readable from", sets the letters of every
    // short-text view; 6.6 cm letters read comfortably at 2.5 m.
    expect(shortTextLetterHeightM(2.5)).toBeCloseTo(0.066, 10);
    expect(shortTextLetterHeightM(10)).toBeCloseTo(0.264, 10);
  });

  it('grows with the distance and stays inside the bounds', () => {
    // Why: a sign readable from farther away never has smaller letters,
    // and an out-of-range value from a draft is clamped, not trusted.
    fc.assert(
      fc.property(
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: -100, max: 100, noNaN: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          const hLo = shortTextLetterHeightM(lo);
          const hHi = shortTextLetterHeightM(hi);
          expect(hLo).toBeLessThanOrEqual(hHi);
          expect(hLo).toBeGreaterThanOrEqual(
            shortTextLetterHeightM(TOUR_SHORT_TEXT_MIN_READ_AT_M)
          );
          expect(hHi).toBeLessThanOrEqual(
            shortTextLetterHeightM(TOUR_SHORT_TEXT_MAX_READ_AT_M)
          );
        }
      )
    );
  });
});
