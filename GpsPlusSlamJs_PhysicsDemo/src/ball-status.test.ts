/**
 * Why this test matters (owner feedback round 2, plan 2026-09-26-2055 M1):
 * the owner saw no shadow on the phone, and the desktop replay cannot tell
 * which of the remaining causes it was. The status line says, on the phone,
 * how many balls came to rest (a resting ball is where a shadow is seen) and
 * how many fell through the reconstructed floor (measured on a sparse room:
 * they do). A miscount would send the next diagnosis the wrong way.
 */

import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  FELL_THROUGH_BELOW_VIEWER_M,
  RESTING_MOVE_M,
  STILL_STEPS,
  ballStatusText,
  createBallStatus,
  statsText,
} from "./ball-status";

const at = (x: number, y: number, z: number) => ({
  position: new THREE.Vector3(x, y, z),
  radius: 0.08,
});

describe("createBallStatus", () => {
  // One still step is a bounce's apex, not rest (M1 review): resting needs
  // STILL_STEPS still steps in a row.
  it("counts a ball as resting only after it stayed still for STILL_STEPS steps", () => {
    const status = createBallStatus();
    expect(status.update([at(0, 1, 0)], 1.5)).toEqual({
      balls: 1,
      resting: 0,
      fellThrough: 0,
      inRange: 0,
    });
    expect(status.update([at(0, 0.9, 0)], 1.5).resting).toBe(0);
    let y = 0.9;
    for (let i = 1; i < STILL_STEPS; i++) {
      y -= RESTING_MOVE_M / 2;
      expect(status.update([at(0, y, 0)], 1.5).resting).toBe(0);
    }
    expect(status.update([at(0, y, 0)], 1.5).resting).toBe(1);
    // A move ends the rest at once.
    expect(status.update([at(0, y + 0.01, 0)], 1.5).resting).toBe(0);
  });

  it("counts the balls a predicate puts in the shadow's range", () => {
    const status = createBallStatus();
    const near = (p: THREE.Vector3) => Math.abs(p.x) < 5;
    expect(status.update([at(0, 0, 0), at(9, 0, 0)], 1.5, near).inRange).toBe(
      1,
    );
  });

  it("counts a ball far below the viewer as fallen through the floor", () => {
    const status = createBallStatus();
    const viewerY = 1.5;
    const deep = viewerY - FELL_THROUGH_BELOW_VIEWER_M - 0.1;
    status.update([at(0, deep, 0), at(1, 0.1, 0)], viewerY);
    let s = status.update([at(0, deep - 0.5, 0), at(1, 0.1, 0)], viewerY);
    for (let i = 0; i < STILL_STEPS; i++) {
      s = status.update([at(0, deep - 0.5, 0), at(1, 0.1, 0)], viewerY);
    }
    expect(s).toEqual({ balls: 2, resting: 1, fellThrough: 1, inRange: 0 });
  });

  it("starts over when the balls change (a spawn, a clear), never comparing the wrong pairs", () => {
    const status = createBallStatus();
    status.update([at(0, 0.1, 0)], 1.5);
    // A second ball appears: no previous position for anyone this frame.
    expect(status.update([at(0, 0.1, 0), at(2, 1, 0)], 1.5).resting).toBe(0);
    expect(status.update([], 1.5)).toEqual({
      balls: 0,
      resting: 0,
      fellThrough: 0,
      inRange: 0,
    });
  });
});

// One format for AR and the replay: the e2e reads "balls N " and
// "collider N tris" from it.
describe("statsText", () => {
  it("joins the balls, the collider and the shadows' note", () => {
    expect(
      statsText(
        { balls: 2, resting: 1, fellThrough: 0, inRange: 2 },
        40,
        " · shadows on",
      ),
    ).toBe(
      "balls 2 (1 resting, 2 in shadow range) · collider 40 tris · shadows on",
    );
  });
});

describe("ballStatusText", () => {
  it("names the counts only when there is something to say", () => {
    expect(
      ballStatusText({ balls: 0, resting: 0, fellThrough: 0, inRange: 0 }),
    ).toBe("balls 0");
    expect(
      ballStatusText({ balls: 3, resting: 2, fellThrough: 1, inRange: 2 }),
    ).toBe("balls 3 (2 resting, 1 fell through, 2 in shadow range)");
    expect(
      ballStatusText({ balls: 2, resting: 2, fellThrough: 0, inRange: 0 }),
    ).toBe("balls 2 (2 resting)");
  });
});
