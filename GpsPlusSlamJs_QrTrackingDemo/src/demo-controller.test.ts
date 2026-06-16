/**
 * QR-tracking demo controller — unit tests.
 *
 * Why this matters: this pins the orchestration the whole demo rests on —
 * detect → measure size from depth → (as soon as a size EXISTS) solve pose via the
 * injected PnP closure → (on lock) record into the store + glue the scene. Every
 * device dependency is faked (no WebXR/camera/depth/OpenCV), so the flow is
 * exercised in isolation. The pose math itself lives in the framework's
 * `solveQrPose`/`qr-pose` tests; here the solver is a fake that returns a fixed
 * solution, so these tests assert ORCHESTRATION: the size gate (a size exists, NOT
 * vote-grade convergence), the intrinsics derivation, per-frame size recording,
 * and which pose drives the scene.
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
import {
  createQrDemoController,
  type DepthContext,
  type QrFrameDiagnostics,
} from "./demo-controller";

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
  const sizes: { text: string; estimateM: number | null; status: string }[] =
    [];
  const sceneUpdates: { pose: Pose; sizeM: number | null }[] = [];
  const statuses: string[] = [];
  const solveInputs: QrSolvePoseInput[] = [];
  const diags: QrFrameDiagnostics[] = [];
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
    recordSize: (text, est) =>
      sizes.push({ text, estimateM: est.estimateM, status: est.status }),
    updateScene: (pose, sizeM) => sceneUpdates.push({ pose, sizeM }),
    onStatus: (s) => statuses.push(s),
    onFrameDiagnostics: (d) => diags.push(d),
    requiredLockCount: 2,
    ...overrides,
  });
  return {
    controller,
    detections,
    sizes,
    sceneUpdates,
    statuses,
    solveInputs,
    diags,
  };
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
  it("records the size estimate every measured frame (HUD progression)", async () => {
    const { controller, sizes } = setup();
    await feed(controller, 5);
    // The size is recorded on EVERY measured frame so the HUD can show the
    // running median + sample count even before (and independently of) a lock.
    expect(sizes).toHaveLength(5);
    expect(sizes[0]?.estimateM).toBeCloseTo(0.2, 3);
  });

  it("locks as soon as a running-median size exists — it does NOT wait for the 'estimated' lifecycle", async () => {
    // REGRESSION: the controller previously gated the PnP solve on
    // `estimate.status === 'estimated'` (8 quality-≥0.8 samples within a 1 cm
    // spread). On noisy device depth that bar is essentially never met, so the
    // overlay never appeared. The correct gate — matching the plan and the
    // production controller — blocks the solve only while NO size exists
    // (`estimateM === null`); `SOLVEPNP_IPPE_SQUARE` rotation is size-invariant,
    // so the provisional median is a valid size that just refines as it converges.
    const { controller, detections, sceneUpdates, sizes, solveInputs } =
      setup();
    // requiredLockCount=2 → two consecutive measured frames suffice once a size
    // exists, which is from the very first accepted sample.
    await feed(controller, 3);
    // Far below minSamples (8): the size is still 'measuring', NOT 'estimated'…
    expect(sizes.at(-1)?.status).toBe("measuring");
    // …yet the detection has locked and the scene is glued with the PnP pose.
    expect(detections).toContain(TEXT);
    expect(controller.status).toBe("tracking");
    expect(sceneUpdates.at(-1)?.pose.position).toEqual([0, 0, -1]);
    // The solve ran with the provisional running-median size (≈ 0.2 m).
    expect(solveInputs.at(-1)?.sizeM).toBeCloseTo(0.2, 3);
  });

  it("drives the scene with the PnP pose and the measured size", async () => {
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

// The on-device root-cause readout: each frame emits WHY it did/didn't accept a
// sample or lock, so the "0 samples / nothing glued" failure can be diagnosed on
// a phone instead of inferred. These pin the reason for each sub-cause.
describe("createQrDemoController — frame diagnostics", () => {
  it("reports depth coverage, quality and reprojection on a solved frame", async () => {
    const { controller, diags } = setup();
    await feed(controller, 3);
    const solved = diags.find((d) => d.solved === true);
    expect(solved).toBeDefined();
    expect(solved?.detected).toBe(true);
    expect(solved?.depthCornerHits).toBe(4);
    expect(solved?.quality ?? 0).toBeGreaterThan(0.8);
    expect(solved?.sizeM).toBeCloseTo(0.2, 3);
    expect(solved?.reprojectionErrorPx).toBeCloseTo(0.5, 5);
    expect(solved?.reason).toContain("solved");
  });

  it("emits 'no depth context' when depth is unavailable", async () => {
    const { controller, diags } = setup({ getDepthContext: () => null });
    await feed(controller, 2);
    const d = diags.at(-1);
    expect(d?.detected).toBe(true);
    expect(d?.hasDepthContext).toBe(false);
    expect(d?.reason).toContain("no depth context");
  });

  it("reports the corner depth-hit count (0/4) when corners lack a depth read", async () => {
    const ctx = fakeDepthContext();
    const { controller, diags } = setup({
      getDepthContext: () => ({ ...ctx, depthAt: () => null }),
    });
    await feed(controller, 2);
    const d = diags.at(-1);
    expect(d?.depthCornerHits).toBe(0);
    expect(d?.reason).toContain("corner depth missing");
  });

  it("reports 'low quality' (no sample accepted) for a non-planar quad with depth present", async () => {
    const ctx = fakeDepthContext();
    // Depth resolves at every corner (hits = 4) but the unprojected quad is
    // non-planar (BR pushed off the plane) → quality < 0.8 → never accepted →
    // sampleCount stays 0 → nothing glues. This is the C2 ("quality gate too
    // strict for noisy depth") signal the on-device log must surface.
    const nonPlanar: DepthContext = {
      ...ctx,
      unprojector: {
        unproject: (dp): Vector3 | null => [
          dp.screenX,
          dp.screenY,
          dp.screenX > 0.5 && dp.screenY > 0.5 ? -0.85 : -1,
        ],
      },
    };
    const { controller, diags, detections } = setup({
      getDepthContext: () => nonPlanar,
    });
    await feed(controller, 4);
    const d = diags.at(-1);
    expect(d?.detected).toBe(true);
    expect(d?.depthCornerHits).toBe(4); // depth present at all corners…
    expect(d?.accepted).toBe(false); // …but quality too low to accept
    expect(d?.sampleCount).toBe(0);
    expect(d?.quality ?? 1).toBeLessThan(0.8);
    expect(d?.reason).toContain("low quality");
    expect(detections).toHaveLength(0); // never locks → nothing glued
  });
});
