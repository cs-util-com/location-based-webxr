/**
 * The arrival prefetch (round-5 plan 2026-10-01-0945 §3.6 step 1): once the
 * flight's place is known, the city's own load for it starts
 * (`startCityLoad`: `globe-city.ts`'s `load`; one load is the warm-up and
 * the build, round-4 plan 2026-10-11-0122 §5), and its progress paces the
 * dive (`createDiveClock`: the flight's path over at most the pace's cap).
 * `diveMs` set in the hash (`manualDive`) keeps the fixed dive instead, and
 * `prefetch=0` turns it off. Without a city to load it counts as done
 * (nothing is waited for). Every way a flight stops aborts it (`stop`).
 * The status line (`show`) carries the tiles warmed of the total, cold or
 * warm, then how it ended (`arrivalStatusText`). Moved out of the globe
 * lab's pin as a pure refactor (editor-on-the-full-globe plan, the approach
 * slice).
 *
 * @see globe-arrival-prefetch.ts.md
 */
import {
  type ArrivalJobs,
  arrivalStatusText,
  createDiveClock,
  type DiveClock,
} from "./globe-arrival.js";
import type { GlobeCityLoadHandle } from "./globe-city.js";
import { FLIGHT_PACE_DEFAULTS } from "./flight-pace.js";
import type { LatLng } from "./globe-target.js";

/** The lab's knobs the prefetch reads. */
export interface ArrivalPrefetchParams {
  readonly prefetch: number;
  readonly diveMs: number;
}

/** One flight's prefetch. */
interface Arrival {
  /** The city's load, or null (none to load, or not enabled). */
  prefetch: GlobeCityLoadHandle | null;
  /** Whether there was nothing to load (no city): counts as done. */
  gaveUp: boolean;
  /** Whether the flight stopped it. */
  stopped: boolean;
  /** How it ended (the load's outcome, `aborted`, `off`), null while it runs. */
  outcome: string | null;
  /** The dive's clock it paces. */
  readonly clock: DiveClock;
}

const NO_JOBS: ArrivalJobs = { total: 0, warm: 0, fetched: 0, failed: 0 };

/**
 * The prefetch: `start(target, params)` starts one for a flight (stopping
 * the last) and returns the dive's clock, `stop()` aborts it, `progress()`
 * paces the continuous flight, `render()` brings the status line up to
 * date (only when its text changed), `state()` is what the smokes read
 * (null before the first flight).
 */
export function createArrivalPrefetch({
  startCityLoad,
  show,
  manualDive,
}: {
  /** The city's load for a place, or null when there is no city to load. */
  startCityLoad: (target: LatLng) => GlobeCityLoadHandle | null;
  /** Writes the status line ("" hides it). */
  show: (text: string) => void;
  /** Whether the dive's duration was set by hand (`diveMs` in the hash). */
  manualDive: () => boolean;
}) {
  let arrival: Arrival | null = null;
  let line = "";
  const counts = () =>
    arrival?.prefetch?.stats().counts ?? { overpass: NO_JOBS, dem: NO_JOBS };
  const progress = () => {
    if (!arrival) return 0;
    // Nothing to wait for: the prefetch is off (`prefetch=0`) or had no
    // city to load. Without "off" the continuous flight's gate waited out
    // its cap; the dive is unaffected (its clock is fixed when off).
    if (arrival.gaveUp || arrival.outcome === "off") return 1;
    return arrival.prefetch?.progress() ?? 0;
  };
  const render = () => {
    const text =
      arrival && arrival.outcome !== "off"
        ? arrivalStatusText({ outcome: arrival.outcome, counts: counts() })
        : "";
    if (text === line) return;
    line = text;
    show(text);
  };
  const stop = () => {
    if (!arrival || arrival.stopped) return;
    arrival.stopped = true;
    if (arrival.outcome === null) {
      arrival.prefetch?.abort();
      arrival.outcome = "aborted";
    }
    render();
  };
  /** The load for `mine`, and its outcome once it ends (unless stopped first). */
  const load = (mine: Arrival, target: LatLng) => {
    mine.prefetch = startCityLoad(target);
    if (mine.prefetch === null) {
      mine.gaveUp = true;
      mine.outcome = "off";
      return;
    }
    void mine.prefetch.finished.then((report) => {
      if (mine.outcome === null) mine.outcome = report.outcome;
      render();
    });
  };
  return {
    /**
     * Starts the prefetch for `target` and returns the dive's clock
     * (`dive`'s `clock`): paced by it, or fixed by `diveMs`.
     */
    start(target: LatLng, params: ArrivalPrefetchParams) {
      stop();
      const enabled = params.prefetch !== 0;
      const manual = manualDive();
      const clock = createDiveClock(
        enabled && !manual
          ? {
              kind: "paced",
              durationMs: params.diveMs,
              pace: FLIGHT_PACE_DEFAULTS,
            }
          : { kind: "fixed", durationMs: params.diveMs },
      );
      const mine: Arrival = {
        prefetch: null,
        gaveUp: false,
        stopped: false,
        outcome: enabled ? null : "off",
        clock,
      };
      arrival = mine;
      if (enabled) load(mine, target);
      render();
      return (elapsedMs: number) => clock.elapsedMs(elapsedMs, progress());
    },
    /** Stops the current prefetch, if it still runs. */
    stop,
    progress,
    render,
    state: () =>
      arrival && {
        outcome: arrival.outcome,
        progress: progress(),
        counts: counts(),
        paced: arrival.clock.paced,
        rate: arrival.clock.rate(),
        line,
      },
  };
}
