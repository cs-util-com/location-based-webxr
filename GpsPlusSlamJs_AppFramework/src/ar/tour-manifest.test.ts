/**
 * Why this test matters: `tour.json` is hand-editable, external data that
 * decides where a visitor sees content. A malformed field must be rejected
 * at the boundary with a message naming the record, not produce a pin at
 * (0, 0) or a photo plane with a zero aspect. The writer re-validates
 * through the reader, so a manifest the creator's session assembled wrong
 * fails on the phone, not on the visitor's. Version 3 (tour editor plan
 * 2026-10-17-1816, W3) nests every pin and photo in a station at a local
 * pose, and refuses the older formats with a message that says so (D5:
 * no migration).
 */

import { describe, expect, it } from 'vitest';

import {
  createEmptyTourManifest,
  parseTourManifest,
  parseTourObject,
  serializeTourManifest,
  tourItems,
  TOUR_MANIFEST_MINOR,
  TOUR_MANIFEST_VERSION,
  TourManifestValidationError,
} from './tour-manifest';

const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] };
const pin = {
  id: 'p1',
  kind: 'pin',
  createdAtIso: '2026-09-08T14:00:00.000Z',
  label: 'The old gate',
  pose: POSE,
};
const photo = {
  id: 'f1',
  kind: 'photo',
  createdAtIso: '2026-09-08T14:01:00.000Z',
  image: 'content/f1.jpg',
  imageWidth: 1024,
  imageHeight: 768,
  pose: { position: [0, 1.5, -3], rotation: [0, 0.6, 0, 0.8] },
};
const GEO = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };

function station(items: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: 'gate',
    title: 'The gate',
    geo: GEO,
    activateRadiusM: 25,
    foundRadiusM: 4,
    steps: [{ id: 'hi', block: { kind: 'text', text: 'Hello' } }],
    items,
    ...extra,
  };
}

function tour(extra: Record<string, unknown> = {}) {
  return { version: 3, stations: [station([pin, photo])], ...extra };
}

describe('parseTourManifest', () => {
  it('reads a station with a pin and a photo at local poses, renormalising a rotation like the level parser', () => {
    const manifest = parseTourManifest(
      tour({
        stations: [
          station([
            pin,
            {
              ...photo,
              pose: { ...photo.pose, rotation: [0, 0.6, 0, 0.8004] },
            },
          ]),
        ],
      })
    );
    const [first, second] = tourItems(manifest);
    expect(first?.kind).toBe('pin');
    expect(first?.kind === 'pin' ? first.label : null).toBe('The old gate');
    expect(second?.kind === 'photo' ? second.image : null).toBe(
      'content/f1.jpg'
    );
    const r = second!.pose.rotation;
    expect(Math.hypot(...r)).toBeCloseTo(1, 12);
  });

  it('an empty manifest is valid and is what the starter zip carries', () => {
    expect(parseTourManifest(createEmptyTourManifest())).toEqual({
      version: 3,
      minor: 0,
      order: 'fixed',
      assets: [],
      stations: [],
    });
  });

  it.each([
    ['a non-object', null, /JSON object/],
    [
      'a version that is not a format number',
      { version: '3', stations: [] },
      /"version" must be 3/,
    ],
    ['version 0', { version: 0, stations: [] }, /"version" must be 3/],
    [
      'a version from a newer app',
      { version: 4, stations: [] },
      /made with a newer version of the app \(format 4\)/,
    ],
    [
      'a minor that is not a whole number',
      { version: 3, minor: 1.5, stations: [] },
      /"minor" must be an integer >= 0/,
    ],
    [
      'an unknown order',
      { version: 3, order: 'random', stations: [] },
      /"order"/,
    ],
    [
      'an asset whose id an item already uses',
      tour({ assets: [{ id: 'p1', path: 'content/p1.jpg' }] }),
      /assets\[0\]\.id" "p1" is already an item id/,
    ],
    [
      'the same item id in two stations',
      {
        version: 3,
        stations: [station([pin]), { ...station([pin]), id: 'well' }],
      },
      /duplicate item id "p1"/,
    ],
    [
      'a station naming a missing asset',
      {
        version: 3,
        stations: [
          station([], {
            steps: [{ id: 'a', block: { kind: 'image', asset: 'nope' } }],
          }),
        ],
      },
      /stations\[0\]\.steps\[0\]\.block\.asset/,
    ],
    [
      'an unknown item kind',
      tour({ stations: [station([{ ...pin, kind: 'audio' }])] }),
      /stations\[0\]\.items\[0\]\.kind/,
    ],
    [
      'a path-unsafe item id',
      tour({ stations: [station([{ ...pin, id: '../x' }])] }),
      /stations\[0\]\.items\[0\]\.id/,
    ],
    [
      'a timestamp that is not a date',
      tour({ stations: [station([{ ...pin, createdAtIso: 'yesterday' }])] }),
      /stations\[0\]\.items\[0\]\.createdAtIso/,
    ],
    [
      'a pin without a label',
      tour({ stations: [station([{ ...pin, label: '  ' }])] }),
      /stations\[0\]\.items\[0\]\.label/,
    ],
    [
      'a photo whose image is not its own content entry (M1 review #5)',
      tour({
        stations: [station([{ ...photo, image: '../../session.json' }])],
      }),
      /items\[0\]\.image" must be content\/f1\.<ext>/,
    ],
    [
      // K0: SVG can carry script; a photo is a raster image only.
      'a photo whose image is an SVG',
      tour({ stations: [station([{ ...photo, image: 'content/f1.svg' }])] }),
      /items\[0\]\.image" must be content\/f1\.<ext> \(an image type\)/,
    ],
    [
      'a photo with a zero height',
      tour({ stations: [station([{ ...photo, imageHeight: 0 }])] }),
      /imageHeight/,
    ],
    [
      'an item pose with a position that is not three numbers',
      tour({
        stations: [station([{ ...pin, pose: { ...POSE, position: [1, 2] } }])],
      }),
      /items\[0\]\.pose\.position/,
    ],
    [
      'a station geo pose with neither heading nor rotation',
      tour({ stations: [station([], { geo: { lat: 1, lon: 2, alt: 3 } })] }),
      /stations\[0\]\.geo".*headingDeg/,
    ],
  ])('rejects %s', (_label, data, message) => {
    expect(() => parseTourManifest(data)).toThrow(TourManifestValidationError);
    expect(() => parseTourManifest(data)).toThrow(message);
  });
});

