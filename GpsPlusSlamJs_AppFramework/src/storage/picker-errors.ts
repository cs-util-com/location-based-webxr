/**
 * What a rejected File System Access picker means, in one place: the save
 * dialog, the folder dialog and `downloadBlob` all ask the same question.
 *
 * @see picker-errors.ts.md
 */

/**
 * - `cancelled` - the user dismissed the dialog: nothing is to be written,
 *   and no other way of saving is to be offered in its place.
 * - `unavailable` - the browser refused the dialog or has none that works
 *   here (no click to open it on, an iframe, a dialog already open): the
 *   caller may save another way, such as a download.
 */
export type PickerRejection = 'cancelled' | 'unavailable';

/**
 * Read a picker call's rejection. An error NAMED `AbortError` is the
 * user's dismissal - by its name alone, as `downloadBlob` has always read
 * it (a `DOMException` in every browser, but the name is the contract);
 * anything else - another `DOMException` (`SecurityError`,
 * `NotAllowedError`), a `TypeError`, a non-error, nullish - is
 * `unavailable`. A picker that throws at once, before it returns a
 * promise, is read the same way. Never throws: a `name` getter that throws
 * reads as `unavailable`.
 */
export function classifyPickerRejection(err: unknown): PickerRejection {
  if (typeof err !== 'object' || err === null) return 'unavailable';
  try {
    return (err as { readonly name?: unknown }).name === 'AbortError'
      ? 'cancelled'
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
