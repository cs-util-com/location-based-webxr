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
    // Optional on the type so a FAILED unweighted mint reports nothing rather
    // than Null Island - but a successful mint always carries it, and
    // asserting that is what keeps the comparison below meaningful.
    expect(result.quality.unweighted).toBeDefined();
    expect(result.quality.unweighted?.lat).not.toBe(
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

// Added after the M-B…M-G review (finding 6): the comparison must isolate the
// WEIGHTING, not a change of estimator.
describe('mintQrAnchorFromSightings — the unweighted comparison', () => {
  it('matches the weighted answer when the half-life is long enough to be inert', () => {
    // Why this test matters: the weighted and unweighted answers used
    // different estimators, so for any EVEN number of sightings they differed
    // even with the weighting disabled - and the summary screen reported
    // "weighting moved it N m" for a difference the weighting did not cause.
    // That readout exists to make an unearned half-life checkable in the
    // field, which a confounded number cannot do.
    // THREE sightings, deliberately. A median over an EVEN count sits
    // between the two middle values, so any weight difference at all flips it
    // from one to the other - which says nothing about whether the weighting
    // is doing real work. An odd count has a stable middle.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ alignmentMatrix: shifted(0, 0), lastTimestamp: 0 }),
        sighting({ alignmentMatrix: shifted(50, 0), lastTimestamp: 500 }),
        sighting({ alignmentMatrix: shifted(100, 0), lastTimestamp: 1000 }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
      recencyHalfLifeS: 1e9, // every sighting weighs effectively the same
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.level.ok) return;
    // Optional on the type so a FAILED unweighted mint reports nothing rather
    // than Null Island - but a successful mint always carries it, and
    // asserting that is what keeps the comparison below meaningful.
    expect(result.quality.unweighted).toBeDefined();
    expect(result.quality.unweighted?.lat).toBeCloseTo(
      result.level.level.qr.geo?.lat ?? 0,
      9
    );
  });

  it('still differs when the half-life is short enough to bite', () => {
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ alignmentMatrix: shifted(0, 0), lastTimestamp: 0 }),
        sighting({ alignmentMatrix: shifted(50, 0), lastTimestamp: 300_000 }),
        sighting({ alignmentMatrix: shifted(100, 0), lastTimestamp: 600_000 }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
      recencyHalfLifeS: 60,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.level.ok) return;
    // Optional on the type so a FAILED unweighted mint reports nothing rather
    // than Null Island - but a successful mint always carries it, and
    // asserting that is what keeps the comparison below meaningful.
    expect(result.quality.unweighted).toBeDefined();
    expect(result.quality.unweighted?.lat).not.toBeCloseTo(
      result.level.level.qr.geo?.lat ?? 0,
      9
    );
  });
});

describe('mintQrAnchorFromSightings — recencyHalfLifeS validation', () => {
  /**
   * Why these tests matter: `recencyHalfLifeS` is caller-supplied public API,
   * and `recencyWeights` divides by it unguarded (PR #390 review). The failure
   * was SILENT rather than loud, which is what makes it worth a throw:
   *
   * - `0` gives the newest sighting `1 / (1 + 0/0)` = NaN and every older one
   *   `1 / (1 + Infinity)` = 0. `weightedMedian` drops all of them and falls
   *   back to `lowerMedian`, so the weighting simply does not run — and
   *   `quality.unweighted` then equals the weighted answer, so the "weighting
   *   moved it N m" readout on the summary screen reports 0 m for a mint whose
   *   weighting never happened. The one signal that would reveal the bug is
   *   the signal the bug suppresses.
   * - a negative half-life can make `1 + ageS/halfLifeS` exactly 0, giving an
   *   Infinity weight, or simply a negative one — both dropped the same way.
   *
   * A caller wanting "no decay" passes a large finite number, which is what
   * the unweighted-comparison test above already does.
   */
  const twoSightings = [
    sighting({ alignmentMatrix: shifted(0, 0), lastTimestamp: 0 }),
    sighting({ alignmentMatrix: shifted(100, 0), lastTimestamp: 600_000 }),
  ];

  for (const bad of [0, -1, -60, Number.NaN, Infinity, -Infinity]) {
    it(`rejects recencyHalfLifeS = ${String(bad)}`, () => {
      expect(() =>
        mintQrAnchorFromSightings({
          sightings: twoSightings,
          spansFrameChange: false,
          nowIso: NOW,
          recencyHalfLifeS: bad,
        })
      ).toThrow(RangeError);
    });
  }

  it('still accepts a positive finite half-life', () => {
    // Guards the guard: a validation that rejected everything would make every
    // test above red, but a validation that rejected only the DEFAULT path
    // would not, since these tests all pass an explicit value.
    const result = mintQrAnchorFromSightings({
      sightings: twoSightings,
      spansFrameChange: false,
      nowIso: NOW,
      recencyHalfLifeS: 60,
    });
    expect(result.ok).toBe(true);
  });

  it('accepts an omitted half-life, falling back to the default', () => {
    const result = mintQrAnchorFromSightings({
      sightings: twoSightings,
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a bad half-life even when the sightings would be refused', () => {
    // Why this test matters: it pins the ORDER. Validating inside the
    // placement step would let a caller bug hide behind "these sightings were
    // unusable anyway", so it would only ever surface on the sessions that
    // would otherwise have succeeded — the worst possible sampling.
    expect(() =>
      mintQrAnchorFromSightings({
        sightings: [],
        spansFrameChange: false,
        nowIso: NOW,
        recencyHalfLifeS: 0,
      })
    ).toThrow(RangeError);
  });
});