describe('the version policy (tour editor plan W3, D5)', () => {
  it('is version 3, minor 1 (minor 1 adds the placed 3D model)', () => {
    expect([TOUR_MANIFEST_VERSION, TOUR_MANIFEST_MINOR]).toEqual([3, 1]);
  });

  it.each([1, 2])(
    'refuses a version %i tour with a message that says it is an older format: no migration',
    (version) => {
      // Why (D5): the one test tour is replaced; a creator who opens an old
      // file must learn why it does not open, never meet an empty tour.
      const old = {
        version,
        objects: [
          {
            id: 'p1',
            kind: 'pin',
            label: 'x',
            createdAtIso: '2026-01-01T00:00:00.000Z',
            geo: GEO,
          },
        ],
      };
      expect(() => parseTourManifest(old)).toThrow(
        new RegExp(
          `older format \\(version ${String(version)}\\) that this version of the app no longer opens`
        )
      );
    }
  );

  it('writes version 3 at minor 0 while the tour has no model, with every station and its items', () => {
    const written = JSON.parse(
      serializeTourManifest(parseTourManifest(tour()))
    ) as Record<string, unknown>;
    expect(written).toMatchObject({ version: 3, minor: 0 });
    expect(written).not.toHaveProperty('objects');
    expect(
      JSON.parse(serializeTourManifest(createEmptyTourManifest()))
    ).toEqual({
      version: 3,
      minor: 0,
      order: 'fixed',
      assets: [],
      stations: [],
    });
  });

  it("reads the title trimmed, as the editor's name field writes it", () => {
    // Why (M4a review #10): the editor trims the name it writes, so a title
    // read untrimmed differed from its own field and counted as a change.
    expect(
      parseTourManifest({ version: 3, title: '  Castle walk \n', stations: [] })
        .title
    ).toBe('Castle walk');
  });

  it('reads a full tour: title, order, assets, stations with steps and items', () => {
    const manifest = parseTourManifest(
      tour({
        title: 'Castle walk',
        order: 'branch',
        assets: [{ id: 'knight', path: 'content/knight.png' }],
        stations: [
          station([pin], {
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
          }),
        ],
      })
    );
    expect(manifest.title).toBe('Castle walk');
    expect(manifest.order).toBe('branch');
    expect(manifest.assets[0]?.kind).toBe('image');
    expect(manifest.stations[0]?.steps[0]?.block.kind).toBe('character');
    expect(manifest.stations[0]?.items.map((i) => i.id)).toEqual(['p1']);
  });

  it('opens a tour of a NEWER minor, ignoring the fields it does not know', () => {
    const manifest = parseTourManifest({
      version: 3,
      minor: 7,
      futureField: { anything: true },
      stations: [
        station([{ ...pin, futureItemField: 1 }], { futureStationField: 'x' }),
      ],
    });
    expect(manifest.minor).toBe(7);
    expect(manifest).not.toHaveProperty('futureField');
    expect(manifest.stations[0]?.items[0]).not.toHaveProperty(
      'futureItemField'
    );
    expect(manifest.stations[0]).not.toHaveProperty('futureStationField');
  });

  describe('unknown values of a closed list (K1 milestone review R4)', () => {
    // Why: "minor versions are additive" is only true if a reader of an
    // older minor survives what a newer one ADDS - a new item kind, a new
    // block kind, a new order. Such a value degrades when the file says it
    // is newer; at this reader's own minor the same value is a broken file.
    const newer = TOUR_MANIFEST_MINOR + 1;
    const file = (minor: number) => ({
      version: 3,
      minor,
      order: 'spiral',
      stations: [
        station(
          [
            pin,
            { ...pin, id: 'p9', kind: 'sticker' },
            { ...photo, image: 'content/f1.heic' },
          ],
          {
            hint: 'compass',
            steps: [
              { id: 'hi', block: { kind: 'text', text: 'Hello' } },
              { id: 'holo', block: { kind: 'hologram' } },
            ],
          }
        ),
      ],
    });

    it('a newer minor opens: what it cannot show is left out, the rest degrades', () => {
      const manifest = parseTourManifest(file(newer));
      expect(manifest.order).toBe('any');
      expect(tourItems(manifest).map((i) => i.id)).toEqual(['p1']);
      expect(manifest.stations[0]?.hint).toBe('arrow');
      expect(manifest.stations[0]?.steps.map((s) => s.id)).toEqual(['hi']);
    });

    it("the same file at this reader's own minor is refused", () => {
      expect(() => parseTourManifest(file(TOUR_MANIFEST_MINOR))).toThrow(
        TourManifestValidationError
      );
    });

    it('a degraded tour can never be written back', () => {
      expect(() =>
        serializeTourManifest(parseTourManifest(file(newer)))
      ).toThrow(/made with a newer version of the app/);
    });
  });
});

