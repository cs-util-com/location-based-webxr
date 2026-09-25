/**
 * Viewing-mode URL for a hosted `tour.zip` (Component 5).
 *
 * The presence of `?tour=` is what switches the app from authoring into viewing
 * mode at bootstrap (contract D13), and its value is the ZIP that component 6
 * range-reads. This is the seam between the two modes, expressed as one pure
 * string function so the QR utility never has to think about URLs.
 *
 * @see plans/Shared-Contract.md §2.4 (store factories, D13)
 * @see plans/2026-07-14-packaging-plan.md (decision 13)
 */

/**
 * Build `<appBaseUrl>?tour=<encoded zipUrl>`.
 *
 * `zipUrl` is percent-encoded by `URLSearchParams`, which matters because it is
 * itself a URL: a presigned link carries `?` and `&`, and pasting one in raw
 * would truncate the param at its first separator.
 *
 * @throws {TypeError} if `appBaseUrl` is not a valid absolute URL.
 */
export function buildTourUrl(appBaseUrl: string, zipUrl: string): string {
  const url = new URL(appBaseUrl);
  url.searchParams.set("tour", zipUrl);
  return url.toString();
}
