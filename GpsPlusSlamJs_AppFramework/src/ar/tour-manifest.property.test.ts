/**
 * Why this test matters: the creator's session writes the manifest and the
 * visitor's reads it, on different phones, days apart. The property that
 * makes that safe is exact round-trip: any manifest the writer accepts
 * parses back to the same records - every station's geo pose and every
 * item's local pose bit for bit (tour editor plan 2026-10-17-1816, D17:
 * nothing may nudge a local pose) - for every mix of stations, pins,
 * photos, placed models (their size in metres exactly), recorded photos and
 * details and station descriptions and card images (minor 2) the
 * generators can produce, not only the hand-written examples. The minor
 * written is the lowest the tour needs: the smallest minor whose reader
 * keeps everything the tour carries (a tour id needs none).
 */

import { isDeepStrictEqual } from 'node:util';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TOUR_MODEL_MAX_SIZE_M, TOUR_MODEL_MIN_SIZE_M } from './tour-items';
import {
  parseTourManifest,
  serializeTourManifest,
  tourItems,
  tourManifestRecord,
  type TourManifest,
} from './tour-manifest';

const id = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
const iso = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());
// JSON has no -0: a generated -0 would parse back as 0 and fail the exact
// round trip for a reason that is JSON's, not the manifest's.
const coordinate = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true }).map((x) => (x === 0 ? 0 : x));
/** An identity-or-yaw unit quaternion about Up: always near-vertical, so a
 *  rotation-only pose never trips the heading/rotation consistency rule. */
const yawRotation = fc
  .double({ min: 0, max: Math.PI * 2, noNaN: true })
  .map((theta): [number, number, number, number] => [
    0,
    Math.sin(theta / 2),
    0,
    Math.cos(theta / 2),
  ]);
const geo = fc.oneof(
  fc.record({
    lat: coordinate(-89, 89),
    lon: coordinate(-179, 179),
    alt: coordinate(-400, 8000),
    headingDeg: coordinate(0, 359.9),
  }),
  fc.record({
    lat: coordinate(-89, 89),
    lon: coordinate(-179, 179),
    alt: coordinate(-400, 8000),
    rotation: yawRotation,
  })
);
const pose = fc.record({
  position: fc.tuple(
    coordinate(-500, 500),
    coordinate(-50, 50),
    coordinate(-500, 500)
  ),
  rotation: yawRotation,
});

const pin = fc.record({
  id,
  kind: fc.constant('pin' as const),
  createdAtIso: iso,
  label: fc.stringMatching(/^[A-Za-z ]{1,30}$/).filter((s) => s.trim() !== ''),
  pose,
});
const photo = fc
  .record({
    id,
    kind: fc.constant('photo' as const),
    createdAtIso: iso,
    imageWidth: fc.integer({ min: 1, max: 4096 }),
    imageHeight: fc.integer({ min: 1, max: 4096 }),
    pose,
  })
  // The image entry is derived from the item's own id (M1 review #5).
  .map((p) => ({ ...p, image: `content/${p.id}.jpg` }));

/** The model assets a placed model may name: ids longer than any item id
 *  the generator makes (12), since an asset id may not be an item's. */
const MODEL_ASSETS = [
  { id: 'model-asset-01', path: 'content/model-asset-01.glb' },
  { id: 'model-asset-02', path: 'content/model-asset-02.glb' },
];
const model = fc.record(
  {
    id,
    kind: fc.constant('model' as const),
    createdAtIso: iso,
    asset: fc.constantFrom(...MODEL_ASSETS.map((a) => a.id)),
    sizeM: fc.double({
      min: TOUR_MODEL_MIN_SIZE_M,
      max: TOUR_MODEL_MAX_SIZE_M,
      noNaN: true,
    }),
    label: fc.stringMatching(/^[A-Za-z]{1,20}$/),
    pose,
  },
  { requiredKeys: ['id', 'kind', 'createdAtIso', 'asset', 'sizeM', 'pose'] }
);

/** An image asset a station's card image may name (an id longer than any
 *  item id, as for the model assets). */
const IMAGE_ASSET = {
  id: 'image-asset-01',
  path: 'content/image-asset-01.png',
};

/** A station's minor 2 fields as generated: any printable description
 *  (blank, padded or none), and a card image naming the station's own
 *  photo, the tour's image asset, another station's item or nothing the
 *  tour has (both dropped by the reader). */
