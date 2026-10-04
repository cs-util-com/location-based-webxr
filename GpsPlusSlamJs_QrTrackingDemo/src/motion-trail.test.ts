/**
 * The demo's motion trail (plan §26): the code's last ~2 s of positions.
 *
 * Why these tests matter: the owner asked for a short trail to SEE a
 * hand-held code's path next to its motion mode. It must forget old points
 * (a long trail would read as drift), never draw through a restart (the old
 * points live in another frame) and ignore a bad position rather than
 * drawing a line to NaN.
 */
import { describe, expect, it } from "vitest";
import { createMotionTrail } from "./motion-trail.js";

describe("createMotionTrail", () => {
  it("keeps only the last spanMs of positions", () => {
    const trail = createMotionTrail({ spanMs: 2000 });
    for (let t = 0; t <= 3000; t += 125) trail.add(t, [t / 1000, 0, 0]);
    const pts = trail.points();
    // 1000..3000 ms inclusive.
    expect(pts).toHaveLength(17);
    expect(pts[0]).toEqual([1, 0, 0]);
    expect(pts[pts.length - 1]).toEqual([3, 0, 0]);
  });

  it("defaults to a 2 s span", () => {
    const trail = createMotionTrail();
    trail.add(0, [0, 0, 0]);
    trail.add(2000, [1, 0, 0]);
    trail.add(2001, [2, 0, 0]);
    expect(trail.points()).toEqual([
      [1, 0, 0],
      [2, 0, 0],
    ]);
  });

  it("ignores a non-finite position or time", () => {
    const trail = createMotionTrail();
    trail.add(0, [0, 0, 0]);
    trail.add(125, [Number.NaN, 0, 0]);
    trail.add(Number.NaN, [1, 1, 1]);
    expect(trail.points()).toEqual([[0, 0, 0]]);
  });

  // A clock going backwards is a new run (a replay seek, a store swap):
  // joining it to the old points would draw a line through time.
  it("starts afresh when time goes backwards", () => {
    const trail = createMotionTrail();
    trail.add(1000, [0, 0, 0]);
    trail.add(1125, [1, 0, 0]);
    trail.add(500, [5, 0, 0]);
    expect(trail.points()).toEqual([[5, 0, 0]]);
  });

  it("forgets everything on clear", () => {
    const trail = createMotionTrail();
    trail.add(0, [0, 0, 0]);
    trail.clear();
    expect(trail.points()).toEqual([]);
  });

  it("hands out copies, not its own storage", () => {
    const trail = createMotionTrail();
    const p: [number, number, number] = [0, 0, 0];
    trail.add(0, p);
    p[0] = 9;
    const out = trail.points();
    out[0]![1] = 9;
    expect(trail.points()).toEqual([[0, 0, 0]]);
  });
});
