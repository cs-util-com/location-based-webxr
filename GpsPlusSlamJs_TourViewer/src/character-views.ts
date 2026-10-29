/**
 * The RULES of a character's five world views (`bubble`, `speak`,
 * `two-stations`, `portrait`, `popup`), kept pure so the three.js look
 * (`character-look.ts`) and its tests read one table: which parts a view
 * draws, the distances it opens at, how far he turns from the creator's
 * facing, when he beckons and how long a line takes to read. The numbers
 * are the station-blocks-7 prototype's
 * (`public/prototypes/station-blocks-7-character/`).
 *
 * @see character-views.ts.md
 */

import {
  TOUR_CHARACTER_VIEWS,
  type TourCharacterView,
} from "gps-plus-slam-app-framework/ar/tour-blocks";

/** The bubble opens within this distance; farther away a name tag shows. */
export const BUBBLE_OPEN_M = 9;
/** The pop-up stage unfolds within this distance... */
export const POPUP_UNFOLD_M = 12;
/** ...and folds again only beyond this one (hysteresis). */
export const POPUP_CLOSE_M = 16;
/** Text keeps its size within this distance and grows beyond it. */
const READING_FLOOR_M = 2.4;
/** The two-stations beckon shows only within this distance of him. */
export const BECKON_WITHIN_M = 14;
/** ...and once he has been heard, or after this long open. */
export const BECKON_AFTER_MS = 6000;

/** The views the world look draws: the format's story views (`card` and
 *  `stage` are not among them). */
export type StageCharacterView = TourCharacterView;

export function isStageCharacterView(
  view: unknown,
): view is StageCharacterView {
  return (TOUR_CHARACTER_VIEWS as readonly unknown[]).includes(view);
}

/** How far (degrees) he turns from the creator's facing toward the
 *  visitor, as in the prototype. */
export const MAX_TURN_DEG = 60;
const MAX_TURN_RAD = (MAX_TURN_DEG * Math.PI) / 180;

const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * The creator's facing of a block whose rotation (a quaternion [x, y, z, w]
 * in the scene's NUE: x north, y up, z east) turns his front, +Z, to some
 * direction: that direction's angle about Up (rad, 0 facing +Z, east;
 * pi/2 facing +X, north). 0 for a malformed rotation or one that turns his
 * front straight up or down.
 */
export function restYawOf(q: readonly number[]): number {
  if (q.length !== 4 || !q.every(Number.isFinite)) return 0;
  const [x, y, z, w] = q as [number, number, number, number];
  const n2 = x * x + y * y + z * z + w * w;
  if (!(n2 > 0)) return 0;
  // +Z turned by the (normalised) quaternion: its x and z.
  const vx = (2 * (x * z + w * y)) / n2;
  const vz = 1 - (2 * (x * x + y * y)) / n2;
  if (Math.hypot(vx, vz) < 1e-9) return 0;
  return Math.atan2(vx, vz);
}

/**
 * Where he faces (rad, about Up, 0 facing +Z): from his rest facing toward
 * the camera's direction, by at most {@link MAX_TURN_DEG}; a view that does
 * not turn (the pop-up) stays at rest. A non-finite rest reads as 0, a
 * non-finite camera direction as no turn.
 */
export function facingYaw(
  restYaw: number,
  toCamera: number,
  turns: boolean,
): number {
  const rest = Number.isFinite(restYaw) ? restYaw : 0;
  if (!turns || !Number.isFinite(toCamera)) return rest;
  const rel = wrapAngle(toCamera - rest);
  return rest + Math.min(MAX_TURN_RAD, Math.max(-MAX_TURN_RAD, rel));
}

/** Which parts one view draws. */
export interface CharacterViewLook {
  /** The standing cut-out (the pop-up draws its own on the stage). */
  readonly figure: boolean;
  /** The speech bubble near, with the line. */
  readonly bubble: boolean;
  /** A footer row in the bubble (the views that talk). */
  readonly footer: boolean;
  /** The name tag far away. */
  readonly pip: boolean;
  /** The pulsing ring at his feet while the voice plays. */
  readonly ring: boolean;
  /** The round portrait in the story card. */
  readonly portrait: boolean;
  /** The folding pop-up stage with the scroll. */
  readonly popup: boolean;
  /** He turns toward the visitor (the pop-up keeps its facing). */
  readonly turns: boolean;
  /** He beckons toward the next station. */
  readonly beckons: boolean;
}

const LOOKS: Readonly<Record<StageCharacterView, CharacterViewLook>> = {
  bubble: look({ bubble: true, pip: true }),
  speak: look({ bubble: true, footer: true, pip: true }),
  "two-stations": look({
    bubble: true,
    footer: true,
    pip: true,
    beckons: true,
  }),
  portrait: look({ pip: true, ring: true, portrait: true }),
  popup: look({ figure: false, popup: true, turns: false }),
};

