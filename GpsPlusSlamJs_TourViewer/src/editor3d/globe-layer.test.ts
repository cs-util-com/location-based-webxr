/**
 * Why these tests matter: the globe moves its world frame under a camera
 * flown far away (every 20 km of drift below 150 km). The tour hangs under
 * the globe's Earth-centred group through one group of its own, the tour's
 * frame (x east, y up, z south at the tour's centre) in ECEF; the editor
 * places every station in that frame. A tour placed in world coordinates
 * instead would move by the whole drift at each recentre and still look
 * plausible near the camera. These pin the path production takes: a point
 * of the tour's frame lands, in the world, on the globe's frame times its
 * ECEF point (written out by hand from the textbook WGS84, not from the
 * library the layer is built on), before and after the frame moves.
 */
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { GLOBE_LAYER_NAME, createGlobeLayer } from "./globe-layer.js";
import {
  earthAt,
  ecefOfTourPoint,
  recentre,
} from "../test-support/tour-frame-points.js";
import { WGS84_TEXTBOOK, geodeticOf } from "../test-support/wgs84-textbook.js";

const MUNICH = { lat: 48.1374, lng: 11.5755 };

describe("createGlobeLayer", () => {
  it("hangs one named group under the globe's group and takes it out again", () => {
    const earth = earthAt(MUNICH);
    const layer = createGlobeLayer(earth);
    expect(layer.root.parent).toBe(earth);
    expect(layer.root.name).toBe(GLOBE_LAYER_NAME);
    layer.dispose();
    expect(layer.root.parent).toBeNull();
  });

  // Why: the stations are placed in the tour's frame; that frame must sit
  // at the tour's centre in ECEF, so a station's world point is the
  // globe's frame times its ECEF point.
  it("mounts the tour's frame at the tour's centre in ECEF", () => {
    const earth = earthAt(MUNICH);
    const layer = createGlobeLayer(earth);
    const tour = layer.mountTour(WGS84_TEXTBOOK, MUNICH);
    expect(tour.frame.parent).toBe(layer.root);
    expect(tour.frame.matrixAutoUpdate).toBe(false);
    const station = new THREE.Vector3(12, 515, -40);
    const world = station.clone().applyMatrix4(tour.frame.matrixWorld);
    const expected = ecefOfTourPoint(MUNICH, station).applyMatrix4(
      earth.matrixWorld,
    );
    expect(world.distanceTo(expected)).toBeLessThan(1e-6);
    // The matrix the stations layer is given: ECEF to the tour's frame.
    const back = ecefOfTourPoint(MUNICH, station).applyMatrix4(
      tour.tourFromEcef,
    );
    expect(back.distanceTo(station)).toBeLessThan(1e-6);
  });

  // Why: the point of the layer - a recentre rewrites only the globe's
  // frame; the tour's frame matrix is not touched and its points follow
  // the new frame, so a station stays at its place on the Earth.
  it("keeps the tour at its place across a frame recentre", () => {
    const earth = earthAt(MUNICH);
    const layer = createGlobeLayer(earth);
    const tour = layer.mountTour(WGS84_TEXTBOOK, MUNICH);
    const own = tour.frame.matrix.clone();
    recentre(earth, { lat: 47.3, lng: 11.4 });
    expect(tour.frame.matrix.equals(own)).toBe(true);
    const station = new THREE.Vector3(-30, 520, 25);
    const world = station.clone().applyMatrix4(tour.frame.matrixWorld);
    const expected = ecefOfTourPoint(MUNICH, station).applyMatrix4(
      earth.matrixWorld,
    );
    expect(world.distanceTo(expected)).toBeLessThan(1e-6);
    // Read back by the closed-form inversion: the point straight up the
    // tour frame's y axis is the centre at that height, so the hand-written
    // frame is the tour's place on the Earth, not merely agreed with.
    const above = new THREE.Vector3(0, 520, 0)
      .applyMatrix4(tour.frame.matrixWorld)
      .applyMatrix4(earth.matrixWorld.clone().invert());
    const geo = geodeticOf(above);
    expect(geo.latDeg).toBeCloseTo(MUNICH.lat, 9);
    expect(geo.lonDeg).toBeCloseTo(MUNICH.lng, 9);
    expect(geo.heightM).toBeCloseTo(520, 6);
  });

  it("refuses a tour centre off the Earth", () => {
    const layer = createGlobeLayer(earthAt(MUNICH));
    for (const bad of [
      { lat: 91, lng: 0 },
      { lat: Number.NaN, lng: 0 },
      { lat: 0, lng: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => layer.mountTour(WGS84_TEXTBOOK, bad)).toThrow(RangeError);
    }
    expect(layer.root.children).toEqual([]);
  });
});
