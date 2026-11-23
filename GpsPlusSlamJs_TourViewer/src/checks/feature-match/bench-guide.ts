/**
 * The general rules shown before the first shot, and the note on the light
 * scene's places. The words per shot live in `guided-texts.ts`. Plain
 * text, shown by the page as is.
 *
 * @see bench-guide.ts.md
 */

/** The general rules, shown once in "Before you start". */
export const BEFORE_YOU_START: readonly string[] = [
  "Put the phone on a stand. Lock the screen rotation. Do not zoom.",
  "Each scene is a few shots of one place: a first shot, then one change per shot (the light, a tilt, a step). The pairs to measure are made from the shots.",
  "Nothing personal in the picture: no faces, documents, screens, letters, house numbers, and no window showing the outside.",
  "Aim at something with detail (furniture, shelves, pictures, patterned fabric); a plain white wall gives nothing to match.",
  "The next shot comes up by itself; Details, Shots takes any shot again or skips one.",
  "Download all saves every ready pair in one zip at the end. Measure it on the PC.",
];

/** Shown with the light shots. */
export const SPOT_NOTE =
  "Place: the light scene is repeated at up to 3 places in the room. After L4, point the phone at another part of the room; L1 at the next place comes up by itself.";
