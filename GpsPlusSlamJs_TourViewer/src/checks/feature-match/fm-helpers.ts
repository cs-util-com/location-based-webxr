/**
 * Two small helpers the feature-match check's modules share: the guard of
 * a stored JSON object (the framework's `utils/json-guards`, under the
 * check's short name) and the counted plural of the texts.
 *
 * @see fm-helpers.ts.md
 */

/** A JSON object: not null and not an array. */
export { isJsonObject as isObj } from "gps-plus-slam-app-framework/utils/json-guards";

/** "1 pair", "2 pairs": the count and the word, an "s" unless one. */
export const plural = (n: number, word: string): string =>
  `${String(n)} ${word}${n === 1 ? "" : "s"}`;
