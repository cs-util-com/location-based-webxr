/**
 * Why this test matters: `tour.json` is hand-editable, external data that
 * decides where a visitor sees content. A malformed field must be rejected
 * at the boundary with a message naming the record, not produce a pin at
 * (0, 0) or a picture plane with a zero aspect. The writer re-validates
 * through the reader, so a manifest the creator's session assembled wrong
 * fails on the phone, not on the visitor's. Version 4 holds every thing a
 * station shows as a block at a local pose, every media file (a captured
 * photo's too) as an asset, and refuses the older formats with a message
 * that says so (no migration).
 */

import { describe, expect, it } from 'vitest';

import {
  createEmptyTourManifest,
  parseTourManifest,
  parseTourObject,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
  TOUR_MANIFEST_VERSION,
  TOUR_OBJECT_RECORD_FORMAT,
  tourObjectRecord,
  TourManifestOlderFormatError,
  TourManifestValidationError,
} from './tour-manifest';
import { tourObjects } from './tour-station-pose';

const POSE = { position: [1, 0, 2], rotation: [0, 0, 0, 1] };
const pin = {
  id: 'p1',
  kind: 'shortText',
  view: 'pin',
  createdAtIso: '2026-09-08T14:00:00.000Z',
  caption: 'The old gate',
  pose: POSE,
};
const photoAsset = {
  id: 'f1',
  path: 'content/f1.jpg',
  width: 1024,
  height: 768,
};
const photo = {
  id: 'f1',
  kind: 'picture',
  view: 'plane',
  createdAtIso: '2026-09-08T14:01:00.000Z',
  image: 'f1',
  widthM: 1,
  pose: { position: [0, 1.5, -3], rotation: [0, 0.6, 0, 0.8] },
};
const hello = {
  id: 'hello',
  kind: 'longText',
  view: 'card',
  title: 'Hello',
  body: 'Hello',
  pose: POSE,
};
const GEO = { lat: 47.5, lon: 8.7, alt: 400, headingDeg: 30 };

function station(blocks: unknown[], extra: Record<string, unknown> = {}) {
  return {
    id: 'gate',
    title: 'The gate',
    geo: GEO,
    activateRadiusM: 25,
    foundRadiusM: 4,
    blocks: [hello, ...blocks],
    steps: [{ id: 'hi', action: { kind: 'show', block: 'hello' } }],
    ...extra,
  };
}

function tour(extra: Record<string, unknown> = {}) {
  return {
    version: 4,
    assets: [photoAsset],
    stations: [station([pin, photo])],
    ...extra,
  };
}

