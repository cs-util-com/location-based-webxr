/**
 * QR-tracking demo controller — unit tests.
 *
 * Why this matters: this pins the orchestration the whole demo rests on —
 * detect → measure size from depth → (once size CONVERGES) solve pose via the
 * injected PnP closure → (on lock) record into the store + glue the scene. Every
 * device dependency is faked (no WebXR/camera/depth/OpenCV), so the flow is
 * exercised in isolation. The pose math itself lives in the framework's
 * `solveQrPose`/`qr-pose` tests; here the solver is a fake that returns a fixed
 * solution, so these tests assert ORCHESTRATION: the strict size gate, the
 * intrinsics derivation, per-frame size recording, and which pose drives the
 * scene.
 */

import { describe, it, expect } from "vitest";
import type {
  RgbaImage,
  QrDetection,
  Pose,
  QrSolvePoseInput,
  QrPoseSolution,
  CameraIntrinsics,
} from "gps-plus-slam-app-framework/ar";
import type { Vector3 } from "gps-plus-slam-app-framework/core";
import { createQrDemoController, type DepthContext } from "./demo-controller";

const TEXT = "https://demo/qr";
const IMG: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 100,
  height: 100,
};

// A 20-px square centered on the 100×100 frame, ordered TL, TR, BR, BL.
const detection: QrDetection = {
  corners: [
    { x: 40, y: 40 },
    { x: 60, y: 40 },
    { x: 60, y: 60 },
    { x: 40, y: 60 },
  ],
  text: TEXT,
};

// Column-major XRView projection → intrinsics fx=fy=100, cx=cy=50 on a 100×100
// frame (intrinsicsFromProjection reads P[0], P[5], P[8], P[9]).
const PROJECTION = [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] as const;

// Identity screen→world map (SCALE=1) so the unprojected corner square has side
// 0.2 m → the depth-measured size converges to a constant 0.2.
function fakeDepthContext(): DepthContext {
  return {
    unprojector: {
      unproject: (dp): Vector3 | null => [dp.screenX, dp.screenY, -1],
    },
    depthAt: () => 1,
    cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
    projectionMatrix: [...PROJECTION],
  };
}

/** Fixed PnP solution: QR centered 1 m in front, identity rotation. */
const SOLVED_POSE: Pose = { position: [0, 0, -1], rotation: [0, 0, 0, 1] };
function fakeSolution(): QrPoseSolution {
  return {
    qrPoseWorld: SOLVED_POSE,
    qrPoseInCamera: SOLVED_POSE,
    reprojectionErrorPx: 0.5,
  };
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function setup(
  overrides: Partial<Parameters<typeof createQrDemoController>[0]> = {},
  opts: { omitSolver?: boolean } = {},
) {
  const detections: string[] = [];
  const sizes: { text: string; estimateM: number | null }[] = [];
  const sceneUpdates: { pose: Pose; sizeM: number | null }[] = [];
  const statuses: string[] = [];
  const solveInputs: QrSolvePoseInput[] = [];
  // `solvePose` is omitted entirely (not set to `undefined`) for the
  // graceful-degrade test — `exactOptionalPropertyTypes` forbids `undefined`.
  const solverDep = opts.omitSolver
    ? {}
    : {
        solvePose: (input: QrSolvePoseInput) => {
          solveInputs.push(input);
          return fakeSolution();
        },
      };
  const controller = createQrDemoController({
    detect: () => Promise.resolve<QrDetection | null>(detection),
    getDepthContext: () => fakeDepthContext(),
    ...solverDep,
    recordDetection: (e) => detections.push(e.text),
    recordSize: (text, est) => sizes.push({ text, estimateM: est.estimateM }),
    updateScene: (pose, sizeM) => sceneUpdates.push({ pose, sizeM }),
    onStatus: (s) => statuses.push(s),
    requiredLockCount: 2,
    ...overrides,
  });
  return { controller, detections, sizes, sceneUpdates, statuses, solveInputs };
}

async function feed(
  controller: { offerFrame: (i: RgbaImage) => void },
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    controller.offerFrame(IMG);
    await flush();
  }
}