describe('a placed 3D model (minor 1, a size in metres)', () => {
  // Why: the model is the one item a 3.0 reader does not know, so a tour
  // carrying one is written at minor 1 - a 3.0 reader then leaves the
  // model out instead of refusing the tour - and a tour without one keeps
  // minor 0, so every tour made before stays editable by a 3.0 reader. The size must come back exactly: it is the creator's
  // number.
  const model = {
    id: 'm1',
    kind: 'model',
    asset: 'arch',
    sizeM: 12.75,
    label: 'The old arch',
    createdAtIso: '2026-10-19T12:00:00.000Z',
    pose: { position: [4, 0, -1], rotation: [0, 0.6, 0, 0.8] },
  };
  const withModel = () =>
    tour({
      assets: [{ id: 'arch', path: 'content/arch.glb' }],
      stations: [station([pin, photo, model])],
    });

  it('writes a tour carrying a model at minor 1, and reads it back exactly', () => {
    const manifest = parseTourManifest(withModel());
    const json = serializeTourManifest(manifest);
    expect(JSON.parse(json)).toMatchObject({ version: 3, minor: 1 });
    const again = parseTourManifest(JSON.parse(json));
    expect(again).toEqual({ ...manifest, minor: 1 });
    expect(tourItems(again).find((i) => i.id === 'm1')).toEqual(model);
  });

  it('writes minor 0 again once the last model is gone', () => {
    const manifest = parseTourManifest({ ...withModel(), minor: 1 });
    const without = {
      ...manifest,
      stations: manifest.stations.map((s) => ({
        ...s,
        items: s.items.filter((i) => i.kind !== 'model'),
      })),
    };
    expect(JSON.parse(serializeTourManifest(without))).toMatchObject({
      minor: 0,
    });
  });

  it("a newer minor's model beyond this reader's bound is left out", () => {
    const manifest = parseTourManifest({
      ...withModel(),
      minor: TOUR_MANIFEST_MINOR + 1,
      stations: [station([pin, { ...model, sizeM: 900 }])],
    });
    expect(tourItems(manifest).map((i) => i.id)).toEqual(['p1']);
  });

  // Why: items and assets share one id namespace - a model names an
  // asset by id, so an item with an asset's id would make that reference
  // ambiguous.
  it('a model id may not be an asset id: one id namespace across items and assets', () => {
    expect(() =>
      parseTourManifest(
        tour({
          assets: [{ id: 'arch', path: 'content/arch.glb' }],
          stations: [station([{ ...model, id: 'arch' }])],
        })
      )
    ).toThrow(/"assets\[0\]\.id" "arch" is already an item id/);
  });

  it('the world view a draft keeps carries a model with its size', () => {
    const { pose: _pose, ...fields } = model;
    const world = { ...fields, geo: GEO, station: 'gate' };
    expect(parseTourObject(world)).toEqual(world);
    expect(() => parseTourObject({ ...world, sizeM: 0 })).toThrow(
      /object\.sizeM/
    );
  });
});

