/**
 * How a tour object is named on every page that lists or labels one (the
 * object list, the summary map, the desktop editor's rail, map, tree and
 * inspector; M6 E1 plan review #3, root CLAUDE.md DEC-H3): its title, and
 * its distance to the nearest code. The one naming rule: no page names a
 * block on its own. Pure.
 *
 * @see object-describe.ts.md
 */

import type {
  TourBlock,
  TourBlockKind,
} from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { horizontalM } from "./move-with-code.js";

/** What an object in the world is, in the pages' words and icons: a short
 *  text is a pin, a picture a photo, a model a model. */
export type ObjectLook = "pin" | "photo" | "model";

export function objectLook(kind: TourObject["kind"]): ObjectLook {
  if (kind === "shortText") return "pin";
  return kind === "picture" ? "photo" : "model";
}

/** Each kind in the block model's words: what a block without a text of
 *  its own is called, and the inspector's kind line. */
export const BLOCK_KIND_LABEL: Readonly<Record<TourBlockKind, string>> = {
  shortText: "Short text",
  longText: "Long text",
  picture: "Picture",
  video: "Video",
  audio: "Audio",
  model: "3D model",
  character: "Character",
};

/** The texts a block may be named by, first found first: its title (a
 *  character's name), else its caption (a short text's own text). */
const NAMING_FIELDS = ["title", "name", "caption"] as const;

/** The one name of a block, on every page: its title (a character's
 *  name), else its caption, else its kind's name - trimmed, so a text of
 *  blanks names nothing. */
export function objectTitle(object: TourObject | TourBlock): string {
  const fields = object as unknown as Readonly<Record<string, unknown>>;
  for (const name of NAMING_FIELDS) {
    const value = fields[name];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return BLOCK_KIND_LABEL[object.kind];
}

/** "4 m from the code" / "12 m from the nearest code"; "" without a code
 *  (or without a finite distance to one). Rounded to whole metres: the
 *  objects' own GPS error is metres, so decimals would be noise. */
export function codeDistanceLine(
  object: TourObject,
  codes: readonly QrGeoPose[],
): string {
  const distances = codes
    .map((code) => horizontalM(code, object.geo))
    .filter(Number.isFinite);
  if (distances.length === 0) return "";
  const nearest = Math.round(Math.min(...distances));
  return codes.length === 1
    ? `${String(nearest)} m from the code`
    : `${String(nearest)} m from the nearest code`;
}
