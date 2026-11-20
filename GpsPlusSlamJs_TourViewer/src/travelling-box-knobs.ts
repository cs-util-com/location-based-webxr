/**
 * The travelling box's tuning from the address, for a field sweep: each
 * `tb.*` parameter is read only behind `?debug=1` and only when it names
 * one of the values the sweep compares; anything else keeps the default.
 * Static: read once when the page starts.
 *
 * @see travelling-box-knobs.ts.md
 */

import {
  TRAVELLING_BOX_DEFAULTS,
  type TravellingBoxKnobs,
  type TravelMetric,
} from "./travelling-box-rules.js";

/** The values each numeric knob may take (the sweep's grid). */
const TRAVELLING_BOX_KNOB_VALUES = {
  thr: [10, 12, 14, 16, 20],
  keep: [0.85, 0.9, 0.95],
  holdDock: [0.3, 0.6, 1],
  holdPlate: [0.3, 0.6, 1],
  lock: [0, 0.3, 0.6, 1],
  angle: [35, 45, 60],
  fly: [0.35, 0.45, 0.6],
} as const;

type NumericKnob = keyof typeof TRAVELLING_BOX_KNOB_VALUES;

/**
 * The knobs for this page: the defaults, with each `tb.<name>` from
 * `search` that names an allowed value when `debug` is on.
 */
export function travellingBoxKnobs(
  search: string,
  debug: boolean,
): TravellingBoxKnobs {
  if (!debug) return TRAVELLING_BOX_DEFAULTS;
  const params = new URLSearchParams(search);
  const numeric = (name: NumericKnob): number => {
    const raw = params.get(`tb.${name}`);
    const value = raw === null || raw.trim() === "" ? Number.NaN : Number(raw);
    const allowed: readonly number[] = TRAVELLING_BOX_KNOB_VALUES[name];
    return allowed.includes(value) ? value : TRAVELLING_BOX_DEFAULTS[name];
  };
  const metricRaw = params.get("tb.metric");
  const metric: TravelMetric =
    metricRaw === "min" || metricRaw === "h"
      ? metricRaw
      : TRAVELLING_BOX_DEFAULTS.metric;
  const growRaw = params.get("tb.grow");
  return {
    thr: numeric("thr"),
    metric,
    keep: numeric("keep"),
    holdDock: numeric("holdDock"),
    holdPlate: numeric("holdPlate"),
    lock: numeric("lock"),
    angle: numeric("angle"),
    fly: numeric("fly"),
    grow:
      growRaw === "on"
        ? true
        : growRaw === "off"
          ? false
          : TRAVELLING_BOX_DEFAULTS.grow,
  };
}
