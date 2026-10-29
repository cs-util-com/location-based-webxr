/**
 * The globe city's per-frame step, moved out of the globe lab.
 *
 * Why this file matters: the step decides when the city's data is
 * downloaded (never from orbit without a flight, never twice for a place,
 * never while the flight's own warm-up runs, never where the relief is
 * exaggerated), how often a failed build is asked for again, and how much
 * of the city shows at an altitude. A wrong condition is a download from
 * orbit, a city that never comes back after one Overpass failure, or
 * buildings buried in an exaggerated relief. These tests pin the lab's
 * calls and their conditions with a recording fake of the city; the city's
 * look is the lab's smokes.
 */
import { describe, expect, it } from "vitest";

import type { GlobeCityState } from "./globe-city.js";
import {
  GLOBE_CITY_RETRY,
  type GlobeCityFrame,
  type GlobeCityHeightLaw,
  createGlobeCityStep,
} from "./globe-city-step.js";
import { cityShareAt } from "./globe-flight.js";

/** True heights at every altitude (the lab's default `exaggerationNear`). */
const TRUE: GlobeCityHeightLaw = {};
/** Exaggerated down to the ground: no city can stand on it. */
const RAISED: GlobeCityHeightLaw = { near: 3 };
/** True on the ground (below 2 km), exaggerated above 8 km. */
const GROUND: GlobeCityHeightLaw = { near: 3, ground: 1 };

const BERN = { lat: 46.948, lng: 7.4474 };
const ZURICH = { lat: 47.3769, lng: 8.5417 };

type Call =
  ["load", string, { zoom: number; fresh?: boolean }] | ["setFade", number];

/** A recording city whose state the test sets. */
function fakeCity() {
  const calls: Call[] = [];
  let state: GlobeCityState = { phase: "idle", fade: 1, shown: 0, load: null };
  const handle = {
    progress: () => 0,
    done: false,
    finished: new Promise<never>(() => undefined),
    stats: () => ({
      counts: {
        overpass: { total: 0, warm: 0, fetched: 0, failed: 0 },
        dem: { total: 0, warm: 0, fetched: 0, failed: 0 },
      },
      inFlight: 0,
      bytesStored: 0,
    }),
    abort: () => undefined,
  };
  return {
    calls,
    loads: () => calls.filter((c) => c[0] === "load"),
    set(over: Partial<GlobeCityState>) {
      state = { ...state, ...over };
    },
    city: {
      load(target: { lat: number; lng: number }, options: { zoom: number }) {
        calls.push(["load", `${target.lat},${target.lng}`, options]);
        return handle;
      },
      setFade(value: number) {
        calls.push(["setFade", value]);
      },
      state: () => state,
    },
    handle,
  };
}

const frame = (over: Partial<GlobeCityFrame> = {}): GlobeCityFrame => ({
  place: BERN,
  arrival: null,
  altitudeM: 1000,
  topM: 30_000,
  zoom: 12,
  law: TRUE,
  ...over,
});

/** A step with a clock the test moves. */
function setup() {
  const fake = fakeCity();
  let t = 0;
  const step = createGlobeCityStep({ city: fake.city, now: () => t });
  return {
    fake,
    step,
    at(ms: number) {
      t = ms;
    },
  };
}

