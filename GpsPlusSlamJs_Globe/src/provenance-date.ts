/**
 * The "Fetched:" dates the imagery's provenance file records
 * (`scripts/fetch-globe-assets.mjs`): the first fetch's date, and the date
 * of the latest run that added files, when that was a later day. A pure
 * function, so each path of a hand-run script is unit-tested.
 *
 * @see provenance-date.ts.md
 */

const DATE = "(\\d{4}-\\d{2}-\\d{2})";

/**
 * The text after "Fetched: " for this run.
 * - A first run (no previous file, or one without a date) and `--force`
 *   (every file fetched again): `today` alone.
 * - A run that fetched nothing: the previous dates, unchanged.
 * - A run that added files on a later day than the first fetch:
 *   "<first>; files added: <today>".
 * Dates are matched as YYYY-MM-DD, so the sentence's full stop is never
 * taken along.
 */
export function provenanceFetchedOn(input: {
  previous: string;
  today: string;
  force: boolean;
  fetched: number;
}): string {
  const { previous, today, force, fetched } = input;
  const first = previous.match(new RegExp(`Fetched: ${DATE}`))?.[1];
  if (force || first === undefined) return today;
  const added = previous.match(new RegExp(`files added: ${DATE}`))?.[1];
  const lastAdded = fetched > 0 ? today : added;
  return lastAdded !== undefined && lastAdded !== first
    ? `${first}; files added: ${lastAdded}`
    : first;
}
