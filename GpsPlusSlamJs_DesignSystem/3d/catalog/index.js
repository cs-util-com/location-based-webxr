/**
 * The material catalog's static index (W5 plan 2026-09-26-0549, M1): one
 * module per category, imported statically, because the deploy builder
 * follows only static imports.
 */

import { CLASSIC_ENTRIES } from "./classic.js";
import { STANDARD_ENTRIES } from "./standard.js";

export const CATALOG = [...STANDARD_ENTRIES, ...CLASSIC_ENTRIES];
