/**
 * Which way a station is, in words (visitor walk W4 build plan
 * 2026-10-21-1105, M3, §1.5, §1.6, §5): "ahead", "to your left", "to your
 * right", "behind you" - the one direction rule for the peek's tail, the
 * list's rows and (M5) the edge pill. W4 had two rules ("behind" past 140°
 * in its words, past 137.5° in its pill); the build has this one.
 *
 * The angle is the station's bearing relative to the camera's
 * (`bearingDeltaDeg(stationBearing, cameraBearing)`, positive to the
 * right). A word changes only once the angle passes its threshold by the
 * hysteresis, so a visitor turning slowly across a threshold, or a phone
 * jittering in the hand, does not make the word flicker.
 *
 * @see walk-direction.ts.md
 */

import { bearingDeltaDeg } from "gps-plus-slam-app-framework/utils/bearing-degrees";

export type WalkDirection = "ahead" | "left" | "right" | "behind";

/**
 * "Ahead" within this angle of the view's centre (W4's `dirWord`). About
 * half a phone's horizontal field of view in portrait (64° in W4): a
 * station called "ahead" is on screen. Swept 20-35° in
 * `walk-direction.sweep.test.ts`; the phone decides (plan §3.2).
 */
export const WALK_AHEAD_DEG = 28;

/**
 * "Behind you" beyond this angle (W4's `dirWord`; its pill's 137.5° is the
 * rule the build does not take). Swept 120-150°.
 */
export const WALK_BEHIND_DEG = 140;

/**
 * How far past a threshold the angle must go before the word changes
 * (plan §5: default 5°, swept 0-10°). A phone held still jitters by a
 * degree or two; 5° outlasts that and is still well inside the 28° zone.
 */
export const WALK_DIRECTION_HYSTERESIS_DEG = 5;

export interface WalkDirectionOptions {
  readonly aheadDeg?: number;
  readonly behindDeg?: number;
  readonly hysteresisDeg?: number;
}

function zoneOf(d: number, a: number, aheadDeg: number, behindDeg: number) {
  if (d < aheadDeg) return "ahead";
  if (d > behindDeg) return "behind";
  return a > 0 ? "right" : "left";
}

/** Whether the angle still lies in `word`'s zone grown by `h`. */
function holds(
  word: WalkDirection,
  a: number,
  d: number,
  aheadDeg: number,
  behindDeg: number,
  h: number,
): boolean {
  switch (word) {
    case "ahead":
      return d < aheadDeg + h;
    case "behind":
      return d > behindDeg - h;
    case "right":
      return a > 0 && d > aheadDeg - h && d <= behindDeg + h;
    case "left":
      return a < 0 && d > aheadDeg - h && d <= behindDeg + h;
  }
}

/**
 * The word for a relative bearing `angleDeg` (degrees, positive to the
 * right; wrapped into (-180, 180] first), keeping `previous` while the
 * angle stays within the hysteresis of its zone.
 *
 * @returns null for an angle that is no finite number.
 * @throws RangeError for thresholds that do not make three zones
 *   (`0 < ahead < behind < 180`, the band at least 0 and narrower than
 *   either zone's margin).
 */
export function walkDirection(
  angleDeg: number,
  previous: WalkDirection | null = null,
  options: WalkDirectionOptions = {},
): WalkDirection | null {
  const aheadDeg = options.aheadDeg ?? WALK_AHEAD_DEG;
  const behindDeg = options.behindDeg ?? WALK_BEHIND_DEG;
  const h = options.hysteresisDeg ?? WALK_DIRECTION_HYSTERESIS_DEG;
  if (
    !(aheadDeg > 0 && aheadDeg < behindDeg && behindDeg < 180) ||
    !(h >= 0 && h < aheadDeg && h < 180 - behindDeg)
  ) {
    throw new RangeError(
      `walk-direction: thresholds ahead ${String(aheadDeg)}°, behind ${String(behindDeg)}°, band ${String(h)}° make no three zones`,
    );
  }
  if (!Number.isFinite(angleDeg)) return null;
  const a = bearingDeltaDeg(angleDeg, 0);
  const d = Math.abs(a);
  if (previous !== null && holds(previous, a, d, aheadDeg, behindDeg, h)) {
    return previous;
  }
  return zoneOf(d, a, aheadDeg, behindDeg);
}

const PHRASES: Record<WalkDirection, string> = {
  ahead: "ahead",
  left: "to your left",
  right: "to your right",
  behind: "behind you",
};

/** The row's words: "ahead", "to your left", "to your right", "behind you". */
export function walkDirectionPhrase(word: WalkDirection): string {
  return PHRASES[word];
}

/** The peek's tail: "Ahead.", "To your left.", "To your right.",
 *  "Behind you." */
export function walkDirectionTail(word: WalkDirection): string {
  const phrase = PHRASES[word];
  return `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;
}

/** Each station's word with its own memory for the band. */
export interface WalkDirections {
  /** The word for station `id` at `angleDeg`; null (and the station
   *  forgotten) without an angle (no heading). */
  of(id: string, angleDeg: number | null): WalkDirection | null;
  /** Forget every station (another tour, the session's end). */
  reset(): void;
}

/**
 * The memory behind the band, one word per station. A view resource (a
 * closure, never the store: it changes with the camera's heading, many
 * times a second).
 */
export function createWalkDirections(
  options: WalkDirectionOptions = {},
): WalkDirections {
  const words = new Map<string, WalkDirection>();
  return {
    of(id, angleDeg) {
      const word =
        angleDeg === null
          ? null
          : walkDirection(angleDeg, words.get(id) ?? null, options);
      if (word === null) words.delete(id);
      else words.set(id, word);
      return word;
    },
    reset() {
      words.clear();
    },
  };
}
