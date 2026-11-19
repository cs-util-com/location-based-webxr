/**
 * The page's sun follower: the one place the view follows the store's sun,
 * and the one holder of the sun drivers' timers.
 *
 * - THE SUN STEP: the sun and the light in one atmosphere update
 *   (`SunFollowView.setSunAndLight`), then the sun controls and, unless the
 *   timelapse plays, the light dialog's brightness readback.
 * - THE LIGHT: the dialog's settings as they are for a fixed build; for a
 *   time-of-day build (the view draws the blend) each look's light mixed by
 *   the sun's look weights (`look-light.ts`).
 * - THE TIMELAPSE moves the sun every frame: the look weights follow every
 *   move (uniform and colour writes), the step at most every
 *   `SUN_STEP_TIMELAPSE_MS` and once after the last move, run at the START
 *   of the view's next frame, where the GPU has finished the frame before
 *   and the step's synchronous sky readback does not wait for it.
 * - A HAND (`moveSun`) stops the driver and drops a pending sampled step; a
 *   RE-ANCHOR (`placeMoved`) does not stop it, and under the real clock goes
 *   straight to the clock's instant at the new place.
 *
 * Which driver runs is store state (`selectSunDriver`); the drivers' stop
 * function, the sampling timer and the queued frame task are resources and
 * stay here.
 *
 * @see sun-follow.ts.md
 */

import type { LightSetting } from "./atmosphere-rig.js";
import type { LightSettings } from "./light-settings.js";
import type { SunAngles } from "./sun-position.js";
import {
  blendLookLight,
  lookLightSettings,
  rigLightOf,
  type BlendedLight,
} from "./look-light.js";
import {
  selectLookWeights,
  selectSun,
  selectSunDriver,
  sunDriverChanged,
  sunMoved,
  sunPlaceMoved,
  type DemoStore,
} from "./osm-store.js";
import { relocate, type SunPlace } from "./sun-clock.js";
import {
  clockInstant,
  followClock,
  playTimelapse,
  type SunDriver,
  type SunDriverChoice,
} from "./sun-driver.js";
import { throttle } from "./throttle.js";

/** While the timelapse plays, the sun step runs at most this often. */
export const SUN_STEP_TIMELAPSE_MS = 250;

/** What the follower drives on the 3D view (`BuildingView`). */
export interface SunFollowView {
  /** Whether the drawn city is a time-of-day build (it holds look weights). */
  readonly drawsBlend: boolean;
  setLookWeights(weights: readonly number[]): void;
  followMeshScheme(
    scheme: string | undefined,
    lookWeights: readonly number[],
  ): void;
  setSunAndLight(
    angles: SunAngles,
    settings: LightSettings,
    light: LightSetting,
  ): void;
  /** Runs `task` at the start of the view's next frame; returns its cancel. */
  atNextFrame(task: () => void): () => void;
}

/** What the follower reads from the light dialog. */
interface SunFollowDialog {
  readonly settings: LightSettings;
  readonly defaults: LightSettings;
  readonly touched: ReadonlySet<keyof LightSettings>;
  /** Re-reads the brightness (a GPU readback while the dialog is open). */
  refresh(): void;
}

export interface SunFollowDeps {
  readonly store: DemoStore["store"];
  readonly view: SunFollowView;
  /** The light dialog, read late: it is created after the follower. */
  readonly dialog: () => SunFollowDialog;
  readonly sunAngles: (instantMs: number, place: SunPlace) => SunAngles;
  /** Paints the sun controls from the store. */
  readonly showSun: () => void;
  /** The drivers; the real ones unless a test passes its own. */
  readonly drivers?: {
    readonly clock?: () => SunDriver;
    readonly timelapse?: (seconds: number) => SunDriver;
  };
  /** The wall clock, for a re-anchor under the real clock. */
  readonly now?: () => number;
}

