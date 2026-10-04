import { describe, expect, it } from 'vitest';
import type { CameraIntrinsics, Pose } from '../ar/qr/qr-pose';
import {
  buildObjectPoints,
  projectViewPoint,
  transformPoint,
} from '../ar/qr/qr-pose';
import { codeInCamera, walkCameraPoses } from './synthetic-qr-walk';
import { rotationAngleDeg } from './qr-zxing-pipeline';
import {
  realCandidateStarts,
  solveMultiView,
  type MultiViewVariant,
  type ViewObservation,
} from './qr-multiview-prototype';

const SIZE_M = 0.16;
const INTRINSICS: CameraIntrinsics = { fx: 820, fy: 820, cx: 512, cy: 384 };
const VARIANTS: MultiViewVariant[] = [
  'rotSharedFixedT',
  'rotSharedFreeT',
  'shared6',
];

function tilted(deg: number): Pose {
  const h = (deg * Math.PI) / 360;
  return { position: [0, 1.5, 0], rotation: [Math.sin(h), 0, 0, Math.cos(h)] };
}

/** Exact corners of `code` seen from `camera`, optionally with one corner moved. */
function view(camera: Pose, code: Pose, corner0Offset = 0): ViewObservation {
  const inCam = codeInCamera(camera, code);
  const corners = buildObjectPoints(SIZE_M).map((p, i) => {
    const px = projectViewPoint(transformPoint(p, inCam), INTRINSICS)!;
    return i === 0 ? { x: px.x + corner0Offset, y: px.y } : px;
  });
  return { corners, cameraWorld: camera, intrinsics: INTRINSICS };
}

function arcViews(code: Pose, extentDeg: number, n: number): ViewObservation[] {
  return walkCameraPoses({
    kind: 'arc',
    codeWorld: code,
    distanceM: 1.2,
    extent: extentDeg,
    steps: n,
  }).map((cam) => view(cam, code));
}

function nudged(pose: Pose, deg: number): Pose {
  const h = (deg * Math.PI) / 360;
  const q = pose.rotation;
  const d = [0, Math.sin(h), 0, Math.cos(h)];
  // q * d
  return {
    position: [
      pose.position[0] + 0.01,
      pose.position[1],
      pose.position[2] - 0.01,
    ],
    rotation: [
      q[3] * d[0]! + q[0] * d[3]! + q[1] * d[2]! - q[2] * d[1]!,
      q[3] * d[1]! - q[0] * d[2]! + q[1] * d[3]! + q[2] * d[0]!,
      q[3] * d[2]! + q[0] * d[1]! - q[1] * d[0]! + q[2] * d[3]!,
      q[3] * d[3]! - q[0] * d[0]! - q[1] * d[1]! - q[2] * d[2]!,
    ],
  };
}

describe('multi-view QR pose prototype (M0)', () => {
  // Why this test matters: on exact data every variant must land on the truth
  // from a nearby start; anything else is a bug in the residual or the step.
  it.each(VARIANTS)(
    'recovers the exact pose from a nearby start (%s)',
    (variant) => {
      const code = tilted(4);
      const views = arcViews(code, 30, 4);
      const res = solveMultiView(views, [nudged(code, 5)], {
        sizeM: SIZE_M,
        variant,
      });
      expect(res).not.toBeNull();
      expect(rotationAngleDeg(res!.rotationWorld, code.rotation)).toBeLessThan(
        1e-3
      );
      expect(res!.costPx).toBeLessThan(1e-3);
    }
  );

  // Why this test matters: the point of combining views - a mirror flip that
  // fits one view does not fit the others, so starting from every view's real
  // candidates must end on the truth, not on a flip.
  it('ends on the truth, not a mirror flip, when started from every real candidate', () => {
    const code = tilted(6);
    const views = arcViews(code, 30, 5);
    const starts = views.flatMap((v) => realCandidateStarts(v, SIZE_M));
    expect(starts.length).toBeGreaterThanOrEqual(views.length);
    const res = solveMultiView(views, starts, {
      sizeM: SIZE_M,
      variant: 'rotSharedFreeT',
    });
    expect(rotationAngleDeg(res!.rotationWorld, code.rotation)).toBeLessThan(
      1e-3
    );
  });

  // Why this test matters: a single view is the M0 "single-view refinement"
  // measurement; on exact data it must reproduce the truth too.
  it('refines a single view', () => {
    const code = tilted(25);
    const [one] = arcViews(code, 0, 1);
    const res = solveMultiView([one!], [nudged(code, 3)], {
      sizeM: SIZE_M,
      variant: 'shared6',
    });
    expect(rotationAngleDeg(res!.rotationWorld, code.rotation)).toBeLessThan(
      1e-3
    );
  });

  // Why this test matters: a phone delivers the occasional bad corner; the
  // robust loss must keep one of them from dragging the whole window.
  it('limits the pull of one bad corner with the robust loss', () => {
    const code = tilted(10);
    const cams = walkCameraPoses({
      kind: 'arc',
      codeWorld: code,
      distanceM: 1.2,
      extent: 40,
      steps: 6,
    });
    const views = cams.map((c, i) => view(c, code, i === 2 ? 25 : 0));
    const robust = solveMultiView(views, [code], {
      sizeM: SIZE_M,
      variant: 'rotSharedFreeT',
      robustScalePx: 1,
    });
    const plain = solveMultiView(views, [code], {
      sizeM: SIZE_M,
      variant: 'rotSharedFreeT',
      robustScalePx: Infinity,
    });
    const eRobust = rotationAngleDeg(robust!.rotationWorld, code.rotation);
    const ePlain = rotationAngleDeg(plain!.rotationWorld, code.rotation);
    // Measured: robust 0.05 deg, plain least squares 1.96 deg; with the robust
    // weights switched off the "robust" run stays at 1.75 (mutation-checked).
    expect(ePlain).toBeGreaterThan(1);
    expect(eRobust).toBeLessThan(0.2);
  });

  it('returns null for unusable input', () => {
    const code = tilted(4);
    expect(
      solveMultiView([], [code], { sizeM: SIZE_M, variant: 'shared6' })
    ).toBeNull();
    expect(
      solveMultiView(arcViews(code, 20, 2), [], {
        sizeM: SIZE_M,
        variant: 'shared6',
      })
    ).toBeNull();
    const bad = { ...arcViews(code, 0, 1)[0]!, corners: [{ x: 1, y: 1 }] };
    expect(
      solveMultiView([bad], [code], { sizeM: SIZE_M, variant: 'shared6' })
    ).toBeNull();
  });

  // Why this test matters: the invalid IPPE root (plan §6 finding 1) must not
  // be offered as a start; each view gives at most its two real candidates.
  it('offers at most two real candidates per view', () => {
    for (const v of arcViews(tilted(8), 30, 4)) {
      const starts = realCandidateStarts(v, SIZE_M);
      expect(starts.length).toBeGreaterThanOrEqual(1);
      expect(starts.length).toBeLessThanOrEqual(2);
    }
  });

  // Why this test matters (milestone review 2026-09-24, finding 9): a count
  // alone passes when the filter keeps the WRONG root. On exact data the
  // real pair contains the truth; the invalid root is frontal to the ray and
  // sits ~the tilt away from it.
  it('offers the true orientation among the starts on exact data', () => {
    const code = tilted(12);
    for (const v of arcViews(code, 30, 4)) {
      const errors = realCandidateStarts(v, SIZE_M).map((s) =>
        rotationAngleDeg(s.rotation, code.rotation)
      );
      expect(Math.min(...errors)).toBeLessThan(0.01);
    }
  });
});