describe('parseTourManifest', () => {
  it('reads a station with a pin and a picture at local poses, renormalising a rotation like the level parser', () => {
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
    const [first, second] = tourObjects(manifest);
    expect(first?.kind).toBe('shortText');
    expect(first?.kind === 'shortText' ? first.caption : null).toBe(
      'The old gate'
    );
    expect(second?.kind === 'picture' ? second.imageAsset : null).toEqual({
      ...photoAsset,
      kind: 'image',
    });
    const block = manifest.stations[0]!.blocks.find((b) => b.id === 'f1')!;
    expect(Math.hypot(...block.pose.rotation)).toBeCloseTo(1, 12);
  });

  it('an empty manifest is valid and is what the starter zip carries', () => {
    expect(parseTourManifest(createEmptyTourManifest())).toEqual({
      version: 4,
      minor: 0,
      order: 'fixed',
      assets: [],
      stations: [],
    });
  });

  it('block and asset ids are separate namespaces: a captured photo is a picture block and an image asset of one id', () => {
    // Why: every reference says which kind it names (a show names a block,
    // a picture's image an asset), so the same id in both is unambiguous -
    // and is exactly what a captured photo mints.
    const manifest = parseTourManifest(tour());
    expect(manifest.assets.map((a) => a.id)).toEqual(['f1']);
    expect(manifest.stations[0]?.blocks.map((b) => b.id)).toContain('f1');
  });

  it.each([
    ['a non-object', null, /JSON object/],
    [
      'a version that is not a format number',
      { version: '4', stations: [] },
      /"version" must be 4/,
    ],
    ['version 0', { version: 0, stations: [] }, /"version" must be 4/],
    [
      'a version from a newer app',
      { version: 5, stations: [] },
      /made with a newer version of the app \(format 5\)/,
    ],
    [
      'a minor that is not a whole number',
      { version: 4, minor: 1.5, stations: [] },
      /"minor" must be an integer >= 0/,
    ],
    [
      'a negative minor',
      { version: 4, minor: -1, stations: [] },
      /"minor" must be an integer >= 0/,
    ],
    [
      'an unknown order',
      { version: 4, order: 'random', stations: [] },
      /"order"/,
    ],
    [
      'the same block id in two stations',
      {
        version: 4,
        stations: [station([pin]), { ...station([pin]), id: 'well' }],
      },
      /duplicate block id/,
    ],
    [
      'the same asset id twice',
      tour({ assets: [photoAsset, photoAsset] }),
      /duplicate asset id "f1"/,
    ],
    [
      'a picture naming a missing asset',
      tour({ assets: [] }),
      /stations\[0\]\.blocks\[2\]\.image" must name an image asset/,
    ],
    [
      'a picture naming an asset that is not an image',
      tour({ assets: [{ id: 'f1', path: 'content/f1.mp3' }] }),
      /stations\[0\]\.blocks\[2\]\.image" must name an image asset/,
    ],
    [
      'an unknown block kind',
      tour({ stations: [station([{ ...pin, kind: 'sticker' }])] }),
      /stations\[0\]\.blocks\[1\]\.kind/,
    ],
    [
      'a path-unsafe block id',
      tour({ stations: [station([{ ...pin, id: '../x' }])] }),
      /stations\[0\]\.blocks\[1\]\.id/,
    ],
    [
      'a timestamp that is not a date',
      tour({ stations: [station([{ ...pin, createdAtIso: 'yesterday' }])] }),
      /stations\[0\]\.blocks\[1\]\.createdAtIso/,
    ],
    [
      'a pin without a caption',
      tour({ stations: [station([{ ...pin, caption: '  ' }])] }),
      /stations\[0\]\.blocks\[1\]\.caption/,
    ],
    [
      'a pin caption over 40 characters',
      tour({ stations: [station([{ ...pin, caption: 'x'.repeat(41) }])] }),
      /stations\[0\]\.blocks\[1\]\.caption" is longer than 40/,
    ],
    [
      'an asset whose path is not its own content entry',
      tour({ assets: [{ ...photoAsset, path: '../../session.json' }] }),
      /assets\[0\]\.path" must be content\/f1\.<ext>/,
    ],
    [
      // The file's stem is the asset's id: another id's entry is not its own.
      'an asset whose path is the content entry of another id',
      tour({ assets: [{ ...photoAsset, path: 'content/f2.jpg' }] }),
      /assets\[0\]\.path" must be content\/f1\.<ext>/,
    ],
    [
      'a pixel size on an asset that is not an image',
      tour({
        assets: [
          photoAsset,
          { id: 's1', path: 'content/s1.mp3', width: 10, height: 10 },
        ],
      }),
      /assets\[1\]\.width"\/"height" are only for an image/,
    ],
    [
      // SVG can carry script; an image asset is a raster type only.
      'an image asset that is an SVG',
      tour({ assets: [{ ...photoAsset, path: 'content/f1.svg' }] }),
      /assets\[0\]\.path" must be content\/f1\.<ext> \(an allowlisted media type\)/,
    ],
    [
      'an image asset with a zero height',
      tour({ assets: [{ ...photoAsset, height: 0 }] }),
      /assets\[0\]\.width"\/"height" must be positive integers/,
    ],
    [
      'a block pose with a position that is not three numbers',
      tour({
        stations: [station([{ ...pin, pose: { ...POSE, position: [1, 2] } }])],
      }),
      /blocks\[1\]\.pose\.position/,
    ],
    [
      'a station geo pose with neither heading nor rotation',
      tour({ stations: [station([], { geo: { lat: 1, lon: 2, alt: 3 } })] }),
      /stations\[0\]\.geo".*headingDeg/,
    ],
    [
      'a free block in a view that does not stand in the world',
      tour({ stations: [station([], { steps: [] })] }),
      /no step shows block "hello"/,
    ],
  ])('rejects %s', (_label, data, message) => {
    expect(() => parseTourManifest(data)).toThrow(TourManifestValidationError);
    expect(() => parseTourManifest(data)).toThrow(message);
  });
});

