/**
 * The globe city's per-frame step (globe city plan 2026-10-05-0040 §12.5
 * C4): which place to load and when, the retry of a failed build, and the
 * fade by altitude; plus the flight's warm-up and the gates the lab's test
 * hooks read. Moved out of the globe lab as a pure refactor
 * (editor-on-the-full-globe plan, the city slice).
 *
 * The flight's place, or the link's, is loaded here when no warm-up is
 * running for it (`prefetch=0`, `cityWarm=0`, a stopped flight). A load of
 * a place that runs or ran is the same load (`GlobeCity.load` returns it),
 * so nothing is downloaded twice.
 *
 * @see globe-city-step.ts.md
 */
import type { GlobeCity, GlobeCityLoadHandle } from "./globe-city.js";
import { cityShareAt, exaggerationAt } from "./globe-flight.js";
import type { LatLng } from "./globe-target.js";

/**
 * A failed build is asked for again after a pause, a few times, so a
 * passing Overpass or DEM failure does not leave the place without a city
 * for the session (r790 milestone review F6).
 */
export const GLOBE_CITY_RETRY = Object.freeze({ afterMs: 10_000, times: 3 });

/** The relief's height law, as `exaggerationAt` takes it. */
export interface GlobeCityHeightLaw {
  near?: number;
  ground?: number;
}

/** One frame's inputs. */
export interface GlobeCityFrame {
  /** The flight's place, or the link's (none: nothing to load). */
  place: LatLng | null | undefined;
  /** The pin's arrival: a warm-up runs while its `outcome` is null. */
  arrival: { outcome: unknown } | null | undefined;
  /** The camera's altitude above the ellipsoid (m, at least 0). */
  altitudeM: number;
  /** The altitude the city starts to show below (m, the lab's `cityKm`). */
  topM: number;
  /** The relief's global zoom, the city's heights' zoom. */
  zoom: number;
  /** The relief's height law (the lab's `heightLaw()`). */
  law: GlobeCityHeightLaw;
}

/** The answer of `gate()`: what a sweep waits for before its first move. */
type GlobeCityGate = "idle" | "loading" | "ended" | "gave-up";

export interface GlobeCityStep {
  /** The frame's load, retry and fade (`GlobeCityFrame`). */
  step(frame: GlobeCityFrame): void;
  /**
   * The flight's warm-up for `target`: a fresh load, or null where the
   * city cannot be drawn (the relief not at true heights on the ground,
   * R14).
   */
  warmUp(
    target: LatLng,
    options: { zoom: number; law: GlobeCityHeightLaw },
  ): GlobeCityLoadHandle | null;
  /**
   * `idle` (not asked for yet), `ended` (every stage and retry done),
   * `gave-up` (no data for the place, or failed with every retry spent)
   * or `loading`.
   */
  gate(): GlobeCityGate;
  /** No load running and the fade-in done (the view's readiness). */
  ready(): boolean;
}

export interface GlobeCityStepOptions {
  city: Pick<GlobeCity, "load" | "setFade" | "state">;
  /** The retry's clock (ms; default `performance.now`). */
  now?: () => number;
}

const keyOf = (place: LatLng | null | undefined): string | null =>
  place ? `${place.lat},${place.lng}` : null;

/** The step for `city` (`GlobeCityStepOptions`). */
export function createGlobeCityStep({
  city,
  now = () => performance.now(),
}: GlobeCityStepOptions): GlobeCityStep {
  /** The place the city was last asked for, as "lat,lng". */
  let cityKey: string | null = null;
  let tries = 0;
  let failedAt: number | null = null;

  /** A failed build of the asked place is asked for again once its pause ran. */
  const retryIfDue = (key: string | null, at: number, failed: boolean) => {
    if (key === null || key !== cityKey || !failed) return;
    failedAt ??= at;
    if (at - failedAt > GLOBE_CITY_RETRY.afterMs) {
      if (tries < GLOBE_CITY_RETRY.times) cityKey = null; // asks again below
    }
  };

  /**
   * Without a warm-up (`cityWarm=0`, `prefetch=0`) the frame loop loads
   * only once the city could be seen (below `topM`): a link that names a
   * place for its view loads no city data from orbit.
   */
  const wanted = (frame: GlobeCityFrame, groundTrue: boolean): boolean => {
    const warming = frame.arrival != null && frame.arrival.outcome === null;
    if (warming || !groundTrue) return false;
    return frame.arrival != null || frame.altitudeM < frame.topM;
  };

  return {
    step(frame) {
      const groundTrue = exaggerationAt(0, frame.law) === 1;
      const key = keyOf(frame.place);
      if (key !== cityKey) tries = 0;
      const at = now();
      retryIfDue(key, at, city.state().phase === "failed");
      if (key !== null && key !== cityKey && wanted(frame, groundTrue)) {
        city.load(frame.place as LatLng, { zoom: frame.zoom });
        cityKey = key;
        tries += 1;
        failedAt = null;
      }
      // Drawn only where the relief is drawn at true heights NOW (R14,
      // review F8): with `reliefGround` the relief is exaggerated above
      // 2-8 km, and true-height buildings would stand buried in it there.
      const trueNow = exaggerationAt(frame.altitudeM, frame.law) === 1;
      city.setFade(trueNow ? cityShareAt(frame.altitudeM, frame.topM) : 0);
    },
    warmUp(target, { zoom, law }) {
      return exaggerationAt(0, law) === 1
        ? city.load(target, { zoom, fresh: true })
        : null;
    },
    gate() {
      const s = city.state();
      if (s.phase === "idle") return "idle";
      if (s.load?.ended) return "ended";
      const spent = s.phase === "failed" && tries >= GLOBE_CITY_RETRY.times;
      if (s.load?.outcome === "unavailable" || spent) return "gave-up";
      return "loading";
    },
    ready() {
      const s = city.state();
      return s.phase !== "loading" && Math.abs(s.shown - s.fade) < 1e-3;
    },
  };
}
