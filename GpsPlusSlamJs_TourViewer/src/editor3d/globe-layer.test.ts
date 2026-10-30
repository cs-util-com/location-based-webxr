/**
 * Why these tests matter: the globe moves its world frame under a camera
 * flown far away (every 20 km of drift below 150 km). An editor object
 * placed in world coordinates would move by the whole drift at each
 * recentre and still look plausible near the camera. The layer puts its
 * objects in ECEF under the globe's frame, so a recentre must change
 * nothing in the layer and leave every object at its geo pose; these pin
 * that, and that a refused place leaves the object untouched.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { worldFromEcefAt } from "gps-plus-slam-globe/editor";

import { GLOBE_LAYER_NAME, createGlobeLayer } from "./globe-layer.js";
import {
  WGS84_TEXTBOOK,
  ecefOf,
  geodeticOf,
} from "../test-support/wgs84-textbook.js";

const BERN = { lat: 46.948, lng: 7.4474 };
const THUN = { lat: 46.758, lng: 7.628 };
const DEG = Math.PI / 180;

/** The globe's Earth-centred group, its matrix the frame at `target`. */
function earthAt(target: { lat: number; lng: number }): THREE.Group {
  const earth = new THREE.Group();
  earth.matrixAutoUpdate = false;
  worldFromEcefAt(WGS84_TEXTBOOK, target, earth.matrix);
  earth.updateMatrixWorld(true);
  return earth;
}

function recentre(earth: THREE.Group, target: { lat: number; lng: number }) {
  worldFromEcefAt(WGS84_TEXTBOOK, target, earth.matrix);
  earth.updateMatrixWorld(true);
}

function worldPointOf(object: THREE.Object3D, local: THREE.Vector3) {
  return local.clone().applyMatrix4(object.matrixWorld);
}

describe("createGlobeLayer", () => {
  it("hangs one named group under the globe's group and takes it out again", () => {
    const earth = earthAt(BERN);
    const layer = createGlobeLayer(earth);
    expect(layer.root.parent).toBe(earth);
    expect(layer.root.name).toBe(GLOBE_LAYER_NAME);
    layer.dispose();
    expect(layer.root.parent).toBeNull();
  });

  // Why: the object's file height on its up axis lands on the ellipsoid's
  // point of its place at height alt - N, in the world through the frame.
  it("places an object at its geo pose through the globe's frame", () => {
    const earth = earthAt(BERN);
    const layer = createGlobeLayer(earth);
    const bench = new THREE.Object3D();
    const place = { lat: 46.95, lon: 7.45 };
    layer.place(bench, {
      ellipsoid: WGS84_TEXTBOOK,
      place,
      undulationM: 49.5,
    });
    earth.updateMatrixWorld(true);
    const world = worldPointOf(bench, new THREE.Vector3(0, 560, 0));
    const expected = ecefOf(
      place.lat * DEG,
      place.lon * DEG,
      560 - 49.5,
      new THREE.Vector3(),
    ).applyMatrix4(earth.matrix);
    expect(world.distanceTo(expected)).toBeLessThan(1e-6);
    expect(bench.parent).toBe(layer.root);
    expect(bench.matrixAutoUpdate).toBe(false);
  });

  // Why: the point of the layer - a recentre rewrites only the globe's
  // frame; the object's own matrix is not touched and its ECEF point (its
  // geo pose) is the same, while its world point follows the new frame.
  it("keeps every object at its geo pose across a frame recentre", () => {
    const earth = earthAt(BERN);
    const layer = createGlobeLayer(earth);
    const fountain = new THREE.Object3D();
    const place = { lat: 46.76, lon: 7.63 };
    layer.place(fountain, {
      ellipsoid: WGS84_TEXTBOOK,
      place,
      undulationM: 50,
    });
    earth.updateMatrixWorld(true);
    const own = fountain.matrix.clone();
    const foot = new THREE.Vector3(0, 600, 0);
    const ecefBefore = worldPointOf(fountain, foot).applyMatrix4(
      earth.matrix.clone().invert(),
    );

    recentre(earth, THUN);

    expect(fountain.matrix.equals(own)).toBe(true);
    const world = worldPointOf(fountain, foot);
    const ecefAfter = world.clone().applyMatrix4(earth.matrix.clone().invert());
    expect(ecefAfter.distanceTo(ecefBefore)).toBeLessThan(1e-6);
    const geo = geodeticOf(ecefAfter);
    expect(geo.latDeg).toBeCloseTo(place.lat, 9);
    expect(geo.lonDeg).toBeCloseTo(place.lon, 9);
    expect(geo.heightM).toBeCloseTo(550, 6);
    // Near the new frame's origin now: the frame did its job for the camera.
    expect(world.length()).toBeLessThan(2_000);
  });

  it("re-places an object already in the layer without adding it twice", () => {
    const earth = earthAt(BERN);
    const layer = createGlobeLayer(earth);
    const gate = new THREE.Object3D();
    const at = { ellipsoid: WGS84_TEXTBOOK, undulationM: 0 };
    layer.place(gate, { ...at, place: { lat: 46.9, lon: 7.4 } });
    layer.place(gate, { ...at, place: { lat: 46.8, lon: 7.5 } });
    expect(layer.root.children).toEqual([gate]);
  });

  it("refuses a bad place and leaves the object as it was", () => {
    const earth = earthAt(BERN);
    const layer = createGlobeLayer(earth);
    const gate = new THREE.Object3D();
    const before = gate.matrix.clone();
    for (const bad of [
      { place: { lat: 91, lon: 0 }, undulationM: 0 },
      { place: { lat: NaN, lon: 0 }, undulationM: 0 },
      { place: { lat: 46, lon: 7 }, undulationM: Infinity },
    ]) {
      expect(() =>
        layer.place(gate, { ellipsoid: WGS84_TEXTBOOK, ...bad }),
      ).toThrow(RangeError);
    }
    expect(gate.matrix.equals(before)).toBe(true);
    expect(gate.parent).toBeNull();
  });
});
