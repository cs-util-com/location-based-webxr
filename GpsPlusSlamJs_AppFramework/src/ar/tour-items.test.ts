/**
 * Why these tests matter: a station's pins and photos (tour editor plan
 * 2026-10-17-1816, W3) are hand-editable records whose local pose decides
 * where a visitor sees them relative to the station. The pose must be
 * checked at the boundary and read back exactly (no -0, a unit rotation),
 * and a newer app's item must degrade in a lenient read instead of failing
 * the tour (K1 milestone review R4). The kind-specific fields are shared
 * with the world-view object, so one rule decides what a pin or photo is.
 */

import { describe, expect, it } from 'vitest';

import {
  parseTourContentFields,
  parseTourItems,
  parseTourLocalPose,
  TOUR_ITEM_MAX_OFFSET_M,
  TOUR_MODEL_MAX_SIZE_M,
  TOUR_MODEL_MIN_SIZE_M,
} from './tour-items';

class Invalid extends Error {}
const fail = (message: string): never => {
  throw new Invalid(message);
};

const pin = {
  id: 'p1',
  kind: 'pin',
  label: 'Gate',
  createdAtIso: '2026-10-18T06:00:00.000Z',
};

describe('parseTourLocalPose', () => {
  it('reads three offsets and a unit rotation, -0 read as 0 and a near-unit rotation renormalized', () => {
    const pose = parseTourLocalPose(
      { position: [-0, 1.5, 2], rotation: [0, 0, 0, 1.0004] },
      'p',
      fail
    );
    expect(Object.is(pose.position[0], 0)).toBe(true);
    expect(pose.position).toEqual([0, 1.5, 2]);
    expect(pose.rotation).toEqual([0, 0, 0, 1]);
  });

  it.each([
    ['no object', null, /"p" must be an object/],
    [
      'two offsets',
      { position: [1, 2], rotation: [0, 0, 0, 1] },
      /p\.position/,
    ],
    [
      'a non-finite offset',
      { position: [1, Number.NaN, 2], rotation: [0, 0, 0, 1] },
      /p\.position/,
    ],
    [
      'an offset beyond the sanity bound',
      { position: [TOUR_ITEM_MAX_OFFSET_M + 1, 0, 0], rotation: [0, 0, 0, 1] },
      /p\.position/,
    ],
    [
      'a rotation far from unit length',
      { position: [0, 0, 0], rotation: [0, 0, 0, 3] },
      /p\.rotation/,
    ],
    [
      'a rotation of three numbers',
      { position: [0, 0, 0], rotation: [0, 0, 1] },
      /p\.rotation/,
    ],
  ])('refuses %s', (_name, value, message) => {
    expect(() => parseTourLocalPose(value, 'p', fail)).toThrow(message);
  });
});

describe('parseTourContentFields', () => {
  it('reads a pin and a photo, and nothing of a placement', () => {
    expect(parseTourContentFields({ ...pin, pose: {} }, 'x', { fail })).toEqual(
      pin
    );
    expect(
      parseTourContentFields(
        {
          id: 'f1',
          kind: 'photo',
          image: 'content/f1.webp',
          imageWidth: 2,
          imageHeight: 1,
          createdAtIso: '2026-10-18T06:00:00.000Z',
        },
        'x',
        { fail }
      )
    ).toMatchObject({ kind: 'photo', image: 'content/f1.webp' });
  });

  it("a lenient read leaves out a newer app's kind or image type; a strict one refuses it", () => {
    const sticker = { ...pin, kind: 'sticker' };
    const heic = {
      id: 'f1',
      kind: 'photo',
      image: 'content/f1.heic',
      imageWidth: 2,
      imageHeight: 1,
      createdAtIso: '2026-10-18T06:00:00.000Z',
    };
    expect(parseTourContentFields(sticker, 'x', { fail, lenient: true })).toBe(
      null
    );
    expect(parseTourContentFields(heic, 'x', { fail, lenient: true })).toBe(
      null
    );
    expect(() => parseTourContentFields(sticker, 'x', { fail })).toThrow(
      /x\.kind/
    );
    expect(() => parseTourContentFields(heic, 'x', { fail })).toThrow(
      /x\.image/
    );
  });
});