function look(parts: Partial<CharacterViewLook>): CharacterViewLook {
  return {
    figure: true,
    bubble: false,
    footer: false,
    pip: false,
    ring: false,
    portrait: false,
    popup: false,
    turns: true,
    beckons: false,
    ...parts,
  };
}

export function characterViewLook(view: StageCharacterView): CharacterViewLook {
  return LOOKS[view];
}

/** The bubble is open at this distance (a non-finite one is far). */
export function bubbleOpens(distanceM: number): boolean {
  return Number.isFinite(distanceM) && distanceM < BUBBLE_OPEN_M;
}

/** The pop-up is (or stays) unfolded at this distance. */
export function popupUnfolds(distanceM: number, unfolded: boolean): boolean {
  if (!Number.isFinite(distanceM)) return false;
  return distanceM < (unfolded ? POPUP_CLOSE_M : POPUP_UNFOLD_M);
}

/** The scale text gets so it reads at this distance (never below 1). */
export function readingFloor(distanceM: number): number {
  if (!Number.isFinite(distanceM)) return 1;
  return Math.max(1, distanceM / READING_FLOOR_M);
}

/** The walk's state, as the beckon reads it (`station-run.ts`'s shape). */
export interface BeckonWalk {
  readonly order: "fixed" | "any";
  readonly stations: readonly {
    readonly id: string;
    readonly state: "waiting" | "found" | "done";
  }[];
}

/**
 * The station he beckons toward from `currentId`: he points along the tour
 * order when exactly one next station exists, otherwise there is no beckon.
 * Under a fixed order that is the first undone station after him (or
 * before, when the visitor skipped ahead); under any order, the one undone
 * station left besides his.
 */
export function beckonNext(walk: BeckonWalk, currentId: string): string | null {
  const undone = walk.stations.filter(
    (s) => s.id !== currentId && s.state !== "done",
  );
  if (walk.order === "any") return undone.length === 1 ? undone[0]!.id : null;
  return undone[0]?.id ?? null;
}

/** Screen edges (NDC) a bubble should stay inside. */
export const SCREEN_EDGE = 0.97;
/** A side is given up for the other only when it overflows this much more. */
const SIDE_FLIP_MARGIN = 0.08;
/** A side once chosen is kept unless the other is this much better. */
const SIDE_HYSTERESIS = 0.12;

export interface BubbleSideInput {
  /** His head's screen x, -1 (left) .. 1 (right). */
  readonly x: number;
  /** The bubble's width on screen, in the same units. */
  readonly width: number;
  /** The side chosen last frame. */
  readonly last: "left" | "right" | null;
}

/**
 * Which side of his head the bubble hangs (the prototype's `auto`): toward
 * the middle of the screen; a side that would leave the screen flips to the
 * side with room; a side once chosen is kept until the other is clearly
 * better, so a figure near the centre does not flip it every frame.
 * `overflow` is how far (screen units, signed: + to the right) the chosen
 * side still leaves the screen, for the caller to slide it back.
 */
export function bubbleSide(input: BubbleSideInput): {
  side: "left" | "right";
  overflow: number;
} {
  const x = Number.isFinite(input.x) ? input.x : 0;
  const w = Number.isFinite(input.width) ? Math.max(0, input.width) : 0;
  const over = {
    right: Math.max(0, x + w - SCREEN_EDGE),
    left: Math.max(0, -SCREEN_EDGE - (x - w)),
  };
  let side: "left" | "right" = x > 0.05 ? "left" : "right";
  const other = side === "right" ? "left" : "right";
  if (over[side] > over[other] + SIDE_FLIP_MARGIN) side = other;
  if (
    input.last !== null &&
    input.last !== side &&
    Math.abs(over[side] - over[input.last]) < SIDE_HYSTERESIS
  ) {
    side = input.last;
  }
  return { side, overflow: over[side] * (side === "right" ? 1 : -1) };
}

const READ_MIN_MS = 1500;
const READ_MAX_MS = 60_000;

/**
 * How long a line takes to read, for the `lineEnd` advance of a line with
 * no voice: the prototype's narration timing (a lead of 260 ms, per word
 * 110 + 52 ms a letter within 170-640 ms plus a 70 ms gap, 430 ms after a
 * sentence's end and 210 ms after a comma) plus its 600 ms tail, bounded
 * to 1.5-60 s.
 */
export function lineReadingMs(text: string): number {
  const words =
    typeof text === "string" ? text.split(/\s+/).filter(Boolean) : [];
  let ms = 260 + 600;
  for (const word of words) {
    const letters = word.replace(/[^\p{L}\p{N}]/gu, "").length;
    ms += Math.min(640, Math.max(170, 110 + 52 * letters)) + 70;
    if (/[.!?]["')\]]*$/.test(word)) ms += 430;
    else if (/[,;:]["')\]]*$/.test(word)) ms += 210;
    if (ms > READ_MAX_MS) return READ_MAX_MS;
  }
  return Math.min(READ_MAX_MS, Math.max(READ_MIN_MS, ms));
}
