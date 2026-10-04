/**
 * The trail's three.js view (plan §26).
 *
 * Why these tests matter: the trail is drawn in the same raw-WebXR frame as
 * the QR axis, so it must ride the same WEBXR_TO_NUE basis or it would sit
 * East/North-swapped beside the code on a real device (the recurring
 * scene-frame bug the debug view documents). It must also stay hidden until
 * there is a line to draw, take the mode's colour, and free its GPU objects.
 */
import { describe, expect, it } from "vitest";
import { Group, Line, Matrix4 } from "three";
import { WEBXR_TO_NUE } from "gps-plus-slam-app-framework/ar/webxr-nue-basis";
import { createMotionTrailView } from "./motion-trail-view.js";

function lineOf(parent: Group): Line {
  let line: Line | null = null;
  parent.traverse((o) => {
    if (o instanceof Line) line = o;
  });
  if (!line) throw new Error("no line");
  return line;
}

describe("createMotionTrailView", () => {
  it("rides the WEBXR_TO_NUE basis under the parent", () => {
    const parent = new Group();
    createMotionTrailView(parent);
    const line = lineOf(parent);
    const basis = line.parent!;
    expect(basis.parent).toBe(parent);
    expect(basis.matrixAutoUpdate).toBe(false);
    expect(basis.matrix.equals(new Matrix4().copy(WEBXR_TO_NUE))).toBe(true);
  });

  it("stays hidden until there are two points", () => {
    const parent = new Group();
    const view = createMotionTrailView(parent);
    const line = lineOf(parent);
    expect(line.visible).toBe(false);
    view.update([[0, 0, 0]], "#ffaa00");
    expect(line.visible).toBe(false);
    view.update(
      [
        [0, 0, 0],
        [1, 2, 3],
      ],
      "#ffaa00",
    );
    expect(line.visible).toBe(true);
    const pos = line.geometry.getAttribute("position");
    expect(line.geometry.drawRange.count).toBe(2);
    expect([pos.getX(1), pos.getY(1), pos.getZ(1)]).toEqual([1, 2, 3]);
  });

  // It updates on every HUD render: one preallocated buffer, rewritten in
  // place, never a new GPU buffer per render (milestone review 2026-09-25).
  it("rewrites one buffer in place and keeps the newest points past its capacity", () => {
    const parent = new Group();
    const view = createMotionTrailView(parent);
    const line = lineOf(parent);
    const pts = (n: number) =>
      Array.from(
        { length: n },
        (_, i) => [i, 0, 0] as [number, number, number],
      );
    view.update(pts(3), null);
    const attr = line.geometry.getAttribute("position");
    view.update(pts(200), null);
    expect(line.geometry.getAttribute("position")).toBe(attr);
    const n = line.geometry.drawRange.count;
    expect(n).toBeLessThan(200);
    expect(attr.getX(n - 1)).toBe(199);
  });

  it("takes the mode's colour, and a neutral one for none", () => {
    const parent = new Group();
    const view = createMotionTrailView(parent);
    const line = lineOf(parent);
    const pts: [number, number, number][] = [
      [0, 0, 0],
      [1, 0, 0],
    ];
    view.update(pts, "#ff0000");
    const material = line.material as unknown as {
      color: { getHexString(): string };
    };
    expect(material.color.getHexString()).toBe("ff0000");
    view.update(pts, null);
    expect(material.color.getHexString()).toBe("ffffff");
  });

  it("detaches on dispose", () => {
    const parent = new Group();
    const view = createMotionTrailView(parent);
    view.dispose();
    expect(parent.children).toHaveLength(0);
  });
});