describe("createGlobeCityStep: loading", () => {
  it("loads the place once it could be seen, at the relief's zoom, and never twice", () => {
    const { fake, step } = setup();
    step.step(frame({ altitudeM: 40_000 }));
    expect(fake.loads()).toEqual([]);
    step.step(frame({ altitudeM: 29_999 }));
    step.step(frame({ altitudeM: 1000 }));
    expect(fake.loads()).toEqual([["load", "46.948,7.4474", { zoom: 12 }]]);
  });

  it("loads with a flight from any altitude, but not while its warm-up runs", () => {
    const { fake, step } = setup();
    step.step(frame({ altitudeM: 9e6, arrival: { outcome: null } }));
    expect(fake.loads()).toEqual([]);
    step.step(frame({ altitudeM: 9e6, arrival: { outcome: "complete" } }));
    expect(fake.loads()).toEqual([["load", "46.948,7.4474", { zoom: 12 }]]);
  });

  it("loads nothing without a place, or where the ground is not at true heights", () => {
    const { fake, step } = setup();
    step.step(frame({ place: null }));
    step.step(frame({ place: undefined }));
    step.step(frame({ law: RAISED }));
    expect(fake.loads()).toEqual([]);
    step.step(frame({ law: GROUND, altitudeM: 25_000 }));
    expect(fake.loads()).toEqual([["load", "46.948,7.4474", { zoom: 12 }]]);
  });

  it("loads another place when the place changes", () => {
    const { fake, step } = setup();
    step.step(frame());
    step.step(frame({ place: ZURICH, zoom: 11 }));
    step.step(frame({ place: ZURICH, zoom: 11 }));
    expect(fake.loads()).toEqual([
      ["load", "46.948,7.4474", { zoom: 12 }],
      ["load", "47.3769,8.5417", { zoom: 11 }],
    ]);
  });
});

describe("createGlobeCityStep: the retry of a failed build", () => {
  it("asks again once the pause ran, three loads at most", () => {
    const { fake, step, at } = setup();
    step.step(frame());
    fake.set({ phase: "failed" });
    at(1000);
    step.step(frame()); // the failure is seen at 1000
    at(1000 + GLOBE_CITY_RETRY.afterMs);
    step.step(frame()); // not past the pause yet
    expect(fake.loads()).toHaveLength(1);
    at(1001 + GLOBE_CITY_RETRY.afterMs);
    step.step(frame());
    expect(fake.loads()).toHaveLength(2);
    for (let i = 0; i < 5; i += 1) {
      at(2000 + (i + 2) * GLOBE_CITY_RETRY.afterMs * 2);
      step.step(frame());
    }
    expect(fake.loads()).toHaveLength(GLOBE_CITY_RETRY.times);
    expect(GLOBE_CITY_RETRY).toEqual({ afterMs: 10_000, times: 3 });
  });

  it("times the next pause from the failure after a retry, not the one before", () => {
    const { fake, step, at } = setup();
    fake.set({ phase: "failed" });
    step.step(frame()); // the first load
    at(1);
    step.step(frame()); // the failure seen at 1
    at(10_002);
    step.step(frame()); // the retry
    at(10_003);
    step.step(frame()); // still failed: the new pause starts here
    at(20_002);
    step.step(frame()); // 20 001 after the first failure, 9 999 after this one
    expect(fake.loads()).toHaveLength(2);
    at(20_004);
    step.step(frame());
    expect(fake.loads()).toHaveLength(3);
  });

  it("starts the tries again for a new place", () => {
    const { fake, step, at } = setup();
    fake.set({ phase: "failed" });
    for (let i = 0; i < 8; i += 1) {
      at(i * 20_000);
      step.step(frame());
    }
    expect(fake.loads()).toHaveLength(3);
    step.step(frame({ place: ZURICH }));
    expect(fake.loads()).toHaveLength(4);
  });

  // A retry that falls due while the city is not wanted (above `topM`
  // without a flight) is asked for on the next frame that wants it, and
  // the tries keep counting for the place: the lab restarted them there,
  // so a city that kept failing was tried more than three times.
  it("keeps counting the tries across a due retry the frame did not want", () => {
    const { fake, step, at } = setup();
    fake.set({ phase: "failed" });
    step.step(frame()); // the first load
    at(1);
    step.step(frame()); // the failure seen
    at(20_000);
    step.step(frame({ altitudeM: 40_000 })); // due, but not wanted up here
    at(20_001);
    step.step(frame({ altitudeM: 40_000 })); // still the same place's tries
    for (let i = 0; i < 6; i += 1) {
      at(60_000 + i * 20_000);
      step.step(frame());
    }
    // One load before, then the two tries that were left.
    expect(fake.loads()).toHaveLength(GLOBE_CITY_RETRY.times);
    expect(step.gate()).toBe("gave-up");
  });

  it("keeps counting the tries across frames without a place", () => {
    const { fake, step, at } = setup();
    fake.set({ phase: "failed" });
    for (let i = 0; i < 8; i += 1) {
      at(i * 20_000);
      step.step(frame());
      step.step(frame({ place: null }));
    }
    expect(fake.loads()).toHaveLength(GLOBE_CITY_RETRY.times);
  });
});

