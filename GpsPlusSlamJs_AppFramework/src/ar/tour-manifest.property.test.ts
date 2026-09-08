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
const photo = fc.record({
  id,
  kind: fc.constant('photo' as const),
  geo,
  createdAtIso: iso,
  image: id.map((stem) => `content/${stem}.jpg`),
  imageWidth: fc.integer({ min: 1, max: 4096 }),
  imageHeight: fc.integer({ min: 1, max: 4096 }),
});

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
