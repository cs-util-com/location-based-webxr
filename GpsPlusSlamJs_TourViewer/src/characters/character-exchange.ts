/**
 * The character exchange file: the cut sheet as a PNG with the record in a
 * `tEXt` chunk, so one ordinary picture file carries a character between
 * devices. Reading one checks, in this order, that it is a picture, a
 * PNG, undamaged, see-through, the sheet's size, and that its record is
 * not from a newer version; each refusal has a title and plain words.
 * `checkSheetPixels` then checks the decoded pixels.
 */

import { type CharacterRecord, importedRecordOf } from "./character-record.js";
import { CUT_SETTINGS } from "./cut-settings.js";
import {
  asciiJson,
  isJpeg,
  isPng,
  pngHeader,
  PngDamaged,
  readChunks,
  readTextChunk,
  withTextChunk,
} from "./png-text.js";
import type { RgbaImage } from "./rgba-image.js";

export const TEXT_KEY = "gps-plus-slam-character";

const SHEET_W = CUT_SETTINGS.cellW * 4;
const SHEET_H = CUT_SETTINGS.cellH;

/** Why a file cannot be imported, as a title and a sentence for a person. */
export class ImportRefusal extends Error {
  constructor(
    readonly title: string,
    readonly words: string,
  ) {
    super(`${title}. ${words}`);
    this.name = "ImportRefusal";
  }
}

export interface InspectedExchange {
  readonly name: string;
  readonly steady: boolean;
  readonly describedAs: string;
  /** A sentence for the author when the record did not read, else "". */
  readonly note: string;
}

const LOST_ALPHA = (): ImportRefusal =>
  new ImportRefusal(
    "This copy lost its transparency",
    "Somewhere on the way the see-through background was filled in, which messengers often do. Send the original PNG file instead.",
  );
const NOT_A_SHEET = (words: string): ImportRefusal =>
  new ImportRefusal("This is not a character sheet", words);
const DAMAGED = (): ImportRefusal =>
  new ImportRefusal(
    "This file is damaged",
    "Part of it is missing or broken, probably from an interrupted download. Get the file again.",
  );

/** Checks a file's bytes before any pixel is decoded; throws `ImportRefusal`. */
export function inspectExchange(
  bytes: Uint8Array,
  mimeType: string,
): InspectedExchange {
  if (isJpeg(bytes) || mimeType === "image/jpeg") throw LOST_ALPHA();
  if (!isPng(bytes)) {
    if (mimeType.startsWith("image/")) {
      throw NOT_A_SHEET("A character file is a PNG picture, and this is not.");
    }
    throw new ImportRefusal(
      "This file is not a picture",
      "Choose the PNG file of a character.",
    );
  }
  let header;
  let text: string | null;
  try {
    const chunks = readChunks(bytes);
    header = pngHeader(chunks);
    text = readTextChunk(chunks, TEXT_KEY);
  } catch (e) {
    if (e instanceof PngDamaged) throw DAMAGED();
    throw e;
  }
  if (!header) throw DAMAGED();
  if (!header.hasAlpha) throw LOST_ALPHA();
  if (header.width !== SHEET_W || header.height !== SHEET_H) {
    throw NOT_A_SHEET(
      header.width === header.height * 2
        ? "It has the right shape but not the right size, so it was probably made smaller on the way. Send the original file, not a preview of it."
        : "A character sheet is four poses side by side, and this picture has another shape.",
    );
  }
  const none = { name: "", steady: false, describedAs: "", note: "" };
  if (text === null) return none;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ...none, note: "Its name could not be read." };
  }
  const rec = importedRecordOf(parsed);
  if (rec.kind === "newer") {
    throw new ImportRefusal(
      "This character was made by a newer version",
      "Update this page, then import it again.",
    );
  }
  if (rec.kind === "unreadable") {
    return { ...none, note: "Its name could not be read." };
  }
  return {
    name: rec.name,
    steady: rec.steady,
    describedAs: rec.describedAs,
    note: "",
  };
}

const STEP = 4;
const RIM = 8;
const FIGURE_MIN = 300;
const RIM_MAX = 40;

/**
 * Checks the decoded sheet: some see-through pixels, and in each of the
 * four cells one figure (enough solid samples) clear of the side edges of its cell.
 * Sampled every 4 pixels; throws `ImportRefusal`.
 */
export function checkSheetPixels(img: RgbaImage): void {
  const alphaAt = (x: number, y: number): number =>
    img.data[(y * img.width + x) * 4 + 3]!;
  let seeThrough = false;
  for (let y = 0; y < img.height && !seeThrough; y += STEP) {
    for (let x = 0; x < img.width; x += STEP) {
      if (alphaAt(x, y) < 250) {
        seeThrough = true;
        break;
      }
    }
  }
  if (!seeThrough) throw LOST_ALPHA();
  const cellW = Math.floor(img.width / 4);
  for (let k = 0; k < 4; k++) {
    let figure = 0;
    let rim = 0;
    for (let y = 0; y < img.height; y += STEP) {
      for (let x = 0; x < cellW; x += STEP) {
        if (alphaAt(k * cellW + x, y) < 128) continue;
        figure++;
        if (x < RIM || x >= cellW - RIM) {
          rim++;
        }
      }
    }
    if (figure < FIGURE_MIN || rim > RIM_MAX) {
      throw NOT_A_SHEET(
        "Each of its four quarters must hold one whole pose on a see-through background, and this one does not.",
      );
    }
  }
}

/** The sheet's PNG with the record inside, without its device-local id. */
export function exchangeBytes(
  sheetPng: Uint8Array,
  record: CharacterRecord,
): Uint8Array {
  const { libraryId: _local, ...shared } = record;
  return withTextChunk(sheetPng, TEXT_KEY, asciiJson(shared));
}

/** A file name from the character's name: letters, digits, spaces, dashes. */
export function exchangeFileName(name: string): string {
  const base = name
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${base || "character"}.png`;
}
