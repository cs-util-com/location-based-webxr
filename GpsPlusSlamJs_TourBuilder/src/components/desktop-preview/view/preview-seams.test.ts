import { describe, expect, it } from "vitest";
import { Object3D, PerspectiveCamera } from "three";

import { createPreviewFrame } from "../core/preview-frame.js";
import { createPreviewSeams } from "./preview-seams.js";

const ORIGIN = { lat: 48.137, lon: 11.575 };
const NORTH = { lat: ORIGIN.lat + 0.001, lon: ORIGIN.lon };

function seams(camera = new PerspectiveCamera()) {
  return {
    camera,
    instance: createPreviewSeams({
      frame: createPreviewFrame(ORIGIN),
      getCamera: () => camera,
    }),
  };
}

describe("preview seams", () => {
  it("places a waypoint at its coordinate and calls it anchored at once", () => {
    const { instance } = seams();
    const object = new Object3D();

    const anchor = instance.createAnchor(object, NORTH);

    // No alignment to converge on a desktop — content is placed on frame one.
    expect(anchor.isFullyAnchored).toBe(true);
    expect(object.position.x).toBeGreaterThan(100);
    expect(object.position.z).toBeCloseTo(0, 1);
  });

  it("re-points a recycled anchor at a new coordinate", () => {
    const { instance } = seams();
    const object = new Object3D();
    const anchor = instance.createAnchor(object, ORIGIN);

    anchor.setGpsPoint(NORTH);

    expect(object.position.x).toBeGreaterThan(100);
  });

  it("reads the visitor's position off the preview camera", () => {
    const camera = new PerspectiveCamera();
    camera.position.set(3, 1.6, -4);
    const { instance } = seams(camera);

    expect(instance.getUserWorldPos()).toMatchObject({ x: 3, z: -4 });
  });

  it("agrees with the trail conversion, so orbs land on the waypoints", () => {
    const { instance } = seams();
    const object = new Object3D();
    instance.createAnchor(object, NORTH);

    expect(instance.toWorld(NORTH)!.x).toBeCloseTo(object.position.x, 6);
  });
});
