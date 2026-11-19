/**
 * The page's sun follower: the store's sun and driver, the view's sun
 * step, the drivers' timers.
 *
 * WHY THESE TESTS MATTER. This wiring lived in `main.ts` closures, where
 * no test could reach it, and each rule here is one a mutation of those
 * closures broke silently: a hand that did not stop the driver (the
 * timelapse pulled the sun back from under the slider), a light that
 * ignored whether the drawn city is the blend (a fixed scheme lit as a
 * mix of looks), an inverted timelapse check (a sky rebuild on every
 * frame, or a slider that lagged 250 ms). The store, the drivers' rules
 * and the light mix are the real ones; only the view, the dialog and the
 * drivers' timers are fakes.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { timeAtElevation } from "gps-plus-slam-app-framework/geo/solar-position";

import {
  DEFAULT_LIGHT_SETTINGS,
  type LightSettings,
} from "./light-settings.js";
import { TIME_OF_DAY } from "./look-choice.js";
import { blendLookLight, lookLightSettings, rigLightOf } from "./look-light.js";
import {
  createDemoStore,
  selectLookWeights,
  selectSun,
  selectSunDriver,
  sunMoved,
} from "./osm-store.js";
import { relocate } from "./sun-clock.js";
import { clockInstant, type SunDriver } from "./sun-driver.js";
import {
  createSunFollow,
  SUN_STEP_TIMELAPSE_MS,
  type SunFollowView,
} from "./sun-follow.js";

const COLOGNE = { lat: 50.94, lng: 6.96 };
const TOKYO = { lat: 35.68, lng: 139.69 };
const DATE = { year: 2026, month: 9, day: 23 };
const at = (deg: number) =>
  timeAtElevation(DATE, COLOGNE.lat, COLOGNE.lng, deg, "setting")!;

function fakeView() {
  let blend = false;
  const tasks: (() => void)[] = [];
  const view = {
    get drawsBlend() {
      return blend;
    },
    setLookWeights: vi.fn<SunFollowView["setLookWeights"]>(),
    followMeshScheme: vi.fn<SunFollowView["followMeshScheme"]>((scheme) => {
      blend = scheme === TIME_OF_DAY;
    }),
    setSunAndLight: vi.fn<SunFollowView["setSunAndLight"]>(),
    atNextFrame: vi.fn<SunFollowView["atNextFrame"]>((task) => {
      tasks.push(task);
      return () => {
        const i = tasks.indexOf(task);
        if (i >= 0) tasks.splice(i, 1);
      };
    }),
  };
  /** Runs the tasks queued for the next frame, as the view's frame does. */
  const frame = () => {
    for (const task of tasks.splice(0)) task();
  };
  return { view, tasks, frame };
}

/** A driver whose timers are the test's: it hands out its dispatch and counts stops. */
function fakeDriver() {
  const stop = vi.fn();
  let dispatch: Parameters<SunDriver>[0] | undefined;
  const driver: SunDriver = (d) => {
    dispatch = d;
    return stop;
  };
  return { driver, stop, move: (ms: number) => dispatch!(sunMoved(ms)) };
}

function setup(options: { readonly nowMs?: number } = {}) {
  const { store } = createDemoStore({
    start: COLOGNE,
    category: "x",
    sun: { instantMs: at(20), place: COLOGNE },
  });
  const { view, tasks, frame } = fakeView();
  const dialog = {
    settings: DEFAULT_LIGHT_SETTINGS,
    defaults: DEFAULT_LIGHT_SETTINGS,
    touched: new Set<keyof LightSettings>(),
    refresh: vi.fn(),
  };
  const showSun = vi.fn();
  const clock = fakeDriver();
  const timelapse = fakeDriver();
  const follow = createSunFollow({
    store,
    view,
    dialog: () => dialog,
    sunAngles: () => ({ elevationRad: 0.1, azimuthRad: 4 }),
    showSun,
    drivers: { clock: () => clock.driver, timelapse: () => timelapse.driver },
    now: () => options.nowMs ?? at(3),
  });
  return {
    store,
    view,
    tasks,
    frame,
    dialog,
    showSun,
    clock,
    timelapse,
    follow,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the sun follower's light", () => {
  // WHY: the blend's light belongs to a blend build only; a fixed scheme
  // (or AR's default build) lit as a mix of looks is wrong at every sun.
  it("is the dialog's light for a fixed build and the looks' mix for the blend", () => {
    const { store, view, follow } = setup();
    store.dispatch(sunMoved(at(1)));
    const settings = DEFAULT_LIGHT_SETTINGS;
    expect(follow.viewLight(settings)).toEqual({
      settings,
      light: rigLightOf(settings),
    });
    view.followMeshScheme(TIME_OF_DAY, []);
    const blended = blendLookLight(
      lookLightSettings(settings, DEFAULT_LIGHT_SETTINGS, new Set()),
      selectLookWeights(store.getState()),
    );
    expect(follow.viewLight(settings)).toEqual(blended);
    expect(blended.light).not.toEqual(rigLightOf(settings));
  });
});

