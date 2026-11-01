/**
 * Why these tests matter: the recorded walk must draw itself from its
 * first capture to its last, never jump ahead or back, and a tour with no
 * walk must draw no line at all (the owner: no straight lines between
 * stations). The rings must go once their spread ends, or the ground
 * keeps a ring per station.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  createArrivalMarks,
  walkCut,
  type WalkCut,
} from "./globe-approach-marks.js";

const v = (x: number, z: number) => new THREE.Vector3(x, 0, z);

/** The walk's drawn length at a cut (`along` the lengths up to each point). */
const drawnAt = (along: readonly number[], cut: WalkCut | null) =>
  cut === null
    ? 0
    : along[cut.segment]! +
      cut.t * (along[cut.segment + 1]! - along[cut.segment]!);

describe("walkCut", () => {
  it("cuts the walk at a share of its length", () => {
    // Why: the walk grows by distance walked, so a long leg takes longer
    // to draw than a short one, as the prototype's route does. Legs of 10
    // and 30 m.
    const along = [0, 10, 40];
    expect(walkCut(along, 0)).toBeNull();
    expect(walkCut(along, 0.125)).toEqual({ segment: 0, t: 0.5 });
    const half = walkCut(along, 0.5);
    expect(half?.segment).toBe(1);
    expect(half?.t).toBeCloseTo(1 / 3, 9);
    expect(walkCut(along, 1)).toEqual({ segment: 1, t: 1 });
    expect(walkCut(along, 2)).toEqual({ segment: 1, t: 1 });
    expect(walkCut(along, Number.NaN)).toBeNull();
  });

  it("cuts nothing for fewer than two points or a walk of no length", () => {
    // Why: a single capture or captures in one spot are no walk to draw.
    expect(walkCut([0], 1)).toBeNull();
    expect(walkCut([0, 0], 0.5)).toBeNull();
  });

  it("only grows with its share, by exactly that share of the length", () => {
    // Why: a line that draws back reads as a glitch. Legs of 5, 6 and 5 m.
    const along = [0, 5, 11, 16];
    let last = 0;
    for (let k = 1; k <= 50; k++) {
      const len = drawnAt(along, walkCut(along, k / 50));
      expect(len).toBeGreaterThanOrEqual(last - 1e-9);
      expect(len).toBeCloseTo((16 * k) / 50, 9);
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

  it("builds the walk's line once and reveals it by its share", () => {
    // Why: the walk draws itself over many frames; a geometry made anew
    // each frame is a GPU upload and a garbage object per frame for a
    // line whose points never change. One geometry, its segments shown
    // up to the share and the last one cut where the share ends.
    const parent = new THREE.Group();
    const marks = createArrivalMarks(parent);
    marks.setWalk([v(0, 0), v(10, 0), v(10, 10), v(0, 10)]);
    marks.drawWalk(0.1);
    const line = parent.getObjectByName("approach-walk") as THREE.Mesh;
    const geometry = line.geometry as THREE.InstancedBufferGeometry;
    const end = () => geometry.getAttribute("instanceEnd");
    expect(geometry.instanceCount).toBe(1);
    expect(end().getX(0)).toBeCloseTo(3, 6);
    marks.drawWalk(0.5);
    expect(parent.getObjectByName("approach-walk")).toBe(line);
    expect(line.geometry).toBe(geometry);
    expect(geometry.instanceCount).toBe(2);
    expect([end().getX(0), end().getZ(0)]).toEqual([10, 0]);
    expect(end().getZ(1)).toBeCloseTo(5, 6);
    expect(marks.stats().walkDrawn).toBe(3);
    marks.drawWalk(1);
    expect(line.geometry).toBe(geometry);
    expect(geometry.instanceCount).toBe(3);
    expect([end().getX(1), end().getZ(1)]).toEqual([10, 10]);
    expect([end().getX(2), end().getZ(2)]).toEqual([0, 10]);
    expect(marks.stats().walkDrawn).toBe(4);
    marks.drawWalk(0);
    expect(line.visible).toBe(false);
    expect(marks.stats().walkDrawn).toBe(0);
    marks.dispose();
  });
});
