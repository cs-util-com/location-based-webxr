/**
 * The live-GPS `PositionSource` for component 10 — the only place this
 * component touches the framework's browser-only GPS watch directly.
 * `startGpsWatch`/`stopGpsWatch` is the framework's only "current position"
 * primitive (no Redux selector exists for it, only a history of past fixes),
 * so this wraps it behind the injectable `PositionSource` interface the
 * orchestrator (and the demo's replay mode) actually depend on (plan AU6).
 *
 * @see plans/2026-08-07-authoring-plan.md
 */

import {
  startGpsWatch as frameworkStartGpsWatch,
  stopGpsWatch as frameworkStopGpsWatch,
  type GpsPosition,
} from "gps-plus-slam-app-framework/sensors";

import type { TourCoord } from "../../../store/types.js";
import type { FixInfo } from "../core/breadcrumb-gate.js";

export interface PositionSource {
  /** Fires on every fix; returns an unsubscribe function. `fix` carries what
   *  the source knows about the fix's quality; a replay source may omit it. */
  subscribe(onPosition: (pos: TourCoord, fix?: FixInfo) => void): () => void;
}

export interface LiveGpsPositionSourceDeps {
  readonly startGpsWatch: (
    onPosition: (position: GpsPosition) => void,
    onError?: (error: GeolocationPositionError) => void,
  ) => void;
  readonly stopGpsWatch: () => void;
}

function toTourCoord(position: GpsPosition): TourCoord {
  return position.altitude === null
    ? { lat: position.lat, lon: position.lon }
    : { lat: position.lat, lon: position.lon, altitude: position.altitude };
}

export function createLiveGpsPositionSource(
  deps: LiveGpsPositionSourceDeps = {
    startGpsWatch: frameworkStartGpsWatch,
    stopGpsWatch: frameworkStopGpsWatch,
  },
): PositionSource {
  return {
    subscribe(onPosition) {
      deps.startGpsWatch((position) =>
        onPosition(toTourCoord(position), {
          accuracy: position.accuracy,
          timestamp: position.timestamp,
        }),
      );
      return () => deps.stopGpsWatch();
    },
  };
}
