/**
 * Why these tests matter: the recorded walk must draw itself from its
 * first capture to its last, never jump ahead or back, and a tour with no
 * walk must draw no line at all (the owner: no straight lines between
 * stations). The rings must go once their spread ends, or the ground
 * keeps a ring per station.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createArrivalMarks, walkPrefix } from "./globe-approach-marks.js";

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

describe("walkPrefix", () => {
  it("cuts the polyline at a share of its length", () => {
    // Why: the walk grows by distance walked, so a long leg takes longer
    // to draw than a short one, as the prototype's route does.
    const pts = [v(0, 0), v(10, 0), v(10, 30)];
    expect(walkPrefix(pts, 0)).toEqual([]);
    expect(walkPrefix(pts, 0.125).map((p) => p.x)).toEqual([0, 5]);
    const half = walkPrefix(pts, 0.5);
    expect(half).toHaveLength(3);
    expect(half[2]!.z).toBeCloseTo(10, 9);
    expect(walkPrefix(pts, 1)).toEqual(pts);
    expect(walkPrefix(pts, Number.NaN)).toEqual([]);
  });

  it("draws nothing for fewer than two points or a walk of no length", () => {
    // Why: a single capture or captures in one spot are no walk to draw.
    expect(walkPrefix([v(1, 1)], 1)).toEqual([]);
    expect(walkPrefix([v(1, 1), v(1, 1)], 0.5)).toEqual([]);
  });

  it("only grows with its share", () => {
    // Why: a line that draws back reads as a glitch.
    const pts = [v(0, 0), v(3, 4), v(3, 10), v(-2, 10)];
    let last = 0;
    for (let k = 0; k <= 50; k++) {
      const part = walkPrefix(pts, k / 50);
      let len = 0;
      for (let i = 1; i < part.length; i++)
        len += part[i]!.distanceTo(part[i - 1]!);
      expect(len).toBeGreaterThanOrEqual(last - 1e-9);
      last = len;
    }
  });
});

describe("createArrivalMarks", () => {
  it("adds a ring while it spreads and removes it after", () => {
    // Why: one ring per station, gone when its spread ends.
    const parent = new THREE.Group();
    const marks = createArrivalMarks(parent);
    marks.ring("a", v(0, 0), { radius: 0.5, opacity: 0.5 });
    expect(marks.stats().rings).toBe(1);
    marks.ring("a", v(0, 0), null);
    expect(marks.stats().rings).toBe(0);
    marks.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it("draws no line without a walk, and the walk's prefix with one", () => {
    // Why: no walk, no line; a walk draws itself point by point.
    const parent = new THREE.Group();
    const marks = createArrivalMarks(parent);
    marks.drawWalk(1);
    expect(parent.getObjectByName("approach-walk")).toBeUndefined();
    marks.setWalk([v(0, 0), v(10, 0), v(10, 10)]);
    marks.drawWalk(0.25);
    expect(marks.stats().walkDrawn).toBe(2);
    marks.drawWalk(1);
    expect(marks.stats().walkDrawn).toBe(3);
    const line = parent.getObjectByName("approach-walk")!;
    marks.showWalk(false);
    expect(line.visible).toBe(false);
    marks.dispose();
  });
});