/**
 * Why these tests matter: a placed 3D model's size is a number a creator
 * drags and a hand-edited file can carry, and it decides how big the
 * model stands in a visitor's AR view. The bound is in METRES (the scaled
 * model's largest side, 0.05 m to 500 m), because a factor's sensible range
 * depends on the model's own size; outside it, or not a finite number, the
 * file is refused rather than clamped, so a save never rewrites what the
 * creator's file says without telling them.
 */
describe('a placed 3D model (parseTourContentFields)', () => {
  const model = {
    id: 'm1',
    kind: 'model',
    asset: 'statue',
    sizeM: 2.5,
    createdAtIso: '2026-10-19T12:00:00.000Z',
  };

  it('reads a model: its asset, its size in metres and an optional label', () => {
    expect(
      parseTourContentFields({ ...model, pose: {} }, 'x', { fail })
    ).toEqual(model);
    expect(
      parseTourContentFields({ ...model, label: 'Fountain' }, 'x', { fail })
    ).toEqual({ ...model, label: 'Fountain' });
  });

  it('accepts the bounds themselves, 0.05 m and 500 m', () => {
    expect(TOUR_MODEL_MIN_SIZE_M).toBe(0.05);
    expect(TOUR_MODEL_MAX_SIZE_M).toBe(500);
    for (const sizeM of [TOUR_MODEL_MIN_SIZE_M, TOUR_MODEL_MAX_SIZE_M]) {
      expect(
        parseTourContentFields({ ...model, sizeM }, 'x', { fail })
      ).toMatchObject({ sizeM });
    }
  });

  it.each([
    ['zero', 0],
    ['a negative size', -1],
    ['-0', -0],
    ['infinity', Number.POSITIVE_INFINITY],
    ['NaN', Number.NaN],
    ['a string', '2'],
    ['no size', undefined],
  ])(
    'refuses %s as the size at any minor: no revision can make it a size',
    (_name, sizeM) => {
      for (const lenient of [false, true]) {
        expect(() =>
          parseTourContentFields({ ...model, sizeM }, 'x', { fail, lenient })
        ).toThrow(/"x\.sizeM" must be a number of metres from 0\.05 to 500/);
      }
    }
  );

  // A later minor may widen the bound (the owner asked for some room), so a
  // positive size beyond this reader's bound is a newer app's model: a
  // lenient read leaves it out, as it does a newer kind; a strict one
  // refuses the file.
  it.each([
    ['just below the minimum', 0.049_999],
    ['just above the maximum', 500.000_1],
    ['a kilometre', 1000],
  ])(
    'refuses %s in a strict read and leaves the model out in a lenient one',
    (_name, sizeM) => {
      expect(() =>
        parseTourContentFields({ ...model, sizeM }, 'x', { fail })
      ).toThrow(/"x\.sizeM" must be a number of metres from 0\.05 to 500/);
      expect(
        parseTourContentFields({ ...model, sizeM }, 'x', {
          fail,
          lenient: true,
        })
      ).toBe(null);
    }
  );

  it('refuses an asset that is not an id', () => {
    for (const asset of [undefined, '', 'content/statue.glb', 7]) {
      expect(() =>
        parseTourContentFields({ ...model, asset }, 'x', { fail })
      ).toThrow(/"x\.asset" must name a model asset/);
    }
  });

  it('a strict read of an unknown kind names the model among the kinds', () => {
    expect(() =>
      parseTourContentFields({ ...model, kind: 'sticker' }, 'x', { fail })
    ).toThrow(/"x\.kind" must be "pin", "photo" or "model"/);
  });
});

describe('parseTourItems', () => {
  it('keeps the order, and leaves out in a lenient read what it cannot show', () => {
    const pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const items = parseTourItems(
      [
        { ...pin, pose },
        { ...pin, id: 'p2', kind: 'sticker', pose },
        { ...pin, id: 'p3', pose },
      ],
      's.items',
      { fail, lenient: true }
    );
    expect(items.map((i) => i.id)).toEqual(['p1', 'p3']);
  });
});