const stationExtras = fc.record({
  description: fc.option(fc.string({ maxLength: 40 }), { nil: undefined }),
  image: fc.option(
    fc.constantFrom('own-photo', 'asset', 'other-item', 'missing'),
    { nil: undefined }
  ),
});

/** Up to four stations sharing up to twelve uniquely named items. */
const stations = fc
  .tuple(
    fc.uniqueArray(id, { minLength: 1, maxLength: 4 }),
    fc.uniqueArray(fc.oneof(pin, photo, model), {
      maxLength: 12,
      selector: (o) => o.id,
    }),
    fc.array(geo, { minLength: 4, maxLength: 4 }),
    fc.array(fc.nat(), { minLength: 12, maxLength: 12 }),
    fc.array(stationExtras, { minLength: 4, maxLength: 4 })
  )
  .map(([ids, items, geos, picks, extras]) =>
    ids.map((stationId, s) => {
      const own = items.filter((_, i) => (picks[i] ?? 0) % ids.length === s);
      const { description, image } = extras[s]!;
      const named = {
        'own-photo': own.find((o) => o.kind === 'photo')?.id,
        asset: IMAGE_ASSET.id,
        'other-item': items.find((o) => !own.includes(o))?.id,
        missing: 'no-such-image',
      };
      const imageId = image === undefined ? undefined : named[image];
      return {
        id: stationId,
        geo: geos[s]!,
        activateRadiusM: 30,
        foundRadiusM: 25,
        hint: 'arrow' as const,
        // An automatic station has no story (D20).
        steps: [],
        items: own,
        ...(description === undefined ? {} : { description }),
        ...(imageId === undefined ? {} : { image: imageId }),
      };
    })
  );

/** What a reader of `minor` keeps of `m`: a minor 0 reader no placed model
 *  (its unknown kind), a minor 1 reader no station description or card
 *  image (its unknown fields). This is a hand-written MODEL of the older
 *  readers, not an independent oracle: it lists the same per-minor features
 *  `minorNeeded` lists, so a feature added to both in the same wrong way
 *  would still pass. What it catches is a minor too LOW for what the
 *  manifest carries and, through the minimality check, one too HIGH. */
function keptAtMinor(m: TourManifest, minor: number): TourManifest {
  return {
    ...m,
    stations: m.stations.map(({ description, image, ...s }) => ({
      ...s,
      items: minor >= 1 ? s.items : s.items.filter((i) => i.kind !== 'model'),
      ...(minor >= 2 && description !== undefined ? { description } : {}),
      ...(minor >= 2 && image !== undefined ? { image } : {}),
    })),
  };
}

const capture = (stationIds: readonly string[]) =>
  fc.record({
    image: fc
      .integer({ min: 0, max: 999_999 })
      .map((n) => `images/frame-${String(n).padStart(6, '0')}.jpg`),
    station: fc.constantFrom(...stationIds),
    pose,
  });

const manifest = stations.chain((s) =>
  fc
    .record({
      // An earlier file's baked captures: no longer part of the format, so
      // the reader must ignore them like any unknown field.
      captureSpots: fc.option(
        fc.record({
          fixes: fc.integer({ min: 1, max: 5000 }),
          gpsAccuracyMedianM: fc.option(coordinate(0, 100), { nil: null }),
          captures: fc.uniqueArray(capture(s.map((x) => x.id)), {
            minLength: 1,
            maxLength: 6,
            selector: (c) => c.image,
          }),
        }),
        { nil: undefined }
      ),
      needsNoGps: fc.option(fc.boolean(), { nil: undefined }),
      tourId: fc.option(fc.stringMatching(/^[A-Za-z0-9_-]{1,64}$/), {
        nil: undefined,
      }),
      description: fc.option(fc.stringMatching(/^[A-Za-z]{1,40}$/), {
        nil: undefined,
      }),
      cover: fc.option(fc.oneof(id, fc.constant('missing')), {
        nil: undefined,
      }),
    })
    .map(({ captureSpots, needsNoGps, tourId, description, cover }) => ({
      version: 3,
      ...(tourId === undefined ? {} : { tourId }),
      assets: [...MODEL_ASSETS, IMAGE_ASSET],
      stations: s,
      ...(captureSpots === undefined ? {} : { captureSpots }),
      ...(needsNoGps === undefined ? {} : { needsNoGps }),
      ...(description === undefined ? {} : { description }),
      // Half the time the cover is one of the generated photos.
      ...(cover === undefined
        ? {}
        : {
            cover:
              tourItems({ stations: s }).find(
                (o) => o.kind === 'photo' && cover.length % 2 === 0
              )?.id ?? cover,
          }),
    }))
);

