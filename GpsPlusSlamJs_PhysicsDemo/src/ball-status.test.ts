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
  diagnosticsText,
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

// The owner's first-load report (r752, 2026-09-27): shadows missing only on
// the first page load, and nothing in the code explained it. These numbers
// on the phone's status line say which link was missing at that moment:
// no depth, no mesh, no collider, or a slow start.
describe("diagnosticsText", () => {
  it("names the depth stream, the mesh, the collider's age and the start", () => {
    expect(
      diagnosticsText({
        depthSamples: 12,
        depthAgeMs: 240,
        meshTris: 950,
        colliderAgeMs: 310,
        start: { rapierMs: 820, arMs: 2345 },
      }),
    ).toBe(
      " · depth 12 (0.2 s ago) · mesh 950 tris · collider 0.3 s old · start: physics 0.8 s, AR 2.3 s",
    );
  });

  it("says what has not happened yet, and leaves out an unknown start", () => {
    expect(
      diagnosticsText({
        depthSamples: 0,
        depthAgeMs: null,
        meshTris: 0,
        colliderAgeMs: null,
      }),
    ).toBe(" · depth 0 · mesh 0 tris · collider not built");
  });

  // The first-visit report on r753: the shadow side too, the receiver's
  // program flags, the light and its map, the XR session's visibility and
  // the one-shot receiver rebuild.
  it("adds the shadow state and the XR session when given", () => {
    expect(
      diagnosticsText({
        depthSamples: 3,
        depthAgeMs: 100,
        meshTris: 40,
        colliderAgeMs: 200,
        shadow: {
          receiver: "S1N1D1",
          cast: true,
          mapSize: 1024,
          mapAllocated: true,
          mapRenders: 3,
        },
        xr: {
          visibility: "visible",
          firstVisibleMs: 1250,
          rebuild: "rebuilt 3.2 s S0N0D1>S1N1D1",
        },
      }),
    ).toBe(
      " · depth 3 (0.1 s ago) · mesh 40 tris · collider 0.2 s old" +
        " · rx S1N1D1 · sun cast, map 1024, renders 3" +
        " · xr visible (first 1.3 s) · rx rebuilt 3.2 s S0N0D1>S1N1D1",
    );
  });

  it("says when the light casts no map yet, and XR was never visible", () => {
    expect(
      diagnosticsText({
        depthSamples: 0,
        depthAgeMs: null,
        meshTris: 0,
        colliderAgeMs: null,
        shadow: {
          receiver: "off",
          cast: false,
          mapSize: 1024,
          mapAllocated: false,
          mapRenders: 0,
        },
        xr: {
          visibility: "visible-blurred",
          firstVisibleMs: null,
          rebuild: "rebuild pending",
        },
      }),
    ).toBe(
      " · depth 0 · mesh 0 tris · collider not built" +
        " · rx off · sun no cast, no map, renders 0" +
        " · xr visible-blurred (never visible) · rx rebuild pending",
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
