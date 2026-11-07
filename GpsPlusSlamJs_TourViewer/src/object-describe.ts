/**
 * How a tour object is named on every page that lists or labels one (the
 * object list, the summary map, the desktop editor's rail, map, tree and
 * inspector; M6 E1 plan review #3, root CLAUDE.md DEC-H3): its title, and
 * its distance to the nearest code. The one naming rule: no page names a
 * block on its own. Pure.
 *
 * @see object-describe.ts.md
 */

import type { TourBlock } from "gps-plus-slam-app-framework/ar/tour-blocks";
import type { QrGeoPose } from "gps-plus-slam-app-framework/ar/qr/qr-gps-vote";
import type { TourObject } from "gps-plus-slam-app-framework/ar/tour-manifest";
import { horizontalM } from "./move-with-code.js";
import { KIND_EDIT } from "./kinds/edit-kinds.js";

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
  return KIND_EDIT[object.kind].label;
}

/** The text a free block carries for its name, as a page edits it: a
 *  pin's or a picture's caption, a character's name, else its title. Unlike
 *  `objectTitle` it can be empty, and names no kind in its place. */
export function objectOwnText(object: TourObject): string | undefined {
  switch (object.kind) {
    case "shortText":
    case "picture":
      return object.caption;
    case "character":
      return object.name;
    default:
      return object.title;
  }
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
