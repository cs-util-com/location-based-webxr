/**
 * Rectangular planar targets through the pose, size and vote modules.
 *
 * A printed image target is a rectangle (an A4 page, a poster), not a square.
 * Its aspect ratio (height over width) is passed next to the width, and each
 * module must then return the rectangle's true pose and width. The aspect
 * values swept here (0.5, 1/sqrt 2, 1, sqrt 2, 2) span landscape banners,
 * A-series paper both ways round, and tall posters.
 */
// Activates the core library's licence before any module under test loads.
import '../../test-setup';
import { describe, expect, it } from 'vitest';
import {
  buildObjectPoints,
  isValidAspectRatio,
  solveQrPose,
  transformPoint,
  type Pose,
} from './qr-pose';
import { PlanarPnpSquare } from './planar-pnp';
import { estimateQrSizeFromParallax } from './qr-size-parallax';
import {
  solveQrPoseMultiView,
  viewErrorAtRotationPx,
} from './qr-multi-view-pose';
import {
  estimateQrSizeFromDepth,
  estimateQrSizeFromDepthDense,
} from './qr-size-from-depth';
import { buildQrGpsVotes } from './qr-gps-vote';
import { createDepthUnprojector } from '../depth-unprojection';
import { walkCameraPoses } from '../../test-utils/synthetic-qr-walk';
import { rotationAngleDeg } from '../../test-utils/qr-zxing-pipeline';
import {
  DEPTH_PROJECTION,
  depthPointOf,
  planarTargetEntries,
  quadLattice,
  targetPointsInWorld,
} from '../../test-utils/synthetic-planar-target';

const ASPECTS = [0.5, Math.SQRT1_2, 1, Math.SQRT2, 2];
const BAD_ASPECTS = [0, -1, Number.NaN, Infinity, -Infinity];
const WIDTH_M = 0.3;
const TARGET: Pose = {
  position: [0.2, 1.3, -0.4],
  rotation: [0, Math.sin(Math.PI / 18), 0, Math.cos(Math.PI / 18)],
};

function arc(aspect: number) {
  return planarTargetEntries(
    buildObjectPoints(WIDTH_M, aspect),
    TARGET,
    walkCameraPoses({
      kind: 'arc',
      codeWorld: TARGET,
      distanceM: 1.6,
      extent: 30,
      steps: 6,
      offsetDeg: 5,
    })
  );
}

function sidestep(aspect: number) {
  return planarTargetEntries(
    buildObjectPoints(WIDTH_M, aspect),
    TARGET,
    walkCameraPoses({
      kind: 'sidestep',
      codeWorld: TARGET,
      distanceM: 1.8,
      extent: 0.6,
      steps: 7,
    })
  );
}

/** A rectangle tilted 30 deg about y, 1.6 m ahead of a camera at the origin. */
function depthQuad(aspect: number) {
  const half = (30 * Math.PI) / 360;
  return targetPointsInWorld(buildObjectPoints(WIDTH_M, aspect), {
    position: [0.05, 0.02, -1.6],
    rotation: [0, Math.sin(half), 0, Math.cos(half)],
  });
}

const unprojector = () =>
  createDepthUnprojector([0, 0, 0], [0, 0, 0, 1], DEPTH_PROJECTION)!;

type Four<T> = [T, T, T, T];

describe('isValidAspectRatio and buildObjectPoints', () => {
  // Why: every module trusts the aspect it is handed; this is the one gate.
  it('accepts positive finite numbers and nothing else', () => {
    for (const a of ASPECTS) expect(isValidAspectRatio(a)).toBe(true);
    for (const a of [...BAD_ASPECTS, '1', null, undefined])
      expect(isValidAspectRatio(a)).toBe(false);
  });

  // Why: the corners define what "width" and "aspect" mean for every module.
  it('builds a centred rectangle, width along x and height along y', () => {
    expect(buildObjectPoints(0.4, 0.5)).toEqual([
      [-0.2, 0.1, 0],
      [0.2, 0.1, 0],
      [0.2, -0.1, 0],
      [-0.2, -0.1, 0],
    ]);
  });

  // Why: a NaN or zero aspect would collapse the target to a line silently.
  it.each(BAD_ASPECTS)('rejects the aspect %s', (a) => {
    expect(() => buildObjectPoints(0.2, a)).toThrow(RangeError);
  });
});

