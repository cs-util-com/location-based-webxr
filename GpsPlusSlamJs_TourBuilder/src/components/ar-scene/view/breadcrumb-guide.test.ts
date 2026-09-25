/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { Group, PerspectiveCamera, Vector3 } from "three";

import type { TourCoord } from "../../../store/types.js";
import type { OrbAnchor } from "./breadcrumb-orbs.js";
import { createBreadcrumbGuide } from "./breadcrumb-guide.js";

// jsdom ships no real 2D canvas backend; the HUD's distance label needs one.
// Same stub three-scene-adapter.test.ts uses, left un-restored for the same
// reason (its fallback wiring keeps retrying getContext past this test's
// lifetime).
const fake2dContext = {
  font: "",
  measureText: () => ({ width: 0 }),
  fillRect: () => undefined,
  clearRect: () => undefined,
  fillText: () => undefined,
  save: () => undefined,
  restore: () => undefined,
  beginPath: () => undefined,
  closePath: () => undefined,
  fill: () => undefined,
  arc: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  roundRect: () => undefined,
  translate: () => undefined,
  scale: () => undefined,
};
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
  fake2dContext as unknown as CanvasRenderingContext2D,
);

/** Identity anchor: reports its coordinate as the world position directly
 *  (lat -> x, lon -> z), same convention `fake-scene-adapter.ts` uses. */
function identityAnchorFactory() {
  const calls: string[] = [];
  return {
    calls,
    factory: (
      object3D: { position: { set(x: number, y: number, z: number): void } },
      coord: TourCoord,
    ) => {
      calls.push(`create:${coord.lat},${coord.lon}`);
      object3D.position.set(coord.lat, 0, coord.lon);
      const anchor: OrbAnchor = {
        setGpsPoint: (c) => {
          calls.push(`setGpsPoint:${c.lat},${c.lon}`);
          object3D.position.set(c.lat, 0, c.lon);
        },
        markMovedExternally: () => calls.push("markMovedExternally"),
        dispose: () => calls.push("dispose"),
      };
      return anchor;
    },
  };
}

function findIndicator(camera: PerspectiveCamera) {
  return camera.children.find(
    (c) =>
      c.visible &&
      (c.name === "wayfinding-arrow" || c.name === "wayfinding-circle"),
  );
}

describe("createBreadcrumbGuide", () => {
  it("shows no indicator before any target is set", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeUndefined();
    guide.dispose();
  });

  it("shows an indicator once a target is set, straight ahead of the camera", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    // Camera at the origin looking down -Z; a target at (0, 0, -5) is 5 m
    // directly ahead — on-screen, so it renders as the circle indicator.
    guide.setTarget({
      kind: "breadcrumb",
      index: 3,
      coord: { lat: 0, lon: -5 },
    });
    guide.update(1 / 60);
    const indicator = findIndicator(camera);
    expect(indicator?.name).toBe("wayfinding-circle");
    guide.dispose();
  });

  it("re-points the SAME anchor when the target coordinate changes, rather than creating a new one", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory, calls } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({
      kind: "breadcrumb",
      index: 0,
      coord: { lat: 0, lon: -5 },
    });
    guide.setTarget({
      kind: "breadcrumb",
      index: 1,
      coord: { lat: 0, lon: -8 },
    });
    expect(calls.filter((c) => c.startsWith("create:"))).toHaveLength(1);
    expect(calls).toContain("setGpsPoint:0,-8");
    expect(calls).toContain("markMovedExternally");
    guide.dispose();
  });

  it("hides the indicator again when the target is cleared to null", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({
      kind: "breadcrumb",
      index: 0,
      coord: { lat: 0, lon: -5 },
    });
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeDefined();
    guide.setTarget(null);
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeUndefined();
    guide.dispose();
  });

  it("suppresses the indicator while an ACTIVE waypoint is roughly in front of the camera", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({
      kind: "breadcrumb",
      index: 0,
      coord: { lat: 0, lon: -5 },
    });
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeDefined();

    // Default camera looks down -Z; a waypoint straight ahead is exactly
    // where its picture/model would be up close and visible.
    guide.setActiveWaypointPositions([new Vector3(0, 0, -10)]);
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeUndefined();

    guide.dispose();
  });

  it("does not suppress the indicator when the ACTIVE waypoint is behind the camera", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({
      kind: "breadcrumb",
      index: 0,
      coord: { lat: 0, lon: -5 },
    });

    // Behind the camera — "still open, just behind me": walking past an
    // open waypoint and turning away must bring the guide back even
    // though that waypoint's zone hasn't exited ACTIVE yet.
    guide.setActiveWaypointPositions([new Vector3(0, 0, 10)]);
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeDefined();

    guide.dispose();
  });

  it("shows the indicator again once the active waypoint list is cleared", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({
      kind: "breadcrumb",
      index: 0,
      coord: { lat: 0, lon: -5 },
    });
    guide.setActiveWaypointPositions([new Vector3(0, 0, -10)]);
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeUndefined();

    guide.setActiveWaypointPositions([]);
    guide.update(1 / 60);
    expect(findIndicator(camera)).toBeDefined();

    guide.dispose();
  });

  it("disposes its anchor and detaches its indicator on dispose", () => {
    const parent = new Group();
    const camera = new PerspectiveCamera();
    const { factory, calls } = identityAnchorFactory();
    const guide = createBreadcrumbGuide({
      parent,
      camera,
      anchorFactory: factory,
      distanceMinM: 0,
      distanceMaxM: 50,
    });
    guide.setTarget({
      kind: "breadcrumb",
      index: 0,
      coord: { lat: 0, lon: -5 },
    });
    guide.update(1 / 60);
    guide.dispose();
    expect(calls).toContain("dispose");
    expect(findIndicator(camera)).toBeUndefined();
  });
});
