/**
 * Why this test matters: the approach is the camera's only owner from the
 * page's first frame to the landing, and the smokes read its phase history
 * instead of racing it. For any timing, intro variant, target and frame
 * times the lab can produce, the properties pin what the camera may never
 * do: the phases only move forward (spin, turning, arrived); the fly-in's
 * distance never grows and stays between the fitted distance and the
 * zoom-out limit; from turnMs on the camera holds the target's orbit pose
 * exactly, at the fitted distance; and a dive ends exactly at its landing
 * altitude, asks its clock for the frame times in order, and lands once.
 */
import fc from "fast-check";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  type ApproachOrbitStep,
  type ApproachStep,
  type GlobeApproachParams,
  createGlobeApproach,
} from "./globe-approach.js";
import { orbitPose } from "./globe-camera.js";
import { INTRO_VARIANTS } from "./globe-intro.js";

const FIT_M = 20_000_000;
const ZOOM_OUT_M = 60_000_000;
const PHASE_ORDER = ["spin", "turning", "arrived"];

const latLng = fc.record({
  lat: fc.double({ min: -80, max: 80, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});
const sun = fc
  .tuple(
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
    fc.double({ min: -1, max: 1, noNaN: true }),
  )
  .filter(([x, y, z]) => x * x + y * y + z * z > 0.01);
const knobs = fc.record({
  url: fc.option(latLng, { nil: undefined }),
  spinMs: fc.integer({ min: 0, max: 5000 }),
  turnMs: fc.integer({ min: 0, max: 10_000 }),
  intro: fc.constantFrom(...INTRO_VARIANTS),
  turnCap: fc.integer({ min: 0, max: 180 }),
});
/** Increasing frame times, ms after the restart. */
const frames = fc
  .array(fc.integer({ min: 1, max: 2000 }), { minLength: 1, maxLength: 30 })
  .map((gaps) => {
    let t = 0;
    return gaps.map((g) => (t += g));
  });

function approachWith(sunDir: [number, number, number]) {
  let now = 0;
  const approach = createGlobeApproach(WGS84_ELLIPSOID, {
    sunEcef: () => new THREE.Vector3(...sunDir).normalize(),
    fitDistance: () => FIT_M,
    zoomOutM: () => ZOOM_OUT_M,
    now: () => now,
  });
  return {
    approach,
    at(ms: number) {
      now = ms;
      return ms;
    },
  };
}

type Knobs = Pick<
  GlobeApproachParams,
  "url" | "spinMs" | "turnMs" | "intro" | "turnCap"
>;
const params = (k: Knobs): GlobeApproachParams => ({
  ...k,
  maxKm: 50_000,
  fovY: 50,
  pitchLow: 50,
});
const orbitOf = (s: ApproachStep) => s as ApproachOrbitStep;

describe("createGlobeApproach (properties)", () => {
  it("only moves forward through spin, turning, arrived, at rising times", () => {
    fc.assert(
      fc.property(knobs, sun, frames, (k, s, times) => {
        const { approach, at } = approachWith(s);
        approach.restart(at(0), params(k));
        approach.noFixComing();
        for (const t of times) approach.pose(at(t));
        const h = approach.state().history;
        const ranks = h.map((e) => PHASE_ORDER.indexOf(e.phase));
        expect(ranks.every((r) => r >= 0)).toBe(true);
        for (let i = 1; i < h.length; i++) {
          expect(ranks[i]).toBeGreaterThan(ranks[i - 1] as number);
          expect(h[i]?.atMs).toBeGreaterThanOrEqual(h[i - 1]?.atMs as number);
        }
      }),
    );
  });

  it("flies in without the distance ever growing, between the fit and the zoom-out limit", () => {
    fc.assert(
      fc.property(knobs, sun, frames, (k, s, times) => {
        const { approach, at } = approachWith(s);
        approach.restart(at(0), params(k));
        approach.noFixComing();
        let last = Infinity;
        for (const t of times) {
          const step = orbitOf(approach.pose(at(t)));
          if (approach.state().phase !== "turning") continue;
          const d = step.distanceM as number;
          expect(d).toBeLessThanOrEqual(ZOOM_OUT_M * (1 + 1e-9));
          expect(d).toBeGreaterThanOrEqual(FIT_M * (1 - 1e-9));
          expect(d).toBeLessThanOrEqual(last * (1 + 1e-9));
          last = d;
        }
      }),
    );
  });

  it("from turnMs on, holds the target's orbit pose exactly at the fitted distance", () => {
    fc.assert(
      fc.property(knobs, sun, frames, latLng, (k, s, times, place) => {
        const { approach, at } = approachWith(s);
        const p = params({ ...k, url: place });
        approach.restart(at(0), p);
        approach.pose(at(0)); // the link's target: the fly-in starts now
        const to = orbitPose(WGS84_ELLIPSOID, place);
        for (const t of times) {
          const step = orbitOf(approach.pose(at(t)));
          if (t < p.turnMs) continue;
          expect(approach.state().phase).toBe("arrived");
          expect(step.pose.direction.toArray()).toEqual(to.direction.toArray());
          expect(step.pose.up.toArray()).toEqual(to.up.toArray());
          expect(step.distanceM).toBeNull();
          expect(step.fovDeg).toBe(50);
        }
      }),
    );
  });

  it("dives exactly to the landing altitude, holds there, and lands once", () => {
    fc.assert(
      fc.property(
        latLng,
        latLng,
        fc.integer({ min: 1, max: 20_000 }),
        fc.double({ min: 50, max: 10_000, noNaN: true }),
        frames,
        (from, target, durationMs, toAltitudeM, times) => {
          const { approach, at } = approachWith([1, 0, 0]);
          approach.restart(
            at(0),
            params({
              url: from,
              spinMs: 0,
              turnMs: 0,
              intro: "distance",
              turnCap: 90,
            }),
          );
          approach.pose(at(0));
          const asked: number[] = [];
          approach.dive(
            at(0),
            target,
            {
              pose: orbitPose(WGS84_ELLIPSOID, from),
              distanceM: FIT_M,
              quaternion: new THREE.Quaternion(),
            },
            {
              durationMs,
              toAltitudeM,
              clock: (ms) => {
                asked.push(ms);
                return ms;
              },
            },
          );
          const ends = [...times, durationMs, durationMs + 1];
          let prev = -Infinity;
          for (const t of ends.sort((a, b) => a - b)) {
            const step = approach.pose(at(t)) as {
              altitudeM: number;
              done: boolean;
            };
            const over = t >= durationMs;
            expect(step.done).toBe(over);
            // Exactly the landing from the end on; never below it before.
            expect(over ? step.altitudeM === toAltitudeM : true).toBe(true);
            expect(step.altitudeM).toBeGreaterThanOrEqual(
              toAltitudeM * (1 - 1e-9),
            );
            prev = t;
          }
          expect(prev).toBeGreaterThanOrEqual(durationMs);
          // The real elapsed time, in order: no step is asked for twice
          // out of order.
          expect(asked).toEqual([...asked].sort((a, b) => a - b));
          const landed = approach
            .state()
            .history.filter((h) => h.phase === "landed");
          expect(landed).toHaveLength(1);
          expect(landed[0]?.atMs).toBe(durationMs);
        },
      ),
    );
  });
});