describe('the version policy', () => {
  it('is version 4, minor 1', () => {
    expect([TOUR_MANIFEST_VERSION, TOUR_MANIFEST_MINOR]).toEqual([4, 1]);
  });

  it.each([1, 2, 3])(
    'refuses a version %i tour with a message that says it is an older format: no migration',
    (version) => {
      // Why: a creator who opens an old file must learn why it does not
      // open, never meet an empty tour; the error's type lets a page remove
      // what it kept for that tour.
      const old = { version, stations: [], objects: [] };
      expect(() => parseTourManifest(old)).toThrow(
        new RegExp(
          `older format \\(version ${String(version)}\\) that this version of the app no longer opens; it has to be made again`
        )
      );
      let error: unknown;
      try {
        parseTourManifest(old);
      } catch (err) {
        error = err;
      }
      expect(error).toBeInstanceOf(TourManifestOlderFormatError);
      expect(error).toBeInstanceOf(TourManifestValidationError);
      expect((error as TourManifestOlderFormatError).version).toBe(version);
    }
  );

  it('writes version 4 at minor 0, with every station and its blocks', () => {
    const written = JSON.parse(
      serializeTourManifest(parseTourManifest(tour()))
    ) as Record<string, unknown>;
    expect(written).toMatchObject({ version: 4, minor: 0 });
    expect(written).not.toHaveProperty('objects');
    expect(
      JSON.parse(serializeTourManifest(createEmptyTourManifest()))
    ).toEqual({
      version: 4,
      minor: 0,
      order: 'fixed',
      assets: [],
      stations: [],
    });
  });

  it("reads the title trimmed, as the editor's name field writes it", () => {
    // Why: the editor trims the name it writes, so a title read untrimmed
    // differed from its own field and counted as a change.
    expect(
      parseTourManifest({ version: 4, title: '  Castle walk \n', stations: [] })
        .title
    ).toBe('Castle walk');
  });

  it('reads a full tour: title, order, assets, stations with blocks and steps', () => {
    const manifest = parseTourManifest(
      tour({
        title: 'Castle walk',
        order: 'any',
        assets: [{ id: 'knight', path: 'content/knight.png' }],
        stations: [
          station([pin], {
            blocks: [
              pin,
              {
                id: 'kurt',
                kind: 'character',
                view: 'stage',
                name: 'Kurt',
                image: 'knight',
                caption: 'Hi',
                pose: POSE,
              },
            ],
            steps: [{ id: 'hi', action: { kind: 'show', block: 'kurt' } }],
          }),
        ],
      })
    );
    expect(manifest.title).toBe('Castle walk');
    expect(manifest.order).toBe('any');
    expect(manifest.assets[0]?.kind).toBe('image');
    expect(manifest.stations[0]?.steps[0]?.action).toEqual({
      kind: 'show',
      block: 'kurt',
    });
    expect(tourObjects(manifest).map((o) => o.id)).toEqual(['p1']);
  });

  it('refuses a branching order at its own minor, and reads one of a newer minor as any order', () => {
    // Why: a walk branched by answers left the format; a file asking for it
    // at this minor is one this reader cannot honour, and a quiet "fixed"
    // would send a visitor somewhere the author never meant. The refusal
    // says so in words a creator can act on. From a newer minor any
    // unknown order reads as "any", which never deadlocks.
    expect(() =>
      parseTourManifest(tour({ order: 'branch', stations: [] }))
    ).toThrow(
      /this tour lets answers choose the next station, which this version of the app no longer does; change its order to fixed or any/
    );
    expect(
      parseTourManifest({ version: 4, minor: 9, order: 'branch', stations: [] })
        .order
    ).toBe('any');
  });

  it('opens a tour of a NEWER minor, ignoring the fields it does not know', () => {
    const manifest = parseTourManifest({
      ...tour(),
      minor: 7,
      futureField: { anything: true },
      stations: [
        station([{ ...pin, futureBlockField: 1 }], { futureStationField: 'x' }),
      ],
    });
    expect(manifest.minor).toBe(7);
    expect(manifest).not.toHaveProperty('futureField');
    expect(manifest.stations[0]?.blocks[1]).not.toHaveProperty(
      'futureBlockField'
    );
    expect(manifest.stations[0]).not.toHaveProperty('futureStationField');
  });

  describe('unknown values of a closed list', () => {
    // Why: "minor versions are additive" is only true if a reader of an
    // older minor survives what a newer one ADDS - a new block kind, a new
    // step kind, a new media type, a new order. Such a value degrades when
    // the file says it is newer; at this reader's own minor the same value
    // is a broken file.
    const newer = TOUR_MANIFEST_MINOR + 1;
    const file = (minor: number) => ({
      version: 4,
      minor,
      order: 'spiral',
      assets: [{ id: 'f1', path: 'content/f1.heic' }],
      stations: [
        station([pin, { ...pin, id: 'p9', kind: 'sticker' }, photo], {
          hint: 'compass',
          steps: [
            { id: 'hi', action: { kind: 'show', block: 'hello' } },
            { id: 'holo', action: { kind: 'hologram' } },
          ],
        }),
      ],
    });

    it('a newer minor opens: what it cannot show is left out, the rest degrades', () => {
      const manifest = parseTourManifest(file(newer));
      expect(manifest.order).toBe('any');
      expect(manifest.assets).toEqual([]);
      expect(tourObjects(manifest).map((o) => o.id)).toEqual(['p1']);
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

describe('a placed 3D model (a size in metres)', () => {
  // Why: the size must come back exactly: it is the creator's number.
  const model = {
    id: 'm1',
    kind: 'model',
    view: 'placed',
    asset: 'arch',
    sizeM: 12.75,
    title: 'The old arch',
    createdAtIso: '2026-10-19T12:00:00.000Z',
    pose: { position: [4, 0, -1], rotation: [0, 0.6, 0, 0.8] },
  };
  const withModel = () =>
    tour({
      assets: [photoAsset, { id: 'arch', path: 'content/arch.glb' }],
      stations: [station([pin, photo, model])],
    });

  it('writes a tour carrying a model at minor 0, and reads it back exactly', () => {
    const manifest = parseTourManifest(withModel());
    const json = serializeTourManifest(manifest);
    expect(JSON.parse(json)).toMatchObject({ version: 4, minor: 0 });
    const again = parseTourManifest(JSON.parse(json));
    expect(again).toEqual(manifest);
    expect(again.stations[0]?.blocks.find((b) => b.id === 'm1')).toEqual(model);
  });

  it("a newer minor's model beyond this reader's bound is left out", () => {
    const manifest = parseTourManifest({
      ...withModel(),
      minor: TOUR_MANIFEST_MINOR + 1,
      stations: [station([pin, { ...model, sizeM: 900 }])],
    });
    expect(tourObjects(manifest).map((o) => o.id)).toEqual(['p1']);
  });

  describe("a model's views, notes, sections and clip: minor 1", () => {
    // Why: the writer writes the LOWEST minor a tour needs, so a tour that
    // uses none of minor 1 still opens fully in an app that reads only
    // minor 0, and one that does is marked so that app opens it leniently
    // (falling back to `placed`) instead of refusing a view it never met.
    const annotated = {
      ...model,
      view: 'hotspots',
      animation: { name: 'Swing', autoplay: true },
      annotations: [
        { position: [0, 2.5, 0.4], normal: [0, 0, 1], title: 'Keystone' },
      ],
      sections: [
        { name: 'Through the arch', position: [0, 0, 0], normal: [1, 0, 0] },
      ],
    };
    const withBlocks = (blocks: unknown[]) =>
      tour({
        assets: [photoAsset, { id: 'arch', path: 'content/arch.glb' }],
        stations: [station(blocks)],
      });

    it('writes minor 1 and reads every field back exactly', () => {
      const manifest = parseTourManifest(withBlocks([pin, annotated]));
      const json = serializeTourManifest(manifest);
      expect(JSON.parse(json)).toMatchObject({ version: 4, minor: 1 });
      const again = parseTourManifest(JSON.parse(json));
      expect(again).toEqual({ ...manifest, minor: 1 });
      expect(
        again.stations[0]?.blocks.find((b) => b.id === annotated.id)
      ).toEqual(annotated);
    });

    it('writes minor 0 again once the tour no longer uses any of it', () => {
      const {
        animation: _a,
        annotations: _n,
        sections: _s,
        ...plain
      } = annotated;
      const json = serializeTourManifest(
        parseTourManifest(withBlocks([pin, { ...plain, view: 'placed' }]))
      );
      expect(JSON.parse(json)).toMatchObject({ minor: 0 });
    });

    it('reads the fields from a file that says minor 0, as the reader that knows them', () => {
      const manifest = parseTourManifest({
        ...withBlocks([pin, annotated]),
        minor: 0,
      });
      expect(tourObjects(manifest).map((o) => o.view)).toEqual([
        'pin',
        'hotspots',
      ]);
    });

    it('each new world view puts the model in the world view list', () => {
      for (const view of ['ghost', 'hotspots', 'cutaway', 'toy']) {
        const manifest = parseTourManifest(withBlocks([{ ...model, view }]));
        expect(tourObjects(manifest)).toEqual([
          expect.objectContaining({ id: 'm1', view, sizeM: 12.75 }),
        ]);
      }
    });
  });

  it('a model id may be an asset id: blocks and assets are separate namespaces', () => {
    expect(() =>
      parseTourManifest({
        ...withModel(),
        stations: [station([{ ...model, id: 'arch' }])],
      })
    ).not.toThrow();
  });
});

describe("a station's description and card image", () => {
  // Why: the 3D editor's station cards carry a description and a picture.
  // The picture names an image asset of the tour, a captured photo's too.
  const art = { id: 'art', path: 'content/art.png', width: 640, height: 480 };

  it('reads and writes a station with a description and an image back exactly', () => {
    const manifest = parseTourManifest(
      tour({
        assets: [photoAsset, art],
        stations: [
          station([pin, photo], { description: 'The old gate.', image: 'f1' }),
          station([], {
            id: 'well',
            image: 'art',
            blocks: [{ ...hello, id: 'hello-2' }],
            steps: [{ id: 'hi', action: { kind: 'show', block: 'hello-2' } }],
          }),
        ],
      })
    );
    expect(manifest.stations.map((s) => [s.description, s.image])).toEqual([
      ['The old gate.', 'f1'],
      [undefined, 'art'],
    ]);
    const json = serializeTourManifest(manifest);
    expect(JSON.parse(json)).toMatchObject({ version: 4, minor: 0 });
    expect(parseTourManifest(JSON.parse(json))).toEqual(manifest);
  });

  it('the writer drops an image whose picture went (a deleted photo) with its own reason, never failing', () => {
    const manifest = parseTourManifest(
      tour({ stations: [station([pin, photo], { image: 'f1' })], cover: 'f1' })
    );
    const withoutPhoto = {
      ...manifest,
      assets: [],
      stations: [
        {
          ...manifest.stations[0]!,
          blocks: manifest.stations[0]!.blocks.filter((b) => b.id !== 'f1'),
        },
      ],
    };
    const dropped: { field: string; cause?: string }[] = [];
    const written = JSON.parse(
      serializeTourManifest(withoutPhoto, {
        onDropped: (drop) => {
          dropped.push({
            field: 'field' in drop ? drop.field : drop.kind,
            ...('cause' in drop && drop.cause !== undefined
              ? { cause: drop.cause }
              : {}),
          });
        },
      })
    ) as { minor: number; stations: Record<string, unknown>[] };
    expect(written.stations[0]).not.toHaveProperty('image');
    expect(dropped).toEqual([
      { field: 'image', cause: 'station-image-gone' },
      { field: 'cover', cause: 'image-gone' },
    ]);
  });

  it('the reader drops a malformed station description or image and opens the tour, saying which', () => {
    // Why (as the tour details): a hand-edited value costs the value, never
    // the tour - refused, the tour could not even be opened in the editor
    // to fix it.
    const dropped: string[] = [];
    const manifest = parseTourManifest(
      tour({
        stations: [
          station([pin, photo], {
            description: 'x'.repeat(2001),
            image: 'not/an id',
          }),
        ],
      }),
      {
        onDropped: (drop) => {
          dropped.push(`${'field' in drop ? drop.field : ''}: ${drop.reason}`);
        },
      }
    );
    expect(manifest.stations[0]).not.toHaveProperty('description');
    expect(manifest.stations[0]).not.toHaveProperty('image');
    expect(dropped).toEqual([
      'description: "stations[0].description" must be text of at most 2000 characters',
      'image: "stations[0].image" must be an image id',
    ]);
  });

  it('the writer refuses a station image or description its reader drops as malformed: a programming error fails loud', () => {
    const manifest = parseTourManifest(tour());
    const withStation = (extra: Record<string, unknown>) => ({
      ...manifest,
      stations: [{ ...manifest.stations[0]!, ...extra }],
    });
    expect(() =>
      serializeTourManifest(withStation({ image: 'not/an id' }) as never)
    ).toThrow(/"stations\[0\]\.image" must be an image id/);
    expect(() =>
      serializeTourManifest(withStation({ description: 42 }) as never)
    ).toThrow(/"stations\[0\]\.description" must be text/);
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
          {
            ...manifest.stations[0]!,
            blocks: [hello, { ...pin, caption: '' }] as never,
          },
        ],
      })
    ).toThrow(TourManifestValidationError);
  });

  it("refuses a block's optional text its reader would drop: a programming error fails loud", () => {
    const manifest = parseTourManifest(tour());
    expect(() =>
      serializeTourManifest({
        ...manifest,
        stations: [
          {
            ...manifest.stations[0]!,
            blocks: [
              hello,
              { ...pin, description: 'x'.repeat(161) },
              photo,
            ] as never,
          },
        ],
      })
    ).toThrow(/description/);
  });
});

describe('parseTourObject and tourObjectRecord (the world view a draft keeps)', () => {
  // Why: a creator's on-device draft keeps pins, pictures and models in
  // the world (geo poses), before a station holds them; the same fields
  // as a free block, checked by the same rules, and a captured photo's
  // asset entry with it (the draft has no tour to list it).
  const worldPin = {
    id: 'p1',
    kind: 'shortText',
    view: 'pin',
    caption: 'Gate',
    createdAtIso: '2026-10-18T06:00:00.000Z',
    geo: GEO,
  } as const;
  const worldPicture = {
    id: 'f1',
    kind: 'picture',
    view: 'plane',
    image: 'f1',
    widthM: 1,
    createdAtIso: '2026-10-18T06:01:00.000Z',
    geo: GEO,
    station: 'gate',
    imageAsset: { ...photoAsset, kind: 'image' },
  } as const;
  const worldModel = {
    id: 'm1',
    kind: 'model',
    view: 'placed',
    asset: 'arch',
    sizeM: 3,
    geo: GEO,
  } as const;

  it('reads a world pin, with or without its station, from its record', () => {
    expect(parseTourObject(tourObjectRecord(worldPin))).toEqual(worldPin);
    const stationed = { ...worldPin, station: 'gate' };
    expect(parseTourObject(tourObjectRecord(stationed))).toEqual(stationed);
  });

  it('writes the record in its format: the block, the picture asset entry, the geo pose and the station', () => {
    expect(tourObjectRecord(worldPicture)).toEqual({
      format: TOUR_OBJECT_RECORD_FORMAT,
      block: {
        id: 'f1',
        kind: 'picture',
        view: 'plane',
        image: 'f1',
        widthM: 1,
        createdAtIso: '2026-10-18T06:01:00.000Z',
      },
      asset: photoAsset,
      geo: GEO,
      station: 'gate',
    });
    expect(TOUR_OBJECT_RECORD_FORMAT).toBe(4);
  });

  it('a picture and a model read back exactly', () => {
    expect(parseTourObject(tourObjectRecord(worldPicture))).toEqual(
      worldPicture
    );
    expect(parseTourObject(tourObjectRecord(worldModel))).toEqual(worldModel);
  });

  const record = tourObjectRecord(worldPin);
  it.each([
    [
      'no format',
      { ...record, format: undefined },
      /object\.format" must be 4/,
    ],
    [
      'an earlier format',
      { ...record, format: 3 },
      /object\.format" must be 4/,
    ],
    ['no geo pose', { ...record, geo: undefined }, /object\.geo/],
    ['a bad station id', { ...record, station: 'a b' }, /object\.station/],
    [
      'an unknown kind',
      { ...record, block: { ...record.block, kind: 'audio' } },
      /audio/,
    ],
    [
      'a block that does not stand in the world',
      {
        ...record,
        block: {
          id: 'x',
          kind: 'longText',
          view: 'card',
          title: 'T',
          body: 'B',
        },
      },
      /must stand in the world/,
    ],
    [
      'a picture without its asset entry',
      { ...tourObjectRecord(worldPicture), asset: undefined },
      /object\.asset/,
    ],
    [
      'a picture whose asset entry is another image',
      {
        ...tourObjectRecord(worldPicture),
        asset: { id: 'f2', path: 'content/f2.jpg' },
      },
      /object\.asset" must be the image asset its picture names/,
    ],
    [
      // A draft never holds what a save would refuse: the reader would
      // leave this text out of a tour, so the record fails instead.
      'an optional text its reader would drop',
      { ...record, block: { ...record.block, description: 'x'.repeat(161) } },
      /description/,
    ],
    [
      'an asset entry on a pin',
      { ...record, asset: photoAsset },
      /object\.asset" is only for a picture/,
    ],
    [
      'a model without its size',
      {
        ...tourObjectRecord(worldModel),
        block: { id: 'm1', kind: 'model', view: 'placed', asset: 'arch' },
      },
      /sizeM/,
    ],
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
    blocks: [],
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
    expect(manifest.stations[1]?.blocks).toEqual([]);
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

describe('a tour that needs no GPS', () => {
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

describe('tour details', () => {
  // Why: a tour has a description, a cover (one of its image assets, a
  // captured photo's included) and a contact the visitor's error messages
  // show. They are cosmetic, so a bad value costs the value, never the
  // tour - a deleted cover photo included.
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

  it('a cover is an image asset, never another kind and never a block', () => {
    expect(
      parseTourManifest(
        tour({
          assets: [photoAsset, asset, { id: 'song', path: 'content/song.mp3' }],
          cover: 'art',
        })
      ).cover
    ).toBe('art');
    expect(
      parseTourManifest(
        tour({
          assets: [photoAsset, { id: 'song', path: 'content/song.mp3' }],
          cover: 'song',
        })
      )
    ).not.toHaveProperty('cover');
    // A pin is a block, not an image.
    expect(parseTourManifest(tour({ cover: 'p1' }))).not.toHaveProperty(
      'cover'
    );
  });

  it('a bad detail is dropped with its reason, and the tour still opens', () => {
    const dropped: string[] = [];
    const manifest = parseTourManifest(
      tour({
        assets: [],
        stations: [station([pin])],
        description: 'Fine.',
        cover: 'f1',
        contact: 'javascript:alert(1)',
      }),
      {
        onDropped: (drop) => {
          dropped.push(`${'field' in drop ? drop.field : ''}: ${drop.reason}`);
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

  it('the writer refuses a description or contact its reader would drop: a programming error fails loud', () => {
    const manifest = parseTourManifest(tour());
    expect(() =>
      serializeTourManifest({ ...manifest, contact: 'call me' })
    ).toThrow(/"contact" must be an e-mail address/);
    expect(() =>
      serializeTourManifest({ ...manifest, description: '   ' })
    ).toThrow(/"description" is empty/);
  });

  // Why: only a cover whose image went is a creator's ordinary edit; a
  // cover that is not an id at all is the page's bug, and dropping it
  // quietly hid that, as a malformed contact would have been hidden.
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

describe('a stable tour id', () => {
  // Why: a tour opened from a FILE has no link to be known by, so a
  // creator's draft was keyed by a fingerprint of the file's content -
  // which a tour of authored files alone changes at every save, leaving
  // the draft behind. An id the tour itself carries, written by every
  // save, is a key that survives saves. Optional: a tour without one
  // reads as before, and a bad one costs the id, never the tour.
  it('reads and round-trips an id', () => {
    const manifest = parseTourManifest(tour({ tourId: 'a1B2_c3-D4' }));
    expect(manifest.tourId).toBe('a1B2_c3-D4');
    const written = JSON.parse(serializeTourManifest(manifest)) as unknown;
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
