/**
 * What the page tells the tester for each photo pair: its purpose, the
 * steps for photo A and photo B, and what to avoid; plus the general rules
 * shown before the first pair. Plain text, shown by the page as is.
 *
 * @see bench-guide.ts.md
 */
import type { PairKey } from "./bench-export";

/** The guidance for one pair. */
export interface PairGuide {
  /** One sentence: what the pair measures. */
  readonly purpose: string;
  /** The steps in order, without numbers (the page numbers them). */
  readonly steps: readonly string[];
  /** One short line of what spoils the pair. */
  readonly avoid: string;
  /** True for the light pairs, which are repeated at up to three spots. */
  readonly spotNote: boolean;
}

/** The general rules, shown once in "Before you start". */
export const BEFORE_YOU_START: readonly string[] = [
  "Lock the screen rotation. Do not zoom.",
  "After photo B, wait until the run has finished, then tap Save files and Download all before the next photo A (a new photo A clears the result).",
  "Nothing personal in the picture: no faces, documents, screens, letters, house numbers, and no window showing the outside.",
  "Aim at something with detail (furniture, shelves, pictures, patterned fabric); a plain white wall gives nothing to match.",
  "The selector moves to the next pair by itself after Download all; pick another pair any time to repeat or skip one.",
];

/** Shown with the light pairs. */
export const SPOT_NOTE =
  "Spot: test 1 is repeated at up to 3 places in the room (spot 1, 2, 3). After 1c, point the phone at another part of the room; the selector moves to 1a at the next spot by itself.";

const FLAT_SURFACE =
  "a FLAT surface with detail (a poster, a wall with pictures, a patterned door, a large book or map lying flat)";

export const PAIR_GUIDE: Readonly<Record<PairKey, PairGuide>> = {
  "1a": {
    purpose: "How many matches survive when nothing changes.",
    steps: [
      "Lay the phone on a table or shelf, pointing at a detailed part of the room (or hold it very still).",
      "Photo A.",
      "Change nothing.",
      "Photo B.",
    ],
    avoid: "Moving the phone, changing the light.",
    spotNote: true,
  },
  "1b": {
    purpose: "Does a method still match when the light gets weaker?",
    steps: [
      "Same place as 1a, phone lying still; normal light.",
      "Photo A.",
      "Dim the light: switch off the main light, keep one small lamp, or use a dimmer. Do not touch the phone.",
      "Wait 2 seconds for the camera to adjust.",
      "Photo B.",
    ],
    avoid: "Moving the phone between A and B.",
    spotNote: true,
  },
  "1c": {
    purpose: "Does a method still match with very little light?",
    steps: [
      "Same place as 1a, phone lying still; normal light.",
      "Photo A.",
      "Make it as dark as possible while the room's shapes are still visible on the screen. Do not touch the phone.",
      "Wait 2 seconds for the camera to adjust.",
      "Photo B.",
    ],
    avoid: "Fully black (nothing to match), moving the phone.",
    spotNote: true,
  },
  "2a": {
    purpose: "The baseline for the turning tests.",
    steps: [
      `Stand about 1.5 m in front of ${FLAT_SURFACE}.`,
      "Hold the phone upright: photo A.",
      "Same place, upright again: photo B. Holding by hand is fine.",
    ],
    avoid:
      "Deep scenes: turning the phone moves the lens a few cm, which does not matter on a flat surface only.",
    spotNote: false,
  },
  "2b": {
    purpose: "Does a method cope with a quarter turn?",
    steps: [
      "Same flat surface, same place as 2a.",
      "Upright: photo A.",
      "Turn the phone sideways (either way) and aim at the same centre: photo B.",
    ],
    avoid: "Stepping closer or away.",
    spotNote: false,
  },
  "2c": {
    purpose: "Does a method cope with a half turn?",
    steps: [
      "Same flat surface, same place as 2a.",
      "Upright: photo A.",
      "Hold the phone upside down and aim at the same centre: photo B.",
    ],
    avoid: "Stepping closer or away.",
    spotNote: false,
  },
  "2d": {
    purpose: "Does a method cope with a slight tilt?",
    steps: [
      "Same flat surface, same place as 2a.",
      "Upright: photo A.",
      "Tilt the phone 30-45 deg (like a clock hand at one o'clock) and aim at the same centre: photo B.",
    ],
    avoid: "Stepping closer or away.",
    spotNote: false,
  },
  "3a": {
    purpose: "The baseline for the distance tests.",
    steps: [
      "Same flat surface.",
      "From 1.5 m: photo A.",
      "From the same place: photo B.",
    ],
    avoid: "Moving between A and B.",
    spotNote: false,
  },
  "3b": {
    purpose: "Does a method match the same thing at half the size?",
    steps: [
      "From 1.5 m: photo A.",
      "Step straight back to about 3 m, keep the surface centred: photo B.",
    ],
    avoid: "Zooming instead of stepping back.",
    spotNote: false,
  },
  "3c": {
    purpose: "Does a method match the same thing at a third of the size?",
    steps: [
      "From 1 m: photo A.",
      "Step straight back to about 3 m, keep the surface centred: photo B.",
    ],
    avoid: "Zooming instead of stepping back.",
    spotNote: false,
  },
  "4a": {
    purpose: "The baseline for the side-step test on a flat surface.",
    steps: ["From one place: photo A of the flat surface.", "Photo B."],
    avoid: "Moving between A and B.",
    spotNote: false,
  },
  "4b": {
    purpose: "Does a method match after a change of viewpoint?",
    steps: [
      "Photo A of the flat surface.",
      "Step about 1 m to the side, parallel to it.",
      "Turn to aim at the same centre: photo B.",
    ],
    avoid: "Stepping closer or away.",
    spotNote: false,
  },
  "4c": {
    purpose: "The baseline for a scene with depth.",
    steps: [
      "Aim into a deep room or a hallway (things near and far).",
      "From one place: photo A, then photo B.",
    ],
    avoid: "Anything moving in the scene (people, pets, a TV).",
    spotNote: false,
  },
  "4d": {
    purpose: "Does a method match a deep scene after a change of viewpoint?",
    steps: [
      "Photo A into the deep scene.",
      "Step about 1 m to the side.",
      "Aim at the same centre: photo B.",
    ],
    avoid: "Anything moving in the scene (people, pets, a TV).",
    spotNote: false,
  },
  x: {
    purpose: 'Anything not in the list; the file name says "other".',
    steps: ["Photo A.", "Photo B."],
    avoid: "Anything personal in the picture.",
    spotNote: false,
  },
  none: {
    purpose:
      "A manual benchmark run: the Options decide what runs, and no photo test settings apply.",
    steps: ["Set the Options.", "Photo A.", "Photo B."],
    avoid: "Using it for the photo tests: pick their pair instead.",
    spotNote: false,
  },
};
