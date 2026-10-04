/**
 * The fused QR pose per code, for apps (QR near-frontal pose plan §60-§61,
 * b4b-3; moved here from the QR demo so the demo, the TourViewer and later
 * the recorder share ONE implementation - DEC-H3).
 *
 * Why these tests matter: this is what an app shows and votes with. It must
 * give the joint rotation once the window is stable and nothing (the app
 * falls back, or does not vote) while it is not, forget the old frame at a
 * restart, keep codes apart, take each code's own options (its printed
 * size), and not re-solve on every read - a HUD re-renders on every store
 * change and a TourViewer asks on every lock.
 */
import { describe, expect, it } from 'vitest';
import {
  buildObjectPoints,
  projectViewPoint,
  rotateVectorByQuaternion,
  type Pose,
} from './qr-pose';
import { solveQrPoseMultiView } from './qr-multi-view-pose';
import { createFusedQrPoseSource } from './qr-fused-pose-source';
import {
  qrDetectedReducer,
  qrFrameChanged,
  recordQrDetection,
  selectQrFusedEntries,
  type QrDetectedState,
} from '../../state/qr-detected-slice';

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

/** A slice the tests dispatch into, and the entries reader an app passes. */
function slice() {
  let state: QrDetectedState = qrDetectedReducer(undefined, {
    type: '@@INIT',
  });
  return {
    feed(text: string, n: number, t0 = 0) {
      for (let i = 0; i < n; i++) {
        state = qrDetectedReducer(
          state,
          recordQrDetection(eventAt(text, -0.3 + 0.1 * i, t0 + i * 125))
        );
      }
    },
    restart() {
      state = qrDetectedReducer(state, qrFrameChanged());
    },
    entriesOf: (text: string) =>
      selectQrFusedEntries({ qrDetected: state }, text),
  };
}

function angleDeg(a: readonly number[], b: readonly number[]): number {
  const dot = Math.abs(
    a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! + a[3]! * b[3]!
  );
  return (2 * Math.acos(Math.min(1, dot)) * 180) / Math.PI;
}

describe('createFusedQrPoseSource', () => {
  it('gives nothing until the window is stable, then the joint rotation', () => {
    const s = slice();
    const source = createFusedQrPoseSource({ entriesOf: s.entriesOf });
    s.feed('A', 4);
    expect(source.resolve('A')).toBeNull();
    s.feed('A', 3, 500);
    const pose = source.resolve('A');
    expect(pose).not.toBeNull();
    expect(angleDeg(pose!.rotation, CODE.rotation)).toBeLessThan(1e-3);
    expect(source.last('A')?.method).toBe('joint');
  });

  // A restart moves the frame: the old detections must stop counting at once.
  it('forgets the old frame at a restart', () => {
    const s = slice();
    const source = createFusedQrPoseSource({ entriesOf: s.entriesOf });
    s.feed('A', 6);
    expect(source.resolve('A')).not.toBeNull();
    s.restart();
    expect(source.resolve('A')).toBeNull();
    expect(source.last('A')?.status).toBe('unknown');
  });

  it('keeps codes apart', () => {
    const s = slice();
    const source = createFusedQrPoseSource({ entriesOf: s.entriesOf });
    s.feed('A', 6);
    s.feed('B', 2);
    expect(source.resolve('A')).not.toBeNull();
    expect(source.resolve('B')).toBeNull();
  });

  // A TourViewer passes each code's printed size (plan §61 #8); the
  // options must reach that code's tracker and no other.
  it("hands each code's own options to its tracker", () => {
    const s = slice();
    const asked: string[] = [];
    const source = createFusedQrPoseSource({
      entriesOf: s.entriesOf,
      optionsFor: (text) => {
        asked.push(text);
        return text === 'A' ? { minViews: 3 } : {};
      },
    });
    s.feed('A', 3);
    s.feed('B', 3);
    expect(source.resolve('A')).not.toBeNull();
    expect(source.resolve('B')).toBeNull();
    source.resolve('A');
    expect(asked).toEqual(['A', 'B']);
  });

  // The HUD re-renders on every store change; the solve must run once per
  // new detection, not per read.
  it('solves once per new detection, however often it is read', () => {
    const s = slice();
    let solves = 0;
    const source = createFusedQrPoseSource({
      entriesOf: s.entriesOf,
      optionsFor: () => ({
        solve: (views, sizeM, options) => {
          solves++;
          return solveQrPoseMultiView(views, sizeM, options);
        },
      }),
    });
    s.feed('A', 6);
    source.resolve('A');
    source.evaluate('A');
    source.resolve('A');
    expect(solves).toBe(1);
    s.feed('A', 1, 2000);
    source.resolve('A');
    expect(solves).toBe(2);
  });

  // Plan §30: ?qrperf times the fused/motion step. Re-reads hit the
  // tracker's cache, so only a NEW evaluation is reported - with the time it
  // took on the given clock.
  it("reports each new evaluation's cost, never a cached re-read", () => {
    const s = slice();
    const costs: number[] = [];
    let t = 0;
    const source = createFusedQrPoseSource({
      entriesOf: s.entriesOf,
      now: () => (t += 2),
      onEvaluated: (_r, ms) => costs.push(ms),
    });
    s.feed('A', 6);
    source.resolve('A');
    source.resolve('A');
    expect(costs).toEqual([2]);
    s.feed('A', 1, 2000);
    source.resolve('A');
    expect(costs).toHaveLength(2);
  });

  // Plan §66: the TourViewer keeps one tally per code from this callback,
  // so it must say WHICH code was evaluated.
  it('names the code each new evaluation belongs to', () => {
    const s = slice();
    const seen: string[] = [];
    const source = createFusedQrPoseSource({
      entriesOf: s.entriesOf,
      onEvaluated: (_r, _ms, text) => seen.push(text),
    });
    s.feed('A', 2);
    s.feed('B', 2);
    source.evaluate('A');
    source.evaluate('B');
    source.evaluate('A');
    expect(seen).toEqual(['A', 'B']);
  });

  it('reports the last evaluation, and nothing for a code never read', () => {
    const s = slice();
    const source = createFusedQrPoseSource({ entriesOf: s.entriesOf });
    expect(source.last('A')).toBeNull();
    s.feed('A', 2);
    const r = source.evaluate('A');
    expect(source.last('A')).toBe(r);
    expect(r.status).toBe('measuring');
  });
});