describe('serializeTourManifest', () => {
  it('round-trips through parseTourManifest, every local pose exactly', () => {
    const manifest = parseTourManifest(tour());
    expect(
      parseTourManifest(JSON.parse(serializeTourManifest(manifest)))
    ).toEqual(manifest);
  });

  it('refuses to write a manifest the reader would reject', () => {
    const manifest = parseTourManifest(tour());
    expect(() =>
      serializeTourManifest({
        ...manifest,
        stations: [
          { ...manifest.stations[0]!, items: [{ ...pin, label: '' } as never] },
        ],
      })
    ).toThrow(TourManifestValidationError);
  });
});

describe('parseTourObject (the world view a draft keeps)', () => {
  // Why: a creator's on-device draft keeps pins and photos in the world
  // (geo poses), before a station holds them; the same fields as an item,
  // checked by the same rules.
  const worldPin = {
    id: 'p1',
    kind: 'pin',
    label: 'Gate',
    createdAtIso: '2026-10-18T06:00:00.000Z',
    geo: GEO,
  };

  it('reads a world pin, with or without its station', () => {
    expect(parseTourObject(worldPin)).toEqual(worldPin);
    expect(parseTourObject({ ...worldPin, station: 'gate' })).toEqual({
      ...worldPin,
      station: 'gate',
    });
  });

  it.each([
    ['no geo pose', { ...worldPin, geo: undefined }, /object\.geo/],
    ['a bad station id', { ...worldPin, station: 'a b' }, /object\.station/],
    ['an unknown kind', { ...worldPin, kind: 'audio' }, /object\.kind/],
  ])('refuses %s', (_name, bad, message) => {
    expect(() => parseTourObject(bad)).toThrow(message);
  });
});

describe("an earlier file's captureSpots (removed from the format)", () => {
  // Why: the walk's camera captures are debug data, never tour content, and
  // the field that once baked them into tour.json is gone from the format.
  // A file that still carries it must open as if the field were any other
  // unknown one (ignored, every station kept as written), and no write may
  // carry it on: a stale field a later reader could trust again.
  const capture = {
    image: 'images/frame-0001.jpg',
    station: 'walk-1',
    pose: { position: [2, 1.4, 0], rotation: [0, 0, 0, 1] },
  };
  const spots = { fixes: 46, gpsAccuracyMedianM: 3.5, captures: [capture] };
  // The empty station only the capture named, as the earlier bake wrote it.
  const walkStation = station([], {
    id: 'walk-1',
    title: undefined,
    steps: [],
  });

  it('reads a file that carries it without it, every station kept as written', () => {
    const manifest = parseTourManifest(
      tour({
        stations: [station([pin, photo]), walkStation],
        captureSpots: spots,
      })
    );
    expect('captureSpots' in manifest).toBe(false);
    expect(manifest.stations.map((s) => s.id)).toEqual(['gate', 'walk-1']);
    expect(manifest.stations[1]?.items).toEqual([]);
  });

  it('a malformed one no longer fails the tour: it is an unknown field', () => {
    for (const bad of [
      { ...spots, captures: [] },
      { ...spots, captures: [{ ...capture, image: '../x.jpg' }] },
      { ...spots, captures: [{ ...capture, station: 'nope' }] },
      'not an object',
    ]) {
      expect(() =>
        parseTourManifest(tour({ captureSpots: bad }))
      ).not.toThrow();
    }
  });

  it('is never written: a manifest object that still carries it is saved without it', () => {
    const carried = {
      ...parseTourManifest(tour()),
      captureSpots: spots,
    } as Parameters<typeof serializeTourManifest>[0];
    const written = JSON.parse(serializeTourManifest(carried)) as object;
    expect('captureSpots' in written).toBe(false);
  });
});

