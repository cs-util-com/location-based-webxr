/**
 * The globe's one clock (round-2 plan 2026-09-26-2055 M3f, round-3 plan
 * 2026-09-27-0532 §4 F): the scene's instant, which the sun, the cloud
 * drift and the dive's hand-over all read. It is pinnable from the hash, so
 * a link reproduces a scene exactly: `time=<ISO>` pins the instant (the
 * clock then stands still, as `time=` always did), `timeScale=<n>` runs it
 * at n scene seconds per real second (from the pin, or from now).
 *
 * @see globe-clock.ts.md
 */

/** The accepted range of `timeScale`: standing still to about a day a second. */
export const GLOBE_CLOCK_SCALE = { min: 0, max: 100_000 } as const;

/** What the hash says about the scene's time. */
export interface GlobeClockSetting {
  /** A pinned start instant (epoch ms), or null for "now". */
  readonly startMs: number | null;
  /**
   * Scene milliseconds per real millisecond, or null for the default: 0
   * (standing) with a pinned start, 1 (the wall clock) without one.
   */
  readonly scale: number | null;
}

/** A started clock. */
export interface GlobeClock {
  readonly setting: GlobeClockSetting;
  /** The effective scale (the setting's, or its default). */
  readonly scale: number;
  /** The scene's instant (epoch ms) at a monotonic reading (`performance.now()`). */
  timeAt(monoMs: number): number;
}

/** A plain decimal number: no hex, no `Infinity`, no empty string. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * The clock's setting from the lab's hash parameters. An absent, empty or
 * unparseable `time` is "now"; an absent, malformed or out-of-range
 * `timeScale` is the default. A hand-typed offset's "+" arrives as a space
 * (form decoding), so it is put back.
 */
export function readGlobeClockSetting(
  params: URLSearchParams,
): GlobeClockSetting {
  const timeText = (params.get("time") ?? "").replaceAll(" ", "+");
  const startMs = timeText === "" ? Number.NaN : Date.parse(timeText);
  const scaleText = (params.get("timeScale") ?? "").trim();
  const scale = DECIMAL.test(scaleText) ? Number(scaleText) : Number.NaN;
  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    scale:
      scale >= GLOBE_CLOCK_SCALE.min && scale <= GLOBE_CLOCK_SCALE.max
        ? scale
        : null,
  };
}

/** True when two settings describe the same clock (no restart needed). */
export function sameGlobeClockSetting(
  a: GlobeClockSetting,
  b: GlobeClockSetting,
): boolean {
  return a.startMs === b.startMs && a.scale === b.scale;
}

/**
 * Starts the clock at a wall reading: `epochMs` (`Date.now()`) is "now" for
 * an unpinned clock, `monoMs` (`performance.now()`) the reading its later
 * `timeAt` calls are measured from. RangeError for a non-finite reading, a
 * non-finite start, or a scale outside `GLOBE_CLOCK_SCALE`.
 */
export function startGlobeClock(
  setting: GlobeClockSetting,
  wall: { epochMs: number; monoMs: number },
): GlobeClock {
  const { epochMs, monoMs } = wall;
  if (!Number.isFinite(epochMs) || !Number.isFinite(monoMs)) {
    throw new RangeError(
      `wall readings must be finite, got ${epochMs}, ${monoMs}`,
    );
  }
  requireSetting(setting);
  const { startMs, scale } = setting;
  const origin = startMs ?? epochMs;
  const effective = scale ?? (startMs === null ? 1 : 0);
  return {
    setting,
    scale: effective,
    timeAt: (mono) => origin + (mono - monoMs) * effective,
  };
}

/** RangeError for a non-finite start or a scale outside the range. */
function requireSetting({ startMs, scale }: GlobeClockSetting): void {
  if (startMs !== null && !Number.isFinite(startMs)) {
    throw new RangeError(`start must be finite or null, got ${startMs}`);
  }
  if (
    scale !== null &&
    !(scale >= GLOBE_CLOCK_SCALE.min && scale <= GLOBE_CLOCK_SCALE.max)
  ) {
    throw new RangeError(
      `scale must be within ${GLOBE_CLOCK_SCALE.min}-${GLOBE_CLOCK_SCALE.max}, got ${scale}`,
    );
  }
}
