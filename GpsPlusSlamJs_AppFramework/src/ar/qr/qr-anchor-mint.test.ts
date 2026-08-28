import { describe, it, expect } from 'vitest';
import { Quaternion as ThreeQuaternion, Vector3 } from 'three';
import {
  DEFAULT_MAX_FIXED_ROTATION_SPREAD_DEG,
  maxPairwiseRotationDeg,
  mintQrAnchorFromSightings,
} from './qr-anchor-mint.js';
import { calcRelativeCoordsInMeters } from '../../core/index.js';
import type { QrSighting } from './qr-sighting-accumulator.js';
import type { Matrix4 as AlignmentMatrix } from '../../core/index.js';

const IDENTITY: AlignmentMatrix = [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];
const ZERO = { lat: 48, lon: 11 };
const NOW = '2026-08-28T09:00:00.000Z';

/** An alignment that is identity apart from a north/east translation. */
function shifted(north: number, east: number): AlignmentMatrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, north, 0, east, 1];
}

/** A rotation of `deg` about WebXR +Y (yaw), as a quaternion. */
function yaw(deg: number): [number, number, number, number] {
  const q = new ThreeQuaternion().setFromAxisAngle(
    new Vector3(0, 1, 0),
    (deg * Math.PI) / 180
  );
  return [q.x, q.y, q.z, q.w];
}

function sighting(overrides: Partial<QrSighting> = {}): QrSighting {
  return {
    text: 'code',
    firstTimestamp: 0,
    lastTimestamp: 1000,
    detectionCount: 10,
    posesUsed: 8,
    odomPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    translationSpreadM: 0.01,
    rotationSpreadDeg: 0.5,
    sizeM: 0.16,
    sizeSpreadM: 0.002,
    alignmentMatrix: IDENTITY,
    zero: ZERO,
    alignmentSampleCount: 8,
    segment: 0,
    ...overrides,
  };
}

describe('maxPairwiseRotationDeg', () => {
  it('is OUTLIER-INCLUSIVE, unlike the robust aggregate', () => {
    // Why this test matters, and why this function exists at all (cold review
    // blocker 3): `aggregateQrPose`'s spread is the max angle among the
    // INLIERS to its robust mean, with a 12-degree inlier threshold. Eight
    // agreeing sightings plus one turned by 25 degrees would be reported by
    // THAT as a small spread - the outlier discarded - which would make the
    // fixedness gate blind to exactly the re-hung poster it exists to catch.
    const agreeing = Array.from({ length: 8 }, () => yaw(0));
    expect(maxPairwiseRotationDeg([...agreeing, yaw(25)])).toBeCloseTo(25, 1);
  });

  it('is zero for one rotation and for identical ones', () => {
    expect(maxPairwiseRotationDeg([yaw(0)])).toBe(0);
    expect(maxPairwiseRotationDeg([yaw(30), yaw(30)])).toBeCloseTo(0, 6);
  });
});

