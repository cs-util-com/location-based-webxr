/**
 * The field checks every reader of `tour.json` shares: an id, a non-blank
 * text, a list, and ids that must not repeat. One implementation, so the
 * words an author reads for a broken file are the same wherever the file
 * breaks (`tour-assets.ts`, `tour-blocks.ts`, `tour-story.ts`,
 * `tour-stations.ts`).
 *
 * Each check takes the caller's `fail`, which throws the caller's own
 * validation error (the manifest's), so this module needs no error class
 * and imports none of its callers.
 *
 * @see tour-fields.ts.md
 */

import { isFiniteNumber } from '../utils/json-guards.js';
import { TOUR_ID_PATTERN } from './tour-archive.js';

/** Throws the caller's validation error. */
export type TourFail = (message: string) => never;

/** A short, path-safe id: one path segment of 1-64 letters, digits, `_`
 *  or `-` (`TOUR_ID_PATTERN`). */
export function isTourId(value: unknown): value is string {
  return typeof value === 'string' && TOUR_ID_PATTERN.test(value);
}

/** `value` as an id, or a failure naming `at`. */
export function requireTourId(
  value: unknown,
  at: string,
  fail: TourFail
): string {
  if (!isTourId(value)) return fail(`"${at}" must be a short path-safe id`);
  return value;
}

/** A non-blank string as written, or undefined. */
export function tourTextOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** `value` as a non-blank string, kept as written, or a failure. */
export function requireTourText(
  value: unknown,
  at: string,
  fail: TourFail
): string {
  const text = tourTextOf(value);
  if (text === undefined) return fail(`"${at}" must be a non-empty string`);
  return text;
}

/** `value` as an array, or a failure. */
export function requireTourArray(
  value: unknown,
  at: string,
  fail: TourFail
): unknown[] {
  if (!Array.isArray(value)) return fail(`"${at}" must be an array`);
  return value as unknown[];
}

/** A whole number above zero. */
export function isPositiveInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value > 0;
}

/**
 * Fails on the first id `ids` repeats: `duplicate <what> id "<id>"`, after
 * `prefix` (where the list is, as `stations[0]: `; empty for a list whose
 * place the message needs not name).
 */
export function assertUniqueTourIds(
  ids: readonly string[],
  what: string,
  fail: TourFail,
  prefix = ''
): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) fail(`${prefix}duplicate ${what} id "${id}"`);
    seen.add(id);
  }
}
