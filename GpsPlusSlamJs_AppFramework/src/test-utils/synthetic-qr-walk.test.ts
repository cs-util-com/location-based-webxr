import { describe, expect, it } from 'vitest';
import type { Pose } from '../ar/qr/qr-pose';
import { composePose, transformPoint } from '../ar/qr/qr-pose';
import {
  codeInCamera,
  lookAtPose,
  rayAngleDeg,
  walkCameraPoses,
  type WalkKind,
} from './synthetic-qr-walk';

const CODE: Pose = { position: [0.3, 1.5, -0.2], rotation: [0, 0, 0, 1] };

function yawed(deg: number): Pose {
  const h = (deg * Math.PI) / 360;
  return {
    position: CODE.position,
    rotation: [0, Math.sin(h), 0, Math.cos(h)],
  };
}

describe('synthetic QR walks', () => {
  // Why this test matters: every walk measurement assumes the code stays in
  // view, centred; a camera that drifts off the code would make a solver look
  // bad for reasons that have nothing to do with the solver.
  it('keeps the code centre on the camera axis at every step, for every walk', () => {
    for (const kind of ['approach', 'sidestep', 'arc', 'still'] as WalkKind[]) {
      for (const code of [CODE, yawed(35)]) {
        const poses = walkCameraPoses({
          kind,
          codeWorld: code,
          distanceM: 1.5,
          extent: kind === 'arc' ? 40 : 0.6,
          steps: 7,
          offsetDeg: 10,
        });
        for (const cam of poses) {
          const c = transformPoint([0, 0, 0], codeInCamera(cam, code));
          expect(Math.hypot(c[0], c[1]), kind).toBeLessThan(1e-5);
          expect(c[2], kind).toBeLessThan(0); // in front (-z)
        }
      }
    }
  });

  // Why this test matters: a phone is held upright; a rolled camera would
  // change the image-space corner order the pipeline sees.
  it('keeps the camera upright (its x axis horizontal)', () => {
    const cam = lookAtPose([1, 2, 3], [0, 1.5, 0]);
    const x = transformPoint([1, 0, 0], {
      position: [0, 0, 0],
      rotation: cam.rotation,
    });
    expect(Math.abs(x[1])).toBeLessThan(1e-9);
  });

  // Why this test matters: a camera standing in front of the code must see it
  // unmirrored - its +x (image right) along the code's +x. A flipped basis
  // still keeps the code centred and the x axis horizontal (mutation-checked).
  it('faces the code without mirroring', () => {
    const [cam] = walkCameraPoses({
      kind: 'still',
      codeWorld: CODE,
      distanceM: 1,
      extent: 0,
      steps: 1,
    });
    const right = transformPoint([1, 0, 0], {
      position: [0, 0, 0],
      rotation: cam!.rotation,
    });
    expect(right[0]).toBeCloseTo(1, 6);
    expect(right[1]).toBeCloseTo(0, 6);
    expect(right[2]).toBeCloseTo(0, 6);
  });

  it('round-trips the code pose through the camera frame', () => {
    const cam = lookAtPose(
      [0.5, 1.4, 1.2],
      CODE.position as [number, number, number]
    );
    const back = composePose(cam, codeInCamera(cam, CODE));
    for (let i = 0; i < 3; i++) {
      expect(back.position[i]).toBeCloseTo(CODE.position[i]!, 5);
    }
  });

  // Why this test matters: the done bar bins by the viewing angle a walk
  // reaches, so the angle must be measured to the RAY, and an arc of E degrees
  // centred on the normal must reach E/2.
  it('reaches the expected ray angles', () => {
    const arc = walkCameraPoses({
      kind: 'arc',
      codeWorld: CODE,
      distanceM: 1,
      extent: 40,
      steps: 5,
    });
    const angles = arc.map((p) => rayAngleDeg(p, CODE));
    expect(angles[0]).toBeCloseTo(20, 4);
    expect(angles[2]).toBeCloseTo(0, 4);
    expect(angles[4]).toBeCloseTo(20, 4);

    const side = walkCameraPoses({
      kind: 'sidestep',
      codeWorld: CODE,
      distanceM: 2,
      extent: 0.4,
      steps: 3,
    });
    // atan(0.2 / 2): a 40 cm sidestep at 2 m reaches only ~5.7 deg.
    expect(rayAngleDeg(side[0]!, CODE)).toBeCloseTo(5.71, 1);

    const still = walkCameraPoses({
      kind: 'still',
      codeWorld: CODE,
      distanceM: 1.5,
      extent: 0,
      steps: 4,
      offsetDeg: 12,
    });
    for (const p of still) expect(rayAngleDeg(p, CODE)).toBeCloseTo(12, 4);
  });

  it('approaches the code along the viewing line', () => {
    const poses = walkCameraPoses({
      kind: 'approach',
      codeWorld: CODE,
      distanceM: 1,
      extent: 1,
      steps: 3,
    });
    const dist = poses.map((p) =>
      Math.hypot(
        p.position[0] - CODE.position[0],
        p.position[1] - CODE.position[1],
        p.position[2] - CODE.position[2]
      )
    );
    expect(dist[0]).toBeCloseTo(2, 5);
    expect(dist[2]).toBeCloseTo(1, 5);
  });

  it('rejects bad options', () => {
    const base = {
      kind: 'still' as const,
      codeWorld: CODE,
      distanceM: 1,
      extent: 0,
      steps: 2,
    };
    expect(() => walkCameraPoses({ ...base, distanceM: 0 })).toThrow(
      RangeError
    );
    expect(() => walkCameraPoses({ ...base, extent: -1 })).toThrow(RangeError);
    expect(() => walkCameraPoses({ ...base, steps: 0 })).toThrow(RangeError);
    expect(() => walkCameraPoses({ ...base, steps: 1.5 })).toThrow(RangeError);
  });
});
