/**
 * The material catalog's static index (W5 plan 2026-09-26-0549, M1): one
 * module per category, imported statically, because the deploy builder
 * follows only static imports.
 */

import { CLASSIC_ENTRIES } from "./classic.js";
import { RAMP_ENTRIES } from "./ramp.js";
import { STANDARD_ENTRIES } from "./standard.js";

/**
 * Grid order: the standard rows, the old white and gold ramp as the third
 * row (round-3 plan 2026-09-27-0532, DEC-FB3-1; its gold under the standard
 * gold, so the near-duplicate reads column for column), then the classic
 * and toon row. Each run of 12 is one row (CATALOG_LAYOUT.perRow).
 */
export const CATALOG = [
  ...STANDARD_ENTRIES,
  ...RAMP_ENTRIES,
  ...CLASSIC_ENTRIES,
];
