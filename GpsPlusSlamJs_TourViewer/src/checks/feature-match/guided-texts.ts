/**
 * The words per shot of the photo test, shared by both views: a short
 * title, the scene's setup, the change before the shot, how to take it,
 * the diagram, what it measures and what spoils it; plus the note after a
 * shot's light check. Plain text, set as text.
 *
 * @see guided-texts.ts.md
 */
import type { DiagramKind } from "./guided-diagram";
import type { SceneKind, Shot, ShotKey, ShotLight } from "./scenes";

export interface ShotWords {
  readonly title: string;
  /** What changes after the scene's previous shot; empty on a first shot. */
  readonly change: string;
  /** How to take the shot. */
  readonly capture: string;
  readonly diagram: DiagramKind;
  /** One sentence: what the shot's pair measures. */
  readonly purpose: string;
  /** One short line of what spoils the shot. */
  readonly avoid: string;
}

/** Where a scene's first shot is taken from; shown on every shot of it. */
export const SCENE_SETUP: Readonly<Record<SceneKind, string>> = {
  light:
    "Stand the phone on a table or shelf, aimed at a detailed part of the room.",
  flat: "About 1.5 m from a flat surface with detail (a poster, a patterned door). Phone upright.",
  deep: "Aim into a hallway or a deep room, things near and far.",
  own: "Anything you want to test.",
};

const STILL = "Change nothing.";
const AGAIN = "Capture again.";
const NO_MOVE = "Capture without moving the phone.";
const STEPPING = "Stepping closer or away.";
const MOVING_SCENE = "Anything moving in the scene (people, pets, a TV).";

export const SHOT_WORDS: Readonly<Record<ShotKey, ShotWords>> = {
  L1: {
    title: "Normal light",
    change: "",
    capture: "Light ON as normal. Capture.",
    diagram: "light-same",
    purpose: "The reference the other light shots are matched against.",
    avoid: "Moving the phone between the light shots.",
  },
  L2: {
    title: "Same light again",
    change: STILL,
    capture: AGAIN,
    diagram: "light-same",
    purpose: "How many matches survive when nothing changes.",
    avoid: "Moving the phone, changing the light.",
  },
  L3: {
    title: "Weaker light",
    change: "Dim the light: main light off, one small lamp on. Wait 2 seconds.",
    capture: NO_MOVE,
    diagram: "light-dim",
    purpose: "Does a method still match when the light gets weaker?",
    avoid: "Moving the phone. The camera brightens a dim picture a little.",
  },
  L4: {
    title: "Very little light",
    change: "Dim as far as you can while the shapes still show on the screen.",
    capture: NO_MOVE,
    diagram: "light-dark",
    purpose: "Does a method still match with very little light?",
    avoid: "Fully black (nothing to match), moving the phone.",
  },
  F1: {
    title: "Upright",
    change: "",
    capture: "Capture upright. Holding by hand is fine.",
    diagram: "rot-0",
    purpose:
      "The reference of the flat scene; its turned squares test rotation.",
    avoid: "A deep scene: a flat surface keeps near and far lined up.",
  },
  F2: {
    title: "Upright again",
    change: "Nothing. Same place, upright again.",
    capture: AGAIN,
    diagram: "rot-0",
    purpose: "The baseline for the flat scene's tests.",
    avoid: "Moving between the two shots.",
  },
  F3: {
    title: "Slight tilt",
    change: "Tilt the phone 30-45 deg, like a clock hand at one o'clock.",
    capture: "Capture tilted.",
    diagram: "rot-35",
    purpose: "Does a method cope with a slight tilt?",
    avoid: STEPPING,
  },
  F4: {
    title: "From 3 m",
    change: "Step straight back to about 3 m, keep it centred.",
    capture: "Capture from 3 m.",
    diagram: "dist-2x",
    purpose: "Does a method match the same thing at half the size?",
    avoid: "Zooming instead of stepping back.",
  },
  F5: {
    title: "From 1 m",
    change: "Step forward to about 1 m, keep it centred.",
    capture: "Capture from 1 m.",
    diagram: "dist-forward",
    purpose: "Matched against the 3 m shot: a third of the size.",
    avoid: "Zooming instead of stepping.",
  },
  F6: {
    title: "Step aside",
    change:
      "Back to 1.5 m, then about 1 m to the side, parallel to the surface. Aim at the same centre.",
    capture: "Capture from the new place.",
    diagram: "side-flat",
    purpose: "Does a method match after a change of viewpoint?",
    avoid: STEPPING,
  },
  D1: {
    title: "Deep scene",
    change: "",
    capture: "Capture.",
    diagram: "side-same-deep",
    purpose: "The reference of a scene with depth.",
    avoid: MOVING_SCENE,
  },
  D2: {
    title: "Deep scene again",
    change: STILL,
    capture: AGAIN,
    diagram: "side-same-deep",
    purpose: "The baseline for a scene with depth.",
    avoid: MOVING_SCENE,
  },
  D3: {
    title: "Deep scene, step aside",
    change: "Step about 1 m to the side. Aim at the same centre.",
    capture: "Capture from the new place.",
    diagram: "side-deep",
    purpose: "Does a method match a deep scene after a change of viewpoint?",
    avoid: MOVING_SCENE,
  },
  X1: {
    title: "Your own first photo",
    change: "",
    capture: "Capture.",
    diagram: "other",
    purpose: 'Anything not in the list; the file name says "other".',
    avoid: "Anything personal in the picture.",
  },
  X2: {
    title: "Your own second photo",
    change: "Change one thing.",
    capture: "Capture.",
    diagram: "other",
    purpose: 'Anything not in the list; the file name says "other".',
    avoid: "Anything personal in the picture.",
  },
};

/** What a view shows for one shot. */
export interface ShotCard extends ShotWords {
  readonly setup: string;
}

export const shotCard = (shot: Shot): ShotCard => ({
  ...SHOT_WORDS[shot.key],
  setup: SCENE_SETUP[shot.kind],
});

/** The guided chip while the photos are not stored on this phone. */
export const STORE_CHIP_TEXT = "not stored on this phone: download soon";

/** Said while another tab of the page holds the run. */
export const OTHER_TAB_TEXT =
  "This test is open in another tab: this one takes no photo.";

/** The note after a shot's light check (against L1, and L4 against L3). */
export const LIGHT_NOTE: Readonly<Record<ShotLight, string>> = {
  ok: "Light check: ok.",
  "not-darker": "Not darker than L1. Dim further, then retake this shot.",
  "too-dark-a":
    "L1 is almost black. Go back to L1, turn the light on and retake it.",
  "too-dark-b": "Black: nothing to match. Dim a little less and retake.",
  changed: "The light changed since L1. Retake with the same light.",
  "not-darker-than-dimmed":
    "Not darker than the dimmed shot L3. Dim further and retake.",
};

/** "Retaking F1 redoes 7 measurements": what a retake of `key` costs. */
export const retakeText = (key: ShotKey, pairs: number): string =>
  `Retaking ${key} redoes ${String(pairs)} measurement${pairs === 1 ? "" : "s"}.`;
