/**
 * The demo's fused QR pose source (QR near-frontal pose plan M3b b5).
 *
 * Why these tests matter: the demo overlay is where the owner SEES the fused
 * pose on the phone. It must show the joint rotation once the window is
 * stable, nothing (so the controller falls back to the raw frame pose) while
 * it is not, forget the old frame at a restart, keep codes apart, and not
 * re-solve on every HUD render.
 */
import { describe, expect, it } from "vitest";
import type { Pose } from "gps-plus-slam-app-framework/ar/qr";
import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
  solveQrPoseMultiView,
} from "gps-plus-slam-app-framework/ar/qr";
import {
  qrFrameChanged,
  recordQrDetection,
} from "gps-plus-slam-app-framework/state";
import { createQrDemoStore } from "./demo-store.js";
import { createFusedPoseSource } from "./fused-pose-source.js";

const SIZE_M = 0.16;
const K = { fx: 820, fy: 820, cx: 512, cy: 384 };
/** A code at the origin facing +z, turned 6 deg about y. */
const CODE: Pose = {
  position: [0, 0, 0],
  rotation: [
    0,
    Math.sin((6 * Math.PI) / 360),
    0,
    Math.cos((6 * Math.PI) / 360),
  ],
};

/** A detection event from a camera at (dx, 0, 1.2) looking down -z. */
function eventAt(text: string, dx: number, timestamp: number) {
  const cameraPose: Pose = { position: [dx, 0, 1.2], rotation: [0, 0, 0, 1] };
  const corners = buildObjectPoints(SIZE_M).map((p) => {
    const w = rotateVectorByQuaternion(CODE.rotation, p);
    return projectViewPoint([w[0] - dx, w[1], w[2] - 1.2], K)!;
  });
  return {
    text,
    timestamp,
    corners,
    cameraPose,
    intrinsics: K,
    imageWidth: 1024,
    imageHeight: 768,
    qrPoseWorld: CODE,
    qrPoseInCamera: CODE,
    reprojectionErrorPx: 0,
  };
}

function feed(
  store: ReturnType<typeof createQrDemoStore>,
  text: string,
  n: number,
  t0 = 0,
) {
  for (let i = 0; i < n; i++) {
    store.dispatch(
      recordQrDetection(eventAt(text, -0.3 + 0.1 * i, t0 + i * 125)),
    );
  }
}

function angleDeg(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!,
  );
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

describe("createFusedPoseSource", () => {
  it("gives nothing until the window is stable, then the joint rotation", () => {
    const store = createQrDemoStore();
    const source = createFusedPoseSource();
    feed(store, "A", 4);
    expect(source.resolve(store.getState(), "A")).toBeNull();
    feed(store, "A", 3, 500);
    const pose = source.resolve(store.getState(), "A");
    expect(pose).not.toBeNull();
    expect(angleDeg(pose!.rotation, CODE.rotation)).toBeLessThan(1e-3);
    expect(source.last("A")?.method).toBe("joint");
  });

  // A restart moves the frame: the old detections must stop counting at once.
  it("forgets the old frame at a restart", () => {
    const store = createQrDemoStore();
    const source = createFusedPoseSource();
    feed(store, "A", 6);
    expect(source.resolve(store.getState(), "A")).not.toBeNull();
    store.dispatch(qrFrameChanged());
    expect(source.resolve(store.getState(), "A")).toBeNull();
    expect(source.last("A")?.status).toBe("unknown");
  });

  it("keeps codes apart", () => {
    const store = createQrDemoStore();
    const source = createFusedPoseSource();
    feed(store, "A", 6);
    feed(store, "B", 2);
    expect(source.resolve(store.getState(), "A")).not.toBeNull();
    expect(source.resolve(store.getState(), "B")).toBeNull();
  });

  // The HUD re-renders on every store change; the solve must run once per
  // new detection, not per read.
  it("solves once per new detection, however often it is read", () => {
    const store = createQrDemoStore();
    let solves = 0;
    const source = createFusedPoseSource({
      solve: (views, sizeM, options) => {
        solves++;
        return solveQrPoseMultiView(views, sizeM, options);
      },
    });
    feed(store, "A", 6);
    source.resolve(store.getState(), "A");
    source.resolve(store.getState(), "A");
    source.resolve(store.getState(), "A");
    expect(solves).toBe(1);
    feed(store, "A", 1, 2000);
    source.resolve(store.getState(), "A");
    expect(solves).toBe(2);
  });
});