describe('a tour that needs no GPS (Tour Viewer QR-first, owner decision Q-QF-1)', () => {
  // Why: a creator can mark a tour whose printed codes place it on their
  // own, so its visitors are never asked for their location. Absent - and
  // false - mean location as before; only true is kept.
  it('reads and round-trips needsNoGps: true', () => {
    const manifest = parseTourManifest(tour({ needsNoGps: true }));
    expect(manifest.needsNoGps).toBe(true);
    const written = JSON.parse(serializeTourManifest(manifest)) as unknown;
    expect(written).toMatchObject({ needsNoGps: true });
    expect(parseTourManifest(written)).toEqual(manifest);
  });

  it('reads false, and an absent flag, as no flag', () => {
    for (const needsNoGps of [false, undefined]) {
      const manifest = parseTourManifest(
        tour(needsNoGps === undefined ? {} : { needsNoGps })
      );
      expect(manifest).not.toHaveProperty('needsNoGps');
      expect(JSON.parse(serializeTourManifest(manifest))).not.toHaveProperty(
        'needsNoGps'
      );
    }
  });

  it("refuses a flag that is not a boolean at this reader's minor, and ignores it at a newer one", () => {
    expect(() => parseTourManifest(tour({ needsNoGps: 'yes' }))).toThrow(
      /"needsNoGps" must be true or false/
    );
    expect(
      parseTourManifest(
        tour({ minor: TOUR_MANIFEST_MINOR + 1, needsNoGps: 'yes' })
      )
    ).not.toHaveProperty('needsNoGps');
  });
});

