/**
 * Why this test matters: `tour.json` is hand-editable, external data that
 * decides where a visitor sees content. A malformed field must be rejected
 * at the boundary with a message naming the object, not produce a pin at
 * (0, 0) or a photo plane with a zero aspect. The writer re-validates
 * through the reader, so a manifest the creator's session assembled wrong
 * fails on the phone, not on the visitor's.
 */

import { describe, expect, it } from 'vitest';

import {
  createEmptyTourManifest,
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
  TOUR_MANIFEST_VERSION,
  TourManifestValidationError,
} from './tour-manifest';

const pin = {
  id: 'p1',
  kind: 'pin',
  geo: { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 },
  createdAtIso: '2026-09-08T14:00:00.000Z',
  label: 'The old gate',
};
const photo = {
  id: 'f1',
  kind: 'photo',
  geo: { lat: 47.5001, lon: 8.7001, alt: 401, rotation: [0, 0, 0, 1] },
  createdAtIso: '2026-09-08T14:01:00.000Z',
  image: 'content/f1.jpg',
  imageWidth: 1024,
  imageHeight: 768,
};

describe('parseTourManifest', () => {
  it('accepts a pin and a photo and normalises the geo pose like the level parser', () => {
    const manifest = parseTourManifest({
      version: TOUR_MANIFEST_VERSION,
      objects: [
        pin,
        { ...photo, geo: { ...photo.geo, rotation: [0, 0, 0, 1.0004] } },
      ],
    });
    expect(manifest.objects).toHaveLength(2);
    const [first, second] = manifest.objects;
    expect(first?.kind).toBe('pin');
    expect(first?.kind === 'pin' ? first.label : null).toBe('The old gate');
    expect(second?.kind === 'photo' ? second.image : null).toBe(
      'content/f1.jpg'
    );
    expect(second?.geo.rotation).toEqual([0, 0, 0, 1]);
  });

  it('an empty manifest is valid and is what the starter zip carries', () => {
    expect(parseTourManifest(createEmptyTourManifest())).toEqual({
      version: 2,
      minor: 0,
      order: 'fixed',
      objects: [],
      assets: [],
      stations: [],
    });
  });

  it.each([
    ['a non-object', null, /JSON object/],
    [
      'a version that is not a format number',
      { version: '2', objects: [] },
      /"version" must be 1 or 2/,
    ],
    ['version 0', { version: 0, objects: [] }, /"version" must be 1 or 2/],
    [
      'a version from a newer app',
      { version: 3, objects: [] },
      /made with a newer version of the app \(format 3\)/,
    ],
    [
      'a minor that is not a whole number',
      { version: 2, minor: 1.5, objects: [] },
      /"minor" must be an integer >= 0/,
    ],
    [
      'an unknown order',
      { version: 2, order: 'random', objects: [] },
      /"order"/,
    ],
    [
      'an asset whose id an object already uses',
      {
        version: 2,
        objects: [pin],
        assets: [{ id: 'p1', path: 'content/p1.jpg' }],
      },
      /already an object id/,
    ],
    [
      'a station naming a missing asset',
      {
        version: 2,
        objects: [],
        stations: [
          {
            id: 's',
            anchor: { code: 'abc' },
            activateRadiusM: 20,
            foundRadiusM: 5,
            steps: [{ id: 'a', block: { kind: 'image', asset: 'nope' } }],
          },
        ],
      },
      /stations\[0\]\.steps\[0\]\.block\.asset/,
    ],
    ['objects not an array', { version: 1, objects: {} }, /"objects"/],
    [
      'an unknown kind',
      { version: 1, objects: [{ ...pin, kind: 'audio' }] },
      /objects\[0\]\.kind/,
    ],
    [
      'a path-unsafe id',
      { version: 1, objects: [{ ...pin, id: '../x' }] },
      /objects\[0\]\.id/,
    ],
    [
      'a timestamp that is not a date',
      { version: 1, objects: [{ ...pin, createdAtIso: 'yesterday' }] },
      /objects\[0\]\.createdAtIso/,
    ],
    [
      'a pin without a label',
      { version: 1, objects: [{ ...pin, label: '  ' }] },
      /objects\[0\]\.label/,
    ],
    [
      'a photo without an image',
      { version: 1, objects: [{ ...photo, image: undefined }] },
      /objects\[0\]\.image/,
    ],
    [
      'a photo whose image is not its own content entry (M1 review #5)',
      { version: 1, objects: [{ ...photo, image: '../../session.json' }] },
      /objects\[0\]\.image" must be content\/f1\.<ext>/,
    ],
    [
      "a photo whose image names another object's stem",
      { version: 1, objects: [{ ...photo, image: 'content/other.jpg' }] },
      /objects\[0\]\.image/,
    ],
    [
      // K0: SVG can carry script; a photo is a raster image only.
      'a photo whose image is an SVG',
      { version: 1, objects: [{ ...photo, image: 'content/f1.svg' }] },
      /objects\[0\]\.image" must be content\/f1\.<ext> \(an image type\)/,
    ],
    [
      'a photo whose image is a model, not an image',
      { version: 1, objects: [{ ...photo, image: 'content/f1.glb' }] },
      /objects\[0\]\.image" must be content\/f1\.<ext> \(an image type\)/,
    ],
    [
      'a photo with a zero height',
      { version: 1, objects: [{ ...photo, imageHeight: 0 }] },
      /imageHeight/,
    ],
    [
      'a geo pose with a bad latitude, named by object',
      {
        version: 1,
        objects: [pin, { ...photo, geo: { ...photo.geo, lat: 91 } }],
      },
      /objects\[1\]\.geo\.lat/,
    ],
    [
      'a geo pose with neither heading nor rotation',
      { version: 1, objects: [{ ...pin, geo: { lat: 1, lon: 2, alt: 3 } }] },
      /objects\[0\]\.geo".*headingDeg/,
    ],
    [
      'a duplicate id',
      {
        version: 1,
        objects: [pin, { ...photo, id: 'p1', image: 'content/p1.jpg' }],
      },
      /duplicate object id "p1"/,
    ],
  ])('rejects %s', (_label, data, message) => {
    expect(() => parseTourManifest(data)).toThrow(TourManifestValidationError);
    expect(() => parseTourManifest(data)).toThrow(message);
  });
});