describe('mintQrAnchorFromSightings — the fixedness gate', () => {
  it('accepts a code that stayed put through SLAM drift', () => {
    // A few degrees of disagreement across visits is what drift looks like.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ odomPose: { position: [0, 0, 0], rotation: yaw(0) } }),
        sighting({ odomPose: { position: [0.2, 0, 0], rotation: yaw(2) } }),
        sighting({ odomPose: { position: [0.1, 0, 0], rotation: yaw(-1.5) } }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.rotationSpreadDeg).toBeLessThan(
      DEFAULT_MAX_FIXED_ROTATION_SPREAD_DEG
    );
    expect(result.quality.sightingCount).toBe(3);
    expect(result.quality.detectionCount).toBe(30);
  });

  it('refuses a code that was re-hung, in plain words', () => {
    // The negative case the field recording is being made for: taken down and
    // re-hung rotated by twenty degrees or more.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ odomPose: { position: [0, 0, 0], rotation: yaw(0) } }),
        sighting({ odomPose: { position: [0, 0, 0], rotation: yaw(25) } }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('moved');
    expect(result.detail).toMatch(/moved/i);
    expect(result.detail).toMatch(/25/);
  });

  it('reports translation disagreement but never gates on it', () => {
    // Why: over a three-minute walk, SLAM drift and a genuinely moved poster
    // produce the SAME magnitude of position spread, so that threshold cannot
    // be set honestly before the field data exists. It is measured and
    // surfaced instead of guessed at.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ odomPose: { position: [0, 0, 0], rotation: yaw(0) } }),
        sighting({ odomPose: { position: [3, 0, 4], rotation: yaw(1) } }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.quality.translationSpreadM).toBeCloseTo(5, 6);
  });
});

describe('mintQrAnchorFromSightings — declines', () => {
  it.each([
    [{ sightings: [], spansFrameChange: false }, 'no-sightings'],
    [{ sightings: [sighting()], spansFrameChange: true }, 'frame-changed'],
    [
      {
        sightings: [sighting({ alignmentMatrix: null, zero: null })],
        spansFrameChange: false,
      },
      'no-alignment',
    ],
  ] as [Partial<Parameters<typeof mintQrAnchorFromSightings>[0]>, string][])(
    'declines with %#: $1',
    (partial, reason) => {
      const result = mintQrAnchorFromSightings({
        sightings: [],
        spansFrameChange: false,
        nowIso: NOW,
        ...partial,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe(reason);
      // Every decline reaches a person, so every decline says why.
      expect(result.detail.length).toBeGreaterThan(20);
    }
  );

  it('declines a session that never solved enough GPS fixes', () => {
    const result = mintQrAnchorFromSightings({
      sightings: [sighting({ alignmentSampleCount: 1 })],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(false);
  });
});

describe('mintQrAnchorFromSightings — combining', () => {
  it('places a still code exactly where every sighting agrees it is', () => {
    // With one alignment and no drift, the answer must be the alignment's own
    // translation - 10 m north, 25 m east of the zero - whatever the
    // weighting does.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ alignmentMatrix: shifted(10, 25) }),
        sighting({ alignmentMatrix: shifted(10, 25), lastTimestamp: 60_000 }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.level.ok) return;
    const geo = result.level.level.qr.geo;
    expect(geo).toBeDefined();
    if (geo === undefined) return;
    const back = calcRelativeCoordsInMeters(
      ZERO,
      { lat: geo.lat, lon: geo.lon },
      geo.alt,
      0
    );
    expect(back[0]).toBeCloseTo(10, 2);
    expect(back[2]).toBeCloseTo(25, 2);
  });

  it('leans toward the LATER sighting when they disagree', () => {
    // Why this test matters: this IS the owner's decision (DEC-3). An
    // implementation that ignored the weights would place the anchor midway,
    // and every other test here would still pass.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ alignmentMatrix: shifted(0, 0), lastTimestamp: 0 }),
        sighting({ alignmentMatrix: shifted(100, 0), lastTimestamp: 600_000 }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
      recencyHalfLifeS: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.level.ok) return;
    const geo = result.level.level.qr.geo;
    if (geo === undefined) return;
    const back = calcRelativeCoordsInMeters(
      ZERO,
      { lat: geo.lat, lon: geo.lon },
      geo.alt,
      0
    );
    // The ten-minute-old sighting weighs 1/11 against the newest one's 1, so
    // the weighted median lands on the LATER position, not between them.
    expect(back[0]).toBeCloseTo(100, 1);
  });

  it('reports the unweighted answer alongside, so the difference is visible', () => {
    // The recency half-life is a guess until the field probe measures it.
    // Showing both is what lets the owner see, on the phone, whether the
    // decision is doing anything.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ alignmentMatrix: shifted(0, 0), lastTimestamp: 0 }),
        sighting({ alignmentMatrix: shifted(100, 0), lastTimestamp: 600_000 }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.level.ok) return;
    expect(result.quality.unweighted.lat).not.toBe(
      result.level.level.qr.geo?.lat
    );
  });

  it('carries the session-mint quality into the level itself', () => {
    const result = mintQrAnchorFromSightings({
      sightings: [sighting(), sighting({ lastTimestamp: 60_000 })],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.level.ok) return;
    const quality = result.level.level.qr.mintQuality;
    expect(quality?.sightingCount).toBe(2);
    expect(quality?.detectionCount).toBe(20);
    expect(quality?.rotationSpreadDeg).toBeDefined();
    expect(quality?.translationSpreadM).toBeDefined();
    expect(quality?.mintedAtIso).toBe(NOW);
  });

  it('takes the median printed size across sightings', () => {
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ sizeM: 0.14 }),
        sighting({ sizeM: 0.16, lastTimestamp: 60_000 }),
        sighting({ sizeM: 0.18, lastTimestamp: 120_000 }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.level.ok) return;
    expect(result.level.level.qr.physicalSizeM).toBeCloseTo(0.16, 6);
    expect(result.quality.sizeSpreadM).toBeCloseTo(0.04, 6);
  });
});
