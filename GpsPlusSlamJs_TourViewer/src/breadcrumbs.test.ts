import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Group } from "three";

import {
  BREADCRUMB_COUNT,
  BREADCRUMB_SPACING_M,
  breadcrumbPoints,
  createBreadcrumbTrail,
  EYE_HEIGHT_M,
} from "./breadcrumbs";

/**
 * Why these tests matter: the dots must lead TOWARDS the station, lie on
 * the ground, never run past the spot where the station is found (the
 * station itself is the guide there), and must not be laid again on every
 * frame - a phone redrawing geometry 60 times a second for a guide that
 * barely moves is battery spent for nothing.
 */

describe("breadcrumbPoints", () => {
  it("lays the dots on the ground, one spacing apart, towards the station", () => {
    const points = breadcrumbPoints({
      from: [0, 401.5, 0],
      to: [100, 401, 0],
      stopM: 5,
    });
    expect(points).toHaveLength(BREADCRUMB_COUNT);
    points.forEach(([n, u, e], i) => {
      expect(n).toBeCloseTo((i + 1) * BREADCRUMB_SPACING_M);
      expect(u).toBeCloseTo(401.5 - EYE_HEIGHT_M);
      expect(e).toBeCloseTo(0);
    });
  });

  it("stops short of the found radius, and lays nothing inside it", () => {
    expect(
      breadcrumbPoints({ from: [0, 0, 0], to: [0, 0, 15], stopM: 5 }),
    ).toHaveLength(2);
    expect(
      breadcrumbPoints({ from: [0, 0, 0], to: [0, 0, 4], stopM: 5 }),
    ).toEqual([]);
    expect(
      breadcrumbPoints({ from: [0, 0, 0], to: [0, 0, 0], stopM: 5 }),
    ).toEqual([]);
  });

  it("every dot is on the way and outside the found radius (property)", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: -500, max: 500, noNaN: true }),
        fc.double({ min: 1.5, max: 50, noNaN: true }),
        (n, e, stopM) => {
          const d = Math.hypot(n, e);
          for (const [pn, , pe] of breadcrumbPoints({
            from: [0, 1.5, 0],
            to: [n, 0, e],
            stopM,
          })) {
            expect(Math.hypot(n - pn, e - pe)).toBeGreaterThanOrEqual(
              stopM - 1e-9,
            );
            expect(Math.hypot(pn, pe)).toBeLessThanOrEqual(d + 1e-9);
            // On the line towards the station.
            expect(Math.abs(pn * e - pe * n)).toBeLessThan(
              1e-6 * Math.max(1, d * d),
            );
          }
        },
      ),
    );
  });
});

describe("createBreadcrumbTrail", () => {
  it("lays the trail once, again only after a metre's walk or a new station, and clears it", () => {
    const scene = new Group();
    const trail = createBreadcrumbTrail({ getScene: () => scene });
    const target = { id: "well", to: [50, 400, 0] as const, stopM: 5 };
    trail.update([0, 401.5, 0], target);
    const first = scene.children[0];
    expect(first?.name).toBe("station-breadcrumbs");
    expect(first?.children).toHaveLength(BREADCRUMB_COUNT);
    trail.update([0.5, 401.5, 0], target);
    expect(scene.children[0]).toBe(first);
    trail.update([2, 401.5, 0], target);
    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).not.toBe(first);
    const second = scene.children[0];
    trail.update([2, 401.5, 0], { ...target, id: "tower" });
    expect(scene.children[0]).not.toBe(second);
    trail.update(null, target);
    expect(scene.children).toHaveLength(0);
    trail.update([0, 0, 0], null);
    expect(scene.children).toHaveLength(0);
  });
});
