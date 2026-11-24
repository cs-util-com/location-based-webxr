/**
 * Aspect 1 is the QR code, bit for bit.
 *
 * Why this test matters: the pose, size and vote modules gained an aspect
 * ratio so rectangular image targets can share QR's pipeline. Every QR
 * recording, level and anchor already made rests on what these modules
 * return for a square; a change in the last bit of a QR result would move
 * replays and minted levels without anyone noticing. The values below were
 * recorded from the square-only code BEFORE the aspect ratio existed, and
 * are compared exactly (no tolerance), for the default call and for an
 * explicit aspect of 1.
 */
// Activates the core library's licence before any module under test loads.
import '../../test-setup';
import { describe, expect, it } from 'vitest';
import { buildObjectPoints, solveQrPose, type Pose } from './qr-pose';
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
import {
  DEPTH_PROJECTION,
  depthPointOf,
  planarTargetEntries,
  quadLattice,
  targetPointsInWorld,
} from '../../test-utils/synthetic-planar-target';

const SIZE_M = 0.16;
const TARGET: Pose = {
  position: [0, 1.4, 0],
  rotation: [0, Math.sin(Math.PI / 36), 0, Math.cos(Math.PI / 36)],
};

function scene() {
  const sidestep = planarTargetEntries(
    buildObjectPoints(SIZE_M),
    TARGET,
    walkCameraPoses({
      kind: 'sidestep',
      codeWorld: TARGET,
      distanceM: 1.5,
      extent: 0.6,
      steps: 9,
    }),
    { noisePx: 0.7, jitterCm: 0.3, jitterDeg: 0.2, seed: 3 }
  );
  const arc = planarTargetEntries(
    buildObjectPoints(SIZE_M),
    TARGET,
    walkCameraPoses({
      kind: 'arc',
      codeWorld: TARGET,
      distanceM: 1.2,
      extent: 30,
      steps: 6,
      offsetDeg: 10,
    }),
    { noisePx: 0.5, seed: 7 }
  );
  // A square tilted 35 deg about y, 1.8 m ahead, with a little depth noise.
  const tilt = (35 * Math.PI) / 360;
  const depthTarget: Pose = {
    position: [0.1, -0.05, -1.8],
    rotation: [0, Math.sin(tilt), 0, Math.cos(tilt)],
  };
  const quad = targetPointsInWorld(buildObjectPoints(0.24), depthTarget);
  return { sidestep, arc, quad };
}

type Aspect = { aspect?: number };

/** Everything the four modules and `solveQrPose` return for the scene. */
function outputs({ aspect }: Aspect) {
  const { sidestep, arc, quad } = scene();
  const withAspect = <T extends object>(o: T) =>
    aspect === undefined ? o : { ...o, aspectRatio: aspect };
  const e = arc[2]!;
  const single = solveQrPose(
    withAspect({
      imagePoints: e.corners,
      sizeM: SIZE_M,
      intrinsics: e.intrinsics,
      cameraPose: e.cameraPose,
      solver: new PlanarPnpSquare(),
    })
  );
  const parallax = estimateQrSizeFromParallax(sidestep, withAspect({}));
  const multi = solveQrPoseMultiView(arc, SIZE_M, withAspect({}));
  const viewError =
    aspect === undefined
      ? viewErrorAtRotationPx(arc[0]!, multi!.rotation, SIZE_M)
      : viewErrorAtRotationPx(arc[0]!, multi!.rotation, SIZE_M, aspect);
  const unprojector = createDepthUnprojector(
    [0, 0, 0],
    [0, 0, 0, 1],
    DEPTH_PROJECTION
  )!;
  const corners = quad.map((p, i) => {
    const d = depthPointOf(p);
    return { ...d, depthM: d.depthM + (i - 1.5) * 0.004 };
  }) as [
    ReturnType<typeof depthPointOf>,
    ReturnType<typeof depthPointOf>,
    ReturnType<typeof depthPointOf>,
    ReturnType<typeof depthPointOf>,
  ];
  const interior = quadLattice(quad, 4).map(depthPointOf);
  const screens = quad.map(depthPointOf) as typeof corners;
  const depthArgs = aspect === undefined ? [] : [aspect];
  const depthCorner = estimateQrSizeFromDepth(
    corners,
    interior,
    unprojector,
    ...depthArgs
  );
  const depthDense = estimateQrSizeFromDepthDense(
    screens,
    interior,
    unprojector,
    ...depthArgs
  );
  const votes = buildQrGpsVotes(
    withAspect({
      qrPoseWorld: single!.qrPoseWorld,
      sizeM: SIZE_M,
      qrGeo: { lat: 10, lon: 20, alt: 100, headingDeg: 37 },
      syntheticAccuracyM: 0.5,
      timestamp: 1_700_000_000_000,
    })
  );
  return {
    single,
    parallax,
    multi,
    viewError,
    depthCorner,
    depthDense,
    votes,
  };
}

