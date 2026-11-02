/**
 * Why this test matters: the meteor's landing angle became an option of the
 * shared flight (`pressPin`'s `meteorLandDeg`, `meteorLinkStart`'s
 * `landDeg`) so a page can enter shallow and land steep. The globe lab
 * never passes it, and its flights must not change: the first block pins
 * the lab's paths as the code drew them BEFORE the option existed (the
 * numbers were recorded from the unchanged code), the second that omitting
 * the option equals passing its default.
 */
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";

import { orbitPose } from "./globe-camera.js";
import { obliqueCamera } from "./globe-dive.js";
import { flightCamera } from "./flight-path.js";
import { meteorLinkStart, pressPin } from "./pin-flight.js";

const KM = 1_000;
const BERN = { lat: 46.948, lng: 7.4474 };
const bern = orbitPose(WGS84_ELLIPSOID, BERN);
const south = orbitPose(WGS84_ELLIPSOID, { lat: 16.948, lng: 7.4474 });

/** The camera over `place`, looking straight down, as the intro leaves it. */
function cameraOver(place: { lat: number; lng: number }, altitudeM: number) {
  const pose = orbitPose(WGS84_ELLIPSOID, place);
  const cam = obliqueCamera(WGS84_ELLIPSOID, pose, altitudeM, 90);
  return { pose, distanceM: cam.position.length(), quaternion: cam.quaternion };
}

const forward = (q: THREE.Quaternion) =>
  new THREE.Vector3(0, 0, -1).applyQuaternion(q);

/** Nine samples of a press's path: altitude (m) and view, rounded. */
function samples(pin: ReturnType<typeof pressPin>) {
  const path = pin.flight?.path;
  if (!path) throw new Error("no path");
  const out: number[][] = [];
  for (let i = 0; i <= 8; i++) {
    const cam = flightCamera(path, (path.durationMs * i) / 8);
    const f = forward(cam.quaternion);
    out.push([
      Math.round(cam.position.length()),
      Math.round(f.x * 1e5) / 1e5,
      Math.round(f.y * 1e5) / 1e5,
      Math.round(f.z * 1e5) / 1e5,
    ]);
  }
  return { meteorDeg: Math.round(path.meteorDeg * 1e4) / 1e4, out };
}

/** The lab's three kinds of press: a meteor link, the vertical approach, a meteor fitted over its own place. */
const presses = {
  link45: () =>
    pressPin(
      WGS84_ELLIPSOID,
      0,
      meteorLinkStart(
        WGS84_ELLIPSOID,
        bern,
        south.direction,
        65_000 * KM,
        2 * KM,
        45,
      ),
      { target: bern, landingM: 2 * KM, progress: 1, meteorDeg: 45 },
    ),
  r1: () =>
    pressPin(WGS84_ELLIPSOID, 0, cameraOver({ lat: 30, lng: 0 }, 8_000 * KM), {
      target: bern,
      landingM: 2 * KM,
      progress: 1,
    }),
  fitted30: () =>
    pressPin(WGS84_ELLIPSOID, 0, cameraOver(BERN, 8_000 * KM), {
      target: bern,
      landingM: 2 * KM,
      progress: 1,
      meteorDeg: 30,
    }),
};

