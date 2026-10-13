/**
 * The code's printed text on its level file (follow-up F2): the optional
 * `qr.printed`, the full text the code carries (its launch URL), written
 * when the code is measured. A code's level is filed under a HASH of that
 * text, so without it a re-print can only guess which spelling of the tour
 * link the code was printed from (`print-link.ts`). Like `qr.spots`
 * (`level-spots.ts`), it is the Tour Viewer authoring's field: visitors'
 * parser (`parseQrLevel`) drops it, and it is read LENIENTLY - anything but
 * a usable string is no text, never a reason to reject the level.
 *
 * @see level-printed.ts.md
 */

import { objectOf } from "./level-spots.js";

/** Longer than any text a QR code can carry (version 40 holds at most
 *  2 953 bytes); a longer field is damage, not a code's text. */
const MAX_PRINTED_LENGTH = 4096;

/** The text the code was printed with, or null (none, damaged, or not a
 *  level). */
export function readPrintedText(json: string): string | null {
  const printed = objectOf(json)?.qr["printed"];
  return typeof printed === "string" &&
    printed !== "" &&
    printed.length <= MAX_PRINTED_LENGTH
    ? printed
    : null;
}

/**
 * The level `json` with `text` as its printed text; every other field kept.
 *
 * @throws SyntaxError when `json` is not a level object
 */
export function withPrintedText(json: string, text: string): string {
  const data = objectOf(json);
  if (data === null) throw new SyntaxError("not a level file");
  return JSON.stringify({ ...data, qr: { ...data.qr, printed: text } });
}

/**
 * The freshly minted level `toJson` with the printed text of the level it
 * replaces (`fromJson`), at the one seam every re-mint goes through (with
 * `carryCodeSpots`). `toJson` itself when there is nothing to carry or it
 * already holds a text.
 */
export function carryPrintedText(fromJson: string, toJson: string): string {
  const text = readPrintedText(fromJson);
  if (text === null || readPrintedText(toJson) !== null) return toJson;
  return objectOf(toJson) === null ? toJson : withPrintedText(toJson, text);
}
