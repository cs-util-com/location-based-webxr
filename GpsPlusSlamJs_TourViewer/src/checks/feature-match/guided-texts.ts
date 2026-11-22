/**
 * The guided view's words per photo pair: a short title, the three steps
 * (photo A, the change, photo B) and the diagram that shows the change,
 * plus the review note after a light check. Purpose and avoid line come
 * from `PAIR_GUIDE`, shared with the other view. Plain text, set as text.
 *
 * @see guided-texts.ts.md
 */
import type { LightCheck, PAIRS } from "./bench-export";
import { PAIR_GUIDE } from "./bench-guide";
import type { DiagramKind } from "./guided-diagram";

/** A key of the protocol (every pair but the manual run). */
export type ProtocolKey = (typeof PAIRS)[number]["key"];

export interface GuidedSteps {
  readonly title: string;
  /** Before photo A. */
  readonly a: string;
  /** Between photo A and photo B. */
  readonly change: string;
  /** Photo B. */
  readonly b: string;
  readonly diagram: DiagramKind;
}

const STAY = "Stay where you are.";
const AGAIN = "Capture again.";

export const GUIDED_STEPS: Readonly<Record<ProtocolKey, GuidedSteps>> = {
  "1a": {
    title: "Same light twice",
    a: "Stand the phone on a table or shelf, aimed at a detailed part of the room.",
    change: "Change nothing.",
    b: AGAIN,
    diagram: "light-same",
  },
  "1b": {
    title: "Weaker light",
    a: "Light ON as normal.",
    change: "Dim the light: main light off, one small lamp on. Wait 2 seconds.",
    b: "Capture without moving the phone.",
    diagram: "light-dim",
  },
  "1c": {
    title: "Very little light",
    a: "Light ON as normal.",
    change: "Dim as far as you can while the shapes still show on the screen.",
    b: "Capture without moving the phone.",
    diagram: "light-dark",
  },
  "2a": {
    title: "Upright twice",
    a: "About 1.5 m from a flat surface with detail (poster, patterned door). Phone upright.",
    change: "Nothing. Same place, upright again. Holding by hand is fine.",
    b: AGAIN,
    diagram: "rot-0",
  },
  "2b": {
    title: "Quarter turn",
    a: "Same flat surface, same place. Phone upright.",
    change: "Turn the phone sideways (either way), aim at the same centre.",
    b: "Capture sideways.",
    diagram: "rot-90",
  },
  "2c": {
    title: "Half turn",
    a: "Same flat surface, same place. Phone upright.",
    change: "Hold the phone upside down, aim at the same centre.",
    b: "Capture upside down.",
    diagram: "rot-180",
  },
  "2d": {
    title: "Slight tilt",
    a: "Same flat surface, same place. Phone upright.",
    change: "Tilt the phone 30-45 deg, like a clock hand at one o'clock.",
    b: "Capture tilted.",
    diagram: "rot-35",
  },
  "3a": {
    title: "Same distance twice",
    a: "1.5 m from the flat surface.",
    change: STAY,
    b: AGAIN,
    diagram: "dist-same",
  },
  "3b": {
    title: "Half the size",
    a: "1.5 m from the flat surface.",
    change: "Step straight back to about 3 m, keep it centred.",
    b: "Capture from 3 m.",
    diagram: "dist-2x",
  },
  "3c": {
    title: "A third of the size",
    a: "1 m from the flat surface.",
    change: "Step straight back to about 3 m, keep it centred.",
    b: "Capture from 3 m.",
    diagram: "dist-3x",
  },
  "4a": {
    title: "Flat surface, same spot",
    a: "Aim at the flat surface from one place.",
    change: STAY,
    b: AGAIN,
    diagram: "side-same-flat",
  },
  "4b": {
    title: "Flat surface, step aside",
    a: "Aim at the flat surface.",
    change:
      "Step about 1 m to the side, parallel to it. Aim at the same centre.",
    b: "Capture from the new place.",
    diagram: "side-flat",
  },
  "4c": {
    title: "Deep scene, same spot",
    a: "Aim into a hallway or a deep room, things near and far.",
    change: STAY,
    b: AGAIN,
    diagram: "side-same-deep",
  },
  "4d": {
    title: "Deep scene, step aside",
    a: "Aim into the deep scene.",
    change: "Step about 1 m to the side. Aim at the same centre.",
    b: "Capture from the new place.",
    diagram: "side-deep",
  },
  x: {
    title: "Your own pair",
    a: "Anything you want to test.",
    change: "Change one thing.",
    b: "Capture.",
    diagram: "other",
  },
};

/** What the guided card shows for one pair. */
export interface GuidedCard extends GuidedSteps {
  readonly purpose: string;
  readonly avoid: string;
}

export const guidedCard = (key: ProtocolKey): GuidedCard => ({
  ...GUIDED_STEPS[key],
  purpose: PAIR_GUIDE[key].purpose,
  avoid: PAIR_GUIDE[key].avoid,
});

/** The review note after both photos, per light check. */
export const LIGHT_NOTE: Readonly<Record<LightCheck, string>> = {
  ok: "Light check: ok.",
  "not-darker":
    "Photo B is not darker than A. Turn the light on, retake A, dim, then retake B.",
  "too-dark-a": "Photo A is almost black. Turn the light on and retake A.",
  "too-dark-b":
    "Photo B is black: nothing to match. Dim a little less and retake B.",
  changed:
    "The light changed during the control pair. Retake B with the same light.",
};