describe("the lab's flights are unchanged by the landing-angle option", () => {
  it("a meteor link at 45 degrees", () => {
    expect(samples(presses.link45())).toMatchInlineSnapshot(`
      {
        "meteorDeg": 45,
        "out": [
          [
            71366763,
            -0.99111,
            -0.12956,
            -0.03026,
          ],
          [
            22205401,
            -0.99111,
            -0.12956,
            -0.03029,
          ],
          [
            9110087,
            -0.99111,
            -0.12956,
            -0.03032,
          ],
          [
            6958484,
            -0.99111,
            -0.12956,
            -0.03033,
          ],
          [
            6519332,
            -0.99111,
            -0.12956,
            -0.03033,
          ],
          [
            6408591,
            -0.99111,
            -0.12956,
            -0.03033,
          ],
          [
            6378436,
            -0.99111,
            -0.12956,
            -0.03033,
          ],
          [
            6370066,
            -0.99111,
            -0.12956,
            -0.03033,
          ],
          [
            6368763,
            -0.99111,
            -0.12956,
            -0.03033,
          ],
        ],
      }
    `);
  });
  it("the vertical approach (beta 90)", () => {
    expect(samples(presses.r1())).toMatchInlineSnapshot(`
      {
        "meteorDeg": 90,
        "out": [
          [
            14372824,
            -0.86747,
            0,
            -0.49748,
          ],
          [
            9319581,
            -0.77634,
            -0.04802,
            -0.62848,
          ],
          [
            7228546,
            -0.70717,
            -0.07788,
            -0.70274,
          ],
          [
            6618893,
            -0.68339,
            -0.08724,
            -0.72482,
          ],
          [
            6436085,
            -0.69512,
            -0.08268,
            -0.71413,
          ],
          [
            6386010,
            -0.86299,
            -0.0027,
            -0.50521,
          ],
          [
            6372856,
            -0.97316,
            0.09084,
            -0.21146,
          ],
          [
            6369272,
            -0.98896,
            0.12996,
            -0.07125,
          ],
          [
            6368763,
            -0.9892,
            0.1319,
            -0.06398,
          ],
        ],
      }
    `);
  });
  it("a meteor at 30 fitted over its own place", () => {
    expect(samples(presses.fitted30())).toMatchInlineSnapshot(`
      {
        "meteorDeg": 90,
        "out": [
          [
            14366763,
            -0.67933,
            -0.0888,
            -0.72844,
          ],
          [
            9106713,
            -0.681,
            -0.08902,
            -0.72685,
          ],
          [
            7068597,
            -0.68201,
            -0.08915,
            -0.72589,
          ],
          [
            6546585,
            -0.68226,
            -0.08918,
            -0.72565,
          ],
          [
            6412904,
            -0.75503,
            -0.0987,
            -0.64822,
          ],
          [
            6379606,
            -0.96056,
            -0.12556,
            -0.24812,
          ],
          [
            6371558,
            -0.9867,
            -0.12898,
            0.0989,
          ],
          [
            6369161,
            -0.96651,
            -0.12634,
            0.22336,
          ],
          [
            6368763,
            -0.96507,
            -0.12615,
            0.22963,
          ],
        ],
      }
    `);
  });
});

describe("omitting the landing angle equals passing its default", () => {
  it("a meteor lands at its own beta", () => {
    const start = meteorLinkStart(
      WGS84_ELLIPSOID,
      bern,
      south.direction,
      65_000 * KM,
      2 * KM,
      45,
      0,
      45,
    );
    const pin = pressPin(WGS84_ELLIPSOID, 0, start, {
      target: bern,
      landingM: 2 * KM,
      progress: 1,
      meteorDeg: 45,
      meteorLandDeg: 45,
    });
    expect(samples(pin)).toEqual(samples(presses.link45()));
  });
  it("a fitted meteor lands at the asked beta", () => {
    const pin = pressPin(WGS84_ELLIPSOID, 0, cameraOver(BERN, 8_000 * KM), {
      target: bern,
      landingM: 2 * KM,
      progress: 1,
      meteorDeg: 30,
      meteorLandDeg: 30,
    });
    expect(samples(pin)).toEqual(samples(presses.fitted30()));
  });
  it("rejects a landing angle outside (0, 90]", () => {
    for (const bad of [0, -5, 91, Number.NaN]) {
      expect(() =>
        pressPin(WGS84_ELLIPSOID, 0, cameraOver(BERN, 8_000 * KM), {
          target: bern,
          landingM: 2 * KM,
          progress: 1,
          meteorDeg: 30,
          meteorLandDeg: bad,
        }),
      ).toThrow(RangeError);
    }
  });
});
