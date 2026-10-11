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

  it('a tour with nothing version 2 needs is WRITTEN as version 1, which builds before K1 open (K1 milestone review R10)', () => {
    // Why: the deployed main and older previews read only version 1, and
    // refuse anything else. A Finish of a pins-and-photos tour must stay
    // openable there; only a tour that USES version 2 needs the new number.
    const text = serializeTourManifest(
      parseTourManifest({ version: 1, objects: [pin, photo] })
    );
    const written = JSON.parse(text) as Record<string, unknown>;
    // Exactly the shape the pre-K1 reader checks: version 1 and objects.
    expect(Object.keys(written).sort()).toEqual(['objects', 'version']);
    expect(written['version']).toBe(1);
    expect(parseTourManifest(written)).toEqual(
      parseTourManifest({ version: 2, objects: [pin, photo] })
    );
    expect(
      JSON.parse(serializeTourManifest(createEmptyTourManifest()))
    ).toEqual({ version: 1, objects: [] });
  });

  it.each([
    ['a title', { title: 'Castle walk' }],
    ['an order other than fixed', { order: 'any' }],
    ['an asset', { assets: [{ id: 'knight', path: 'content/knight.png' }] }],
    ['a station', { stations: [station] }],
  ])('a tour with %s is written as version 2', (_label, extra) => {
    const text = serializeTourManifest(
      parseTourManifest({ version: 2, objects: [pin], ...extra })
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

  describe('unknown values of a closed list (K1 milestone review R4)', () => {
    // Why: "minor versions are additive" is only true if a reader of an
    // older minor survives what a newer one ADDS - a new block kind, a new
    // hint, a new quiz type. Such a value degrades (the step is skipped,
    // the hint is the arrow) when the file says it is newer; at this
    // reader's own minor or below the same value is a broken file.
    const newer = TOUR_MANIFEST_MINOR + 1;
    const knight = { id: 'knight', path: 'content/knight.png' };
    const steps = [
      { id: 'hi', block: { kind: 'text', text: 'Hello' } },
      { id: 'hologram', block: { kind: 'hologram', asset: 'knight' } },
      {
        id: 'q',
        block: {
          kind: 'quiz',
          question: 'Which way?',
          points: 1,
          answer: { type: 'map-pick', area: 3 },
        },
      },
      {
        id: 'see',
        block: { kind: 'image', asset: 'scan' },
        advance: { mode: 'gaze' },
      },
      {
        id: 'pick',
        block: {
          kind: 'choice',
          prompt: 'Next?',
          options: [
            { id: 'a', label: 'Hello again', goto: 'hi' },
            { id: 'b', label: 'The hologram', goto: 'hologram' },
          ],
        },
      },
      {
        id: 'bye',
        block: { kind: 'text', text: 'Bye' },
        advance: { mode: 'gaze' },
      },
    ];
    const tour = (minor: number) => ({
      version: 2,
      minor,
      order: 'spiral',
      objects: [pin, { ...pin, id: 'p9', kind: 'sticker' }],
      assets: [knight, { id: 'scan', path: 'content/scan.splat' }],
      stations: [{ ...station, hint: 'compass', steps }],
    });

    it('a newer minor opens: the steps it cannot show are skipped, the rest degrades', () => {
      const manifest = parseTourManifest(tour(newer));
      expect(manifest.minor).toBe(newer);
      // An unknown order offers every station: nothing can deadlock.
      expect(manifest.order).toBe('any');
      expect(manifest.objects.map((o) => o.id)).toEqual(['p1']);
      expect(manifest.assets.map((a) => a.id)).toEqual(['knight']);
      const [gate] = manifest.stations;
      expect(gate?.hint).toBe('arrow');
      // Skipped: the unknown block, the unknown quiz type, the block whose
      // asset is of a type this reader does not know, and the choice that
      // was left with one option once its target was skipped.
      expect(gate?.steps.map((s) => s.id)).toEqual(['hi', 'bye']);
      expect(gate?.steps[1]?.advance).toEqual({ mode: 'tap' });
    });

    it("the same file at this reader's own minor is refused", () => {
      expect(() => parseTourManifest(tour(TOUR_MANIFEST_MINOR))).toThrow(
        TourManifestValidationError
      );
    });

    it('a degraded tour can never be written back', () => {
      expect(() =>
        serializeTourManifest(parseTourManifest(tour(newer)))
      ).toThrow(/made with a newer version of the app/);
    });
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

describe('baked capture spots (scan-pass plan S1, S-D11)', () => {
  // Why: a recorded photo's spot is computed ONCE, at the creator's Finish,
  // so a visitor neither downloads the walk nor replays it. The field is
  // the "baked" marker the viewer trusts instead of its live join, so a
  // malformed one must be refused here, never placed at a guessed spot.
  const capture = {
    image: 'images/frame-0001.jpg',
    geo: {
      lat: 48.1374,
      lon: 11.5755,
      alt: 520,
      rotation: [0, 0, 0, 1] as [number, number, number, number],
    },
  };
  const spots = { fixes: 46, gpsAccuracyMedianM: 3.5, captures: [capture] };

  it('reads and round-trips the baked spots', () => {
    const manifest = parseTourManifest({
      version: 2,
      minor: 1,
      objects: [],
      captureSpots: spots,
    });
    expect(manifest.captureSpots).toEqual(spots);
    expect(
      parseTourManifest(JSON.parse(serializeTourManifest(manifest)))
    ).toEqual(manifest);
  });

  it('keeps an unknown median accuracy unknown (null), never a guessed number', () => {
    const manifest = parseTourManifest({
      version: 2,
      minor: 1,
      objects: [],
      captureSpots: { ...spots, gpsAccuracyMedianM: null },
    });
    expect(manifest.captureSpots?.gpsAccuracyMedianM).toBeNull();
  });

  it('is written at minor 1, the revision that added it, so an older writer refuses to drop it', () => {
    const written = JSON.parse(
      serializeTourManifest({
        ...createEmptyTourManifest(),
        captureSpots: spots,
      })
    ) as { version: number; minor: number };
    expect(written.version).toBe(2);
    expect(written.minor).toBe(1);
  });

  it('a tour WITHOUT baked spots is still written as version 1, whatever minor it was read at', () => {
    // Lossless: this reader knows every field up to its own minor, so a
    // file read at minor 1 that carries none of them needs nothing newer.
    const read = parseTourManifest({ version: 2, minor: 1, objects: [pin] });
    expect(JSON.parse(serializeTourManifest(read))).toEqual({
      version: 1,
      objects: [pin],
    });
  });

  it.each([
    ['a path that escapes the zip', { ...capture, image: '../x.jpg' }],
    ['an absolute path', { ...capture, image: '/images/x.jpg' }],
    ['a type that is not an image', { ...capture, image: 'images/x.glb' }],
    ['a type outside the allowlist', { ...capture, image: 'images/x.svg' }],
    [
      'a pose without a rotation (photos face as captured)',
      { ...capture, geo: { lat: 48, lon: 11, alt: 520, headingDeg: 10 } },
    ],
  ])('refuses a capture with %s', (_name, bad) => {
    expect(() =>
      parseTourManifest({
        version: 2,
        minor: 1,
        objects: [],
        captureSpots: { ...spots, captures: [bad] },
      })
    ).toThrow(TourManifestValidationError);
  });

  it.each([
    ['no captures', { ...spots, captures: [] }],
    ['the same photo twice', { ...spots, captures: [capture, capture] }],
    ['a fix count that is not a positive integer', { ...spots, fixes: 0 }],
    ['a negative accuracy', { ...spots, gpsAccuracyMedianM: -1 }],
    ['an accuracy that is not a number', { ...spots, gpsAccuracyMedianM: '3' }],
    ['captures that are not a list', { ...spots, captures: {} }],
  ])('refuses spots with %s', (_name, bad) => {
    expect(() =>
      parseTourManifest({
        version: 2,
        minor: 1,
        objects: [],
        captureSpots: bad,
      })
    ).toThrow(TourManifestValidationError);
  });

  it('a NEWER minor with spots this build cannot read opens without them, instead of failing the tour', () => {
    // Why (S1 milestone review #8): additive revisions must degrade
    // (K1 R4). A later minor that extends the spots (a new image type, a
    // capture without a rotation) would otherwise break every older
    // viewer's open; without the spots the viewer falls back to its own
    // join or the photo ring.
    const read = parseTourManifest({
      version: 2,
      minor: TOUR_MANIFEST_MINOR + 1,
      objects: [],
      captureSpots: { ...spots, captures: [{ image: 'images/x.heic' }] },
    });
    expect(read.captureSpots).toBeUndefined();
  });

  it('TRIPWIRE: raising TOUR_MANIFEST_MINOR must teach the writer what needs the new minor', () => {
    // The writer writes the LOWEST minor a manifest's content needs
    // (minorNeeded in tour-manifest.ts). A field added at minor 2 that
    // minorNeeded does not know would be written at minor 1, and a minor-1
    // reader parses minor-1 files strictly - so the tour would stop
    // opening there. When this fails: extend minorNeeded for the new
    // field, add its round trip, then move this number.
    expect(TOUR_MANIFEST_MINOR).toBe(1);
  });

  it('a version 1 document carries no baked spots (the field is version 2)', () => {
    expect(
      parseTourManifest({ version: 1, objects: [], captureSpots: spots })
        .captureSpots
    ).toBeUndefined();
  });
});