describe('tour details (tour editor plan 2026-10-17-1816, W2, D15)', () => {
  // Why: a tour has a description, a cover (one of its own images: a
  // station's photo or an image asset) and a contact the visitor's error
  // messages show. They are cosmetic, so a bad value costs the value,
  // never the tour - a deleted cover photo included.
  const asset = { id: 'art', path: 'content/art.png', width: 640, height: 480 };
  const details = {
    description: 'Up to the castle and back.',
    cover: 'f1',
    contact: 'guide@example.org',
  };

  it('reads and round-trips the details', () => {
    const manifest = parseTourManifest(tour(details));
    expect(manifest).toMatchObject(details);
    const written = JSON.parse(serializeTourManifest(manifest)) as unknown;
    expect(written).toMatchObject(details);
    expect(parseTourManifest(written)).toEqual(manifest);
  });

  it("a cover may be a station's photo or an image asset, never another kind", () => {
    expect(
      parseTourManifest(
        tour({
          assets: [asset, { id: 'song', path: 'content/song.mp3' }],
          cover: 'art',
        })
      ).cover
    ).toBe('art');
    expect(
      parseTourManifest(
        tour({
          assets: [{ id: 'song', path: 'content/song.mp3' }],
          cover: 'song',
        })
      )
    ).not.toHaveProperty('cover');
    // A pin is not an image either.
    expect(parseTourManifest(tour({ cover: 'p1' }))).not.toHaveProperty(
      'cover'
    );
  });

  it('a bad detail is dropped with its reason, and the tour still opens', () => {
    const dropped: string[] = [];
    const manifest = parseTourManifest(
      tour({
        stations: [station([pin])],
        description: 'Fine.',
        cover: 'f1',
        contact: 'javascript:alert(1)',
      }),
      {
        onDropped: (drop) => {
          dropped.push(`${drop.field}: ${drop.reason}`);
        },
      }
    );
    expect(manifest.description).toBe('Fine.');
    expect(manifest).not.toHaveProperty('cover');
    expect(manifest).not.toHaveProperty('contact');
    expect(dropped).toEqual([
      'cover: "cover" names no image of this tour',
      expect.stringMatching(/^contact: /),
    ]);
  });

  it('the writer drops a cover whose image went (a deleted photo), and says so', () => {
    const manifest = parseTourManifest(tour({ cover: 'f1' }));
    const withoutPhoto = {
      ...manifest,
      stations: [
        {
          ...manifest.stations[0]!,
          items: manifest.stations[0]!.items.filter((i) => i.id !== 'f1'),
        },
      ],
    };
    const dropped: string[] = [];
    const written = JSON.parse(
      serializeTourManifest(withoutPhoto, {
        onDropped: (drop) => {
          dropped.push(drop.field);
        },
      })
    ) as Record<string, unknown>;
    expect(written).not.toHaveProperty('cover');
    expect(dropped).toEqual(['cover']);
  });

  it('the writer refuses a description or contact its reader would drop: a programming error fails loud', () => {
    const manifest = parseTourManifest(tour());
    expect(() =>
      serializeTourManifest({ ...manifest, contact: 'call me' })
    ).toThrow(/"contact" must be an e-mail address/);
    expect(() =>
      serializeTourManifest({ ...manifest, description: '   ' })
    ).toThrow(/"description" is empty/);
  });

  // Why (PR #638 review): the writer let EVERY dropped cover pass silently.
  // Only a cover whose image went is a creator's ordinary edit; a cover
  // that is not an id at all is the page's bug, and dropping it quietly
  // hid that, as a malformed contact would have been hidden.
  it('the writer refuses a cover that is not an image id: only a missing image is dropped quietly', () => {
    const manifest = parseTourManifest(tour({ cover: 'f1' }));
    for (const cover of [42, 'not/an id', '']) {
      expect(() =>
        serializeTourManifest({ ...manifest, cover } as never)
      ).toThrow(/"cover" must be an image id/);
    }
    expect(() =>
      serializeTourManifest({ ...manifest, cover: 'gone' })
    ).not.toThrow();
  });
});

describe('a stable tour id (debug-captures plan, Q-I)', () => {
  // Why: a tour opened from a FILE has no link to be known by, so a
  // creator's draft was keyed by a fingerprint of the file's content -
  // which a tour of authored files alone changes at every save, leaving
  // the draft behind. An id the tour itself carries, written by every
  // save, is a key that survives saves. Optional: a tour without one
  // reads as before, and a bad one costs the id, never the tour.
  it('reads and round-trips an id, at the minor the tour needs', () => {
    const manifest = parseTourManifest(tour({ tourId: 'a1B2_c3-D4' }));
    expect(manifest.tourId).toBe('a1B2_c3-D4');
    const written = JSON.parse(serializeTourManifest(manifest)) as unknown;
    // No minor of its own: a 3.0 or 3.1 reader ignores the field, and a
    // writer of either keeps saving the tour (it only drops the id).
    expect(written).toMatchObject({ tourId: 'a1B2_c3-D4', minor: 0 });
    expect(parseTourManifest(written)).toEqual(manifest);
  });

  it('reads a tour without an id as none', () => {
    const manifest = parseTourManifest(tour());
    expect(manifest).not.toHaveProperty('tourId');
    expect(JSON.parse(serializeTourManifest(manifest))).not.toHaveProperty(
      'tourId'
    );
  });

  it('reads an id that is not a short path-safe string as none, at every minor', () => {
    for (const tourId of [42, '', 'has space', 'a/b', 'x'.repeat(65), null]) {
      for (const minor of [0, TOUR_MANIFEST_MINOR + 1]) {
        expect(parseTourManifest(tour({ minor, tourId }))).not.toHaveProperty(
          'tourId'
        );
      }
    }
  });

  it('the writer refuses an id its reader would drop: a programming error fails loud', () => {
    const manifest = parseTourManifest(tour());
    for (const tourId of ['', 'has space', 'x'.repeat(65)]) {
      expect(() => serializeTourManifest({ ...manifest, tourId })).toThrow(
        /"tourId" must be/
      );
    }
  });
});