describe('tour manifest version 3 (properties)', () => {
  it('serialize -> parse is the identity on every manifest the writer accepts, local poses bit for bit', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const parsed = parseTourManifest(m);
        const again = parseTourManifest(
          JSON.parse(serializeTourManifest(parsed))
        );
        // The minor is the writer's own choice (the lowest the tour needs),
        // pinned by its own property below; everything else is identity.
        expect({ ...again, minor: 0 }).toEqual({ ...parsed, minor: 0 });
        // The same numbers exactly, not merely close: JSON round trips a
        // double exactly, and nothing on the way may recompute a pose.
        expect(JSON.stringify(tourItems(again).map((i) => i.pose))).toBe(
          JSON.stringify(tourItems(m).map((i) => i.pose))
        );
      }),
      { numRuns: 200 }
    );
  });

  it('writes the smallest minor whose reader keeps the whole tour, and every model size back unchanged', () => {
    // Why: a reader of an older minor ignores what it does not know and
    // would write the tour back without it; the written minor is what makes
    // that reader refuse to save. Too low loses the creator's work in an
    // older app, too high locks a tour out of an older app for nothing.
    fc.assert(
      fc.property(manifest, (m) => {
        const parsed = parseTourManifest(m);
        const written = JSON.parse(serializeTourManifest(parsed)) as {
          minor: number;
        };
        const keepsAll = (minor: number) =>
          isDeepStrictEqual(keptAtMinor(parsed, minor), parsed);
        expect(keepsAll(written.minor)).toBe(true);
        // ... and no lower minor's reader does.
        expect(written.minor === 0 || !keepsAll(written.minor - 1)).toBe(true);
        const models = tourItems(parsed).filter((i) => i.kind === 'model');
        const extras = parsed.stations.some(
          (s) => s.description !== undefined || s.image !== undefined
        );
        expect(written.minor).toBe(extras ? 2 : models.length > 0 ? 1 : 0);
        const again = tourItems(parseTourManifest(written)).filter(
          (i) => i.kind === 'model'
        );
        expect(again.map((i) => i.sizeM)).toEqual(models.map((i) => i.sizeM));
      }),
      { numRuns: 200 }
    );
  });

  it('parsing is idempotent: parsing a parsed manifest changes nothing', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const once = parseTourManifest(m);
        // Read again from the file's shape (`tourManifestRecord`).
        expect(parseTourManifest(tourManifestRecord(once))).toEqual(once);
      })
    );
  });

  it('keeps every station and every item in the station it was written in, drops the captureSpots of an earlier file, and keeps a cover only when the tour has that photo', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const parsed = parseTourManifest(m);
        // An earlier file's captureSpots never reaches the tour, and costs
        // no station (the stations it named stay as written).
        expect('captureSpots' in parsed).toBe(false);
        expect(parsed.stations.map((s) => s.id)).toEqual(
          m.stations.map((s) => s.id)
        );
        expect(parsed.stations.map((s) => s.items.map((i) => i.id))).toEqual(
          m.stations.map((s) => s.items.map((i) => i.id))
        );
        expect(
          parsed.cover === undefined ||
            tourItems(parsed).some(
              (o) => o.kind === 'photo' && o.id === parsed.cover
            )
        ).toBe(true);
      })
    );
  });

  it("keeps a station's card image only when it names a photo of that station or an image asset, and reports every one it drops", () => {
    // Why (G2 build plan M1a, Q14): a card image whose picture went is
    // dropped, never fails the tour, and is never dropped silently.
    fc.assert(
      fc.property(manifest, (m) => {
        const dropped: string[] = [];
        const parsed = parseTourManifest(m, {
          onDropped: (drop) => {
            if (drop.field === 'image') dropped.push(drop.station);
          },
        });
        for (const s of parsed.stations) {
          if (s.image === undefined) continue;
          expect(
            s.image === IMAGE_ASSET.id ||
              s.items.some((i) => i.kind === 'photo' && i.id === s.image)
          ).toBe(true);
        }
        expect(dropped).toEqual(
          m.stations
            .filter(
              (s, i) => 'image' in s && parsed.stations[i]?.image === undefined
            )
            .map((s) => s.id)
        );
      })
    );
  });
});
