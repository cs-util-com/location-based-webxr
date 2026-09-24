/**
 * QR-tracking demo controller — unit tests.
 *
 * Why this matters: this pins the orchestration the whole demo rests on —
 * detect → measure size from depth → (size exists) solve PnP → (on lock) record
 * into the store + glue the scene. Every device dependency is faked: a planar
 * fake depth context makes the measured size converge, and an injected fake
 * `solvePose` returns a canned pose so the scene assertions don't depend on the
 * solver math (which has its own tests in the framework). The flow runs without
 * WebXR / camera / depth.
 */

import { describe, it, expect } from "vitest";
import type {
  RgbaImage,
  QrDetection,
  Pose,
} from "gps-plus-slam-app-framework/ar";
import type { Vector3, Matrix4 } from "gps-plus-slam-app-framework/core";
import type { CapturedCameraFrame } from "gps-plus-slam-app-framework/ar";
import { intrinsicsFromProjection } from "gps-plus-slam-app-framework/ar";
import {
  createQrDemoController,
  type DepthContext,
  type DemoSolvePose,
} from "./demo-controller";

const TEXT = "https://demo/qr";
const IMG: RgbaImage = {
  data: new Uint8ClampedArray(4),
  width: 100,
  height: 100,
};

/** The offered frame: the pixels plus the camera pose they were captured at. */
const FRAME: CapturedCameraFrame = {
  image: IMG,
  cameraPose: { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  capturedAtMs: 0,
};

// A symmetric perspective projection (column-major); only fx/fy/cx/cy are read.
const PROJECTION = [
  2, 0, 0, 0, 0, 2, 0, 0, 0, 0, -1.0002, -1, 0, 0, -0.2, 0,
] as unknown as Matrix4;

// A pixel square on a 100×100 frame → a planar world square (z = −1).
const detection: QrDetection = {
  corners: [
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
  ],
  text: TEXT,
};

/** Linear screen→world map; a square frame keeps the world quad square. */
const SCALE = 1 / 3;
function fakeDepthContext(): DepthContext {
  return {
    unprojector: {
      unproject: (dp): Vector3 | null => [
        dp.screenX * SCALE,
        dp.screenY * SCALE,
        -1,
      ],
    },
    depthAt: () => 1,
    projectionMatrix: PROJECTION,
  };
}

/**
 * A non-planar fake: the bottom-right corner is pushed off the plane so the
 * size-quality score never clears the accept threshold → estimateM stays null.
 */
function nonPlanarDepthContext(): DepthContext {
  return {
    ...fakeDepthContext(),
    unprojector: {
      unproject: (dp): Vector3 | null => [
        dp.screenX * SCALE,
        dp.screenY * SCALE,
        dp.screenX > 0.5 && dp.screenY > 0.5 ? -0.6 : -1,
      ],
    },
  };
}

/** The canned PnP pose the injected solvePose returns. */
const SOLVED_WORLD: Pose = { position: [1, 2, 3], rotation: [0, 0, 0, 1] };
const cannedSolvePose: DemoSolvePose = () => ({
  qrPoseWorld: SOLVED_WORLD,
  qrPoseInCamera: { position: [0, 0, 1], rotation: [0, 0, 0, 1] },
  reprojectionErrorPx: 0.5,
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

function setup(
  overrides: Partial<Parameters<typeof createQrDemoController>[0]> = {},
) {
  const detections: string[] = [];
  const sizes: { text: string; estimateM: number | null; status: string }[] =
    [];
  const sceneUpdates: { pose: Pose; sizeM: number | null }[] = [];
  const statuses: string[] = [];
  const controller = createQrDemoController({
    detect: () => Promise.resolve<QrDetection | null>(detection),
    getDepthContext: () => fakeDepthContext(),
    recordDetection: (e) => detections.push(e.text),
    recordSize: (text, est) =>
      sizes.push({ text, estimateM: est.estimateM, status: est.status }),
    updateScene: (pose, sizeM) => sceneUpdates.push({ pose, sizeM }),
    onStatus: (s) => statuses.push(s),
    solvePose: cannedSolvePose,
    requiredLockCount: 2,
    ...overrides,
  });
  return { controller, detections, sizes, sceneUpdates, statuses };
}

async function feed(
  controller: { offerFrame: (f: CapturedCameraFrame) => void },
  n: number,
  frame: CapturedCameraFrame = FRAME,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    controller.offerFrame(frame);
    await flush();
  }
}

describe("createQrDemoController", () => {
  it("locks after N detections and records detection + size + PnP scene update", async () => {
    const { controller, detections, sizes, sceneUpdates, statuses } = setup();
    await feed(controller, 4);

    expect(detections).toContain(TEXT);
    expect(sizes.length).toBeGreaterThan(0);
    // The measured square has side 60/100 * SCALE = 0.2 m.
    expect(sizes.at(-1)?.estimateM).toBeCloseTo(0.2, 3);
    expect(sceneUpdates.length).toBeGreaterThan(0);
    // The scene is driven by the (injected) PnP pose, not a depth-fit pose.
    expect(sceneUpdates.at(-1)?.pose.position).toEqual([1, 2, 3]);
    expect(sceneUpdates.at(-1)?.sizeM).toBeCloseTo(0.2, 3);
    expect(controller.status).toBe("tracking");
    expect(statuses).toContain("scanning");
    expect(statuses).toContain("tracking");
  });

  it('converges the size to "estimated" after enough samples', async () => {
    const { controller, sizes } = setup();
    await feed(controller, 12);
    // Constant square → spread 0 → estimated once minSamples (8) is reached.
    expect(sizes.at(-1)?.estimateM).toBeCloseTo(0.2, 3);
    expect(sizes.at(-1)?.status).toBe("estimated");
    expect(controller.status).toBe("tracking");
  });

  it("does not lock while the size is still unknown (size-exists gate)", async () => {
    // Non-planar depth → quality below the accept threshold → estimateM null →
    // the controller must NOT solve a pose or record anything, even though the
    // QR is detected every frame.
    const { controller, detections, sceneUpdates } = setup({
      getDepthContext: () => nonPlanarDepthContext(),
    });
    await feed(controller, 4);
    expect(detections).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("does not lock when the solver returns null", async () => {
    const { controller, detections, sceneUpdates } = setup({
      solvePose: () => null,
    });
    await feed(controller, 4);
    expect(detections).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("does not record or lock when depth is unavailable", async () => {
    const { controller, detections, sceneUpdates } = setup({
      getDepthContext: () => null,
    });
    await feed(controller, 4);
    expect(detections).toHaveLength(0);
    expect(sceneUpdates).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("does not record when a corner has no depth read", async () => {
    const ctx = fakeDepthContext();
    const { controller, detections } = setup({
      getDepthContext: () => ({ ...ctx, depthAt: () => null }),
    });
    await feed(controller, 4);
    expect(detections).toHaveLength(0);
  });

  it("stays scanning when nothing is detected", async () => {
    const { controller, detections } = setup({
      detect: () => Promise.resolve(null),
    });
    await feed(controller, 3);
    expect(detections).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("rejects a degenerate quad (matches solveQrPose's validateQuad guard)", async () => {
    // Four collinear corners → zero area → degenerate → must not lock.
    const degenerate: QrDetection = {
      corners: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 2, y: 0 },
        { x: 3, y: 0 },
      ],
      text: TEXT,
    };
    const { controller, detections } = setup({
      detect: () => Promise.resolve<QrDetection | null>(degenerate),
    });
    await feed(controller, 4);
    expect(detections).toHaveLength(0);
    expect(controller.status).toBe("scanning");
  });

  it("renders the resolveStablePose filtered pose when available", async () => {
    const stable: Pose = {
      position: [9, 9, 9],
      rotation: [0, 0, 0, 1],
    };
    const { controller, sceneUpdates } = setup({
      resolveStablePose: () => stable,
    });
    await feed(controller, 4);
    // The overlay must use the FILTERED pose, not the raw PnP pose.
    expect(sceneUpdates.at(-1)?.pose.position).toEqual([9, 9, 9]);
  });

  it("falls back to the raw PnP pose while the stable pose is not yet converged", async () => {
    const { controller, sceneUpdates } = setup({
      resolveStablePose: () => null, // not converged
    });
    await feed(controller, 4);
    expect(sceneUpdates.length).toBeGreaterThan(0);
    // The injected PnP pose drives the scene.
    expect(sceneUpdates.at(-1)?.pose.position).toEqual([1, 2, 3]);
  });

  it("reset() clears accumulators and returns to idle", async () => {
    const { controller } = setup();
    await feed(controller, 4);
    controller.reset();
    expect(controller.status).toBe("idle");
  });
});

/**
 * Why this test matters (QR perf plan 2026-09-23, M3): `isBusy` is the camera
 * source's veto - while a detect is in flight the scheduler would drop a new
 * frame, so the demo skips reading it back from the GPU at all.
 */
describe("createQrDemoController isBusy", () => {
  it("is busy exactly while a detect is in flight", async () => {
    let resolveDetect: (d: QrDetection | null) => void = () => {};
    const { controller } = setup({
      detect: () => new Promise((r) => (resolveDetect = r)),
    });
    expect(controller.isBusy()).toBe(false);
    controller.offerFrame(FRAME);
    expect(controller.isBusy()).toBe(true);
    resolveDetect(null);
    await flush();
    expect(controller.isBusy()).toBe(false);
  });
});

/**
 * Why this test matters (QR perf plan 2026-09-23, M4): the demo's pose used to
 * come from the latest DEPTH sample (sampled every 250 ms), so the PnP solve
 * paired one frame's corners with a camera pose up to 250 ms + one decode
 * away. The solve and the recorded event must use the pose of the frame the
 * corners came from; depth still supplies the SIZE.
 */
describe("createQrDemoController capture-time pose", () => {
  it("solves against the frame's capture pose, not the depth sample's", async () => {
    const capturePose = {
      position: [4, 5, 6] as const,
      rotation: [0, 0, 0, 1] as const,
    };
    const poses: unknown[] = [];
    const events: unknown[] = [];
    const { controller } = setup({
      solvePose: (input) => {
        poses.push(input.cameraPose);
        return cannedSolvePose(input);
      },
      recordDetection: (e) => events.push(e),
    });
    const frame: CapturedCameraFrame = {
      image: IMG,
      cameraPose: capturePose,
      capturedAtMs: 0,
    };
    await feed(controller, 3, frame);
    expect(poses.length).toBeGreaterThan(0);
    expect(poses.every((p) => p === capturePose)).toBe(true);
    expect(events[0]).toMatchObject({ cameraPose: capturePose });
  });

  // Why this test matters (QR near-frontal pose plan M3b b3): the recorded
  // event feeds the fused QR window, which re-solves the corners jointly and
  // needs the intrinsics of the buffer they came from.
  it("records the detector buffer's intrinsics on the event", async () => {
    const events: { intrinsics?: { fx: number } }[] = [];
    const { controller } = setup({ recordDetection: (e) => events.push(e) });
    await feed(controller, 3);
    expect(events.length).toBeGreaterThan(0);
    // Exactly the solve's intrinsics: the demo's projection over this image.
    expect(events[0]!.intrinsics).toEqual(
      intrinsicsFromProjection(PROJECTION, IMG.width, IMG.height),
    );
  });
});