describe("createQrDemoController", () => {
  it("records the size estimate every measured frame, before any lock (HUD progression + strict gate)", async () => {
    const { controller, sizes, detections, sceneUpdates } = setup();
    // Below the size accumulator's minSamples (8) → still 'measuring', so the
    // strict gate withholds the pose: no lock, no scene update — but the size IS
    // recorded each frame so the HUD can show convergence progress.
    await feed(controller, 5);
    expect(sizes).toHaveLength(5);
    expect(detections).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("locks once the size converges and drives the scene with the PnP pose", async () => {
    const { controller, detections, sceneUpdates, statuses } = setup();
    await feed(controller, 12);

    expect(detections).toContain(TEXT);
    expect(controller.status).toBe("tracking");
    expect(statuses).toContain("tracking");
    // The scene is driven by the SOLVED PnP pose (z = −1), not a depth-fit fit.
    expect(sceneUpdates.at(-1)?.pose.position).toEqual([0, 0, -1]);
    // The cube size is the converged measured size (≈ 0.2 m).
    expect(sceneUpdates.at(-1)?.sizeM).toBeCloseTo(0.2, 3);
  });

  it("passes intrinsics derived from the projection matrix + the measured size to solvePose", async () => {
    const { controller, solveInputs } = setup();
    await feed(controller, 12);
    expect(solveInputs.length).toBeGreaterThan(0);
    const last = solveInputs.at(-1) as QrSolvePoseInput;
    expect(last.intrinsics).toEqual<CameraIntrinsics>({
      fx: 100,
      fy: 100,
      cx: 50,
      cy: 50,
    });
    expect(last.sizeM).toBeCloseTo(0.2, 3);
    expect(last.cameraPose.position).toEqual([0, 0, 0]);
  });

  it("does not lock when no pose solver is available (OpenCV unavailable → graceful degrade)", async () => {
    const { controller, detections, sceneUpdates, sizes } = setup(
      {},
      { omitSolver: true },
    );
    await feed(controller, 12);
    // Size still measured (HUD works), but with no solver nothing is placed.
    expect(sizes.length).toBeGreaterThan(0);
    expect(detections).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("does not lock when the solver rejects the detection (returns null)", async () => {
    const { controller, detections } = setup({ solvePose: () => null });
    await feed(controller, 12);
    expect(detections).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("does not measure or lock when depth is unavailable", async () => {
    const { controller, detections, sizes, sceneUpdates } = setup({
      getDepthContext: () => null,
    });
    await feed(controller, 12);
    expect(sizes).toHaveLength(0);
    expect(detections).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("does not measure when a corner has no depth read", async () => {
    const ctx = fakeDepthContext();
    const { controller, detections, sizes } = setup({
      getDepthContext: () => ({ ...ctx, depthAt: () => null }),
    });
    await feed(controller, 12);
    expect(sizes).toHaveLength(0);
    expect(detections).toHaveLength(0);
  });

  it("stays scanning when nothing is detected", async () => {
    const { controller, detections, sizes } = setup({
      detect: () => Promise.resolve(null),
    });
    await feed(controller, 12);
    expect(detections).toHaveLength(0);
    expect(sizes).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("rejects a degenerate quad before measuring (matches solveQrPose's validateQuad guard)", async () => {
    // Four collinear corners → zero area → degenerate → must not measure or lock.
    const degenerate: QrDetection = {
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      text: TEXT,
    };
    const { controller, detections, sizes } = setup({
      detect: () => Promise.resolve<QrDetection | null>(degenerate),
    });
    await feed(controller, 12);
    expect(detections).toHaveLength(0);
    expect(sizes).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("renders the resolveStablePose filtered pose when available", async () => {
    const stable: Pose = { position: [9, 9, 9], rotation: [0, 0, 0, 1] };
    const { controller, sceneUpdates } = setup({
      resolveStablePose: () => stable,
    });
    await feed(controller, 12);
    // The overlay must use the FILTERED pose, not the raw PnP pose.
    expect(sceneUpdates.at(-1)?.pose.position).toEqual([9, 9, 9]);
  });

  it("falls back to the raw PnP pose while the stable pose is not yet converged", async () => {
    const { controller, sceneUpdates } = setup({
      resolveStablePose: () => null, // not converged
    });
    await feed(controller, 12);
    expect(sceneUpdates.length).toBeGreaterThan(0);
    // Raw PnP pose: QR centered 1 m in front (z = −1).
    expect(sceneUpdates.at(-1)?.pose.position).toEqual([0, 0, -1]);
  });

  it("reset() clears accumulators and returns to idle", async () => {
    const { controller } = setup();
    await feed(controller, 12);
    controller.reset();
    expect(controller.status).toBe("idle");
  });
});