export interface SunFollow {
  /** The light the view takes for the dialog's `settings` (see the header). */
  viewLight(settings: LightSettings): BlendedLight;
  /** The sun step, now. */
  step(): void;
  /** A full mesh arrived in `scheme`: the view follows it, the light too. */
  followMeshScheme(scheme: string | undefined): void;
  /** A hand moves the sun: the driver stops, the store takes the move. */
  moveSun(instantMs: number): void;
  /** The scene was re-anchored at `place`: the sun moves there. */
  placeMoved(place: SunPlace): void;
  /** Starts the link's driver, if any. */
  start(choice: SunDriverChoice): void;
  /** Stops the driver, drops pending steps and stops following the store. */
  dispose(): void;
}

const noop = (): void => undefined;

export function createSunFollow(deps: SunFollowDeps): SunFollow {
  const { store, view } = deps;
  const now = deps.now ?? (() => Date.now());
  const clockDriver = deps.drivers?.clock ?? (() => followClock());
  const timelapseDriver =
    deps.drivers?.timelapse ?? ((seconds) => playTimelapse({ seconds }));

  let stopDriver = noop;
  let cancelFrameTask = noop;

  const viewLight = (settings: LightSettings): BlendedLight => {
    if (!view.drawsBlend) return { settings, light: rigLightOf(settings) };
    const dialog = deps.dialog();
    return blendLookLight(
      lookLightSettings(settings, dialog.defaults, dialog.touched),
      selectLookWeights(store.getState()),
    );
  };

  const step = (): void => {
    const state = store.getState();
    const { instantMs, place } = selectSun(state);
    const dialog = deps.dialog();
    const light = viewLight(dialog.settings);
    view.setSunAndLight(
      deps.sunAngles(instantMs, place),
      light.settings,
      light.light,
    );
    deps.showSun();
    // The readback waits for the GPU; a timelapse would pay it per step for
    // a readout nobody reads while the sun runs.
    if (selectSunDriver(state) !== "timelapse") dialog.refresh();
  };

  const sampledStep = throttle(() => {
    cancelFrameTask();
    cancelFrameTask = view.atNextFrame(() => {
      cancelFrameTask = noop;
      step();
    });
  }, SUN_STEP_TIMELAPSE_MS);

  const dropPendingStep = (): void => {
    sampledStep.cancel();
    cancelFrameTask();
    cancelFrameTask = noop;
  };

  const stop = (): void => {
    stopDriver();
    stopDriver = noop;
    dropPendingStep();
    if (selectSunDriver(store.getState()) !== "none") {
      store.dispatch(sunDriverChanged("none"));
    }
  };

  let shownSun = selectSun(store.getState());
  let shownWeights = selectLookWeights(store.getState());
  const unsubscribe = store.subscribe(() => {
    const state = store.getState();
    const weights = selectLookWeights(state);
    if (weights !== shownWeights) {
      shownWeights = weights;
      if (view.drawsBlend) view.setLookWeights(weights);
    }
    const sun = selectSun(state);
    if (sun === shownSun) return;
    shownSun = sun;
    if (selectSunDriver(state) === "timelapse") sampledStep();
    else step();
  });

  return {
    viewLight,
    step,
    followMeshScheme(scheme) {
      const wasBlend = view.drawsBlend;
      view.followMeshScheme(scheme, selectLookWeights(store.getState()));
      if (view.drawsBlend !== wasBlend) step();
    },
    moveSun(instantMs) {
      stop();
      store.dispatch(sunMoved(instantMs));
    },
    placeMoved(place) {
      const state = store.getState();
      const { instantMs, place: from } = selectSun(state);
      const at =
        selectSunDriver(state) === "clock"
          ? clockInstant(now(), place)
          : relocate(instantMs, from, place);
      store.dispatch(sunPlaceMoved(place, at));
    },
    start(choice) {
      stop();
      if (choice.kind === "none") return;
      store.dispatch(sunDriverChanged(choice.kind));
      const driver =
        choice.kind === "clock"
          ? clockDriver()
          : timelapseDriver(choice.seconds);
      stopDriver = driver(store.dispatch, store.getState);
    },
    dispose() {
      unsubscribe();
      stop();
    },
  };
}