/** Recorded from the square-only code (JSON keeps every double's shortest round-trip digits). */
const GOLDEN = {
  single: {
    qrPoseWorld: {
      rotation: [
        0.028369631618261337, 0.09054791927337646, -0.005399804096668959,
        0.9954732656478882,
      ],
      position: [
        -0.0003818338569469004, 1.3996815410850103, -0.0014312420402193826,
      ],
    },
    qrPoseInCamera: {
      rotation: [
        0.028856156393885612, -0.057586997747421265, -0.0011471934849396348,
        0.9979227185249329,
      ],
      position: [
        0.000053347828028796885, -0.0003184589051279615, -1.2014803926781086,
      ],
    },
    reprojectionErrorPx: 0.2905114264855661,
  },
  parallax: {
    sizeM: 0.16130008647337912,
    lateralBaselineM: 0.19427634994773765,
    views: 9,
    oldestTimestamp: 1000,
    newestTimestamp: 2000,
  },
  multi: {
    rotation: [
      0.0011945473903182274, 0.0872883615910091, -0.0005411638757320124,
      0.9961822233552199,
    ],
    position: [
      -0.000478290969666136, 1.3999357620652109, -0.0017755032365887231,
    ],
    costPx: 0.3938523349922673,
    viewRmsPx: [
      0.530482427203521, 0.3552398063618194, 0.36228644780237623,
      0.39262300403532263, 0.3777004861677226, 0.30830033127962436,
    ],
    viewPositions: [
      [-0.000021325148972350938, 1.3998821489062099, -0.002143120035324575],
      [-0.0002716692587060865, 1.4003316160906716, -0.002751435648360001],
      [-0.00038180814929344997, 1.399681541094872, -0.0014313039541924422],
      [-0.0013596025788992772, 1.4000656338407589, -0.003612377533691813],
      [-0.0010059847838079783, 1.3998285363014373, -0.0014612688098063487],
      [0.0001706441016823268, 1.3998250961573158, 0.0007464865618428407],
    ],
    views: 6,
    droppedViews: 0,
    tiltSigmaDeg: 0.9269155821161648,
    starts: 3,
    iterations: 14,
  },
  viewError: 0.530482427203521,
  depthCorner: {
    sizeM: 0.24039334175799165,
    quality: 0.9658479310188942,
  },
  depthDense: {
    sizeM: 0.23999999759850627,
    quality: 0.9999999756529264,
  },
  votes: [
    {
      odomPosition: [
        -0.0777942677792377, 1.4799971458909567, 0.01745571714001648,
      ],
      odomRotation: [
        0.028369631618261337, 0.09054791927337646, -0.005399804096668959,
        0.9954732656478882,
      ],
      rawGpsPoint: {
        id: 'qr-1700000000000-0',
        latitude: 9.999999424128022,
        longitude: 19.99999956083235,
        altitude: 100.08,
        latLongAccuracy: 0.5,
        timestamp: 1700000000000,
        source: 'synthetic-qr',
      },
    },
    {
      odomPosition: [
        0.07957273816501431, 1.4790990529058035, -0.011437474227371291,
      ],
      odomRotation: [
        0.028369631618261337, 0.09054791927337646, -0.005399804096668959,
        0.9954732656478882,
      ],
      rawGpsPoint: {
        id: 'qr-1700000000000-1',
        latitude: 10.000000575871978,
        longitude: 20.00000043916765,
        altitude: 100.08,
        latLongAccuracy: 0.5,
        timestamp: 1700000000000,
        source: 'synthetic-qr',
      },
    },
    {
      odomPosition: [
        0.0770306000653439, 1.319365936279064, -0.020318201220455245,
      ],
      odomRotation: [
        0.028369631618261337, 0.09054791927337646, -0.005399804096668959,
        0.9954732656478882,
      ],
      rawGpsPoint: {
        id: 'qr-1700000000000-2',
        latitude: 10.000000575871978,
        longitude: 20.00000043916765,
        altitude: 99.92,
        latLongAccuracy: 0.5,
        timestamp: 1700000000000,
        source: 'synthetic-qr',
      },
    },
    {
      odomPosition: [
        -0.08033640587890811, 1.3202640292642172, 0.008574990146932526,
      ],
      odomRotation: [
        0.028369631618261337, 0.09054791927337646, -0.005399804096668959,
        0.9954732656478882,
      ],
      rawGpsPoint: {
        id: 'qr-1700000000000-3',
        latitude: 9.999999424128022,
        longitude: 19.99999956083235,
        altitude: 99.92,
        latLongAccuracy: 0.5,
        timestamp: 1700000000000,
        source: 'synthetic-qr',
      },
    },
  ],
};

describe('aspect 1 reproduces the square-only results exactly', () => {
  it('when the aspect ratio is left out', () => {
    expect(outputs({})).toEqual(GOLDEN);
  });

  it('when the aspect ratio is 1', () => {
    expect(outputs({ aspect: 1 })).toEqual(GOLDEN);
  });
});
