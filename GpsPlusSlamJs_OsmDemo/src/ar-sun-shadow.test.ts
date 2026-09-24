/**
 * Tests for OsmDemo's AR sun shadow pieces (plan 2026-09-23-2343, M3).
 *
 * Why this file matters: the prototype must be invisible unless asked for
 * (the switch), must never let the X-ray shells or trees cast (their real
 * counterparts already do), and must report the frame that renders a map,
 * which a window-mean fps hides.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  AR_SHADOW_CASTER,
  SHADOW_POLE,
  applyArShadowCasting,
  createFrameTimes,
  createShadowPlane,
  createShadowPole,
  markArShadowCaster,
  sunShadowEnabled,
} from "./ar-sun-shadow";

describe("sunShadowEnabled", () => {
  // Default OFF, unlike ?autoElevation (plan §7 item 17).
  it("is on only for 1, on or true", () => {
    for (const on of [
      "?sunShadow=1",
      "?sunShadow=on",
      "?sunShadow=TRUE",
      "?x=2&sunShadow= true ",
    ]) {
      expect(sunShadowEnabled(on)).toBe(true);
    }
    for (const off of [
      "",
      "?sunShadow",
      "?sunShadow=0",
      "?sunShadow=off",
      "?sunShadow=yes",
    ]) {
      expect(sunShadowEnabled(off)).toBe(false);
    }
  });
});

describe("applyArShadowCasting", () => {
  // The caster rule: tagged meshes only. A shell, a tree and a roof-hosted
  // pin stand in for the untagged kinds.
  it("casts tagged meshes only, and turns everything off again", () => {
    const root = new THREE.Group();
    const pin = new THREE.Mesh();
    markArShadowCaster(pin);
    const beacon = new THREE.Group().add(new THREE.Mesh());
    markArShadowCaster(beacon.children[0]!);
    const shell = new THREE.Mesh();
    const tree = new THREE.InstancedMesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
      1,
    );
    const hostPin = new THREE.Mesh();
    shell.castShadow = true; // left over from anywhere: must be cleared
    root.add(pin, beacon, shell, tree, hostPin);
    expect(applyArShadowCasting(root, true)).toBe(2);
    expect(pin.castShadow).toBe(true);
    expect(beacon.children[0]!.castShadow).toBe(true);
    expect(shell.castShadow).toBe(false);
    expect(tree.castShadow).toBe(false);
    expect(hostPin.castShadow).toBe(false);
    expect(applyArShadowCasting(root, false)).toBe(0);
    expect(pin.castShadow).toBe(false);
  });
});

describe("createShadowPole", () => {
  it("is a tagged 1.5 m pole standing on its base", () => {
    const pole = createShadowPole();
    expect(pole.userData[AR_SHADOW_CASTER]).toBe(true);
    pole.geometry.computeBoundingBox();
    const box = pole.geometry.boundingBox!;
    expect(box.min.y).toBeCloseTo(0, 9);
    expect(box.max.y).toBeCloseTo(SHADOW_POLE.heightM, 9);
  });
});

describe("createShadowPlane", () => {
  // A receiver that draws only the shadow, never casts, has no fog, and
  // sits in front of the coplanar ground layers.
  it("receives only, with the opacity, no fog and a polygon offset", () => {
    const plane = createShadowPlane(25, 0.42);
    const material = plane.material as THREE.ShadowMaterial;
    expect(material).toBeInstanceOf(THREE.ShadowMaterial);
    expect(material.opacity).toBe(0.42);
    expect(material.fog).toBe(false);
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBeLessThan(0);
    expect(plane.receiveShadow).toBe(true);
    expect(plane.castShadow).toBe(false);
    plane.geometry.computeBoundingBox();
    const box = plane.geometry.boundingBox!;
    expect(box.max.x).toBeCloseTo(25, 9);
    expect(box.max.y - box.min.y).toBeLessThan(1e-9);
  });

  it("refuses a bad size or opacity", () => {
    expect(() => createShadowPlane(0, 0.4)).toThrow(RangeError);
    expect(() => createShadowPlane(25, 1.2)).toThrow(RangeError);
    expect(() => createShadowPlane(25, Number.NaN)).toThrow(RangeError);
  });
});

describe("createFrameTimes", () => {
  // The one slow frame a window mean hides must show in p95 and max.
  it("reports nearest-rank percentiles and the max over the last frames", () => {
    const times = createFrameTimes(100);
    expect(times.summary()).toBeNull();
    for (let i = 0; i < 99; i++) times.push(16);
    times.push(80);
    expect(times.summary()).toEqual({ p50: 16, p95: 16, max: 80, count: 100 });
    for (let i = 0; i < 10; i++) times.push(40);
    const s = times.summary()!;
    expect(s.count).toBe(100);
    expect(s.p95).toBe(40);
    expect(s.max).toBe(80);
  });

  it("drops the oldest frames and ignores bad values", () => {
    const times = createFrameTimes(3);
    for (const ms of [100, 1, 2, 3, Number.NaN, -5]) times.push(ms);
    expect(times.summary()).toEqual({ p50: 2, p95: 3, max: 3, count: 3 });
    expect(() => createFrameTimes(0)).toThrow(RangeError);
  });
});
