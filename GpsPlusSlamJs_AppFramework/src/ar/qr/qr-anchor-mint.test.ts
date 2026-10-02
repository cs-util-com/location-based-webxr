import { describe, it, expect } from 'vitest';
import { Matrix4, Quaternion as ThreeQuaternion, Vector3 } from 'three';
import {
  DEFAULT_MAX_FIXED_ROTATION_SPREAD_DEG,
  maxPairwiseRotationDeg,
  mintQrAnchorFromSightings,
  QR_MINT_HEADING_UNCERTAIN_EXTENT_M,
} from './qr-anchor-mint.js';
import { calcRelativeCoordsInMeters } from '../../core/index.js';
import { geodesicAngleRad } from '../../utils/geodesic-angle.js';
import { qrWorldPoseFromOdom } from './qr-mint-level.js';
import type { QrSighting } from './qr-sighting-accumulator.js';
import type { Quaternion } from 'gps-plus-slam-js';
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

/** An odometry pose `n` metres north of the origin (WebXR -Z is north
 *  after the basis change), facing the default way. */
function north(n: number): QrSighting['odomPose'] {
  return { position: [0, 0, -n], rotation: [0, 0, 0, 1] };
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
    // Why this test matters: the recency weighting is the one part of the
    // old DEC-3 that is still in force (the per-sighting alignment was
    // retired on 2026-10-02). An implementation that ignored the weights
    // would place the anchor midway, and every other test here would still
    // pass.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ odomPose: north(0), lastTimestamp: 0 }),
        sighting({ odomPose: north(100), lastTimestamp: 600_000 }),
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
        sighting({ odomPose: north(0), lastTimestamp: 0 }),
        sighting({ odomPose: north(100), lastTimestamp: 600_000 }),
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
        sighting({ odomPose: north(0), lastTimestamp: 0 }),
        sighting({ odomPose: north(50), lastTimestamp: 500 }),
        sighting({ odomPose: north(100), lastTimestamp: 1000 }),
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
        sighting({ odomPose: north(0), lastTimestamp: 0 }),
        sighting({ odomPose: north(50), lastTimestamp: 300_000 }),
        sighting({ odomPose: north(100), lastTimestamp: 600_000 }),
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
    sighting({ odomPose: north(0), lastTimestamp: 0 }),
    sighting({ odomPose: north(100), lastTimestamp: 600_000 }),
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

// Added for the start-at-code heading defect (M3a results, open question 5;
// reproduced in `qr-anchor-mint.start-at-code.test.ts`).
describe('mintQrAnchorFromSightings - which alignment places the code', () => {
  /** An alignment turned by `deg` about Up, translated to (north, east). */
  function turned(deg: number, north = 0, east = 0): AlignmentMatrix {
    return new Matrix4()
      .makeRotationY((deg * Math.PI) / 180)
      .setPosition(north, 0, east)
      .toArray();
  }

  /** The angle (deg) between the minted rotation and `expected`. */
  function rotationErrorDeg(
    result: ReturnType<typeof mintQrAnchorFromSightings>,
    expected: Quaternion
  ): number {
    if (!result.ok || !result.level.ok) throw new Error('mint failed');
    const rotation = result.level.level.qr.geo?.rotation;
    if (rotation === undefined) throw new Error('no rotation minted');
    return (geodesicAngleRad(rotation, expected) * 180) / Math.PI;
  }

  const odomPose = {
    position: [0, 0, 0] as [number, number, number],
    rotation: yaw(0),
  };
  /** What a sighting composed through the MATURE alignment turns to. */
  const throughMature = qrWorldPoseFromOdom(odomPose, IDENTITY).rotation;

  it('turns every sighting through the session alignment at mint time', () => {
    // Why this test matters: this IS the defect. A recording that starts at
    // the code has its first sighting composed through an alignment with no
    // walk behind it, whose yaw is arbitrary (here: 90 degrees off). Turned
    // through its own alignment, that sighting minted a heading wrong by up
    // to 160 degrees (70 degrees p50 on the start-at-code sweep). The
    // alignment at mint time has seen the whole walk.
    const result = mintQrAnchorFromSightings({
      sightings: [sighting({ odomPose, alignmentMatrix: turned(90) })],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: IDENTITY,
        zero: ZERO,
        alignmentSampleCount: 60,
        segment: 0,
      },
    });
    expect(rotationErrorDeg(result, throughMature)).toBeLessThan(1e-3);
  });

  it('composes the POSITION through the session alignment at mint time too', () => {
    // Why this test matters: the owner retired DEC-3's per-sighting
    // composition on 2026-10-02. A code seen only as the recording started
    // was placed through an alignment fitted to a few fixes taken standing
    // still: 2.9 m p50 on the start-at-code sweep, against 1.3 m through the
    // alignment at mint time. Here the sighting's own alignment would put it
    // at (10, 25); the mint-time one puts it at (-40, 70).
    const result = mintQrAnchorFromSightings({
      sightings: [sighting({ odomPose, alignmentMatrix: turned(90, 10, 25) })],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: shifted(-40, 70),
        zero: ZERO,
        alignmentSampleCount: 60,
        segment: 0,
      },
    });
    if (!result.ok || !result.level.ok) throw new Error('mint failed');
    const geo = result.level.level.qr.geo!;
    const back = calcRelativeCoordsInMeters(
      ZERO,
      { lat: geo.lat, lon: geo.lon },
      geo.alt,
      0
    );
    expect(back[0]).toBeCloseTo(-40, 2);
    expect(back[2]).toBeCloseTo(70, 2);
  });

  it('stamps the session alignment sample count, and mints when the sighting own was too young', () => {
    // Why this test matters: the level records the alignment it was minted
    // through. A sighting seen after one GPS fix was refused before (the
    // MIN_ALIGNMENT_SAMPLES floor read the sighting's own count), although
    // the session's alignment at mint time had sixty.
    const result = mintQrAnchorFromSightings({
      sightings: [sighting({ alignmentSampleCount: 1 })],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: IDENTITY,
        zero: ZERO,
        alignmentSampleCount: 60,
        segment: 0,
      },
    });
    if (!result.ok || !result.level.ok) throw new Error('mint failed');
    expect(result.level.level.qr.mintQuality?.alignmentSampleCount).toBe(60);
  });

  it('places the code against the session GPS zero, not the sighting one', () => {
    // Why this test matters: the zero is half of the frame. A matrix from
    // the session with the zero from a sighting would place the code against
    // a reference the matrix was never solved for; the two only coincide
    // while nothing re-zeroes the session, which is why they differ here.
    const sessionZero = { lat: 48.001, lon: 11.002 };
    const result = mintQrAnchorFromSightings({
      sightings: [sighting({ zero: ZERO })],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: IDENTITY,
        zero: sessionZero,
        alignmentSampleCount: 60,
        segment: 0,
      },
    });
    if (!result.ok || !result.level.ok) throw new Error('mint failed');
    const geo = result.level.level.qr.geo!;
    expect(geo.lat).toBeCloseTo(sessionZero.lat, 9);
    expect(geo.lon).toBeCloseTo(sessionZero.lon, 9);
  });

  it('mints a code seen before the first GPS fix through the session alignment', () => {
    // Why this test matters: a code scanned the moment the recording starts
    // can be seen before any fix, so its sightings carry no matrix and no
    // zero. That code was refused before 2026-10-02; the alignment at mint
    // time places it like any other.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({
          alignmentMatrix: null,
          zero: null,
          alignmentSampleCount: 0,
        }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: shifted(5, -3),
        zero: ZERO,
        alignmentSampleCount: 40,
        segment: 0,
      },
    });
    if (!result.ok || !result.level.ok) throw new Error('mint failed');
    const geo = result.level.level.qr.geo!;
    const back = calcRelativeCoordsInMeters(
      ZERO,
      { lat: geo.lat, lon: geo.lon },
      geo.alt,
      0
    );
    expect(back[0]).toBeCloseTo(5, 2);
    expect(back[2]).toBeCloseTo(-3, 2);
    expect(result.level.level.qr.mintQuality?.alignmentSampleCount).toBe(40);
  });

  it('stamps the GPS accuracy of the alignment it minted through', () => {
    // Why this test matters: the stamped accuracy describes the alignment
    // the code was placed through, so it comes from the same place as the
    // matrix. (The Recorder's live alignment reader supplies no accuracy
    // today, so production levels carry none; this pins the contract for
    // the reader that does.)
    const result = mintQrAnchorFromSightings({
      sightings: [sighting({ gpsAccuracyM: 9 })],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: IDENTITY,
        zero: ZERO,
        alignmentSampleCount: 60,
        gpsAccuracyM: 4.2,
        segment: 0,
      },
    });
    if (!result.ok || !result.level.ok) throw new Error('mint failed');
    expect(result.level.level.qr.mintQuality?.gpsAccuracyM).toBe(4.2);
  });

  it('composes every POSITION through the newest sighting alignment without a session one', () => {
    // Why this test matters: the fallback is one alignment too, never a mix
    // of the sightings' own.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ alignmentMatrix: shifted(0, 0), lastTimestamp: 0 }),
        sighting({ alignmentMatrix: shifted(100, 0), lastTimestamp: 1000 }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
      recencyHalfLifeS: 1e9,
    });
    if (!result.ok || !result.level.ok) throw new Error('mint failed');
    const geo = result.level.level.qr.geo!;
    const back = calcRelativeCoordsInMeters(
      ZERO,
      { lat: geo.lat, lon: geo.lon },
      geo.alt,
      0
    );
    // Through each own alignment two equally weighted sightings disagree by
    // 100 m and the median picks one of them; through the newest alignment
    // they agree, weighted or not.
    expect(back[0]).toBeCloseTo(100, 2);
    expect(result.quality.translationSpreadM).toBe(0);
    expect(result.quality.unweighted?.lat).toBeCloseTo(geo.lat, 9);
  });

  it('uses the newest sighting alignment when the session moved to another odometry frame', () => {
    // Why this test matters: after a tracking restart or a loop closure the
    // session's alignment describes a DIFFERENT odometry frame than these
    // sightings, so turning them through it would be wrong by however far
    // the frame moved. The newest snapshot taken in their own frame is the
    // most informed alignment that still describes them.
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ odomPose, alignmentMatrix: turned(90), lastTimestamp: 0 }),
        sighting({
          odomPose,
          alignmentMatrix: IDENTITY,
          lastTimestamp: 60_000,
        }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: turned(-120),
        zero: ZERO,
        alignmentSampleCount: 90,
        segment: 1,
      },
    });
    expect(rotationErrorDeg(result, throughMature)).toBeLessThan(1e-3);
  });

  it('uses the newest sighting alignment when the caller passes none', () => {
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ odomPose, alignmentMatrix: turned(90), lastTimestamp: 0 }),
        sighting({
          odomPose,
          alignmentMatrix: IDENTITY,
          lastTimestamp: 60_000,
        }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
    });
    expect(rotationErrorDeg(result, throughMature)).toBeLessThan(1e-3);
  });

  it('uses the newest sighting alignment while the session has none at mint time', () => {
    const result = mintQrAnchorFromSightings({
      sightings: [
        sighting({ odomPose, alignmentMatrix: turned(90), lastTimestamp: 0 }),
        sighting({
          odomPose,
          alignmentMatrix: IDENTITY,
          lastTimestamp: 60_000,
        }),
      ],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: null,
        zero: ZERO,
        alignmentSampleCount: 0,
        segment: 0,
      },
    });
    expect(rotationErrorDeg(result, throughMature)).toBeLessThan(1e-3);
  });
});

