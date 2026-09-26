/**
 * Why this test matters (M1 review): the status line is what the owner
 * reads on the phone, so its counts must never contradict each other,
 * whatever the balls do: a ball is resting or fell through, never both, and
 * neither count exceeds the balls there are.
 */

import fc from "fast-check";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createBallStatus } from "./ball-status";

const ball = fc
  .tuple(
    fc.double({ min: -10, max: 10, noNaN: true }),
    fc.double({ min: -10, max: 3, noNaN: true }),
    fc.double({ min: -10, max: 10, noNaN: true }),
  )
  .map(([x, y, z]) => ({ position: new THREE.Vector3(x, y, z) }));

describe("createBallStatus, over any sequence of frames", () => {
  it("keeps resting + fell through + nothing else within the ball count", () => {
    fc.assert(
      fc.property(
        fc.array(fc.array(ball, { maxLength: 6 }), { maxLength: 60 }),
        fc.double({ min: -2, max: 3, noNaN: true }),
        (frames, viewerY) => {
          const status = createBallStatus();
          for (const balls of frames) {
            const s = status.update(balls, viewerY, (p) => p.x > 0);
            expect(s.balls).toBe(balls.length);
            expect(s.resting + s.fellThrough).toBeLessThanOrEqual(s.balls);
            expect(s.inRange).toBeLessThanOrEqual(s.balls);
            expect(
              Math.min(s.resting, s.fellThrough, s.inRange),
            ).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});
