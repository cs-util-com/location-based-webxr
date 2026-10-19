/**
 * Why this test matters: the creator's session writes the manifest and the
 * visitor's reads it, on different phones, days apart. The property that
 * makes that safe is exact round-trip: any manifest the writer accepts
 * parses back to the same records - every station's geo pose and every
 * item's local pose bit for bit (tour editor plan 2026-10-17-1816, D17:
 * nothing may nudge a local pose) - for every mix of stations, pins,
 * photos, placed models (their size in metres exactly), recorded photos and
 * details the generators can produce, not only the hand-written examples.
 * The minor written is the lowest the tour needs: 1 exactly when it carries
 * a model.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TOUR_MODEL_MAX_SIZE_M, TOUR_MODEL_MIN_SIZE_M } from './tour-items';
import {
  parseTourManifest,
  serializeTourManifest,
  tourItems,
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

/** Up to four stations sharing up to twelve uniquely named items. */
const stations = fc
  .tuple(
    fc.uniqueArray(id, { minLength: 1, maxLength: 4 }),
    fc.uniqueArray(fc.oneof(pin, photo, model), {
      maxLength: 12,
      selector: (o) => o.id,
    }),
    fc.array(geo, { minLength: 4, maxLength: 4 }),
    fc.array(fc.nat(), { minLength: 12, maxLength: 12 })
  )
  .map(([ids, items, geos, picks]) =>
    ids.map((stationId, s) => ({
      id: stationId,
      geo: geos[s]!,
      activateRadiusM: 30,
      foundRadiusM: 25,
      hint: 'arrow' as const,
      // An automatic station has no story (D20).
      steps: [],
      items: items.filter((_, i) => (picks[i] ?? 0) % ids.length === s),
    }))
  );

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
      description: fc.option(fc.stringMatching(/^[A-Za-z]{1,40}$/), {
        nil: undefined,
      }),
      cover: fc.option(fc.oneof(id, fc.constant('missing')), {
        nil: undefined,
      }),
    })
    .map(({ captureSpots, needsNoGps, description, cover }) => ({
      version: 3,
      assets: MODEL_ASSETS,
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

  it('writes minor 1 exactly when the tour carries a model, and every model size back unchanged', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const parsed = parseTourManifest(m);
        const written = JSON.parse(serializeTourManifest(parsed)) as {
          minor: number;
        };
        const models = tourItems(parsed).filter((i) => i.kind === 'model');
        expect(written.minor).toBe(models.length > 0 ? 1 : 0);
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
        expect(parseTourManifest(once)).toEqual(once);
      })
    );
  });

  it('keeps every item in the station it was written in, and a cover only when the tour has that photo', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const parsed = parseTourManifest(m);
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
});