describe('mintQrAnchorFromSightings - the uncertain-heading marker (D31)', () => {
  /** Mint one sighting through a session alignment with this GPS extent. */
  function mintWithExtent(
    gpsExtentM: number | undefined,
    segment = 0
  ): ReturnType<typeof mintQrAnchorFromSightings> {
    return mintQrAnchorFromSightings({
      sightings: [sighting()],
      spansFrameChange: false,
      nowIso: NOW,
      currentAlignment: {
        alignmentMatrix: IDENTITY,
        zero: ZERO,
        alignmentSampleCount: 60,
        segment,
        ...(gpsExtentM !== undefined ? { gpsExtentM } : {}),
      },
    });
  }

  function qualityOf(
    result: ReturnType<typeof mintQrAnchorFromSightings>
  ): Record<string, unknown> {
    if (!result.ok || !result.level.ok) throw new Error('mint failed');
    return { ...result.level.level.qr.mintQuality };
  }

  // Why this test matters: owner decision D31. A code composed through an
  // alignment that rests on under 10 m of GPS walk is SAVED (refusing it
  // would lose the "scan the poster, stop" session), but its heading is
  // close to guesswork: 13.8 degrees p50 and 88 p90 for the codes the
  // marker catches on the extent sweep, 3.4 / 8 for the rest. The level
  // must say so, or a viewer trusts it like any other.
  it('marks a code minted through an alignment under 10 m of GPS extent', () => {
    const quality = qualityOf(mintWithExtent(4));
    expect(quality['headingUncertain']).toBe(true);
    expect(quality['alignmentGpsExtentM']).toBe(4);
  });

  it('marks a code minted through a longer walk as NOT uncertain, explicitly', () => {
    // `false` is a measured answer, distinct from an absent (unknown) one.
    const quality = qualityOf(mintWithExtent(80));
    expect(quality['headingUncertain']).toBe(false);
    expect(quality['alignmentGpsExtentM']).toBe(80);
  });

  it('puts the boundary at exactly the threshold: 10 m is not uncertain', () => {
    expect(QR_MINT_HEADING_UNCERTAIN_EXTENT_M).toBe(10);
    expect(qualityOf(mintWithExtent(10))['headingUncertain']).toBe(false);
    expect(qualityOf(mintWithExtent(9.99))['headingUncertain']).toBe(true);
  });

  it('stamps nothing when the extent is unknown', () => {
    // A caller that does not supply the extent (a replay, an older app) must
    // not produce a level that claims a heading is settled or unsettled.
    const quality = qualityOf(mintWithExtent(undefined));
    expect(quality).not.toHaveProperty('headingUncertain');
    expect(quality).not.toHaveProperty('alignmentGpsExtentM');
  });

  it('stamps nothing for a non-finite or negative extent', () => {
    // Defensive: a broken extent says nothing about the walk, and a NaN
    // would otherwise compare false and claim "settled".
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(qualityOf(mintWithExtent(bad))).not.toHaveProperty(
        'headingUncertain'
      );
    }
  });

  it('stamps nothing when the code falls back to its own sighting snapshot', () => {
    // The extent describes the session alignment it came with. When that
    // alignment is from another odometry segment the mint uses the newest
    // sighting's own snapshot instead, whose extent nobody measured.
    const quality = qualityOf(mintWithExtent(2, 1));
    expect(quality).not.toHaveProperty('headingUncertain');
    expect(quality).not.toHaveProperty('alignmentGpsExtentM');
  });
});
