/**
 * `parseTourJson` — turn raw tour.json text (fetched, typed, pasted, or
 * uploaded) into a validated `Tour`. Contract-level companion to
 * `validateTour`: every consumer that starts from *text* (the cloud-loader's
 * zip entry, the packaging demo's "use your own tour" input) goes through this
 * one gate.
 *
 * The only error the caller has to handle: a JSON syntax error is rethrown as a
 * `TourValidationError` so it reads the same as an invariant violation from
 * `validateTour` — one error type, one status line.
 *
 * @see plans/2026-07-14-packaging-plan.md (decision 18)
 */

import type { Tour } from "./types.js";
import { TourValidationError, validateTour } from "./validate-tour.js";

/**
 * @throws {TourValidationError} on invalid JSON syntax or a `validateTour`
 * invariant violation. Never returns a partial `Tour`.
 */
export function parseTourJson(text: string): Tour {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TourValidationError(`invalid JSON: ${message}`);
  }
  return validateTour(raw);
}