describe("the sun follower's step", () => {
  // WHY: without a driver every move is a hand or a link, and the view must
  // show it at once, the dialog's brightness included.
  it("steps at once, with the dialog's readout, when no driver runs", () => {
    const { store, view, dialog, showSun } = setup();
    store.dispatch(sunMoved(at(5)));
    expect(view.setSunAndLight).toHaveBeenCalledTimes(1);
    expect(showSun).toHaveBeenCalledTimes(1);
    expect(dialog.refresh).toHaveBeenCalledTimes(1);
  });

  // WHY: the timelapse moves the sun every frame; a sky rebuild per frame
  // is about 17 ms on the measured phone. The step is sampled, runs at
  // the start of a frame (where the GPU has finished the last one), and
  // skips the dialog's readback.
  it("samples the step into the next frame while the timelapse plays", () => {
    const { store, view, frame, dialog, timelapse, follow } = setup();
    follow.start({ kind: "timelapse", seconds: 10 });
    expect(selectSunDriver(store.getState())).toBe("timelapse");
    timelapse.move(at(6));
    timelapse.move(at(5.9));
    expect(view.setSunAndLight).not.toHaveBeenCalled();
    vi.advanceTimersByTime(SUN_STEP_TIMELAPSE_MS);
    expect(view.setSunAndLight).not.toHaveBeenCalled();
    frame();
    expect(view.setSunAndLight).toHaveBeenCalledTimes(1);
    expect(dialog.refresh).not.toHaveBeenCalled();
  });

  // WHY: the weights are uniform writes and follow every move, but only a
  // blend build wears them; a fixed build must not be recoloured.
  it("hands the look weights to the view only while the blend is drawn", () => {
    const { store, view, follow } = setup();
    store.dispatch(sunMoved(at(4)));
    expect(view.setLookWeights).not.toHaveBeenCalled();
    follow.followMeshScheme(TIME_OF_DAY);
    store.dispatch(sunMoved(at(1)));
    expect(view.setLookWeights).toHaveBeenLastCalledWith(
      selectLookWeights(store.getState()),
    );
  });

  // WHY: the light changes with the drawn scheme, so a blend build arriving
  // (or leaving) steps the sun once; another build of the same kind does not.
  it("steps once when the drawn city turns into the blend or back", () => {
    const { view, follow } = setup();
    follow.followMeshScheme(TIME_OF_DAY);
    expect(view.followMeshScheme).toHaveBeenCalledWith(
      TIME_OF_DAY,
      expect.any(Array),
    );
    expect(view.setSunAndLight).toHaveBeenCalledTimes(1);
    follow.followMeshScheme(TIME_OF_DAY);
    expect(view.setSunAndLight).toHaveBeenCalledTimes(1);
    follow.followMeshScheme("urban");
    expect(view.setSunAndLight).toHaveBeenCalledTimes(2);
  });
});

describe("a hand and a re-anchor", () => {
  // WHY: a running driver would pull the sun back from under the slider.
  it("a hand stops the driver and steps at once", () => {
    const { store, view, timelapse, follow } = setup();
    follow.start({ kind: "timelapse", seconds: 10 });
    follow.moveSun(at(2));
    expect(timelapse.stop).toHaveBeenCalledTimes(1);
    expect(selectSunDriver(store.getState())).toBe("none");
    expect(selectSun(store.getState()).instantMs).toBe(at(2));
    expect(view.setSunAndLight).toHaveBeenCalledTimes(1);
  });

  // WHY: a sampled step pending from the driver would rebuild the sky a
  // second time, up to 250 ms after the hand's own step.
  it("a hand drops the driver's pending sampled step", () => {
    const { view, tasks, frame, timelapse, follow } = setup();
    follow.start({ kind: "timelapse", seconds: 10 });
    timelapse.move(at(6));
    vi.advanceTimersByTime(SUN_STEP_TIMELAPSE_MS);
    expect(tasks).toHaveLength(1);
    timelapse.move(at(5.9));
    follow.moveSun(at(2));
    expect(tasks).toHaveLength(0);
    vi.advanceTimersByTime(4 * SUN_STEP_TIMELAPSE_MS);
    frame();
    expect(view.setSunAndLight).toHaveBeenCalledTimes(1);
  });

  // WHY: a re-anchor is not a hand: the driver keeps running at the new
  // place, and the sun keeps its phase there.
  it("a re-anchor keeps the driver and the sun's phase", () => {
    const { store, timelapse, follow } = setup();
    follow.start({ kind: "timelapse", seconds: 10 });
    const before = selectSun(store.getState());
    follow.placeMoved(TOKYO);
    expect(timelapse.stop).not.toHaveBeenCalled();
    expect(selectSunDriver(store.getState())).toBe("timelapse");
    expect(selectSun(store.getState())).toEqual({
      instantMs: relocate(before.instantMs, before.place, TOKYO),
      place: TOKYO,
    });
  });

  // WHY: under the real clock a phase-kept sun is not the clock's, and it
  // showed for up to a clock step (10 s) before jumping.
  it("a re-anchor under the clock goes straight to the clock there", () => {
    const nowMs = at(3);
    const { store, clock, follow } = setup({ nowMs });
    follow.start({ kind: "clock" });
    follow.placeMoved(TOKYO);
    expect(clock.stop).not.toHaveBeenCalled();
    expect(selectSun(store.getState())).toEqual({
      instantMs: clockInstant(nowMs, TOKYO),
      place: TOKYO,
    });
  });

  // WHY: a link with no driver must leave none running and nothing in the
  // store saying otherwise.
  it("starts nothing for no driver, and dispose stops a running one", () => {
    const { store, clock, follow } = setup();
    follow.start({ kind: "none" });
    expect(selectSunDriver(store.getState())).toBe("none");
    follow.start({ kind: "clock" });
    expect(selectSunDriver(store.getState())).toBe("clock");
    follow.dispose();
    expect(clock.stop).toHaveBeenCalledTimes(1);
  });
});
