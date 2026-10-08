/**
 * Why this test matters: the creator's session writes the manifest and the
 * visitor's reads it, on different phones, days apart. The property that
 * makes that safe is exact round-trip: any manifest the writer accepts
 * parses back to the same records (up to the geo pose's own documented
 * renormalisation), for every mix of pins and photos, ids and poses the
 * generators can produce - not only the two hand-written examples.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  parseTourManifest,
  serializeTourManifest,
  TOUR_MANIFEST_MINOR,
  type TourObject,
} from './tour-manifest';

const id = fc.stringMatching(/^[A-Za-z0-9_-]{1,12}$/);
const iso = fc
  .integer({ min: 0, max: 4_102_444_800_000 })
  .map((ms) => new Date(ms).toISOString());
// JSON has no -0: a generated -0 would parse back as 0 and fail the exact
// round trip for a reason that is JSON's, not the manifest's.
const coordinate = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true }).map((x) => (x === 0 ? 0 : x));
const heading = coordinate(0, 359.9);
const geoWithHeading = fc.record({
  lat: coordinate(-89, 89),
  lon: coordinate(-179, 179),
  alt: coordinate(-400, 8000),
  headingDeg: heading,
});
/** An identity-or-yaw unit quaternion about Up: always near-vertical, so a
 *  rotation-only pose never trips the heading/rotation consistency rule. */
const yawRotation = fc
  .double({ min: 0, max: Math.PI * 2, noNaN: true })
  .map((theta) => [0, Math.sin(theta / 2), 0, Math.cos(theta / 2)] as const);
const geoWithRotation = fc.record({
  lat: coordinate(-89, 89),
  lon: coordinate(-179, 179),
  alt: coordinate(-400, 8000),
  rotation: yawRotation.map((q) => [q[0], q[1], q[2], q[3]]),
});
const geo = fc.oneof(geoWithHeading, geoWithRotation);

const pin = fc.record({
  id,
  kind: fc.constant('pin' as const),
  geo,
  createdAtIso: iso,
  label: fc.stringMatching(/^[A-Za-z ]{1,30}$/).filter((s) => s.trim() !== ''),
});
const photo = fc
  .record({
    id,
    kind: fc.constant('photo' as const),
    geo,
    createdAtIso: iso,
    imageWidth: fc.integer({ min: 1, max: 4096 }),
    imageHeight: fc.integer({ min: 1, max: 4096 }),
  })
  // The image entry is derived from the object's own id (M1 review #5).
  .map((p) => ({ ...p, image: `content/${p.id}.jpg` }));

const manifest = fc
  .uniqueArray(fc.oneof(pin, photo), {
    maxLength: 12,
    selector: (o) => o.id,
  })
  .map((objects) => ({ version: 1, objects: objects as TourObject[] }));

describe('tour manifest (properties)', () => {
  it('serialize → parse is the identity on every manifest the writer accepts', () => {
    fc.assert(
      fc.property(manifest, (m) => {
        const parsed = parseTourManifest(m);
        const again = parseTourManifest(
          JSON.parse(serializeTourManifest(parsed))
        );
        expect(again).toEqual(parsed);
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
});

describe('the v1 migration (properties, tour kit plan K1)', () => {
  // Why this matters: every tour and draft made before K1 is version 1.
  // Migrating must keep every object exactly, land on the same document a
  // version 2 file with those objects gives, and be idempotent - a
  // migrated tour written back and read again must not change.
  it('a v1 manifest migrates to the v2 manifest with the same objects, and stays put', () => {
    fc.assert(
      fc.property(manifest, (v1) => {
        const migrated = parseTourManifest(v1);
        expect(migrated.version).toBe(2);
        expect(migrated).toEqual(parseTourManifest({ ...v1, version: 2 }));
        expect(
          parseTourManifest(JSON.parse(serializeTourManifest(migrated)))
        ).toEqual(migrated);
      }),
      { numRuns: 200 }
    );
  });
});

describe('baked capture spots (properties, scan-pass plan S1)', () => {
  // Why this matters: the spots are written once at a creator's Finish and
  // read by every visitor. They must round-trip exactly, and the file's
  // minor must be the one its content needs (1 with spots, the version 1
  // form without anything of version 2) whatever minor it was read at - an
  // exact-minor round trip would be wrong here by design.
  const capture = fc.record({
    image: fc
      .integer({ min: 0, max: 999_999 })
      .map((n) => `images/frame-${String(n).padStart(6, '0')}.jpg`),
    geo: geoWithRotation,
  });
  const spots = fc.record({
    fixes: fc.integer({ min: 1, max: 5000 }),
    gpsAccuracyMedianM: fc.option(coordinate(0, 100), { nil: null }),
    captures: fc.uniqueArray(capture, {
      minLength: 1,
      maxLength: 8,
      selector: (c) => c.image,
    }),
  });
  const v2 = fc
    .record({
      objects: manifest.map((m) => m.objects),
      minor: fc.integer({ min: 0, max: TOUR_MANIFEST_MINOR }),
      captureSpots: fc.option(spots, { nil: undefined }),
    })
    .map(({ captureSpots, ...rest }) => ({
      version: 2,
      ...rest,
      ...(captureSpots === undefined ? {} : { captureSpots }),
    }));

  it('round-trips the spots and writes the minor the content needs', () => {
    fc.assert(
      fc.property(v2, (m) => {
        const parsed = parseTourManifest(m);
        const written = JSON.parse(serializeTourManifest(parsed)) as {
          version: number;
          minor?: number;
        };
        const again = parseTourManifest(written);
        expect(again.captureSpots).toEqual(parsed.captureSpots);
        expect(again.objects).toEqual(parsed.objects);
        expect(written).toMatchObject(
          parsed.captureSpots === undefined
            ? { version: 1 }
            : { version: 2, minor: 1 }
        );
      }),
      { numRuns: 200 }
    );
  });
});