describe('the version policy (tour kit plan K1, §8 D7)', () => {
  const station = {
    id: 'gate',
    title: 'The gate',
    anchor: { code: 'a1b2c3d4e5f6' },
    activateRadiusM: 25,
    foundRadiusM: 4,
    steps: [{ id: 'hi', block: { kind: 'text', text: 'Hello' } }],
  };

  it('migrates a version 1 tour: its pins and photos stay as free objects, with the v2 defaults', () => {
    const migrated = parseTourManifest({ version: 1, objects: [pin, photo] });
    expect(TOUR_MANIFEST_VERSION).toBe(2);
    expect(migrated).toEqual({
      version: 2,
      minor: 0,
      order: 'fixed',
      objects: parseTourManifest({ version: 2, objects: [pin, photo] }).objects,
      assets: [],
      stations: [],
    });
  });

  it('a migrated v1 tour is written back as version 2', () => {
    const text = serializeTourManifest(
      parseTourManifest({ version: 1, objects: [pin] })
    );
    expect(JSON.parse(text)).toMatchObject({ version: 2, minor: 0 });
  });

  it('reads a full v2 tour: title, order, assets and stations', () => {
    const manifest = parseTourManifest({
      version: 2,
      title: 'Castle walk',
      order: 'branch',
      objects: [pin],
      assets: [{ id: 'knight', path: 'content/knight.png' }],
      stations: [
        {
          ...station,
          steps: [
            {
              id: 'hi',
              block: {
                kind: 'character',
                name: 'Kurt',
                image: 'knight',
                caption: 'Hi',
              },
            },
          ],
        },
      ],
    });
    expect(manifest.title).toBe('Castle walk');
    expect(manifest.order).toBe('branch');
    expect(manifest.assets[0]?.kind).toBe('image');
    expect(manifest.stations[0]?.steps[0]?.block.kind).toBe('character');
  });

  it('opens a tour of a NEWER minor, ignoring the fields it does not know', () => {
    const manifest = parseTourManifest({
      version: 2,
      minor: 7,
      futureField: { anything: true },
      objects: [{ ...pin, futureObjectField: 1 }],
      stations: [{ ...station, futureStationField: 'x' }],
    });
    expect(manifest.minor).toBe(7);
    expect(manifest).not.toHaveProperty('futureField');
    expect(manifest.objects[0]).not.toHaveProperty('futureObjectField');
    expect(manifest.stations[0]).not.toHaveProperty('futureStationField');
  });

  it('refuses to WRITE a tour of a newer minor: saving would drop what this version cannot read', () => {
    const newer = parseTourManifest({
      version: 2,
      minor: TOUR_MANIFEST_MINOR + 1,
      objects: [],
    });
    expect(() => serializeTourManifest(newer)).toThrow(
      /made with a newer version of the app/
    );
    expect(() =>
      serializeTourManifest({ ...newer, minor: TOUR_MANIFEST_MINOR })
    ).not.toThrow();
  });
});

describe('serializeTourManifest', () => {
  it('round-trips through parseTourManifest', () => {
    const manifest = parseTourManifest({ version: 2, objects: [pin, photo] });
    expect(
      parseTourManifest(JSON.parse(serializeTourManifest(manifest)))
    ).toEqual(manifest);
  });

  it('refuses to write a manifest the reader would reject', () => {
    expect(() =>
      serializeTourManifest({
        ...createEmptyTourManifest(),
        objects: [{ ...pin, label: '' } as never],
      })
    ).toThrow(TourManifestValidationError);
  });
});
