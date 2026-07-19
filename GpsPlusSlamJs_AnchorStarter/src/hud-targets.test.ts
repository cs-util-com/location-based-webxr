/**
 * Unit tests for the wayfinding HUD target feed.
 *
 * Why these tests matter: the HUD polls this function every frame. It must
 * (a) yield the marker's WORLD position (the marker is a child of the
 * GPS-aligned arWorldGroup, so local == world would point the HUD wrong once
 * an alignment is applied) and (b) yield NO targets while the marker is
 * hidden — the `?show=` cache-hit marker sits invisible at the AR origin
 * until the first alignment, and the HUD must not guide the user there.
 */
import { describe, it, expect } from "vitest";
import { Group, Object3D, Vector3 } from "three";

import { hudTargetsFromMarker } from "./hud-targets.js";

describe("hudTargetsFromMarker", () => {
  it("returns no targets when there is no marker", () => {
    expect(hudTargetsFromMarker(null)).toEqual([]);
  });

  it("returns no targets while the marker is hidden (pre-alignment cache-hit)", () => {
    const marker = new Object3D();
    marker.visible = false;
    expect(hudTargetsFromMarker(marker)).toEqual([]);
  });

  it("returns the marker WORLD position (parent transforms applied)", () => {
    const parent = new Group();
    parent.position.set(10, 0, -5);
    const marker = new Object3D();
    marker.position.set(1, 2, 3);
    parent.add(marker);
    parent.updateMatrixWorld(true);

    const targets = hudTargetsFromMarker(marker);
    expect(targets.length).toBe(1);
    expect(targets[0]!.x).toBeCloseTo(11, 6);
    expect(targets[0]!.y).toBeCloseTo(2, 6);
    expect(targets[0]!.z).toBeCloseTo(-2, 6);
  });

  it("allocates a fresh Vector3 per call (no shared mutable state)", () => {
    const marker = new Object3D();
    marker.updateMatrixWorld(true);
    const first = hudTargetsFromMarker(marker)[0]!;
    const second = hudTargetsFromMarker(marker)[0]!;
    expect(first).not.toBe(second);
    expect(first).toBeInstanceOf(Vector3);
  });
});
