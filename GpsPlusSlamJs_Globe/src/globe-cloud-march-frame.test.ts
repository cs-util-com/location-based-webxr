import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CLOUD_MARCH_RADIUS_KM,
  type CloudWeatherFrame,
  advanceCloudWeatherFrame,
  cloudWeatherFrameAt,
} from "./globe-cloud-march-frame.js";

type V = readonly [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: V): V => scale(a, 1 / Math.hypot(...a));
const unitAt = (latDeg: number, lonDeg: number): V => {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  return [
    Math.cos(lat) * Math.cos(lon),
    Math.cos(lat) * Math.sin(lon),
    Math.sin(lat),
  ];
};

/** The weather position of an Earth point, as the march computes it. */
function weatherOf(frame: CloudWeatherFrame, point: V): [number, number] {
  const camera = scale(frame.up, CLOUD_MARCH_RADIUS_KM + 2);
  const p = sub(point, camera);
  return [dot(p, frame.x) + frame.q[0], dot(p, frame.z) + frame.q[1]];
}

/** A step of `km` from `up`, along the tangent `heading` rad off `x`. */
function stepped(frame: CloudWeatherFrame, km: number, heading: number): V {
  const a = km / CLOUD_MARCH_RADIUS_KM;
  const along: V = [
    frame.x[0] * Math.cos(heading) + frame.z[0] * Math.sin(heading),
    frame.x[1] * Math.cos(heading) + frame.z[1] * Math.sin(heading),
    frame.x[2] * Math.cos(heading) + frame.z[2] * Math.sin(heading),
  ];
  return unit([
    frame.up[0] * Math.cos(a) + along[0] * Math.sin(a),
    frame.up[1] * Math.cos(a) + along[1] * Math.sin(a),
    frame.up[2] * Math.cos(a) + along[2] * Math.sin(a),
  ]);
}

describe("cloudWeatherFrameAt", () => {
  it("starts on east and south", () => {
    const f = cloudWeatherFrameAt(unitAt(0, 0));
    expect(f.x[1]).toBeCloseTo(1);
    expect(f.z[2]).toBeCloseTo(-1);
  });

  it("has a frame at the pole too", () => {
    const f = cloudWeatherFrameAt([0, 0, 1]);
    expect(Math.hypot(...f.x)).toBeCloseTo(1);
    expect(dot(f.x, f.z)).toBeCloseTo(0);
  });

  it("refuses a place that is no direction", () => {
    expect(() => cloudWeatherFrameAt([0, 0, 0])).toThrow(RangeError);
  });
});

describe("advanceCloudWeatherFrame", () => {
  // Why this test matters: this is what keeps a cloud in its place. Moving
  // the camera (or the wind moving the map under it) must leave the weather
  // position of a cloud at any place on the screen alone: a slip here shows
  // as the whole sky sliding, worst at high latitudes, where a frame tied
  // to east and south turns under the camera on every step east.
  it("keeps every cloud where it is as the camera moves", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -89, max: 89, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        fc.double({ min: 0, max: 6.28, noNaN: true }),
        fc.double({ min: 0.01, max: 20, noNaN: true }),
        fc.double({ min: 0, max: 6.28, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (lat, lon, heading, km, bearing, reach) => {
          const from = cloudWeatherFrameAt(unitAt(lat, lon));
          const to = advanceCloudWeatherFrame(from, stepped(from, km, heading));
          // A cloud `reach` km off, in the layer.
          const point = scale(
            stepped(from, reach, bearing),
            CLOUD_MARCH_RADIUS_KM + 2,
          );
          const a = weatherOf(from, point);
          const b = weatherOf(to, point);
          expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.03);
        },
      ),
    );
  });

  // Why this test matters: float drift over a long flight must not skew the
  // frame, and a route across the pole must not meet a singular east.
  it("stays orthonormal around the world and over the pole", () => {
    let f = cloudWeatherFrameAt(unitAt(10, 20));
    for (let i = 0; i < 40_000; i++) {
      f = advanceCloudWeatherFrame(f, stepped(f, 5, 1.3));
    }
    expect(Math.hypot(...f.x)).toBeCloseTo(1, 9);
    expect(Math.hypot(...f.z)).toBeCloseTo(1, 9);
    expect(dot(f.x, f.z)).toBeCloseTo(0, 9);
    expect(dot(f.x, f.up)).toBeCloseTo(0, 9);
    expect(f.q.every(Number.isFinite)).toBe(true);
  });

  it("does not move for a place that does not move", () => {
    const f = cloudWeatherFrameAt(unitAt(40, 158));
    expect(advanceCloudWeatherFrame(f, f.up).q).toEqual(f.q);
  });

  // Why this test matters: the view can teleport (a jump to a place). The
  // far side of the Earth has no unique great circle; the frame must stay a
  // frame there.
  it("survives a jump to the opposite side", () => {
    const f = cloudWeatherFrameAt(unitAt(10, 20));
    const g = advanceCloudWeatherFrame(f, unitAt(-10, -160));
    expect(Math.hypot(...g.x)).toBeCloseTo(1);
    expect(dot(g.x, g.up)).toBeCloseTo(0);
    expect(g.q.every(Number.isFinite)).toBe(true);
  });
});
