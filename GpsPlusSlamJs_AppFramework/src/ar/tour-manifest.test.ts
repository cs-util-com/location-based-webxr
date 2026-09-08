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
    expect(manifest.objects[0]?.label).toBe('The old gate');
    expect(manifest.objects[1]?.image).toBe('content/f1.jpg');
    expect(manifest.objects[1]?.geo.rotation).toEqual([0, 0, 0, 1]);
  });

  it('an empty manifest is valid and is what the starter zip carries', () => {
    expect(parseTourManifest(createEmptyTourManifest())).toEqual({
      version: 1,
      objects: [],
    });
  });

  it.each([
    ['a non-object', null, /JSON object/],
    ['a wrong version', { version: 2, objects: [] }, /"version"/],
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
      { version: 1, objects: [pin, { ...photo, id: 'p1' }] },
      /duplicate object id "p1"/,
    ],
  ])('rejects %s', (_label, data, message) => {
    expect(() => parseTourManifest(data)).toThrow(TourManifestValidationError);
    expect(() => parseTourManifest(data)).toThrow(message);
  });
});

describe('serializeTourManifest', () => {
  it('round-trips through parseTourManifest', () => {
    const manifest = parseTourManifest({ version: 1, objects: [pin, photo] });
    expect(
      parseTourManifest(JSON.parse(serializeTourManifest(manifest)))
    ).toEqual(manifest);
  });

  it('refuses to write a manifest the reader would reject', () => {
    expect(() =>
      serializeTourManifest({
        version: 1,
        objects: [{ ...pin, label: '' } as never],
      })
    ).toThrow(TourManifestValidationError);
  });
});