describe.each(ASPECTS)('a rectangle of aspect %s', (aspect) => {
  // Why: the single-view solve anchors every rectangular target's pose.
  it('solves the single-view pose exactly', () => {
    const e = arc(aspect)[2]!;
    const sol = solveQrPose({
      imagePoints: e.corners,
      sizeM: WIDTH_M,
      aspectRatio: aspect,
      intrinsics: e.intrinsics,
      cameraPose: e.cameraPose,
      solver: new PlanarPnpSquare(),
    })!;
    // The solver returns a float32 rotation: up to about 1e-3 px of rounding.
    expect(sol.reprojectionErrorPx).toBeLessThan(0.01);
    for (let i = 0; i < 3; i++)
      expect(sol.qrPoseWorld.position[i]).toBeCloseTo(TARGET.position[i]!, 6);
    // A single view fixes the tilt only to float32 rounding (about 0.03 deg).
    expect(
      rotationAngleDeg(sol.qrPoseWorld.rotation, TARGET.rotation)
    ).toBeLessThan(0.1);
  });

  // Why: the parallax size is the width the image matcher's anchor is built at.
  it('measures the width from parallax', () => {
    const size = estimateQrSizeFromParallax(sidestep(aspect), {
      aspectRatio: aspect,
    })!;
    expect(size.sizeM).toBeCloseTo(WIDTH_M, 6);
  });

  // Why: the multi-view rotation is what anchors a target's content level.
  it('solves the multi-view pose, and each view fits it', () => {
    const views = arc(aspect);
    const multi = solveQrPoseMultiView(views, WIDTH_M, {
      aspectRatio: aspect,
    })!;
    expect(multi.costPx).toBeLessThan(1e-6);
    expect(rotationAngleDeg(multi.rotation, TARGET.rotation)).toBeLessThan(
      1e-4
    );
    expect(
      viewErrorAtRotationPx(views[0]!, multi.rotation, WIDTH_M, aspect)
    ).toBeLessThan(1e-6);
  });

  // Why: both depth measurers must report the WIDTH and a clean quality.
  it('measures the width from depth, corner and dense paths', () => {
    const quad = depthQuad(aspect);
    const reads = quad.map(depthPointOf) as Four<
      ReturnType<typeof depthPointOf>
    >;
    const interior = quadLattice(quad, 4).map(depthPointOf);
    const corner = estimateQrSizeFromDepth(
      reads,
      interior,
      unprojector(),
      aspect
    )!;
    const dense = estimateQrSizeFromDepthDense(
      reads,
      interior,
      unprojector(),
      aspect
    )!;
    for (const obs of [corner, dense]) {
      expect(obs.sizeM).toBeCloseTo(WIDTH_M, 5);
      expect(obs.quality).toBeGreaterThan(0.9999);
    }
  });

  // Why: votes pair each physical corner with its geo position; a square
  // assumption would put two of them on the wrong spot of the target.
  it('votes at the rectangle corners', () => {
    const votes = buildQrGpsVotes({
      qrPoseWorld: TARGET,
      sizeM: WIDTH_M,
      aspectRatio: aspect,
      qrGeo: { lat: 10, lon: 20, alt: 100, headingDeg: 0 },
      syntheticAccuracyM: 0.5,
      timestamp: 1,
    });
    const local = buildObjectPoints(WIDTH_M, aspect);
    votes.forEach((v, i) => {
      const want = transformPoint(local[i]!, TARGET);
      for (let k = 0; k < 3; k++)
        expect(v.odomPosition[k]).toBeCloseTo(want[k]!, 12);
    });
    const altSpan =
      votes[0]!.rawGpsPoint.altitude! - votes[3]!.rawGpsPoint.altitude!;
    expect(altSpan).toBeCloseTo(WIDTH_M * aspect, 9);
  });
});

describe('the aspect is what the measurers trust', () => {
  // Why: told the wrong shape, the depth quality must drop so the size
  // accumulator (quality threshold 0.8) refuses the read.
  it('a 2:1 rectangle measured as a square scores low', () => {
    const quad = depthQuad(2);
    const reads = quad.map(depthPointOf) as Four<
      ReturnType<typeof depthPointOf>
    >;
    const obs = estimateQrSizeFromDepth(reads, [], unprojector(), 1)!;
    expect(obs.quality).toBeLessThan(0.8);
  });
});

describe('an invalid aspect is refused at every entry point', () => {
  const quad = depthQuad(1);
  const reads = quad.map(depthPointOf) as Four<ReturnType<typeof depthPointOf>>;
  const views = arc(1);

  // Why: a garbage aspect must never yield a plausible-looking pose or size.
  it.each(BAD_ASPECTS)('aspect %s', (a) => {
    const e = views[0]!;
    expect(() =>
      solveQrPose({
        imagePoints: e.corners,
        sizeM: WIDTH_M,
        aspectRatio: a,
        intrinsics: e.intrinsics,
        cameraPose: e.cameraPose,
        solver: new PlanarPnpSquare(),
      })
    ).toThrow(RangeError);
    expect(() =>
      estimateQrSizeFromParallax(sidestep(1), { aspectRatio: a })
    ).toThrow(RangeError);
    expect(() => estimateQrSizeFromDepth(reads, [], unprojector(), a)).toThrow(
      RangeError
    );
    expect(() =>
      estimateQrSizeFromDepthDense(reads, reads, unprojector(), a)
    ).toThrow(RangeError);
    expect(() =>
      buildQrGpsVotes({
        qrPoseWorld: TARGET,
        sizeM: WIDTH_M,
        aspectRatio: a,
        qrGeo: { lat: 10, lon: 20, alt: 100, headingDeg: 0 },
        syntheticAccuracyM: 0.5,
      })
    ).toThrow(RangeError);
    // The multi-view module reports an out-of-range input as null, as it
    // already does for the size.
    expect(solveQrPoseMultiView(views, WIDTH_M, { aspectRatio: a })).toBeNull();
    expect(
      viewErrorAtRotationPx(views[0]!, TARGET.rotation, WIDTH_M, a)
    ).toBeNull();
  });
});
