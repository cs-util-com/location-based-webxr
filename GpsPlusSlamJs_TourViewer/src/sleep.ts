/**
 * The Tour Viewer's one `sleep` (a pure one-liner may exist once per
 * package): a promise that resolves after `ms` milliseconds.
 *
 * @see sleep.ts.md
 */

/** Resolves after `ms` milliseconds (the browser's timer, so at least that). */
export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
