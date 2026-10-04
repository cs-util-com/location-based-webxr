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
  createShadowPlane,
  createShadowPole,
  markArShadowCaster,
  shadowCheckEnabled,
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

describe("shadowCheckEnabled", () => {
  // WHY: the compile check is a diagnostic; it must stay off unless asked
  // for, and it must not be switched on by the AR prototype's own switch.
  it("is on only for its own switch, with the same values", () => {
    expect(shadowCheckEnabled("?shadowCheck=1")).toBe(true);
    expect(shadowCheckEnabled("?shadowCheck=on")).toBe(true);
    expect(shadowCheckEnabled("?shadowCheck=0")).toBe(false);
    expect(shadowCheckEnabled("")).toBe(false);
    expect(shadowCheckEnabled("?sunShadow=1")).toBe(false);
    expect(sunShadowEnabled("?shadowCheck=1")).toBe(false);
  });
});
