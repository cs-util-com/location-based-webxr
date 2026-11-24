/**
 * Two small helpers the feature-match check's modules share: the guard of
 * a stored JSON object and the counted plural of the texts. One copy for
 * the check; a finite-number guard comes from the framework's
 * `utils/json-guards`.
 *
 * @see fm-helpers.ts.md
 */

/** A JSON object: not null and not an array. */
export const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** "1 pair", "2 pairs": the count and the word, an "s" unless one. */
export const plural = (n: number, word: string): string =>
  `${String(n)} ${word}${n === 1 ? "" : "s"}`;
