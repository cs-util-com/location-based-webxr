/**
 * Why this test matters: a city whose build keeps failing (Overpass or the
 * DEM down) is asked for again after a pause, three times at most for a
 * place. The frames between the retries can be anything the lab produces:
 * the camera above `cityKm` without a flight, the flight's own warm-up
 * running, or no place at all. For any such sequence at one place, the
 * step never loads the city more than three times; and once the camera
 * comes down and stays, the three tries are all made (a step that never
 * retried would pass the first half alone).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { GlobeCityState } from "./globe-city.js";
import {
  GLOBE_CITY_RETRY,
  type GlobeCityFrame,
  createGlobeCityStep,
} from "./globe-city-step.js";

const BERN = { lat: 46.948, lng: 7.4474 };

/** A city whose every build fails, counting its loads. */
function failingCity() {
  let loads = 0;
  const state: GlobeCityState = {
    phase: "failed",
    fade: 1,
    shown: 0,
    load: null,
  };
  return {
    loads: () => loads,
    city: {
      load() {
        loads += 1;
        return null as never;
      },
      setFade: () => undefined,
      state: () => state,
    },
  };
}

const KINDS = {
  wanted: {},
  high: { altitudeM: 40_000 },
  warming: { arrival: { outcome: null } },
  none: { place: null },
} satisfies Record<string, Partial<GlobeCityFrame>>;

const frame = (kind: keyof typeof KINDS): GlobeCityFrame => ({
  place: BERN,
  arrival: null,
  altitudeM: 1000,
  topM: 30_000,
  zoom: 12,
  law: {},
  ...KINDS[kind],
});

const frames = fc.array(
  fc.record({
    kind: fc.constantFrom(...(Object.keys(KINDS) as (keyof typeof KINDS)[])),
    dtMs: fc.integer({ min: 0, max: 3 * GLOBE_CITY_RETRY.afterMs }),
  }),
  { maxLength: 60 },
);

describe("createGlobeCityStep: the retry's cap (properties)", () => {
  it("tries a failing place at most three times, whatever frames come between", () => {
    fc.assert(
      fc.property(frames, (sequence) => {
        const fake = failingCity();
        let t = 0;
        const step = createGlobeCityStep({ city: fake.city, now: () => t });
        for (const { kind, dtMs } of sequence) {
          t += dtMs;
          step.step(frame(kind));
          expect(fake.loads()).toBeLessThanOrEqual(GLOBE_CITY_RETRY.times);
        }
        // Then the camera comes down and stays: every try is made.
        for (let i = 0; i < 4 * GLOBE_CITY_RETRY.times; i += 1) {
          t += 2 * GLOBE_CITY_RETRY.afterMs;
          step.step(frame("wanted"));
        }
        expect(fake.loads()).toBe(GLOBE_CITY_RETRY.times);
      }),
    );
  });
});