describe("createGlobeCityStep: the fade", () => {
  it("shows the city's share where the relief is at true heights now, else 0", () => {
    const { fake, step } = setup();
    step.step(frame({ altitudeM: 25_000 }));
    step.step(frame({ altitudeM: 25_000, law: GROUND }));
    step.step(frame({ altitudeM: 1000, law: GROUND }));
    step.step(frame({ place: null, altitudeM: 50_000 }));
    expect(fake.calls.filter((c) => c[0] === "setFade")).toEqual([
      ["setFade", cityShareAt(25_000, 30_000)],
      ["setFade", 0],
      ["setFade", 1],
      ["setFade", 0],
    ]);
    expect(cityShareAt(25_000, 30_000)).toBeGreaterThan(0);
    expect(cityShareAt(25_000, 30_000)).toBeLessThan(1);
  });

  it("fades after the frame's load", () => {
    const { fake, step } = setup();
    step.step(frame());
    expect(fake.calls.map((c) => c[0])).toEqual(["load", "setFade"]);
  });
});

describe("createGlobeCityStep: the warm-up and the gates", () => {
  it("warms up with a fresh load where the ground is at true heights", () => {
    const { fake, step } = setup();
    expect(step.warmUp(BERN, { zoom: 12, law: GROUND })).toBe(fake.handle);
    expect(step.warmUp(BERN, { zoom: 12, law: RAISED })).toBeNull();
    expect(fake.loads()).toEqual([
      ["load", "46.948,7.4474", { zoom: 12, fresh: true }],
    ]);
  });

  it("gates a sweep on the city's load", () => {
    const { fake, step, at } = setup();
    expect(step.gate()).toBe("idle");
    fake.set({ phase: "loading" });
    expect(step.gate()).toBe("loading");
    const load = {
      outcome: null,
      ended: false,
      stages: [],
      counts: {
        overpass: { total: 0, warm: 0, fetched: 0, failed: 0 },
        dem: { total: 0, warm: 0, fetched: 0, failed: 0 },
      },
      progress: 0,
    };
    fake.set({ phase: "ready", load: { ...load, ended: true } });
    expect(step.gate()).toBe("ended");
    fake.set({ phase: "failed", load: { ...load, outcome: "unavailable" } });
    expect(step.gate()).toBe("gave-up");
    fake.set({ load });
    expect(step.gate()).toBe("loading"); // failed, tries left
    for (let i = 0; i < 6; i += 1) {
      at(i * 20_000);
      step.step(frame());
    }
    expect(step.gate()).toBe("gave-up");
  });

  it("is ready with no load running and the fade-in done", () => {
    const { fake, step } = setup();
    fake.set({ phase: "ready", fade: 1, shown: 1 });
    expect(step.ready()).toBe(true);
    fake.set({ shown: 0.998 });
    expect(step.ready()).toBe(false);
    fake.set({ shown: 0.9995 });
    expect(step.ready()).toBe(true);
    fake.set({ phase: "loading" });
    expect(step.ready()).toBe(false);
    fake.set({ phase: "idle", fade: 1, shown: 0 });
    expect(step.ready()).toBe(false);
  });
});
